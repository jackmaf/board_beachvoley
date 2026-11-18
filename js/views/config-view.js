/**
 * @file config-view.js
 * @description Vista "Config": formulario del partido (equipos, jugadores y
 * reglas), tema visual, copia de seguridad y borrado total de datos.
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { byId, qsa } = VP.dom;
    const { toInt } = VP.utils;
    const { toast, confirm } = VP.feedback;
    const store = VP.matchStore;

    /** IDs de los inputs del formulario y la clave de config que alimentan. */
    const FIELD_MAP = {
        'input-team-a': 'teamA',
        'input-team-b': 'teamB',
        'input-a1': 'pA1',
        'input-a2': 'pA2',
        'input-b1': 'pB1',
        'input-b2': 'pB2'
    };

    /** Valores por defecto si el usuario deja un nombre vacío. */
    const NAME_FALLBACK = { teamA: 'Equipo A', teamB: 'Equipo B', pA1: 'A1', pA2: 'A2', pB1: 'B1', pB2: 'B2' };

    /**
     * Partido de torneo pendiente de empezar. Se rellena al pulsar "Pitar" en
     * un torneo y se consume al enviar el formulario.
     * @type {{tournamentId:string, tournamentMatchId:string, tournamentName:string}|null}
     */
    let pendingTournamentLink = null;

    // ---------------------------------------------------------------------
    // Formulario del partido
    // ---------------------------------------------------------------------

    /** Lee el formulario y construye la config del partido. */
    function readForm() {
        const config = {};
        Object.entries(FIELD_MAP).forEach(([inputId, key]) => {
            config[key] = byId(inputId).value.trim() || NAME_FALLBACK[key];
        });
        config.maxSets = toInt(byId('input-max-sets').value, 3);
        config.ptsNormal = toInt(byId('input-pts-normal').value, 21);
        config.ptsTiebreak = toInt(byId('input-pts-tiebreak').value, 15);
        config.firstServer = byId('input-first-server').value === 'B' ? 'B' : 'A';
        return config;
    }

    /** Las opciones de "Saque inicial" muestran el nombre real de cada dupla. */
    function syncFirstServerLabels() {
        const select = byId('input-first-server');
        select.options[0].textContent = `🏐 ${byId('input-team-a').value.trim() || 'Equipo A'}`;
        select.options[1].textContent = `🏐 ${byId('input-team-b').value.trim() || 'Equipo B'}`;
    }

    /** Rellena el formulario con una config (al volver a la vista o precargar un torneo). */
    function fillForm(config) {
        Object.entries(FIELD_MAP).forEach(([inputId, key]) => {
            byId(inputId).value = config[key] || '';
        });
        byId('input-max-sets').value = config.maxSets || 3;
        byId('input-pts-normal').value = config.ptsNormal || 21;
        byId('input-pts-tiebreak').value = config.ptsTiebreak || 15;
        byId('input-first-server').value = config.firstServer === 'B' ? 'B' : 'A';
        syncFirstServerLabels();
    }

    /** Ajusta textos y botones según haya (o no) partido en curso. */
    function render() {
        const isUpdating = store.hasPoints() && !pendingTournamentLink;
        byId('btn-start-match').textContent = isUpdating ? 'Actualizar datos del partido' : 'Empezar partido';
        byId('btn-discard-match').hidden = !store.hasMatch() || Boolean(pendingTournamentLink);

        const notice = byId('config-tournament-notice');
        const link = pendingTournamentLink;
        notice.hidden = !link;
        if (link) {
            notice.textContent = `🏆 Partido del torneo «${link.tournamentName}». Revisa los jugadores y pulsa «Empezar partido».`;
        }

        if (store.hasMatch() && !pendingTournamentLink) fillForm(store.getState().config);
    }

    /**
     * Valida y envía el formulario.
     *  - Partido nuevo → `store.start()` y navega al marcador correspondiente.
     *  - Partido en curso → `store.updateConfig()` (corrige nombres/reglas sin perder puntos).
     */
    function handleSubmit(event) {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;

        const config = readForm();
        const link = pendingTournamentLink;

        if (store.hasPoints() && !link) {
            store.updateConfig(config);
            toast('Datos del partido actualizados.', { type: 'success' });
        } else {
            store.start(config, link || {});
            toast(`¡A jugar! ${config.teamA} vs ${config.teamB}`, { type: 'success' });
        }
        pendingTournamentLink = null;
        VP.router.go(store.isTournamentMatch() ? 'vista-marcador-vivo' : 'vista-registro');
    }

    /**
     * Precarga el formulario con un partido de torneo y lleva al usuario a esta vista.
     * @param {Object} tournament
     * @param {Object} match Partido del torneo.
     */
    function prepareTournamentMatch(tournament, match) {
        const { getSlotTeam } = VP.tournamentEngine;
        const a = getSlotTeam(match, 'teamA');
        const b = getSlotTeam(match, 'teamB');
        // Si no hay jugadores cargados se usan nombres genéricos "Dupla 1", "Dupla 2"
        fillForm({
            teamA: a.name,
            teamB: b.name,
            pA1: a.p1 || `${a.name} 1`,
            pA2: a.p2 || `${a.name} 2`,
            pB1: b.p1 || `${b.name} 1`,
            pB2: b.p2 || `${b.name} 2`,
            ...VP.rules.normalizeRules(tournament.config_sets)
        });
        pendingTournamentLink = {
            tournamentId: tournament.id,
            tournamentMatchId: match.id,
            tournamentName: tournament.name
        };
        VP.router.go('vista-configuracion');
    }

    async function handleDiscard() {
        const accepted = await confirm({
            title: 'Descartar partido',
            message: 'Se perderá todo lo registrado en el partido en curso. ¿Continuar?',
            confirmLabel: 'Descartar',
            danger: true
        });
        if (!accepted) return;
        store.discard();
        byId('config-form').reset();
        syncFirstServerLabels();
        render();
        toast('Partido descartado.', { type: 'info' });
    }

    // ---------------------------------------------------------------------
    // Tema visual
    // ---------------------------------------------------------------------

    /**
     * Aplica un tema. Además de nuestros tokens ([data-theme]) activa el modo
     * de color nativo de Bootstrap ([data-bs-theme]) para sus componentes.
     */
    function applyTheme(theme) {
        document.body.dataset.theme = theme;
        document.body.dataset.bsTheme = theme === 'dark' ? 'dark' : 'light';
        qsa('.theme-picker__input').forEach((input) => {
            input.checked = input.value === theme;
        });
    }

    // ---------------------------------------------------------------------
    // Copia de seguridad y borrado total
    // ---------------------------------------------------------------------

    async function handleImport(event) {
        const input = event.currentTarget;
        const [file] = input.files;
        input.value = ''; // Permite volver a elegir el mismo archivo
        if (!file) return;

        try {
            const backup = await VP.exporters.readJsonFile(file);
            const accepted = await confirm({
                title: 'Importar copia de seguridad',
                message: 'Se reemplazarán TODOS los datos actuales (partidos, historial y torneos). ¿Continuar?',
                confirmLabel: 'Importar',
                danger: true
            });
            if (!accepted) return;

            const result = VP.storage.importBackup(backup);
            if (!result.ok) {
                toast(result.error, { type: 'error' });
                return;
            }
            toast('Datos importados. Recargando…', { type: 'success' });
            setTimeout(() => window.location.reload(), 800);
        } catch (error) {
            toast(error.message, { type: 'error' });
        }
    }

    async function handleReset() {
        const first = await confirm({
            title: '🚨 Atención',
            message: 'Vas a borrar TODO: partidos, historial y torneos guardados en este dispositivo.',
            confirmLabel: 'Sí, continuar',
            danger: true
        });
        if (!first) return;
        const second = await confirm({
            title: '⚠️ Última advertencia',
            message: 'Esta acción NO se puede deshacer. Si quieres conservar algo, exporta antes una copia de seguridad.',
            confirmLabel: 'Borrar todo',
            danger: true
        });
        if (!second) return;

        VP.storage.clearAllData();
        window.location.reload();
    }

    // ---------------------------------------------------------------------
    // Inicialización
    // ---------------------------------------------------------------------

    function init() {
        byId('config-form').addEventListener('submit', handleSubmit);
        byId('input-team-a').addEventListener('input', syncFirstServerLabels);
        byId('input-team-b').addEventListener('input', syncFirstServerLabels);
        byId('btn-discard-match').addEventListener('click', handleDiscard);

        applyTheme(VP.storage.getTheme());
        qsa('.theme-picker__input').forEach((input) => {
            input.addEventListener('change', () => {
                applyTheme(input.value);
                VP.storage.saveTheme(input.value);
            });
        });

        byId('btn-backup-export').addEventListener('click', () => {
            VP.exporters.exportBackup();
            toast('Copia de seguridad descargada.', { type: 'success' });
        });
        byId('input-backup-import').addEventListener('change', handleImport);
        byId('btn-reset-db').addEventListener('click', handleReset);

        VP.router.register('vista-configuracion', { onEnter: render });
    }

    VP.views = VP.views || {};
    VP.views.config = Object.freeze({ init, render, prepareTournamentMatch });
})(window);
