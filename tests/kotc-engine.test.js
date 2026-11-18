/**
 * Tests del formato Queen & King of the Court (js/core/kotc-engine.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { kotcEngine: kotc, tournamentEngine, constants } = require('./load-core');

const teams = (n) => Array.from({ length: n }, (_, i) => ({ name: `D${i + 1}`, p1: `J${i + 1}a`, p2: `J${i + 1}b` }));
const nameOf = (state, id) => kotc.getTeam(state, id).name;
const snapshotOf = (state) => ({
    throne: nameOf(state, state.throne),
    queue: state.queue.map((id) => nameOf(state, id)).join(','),
    points: state.teams.map((t) => state.points[t.id]).join(',')
});

test('estado inicial: la primera dupla en el trono y el resto en cola', () => {
    const s = kotc.createState(teams(4), { targetPoints: 5 });
    assert.deepEqual(snapshotOf(s), { throne: 'D1', queue: 'D2,D3,D4', points: '0,0,0,0' });
    assert.equal(nameOf(s, kotc.getChallengerId(s)), 'D2');
    assert.deepEqual(s.settings, { targetPoints: 5, timeLimitMinutes: 0 });
});

test('gana el trono: +1 punto y el retador va al final de la cola', () => {
    const s = kotc.createState(teams(4));
    kotc.applyRally(s, 'throne');
    assert.deepEqual(snapshotOf(s), { throne: 'D1', queue: 'D3,D4,D2', points: '1,0,0,0' });
    assert.equal(s.stats.k1.kingRallies, 1);
});

test('gana el retador: sube al trono SIN puntuar y el destronado va a la cola', () => {
    const s = kotc.createState(teams(4));
    kotc.applyRally(s, 'challenger');
    assert.deepEqual(snapshotOf(s), { throne: 'D2', queue: 'D3,D4,D1', points: '0,0,0,0' });
    assert.equal(s.stats.k2.thrones, 1);
    assert.equal(s.stats.k1.dethroned, 1);
});

test('campeón al llegar a los puntos objetivo; después no se aceptan rallies', () => {
    const s = kotc.createState(teams(3), { targetPoints: 2 });
    kotc.applyRally(s, 'throne');
    assert.equal(s.winnerId, null);
    kotc.applyRally(s, 'throne');
    assert.equal(nameOf(s, s.winnerId), 'D1');
    assert.equal(kotc.applyRally(s, 'throne').ok, false);
});

test('deshacer restaura exactamente cola, trono, puntos y campeón', () => {
    const s = kotc.createState(teams(4), { targetPoints: 2 });
    kotc.applyRally(s, 'throne');
    const before = snapshotOf(s);
    kotc.applyRally(s, 'challenger');
    kotc.applyRally(s, 'throne');
    kotc.undo(s);
    kotc.undo(s);
    assert.deepEqual(snapshotOf(s), before);

    kotc.applyRally(s, 'throne'); // D1 llega a 2 → campeón
    assert.ok(s.winnerId);
    kotc.undo(s);
    assert.equal(s.winnerId, null, 'deshacer quita el campeón');
    assert.equal(kotc.undo(s).type, 'rally');
    assert.equal(kotc.undo(s), null, 'sin historial no hay nada que deshacer');
});

test('correcciones manuales +1/−1 también se pueden deshacer', () => {
    const s = kotc.createState(teams(3), { targetPoints: 3 });
    kotc.adjustPoints(s, 'k3', 1);
    assert.equal(s.points.k3, 1);
    assert.equal(kotc.adjustPoints(s, 'k2', -1).ok, false, 'no baja de 0');
    kotc.adjustPoints(s, 'k3', 2);
    assert.equal(nameOf(s, s.winnerId), 'D3', 'una corrección también puede dar el título');
    kotc.adjustPoints(s, 'k3', -1);
    assert.equal(s.winnerId, null, 'y quitarlo');
    kotc.undo(s);
    assert.equal(nameOf(s, s.winnerId), 'D3');
});

test('tiempo cumplido: gana el líder; con empate se juega punto de oro', () => {
    const s = kotc.createState(teams(3), { targetPoints: 15, timeLimitMinutes: 10 });
    kotc.applyRally(s, 'throne');               // D1: 1
    kotc.applyRally(s, 'challenger');           // D3 sube
    kotc.applyRally(s, 'throne');               // D3: 1  → empate D1-D3
    kotc.markTimeUp(s);
    assert.equal(s.timeUp, true);
    assert.equal(s.winnerId, null, 'empate en la cabeza: punto de oro');
    assert.deepEqual(kotc.getLeaders(s).map((id) => nameOf(s, id)).sort(), ['D1', 'D3']);
    kotc.applyRally(s, 'throne');               // D3: 2 rompe el empate
    assert.equal(nameOf(s, s.winnerId), 'D3');
});

test('reloj: arranca con el primer rally, se pausa y calcula el tiempo restante', () => {
    const s = kotc.createState(teams(3), { timeLimitMinutes: 1 });
    assert.equal(kotc.getRemainingMs(s), 60000);
    kotc.applyRally(s, 'throne');
    assert.ok(s.timer.runningSince, 'el primer rally pone el reloj en marcha');
    const t0 = s.timer.runningSince;
    kotc.toggleTimer(s, t0 + 20000);            // pausa a los 20 s
    assert.equal(kotc.getElapsedMs(s, t0 + 999999), 20000, 'en pausa no avanza');
    assert.equal(kotc.getRemainingMs(s, t0 + 999999), 40000);
    assert.equal(kotc.getRemainingMs(kotc.createState(teams(3))), null, 'sin límite → null');
});

test('tabla de posiciones: puntos, luego tronos conquistados; marca trono y retador', () => {
    const s = kotc.createState(teams(4));
    kotc.applyRally(s, 'throne');      // D1 +1
    kotc.applyRally(s, 'challenger');  // D3 sube
    kotc.applyRally(s, 'challenger');  // D4 sube
    const table = kotc.computeStandings(s);
    assert.deepEqual(table.map((r) => r.name), ['D1', 'D3', 'D4', 'D2']);
    assert.equal(table.find((r) => r.name === 'D4').status, 'throne');
    assert.equal(table.find((r) => r.status === 'challenger').name, nameOf(s, s.queue[0]));
});

test('integración: createTournament crea el estado y getChampion lo lee', () => {
    const t = tournamentEngine.createTournament({
        name: 'QK', category: 'A', gender: 'F', format: constants.TOURNAMENT_FORMAT.KING_OF_COURT,
        rules: {}, teams: teams(4), kotc: { targetPoints: 1 }
    });
    assert.equal(t.matches.length, 0);
    assert.equal(t.kotc.teams.length, 4);
    kotc.applyRally(t.kotc, 'throne');
    assert.equal(tournamentEngine.getChampion(t), 'D1');
});
