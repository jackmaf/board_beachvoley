/**
 * @file match-actions.js
 * @description Acciones de partido compartidas por las vistas "Scout" y
 * "Marcador Vivo": anunciar el resultado de un punto, deshacer y finalizar.
 * Tenerlas en un solo sitio evita que ambas vistas se comporten distinto.
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { toast, callout, confirm } = VP.feedback;
    const store = VP.matchStore;

    /**
     * Comunica al usuario lo que provocó un punto (fin de set, de partido,
     * cambio de lado…) usando el objeto que devuelve el store.
     * @param {Object} outcome Resultado de `registerAction` / `registerFastPoint`.
     */
    function announceOutcome(outcome) {
        if (!outcome.ok) {
            if (outcome.reason === 'match-over') {
                toast('El partido ya terminó. Pulsa «Finalizar» para guardarlo.', { type: 'warning' });
            } else {
                toast('No hay ningún partido en curso.', { type: 'error' });
            }
            return;
        }

        if (outcome.timerAutoStarted) toast('⏱️ Cronómetro iniciado automáticamente.', { type: 'info' });

        if (outcome.matchWinner) {
            const won = store.getSetsWon();
            callout(`¡${store.getTeamName(outcome.matchWinner)} gana el partido!`, '🏆', 3000);
            toast(`Partido decidido (${won.A}-${won.B}). Pulsa «Finalizar» para guardarlo.`, { type: 'success', duration: 6000 });
        } else if (outcome.setWinner) {
            callout(`¡${store.getTeamName(outcome.setWinner)} gana el Set ${outcome.setNumber}!`, '🏐');
        } else if (outcome.sideChange) {
            callout('¡Cambio de lado!', '🔄');
        }
    }

    /** Texto breve de un registro de la bitácora para los mensajes de confirmación. */
    function describePoint(point) {
        const config = store.getState().config || {};
        const name = config[`p${point.jugadorId}`] || store.getTeamName(point.equipo);
        return `${VP.statsEngine.describeAction(point)} · ${name} · ${point.marcadorMomento}`;
    }

    /** Pide confirmación y deshace la última acción. */
    async function confirmAndUndo() {
        const { points } = store.getState();
        if (!points.length) {
            toast('No hay acciones para deshacer.', { type: 'info' });
            return;
        }
        const last = points[points.length - 1];
        const accepted = await confirm({
            title: 'Deshacer última acción',
            message: `Se eliminará: ${describePoint(last)}`,
            confirmLabel: 'Deshacer'
        });
        if (!accepted) return;
        store.undo();
        toast('Acción deshecha.', { type: 'success' });
    }

    /**
     * Pide confirmación y finaliza el partido. Después:
     *  - Partido de torneo → vuelve a Torneos con el detalle abierto.
     *  - Partido amistoso  → abre Estadísticas con ese partido.
     */
    async function confirmAndFinish() {
        if (!store.hasMatch()) return;
        const won = store.getSetsWon();
        const winner = store.getMatchWinner();
        const message = winner
            ? `Ganador: ${store.getTeamName(winner)} (${won.A}-${won.B}). Se guardará en el historial.`
            : `El partido aún no ha terminado (sets ${won.A}-${won.B}). ¿Guardarlo igualmente en el historial?`;

        const accepted = await confirm({ title: 'Finalizar partido', message, confirmLabel: 'Finalizar y guardar' });
        if (!accepted) return;

        const result = store.finish();
        if (!result.ok) {
            toast(result.error, { type: 'error', duration: 5000 });
            return;
        }

        toast('Partido guardado.', { type: 'success' });
        if (result.tournamentId) {
            VP.router.go('vista-torneos');
            VP.views.tournaments.openDetail(result.tournamentId);
        } else {
            VP.views.stats.selectLatestHistory();
            VP.router.go('vista-estadisticas');
        }
    }

    VP.views = VP.views || {};
    VP.views.matchActions = Object.freeze({ announceOutcome, confirmAndUndo, confirmAndFinish });
})(window);
