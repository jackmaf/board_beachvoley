/**
 * @file constants.js
 * @description Constantes de dominio compartidas por toda la aplicación.
 *
 * Centralizar aquí los "números mágicos" (puntos por set, máximo de tiempos
 * muertos, claves de localStorage, gestos técnicos…) permite cambiar una regla
 * en UN solo lugar y que el resto del código la respete automáticamente.
 *
 * Patrón de módulo usado en todo el proyecto
 * ------------------------------------------
 * Cada archivo es una IIFE (función autoejecutable) que cuelga su API pública
 * del espacio de nombres global `VP` (Voley Playa). Así:
 *   - No contaminamos `window` con decenas de variables sueltas.
 *   - Funciona abriendo `index.html` directamente (file://), cosa que los
 *     ES Modules (`import/export`) no permiten por las políticas CORS.
 *   - Los módulos "puros" también se exportan con `module.exports` para poder
 *     testearlos con Node (`npm test`) sin navegador.
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});

    /** Claves usadas en localStorage. NO cambiarlas: romperían los datos guardados. */
    const STORAGE_KEYS = Object.freeze({
        CURRENT_MATCH: 'voley-currentMatch', // Partido en curso (se guarda tras cada acción)
        LAST_MATCH: 'voley-lastMatch',       // Último partido finalizado
        HISTORY: 'voley-history',            // Array con todos los partidos finalizados
        TOURNAMENTS: 'voley-tournaments',    // Array de torneos
        THEME: 'voley-theme'                 // Tema visual elegido
    });

    /** Reglas por defecto de un partido de voley playa (FIVB). */
    const DEFAULT_RULES = Object.freeze({
        maxSets: 3,      // Al mejor de 3
        ptsNormal: 21,   // Puntos para ganar un set normal
        ptsTiebreak: 15  // Puntos para ganar el set decisivo
    });

    /** Diferencia mínima de puntos para cerrar un set (21-19, 22-20…). */
    const MIN_POINT_DIFF = 2;

    /** Tiempos muertos permitidos por equipo y por set. */
    const MAX_TIMEOUTS_PER_SET = 1;

    /** Cada cuántos puntos totales se cambia de lado (sets normales / tie-break). */
    const SIDE_CHANGE_EVERY = Object.freeze({ normal: 7, tiebreak: 5 });

    /** Medidas reales de la cancha de voley playa, en metros. */
    const COURT_METERS = Object.freeze({ width: 8, length: 16 });

    /** Identificadores fijos de los cuatro jugadores de un partido 2 vs 2. */
    const PLAYER_IDS = Object.freeze(['A1', 'A2', 'B1', 'B2']);

    /** Tipos de acción que puede tener un registro de la bitácora. */
    const ACTION = Object.freeze({
        POINT: 'punto',     // Punto ganador del jugador → suma a SU equipo
        ERROR: 'error',     // Error no forzado → suma al RIVAL
        TIMEOUT: 'timeout'  // Tiempo muerto (no suma puntos)
    });

    /**
     * Gestos técnicos. El orden de este array define el orden en el menú de
     * registro, los filtros, el desglose del jugador y los ejes del radar.
     * Para añadir un gesto nuevo basta con agregarlo aquí.
     */
    const SKILLS = Object.freeze([
        { key: 'Ataque', emoji: '🏐', award: 'Mejor Atacante' },
        { key: 'Saque', emoji: '🎯', award: 'Mejor Sacador' },
        { key: 'Bloqueo', emoji: '🧱', award: 'Muro del Bloqueo' },
        { key: 'Antebrazos', emoji: '💪', award: 'Defensor Clave' },
        { key: 'Garrita', emoji: '🤜', award: 'Letal con Garrita' },
        { key: 'Toque', emoji: '🤏', award: 'Mago del Toque' },
        { key: 'Dedos', emoji: '👐', award: 'Armador Fino' }
    ]);

    /** Gesto que se asume cuando un registro antiguo no trae `actionDetail`. */
    const DEFAULT_SKILL = 'Ataque';

    /**
     * Escala estándar de calidad de recepción en scouting de voley (0-3).
     * Ordenada de mejor a peor, que es como se muestra en la interfaz.
     */
    const RECEPTION_GRADES = Object.freeze([
        { grade: 3, label: 'Perfecta', hint: 'Pase ideal: permite cualquier ataque' },
        { grade: 2, label: 'Buena', hint: 'Se puede atacar con opciones limitadas' },
        { grade: 1, label: 'Mala', hint: 'Sólo ataque forzado o free ball' },
        { grade: 0, label: 'Error', hint: 'Ace o recepción fallida' }
    ]);

    /** Calidad mínima para considerar una recepción "positiva" (2 y 3). */
    const POSITIVE_RECEPTION_MIN = 2;

    /** Formatos de torneo soportados (el valor se guarda tal cual en localStorage). */
    const TOURNAMENT_FORMAT = Object.freeze({
        ROUND_ROBIN: 'Round Robin',
        KNOCKOUT: 'Eliminacion Directa',
        KING_OF_COURT: 'Queen & King of the Court'
    });

    /** Etiqueta legible de cada formato (el valor guardado no lleva tildes). */
    const FORMAT_LABEL = Object.freeze({
        [TOURNAMENT_FORMAT.ROUND_ROBIN]: 'Round Robin',
        [TOURNAMENT_FORMAT.KNOCKOUT]: 'Eliminación directa',
        [TOURNAMENT_FORMAT.KING_OF_COURT]: 'Queen & King of the Court'
    });

    /** Estados de un partido dentro de un torneo. */
    const MATCH_STATUS = Object.freeze({
        SCHEDULED: 'programado',
        FINISHED: 'finalizado'
    });

    /** Marcadores de posición en el cuadro de eliminación. */
    const SLOT = Object.freeze({
        TBD: 'TBD', // "Por definir": espera al ganador de un partido previo
        BYE: 'BYE'  // Hueco libre: el rival pasa de ronda automáticamente
    });

    /** Puntos de clasificación en Round Robin (sistema FIVB: 2 por victoria, 1 por derrota). */
    const STANDING_POINTS = Object.freeze({ win: 2, loss: 1 });

    /** Emojis que identifican visualmente a cada dupla (se elige uno por hash del nombre). */
    const TEAM_EMOJIS = Object.freeze(['🏐', '🏖️', '🌴', '☀️', '🏄', '🌊', '🩳', '🕶️', '🍉', '🥥', '🏆', '🥇', '💪', '🔥', '⚡']);

    /** Etiquetas legibles para el género del torneo. */
    const GENDER_LABEL = Object.freeze({ M: 'Masculino', F: 'Femenino', X: 'Mixto' });

    /**
     * Queen & King of the Court: valores por defecto.
     *  - targetPoints:     puntos para ganar (sólo se puntúa desde el trono).
     *  - timeLimitMinutes: 0 = sin límite de tiempo.
     *  - minTeams:         con menos de 3 duplas no hay cola y el formato no tiene sentido.
     */
    const KOTC_DEFAULTS = Object.freeze({ targetPoints: 15, timeLimitMinutes: 0, minTeams: 3 });

    /** Cómo se llama el trono según la rama del torneo. */
    const THRONE_LABEL = Object.freeze({ F: 'Reina', M: 'Rey', X: 'Trono' });

    /** A partir de cuántos registros se muestra el spinner al recalcular estadísticas. */
    const SPINNER_THRESHOLD = 300;

    VP.constants = Object.freeze({
        STORAGE_KEYS,
        DEFAULT_RULES,
        MIN_POINT_DIFF,
        MAX_TIMEOUTS_PER_SET,
        SIDE_CHANGE_EVERY,
        COURT_METERS,
        PLAYER_IDS,
        ACTION,
        SKILLS,
        DEFAULT_SKILL,
        RECEPTION_GRADES,
        POSITIVE_RECEPTION_MIN,
        TOURNAMENT_FORMAT,
        FORMAT_LABEL,
        MATCH_STATUS,
        SLOT,
        STANDING_POINTS,
        TEAM_EMOJIS,
        GENDER_LABEL,
        KOTC_DEFAULTS,
        THRONE_LABEL,
        SPINNER_THRESHOLD
    });

    if (typeof module !== 'undefined' && module.exports) module.exports = VP.constants;
})(typeof window !== 'undefined' ? window : globalThis);
