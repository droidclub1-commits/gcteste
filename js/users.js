// ═══════════════════════════════════════════════════════════════
// USERS — gestão de utilizadores (só admin), via Edge Function
// manage-users. Extraído do app.js (Fase 9 da modularização)
//
// Padrão igual a cidadaos.js/demandas.js: estado (allUsers,
// editingUserId) encapsulado aqui dentro. app.js chama resetUsers()
// no login/logout em vez de mexer direto na lista.
// ═══════════════════════════════════════════════════════════════

import { showToast } from './utils.js';
import { sb, EDGE_FUNCTION_URL } from './config.js';
import { state } from './state.js';
import { resetVeiculosPosEleicao } from './veiculos.js';

let allUsers = [];
let editingUserId = null;

export function resetUsers() {
    allUsers = [];
    editingUserId = null;
}

async function callEdgeFunction(payload) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('Sessão expirada.');
    const res = await fetch(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Erro na Edge Function.');
    return json;
}

export async function loadUsers() {
    const listEl = document.getElementById('users-list');
    if (!listEl) return;
    listEl.innerHTML = '<p class="text-gray-400 text-sm">A carregar...</p>';
    try {
        const { users } = await callEdgeFunction({ action: 'list' });
        allUsers = users;
        renderUsersList();
    } catch(e) {
        console.error(e);
        listEl.innerHTML = '<p class="text-red-500 text-sm">Erro ao carregar utilizadores.</p>';
    }
}

export function renderUsersList() {
    const listEl = document.getElementById('users-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!allUsers.length) {
        listEl.innerHTML = '<p class="text-gray-500 text-center">Nenhum utilizador encontrado.</p>';
        return;
    }
    allUsers.forEach(u => {
        const isCurrentUser = u.id === state.user.id;
        const roleLabel = u.role === 'admin' ? 'Administrador' : 'Cadastrador';
        const roleBadgeColor = u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700';
        const lastLogin = u.last_sign_in
            ? new Date(u.last_sign_in).toLocaleDateString('pt-BR')
            : 'Nunca';

        const row = document.createElement('div');
        row.className = 'bg-white p-4 rounded-lg shadow-sm border flex items-center justify-between gap-4';

        const infoDiv = document.createElement('div');
        infoDiv.className = 'flex-1 min-w-0';

        const emailEl = document.createElement('p');
        emailEl.className = 'font-semibold text-gray-800 truncate';
        emailEl.textContent = u.email;

        const metaEl = document.createElement('p');
        metaEl.className = 'text-sm text-gray-500';
        metaEl.textContent = `Último acesso: ${lastLogin}`;

        infoDiv.appendChild(emailEl);
        infoDiv.appendChild(metaEl);

        const badgeSpan = document.createElement('span');
        badgeSpan.className = `px-3 py-1 rounded-full text-xs font-semibold ${roleBadgeColor}`;
        badgeSpan.textContent = roleLabel;

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'flex gap-2';

        if (!isCurrentUser) {
            const editBtn = document.createElement('button');
            editBtn.className = 'bg-blue-500 hover:bg-blue-600 text-white py-1 px-3 rounded-lg text-sm';
            editBtn.textContent = 'Editar';
            editBtn.addEventListener('click', () => openUserModal(u));

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'bg-red-500 hover:bg-red-600 text-white py-1 px-3 rounded-lg text-sm';
            deleteBtn.textContent = 'Remover';
            deleteBtn.addEventListener('click', () => confirmDeleteUser(u));

            actionsDiv.appendChild(editBtn);
            actionsDiv.appendChild(deleteBtn);
        } else {
            // Clicar em "(você)" no próprio card de admin revela o painel
            // de funções de administrador (#admin-maintenance-panel).
            const youBtn = document.createElement('button');
            youBtn.type = 'button';
            youBtn.className = 'text-xs text-gray-400 italic hover:text-blue-600 hover:not-italic flex items-center gap-1';
            youBtn.title = 'Funções de administrador';
            youBtn.innerHTML = '<span>(você)</span>' +
                '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
            youBtn.addEventListener('click', () => toggleAdminMaintenancePanel());
            actionsDiv.appendChild(youBtn);
        }

        row.appendChild(infoDiv);
        row.appendChild(badgeSpan);
        row.appendChild(actionsDiv);
        listEl.appendChild(row);
    });
}

