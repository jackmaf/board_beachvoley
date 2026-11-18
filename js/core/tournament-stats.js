/**
 * @file tournament-stats.js
 * @description Estadísticas a nivel de TORNEO (funciones puras, testeadas).
 *
 * Dos fuentes de datos según el formato:
 *  - Queen & King of the Court: el estado de la pista (`tournament.kotc`).
 *    Su historial de instantáneas permite reconstruir cada rally: quién
 *    estaba en el trono, quién retaba y quién ganó.
 *  - Round Robin / Eliminación directa: los partidos ARCHIVADOS en el
 *    historial (`voley-history`) que llevan `tournamentId`. Se agregan por
 *    dupla y por jugador (los resultados cargados a mano no tienen detalle
 *    de puntos: sólo cuentan para la clasificación).
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});

    /** Porcentaje seguro: `null` si no hay muestra (la interfaz muestra "—"). */
    const percent = (part, total) => (total ? (part / total) * 100 : null);

    /** Mínimo de rallies para competir en los premios de porcentaje (evita 1/1 = 100 %). */
    const MIN_SAMPLE = 3;

    // =====================================================================
    // QUEEN & KING OF THE COURT
    // =====================================================================

    /**
     * Reconstruye los rallies a partir del historial de instantáneas.
     * La instantánea de la entrada i es el estado ANTES de la jugada i, así
     * que el estado DESPUÉS es la instantánea de la entrada i+1 (o el estado
     * actual si es la última).
     * @returns {Array<{kingId:string, challengerId:string, winner:'throne'|'challenger', pointsAfter:Object}>}
     */
    function replayKotcRallies(state) {
        const { history } = state;
        const after = (i) => (i + 1 < history.length ? history[i + 1].snapshot : state);
        const rallies = [];
        history.forEach((entry, i) => {
            if (entry.type !== 'rally') return;
            const before = entry.snapshot;
            const next = after(i);
            rallies.push({
                kingId: before.throne,
                challengerId: before.queue[0],
                winner: next.throne === before.throne ? 'throne' : 'challenger',
                pointsAfter: { ...next.points }
            });
        });
        return rallies;
    }

    /**
     * Analíticas de una pista Queen & King.
     *  - holdPct:      % de rallies ganados defendiendo el trono.
     *  - challengePct: % de retos ganados (subidas al trono).
     *  - bestStreak:   mayor racha de puntos seguidos desde el trono.
     *  - timeline:     puntos de cada dupla tras cada rally (para la gráfica).
     *
     * @param {Object} state `tournament.kotc`
     */
    function computeKotcAnalytics(state) {
        const rallies = replayKotcRallies(state);
        const base = () => ({ holdRallies: 0, holdWins: 0, challenges: 0, challengeWins: 0, bestStreak: 0 });
        const acc = Object.fromEntries(state.teams.map((t) => [t.id, base()]));
        let streakTeam = null;
        let streak = 0;

        rallies.forEach(({ kingId, challengerId, winner }) => {
            acc[kingId].holdRallies++;
            acc[challengerId].challenges++;
            if (winner === 'throne') {
                acc[kingId].holdWins++;
                streak = streakTeam === kingId ? streak + 1 : 1;
                streakTeam = kingId;
                acc[kingId].bestStreak = Math.max(acc[kingId].bestStreak, streak);
            } else {
                acc[challengerId].challengeWins++;
                streakTeam = null;
                streak = 0;
            }
        });

        const rows = VP.kotcEngine.computeStandings(state).map((row) => {
            const a = acc[row.id];
            return {
                ...row,
                ...a,
                holdPct: percent(a.holdWins, a.holdRallies),
                challengePct: percent(a.challengeWins, a.challenges)
            };
        });

        // Serie temporal: punto 0 (inicio) + puntos tras cada rally
        const start = state.history.length ? state.history[0].snapshot.points : state.points;
        const timeline = {
            labels: [0, ...rallies.map((_, i) => i + 1)],
            series: state.teams.map((team) => ({
                id: team.id,
                name: team.name,
                values: [start[team.id] || 0, ...rallies.map((r) => r.pointsAfter[team.id] || 0)]
            }))
        };

        const pick = (score, minKey) => {
            const eligible = rows.filter((r) => (minKey ? r[minKey] >= MIN_SAMPLE : true) && score(r) !== null && score(r) > 0);
            return eligible.sort((x, y) => score(y) - score(x))[0] || null;
        };
        const highlights = [
            { key: 'thrones', emoji: '👑', title: 'Más tronos conquistados', row: pick((r) => r.thrones), value: (r) => `${r.thrones} tronos` },
            { key: 'streak', emoji: '🔥', title: 'Mejor racha en el trono', row: pick((r) => r.bestStreak), value: (r) => `${r.bestStreak} pts seguidos` },
            { key: 'hold', emoji: '🛡️', title: 'Mejor defensa del trono', row: pick((r) => r.holdPct, 'holdRallies'), value: (r) => `${Math.round(r.holdPct)}% (${r.holdWins}/${r.holdRallies})` },
            { key: 'challenge', emoji: '⚔️', title: 'Mejor retadora', row: pick((r) => r.challengePct, 'challenges'), value: (r) => `${Math.round(r.challengePct)}% (${r.challengeWins}/${r.challenges})` }
        ]
            .filter((h) => h.row)
            .map((h) => ({ ...h, winner: h.row.name, value: h.value(h.row) }));

        return {
            rows,
            timeline,
            highlights,
            rallies: rallies.length,
            // El historial guarda las últimas 300 jugadas: si hubo más, las analíticas son parciales
            partial: rallies.length < state.rallies
        };
    }

    // =====================================================================
    // FORMATOS CON PARTIDOS (Round Robin / Eliminación directa)
    // =====================================================================

    /**
     * Partidos archivados que pertenecen al torneo, con su índice en el historial
     * (lo usa la interfaz para abrir el análisis de ese partido).
     */
    function getTournamentMatches(tournament, history) {
        return (history || [])
            .map((match, index) => ({ match, index }))
            .filter(({ match }) => match && match.tournamentId === tournament.id && match.config);
    }

    /**
     * Agrega por dupla y por jugador todos los partidos archivados del torneo.
     * Dupla: partidos con datos, puntos a favor/en contra, side-out y break point.
     * Jugador: puntos y errores (sólo si el partido se registró en Scout).
     *
     * @param {Object} tournament
     * @param {Array} history Partidos finalizados (storage.getHistory()).
     */
    function computeMatchStats(tournament, history) {
        const { statsEngine, rules } = VP;
        const matches = getTournamentMatches(tournament, history);
        const teams = new Map();
        const players = new Map();

        const teamRow = (name) => {
            if (!teams.has(name)) {
                teams.set(name, { name, played: 0, pointsFor: 0, pointsAgainst: 0, setsFor: 0, setsAgainst: 0, received: 0, sideOutWon: 0, served: 0, breakWon: 0 });
            }
            return teams.get(name);
        };

        const summaries = matches.map(({ match, index }) => {
            const { config } = match;
            const points = statsEngine.withServingTeam(match.points || [], config.firstServer);
            const score = statsEngine.computeScore(points);
            const sets = rules.countSetsWon(match.sets || [], config);
            const pro = statsEngine.computeProIndicators(points);

            [['A', config.teamA, 'B'], ['B', config.teamB, 'A']].forEach(([side, name, other]) => {
                const row = teamRow(name);
                row.played++;
                row.pointsFor += score[side];
                row.pointsAgainst += score[other];
                row.setsFor += sets[side];
                row.setsAgainst += sets[other];
                row.received += pro.teams[side].received;
                row.sideOutWon += pro.teams[side].sideOutWon;
                row.served += pro.teams[side].served;
                row.breakWon += pro.teams[side].breakWon;
            });

            // Jugadores: sólo los partidos de Scout tienen acciones por jugador
            const totals = statsEngine.computePlayerTotals(points, config);
            Object.values(totals).forEach((p) => {
                if (!p.pts && !p.errs) return;
                const key = `${p.name}|${p.team === 'A' ? config.teamA : config.teamB}`;
                if (!players.has(key)) players.set(key, { name: p.name, team: p.team === 'A' ? config.teamA : config.teamB, pts: 0, errs: 0, matches: 0 });
                const row = players.get(key);
                row.pts += p.pts;
                row.errs += p.errs;
                row.matches++;
            });

            return {
                index,
                teamA: config.teamA,
                teamB: config.teamB,
                sets: `${sets.A}-${sets.B}`,
                points: `${score.A}-${score.B}`,
                finishedAt: match.finishedAt || null,
                rallies: points.filter((p) => p.tipoAccion !== 'timeout').length
            };
        });

        const teamRows = [...teams.values()]
            .map((t) => ({ ...t, sideOutPct: percent(t.sideOutWon, t.received), breakPct: percent(t.breakWon, t.served) }))
            .sort((a, b) => b.setsFor - b.setsAgainst - (a.setsFor - a.setsAgainst) || b.pointsFor - a.pointsFor);

        const playerRows = [...players.values()]
            .map((p) => ({ ...p, efficiency: percent(p.pts - p.errs, p.pts + p.errs) }))
            .sort((a, b) => b.pts - a.pts || a.errs - b.errs);

        return { matches: summaries, teams: teamRows, players: playerRows, hasScoutData: playerRows.length > 0 };
    }

    VP.tournamentStats = Object.freeze({ replayKotcRallies, computeKotcAnalytics, getTournamentMatches, computeMatchStats });

    if (typeof module !== 'undefined' && module.exports) module.exports = VP.tournamentStats;
})(typeof window !== 'undefined' ? window : globalThis);
