/**
 * @file stats-engine.js
 * @description Cálculos estadísticos PUROS sobre la bitácora de un partido
 * (array de "points"). La vista de Estadísticas y el Dashboard de jugador sólo
 * pintan lo que devuelven estas funciones.
 *
 * Forma de un registro de la bitácora (point):
 * {
 *   equipo: 'A'|'B',              // equipo de QUIEN EJECUTA la acción
 *   jugadorId: 'A1'|…|'Eq.A'|'Fast_A',
 *   tipoAccion: 'punto'|'error'|'timeout',
 *   actionDetail: 'Ataque'|…|'FastScore',
 *   coordenadas: { x, y },        // % sobre la cancha (puede salir de 0-100)
 *   marcadorMomento: '15-12',     // marcador del set justo después de la acción
 *   setNumber, matchSecond, pointNumber, timestamp
 * }
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { ACTION, PLAYER_IDS, SKILLS, DEFAULT_SKILL, POSITIVE_RECEPTION_MIN } = VP.constants;
    const { getPointWinner, getSetFirstServer, opponentOf } = VP.rules;
    const { toMatchMinute, percentToMeters } = VP.utils;

    /**
     * @typedef {Object} StatsFilters
     * @property {'all'|string} player        'all' o 'A1'…'B2'
     * @property {'all'|'punto'|'error'} action
     * @property {'all'|string} actionDetail  'all' o un gesto técnico
     * @property {'all'|number} set           'all' o número de set (1-based)
     * @property {number} timelinePct         0-100: porcentaje de jugadas a mostrar
     * @property {number|null} minMinute      Minuto inicial (incluido)
     * @property {number|null} maxMinute      Minuto final (incluido)
     */

    /** Filtros "neutros": muestran todo el partido. */
    function createDefaultFilters() {
        return { player: 'all', action: 'all', actionDetail: 'all', set: 'all', timelinePct: 100, minMinute: null, maxMinute: null };
    }

    const isTimeout = (p) => p.tipoAccion === ACTION.TIMEOUT;

    /**
     * Aplica los filtros en cascada y devuelve las tres "capas" de datos:
     *
     *   points ──① línea de tiempo──▶ timeline ──② set──▶ bySet ──③-⑦──▶ visible
     *
     *  - `bySet`: alimenta el resumen, el Salón de la Fama y el dashboard
     *    (ignoran los filtros de jugador/acción para no quedar vacíos).
     *  - `visible`: alimenta el heatmap, la tabla por jugador y la bitácora.
     *
     * @param {Array} points
     * @param {StatsFilters} filters
     */
    function selectPoints(points, filters) {
        const all = points || [];
        // ① Línea de tiempo: se corta por número de jugadas (no por minutos)
        const cut = Math.floor((all.length * filters.timelinePct) / 100);
        const timeline = all.slice(0, cut);

        // ② Set
        const bySet = filters.set === 'all' ? timeline : timeline.filter((p) => (p.setNumber || 1) === filters.set);

        // ③-⑦ Filtros visuales
        const visible = bySet.filter((p) => {
            if (isTimeout(p)) return false;
            const minute = toMatchMinute(p.matchSecond);
            if (filters.minMinute !== null && minute < filters.minMinute) return false;
            if (filters.maxMinute !== null && minute > filters.maxMinute) return false;
            if (filters.player !== 'all' && p.jugadorId !== filters.player) return false;
            if (filters.action !== 'all' && p.tipoAccion !== filters.action) return false;
            if (filters.actionDetail !== 'all' && (p.actionDetail || DEFAULT_SKILL) !== filters.actionDetail) return false;
            return true;
        });

        return { timeline, bySet, visible };
    }

    /** Marcador acumulado (puntos, no sets) de una lista de registros. */
    function computeScore(points) {
        return points.reduce(
            (acc, p) => {
                const winner = getPointWinner(p);
                if (winner) acc[winner]++;
                return acc;
            },
            { A: 0, B: 0 }
        );
    }

    /** Segundos entre la primera y la última acción de la lista. */
    function computeSpanSeconds(points) {
        if (!points.length) return 0;
        const seconds = points.map((p) => p.matchSecond || 0);
        return Math.max(...seconds) - Math.min(...seconds);
    }

    /** Objeto `{ Ataque: 0, Saque: 0, … }` con todos los gestos a cero. */
    function emptySkillCounts() {
        return Object.fromEntries(SKILLS.map((s) => [s.key, 0]));
    }

    /**
     * Totales por jugador: puntos, errores y puntos por gesto técnico.
     * @param {Array} points
     * @param {{pA1:string,pA2:string,pB1:string,pB2:string}} config Nombres de los jugadores.
     */
    function computePlayerTotals(points, config) {
        const totals = {};
        PLAYER_IDS.forEach((id) => {
            totals[id] = { id, team: id.charAt(0), name: config[`p${id}`] || id, pts: 0, errs: 0, skills: emptySkillCounts() };
        });

        points.forEach((p) => {
            const player = totals[p.jugadorId];
            if (!player || isTimeout(p)) return;
            if (p.tipoAccion === ACTION.POINT) {
                player.pts++;
                const skill = p.actionDetail || DEFAULT_SKILL;
                if (skill in player.skills) player.skills[skill]++;
            } else if (p.tipoAccion === ACTION.ERROR) {
                player.errs++;
            }
        });
        return totals;
    }

    /**
     * Premios del "Salón de la Fama".
     * `key` ('topScorer' | 'mostErrors' | clave del gesto) y `count`/`unit`
     * permiten a la interfaz traducir `title` y `value`.
     * @returns {Array<{key:string,emoji:string,title:string,playerId:string,winner:string,team:string,value:string,count:number,unit:'pts'|'errs',isNegative:boolean}>}
     */
    function computeAwards(totals) {
        const players = Object.values(totals);
        const best = (score) => [...players].sort((a, b) => score(b) - score(a))[0];
        const awards = [];
        const push = (key, emoji, title, player, count, unit, isNegative = false) =>
            awards.push({
                key, emoji, title, playerId: player.id, winner: player.name, team: player.team,
                value: `${count} ${unit}`, count, unit, isNegative
            });

        const topScorer = best((p) => p.pts);
        if (topScorer && topScorer.pts > 0) push('topScorer', '🔥', 'Máx. Anotador', topScorer, topScorer.pts, 'pts');

        const mostErrors = best((p) => p.errs);
        if (mostErrors && mostErrors.errs > 0) push('mostErrors', '☠️', 'Más Errores', mostErrors, mostErrors.errs, 'errs', true);

        SKILLS.forEach((skill) => {
            const leader = best((p) => p.skills[skill.key]);
            if (leader && leader.skills[skill.key] > 0) push(skill.key, skill.emoji, skill.award, leader, leader.skills[skill.key], 'pts');
        });
        return awards;
    }

    /** Texto legible de una acción para tablas y exportaciones. */
    function describeAction(point) {
        if (isTimeout(point)) return 'TIEMPO MUERTO';
        if (point.actionDetail === 'FastScore') return 'Punto (marcador rápido)';
        const kind = point.tipoAccion === ACTION.POINT ? 'Punto' : 'Error';
        return `${point.actionDetail || DEFAULT_SKILL} (${kind})`;
    }

    /**
     * ¿Es una coordenada real tocada en la cancha?
     * Los tiempos muertos y el marcador rápido usan (50,50) ficticio.
     */
    function hasRealCoords(point) {
        return !isTimeout(point) && point.actionDetail !== 'FastScore' && Boolean(point.coordenadas);
    }

    /**
     * Fila de bitácora lista para pintar o exportar.
     * Calcula los metros a partir de las coordenadas (antes se leían campos
     * `realX/realY` que nunca se guardaban y las columnas salían vacías).
     */
    function toLogRow(point, playerName) {
        const meters = hasRealCoords(point) ? percentToMeters(point.coordenadas) : null;
        return {
            pointNumber: point.pointNumber,
            setNumber: point.setNumber || 1,
            team: point.equipo,
            playerId: point.jugadorId,
            playerName: isTimeout(point) ? '-' : playerName || point.jugadorId,
            action: describeAction(point),
            kind: point.tipoAccion,
            detail: point.actionDetail || null, // Para traducir `action` en la interfaz
            score: point.marcadorMomento,
            xMeters: meters ? meters.x.toFixed(1) : '-',
            yMeters: meters ? meters.y.toFixed(1) : '-'
        };
    }

    /**
     * Perfil analítico de un jugador (Dashboard individual).
     *
     * KPIs:
     *  - plusMinus:  puntos − errores.
     *  - efficiency: (puntos − errores) / acciones × 100.
     *  - clutch:     puntos ganados con el marcador ajustado (diferencia ≤ 2).
     *  - zones:      % de puntos en la mitad izquierda (x < 50 %) / derecha.
     *  - bestMinute: minuto oficial con más puntos.
     *
     * @param {Array} points  Registros ya filtrados por línea de tiempo y set.
     * @param {string} playerId 'A1'…'B2'
     */
    function computePlayerProfile(points, playerId) {
        const team = playerId.charAt(0);
        const skills = emptySkillCounts();
        const perMinute = {};
        const heatPoints = [];
        const log = [];
        let pts = 0;
        let errs = 0;
        let clutch = 0;
        let left = 0;
        let right = 0;

        points.forEach((p) => {
            const timeout = isTimeout(p);
            // Sólo sus acciones y los tiempos muertos de su equipo
            if (timeout ? p.equipo !== team : p.jugadorId !== playerId) return;
            log.push(toLogRow(p));
            if (timeout) return;

            if (p.tipoAccion !== ACTION.POINT) {
                errs++;
                return;
            }

            pts++;
            const skill = p.actionDetail || DEFAULT_SKILL;
            if (skill in skills) skills[skill]++;

            const [scoreA, scoreB] = String(p.marcadorMomento || '0-0').split('-').map(Number);
            if (Math.abs(scoreA - scoreB) <= 2) clutch++;

            const minute = toMatchMinute(p.matchSecond);
            perMinute[minute] = (perMinute[minute] || 0) + 1;

            if (p.coordenadas.x < 50) left++;
            else right++;
            heatPoints.push(p.coordenadas);
        });

        const actions = pts + errs;
        const zoneTotal = left + right;
        const bestMinuteEntry = Object.entries(perMinute).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];

        return {
            playerId,
            team,
            pts,
            errs,
            plusMinus: pts - errs,
            efficiency: actions ? ((pts - errs) / actions) * 100 : 0,
            clutch,
            zones: {
                left,
                right,
                pctLeft: zoneTotal ? (left / zoneTotal) * 100 : 0,
                pctRight: zoneTotal ? (right / zoneTotal) * 100 : 0
            },
            bestMinute: bestMinuteEntry ? { minute: Number(bestMinuteEntry[0]), count: bestMinuteEntry[1] } : null,
            skills,
            heatPoints,
            log
        };
    }

    // =====================================================================
    // INDICADORES PROFESIONALES: side-out, break point y recepción
    // =====================================================================

    /** Porcentaje seguro: `null` cuando no hay muestra (para mostrar "—"). */
    const percent = (part, total) => (total ? (part / total) * 100 : null);

    /**
     * Garantiza que cada rally sepa qué equipo sacó (`servingTeam`).
     *
     * Los puntos nuevos ya lo traen grabado. Para partidos antiguos se
     * reconstruye repitiendo la secuencia: el primer rally de cada set lo saca
     * quien corresponde por alternancia y los siguientes, quien ganó el rally
     * anterior. Así el historial previo también tiene side-out y break point.
     *
     * Debe llamarse con la bitácora COMPLETA (antes de filtrar), porque la
     * reconstrucción necesita la secuencia entera.
     *
     * @param {Array} points
     * @param {'A'|'B'} [firstServer='A'] Quién sacó primero en el set 1.
     * @returns {Array} Misma lista; los registros sin `servingTeam` se copian completados.
     */
    function withServingTeam(points, firstServer = 'A') {
        const lastWinnerBySet = {};
        return (points || []).map((p) => {
            if (isTimeout(p)) return p;
            const set = p.setNumber || 1;
            const servingTeam = p.servingTeam || lastWinnerBySet[set] || getSetFirstServer(set - 1, firstServer);
            lastWinnerBySet[set] = getPointWinner(p);
            return p.servingTeam ? p : { ...p, servingTeam };
        });
    }

    /** Acumulador vacío de recepciones. `grades[g]` = nº de recepciones de calidad g. */
    const emptyReception = () => ({ count: 0, sum: 0, grades: [0, 0, 0, 0], sideOutWon: 0 });

    /** Convierte un acumulador de recepciones en métricas listas para mostrar. */
    function summarizeReception(acc) {
        const positive = acc.grades.slice(POSITIVE_RECEPTION_MIN).reduce((a, b) => a + b, 0);
        return {
            count: acc.count,
            grades: acc.grades,
            average: acc.count ? acc.sum / acc.count : null,      // Media en escala 0-3
            positivePct: percent(positive, acc.count),            // % de recepciones 2-3
            perfectPct: percent(acc.grades[3], acc.count),        // % de recepciones 3
            sideOutPct: percent(acc.sideOutWon, acc.count)        // % de rallies ganados tras recibir
        };
    }

    /**
     * Indicadores profesionales de ambos equipos y de cada receptor.
     *
     *  - Side-out %:    rallies ganados RECIBIENDO / rallies en que el equipo recibió.
     *  - Break point %: rallies ganados SACANDO / rallies en que el equipo sacó.
     *  - Aces / errores de saque: acciones "Saque" del equipo que sacaba.
     *  - Recepción: media 0-3, % positivas (2-3), % perfectas (3) y
     *    side-out según la calidad con la que se recibió.
     *
     * @param {Array} points Registros con `servingTeam` (ver `withServingTeam`).
     */
    function computeProIndicators(points) {
        const newTeam = () => ({ served: 0, breakWon: 0, received: 0, sideOutWon: 0, aces: 0, serveErrors: 0, reception: emptyReception() });
        const teams = { A: newTeam(), B: newTeam() };
        const players = Object.fromEntries(PLAYER_IDS.map((id) => [id, emptyReception()]));
        // byGrade.A[3] = { rallies, won }: recepciones de calidad 3 del equipo A y cuántas acabaron en punto
        const byGrade = {
            A: [0, 1, 2, 3].map(() => ({ rallies: 0, won: 0 })),
            B: [0, 1, 2, 3].map(() => ({ rallies: 0, won: 0 }))
        };

        points.forEach((p) => {
            if (isTimeout(p) || !p.servingTeam) return;
            const server = p.servingTeam;
            const receiver = opponentOf(server);
            const winner = getPointWinner(p);

            teams[server].served++;
            if (winner === server) teams[server].breakWon++;
            teams[receiver].received++;
            if (winner === receiver) teams[receiver].sideOutWon++;

            if (p.actionDetail === 'Saque' && p.equipo === server) {
                if (p.tipoAccion === ACTION.POINT) teams[server].aces++;
                else if (p.tipoAccion === ACTION.ERROR) teams[server].serveErrors++;
            }

            const reception = p.reception;
            if (!reception || !players[reception.playerId] || !(reception.grade in byGrade.A)) return;
            const team = reception.playerId.charAt(0);
            const won = winner === team;
            [teams[team].reception, players[reception.playerId]].forEach((acc) => {
                acc.count++;
                acc.sum += reception.grade;
                acc.grades[reception.grade]++;
                if (won) acc.sideOutWon++;
            });
            byGrade[team][reception.grade].rallies++;
            if (won) byGrade[team][reception.grade].won++;
        });

        const summarizeTeam = (t) => ({
            served: t.served,
            received: t.received,
            breakWon: t.breakWon,
            sideOutWon: t.sideOutWon,
            breakPct: percent(t.breakWon, t.served),
            sideOutPct: percent(t.sideOutWon, t.received),
            aces: t.aces,
            serveErrors: t.serveErrors,
            reception: summarizeReception(t.reception)
        });

        return {
            teams: { A: summarizeTeam(teams.A), B: summarizeTeam(teams.B) },
            players: Object.fromEntries(Object.entries(players).map(([id, acc]) => [id, summarizeReception(acc)])),
            byGrade: {
                A: byGrade.A.map((g) => ({ ...g, sideOutPct: percent(g.won, g.rallies) })),
                B: byGrade.B.map((g) => ({ ...g, sideOutPct: percent(g.won, g.rallies) }))
            },
            hasReceptionData: teams.A.reception.count + teams.B.reception.count > 0
        };
    }

    VP.statsEngine = Object.freeze({
        withServingTeam,
        computeProIndicators,
        createDefaultFilters,
        selectPoints,
        computeScore,
        computeSpanSeconds,
        computePlayerTotals,
        computeAwards,
        describeAction,
        hasRealCoords,
        toLogRow,
        computePlayerProfile
    });

    if (typeof module !== 'undefined' && module.exports) module.exports = VP.statsEngine;
})(typeof window !== 'undefined' ? window : globalThis);
