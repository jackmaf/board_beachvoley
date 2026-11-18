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
