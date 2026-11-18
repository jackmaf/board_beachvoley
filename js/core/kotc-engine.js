/**
 * @file kotc-engine.js
 * @description Motor PURO del formato "Queen & King of the Court".
 *
 * Reglas implementadas (las habituales del formato, configurables):
 *  - Varias duplas comparten UNA cancha. Un lado es el "trono" (Reina/Rey);
 *    el otro lo ocupa el "retador" (primera dupla de la cola).
 *  - El retador saca contra el trono. En cada rally:
 *      · Gana el trono    → +1 punto para el trono; el retador va al final
 *                           de la cola y entra el siguiente.
 *      · Gana el retador  → NO suma, pero sube al trono; la dupla destronada
 *                           va al final de la cola.
 *    Es decir: sólo se puntúa desde el trono.
 *  - Gana el torneo la primera dupla que llega a `targetPoints`.
 *  - Con límite de tiempo: al acabarse gana el líder; si hay empate en la
 *    cabeza se juega "punto de oro" (el primer punto que rompa el empate).
 *
 * Diseño del "deshacer": antes de cada acción se guarda una instantánea del
 * estado de juego en `history`. Deshacer = restaurar la última instantánea.
 * Es simple y a prueba de errores: devuelve EXACTAMENTE cola, trono, puntos
 * y estadísticas, sea cual sea la jugada (rally o corrección manual).
 *
 * Forma del estado (se guarda en `tournament.kotc`):
 * {
 *   settings: { targetPoints, timeLimitMinutes },
 *   teams:    [{ id, name, p1, p2 }],
 *   throne:   'k1',                 // id de la dupla en el trono
 *   queue:    ['k2', 'k3', …],      // queue[0] es el retador actual
 *   points:   { k1: 0, … },
 *   stats:    { k1: { thrones, kingRallies, dethroned }, … },
 *   rallies:  0,
 *   timeUp:   false,
 *   winnerId: null,
 *   timer:    { elapsedMs, runningSince },
 *   history:  [{ type, label, at, snapshot }]
 * }
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { KOTC_DEFAULTS } = VP.constants;

    /** Máximo de jugadas que se pueden deshacer (evita que localStorage crezca sin límite). */
    const MAX_HISTORY = 300;

    /** Normaliza la configuración del formato. */
    function normalizeSettings(settings = {}) {
        const target = parseInt(settings.targetPoints, 10);
        const minutes = parseInt(settings.timeLimitMinutes, 10);
        return {
            targetPoints: Number.isFinite(target) && target > 0 ? target : KOTC_DEFAULTS.targetPoints,
            timeLimitMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 0
        };
    }

    /**
     * Crea el estado inicial. La primera dupla empieza en el trono y el resto
     * hace cola en el orden de inscripción (la segunda es el primer retador).
     * @param {Array<{name:string,p1?:string,p2?:string}>} teams
     * @param {Object} [settings]
     */
    function createState(teams, settings) {
        const list = teams.map((t, i) => ({ id: `k${i + 1}`, name: t.name, p1: t.p1 || '', p2: t.p2 || '' }));
        const ids = list.map((t) => t.id);
        return {
            settings: normalizeSettings(settings),
            teams: list,
            throne: ids[0],
            queue: ids.slice(1),
            points: Object.fromEntries(ids.map((id) => [id, 0])),
            stats: Object.fromEntries(ids.map((id) => [id, { thrones: 0, kingRallies: 0, dethroned: 0 }])),
            rallies: 0,
            timeUp: false,
            winnerId: null,
            timer: { elapsedMs: 0, runningSince: null },
            history: []
        };
    }

    // ---------------------------------------------------------------------
    // Lecturas
    // ---------------------------------------------------------------------

    const getTeam = (state, id) => state.teams.find((t) => t.id === id) || null;
    const getChallengerId = (state) => state.queue[0] || null;
    const isFinished = (state) => Boolean(state.winnerId);

    /** Milisegundos jugados (el reloj sólo corre entre "play" y "pausa"). */
    function getElapsedMs(state, now = Date.now()) {
        const { elapsedMs, runningSince } = state.timer;
        return elapsedMs + (runningSince ? now - runningSince : 0);
    }

    /** Milisegundos restantes, o `null` si no hay límite de tiempo. */
    function getRemainingMs(state, now = Date.now()) {
        if (!state.settings.timeLimitMinutes) return null;
        return Math.max(0, state.settings.timeLimitMinutes * 60000 - getElapsedMs(state, now));
    }

    /** Duplas empatadas en la cabeza (para el "punto de oro"). */
    function getLeaders(state) {
        const max = Math.max(...Object.values(state.points));
        return Object.keys(state.points).filter((id) => state.points[id] === max);
    }

    /**
     * Tabla de posiciones.
     * Orden: puntos → tronos conquistados → puntos ganados desde el trono → nombre.
     * `status` indica dónde está cada dupla ahora mismo.
     */
    function computeStandings(state) {
        return state.teams
            .map((team) => {
                const queuePos = state.queue.indexOf(team.id);
                let status = 'queue';
                if (team.id === state.throne) status = 'throne';
                else if (queuePos === 0) status = 'challenger';
                return {
                    ...team,
                    points: state.points[team.id],
                    ...state.stats[team.id],
                    status,
                    queuePos, // 0 = retador, 1 = siguiente en entrar…
                    isWinner: team.id === state.winnerId
                };
            })
            .sort(
                (a, b) =>
                    b.points - a.points ||
                    b.thrones - a.thrones ||
                    b.kingRallies - a.kingRallies ||
                    a.name.localeCompare(b.name)
            );
    }

    // ---------------------------------------------------------------------
    // Acciones (todas guardan una instantánea para poder deshacerlas)
    // ---------------------------------------------------------------------

    /** Copia del estado de juego (sin el historial, para no anidarlo). */
    function takeSnapshot(state) {
        const { history, ...rest } = state;
        return JSON.parse(JSON.stringify(rest));
    }

    function pushHistory(state, type, label) {
        state.history.push({ type, label, at: Date.now(), snapshot: takeSnapshot(state) });
        if (state.history.length > MAX_HISTORY) state.history.shift();
    }

    /** Decide si hay campeón: por puntos objetivo o, con el tiempo cumplido, por liderato único. */
    function checkWinner(state) {
        const reached = state.teams.find((t) => state.points[t.id] >= state.settings.targetPoints);
        if (reached) {
            state.winnerId = reached.id;
        } else if (state.timeUp) {
            const leaders = getLeaders(state);
            state.winnerId = leaders.length === 1 ? leaders[0] : null; // empate → punto de oro
        } else {
            state.winnerId = null;
        }
        if (state.winnerId && state.timer.runningSince) {
            // Fin del torneo: se detiene el reloj
            state.timer.elapsedMs = getElapsedMs(state);
            state.timer.runningSince = null;
        }
    }

    /**
     * Registra un rally.
     * @param {Object} state
     * @param {'throne'|'challenger'} winner Lado que ganó el rally.
     * @returns {{ok:true, dethroned?:boolean} | {ok:false, error:string}}
     */
    function applyRally(state, winner) {
        if (isFinished(state)) return { ok: false, error: 'El torneo ya tiene campeón. Deshaz la última jugada para corregir.' };
        const kingId = state.throne;
        const challengerId = getChallengerId(state);
        if (!challengerId) return { ok: false, error: 'No hay retador en cola.' };

        const king = getTeam(state, kingId);
        const challenger = getTeam(state, challengerId);
        const label = winner === 'throne'
            ? `👑 ${king.name} gana desde el trono a ${challenger.name} (+1)`
            : `⚔️ ${challenger.name} destrona a ${king.name}`;
        pushHistory(state, 'rally', label);

        // El reloj arranca solo con el primer rally
        if (!state.timer.runningSince && !state.timer.elapsedMs) state.timer.runningSince = Date.now();

        state.rallies++;
        state.queue.shift(); // El retador sale de la cola en ambos casos…

        if (winner === 'throne') {
            state.points[kingId]++;
            state.stats[kingId].kingRallies++;
            state.queue.push(challengerId); // …y si pierde, vuelve al final
        } else {
            state.throne = challengerId; // …y si gana, ocupa el trono
            state.stats[challengerId].thrones++;
            state.stats[kingId].dethroned++;
            state.queue.push(kingId); // El destronado pasa al final de la cola
        }

        checkWinner(state);
        return { ok: true, dethroned: winner === 'challenger' };
    }

    /**
     * Corrección manual de puntos (+1 / −1) desde la tabla. También se puede deshacer.
     * @returns {{ok:true} | {ok:false, error:string}}
     */
    function adjustPoints(state, teamId, delta) {
        const team = getTeam(state, teamId);
        if (!team) return { ok: false, error: 'Dupla no encontrada.' };
        if (delta < 0 && state.points[teamId] === 0) return { ok: false, error: `${team.name} ya tiene 0 puntos.` };

        pushHistory(state, 'adjust', `✏️ Corrección: ${team.name} ${delta > 0 ? '+' : ''}${delta}`);
        state.points[teamId] = Math.max(0, state.points[teamId] + delta);
        checkWinner(state);
        return { ok: true };
    }

    /** Marca el fin del tiempo reglamentario y decide campeón (o punto de oro). */
    function markTimeUp(state) {
        if (state.timeUp) return;
        pushHistory(state, 'time', '⏱️ Tiempo cumplido');
        state.timeUp = true;
        state.timer.elapsedMs = getElapsedMs(state);
        state.timer.runningSince = null;
        checkWinner(state);
    }

    /** Pone en marcha o pausa el reloj (no se guarda en el historial). */
    function toggleTimer(state, now = Date.now()) {
        if (isFinished(state) || state.timeUp) return;
        if (state.timer.runningSince) {
            state.timer.elapsedMs = getElapsedMs(state, now);
            state.timer.runningSince = null;
        } else {
            state.timer.runningSince = now;
        }
    }

    /**
     * Deshace la última jugada restaurando la instantánea previa.
     * El reloj NO retrocede: el tiempo jugado es real.
     * @returns {Object|null} La jugada deshecha o null si no había.
     */
    function undo(state) {
        const last = state.history.pop();
        if (!last) return null;
        const timer = { ...state.timer };
        Object.assign(state, last.snapshot, { history: state.history });
        // Se conserva el reloj actual salvo que la jugada deshecha fuera el fin de tiempo
        if (last.type !== 'time') state.timer = timer;
        return last;
    }

    VP.kotcEngine = Object.freeze({
        normalizeSettings,
        createState,
        getTeam,
        getChallengerId,
        isFinished,
        getElapsedMs,
        getRemainingMs,
        getLeaders,
        computeStandings,
        applyRally,
        adjustPoints,
        markTimeUp,
        toggleTimer,
        undo
    });

    if (typeof module !== 'undefined' && module.exports) module.exports = VP.kotcEngine;
})(typeof window !== 'undefined' ? window : globalThis);
