/**
 * @file i18n.js
 * @description Traducciones de la interfaz (español / inglés) sobre la
 * librería i18next (cargada por CDN).
 *
 * Por qué i18next: es el estándar de facto en JavaScript, resuelve plurales
 * («1 partido» / «3 partidos»), interpolación (`{{name}}`) y el idioma de
 * respaldo, y sus diccionarios son JSON compatibles con las herramientas de
 * traducción habituales. Los diccionarios viven en `js/i18n/*.js` (y no en
 * archivos .json) porque la app funciona con `file://`, donde `fetch` no
 * puede leer archivos locales.
 *
 * Si el CDN no carga (sin conexión) la app NO se rompe: `t()` usa un
 * traductor mínimo propio con los mismos diccionarios.
 *
 * Este módulo sólo traduce textos; pintar el DOM es cosa de `ui/language.js`.
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { LANGUAGES, DEFAULT_LANGUAGE, ACTION, DEFAULT_SKILL, FORMAT_LABEL, GENDER_LABEL } = VP.constants;
    const { formatMoney } = VP.utils;

    let language = DEFAULT_LANGUAGE;
    const listeners = new Set();

    /** i18next, si se cargó correctamente desde el CDN. */
    const library = () => (root.i18next && typeof root.i18next.t === 'function' ? root.i18next : null);

    const dictionary = (lang) => VP.locales?.[lang] || {};

    // ---------------------------------------------------------------------
    // Traductor de respaldo (mismo formato de claves que i18next)
    // ---------------------------------------------------------------------

    const lookup = (lang, key) => key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), dictionary(lang));

    /** Busca `key` (o su forma plural `key_one` / `key_other`) en el idioma activo y luego en el de respaldo. */
    function resolveKey(key, params) {
        const candidates = [];
        if (typeof params?.count === 'number') {
            const form = new Intl.PluralRules(LANGUAGES[language].locale).select(params.count);
            candidates.push(`${key}_${form}`, `${key}_other`);
        }
        candidates.push(key);
        for (const lang of [language, DEFAULT_LANGUAGE]) {
            for (const candidate of candidates) {
                const value = lookup(lang, candidate);
                if (typeof value === 'string') return value;
            }
        }
        return undefined;
    }

    function fallbackTranslate(key, params = {}) {
        const template = resolveKey(key, params);
        if (template === undefined) return params.defaultValue ?? key;
        return template.replace(/{{\s*(\w+)\s*}}/g, (_match, name) => String(params[name] ?? ''));
    }

    // ---------------------------------------------------------------------
    // API pública
    // ---------------------------------------------------------------------

    /** Normaliza un código de idioma; cualquier valor desconocido → español. */
    const normalize = (lang) => (lang && Object.hasOwn(LANGUAGES, lang) ? lang : DEFAULT_LANGUAGE);

    /**
     * Inicializa las traducciones. Síncrono: los diccionarios ya están en memoria.
     * @param {string|null} preferred Idioma guardado por el usuario.
     */
    function init(preferred) {
        language = normalize(preferred);
        const i18next = library();
        if (!i18next) {
            console.warn('[i18n] i18next no está disponible (¿sin conexión?): se usa el traductor de respaldo.');
            return;
        }
        i18next.init({
            lng: language,
            fallbackLng: DEFAULT_LANGUAGE,
            supportedLngs: Object.keys(LANGUAGES),
            resources: Object.fromEntries(Object.keys(LANGUAGES).map((lang) => [lang, { translation: dictionary(lang) }])),
            initImmediate: false,             // Carga síncrona: no hay archivos que descargar
            interpolation: { escapeValue: false }, // Escapamos nosotros (escapeHtml) donde hace falta
            returnNull: false
        });
    }

    /**
     * Traduce una clave.
     * IMPORTANTE: el resultado NO va escapado. Si se inserta con `innerHTML`
     * y lleva datos del usuario, escapa esos datos ANTES de pasarlos en `params`.
     * @param {string} key Clave con puntos, p. ej. `'prize.sectionTitle'`.
     * @param {Object} [params] Variables `{{x}}`, `count` para plurales, `defaultValue`.
     * @returns {string}
     */
    function t(key, params) {
        const i18next = library();
        return i18next?.isInitialized ? i18next.t(key, params) : fallbackTranslate(key, params);
    }

    /** ¿Existe la clave en el idioma activo o en el de respaldo? */
    function exists(key) {
        const i18next = library();
        return i18next?.isInitialized ? i18next.exists(key) : resolveKey(key) !== undefined;
    }

    const getLanguage = () => language;

    /** Configuración regional para `Intl` (números, fechas, dinero). */
    const getLocale = () => LANGUAGES[language].locale;

    /**
     * Cambia el idioma, lo guarda y avisa a los suscriptores para que se repinten.
     * @param {string} lang
     */
    function setLanguage(lang) {
        const next = normalize(lang);
        if (next === language) return;
        language = next;
        library()?.changeLanguage(next);
        VP.storage?.saveLanguage(next);
        listeners.forEach((listener) => listener(next));
    }

    /**
     * Suscribe una función al cambio de idioma.
     * @param {(lang:string) => void} listener
     * @returns {() => void} Función para cancelar la suscripción.
     */
    function onChange(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    // ---------------------------------------------------------------------
    // Ayudantes de dominio (el núcleo puro devuelve códigos, no textos)
    // ---------------------------------------------------------------------

    /** Dinero en COP con el formato del idioma activo. */
    const money = (amount) => formatMoney(amount, getLocale());

    /** Número con separadores del idioma activo. */
    const number = (value, options) => new Intl.NumberFormat(getLocale(), options).format(value);

    /**
     * Mensaje de un resultado `{ ok:false, code, params, error }` del núcleo.
     * Usa la traducción de `errors.<code>` y, si no existe, el texto original.
     */
    function errorMessage(result) {
        if (!result) return '';
        if (result.code && exists(`errors.${result.code}`)) return t(`errors.${result.code}`, result.params);
        return result.error || t('errors.unexpected');
    }

    /** Nombre de un gesto técnico (la clave guardada es en español: 'Ataque'…). */
    const skill = (key) => t(`skills.${key}`, { defaultValue: key });

    /**
     * Texto de una acción de la bitácora ("Ataque (Punto)", "TIEMPO MUERTO"…).
     * @param {{tipoAccion:string, actionDetail?:string|null}} point
     */
    function describeAction({ tipoAccion, actionDetail }) {
        if (tipoAccion === ACTION.TIMEOUT) return t('actions.timeout');
        if (actionDetail === 'FastScore') return t('actions.fastPoint');
        const kind = t(tipoAccion === ACTION.POINT ? 'actions.point' : 'actions.error');
        return t('actions.described', { skill: skill(actionDetail || DEFAULT_SKILL), kind });
    }

    /** Nombre de una ronda de eliminación directa según cuántas faltan para la final. */
    function roundLabel(roundIndex, totalRounds) {
        const remaining = totalRounds - roundIndex;
        const named = { 1: 'final', 2: 'semifinals', 3: 'quarterfinals', 4: 'roundOf16' };
        return named[remaining] ? t(`rounds.${named[remaining]}`) : t('rounds.round', { number: roundIndex + 1 });
    }

    /** Formato de torneo legible ('Round Robin', 'Eliminación directa'…). */
    const formatLabel = (format) => t(`formats.${format}`, { defaultValue: FORMAT_LABEL[format] || format });

    const genderLabel = (gender) => t(`genders.${gender}`, { defaultValue: GENDER_LABEL[gender] || gender });

    /** Puesto ordinal: «1.º» en español, «1st» en inglés. */
    function ordinal(place) {
        if (language !== 'en') return `${place}.º`;
        const suffix = { one: 'st', two: 'nd', few: 'rd', other: 'th' };
        return `${place}${suffix[new Intl.PluralRules('en-US', { type: 'ordinal' }).select(place)]}`;
    }

    VP.i18n = Object.freeze({
        init,
        t,
        exists,
        getLanguage,
        getLocale,
        setLanguage,
        onChange,
        money,
        number,
        errorMessage,
        skill,
        describeAction,
        roundLabel,
        formatLabel,
        genderLabel,
        ordinal
    });
})(window);
