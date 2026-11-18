/**
 * Tests de los cálculos estadísticos (js/core/stats-engine.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { statsEngine: stats } = require('./load-core');

const config = { teamA: 'Brasil', teamB: 'España', pA1: 'Ana', pA2: 'Bea', pB1: 'Carlos', pB2: 'Dani' };

/** Crea un registro de bitácora con valores por defecto. */
const point = (overrides) => ({
    equipo: 'A',
    jugadorId: 'A1',
    tipoAccion: 'punto',
    actionDetail: 'Ataque',
    coordenadas: { x: 25, y: 75 },
    marcadorMomento: '1-0',
    setNumber: 1,
    matchSecond: 10,
    pointNumber: 1,
    ...overrides
});

const points = [
    point({}),
    point({ jugadorId: 'B1', equipo: 'B', tipoAccion: 'error', marcadorMomento: '2-0', pointNumber: 2, matchSecond: 70 }),
    point({ tipoAccion: 'timeout', jugadorId: 'Eq.B', equipo: 'B', marcadorMomento: '2-0', pointNumber: 2 }),
    point({ jugadorId: 'A1', actionDetail: 'Saque', coordenadas: { x: 75, y: 80 }, marcadorMomento: '15-10', setNumber: 2, pointNumber: 3, matchSecond: 130 })
];

test('selectPoints aplica línea de tiempo, set y filtros visuales en cascada', () => {
    const filters = stats.createDefaultFilters();
    const all = stats.selectPoints(points, filters);
    assert.equal(all.bySet.length, 4);
    assert.equal(all.visible.length, 3, 'los tiempos muertos no van al heatmap');

    const set2 = stats.selectPoints(points, { ...filters, set: 2 });
    assert.equal(set2.bySet.length, 1);

    const half = stats.selectPoints(points, { ...filters, timelinePct: 50 });
    assert.equal(half.timeline.length, 2);

    const minute2 = stats.selectPoints(points, { ...filters, minMinute: 2, maxMinute: 2 });
    assert.deepEqual(minute2.visible.map((p) => p.pointNumber), [2]);

    const saques = stats.selectPoints(points, { ...filters, actionDetail: 'Saque' });
    assert.equal(saques.visible.length, 1);
});

test('computeScore asigna los errores al rival', () => {
    assert.deepEqual(stats.computeScore(points), { A: 3, B: 0 });
});

test('totales por jugador y premios del Salón de la Fama', () => {
    const totals = stats.computePlayerTotals(points, config);
    assert.equal(totals.A1.pts, 2);
    assert.equal(totals.A1.skills.Saque, 1);
    assert.equal(totals.B1.errs, 1);

    const awards = stats.computeAwards(totals);
    const titles = awards.map((a) => a.title);
    assert.ok(titles.includes('Máx. Anotador'));
    assert.equal(awards.find((a) => a.title === 'Más Errores').winner, 'Carlos');
});

test('perfil del jugador: KPIs, zonas y mejor minuto', () => {
    const profile = stats.computePlayerProfile(points, 'A1');
    assert.equal(profile.pts, 2);
    assert.equal(profile.errs, 0);
    assert.equal(profile.efficiency, 100);
    assert.equal(profile.clutch, 1, 'sólo 1-0 es un marcador ajustado (15-10 no)');
    assert.equal(profile.zones.pctLeft, 50);
    assert.deepEqual(profile.bestMinute, { minute: 1, count: 1 });
});

test('la bitácora calcula los metros desde las coordenadas', () => {
    const row = stats.toLogRow(points[0], 'Ana');
    assert.equal(row.xMeters, '2.0'); // 25 % de 8 m
    assert.equal(row.yMeters, '12.0'); // 75 % de 16 m
    assert.equal(stats.toLogRow(points[2]).xMeters, '-', 'los tiempos muertos no tienen coordenadas');
});

// -------------------------------------------------------------------------
// Indicadores profesionales
// -------------------------------------------------------------------------

test('withServingTeam reconstruye el saque en partidos antiguos', () => {
    const legacy = [
        point({ equipo: 'A', tipoAccion: 'punto', setNumber: 1 }),    // saca A (inicial) y gana A
        point({ equipo: 'A', tipoAccion: 'error', setNumber: 1 }),    // saca A, gana B
        point({ equipo: 'B', tipoAccion: 'timeout', setNumber: 1 }),
        point({ equipo: 'B', tipoAccion: 'punto', setNumber: 1 }),    // saca B
        point({ equipo: 'B', tipoAccion: 'punto', setNumber: 2 })     // set 2: saca B por alternancia
    ];
    const served = stats.withServingTeam(legacy, 'A');
    assert.deepEqual(served.map((p) => p.servingTeam), ['A', 'A', undefined, 'B', 'B']);
    assert.equal(stats.withServingTeam([point({ servingTeam: 'B' })], 'A')[0].servingTeam, 'B', 'respeta el dato grabado');
});

test('side-out, break point, aces y errores de saque', () => {
    const rallies = [
        point({ servingTeam: 'A', equipo: 'A', tipoAccion: 'punto', actionDetail: 'Saque' }), // ace de A → break A
        point({ servingTeam: 'A', equipo: 'B', tipoAccion: 'punto' }),                        // side-out B
        point({ servingTeam: 'B', equipo: 'B', tipoAccion: 'error', actionDetail: 'Saque' }), // error de saque B → side-out A
        point({ servingTeam: 'A', equipo: 'A', tipoAccion: 'punto' })                         // break A
    ];
    const { teams } = stats.computeProIndicators(rallies);
    assert.equal(teams.A.served, 3);
    assert.equal(teams.A.breakWon, 2);
    assert.ok(Math.abs(teams.A.breakPct - 66.67) < 0.01);
    assert.equal(teams.A.sideOutPct, 100);
    assert.equal(teams.B.sideOutPct, (1 / 3) * 100);
    assert.equal(teams.B.breakPct, 0);
    assert.equal(teams.A.aces, 1);
    assert.equal(teams.B.serveErrors, 1);
});

test('calidad de recepción: media, positivas y side-out por calidad', () => {
    const rallies = [
        point({ servingTeam: 'B', equipo: 'A', reception: { playerId: 'A1', grade: 3 } }),                     // A recibe 3 y gana
        point({ servingTeam: 'B', equipo: 'A', reception: { playerId: 'A1', grade: 2 } }),                     // A recibe 2 y gana
        point({ servingTeam: 'B', equipo: 'A', tipoAccion: 'error', reception: { playerId: 'A2', grade: 1 } }), // A recibe 1 y pierde
        point({ servingTeam: 'B', equipo: 'B', actionDetail: 'Saque', reception: { playerId: 'A2', grade: 0 } }) // ace sobre A2
    ];
    const pro = stats.computeProIndicators(rallies);
    const rec = pro.teams.A.reception;
    assert.equal(pro.hasReceptionData, true);
    assert.equal(rec.count, 4);
    assert.equal(rec.average, 1.5);
    assert.equal(rec.positivePct, 50);
    assert.equal(rec.perfectPct, 25);
    assert.equal(pro.players.A1.average, 2.5);
    assert.equal(pro.players.A2.sideOutPct, 0);
    assert.equal(pro.byGrade.A[3].sideOutPct, 100);
    assert.equal(pro.byGrade.A[1].sideOutPct, 0);
    assert.equal(pro.teams.B.aces, 1);
    assert.equal(pro.players.B1.count, 0);
    assert.equal(pro.players.B1.average, null, 'sin muestra → null (se muestra "—")');
});
