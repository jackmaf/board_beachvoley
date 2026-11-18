/**
 * @file live-view.js
 * @description Vista "Marcador Vivo": marcador grande tipo TV con botones
 * +1 por equipo. Pensado para torneos, donde sólo interesa el resultado.
 *
 * Atajos de teclado (sólo con esta vista activa y sin modales abiertos):
 *   A / ←  punto equipo A    L / →  punto equipo B    Z  deshacer
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { byId, setTextWithBump, isAnyModalOpen } = VP.dom;
    const store = VP.matchStore;
    const actions = VP.views.matchActions;
    const { t } = VP.i18n;

    const VIEW_ID = 'vista-marcador-vivo';
    let el = {};

    function render() {
        if (!store.hasMatch()) return;
        const state = store.getState();
        const set = store.getCurrentSet();
        const won = store.getSetsWon();
        const matchOver = store.isMatchOver();

        // Nombre del torneo (o "Partido amistoso")
        const tournament = state.tournamentId ? VP.storage.getTournament(state.tournamentId) : null;
        el.tournament.textContent = tournament ? t('live.tournament', { name: tournament.name }) : t('live.friendly');

        el.setNumber.textContent = state.currentSetIndex + 1;
        el.setsWon.textContent = `${won.A} - ${won.B}`;
        el.nameA.textContent = state.config.teamA;
        el.nameB.textContent = state.config.teamB;
        setTextWithBump(el.scoreA, set.scoreA, 'live-board__score--bump');
        setTextWithBump(el.scoreB, set.scoreB, 'live-board__score--bump');

        const serving = store.getServingTeam();
        el.servingA.hidden = matchOver || serving !== 'A';
        el.servingB.hidden = matchOver || serving !== 'B';

        el.addA.disabled = matchOver;
        el.addB.disabled = matchOver;
        el.undo.disabled = state.points.length === 0;
        el.end.classList.toggle('btn--pulse', matchOver);
    }

    function addPoint(team) {
        actions.announceOutcome(store.registerFastPoint(team));
    }

    /** Atajos de teclado para anotar sin mirar la pantalla. */
    function handleKeydown(event) {
        if (VP.router.getCurrent() !== VIEW_ID || isAnyModalOpen() || !store.hasMatch()) return;
        if (event.target.closest('input, select, textarea')) return;

        const key = event.key.toLowerCase();
        if (key === 'a' || key === 'arrowleft') addPoint('A');
        else if (key === 'l' || key === 'arrowright') addPoint('B');
        else if (key === 'z') actions.confirmAndUndo();
        else return;
        event.preventDefault();
    }

    function init() {
        el = {
            tournament: byId('live-tournament-name'),
            setNumber: byId('live-set-number'),
            setsWon: byId('live-sets-won'),
            nameA: byId('live-name-a'),
            nameB: byId('live-name-b'),
            scoreA: byId('live-score-a'),
            scoreB: byId('live-score-b'),
            servingA: byId('live-serving-a'),
            servingB: byId('live-serving-b'),
            addA: byId('btn-live-point-a'),
            addB: byId('btn-live-point-b'),
            undo: byId('btn-live-undo'),
            end: byId('btn-live-end')
        };

        el.addA.addEventListener('click', () => addPoint('A'));
        el.addB.addEventListener('click', () => addPoint('B'));
        el.undo.addEventListener('click', actions.confirmAndUndo);
        el.end.addEventListener('click', actions.confirmAndFinish);
        document.addEventListener('keydown', handleKeydown);

        store.subscribe((event) => {
            if (event === 'change') render();
        });
        VP.i18n.onChange(render);
        VP.router.register(VIEW_ID, { onEnter: render });
    }

    VP.views = VP.views || {};
    VP.views.live = Object.freeze({ init, render });
})(window);
