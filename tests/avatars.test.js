/**
 * Tests de los avatares de ejemplo (js/core/avatars.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { avatars } = require('./load-core');

test('hay avatares de ejemplo para jugadores y para duplas, con IDs únicos', () => {
    const players = avatars.list('players');
    const teams = avatars.list('teams');
    assert.ok(players.length >= 8 && teams.length >= 8);
    assert.equal(new Set([...players, ...teams]).size, players.length + teams.length);
    assert.deepEqual(avatars.list('otro'), []);
});

test('cada avatar es un SVG válido y su data URL se puede usar en <img>', () => {
    [...avatars.list('players'), ...avatars.list('teams')].forEach((id) => {
        const svg = avatars.getSvg(id);
        assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*>.*<\/svg>$/s, id);
        assert.ok(avatars.getDataUrl(id).startsWith('data:image/svg+xml;charset=utf-8,%3Csvg'), id);
    });
    assert.equal(avatars.getSvg('nope'), '');
    assert.equal(avatars.getDataUrl('nope'), '');
});

test('avatar por defecto: estable por nombre (sin mayúsculas ni espacios) y del tipo correcto', () => {
    const id = avatars.getDefaultId('players', 'Juan Pérez');
    assert.equal(avatars.getDefaultId('players', '  juan   PÉREZ '), id);
    assert.ok(avatars.list('players').includes(id));
    assert.ok(avatars.list('teams').includes(avatars.getDefaultId('teams', 'Brasil')));
    // Nombres distintos se reparten entre varios avatares
    const spread = new Set(['Ana', 'Luis', 'Marta', 'Sol', 'Pedro', 'Carlos', 'Juan', 'Lucía'].map((n) => avatars.getDefaultId('players', n)));
    assert.ok(spread.size >= 4);
});

test('referencias avatar:<id>: ida y vuelta, y rechazo de valores ajenos', () => {
    assert.equal(avatars.fromRef(avatars.toRef('p3')), 'p3');
    assert.equal(avatars.fromRef('avatar:inexistente'), null);
    assert.equal(avatars.fromRef('data:image/jpeg;base64,AAAA'), null);
    assert.equal(avatars.fromRef(null), null);
});
