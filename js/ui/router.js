/**
 * @file router.js
 * @description Navegación entre las vistas de la SPA.
 *
 * Cada vista es un `<section class="view" id="vista-…">` y cada botón de la
 * barra inferior lleva `data-view="vista-…"`. Cambiar de vista consiste en:
 *   1. Activar el modificador `view--active` en la sección destino.
 *   2. Marcar el botón correspondiente con `bottom-nav__item--active`.
 *   3. Ejecutar el hook `onEnter` registrado por la vista (p. ej. repintar).
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { qsa, byId } = VP.dom;

    /** Vistas que sólo tienen sentido con un partido en curso. */
    const MATCH_VIEWS = ['vista-marcador-vivo', 'vista-registro'];

    /** @type {Map<string, {onEnter?: Function}>} */
    const routes = new Map();
    let currentView = null;

    /**
     * Registra los hooks de una vista.
     * @param {string} viewId
     * @param {{onEnter?: () => void}} hooks
     */
    function register(viewId, hooks) {
        routes.set(viewId, hooks);
    }

    /** Muestra la vista indicada. */
    function go(viewId) {
        const target = byId(viewId);
        if (!target) return;

        qsa('.view').forEach((view) => view.classList.toggle('view--active', view === target));
        qsa('.bottom-nav__item').forEach((item) => {
            const isActive = item.dataset.view === viewId;
            item.classList.toggle('bottom-nav__item--active', isActive);
            if (isActive) item.setAttribute('aria-current', 'page');
            else item.removeAttribute('aria-current');
        });

        currentView = viewId;
        window.scrollTo({ top: 0, behavior: 'smooth' });
        routes.get(viewId)?.onEnter?.();
    }

    const getCurrent = () => currentView;

    /** Habilita o deshabilita los accesos a las vistas de partido. */
    function setMatchViewsEnabled(enabled) {
        MATCH_VIEWS.forEach((viewId) => {
            const button = document.querySelector(`.bottom-nav__item[data-view="${viewId}"]`);
            if (button) button.disabled = !enabled;
        });
    }

    /** Conecta los botones de la barra inferior. */
    function init() {
        qsa('.bottom-nav__item').forEach((button) => {
            button.addEventListener('click', () => go(button.dataset.view));
        });
    }

    VP.router = Object.freeze({ register, go, getCurrent, setMatchViewsEnabled, init });
})(window);
