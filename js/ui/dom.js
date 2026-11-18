/**
 * @file dom.js
 * @description Pequeñas utilidades de DOM para no repetir código en las vistas:
 * selectores, delegación de eventos, animaciones y diálogos modales.
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});

    /** Atajo de `document.getElementById`. */
    const byId = (id) => document.getElementById(id);

    /** Atajo de `querySelector` (por defecto sobre `document`). */
    const qs = (selector, scope = document) => scope.querySelector(selector);

    /** `querySelectorAll` devuelto como array real (permite map/filter). */
    const qsa = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

    /**
     * Delegación de eventos: un único listener en `container` que reacciona a
     * los clics (u otro evento) de cualquier hijo que cumpla `selector`,
     * incluidos los que se creen DESPUÉS con innerHTML.
     *
     * Sustituye a los antiguos `onclick="funcion('${nombre}')"` en strings
     * HTML, que obligaban a colgar funciones de `window` y se rompían con
     * nombres que contenían comillas.
     *
     * @param {Element} container
     * @param {string} eventName
     * @param {string} selector
     * @param {(event:Event, target:Element) => void} handler Recibe el elemento que coincide.
     */
    function delegate(container, eventName, selector, handler) {
        container.addEventListener(eventName, (event) => {
            const target = event.target.closest(selector);
            if (target && container.contains(target)) handler(event, target);
        });
    }

    /**
     * Reinicia una animación CSS añadiendo de nuevo su clase modificadora.
     * Forzar un "reflow" (leer offsetWidth) hace que el navegador la vuelva a reproducir.
     */
    function replayAnimation(element, className) {
        element.classList.remove(className);
        void element.offsetWidth; // eslint-disable-line no-void
        element.classList.add(className);
    }

    /** Cambia el texto sólo si es distinto y, en ese caso, anima el "salto". */
    function setTextWithBump(element, text, bumpClass) {
        const value = String(text);
        if (element.textContent === value) return;
        element.textContent = value;
        replayAnimation(element, bumpClass);
    }

    /** Selecciona el botón activo de un grupo de "pills" (modificador `pill--active`). */
    function setActivePill(group, value) {
        qsa('.pill', group).forEach((pill) => {
            const isActive = pill.dataset.value === String(value);
            pill.classList.toggle('pill--active', isActive);
            pill.setAttribute('aria-pressed', String(isActive));
        });
    }

    // ---------------------------------------------------------------------
    // Diálogos modales (<dialog> nativo)
    // ---------------------------------------------------------------------
    // Usamos el elemento <dialog> del navegador porque ya resuelve gratis:
    // foco atrapado dentro del modal, cierre con Escape, capa de fondo
    // (::backdrop) y apilado de varios modales (p. ej. "Editar dupla" encima
    // del "Detalle del torneo").

    function openModal(dialog) {
        if (dialog && !dialog.open) dialog.showModal();
    }

    function closeModal(dialog) {
        if (dialog && dialog.open) dialog.close();
    }

    /**
     * Comportamiento común de TODOS los modales, registrado una sola vez:
     *  - Botones con `data-close-modal` cierran su diálogo.
     *  - Clic en el fondo oscuro (fuera del panel) cierra el diálogo.
     */
    function initModals() {
        delegate(document, 'click', '[data-close-modal]', (event, button) => {
            event.preventDefault();
            closeModal(button.closest('dialog'));
        });
        document.addEventListener('click', (event) => {
            const dialog = event.target;
            if (dialog instanceof HTMLDialogElement && dialog.open && dialog.dataset.dismissible !== 'false') {
                dialog.close();
            }
        });
    }

    /** ¿Hay algún modal abierto? (para desactivar atajos de teclado) */
    const isAnyModalOpen = () => qsa('dialog[open]').length > 0;

    VP.dom = Object.freeze({
        byId,
        qs,
        qsa,
        delegate,
        replayAnimation,
        setTextWithBump,
        setActivePill,
        openModal,
        closeModal,
        initModals,
        isAnyModalOpen
    });
})(window);
