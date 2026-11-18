/**
 * Tests del motor de torneos (js/core/tournament-engine.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { tournamentEngine: engine, constants } = require('./load-core');

const { SLOT, MATCH_STATUS, TOURNAMENT_FORMAT } = constants;
const teams = (n) => Array.from({ length: n }, (_, i) => ({ name: `D${i + 1}`, p1: `J${i + 1}a`, p2: `J${i + 1}b` }));
const create = (format, n) =>
    engine.createTournament({ name: 'Test', category: 'A', gender: 'X', format, rules: { maxSets: 3 }, teams: teams(n) });

test('Round Robin genera n·(n-1)/2 partidos con los jugadores asignados', () => {
    const t = create(TOURNAMENT_FORMAT.ROUND_ROBIN, 4);
    assert.equal(t.matches.length, 6);
    assert.equal(t.matches[0].teamA_p1, 'J1a');
});

test('orden de cabezas de serie estándar', () => {
    assert.deepEqual(engine.bracketSeedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

test('eliminación con 5 duplas: 7 partidos, sin BYE vs BYE y BYEs resueltos', () => {
    const t = create(TOURNAMENT_FORMAT.KNOCKOUT, 5);
    assert.equal(t.matches.length, 7);

    const firstRound = engine.getKnockoutRounds(t)[0];
    assert.ok(firstRound.every((m) => !(m.teamA === SLOT.BYE && m.teamB === SLOT.BYE)));

    // 3 partidos con BYE se resuelven solos y sus ganadores avanzan
    const walkovers = t.matches.filter((m) => m.walkover);
    assert.equal(walkovers.length, 3);
    const semis = engine.getKnockoutRounds(t)[1];
    const placed = semis.flatMap((m) => [m.teamA, m.teamB]).filter(engine.isRealTeam);
    assert.equal(placed.length, 3); // D1, D2 y D3 ya esperan en semifinales
});

test('registrar un resultado hace avanzar al ganador con sus jugadores', () => {
    const t = create(TOURNAMENT_FORMAT.KNOCKOUT, 4);
    const [m1, m2] = t.matches;
    assert.equal(engine.recordResult(t, m1.id, 2, 0).ok, true);
    assert.equal(engine.recordResult(t, m2.id, 1, 2).ok, true);

    const final = t.matches[2];
    assert.equal(final.teamA, m1.teamA);
    assert.equal(final.teamA_p1, m1.teamA_p1);
    assert.equal(final.teamB, m2.teamB);
    assert.equal(engine.isPlayable(final), true);

    engine.recordResult(t, final.id, 2, 1);
    assert.equal(engine.getChampion(t), m1.teamA);
});

test('no se puede cambiar el ganador si el siguiente partido ya se jugó', () => {
    const t = create(TOURNAMENT_FORMAT.KNOCKOUT, 4);
    const [m1, m2, final] = t.matches;
    engine.recordResult(t, m1.id, 2, 0);
    engine.recordResult(t, m2.id, 2, 0);
    engine.recordResult(t, final.id, 2, 0);
    assert.equal(engine.recordResult(t, m1.id, 0, 2).ok, false);
});

test('corregir un resultado antes de jugar la siguiente ronda reemplaza al clasificado', () => {
    const t = create(TOURNAMENT_FORMAT.KNOCKOUT, 4);
    const [m1, , final] = t.matches;
    engine.recordResult(t, m1.id, 2, 0);
    engine.recordResult(t, m1.id, 0, 2);
    assert.equal(final.teamA, m1.teamB);
});

test('un empate no es un resultado válido', () => {
    const t = create(TOURNAMENT_FORMAT.ROUND_ROBIN, 3);
    assert.equal(engine.recordResult(t, t.matches[0].id, 1, 1).ok, false);
});

test('torneos antiguos con BYE vs BYE se reparan con resolveByes', () => {
    // Forma de los datos de la versión anterior: sin `round` ni `winner`
    const legacy = {
        format: TOURNAMENT_FORMAT.KNOCKOUT,
        matches: [
            { id: 'a', teamA: 'D1', teamB: 'D2', status: 'programado', score: '0 - 0', nextMatchId: 'e', nextMatchSlot: 'teamA' },
            { id: 'b', teamA: 'D3', teamB: 'D4', status: 'programado', score: '0 - 0', nextMatchId: 'e', nextMatchSlot: 'teamB' },
            { id: 'c', teamA: 'D5', teamB: 'BYE', status: 'programado', score: '0 - 0', nextMatchId: 'f', nextMatchSlot: 'teamA' },
            { id: 'd', teamA: 'BYE', teamB: 'BYE', status: 'programado', score: '0 - 0', nextMatchId: 'f', nextMatchSlot: 'teamB' },
            { id: 'e', teamA: 'TBD', teamB: 'TBD', status: 'programado', score: '0 - 0', nextMatchId: 'g', nextMatchSlot: 'teamA' },
            { id: 'f', teamA: 'TBD', teamB: 'TBD', status: 'programado', score: '0 - 0', nextMatchId: 'g', nextMatchSlot: 'teamB' },
            { id: 'g', teamA: 'TBD', teamB: 'TBD', status: 'programado', score: '0 - 0', nextMatchId: null, nextMatchSlot: null }
        ]
    };
    assert.equal(engine.resolveByes(legacy), true);
    assert.equal(engine.findMatch(legacy, 'g').teamB, 'D5'); // D5 pasa directo a la final
    assert.equal(engine.getKnockoutRounds(legacy).map((r) => r.length).join(','), '4,2,1');
});

test('el ganador se calcula numéricamente (antes "10" < "9" como texto)', () => {
    assert.equal(engine.getWinnerSlot({ status: MATCH_STATUS.FINISHED, score: '10 - 9', teamA: 'X', teamB: 'Y' }), 'teamA');
});

test('clasificación Round Robin: 2 pts por victoria, 1 por derrota y desempate por sets', () => {
    const t = create(TOURNAMENT_FORMAT.ROUND_ROBIN, 3);
    const [ab, ac, bc] = t.matches; // D1-D2, D1-D3, D2-D3
    engine.recordResult(t, ab.id, 2, 0); // gana D1
    engine.recordResult(t, ac.id, 1, 2); // gana D3
    engine.recordResult(t, bc.id, 2, 0); // gana D2

    const table = engine.computeStandings(t);
    // Triple empate a 3 pts (1V + 1D) → decide la diferencia de sets: D1 +1, D2 0, D3 -1
    assert.deepEqual(table.map((r) => r.team), ['D1', 'D2', 'D3']);
    assert.ok(table.every((r) => r.points === 3));
    assert.equal(engine.getChampion(t), 'D1');
});
