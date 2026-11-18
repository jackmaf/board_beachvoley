/**
 * @file scout-view.js
 * @description Vista "Scout": registro táctico punto a punto.
 *
 * Flujo de un punto:
 *   1. El usuario toca la cancha (o la zona libre de alrededor).
 *   2. Se calcula la posición en % respecto a la cancha y se pinta un marcador.
 *   3. Se abre el menú: tipo (punto/error), gesto técnico y jugador.
 *   4. Al elegir jugador se llama a `matchStore.registerAction()`.
 *   5. El store emite 'change' y esta vista se repinta.
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { byId, qs, qsa, setTextWithBump } = VP.dom;
    const { escapeHtml, formatDuration, getAvatarUrl, getTeamLogoUrl } = VP.utils;
    const { SKILLS, DEFAULT_SKILL, MAX_TIMEOUTS_PER_SET } = VP.constants;
    const { toast } = VP.feedback;
    const store = VP.matchStore;
    const actions = VP.views.matchActions;

    let el = {};

    /** Posición (en %) del toque pendiente de asignar a un jugador. */
    let pendingCoords = null;
    let pendingMarker = null;

    // ---------------------------------------------------------------------
    // Pintado
    // ---------------------------------------------------------------------

    /** Genera los botones de gesto técnico a partir de VP.constants.SKILLS. */
    function renderSkillChoices() {
        el.skillGroup.innerHTML = SKILLS.map(
            (skill) => `
            <label class="choice choice--detail">
                <input class="choice__input" type="radio" name="actionDetail" value="${skill.key}"
                    ${skill.key === DEFAULT_SKILL ? 'checked' : ''}>
                <span class="choice__label">${skill.emoji} ${skill.key}</span>
            </label>`
        ).join('');
    }

    /** Reloj de Bogotá (hora oficial de referencia del proyecto). */
    function renderRealClock() {
        const time = new Intl.DateTimeFormat('es-CO', {
            timeZone: 'America/Bogota',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).format(new Date());
        el.realClock.textContent = `${time} (Bogotá)`;
    }

    /** Cronómetro oficial y estado de sus botones. */
    function renderStopwatch() {
        const { isTimerRunning } = store.getState();
        el.stopwatch.textContent = formatDuration(store.getElapsedSeconds());
        el.timerPlay.disabled = isTimerRunning || !store.hasMatch() || store.isMatchOver();
        el.timerPause.disabled = !isTimerRunning;
    }

    /** Cajitas de sets ganados de cada equipo. */
    function renderSetBoxes() {
        const state = store.getState();
        const matchRules = store.getRules();
        const boxes = { A: [], B: [] };

        for (let i = 0; i < matchRules.maxSets; i++) {
            const winner = VP.rules.getSetWinner(state.sets[i], i, matchRules);
            ['A', 'B'].forEach((team) => {
                const won = winner === team ? `sets-tracker__box--won-${team.toLowerCase()}` : '';
                boxes[team].push(`<span class="sets-tracker__box ${won}" aria-label="Set ${i + 1}${winner === team ? ' ganado' : ''}"></span>`);
            });
        }
        el.setBoxesA.innerHTML = boxes.A.join('');
        el.setBoxesB.innerHTML = boxes.B.join('');
    }

    /** Actualiza nombre y avatar de los cuatro botones de jugador. */
    function renderPlayerButtons(config) {
        qsa('.player-btn', el.menu).forEach((button) => {
            const name = config[`p${button.dataset.player}`];
            qs('.player-btn__name', button).textContent = name;
            const avatar = qs('.player-btn__avatar', button);
            avatar.src = getAvatarUrl(name);
            avatar.alt = '';
        });
    }

    /** Repinta toda la vista a partir del estado del store. */
    function render() {
        if (!store.hasMatch()) return;
        const state = store.getState();
        const { config } = state;
        const set = store.getCurrentSet();
        const won = store.getSetsWon();
        const matchOver = store.isMatchOver();

        // Equipos y logos
        el.nameA.textContent = config.teamA;
        el.nameB.textContent = config.teamB;
        el.setNameA.textContent = config.teamA;
        el.setNameB.textContent = config.teamB;
        [
            [el.logoA, config.teamA],
            [el.logoB, config.teamB]
        ].forEach(([img, name]) => {
            img.src = getTeamLogoUrl(name);
            img.alt = `Logo de ${name}`;
            img.hidden = false;
        });
        renderPlayerButtons(config);

        // Marcador con animación de "salto" cuando cambia
        setTextWithBump(el.scoreA, set.scoreA, 'scoreboard__score--bump');
        setTextWithBump(el.scoreB, set.scoreB, 'scoreboard__score--bump');

        // Indicador de saque
        const serving = store.getServingTeam();
        el.serveA.hidden = matchOver || serving !== 'A';
        el.serveB.hidden = matchOver || serving !== 'B';

        // Etiqueta del set en juego
        const target = VP.rules.getSetTarget(state.currentSetIndex, store.getRules());
        el.setLabel.innerHTML = matchOver
            ? `🏆 <strong>${escapeHtml(store.getTeamName(store.getMatchWinner()))}</strong> gana ${won.A}-${won.B}`
            : `Set ${state.currentSetIndex + 1} · a ${target} puntos · Sets ${won.A}-${won.B}`;

        // Tiempos muertos
        el.toLabelA.textContent = `⏱️ T. ${config.teamA}`;
        el.toLabelB.textContent = `⏱️ T. ${config.teamB}`;
        el.toCountA.textContent = `(${set.timeoutsA}/${MAX_TIMEOUTS_PER_SET})`;
        el.toCountB.textContent = `(${set.timeoutsB}/${MAX_TIMEOUTS_PER_SET})`;
        el.timeoutA.disabled = matchOver || set.timeoutsA >= MAX_TIMEOUTS_PER_SET;
        el.timeoutB.disabled = matchOver || set.timeoutsB >= MAX_TIMEOUTS_PER_SET;

        // Si el partido terminó, el botón de finalizar llama la atención
        el.endMatch.classList.toggle('btn--pulse', matchOver);
        el.undo.disabled = state.points.length === 0;

        renderSetBoxes();
        renderStopwatch();
    }

    // ---------------------------------------------------------------------
    // Interacción con la cancha
    // ---------------------------------------------------------------------

    /**
     * Toque en la cancha o zona libre: calcula la posición relativa a la
     * cancha (no a la zona libre), por eso puede ser < 0 o > 100 si el balón
     * cayó fuera.
     */
    function handleCourtClick(event) {
        if (!store.hasMatch()) return;
        if (store.isMatchOver()) {
            actions.announceOutcome({ ok: false, reason: 'match-over' });
            return;
        }

        const rect = el.court.getBoundingClientRect();
        pendingCoords = {
            x: ((event.clientX - rect.left) / rect.width) * 100,
            y: ((event.clientY - rect.top) / rect.height) * 100
        };

        // Marcador visual del toque
        pendingMarker?.remove();
        pendingMarker = document.createElement('div');
        pendingMarker.className = 'court-marker';
        pendingMarker.style.left = `${pendingCoords.x}%`;
        pendingMarker.style.top = `${pendingCoords.y}%`;
        el.court.appendChild(pendingMarker);

        // Cada punto nuevo empieza como "Punto (winner)"; el gesto se mantiene
        qs('input[name="actionType"][value="punto"]', el.menu).checked = true;
        el.menu.hidden = false;
        qs('.player-btn', el.menu).focus({ preventScroll: true });
    }

    function closeMenu() {
        pendingMarker?.remove();
        pendingMarker = null;
        pendingCoords = null;
        el.menu.hidden = true;
    }

    /** Clic en un jugador del menú: registra la acción en el store. */
    function handlePlayerPick(button) {
        if (!pendingCoords) return;
        const outcome = store.registerAction({
            team: button.dataset.team,
            playerId: button.dataset.player,
            actionType: qs('input[name="actionType"]:checked', el.menu).value,
            actionDetail: qs('input[name="actionDetail"]:checked', el.menu)?.value || DEFAULT_SKILL,
            coords: pendingCoords
        });
        closeMenu();
        actions.announceOutcome(outcome);
    }

    function handleTimeout(team) {
        const result = store.registerTimeout(team);
        if (result.ok) {
            toast(`Tiempo muerto: ${store.getTeamName(team)}. Cronómetro en pausa.`, { type: 'info' });
        } else if (result.reason === 'limit') {
            toast(`${store.getTeamName(team)} ya no tiene tiempos muertos en este set.`, { type: 'warning' });
        } else {
            actions.announceOutcome(result);
        }
    }

    // ---------------------------------------------------------------------
    // Inicialización
    // ---------------------------------------------------------------------

    function init() {
        el = {
            court: byId('main-court'),
            freeZone: byId('free-zone'),
            menu: byId('player-menu'),
            skillGroup: byId('action-detail-group'),
            nameA: byId('name-team-a'),
            nameB: byId('name-team-b'),
            logoA: byId('logo-team-a'),
            logoB: byId('logo-team-b'),
            scoreA: byId('score-a'),
            scoreB: byId('score-b'),
            serveA: byId('serve-a'),
            serveB: byId('serve-b'),
            setNameA: byId('set-name-a'),
            setNameB: byId('set-name-b'),
            setBoxesA: byId('set-boxes-a'),
            setBoxesB: byId('set-boxes-b'),
            setLabel: byId('scout-set-label'),
            realClock: byId('bogota-clock'),
            stopwatch: byId('match-stopwatch'),
            timerPlay: byId('btn-timer-play'),
            timerPause: byId('btn-timer-pause'),
            timeoutA: byId('btn-timeout-a'),
            timeoutB: byId('btn-timeout-b'),
            toLabelA: byId('to-label-a'),
            toLabelB: byId('to-label-b'),
            toCountA: byId('to-count-a'),
            toCountB: byId('to-count-b'),
            undo: byId('btn-undo-action'),
            endMatch: byId('btn-end-match')
        };

        renderSkillChoices();
        renderRealClock();
        setInterval(renderRealClock, 1000);

        el.freeZone.addEventListener('click', handleCourtClick);
        qsa('.player-btn', el.menu).forEach((button) => button.addEventListener('click', () => handlePlayerPick(button)));
        byId('cancel-point').addEventListener('click', closeMenu);
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !el.menu.hidden) closeMenu();
        });

        el.timerPlay.addEventListener('click', () => store.startTimer());
        el.timerPause.addEventListener('click', () => store.pauseTimer());
        el.timeoutA.addEventListener('click', () => handleTimeout('A'));
        el.timeoutB.addEventListener('click', () => handleTimeout('B'));
        el.undo.addEventListener('click', actions.confirmAndUndo);
        el.endMatch.addEventListener('click', actions.confirmAndFinish);

        // El store avisa: 'change' repinta todo, 'tick' sólo el cronómetro
        store.subscribe((event) => (event === 'tick' ? renderStopwatch() : render()));
        VP.router.register('vista-registro', { onEnter: render });
    }

    VP.views = VP.views || {};
    VP.views.scout = Object.freeze({ init, render });
})(window);
