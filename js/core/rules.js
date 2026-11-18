/**
 * @file rules.js
 * @description Motor de reglas del voley playa. Funciones PURAS: reciben datos y
 * devuelven resultados, sin tocar el DOM ni localStorage. Por eso están
 * cubiertas por tests unitarios (`tests/rules.test.js`).
 *
 * Conceptos:
 *  - Un set se gana al llegar al umbral (21 o 15 en el tie-break) con 2 puntos
 *    de ventaja como mínimo.
 *  - El partido lo gana quien primero consigue `ceil(maxSets / 2)` sets.
 *  - El "tie-break" es el último set posible (el 3º en un partido a 3).
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { DEFAULT_RULES, MIN_POINT_DIFF, SIDE_CHANGE_EVERY, ACTION } = VP.constants;

    /**
     * @typedef {Object} MatchRules
     * @property {number} maxSets     Número máximo de sets (1, 3 o 5).
     * @property {number} ptsNormal   Puntos para ganar un set normal.
     * @property {number} ptsTiebreak Puntos para ganar el set decisivo.
     */

    /**
     * @typedef {Object} SetScore
     * @property {number} scoreA
     * @property {number} scoreB
     */

    /**
     * Devuelve unas reglas completas y válidas a partir de una config parcial.
     * @param {Partial<MatchRules>} [config]
     * @returns {MatchRules}
     */
    function normalizeRules(config = {}) {
        const pick = (value, fallback) => (Number.isFinite(+value) && +value > 0 ? +value : fallback);
        return {
            maxSets: pick(config.maxSets, DEFAULT_RULES.maxSets),
            ptsNormal: pick(config.ptsNormal, DEFAULT_RULES.ptsNormal),
            ptsTiebreak: pick(config.ptsTiebreak, DEFAULT_RULES.ptsTiebreak)
        };
    }

    /**
     * ¿Qué equipo se lleva el punto de un registro?
     * Un "punto" suma al equipo del jugador; un "error" suma al rival.
     * @param {{equipo:'A'|'B', tipoAccion:string}} point
     * @returns {'A'|'B'|null} `null` para los tiempos muertos.
     */
    function getPointWinner(point) {
        if (!point || point.tipoAccion === ACTION.TIMEOUT) return null;
        if (point.tipoAccion === ACTION.ERROR) return point.equipo === 'A' ? 'B' : 'A';
        return point.equipo;
    }

    /** Devuelve el equipo contrario. */
    function opponentOf(team) {
        return team === 'A' ? 'B' : 'A';
    }

    /** ¿El set con este índice (0-based) es el tie-break? */
    function isTiebreakSet(setIndex, rules) {
        const { maxSets } = normalizeRules(rules);
        return maxSets > 1 && setIndex === maxSets - 1;
    }

    /** Puntos necesarios para ganar el set `setIndex`. */
    function getSetTarget(setIndex, rules) {
        const normalized = normalizeRules(rules);
        return isTiebreakSet(setIndex, normalized) ? normalized.ptsTiebreak : normalized.ptsNormal;
    }

    /**
     * Ganador de un set, si ya terminó.
     * @param {SetScore} set
     * @param {number} setIndex
     * @param {MatchRules} rules
     * @returns {'A'|'B'|null}
     */
    function getSetWinner(set, setIndex, rules) {
        if (!set) return null;
        const target = getSetTarget(setIndex, rules);
        const { scoreA, scoreB } = set;
        const reachedTarget = scoreA >= target || scoreB >= target;
        const hasMargin = Math.abs(scoreA - scoreB) >= MIN_POINT_DIFF;
        if (!reachedTarget || !hasMargin) return null;
        return scoreA > scoreB ? 'A' : 'B';
    }

    /** ¿El set ya terminó según las reglas? */
    function isSetFinished(set, setIndex, rules) {
        return getSetWinner(set, setIndex, rules) !== null;
    }

    /** Sets necesarios para ganar el partido (2 en un "mejor de 3"). */
    function getSetsToWin(rules) {
        return Math.ceil(normalizeRules(rules).maxSets / 2);
    }

    /**
     * Cuenta los sets TERMINADOS que ha ganado cada equipo.
     * Un set a medias (p. ej. 10-8) no cuenta para nadie.
     * @param {SetScore[]} sets
     * @param {MatchRules} rules
     * @returns {{A:number, B:number}}
     */
    function countSetsWon(sets, rules) {
        return (sets || []).reduce(
            (acc, set, index) => {
                const winner = getSetWinner(set, index, rules);
                if (winner) acc[winner]++;
                return acc;
            },
            { A: 0, B: 0 }
        );
    }

    /**
     * Ganador del partido si ya está decidido.
     * @returns {'A'|'B'|null}
     */
    function getMatchWinner(sets, rules) {
        const won = countSetsWon(sets, rules);
        const needed = getSetsToWin(rules);
        if (won.A >= needed) return 'A';
        if (won.B >= needed) return 'B';
        return null;
    }

    /**
     * ¿Toca cambiar de lado tras el último punto del set?
     * Se cambia cada 7 puntos totales (5 en el tie-break), salvo si ese punto cerró el set.
     */
    function isSideChange(set, setIndex, rules) {
        const total = set.scoreA + set.scoreB;
        const every = isTiebreakSet(setIndex, rules) ? SIDE_CHANGE_EVERY.tiebreak : SIDE_CHANGE_EVERY.normal;
        return total > 0 && total % every === 0 && !isSetFinished(set, setIndex, rules);
    }

    // ---------------------------------------------------------------------
    // Saque
    // ---------------------------------------------------------------------

    /**
     * Equipo que saca el primer rally de un set.
     * El saque inicial del partido se alterna en cada set (A, B, A…): en el
     * reglamento, quien no sacó primero en el set 1 saca primero en el set 2.
     * (El set decisivo se sortea en la realidad; aquí se mantiene la alternancia
     * por simplicidad.)
     *
     * @param {number} setIndex 0-based.
     * @param {'A'|'B'} [firstServer='A'] Quién sacó primero en el set 1.
     * @returns {'A'|'B'}
     */
    function getSetFirstServer(setIndex, firstServer = 'A') {
        const first = firstServer === 'B' ? 'B' : 'A';
        return setIndex % 2 === 0 ? first : opponentOf(first);
    }

    /**
     * Equipo que tiene el saque en el PRÓXIMO rally del set indicado.
     * En voley playa saca quien ganó el rally anterior (rally point); si el
     * set aún no tiene puntos, saca quien le corresponde por alternancia.
     *
     * @param {Array} points Bitácora completa del partido.
     * @param {number} setIndex Set en juego (0-based).
     * @param {'A'|'B'} [firstServer='A']
     * @returns {'A'|'B'}
     */
    function getServingTeam(points, setIndex, firstServer = 'A') {
        const setNumber = setIndex + 1;
        for (let i = points.length - 1; i >= 0; i--) {
            const pointSet = points[i].setNumber || 1;
            if (pointSet < setNumber) break; // Ya pasamos al set anterior
            if (pointSet > setNumber) continue;
            const winner = getPointWinner(points[i]);
            if (winner) return winner;
        }
        return getSetFirstServer(setIndex, firstServer);
    }

    /**
     * Valida un resultado introducido a mano (pantalla "Colocar marcador").
     *
     * Reglas de validación:
     *  - Los sets se rellenan en orden: no puede haber huecos.
     *  - Ningún set puede acabar empatado.
     *  - Debe haber un ganador del partido y no puede haber sets "de más"
     *    después de que el partido quedara decidido.
     *
     * @param {Array<{a:(number|null), b:(number|null)}>} setScores Puntos por set (null = vacío).
     * @param {MatchRules} rules
     * @returns {{ok:true, setsA:number, setsB:number, winner:'A'|'B'} | {ok:false, error:string}}
     */
    function evaluateManualResult(setScores, rules) {
        const needed = getSetsToWin(rules);
        let setsA = 0;
        let setsB = 0;
        let reachedEmpty = false;

        for (let i = 0; i < setScores.length; i++) {
            const { a, b } = setScores[i];
            const isEmpty = a === null && b === null;

            if (isEmpty) {
                reachedEmpty = true;
                continue;
            }
            if (a === null || b === null) return { ok: false, code: 'setIncomplete', params: { set: i + 1 }, error: `Completa los dos marcadores del Set ${i + 1}.` };
            if (reachedEmpty) return { ok: false, code: 'setGap', params: { set: i + 1 }, error: `El Set ${i + 1} está relleno pero falta un set anterior.` };
            if (a < 0 || b < 0) return { ok: false, code: 'negativePoints', error: 'Los puntos no pueden ser negativos.' };
            if (a === b) return { ok: false, code: 'setTied', params: { set: i + 1 }, error: `El Set ${i + 1} no puede terminar empatado.` };
            if (setsA >= needed || setsB >= needed) {
                return { ok: false, code: 'alreadyDecided', params: { set: i + 1 }, error: `El partido ya estaba decidido antes del Set ${i + 1}.` };
            }

            if (a > b) setsA++;
            else setsB++;
        }

        if (setsA < needed && setsB < needed) {
            return { ok: false, code: 'setsNeeded', params: { count: needed }, error: `Un equipo debe ganar ${needed} set(s) para cerrar el partido.` };
        }
        return { ok: true, setsA, setsB, winner: setsA > setsB ? 'A' : 'B' };
    }

    VP.rules = Object.freeze({
        normalizeRules,
        getPointWinner,
        opponentOf,
        isTiebreakSet,
        getSetTarget,
        getSetWinner,
        isSetFinished,
        getSetsToWin,
        countSetsWon,
        getMatchWinner,
        isSideChange,
        getSetFirstServer,
        getServingTeam,
        evaluateManualResult
    });

    if (typeof module !== 'undefined' && module.exports) module.exports = VP.rules;
})(typeof window !== 'undefined' ? window : globalThis);
