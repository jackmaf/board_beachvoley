/**
 * Tests de las estadísticas por torneo (js/core/tournament-stats.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
require('./load-core');
require('../js/core/tournament-stats.js');
const { kotcEngine: kotc, tournamentStats: tStats } = globalThis.VP;

const teams = (n) => Array.from({ length: n }, (_, i) => ({ name: `D${i + 1}` }));

test('Queen & King: reconstruye cada rally desde el historial', () => {
    const s = kotc.createState(teams(3));
    kotc.applyRally(s, 'throne');      // D1 defiende ante D2
    kotc.applyRally(s, 'challenger');  // D3 destrona a D1
    kotc.adjustPoints(s, 'k2', 1);     // corrección: no es un rally
    const rallies = tStats.replayKotcRallies(s);
    assert.equal(rallies.length, 2);
    assert.deepEqual(rallies.map((r) => `${r.kingId}>${r.challengerId}:${r.winner}`), ['k1>k2:throne', 'k1>k3:challenger']);
});

test('Queen & King: defensa del trono, retos, rachas y evolución de puntos', () => {
    const s = kotc.createState(teams(3));
    // Cola inicial: trono D1, retadores D2, D3
    kotc.applyRally(s, 'throne');      // D1 defiende ante D2 → D1 1   · cola D3, D2
    kotc.applyRally(s, 'throne');      // D1 defiende ante D3 → D1 2   · cola D2, D3 (racha 2)
    kotc.applyRally(s, 'challenger');  // D2 destrona a D1             · cola D3, D1
    kotc.applyRally(s, 'throne');      // D2 defiende ante D3 → D2 1
    const a = tStats.computeKotcAnalytics(s);
    const row = (name) => a.rows.find((r) => r.name === name);

    assert.equal(row('D1').holdRallies, 3);
    assert.equal(row('D1').holdWins, 2);
    assert.ok(Math.abs(row('D1').holdPct - 66.67) < 0.01);
    assert.equal(row('D1').bestStreak, 2);
    assert.equal(row('D2').challenges, 2);
    assert.equal(row('D2').challengePct, 50);
    assert.equal(row('D3').challenges, 2);
    assert.equal(row('D3').challengePct, 0);

    assert.deepEqual(a.timeline.labels, [0, 1, 2, 3, 4]);
    assert.deepEqual(a.timeline.series.find((x) => x.name === 'D1').values, [0, 1, 2, 2, 2]);
    assert.deepEqual(a.timeline.series.find((x) => x.name === 'D2').values, [0, 0, 0, 0, 1]);
    assert.equal(a.partial, false);

    const titles = a.highlights.map((h) => `${h.key}:${h.winner}`);
    assert.ok(titles.includes('streak:D1'));
    assert.ok(titles.includes('hold:D1'), 'D1 defendió 3 rallies (muestra mínima)');
    assert.ok(!titles.some((t) => t.startsWith('challenge:')), 'nadie tiene 3 retos: sin premio de retadora');
});

test('Queen & King: sin jugadas, analíticas vacías pero válidas', () => {
    const a = tStats.computeKotcAnalytics(kotc.createState(teams(3)));
    assert.equal(a.rallies, 0);
    assert.deepEqual(a.timeline.labels, [0]);
    assert.equal(a.rows[0].holdPct, null);
    assert.equal(a.highlights.length, 0);
});

test('Partidos de torneo: agrega por dupla y por jugador sólo los del torneo', () => {
    const point = (equipo, jugadorId, tipoAccion, setNumber = 1) => ({ equipo, jugadorId, tipoAccion, setNumber, actionDetail: 'Ataque', coordenadas: { x: 10, y: 10 }, marcadorMomento: '0-0' });
    const config = { teamA: 'Brasil', teamB: 'España', pA1: 'Ana', pA2: 'Bea', pB1: 'Carla', pB2: 'Dani', maxSets: 1, ptsNormal: 2, firstServer: 'A' };
    const history = [
        { tournamentId: 'otro', config, points: [point('A', 'A1', 'punto')], sets: [] },
        {
            tournamentId: 't1', finishedAt: 1, config,
            sets: [{ scoreA: 2, scoreB: 0 }], // set cerrado: 2 puntos con ventaja de 2
            points: [point('A', 'A1', 'punto'), point('B', 'B1', 'punto'), point('A', 'A2', 'punto')]
        },
        { tournamentId: 't1', config: { ...config, teamA: 'España', teamB: 'Chile', pA1: 'Carla', pA2: 'Dani', pB1: 'Eva', pB2: 'Fe' }, sets: [], points: [point('B', 'Fast_B', 'punto')] }
    ];
    const r = tStats.computeMatchStats({ id: 't1' }, history);

    assert.equal(r.matches.length, 2, 'ignora partidos de otros torneos');
    assert.equal(r.matches[0].index, 1, 'conserva el índice en el historial');
    const team = (n) => r.teams.find((t) => t.name === n);
    assert.equal(team('España').played, 2);
    assert.equal(team('Brasil').pointsFor, 2);
    assert.equal(team('Brasil').setsFor, 1);
    assert.equal(team('Brasil').served, 2, 'Brasil sacó el 1º rally y, al ganarlo, también el 2º');
    assert.equal(r.players.find((p) => p.name === 'Ana').pts, 1);
    assert.equal(r.players.some((p) => p.name === 'Eva'), false, 'el marcador rápido no tiene acciones por jugador');
    assert.equal(r.hasScoutData, true);
});
