import { Auth } from './auth.js';

export const App = {
    init() {
        const getCookie = (n) => {
            const m = document.cookie.match(new RegExp('(^| )' + n + '=([^;]+)'));
            return m ? m[2] : null;
        };

        if (getCookie('token')) window.location.href = '/app';

        const $ = id => document.getElementById(id);
        const userEl = $('inp-user'), passEl = $('inp-pass'), errEl = $('error-msg'), btnEl = $('btn-submit');
        const regUserEl = $('reg-user'), regPassEl = $('reg-pass'), regPass2El = $('reg-pass2'), regMsgEl = $('register-msg'), btnRegEl = $('btn-register');

        if (userEl) userEl.addEventListener('keydown', e => e.key === 'Enter' && passEl.focus());
        if (passEl) passEl.addEventListener('keydown', e => e.key === 'Enter' && this.doLogin());
        [userEl, passEl].forEach(el => el && el.addEventListener('input', () => errEl.textContent = ''));

        if (regUserEl) regUserEl.addEventListener('keydown', e => e.key === 'Enter' && regPassEl.focus());
        if (regPassEl) regPassEl.addEventListener('keydown', e => e.key === 'Enter' && regPass2El.focus());
        if (regPass2El) regPass2El.addEventListener('keydown', e => e.key === 'Enter' && this.doRegister());
        [regUserEl, regPassEl, regPass2El].forEach(el => el && el.addEventListener('input', () => {
            regMsgEl.textContent = ''; regMsgEl.classList.remove('success');
        }));

        if (btnEl) btnEl.addEventListener('click', () => this.doLogin());
        if (btnRegEl) btnRegEl.addEventListener('click', () => this.doRegister());

        window.toggleForm = this.toggleForm.bind(this);

        this.updateThemeIcon(document.documentElement.getAttribute('data-theme') || 'dark');

        window.addEventListener('storage', e => {
            if (e.key === 'theme' && e.newValue) {
                document.documentElement.setAttribute('data-theme', e.newValue);
                this.updateThemeIcon(e.newValue);
            }
        });

        if (window.I18n) window.I18n.init();

        const lastUser = localStorage.getItem('last_user');
        if (lastUser && userEl) { userEl.value = lastUser; if (passEl) passEl.focus(); }
    },

    toggleForm(e) {
        if (e) e.preventDefault();
        const $ = id => document.getElementById(id);
        const userEl = $('inp-user'), errEl = $('error-msg');
        const regUserEl = $('reg-user'), regMsgEl = $('register-msg');
        const login = $('login-form'), reg = $('register-form');
        
        if (!login || !reg) return;
        const isLogin = login.style.display !== 'none';
        (isLogin ? login : reg).style.opacity = '0';
        setTimeout(() => {
            if (isLogin) {
                login.style.display = 'none'; reg.style.display = 'block'; reg.style.opacity = '0';
                $('card-title').textContent = window.t ? window.t('reg_title') : 'Registro'; 
                $('card-sub').textContent = window.t ? window.t('reg_sub') : '';
                setTimeout(() => { reg.style.opacity = '1'; if(regUserEl) regUserEl.focus(); }, 20);
            } else {
                reg.style.display = 'none'; login.style.display = 'block'; login.style.opacity = '0';
                $('card-title').textContent = window.t ? window.t('welcome') : 'Bienvenido'; 
                $('card-sub').textContent = window.t ? window.t('login_sub') : '';
                setTimeout(() => { login.style.opacity = '1'; if(userEl) userEl.focus(); }, 20);
            }
            if(errEl) errEl.textContent = ''; 
            if(regMsgEl) { regMsgEl.textContent = ''; regMsgEl.classList.remove('success'); }
        }, 180);
    },

    async doLogin() {
        const $ = id => document.getElementById(id);
        const userEl = $('inp-user'), passEl = $('inp-pass'), errEl = $('error-msg'), btnEl = $('btn-submit');
        const user = userEl.value.trim(), pass = passEl.value;
        const t = window.t || (k => k);
        const UI = window.UI;
        
        if (!user || !pass) { errEl.textContent = t('err_empty'); if(UI) UI.shake(); return; }
        
        if(UI) UI.setLoading(btnEl, true); 
        errEl.textContent = '';
        
        try {
            const data = await Auth.login(user, pass);
            
            if (data.ok) {
                localStorage.setItem('last_user', user); 
                if(UI) UI.setLoading(btnEl, false);
                btnEl.querySelector('.btn-text').textContent = t('success_login');
                btnEl.style.background = 'linear-gradient(135deg,#059669,#047857)';
                setTimeout(() => window.location.href = '/app', 600);
            } else {
                const msg = data.error_code ? t(data.error_code) : data.error;
                errEl.textContent = '⚠ ' + msg; 
                if(UI) UI.setLoading(btnEl, false);
                if(UI) UI.shake(); 
                passEl.value = ''; 
                passEl.focus();
            }
        } catch (e) { 
            errEl.textContent = t('err_conn'); 
            if(UI) UI.setLoading(btnEl, false); 
        }
    },

    async doRegister() {
        const $ = id => document.getElementById(id);
        const userEl = $('inp-user'), passEl = $('inp-pass');
        const regUserEl = $('reg-user'), regPassEl = $('reg-pass'), regPass2El = $('reg-pass2'), regMsgEl = $('register-msg'), btnRegEl = $('btn-register');
        const user = regUserEl.value.trim(), pass = regPassEl.value, pass2 = regPass2El.value;
        const t = window.t || (k => k);
        const UI = window.UI;
        
        if (!user || !pass || !pass2) { regMsgEl.textContent = t('err_empty'); if(UI) UI.shakeReg(); return; }
        if (!Auth.isValidPassword(pass)) { regMsgEl.textContent = t('err_pass_short'); if(UI) UI.shakeReg(); return; }
        if (pass !== pass2) { regMsgEl.textContent = t('err_match'); if(UI) UI.shakeReg(); regPass2El.focus(); return; }
        
        if(UI) UI.setLoading(btnRegEl, true); 
        regMsgEl.textContent = '';
        
        try {
            const data = await Auth.register(user, pass);
            
            if (data.ok) {
                if(UI) UI.setLoading(btnRegEl, false);
                btnRegEl.querySelector('.btn-text').textContent = t('success_reg');
                btnRegEl.style.background = 'linear-gradient(135deg,#059669,#047857)';
                regMsgEl.classList.add('success'); 
                regMsgEl.textContent = t('redirect');
                setTimeout(() => {
                    btnRegEl.style.background = ''; btnRegEl.querySelector('.btn-text').textContent = t('register_btn');
                    regUserEl.value = ''; regPassEl.value = ''; regPass2El.value = '';
                    this.toggleForm(null); userEl.value = user; passEl.focus();
                }, 1200);
            } else {
                let msg = data.error_code ? t(data.error_code) : data.error;
                if (data.error_code === 'err_in_use' && data.suggestions && data.suggestions.length) {
                    msg += " " + t('try_with') + " " + data.suggestions.join(', ');
                }
                regMsgEl.textContent = '⚠ ' + msg; 
                if(UI) UI.setLoading(btnRegEl, false); 
                if(UI) UI.shakeReg();
            }
        } catch (e) { 
            regMsgEl.textContent = t('err_conn'); 
            if(UI) UI.setLoading(btnRegEl, false); 
        }
    },

    updateThemeIcon(theme) {
        const icon = document.getElementById('theme-icon-svg'); if (!icon) return;
        icon.innerHTML = theme === 'light'
            ? '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>'
            : '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
    }
};

window.toggleTheme = () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    App.updateThemeIcon(next);
};
