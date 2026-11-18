/**
 * Tests del motor de premios (js/core/prize-engine.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { prizeEngine: prize, tournamentEngine: engine, constants, utils } = require('./load-core');

const { TOURNAMENT_FORMAT } = constants;
const teams = (n) => Array.from({ length: n }, (_, i) => ({ name: `D${i + 1}`, p1: `J${i + 1}a`, p2: `J${i + 1}b` }));
const create = (format, n) =>
    engine.createTournament({ name: 'Test', category: 'A', gender: 'X', format, rules: { maxSets: 1 }, teams: teams(n) });
const settings = (overrides = {}) => ({ feePerPlayer: 5000, poolPercent: 100, distribution: [60, 30, 10], ...overrides });

/** Marca como pagados los dos jugadores de las primeras `n` duplas. */
const payTeams = (t, n) => t.prize.entries.slice(0, n).forEach((e) => {
    prize.setPayment(t, e.name, 'p1', true);
    prize.setPayment(t, e.name, 'p2', true);
});

/** Juega un partido: gana el hueco indicado 1-0. */
const play = (t, match, winner = 'teamA') =>
    engine.recordResult(t, match.id, winner === 'teamA' ? 1 : 0, winner === 'teamA' ? 0 : 1);

test('valida inscripción, porcentaje para la bolsa y que el reparto sume 100', () => {
    assert.equal(prize.validateSettings(settings()).ok, true);
    assert.equal(prize.validateSettings(settings({ feePerPlayer: 0 })).code, 'fee');
    assert.equal(prize.validateSettings(settings({ poolPercent: 120 })).code, 'pool');
    assert.equal(prize.validateSettings(settings({ distribution: [] })).code, 'noPlaces');
    assert.equal(prize.validateSettings(settings({ distribution: [60, 30] })).code, 'sum');
    assert.equal(prize.validateSettings(settings({ distribution: [100, 0] })).code, 'placePercent');
});

test('la bolsa se calcula sobre lo PAGADO; ejemplo 10 duplas × $10.000', () => {
    const t = create(TOURNAMENT_FORMAT.ROUND_ROBIN, 10);
    prize.enablePrize(t, settings({ poolPercent: 80 }));
    assert.equal(t.prize.entries.length, 10);
    assert.equal(t.prize.entries[0].p1, 'J1a', 'los jugadores se leen de los partidos');

    let s = prize.summarize(t);
    assert.equal(s.expected, 100000);
    assert.equal(s.collected, 0);
    assert.equal(s.pool, 0, 'sin pagos no hay bolsa');
    assert.equal(s.projectedPool, 80000);

    payTeams(t, 7);
    prize.setPayment(t, 'D8', 'p1', true); // Un solo jugador de la dupla 8
    s = prize.summarize(t);
    assert.equal(s.paidPlayers, 15);
    assert.equal(s.paidTeams, 7);
    assert.equal(s.partialTeams, 1);
    assert.equal(s.unpaidTeams, 2);
    assert.equal(s.collected, 75000);
    assert.equal(s.pending, 25000);
    assert.equal(s.pool, 60000);
    assert.equal(s.admin, 15000);
    assert.deepEqual(s.awards.map((a) => a.amount), [36000, 18000, 6000]);
    assert.equal(s.awards[0].perPlayer, 18000);
});

test('reparto exacto: no se pierde ni un peso y no se redondea a miles', () => {
    assert.deepEqual(prize.splitExact(100, [1, 1, 1]), [34, 33, 33]);
    assert.deepEqual(prize.splitExact(17500, [60, 30, 10]), [10500, 5250, 1750]);
    const parts = prize.splitExact(70001, [60, 30, 10]);
    assert.equal(parts.reduce((a, b) => a + b, 0), 70001);
});

test('eliminación directa: campeón, finalista y 3.º compartido por los semifinalistas', () => {
    const t = create(TOURNAMENT_FORMAT.KNOCKOUT, 4);
    prize.enablePrize(t, settings({ distribution: [60, 30, 10] }));
    payTeams(t, 4); // 4 duplas × $10.000 = $40.000

    const [semis, [final]] = engine.getKnockoutRounds(t);
    play(t, semis[0], 'teamA');
    play(t, semis[1], 'teamB');
    let s = prize.summarize(t);
    const third = s.awards.find((a) => a.rank === 3);
    assert.equal(third.shared, true);
    assert.equal(third.slots, 2);
    assert.equal(third.amount, 4000);
    assert.equal(third.perTeam, 2000);
    assert.equal(third.teams.length, 2);
    assert.equal(s.awards[0].decided, false, 'la final aún no se juega');

    play(t, engine.findMatch(t, final.id), 'teamB');
    s = prize.summarize(t);
    assert.deepEqual(s.awards[0].teams, [engine.findMatch(t, final.id).teamB]);
    assert.equal(s.awards[0].amount, 24000);
    assert.equal(s.awards[1].amount, 12000);
    assert.equal(s.awards.reduce((sum, a) => sum + a.amount, 0), s.pool);
});

test('eliminación directa con BYE: los pases automáticos no ocupan puesto', () => {
    const t = create(TOURNAMENT_FORMAT.KNOCKOUT, 5); // 3 BYE en primera ronda
    const groups = prize.getRankGroups(t);
    const firstRound = groups[groups.length - 1];
    assert.equal(firstRound.rank, 5);
    assert.equal(firstRound.size, 1, 'sólo un partido real en primera ronda');
});

test('Round Robin: orden provisional hasta jugar todos los partidos', () => {
    const t = create(TOURNAMENT_FORMAT.ROUND_ROBIN, 3);
    prize.enablePrize(t, settings({ distribution: [100] }));
    assert.deepEqual(prize.summarize(t).awards[0].teams, [], 'sin partidos no hay líder');

    play(t, t.matches[0], 'teamA');
    let award = prize.summarize(t).awards[0];
    assert.equal(award.teams.length, 1);
    assert.equal(award.decided, false);

    t.matches.slice(1).forEach((m) => play(t, m, 'teamA'));
    award = prize.summarize(t).awards[0];
    assert.equal(award.decided, true);
    assert.deepEqual(award.teams, [engine.getChampion(t)]);
});

test('reconfigurar conserva los pagos; desactivar no los borra', () => {
    const t = create(TOURNAMENT_FORMAT.ROUND_ROBIN, 3);
    prize.enablePrize(t, settings(), { D2: { p1: true, p2: false } });
    assert.equal(prize.summarize(t).paidPlayers, 1);

    prize.enablePrize(t, settings({ feePerPlayer: 8000 }));
    assert.equal(prize.summarize(t).collected, 8000);

    prize.disablePrize(t);
    assert.equal(prize.summarize(t), null);
    assert.equal(t.prize.entries[1].paid.p1, true);
});

test('torneos sin premios (o antiguos) no rompen nada', () => {
    const t = create(TOURNAMENT_FORMAT.ROUND_ROBIN, 3);
    assert.equal(prize.isEnabled(t), false);
    assert.equal(prize.summarize(t), null);
    assert.equal(prize.syncEntries(t), false);
});

test('formatMoney: pesos colombianos sin redondear', () => {
    assert.equal(utils.formatMoney(10000, 'es-CO'), '$ 10.000');
    assert.equal(utils.formatMoney(10000, 'en-US'), '$10,000');
    assert.equal(utils.formatMoney(3500.5, 'es-CO'), '$ 3.500,5');
});
