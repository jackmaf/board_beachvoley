/**
 * @file tournament-engine.js
 * @description Lógica pura de torneos: generación de partidos (Round Robin y
 * Eliminación Directa), registro de resultados, avance de ganadores en el
 * cuadro, pases automáticos por BYE, tabla de clasificación y campeón.
 *
 * Todas las funciones trabajan sobre objetos planos y MUTAN el torneo que
 * reciben (salvo `createTournament`, que lo crea). Quien llama es responsable
 * de persistirlo (ver `VP.storage.updateTournament`).
 *
 * Forma de un torneo guardado:
 * {
 *   id, name, category, gender, format, status, createdAt,
 *   config_sets: { maxSets, ptsNormal, ptsTiebreak },
 *   teams: ['Dupla 1', 'Dupla 2', …],
 *   matches: [TournamentMatch, …]
 * }
 *
 * Forma de un partido del torneo (TournamentMatch):
 * {
 *   id, round, teamA, teamB,               // round = 0 es la primera ronda
 *   teamA_p1, teamA_p2, teamB_p1, teamB_p2, // jugadores (opcionales)
 *   status: 'programado' | 'finalizado',
 *   score: '2 - 1',                        // sets ganados A - B
 *   winner: 'teamA' | 'teamB',             // presente cuando está finalizado
 *   walkover: true,                        // si se resolvió por BYE
 *   nextMatchId, nextMatchSlot             // sólo en eliminación directa
 * }
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { TOURNAMENT_FORMAT, MATCH_STATUS, SLOT, STANDING_POINTS } = VP.constants;
    const { createId } = VP.utils;
    const { normalizeRules } = VP.rules;

    /** ¿El nombre corresponde a una dupla real (no TBD ni BYE)? */
    function isRealTeam(name) {
        return Boolean(name) && name !== SLOT.TBD && name !== SLOT.BYE;
    }

    /** ¿Se puede jugar ya este partido? (dos duplas reales y aún no finalizado) */
    function isPlayable(match) {
        return match.status !== MATCH_STATUS.FINISHED && isRealTeam(match.teamA) && isRealTeam(match.teamB);
    }

    /** Crea un partido vacío con la forma estándar. */
    function createMatch(teamA, teamB, round = 0) {
        return {
            id: createId('m'),
            round,
            teamA,
            teamB,
            status: MATCH_STATUS.SCHEDULED,
            score: '0 - 0',
            nextMatchId: null,
            nextMatchSlot: null
        };
    }

    /** Copia los jugadores de una dupla a un hueco (`teamA` / `teamB`) del partido. */
    function assignTeam(match, slot, team) {
        match[slot] = team.name;
        if (team.p1) match[`${slot}_p1`] = team.p1;
        else delete match[`${slot}_p1`];
        if (team.p2) match[`${slot}_p2`] = team.p2;
        else delete match[`${slot}_p2`];
    }

    /** Lee los jugadores de un hueco del partido. */
    function getSlotTeam(match, slot) {
        return { name: match[slot], p1: match[`${slot}_p1`] || '', p2: match[`${slot}_p2`] || '' };
    }

    /**
     * Round Robin: todos contra todos → n·(n-1)/2 partidos.
     * @param {Array<{name:string,p1:string,p2:string}>} teams
     */
    function generateRoundRobin(teams) {
        const matches = [];
        for (let i = 0; i < teams.length; i++) {
            for (let j = i + 1; j < teams.length; j++) {
                const match = createMatch(teams[i].name, teams[j].name, 0);
                assignTeam(match, 'teamA', teams[i]);
                assignTeam(match, 'teamB', teams[j]);
                matches.push(match);
            }
        }
        return matches;
    }

    /**
     * Orden estándar de cabezas de serie en un cuadro de `size` plazas.
     * Para 8 → [1, 8, 4, 5, 2, 7, 3, 6]. Así los BYE (las "semillas" más altas)
     * siempre se emparejan con duplas reales y nunca hay un "BYE vs BYE".
     * @param {number} size Potencia de 2.
     * @returns {number[]} Semillas (1-based) en orden de aparición en el cuadro.
     */
    function bracketSeedOrder(size) {
        let order = [1, 2];
        while (order.length < size) {
            const nextSize = order.length * 2;
            order = order.flatMap((seed) => [seed, nextSize + 1 - seed]);
        }
        return order;
    }

    /**
     * Eliminación directa completa: genera TODAS las rondas hasta la final y
     * enlaza cada partido con el siguiente mediante `nextMatchId`/`nextMatchSlot`.
     *
     * El array resultante queda ordenado por ronda:
     *   [ ronda 0 (n/2 partidos) | ronda 1 (n/4) | … | final ]
     *
     * @param {Array<{name:string,p1:string,p2:string}>} teams
     */
    function generateKnockout(teams) {
        const size = Math.max(2, 2 ** Math.ceil(Math.log2(teams.length)));
        const seeds = bracketSeedOrder(size).map((seed) => teams[seed - 1] || { name: SLOT.BYE });

        // 1) Crear los partidos de cada ronda
        const rounds = [];
        for (let round = 0, count = size / 2; count >= 1; round++, count /= 2) {
            rounds.push(Array.from({ length: count }, () => createMatch(SLOT.TBD, SLOT.TBD, round)));
        }

        // 2) Colocar las duplas en la primera ronda
        rounds[0].forEach((match, i) => {
            assignTeam(match, 'teamA', seeds[i * 2]);
            assignTeam(match, 'teamB', seeds[i * 2 + 1]);
        });

        // 3) Enlazar cada partido con su "padre" de la ronda siguiente.
        //    Los partidos 0 y 1 alimentan al 0 de la siguiente ronda (huecos A y B), etc.
        for (let r = 0; r < rounds.length - 1; r++) {
            rounds[r].forEach((match, i) => {
                match.nextMatchId = rounds[r + 1][Math.floor(i / 2)].id;
                match.nextMatchSlot = i % 2 === 0 ? 'teamA' : 'teamB';
            });
        }

        return rounds.flat();
    }

    /**
     * Crea un torneo nuevo con sus partidos ya generados.
     * @param {Object} input
     * @param {string} input.name
     * @param {string} input.category
     * @param {string} input.gender
     * @param {string} input.format  Valor de `TOURNAMENT_FORMAT`.
     * @param {Object} input.rules   Reglas de los partidos.
     * @param {Array<{name:string,p1:string,p2:string}>} input.teams
     */
    function createTournament({ name, category, gender, format, rules, teams, kotc }) {
        const isKnockout = format === TOURNAMENT_FORMAT.KNOCKOUT;
        const isKingOfCourt = format === TOURNAMENT_FORMAT.KING_OF_COURT;
        const tournament = {
            id: createId('t'),
            createdAt: Date.now(),
            name,
            category,
            gender,
            format,
            config_sets: normalizeRules(rules),
            status: 'creado',
            teams: teams.map((t) => t.name),
            // Queen & King of the Court no tiene partidos: es una sola cancha con cola de duplas
            matches: isKingOfCourt ? [] : isKnockout ? generateKnockout(teams) : generateRoundRobin(teams)
        };
        if (isKnockout) resolveByes(tournament);
        if (isKingOfCourt) tournament.kotc = VP.kotcEngine.createState(teams, kotc);
        return tournament;
    }

    /** Busca un partido por id. */
    function findMatch(tournament, matchId) {
        return tournament.matches.find((m) => m.id === matchId) || null;
    }

    /** Interpreta un marcador "2 - 1" → {a:2, b:1}. Devuelve null si no es válido. */
    function parseScore(score) {
        const parts = String(score || '').split('-').map((p) => parseInt(p, 10));
        return parts.length === 2 && parts.every(Number.isFinite) ? { a: parts[0], b: parts[1] } : null;
    }

    /**
     * Hueco ganador de un partido finalizado.
     * Usa el campo `winner` y, para datos antiguos que no lo tienen, compara el marcador
     * NUMÉRICAMENTE (antes se comparaban strings y "10" < "9").
     * @returns {'teamA'|'teamB'|null}
     */
    function getWinnerSlot(match) {
        if (match.status !== MATCH_STATUS.FINISHED) return null;
        if (match.winner) return match.winner;
        if (match.teamB === SLOT.BYE) return 'teamA';
        if (match.teamA === SLOT.BYE) return 'teamB';
        const parsed = parseScore(match.score);
        if (!parsed || parsed.a === parsed.b) return null;
        return parsed.a > parsed.b ? 'teamA' : 'teamB';
    }

    /** Coloca al ganador de `match` (con sus jugadores) en el partido siguiente. */
    function advanceWinner(tournament, match) {
        if (!match.nextMatchId) return; // Era la final
        const next = findMatch(tournament, match.nextMatchId);
        const winnerSlot = getWinnerSlot(match);
        if (!next || !winnerSlot) return;
        assignTeam(next, match.nextMatchSlot, getSlotTeam(match, winnerSlot));
    }

    /**
     * Resuelve automáticamente los partidos con BYE (pase directo).
     * Se repite hasta que no haya cambios porque un pase puede habilitar otro
     * en la ronda siguiente (datos antiguos podían tener "BYE vs BYE").
     * @returns {boolean} `true` si cambió algo.
     */
    function resolveByes(tournament) {
        if (tournament.format !== TOURNAMENT_FORMAT.KNOCKOUT) return false;
        let changed = false;
        let keepGoing = true;

        while (keepGoing) {
            keepGoing = false;
            for (const match of tournament.matches) {
                if (match.status === MATCH_STATUS.FINISHED) continue;
                const aBye = match.teamA === SLOT.BYE;
                const bBye = match.teamB === SLOT.BYE;
                if (!aBye && !bBye) continue;
                // Esperar si el otro hueco aún no tiene dupla definida
                if ((aBye && match.teamB === SLOT.TBD) || (bBye && match.teamA === SLOT.TBD)) continue;

                match.status = MATCH_STATUS.FINISHED;
                match.walkover = true;
                match.winner = aBye && !bBye ? 'teamB' : 'teamA'; // BYE vs BYE propaga un BYE
                match.score = aBye && bBye ? '0 - 0' : match.winner === 'teamA' ? '1 - 0' : '0 - 1';
                advanceWinner(tournament, match);
                changed = true;
                keepGoing = true;
            }
        }
        return changed;
    }

    /**
     * Registra el resultado de un partido (sets ganados por cada dupla) y, en
     * eliminación directa, hace avanzar al ganador.
     *
     * Si se corrige un resultado y cambia el ganador, se reemplaza al clasificado
     * en la ronda siguiente, salvo que ese partido ya se haya jugado (sería
     * inconsistente), en cuyo caso se devuelve un error.
     *
     * @returns {{ok:true} | {ok:false, error:string}}
     */
    function recordResult(tournament, matchId, setsA, setsB) {
        const match = findMatch(tournament, matchId);
        if (!match) return { ok: false, code: 'matchNotFound', error: 'No se encontró el partido.' };
        if (setsA === setsB) return { ok: false, code: 'matchTied', error: 'Un partido de voley playa no puede terminar empatado.' };

        const newWinner = setsA > setsB ? 'teamA' : 'teamB';
        const previousWinner = getWinnerSlot(match);

        if (previousWinner && previousWinner !== newWinner && match.nextMatchId) {
            const next = findMatch(tournament, match.nextMatchId);
            if (next && next.status === MATCH_STATUS.FINISHED && !next.walkover) {
                return { ok: false, code: 'nextMatchPlayed', error: 'No se puede cambiar el ganador: el siguiente partido ya se jugó.' };
            }
            if (next && next.walkover) {
                // Deshacer el pase automático para recalcularlo con el nuevo ganador
                next.status = MATCH_STATUS.SCHEDULED;
                delete next.walkover;
                delete next.winner;
                next.score = '0 - 0';
            }
        }

        match.status = MATCH_STATUS.FINISHED;
        match.score = `${setsA} - ${setsB}`;
        match.winner = newWinner;
        delete match.walkover;

        if (tournament.format === TOURNAMENT_FORMAT.KNOCKOUT) {
            advanceWinner(tournament, match);
            resolveByes(tournament);
        }
        return { ok: true };
    }

    /**
     * Cambia la dupla (y sus jugadores) de un hueco de un partido.
     * Nombre vacío → vuelve a "TBD".
     */
    function setMatchTeam(tournament, matchId, slot, team) {
        const match = findMatch(tournament, matchId);
        if (!match) return false;
        assignTeam(match, slot, { name: team.name || SLOT.TBD, p1: team.p1, p2: team.p2 });
        resolveByes(tournament);
        return true;
    }

    /**
     * Agrupa los partidos de eliminación directa por ronda.
     * Los torneos antiguos no guardaban `round`: se deduce por posición,
     * sabiendo que la primera ronda tiene (n + 1) / 2 partidos.
     * @returns {TournamentMatch[][]}
     */
    function getKnockoutRounds(tournament) {
        const { matches } = tournament;
        if (matches.every((m) => Number.isInteger(m.round))) {
            const rounds = [];
            matches.forEach((m) => (rounds[m.round] = rounds[m.round] || []).push(m));
            return rounds;
        }
        const rounds = [];
        let index = 0;
        for (let count = (matches.length + 1) / 2; count >= 1 && index < matches.length; count /= 2) {
            rounds.push(matches.slice(index, index + count));
            index += count;
        }
        return rounds;
    }

    /** Nombre de una ronda según cuántas quedan hasta la final. */
    function getRoundLabel(roundIndex, totalRounds) {
        const remaining = totalRounds - roundIndex;
        const labels = { 1: 'Final', 2: 'Semifinales', 3: 'Cuartos de final', 4: 'Octavos de final' };
        return labels[remaining] || `Ronda ${roundIndex + 1}`;
    }

    /**
     * Tabla de clasificación (Round Robin).
     * Orden: puntos de clasificación → diferencia de sets → sets a favor → nombre.
     * @returns {Array<{team:string, played:number, won:number, lost:number, setsFor:number, setsAgainst:number, points:number}>}
     */
    function computeStandings(tournament) {
        const table = new Map();
        const row = (team) => {
            if (!table.has(team)) {
                table.set(team, { team, played: 0, won: 0, lost: 0, setsFor: 0, setsAgainst: 0, points: 0 });
            }
            return table.get(team);
        };

        tournament.matches.forEach((match) => {
            if (!isRealTeam(match.teamA) || !isRealTeam(match.teamB)) return;
            const rowA = row(match.teamA);
            const rowB = row(match.teamB);
            const winnerSlot = getWinnerSlot(match);
            const score = parseScore(match.score);
            if (!winnerSlot || !score) return; // Aún no jugado

            const [winner, loser] = winnerSlot === 'teamA' ? [rowA, rowB] : [rowB, rowA];
            rowA.played++;
            rowB.played++;
            rowA.setsFor += score.a;
            rowA.setsAgainst += score.b;
            rowB.setsFor += score.b;
            rowB.setsAgainst += score.a;
            winner.won++;
            winner.points += STANDING_POINTS.win;
            loser.lost++;
            loser.points += STANDING_POINTS.loss;
        });

        return [...table.values()].sort(
            (x, y) =>
                y.points - x.points ||
                y.setsFor - y.setsAgainst - (x.setsFor - x.setsAgainst) ||
                y.setsFor - x.setsFor ||
                x.team.localeCompare(y.team)
        );
    }

    /**
     * Campeón del torneo, si ya está decidido.
     *  - Eliminación directa: ganador de la final.
     *  - Round Robin: líder de la tabla cuando todos los partidos están jugados.
     * @returns {string|null}
     */
    function getChampion(tournament) {
        if (tournament.kotc) {
            const winner = VP.kotcEngine.getTeam(tournament.kotc, tournament.kotc.winnerId);
            return winner ? winner.name : null;
        }
        if (!tournament.matches.length) return null;

        if (tournament.format === TOURNAMENT_FORMAT.KNOCKOUT) {
            const final = tournament.matches.find((m) => !m.nextMatchId);
            const slot = final && getWinnerSlot(final);
            return slot && isRealTeam(final[slot]) ? final[slot] : null;
        }

        const pending = tournament.matches.some(
            (m) => isRealTeam(m.teamA) && isRealTeam(m.teamB) && m.status !== MATCH_STATUS.FINISHED
        );
        if (pending) return null;
        const standings = computeStandings(tournament);
        return standings.length ? standings[0].team : null;
    }

    /** Progreso del torneo: partidos jugados (sin contar pases por BYE) / total. */
    function getProgress(tournament) {
        const real = tournament.matches.filter((m) => !m.walkover);
        const done = real.filter((m) => m.status === MATCH_STATUS.FINISHED).length;
        return { done, total: real.length };
    }

    VP.tournamentEngine = Object.freeze({
        isRealTeam,
        isPlayable,
        bracketSeedOrder,
        generateRoundRobin,
        generateKnockout,
        createTournament,
        findMatch,
        parseScore,
        getWinnerSlot,
        getSlotTeam,
        resolveByes,
        recordResult,
        setMatchTeam,
        getKnockoutRounds,
        getRoundLabel,
        computeStandings,
        getChampion,
        getProgress
    });

    if (typeof module !== 'undefined' && module.exports) module.exports = VP.tournamentEngine;
})(typeof window !== 'undefined' ? window : globalThis);
