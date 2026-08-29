const UI = {
    setLoading(btn, on) {
        if (!btn) return;
        btn.disabled = on;
        btn.classList.toggle('loading', on);
    },
    shake() {
        const c = document.getElementById('card');
        if (!c) return;
        c.style.animation = 'none';
        c.offsetHeight; // trigger reflow
        c.style.animation = 'shake 0.4s ease';
    },
    shakeReg() {
        const f = document.getElementById('register-form');
        if (!f) return;
        f.style.animation = 'none';
        f.offsetHeight;
        f.style.animation = 'shake 0.4s ease';
    },
    togglePassword(id) {
        const el = document.getElementById(id);
        if (el) el.type = el.type === 'password' ? 'text' : 'password';
    }
};

window.UI = UI;
