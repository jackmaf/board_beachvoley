/**
 * @file prize-engine.js
 * @description Motor PURO de los premios de un torneo: inscripciones, pagos
 * por jugador, bolsa, administración y reparto por puestos.
 *
 * Reglas:
 *  - Cada JUGADOR paga `feePerPlayer` (la dupla paga el doble).
 *  - La bolsa se calcula sobre lo PAGADO de verdad, nunca sobre lo esperado:
 *    así no se promete un premio con dinero que aún no ha entrado.
 *  - `poolPercent` de lo recaudado va a premios; el resto es administración.
 *  - La bolsa se reparte por puestos según `distribution` (suma 100 %).
 *  - Montos exactos en pesos: sin redondear a miles. Para que no se "pierda"
 *    ningún peso, los repartos usan el método del mayor resto (la suma de
 *    las partes es SIEMPRE igual al total).
 *  - Puestos compartidos: en eliminación directa no hay partido por el 3.º,
 *    así que los dos perdedores de semifinal comparten los puestos 3.º y 4.º
 *    (y los de cuartos, del 5.º al 8.º). Su premio se suma y se divide.
 *
 * Forma de los datos (se guarda en `tournament.prize`):
 * {
 *   enabled: true,
 *   feePerPlayer: 5000,
 *   poolPercent: 100,
 *   distribution: [60, 30, 10],
 *   entries: [{ name, p1, p2, paid: { p1: true, p2: false } }]
 * }
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { TOURNAMENT_FORMAT, MATCH_STATUS, PRIZE_DEFAULTS, MAX_PRIZE_PLACES } = VP.constants;
    const engine = VP.tournamentEngine;

    /** Los dos jugadores de una dupla, en el orden en que se guardan. */
    const PLAYER_KEYS = Object.freeze(['p1', 'p2']);

    // =====================================================================
    // CONFIGURACIÓN
    // =====================================================================

    /**
     * Valida los ajustes del formulario de premios.
     * @param {{feePerPlayer:number, poolPercent:number, distribution:number[]}} settings
     * @returns {{ok:true} | {ok:false, code:string, params?:Object}} `code` es la
     *   clave de traducción del error (`errors.prize.<code>`).
     */
    function validateSettings({ feePerPlayer, poolPercent, distribution }) {
        if (!Number.isFinite(feePerPlayer) || feePerPlayer <= 0) return { ok: false, code: 'fee' };
        if (!Number.isFinite(poolPercent) || poolPercent < 0 || poolPercent > 100) return { ok: false, code: 'pool' };
        if (!Array.isArray(distribution) || distribution.length === 0) return { ok: false, code: 'noPlaces' };
        if (distribution.length > MAX_PRIZE_PLACES) return { ok: false, code: 'tooManyPlaces', params: { max: MAX_PRIZE_PLACES } };
        if (distribution.some((pct) => !Number.isFinite(pct) || pct <= 0)) return { ok: false, code: 'placePercent' };
        const sum = distribution.reduce((total, pct) => total + pct, 0);
        // Tolerancia mínima por si se usan decimales (33,3 + 33,3 + 33,4)
        if (Math.abs(sum - 100) > 1e-9) return { ok: false, code: 'sum', params: { sum } };
        return { ok: true };
    }

    /**
     * Jugadores de cada dupla del torneo. Los torneos sólo guardan el NOMBRE
     * de la dupla en `teams`; los jugadores viven en los partidos.
     * @returns {Array<{name:string, p1:string, p2:string}>}
     */
    function readTeams(tournament) {
        return (tournament.teams || []).map((name) => {
            const team = { name, p1: '', p2: '' };
            for (const match of tournament.matches || []) {
                const slot = match.teamA === name ? 'teamA' : match.teamB === name ? 'teamB' : null;
                if (!slot) continue;
                const players = engine.getSlotTeam(match, slot);
                if (players.p1 || players.p2) return { name, p1: players.p1, p2: players.p2 };
            }
            return team;
        });
    }

    /**
     * Activa (o reconfigura) los premios de un torneo. Conserva los pagos ya
     * marcados: sirve tanto al crear el torneo como al editar los ajustes.
     *
     * @param {Object} tournament Se modifica en el sitio.
     * @param {{feePerPlayer:number, poolPercent:number, distribution:number[]}} settings
     * @param {Object<string, {p1:boolean, p2:boolean}>} [payments] Pagos iniciales por nombre de dupla.
     * @returns {Object} `tournament.prize`
     */
    function enablePrize(tournament, settings, payments = {}) {
        const previous = tournament.prize;
        tournament.prize = {
            enabled: true,
            feePerPlayer: Number(settings.feePerPlayer),
            poolPercent: Number(settings.poolPercent),
            distribution: settings.distribution.map(Number),
            entries: previous?.entries || []
        };
        syncEntries(tournament);
        Object.entries(payments).forEach(([name, paid]) => {
            PLAYER_KEYS.forEach((key) => setPayment(tournament, name, key, Boolean(paid?.[key])));
        });
        return tournament.prize;
    }

    /** Desactiva los premios sin borrar los pagos (se pueden volver a activar). */
    function disablePrize(tournament) {
        if (tournament.prize) tournament.prize.enabled = false;
    }

    /** ¿El torneo tiene los premios activos? */
    const isEnabled = (tournament) => Boolean(tournament?.prize?.enabled);

    /**
     * Alinea la lista de pagos con las duplas del torneo: añade las que falten
     * (sin pagar) y actualiza los nombres de los jugadores. Los pagos marcados
     * se conservan. Devuelve `true` si cambió algo.
     */
    function syncEntries(tournament) {
        const prize = tournament.prize;
        if (!prize) return false;
        const previous = new Map((prize.entries || []).map((entry) => [entry.name, entry]));
        const entries = readTeams(tournament).map((team) => {
            const old = previous.get(team.name);
            return {
                name: team.name,
                p1: team.p1 || old?.p1 || '',
                p2: team.p2 || old?.p2 || '',
                paid: { p1: Boolean(old?.paid?.p1), p2: Boolean(old?.paid?.p2) }
            };
        });
        const changed = JSON.stringify(entries) !== JSON.stringify(prize.entries || []);
        prize.entries = entries;
        return changed;
    }

    /**
     * Marca o desmarca el pago de un jugador.
     * @param {Object} tournament
     * @param {string} teamName
     * @param {'p1'|'p2'} playerKey
     * @param {boolean} paid
     * @returns {boolean} `false` si la dupla no existe.
     */
    function setPayment(tournament, teamName, playerKey, paid) {
        const entry = tournament.prize?.entries?.find((e) => e.name === teamName);
        if (!entry || !PLAYER_KEYS.includes(playerKey)) return false;
        entry.paid = { ...entry.paid, [playerKey]: Boolean(paid) };
        return true;
    }

    // =====================================================================
    // DINERO
    // =====================================================================

    /**
     * Reparte un total entero según unos pesos (porcentajes) sin perder ni un
     * peso: método del mayor resto. Ej.: 100 entre [1,1,1] → [34, 33, 33].
     * @param {number} total Pesos enteros.
     * @param {number[]} weights
     * @returns {number[]}
     */
    function splitExact(total, weights) {
        const weightSum = weights.reduce((sum, w) => sum + w, 0);
        if (!weightSum || total <= 0) return weights.map(() => 0);
        const raw = weights.map((w) => (total * w) / weightSum);
        const parts = raw.map(Math.floor);
        let remainder = total - parts.reduce((sum, p) => sum + p, 0);
        // Los pesos sobrantes van a quien tenga mayor parte decimal (empate → el primero)
        const order = raw
            .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
            .sort((x, y) => y.fraction - x.fraction || x.index - y.index);
        for (let i = 0; remainder > 0; i = (i + 1) % order.length, remainder--) parts[order[i].index]++;
        return parts;
    }

    // =====================================================================
    // PUESTOS FINALES
    // =====================================================================

    /**
     * @typedef {Object} RankGroup
     * @property {number}   rank     Primer puesto que ocupa el grupo (1, 2, 3, 5…).
     * @property {number}   size     Cuántos puestos ocupa (1, o 2 para los semifinalistas…).
     * @property {string[]} teams    Duplas ya conocidas en ese puesto.
     * @property {boolean}  decided  ¿Ya se jugaron los partidos que lo definen?
     */

    /**
     * Eliminación directa: campeón, finalista y luego los perdedores de cada
     * ronda, de la última a la primera. Los pases por BYE no ocupan puesto.
     * @returns {RankGroup[]}
     */
    function knockoutGroups(tournament) {
        const rounds = engine.getKnockoutRounds(tournament);
        if (!rounds.length) return [];
        const decided = (match) => match.status === MATCH_STATUS.FINISHED && Boolean(engine.getWinnerSlot(match));
        const loserOf = (match) => {
            const slot = engine.getWinnerSlot(match);
            const loser = match[slot === 'teamA' ? 'teamB' : 'teamA'];
            return engine.isRealTeam(loser) ? loser : null;
        };

        const final = rounds[rounds.length - 1][0];
        const finalDone = Boolean(final) && decided(final);
        const winnerSlot = finalDone ? engine.getWinnerSlot(final) : null;
        const groups = [
            { rank: 1, size: 1, teams: finalDone ? [final[winnerSlot]] : [], decided: finalDone },
            { rank: 2, size: 1, teams: finalDone && loserOf(final) ? [loserOf(final)] : [], decided: finalDone }
        ];

        let nextRank = 3;
        for (let r = rounds.length - 2; r >= 0; r--) {
            // Los pases por BYE no tienen perdedor: no reservan puesto
            const played = rounds[r].filter((m) => !m.walkover);
            if (!played.length) continue;
            groups.push({
                rank: nextRank,
                size: played.length,
                teams: played.filter(decided).map(loserOf).filter(Boolean),
                decided: played.every(decided)
            });
            nextRank += played.length;
        }
        return groups;
    }

    /**
     * Round Robin: un puesto por dupla según la clasificación. Mientras falten
     * partidos, el orden es provisional (`decided: false`).
     * @returns {RankGroup[]}
     */
    function roundRobinGroups(tournament) {
        const finished = Boolean(engine.getChampion(tournament));
        const standings = engine.computeStandings(tournament);
        const anyPlayed = standings.some((row) => row.played > 0);
        return standings.map((row, index) => ({
            rank: index + 1,
            size: 1,
            // Sin partidos jugados la tabla sólo está ordenada por nombre: no se muestra a nadie
            teams: anyPlayed ? [row.team] : [],
            decided: finished
        }));
    }

    /**
     * Puestos del torneo agrupados (empates incluidos).
     * Los formatos sin puestos definidos todavía devuelven `[]`.
     * @returns {RankGroup[]}
     */
    function getRankGroups(tournament) {
        if (tournament.format === TOURNAMENT_FORMAT.KNOCKOUT) return knockoutGroups(tournament);
        if (tournament.format === TOURNAMENT_FORMAT.ROUND_ROBIN) return roundRobinGroups(tournament);
        return [];
    }

    // =====================================================================
    // RESUMEN
    // =====================================================================

    /**
     * @typedef {Object} PrizeAward Premio de un puesto (o de un grupo de puestos compartidos).
     * @property {number}   rank       Puesto (1, 2, 3…). Si es compartido, el primero.
     * @property {number}   rankTo     Último puesto que cubre (igual a `rank` si no se comparte).
     * @property {number}   percent    % de la bolsa (suma de los puestos que cubre).
     * @property {number}   amount     Pesos para el puesto completo.
     * @property {number}   slots      Duplas que se lo reparten (1 o más).
     * @property {number}   perTeam    Pesos por dupla (puede llevar decimales si el reparto es impar).
     * @property {number}   perPlayer  Pesos por jugador.
     * @property {string[]} teams      Duplas conocidas.
     * @property {boolean}  decided
     * @property {boolean}  shared
     */

    /**
     * Calcula todo lo que muestra la pestaña «Premios».
     * @param {Object} tournament
     * @returns {Object|null} `null` si el torneo no tiene premios activos.
     */
    function summarize(tournament) {
        const prize = tournament?.prize;
        if (!prize?.enabled) return null;

        const fee = Number(prize.feePerPlayer) || 0;
        const poolPercent = Number(prize.poolPercent) || 0;
        const distribution = prize.distribution?.length ? prize.distribution : [...PRIZE_DEFAULTS.distribution];
        const entries = prize.entries || [];

        const paidPlayers = entries.reduce((sum, e) => sum + PLAYER_KEYS.filter((k) => e.paid?.[k]).length, 0);
        const paidTeams = entries.filter((e) => PLAYER_KEYS.every((k) => e.paid?.[k])).length;
        const partialTeams = entries.filter((e) => PLAYER_KEYS.some((k) => e.paid?.[k])).length - paidTeams;

        const totalPlayers = entries.length * PLAYER_KEYS.length;
        const expected = totalPlayers * fee;
        const collected = paidPlayers * fee;
        const [pool, admin] = splitExact(collected, [poolPercent, 100 - poolPercent]);
        const projectedPool = splitExact(expected, [poolPercent, 100 - poolPercent])[0];

        const placeAmounts = splitExact(pool, distribution);
        const awards = buildAwards(getRankGroups(tournament), distribution, placeAmounts);
        const assigned = awards.reduce((sum, a) => sum + a.amount, 0);

        return {
            feePerPlayer: fee,
            feePerTeam: fee * PLAYER_KEYS.length,
            poolPercent,
            adminPercent: 100 - poolPercent,
            distribution: [...distribution],
            teams: entries.length,
            totalPlayers,
            paidPlayers,
            paidTeams,
            partialTeams,
            unpaidTeams: entries.length - paidTeams - partialTeams,
            expected,
            collected,
            pending: expected - collected,
            pool,
            admin,
            projectedPool,
            awards,
            // Puestos configurados que el torneo no llega a tener (p. ej. 4 premios con 3 duplas)
            unassigned: pool - assigned,
            entries: entries.map((e) => ({
                ...e,
                paidCount: PLAYER_KEYS.filter((k) => e.paid?.[k]).length,
                owed: PLAYER_KEYS.filter((k) => !e.paid?.[k]).length * fee
            }))
        };
    }

    /**
     * Une los grupos de puestos con el reparto: cada grupo cobra la suma de los
     * puestos que cubre y la divide entre sus duplas.
     * @returns {PrizeAward[]}
     */
    function buildAwards(groups, distribution, placeAmounts) {
        const awards = [];
        const covered = new Set();

        groups.forEach((group) => {
            const places = [];
            for (let place = group.rank; place < group.rank + group.size; place++) {
                if (place <= distribution.length) places.push(place);
            }
            if (!places.length) return;
            places.forEach((p) => covered.add(p));

            const amount = places.reduce((sum, p) => sum + placeAmounts[p - 1], 0);
            const percent = places.reduce((sum, p) => sum + distribution[p - 1], 0);
            const slots = group.size;
            awards.push({
                rank: group.rank,
                rankTo: group.rank + group.size - 1,
                percent,
                amount,
                slots,
                perTeam: amount / slots,
                perPlayer: amount / slots / PLAYER_KEYS.length,
                teams: group.teams,
                decided: group.decided,
                shared: slots > 1
            });
        });

        // Puestos sin grupo todavía (p. ej. un torneo sin partidos generados)
        distribution.forEach((percent, index) => {
            const place = index + 1;
            if (covered.has(place) || groups.length) return;
            awards.push({
                rank: place, rankTo: place, percent, amount: placeAmounts[index], slots: 1,
                perTeam: placeAmounts[index], perPlayer: placeAmounts[index] / PLAYER_KEYS.length,
                teams: [], decided: false, shared: false
            });
        });
        return awards.sort((a, b) => a.rank - b.rank);
    }

    /**
     * Proyección para el formulario de creación: cuánto habría si TODAS las
     * duplas pagaran. No necesita un torneo creado.
     * @param {number} teamCount
     * @param {{feePerPlayer:number, poolPercent:number, distribution:number[]}} settings
     */
    function project(teamCount, { feePerPlayer, poolPercent, distribution }) {
        const total = teamCount * PLAYER_KEYS.length * (Number(feePerPlayer) || 0);
        const [pool, admin] = splitExact(total, [poolPercent, 100 - poolPercent]);
        return { total, pool, admin, places: splitExact(pool, distribution) };
    }

    VP.prizeEngine = Object.freeze({
        PLAYER_KEYS,
        validateSettings,
        readTeams,
        enablePrize,
        disablePrize,
        isEnabled,
        syncEntries,
        setPayment,
        splitExact,
        getRankGroups,
        summarize,
        project
    });

    if (typeof module !== 'undefined' && module.exports) module.exports = VP.prizeEngine;
})(typeof window !== 'undefined' ? window : globalThis);
