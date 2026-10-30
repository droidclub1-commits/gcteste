// Consultas compartilhadas: a listagem e os relatórios usam os mesmos filtros.
export async function fetchAllRows(makeQuery, pageSize = 1000) {
    const rows = [];
    // count=exact detecta limites do servidor menores que pageSize.
    for (let offset = 0; ; ) {
        const { data, error, count } = await makeQuery().range(offset, offset + pageSize - 1);
        if (error) throw error;
        const chunk = data || [];
        if (!chunk.length) {
            if (count != null && offset < count) throw new Error('Consulta incompleta. Tente novamente.');
            break;
        }
        rows.push(...chunk);
        offset += chunk.length;
        if (count != null ? offset >= count : chunk.length < pageSize) break;
    }
    return rows;
}

export function dateOnly(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// O mesmo critério de aniversário usado por getFaixaEtaria, inclusive em 29/02.
function yearsAgo(today, age) {
    const year = today.getFullYear() - age;
    const month = today.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();
    return dateOnly(new Date(year, month, Math.min(today.getDate(), lastDay)));
}

export function applyCidadaoFilters(query, filters = {}, today = new Date()) {
    const s = filters;
    if (s.search) {
        // Valor citado no filtro PostgREST, sem permitir novas expressões .or().
        const value = `"%${String(s.search).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}%"`;
        query = query.or(['name', 'email', 'cpf', 'voterid'].map(k => `${k}.ilike.${value}`).join(','));
    }
    for (const key of ['type', 'bairro', 'cidade', 'leader', 'sexo']) {
        if (s[key]) query = query.eq(key, s[key]);
    }
    if (s.localTrabalho) query = query.ilike('localtrabalho', `%${s.localTrabalho}%`);
    if (s.faixaEtaria === 'N/A') return query.is('dob', null);
    const ranges = { '0-17': [0, 17], '18-25': [18, 25], '26-35': [26, 35], '36-50': [36, 50], '51-65': [51, 65], '66+': [66, null] };
    const range = ranges[s.faixaEtaria];
    if (range) {
        query = query.lte('dob', yearsAgo(today, range[0]));
        if (range[1] != null) query = query.gt('dob', yearsAgo(today, range[1] + 1));
    }
    return query;
}

export function csvCell(value) {
    let s = String(value ?? '');
    // Impede que texto de usuário seja executado como fórmula ao abrir no Excel.
    if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
    return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    // O download pode ainda não ter consumido a URL no próximo evento.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}
