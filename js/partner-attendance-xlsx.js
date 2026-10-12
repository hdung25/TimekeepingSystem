// Dedicated attendance workbook writer, reused from the tested payroll ZIP/XLSX implementation.
(function () {
    "use strict";
    let _crcTable = null;
    function crcTable() {
        if (_crcTable) return _crcTable;
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[n] = c >>> 0;
        }
        _crcTable = t;
        return t;
    }

    function crc32(bytes) {
        const t = crcTable();
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }

    // Giờ trong ZIP theo định dạng MS-DOS
    function dosDateTime(d) {
        const time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() / 2) & 0x1F);
        const date = (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0x0F) << 5) | (d.getDate() & 0x1F);
        return { time: time & 0xFFFF, date: date & 0xFFFF };
    }

    // entries: [{ name: string, text?: string, bytes?: Uint8Array }] → Blob
    function buildZip(entries, mimeType) {
        const enc = new TextEncoder();
        const stamp = dosDateTime(new Date());
        const parts = [];
        const central = [];
        let offset = 0;

        entries.forEach(entry => {
            const nameBytes = enc.encode(entry.name);
            const dataBytes = entry.bytes instanceof Uint8Array ? entry.bytes : enc.encode(entry.text || '');
            const crc = crc32(dataBytes);

            // Local file header (30 bytes + name)
            const lh = new DataView(new ArrayBuffer(30));
            lh.setUint32(0, 0x04034b50, true);   // signature
            lh.setUint16(4, 20, true);           // version needed
            lh.setUint16(6, 0x0800, true);       // flag: tên file là UTF-8
            lh.setUint16(8, 0, true);            // method 0 = STORE
            lh.setUint16(10, stamp.time, true);
            lh.setUint16(12, stamp.date, true);
            lh.setUint32(14, crc, true);
            lh.setUint32(18, dataBytes.length, true);
            lh.setUint32(22, dataBytes.length, true);
            lh.setUint16(26, nameBytes.length, true);
            lh.setUint16(28, 0, true);           // extra length
            parts.push(new Uint8Array(lh.buffer), nameBytes, dataBytes);

            // Central directory entry (46 bytes + name)
            const cd = new DataView(new ArrayBuffer(46));
            cd.setUint32(0, 0x02014b50, true);
            cd.setUint16(4, 20, true);           // version made by
            cd.setUint16(6, 20, true);           // version needed
            cd.setUint16(8, 0x0800, true);
            cd.setUint16(10, 0, true);
            cd.setUint16(12, stamp.time, true);
            cd.setUint16(14, stamp.date, true);
            cd.setUint32(16, crc, true);
            cd.setUint32(20, dataBytes.length, true);
            cd.setUint32(24, dataBytes.length, true);
            cd.setUint16(28, nameBytes.length, true);
            cd.setUint16(30, 0, true);           // extra
            cd.setUint16(32, 0, true);           // comment
            cd.setUint16(34, 0, true);           // disk number
            cd.setUint16(36, 0, true);           // internal attrs
            cd.setUint32(38, 0, true);           // external attrs
            cd.setUint32(42, offset, true);      // offset of local header
            central.push(new Uint8Array(cd.buffer), nameBytes);

            offset += 30 + nameBytes.length + dataBytes.length;
        });

        const centralSize = central.reduce((sum, a) => sum + a.length, 0);
        const eocd = new DataView(new ArrayBuffer(22));
        eocd.setUint32(0, 0x06054b50, true);
        eocd.setUint16(4, 0, true);
        eocd.setUint16(6, 0, true);
        eocd.setUint16(8, entries.length, true);
        eocd.setUint16(10, entries.length, true);
        eocd.setUint32(12, centralSize, true);
        eocd.setUint32(16, offset, true);
        eocd.setUint16(20, 0, true);

        return new Blob([...parts, ...central, new Uint8Array(eocd.buffer)], { type: mimeType || 'application/zip' });
    }

    const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    function xmlEsc(s) {
        return String(s == null ? '' : s)
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function colName(i) {
        let s = '';
        i += 1;
        while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
        return s;
    }

    // Kiểu ô (chỉ số trong cellXfs của styles.xml bên dưới)
    const ST = { title: 1, sub: 2, head: 3, text: 4, center: 5, money: 6, totalLabel: 7, totalMoney: 8, note: 9, net: 10, totalCenter: 11 };

    const STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.00"/></numFmts>'
        + '<fonts count="5">'
        + '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'
        + '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>'
        + '<font><b/><sz val="15"/><color rgb="FF047857"/><name val="Calibri"/><family val="2"/></font>'
        + '<font><i/><sz val="10"/><color rgb="FF5B6660"/><name val="Calibri"/><family val="2"/></font>'
        + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>'
        + '</fonts>'
        + '<fills count="4">'
        + '<fill><patternFill patternType="none"/></fill>'
        + '<fill><patternFill patternType="gray125"/></fill>'
        + '<fill><patternFill patternType="solid"><fgColor rgb="FF047857"/><bgColor indexed="64"/></patternFill></fill>'
        + '<fill><patternFill patternType="solid"><fgColor rgb="FFECFDF5"/><bgColor indexed="64"/></patternFill></fill>'
        + '</fills>'
        + '<borders count="2">'
        + '<border><left/><right/><top/><bottom/><diagonal/></border>'
        + '<border><left style="thin"><color rgb="FFC9D3CE"/></left><right style="thin"><color rgb="FFC9D3CE"/></right>'
        + '<top style="thin"><color rgb="FFC9D3CE"/></top><bottom style="thin"><color rgb="FFC9D3CE"/></bottom><diagonal/></border>'
        + '</borders>'
        + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        + '<cellXfs count="12">'
        + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
        + '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
        + '<xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
        + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
        + '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        + '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>'
        + '<xf numFmtId="164" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
        + '<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        + '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
        + '</cellXfs>'
        + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        + '</styleSheet>';

    // cell: { v, s, f } — v là số → ô số; chuỗi → ô chữ; f = công thức (v là giá trị tính sẵn)
    function cellXml(ref, cell) {
        if (cell == null) return '';
        const s = cell.s != null ? ` s="${cell.s}"` : '';
        if (cell.f) return `<c r="${ref}"${s}><f>${xmlEsc(cell.f)}</f><v>${Number(cell.v) || 0}</v></c>`;
        if (typeof cell.v === 'number' && Number.isFinite(cell.v)) return `<c r="${ref}"${s}><v>${cell.v}</v></c>`;
        if (cell.v == null || cell.v === '') return `<c r="${ref}"${s}/>`;
        return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(cell.v)}</t></is></c>`;
    }

    // sheet: { name, widths:[], rows:[{ cells:[cell], ht? }], merges:[ 'A1:K1' ], headerRow }
    function sheetXml(sheet) {
        const lastCol = colName(sheet.widths.length - 1);
        const cols = sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
        const rows = sheet.rows.map((row, ri) => {
            const r = ri + 1;
            const ht = row.ht ? ` ht="${row.ht}" customHeight="1"` : '';
            const cells = (row.cells || []).map((c, ci) => cellXml(colName(ci) + r, c)).join('');
            return `<row r="${r}"${ht}>${cells}</row>`;
        }).join('');
        const h = sheet.headerRow;
        const pane = h ? `<pane ySplit="${h}" topLeftCell="A${h + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${h + 1}" sqref="A${h + 1}"/>` : '';
        const merges = sheet.merges && sheet.merges.length
            ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
            + `<dimension ref="A1:${lastCol}${Math.max(1, sheet.rows.length)}"/>`
            + `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>`
            + '<sheetFormatPr defaultRowHeight="18"/>'
            + `<cols>${cols}</cols>`
            + `<sheetData>${rows}</sheetData>`
            + merges
            + '<printOptions horizontalCentered="1"/>'
            + '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>'
            + '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
            + '</worksheet>';
    }

    function buildXlsx(sheets) {
        const ctSheets = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
        const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            + '<Default Extension="xml" ContentType="application/xml"/>'
            + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            + ctSheets
            + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            + '</Types>';
        const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            + '</Relationships>';
        const printTitles = sheets.map((sh, i) => sh.headerRow
            ? `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${sh.name.replace(/'/g, "''")}'!$${sh.headerRow}:$${sh.headerRow}</definedName>` : '').join('');
        const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            + '<bookViews><workbookView activeTab="0"/></bookViews><sheets>'
            + sheets.map((sh, i) => `<sheet name="${xmlEsc(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
            + '</sheets>'
            + (printTitles ? `<definedNames>${printTitles}</definedNames>` : '')
            + '</workbook>';
        const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
            + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
            + '</Relationships>';

        const entries = [
            { name: '[Content_Types].xml', text: contentTypes },
            { name: '_rels/.rels', text: rootRels },
            { name: 'xl/workbook.xml', text: workbook },
            { name: 'xl/_rels/workbook.xml.rels', text: wbRels },
            { name: 'xl/styles.xml', text: STYLES_XML }
        ].concat(sheets.map((sh, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(sh) })));
        return buildZip(entries, XLSX_MIME);
    }
    window.PartnerAttendanceXlsx = {build:buildXlsx};
})();
