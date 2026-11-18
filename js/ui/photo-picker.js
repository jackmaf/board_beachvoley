/**
 * @file photo-picker.js
 * @description Selector de imagen que acompaña a un input de nombre
 * (jugador o dupla). Clona `<template id="tpl-photo-picker">` y lo coloca a la
 * izquierda del input:
 *
 *     [🙂] [ Juan Pérez            ]
 *
 * Al tocar el círculo se abre el diálogo `#photo-dialog` con:
 *  - 📸 Tomar foto: `capture="environment"` abre DIRECTAMENTE la cámara. Hace
 *    falta un input aparte: en Android reciente, `accept="image/*"` a secas abre
 *    el selector de fotos del sistema, que no ofrece la cámara.
 *  - 🖼️ Galería: input sin `capture` (fotos ya hechas o archivos).
 *  - Avatares de ejemplo para elegir uno a mano.
 *  - Quitar: vuelve al avatar por defecto.
 *
 * Flujo:
 *  - Sin nada elegido, el círculo muestra el avatar POR DEFECTO de ese nombre
 *    (cambia al teclear, porque depende del nombre) con un distintivo 📷.
 *  - Lo elegido queda PENDIENTE: no se guarda hasta que el formulario se
 *    envía (`commit`). Así, cancelar un formulario no deja fotos sueltas.
 *  - Mientras no haya cambios pendientes, el selector muestra lo ya guardado
 *    para el nombre escrito: al teclear «Juan Pérez» aparece su foto si la tiene.
 *  - Como la foto va ligada al nombre, si se elige una y luego se corrige el
 *    nombre, se guarda con el nombre corregido.
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { byId, qs, qsa, openModal, closeModal } = VP.dom;
    const photos = VP.photos;
    const avatars = VP.avatars;
    const { t } = VP.i18n;

    /** Estado de cada selector, indexado por su input de nombre. */
    const pickers = new WeakMap();

    /** Selector cuyo diálogo está abierto. */
    let active = null;

    /** Referencias del diálogo compartido (se rellenan la primera vez). */
    let dialog = null;

    /** Texto accesible a partir de la etiqueta del input («Jugador 1», «Dupla 2, jugador 1»…). */
    function describe(input) {
        const text = input.getAttribute('aria-label') || input.labels?.[0]?.textContent || input.placeholder || '';
        return text.replace(/\s+/g, ' ').trim();
    }

    /** Lo que muestra ahora el selector: lo pendiente o, si no hay cambios, lo guardado. */
    const currentValue = (state) => (state.dirty ? state.pending : photos.getStored(state.kind, state.input.value));

    /** Pinta el selector: imagen elegida, avatar por defecto o icono vacío. */
    function render(state) {
        const chosen = photos.resolve(currentValue(state));
        const hasName = Boolean(state.input.value.trim());
        const image = chosen || (hasName ? photos.getDefault(state.kind, state.input.value) : null);

        if (image) state.img.src = image;
        else state.img.removeAttribute('src');
        state.img.hidden = !image;
        state.placeholder.hidden = Boolean(image);
        // El distintivo 📷 indica que se puede poner una foto propia
        state.badge.hidden = Boolean(chosen) || !image;
        state.frame.classList.toggle('photo-picker__frame--filled', Boolean(chosen));
        state.frame.title = t(chosen ? 'photos.change' : 'photos.upload');
    }

    /** Fija un valor pendiente (foto, `avatar:<id>` o `null` = quitar). */
    function setPending(state, value) {
        state.pending = value;
        state.dirty = true;
        render(state);
    }

    // ---------------------------------------------------------------------
    // Diálogo compartido
    // ---------------------------------------------------------------------

    /** Rejilla de avatares de ejemplo del tipo del selector activo. */
    function renderAvatarGrid(state) {
        const selectedId = avatars.fromRef(currentValue(state));
        const modifier = state.kind === photos.KIND.TEAM ? ' avatar-choice--team' : '';
        dialog.avatars.innerHTML = avatars
            .list(state.kind)
            .map((id, index) => {
                const selected = id === selectedId;
                const label = t('photos.sample', { n: index + 1 });
                return `
                <button type="button" class="avatar-choice${modifier}${selected ? ' avatar-choice--active' : ''}"
                    data-avatar="${id}" aria-pressed="${selected}" aria-label="${label}" title="${label}">
                    <img class="avatar-choice__img" src="${avatars.getDataUrl(id)}" alt="">
                </button>`;
            })
            .join('');
    }

    function openDialog(state) {
        active = state;
        const subject = describe(state.input);
        const name = state.input.value.trim();
        dialog.subject.textContent = name ? `${subject} · ${name}` : subject;
        dialog.remove.hidden = !photos.resolve(currentValue(state));
        renderAvatarGrid(state);
        openModal(dialog.root);
    }

    /** Lee la imagen elegida con la cámara o la galería. */
    async function handleFile(input) {
        const [file] = input.files;
        input.value = ''; // Permite volver a elegir el mismo archivo
        const state = active;
        if (!file || !state) return;

        // Se cierra ya: el procesado se ve en el propio círculo
        closeModal(dialog.root);
        state.frame.classList.add('photo-picker__frame--loading');
        try {
            setPending(state, await photos.processFile(file));
        } catch (error) {
            VP.feedback.toast(error.message, { type: 'error' });
        } finally {
            state.frame.classList.remove('photo-picker__frame--loading');
            state.frame.focus();
        }
    }

    function finish(value) {
        if (!active) return;
        setPending(active, value);
        closeModal(dialog.root);
        active.frame.focus();
    }

    /** Engancha el diálogo `#photo-dialog` la primera vez que hace falta. */
    function ensureDialog() {
        if (dialog) return;
        dialog = {
            root: byId('photo-dialog'),
            subject: byId('photo-dialog-subject'),
            avatars: byId('photo-dialog-avatars'),
            remove: byId('photo-dialog-remove')
        };
        qsa('.photo-dialog__file', dialog.root).forEach((input) => {
            input.addEventListener('change', () => handleFile(input));
        });
        VP.dom.delegate(dialog.avatars, 'click', '.avatar-choice', (_event, button) => {
            finish(avatars.toRef(button.dataset.avatar));
        });
        dialog.remove.addEventListener('click', () => finish(null));
        dialog.root.addEventListener('close', () => {
            active = null;
        });
    }

    // ---------------------------------------------------------------------
    // API
    // ---------------------------------------------------------------------

    /**
     * Añade un selector de imagen delante de un input de nombre.
     * Envuelve el input en `.photo-field` para alinearlos. Es idempotente.
     *
     * @param {HTMLInputElement} input
     * @param {'players'|'teams'} kind `VP.photos.KIND.PLAYER` o `KIND.TEAM`.
     */
    function attach(input, kind) {
        if (!input || pickers.has(input)) return;
        ensureDialog();

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
            badge: qs('.photo-picker__badge', picker),
            dirty: false,
            pending: null
        };
        if (kind === photos.KIND.TEAM) state.frame.classList.add('photo-picker__frame--team');
        pickers.set(input, state);
        setLabel(input);

        state.frame.addEventListener('click', () => openDialog(state));
        input.addEventListener('input', () => render(state));
        render(state);
    }

    /**
     * Actualiza la etiqueta accesible (útil cuando cambia el aria-label del input,
     * p. ej. al renumerar las duplas del formulario de torneo).
     * @param {HTMLInputElement} input
     * @param {string} [text] Por defecto se deduce de la etiqueta del input.
     */
    function setLabel(input, text) {
        const state = pickers.get(input);
        if (!state) return;
        const what = text || describe(input) || t('photos.nameFallback');
        state.frame.setAttribute('aria-label', t('photos.photoOf', { what }));
    }

    /**
     * Descarta cambios pendientes y muestra lo guardado para el nombre actual.
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
            render(state);
        });
    }

    /**
     * Guarda (o borra) lo pendiente con el nombre definitivo.
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
            VP.feedback.toast(t('photos.noSpace', { name }), { type: 'warning', duration: 6000 });
        }
        state.pending = null;
        return ok;
    }

    // Cambio de idioma: etiquetas accesibles y títulos de todos los selectores.
    // Se difiere un instante para leer las etiquetas de los inputs ya traducidas.
    VP.i18n.onChange(() =>
        setTimeout(() => {
            document.querySelectorAll('.photo-field__input').forEach((input) => {
                const state = pickers.get(input);
                if (!state) return;
                setLabel(input);
                render(state);
            });
        })
    );

    VP.photoPicker = Object.freeze({ attach, setLabel, refresh, commit });
})(window);
