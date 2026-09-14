import { showToast, getInitials, getStatusInfo, formatarData, getFaixaEtaria } from './js/utils.js';
import { SUPABASE_URL, SUPABASE_KEY, EDGE_FUNCTION_URL, sb } from './js/config.js';
import { backupData, renderBackupHistory } from './js/backup.js';
import { generateExcelReport, exportCoberturaExcel } from './js/reports.js';
import {
    initCidadaos, getCidadaosServerSearchState, getTotalCidadaosCount,
    loadBairrosDistintos, loadCidadaosPage, handleCidadaoFormSubmit,
    renderCidadaos, renderMoreCidadaos,
    updateBairroFilter, clearCidadaoFilters,
    openCidadaoModal, closeCidadaoModal, updateChildrenInputs,
    handleCEPBlur, openDetailsModal, closeDetailsModal,
    setupLeaderAutocomplete
} from './js/cidadaos.js';
import {
    initDemandas,
    handleDemandaFormSubmit, openDemandaDetailsModal,
    handleAddNoteSubmit, loadDemandasPage, clearDemandaFilters,
    openDemandaModal, closeDemandaModal, closeDemandaDetailsModal
} from './js/demandas.js';
import {
    resetUsers, loadUsers, renderUsersList,
    openUserModal, closeUserModal, handleUserFormSubmit, confirmDeleteUser
} from './js/users.js';
import {
    getCoberturaData, setupCoberturaLiderAutocomplete,
    clearCoberturaFiltros, loadCoberturaEleitoral
} from './js/cobertura.js';
import { openMapModal, closeMapModal } from './js/map.js';
import {
    updateDashboard, openAniversariantesModal, closeAniversariantesModal,
    prevAniversariantesPage, nextAniversariantesPage
} from './js/dashboard.js';

import { state } from './js/state.js';
// state.userRole carregado após login ('admin' ou 'cadastrador')
// Paginação server-side de cidadãos e demandas — encapsuladas em
// js/cidadaos.js e js/demandas.js respetivamente
let appInitialized = false;
let _initLock = false;
let logoBtn, logoutBtn, sidebarNav, addCidadaoBtn, addDemandaGeralBtn,
    closeModalBtn, cancelBtn, saveBtn, closeDetailsModalBtn, closeDemandaModalBtn,
    cancelDemandaBtn, closeDemandaDetailsBtn, closeMapBtn, cidadaoModal,
    modalContent, cidadaoDetailsModal, demandaModal, demandaDetailsModal,
    confirmationModal, cidadaoForm, demandaForm, addNoteForm,
    searchInput, filterType, filterBairro, filterCidade, filterLeader, filterSexo,
    filterFaixaEtaria, filterLocalTrabalho, clearFiltersBtn, generateReportBtn, viewMapBtn,
    demandaFilterStatus, demandaFilterLeader, demandaSearchNome, demandaClearFiltersBtn,
    cidadaosGrid, allDemandasList, cidadaoLeaderSelect, demandaCidadaoSelect,
    cancelDeleteBtn, confirmDeleteBtn, cidadaoName, cidadaoEmail, cidadaoDob,
    cidadaoSexo, cidadaoType, cidadaoCPF, cidadaoRG, cidadaoVoterId,
    cidadaoZona, cidadaoSecao,
    cidadaoPhone, cidadaoWhatsapp, cidadaoProfissao, cidadaoLocalTrabalho,
    cidadaoCEP, cidadaoLogradouro, cidadaoNumero, cidadaoComplemento,
    cidadaoBairro, cidadaoCidade, cidadaoEstado, cidadaoSons, cidadaoDaughters,
    childrenDetailsContainer, cidadaoPhotoUrl, cidadaoPhotoUpload, fileNameDisplay,
    loadMoreBtn, cidadaoLat, cidadaoLong,
    itemToDelete = { id: null, type: null };
