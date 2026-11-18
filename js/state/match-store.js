/**
 * @file match-store.js
 * @description "Store" del partido en curso: única fuente de verdad del estado
 * de juego (marcador, sets, bitácora, cronómetro).
 *
 * Las vistas NUNCA modifican el estado directamente: llaman a los métodos de
 * este store (registerAction, undo, finish…), que aplican las reglas, guardan
 * en localStorage y avisan a los suscriptores. Es un patrón observador
 * simplificado (similar a un mini Redux/Pinia):
 *
 *   Vista ──acción──▶ Store ──aplica reglas──▶ estado ──persist──▶ localStorage
 *     ▲                                          │
 *     └──────────── notify('change') ────────────┘
 *
 * Eventos emitidos:
 *  - 'change': el estado cambió (punto, set, config…). Las vistas se repintan.
 *  - 'tick':   avanzó el cronómetro (cada segundo). Sólo repinta el reloj.
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { ACTION, MAX_TIMEOUTS_PER_SET } = VP.constants;
    const rules = VP.rules;
    const storage = VP.storage;
    const tournamentEngine = VP.tournamentEngine;

    /**
     * @typedef {Object} MatchState
     * @property {Object|null} config  Equipos, jugadores y reglas. `null` = no hay partido.
     * @property {Array<{scoreA:number,scoreB:number,timeoutsA:number,timeoutsB:number}>} sets
     * @property {number} currentSetIndex
     * @property {Array} points               Bitácora completa (ver stats-engine.js)
     * @property {number} matchTimeSeconds    Segundos del cronómetro oficial
     * @property {boolean} isTimerRunning
     * @property {number|null} timerStartedAt Epoch (ms) del último "play"
     * @property {number} timerBaseSeconds    Segundos acumulados antes de ese "play"
     * @property {number|null} matchStartTime Epoch del primer punto (legacy)
     * @property {string|null} tournamentId
     * @property {string|null} tournamentMatchId
     *
     * Cada rally de `points` guarda además `servingTeam` (quién sacó) y,
     * opcionalmente, `reception: { playerId, grade }` (calidad 0-3).
     */

    /** Set vacío. */
    const createSet = () => ({ scoreA: 0, scoreB: 0, timeoutsA: 0, timeoutsB: 0 });

    /** @returns {MatchState} Estado inicial sin partido. */
    function createEmptyMatch() {
        return {
            config: null,
            sets: [createSet()],
            currentSetIndex: 0,
            points: [],
            matchStartTime: null,
            matchTimeSeconds: 0,
            isTimerRunning: false,
            timerStartedAt: null,
            timerBaseSeconds: 0,
            tournamentId: null,
            tournamentMatchId: null
        };
    }

    /** @type {MatchState} */
    let state = createEmptyMatch();
    let timerInterval = null;
    const listeners = new Set();

    // ---------------------------------------------------------------------
    // Suscripción y persistencia
    // ---------------------------------------------------------------------

    /**
     * Registra una función que se llamará con (evento, estado) en cada cambio.
     * @returns {() => void} Función para cancelar la suscripción.
     */
    function subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    function notify(event) {
        listeners.forEach((listener) => listener(event, state));
    }

    /** Guarda en localStorage y avisa a las vistas. */
    function commit() {
        storage.saveCurrentMatch(state);
        notify('change');
    }

    /**
     * Carga el partido guardado (si lo hay) y reanuda el cronómetro.
     * Completa campos que no existían en versiones anteriores (migración suave).
     */
    function load() {
        const saved = storage.getCurrentMatch();
        state = { ...createEmptyMatch(), ...(saved || {}) };
        if (!Array.isArray(state.sets) || state.sets.length === 0) state.sets = [createSet()];

        if (state.isTimerRunning) {
            // Datos antiguos no tenían timerStartedAt: se reanuda desde el valor guardado
            if (!state.timerStartedAt) {
                state.timerStartedAt = Date.now();
                state.timerBaseSeconds = state.matchTimeSeconds || 0;
            }
            runTimerInterval();
        }
        notify('change');
    }

    // ---------------------------------------------------------------------
    // Lecturas (getters)
    // ---------------------------------------------------------------------

    const getState = () => state;
    const hasMatch = () => Boolean(state.config);
    const hasPoints = () => state.points.length > 0;
    const isTournamentMatch = () => Boolean(state.tournamentId);
    const getRules = () => rules.normalizeRules(state.config || {});
    const getCurrentSet = () => state.sets[state.currentSetIndex];
    const getSetsWon = () => rules.countSetsWon(state.sets, getRules());
    const getMatchWinner = () => (hasMatch() ? rules.getMatchWinner(state.sets, getRules()) : null);
    const isMatchOver = () => getMatchWinner() !== null;

    /** Nombre del equipo 'A' o 'B'. */
    const getTeamName = (team) => (state.config ? state.config[team === 'A' ? 'teamA' : 'teamB'] : team);

    /** Número de puntos (sin contar tiempos muertos) registrados hasta ahora. */
    const countRallies = () => state.points.filter((p) => p.tipoAccion !== ACTION.TIMEOUT).length;

    /**
     * ¿Qué equipo saca el próximo rally? Saca quien ganó el rally anterior del
     * set; al empezar cada set, quien corresponda por alternancia según el
     * "Saque inicial" elegido en Config (ver rules.getServingTeam).
     */
    const getServingTeam = () =>
        rules.getServingTeam(state.points, state.currentSetIndex, state.config?.firstServer || 'A');

    // ---------------------------------------------------------------------
    // Cronómetro oficial
    // ---------------------------------------------------------------------

    /**
     * Segundos transcurridos. Se calcula con marcas de tiempo (no sumando
     * +1 cada segundo) para que sea exacto aunque la pestaña se duerma o se
     * recargue la página.
     */
    function getElapsedSeconds() {
        if (!state.isTimerRunning || !state.timerStartedAt) return state.matchTimeSeconds || 0;
        return Math.floor(state.timerBaseSeconds + (Date.now() - state.timerStartedAt) / 1000);
    }

    function runTimerInterval() {
        clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            state.matchTimeSeconds = getElapsedSeconds();
            notify('tick');
        }, 1000);
    }

    function startTimer() {
        if (state.isTimerRunning || !hasMatch()) return;
        state.isTimerRunning = true;
        state.timerStartedAt = Date.now();
        state.timerBaseSeconds = state.matchTimeSeconds || 0;
        runTimerInterval();
        commit();
    }

    function pauseTimer() {
        if (!state.isTimerRunning) return;
        state.matchTimeSeconds = getElapsedSeconds();
        state.isTimerRunning = false;
        state.timerStartedAt = null;
        clearInterval(timerInterval);
        commit();
    }

    // ---------------------------------------------------------------------
    // Ciclo de vida del partido
    // ---------------------------------------------------------------------

    /**
     * Empieza un partido nuevo.
     * @param {Object} config Equipos, jugadores y reglas.
     * @param {{tournamentId?:string, tournamentMatchId?:string}} [link] Partido de torneo asociado.
     */
    function start(config, link = {}) {
        clearInterval(timerInterval);
        state = {
            ...createEmptyMatch(),
            config: { ...config, ...rules.normalizeRules(config), firstServer: config.firstServer === 'B' ? 'B' : 'A' },
            tournamentId: link.tournamentId || null,
            tournamentMatchId: link.tournamentMatchId || null
        };
        commit();
    }

    /** Cambia nombres o reglas sin perder lo jugado (p. ej. corregir un nombre). */
    function updateConfig(config) {
        if (!hasMatch()) return;
        state.config = { ...state.config, ...config, ...rules.normalizeRules(config), firstServer: config.firstServer === 'B' ? 'B' : 'A' };
        commit();
    }

    /** Descarta el partido en curso sin guardarlo en el historial. */
    function discard() {
        clearInterval(timerInterval);
        state = createEmptyMatch();
        commit();
    }

    // ---------------------------------------------------------------------
    // Registro de acciones
    // ---------------------------------------------------------------------

    /**
     * @typedef {Object} PointOutcome
     * @property {boolean} ok
     * @property {'no-match'|'match-over'} [reason] Motivo si `ok` es false.
     * @property {'A'|'B'} [pointWinner]   Equipo que sumó el punto.
     * @property {'A'|'B'|null} [setWinner] Ganador del set si este punto lo cerró.
     * @property {number} [setNumber]        Set en el que se jugó el punto.
     * @property {'A'|'B'|null} [matchWinner] Ganador del partido si quedó decidido.
     * @property {boolean} [sideChange]      ¿Toca cambiar de lado?
     * @property {boolean} [timerAutoStarted] Se arrancó el cronómetro automáticamente.
     */

    /**
     * Núcleo común de "punto táctico" y "punto rápido": suma el punto,
     * lo anota en la bitácora y evalúa fin de set / partido / cambio de lado.
     * @returns {PointOutcome}
     */
    function applyPoint(partialPoint) {
        if (!hasMatch()) return { ok: false, reason: 'no-match' };
        if (isMatchOver()) return { ok: false, reason: 'match-over' };

        // Si el usuario olvidó darle a ▶️, el cronómetro arranca con el primer punto.
        // Así las estadísticas por minuto no quedan todas en el minuto 1.
        let timerAutoStarted = false;
        if (!state.isTimerRunning && state.points.length === 0 && !state.matchTimeSeconds) {
            state.isTimerRunning = true;
            state.timerStartedAt = Date.now();
            state.timerBaseSeconds = 0;
            runTimerInterval();
            timerAutoStarted = true;
        }

        const set = getCurrentSet();
        const setIndex = state.currentSetIndex;
        // Quién sacó este rally: se calcula ANTES de sumar el punto
        const point = { ...partialPoint, servingTeam: getServingTeam() };
        const pointWinner = rules.getPointWinner(point);

        if (pointWinner === 'A') set.scoreA++;
        else set.scoreB++;

        if (!state.matchStartTime) state.matchStartTime = Date.now();
        state.matchTimeSeconds = getElapsedSeconds();

        Object.assign(point, {
            marcadorMomento: `${set.scoreA}-${set.scoreB}`,
            timestamp: Date.now(),
            setNumber: setIndex + 1,
            matchSecond: state.matchTimeSeconds,
            pointNumber: countRallies() + 1
        });
        state.points.push(point);

        const matchRules = getRules();
        const setWinner = rules.getSetWinner(set, setIndex, matchRules);
        const matchWinner = setWinner ? rules.getMatchWinner(state.sets, matchRules) : null;
        const sideChange = rules.isSideChange(set, setIndex, matchRules);

        if (setWinner && !matchWinner && setIndex < matchRules.maxSets - 1) {
            // Empieza el siguiente set
            state.sets.push(createSet());
            state.currentSetIndex++;
        }

        if (matchWinner && state.isTimerRunning) {
            // Fin del partido: se detiene el reloj oficial
            state.matchTimeSeconds = getElapsedSeconds();
            state.isTimerRunning = false;
            state.timerStartedAt = null;
            clearInterval(timerInterval);
        }

        commit();
        return { ok: true, pointWinner, setWinner, setNumber: setIndex + 1, matchWinner, sideChange, timerAutoStarted };
    }

    /**
     * Registra una acción táctica tocada en la cancha.
     * @param {Object} action
     * @param {'A'|'B'} action.team       Equipo del jugador que ejecuta.
     * @param {string} action.playerId    'A1'…'B2'
     * @param {'punto'|'error'} action.actionType
     * @param {string} action.actionDetail Gesto técnico.
     * @param {{x:number,y:number}} action.coords Posición en % de la cancha.
     * @param {{playerId:string, grade:number}} [action.reception] Recepción del rally
     *        (opcional): quién recibió el saque y con qué calidad (0-3).
     * @returns {PointOutcome}
     */
    function registerAction({ team, playerId, actionType, actionDetail, coords, reception }) {
        const point = {
            equipo: team,
            jugadorId: playerId,
            tipoAccion: actionType,
            actionDetail,
            coordenadas: { x: coords.x, y: coords.y }
        };
        if (reception) point.reception = { playerId: reception.playerId, grade: reception.grade };
        return applyPoint(point);
    }

    /**
     * Punto rápido (Marcador Vivo): sólo sabemos qué equipo sumó.
     * @param {'A'|'B'} team
     * @returns {PointOutcome}
     */
    function registerFastPoint(team) {
        return applyPoint({
            equipo: team,
            jugadorId: `Fast_${team}`,
            tipoAccion: ACTION.POINT,
            actionDetail: 'FastScore',
            coordenadas: { x: 50, y: 50 } // Coordenada ficticia: no se registró posición
        });
    }

    /**
     * Pide un tiempo muerto (1 por equipo y set). Pausa el cronómetro.
     * @param {'A'|'B'} team
     * @returns {{ok:true} | {ok:false, reason:'no-match'|'match-over'|'limit'}}
     */
    function registerTimeout(team) {
        if (!hasMatch()) return { ok: false, reason: 'no-match' };
        if (isMatchOver()) return { ok: false, reason: 'match-over' };

        const set = getCurrentSet();
        const key = team === 'A' ? 'timeoutsA' : 'timeoutsB';
        if (set[key] >= MAX_TIMEOUTS_PER_SET) return { ok: false, reason: 'limit' };

        if (state.isTimerRunning) {
            state.matchTimeSeconds = getElapsedSeconds();
            state.isTimerRunning = false;
            state.timerStartedAt = null;
            clearInterval(timerInterval);
        }

        set[key]++;
        state.points.push({
            pointNumber: countRallies(), // Número de la última jugada antes del tiempo muerto
            equipo: team,
            jugadorId: `Eq.${team}`,
            tipoAccion: ACTION.TIMEOUT,
            coordenadas: { x: 50, y: 50 },
            marcadorMomento: `${set.scoreA}-${set.scoreB}`,
            timestamp: Date.now(),
            setNumber: state.currentSetIndex + 1,
            matchSecond: state.matchTimeSeconds
        });
        commit();
        return { ok: true };
    }

    /**
     * Deshace la última acción de la bitácora.
     *  - Tiempo muerto → se devuelve al equipo.
     *  - Punto/error   → se resta y, si ese punto había abierto un set nuevo,
     *                    se elimina el set vacío y se vuelve al anterior.
     * @returns {Object|null} La acción deshecha o `null` si no había ninguna.
     */
    function undo() {
        const last = state.points.pop();
        if (!last) return null;

        if (last.tipoAccion === ACTION.TIMEOUT) {
            const set = state.sets[last.setNumber - 1];
            const key = last.equipo === 'A' ? 'timeoutsA' : 'timeoutsB';
            if (set) set[key] = Math.max(0, set[key] - 1);
        } else {
            if (last.setNumber < state.currentSetIndex + 1) {
                state.sets.pop();
                state.currentSetIndex = last.setNumber - 1;
            }
            const set = getCurrentSet();
            if (rules.getPointWinner(last) === 'A') set.scoreA = Math.max(0, set.scoreA - 1);
            else set.scoreB = Math.max(0, set.scoreB - 1);
        }
        commit();
        return last;
    }

    /**
     * Finaliza el partido: lo archiva en el historial, actualiza el torneo (si
     * corresponde) y deja el store vacío para el siguiente.
     *
     * Un partido de torneo necesita un ganador por sets: si van empatados no
     * se puede cerrar (se devuelve error y no se pierde nada).
     *
     * @returns {{ok:true, tournamentId:(string|null), archived:boolean} | {ok:false, error:string, code:string, params?:Object}}
     */
    function finish() {
        if (!hasMatch()) return { ok: false, code: 'noMatch', error: 'No hay ningún partido en curso.' };
        const { tournamentId, tournamentMatchId } = state;
        const won = getSetsWon();

        if (tournamentId) {
            if (won.A === won.B) {
                return { ok: false, code: 'tournamentNeedsWinner', params: { a: won.A, b: won.B }, error: `Los sets van ${won.A}-${won.B}: un partido de torneo necesita un ganador.` };
            }
            const update = storage.updateTournament(tournamentId, (t) =>
                tournamentEngine.recordResult(t, tournamentMatchId, won.A, won.B)
            );
            if (update && !update.result.ok) return { ok: false, ...update.result };
        }

        pauseTimer();
        const archived = hasPoints();
        if (archived) storage.archiveMatch({ ...state, finishedAt: Date.now() });

        clearInterval(timerInterval);
        state = createEmptyMatch();
        commit();
        return { ok: true, tournamentId, archived };
    }

    VP.matchStore = Object.freeze({
        subscribe,
        load,
        getState,
        hasMatch,
        hasPoints,
        isTournamentMatch,
        getRules,
        getCurrentSet,
        getSetsWon,
        getMatchWinner,
        isMatchOver,
        getTeamName,
        getServingTeam,
        getElapsedSeconds,
        startTimer,
        pauseTimer,
        start,
        updateConfig,
        discard,
        registerAction,
        registerFastPoint,
        registerTimeout,
        undo,
        finish
    });
})(typeof window !== 'undefined' ? window : globalThis);
