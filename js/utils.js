// ═══════════════════════════════════════════════════════════════
// UTILS — funções utilitárias sem dependência de estado do app
// Extraído do app.js (Fase 1 da modularização)
// ═══════════════════════════════════════════════════════════════

export function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    let bgColor, textColor, icon;
    switch (type) {
        case 'success': bgColor = 'bg-green-500'; textColor = 'text-white'; icon = '✓'; break;
        case 'error': bgColor = 'bg-red-500'; textColor = 'text-white'; icon = '✖'; break;
        case 'warning': bgColor = 'bg-yellow-400'; textColor = 'text-black'; icon = '!' ; break;
        default: bgColor = 'bg-blue-500'; textColor = 'text-white'; icon = 'ℹ'; break;
    }
    toast.className = `p-4 rounded-lg shadow-lg flex items-center gap-3 ${bgColor} ${textColor} transform translate-x-full opacity-0 transition-all duration-300 ease-out`;
    toast.innerHTML = `<span class="font-bold text-lg">${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.remove('translate-x-full', 'opacity-0'); }, 10);
    setTimeout(() => {
        toast.classList.add('translate-x-full', 'opacity-0');
        setTimeout(() => { toast.remove(); }, 300);
    }, 3000);
}

export function getInitials(name) {
    if (!name) return '?';
    const parts = name.split(' ');
    if (parts.length > 1) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return (name[0]).toUpperCase();
}

export function getStatusInfo(status) {
    switch (status) {
        case 'pending': return { text: 'Pendente', classes: 'status-badge status-pending', color: '#F59E0B' };
        case 'inprogress': return { text: 'Em Andamento', classes: 'status-badge status-inprogress', color: '#3B82F6' };
        case 'completed': return { text: 'Concluída', classes: 'status-badge status-completed', color: '#10B981' };
        default: return { text: 'N/A', classes: 'status-badge', color: '#6B7280' };
    }
}

export function formatarData(dateString) {
    if (!dateString) return 'N/A';
    try {
        const parts = dateString.split('-');
        if (parts.length !== 3) return dateString;
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    } catch (e) { return dateString; }
}

export function getFaixaEtaria(dob) {
    if (!dob) return 'N/A';
    try {
        const birthDate = new Date(dob);
        if (isNaN(birthDate.getTime())) return 'N/A';
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) { age--; }
        if (age <= 17) return '0-17';
        if (age <= 25) return '18-25';
        if (age <= 35) return '26-35';
        if (age <= 50) return '36-50';
        if (age <= 65) return '51-65';
        if (age >= 66) return '66+';
        return 'N/A';
    } catch (e) { return 'N/A'; }
}
