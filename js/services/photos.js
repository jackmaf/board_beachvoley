/**
 * @file photos.js
 * @description Fotos y avatares de los jugadores y duplas.
 *
 * - Se guardan EN EL DISPOSITIVO (localStorage, vía `storage.js`), indexadas
 *   por nombre normalizado: la foto de «Juan Pérez» aparece en todos sus
 *   partidos y torneos sin duplicarse en el historial.
 * - Cada entrada es una foto (data URL JPEG, recortada a `PHOTO.size` px: una
 *   foto de 4 MB del móvil queda en ~20 KB) o la referencia `avatar:<id>` a un
 *   avatar de ejemplo elegido a mano (`core/avatars.js`).
 * - Si un nombre no tiene nada guardado se usa su avatar de ejemplo POR DEFECTO
 *   (siempre el mismo para ese nombre), así que el resto de la app no tiene que
 *   distinguir los casos y todo funciona sin conexión.
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    /** Traducción en el momento de usarse (los mensajes siguen el idioma activo). */
    const t = (key, params) => VP.i18n.t(key, params);
    const { nameKey, getSquareCrop } = VP.utils;
    const { PHOTO } = VP.constants;
    const avatars = VP.avatars;

    /** Tipos de foto (también son las claves de la biblioteca guardada). */
    const KIND = Object.freeze({ PLAYER: 'players', TEAM: 'teams' });

    /** Copia en memoria de la biblioteca (se lee de storage una sola vez). */
    let library = null;

    /*
     * URLs `blob:` por foto y por avatar. Un data URL pesa de 2 a 20 KB de texto:
     * repetirlo en cada fila de la bitácora (cientos) haría enormes los `innerHTML`.
     * Un blob URL es una cadena corta que apunta a la misma imagen ya decodificada.
     */
    const objectUrls = new Map();

    function load() {
        if (!library) library = VP.storage.getPhotos();
        return library;
    }
    const cacheId = (kind, key) => `${kind}:${key}`;

    function forgetObjectUrl(kind, key) {
        const id = cacheId(kind, key);
        const url = objectUrls.get(id);
        if (url) URL.revokeObjectURL(url);
        objectUrls.delete(id);
    }

    /** Convierte un data URL base64 en blob URL de forma síncrona (para usarlo al pintar). */
    function toObjectUrl(dataUrl) {
        const [header, base64] = dataUrl.split(',');
        const mime = /data:([^;]+)/.exec(header)?.[1] || 'image/jpeg';
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        return URL.createObjectURL(new Blob([bytes], { type: mime }));
    }

    /** Blob URL (cacheado) de un avatar de ejemplo. */
    function avatarObjectUrl(id) {
        const cache = cacheId('avatar', id);
        if (!objectUrls.has(cache)) {
            try {
                objectUrls.set(cache, URL.createObjectURL(new Blob([avatars.getSvg(id)], { type: 'image/svg+xml' })));
            } catch {
                return avatars.getDataUrl(id);
            }
        }
        return objectUrls.get(cache);
    }

    // ---------------------------------------------------------------------
    // Biblioteca
    // ---------------------------------------------------------------------

    /** Valor guardado tal cual (data URL o `avatar:<id>`), o `null`. */
    function getStored(kind, name) {
        const key = nameKey(name);
        return (key && load()[kind][key]) || null;
    }

    /**
     * Convierte un valor guardado (o pendiente en un formulario) en data URL
     * apto para `<img src>`: la foto tal cual o el SVG del avatar elegido.
     * @param {string|null} value
     * @returns {string|null} `null` si no hay valor o es una referencia rota.
     */
    function resolve(value) {
        if (!value) return null;
        const avatarId = avatars.fromRef(value);
        if (avatarId) return avatars.getDataUrl(avatarId);
        return value.startsWith(avatars.AVATAR_PREFIX) ? null : value;
    }

    /**
     * Imagen elegida por el usuario (foto o avatar) como data URL, o `null` si
     * ese nombre usa el avatar por defecto.
     * @param {'players'|'teams'} kind
     * @param {string} name
     * @returns {string|null}
     */
    const get = (kind, name) => resolve(getStored(kind, name));

    /** ¿El usuario eligió foto o avatar para este nombre? */
    const has = (kind, name) => Boolean(get(kind, name));

    /** Data URL del avatar por defecto de un nombre. */
    const getDefault = (kind, name) => avatars.getDataUrl(avatars.getDefaultId(kind, name));

    /**
     * Guarda (o reemplaza) la imagen de un nombre.
     * @param {string} value Data URL de una foto o referencia `avatar:<id>`.
     * @returns {boolean} `false` si el nombre está vacío o no cupo en el almacenamiento.
     */
    function set(kind, name, value) {
        const key = nameKey(name);
        if (!key || !resolve(value)) return false;
        const photos = load();
        const previous = photos[kind][key];
        photos[kind][key] = value;
        if (!VP.storage.savePhotos(photos)) {
            // Deshacer en memoria para no mostrar una foto que no se guardó
            if (previous) photos[kind][key] = previous;
            else delete photos[kind][key];
            return false;
        }
        forgetObjectUrl(kind, key);
        return true;
    }

    /** Quita la imagen elegida de un nombre (vuelve a verse su avatar por defecto). */
    function remove(kind, name) {
        const key = nameKey(name);
        const photos = load();
        if (!key || !photos[kind][key]) return true;
        delete photos[kind][key];
        forgetObjectUrl(kind, key);
        return VP.storage.savePhotos(photos);
    }

    /**
     * URL corta (`blob:`) lista para un `<img src>`: la foto subida, el avatar
     * elegido o, si no hay nada, el avatar por defecto del nombre.
     * @param {'players'|'teams'} kind
     * @param {string} name
     */
    function src(kind, name) {
        const stored = getStored(kind, name);
        const avatarId = avatars.fromRef(stored) || (resolve(stored) ? null : avatars.getDefaultId(kind, name));
        if (avatarId) return avatarObjectUrl(avatarId);

        const id = cacheId(kind, nameKey(name));
        if (!objectUrls.has(id)) {
            try {
                objectUrls.set(id, toObjectUrl(stored));
            } catch {
                return stored; // Navegador sin Blob/atob: el data URL también sirve
            }
        }
        return objectUrls.get(id);
    }

    /**
     * Como `src` pero siempre data URL. Para lo que se exporta (html2pdf no
     * siempre puede leer URLs `blob:`).
     */
    const dataSrc = (kind, name) => get(kind, name) || getDefault(kind, name);

    // ---------------------------------------------------------------------
    // Procesado de la imagen elegida
    // ---------------------------------------------------------------------

    const readAsDataUrl = (file) =>
        new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error(t('errors.readFile')));
            reader.readAsDataURL(file);
        });

    const decodeImage = (url) =>
        new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(t('photos.unsupported')));
            img.src = url;
        });

    /**
     * Lee una imagen elegida por el usuario y la deja lista para guardar:
     * recorte cuadrado centrado, `PHOTO.size` px como máximo y JPEG comprimido.
     *
     * Se lee con FileReader (data URL) y no con un blob URL porque, abriendo la
     * app con `file://`, algunos navegadores marcarían el canvas como «contaminado»
     * y `toDataURL` fallaría. La orientación EXIF la aplica el propio navegador.
     *
     * @param {File} file
     * @returns {Promise<string>} data URL JPEG.
     */
    async function processFile(file) {
        if (!file) throw new Error(t('photos.noFile'));
        if (file.type && !file.type.startsWith('image/')) throw new Error(t('photos.notImage'));
        if (file.size > PHOTO.maxFileBytes) throw new Error(t('photos.tooBig', { max: Math.round(PHOTO.maxFileBytes / 1024 / 1024) }));

        const img = await decodeImage(await readAsDataUrl(file));
        const crop = getSquareCrop(img.naturalWidth, img.naturalHeight, PHOTO.size);

        const canvas = document.createElement('canvas');
        canvas.width = crop.output;
        canvas.height = crop.output;
        const ctx = canvas.getContext('2d');
        // JPEG no tiene transparencia: un logo PNG quedaría con fondo negro
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, crop.output, crop.output);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, crop.sx, crop.sy, crop.side, crop.side, 0, 0, crop.output, crop.output);
        return canvas.toDataURL('image/jpeg', PHOTO.quality);
    }

    VP.photos = Object.freeze({
        KIND,
        get,
        getStored,
        has,
        resolve,
        getDefault,
        set,
        remove,
        src,
        dataSrc,
        processFile,
        /** Atajos para las vistas. */
        playerSrc: (name) => src(KIND.PLAYER, name),
        teamSrc: (name) => src(KIND.TEAM, name)
    });
})(window);
