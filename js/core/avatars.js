/**
 * @file avatars.js
 * @description Avatares de ejemplo PROPIOS (SVG generado en código) para
 * jugadores y duplas que no tienen foto.
 *
 * - No dependen de internet (a diferencia de DiceBear): se ven igual en la
 *   playa sin cobertura.
 * - Cada nombre recibe uno por defecto, siempre el mismo (hash del nombre).
 * - El usuario también puede elegir uno a mano: se guarda sólo la referencia
 *   `avatar:<id>` (unos bytes), no la imagen.
 *
 * Puro: sin DOM ni storage → testeable en Node.
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { hashString, nameKey } = VP.utils;

    /** Prefijo de las referencias guardadas en la biblioteca de fotos. */
    const AVATAR_PREFIX = 'avatar:';

    // ---------------------------------------------------------------------
    // Jugadores: cara sencilla con estética de playa
    // ---------------------------------------------------------------------

    /*
     * Cada preset combina fondo, piel, pelo, camiseta y un complemento.
     * hair: short | long | bun | buzz | cap        extra: none | glasses | band
     */
    const PLAYER_PRESETS = [
        { id: 'p1', bg: '#FFD56F', skin: '#F2C7A5', hair: 'short', hairColor: '#4A3426', shirt: '#FF4B4B', extra: 'none' },
        { id: 'p2', bg: '#93E4C1', skin: '#C68E68', hair: 'long', hairColor: '#2B1D14', shirt: '#4B9BFF', extra: 'none' },
        { id: 'p3', bg: '#B6E3F4', skin: '#8D5B3E', hair: 'buzz', hairColor: '#1E1410', shirt: '#FF7B54', extra: 'glasses' },
        { id: 'p4', bg: '#FFDFBF', skin: '#F7D9C4', hair: 'bun', hairColor: '#D9A441', shirt: '#27AE60', extra: 'none' },
        { id: 'p5', bg: '#FF7B54', skin: '#E0AC85', hair: 'cap', hairColor: '#3B2A20', shirt: '#2C363F', extra: 'none' },
        { id: 'p6', bg: '#4B9BFF', skin: '#6E4530', hair: 'long', hairColor: '#120C08', shirt: '#FFD56F', extra: 'band' },
        { id: 'p7', bg: '#F6B93B', skin: '#F2C7A5', hair: 'short', hairColor: '#B5651D', shirt: '#4B9BFF', extra: 'glasses' },
        { id: 'p8', bg: '#C3B1E1', skin: '#C68E68', hair: 'bun', hairColor: '#2B1D14', shirt: '#FF4B4B', extra: 'band' },
        { id: 'p9', bg: '#93E4C1', skin: '#F7D9C4', hair: 'cap', hairColor: '#E8C170', shirt: '#FF7B54', extra: 'glasses' },
        { id: 'p10', bg: '#FFB3A7', skin: '#8D5B3E', hair: 'short', hairColor: '#1E1410', shirt: '#27AE60', extra: 'band' },
        { id: 'p11', bg: '#B6E3F4', skin: '#E0AC85', hair: 'long', hairColor: '#8A4B2A', shirt: '#2C363F', extra: 'glasses' },
        { id: 'p12', bg: '#FFE8A3', skin: '#6E4530', hair: 'buzz', hairColor: '#120C08', shirt: '#FF4B4B', extra: 'none' }
    ];

    /** Pelo DETRÁS de la cabeza (melena larga). */
    const hairBack = (p) =>
        p.hair === 'long' ? `<path d="M17 30c0-12 7-19 15-19s15 7 15 19v14H17z" fill="${p.hairColor}"/>` : '';

    /** Pelo / gorra DELANTE de la cabeza. */
    function hairFront(p) {
        const c = p.hairColor;
        switch (p.hair) {
            case 'short':
                return `<path d="M19 27c0-9 6-14 13-14s13 5 13 14c-3-4-7-6-13-6s-10 2-13 6z" fill="${c}"/>`;
            case 'long':
                return `<path d="M19 28c0-9 6-15 13-15s13 6 13 15c-4-5-9-7-13-7s-9 2-13 7z" fill="${c}"/>`;
            case 'bun':
                return `<circle cx="32" cy="11" r="5" fill="${c}"/><path d="M19 27c0-9 6-14 13-14s13 5 13 14c-3-4-7-6-13-6s-10 2-13 6z" fill="${c}"/>`;
            case 'buzz':
                return `<path d="M20 24c1-7 6-11 12-11s11 4 12 11c-3-3-7-4-12-4s-9 1-12 4z" fill="${c}"/>`;
            case 'cap':
                return `<path d="M18 25c0-8 6-13 14-13s14 5 14 13z" fill="${p.shirt}"/><path d="M30 24h21c0 3-3 4-6 4H30z" fill="${p.shirt}"/><rect x="18" y="23" width="28" height="3" rx="1.5" fill="#FFFFFF" opacity=".55"/>`;
            default:
                return '';
        }
    }

    /** Ojos, o gafas de sol si el preset las lleva. */
    const eyes = (p) =>
        p.extra === 'glasses'
            ? '<rect x="22" y="27" width="8" height="5" rx="2.5" fill="#1E272E"/><rect x="34" y="27" width="8" height="5" rx="2.5" fill="#1E272E"/><path d="M30 29h4" stroke="#1E272E" stroke-width="1.5"/>'
            : '<circle cx="27" cy="30" r="1.8" fill="#2C2C2C"/><circle cx="37" cy="30" r="1.8" fill="#2C2C2C"/>';

    const headband = (p) => (p.extra === 'band' ? `<rect x="19" y="21" width="26" height="3.5" rx="1.75" fill="${p.shirt}"/>` : '');

    function playerSvg(p) {
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`
            + `<rect width="64" height="64" fill="${p.bg}"/>`
            + hairBack(p)
            + `<path d="M10 64c2-11 11-17 22-17s20 6 22 17z" fill="${p.shirt}"/>`
            + `<rect x="28" y="38" width="8" height="10" rx="3" fill="${p.skin}"/>`
            + `<circle cx="32" cy="29" r="13" fill="${p.skin}"/>`
            + hairFront(p)
            + headband(p)
            + eyes(p)
            + `<path d="M27.5 35.5q4.5 3.5 9 0" stroke="#7A3E2B" stroke-width="1.6" fill="none" stroke-linecap="round"/>`
            + `</svg>`;
    }

    // ---------------------------------------------------------------------
    // Duplas: escudo con degradado y un icono de playa
    // ---------------------------------------------------------------------

    const TEAM_PRESETS = [
        { id: 't1', from: '#FF7B54', to: '#FF4B4B', icon: '🏐' },
        { id: 't2', from: '#4B9BFF', to: '#2C5FA8', icon: '🌊' },
        { id: 't3', from: '#FFD56F', to: '#F39C12', icon: '☀️' },
        { id: 't4', from: '#93E4C1', to: '#27AE60', icon: '🌴' },
        { id: 't5', from: '#C3B1E1', to: '#7D5BA6', icon: '⚡' },
        { id: 't6', from: '#FF9F43', to: '#E8653F', icon: '🔥' },
        { id: 't7', from: '#2C363F', to: '#57606F', icon: '👑' },
        { id: 't8', from: '#48DBFB', to: '#0ABDE3', icon: '🐬' },
        { id: 't9', from: '#FFB3A7', to: '#FF6B81', icon: '🦀' },
        { id: 't10', from: '#7BED9F', to: '#2ED573', icon: '🥥' }
    ];

    function teamSvg(p) {
        const gradient = `g-${p.id}`;
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`
            + `<defs><linearGradient id="${gradient}" x1="0" y1="0" x2="1" y2="1">`
            + `<stop offset="0" stop-color="${p.from}"/><stop offset="1" stop-color="${p.to}"/></linearGradient></defs>`
            + `<path d="M32 4l24 8v18c0 15-10 25-24 30C18 55 8 45 8 30V12z" fill="url(#${gradient})" stroke="#FFFFFF" stroke-width="3" stroke-linejoin="round"/>`
            + `<text x="32" y="40" font-size="24" text-anchor="middle">${p.icon}</text>`
            + `</svg>`;
    }

    // ---------------------------------------------------------------------
    // API
    // ---------------------------------------------------------------------

    /** Claves iguales a las de la biblioteca de fotos (`VP.photos.KIND`). */
    const PRESETS = { players: PLAYER_PRESETS, teams: TEAM_PRESETS };
    const BY_ID = new Map([
        ...PLAYER_PRESETS.map((p) => [p.id, () => playerSvg(p)]),
        ...TEAM_PRESETS.map((p) => [p.id, () => teamSvg(p)])
    ]);
    const dataUrlCache = new Map();

    /** IDs de los avatares de ejemplo de un tipo ('players' | 'teams'). */
    const list = (kind) => (PRESETS[kind] || []).map((p) => p.id);

    const exists = (id) => BY_ID.has(id);

    /** Marcado SVG de un avatar (o '' si no existe). */
    const getSvg = (id) => (exists(id) ? BY_ID.get(id)() : '');

    /** Data URL listo para `<img src>`. */
    function getDataUrl(id) {
        if (!exists(id)) return '';
        if (!dataUrlCache.has(id)) {
            dataUrlCache.set(id, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(getSvg(id))}`);
        }
        return dataUrlCache.get(id);
    }

    /**
     * Avatar asignado por defecto a un nombre: siempre el mismo para el mismo
     * nombre (sin distinguir mayúsculas ni espacios), y repartidos entre todos.
     */
    function getDefaultId(kind, name) {
        const ids = list(kind);
        return ids[hashString(nameKey(name)) % ids.length];
    }

    const toRef = (id) => `${AVATAR_PREFIX}${id}`;

    /** ID de una referencia `avatar:<id>` válida, o `null`. */
    function fromRef(value) {
        if (typeof value !== 'string' || !value.startsWith(AVATAR_PREFIX)) return null;
        const id = value.slice(AVATAR_PREFIX.length);
        return exists(id) ? id : null;
    }

    VP.avatars = Object.freeze({ AVATAR_PREFIX, list, exists, getSvg, getDataUrl, getDefaultId, toRef, fromRef });

    if (typeof module !== 'undefined' && module.exports) module.exports = VP.avatars;
})(typeof window !== 'undefined' ? window : globalThis);
