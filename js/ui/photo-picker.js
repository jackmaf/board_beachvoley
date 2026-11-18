/**
 * @file photo-picker.js
 * @description Selector de foto que acompaña a un input de nombre
 * (jugador o dupla). Clona `<template id="tpl-photo-picker">` y lo coloca a la
 * izquierda del input:
 *
 *     [📷] [ Juan Pérez            ]
 *
 * Flujo:
 *  - Al tocar el círculo se abre la galería / cámara del móvil (`accept="image/*"`).
 *  - La foto elegida queda PENDIENTE: no se guarda hasta que el formulario se
 *    envía (`commit`). Así, cancelar un formulario no deja fotos sueltas.
 *  - Mientras no haya cambios pendientes, el selector muestra la foto ya guardada
 *    del nombre escrito: al teclear «Juan Pérez» aparece su foto si la tiene.
 *  - Como la foto va ligada al nombre, si se pide una foto y luego se corrige el
 *    nombre, la foto pendiente se guarda con el nombre corregido.
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { byId, qs } = VP.dom;
    const photos = VP.photos;

    /** Estado de cada selector, indexado por su input de nombre. */
    const pickers = new WeakMap();

    /** Texto accesible a partir de la etiqueta del input («Jugador 1», «Dupla 2, jugador 1»…). */
    function describe(input) {
        const text = input.getAttribute('aria-label') || input.labels?.[0]?.textContent || input.placeholder || '';
        return text.replace(/\s+/g, ' ').trim();
    }

    /** Pinta el selector con una foto (data URL) o el icono vacío. */
    function show(state, dataUrl) {
        if (dataUrl) state.img.src = dataUrl;
        else state.img.removeAttribute('src');
        state.img.hidden = !dataUrl;
        state.placeholder.hidden = Boolean(dataUrl);
        state.remove.hidden = !dataUrl;
        state.frame.classList.toggle('photo-picker__frame--filled', Boolean(dataUrl));
        state.frame.title = dataUrl ? 'Cambiar foto' : 'Subir foto';
    }

    /** Muestra la foto guardada del nombre escrito (si no hay cambios pendientes). */
    function syncWithName(state) {
        if (!state.dirty) show(state, photos.get(state.kind, state.input.value));
    }

    async function handleFile(state) {
        const [file] = state.file.files;
        state.file.value = ''; // Permite volver a elegir el mismo archivo
        if (!file) return;

        state.frame.classList.add('photo-picker__frame--loading');
        try {
            state.pending = await photos.processFile(file);
            state.dirty = true;
            show(state, state.pending);
        } catch (error) {
            VP.feedback.toast(error.message, { type: 'error' });
        } finally {
            state.frame.classList.remove('photo-picker__frame--loading');
        }
    }

    function handleRemove(state) {
        state.pending = null;
        state.dirty = true;
        show(state, null);
        state.file.focus();
    }

    /**
     * Añade un selector de foto delante de un input de nombre.
     * Envuelve el input en `.photo-field` para alinearlos. Es idempotente.
     *
     * @param {HTMLInputElement} input
     * @param {'players'|'teams'} kind `VP.photos.KIND.PLAYER` o `KIND.TEAM`.
     */
    function attach(input, kind) {
        if (!input || pickers.has(input)) return;

        const field = document.createElement('div');
        field.className = 'photo-field';
        input.before(field);
        field.append(byId('tpl-photo-picker').content.cloneNode(true), input);
        input.classList.add('photo-field__input');

        const picker = qs('.photo-picker', field);
        const state = {
            input,
            kind,
            frame: qs('.photo-picker__frame', picker),
            img: qs('.photo-picker__img', picker),
            placeholder: qs('.photo-picker__placeholder', picker),
            file: qs('.photo-picker__file', picker),
            remove: qs('.photo-picker__remove', picker),
            dirty: false,
            pending: null
        };
        if (kind === photos.KIND.TEAM) state.frame.classList.add('photo-picker__frame--team');
        pickers.set(input, state);
        setLabel(input);

        state.file.addEventListener('change', () => handleFile(state));
        state.remove.addEventListener('click', () => handleRemove(state));
        input.addEventListener('input', () => syncWithName(state));
        syncWithName(state);
    }

    /**
     * Actualiza las etiquetas accesibles (útil cuando cambia el aria-label del input,
     * p. ej. al renumerar las duplas del formulario de torneo).
     * @param {HTMLInputElement} input
     * @param {string} [text] Por defecto se deduce de la etiqueta del input.
     */
    function setLabel(input, text) {
        const state = pickers.get(input);
        if (!state) return;
        const what = text || describe(input) || 'nombre';
        state.file.setAttribute('aria-label', `Foto: ${what}`);
        state.remove.setAttribute('aria-label', `Quitar foto: ${what}`);
    }

    /**
     * Descarta cambios pendientes y muestra la foto guardada del nombre actual.
     * Llamar después de rellenar o resetear el formulario por código (eso no
     * dispara el evento `input`).
     * @param {...HTMLInputElement} inputs
     */
    function refresh(...inputs) {
        inputs.forEach((input) => {
            const state = pickers.get(input);
            if (!state) return;
            state.dirty = false;
            state.pending = null;
            syncWithName(state);
        });
    }

    /**
     * Guarda (o borra) la foto pendiente con el nombre definitivo.
     * @param {HTMLInputElement} input
     * @param {string} [name] Nombre final si difiere del escrito (p. ej. un valor
     *   por defecto como «Equipo A» o «Pedro / Juan»). Vacío = no se guarda nada.
     * @returns {boolean} `false` si la foto no cupo en el almacenamiento.
     */
    function commit(input, name = input.value) {
        const state = pickers.get(input);
        if (!state || !state.dirty) return true;
        state.dirty = false;
        if (!String(name).trim()) return true;
        const ok = state.pending ? photos.set(state.kind, name, state.pending) : photos.remove(state.kind, name);
        if (!ok) {
            VP.feedback.toast(`No queda espacio en el dispositivo para la foto de «${name}». Prueba a quitar otras fotos.`, {
                type: 'warning',
                duration: 6000
            });
        }
        state.pending = null;
        return ok;
    }

    VP.photoPicker = Object.freeze({ attach, setLabel, refresh, commit });
})(window);
