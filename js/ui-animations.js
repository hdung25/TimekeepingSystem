// Isolated UI Animations Service
// Safe to remove without breaking app logic

const UIAnimations = {
    // Configuration
    settings: {
        duration: 1500, // ms
        frameRate: 60
    },

    init: function () {
        console.log("UI Animations Initialized");
        this.observeDashboardStats();
        this.addCardHoverEffects();
    },

    // 1. Observe Dashboard Numbers
    observeDashboardStats: function () {
        // IDs to watch
        const statIds = ['stat-total-users', 'stat-active-today', 'stat-late', 'stat-leave'];

        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    const node = mutation.target;
                    const value = parseInt(node.innerText);

                    // Only animate if it's a valid number and hasn't been animated yet
                    if (!isNaN(value) && !node.classList.contains('animated-done')) {
                        node.classList.add('animated-done'); // Mark as handled
                        this.animateValue(node, 0, value, this.settings.duration);
                    }
                }
            });
        });

        statIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                observer.observe(el, { childList: true });
            }
        });

        // Also observe the table for row insertions
        const tableBody = document.getElementById('recent-activity-body');
        if (tableBody) {
            const tableObserver = new MutationObserver((mutations) => {
                mutations.forEach(mutation => {
                    if (mutation.addedNodes.length) {
                        this.animateTableRows(mutation.addedNodes);
                    }
                });
            });
            tableObserver.observe(tableBody, { childList: true });
        }
    },

    // 2. Count Up Logic
    animateValue: function (obj, start, end, duration) {
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);

            // Ease Out Quad Formula
            const easeProgress = 1 - (1 - progress) * (1 - progress);

            obj.innerHTML = Math.floor(progress * (end - start) + start);

            if (progress < 1) {
                window.requestAnimationFrame(step);
            } else {
                obj.innerHTML = end;
            }
        };
        window.requestAnimationFrame(step);
    },

    // 3. Table Stagger Animation
    animateTableRows: function (nodes) {
        let delay = 0;
        nodes.forEach(node => {
            if (node.nodeType === 1) { // Element node
                node.style.opacity = '0';
                node.style.transform = 'translateY(10px)';
                node.style.transition = 'opacity 0.5s ease, transform 0.5s ease';

                setTimeout(() => {
                    node.style.opacity = '1';
                    node.style.transform = 'translateY(0)';
                }, delay);
                delay += 100; // 100ms stagger
            }
        });
    },

    // 4. Card Hover (JS Fallback or enhancement)
    addCardHoverEffects: function () {
        const cards = document.querySelectorAll('.glass-panel');
        cards.forEach(card => {
            card.addEventListener('mouseenter', () => {
                card.style.transform = 'translateY(-5px)';
                card.style.boxShadow = 'var(--shadow-xl)';
                card.style.transition = 'all 0.3s ease';
            });
            card.addEventListener('mouseleave', () => {
                card.style.transform = 'translateY(0)';
                card.style.boxShadow = 'var(--shadow-lg)';
            });
        });
    }
};

// Auto-start when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Small delay to ensure core logic runs first
    setTimeout(() => {
        UIAnimations.init();
    }, 100);
});
