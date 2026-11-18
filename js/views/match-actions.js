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
    const i18n = VP.i18n;
    const { t } = i18n;

    /**
     * Comunica al usuario lo que provocó un punto (fin de set, de partido,
     * cambio de lado…) usando el objeto que devuelve el store.
     * @param {Object} outcome Resultado de `registerAction` / `registerFastPoint`.
     */
    function announceOutcome(outcome) {
        if (!outcome.ok) {
            if (outcome.reason === 'match-over') {
                toast(t('match.alreadyOver'), { type: 'warning' });
            } else {
                toast(t('errors.noMatch'), { type: 'error' });
            }
            return;
        }

        if (outcome.timerAutoStarted) toast(t('match.timerAutoStarted'), { type: 'info' });

        if (outcome.matchWinner) {
            const won = store.getSetsWon();
            callout(t('match.wonMatch', { team: store.getTeamName(outcome.matchWinner) }), '🏆', 3000);
            toast(t('match.decided', { a: won.A, b: won.B }), { type: 'success', duration: 6000 });
        } else if (outcome.setWinner) {
            callout(t('match.wonSet', { team: store.getTeamName(outcome.setWinner), set: outcome.setNumber }), '🏐');
        } else if (outcome.sideChange) {
            callout(t('match.sideChange'), '🔄');
        }
    }

    /** Texto breve de un registro de la bitácora para los mensajes de confirmación. */
    function describePoint(point) {
        const config = store.getState().config || {};
        const name = config[`p${point.jugadorId}`] || store.getTeamName(point.equipo);
        return `${i18n.describeAction(point)} · ${name} · ${point.marcadorMomento}`;
    }

    /** Pide confirmación y deshace la última acción. */
    async function confirmAndUndo() {
        const { points } = store.getState();
        if (!points.length) {
            toast(t('match.nothingToUndo'), { type: 'info' });
            return;
        }
        const last = points[points.length - 1];
        const accepted = await confirm({
            title: t('match.undoTitle'),
            message: t('match.undoMessage', { action: describePoint(last) }),
            confirmLabel: t('match.undoConfirm')
        });
        if (!accepted) return;
        store.undo();
        toast(t('match.undone'), { type: 'success' });
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
            ? t('match.finishWinner', { team: store.getTeamName(winner), a: won.A, b: won.B })
            : t('match.finishUnfinished', { a: won.A, b: won.B });

        const accepted = await confirm({ title: t('match.finishTitle'), message, confirmLabel: t('match.finishConfirm') });
        if (!accepted) return;

        const result = store.finish();
        if (!result.ok) {
            toast(i18n.errorMessage(result), { type: 'error', duration: 5000 });
            return;
        }

        toast(t('match.saved'), { type: 'success' });
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
