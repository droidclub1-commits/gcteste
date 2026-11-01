import { state } from './state.js';
import { showToast } from './utils.js';

export function canAccessFuel() {
    return Boolean(state.user?.id && state.userRole === 'admin');
}

export function requireFuelAdmin() {
    if (canAccessFuel()) return true;
    showToast('Combustível é exclusivo do administrador.', 'warning');
    return false;
}

export function applyFuelAccessUI() {
    const allowed = canAccessFuel();
    document.querySelectorAll('[data-fuel-admin]').forEach(el => {
        el.classList.toggle('hidden', !allowed);
    });
    if (!allowed) {
        for (const id of ['cotas-page', 'cota-modal', 'cota-history-modal']) {
            document.getElementById(id)?.classList.add('hidden');
        }
        for (const id of ['cotas-tbody', 'cota-history-list', 'cota-history-total', 'cota-history-cidadao-nome']) {
            const el = document.getElementById(id);
            if (el) el.textContent = '';
        }
    }
}
