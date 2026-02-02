@echo off
echo === DANG DAY CODE LEN GITHUB ===
echo Luu y: Neu he thong yeu cau dang nhap, cua so trinh duyet se hien len.
echo Hay dang nhap tai khoan GitHub cua anh.
echo --------------------------------
"C:\Program Files\Git\cmd\git.exe" push -u origin main
if %errorlevel% neq 0 (
    echo.
    echo [!] Co loi xay ra (hoac khong tim thay Git).
    echo Hay thu khoi dong lai may hoac cai dat lai Git.
    git push -u origin main
)
echo.
echo === HOAN TAT ===
pause
