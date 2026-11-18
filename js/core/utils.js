/**
 * @file utils.js
 * @description Funciones auxiliares puras (sin DOM ni estado) reutilizadas en
 * toda la aplicación: escapado de HTML, formato de tiempo, conversión de
 * coordenadas, generación de IDs, avatares, CSV…
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { COURT_METERS, TEAM_EMOJIS } = VP.constants;

    /**
     * Escapa caracteres especiales de HTML.
     *
     * IMPORTANTE: todo texto que escriba el usuario (nombres de equipos,
     * jugadores, torneos) DEBE pasar por aquí antes de insertarse con
     * `innerHTML`. Evita inyección de HTML/JS (XSS) y que un apóstrofe
     * en "D'Angelo" rompa el marcado.
     *
     * @param {unknown} value Valor a mostrar.
     * @returns {string} Texto seguro para interpolar en HTML.
     */
    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Convierte segundos en formato reloj `mm:ss` (o `h:mm:ss` si supera una hora).
     * @param {number} totalSeconds
     * @returns {string}
     */
    function formatDuration(totalSeconds) {
        const safe = Math.max(0, Math.floor(totalSeconds || 0));
        const hours = Math.floor(safe / 3600);
        const minutes = Math.floor((safe % 3600) / 60);
        const seconds = safe % 60;
        const mm = String(minutes).padStart(2, '0');
        const ss = String(seconds).padStart(2, '0');
        return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
    }

    /**
     * Minuto "humano" (empieza en 1) en el que ocurrió una acción.
     * @param {number} matchSecond Segundo del cronómetro oficial.
     */
    function toMatchMinute(matchSecond) {
        return Math.floor((matchSecond || 0) / 60) + 1;
    }

    /**
     * Convierte coordenadas en % de la cancha a metros reales.
     * La cancha mide 8 m de ancho (eje X) y 16 m de largo (eje Y).
     * @param {{x:number, y:number}} coords Porcentajes (pueden salir de 0-100 si el balón cayó fuera).
     * @returns {{x:number, y:number}} Metros.
     */
    function percentToMeters(coords) {
        return {
            x: (coords.x / 100) * COURT_METERS.width,
            y: (coords.y / 100) * COURT_METERS.length
        };
    }

    /**
     * Hash numérico determinista de un texto (algoritmo djb2 simplificado).
     * Sirve para que el mismo nombre obtenga siempre el mismo emoji.
     * @param {string} text
     * @returns {number} Entero positivo.
     */
    function hashString(text) {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            hash = text.charCodeAt(i) + ((hash << 5) - hash);
            hash |= 0; // Fuerza entero de 32 bits para evitar desbordes
        }
        return Math.abs(hash);
    }

    /** Emoji identificativo y estable para una dupla. */
    function pickTeamEmoji(teamName) {
        return TEAM_EMOJIS[hashString(String(teamName)) % TEAM_EMOJIS.length];
    }

    /**
     * Genera un identificador único y legible.
     * Combina timestamp + aleatorio para no colisionar si se crean varios en el mismo milisegundo.
     * @param {string} [prefix]
     */
    function createId(prefix = 'id') {
        const random = Math.random().toString(36).slice(2, 8);
        return `${prefix}_${Date.now()}_${random}`;
    }

    /**
     * URL del avatar de un jugador (servicio DiceBear, SVG generado a partir del nombre).
     * Heurística original del proyecto: los nombres terminados en "a" usan la
     * colección "lorelei" y el resto "adventurer". Es solo estética.
     * @param {string} name
     */
    function getAvatarUrl(name) {
        if (!name) return '';
        const firstName = String(name).trim().split(' ')[0].toLowerCase();
        const seed = encodeURIComponent(name);
        return firstName.endsWith('a')
            ? `https://api.dicebear.com/7.x/lorelei/svg?seed=${seed}&backgroundColor=ffdfbf`
            : `https://api.dicebear.com/7.x/adventurer/svg?seed=${seed}&backgroundColor=b6e3f4`;
    }

    /** URL del logo abstracto (formas geométricas) de un equipo. */
    function getTeamLogoUrl(teamName) {
        if (!teamName) return '';
        return `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(teamName)}&backgroundColor=ffffff`;
    }

    /**
     * Escapa una celda para CSV (RFC 4180): si contiene comas, comillas o
     * saltos de línea se envuelve en comillas dobles y se duplican las internas.
     */
    function toCsvCell(value) {
        const text = String(value ?? '');
        return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    /** Convierte una lista de filas (arrays) en texto CSV. */
    function toCsv(rows) {
        return rows.map((row) => row.map(toCsvCell).join(',')).join('\n');
    }

    /** Convierte un texto en un nombre de archivo seguro ("Juan Pérez" → "Juan_Perez"). */
    function slugify(text) {
        return String(text || 'archivo')
            .normalize('NFD').replace(/[̀-ͯ]/g, '') // Quita tildes
            .replace(/[^\w-]+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
    }

    /**
     * Retrasa la ejecución de `fn` hasta que pasen `wait` ms sin nuevas llamadas.
     * Útil para inputs que recalculan estadísticas en cada tecla.
     */
    function debounce(fn, wait = 250) {
        let timer = null;
        return function debounced(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    /** Copia profunda de datos serializables (los que guardamos en localStorage). */
    function deepClone(data) {
        return JSON.parse(JSON.stringify(data));
    }

    /** Convierte a entero con valor por defecto si no es un número válido. */
    function toInt(value, fallback) {
        const parsed = parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    VP.utils = Object.freeze({
        escapeHtml,
        formatDuration,
        toMatchMinute,
        percentToMeters,
        hashString,
        pickTeamEmoji,
        createId,
        getAvatarUrl,
        getTeamLogoUrl,
        toCsvCell,
        toCsv,
        slugify,
        debounce,
        deepClone,
        toInt
    });

    if (typeof module !== 'undefined' && module.exports) module.exports = VP.utils;
})(typeof window !== 'undefined' ? window : globalThis);