export function openUserModal(userToEdit = null) {
    editingUserId = userToEdit ? userToEdit.id : null;
    const modal = document.getElementById('user-modal');
    const title = document.getElementById('user-modal-title');
    const emailInput = document.getElementById('user-email');
    const passwordGroup = document.getElementById('user-password-group');
    const roleSelect = document.getElementById('user-role');

    document.getElementById('user-form').reset();

    if (userToEdit) {
        title.textContent = 'Editar Utilizador';
        emailInput.value = userToEdit.email;
        emailInput.disabled = true;
        passwordGroup.classList.add('hidden');
        roleSelect.value = userToEdit.role;
    } else {
        title.textContent = 'Novo Utilizador';
        emailInput.disabled = false;
        passwordGroup.classList.remove('hidden');
        roleSelect.value = 'cadastrador';
    }
    modal.classList.remove('hidden');
}

export function closeUserModal() {
    document.getElementById('user-modal').classList.add('hidden');
    editingUserId = null;
}

export async function handleUserFormSubmit(e) {
    e.preventDefault();
    const saveBtn = document.getElementById('save-user-btn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<div class="spinner"></div>';
    try {
        if (editingUserId) {
            const role = document.getElementById('user-role').value;
            await callEdgeFunction({ action: 'update_role', userId: editingUserId, role });
            showToast('Perfil atualizado!', 'success');
        } else {
            const email = document.getElementById('user-email').value.trim();
            const password = document.getElementById('user-password').value;
            const role = document.getElementById('user-role').value;
            if (password.length < 6) {
                showToast('A senha deve ter pelo menos 6 caracteres.', 'warning');
                return;
            }
            await callEdgeFunction({ action: 'create', email, password, role });
            showToast('Utilizador criado com sucesso!', 'success');
        }
        closeUserModal();
        await loadUsers();
    } catch(e) {
        console.error(e);
        showToast(e.message || 'Erro ao salvar.', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = 'Salvar';
    }
}

export async function confirmDeleteUser(u) {
    if (!confirm(`Remover o utilizador "${u.email}"? Esta ação não pode ser desfeita.`)) return;
    try {
        await callEdgeFunction({ action: 'delete', userId: u.id });
        showToast('Utilizador removido.', 'success');
        await loadUsers();
    } catch(e) {
        showToast(e.message || 'Erro ao remover.', 'error');
    }
}

// ── Painel de funções de administrador ──────────────────────────────
export function toggleAdminMaintenancePanel() {
    const panel = document.getElementById('admin-maintenance-panel');
    if (!panel) return;
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// Wiring do botão "Zerar Adesivos e Histórico de Abastecimento".
// Chamado uma vez no arranque da app (mesmo padrão de setupVeiculosFiltro
// etc.) — o botão só existe/é visível dentro da página Utilizadores, que
// já é restrita a admin no sidebar (applyRoleUI em app.js).
export function setupAdminMaintenancePanel() {
    const btn = document.getElementById('reset-veiculos-eleicao-btn');
    if (!btn || btn._wired) return;
    btn._wired = true;
    btn.addEventListener('click', handleResetVeiculosClick);
}

async function handleResetVeiculosClick() {
    const btn = document.getElementById('reset-veiculos-eleicao-btn');
    const primeiraConfirmacao = confirm(
        'Isto vai remover o selo "adesivado" de TODOS os veículos e apagar ' +
        'TODO o histórico de abastecimento (cotas de combustível) do sistema.\n\n' +
        'Os cidadãos e os veículos continuam cadastrados normalmente.\n\n' +
        'Esta ação não pode ser desfeita. Deseja continuar?'
    );
    if (!primeiraConfirmacao) return;

    const digitado = prompt('Para confirmar, digite ZERAR (em maiúsculas):');
    if (digitado !== 'ZERAR') {
        if (digitado !== null) showToast('Confirmação incorreta — nada foi alterado.', 'warning');
        return;
    }

    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner" style="display:inline-block;margin-right:6px"></div> A processar...';
    try {
        const result = await resetVeiculosPosEleicao();
        const veiculos = result?.veiculos_atualizados ?? 0;
        const cotas = result?.cotas_apagadas ?? 0;
        showToast(`Concluído! ${veiculos} veículo(s) zerado(s), ${cotas} registo(s) de abastecimento apagado(s).`, 'success');
    } catch (e) {
        console.error(e);
        showToast(e.message || 'Erro ao zerar veículos.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}
