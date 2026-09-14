// ═══════════════════════════════════════════════════════════════
// MASKS — máscaras de preenchimento de campos (CPF, telefone, etc.)
// Extraído do index.html (Fase 3 da modularização)
// ═══════════════════════════════════════════════════════════════

export function applyMask(id, mask) {
    const el = document.getElementById(id);
    if (!el || el._maskApplied) return;
    el._maskApplied = true;
    el.addEventListener('input', function () {
        let v = this.value.replace(/\D/g, '');
        let out = '', vi = 0;
        for (let mi = 0; mi < mask.length && vi < v.length; mi++) {
            if (mask[mi] === '9') { out += v[vi++]; }
            else { out += mask[mi]; if (v[vi] === mask[mi]) vi++; }
        }
        this.value = out;
    });
}

export function applyAllMasks() {
    applyMask('cidadao-cpf',     '999.999.999-99');
    applyMask('cidadao-phone',   '(99) 99999-9999');
    applyMask('cidadao-voterid', '9999 9999 9999');
    applyMask('cidadao-cep',     '99999-999');
}

document.addEventListener('DOMContentLoaded', applyAllMasks);
// Reaplicar ao abrir modal (flag _maskApplied garante listener único)
document.addEventListener('click', function (e) {
    if (e.target.closest('#add-cidadao-btn, [data-edit-cidadao]'))
        setTimeout(applyAllMasks, 150);
});
