/**
 * @file tournaments-view.js
 * @description Vista "Torneos": listado, creación, detalle (partidos,
 * clasificación, llaves y premios), resultado manual y edición de duplas
 * (con sus fotos). Los torneos Queen & King of the Court se abren en su
 * propia pista (`kotc-view.js`).
 *
 * Esta vista sólo PINTA y RECOGE eventos. La lógica (generar llaves, avanzar
 * ganadores, BYE, clasificación) vive en `core/tournament-engine.js`, los
 * premios en `core/prize-engine.js` + `views/prize-panel.js` y la
 * persistencia en `services/storage.js`.
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { byId, qs, qsa, delegate, openModal, closeModal } = VP.dom;
    const { escapeHtml, pickTeamEmoji, toInt } = VP.utils;
    const { TOURNAMENT_FORMAT, MATCH_STATUS, SLOT, STANDING_POINTS, KOTC_DEFAULTS } = VP.constants;
    const engine = VP.tournamentEngine;
    const prizeEngine = VP.prizeEngine;
    const prizePanel = VP.views.prizePanel;
    const storage = VP.storage;
    const i18n = VP.i18n;
    const { t } = i18n;
    const { toast, confirm } = VP.feedback;
    const picker = VP.photoPicker;
    const { KIND: PHOTO_KIND } = VP.photos;

    /** Mínimo de duplas para crear un torneo. */
    const MIN_TEAMS = 2;

    /** Pestañas del detalle y su panel. */
    const TABS = { fixture: 'panel-fixture', standings: 'panel-standings', bracket: 'panel-bracket', prizes: 'panel-prizes' };

    /** Contexto de los modales abiertos (qué torneo / partido / hueco se edita). */
    const context = {
        tournamentId: null,
        matchId: null,
        slot: null,
        activeTab: 'fixture'
    };

    // Referencias al DOM (se rellenan en init)
    let el = {};

    // =====================================================================
    // LISTADO DE TORNEOS
    // =====================================================================

    /** Texto "Cat. A · Masculino". */
    const describeTournament = (tour) =>
        `${t('tournaments.categoryShort', { category: tour.category })} · ${i18n.genderLabel(tour.gender)}`;

    /** Resumen de premios para la tarjeta del listado ("💰 $ 80.000 · 7/10 duplas pagaron"). */
    function prizeBadgeHtml(tour) {
        const summary = prizeEngine.summarize(tour);
        if (!summary) return '';
        return `
            <span class="tournament-card__prize">
                💰 ${escapeHtml(t('tournaments.prizeBadge', { amount: i18n.money(summary.pool), paid: summary.paidTeams, total: summary.teams }))}
            </span>`;
    }

    /**
     * Línea de progreso de la tarjeta (ya escapada).
     *  - Formatos con partidos: "3/7 partidos jugados".
     *  - Queen & King: líder y puntos ("Líder: Brasil 12/15 pts · 40 rallies").
     */
    function describeProgress(tour) {
        if (!tour.kotc) {
            const { done, total } = engine.getProgress(tour);
            return escapeHtml(t('tournaments.matchesPlayed', { done, count: total }));
        }
        const [leader] = VP.kotcEngine.computeStandings(tour.kotc);
        const { targetPoints } = tour.kotc.settings;
        return escapeHtml(
            tour.kotc.rallies
                ? t('kotc.cardLeader', { name: leader.name, points: leader.points, target: targetPoints, count: tour.kotc.rallies })
                : t('kotc.cardReady', { target: targetPoints })
        );
    }

    /** Abre la pantalla adecuada según el formato del torneo. */
    function openTournament(id) {
        const tournament = storage.getTournament(id);
        if (tournament?.kotc) VP.views.kotc.open(id);
        else openDetail(id);
    }

    /** Pinta las tarjetas de todos los torneos. */
    function renderList() {
        const tournaments = storage.getTournaments();

        if (tournaments.length === 0) {
            el.list.innerHTML = `
                <div class="text-center text-body-secondary py-4">
                    <div class="fs-1" aria-hidden="true">🏖️</div>
                    <p>${escapeHtml(t('tournaments.empty'))}</p>
                </div>`;
            return;
        }

        // Los más recientes primero
        el.list.innerHTML = [...tournaments]
            .reverse()
            .map((tour) => {
                const champion = engine.getChampion(tour);
                return `
                <button type="button" class="tournament-card" data-tournament-id="${escapeHtml(tour.id)}">
                    <span class="tournament-card__title">${escapeHtml(tour.name)}</span>
                    <span class="tournament-card__meta d-flex flex-wrap justify-content-between gap-2">
                        <span>${escapeHtml(describeTournament(tour))}</span>
                        <span class="badge text-bg-light">${escapeHtml(i18n.formatLabel(tour.format))}</span>
                    </span>
                    <span class="tournament-card__progress">
                        ${describeProgress(tour)}
                        ${champion ? `· 🏆 <strong>${escapeHtml(champion)}</strong>` : ''}
                    </span>
                    ${prizeBadgeHtml(tour)}
                </button>`;
            })
            .join('');
    }

    // =====================================================================
    // CREACIÓN DE TORNEO
    // =====================================================================

    /** Campos de nombre de una fila y el tipo de foto que lleva cada uno. */
    const ROW_PHOTO_FIELDS = { name: PHOTO_KIND.TEAM, p1: PHOTO_KIND.PLAYER, p2: PHOTO_KIND.PLAYER };

    /** Añade una fila de dupla clonando el <template id="tpl-team-row">. */
    function addTeamRow() {
        const fragment = byId('tpl-team-row').content.cloneNode(true);
        VP.language.translate(fragment);
        const row = qs('.team-row', fragment);
        el.teamRows.appendChild(fragment);
        Object.entries(ROW_PHOTO_FIELDS).forEach(([field, kind]) => picker.attach(qs(`[data-field="${field}"]`, row), kind));
        renumberTeamRows();
        prizePanel.syncTeamRowPayments();
        prizePanel.renderCreatePreview();
        // Enfocar el primer jugador de la nueva fila para agilizar la carga
        qs('[data-field="p1"]', row)?.focus();
    }

    /** Actualiza los números visibles y las etiquetas accesibles de cada fila. */
    function renumberTeamRows() {
        qsa('.team-row', el.teamRows).forEach((row, index) => {
            const number = index + 1;
            qs('.team-row__number', row).textContent = number;
            qs('[data-field="name"]', row).setAttribute('aria-label', t('tournamentForm.teamNameLabel', { number }));
            qs('[data-field="p1"]', row).setAttribute('aria-label', t('tournamentForm.playerLabel', { number, player: 1 }));
            qs('[data-field="p2"]', row).setAttribute('aria-label', t('tournamentForm.playerLabel', { number, player: 2 }));
            qs('[data-paid="p1"]', row).setAttribute('aria-label', t('tournamentForm.paidLabel', { number, player: 1 }));
            qs('[data-paid="p2"]', row).setAttribute('aria-label', t('tournamentForm.paidLabel', { number, player: 2 }));
            Object.keys(ROW_PHOTO_FIELDS).forEach((field) => picker.setLabel(qs(`[data-field="${field}"]`, row)));
        });
    }

    /** Muestra las reglas de sets o las de Queen & King según el formato elegido. */
    function syncFormatPanels() {
        const isKingOfCourt = byId('t-format').value === TOURNAMENT_FORMAT.KING_OF_COURT;
        byId('t-rules-kotc').hidden = !isKingOfCourt;
        byId('t-rules-sets').hidden = isKingOfCourt;
    }

    function openCreateModal() {
        el.formTournament.reset();
        syncFormatPanels();
        el.teamRows.innerHTML = '';
        prizePanel.resetCreateForm();
        for (let i = 0; i < MIN_TEAMS; i++) addTeamRow();
        openModal(el.modalCreate);
        byId('t-name').focus();
    }

    /**
     * Lee las duplas del formulario (con sus pagos). Ignora filas sin los dos jugadores.
     * @returns {Array<{row:HTMLElement, team:{name:string, p1:string, p2:string, paid:{p1:boolean, p2:boolean}}}>}
     *   Se conserva la fila para guardar después sus fotos.
     */
    function collectTeamRows() {
        return qsa('.team-row', el.teamRows)
            .map((row) => {
                const value = (field) => qs(`[data-field="${field}"]`, row).value.trim();
                const paid = (key) => qs(`[data-paid="${key}"]`, row).checked;
                const p1 = value('p1');
                const p2 = value('p2');
                return { row, team: { name: value('name') || `${p1} / ${p2}`, p1, p2, paid: { p1: paid('p1'), p2: paid('p2') } } };
            })
            .filter(({ team }) => team.p1 && team.p2);
    }

    /** Guarda las fotos elegidas en cada fila con los nombres definitivos. */
    function commitRowPhotos(entries) {
        entries.forEach(({ row, team }) => {
            const input = (field) => qs(`[data-field="${field}"]`, row);
            // Si la dupla no tiene nombre, la foto queda con el generado («Pedro / Juan»)
            picker.commit(input('name'), team.name);
            picker.commit(input('p1'), team.p1);
            picker.commit(input('p2'), team.p2);
        });
    }

    function handleCreateSubmit(event) {
        event.preventDefault();
        if (!el.formTournament.reportValidity()) return;

        const entries = collectTeamRows();
        const teams = entries.map((entry) => entry.team);
        const format = byId('t-format').value;

        const isKingOfCourt = format === TOURNAMENT_FORMAT.KING_OF_COURT;
        const minTeams = isKingOfCourt ? KOTC_DEFAULTS.minTeams : MIN_TEAMS;
        if (teams.length < minTeams) {
            const why = isKingOfCourt ? ` ${t('kotc.minTeamsWhy')}` : '';
            toast(`${t('tournamentForm.minTeams', { count: minTeams })}${why}`, { type: 'error' });
            return;
        }

        // El nombre de la dupla funciona como identificador: no puede repetirse
        const names = teams.map((team) => team.name.toLowerCase());
        const duplicated = teams.find((team, i) => names.indexOf(team.name.toLowerCase()) !== i);
        if (duplicated) {
            toast(t('tournamentForm.duplicated', { name: duplicated.name }), { type: 'error' });
            return;
        }
        if (teams.some((team) => team.name === SLOT.TBD || team.name === SLOT.BYE)) {
            toast(t('tournamentForm.reserved'), { type: 'error' });
            return;
        }

        const prizeForm = prizePanel.readCreateForm();
        if (prizeForm.error) {
            toast(prizeForm.error, { type: 'error' });
            return;
        }

        const tournament = engine.createTournament({
            name: byId('t-name').value.trim(),
            category: byId('t-category').value,
            gender: byId('t-gender').value,
            format,
            rules: {
                maxSets: toInt(byId('t-max-sets').value, 3),
                ptsNormal: toInt(byId('t-pts-normal').value, 21),
                ptsTiebreak: toInt(byId('t-pts-tiebreak').value, 15)
            },
            teams,
            kotc: {
                targetPoints: toInt(byId('t-kotc-target').value, KOTC_DEFAULTS.targetPoints),
                timeLimitMinutes: toInt(byId('t-kotc-minutes').value, 0)
            }
        });
        if (prizeForm.enabled) {
            const payments = Object.fromEntries(teams.map((team) => [team.name, team.paid]));
            prizeEngine.enablePrize(tournament, prizeForm.settings, payments);
        }

        storage.addTournament(tournament);
        commitRowPhotos(entries);
        closeModal(el.modalCreate);
        renderList();

        if (isKingOfCourt) {
            toast(t('kotc.created', { name: tournament.name, count: teams.length, target: tournament.kotc.settings.targetPoints }), { type: 'success' });
        } else if (format === TOURNAMENT_FORMAT.ROUND_ROBIN && teams.length < 3) {
            toast(t('tournamentForm.fewTeamsWarning'), { type: 'warning' });
        } else {
            toast(t('tournamentForm.created', { name: tournament.name, count: tournament.matches.length }), { type: 'success' });
        }
        openTournament(tournament.id);
    }

    // =====================================================================
    // DETALLE DE TORNEO
    // =====================================================================

    /** Torneo abierto en el detalle (siempre leído fresco de storage). */
    const getOpenTournament = () => storage.getTournament(context.tournamentId);

    /**
     * Abre el detalle de un torneo.
     * También "repara" torneos antiguos: aplica los pases por BYE que la
     * versión anterior mostraba pero nunca ejecutaba.
     * @param {string} tournamentId
     * @param {string} [tab='fixture'] Pestaña inicial.
     */
    function openDetail(tournamentId, tab = 'fixture') {
        context.tournamentId = tournamentId;
        const update = storage.updateTournament(tournamentId, (tour) => engine.resolveByes(tour));
        if (!update) {
            toast(t('tournaments.notFound'), { type: 'error' });
            return;
        }
        const isKnockout = update.tournament.format === TOURNAMENT_FORMAT.KNOCKOUT;
        // Mostrar sólo las pestañas que aplican al formato
        qs('[data-tab="bracket"]', el.tabs).hidden = !isKnockout;
        qs('[data-tab="standings"]', el.tabs).hidden = isKnockout;
        context.activeTab = qs(`[data-tab="${tab}"]`, el.tabs)?.hidden === false ? tab : 'fixture';

        renderDetail();
        openModal(el.modalDetail);
    }

    /** Repinta todo el contenido del detalle. */
    function renderDetail() {
        const tour = getOpenTournament();
        if (!tour) return;

        byId('detail-t-name').textContent = tour.name;
        byId('detail-t-info').textContent = [
            describeTournament(tour),
            i18n.formatLabel(tour.format),
            t('tournaments.matchCount', { count: tour.matches.length })
        ].join(' · ');

        const { done, total } = engine.getProgress(tour);
        byId('detail-t-progress-fill').style.width = `${total ? (done / total) * 100 : 0}%`;
        byId('detail-t-progress-label').textContent = t('tournaments.progress', { done, count: total });

        const champion = engine.getChampion(tour);
        const banner = byId('detail-t-champion');
        banner.hidden = !champion;
        banner.textContent = champion ? t('tournaments.champion', { name: champion }) : '';

        renderMatches(tour);
        renderTabs();
        if (context.activeTab === 'standings') renderStandings(tour);
        if (context.activeTab === 'bracket') renderBracket(tour);
        if (context.activeTab === 'prizes') prizePanel.render(tour.id, { onChange: renderList });
    }

    /** Activa la pestaña seleccionada y muestra su panel. */
    function renderTabs() {
        qsa('.nav-link', el.tabs).forEach((tab) => {
            const isActive = tab.dataset.tab === context.activeTab;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-selected', String(isActive));
        });
        Object.entries(TABS).forEach(([tab, panelId]) => {
            byId(panelId).hidden = context.activeTab !== tab;
        });
    }

    /** HTML de un hueco (dupla) dentro de la tarjeta de partido. */
    function teamSlotHtml(match, slot, { canEdit, isWinner }) {
        const name = match[slot];
        const { p1, p2 } = engine.getSlotTeam(match, slot);
        const placeholderText = { [SLOT.TBD]: t('tournaments.tbd'), [SLOT.BYE]: t('tournaments.bye') };
        const isPlaceholder = name in placeholderText;

        return `
            <div class="match-card__team ${isWinner ? 'match-card__team--winner' : ''}">
                ${!isPlaceholder && VP.photos.hasTeam(name)
                    ? `<img class="avatar avatar--md" src="${escapeHtml(VP.photos.teamSrc(name))}" alt="">`
                    : `<span aria-hidden="true">${isPlaceholder ? '⏳' : pickTeamEmoji(name)}</span>`}
                <div class="match-card__team-info">
                    <span class="match-card__team-name ${isPlaceholder ? 'match-card__team-name--placeholder' : ''}">
                        ${escapeHtml(isPlaceholder ? placeholderText[name] : name)}
                    </span>
                    ${p1 || p2 ? `<span class="match-card__players">👤 ${escapeHtml(p1 || '?')} / ${escapeHtml(p2 || '?')}</span>` : ''}
                </div>
                ${canEdit
                    ? `<button type="button" class="btn btn-link btn-sm p-0 fw-bold text-uppercase small" data-action="edit-team"
                         data-match-id="${escapeHtml(match.id)}" data-slot="${slot}">${escapeHtml(t('common.edit'))}</button>`
                    : ''}
            </div>`;
    }

    /** HTML de la zona de acciones según el estado del partido. */
    function matchActionsHtml(match) {
        const id = escapeHtml(match.id);
        if (match.walkover) {
            return `<p class="match-card__status small fst-italic text-body-secondary">${escapeHtml(t('tournaments.walkover'))}</p>`;
        }
        if (match.status === MATCH_STATUS.FINISHED) {
            return `
                <span class="match-card__score">${escapeHtml(t('tournaments.result', { score: match.score }))}</span>
                <button type="button" class="btn btn-outline-primary btn-sm" data-action="manual-score" data-match-id="${id}">
                    ${escapeHtml(t('tournaments.editScore'))}
                </button>`;
        }
        if (!engine.isPlayable(match)) {
            return `<p class="match-card__status small fst-italic text-body-secondary">${escapeHtml(t('tournaments.waiting'))}</p>`;
        }
        return `
            <button type="button" class="btn btn-primary btn-sm" data-action="start-match" data-match-id="${id}">
                ${escapeHtml(t('tournaments.start'))}
            </button>
            <button type="button" class="btn btn-outline-primary btn-sm" data-action="manual-score" data-match-id="${id}">
                ${escapeHtml(t('tournaments.setScore'))}
            </button>`;
    }

    /** Lista de tarjetas de partido. */
    function renderMatches(tour) {
        const rounds = tour.format === TOURNAMENT_FORMAT.KNOCKOUT ? engine.getKnockoutRounds(tour) : null;
        const roundOf = (match) => {
            if (!rounds) return '';
            const index = rounds.findIndex((r) => r.includes(match));
            return i18n.roundLabel(index, rounds.length);
        };

        el.matches.innerHTML = tour.matches
            .map((match, index) => {
                const winnerSlot = engine.getWinnerSlot(match);
                const isFinished = match.status === MATCH_STATUS.FINISHED;
                const canEdit = !isFinished;
                const modifier = isFinished ? 'match-card--finished' : engine.isPlayable(match) ? '' : 'match-card--waiting';
                return `
                <article class="card match-card ${modifier}">
                    <div class="card-body vstack gap-3">
                        <header class="d-flex justify-content-between gap-2">
                            <span class="match-card__label">${escapeHtml(t('tournaments.matchNumber', { number: index + 1 }))}</span>
                            ${rounds ? `<span class="match-card__round">${escapeHtml(roundOf(match))}</span>` : ''}
                        </header>
                        <div class="vstack gap-1">
                            ${teamSlotHtml(match, 'teamA', { canEdit, isWinner: winnerSlot === 'teamA' })}
                            <div class="match-card__vs" aria-hidden="true">VS</div>
                            ${teamSlotHtml(match, 'teamB', { canEdit, isWinner: winnerSlot === 'teamB' })}
                        </div>
                        <footer class="match-card__actions d-flex flex-wrap align-items-center justify-content-end gap-2 pt-2 border-top">
                            ${matchActionsHtml(match)}
                        </footer>
                    </div>
                </article>`;
            })
            .join('');
    }

    /** Tabla de clasificación (sólo Round Robin). */
    function renderStandings(tour) {
        const rows = engine.computeStandings(tour);
        const panel = byId('panel-standings');
        if (!rows.length) {
            panel.innerHTML = `<p class="text-center text-body-secondary py-3">${escapeHtml(t('standings.empty'))}</p>`;
            return;
        }
        const th = (key) => `<th scope="col" title="${escapeHtml(t(`standings.${key}Hint`))}">${escapeHtml(t(`standings.${key}`))}</th>`;
        panel.innerHTML = `
            <div class="table-responsive">
                <table class="table table-sm table-striped align-middle text-center mb-0">
                    <thead class="table-dark">
                        <tr>
                            <th scope="col">#</th><th scope="col">${escapeHtml(t('standings.team'))}</th>
                            ${th('played')}${th('won')}${th('lost')}${th('sets')}${th('points')}
                        </tr>
                    </thead>
                    <tbody>
                        ${rows
                            .map(
                                (r, i) => `
                            <tr class="${i === 0 && r.played ? 'table-warning fw-bold' : ''}">
                                <td>${i + 1}</td>
                                <td class="text-start text-nowrap">${pickTeamEmoji(r.team)} ${escapeHtml(r.team)}</td>
                                <td>${r.played}</td><td>${r.won}</td><td>${r.lost}</td>
                                <td>${r.setsFor}-${r.setsAgainst}</td>
                                <td><strong>${r.points}</strong></td>
                            </tr>`
                            )
                            .join('')}
                    </tbody>
                </table>
            </div>
            <p class="small text-body-secondary text-center mt-2">
                ${escapeHtml(t('standings.legend', { win: STANDING_POINTS.win, loss: STANDING_POINTS.loss }))}
            </p>`;
    }

    /** Cuadro visual de eliminación directa, una columna por ronda. */
    function renderBracket(tour) {
        const rounds = engine.getKnockoutRounds(tour);
        const teamHtml = (match, slot) => {
            const winnerSlot = engine.getWinnerSlot(match);
            const score = engine.parseScore(match.score);
            let value = '-';
            if (match.walkover) value = winnerSlot === slot ? '✓' : '';
            else if (match.status === MATCH_STATUS.FINISHED && score) value = slot === 'teamA' ? score.a : score.b;
            const name = match[slot] === SLOT.TBD ? t('tournaments.tbd') : match[slot];
            return `
                <div class="bracket__team ${winnerSlot === slot ? 'bracket__team--winner' : ''}">
                    <span class="text-truncate">${escapeHtml(name)}</span>
                    <span class="bracket__team-score">${value}</span>
                </div>`;
        };

        byId('panel-bracket').innerHTML = `
            <div class="bracket">
                ${rounds
                    .map(
                        (round, r) => `
                    <div class="bracket__round">
                        <h4 class="bracket__round-title">${escapeHtml(i18n.roundLabel(r, rounds.length))}</h4>
                        <div class="bracket__matches">
                            ${round
                                .map(
                                    (match) => `
                                <div class="bracket__match ${match.walkover ? 'bracket__match--walkover' : ''}">
                                    ${teamHtml(match, 'teamA')}
                                    ${teamHtml(match, 'teamB')}
                                </div>`
                                )
                                .join('')}
                        </div>
                    </div>`
                    )
                    .join('')}
            </div>`;
    }

    async function handleDeleteTournament() {
        const tour = getOpenTournament();
        if (!tour) return;
        const accepted = await confirm({
            title: t('tournaments.deleteTitle'),
            message: t('tournaments.deleteMessage', { name: tour.name }),
            confirmLabel: t('common.delete'),
            danger: true
        });
        if (!accepted) return;

        // Si el partido en curso pertenecía a este torneo, se desvincula
        if (VP.matchStore.getState().tournamentId === tour.id) VP.matchStore.discard();
        storage.deleteTournament(tour.id);
        closeModal(el.modalDetail);
        renderList();
        toast(t('tournaments.deleted'), { type: 'success' });
    }

    // =====================================================================
    // RESULTADO MANUAL
    // =====================================================================

    function openManualScore(matchId) {
        const tour = getOpenTournament();
        const match = tour && engine.findMatch(tour, matchId);
        if (!match) return;
        context.matchId = matchId;

        const { maxSets } = VP.rules.normalizeRules(tour.config_sets);
        byId('manual-score-match-info').textContent = t('manual.matchInfo', { teamA: match.teamA, teamB: match.teamB, count: maxSets });

        // Una fila por set posible
        const header = `
            <div class="manual-set">
                <span></span>
                <span class="manual-set__team">${escapeHtml(match.teamA)}</span>
                <span></span>
                <span class="manual-set__team">${escapeHtml(match.teamB)}</span>
            </div>`;
        const rows = Array.from({ length: maxSets }, (_, i) => `
            <div class="manual-set manual-set--body">
                <span class="small fw-bold">Set ${i + 1}</span>
                <input type="number" class="form-control manual-set__input" data-set="${i}" data-team="a" min="0" max="99"
                    inputmode="numeric" aria-label="${escapeHtml(t('manual.pointsLabel', { set: i + 1, team: match.teamA }))}">
                <span class="text-center">-</span>
                <input type="number" class="form-control manual-set__input" data-set="${i}" data-team="b" min="0" max="99"
                    inputmode="numeric" aria-label="${escapeHtml(t('manual.pointsLabel', { set: i + 1, team: match.teamB }))}">
            </div>`).join('');
        el.manualSets.innerHTML = header + rows;

        openModal(el.modalManual);
        qs('.manual-set__input', el.manualSets).focus();
    }

    function handleManualSubmit(event) {
        event.preventDefault();
        const tour = getOpenTournament();
        if (!tour) return;

        // Leer los inputs como [{a, b}, …] (null = vacío)
        const read = (input) => (input.value === '' ? null : toInt(input.value, null));
        const setScores = qsa('.manual-set--body', el.manualSets).map((row) => ({
            a: read(qs('[data-team="a"]', row)),
            b: read(qs('[data-team="b"]', row))
        }));

        const evaluation = VP.rules.evaluateManualResult(setScores, tour.config_sets);
        if (!evaluation.ok) {
            toast(i18n.errorMessage(evaluation), { type: 'error' });
            return;
        }

        const update = storage.updateTournament(tour.id, (tr) =>
            engine.recordResult(tr, context.matchId, evaluation.setsA, evaluation.setsB)
        );
        if (!update.result.ok) {
            toast(i18n.errorMessage(update.result), { type: 'error' });
            return;
        }

        closeModal(el.modalManual);
        renderDetail();
        renderList();
        toast(t('manual.saved', { a: evaluation.setsA, b: evaluation.setsB }), { type: 'success' });
    }

    // =====================================================================
    // EDITAR DUPLA DE UN PARTIDO
    // =====================================================================

    function openEditTeam(matchId, slot) {
        const tour = getOpenTournament();
        const match = tour && engine.findMatch(tour, matchId);
        if (!match) return;
        context.matchId = matchId;
        context.slot = slot;

        const team = engine.getSlotTeam(match, slot);
        byId('edit-team-name').value = engine.isRealTeam(team.name) ? team.name : '';
        byId('edit-team-p1').value = team.p1;
        byId('edit-team-p2').value = team.p2;
        picker.refresh(byId('edit-team-name'), byId('edit-team-p1'), byId('edit-team-p2'));
        openModal(el.modalEditTeam);
        byId('edit-team-name').focus();
    }

    /** Guarda la dupla del hueco. `clear = true` la deja en "TBD". */
    function saveEditedTeam(clear) {
        const name = clear ? SLOT.TBD : byId('edit-team-name').value.trim() || SLOT.TBD;
        const team = clear
            ? { name, p1: '', p2: '' }
            : { name, p1: byId('edit-team-p1').value.trim(), p2: byId('edit-team-p2').value.trim() };

        if (!clear) {
            // «TBD» no es una dupla real: su foto no se guarda
            picker.commit(byId('edit-team-name'), engine.isRealTeam(name) ? name : '');
            picker.commit(byId('edit-team-p1'), team.p1);
            picker.commit(byId('edit-team-p2'), team.p2);
        }

        storage.updateTournament(context.tournamentId, (tour) => engine.setMatchTeam(tour, context.matchId, context.slot, team));
        closeModal(el.modalEditTeam);
        renderDetail();
    }

    // =====================================================================
    // INICIAR PARTIDO DEL TORNEO
    // =====================================================================

    /**
     * Lleva al usuario a Configuración con los datos del partido precargados.
     * Si ya hay otro partido en curso con puntos, pide confirmación para descartarlo.
     */
    async function startMatch(matchId) {
        const tour = getOpenTournament();
        const match = tour && engine.findMatch(tour, matchId);
        if (!match) return;

        const store = VP.matchStore;
        const current = store.getState();
        const isSameMatch = current.tournamentMatchId === matchId;

        if (store.hasMatch() && isSameMatch) {
            // Retomar el mismo partido
            closeModal(el.modalDetail);
            VP.router.go('vista-marcador-vivo');
            return;
        }
        if (store.hasPoints()) {
            const accepted = await confirm({
                title: t('tournaments.matchInProgressTitle'),
                message: t('tournaments.matchInProgressMessage', { teamA: store.getTeamName('A'), teamB: store.getTeamName('B') }),
                confirmLabel: t('tournaments.discardAndContinue'),
                danger: true
            });
            if (!accepted) return;
            store.discard();
        }

        closeModal(el.modalDetail);
        VP.views.config.prepareTournamentMatch(tour, match);
    }

    // =====================================================================
    // INICIALIZACIÓN
    // =====================================================================

    function init() {
        el = {
            list: byId('tournaments-list'),
            modalCreate: byId('modal-tournament'),
            formTournament: byId('form-tournament'),
            teamRows: byId('t-dynamic-teams'),
            modalDetail: byId('modal-tournament-detail'),
            tabs: byId('detail-tabs'),
            matches: byId('tournament-matches'),
            modalManual: byId('modal-manual-score'),
            manualSets: byId('manual-sets'),
            modalEditTeam: byId('modal-edit-team')
        };

        prizePanel.init();
        picker.attach(byId('edit-team-name'), PHOTO_KIND.TEAM);
        picker.attach(byId('edit-team-p1'), PHOTO_KIND.PLAYER);
        picker.attach(byId('edit-team-p2'), PHOTO_KIND.PLAYER);

        // Crear torneo
        byId('btn-create-tournament').addEventListener('click', openCreateModal);
        byId('btn-add-team').addEventListener('click', addTeamRow);
        byId('t-format').addEventListener('change', syncFormatPanels);
        el.formTournament.addEventListener('submit', handleCreateSubmit);
        delegate(el.teamRows, 'click', '.team-row__remove', (_event, button) => {
            if (qsa('.team-row', el.teamRows).length <= MIN_TEAMS) {
                toast(t('tournamentForm.minTeamsRemove', { count: MIN_TEAMS }), { type: 'warning' });
                return;
            }
            button.closest('.team-row').remove();
            renumberTeamRows();
            prizePanel.renderCreatePreview();
        });

        // Abrir detalle desde una tarjeta
        delegate(el.list, 'click', '.tournament-card', (_event, card) => openTournament(card.dataset.tournamentId));

        // Pestañas del detalle
        delegate(el.tabs, 'click', '.nav-link', (_event, tab) => {
            context.activeTab = tab.dataset.tab;
            renderDetail();
        });

        // Acciones de las tarjetas de partido (delegación: un solo listener)
        delegate(el.matches, 'click', '[data-action]', (_event, button) => {
            const { action, matchId, slot } = button.dataset;
            if (action === 'start-match') startMatch(matchId);
            if (action === 'manual-score') openManualScore(matchId);
            if (action === 'edit-team') openEditTeam(matchId, slot);
        });

        byId('btn-delete-tournament').addEventListener('click', handleDeleteTournament);
        byId('form-manual-score').addEventListener('submit', handleManualSubmit);
        byId('form-edit-team').addEventListener('submit', (event) => {
            event.preventDefault();
            saveEditedTeam(false);
        });
        byId('btn-clear-team').addEventListener('click', () => saveEditedTeam(true));

        // Cambio de idioma: repintar lo generado con JS
        i18n.onChange(() => {
            renderList();
            renumberTeamRows();
            if (el.modalDetail.open) renderDetail();
            if (el.modalManual.open && context.matchId) {
                // Conserva los puntos ya escritos
                const values = qsa('.manual-set__input', el.manualSets).map((input) => input.value);
                openManualScore(context.matchId);
                qsa('.manual-set__input', el.manualSets).forEach((input, i) => (input.value = values[i] ?? ''));
            }
        });

        VP.router.register('vista-torneos', { onEnter: renderList });
    }

    VP.views = VP.views || {};
    VP.views.tournaments = Object.freeze({ init, renderList, openDetail });
})(window);
