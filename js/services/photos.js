/**
 * @file photos.js
 * @description Fotos que el usuario sube para sus jugadores y duplas.
 *
 * - Se guardan EN EL DISPOSITIVO (localStorage, vía `storage.js`), indexadas
 *   por nombre normalizado: la foto de «Juan Pérez» aparece en todos sus
 *   partidos y torneos sin duplicarse en el historial.
 * - Antes de guardarlas se recortan en cuadrado y se reducen a JPEG de
 *   `PHOTO.size` px: una foto de 4 MB del móvil queda en ~20 KB.
 * - Si un nombre no tiene foto se usa el avatar generado de siempre (DiceBear),
 *   así que el resto de la app no tiene que distinguir los dos casos.
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    /** Traducción en el momento de usarse (los mensajes siguen el idioma activo). */
    const t = (key, params) => VP.i18n.t(key, params);
    const { nameKey, getSquareCrop, getAvatarUrl, getTeamLogoUrl } = VP.utils;
    const { PHOTO } = VP.constants;

    /** Tipos de foto (también son las claves de la biblioteca guardada). */
    const KIND = Object.freeze({ PLAYER: 'players', TEAM: 'teams' });

    /** Copia en memoria de la biblioteca (se lee de storage una sola vez). */
    let library = null;

    /*
     * URLs `blob:` por foto. Un data URL pesa ~20 KB de texto: repetirlo en cada
     * fila de la bitácora (cientos) haría enormes los `innerHTML`. Un blob URL es
     * una cadena corta que apunta a la misma imagen ya decodificada.
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

    /** Convierte un data URL en blob URL de forma síncrona (para usarlo al pintar). */
    function toObjectUrl(dataUrl) {
        const [header, base64] = dataUrl.split(',');
        const mime = /data:([^;]+)/.exec(header)?.[1] || 'image/jpeg';
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        return URL.createObjectURL(new Blob([bytes], { type: mime }));
    }

    // ---------------------------------------------------------------------
    // Biblioteca
    // ---------------------------------------------------------------------

    /**
     * Foto original (data URL) de un nombre.
     * @param {'players'|'teams'} kind
     * @param {string} name
     * @returns {string|null}
     */
    function get(kind, name) {
        const key = nameKey(name);
        return (key && load()[kind][key]) || null;
    }

    const has = (kind, name) => Boolean(get(kind, name));

    /**
     * Guarda (o reemplaza) la foto de un nombre.
     * @returns {boolean} `false` si el nombre está vacío o no cupo en el almacenamiento.
     */
    function set(kind, name, dataUrl) {
        const key = nameKey(name);
        if (!key || !dataUrl) return false;
        const photos = load();
        const previous = photos[kind][key];
        photos[kind][key] = dataUrl;
        if (!VP.storage.savePhotos(photos)) {
            // Deshacer en memoria para no mostrar una foto que no se guardó
            if (previous) photos[kind][key] = previous;
            else delete photos[kind][key];
            return false;
        }
        forgetObjectUrl(kind, key);
        return true;
    }

    /** Quita la foto de un nombre (vuelve a verse el avatar generado). */
    function remove(kind, name) {
        const key = nameKey(name);
        const photos = load();
        if (!key || !photos[kind][key]) return true;
        delete photos[kind][key];
        forgetObjectUrl(kind, key);
        return VP.storage.savePhotos(photos);
    }

    /**
     * URL lista para un `<img src>`: la foto subida o, si no hay, el avatar generado.
     * @param {'players'|'teams'} kind
     * @param {string} name
     */
    function src(kind, name) {
        const key = nameKey(name);
        const dataUrl = key && load()[kind][key];
        if (!dataUrl) return kind === KIND.TEAM ? getTeamLogoUrl(name) : getAvatarUrl(name);

        const id = cacheId(kind, key);
        if (!objectUrls.has(id)) {
            try {
                objectUrls.set(id, toObjectUrl(dataUrl));
            } catch {
                return dataUrl; // Navegador sin Blob/atob: el data URL también sirve
            }
        }
        return objectUrls.get(id);
    }

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
        has,
        set,
        remove,
        src,
        processFile,
        /** Atajos para las vistas. */
        playerSrc: (name) => src(KIND.PLAYER, name),
        teamSrc: (name) => src(KIND.TEAM, name),
        hasTeam: (name) => has(KIND.TEAM, name)
    });
})(window);
