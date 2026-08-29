const Auth = {
    // Nueva validación de formato antes de enviar nada
    isUsernameValid(username) {
        const regex = /^[a-zA-Z0-9_-]{3,16}$/;
        return regex.test(username);
    },

        async login(username, password) {
        if (!this.isUsernameValid(username)) {
            throw new Error("err_user_format"); // Se manejará en el frontend traduciéndolo
        }
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        return await res.json();
    },

        async register(username, password) {
        if (!this.isUsernameValid(username)) {
            throw new Error("err_user_format");
        }
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        return await res.json();
    },

        isValidPassword(password) {
        return password.length >= 6; // Ejemplo: mínimo 6 caracteres
    }
};

export { Auth };
