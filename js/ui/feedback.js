/**
 * @file feedback.js
 * @description Mensajes al usuario sin bloquear la pantalla.
 *
 * Reemplaza a `alert()` y `confirm()` nativos, que congelan la app (malo en
 * mitad de un partido) y no se pueden estilizar:
 *  - toast():    aviso breve en la esquina (éxito, error, info…).
 *  - callout():  aviso grande centrado (p. ej. "¡Cambio de lado!").
 *  - confirm():  diálogo Sí/No que devuelve una Promesa.
 *  - spinner:    capa de "cargando".
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { byId, openModal, closeModal } = VP.dom;

    const TOAST_ICONS = { success: '✅', error: '⛔', warning: '⚠️', info: 'ℹ️' };

    /** Máximo de avisos visibles a la vez: los más antiguos se descartan. */
    const MAX_TOASTS = 3;

    /**
     * Lleva un elemento `popover` a la "top layer" del navegador.
     *
     * Los <dialog> modales se pintan en una capa superior a todo el documento,
     * así que un aviso normal quedaría DETRÁS del modal abierto. Con la Popover
     * API (re-abriéndolo) el aviso se coloca por encima del último modal.
     * En navegadores sin soporte simplemente no hace nada.
     */
    function bringToTopLayer(element) {
        if (typeof element.showPopover !== 'function') return;
        try {
            if (element.matches(':popover-open')) element.hidePopover();
            element.showPopover();
        } catch (error) {
            console.warn('[feedback] Popover no disponible:', error);
        }
    }

    /**
     * Muestra un aviso breve apilado en pantalla.
     * El contenedor tiene `aria-live="polite"`: los lectores de pantalla lo anuncian.
     *
     * @param {string} message
     * @param {Object} [options]
     * @param {'success'|'error'|'warning'|'info'} [options.type='info']
     * @param {number} [options.duration=3500] Milisegundos visibles.
     */
    function toast(message, { type = 'info', duration = 3500 } = {}) {
        const stack = byId('toast-stack');
        if (!stack) return;

        // Estructura de un .toast de Bootstrap; `.show` lo hace visible sin su JS
        const item = document.createElement('div');
        item.className = `toast show toast--${type}`;
        item.setAttribute('role', type === 'error' ? 'alert' : 'status');

        const body = document.createElement('div');
        body.className = 'toast-body d-flex align-items-center gap-2';

        const icon = document.createElement('span');
        icon.className = 'flex-shrink-0';
        icon.textContent = TOAST_ICONS[type] || TOAST_ICONS.info;

        const text = document.createElement('span');
        text.textContent = message; // textContent: nunca interpreta HTML

        body.append(icon, text);
        item.append(body);
        stack.appendChild(item);
        while (stack.children.length > MAX_TOASTS) stack.firstElementChild.remove();
        bringToTopLayer(stack);

        // Salida animada y eliminación del DOM
        setTimeout(() => {
            item.classList.add('toast--leaving');
            item.addEventListener('animationend', () => item.remove(), { once: true });
        }, duration);
    }

    /**
     * Aviso grande y llamativo en el centro de la pantalla.
     * @param {string} title Texto principal.
     * @param {string} [icon] Emoji superior.
     * @param {number} [duration=2500]
     */
    function callout(title, icon = '🚨', duration = 2500) {
        const element = document.createElement('div');
        element.className = 'callout';
        element.setAttribute('role', 'alert');
        element.popover = 'manual';
        element.innerHTML = '<span class="callout__icon"></span><span class="callout__title"></span>';
        element.querySelector('.callout__icon').textContent = icon;
        element.querySelector('.callout__title').textContent = title;
        document.body.appendChild(element);
        bringToTopLayer(element);
        setTimeout(() => element.remove(), duration);
    }

    /**
     * Diálogo de confirmación asíncrono.
     *
     * @example
     *   if (await VP.feedback.confirm({ message: '¿Borrar?', danger: true })) { … }
     *
     * @param {Object} options
     * @param {string} [options.title]        Por defecto «¿Estás seguro?» en el idioma activo.
     * @param {string} options.message
     * @param {string} [options.confirmLabel] Por defecto «Aceptar».
     * @param {string} [options.cancelLabel]  Por defecto «Cancelar».
     * @param {boolean} [options.danger=false] Pinta el botón de confirmar en rojo.
     * @returns {Promise<boolean>} `true` si el usuario confirmó.
     */
    function confirm({ title, message, confirmLabel, cancelLabel, danger = false }) {
        // Los textos por defecto se traducen al llamar (no al cargar), así siguen el idioma activo
        const t = VP.i18n ? VP.i18n.t : (key) => key;
        title = title || t('confirm.title');
        confirmLabel = confirmLabel || t('confirm.accept');
        cancelLabel = cancelLabel || t('common.cancel');
        const dialog = byId('confirm-dialog');
        byId('confirm-title').textContent = title;
        byId('confirm-message').textContent = message;

        const okButton = byId('confirm-accept');
        okButton.textContent = confirmLabel;
        okButton.classList.toggle('btn-danger', danger);
        okButton.classList.toggle('btn-primary', !danger);
        byId('confirm-cancel').textContent = cancelLabel;

        return new Promise((resolve) => {
            // El valor de retorno del <dialog> nos dice qué botón se pulsó
            dialog.addEventListener('close', () => resolve(dialog.returnValue === 'accept'), { once: true });
            dialog.returnValue = '';
            openModal(dialog);
            // En acciones destructivas el foco inicial va a "Cancelar" (buena práctica:
            // pulsar Enter por inercia no debe borrar nada).
            (danger ? byId('confirm-cancel') : okButton).focus();
        });
    }

    /** Muestra/oculta la capa de carga. */
    function setLoading(isLoading) {
        const spinner = byId('loading-spinner');
        if (spinner) spinner.hidden = !isLoading;
    }

    /** Cierra el diálogo de confirmación (útil en tests). */
    const dismissConfirm = () => closeModal(byId('confirm-dialog'));

    VP.feedback = Object.freeze({ toast, callout, confirm, setLoading, dismissConfirm });
})(window);
