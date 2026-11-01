import { sb, SUPABASE_URL } from './config.js';
import { state } from './state.js';
import { getInitials } from './utils.js';
import { photoStoragePath } from './backup-core.js';

export function storagePhotoRef(path) { return 'storage://fotos-cidadaos/' + path; }
export async function resolvePhotoUrl(ref) {
    if (!ref) return null;
    const path = photoStoragePath(ref, SUPABASE_URL);
    if (path) {
        const { data, error } = await sb.storage.from('fotos-cidadaos').createSignedUrl(path, 300);
        if (error) throw error;
        return data.signedUrl;
    }
    const url = new URL(ref);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
}
export function renderCitizenPhoto(container, ref, name, small = false) {
    container.textContent = '';
    const fallback = document.createElement('div');
    const size = small ? 'w-16 h-16' : 'w-24 h-24';
    fallback.className = size+' rounded-full bg-blue-500 text-white flex items-center justify-center font-bold '+(small?'text-2xl':'text-4xl');
    fallback.textContent = getInitials(name); container.appendChild(fallback);
    const owner = state.user?.id;
    if (ref) resolvePhotoUrl(ref).then(url => {
        if (!url || owner !== state.user?.id || !container.contains(fallback)) return;
        const image = document.createElement('img'); image.alt = name || ''; image.loading='lazy';
        image.className = size+' rounded-full object-cover bg-gray-200'; image.src=url;
        image.onerror=()=>{ image.replaceWith(fallback); };
        fallback.replaceWith(image);
    }).catch(()=>{});
}
