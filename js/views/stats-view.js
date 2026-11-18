/**
 * @file stats-view.js
 * @description Vista "Stats": análisis de un partido (en curso o del historial).
 *
 * Dos modos (selector «Partido | Torneo»):
 *  - Partido: resumen, desglose por jugador, indicadores profesionales, Salón
 *    de la Fama, filtros, heatmap y bitácora. Cálculos en `core/stats-engine.js`.
 *  - Torneo: resumen del torneo y, según el formato,
 *      · Queen & King: evolución de puntos (gráfica), destacados y rendimiento
 *        en el trono/retando (`core/tournament-stats.js` → computeKotcAnalytics).
 *      · Round Robin / Eliminación: clasificación, rendimiento por dupla y por
 *        jugador sumando sus partidos archivados, y acceso a cada partido.
 * Aquí sólo se gestionan filtros y se pinta.
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { byId, delegate, setActivePill } = VP.dom;
    const { escapeHtml, formatDuration, debounce, toInt, toMatchMinute } = VP.utils;
    // Foto subida por el usuario o, si no hay, el avatar generado
    const { playerSrc, teamSrc } = VP.photos;
    const { SKILLS, PLAYER_IDS, ACTION, SPINNER_THRESHOLD, RECEPTION_GRADES } = VP.constants;
    const stats = VP.statsEngine;
    const store = VP.matchStore;
    const i18n = VP.i18n;
    const { t } = i18n;

    const VIEW_ID = 'vista-estadisticas';
    const TIMELINE_STEP = 10;      // % que avanza la animación en cada paso
    const TIMELINE_INTERVAL = 800; // ms entre pasos

    /** Qué se analiza: un partido ('match') o un torneo completo ('tournament'). */
    let mode = 'match';
    /** Partido analizado: 'current' (en curso) o índice del historial. */
    let source = null;
    /** Torneo analizado en modo torneo (id). */
    let tournamentSource = null;
    /** Filtros activos (ver stats-engine.js → StatsFilters). */
    let filters = stats.createDefaultFilters();
    let timelineTimer = null;
    let el = {};

    // =====================================================================
    // FUENTE DE DATOS (partido en curso o historial)
    // =====================================================================

    /** @returns {Object|null} Estado del partido seleccionado. */
    function getSourceMatch() {
        if (source === 'current') return store.hasPoints() ? store.getState() : null;
        const history = VP.storage.getHistory();
        return Number.isInteger(source) ? history[source] || null : null;
    }

    /**
     * Bitácora del partido con `servingTeam` en cada rally (los partidos
     * antiguos lo reconstruyen). Se calcula sobre la bitácora COMPLETA,
     * antes de aplicar filtros.
     */
    const getAnnotatedPoints = (match) => stats.withServingTeam(match.points, match.config?.firstServer);

    /** Etiqueta "A vs B · 2-1 · 12 nov 18:30" para el selector. */
    function describeMatch(match) {
        const won = VP.rules.countSetsWon(match.sets || [], match.config || {});
        const lastPoint = match.points?.[match.points.length - 1];
        const timestamp = match.finishedAt || lastPoint?.timestamp;
        const date = timestamp
            ? new Date(timestamp).toLocaleString(i18n.getLocale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
            : '';
        return `${match.config?.teamA} vs ${match.config?.teamB} · ${won.A}-${won.B}${date ? ` · ${date}` : ''}`;
    }

    /**
     * Rellena el <select> de partidos y valida la selección actual.
     * Las opciones se agrupan (<optgroup>): partido en curso, un grupo por
     * torneo y los amistosos; así se encuentra rápido un partido de torneo.
     */
    function renderSourceOptions() {
        const history = VP.storage.getHistory();
        const tournamentNames = new Map(VP.storage.getTournaments().map((tour) => [tour.id, tour.name]));
        const groups = new Map(); // etiqueta → opciones (Map mantiene el orden de inserción)
        const add = (group, option) => {
            if (!groups.has(group)) groups.set(group, []);
            groups.get(group).push(option);
        };

        if (store.hasPoints()) add(t('tStats.groupCurrent'), { value: 'current', label: t('stats.inProgress', { match: describeMatch(store.getState()) }) });
        // Historial del más reciente al más antiguo
        for (let i = history.length - 1; i >= 0; i--) {
            const match = history[i];
            if (!match?.config) continue;
            const tourName = match.tournamentId && tournamentNames.get(match.tournamentId);
            add(tourName ? t('tStats.groupTournament', { name: tourName }) : t('tStats.groupFriendly'), { value: String(i), label: describeMatch(match) });
        }

        const options = [...groups.values()].flat();
        const values = options.map((o) => o.value);
        if (source === null || !values.includes(String(source))) {
            source = values.length ? parseSource(values[0]) : null;
            filters = stats.createDefaultFilters();
        }

        const optionHtml = (o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`;
        el.source.innerHTML = options.length
            ? [...groups.entries()]
                  .map(([label, list]) => `<optgroup label="${escapeHtml(label)}">${list.map(optionHtml).join('')}</optgroup>`)
                  .join('')
            : `<option value="">${escapeHtml(t('stats.noMatches'))}</option>`;
        el.source.value = source === null ? '' : String(source);
        el.source.disabled = options.length === 0;
    }

    /** Rellena el <select> de torneos (más recientes primero) y valida la selección. */
    function renderTournamentOptions() {
        const tournaments = [...VP.storage.getTournaments()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        if (!tournaments.some((tour) => tour.id === tournamentSource)) tournamentSource = tournaments[0]?.id ?? null;
        el.tournament.innerHTML = tournaments.length
            ? tournaments
                  .map((tour) => `<option value="${escapeHtml(tour.id)}">${escapeHtml(`${tour.name} · ${i18n.formatLabel(tour.format)}`)}</option>`)
                  .join('')
            : `<option value="">${escapeHtml(t('tStats.noTournaments'))}</option>`;
        el.tournament.value = tournamentSource ?? '';
        el.tournament.disabled = tournaments.length === 0;
    }

    const parseSource = (value) => (value === 'current' ? 'current' : toInt(value, null));

    /** Selecciona el último partido archivado (se usa al finalizar un partido). */
    function selectLatestHistory() {
        const length = VP.storage.getHistory().length;
        mode = 'match';
        source = length ? length - 1 : null;
        filters = stats.createDefaultFilters();
    }

    // =====================================================================
    // FILTROS
    // =====================================================================

    /** Genera las "pills" que dependen del partido (nombres y número de sets). */
    function renderFilterPills(match) {
        const config = match?.config || {};
        el.filterPlayers.innerHTML = [
            `<button type="button" class="btn btn-sm rounded-pill btn-outline-secondary" data-value="all">${escapeHtml(t('stats.allPlayers'))}</button>`,
            ...PLAYER_IDS.map(
                (id) => `<button type="button" class="btn btn-sm rounded-pill btn-outline-secondary btn--team-${id.charAt(0).toLowerCase()}" data-value="${id}">
                    ${escapeHtml(config[`p${id}`] || id)}</button>`
            )
        ].join('');

        el.filterDetails.innerHTML = [
            `<button type="button" class="btn btn-sm rounded-pill btn-outline-secondary" data-value="all">${escapeHtml(t('stats.allActions'))}</button>`,
            ...SKILLS.map((s) => `<button type="button" class="btn btn-sm rounded-pill btn-outline-secondary" data-value="${s.key}">${s.emoji} ${escapeHtml(i18n.skill(s.key))}</button>`)
        ].join('');

        const maxSets = VP.rules.normalizeRules(config).maxSets;
        el.filterSetsContainer.hidden = maxSets <= 1;
        el.filterSets.innerHTML = [
            `<button type="button" class="btn btn-sm rounded-pill btn-outline-secondary" data-value="all">${escapeHtml(t('stats.allSets'))}</button>`,
            ...Array.from({ length: maxSets }, (_, i) => `<button type="button" class="btn btn-sm rounded-pill btn-outline-secondary" data-value="${i + 1}">Set ${i + 1}</button>`)
        ].join('');

        syncFilterControls();
    }

    /** Refleja el objeto `filters` en los controles (pills, inputs, slider). */
    function syncFilterControls() {
        setActivePill(el.filterPlayers, filters.player);
        setActivePill(el.filterActions, filters.action);
        setActivePill(el.filterDetails, filters.actionDetail);
        setActivePill(el.filterSets, filters.set);
        el.timeMin.value = filters.minMinute ?? '';
        el.timeMax.value = filters.maxMinute ?? '';
        el.timeline.value = filters.timelinePct;
    }

    function resetFilters() {
        stopTimeline();
        filters = stats.createDefaultFilters();
        syncFilterControls();
        render();
    }

    /** Conecta un grupo de pills con una clave del objeto `filters`. */
    function bindPillGroup(group, key, parse = (v) => v) {
        delegate(group, 'click', '[data-value]', (_event, pill) => {
            const value = pill.dataset.value;
            filters[key] = value === 'all' ? 'all' : parse(value);
            setActivePill(group, value);
            render();
        });
    }

    // ---------------------------------------------------------------------
    // Línea de tiempo animada
    // ---------------------------------------------------------------------

    function stopTimeline() {
        clearInterval(timelineTimer);
        timelineTimer = null;
        el.playTimeline.textContent = t('stats.play');
        el.playTimeline.classList.remove('timeline__play--playing');
    }

    /** Reproduce el partido avanzando el slider en bucle. */
    function toggleTimeline() {
        if (timelineTimer) {
            stopTimeline();
            return;
        }
        if (filters.timelinePct >= 100) filters.timelinePct = 0;
        el.playTimeline.textContent = t('stats.pause');
        el.playTimeline.classList.add('timeline__play--playing');
        render();

        timelineTimer = setInterval(() => {
            filters.timelinePct = filters.timelinePct >= 100 ? 0 : Math.min(100, filters.timelinePct + TIMELINE_STEP);
            el.timeline.value = filters.timelinePct;
            render();
        }, TIMELINE_INTERVAL);
    }

    // =====================================================================
    // PINTADO
    // =====================================================================

    function renderEmpty() {
        const empty = (key) => `<p class="text-center text-body-secondary py-3 mb-0">${escapeHtml(t(key))}</p>`;
        el.finalScore.innerHTML = empty('stats.noData');
        el.duration.textContent = '00:00';
        el.totalPoints.textContent = '0';
        el.players.innerHTML = empty('stats.noPlayers');
        el.fame.innerHTML = '';
        el.pro.innerHTML = empty('stats.noPro');
        el.heatmap.innerHTML = '';
        el.logBody.innerHTML = `<tr><td colspan="7" class="text-body-secondary py-3">${escapeHtml(t('stats.noLog'))}</td></tr>`;
        el.timelineValue.textContent = t('stats.wholeMatch');
    }

    function renderSummary(match, bySet) {
        const { teamA, teamB } = match.config;
        const score = stats.computeScore(bySet);
        const won = VP.rules.countSetsWon(match.sets || [], match.config);
        const subtitle = filters.set === 'all' ? `Sets ${won.A} - ${won.B}` : t('stats.setPoints', { set: filters.set });

        const teamHtml = (name, team) => `
            <div class="summary__team summary__team--${team}">
                <img class="avatar avatar--logo avatar--team-${team}" src="${escapeHtml(teamSrc(name))}" alt="">
                <span class="summary__team-name">${escapeHtml(name)}</span>
            </div>`;

        el.finalScore.innerHTML = `
            ${teamHtml(teamA, 'a')}
            <div class="d-flex flex-column align-items-center">
                <span class="summary__points">${score.A} - ${score.B}</span>
                <span class="small text-body-secondary">${subtitle}</span>
            </div>
            ${teamHtml(teamB, 'b')}`;

        // Duración: el cronómetro oficial si se ve todo el partido; si no, el tramo filtrado
        const showsWholeMatch = filters.set === 'all' && filters.timelinePct === 100;
        const seconds = showsWholeMatch && match.matchTimeSeconds ? match.matchTimeSeconds : stats.computeSpanSeconds(bySet);
        el.duration.textContent = formatDuration(seconds);
        el.totalPoints.textContent = bySet.length;
    }

    function renderPlayers(totals) {
        el.players.innerHTML = PLAYER_IDS.map((id) => {
            const p = totals[id];
            const team = p.team.toLowerCase();
            return `
            <div class="player-stat d-flex flex-wrap align-items-center justify-content-between gap-2">
                <div class="player-stat__info d-flex align-items-center gap-2">
                    <img class="avatar avatar--md avatar--team-${team}" src="${escapeHtml(playerSrc(p.name))}" alt="">
                    <span class="player-stat__name">${escapeHtml(p.name)}</span>
                </div>
                <div class="d-flex flex-column align-items-end">
                    <span class="player-stat__pts">${p.pts} <small class="player-stat__unit">${escapeHtml(t('stats.winnerPoints', { count: p.pts }))}</small></span>
                    <span class="player-stat__errs">${escapeHtml(t('stats.errorCount', { count: p.errs }))}</span>
                </div>
                <div class="d-flex gap-2 w-100">
                    <button type="button" class="btn btn-dark btn-sm flex-fill" data-action="dashboard" data-player="${id}">${escapeHtml(t('stats.radarButton'))}</button>
                    <button type="button" class="btn btn-primary btn-sm flex-fill" data-action="log" data-player="${id}">${escapeHtml(t('stats.logButton'))}</button>
                </div>
            </div>`;
        }).join('');
    }

    function renderFame(awards) {
        if (!awards.length) {
            el.fame.innerHTML = `<div class="col-12"><p class="text-center text-body-secondary py-3 mb-0">${escapeHtml(t('stats.noFame'))}</p></div>`;
            return;
        }
        el.fame.innerHTML = awards
            .map(
                (award) => `
            <div class="col">
            <div class="fame-card vstack gap-1 align-items-center ${award.isNegative ? 'fame-card--negative' : ''}">
                <img class="avatar avatar--lg avatar--pulse avatar--team-${award.team.toLowerCase()}"
                    src="${escapeHtml(playerSrc(award.winner))}" alt="">
                <span class="fame-card__emoji" aria-hidden="true">${award.emoji}</span>
                <span class="fame-card__title">${escapeHtml(t(`awards.${award.key}`, { defaultValue: award.title }))}</span>
                <span class="fame-card__winner">${escapeHtml(award.winner)}</span>
                <span class="badge text-bg-light align-self-center">${escapeHtml(t(`stats.unit_${award.unit}`, { count: award.count }))}</span>
            </div>
            </div>`
            )
            .join('');
    }

    function renderHeatmap(visible, totals) {
        el.heatmap.innerHTML = visible
            .filter(stats.hasRealCoords)
            .map((p) => {
                const kind = t(p.tipoAccion === ACTION.POINT ? 'actions.point' : 'actions.error');
                const name = totals[p.jugadorId]?.name || p.jugadorId;
                const title = t('stats.heatDot', { number: p.pointNumber, kind, name, score: p.marcadorMomento });
                const modifiers = [`heat-dot--${p.equipo.toLowerCase()}`, p.tipoAccion === ACTION.ERROR ? 'heat-dot--error' : '']
                    .join(' ');
                return `<span class="heat-dot heat-dot--numbered ${modifiers}" style="left:${p.coordenadas.x}%;top:${p.coordenadas.y}%"
                    title="${escapeHtml(title)}">${p.pointNumber}</span>`;
            })
            .join('');
    }

    /**
     * Bitácora global. Incluye los tiempos muertos cuando no hay filtros de
     * jugador/acción (antes se descartaban siempre).
     */
    function renderLog(bySet, visible, totals, config) {
        const noActorFilters = filters.player === 'all' && filters.action === 'all' && filters.actionDetail === 'all';
        const inMinuteRange = (p) => {
            const minute = toMatchMinute(p.matchSecond);
            return (filters.minMinute === null || minute >= filters.minMinute) && (filters.maxMinute === null || minute <= filters.maxMinute);
        };
        const visibleSet = new Set(visible);
        const rows = bySet.filter((p) => visibleSet.has(p) || (p.tipoAccion === ACTION.TIMEOUT && noActorFilters && inMinuteRange(p)));

        if (!rows.length) {
            el.logBody.innerHTML = `<tr><td colspan="7" class="text-body-secondary py-3">${escapeHtml(t('stats.noLogFiltered'))}</td></tr>`;
            return;
        }

        el.logBody.innerHTML = rows
            .map((p) => {
                const row = stats.toLogRow(p, totals[p.jugadorId]?.name);
                const isTimeout = p.tipoAccion === ACTION.TIMEOUT;
                const cellModifier = isTimeout ? '' : p.tipoAccion === ACTION.POINT ? 'text-success fw-bold' : 'text-danger fw-bold';
                const avatar = isTimeout || !totals[p.jugadorId]
                    ? '—'
                    : `<img class="avatar avatar--sm avatar--team-${row.team.toLowerCase()}" src="${escapeHtml(playerSrc(row.playerName))}" alt="">`;
                return `
                <tr class="${isTimeout ? 'table-secondary fst-italic' : ''}">
                    <td>#${row.pointNumber ?? '-'} (Set ${row.setNumber})</td>
                    <td>${avatar}</td>
                    <td class="fw-bold">${escapeHtml(isTimeout ? (row.team === 'A' ? config.teamA : config.teamB) : row.playerName)}</td>
                    <td class="${cellModifier}">${escapeHtml(i18n.describeAction({ tipoAccion: row.kind, actionDetail: row.detail }))}</td>
                    <td>${escapeHtml(row.score)}</td>
                    <td class="d-none d-sm-table-cell">${row.xMeters === '-' ? '-' : `${row.xMeters} m`}</td>
                    <td class="d-none d-sm-table-cell">${row.yMeters === '-' ? '-' : `${row.yMeters} m`}</td>
                </tr>`;
            })
            .join('');
    }

    // ---------------------------------------------------------------------
    // Indicadores profesionales
    // ---------------------------------------------------------------------

    const formatPct = (value) => (value === null ? '—' : `${Math.round(value)}%`);
    const formatAvg = (value) => (value === null ? '—' : value.toFixed(2));

    /**
     * Fila comparativa A vs B con barras enfrentadas.
     * @param {Object} row
     * @param {string} row.label
     * @param {number|null} row.a       Valor numérico de A (null = sin datos)
     * @param {number|null} row.b
     * @param {string} row.aText        Texto a mostrar para A (puede llevar HTML propio)
     * @param {string} row.bText
     * @param {number} row.max          Valor que corresponde a la barra llena
     * @param {string} row.hint         Explicación (tooltip)
     * @param {boolean} [row.lowerIsBetter] Para métricas negativas (errores)
     */
    function versusRow({ label, a, b, aText, bText, max, hint, lowerIsBetter = false }) {
        const width = (v) => (v === null || !max ? 0 : Math.min(100, (v / max) * 100));
        const comparable = a !== null && b !== null && a !== b;
        const leader = !comparable ? null : (a > b) !== lowerIsBetter ? 'a' : 'b';
        const value = (team, text) =>
            `<span class="versus__value versus__value--${team} ${leader === team ? 'versus__value--lead' : ''}">${text}</span>`;
        return `
            <div class="versus__row" title="${escapeHtml(hint)}">
                <span class="versus__label">${escapeHtml(label)}</span>
                ${value('a', aText)}
                <div class="progress versus__track versus__track--a" role="progressbar" aria-label="${escapeHtml(`${label}: ${t('common.teamA')}`)}">
                    <div class="progress-bar" style="width:${width(a)}%"></div>
                </div>
                <div class="progress versus__track versus__track--b" role="progressbar" aria-label="${escapeHtml(`${label}: ${t('common.teamB')}`)}">
                    <div class="progress-bar" style="width:${width(b)}%"></div>
                </div>
                ${value('b', bText)}
            </div>`;
    }

    /** Tarjeta "Indicadores profesionales": side-out, break point, saque y recepción. */
    function renderProIndicators(points, config) {
        const pro = stats.computeProIndicators(points);
        const { A, B } = pro.teams;
        const sample = (won, total) => `<small class="versus__sample">${won}/${total}</small>`;
        const maxCount = (x, y) => Math.max(x, y, 1);

        const rows = [
            versusRow({
                label: 'Side-out', a: A.sideOutPct, b: B.sideOutPct, max: 100,
                aText: `${formatPct(A.sideOutPct)} ${sample(A.sideOutWon, A.received)}`,
                bText: `${formatPct(B.sideOutPct)} ${sample(B.sideOutWon, B.received)}`,
                hint: t('pro.sideOutHint')
            }),
            versusRow({
                label: 'Break point', a: A.breakPct, b: B.breakPct, max: 100,
                aText: `${formatPct(A.breakPct)} ${sample(A.breakWon, A.served)}`,
                bText: `${formatPct(B.breakPct)} ${sample(B.breakWon, B.served)}`,
                hint: t('pro.breakHint')
            }),
            versusRow({
                label: t('pro.receptionAverage'), a: A.reception.average, b: B.reception.average, max: 3,
                aText: formatAvg(A.reception.average), bText: formatAvg(B.reception.average),
                hint: t('pro.receptionAverageHint')
            }),
            versusRow({
                label: t('pro.receptionPositive'), a: A.reception.positivePct, b: B.reception.positivePct, max: 100,
                aText: formatPct(A.reception.positivePct), bText: formatPct(B.reception.positivePct),
                hint: t('pro.receptionPositiveHint')
            }),
            versusRow({
                label: 'Aces', a: A.aces, b: B.aces, max: maxCount(A.aces, B.aces),
                aText: String(A.aces), bText: String(B.aces),
                hint: t('pro.acesHint')
            }),
            versusRow({
                label: t('pro.serveErrors'), a: A.serveErrors, b: B.serveErrors, max: maxCount(A.serveErrors, B.serveErrors),
                aText: String(A.serveErrors), bText: String(B.serveErrors), lowerIsBetter: true,
                hint: t('pro.serveErrorsHint')
            })
        ].join('');

        const header = `
            <div class="d-flex justify-content-between gap-3">
                <span class="versus__team versus__team--a">${escapeHtml(config.teamA)}</span>
                <span class="versus__team versus__team--b">${escapeHtml(config.teamB)}</span>
            </div>`;

        el.pro.innerHTML = `<div class="versus vstack gap-3">${header}${rows}</div>${renderReceptionDetail(pro, config)}`;
    }

    /** Tablas de recepción: side-out por calidad y ranking de receptores. */
    function renderReceptionDetail(pro, config) {
        if (!pro.hasReceptionData) {
            return `
                <p class="small text-body-secondary text-center bg-body-tertiary rounded-3 p-3 mb-0">
                    ${t('pro.receptionTip')}
                </p>`;
        }

        const cell = (g) => (g.rallies ? `${formatPct(g.sideOutPct)} <small class="versus__sample">(${g.rallies})</small>` : '—');
        const byGradeRows = RECEPTION_GRADES.map(
            (g) => `
            <tr>
                <td class="text-start text-nowrap"><span class="badge grade-badge grade-badge--g${g.grade}">${g.grade}</span> ${escapeHtml(t(`reception.grade${g.grade}`))}</td>
                <td>${cell(pro.byGrade.A[g.grade])}</td>
                <td>${cell(pro.byGrade.B[g.grade])}</td>
            </tr>`
        ).join('');

        const receivers = PLAYER_IDS.filter((id) => pro.players[id].count > 0)
            .sort((x, y) => pro.players[y].average - pro.players[x].average)
            .map((id) => {
                const r = pro.players[id];
                return `
                <tr>
                    <td class="fw-bold text-start text-nowrap">
                        <span class="pro-stats__dot pro-stats__dot--${id.charAt(0).toLowerCase()}"></span>
                        ${escapeHtml(config[`p${id}`] || id)}
                    </td>
                    <td>${r.count}</td>
                    <td><strong>${formatAvg(r.average)}</strong></td>
                    <td>${formatPct(r.positivePct)}</td>
                    <td class="d-none d-sm-table-cell">${formatPct(r.perfectPct)}</td>
                    <td>${formatPct(r.sideOutPct)}</td>
                </tr>`;
            })
            .join('');

        return `
            <div class="row g-4">
                <section class="col-md-6">
                    <h3 class="pro-stats__subtitle">${escapeHtml(t('pro.byGradeTitle'))}</h3>
                    <div class="table-responsive">
                        <table class="table table-sm table-striped align-middle text-center mb-0">
                            <thead class="table-dark"><tr>
                                <th scope="col">${escapeHtml(t('pro.reception'))}</th>
                                <th scope="col">${escapeHtml(config.teamA)}</th>
                                <th scope="col">${escapeHtml(config.teamB)}</th>
                            </tr></thead>
                            <tbody>${byGradeRows}</tbody>
                        </table>
                    </div>
                </section>
                <section class="col-md-6">
                    <h3 class="pro-stats__subtitle">${escapeHtml(t('pro.receiversTitle'))}</h3>
                    <div class="table-responsive">
                        <table class="table table-sm table-striped align-middle text-center mb-0">
                            <thead class="table-dark"><tr>
                                <th scope="col">${escapeHtml(t('common.player'))}</th>
                                <th scope="col" title="${escapeHtml(t('pro.colReceptionsHint'))}">${escapeHtml(t('pro.colReceptions'))}</th>
                                <th scope="col" title="${escapeHtml(t('pro.colAverageHint'))}">${escapeHtml(t('pro.colAverage'))}</th>
                                <th scope="col" title="${escapeHtml(t('pro.colPositiveHint'))}">${escapeHtml(t('pro.colPositive'))}</th>
                                <th scope="col" class="d-none d-sm-table-cell" title="${escapeHtml(t('pro.colPerfectHint'))}">${escapeHtml(t('pro.colPerfect'))}</th>
                                <th scope="col" title="${escapeHtml(t('pro.colSideOutHint'))}">Side-out</th>
                            </tr></thead>
                            <tbody>${receivers}</tbody>
                        </table>
                    </div>
                </section>
            </div>`;
    }

    // =====================================================================
    // MODO TORNEO
    // =====================================================================

    /** Tarjeta de la rejilla del modo torneo (todas comparten estructura). */
    const sectionCard = (title, body, { hint = '', col = 'col-12' } = {}) => `
        <div class="${col}">
            <div class="card card--glass h-100">
                <div class="card-body vstack gap-3">
                    <h2 class="section-title">${escapeHtml(title)}</h2>
                    ${hint ? `<p class="small text-body-secondary mb-0">${escapeHtml(hint)}</p>` : ''}
                    ${body}
                </div>
            </div>
        </div>`;

    const emptyText = (text) => `<p class="text-center text-body-secondary py-3 mb-0">${escapeHtml(text)}</p>`;

    /** Cabecera de tabla con explicación opcional (title). */
    const th = (label, hint, extra = '') =>
        `<th scope="col" class="${extra}"${hint ? ` title="${escapeHtml(hint)}"` : ''}>${escapeHtml(label)}</th>`;

    const table = (head, rows) => `
        <div class="table-responsive">
            <table class="table table-sm table-striped align-middle text-center mb-0">
                <thead class="table-dark"><tr>${head}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;

    /** Nombre de dupla con su foto (o avatar generado). */
    const teamCell = (name) => `
        <td class="text-start">
            <span class="d-inline-flex align-items-center gap-2 text-nowrap">
                <img class="avatar avatar--sm" src="${escapeHtml(teamSrc(name))}" alt="">
                <span class="fw-bold">${escapeHtml(name)}</span>
            </span>
        </td>`;

    /** Porcentaje con su muestra («67% 2/3»); «—» si no hay muestra. */
    const pctCell = (pct, won, total) =>
        `<td>${formatPct(pct)}${total ? ` <small class="versus__sample">${won}/${total}</small>` : ''}</td>`;

    /** Fila de indicadores (KPI) del resumen del torneo. */
    function renderTournamentSummary(tour) {
        const isKotc = Boolean(tour.kotc);
        const champion = VP.tournamentEngine.getChampion(tour);
        let teams;
        let activity;
        let lead;
        if (isKotc) {
            const standings = VP.kotcEngine.computeStandings(tour.kotc);
            teams = tour.kotc.teams.length;
            activity = { label: t('tStats.rallies'), value: String(tour.kotc.rallies) };
            lead = champion
                ? { label: t('tStats.champion'), value: champion }
                : { label: t('tStats.leader'), value: tour.kotc.rallies && standings[0] ? `${standings[0].name} · ${standings[0].points}` : '—' };
        } else {
            const progress = VP.tournamentEngine.getProgress(tour);
            const standings = VP.tournamentEngine.computeStandings(tour);
            teams = (tour.teams || []).length || standings.length;
            activity = { label: t('tStats.progress'), value: t('tStats.progressValue', { done: progress.done, total: progress.total }) };
            const leader = standings.find((r) => r.played);
            lead = champion ? { label: t('tStats.champion'), value: champion } : { label: t('tStats.leader'), value: leader ? leader.team : '—' };
        }

        const kpi = ({ label, value }, accent = false) => `
            <div class="col">
                <div class="card h-100 border-0 shadow-sm">
                    <div class="card-body vstack gap-2 text-center">
                        <span class="kpi__label">${escapeHtml(label)}</span>
                        <strong class="kpi__value kpi__value--compact ${accent ? 'kpi__value--accent' : ''}">${escapeHtml(value)}</strong>
                    </div>
                </div>
            </div>`;

        const category = [tour.category && t(`categories.${tour.category}`, { defaultValue: tour.category }), tour.gender && i18n.genderLabel(tour.gender)]
            .filter(Boolean)
            .join(' · ');
        const body = `
            ${category ? `<p class="small text-body-secondary mb-0">${escapeHtml(category)}</p>` : ''}
            <div class="row row-cols-2 row-cols-md-4 g-3">
                ${kpi({ label: t('tStats.format'), value: i18n.formatLabel(tour.format) })}
                ${kpi({ label: t('tStats.teams'), value: String(teams) })}
                ${kpi(activity)}
                ${kpi(lead, true)}
            </div>`;
        return sectionCard(`🏆 ${tour.name}`, body);
    }

    // ---------------------------------------------------------------------
    // Queen & King of the Court
    // ---------------------------------------------------------------------

    /** Texto traducido de un destacado (el núcleo da la clave y la fila). */
    function highlightValue(h) {
        const r = h.row;
        if (h.key === 'thrones') return t('tStats.hlThrones', { count: r.thrones });
        if (h.key === 'streak') return t('tStats.hlStreak', { count: r.bestStreak });
        if (h.key === 'hold') return t('tStats.hlPct', { pct: Math.round(r.holdPct), won: r.holdWins, total: r.holdRallies });
        return t('tStats.hlPct', { pct: Math.round(r.challengePct), won: r.challengeWins, total: r.challenges });
    }

    function renderKotcStats(tour) {
        const analytics = VP.tournamentStats.computeKotcAnalytics(tour.kotc);
        const sections = [];

        // 1) Evolución de puntos: la gráfica se monta después (necesita su ancho real)
        sections.push(
            sectionCard(
                t('tStats.chartTitle'),
                analytics.rallies
                    ? `<div class="points-chart" id="stats-kotc-chart"></div>
                       ${analytics.partial ? `<p class="small text-body-secondary mb-0">${escapeHtml(t('tStats.partial', { count: analytics.rallies }))}</p>` : ''}`
                    : emptyText(t('tStats.noRallies')),
                { hint: analytics.rallies ? t('tStats.chartHint') : '' }
            )
        );

        // 2) Destacados (mismo bloque visual que el Salón de la Fama)
        if (analytics.highlights.length) {
            const cards = analytics.highlights
                .map(
                    (h) => `
                <div class="col">
                    <div class="fame-card vstack gap-1 align-items-center">
                        <img class="avatar avatar--lg" src="${escapeHtml(teamSrc(h.winner))}" alt="">
                        <span class="fame-card__emoji" aria-hidden="true">${h.emoji}</span>
                        <span class="fame-card__title">${escapeHtml(t(`tStats.hl.${h.key}`))}</span>
                        <span class="fame-card__winner">${escapeHtml(h.winner)}</span>
                        <span class="badge text-bg-light align-self-center">${escapeHtml(highlightValue(h))}</span>
                    </div>
                </div>`
                )
                .join('');
            sections.push(sectionCard(t('tStats.highlightsTitle'), `<div class="row row-cols-2 row-cols-md-4 g-3">${cards}</div>`));
        }

        // 3) Rendimiento por dupla
        const head = [
            th('#'),
            th(t('tStats.colTeam')),
            th(t('tStats.colPoints')),
            th(t('tStats.colThrones'), t('kotc.colThronesHint')),
            th(t('tStats.colHold'), t('tStats.colHoldHint')),
            th(t('tStats.colChallenge'), t('tStats.colChallengeHint')),
            th(t('tStats.colStreak'), t('tStats.colStreakHint'), 'd-none d-sm-table-cell')
        ].join('');
        const rows = analytics.rows
            .map(
                (r, i) => `
            <tr class="${r.isWinner ? 'table-warning fw-bold' : ''}">
                <td>${i + 1}</td>
                ${teamCell(r.name)}
                <td><strong>${r.points}</strong></td>
                <td>${r.thrones}</td>
                ${pctCell(r.holdPct, r.holdWins, r.holdRallies)}
                ${pctCell(r.challengePct, r.challengeWins, r.challenges)}
                <td class="d-none d-sm-table-cell">${r.bestStreak}</td>
            </tr>`
            )
            .join('');
        sections.push(sectionCard(t('tStats.kotcTableTitle'), table(head, rows), { hint: t('tStats.kotcTableHint') }));

        return { html: sections.join(''), analytics };
    }

    // ---------------------------------------------------------------------
    // Round Robin / Eliminación directa
    // ---------------------------------------------------------------------

    function renderMatchTournamentStats(tour) {
        const isRoundRobin = tour.format !== VP.constants.TOURNAMENT_FORMAT.KNOCKOUT;
        const data = VP.tournamentStats.computeMatchStats(tour, VP.storage.getHistory());
        const sections = [];

        // 1) Clasificación (incluye resultados cargados a mano)
        const standings = VP.tournamentEngine.computeStandings(tour);
        const standingHead = [
            th('#'),
            th(t('standings.team')),
            th(t('standings.played'), t('standings.playedHint')),
            th(t('standings.won'), t('standings.wonHint')),
            th(t('standings.lost'), t('standings.lostHint')),
            th(t('standings.sets'), t('standings.setsHint')),
            isRoundRobin ? th(t('standings.points'), t('standings.pointsHint')) : ''
        ].join('');
        const standingRows = standings
            .map(
                (r, i) => `
            <tr class="${i === 0 && r.played ? 'table-warning fw-bold' : ''}">
                <td>${i + 1}</td>
                ${teamCell(r.team)}
                <td>${r.played}</td><td>${r.won}</td><td>${r.lost}</td>
                <td>${r.setsFor}-${r.setsAgainst}</td>
                ${isRoundRobin ? `<td><strong>${r.points}</strong></td>` : ''}
            </tr>`
            )
            .join('');
        sections.push(sectionCard(t('tStats.standingsTitle'), standings.length ? table(standingHead, standingRows) : emptyText(t('standings.empty'))));

        if (!data.matches.length) {
            sections.push(sectionCard(t('tStats.teamsTitle'), emptyText(t('tStats.noMatchData'))));
            return sections.join('');
        }

        // 2) Rendimiento por dupla (sólo partidos registrados en la app)
        const teamHead = [
            th(t('tStats.colTeam')),
            th(t('standings.played'), t('tStats.colPlayedHint')),
            th(t('tStats.colPointsFor'), t('tStats.colPointsForHint')),
            th('Side-out', t('pro.sideOutHint')),
            th('Break point', t('pro.breakHint'))
        ].join('');
        const teamRows = data.teams
            .map(
                (r) => `
            <tr>
                ${teamCell(r.name)}
                <td>${r.played}</td>
                <td>${r.pointsFor}-${r.pointsAgainst}</td>
                ${pctCell(r.sideOutPct, r.sideOutWon, r.received)}
                ${pctCell(r.breakPct, r.breakWon, r.served)}
            </tr>`
            )
            .join('');
        sections.push(sectionCard(t('tStats.teamsTitle'), table(teamHead, teamRows), { hint: t('tStats.teamsHint') }));

        // 3) Jugadores (sólo con partidos anotados en Scout)
        let playersBody;
        if (data.hasScoutData) {
            const playerHead = [
                th(t('common.player')),
                th(t('tStats.colTeam'), '', 'd-none d-sm-table-cell'),
                th(t('tStats.colPoints')),
                th(t('stats.errors')),
                th(t('tStats.colEfficiency'), t('tStats.colEfficiencyHint'))
            ].join('');
            const playerRows = data.players
                .map(
                    (p) => `
                <tr>
                    <td class="text-start">
                        <span class="d-inline-flex align-items-center gap-2 text-nowrap">
                            <img class="avatar avatar--sm" src="${escapeHtml(playerSrc(p.name))}" alt="">
                            <span class="fw-bold">${escapeHtml(p.name)}</span>
                        </span>
                    </td>
                    <td class="d-none d-sm-table-cell text-nowrap">${escapeHtml(p.team)}</td>
                    <td class="text-success fw-bold">${p.pts}</td>
                    <td class="text-danger">${p.errs}</td>
                    <td>${formatPct(p.efficiency)}</td>
                </tr>`
                )
                .join('');
            playersBody = table(playerHead, playerRows);
        } else {
            playersBody = emptyText(t('tStats.noScout'));
        }
        sections.push(sectionCard(t('tStats.playersTitle'), playersBody, { col: 'col-12 col-lg-6' }));

        // 4) Partidos registrados → abrir el análisis completo de cada uno
        const items = [...data.matches]
            .reverse()
            .map(
                (m) => `
            <li class="list-group-item d-flex flex-wrap align-items-center justify-content-between gap-2">
                <span class="vstack">
                    <span class="fw-bold">${escapeHtml(`${m.teamA} vs ${m.teamB}`)}</span>
                    <span class="small text-body-secondary">${escapeHtml(t('tStats.matchScore', { sets: m.sets, points: m.points }))}</span>
                </span>
                <button type="button" class="btn btn-outline-primary btn-sm" data-action="analyze-match" data-index="${m.index}">
                    ${escapeHtml(t('tStats.analyze'))}
                </button>
            </li>`
            )
            .join('');
        sections.push(sectionCard(t('tStats.matchesTitle'), `<ul class="list-group">${items}</ul>`, { col: 'col-12 col-lg-6' }));

        return sections.join('');
    }

    /** Pinta las estadísticas del torneo seleccionado. */
    function renderTournamentStats() {
        const tour = tournamentSource ? VP.storage.getTournament(tournamentSource) : null;
        if (!tour) {
            el.tournamentBody.innerHTML = sectionCard(t('tStats.modeTournament'), emptyText(t('tStats.noTournamentsHint')));
            return;
        }

        if (tour.kotc) {
            const { html, analytics } = renderKotcStats(tour);
            el.tournamentBody.innerHTML = renderTournamentSummary(tour) + html;
            const chart = byId('stats-kotc-chart');
            if (chart) {
                VP.charts.renderLineChart(chart, {
                    labels: analytics.timeline.labels,
                    series: analytics.timeline.series,
                    target: tour.kotc.settings.targetPoints,
                    ariaLabel: t('tStats.chartLabel')
                });
            }
            return;
        }
        el.tournamentBody.innerHTML = renderTournamentSummary(tour) + renderMatchTournamentStats(tour);
    }

    /** Muestra los controles y secciones del modo activo. */
    function applyMode() {
        const isTournament = mode === 'tournament';
        el.modeMatch.checked = !isTournament;
        el.modeTournament.checked = isTournament;
        el.matchPicker.hidden = isTournament;
        el.tournamentPicker.hidden = !isTournament;
        el.tournamentSections.hidden = !isTournament;
        el.matchSections.forEach((section) => (section.hidden = isTournament));
        if (isTournament) stopTimeline();
    }

    /** Calcula y pinta todas las secciones con los filtros actuales. */
    function draw() {
        const match = getSourceMatch();
        if (!match?.config || !match.points?.length) {
            renderEmpty();
            return;
        }

        const { timeline, bySet, visible } = stats.selectPoints(getAnnotatedPoints(match), filters);
        const totalsVisible = stats.computePlayerTotals(visible, match.config);
        const totalsBySet = stats.computePlayerTotals(bySet, match.config);

        el.timelineValue.textContent =
            filters.timelinePct === 100 ? t('stats.wholeMatch') : t('stats.playOf', { current: timeline.length, total: match.points.length });

        renderSummary(match, bySet);
        renderPlayers(totalsVisible);
        renderProIndicators(bySet, match.config);
        renderFame(stats.computeAwards(totalsBySet));
        renderHeatmap(visible, totalsBySet);
        renderLog(bySet, visible, totalsBySet, match.config);
    }

    /**
     * Punto de entrada del repintado. Con muchos registros muestra el spinner
     * y difiere el cálculo un instante para que el navegador llegue a pintarlo.
     */
    function render() {
        if (mode === 'tournament') {
            renderTournamentStats();
            return;
        }
        const match = getSourceMatch();
        if ((match?.points?.length || 0) < SPINNER_THRESHOLD || timelineTimer) {
            draw();
            return;
        }
        VP.feedback.setLoading(true);
        setTimeout(() => {
            draw();
            VP.feedback.setLoading(false);
        }, 30);
    }

    /** Al entrar a la vista: actualiza los selectores, los filtros y pinta. */
    function enter() {
        renderSourceOptions();
        renderTournamentOptions();
        renderFilterPills(getSourceMatch());
        applyMode();
        render();
    }

    /**
     * Abre Stats en modo torneo con ese torneo seleccionado
     * (botones «📊 Ver estadísticas» de la pista Queen & King y del detalle).
     * @param {string} tournamentId
     */
    function showTournament(tournamentId) {
        mode = 'tournament';
        tournamentSource = tournamentId;
        if (VP.router.getCurrent() === VIEW_ID) enter();
        else VP.router.go(VIEW_ID);
    }

    /**
     * Cambia a modo partido con un partido del historial seleccionado.
     * @param {number} historyIndex
     */
    function selectMatch(historyIndex) {
        mode = 'match';
        source = historyIndex;
        filters = stats.createDefaultFilters();
        stopTimeline();
        enter();
        el.source.closest('.card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // =====================================================================
    // INICIALIZACIÓN
    // =====================================================================

    function init() {
        el = {
            source: byId('stats-source'),
            finalScore: byId('final-score'),
            duration: byId('match-duration'),
            totalPoints: byId('total-points'),
            players: byId('players-stats-container'),
            fame: byId('gamification-container'),
            pro: byId('pro-indicators'),
            heatmap: byId('heatmap-points'),
            logBody: byId('global-table-body'),
            logSection: byId('global-log-section'),
            filterPlayers: byId('filter-players'),
            filterActions: byId('filter-actions'),
            filterDetails: byId('filter-details'),
            filterSets: byId('filter-sets'),
            filterSetsContainer: byId('filter-sets-container'),
            timeMin: byId('filter-time-min'),
            timeMax: byId('filter-time-max'),
            timeline: byId('filter-timeline'),
            timelineValue: byId('timeline-val'),
            playTimeline: byId('btn-play-timeline'),
            // Modo torneo
            modeMatch: byId('stats-mode-match'),
            modeTournament: byId('stats-mode-tournament'),
            matchPicker: byId('stats-match-picker'),
            tournamentPicker: byId('stats-tournament-picker'),
            tournament: byId('stats-tournament'),
            tournamentSections: byId('stats-tournament-sections'),
            tournamentBody: byId('stats-tournament-body'),
            matchSections: [...document.querySelectorAll(`#${VIEW_ID} .stats__match-only`)]
        };

        // Selector «Partido | Torneo»
        [el.modeMatch, el.modeTournament].forEach((radio) =>
            radio.addEventListener('change', () => {
                if (!radio.checked) return;
                mode = radio.value;
                applyMode();
                if (mode === 'match') renderFilterPills(getSourceMatch());
                render();
            })
        );
        el.tournament.addEventListener('change', () => {
            tournamentSource = el.tournament.value || null;
            render();
        });
        // «Analizar» un partido del torneo → modo partido con ese partido
        delegate(el.tournamentBody, 'click', '[data-action="analyze-match"]', (_event, button) => {
            selectMatch(toInt(button.dataset.index, null));
        });
        // La gráfica se dibuja al ancho real: se rehace al girar el móvil o cambiar el tamaño
        window.addEventListener(
            'resize',
            debounce(() => {
                if (mode === 'tournament' && VP.router.getCurrent() === VIEW_ID) renderTournamentStats();
            }, 200)
        );

        el.source.addEventListener('change', () => {
            stopTimeline();
            source = parseSource(el.source.value);
            filters = stats.createDefaultFilters();
            renderFilterPills(getSourceMatch());
            render();
        });

        bindPillGroup(el.filterPlayers, 'player');
        bindPillGroup(el.filterActions, 'action');
        bindPillGroup(el.filterDetails, 'actionDetail');
        bindPillGroup(el.filterSets, 'set', (value) => toInt(value, 'all'));

        // Los inputs de minutos recalculan con "debounce" para no repintar en cada tecla
        const onMinuteChange = debounce(() => {
            filters.minMinute = el.timeMin.value === '' ? null : toInt(el.timeMin.value, null);
            filters.maxMinute = el.timeMax.value === '' ? null : toInt(el.timeMax.value, null);
            render();
        }, 250);
        el.timeMin.addEventListener('input', onMinuteChange);
        el.timeMax.addEventListener('input', onMinuteChange);

        el.timeline.addEventListener('input', () => {
            stopTimeline();
            filters.timelinePct = toInt(el.timeline.value, 100);
            render();
        });
        el.playTimeline.addEventListener('click', toggleTimeline);
        byId('btn-reset-filters').addEventListener('click', resetFilters);

        // Botones de cada jugador (delegación)
        delegate(el.players, 'click', '[data-action]', (_event, button) => {
            const playerId = button.dataset.player;
            const match = getSourceMatch();
            if (!match) return;

            if (button.dataset.action === 'dashboard') {
                const { bySet } = stats.selectPoints(getAnnotatedPoints(match), filters);
                VP.views.playerDashboard.open({ points: bySet, playerId, config: match.config, set: filters.set });
            } else {
                // "Bitácora": filtra por el jugador y baja hasta la tabla
                filters.player = playerId;
                setActivePill(el.filterPlayers, playerId);
                render();
                el.logSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });

        // Si se está viendo el partido en curso, se actualiza en vivo
        store.subscribe((event) => {
            if (event === 'change' && VP.router.getCurrent() === VIEW_ID && mode === 'match' && source === 'current') render();
        });

        // Cambio de idioma: si la vista está abierta se repinta entera
        i18n.onChange(() => {
            if (!timelineTimer) stopTimeline();
            else el.playTimeline.textContent = t('stats.pause');
            if (VP.router.getCurrent() === VIEW_ID) enter();
        });

        VP.router.register(VIEW_ID, { onEnter: enter });
    }

    VP.views = VP.views || {};
    VP.views.stats = Object.freeze({ init, render, selectLatestHistory, showTournament, selectMatch });
})(window);
