/**
 * Tests del motor de reglas (js/core/rules.js).
 * Ejecutar con: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { rules } = require('./load-core');

const BEST_OF_3 = { maxSets: 3, ptsNormal: 21, ptsTiebreak: 15 };
const set = (scoreA, scoreB) => ({ scoreA, scoreB, timeoutsA: 0, timeoutsB: 0 });

test('un punto suma al equipo del jugador y un error al rival', () => {
    assert.equal(rules.getPointWinner({ equipo: 'A', tipoAccion: 'punto' }), 'A');
    assert.equal(rules.getPointWinner({ equipo: 'A', tipoAccion: 'error' }), 'B');
    assert.equal(rules.getPointWinner({ equipo: 'B', tipoAccion: 'error' }), 'A');
    assert.equal(rules.getPointWinner({ equipo: 'A', tipoAccion: 'timeout' }), null);
});

test('un set necesita llegar al umbral con 2 puntos de ventaja', () => {
    assert.equal(rules.getSetWinner(set(21, 19), 0, BEST_OF_3), 'A');
    assert.equal(rules.getSetWinner(set(21, 20), 0, BEST_OF_3), null);
    assert.equal(rules.getSetWinner(set(24, 26), 0, BEST_OF_3), 'B');
    assert.equal(rules.getSetWinner(set(20, 5), 0, BEST_OF_3), null);
});

test('el tercer set de un partido a 3 es tie-break a 15', () => {
    assert.equal(rules.getSetTarget(2, BEST_OF_3), 15);
    assert.equal(rules.getSetWinner(set(15, 13), 2, BEST_OF_3), 'A');
    assert.equal(rules.getSetWinner(set(15, 13), 1, BEST_OF_3), null);
});

test('un partido a 1 set se juega a los puntos normales, no al tie-break', () => {
    const oneSet = { maxSets: 1, ptsNormal: 21, ptsTiebreak: 15 };
    assert.equal(rules.getSetTarget(0, oneSet), 21);
    assert.equal(rules.getSetWinner(set(15, 10), 0, oneSet), null);
});

test('sólo cuentan los sets terminados', () => {
    assert.deepEqual(rules.countSetsWon([set(21, 15), set(10, 8)], BEST_OF_3), { A: 1, B: 0 });
});

test('el ganador del partido es quien llega a ceil(maxSets/2) sets', () => {
    assert.equal(rules.getMatchWinner([set(21, 15), set(21, 18)], BEST_OF_3), 'A');
    assert.equal(rules.getMatchWinner([set(21, 15), set(18, 21)], BEST_OF_3), null);
    assert.equal(rules.getMatchWinner([set(21, 15), set(18, 21), set(12, 15)], BEST_OF_3), 'B');
});

test('cambio de lado cada 7 puntos (5 en tie-break) salvo si se cierra el set', () => {
    assert.equal(rules.isSideChange(set(4, 3), 0, BEST_OF_3), true);
    assert.equal(rules.isSideChange(set(4, 2), 0, BEST_OF_3), false);
    assert.equal(rules.isSideChange(set(3, 2), 2, BEST_OF_3), true);
    assert.equal(rules.isSideChange(set(21, 14), 0, BEST_OF_3), false); // 35 pts pero set cerrado
});

test('normalizeRules rellena valores inválidos con los de por defecto', () => {
    assert.deepEqual(rules.normalizeRules({ maxSets: 'x', ptsNormal: 0 }), { maxSets: 3, ptsNormal: 21, ptsTiebreak: 15 });
});

test('evaluateManualResult valida el resultado manual', () => {
    const ok = rules.evaluateManualResult([{ a: 21, b: 18 }, { a: 15, b: 21 }, { a: 15, b: 10 }], BEST_OF_3);
    assert.deepEqual(ok, { ok: true, setsA: 2, setsB: 1, winner: 'A' });

    assert.equal(rules.evaluateManualResult([{ a: 21, b: 21 }], BEST_OF_3).ok, false, 'set empatado');
    assert.equal(rules.evaluateManualResult([{ a: 21, b: 18 }, { a: null, b: null }, { a: 15, b: 3 }], BEST_OF_3).ok, false, 'hueco');
    assert.equal(rules.evaluateManualResult([{ a: 21, b: 18 }, { a: null, b: null }], BEST_OF_3).ok, false, 'sin ganador');
    assert.equal(rules.evaluateManualResult([{ a: 21, b: 18 }, { a: 21, b: 10 }, { a: 15, b: 3 }], BEST_OF_3).ok, false, 'set de más');
    assert.equal(rules.evaluateManualResult([{ a: 21, b: null }], BEST_OF_3).ok, false, 'set a medias');
});
