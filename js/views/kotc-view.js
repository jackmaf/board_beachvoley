/**
 * @file kotc-view.js
 * @description Vista "pista en vivo" del formato Queen & King of the Court.
 *
 * Muestra la cancha (trono vs retador), dos botones grandes para registrar el
 * rally, la cola de espera, la tabla con TODAS las duplas (con +1/−1 para
 * corregir), el historial de jugadas con "Deshacer" y el acceso a los premios.
 *
 * Toda la lógica está en core/kotc-engine.js; esta vista sólo lee el estado
 * del torneo (`tournament.kotc`), llama al motor y guarda con storage.
 *
 * Atajos (con la vista activa y sin modales): T/← trono · R/→ retador · Z deshacer
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { byId, delegate, setTextWithBump, replayAnimation, isAnyModalOpen } = VP.dom;
    const { escapeHtml, formatDuration } = VP.utils;
    const engine = VP.kotcEngine;
    const storage = VP.storage;
    const { toast, callout, confirm } = VP.feedback;
    const i18n = VP.i18n;
    const { t } = i18n;

    const VIEW_ID = 'vista-kotc';
    /** Cuántas jugadas recientes se listan en "Últimas jugadas". */
    const LOG_SIZE = 8;

    let tournamentId = null;
    let el = {};

    // ---------------------------------------------------------------------
    // Acceso a datos
    // ---------------------------------------------------------------------

    const getTournament = () => (tournamentId ? storage.getTournament(tournamentId) : null);

    /**
     * Aplica una acción del motor sobre el estado guardado y persiste.
     * @param {(state:Object) => any} action
     * @returns {any} Lo que devuelva la acción.
     */
    function mutate(action) {
        const update = storage.updateTournament(tournamentId, (t) => action(t.kotc));
        return update ? update.result : null;
    }

    /** "Reina", "Rey" o "Trono" (en el idioma activo) según la rama del torneo. */
    const throneWord = (tournament) => t(`kotc.throne.${['F', 'M'].includes(tournament.gender) ? tournament.gender : 'X'}`);

    /**
     * Texto de una jugada del historial. Las jugadas nuevas guardan un código
     * traducible; las antiguas sólo traen `label` (en español).
     */
    const describeEntry = (entry) => (entry.code ? t(`kotc.log.${entry.code}`, entry.params) : entry.label);

    const playersOf = (team) => (team && (team.p1 || team.p2) ? `${team.p1 || '?'} / ${team.p2 || '?'}` : '');

    // ---------------------------------------------------------------------
    // Pintado
    // ---------------------------------------------------------------------

    function renderClock(state) {
        const remaining = engine.getRemainingMs(state);
        const running = Boolean(state.timer.runningSince);
        if (remaining === null) {
            el.clock.textContent = `⏱️ ${formatDuration(engine.getElapsedMs(state) / 1000)}`;
        } else {
            el.clock.textContent = `⏳ ${formatDuration(Math.ceil(remaining / 1000))}`;
            el.clock.classList.toggle('kotc__clock--warning', remaining > 0 && remaining <= 60000);
        }
        el.clock.classList.toggle('kotc__clock--paused', !running && !state.winnerId && !state.timeUp && state.rallies > 0);
        el.timerBtn.textContent = running ? '⏸️' : '▶️';
        el.timerBtn.disabled = Boolean(state.winnerId) || state.timeUp;
    }

    function renderSide(prefix, team, points) {
        el[`${prefix}Name`].textContent = team ? team.name : '—';
        el[`${prefix}Players`].textContent = playersOf(team);
        setTextWithBump(el[`${prefix}Points`], points ?? 0, 'kotc__points--bump');
    }

    /** Foto o avatar (siempre hay uno: el de ejemplo por defecto) de trono y retador. */
    function renderSidePhotos(king, challenger) {
        [[el.thronePhoto, king], [el.challengerPhoto, challenger]].forEach(([img, team]) => {
            img.hidden = !team;
            if (team) img.src = VP.photos.teamSrc(team.name);
        });
    }

    function renderQueue(state) {
        el.queue.innerHTML = state.queue
            .map((id, i) => {
                const team = engine.getTeam(state, id);
                const tag = i === 0
                    ? `<span class="badge kotc__badge--challenger">${escapeHtml(t('kotc.challenger'))}</span>`
                    : `<span class="kotc__queue-pos">${escapeHtml(i18n.ordinal(i + 1))}</span>`;
                return `<li class="kotc__queue-item ${i === 0 ? 'kotc__queue-item--next' : ''}">
                    ${tag} ${escapeHtml(team.name)}</li>`;
            })
            .join('');
    }

    function renderTable(state, tournament) {
        const target = state.settings.targetPoints;
        const statusBadge = (row) => {
            if (row.status === 'throne') return `<span class="badge text-bg-warning">👑 ${escapeHtml(throneWord(tournament))}</span>`;
            if (row.status === 'challenger') return `<span class="badge kotc__badge--challenger">⚔️ ${escapeHtml(t('kotc.challenger'))}</span>`;
            return `<span class="badge text-bg-light">${escapeHtml(t('kotc.inQueue', { position: i18n.ordinal(row.queuePos + 1) }))}</span>`;
        };

        el.table.innerHTML = engine
            .computeStandings(state)
            .map((row, i) => `
                <tr class="${row.isWinner ? 'table-success fw-bold' : row.status === 'throne' ? 'table-warning' : ''}">
                    <td>${row.isWinner ? '🏆' : i + 1}</td>
                    <td class="text-start">
                        <div class="fw-bold">${escapeHtml(row.name)}</div>
                        ${playersOf(row) ? `<div class="small text-body-secondary">${escapeHtml(playersOf(row))}</div>` : ''}
                    </td>
                    <td class="kotc__points-cell">
                        <div class="d-flex align-items-center gap-2">
                            <strong class="kotc__table-points">${row.points}</strong>
                            <div class="progress progress--thin flex-grow-1" role="progressbar"
                                aria-label="${escapeHtml(t('kotc.pointsOf', { points: row.points, target }))}">
                                <div class="progress-bar" style="width:${Math.min(100, (row.points / target) * 100)}%"></div>
                            </div>
                        </div>
                    </td>
                    <td>${row.thrones}</td>
                    <td>${statusBadge(row)}</td>
                    <td class="text-nowrap">
                        <button type="button" class="btn btn-sm btn-outline-secondary" data-action="adjust"
                            data-team="${row.id}" data-delta="-1" aria-label="${escapeHtml(t('kotc.minusOne', { name: row.name }))}"
                            ${row.points === 0 ? 'disabled' : ''}>−1</button>
                        <button type="button" class="btn btn-sm btn-outline-primary" data-action="adjust"
                            data-team="${row.id}" data-delta="1" aria-label="${escapeHtml(t('kotc.plusOne', { name: row.name }))}">+1</button>
                    </td>
                </tr>`)
            .join('');
    }

    function renderLog(state) {
        const recent = state.history.slice(-LOG_SIZE).reverse();
        el.log.innerHTML = recent.length
            ? recent
                .map((entry, i) => `
                    <li class="kotc__log-item ${i === 0 ? 'kotc__log-item--last' : ''}">
                        <span>${escapeHtml(describeEntry(entry))}</span>
                        <time class="kotc__log-time">${new Date(entry.at).toLocaleTimeString(i18n.getLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
                    </li>`)
                .join('')
            : `<li class="text-body-secondary small">${escapeHtml(t('kotc.noPlays'))}</li>`;
    }

    /** Repinta toda la vista desde el estado guardado. */
    function render() {
        const tournament = getTournament();
        if (!tournament?.kotc) return;
        const state = tournament.kotc;
        const king = engine.getTeam(state, state.throne);
        const challenger = engine.getTeam(state, engine.getChallengerId(state));
        const finished = engine.isFinished(state);

        el.title.textContent = tournament.name;
        const limit = state.settings.timeLimitMinutes ? ` · ${state.settings.timeLimitMinutes} min` : '';
        el.meta.textContent = t('kotc.meta', {
            target: state.settings.targetPoints,
            limit,
            teams: state.teams.length,
            count: state.rallies
        });
        el.throneLabel.textContent = `👑 ${throneWord(tournament)}`;

        renderSide('throne', king, state.points[state.throne]);
        renderSide('challenger', challenger, challenger ? state.points[challenger.id] : 0);
        renderSidePhotos(king, challenger);

        // Campeón y punto de oro
        const winner = engine.getTeam(state, state.winnerId);
        el.champion.hidden = !winner;
        el.champion.textContent = winner ? t('kotc.champion', { name: winner.name, count: state.points[winner.id] }) : '';
        const golden = state.timeUp && !finished;
        el.golden.hidden = !golden;
        if (golden) {
            const names = engine.getLeaders(state).map((id) => engine.getTeam(state, id).name).join(' vs ');
            el.golden.textContent = t('kotc.golden', { names });
        }

        el.btnThrone.disabled = finished;
        el.btnChallenger.disabled = finished;
        el.btnUndo.disabled = state.history.length === 0;

        renderQueue(state);
        renderTable(state, tournament);
        renderLog(state);
        renderClock(state);
    }

    // ---------------------------------------------------------------------
    // Acciones
    // ---------------------------------------------------------------------

    /** Registra un rally y comunica lo importante (cambio de trono, campeón). */
    function playRally(winner) {
        const result = mutate((state) => engine.applyRally(state, winner));
        if (!result) return;
        if (!result.ok) {
            toast(i18n.errorMessage(result), { type: 'warning' });
            return;
        }
        render();
        // Destello en el trono (suma un punto o cambia de dueño): feedback rápido sin interrumpir el juego
        replayAnimation(el.throneSide, 'kotc__side--flash');
        announceWinner();
    }

    function announceWinner() {
        const tournament = getTournament();
        const winner = engine.getTeam(tournament.kotc, tournament.kotc.winnerId);
        if (winner) callout(t('kotc.championCallout', { name: winner.name }), '🏆', 3500);
    }

    function handleUndo() {
        const undone = mutate((state) => engine.undo(state));
        if (!undone) {
            toast(t('match.nothingToUndo'), { type: 'info' });
            return;
        }
        render();
        toast(t('kotc.undone', { play: describeEntry(undone) }), { type: 'success' });
    }

    function handleAdjust(teamId, delta) {
        const result = mutate((state) => engine.adjustPoints(state, teamId, delta));
        if (result && !result.ok) {
            toast(i18n.errorMessage(result), { type: 'warning' });
            return;
        }
        render();
        announceWinner();
    }

    /** Cada segundo: actualiza el reloj y detecta el fin del tiempo reglamentario. */
    function tick() {
        if (VP.router.getCurrent() !== VIEW_ID) return;
        const tournament = getTournament();
        if (!tournament?.kotc) return;
        const state = tournament.kotc;
        const remaining = engine.getRemainingMs(state);

        if (remaining === 0 && !state.timeUp) {
            mutate((s) => engine.markTimeUp(s));
            render();
            const updated = getTournament().kotc;
            if (updated.winnerId) announceWinner();
            else callout(t('kotc.timeUpCallout'), '⏱️', 3000);
            return;
        }
        renderClock(state);
    }

    async function handleDelete() {
        const tournament = getTournament();
        if (!tournament) return;
        const accepted = await confirm({
            title: t('tournaments.deleteTitle'),
            message: t('tournaments.deleteMessage', { name: tournament.name }),
            confirmLabel: t('common.delete'),
            danger: true
        });
        if (!accepted) return;
        storage.deleteTournament(tournament.id);
        tournamentId = null;
        toast(t('tournaments.deleted'), { type: 'success' });
        VP.router.go('vista-torneos');
    }

    function handleKeydown(event) {
        if (VP.router.getCurrent() !== VIEW_ID || isAnyModalOpen()) return;
        if (event.target.closest('input, select, textarea')) return;
        const key = event.key.toLowerCase();
        if (key === 't' || key === 'arrowleft') playRally('throne');
        else if (key === 'r' || key === 'arrowright') playRally('challenger');
        else if (key === 'z') handleUndo();
        else return;
        event.preventDefault();
    }

    // ---------------------------------------------------------------------
    // API pública
    // ---------------------------------------------------------------------

    /** Abre la pista de un torneo Queen & King of the Court. */
    function open(id) {
        tournamentId = id;
        VP.router.go(VIEW_ID);
    }

    function init() {
        el = {
            title: byId('kotc-title'),
            meta: byId('kotc-meta'),
            clock: byId('kotc-clock'),
            timerBtn: byId('btn-kotc-timer'),
            champion: byId('kotc-champion'),
            golden: byId('kotc-golden'),
            throneSide: byId('kotc-throne'),
            throneLabel: byId('kotc-throne-label'),
            throneName: byId('kotc-throne-name'),
            thronePlayers: byId('kotc-throne-players'),
            thronePhoto: byId('kotc-throne-photo'),
            thronePoints: byId('kotc-throne-points'),
            challengerName: byId('kotc-challenger-name'),
            challengerPlayers: byId('kotc-challenger-players'),
            challengerPhoto: byId('kotc-challenger-photo'),
            challengerPoints: byId('kotc-challenger-points'),
            btnThrone: byId('btn-kotc-throne'),
            btnChallenger: byId('btn-kotc-challenger'),
            btnUndo: byId('btn-kotc-undo'),
            queue: byId('kotc-queue'),
            table: byId('kotc-table'),
            log: byId('kotc-log')
        };

        el.btnThrone.addEventListener('click', () => playRally('throne'));
        el.btnChallenger.addEventListener('click', () => playRally('challenger'));
        el.btnUndo.addEventListener('click', handleUndo);
        el.timerBtn.addEventListener('click', () => {
            mutate((state) => engine.toggleTimer(state));
            render();
        });
        byId('btn-kotc-back').addEventListener('click', () => VP.router.go('vista-torneos'));
        byId('btn-kotc-delete').addEventListener('click', handleDelete);
        // Premios: el mismo panel que la pestaña «Premios», dentro de un diálogo
        byId('btn-kotc-prizes').addEventListener('click', () => {
            if (!tournamentId) return;
            VP.views.prizePanel.render(tournamentId, { host: byId('modal-prizes-panel'), onChange: VP.views.tournaments.renderList });
            VP.dom.openModal(byId('modal-prizes'));
        });
        delegate(el.table, 'click', '[data-action="adjust"]', (_event, button) =>
            handleAdjust(button.dataset.team, Number(button.dataset.delta))
        );
        document.addEventListener('keydown', handleKeydown);
        setInterval(tick, 1000);

        // Cambio de idioma: repintar si la pista está a la vista
        i18n.onChange(() => {
            if (VP.router.getCurrent() === VIEW_ID) render();
        });

        VP.router.register(VIEW_ID, { onEnter: render });
    }

    VP.views = VP.views || {};
    VP.views.kotc = Object.freeze({ init, open, render });
})(window);
