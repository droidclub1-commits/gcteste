const form = document.getElementById('first-access-form');
const recoveryForm = document.getElementById('password-recovery-form');
const status = document.getElementById('first-access-status');
const fragment = new URLSearchParams(location.hash.slice(1));
const type = fragment.get('type');
const callback = type === 'invite' || type === 'recovery';
const token = callback ? fragment.get('access_token') : null;
const invalidLink = 'O link está inválido ou expirou. Solicite um novo link.';
const client = () => import('./js/config.js').then(module => module.sb);

async function initialize() {
    if (!token) {
        recoveryForm.hidden = false;
        if (callback || fragment.has('error') || fragment.has('error_code')) status.textContent = invalidLink;
        return;
    }
    document.getElementById('password-page-title').textContent = type === 'invite' ? 'Primeiro acesso' : 'Redefinir senha';
    document.getElementById('password-page-description').textContent = 'Defina uma nova senha para acessar o Gestor Cidadão.';
    status.textContent = 'Verificando o link…';
    const sb = await client();
    const { data, error } = await sb.auth.getSession();
    if (error || data.session?.access_token !== token) {
        status.textContent = invalidLink;
        recoveryForm.hidden = false;
        return;
    }
    form.hidden = false;
    status.textContent = '';
}

recoveryForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (recoveryForm.hidden || !recoveryForm.reportValidity()) return;
    const email = new FormData(recoveryForm).get('email').trim();
    const button = recoveryForm.querySelector('button');
    button.disabled = true;
    status.textContent = 'Solicitando link…';
    try {
        const sb = await client();
        const redirectTo = new URL('./primeiro-acesso.html', location.href).href;
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
        status.textContent = 'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.';
        recoveryForm.reset();
    } catch {
        status.textContent = 'Não foi possível concluir a solicitação. Tente novamente em alguns minutos.';
    } finally {
        button.disabled = false;
    }
});

form.addEventListener('submit', async event => {
    event.preventDefault();
    if (form.hidden || !form.reportValidity()) return;
    const fields = new FormData(form);
    if (fields.get('password') !== fields.get('confirmation')) {
        status.textContent = 'As senhas precisam ser iguais.';
        return;
    }
    const button = form.querySelector('button');
    button.disabled = true;
    try {
        const sb = await client();
        const { data } = await sb.auth.getSession();
        if (data.session?.access_token !== token) {
            form.hidden = true;
            recoveryForm.hidden = false;
            status.textContent = invalidLink;
            return;
        }
        const { error } = await sb.auth.updateUser({ password: fields.get('password') });
        if (error) throw error;
        location.replace('./index.html');
    } catch (error) {
        status.textContent = error.message || 'Não foi possível salvar a senha.';
        button.disabled = false;
    }
});

initialize().catch(() => { status.textContent = 'Não foi possível verificar o link.'; });