document.addEventListener('DOMContentLoaded', () => {
    const loginPage = document.getElementById('login-page');
    const appContainer = document.getElementById('app-container');
    const loginForm = document.getElementById('login-form');
    const loginBtn = document.getElementById('login-btn');
    const emailInput = document.getElementById('email-address');
    const passwordInput = document.getElementById('password');
    sb.auth.onAuthStateChange((event, session) => {
        if (session && session.user) {
            state.user = session.user;
            loginPage.classList.add('hidden');
            appContainer.style.display = 'flex';
            if (!appInitialized && !_initLock) {
                _initLock = true;
                initializeMainApp().finally(() => { _initLock = false; });
            }
        } else if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && !session)) {
            state.user = null;
            state.userRole = null;
            state.allCidadaos = []; state.allDemandas = []; state.allLeaders = [];
            appInitialized = false;
            _initLock = false;
            // Restaura botão — independente de qual elemento está no DOM agora
            const lb = document.getElementById('logout-btn');
            if (lb) { lb.disabled = false; lb.innerHTML = 'Sair'; }
            loginPage.classList.remove('hidden');
            appContainer.style.display = 'none';
        }
    });
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = emailInput.value;
        const password = passwordInput.value;
        loginBtn.disabled = true;
        loginBtn.innerHTML = '<div class="spinner"></div>';
        try {
            const { error } = await sb.auth.signInWithPassword({
                email: email,
                password: password,
            });
            if (error) throw error;
        } catch (error) {
            console.error(error.message);
            showToast("Credenciais inválidas.", "error");
        } finally {
            loginBtn.disabled = false;
            loginBtn.innerHTML = 'Entrar';
        }
    });
    async function manageSessionOnLoad() {
        const { data: { session } } = await sb.auth.getSession();
        if (session && session.user) {
            state.user = session.user;
            loginPage.classList.add('hidden');
            appContainer.style.display = 'flex';
            if (!appInitialized && !_initLock) {
                _initLock = true;
                try { await initializeMainApp(); }
                finally { _initLock = false; }
            }
        } else {
            state.user = null;
            loginPage.classList.remove('hidden');
            appContainer.style.display = 'none';
        }
    }
    manageSessionOnLoad();
    async function initializeMainApp() {
        if (appInitialized) return;
        state.allCidadaos = []; state.allDemandas = []; state.allLeaders = []; resetUsers();
        state.userRole = null;
        await new Promise(resolve => setTimeout(resolve, 50)); 
        logoBtn = document.getElementById('logo-btn'); 
        logoutBtn = document.getElementById('logout-btn');
        sidebarNav = document.getElementById('sidebar-nav');
        const mobileMenuBtn = document.getElementById('mobile-menu-btn');
        addCidadaoBtn = document.getElementById('add-cidadao-btn');
        addDemandaGeralBtn = document.getElementById('add-demanda-geral-btn');
        closeModalBtn = document.getElementById('close-modal-btn');
        cancelBtn = document.getElementById('cancel-btn');
        saveBtn = document.getElementById('save-btn');
        closeDetailsModalBtn = document.getElementById('close-details-modal-btn');
        closeDemandaModalBtn = document.getElementById('close-demanda-modal-btn');
        cancelDemandaBtn = document.getElementById('cancel-demanda-btn');
        closeDemandaDetailsBtn = document.getElementById('close-demanda-details-btn');
        closeMapBtn = document.getElementById('close-map-btn');
        cidadaoModal = document.getElementById('cidadao-modal');
        modalContent = document.getElementById('modal-content');
        cidadaoDetailsModal = document.getElementById('cidadao-details-modal');
        demandaModal = document.getElementById('demanda-modal');
        demandaDetailsModal = document.getElementById('demanda-details-modal');
        confirmationModal = document.getElementById('confirmation-modal');
        cidadaoForm = document.getElementById('cidadao-form');
        demandaForm = document.getElementById('demanda-form');
        addNoteForm = document.getElementById('add-note-form');
        searchInput = document.getElementById('search-input');
        filterType = document.getElementById('filter-type');
        filterBairro = document.getElementById('filter-bairro');
        filterCidade = document.getElementById('filter-cidade');
        filterCidade = document.getElementById('filter-cidade');
        filterLeader = document.getElementById('filter-leader');
        filterSexo = document.getElementById('filter-sexo');
        filterFaixaEtaria = document.getElementById('filter-faixa-etaria');
        filterLocalTrabalho = document.getElementById('filter-local-trabalho');
        clearFiltersBtn = document.getElementById('clear-filters-btn');
        generateReportBtn = document.getElementById('generate-report-btn');
        viewMapBtn = document.getElementById('view-map-btn');
        demandaFilterStatus  = document.getElementById('demanda-filter-status');
        demandaFilterLeader  = document.getElementById('demanda-filter-leader');
        demandaSearchNome    = document.getElementById('demanda-search-nome');
        demandaClearFiltersBtn = document.getElementById('demanda-clear-filters-btn');
        cidadaosGrid = document.getElementById('cidadaos-grid');
        loadMoreBtn = document.getElementById('load-more-btn');
        allDemandasList = document.getElementById('all-demandas-list');
        cidadaoLeaderSelect = document.getElementById('cidadao-leader');
        demandaCidadaoSelect = document.getElementById('demanda-cidadao-select');
        cancelDeleteBtn = document.getElementById('cancel-delete-btn');
        confirmDeleteBtn = document.getElementById('confirm-delete-btn');
        cidadaoName = document.getElementById('cidadao-name');
        cidadaoEmail = document.getElementById('cidadao-email');
        cidadaoDob = document.getElementById('cidadao-dob');
        cidadaoSexo = document.getElementById('cidadao-sexo');
        cidadaoType = document.getElementById('cidadao-type');
        cidadaoCPF = document.getElementById('cidadao-cpf');
        cidadaoRG = document.getElementById('cidadao-rg');
        cidadaoVoterId = document.getElementById('cidadao-voterid');
        cidadaoZona = document.getElementById('cidadao-zona');
        cidadaoSecao = document.getElementById('cidadao-secao');
        cidadaoPhone = document.getElementById('cidadao-phone');
        cidadaoWhatsapp = document.getElementById('cidadao-whatsapp');
        cidadaoProfissao = document.getElementById('cidadao-profissao');
        cidadaoLocalTrabalho = document.getElementById('cidadao-local-trabalho');
        cidadaoCEP = document.getElementById('cidadao-cep');
        cidadaoLogradouro = document.getElementById('cidadao-logradouro');
        cidadaoNumero = document.getElementById('cidadao-numero');
        cidadaoComplemento = document.getElementById('cidadao-complemento');
        cidadaoBairro = document.getElementById('cidadao-bairro');
        cidadaoCidade = document.getElementById('cidadao-cidade');
        cidadaoEstado = document.getElementById('cidadao-estado');
        cidadaoSons = document.getElementById('cidadao-sons');
        cidadaoDaughters = document.getElementById('cidadao-daughters');
        childrenDetailsContainer = document.getElementById('children-details-container');
        cidadaoPhotoUrl = document.getElementById('cidadao-photo-url');
        cidadaoPhotoUpload = document.getElementById('cidadao-photo-upload');
        fileNameDisplay = document.getElementById('file-name-display');
        cidadaoLat = document.getElementById('cidadao-lat');
        cidadaoLong = document.getElementById('cidadao-long');
        if (!logoutBtn || !cidadaoForm) {
            appInitialized = false; 
            return; 
        }
        // Injeta em cidadaos.js os comportamentos que dependem de outros módulos/app.js,
        // evitando import circular (app.js já importa de cidadaos.js).
        initCidadaos({
            onOpenDemanda: (cidadaoId) => openDemandaModal(cidadaoId),
            onRequestDelete: (id, type) => requestDelete(id, type),
            onLeadersChanged: () => updateLeaderSelects(),
            onOpenMap: (cidadaosToPlot) => openMapModal(cidadaosToPlot)
        });
        initDemandas({
            onRequestDelete: (id, type) => requestDelete(id, type),
            onDashboardChanged: () => updateDashboard()
        });
        if (logoBtn) {
            logoBtn.addEventListener('click', (e) => {
                e.preventDefault();
                switchPage('dashboard-page');
            });
        }
        // Listener de logout — flag evita duplicatas sem precisar de cloneNode
        if (!logoutBtn._listenerAdded) {
            logoutBtn._listenerAdded = true;
            logoutBtn.addEventListener('click', async () => {
                if (logoutBtn.disabled) return;
                try {
                    logoutBtn.disabled = true;
                    logoutBtn.innerHTML = '<div class="spinner mx-auto"></div>';
                    await sb.auth.signOut();
                    // onAuthStateChange (SIGNED_OUT) restaura o botão e limpa o estado
                } catch (error) {
                    logoutBtn.disabled = false;
                    logoutBtn.innerHTML = 'Sair';
                    showToast("Erro ao terminar sessão.", "error");
                }
            });
        }
        sidebarNav.addEventListener('click', (e) => {
            const link = e.target.closest('a');
            if (link) {
                e.preventDefault();
                const page = link.getAttribute('href').substring(1);
                if (page === 'mapa') {
                    openMapModal();
                } else {
                    switchPage(page + '-page');
                }
                document.getElementById('app-container')?.classList.remove('menu-open');
                mobileMenuBtn?.setAttribute('aria-expanded', 'false');
            }
        });
        mobileMenuBtn?.addEventListener('click', () => {
            const isOpen = document.getElementById('app-container').classList.toggle('menu-open');
            mobileMenuBtn.setAttribute('aria-expanded', String(isOpen));
        });
        // ── Filtros recolhíveis no mobile (Cidadãos/Demandas/Cobertura) ──
        function setupFiltersToggle(toggleId, wrapId) {
            const toggle = document.getElementById(toggleId);
            const wrap = document.getElementById(wrapId);
            if (!toggle || !wrap) return;
            toggle.addEventListener('click', () => {
                const isOpen = wrap.classList.toggle('filters-collapsed') === false;
                toggle.setAttribute('aria-expanded', String(isOpen));
            });
        }
        setupFiltersToggle('cidadaos-filters-toggle', 'cidadaos-filters-wrap');
        setupFiltersToggle('demandas-filters-toggle', 'demandas-filters-wrap');
        setupFiltersToggle('cobertura-filters-toggle', 'cobertura-filters-wrap');
        addCidadaoBtn.addEventListener('click', () => openCidadaoModal());
        addDemandaGeralBtn.addEventListener('click', () => openDemandaModal());
        viewMapBtn.addEventListener('click', () => openMapModal());
        closeModalBtn.addEventListener('click', closeCidadaoModal);
        cancelBtn.addEventListener('click', closeCidadaoModal);
        closeDetailsModalBtn.addEventListener('click', closeDetailsModal);
        closeDemandaModalBtn.addEventListener('click', closeDemandaModal);
        cancelDemandaBtn.addEventListener('click', closeDemandaModal);
        closeDemandaDetailsBtn.addEventListener('click', closeDemandaDetailsModal);
        closeMapBtn.addEventListener('click', closeMapModal);
        cidadaoForm.addEventListener('submit', handleCidadaoFormSubmit);
        demandaForm.addEventListener('submit', handleDemandaFormSubmit);
        addNoteForm.addEventListener('submit', handleAddNoteSubmit);
        // PERFORMANCE: debounce de 350ms — evita query a cada tecla digitada
        let searchDebounce;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchDebounce);
            searchDebounce = setTimeout(() => renderCidadaos(), 350);
        });
        filterType.addEventListener('change', () => renderCidadaos());
        filterBairro.addEventListener('change', () => renderCidadaos());
        if (filterCidade) filterCidade.addEventListener('change', () => renderCidadaos());
        if (filterCidade) filterCidade.addEventListener('change', () => renderCidadaos());
        filterLeader.addEventListener('change', () => renderCidadaos());
        filterSexo.addEventListener('change', () => renderCidadaos());
        filterFaixaEtaria.addEventListener('change', () => renderCidadaos());
        let filterLocalTrabalhoDebounce;
        filterLocalTrabalho.addEventListener('input', () => {
            clearTimeout(filterLocalTrabalhoDebounce);
            filterLocalTrabalhoDebounce = setTimeout(() => renderCidadaos(), 350);
        });
        clearFiltersBtn.addEventListener('click', clearCidadaoFilters);
        loadMoreBtn.addEventListener('click', renderMoreCidadaos);
        demandaFilterStatus.addEventListener('change', () => loadDemandasPage(true));
        demandaFilterLeader.addEventListener('change',  () => loadDemandasPage(true));
        demandaSearchNome?.addEventListener('input', () => {
            clearTimeout(demandaSearchNome._t);
            demandaSearchNome._t = setTimeout(() => loadDemandasPage(true), 400);
        });
        demandaClearFiltersBtn.addEventListener('click', clearDemandaFilters);
        document.getElementById('demandas-load-more-btn')?.addEventListener('click', () => loadDemandasPage(false));
        generateReportBtn.addEventListener('click', generatePrintReport);
        const excelReportBtn = document.getElementById('generate-excel-btn');
        if (excelReportBtn) excelReportBtn.addEventListener('click', () => generateExcelReport(getCidadaosServerSearchState()));
        // Cobertura Eleitoral
        document.getElementById('cobertura-load-btn')?.addEventListener('click', loadCoberturaEleitoral);
        // Listeners modal aniversariantes
        document.getElementById('close-aniversariantes-modal')?.addEventListener('click', closeAniversariantesModal);
        document.getElementById('aniv-modal-prev')?.addEventListener('click', () => prevAniversariantesPage());
        document.getElementById('aniv-modal-next')?.addEventListener('click', () => nextAniversariantesPage());
        document.getElementById('aniversariantes-modal')?.addEventListener('click', e => {
            if (e.target === document.getElementById('aniversariantes-modal')) closeAniversariantesModal();
        });
        document.getElementById('cobertura-clear-btn')?.addEventListener('click', clearCoberturaFiltros);
        document.getElementById('cobertura-excel-btn')?.addEventListener('click', () => exportCoberturaExcel(getCoberturaData()));
        // Backup
        document.getElementById('backup-json-btn')?.addEventListener('click', () => backupData('json'));
        document.getElementById('backup-csv-btn')?.addEventListener('click', () => backupData('csv'));
        const addUserBtn = document.getElementById('add-user-btn');
        if (addUserBtn) addUserBtn.addEventListener('click', () => openUserModal());
        const closeUserModalBtn = document.getElementById('close-user-modal-btn');
        if (closeUserModalBtn) closeUserModalBtn.addEventListener('click', closeUserModal);
        const cancelUserBtn = document.getElementById('cancel-user-btn');
        if (cancelUserBtn) cancelUserBtn.addEventListener('click', closeUserModal);
        const userForm = document.getElementById('user-form');
        if (userForm) userForm.addEventListener('submit', handleUserFormSubmit);
        cancelDeleteBtn.addEventListener('click', closeConfirmationModal);
        confirmDeleteBtn.addEventListener('click', handleDeleteConfirmation);
        cidadaoCEP.addEventListener('blur', handleCEPBlur);
        cidadaoPhotoUpload.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                fileNameDisplay.textContent = e.target.files[0].name;
                cidadaoPhotoUrl.value = '';
            } else {
                fileNameDisplay.textContent = 'Nenhum ficheiro selecionado';
            }
        });
        cidadaoSons.addEventListener('input', () => updateChildrenInputs('filho'));
        cidadaoDaughters.addEventListener('input', () => updateChildrenInputs('filha'));
        try {
             await loadInitialData(); 
             appInitialized = true; 
             switchPage('dashboard-page');
        } catch (e) {
             console.error(e);
             showToast("Erro fatal de dados. Por favor, faça login novamente.", "error");
             await sb.auth.signOut(); 
        }
    }
    // ── Paginação de demandas: agora encapsulada em js/demandas.js ────────

    async function loadInitialData() {
        if (!state.user) return;
        try {
            // ── 1. Perfil primeiro — define state.userRole antes de tudo ───────
            const { data: profileData, error: profileError } = await sb
                .from('profiles')
                .select('role')
                .eq('id', state.user.id)
                .single();
            if (profileError || !profileData) {
                await sb.auth.signOut();
                showToast('Acesso negado. O seu utilizador não tem perfil atribuído.', 'error');
                throw new Error('Perfil não encontrado.');
            }
            state.userRole = profileData.role;
            applyRoleUI();

            // ── 2. Líderes + demandas + bairros em paralelo ──────────────
            const [leadersRes, demandasRes] = await Promise.all([
                sb.from('cidadaos')
                    .select('id, name, type')
                    .eq('type', 'Liderança')
                    .order('name', { ascending: true }),
                loadBairrosDistintos()
            ]);
            if (leadersRes.error) throw leadersRes.error;
            state.allLeaders = leadersRes.data;

            updateLeaderSelects();
            updateBairroFilter();
            await loadDemandasPage(true);

            // ── 3. Cidadãos + dashboard + utilizadores em paralelo ───────
            await Promise.all([
                loadCidadaosPage(true),
                updateDashboard(),
                state.userRole === 'admin' ? loadUsers() : Promise.resolve()
            ]);

            return true;
        } catch (error) {
            console.error(error);
            throw error;
        }
    }

    // ── Ajusta interface conforme o perfil do utilizador ────────────────
    function applyRoleUI() {
        if (state.userRole === 'cadastrador') {
            // Esconde funcionalidades exclusivas do admin
            const els = [
                document.getElementById('generate-report-btn'), // relatório global
                document.getElementById('generate-excel-btn'),  // excel global
                document.getElementById('view-map-btn'),        // mapa global
            ];
            els.forEach(el => { if (el) el.classList.add('hidden'); });
            // Esconde links Mapa e Utilizadores na sidebar para cadastrador
            document.querySelectorAll('#sidebar-nav a').forEach(a => {
                const href = a.getAttribute('href');
                if (href === '#mapa' || href === '#utilizadores' || href === '#cobertura' || href === '#backup') {
                    a.parentElement.classList.add('hidden');
                }
            });
            // Botão delete nos cards é ocultado em buildCidadaoCard via state.userRole
        }
    }

    async function handleDeleteConfirmation() {
        const { id, type } = itemToDelete;
        if (!id || !type || !state.user) return;
        const btn = document.getElementById('confirm-delete-btn');
        btn.disabled = true;
        try {
            if (type === 'cidadao') {
                const { error } = await sb
                    .from('cidadaos')
                    .delete()
                    .eq('id', id);
                if (error) throw error;
                showToast("Cidadão excluído.", "success");
            } else if (type === 'demanda') {
                 // Apaga as notas vinculadas primeiro — evita erro de FK constraint
                 // caso a coluna notes.demanda_id não tenha ON DELETE CASCADE no banco.
                 const { error: notesError } = await sb
                    .from('notes')
                    .delete()
                    .eq('demanda_id', id);
                 if (notesError) throw notesError;
                 const { error } = await sb
                    .from('demandas')
                    .delete()
                    .eq('id', id);
                if (error) throw error;
                closeDemandaDetailsModal(); 
                showToast("Demanda excluída.", "success");
            }
            // PERFORMANCE: remove do cache local e re-renderiza sem ir ao servidor
            if (type === 'cidadao') {
                state.allCidadaos = state.allCidadaos.filter(c => c.id !== id);
                await renderCidadaos();
            } else {
                await loadDemandasPage(true);
            }
            await updateDashboard();
        } catch (error) {
            console.error(error);
            showToast(`Erro ao excluir.`, "error");
        } finally {
            btn.disabled = false;
            closeConfirmationModal();
        }
    }
    // Constrói um card de demanda e retorna o elemento
    function updateLeaderSelects() {
        // Filtro, demanda e cobertura — selects normais, ordenados alfabeticamente
        setupCoberturaLiderAutocomplete();
        const selects = [filterLeader, demandaFilterLeader];
        selects.forEach(select => {
            if (!select) return;
            const currentValue = select.value;
            select.innerHTML = '<option value="">Filtrar por Liderança</option>';
            [...state.allLeaders].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).forEach(l => {
                const option = document.createElement('option');
                option.value = l.id;
                option.textContent = l.name;
                select.appendChild(option);
            });
            select.value = currentValue;
        });
        // Autocomplete de liderança no modal de cadastro
        setupLeaderAutocomplete();
    }

    function requestDelete(itemId, type) {
        itemToDelete = { id: itemId, type: type };
        const modal = document.getElementById('confirmation-modal');
        const title = document.getElementById('confirmation-title');
        const message = document.getElementById('confirmation-message');
        if (type === 'cidadao') {
            const cidadao = state.allCidadaos.find(c => c.id === itemId);
            title.textContent = 'Excluir Cidadão';
            message.textContent = `Tem a certeza que quer excluir "${cidadao.name}"?`;
        } else if (type === 'demanda') {
            const demanda = state.allDemandas.find(d => d.id === itemId);
            title.textContent = 'Excluir Demanda';
            message.textContent = `Tem a certeza que quer excluir "${demanda ? demanda.title : 'esta demanda'}"?`;
        }
        modal.classList.remove('hidden');
    }
    function closeConfirmationModal() {
        document.getElementById('confirmation-modal').classList.add('hidden');
        itemToDelete = { id: null, type: null };
    }
    async function generatePrintReport() {
        // Busca TODOS os cidadãos com os filtros ativos — não apenas a página atual
        showToast("A gerar relatório...", "info");
        const s = getCidadaosServerSearchState();
        let query = sb.from('cidadaos').select('name, type, phone, whatsapp, email, logradouro, numero, complemento, bairro, cidade, estado, cep');
        if (s.search)  query = query.or(`name.ilike.%${s.search}%,email.ilike.%${s.search}%,cpf.ilike.%${s.search}%,voterid.ilike.%${s.search}%`);
        if (s.type)    query = query.eq('type', s.type);
        if (s.bairro)  query = query.eq('bairro', s.bairro);
        if (s.cidade)  query = query.eq('cidade', s.cidade);
        if (s.leader)  query = query.eq('leader', s.leader);
        if (s.sexo)    query = query.eq('sexo', s.sexo);
        if (s.localTrabalho) query = query.ilike('localtrabalho', `%${s.localTrabalho}%`);
        query = query.order('name', { ascending: true });

        const { data, error } = await query;
        if (error || !data || data.length === 0) {
            showToast("Nenhum cidadão encontrado.", "warning");
            return;
        }
        const reportWindow = window.open('', '', 'width=800,height=600');
        reportWindow.document.write('<html><head><title>Relatório</title>');
        reportWindow.document.write(`<style> body { font-family: Arial, sans-serif; margin: 20px; } table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #ddd; padding: 8px; text-align: left; } th { background-color: #f2f2f2; } h1 { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; } @media print { button { display: none; } } </style>`);
        reportWindow.document.write('</head><body>');
        reportWindow.document.write('<h1>Relatório de Cidadãos</h1>');
        reportWindow.document.write(`<p>Total: ${data.length}</p>`);
        reportWindow.document.write('<button onclick="window.print()">Imprimir</button>');
        reportWindow.document.write('<table>');
        reportWindow.document.write(`<thead><tr><th>Nome</th><th>Tipo</th><th>Telefone</th><th>Email</th><th>Endereço</th></tr></thead><tbody>`);
        data.forEach(cidadao => {
            const addressParts = [cidadao.logradouro, cidadao.numero, cidadao.complemento, cidadao.bairro, cidadao.cidade, cidadao.estado, cidadao.cep].filter(Boolean);
            const endereco = addressParts.join(', ') || 'Não informado';
            // Escapa HTML para evitar XSS no relatório
            const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            reportWindow.document.write(`<tr><td>${esc(cidadao.name)}</td><td>${esc(cidadao.type)}</td><td>${esc(cidadao.phone)} ${cidadao.whatsapp ? '(W)' : ''}</td><td>${esc(cidadao.email)}</td><td>${esc(endereco)}</td></tr>`);
        });
        reportWindow.document.write('</tbody></table></body></html>');
        reportWindow.document.close();
    }
    // ═══════════════════════════════════════════════════════════════
    // GESTÃO DE UTILIZADORES (só admin)
    // ═══════════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════════
    // BACKUP DE DADOS
    // ═══════════════════════════════════════════════════════════════
    function switchPage(pageId) {
        if (pageId === 'backup-page') setTimeout(renderBackupHistory, 50);
        document.querySelectorAll('.page').forEach(page => {
            page.classList.add('hidden');
            page.classList.remove('flex', 'flex-col');
        });
        const newPage = document.getElementById(pageId);
        if (newPage) {
            newPage.classList.remove('hidden');
            const flexPages = ['dashboard-page','cidadaos-page','demandas-page','cobertura-page','backup-page'];
            if (flexPages.includes(pageId)) newPage.classList.add('flex', 'flex-col');
        }
        document.querySelectorAll('#sidebar-nav a').forEach(link => {
            link.classList.remove('bg-slate-900', 'font-semibold');
            if (link.getAttribute('href') === `#${pageId.replace('-page', '')}`) {
                link.classList.add('bg-slate-900', 'font-semibold');
            }
        });
        if (pageId === 'dashboard-page') {
            updateDashboard();
        }
        if (pageId === 'utilizadores-page') {
            loadUsers();
        }
    }
});
