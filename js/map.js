// ═══════════════════════════════════════════════════════════════
// MAP — mapa de cidadãos (Leaflet + MarkerCluster)
// Extraído do app.js (Fase 11 da modularização)
//
// map/markers ficam encapsulados aqui. O elemento #map-modal é
// consultado direto via getElementById (mesmo padrão de
// cidadaos.js/reports.js) em vez de depender de referência
// cacheada por app.js.
// ═══════════════════════════════════════════════════════════════

import { sb } from './config.js';

let map = null;
let markers = [];
// ── Mapa de calor (Leaflet.heat) ────────────────────────────────────
let heatLayer = null;
let heatModeActive = false;
let lastCidadaosPlotted = []; // cache do último lote plotado, pra montar o calor sem refazer a consulta

function initializeMap() {
    if (map) { map.remove(); }
    map = L.map('map').setView([-0.03964, -51.18182], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    markers = [];
    heatLayer = null;
    heatModeActive = false;
}

// Alterna entre marcadores (com cluster) e mapa de calor. Ambos usam os
// mesmos dados já buscados — não faz nenhuma consulta nova ao Supabase.
function applyHeatMode() {
    if (!map) return;
    if (heatModeActive) {
        if (map._clusterGroup) { map.removeLayer(map._clusterGroup); }
        else { markers.forEach(m => { try { map.removeLayer(m); } catch (e) {} }); }
        const points = lastCidadaosPlotted
            .filter(c => c.latitude && c.longitude)
            .map(c => [parseFloat(c.latitude), parseFloat(c.longitude), 0.6]);
        if (heatLayer) { map.removeLayer(heatLayer); }
        if (typeof L.heatLayer === 'function') {
            heatLayer = L.heatLayer(points, { radius: 22, blur: 18, maxZoom: 15 });
            heatLayer.addTo(map);
        }
    } else {
        if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
        if (map._clusterGroup) { map.addLayer(map._clusterGroup); }
        else { markers.forEach(m => m.addTo(map)); }
    }
}

function setupHeatmapToggle() {
    const btn = document.getElementById('toggle-heatmap-btn');
    if (!btn) return;
    // Reseta visualmente pro estado "marcadores" toda vez que o mapa é reaberto
    btn.classList.remove('bg-orange-500', 'text-white');
    btn.classList.add('bg-gray-100', 'text-gray-700');
    if (btn._wired) return; // listener só é adicionado uma vez
    btn._wired = true;
    btn.addEventListener('click', () => {
        heatModeActive = !heatModeActive;
        applyHeatMode();
        btn.classList.toggle('bg-orange-500', heatModeActive);
        btn.classList.toggle('text-white', heatModeActive);
        btn.classList.toggle('bg-gray-100', !heatModeActive);
        btn.classList.toggle('text-gray-700', !heatModeActive);
    });
}

export async function openMapModal(cidadaosToPlot = null) {
    const mapModal = document.getElementById('map-modal');
    mapModal.classList.remove('hidden');
    heatModeActive = false; // toda reabertura do mapa começa na visualização de marcadores
    if (!map) {
        initializeMap();
        await new Promise(resolve => setTimeout(resolve, 200));
    } else {
        markers.forEach(m => { try { m.remove(); } catch(e) {} });
        markers = [];
        // Remove cluster anterior se existir
        if (map._clusterGroup) { map.removeLayer(map._clusterGroup); map._clusterGroup = null; }
        if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
    }
    if (map) map.invalidateSize();

    // PERFORMANCE: se não recebeu lista específica, busca só cidadãos com coordenadas do servidor
    let cidadaos = cidadaosToPlot;
    if (!cidadaos) {
        const { data } = await sb
            .from('cidadaos')
            .select('id, name, type, latitude, longitude, logradouro, numero')
            .not('latitude', 'is', null)
            .not('longitude', 'is', null)
            .limit(5000); // limite razoável para o mapa
        cidadaos = data || [];
    }
    lastCidadaosPlotted = cidadaos;

    const bounds = [];
    // PERFORMANCE: usa MarkerClusterGroup se disponível, senão marcadores normais
    const useCluster = typeof L.markerClusterGroup === 'function';
    const clusterGroup = useCluster ? L.markerClusterGroup({ chunkedLoading: true }) : null;
    if (clusterGroup) { map._clusterGroup = clusterGroup; }

    for (const cidadao of cidadaos) {
        if (cidadao.latitude && cidadao.longitude) {
            try {
                const latLng = [parseFloat(cidadao.latitude), parseFloat(cidadao.longitude)];
                const marker = L.marker(latLng);
                const popupEl = document.createElement('div');
                const nameEl = document.createElement('strong');
                nameEl.textContent = cidadao.name;
                const typeEl = document.createElement('span');
                typeEl.textContent = ' — ' + cidadao.type;
                popupEl.appendChild(nameEl);
                popupEl.appendChild(typeEl);
                marker.bindPopup(popupEl);
                if (clusterGroup) { clusterGroup.addLayer(marker); } else { marker.addTo(map); }
                markers.push(marker);
                bounds.push(latLng);
            } catch (error) { console.warn(error); }
        }
    }
    if (clusterGroup) map.addLayer(clusterGroup);

    if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [50, 50] });
    } else {
        map.setView([-0.03964, -51.18182], 13);
    }
    setupHeatmapToggle();
}

export function closeMapModal() {
    document.getElementById('map-modal').classList.add('hidden');
}
