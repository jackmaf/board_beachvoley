/**
 * @file language.js
 * @description Aplica las traducciones al HTML estático y conecta el
 * selector de idioma de la cabecera (ES / EN).
 *
 * Marcado declarativo en `index.html`:
 *   data-i18n="clave"                        → textContent
 *   data-i18n-html="clave"                   → innerHTML (sólo textos NUESTROS con <strong>, <kbd>…)
 *   data-i18n-attr="placeholder:clave;title:clave" → atributos
 *
 * El texto en español sigue escrito en el HTML: es lo que se ve si algo
 * falla y hace el marcado legible. Los elementos cuyo contenido pinta una
 * vista con JS NO llevan `data-i18n` (se pisarían): su vista los traduce.
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { qsa } = VP.dom;
    const i18n = VP.i18n;

    /** Elementos de `scope` (incluido él mismo) que cumplen `selector`. */
    function within(scope, selector) {
        const found = qsa(selector, scope);
        return scope.matches?.(selector) ? [scope, ...found] : found;
    }

    /**
     * Traduce los textos marcados dentro de `scope`.
     * Se usa con el documento entero y con cada plantilla clonada.
     * @param {ParentNode} [scope=document]
     */
    function translate(scope = document) {
        within(scope, '[data-i18n]').forEach((element) => {
            element.textContent = i18n.t(element.dataset.i18n);
        });
        within(scope, '[data-i18n-html]').forEach((element) => {
            element.innerHTML = i18n.t(element.dataset.i18nHtml);
        });
        within(scope, '[data-i18n-attr]').forEach((element) => {
            element.dataset.i18nAttr.split(';').forEach((pair) => {
                const [attribute, key] = pair.split(':').map((part) => part.trim());
                if (attribute && key) element.setAttribute(attribute, i18n.t(key));
            });
        });
    }

    /** Marca el idioma activo en el `<html lang>` y en el selector. */
    function syncDocument(lang) {
        document.documentElement.lang = lang;
        qsa('.lang-switch__input').forEach((input) => {
            input.checked = input.value === lang;
        });
    }

    function apply(lang) {
        syncDocument(lang);
        translate(document);
    }

    /** Inicializa i18n con el idioma guardado, traduce la página y conecta el selector. */
    function init() {
        i18n.init(VP.storage.getLanguage());
        apply(i18n.getLanguage());

        qsa('.lang-switch__input').forEach((input) => {
            input.addEventListener('change', () => i18n.setLanguage(input.value));
        });
        // Lo estático se traduce aquí; cada vista se repinta por su cuenta (i18n.onChange)
        i18n.onChange(apply);
    }

    VP.language = Object.freeze({ init, translate });
})(window);
