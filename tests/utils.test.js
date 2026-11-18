/**
 * Tests de las utilidades de fotos (js/core/utils.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { utils } = require('./load-core');

test('nameKey: ignora mayúsculas y espacios sobrantes, pero no las tildes', () => {
    assert.equal(utils.nameKey('  Juan   Pérez '), 'juan pérez');
    assert.equal(utils.nameKey('JUAN PÉREZ'), utils.nameKey('juan pérez'));
    assert.notEqual(utils.nameKey('Ana'), utils.nameKey('Aná'));
    assert.equal(utils.nameKey(''), '');
    assert.equal(utils.nameKey(null), '');
});

test('getSquareCrop: recorte cuadrado centrado que nunca amplía la imagen', () => {
    // Foto vertical de móvil: se recorta arriba y abajo
    assert.deepEqual(utils.getSquareCrop(3000, 4000, 256), { sx: 0, sy: 500, side: 3000, output: 256 });
    // Foto apaisada: se recorta a los lados
    assert.deepEqual(utils.getSquareCrop(1600, 900, 256), { sx: 350, sy: 0, side: 900, output: 256 });
    // Imagen pequeña: se conserva su tamaño
    assert.deepEqual(utils.getSquareCrop(100, 120, 256), { sx: 0, sy: 10, side: 100, output: 100 });
});
