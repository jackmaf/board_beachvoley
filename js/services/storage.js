/**
 * @file storage.js
 * @description Única puerta de acceso a `localStorage`.
 *
 * Antes, `JSON.parse(localStorage.getItem('voley-tournaments'))` se repetía
 * más de 10 veces por el código. Ahora todo pasa por aquí, lo que aporta:
 *  - Tolerancia a fallos: si el JSON está corrupto o el navegador bloquea el
 *    almacenamiento (modo privado), se devuelve un valor por defecto en vez
 *    de romper la app.
 *  - Un único lugar para cambiar el mecanismo de persistencia en el futuro
 *    (IndexedDB, backend…).
 *  - Copia de seguridad (exportar/importar) de todos los datos.
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { STORAGE_KEYS } = VP.constants;

    /**
     * Versión del formato de copia de seguridad.
     * v2 añade `data.photos`; las copias v1 (sin fotos) se siguen importando.
     */
    const BACKUP_VERSION = 2;

    /**
     * Lee y parsea una clave. Nunca lanza excepciones.
     * @template T
     * @param {string} key
     * @param {T} fallback Valor si la clave no existe o es inválida.
     * @returns {T}
     */
    function read(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch (error) {
            console.warn(`[storage] No se pudo leer "${key}":`, error);
            return fallback;
        }
    }

    /**
     * Serializa y guarda un valor.
     * @returns {boolean} `false` si falló (p. ej. cuota de almacenamiento llena).
     */
    function write(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error(`[storage] No se pudo guardar "${key}":`, error);
            return false;
        }
    }

    function remove(key) {
        try {
            localStorage.removeItem(key);
        } catch (error) {
            console.warn(`[storage] No se pudo borrar "${key}":`, error);
        }
    }

    // ---------------------------------------------------------------------
    // Partido en curso / último partido / historial
    // ---------------------------------------------------------------------

    const getCurrentMatch = () => read(STORAGE_KEYS.CURRENT_MATCH, null);
    const saveCurrentMatch = (match) => write(STORAGE_KEYS.CURRENT_MATCH, match);

    const getLastMatch = () => read(STORAGE_KEYS.LAST_MATCH, null);
    const saveLastMatch = (match) => write(STORAGE_KEYS.LAST_MATCH, match);

    /** @returns {Array} Partidos finalizados, del más antiguo al más reciente. */
    const getHistory = () => {
        const history = read(STORAGE_KEYS.HISTORY, []);
        return Array.isArray(history) ? history : [];
    };

    /** Añade un partido finalizado al historial y lo marca como "último partido". */
    function archiveMatch(match) {
        const history = getHistory();
        history.push(match);
        write(STORAGE_KEYS.HISTORY, history);
        saveLastMatch(match);
    }

    /** Elimina un partido del historial por su posición. */
    function removeFromHistory(index) {
        const history = getHistory();
        history.splice(index, 1);
        write(STORAGE_KEYS.HISTORY, history);
    }

    // ---------------------------------------------------------------------
    // Torneos
    // ---------------------------------------------------------------------

    /** @returns {Array} Todos los torneos guardados. */
    const getTournaments = () => {
        const list = read(STORAGE_KEYS.TOURNAMENTS, []);
        return Array.isArray(list) ? list : [];
    };

    const saveTournaments = (list) => write(STORAGE_KEYS.TOURNAMENTS, list);

    const getTournament = (id) => getTournaments().find((t) => t.id === id) || null;

    function addTournament(tournament) {
        const list = getTournaments();
        list.push(tournament);
        saveTournaments(list);
    }

    /**
     * Lee un torneo, lo modifica con `mutator` y lo guarda.
     * Patrón "leer → modificar → guardar" en un solo paso para no olvidar persistir.
     *
     * @template R
     * @param {string} id
     * @param {(tournament:Object) => R} mutator Recibe el torneo y lo modifica in situ.
     * @returns {{tournament:Object, result:R} | null} `null` si no existe.
     */
    function updateTournament(id, mutator) {
        const list = getTournaments();
        const tournament = list.find((t) => t.id === id);
        if (!tournament) return null;
        const result = mutator(tournament);
        saveTournaments(list);
        return { tournament, result };
    }

    function deleteTournament(id) {
        saveTournaments(getTournaments().filter((t) => t.id !== id));
    }

    // ---------------------------------------------------------------------
    // Fotos de jugadores y duplas
    // ---------------------------------------------------------------------

    /*
     * Van en una clave PROPIA (y no dentro de cada partido o torneo) por dos motivos:
     *  - Un jugador juega muchos partidos: guardar su foto en cada uno la
     *    duplicaría en el historial y agotaría enseguida los ~5 MB de localStorage.
     *  - Si la cuota se llena, falla sólo la foto, nunca el guardado del partido.
     */

    /** @returns {{players:Object<string,string>, teams:Object<string,string>}} nombre normalizado → data URL. */
    function getPhotos() {
        const photos = read(STORAGE_KEYS.PHOTOS, null);
        const isMap = (value) => value && typeof value === 'object' && !Array.isArray(value);
        return {
            players: isMap(photos?.players) ? photos.players : {},
            teams: isMap(photos?.teams) ? photos.teams : {}
        };
    }

    /** @returns {boolean} `false` si no cupo (cuota de almacenamiento llena). */
    const savePhotos = (photos) => write(STORAGE_KEYS.PHOTOS, photos);

    // ---------------------------------------------------------------------
    // Preferencias
    // ---------------------------------------------------------------------

    /*
     * El tema se guarda como texto plano (no JSON) para mantener
     * compatibilidad con las versiones anteriores de la app.
     */
    function getTheme() {
        try {
            return localStorage.getItem(STORAGE_KEYS.THEME) || 'classic';
        } catch {
            return 'classic';
        }
    }

    function saveTheme(theme) {
        try {
            localStorage.setItem(STORAGE_KEYS.THEME, theme);
        } catch (error) {
            console.warn('[storage] No se pudo guardar el tema:', error);
        }
    }

    // ---------------------------------------------------------------------
    // Borrado total y copia de seguridad
    // ---------------------------------------------------------------------

    /**
     * Borra TODOS los datos de juego (partidos, historial, torneos y fotos).
     * El tema visual se conserva porque es una preferencia, no un dato.
     */
    function clearAllData() {
        [
            STORAGE_KEYS.CURRENT_MATCH,
            STORAGE_KEYS.LAST_MATCH,
            STORAGE_KEYS.HISTORY,
            STORAGE_KEYS.TOURNAMENTS,
            STORAGE_KEYS.PHOTOS
        ].forEach(remove);
    }

    /** Objeto serializable con todos los datos de la app. */
    function exportBackup() {
        return {
            app: 'voley-playa-scout',
            version: BACKUP_VERSION,
            exportedAt: new Date().toISOString(),
            data: {
                currentMatch: getCurrentMatch(),
                lastMatch: getLastMatch(),
                history: getHistory(),
                tournaments: getTournaments(),
                photos: getPhotos()
            }
        };
    }

    /**
     * Restaura una copia de seguridad (reemplaza los datos actuales).
     * @returns {{ok:true, warning?:string} | {ok:false, error:string}}
     */
    function importBackup(backup) {
        if (!backup || backup.app !== 'voley-playa-scout' || !backup.data) {
            return { ok: false, error: 'El archivo no es una copia de seguridad de Voley Playa Scout.' };
        }
        const { currentMatch, lastMatch, history, tournaments, photos } = backup.data;
        if (!Array.isArray(history) || !Array.isArray(tournaments)) {
            return { ok: false, error: 'La copia de seguridad está incompleta o dañada.' };
        }
        clearAllData();
        if (currentMatch) saveCurrentMatch(currentMatch);
        if (lastMatch) saveLastMatch(lastMatch);
        write(STORAGE_KEYS.HISTORY, history);
        saveTournaments(tournaments);
        // Las fotos van al final: si no caben, al menos los partidos ya están restaurados
        if (photos && !savePhotos(photos)) {
            return { ok: true, warning: 'Los datos se importaron, pero las fotos no cupieron en el almacenamiento.' };
        }
        return { ok: true };
    }

    VP.storage = Object.freeze({
        getCurrentMatch,
        saveCurrentMatch,
        getLastMatch,
        getHistory,
        archiveMatch,
        removeFromHistory,
        getTournaments,
        getTournament,
        addTournament,
        updateTournament,
        deleteTournament,
        getPhotos,
        savePhotos,
        getTheme,
        saveTheme,
        clearAllData,
        exportBackup,
        importBackup
    });
})(typeof window !== 'undefined' ? window : globalThis);
