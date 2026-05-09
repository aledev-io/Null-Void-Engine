'use strict';

/**
 * login.js — Gestión de Login, Registro y Temas
 */

// ── Comprobar token existente ──
function getCookie(name) {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? match[2] : null;
}
if (getCookie('token')) window.location.href = '/app';

// ── Referencias ──
const userEl  = document.getElementById('inp-user');
const passEl  = document.getElementById('inp-pass');
const errEl   = document.getElementById('error-msg');
const btnEl   = document.getElementById('btn-submit');

const regUserEl  = document.getElementById('reg-user');
const regPassEl  = document.getElementById('reg-pass');
const regPass2El = document.getElementById('reg-pass2');
const regMsgEl   = document.getElementById('register-msg');
const btnRegEl   = document.getElementById('btn-register');

// ── Eventos teclado — login ──
if (userEl) {
    userEl.addEventListener('keydown', e => { if (e.key === 'Enter') passEl.focus(); });
    passEl.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    [userEl, passEl].forEach(el => el.addEventListener('input', () => errEl.textContent = ''));
}

// ── Eventos teclado — registro ──
if (regUserEl) {
    regUserEl.addEventListener('keydown',  e => { if (e.key === 'Enter') regPassEl.focus(); });
    regPassEl.addEventListener('keydown',  e => { if (e.key === 'Enter') regPass2El.focus(); });
    regPass2El.addEventListener('keydown', e => { if (e.key === 'Enter') doRegister(); });
    [regUserEl, regPassEl, regPass2El].forEach(el =>
        el.addEventListener('input', () => {
            regMsgEl.textContent = '';
            regMsgEl.classList.remove('success');
        })
    );
}

// ── Toggle Login ↔ Registro ──
function toggleForm(e) {
    if (e) e.preventDefault();
    const login    = document.getElementById('login-form');
    const register = document.getElementById('register-form');
    const title    = document.getElementById('card-title');
    const sub      = document.getElementById('card-sub');
    if (!login || !register) return;
    const isLogin  = login.style.display !== 'none';

    // Fade out
    const current = isLogin ? login : register;
    current.style.opacity = '0';

    setTimeout(() => {
        if (isLogin) {
            login.style.display    = 'none';
            register.style.display = 'block';
            register.style.opacity = '0';
            title.textContent = 'Registro';
            sub.textContent   = 'Crea tu cuenta para continuar';
            setTimeout(() => { register.style.opacity = '1'; if(regUserEl) regUserEl.focus(); }, 20);
        } else {
            register.style.display = 'none';
            login.style.display    = 'block';
            login.style.opacity    = '0';
            title.textContent = 'Bienvenido';
            sub.textContent   = 'Inicia sesión para continuar';
            setTimeout(() => { login.style.opacity = '1'; if(userEl) userEl.focus(); }, 20);
        }
        // Limpiar campos y mensajes
        errEl.textContent = '';
        regMsgEl.textContent = '';
        regMsgEl.classList.remove('success');
    }, 180);
}

// ── LOGIN ──
async function doLogin() {
    const user = userEl.value.trim();
    const pass = passEl.value;
    if (!user || !pass) { errEl.textContent = 'Rellena todos los campos'; shake(); return; }
    setLoading(btnEl, true);
    errEl.textContent = '';
    try {
        const res  = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user, password: pass })
        });
        const data = await res.json();
        if (data.ok) {
            setLoading(btnEl, false);
            btnEl.querySelector('.btn-text').textContent = '✓ Acceso concedido';
            btnEl.style.background = 'linear-gradient(135deg, #059669, #047857)';
            setTimeout(() => window.location.href = '/app', 600);
        } else {
            errEl.textContent = '⚠ ' + data.error;
            setLoading(btnEl, false);
            shake();
            passEl.value = '';
            passEl.focus();
        }
    } catch {
        errEl.textContent = '⚠ Error de conexión con el servidor';
        setLoading(btnEl, false);
    }
}

// ── REGISTRO ──
async function doRegister() {
    const user  = regUserEl.value.trim();
    const pass  = regPassEl.value;
    const pass2 = regPass2El.value;
    if (!user || !pass || !pass2) {
        regMsgEl.textContent = 'Rellena todos los campos';
        regMsgEl.classList.remove('success');
        shakeReg();
        return;
    }
    if (pass !== pass2) {
        regMsgEl.textContent = '⚠ Las contraseñas no coinciden';
        regMsgEl.classList.remove('success');
        shakeReg();
        regPass2El.focus();
        return;
    }
    if (pass.length < 6) {
        regMsgEl.textContent = '⚠ La contraseña debe tener al menos 6 caracteres';
        regMsgEl.classList.remove('success');
        shakeReg();
        return;
    }
    setLoading(btnRegEl, true);
    regMsgEl.textContent = '';
    try {
        const res  = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user, password: pass })
        });
        const data = await res.json();
        if (data.ok) {
            setLoading(btnRegEl, false);
            btnRegEl.querySelector('.btn-text').textContent = '✓ Cuenta creada';
            btnRegEl.style.background = 'linear-gradient(135deg, #059669, #047857)';
            regMsgEl.classList.add('success');
            regMsgEl.textContent = 'Redirigiendo al inicio de sesión…';
            setTimeout(() => {
                btnRegEl.style.background = '';
                btnRegEl.querySelector('.btn-text').textContent = 'Crear cuenta';
                regUserEl.value = '';
                regPassEl.value = '';
                regPass2El.value = '';
                toggleForm(null);
                userEl.value = user;
                passEl.focus();
            }, 1200);
        } else {
            regMsgEl.textContent = '⚠ ' + data.error;
            regMsgEl.classList.remove('success');
            setLoading(btnRegEl, false);
            shakeReg();
        }
    } catch {
        regMsgEl.textContent = '⚠ Error de conexión con el servidor';
        regMsgEl.classList.remove('success');
        setLoading(btnRegEl, false);
    }
}

// ── Helpers ──
function setLoading(btn, on) {
    if (!btn) return;
    btn.disabled = on;
    btn.classList.toggle('loading', on);
}

function shake() {
    const card = document.getElementById('card');
    if (!card) return;
    card.style.animation = 'none';
    card.offsetHeight;
    card.style.animation = 'shake 0.4s ease';
}

function shakeReg() {
    const form = document.getElementById('register-form');
    if (!form) return;
    form.style.animation = 'none';
    form.offsetHeight;
    form.style.animation = 'shake 0.4s ease';
}

// ── GESTIÓN DE TEMA ──
function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeIcon(next);
}

function updateThemeIcon(theme) {
    const icon = document.getElementById('theme-icon-svg');
    if (!icon) return;
    if (theme === 'light') {
        icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
    } else {
        icon.innerHTML = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
    }
}

// Inicialización
window.doLogin = doLogin;
window.doRegister = doRegister;
window.toggleForm = toggleForm;
window.toggleTheme = toggleTheme;
updateThemeIcon(document.documentElement.getAttribute('data-theme') || 'dark');