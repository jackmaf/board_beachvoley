/**
 * @file tournaments-view.js
 * @description Vista "Torneos": listado, creación, detalle (partidos,
 * clasificación y llaves), resultado manual y edición de duplas.
 *
 * Esta vista sólo PINTA y RECOGE eventos. La lógica (generar llaves, avanzar
 * ganadores, BYE, clasificación) vive en `core/tournament-engine.js` y la
 * persistencia en `services/storage.js`.
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { byId, qs, qsa, delegate, openModal, closeModal } = VP.dom;
    const { escapeHtml, pickTeamEmoji, toInt } = VP.utils;
    const { TOURNAMENT_FORMAT, FORMAT_LABEL, MATCH_STATUS, SLOT, GENDER_LABEL, STANDING_POINTS, KOTC_DEFAULTS } = VP.constants;
    const engine = VP.tournamentEngine;
    const storage = VP.storage;
    const { toast, confirm } = VP.feedback;

    /** Mínimo de duplas para crear un torneo. */
    const MIN_TEAMS = 2;

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
    const describeTournament = (t) => `Cat. ${t.category} · ${GENDER_LABEL[t.gender] || t.gender}`;

    /**
     * Línea de progreso de la tarjeta.
     *  - Formatos con partidos: "3/7 partidos jugados".
     *  - Queen & King: líder y puntos ("Líder: Brasil 12/15 pts · 40 rallies").
     */
    function describeProgress(t) {
        if (!t.kotc) {
            const { done, total } = engine.getProgress(t);
            return `${done}/${total} partidos jugados`;
        }
        const [leader] = VP.kotcEngine.computeStandings(t.kotc);
        const { targetPoints } = t.kotc.settings;
        return t.kotc.rallies
            ? `Líder: ${escapeHtml(leader.name)} ${leader.points}/${targetPoints} pts · ${t.kotc.rallies} rallies`
            : `👑 Listo para empezar · a ${targetPoints} puntos`;
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
                    <p>No hay torneos creados aún.</p>
                </div>`;
            return;
        }

        // Los más recientes primero
        el.list.innerHTML = [...tournaments]
            .reverse()
            .map((t) => {
                const champion = engine.getChampion(t);
                return `
                <button type="button" class="tournament-card" data-tournament-id="${escapeHtml(t.id)}">
                    <span class="tournament-card__title">${escapeHtml(t.name)}</span>
                    <span class="tournament-card__meta d-flex flex-wrap justify-content-between gap-2">
                        <span>${escapeHtml(describeTournament(t))}</span>
                        <span class="badge text-bg-light">${escapeHtml(FORMAT_LABEL[t.format] || t.format)}</span>
                    </span>
                    <span class="tournament-card__progress">
                        ${describeProgress(t)}
                        ${champion ? `· 🏆 <strong>${escapeHtml(champion)}</strong>` : ''}
                    </span>
                </button>`;
            })
            .join('');
    }

    // =====================================================================
    // CREACIÓN DE TORNEO
    // =====================================================================

    /** Añade una fila de dupla clonando el <template id="tpl-team-row">. */
    function addTeamRow() {
        const fragment = byId('tpl-team-row').content.cloneNode(true);
        el.teamRows.appendChild(fragment);
        renumberTeamRows();
        // Enfocar el primer jugador de la nueva fila para agilizar la carga
        const rows = qsa('.team-row', el.teamRows);
        qs('[data-field="p1"]', rows[rows.length - 1])?.focus();
    }

    /** Actualiza los números visibles y las etiquetas accesibles de cada fila. */
    function renumberTeamRows() {
        qsa('.team-row', el.teamRows).forEach((row, index) => {
            const number = index + 1;
            qs('.team-row__number', row).textContent = number;
            qs('[data-field="name"]', row).setAttribute('aria-label', `Nombre de la dupla ${number}`);
            qs('[data-field="p1"]', row).setAttribute('aria-label', `Dupla ${number}, jugador 1`);
            qs('[data-field="p2"]', row).setAttribute('aria-label', `Dupla ${number}, jugador 2`);
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
        for (let i = 0; i < MIN_TEAMS; i++) addTeamRow();
        openModal(el.modalCreate);
        byId('t-name').focus();
    }

    /** Lee las duplas del formulario. Ignora filas sin los dos jugadores. */
    function collectTeams() {
        return qsa('.team-row', el.teamRows)
            .map((row) => {
                const value = (field) => qs(`[data-field="${field}"]`, row).value.trim();
                const p1 = value('p1');
                const p2 = value('p2');
                return { name: value('name') || `${p1} / ${p2}`, p1, p2 };
            })
            .filter((team) => team.p1 && team.p2);
    }

    function handleCreateSubmit(event) {
        event.preventDefault();
        if (!el.formTournament.reportValidity()) return;

        const teams = collectTeams();
        const format = byId('t-format').value;

        const isKingOfCourt = format === TOURNAMENT_FORMAT.KING_OF_COURT;
        const minTeams = isKingOfCourt ? KOTC_DEFAULTS.minTeams : MIN_TEAMS;
        if (teams.length < minTeams) {
            const why = isKingOfCourt ? ' Queen & King necesita trono, retador y al menos una dupla en cola.' : '';
            toast(`Ingresa al menos ${minTeams} duplas válidas (con sus dos jugadores).${why}`, { type: 'error' });
            return;
        }

        // El nombre de la dupla funciona como identificador: no puede repetirse
        const names = teams.map((t) => t.name.toLowerCase());
        const duplicated = teams.find((t, i) => names.indexOf(t.name.toLowerCase()) !== i);
        if (duplicated) {
            toast(`La dupla «${duplicated.name}» está repetida. Usa nombres distintos.`, { type: 'error' });
            return;
        }
        if (teams.some((t) => t.name === SLOT.TBD || t.name === SLOT.BYE)) {
            toast('«TBD» y «BYE» son nombres reservados.', { type: 'error' });
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

        storage.addTournament(tournament);
        closeModal(el.modalCreate);
        renderList();

        if (isKingOfCourt) {
            toast(`¡A jugar! «${tournament.name}»: ${teams.length} duplas a ${tournament.kotc.settings.targetPoints} puntos.`, { type: 'success' });
        } else if (format === TOURNAMENT_FORMAT.ROUND_ROBIN && teams.length < 3) {
            toast('Torneo creado. Para Round Robin se recomiendan al menos 3 duplas.', { type: 'warning' });
        } else {
            toast(`Torneo «${tournament.name}» creado con ${tournament.matches.length} partidos.`, { type: 'success' });
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
     */
    function openDetail(tournamentId) {
        context.tournamentId = tournamentId;
        const update = storage.updateTournament(tournamentId, (t) => engine.resolveByes(t));
        if (!update) {
            toast('No se encontró el torneo.', { type: 'error' });
            return;
        }
        const isKnockout = update.tournament.format === TOURNAMENT_FORMAT.KNOCKOUT;
        context.activeTab = 'fixture';
        // Mostrar sólo las pestañas que aplican al formato
        qs('[data-tab="bracket"]', el.tabs).hidden = !isKnockout;
        qs('[data-tab="standings"]', el.tabs).hidden = isKnockout;

        renderDetail();
        openModal(el.modalDetail);
    }

    /** Repinta todo el contenido del detalle. */
    function renderDetail() {
        const t = getOpenTournament();
        if (!t) return;

        byId('detail-t-name').textContent = t.name;
        byId('detail-t-info').textContent = `${describeTournament(t)} · ${FORMAT_LABEL[t.format] || t.format} · ${t.matches.length} partidos`;

        const { done, total } = engine.getProgress(t);
        byId('detail-t-progress-fill').style.width = `${total ? (done / total) * 100 : 0}%`;
        byId('detail-t-progress-label').textContent = `${done} / ${total} partidos`;

        const champion = engine.getChampion(t);
        const banner = byId('detail-t-champion');
        banner.hidden = !champion;
        banner.textContent = champion ? `🏆 Campeón: ${champion}` : '';

        renderMatches(t);
        renderTabs();
        if (context.activeTab === 'standings') renderStandings(t);
        if (context.activeTab === 'bracket') renderBracket(t);
    }

    /** Activa la pestaña seleccionada y muestra su panel. */
    function renderTabs() {
        qsa('.nav-link', el.tabs).forEach((tab) => {
            const isActive = tab.dataset.tab === context.activeTab;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-selected', String(isActive));
        });
        byId('panel-fixture').hidden = context.activeTab !== 'fixture';
        byId('panel-standings').hidden = context.activeTab !== 'standings';
        byId('panel-bracket').hidden = context.activeTab !== 'bracket';
    }

    /** HTML de un hueco (dupla) dentro de la tarjeta de partido. */
    function teamSlotHtml(match, slot, { canEdit, isWinner }) {
        const name = match[slot];
        const { p1, p2 } = engine.getSlotTeam(match, slot);
        const placeholderText = { [SLOT.TBD]: 'Por definir', [SLOT.BYE]: 'Libre (BYE)' };
        const isPlaceholder = name in placeholderText;

        return `
            <div class="match-card__team ${isWinner ? 'match-card__team--winner' : ''}">
                <span aria-hidden="true">${isPlaceholder ? '⏳' : pickTeamEmoji(name)}</span>
                <div class="match-card__team-info">
                    <span class="match-card__team-name ${isPlaceholder ? 'match-card__team-name--placeholder' : ''}">
                        ${escapeHtml(isPlaceholder ? placeholderText[name] : name)}
                    </span>
                    ${p1 || p2 ? `<span class="match-card__players">👤 ${escapeHtml(p1 || '?')} / ${escapeHtml(p2 || '?')}</span>` : ''}
                </div>
                ${canEdit
                    ? `<button type="button" class="btn btn-link btn-sm p-0 fw-bold text-uppercase small" data-action="edit-team"
                         data-match-id="${escapeHtml(match.id)}" data-slot="${slot}">Editar</button>`
                    : ''}
            </div>`;
    }

    /** HTML de la zona de acciones según el estado del partido. */
    function matchActionsHtml(match) {
        const id = escapeHtml(match.id);
        if (match.walkover) return '<p class="match-card__status small fst-italic text-body-secondary">Pase directo (BYE)</p>';
        if (match.status === MATCH_STATUS.FINISHED) {
            return `
                <span class="match-card__score">Resultado: ${escapeHtml(match.score)}</span>
                <button type="button" class="btn btn-outline-primary btn-sm" data-action="manual-score" data-match-id="${id}">
                    Modificar marcador
                </button>`;
        }
        if (!engine.isPlayable(match)) {
            return '<p class="match-card__status small fst-italic text-body-secondary">A la espera de rivales</p>';
        }
        return `
            <button type="button" class="btn btn-primary btn-sm" data-action="start-match" data-match-id="${id}">
                🏐 Pitar
            </button>
            <button type="button" class="btn btn-outline-primary btn-sm" data-action="manual-score" data-match-id="${id}">
                Colocar marcador
            </button>`;
    }

    /** Lista de tarjetas de partido. */
    function renderMatches(t) {
        const rounds = t.format === TOURNAMENT_FORMAT.KNOCKOUT ? engine.getKnockoutRounds(t) : null;
        const roundOf = (match) => {
            if (!rounds) return '';
            const index = rounds.findIndex((r) => r.includes(match));
            return engine.getRoundLabel(index, rounds.length);
        };

        el.matches.innerHTML = t.matches
            .map((match, index) => {
                const winnerSlot = engine.getWinnerSlot(match);
                const isFinished = match.status === MATCH_STATUS.FINISHED;
                const canEdit = !isFinished;
                const modifier = isFinished ? 'match-card--finished' : engine.isPlayable(match) ? '' : 'match-card--waiting';
                return `
                <article class="card match-card ${modifier}">
                    <div class="card-body vstack gap-3">
                        <header class="d-flex justify-content-between gap-2">
                            <span class="match-card__label">Partido ${index + 1}</span>
                            ${rounds ? `<span class="match-card__round">${roundOf(match)}</span>` : ''}
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
    function renderStandings(t) {
        const rows = engine.computeStandings(t);
        const panel = byId('panel-standings');
        if (!rows.length) {
            panel.innerHTML = '<p class="text-center text-body-secondary py-3">Aún no hay duplas en la clasificación.</p>';
            return;
        }
        panel.innerHTML = `
            <div class="table-responsive">
                <table class="table table-sm table-striped align-middle text-center mb-0">
                    <thead class="table-dark">
                        <tr>
                            <th scope="col">#</th><th scope="col">Dupla</th>
                            <th scope="col" title="Partidos jugados">PJ</th>
                            <th scope="col" title="Partidos ganados">PG</th>
                            <th scope="col" title="Partidos perdidos">PP</th>
                            <th scope="col" title="Sets a favor - en contra">Sets</th>
                            <th scope="col" title="Puntos de clasificación">Pts</th>
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
                Victoria = ${STANDING_POINTS.win} pts · Derrota = ${STANDING_POINTS.loss} pt ·
                Desempate por diferencia de sets.
            </p>`;
    }

    /** Cuadro visual de eliminación directa, una columna por ronda. */
    function renderBracket(t) {
        const rounds = engine.getKnockoutRounds(t);
        const teamHtml = (match, slot) => {
            const winnerSlot = engine.getWinnerSlot(match);
            const score = engine.parseScore(match.score);
            let value = '-';
            if (match.walkover) value = winnerSlot === slot ? '✓' : '';
            else if (match.status === MATCH_STATUS.FINISHED && score) value = slot === 'teamA' ? score.a : score.b;
            const name = match[slot] === SLOT.TBD ? 'Por definir' : match[slot];
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
                        <h4 class="bracket__round-title">${engine.getRoundLabel(r, rounds.length)}</h4>
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
        const t = getOpenTournament();
        if (!t) return;
        const accepted = await confirm({
            title: 'Eliminar torneo',
            message: `¿Seguro que quieres eliminar «${t.name}»? Esta acción no se puede deshacer.`,
            confirmLabel: 'Eliminar',
            danger: true
        });
        if (!accepted) return;

        // Si el partido en curso pertenecía a este torneo, se desvincula
        if (VP.matchStore.getState().tournamentId === t.id) VP.matchStore.discard();
        storage.deleteTournament(t.id);
        closeModal(el.modalDetail);
        renderList();
        toast('Torneo eliminado.', { type: 'success' });
    }

    // =====================================================================
    // RESULTADO MANUAL
    // =====================================================================

    function openManualScore(matchId) {
        const t = getOpenTournament();
        const match = t && engine.findMatch(t, matchId);
        if (!match) return;
        context.matchId = matchId;

        const { maxSets } = VP.rules.normalizeRules(t.config_sets);
        byId('manual-score-match-info').textContent = `${match.teamA} vs ${match.teamB} · al mejor de ${maxSets}`;

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
                    inputmode="numeric" aria-label="Set ${i + 1}, puntos de ${escapeHtml(match.teamA)}">
                <span class="text-center">-</span>
                <input type="number" class="form-control manual-set__input" data-set="${i}" data-team="b" min="0" max="99"
                    inputmode="numeric" aria-label="Set ${i + 1}, puntos de ${escapeHtml(match.teamB)}">
            </div>`).join('');
        el.manualSets.innerHTML = header + rows;

        openModal(el.modalManual);
        qs('.manual-set__input', el.manualSets).focus();
    }

    function handleManualSubmit(event) {
        event.preventDefault();
        const t = getOpenTournament();
        if (!t) return;

        // Leer los inputs como [{a, b}, …] (null = vacío)
        const read = (input) => (input.value === '' ? null : toInt(input.value, null));
        const setScores = qsa('.manual-set--body', el.manualSets).map((row) => ({
            a: read(qs('[data-team="a"]', row)),
            b: read(qs('[data-team="b"]', row))
        }));

        const evaluation = VP.rules.evaluateManualResult(setScores, t.config_sets);
        if (!evaluation.ok) {
            toast(evaluation.error, { type: 'error' });
            return;
        }

        const update = storage.updateTournament(t.id, (tour) =>
            engine.recordResult(tour, context.matchId, evaluation.setsA, evaluation.setsB)
        );
        if (!update.result.ok) {
            toast(update.result.error, { type: 'error' });
            return;
        }

        closeModal(el.modalManual);
        renderDetail();
        renderList();
        toast(`Resultado guardado: ${evaluation.setsA} - ${evaluation.setsB}.`, { type: 'success' });
    }

    // =====================================================================
    // EDITAR DUPLA DE UN PARTIDO
    // =====================================================================

    function openEditTeam(matchId, slot) {
        const t = getOpenTournament();
        const match = t && engine.findMatch(t, matchId);
        if (!match) return;
        context.matchId = matchId;
        context.slot = slot;

        const team = engine.getSlotTeam(match, slot);
        byId('edit-team-name').value = engine.isRealTeam(team.name) ? team.name : '';
        byId('edit-team-p1').value = team.p1;
        byId('edit-team-p2').value = team.p2;
        openModal(el.modalEditTeam);
        byId('edit-team-name').focus();
    }

    /** Guarda la dupla del hueco. `clear = true` la deja en "TBD". */
    function saveEditedTeam(clear) {
        const name = clear ? SLOT.TBD : byId('edit-team-name').value.trim() || SLOT.TBD;
        const team = clear
            ? { name, p1: '', p2: '' }
            : { name, p1: byId('edit-team-p1').value.trim(), p2: byId('edit-team-p2').value.trim() };

        storage.updateTournament(context.tournamentId, (t) => engine.setMatchTeam(t, context.matchId, context.slot, team));
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
        const t = getOpenTournament();
        const match = t && engine.findMatch(t, matchId);
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
                title: 'Hay un partido en curso',
                message: `${store.getTeamName('A')} vs ${store.getTeamName('B')} no se ha finalizado. ¿Descartarlo y empezar este?`,
                confirmLabel: 'Descartar y continuar',
                danger: true
            });
            if (!accepted) return;
            store.discard();
        }

        closeModal(el.modalDetail);
        VP.views.config.prepareTournamentMatch(t, match);
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

        // Crear torneo
        byId('btn-create-tournament').addEventListener('click', openCreateModal);
        byId('btn-add-team').addEventListener('click', addTeamRow);
        byId('t-format').addEventListener('change', syncFormatPanels);
        el.formTournament.addEventListener('submit', handleCreateSubmit);
        delegate(el.teamRows, 'click', '.team-row__remove', (_event, button) => {
            if (qsa('.team-row', el.teamRows).length <= MIN_TEAMS) {
                toast(`Debes tener al menos ${MIN_TEAMS} duplas.`, { type: 'warning' });
                return;
            }
            button.closest('.team-row').remove();
            renumberTeamRows();
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

        VP.router.register('vista-torneos', { onEnter: renderList });
    }

    VP.views = VP.views || {};
    VP.views.tournaments = Object.freeze({ init, renderList, openDetail });
})(window);
