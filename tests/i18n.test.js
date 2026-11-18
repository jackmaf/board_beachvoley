/**
 * Tests de las traducciones (js/i18n/*.js).
 *
 * No prueban textos concretos: protegen contra los olvidos típicos al
 * añadir un texto (crearlo en un idioma y no en el otro, o usar en el HTML
 * o en el JS una clave que no existe).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { constants } = require('./load-core');
const es = require('../js/i18n/es.js');
const en = require('../js/i18n/en.js');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** Aplana { a: { b: 'x' } } → { 'a.b': 'x' }. */
function flatten(node, prefix = '', out = {}) {
    Object.entries(node).forEach(([key, value]) => {
        const full = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object') flatten(value, full, out);
        else out[full] = value;
    });
    return out;
}

const flatEs = flatten(es);
const flatEn = flatten(en);

/** ¿Existe la clave (o su forma plural) en un diccionario aplanado? */
const has = (flat, key) => key in flat || `${key}_one` in flat || `${key}_other` in flat;

/** Variables `{{x}}` de un texto, ordenadas. */
const variables = (text) => [...String(text).matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();

test('español e inglés tienen exactamente las mismas claves', () => {
    const onlyEs = Object.keys(flatEs).filter((k) => !(k in flatEn));
    const onlyEn = Object.keys(flatEn).filter((k) => !(k in flatEs));
    assert.deepEqual(onlyEs, [], 'claves que faltan en en.js');
    assert.deepEqual(onlyEn, [], 'claves que faltan en es.js');
});

test('las traducciones usan las mismas variables {{x}} en los dos idiomas', () => {
    const mismatched = Object.keys(flatEs).filter((k) => {
        // En los plurales `_one` la variable count puede omitirse en un idioma
        const a = variables(flatEs[k]).filter((v) => v !== 'count');
        const b = variables(flatEn[k] ?? '').filter((v) => v !== 'count');
        return JSON.stringify(a) !== JSON.stringify(b);
    });
    assert.deepEqual(mismatched, []);
});

test('toda clave de index.html (data-i18n, data-i18n-html, data-i18n-attr) existe', () => {
    const html = read('index.html');
    const keys = new Set();
    for (const m of html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) keys.add(m[1]);
    for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
        m[1].split(';').forEach((pair) => keys.add(pair.split(':')[1].trim()));
    }
    assert.ok(keys.size > 100, 'se esperaban muchas claves en el HTML');
    assert.deepEqual([...keys].filter((k) => !has(flatEs, k)), []);
});

test('toda clave literal usada en el JavaScript existe', () => {
    const namespaces = Object.keys(es).join('|');
    const keyPattern = new RegExp(`['"\`]((?:${namespaces})\\.[A-Za-z0-9_.]+)['"\`]`, 'g');
    const dirs = ['js/views', 'js/ui', 'js/services'];
    const files = dirs.flatMap((dir) => fs.readdirSync(path.join(ROOT, dir)).map((f) => path.join(dir, f)));
    files.push('js/main.js');

    const missing = [];
    files.forEach((file) => {
        for (const m of read(file).matchAll(keyPattern)) {
            if (!has(flatEs, m[1])) missing.push(`${file}: ${m[1]}`);
        }
    });
    assert.deepEqual(missing, []);
});

test('las claves dinámicas del dominio están traducidas', () => {
    const { SKILLS, RECEPTION_GRADES, TOURNAMENT_FORMAT, GENDER_LABEL } = constants;
    const expected = [
        ...SKILLS.flatMap((s) => [`skills.${s.key}`, `awards.${s.key}`]),
        'awards.topScorer',
        'awards.mostErrors',
        ...RECEPTION_GRADES.flatMap((g) => [`reception.grade${g.grade}`, `reception.hint${g.grade}`]),
        ...Object.values(TOURNAMENT_FORMAT).map((f) => `formats.${f}`),
        ...Object.keys(GENDER_LABEL).map((g) => `genders.${g}`),
        ...['final', 'semifinals', 'quarterfinals', 'roundOf16', 'round'].map((r) => `rounds.${r}`),
        ...['played', 'won', 'lost', 'sets', 'points'].flatMap((k) => [`standings.${k}`, `standings.${k}Hint`]),
        'stats.unit_pts',
        'stats.unit_errs'
    ];
    // Formatos con espacios ("Round Robin") son claves de un nivel: se buscan dentro de su grupo
    const missing = expected.filter((key) => {
        const [group, ...rest] = key.split('.');
        return !(rest.join('.') in es[group]) && !has(flatEs, key);
    });
    assert.deepEqual(missing, []);
});

test('los códigos de error del núcleo tienen traducción', () => {
    const sources = ['js/core/rules.js', 'js/core/tournament-engine.js', 'js/state/match-store.js', 'js/services/storage.js'];
    const codes = new Set();
    sources.forEach((file) => {
        for (const m of read(file).matchAll(/code: '(\w+)'/g)) codes.add(m[1]);
    });
    assert.ok(codes.size >= 10);
    assert.deepEqual([...codes].filter((c) => !has(flatEs, `errors.${c}`)), []);

    const prizeCodes = new Set([...read('js/core/prize-engine.js').matchAll(/code: '(\w+)'/g)].map((m) => m[1]));
    assert.deepEqual([...prizeCodes].filter((c) => !has(flatEs, `errors.prize.${c}`)), []);
});
