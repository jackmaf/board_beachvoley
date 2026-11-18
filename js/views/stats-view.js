/**
 * @file stats-view.js
 * @description Vista "Stats": análisis de un partido (en curso o del historial).
 *
 * Secciones: selector de partido, resumen, desglose por jugador, Salón de la
 * Fama, filtros, heatmap y bitácora global. Todos los cálculos los hace
 * `core/stats-engine.js`; aquí sólo se gestionan filtros y se pinta.
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { byId, delegate, setActivePill } = VP.dom;
    const { escapeHtml, formatDuration, getAvatarUrl, getTeamLogoUrl, debounce, toInt, toMatchMinute } = VP.utils;
    const { SKILLS, PLAYER_IDS, ACTION, SPINNER_THRESHOLD, RECEPTION_GRADES } = VP.constants;
    const stats = VP.statsEngine;
    const store = VP.matchStore;

    const VIEW_ID = 'vista-estadisticas';
    const TIMELINE_STEP = 10;      // % que avanza la animación en cada paso
    const TIMELINE_INTERVAL = 800; // ms entre pasos

    /** Partido analizado: 'current' (en curso) o índice del historial. */
    let source = null;
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
            ? new Date(timestamp).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
            : '';
        return `${match.config?.teamA} vs ${match.config?.teamB} · ${won.A}-${won.B}${date ? ` · ${date}` : ''}`;
    }

    /** Rellena el <select> de partidos y valida la selección actual. */
    function renderSourceOptions() {
        const history = VP.storage.getHistory();
        const options = [];
        if (store.hasPoints()) options.push({ value: 'current', label: `🔴 En curso: ${describeMatch(store.getState())}` });
        // Historial del más reciente al más antiguo
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i]?.config) options.push({ value: String(i), label: describeMatch(history[i]) });
        }

        const values = options.map((o) => o.value);
        if (source === null || !values.includes(String(source))) {
            source = values.length ? parseSource(values[0]) : null;
            filters = stats.createDefaultFilters();
        }

        el.source.innerHTML = options.length
            ? options.map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join('')
            : '<option value="">No hay partidos registrados</option>';
        el.source.value = source === null ? '' : String(source);
        el.source.disabled = options.length === 0;
    }

    const parseSource = (value) => (value === 'current' ? 'current' : toInt(value, null));

    /** Selecciona el último partido archivado (se usa al finalizar un partido). */
    function selectLatestHistory() {
        const length = VP.storage.getHistory().length;
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
            '<button type="button" class="pill" data-value="all">Todos</button>',
            ...PLAYER_IDS.map(
                (id) => `<button type="button" class="pill pill--team-${id.charAt(0).toLowerCase()}" data-value="${id}">
                    ${escapeHtml(config[`p${id}`] || id)}</button>`
            )
        ].join('');

        el.filterDetails.innerHTML = [
            '<button type="button" class="pill" data-value="all">Todas</button>',
            ...SKILLS.map((s) => `<button type="button" class="pill" data-value="${s.key}">${s.emoji} ${s.key}</button>`)
        ].join('');

        const maxSets = VP.rules.normalizeRules(config).maxSets;
        el.filterSetsContainer.hidden = maxSets <= 1;
        el.filterSets.innerHTML = [
            '<button type="button" class="pill" data-value="all">Todos los sets</button>',
            ...Array.from({ length: maxSets }, (_, i) => `<button type="button" class="pill" data-value="${i + 1}">Set ${i + 1}</button>`)
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
        delegate(group, 'click', '.pill', (_event, pill) => {
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
        el.playTimeline.textContent = '▶️ Play';
        el.playTimeline.classList.remove('timeline__play--playing');
    }

    /** Reproduce el partido avanzando el slider en bucle. */
    function toggleTimeline() {
        if (timelineTimer) {
            stopTimeline();
            return;
        }
        if (filters.timelinePct >= 100) filters.timelinePct = 0;
        el.playTimeline.textContent = '⏸️ Pausa';
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
        el.finalScore.innerHTML = '<p class="empty-state__text">No hay datos registrados aún.</p>';
        el.duration.textContent = '00:00';
        el.totalPoints.textContent = '0';
        el.players.innerHTML = '<p class="empty-state__text">Registra un partido en «Scout» para ver estadísticas.</p>';
        el.fame.innerHTML = '';
        el.pro.innerHTML = '<p class="empty-state__text">Sin datos para calcular indicadores.</p>';
        el.heatmap.innerHTML = '';
        el.logBody.innerHTML = '<tr><td colspan="7" class="data-table__empty">Sin datos registrados.</td></tr>';
        el.timelineValue.textContent = 'Todo el partido';
    }

    function renderSummary(match, bySet) {
        const { teamA, teamB } = match.config;
        const score = stats.computeScore(bySet);
        const won = VP.rules.countSetsWon(match.sets || [], match.config);
        const subtitle = filters.set === 'all' ? `Sets ${won.A} - ${won.B}` : `Puntos del Set ${filters.set}`;

        const teamHtml = (name, team) => `
            <div class="summary__team summary__team--${team}">
                <img class="avatar avatar--logo avatar--team-${team}" src="${getTeamLogoUrl(name)}" alt="">
                <span class="summary__team-name">${escapeHtml(name)}</span>
            </div>`;

        el.finalScore.innerHTML = `
            ${teamHtml(teamA, 'a')}
            <div class="summary__result">
                <span class="summary__points">${score.A} - ${score.B}</span>
                <span class="summary__sets">${subtitle}</span>
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
            <div class="player-stat">
                <div class="player-stat__info">
                    <img class="avatar avatar--md avatar--team-${team}" src="${getAvatarUrl(p.name)}" alt="">
                    <span class="player-stat__name">${escapeHtml(p.name)}</span>
                </div>
                <div class="player-stat__values">
                    <span class="player-stat__pts">${p.pts} <small class="player-stat__unit">pts ganadores</small></span>
                    <span class="player-stat__errs">${p.errs} errores</span>
                </div>
                <div class="player-stat__actions">
                    <button type="button" class="btn btn--dark btn--small" data-action="dashboard" data-player="${id}">🕸️ Heptagrama</button>
                    <button type="button" class="btn btn--primary btn--small" data-action="log" data-player="${id}">📜 Bitácora</button>
                </div>
            </div>`;
        }).join('');
    }

    function renderFame(awards) {
        if (!awards.length) {
            el.fame.innerHTML = '<p class="empty-state__text">Aún no hay jugadas suficientes para el Salón de la Fama.</p>';
            return;
        }
        el.fame.innerHTML = awards
            .map(
                (award) => `
            <div class="fame-card ${award.isNegative ? 'fame-card--negative' : ''}">
                <img class="avatar avatar--lg avatar--pulse avatar--team-${award.team.toLowerCase()}"
                    src="${getAvatarUrl(award.winner)}" alt="">
                <span class="fame-card__emoji" aria-hidden="true">${award.emoji}</span>
                <span class="fame-card__title">${escapeHtml(award.title)}</span>
                <span class="fame-card__winner">${escapeHtml(award.winner)}</span>
                <span class="fame-card__value">${escapeHtml(award.value)}</span>
            </div>`
            )
            .join('');
    }

    function renderHeatmap(visible, totals) {
        el.heatmap.innerHTML = visible
            .filter(stats.hasRealCoords)
            .map((p) => {
                const kind = p.tipoAccion === ACTION.POINT ? 'Punto' : 'Error';
                const name = totals[p.jugadorId]?.name || p.jugadorId;
                const title = `(#${p.pointNumber}) ${kind} de ${name} (${p.marcadorMomento})`;
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
            el.logBody.innerHTML = '<tr><td colspan="7" class="data-table__empty">Sin acciones para estos filtros.</td></tr>';
            return;
        }

        el.logBody.innerHTML = rows
            .map((p) => {
                const row = stats.toLogRow(p, totals[p.jugadorId]?.name);
                const isTimeout = p.tipoAccion === ACTION.TIMEOUT;
                const cellModifier = isTimeout ? '' : p.tipoAccion === ACTION.POINT ? 'data-table__cell--point' : 'data-table__cell--error';
                const avatar = isTimeout || !totals[p.jugadorId]
                    ? '—'
                    : `<img class="avatar avatar--sm avatar--team-${row.team.toLowerCase()}" src="${getAvatarUrl(row.playerName)}" alt="">`;
                return `
                <tr class="${isTimeout ? 'data-table__row--timeout' : ''}">
                    <td>#${row.pointNumber ?? '-'} (Set ${row.setNumber})</td>
                    <td>${avatar}</td>
                    <td class="data-table__cell--strong">${escapeHtml(isTimeout ? (row.team === 'A' ? config.teamA : config.teamB) : row.playerName)}</td>
                    <td class="${cellModifier}">${escapeHtml(row.action)}</td>
                    <td>${escapeHtml(row.score)}</td>
                    <td class="data-table__cell--optional">${row.xMeters === '-' ? '-' : `${row.xMeters} m`}</td>
                    <td class="data-table__cell--optional">${row.yMeters === '-' ? '-' : `${row.yMeters} m`}</td>
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
                <span class="versus__label">${label}</span>
                ${value('a', aText)}
                <div class="versus__track versus__track--a"><div class="versus__bar versus__bar--a" style="width:${width(a)}%"></div></div>
                <div class="versus__track versus__track--b"><div class="versus__bar versus__bar--b" style="width:${width(b)}%"></div></div>
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
                hint: 'Puntos ganados cuando el equipo RECIBÍA el saque / rallies recibiendo'
            }),
            versusRow({
                label: 'Break point', a: A.breakPct, b: B.breakPct, max: 100,
                aText: `${formatPct(A.breakPct)} ${sample(A.breakWon, A.served)}`,
                bText: `${formatPct(B.breakPct)} ${sample(B.breakWon, B.served)}`,
                hint: 'Puntos ganados cuando el equipo SACABA / rallies sacando'
            }),
            versusRow({
                label: 'Recepción media (0-3)', a: A.reception.average, b: B.reception.average, max: 3,
                aText: formatAvg(A.reception.average), bText: formatAvg(B.reception.average),
                hint: 'Media de la calidad de recepción: 3 perfecta, 2 buena, 1 mala, 0 error'
            }),
            versusRow({
                label: 'Recepción positiva (2-3)', a: A.reception.positivePct, b: B.reception.positivePct, max: 100,
                aText: formatPct(A.reception.positivePct), bText: formatPct(B.reception.positivePct),
                hint: '% de recepciones de calidad 2 o 3'
            }),
            versusRow({
                label: 'Aces', a: A.aces, b: B.aces, max: maxCount(A.aces, B.aces),
                aText: String(A.aces), bText: String(B.aces),
                hint: 'Saques que terminaron directamente en punto'
            }),
            versusRow({
                label: 'Errores de saque', a: A.serveErrors, b: B.serveErrors, max: maxCount(A.serveErrors, B.serveErrors),
                aText: String(A.serveErrors), bText: String(B.serveErrors), lowerIsBetter: true,
                hint: 'Saques fallados (regalan el punto al rival)'
            })
        ].join('');

        const header = `
            <div class="versus__head">
                <span class="versus__team versus__team--a">${escapeHtml(config.teamA)}</span>
                <span class="versus__team versus__team--b">${escapeHtml(config.teamB)}</span>
            </div>`;

        el.pro.innerHTML = `<div class="versus">${header}${rows}</div>${renderReceptionDetail(pro, config)}`;
    }

    /** Tablas de recepción: side-out por calidad y ranking de receptores. */
    function renderReceptionDetail(pro, config) {
        if (!pro.hasReceptionData) {
            return `
                <p class="pro-stats__empty">
                    💡 Para ver la calidad de recepción, marca <strong>3 · 2 · 1 · 0</strong> sobre el receptor
                    en el menú de Scout al registrar cada punto.
                </p>`;
        }

        const cell = (g) => (g.rallies ? `${formatPct(g.sideOutPct)} <small class="versus__sample">(${g.rallies})</small>` : '—');
        const byGradeRows = RECEPTION_GRADES.map(
            (g) => `
            <tr>
                <td class="pro-stats__grade-cell"><span class="grade-badge grade-badge--g${g.grade}">${g.grade}</span> ${g.label}</td>
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
                    <td class="data-table__cell--strong pro-stats__player-cell">
                        <span class="pro-stats__dot pro-stats__dot--${id.charAt(0).toLowerCase()}"></span>
                        ${escapeHtml(config[`p${id}`] || id)}
                    </td>
                    <td>${r.count}</td>
                    <td><strong>${formatAvg(r.average)}</strong></td>
                    <td>${formatPct(r.positivePct)}</td>
                    <td class="data-table__cell--optional">${formatPct(r.perfectPct)}</td>
                    <td>${formatPct(r.sideOutPct)}</td>
                </tr>`;
            })
            .join('');

        return `
            <div class="pro-stats__tables">
                <section class="pro-stats__section">
                    <h3 class="pro-stats__subtitle">Side-out según la calidad de recepción</h3>
                    <div class="table-scroll">
                        <table class="data-table">
                            <thead><tr>
                                <th scope="col">Recepción</th>
                                <th scope="col">${escapeHtml(config.teamA)}</th>
                                <th scope="col">${escapeHtml(config.teamB)}</th>
                            </tr></thead>
                            <tbody>${byGradeRows}</tbody>
                        </table>
                    </div>
                </section>
                <section class="pro-stats__section">
                    <h3 class="pro-stats__subtitle">Receptores</h3>
                    <div class="table-scroll">
                        <table class="data-table">
                            <thead><tr>
                                <th scope="col">Jugador</th>
                                <th scope="col" title="Recepciones registradas">Rec.</th>
                                <th scope="col" title="Media 0-3">Media</th>
                                <th scope="col" title="% de recepciones 2-3">Posit.</th>
                                <th scope="col" class="data-table__cell--optional" title="% de recepciones 3">Perf.</th>
                                <th scope="col" title="% de rallies ganados tras su recepción">Side-out</th>
                            </tr></thead>
                            <tbody>${receivers}</tbody>
                        </table>
                    </div>
                </section>
            </div>`;
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
            filters.timelinePct === 100 ? 'Todo el partido' : `Jugada ${timeline.length} de ${match.points.length}`;

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

    /** Al entrar a la vista: actualiza el selector, los filtros y pinta. */
    function enter() {
        renderSourceOptions();
        renderFilterPills(getSourceMatch());
        render();
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
            playTimeline: byId('btn-play-timeline')
        };

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
            if (event === 'change' && VP.router.getCurrent() === VIEW_ID && source === 'current') render();
        });

        VP.router.register(VIEW_ID, { onEnter: enter });
    }

    VP.views = VP.views || {};
    VP.views.stats = Object.freeze({ init, render, selectLatestHistory });
})(window);
