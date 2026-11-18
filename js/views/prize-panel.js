/**
 * @file prize-panel.js
 * @description Premios de un torneo en la interfaz:
 *  1. La sección «💰 Premios» del formulario de creación (interruptor,
 *     ajustes, casillas de pago por jugador y vista previa).
 *  2. La pestaña «Premios» del detalle: lo recaudado, la bolsa, el reparto
 *     por puestos y la lista de pagos de cada jugador.
 *
 * Los cálculos los hace `core/prize-engine.js`; aquí sólo se pinta y se
 * recogen eventos. Los ajustes (inscripción, % y reparto) son un mismo
 * componente clonado de `<template id="tpl-prize-settings">` en los dos sitios.
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { byId, qs, qsa, delegate } = VP.dom;
    const { escapeHtml, pickTeamEmoji } = VP.utils;
    const { PRIZE_DEFAULTS, PRIZE_PRESETS, MAX_PRIZE_PLACES } = VP.constants;
    const prize = VP.prizeEngine;
    const storage = VP.storage;
    const i18n = VP.i18n;
    const { t } = i18n;
    const { toast, confirm } = VP.feedback;

    const MEDALS = ['🥇', '🥈', '🥉'];
    const medal = (rank) => MEDALS[rank - 1] || '🏅';
    const money = (amount) => escapeHtml(i18n.money(amount));
    const percent = (value) => i18n.number(value, { maximumFractionDigits: 2 });

    // =====================================================================
    // COMPONENTE DE AJUSTES (inscripción · % de bolsa · reparto)
    // =====================================================================

    /** Nombre del reparto predefinido que coincide con `distribution`, o 'custom'. */
    function presetOf(distribution) {
        const match = Object.entries(PRIZE_PRESETS).find(
            ([, preset]) => preset.length === distribution.length && preset.every((value, i) => value === distribution[i])
        );
        return match ? match[0] : 'custom';
    }

    /**
     * Monta el componente de ajustes dentro de `host`.
     * @param {HTMLElement} host
     * @param {{feePerPlayer:number, poolPercent:number, distribution:number[]}} initial
     * @param {string} prefix Prefijo de los `id` (debe ser único en la página).
     * @param {(settings:Object) => void} [onInput] Se llama con cada cambio.
     * @returns {{read: () => Object, validate: () => Object}}
     */
    function mountSettings(host, initial, prefix, onInput) {
        const fragment = byId('tpl-prize-settings').content.cloneNode(true);
        VP.language.translate(fragment);
        qsa('[data-prize-field]', fragment).forEach((input) => (input.id = `${prefix}-${input.dataset.prizeField}`));
        qsa('[data-for]', fragment).forEach((label) => (label.htmlFor = `${prefix}-${label.dataset.for}`));
        host.replaceChildren(fragment);

        const panel = qs('.prize-settings', host);
        const field = (name) => qs(`[data-prize-field="${name}"]`, panel);
        const output = (name) => qs(`[data-prize-out="${name}"]`, panel);
        const placesBox = qs('[data-prize-places]', panel);
        let distribution = [...initial.distribution];

        field('fee').value = initial.feePerPlayer;
        field('pool').value = initial.poolPercent;

        const read = () => ({
            feePerPlayer: field('fee').value === '' ? NaN : Number(field('fee').value),
            poolPercent: field('pool').value === '' ? NaN : Number(field('pool').value),
            distribution: [...distribution]
        });

        function renderPlaces() {
            placesBox.innerHTML = distribution
                .map((value, i) => {
                    const place = i18n.ordinal(i + 1);
                    return `
                    <div class="prize-place-input">
                        <label class="prize-place-input__label" for="${prefix}-place-${i}">
                            ${medal(i + 1)} ${escapeHtml(t('prize.placeLabel', { place }))}
                        </label>
                        <div class="input-group input-group-sm prize-place-input__field">
                            <input class="form-control" type="number" id="${prefix}-place-${i}" min="0" max="100"
                                step="any" inputmode="decimal" value="${Number.isFinite(value) ? value : ''}" data-place="${i}">
                            <span class="input-group-text">%</span>
                        </div>
                        <button type="button" class="btn btn-outline-danger btn-sm btn--icon" data-prize-action="remove-place"
                            data-place="${i}" aria-label="${escapeHtml(t('prize.removePlace', { place }))}"
                            ${distribution.length === 1 ? 'disabled' : ''}>&times;</button>
                    </div>`;
                })
                .join('');
            qs('[data-prize-action="add-place"]', panel).disabled = distribution.length >= MAX_PRIZE_PLACES;
            field('preset').value = presetOf(distribution);
        }

        function renderOutputs() {
            const { feePerPlayer, poolPercent } = read();
            output('feePerTeam').textContent = feePerPlayer > 0 ? t('prize.feePerTeam', { amount: i18n.money(feePerPlayer * 2) }) : '';
            output('admin').textContent =
                poolPercent >= 0 && poolPercent <= 100 ? t('prize.adminPercent', { percent: percent(100 - poolPercent) }) : '';
            const sum = distribution.reduce((total, value) => total + (Number(value) || 0), 0);
            const ok = Math.abs(sum - 100) < 1e-9;
            output('sum').textContent = t(ok ? 'prize.sumOk' : 'prize.sumWrong', { sum: percent(sum) });
            output('sum').classList.toggle('prize-settings__sum--error', !ok);
        }

        const changed = () => {
            renderOutputs();
            onInput?.(read());
        };

        panel.addEventListener('input', (event) => {
            const { place } = event.target.dataset;
            if (place !== undefined) {
                distribution[Number(place)] = event.target.value === '' ? NaN : Number(event.target.value);
                field('preset').value = presetOf(distribution);
            }
            if (event.target !== field('preset')) changed();
        });
        field('preset').addEventListener('change', () => {
            const preset = PRIZE_PRESETS[field('preset').value];
            if (preset) {
                distribution = [...preset];
                renderPlaces();
            }
            changed();
        });
        delegate(panel, 'click', '[data-prize-action]', (_event, button) => {
            if (button.dataset.prizeAction === 'add-place' && distribution.length < MAX_PRIZE_PLACES) {
                const used = distribution.reduce((total, value) => total + (Number(value) || 0), 0);
                distribution.push(Math.max(0, 100 - used));
            } else if (button.dataset.prizeAction === 'remove-place' && distribution.length > 1) {
                distribution.splice(Number(button.dataset.place), 1);
            } else {
                return;
            }
            renderPlaces();
            changed();
        });

        renderPlaces();
        renderOutputs();
        return { read, validate: () => prize.validateSettings(read()) };
    }

    /** Toast con el error de validación de unos ajustes. */
    const settingsError = (result) => t(`errors.prize.${result.code}`, result.params);

    /** Lista de puestos «🥇 1.º $48.000 ($24.000 c/u)» de una proyección. */
    function placesListHtml(places) {
        return `
            <ul class="prize-preview__places list-unstyled mb-0">
                ${places
                    .map(
                        (amount, i) => `
                    <li>${medal(i + 1)} <strong>${escapeHtml(i18n.ordinal(i + 1))}</strong> ${money(amount)}
                        <small class="text-body-secondary">${escapeHtml(t('prize.eachPlayer', { amount: i18n.money(amount / 2) }))}</small></li>`
                    )
                    .join('')}
            </ul>`;
    }

    // =====================================================================
    // 1. FORMULARIO DE CREACIÓN
    // =====================================================================

    const createForm = { settings: null, host: null, preview: null };

    const isCreateEnabled = () => byId('t-prize-enabled').checked;

    /** Muestra u oculta las casillas «¿Pagó?» de cada dupla según el interruptor. */
    function syncTeamRowPayments() {
        const enabled = isCreateEnabled();
        qsa('#t-dynamic-teams .team-row__payments').forEach((box) => (box.hidden = !enabled));
    }

    /** Vista previa: proyección si pagan todas las duplas y lo ya cobrado al inscribir. */
    function renderCreatePreview() {
        if (!createForm.settings || !isCreateEnabled()) return;
        const settings = createForm.settings.read();
        const rows = qsa('#t-dynamic-teams .team-row');
        const teamCount = rows.filter((row) => qs('[data-field="p1"]', row).value.trim() && qs('[data-field="p2"]', row).value.trim()).length;
        const paidPlayers = qsa('#t-dynamic-teams [data-paid]:checked').length;

        if (!prize.validateSettings(settings).ok) {
            createForm.preview.innerHTML = `<p class="small text-body-secondary mb-0">${escapeHtml(t('prize.previewInvalid'))}</p>`;
            return;
        }
        const projection = prize.project(teamCount, settings);
        createForm.preview.innerHTML = `
            <p class="prize-preview__line mb-1">${t('prize.previewTotal', {
                count: teamCount,
                fee: money(settings.feePerPlayer * 2),
                total: `<strong>${money(projection.total)}</strong>`
            })}</p>
            <p class="prize-preview__totals mb-2">
                🏆 ${escapeHtml(t('prize.pool'))} <strong>${money(projection.pool)}</strong> ·
                🧾 ${escapeHtml(t('prize.admin'))} <strong>${money(projection.admin)}</strong>
            </p>
            ${placesListHtml(projection.places)}
            <p class="small text-body-secondary mt-2 mb-0">${escapeHtml(
                t('prize.previewPaid', { count: paidPlayers, amount: i18n.money(paidPlayers * settings.feePerPlayer) })
            )}</p>`;
    }

    /** Muestra u oculta los ajustes al pulsar el interruptor. */
    function syncCreateForm() {
        byId('t-prize-settings').hidden = !isCreateEnabled();
        syncTeamRowPayments();
        renderCreatePreview();
    }

    /** (Re)monta los ajustes del formulario. `initial` permite conservar lo escrito. */
    function mountCreateSettings(initial) {
        const box = byId('t-prize-settings');
        createForm.host = document.createElement('div');
        createForm.preview = document.createElement('div');
        createForm.preview.className = 'prize-preview';
        createForm.preview.setAttribute('aria-live', 'polite');
        box.replaceChildren(createForm.host, createForm.preview);
        createForm.settings = mountSettings(createForm.host, initial, 't-prize', renderCreatePreview);
    }

    /** Deja la sección como nueva (se llama al abrir el formulario). */
    function resetCreateForm() {
        byId('t-prize-enabled').checked = false;
        mountCreateSettings(PRIZE_DEFAULTS);
        syncCreateForm();
    }

    /**
     * Lee la sección de premios del formulario.
     * @returns {{enabled:false} | {enabled:true, settings:Object} | {error:string}}
     */
    function readCreateForm() {
        if (!isCreateEnabled()) return { enabled: false };
        const settings = createForm.settings.read();
        const validation = prize.validateSettings(settings);
        return validation.ok ? { enabled: true, settings } : { error: settingsError(validation) };
    }

    // =====================================================================
    // 2. PESTAÑA «PREMIOS» DEL DETALLE
    // =====================================================================

    const panelState = { tournamentId: null, editing: false, onlyPending: false, editor: null, onChange: null };

    const getTournament = () => storage.getTournament(panelState.tournamentId);

    /** Guarda un cambio en el torneo, repinta la pestaña y avisa a la vista de torneos. */
    function update(mutator) {
        storage.updateTournament(panelState.tournamentId, mutator);
        renderPanel();
        panelState.onChange?.();
    }

    function kpiHtml(label, value, sub, modifier = '') {
        return `
            <div class="col-4">
                <div class="prize-kpi ${modifier}">
                    <span class="prize-kpi__label">${escapeHtml(label)}</span>
                    <strong class="prize-kpi__value">${value}</strong>
                    ${sub ? `<span class="prize-kpi__sub">${escapeHtml(sub)}</span>` : ''}
                </div>
            </div>`;
    }

    /** Fila de un premio: puesto, dupla(s) y monto. */
    function awardHtml(award) {
        const places = award.shared
            ? t('prize.sharedPlaces', { from: i18n.ordinal(award.rank), to: i18n.ordinal(award.rankTo) })
            : i18n.ordinal(award.rank);

        let teams;
        if (!award.teams.length) {
            teams = `<span class="prize-award__pending">${escapeHtml(t('prize.toBeDecided'))}</span>`;
        } else {
            const names = award.teams.map((name) => `${pickTeamEmoji(name)} ${escapeHtml(name)}`).join(' · ');
            const missing = award.slots - award.teams.length;
            teams = names;
            if (!award.decided && award.slots === 1) teams += ` <span class="badge text-bg-light">${escapeHtml(t('prize.provisional'))}</span>`;
            if (missing > 0) teams += ` <span class="prize-award__pending">· ${escapeHtml(t('prize.missingTeams', { count: missing }))}</span>`;
        }

        const detail = award.shared
            ? t('prize.perTeamAndPlayer', { team: i18n.money(award.perTeam), player: i18n.money(award.perPlayer) })
            : t('prize.eachPlayer', { amount: i18n.money(award.perPlayer) });

        return `
            <li class="prize-award ${award.decided && award.teams.length ? 'prize-award--decided' : ''}">
                <span class="prize-award__medal" aria-hidden="true">${medal(award.rank)}</span>
                <div class="prize-award__info">
                    <span class="prize-award__place">${escapeHtml(places)} · ${percent(award.percent)} %</span>
                    <span class="prize-award__teams">${teams}</span>
                </div>
                <div class="prize-award__money">
                    <strong>${money(award.amount)}</strong>
                    <small>${escapeHtml(detail)}</small>
                </div>
            </li>`;
    }

    /** Fila de pagos de una dupla, con un interruptor por jugador. */
    function paymentHtml(entry, index, fee) {
        const status =
            entry.paidCount === 2
                ? { modifier: 'paid', text: t('prize.statusPaid') }
                : entry.paidCount === 1
                    ? { modifier: 'partial', text: t('prize.statusOwes', { amount: i18n.money(entry.owed) }) }
                    : { modifier: 'unpaid', text: t('prize.statusOwes', { amount: i18n.money(entry.owed) }) };

        const player = (key, fallback) => {
            const id = `pay-${index}-${key}`;
            const name = entry[key] || fallback;
            return `
                <input type="checkbox" class="btn-check" id="${id}" data-pay="${key}" data-entry="${index}" autocomplete="off"
                    ${entry.paid?.[key] ? 'checked' : ''}>
                <label class="btn btn-sm btn-outline-success payment-row__player" for="${id}"
                    title="${escapeHtml(t('prize.markPaid', { name, amount: i18n.money(fee) }))}">
                    <span class="payment-row__check" aria-hidden="true">${entry.paid?.[key] ? '✓' : '○'}</span>
                    <span class="text-truncate">${escapeHtml(name)}</span>
                </label>`;
        };

        return `
            <li class="payment-row payment-row--${status.modifier}">
                <span class="payment-row__number" aria-hidden="true">${index + 1}</span>
                <span class="payment-row__team text-truncate">${escapeHtml(entry.name)}</span>
                <span class="badge payment-row__status">${escapeHtml(status.text)}</span>
                <div class="payment-row__players d-flex flex-wrap gap-2">
                    ${player('p1', t('common.player1'))}
                    ${player('p2', t('common.player2'))}
                </div>
            </li>`;
    }

    /** Pestaña con los premios activos. */
    function summaryHtml(tour, summary) {
        const entries = summary.entries
            .map((entry, index) => ({ entry, index }))
            .filter(({ entry }) => !panelState.onlyPending || entry.paidCount < 2);

        const payments = entries.length
            ? entries.map(({ entry, index }) => paymentHtml(entry, index, summary.feePerPlayer)).join('')
            : `<li class="text-center text-body-secondary py-2">${escapeHtml(t('prize.allPaid'))}</li>`;

        const projection = summary.pending > 0
            ? `<p class="small text-body-secondary mb-0">${escapeHtml(t('prize.ifAllPay', { amount: i18n.money(summary.projectedPool) }))}</p>`
            : '';
        const unassigned = summary.unassigned > 0
            ? `<p class="small text-warning-emphasis mb-0">⚠️ ${escapeHtml(t('prize.unassigned', { amount: i18n.money(summary.unassigned) }))}</p>`
            : '';

        return `
            <div class="row g-2">
                ${kpiHtml(t('prize.collected'), money(summary.collected), t('prize.playersPaid', { paid: summary.paidPlayers, total: summary.totalPlayers }), 'prize-kpi--accent')}
                ${kpiHtml(t('prize.expected'), money(summary.expected), t('prize.feeSummary', { amount: i18n.money(summary.feePerPlayer) }))}
                ${kpiHtml(t('prize.pending'), money(summary.pending), t('prize.teamsPending', { count: summary.teams - summary.paidTeams }), summary.pending > 0 ? 'prize-kpi--warning' : '')}
            </div>

            <div class="prize-pool">
                <span>🏆 ${escapeHtml(t('prize.poolWithPercent', { percent: percent(summary.poolPercent) }))} <strong>${money(summary.pool)}</strong></span>
                <span>🧾 ${escapeHtml(t('prize.adminWithPercent', { percent: percent(summary.adminPercent) }))} <strong>${money(summary.admin)}</strong></span>
            </div>
            ${projection}

            <section class="vstack gap-2" aria-labelledby="prize-awards-title">
                <h3 id="prize-awards-title" class="prize-panel__title">${escapeHtml(t('prize.awardsTitle'))}</h3>
                <ul class="list-unstyled vstack gap-2 mb-0">${summary.awards.map(awardHtml).join('')}</ul>
                ${unassigned}
            </section>

            <section class="vstack gap-2" aria-labelledby="prize-payments-title">
                <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
                    <h3 id="prize-payments-title" class="prize-panel__title mb-0">
                        ${escapeHtml(t('prize.paymentsTitle', { paid: summary.paidTeams, total: summary.teams }))}
                    </h3>
                    <div class="form-check form-switch mb-0 small">
                        <input class="form-check-input" type="checkbox" role="switch" id="prize-only-pending"
                            data-prize-action="toggle-pending" ${panelState.onlyPending ? 'checked' : ''}>
                        <label class="form-check-label" for="prize-only-pending">${escapeHtml(t('prize.onlyPending'))}</label>
                    </div>
                </div>
                <p class="small text-body-secondary mb-0">${escapeHtml(t('prize.paymentsHint', { amount: i18n.money(summary.feePerPlayer) }))}</p>
                <ul class="list-unstyled vstack gap-2 mb-0">${payments}</ul>
            </section>

            <div class="d-flex flex-wrap gap-2">
                <button type="button" class="btn btn-primary btn-sm flex-fill" data-prize-action="copy">${escapeHtml(t('prize.copy'))}</button>
                <button type="button" class="btn btn-outline-primary btn-sm flex-fill" data-prize-action="edit">${escapeHtml(t('prize.edit'))}</button>
                <button type="button" class="btn btn-outline-danger btn-sm flex-fill" data-prize-action="disable">${escapeHtml(t('prize.disable'))}</button>
            </div>`;
    }

    /** Pintado de la pestaña según el estado (sin premios · editando · resumen). */
    function renderPanel() {
        const panel = byId('panel-prizes');
        const tour = getTournament();
        if (!tour) return;

        if (panelState.editing) {
            // Conserva lo escrito si se repinta (p. ej. al cambiar de idioma)
            const draft = panelState.editor?.read();
            const current = tour.prize?.distribution ? tour.prize : PRIZE_DEFAULTS;
            panel.innerHTML = `
                <h3 class="prize-panel__title">${escapeHtml(t(prize.isEnabled(tour) ? 'prize.editTitle' : 'prize.enableTitle'))}</h3>
                <div data-prize-editor></div>
                <div class="prize-preview" data-prize-edit-preview aria-live="polite"></div>
                <div class="d-flex gap-2">
                    <button type="button" class="btn btn-outline-primary flex-fill" data-prize-action="cancel">${escapeHtml(t('common.cancel'))}</button>
                    <button type="button" class="btn btn-primary flex-fill" data-prize-action="save">${escapeHtml(t('common.save'))}</button>
                </div>`;
            const preview = qs('[data-prize-edit-preview]', panel);
            const renderPreview = (settings) => {
                if (!prize.validateSettings(settings).ok) {
                    preview.innerHTML = `<p class="small text-body-secondary mb-0">${escapeHtml(t('prize.previewInvalid'))}</p>`;
                    return;
                }
                // Mismo torneo con los ajustes nuevos: así se ve el efecto sobre lo ya pagado
                const trial = { ...tour, prize: { ...(tour.prize || {}), ...settings, enabled: true, entries: tour.prize?.entries || [] } };
                if (!tour.prize?.entries) prize.syncEntries(trial);
                const s = prize.summarize(trial);
                preview.innerHTML = `
                    <p class="prize-preview__line mb-2">${escapeHtml(t('prize.previewCollected', { amount: i18n.money(s.collected) }))}
                        🏆 <strong>${money(s.pool)}</strong> · 🧾 <strong>${money(s.admin)}</strong></p>
                    ${placesListHtml(prize.splitExact(s.pool, settings.distribution))}`;
            };
            panelState.editor = mountSettings(qs('[data-prize-editor]', panel), draft || current, 'prize-edit', renderPreview);
            renderPreview(panelState.editor.read());
            return;
        }
        panelState.editor = null;

        if (!prize.isEnabled(tour)) {
            panel.innerHTML = `
                <div class="text-center text-body-secondary py-3 vstack gap-3 align-items-center">
                    <div class="fs-1" aria-hidden="true">💰</div>
                    <p class="mb-0">${escapeHtml(t('prize.emptyState'))}</p>
                    <button type="button" class="btn btn-primary" data-prize-action="enable">${escapeHtml(t('prize.enable'))}</button>
                </div>`;
            return;
        }

        // Si cambió alguna dupla (nombre o jugadores), se alinea la lista de pagos
        if (prize.syncEntries(structuredClone(tour))) {
            storage.updateTournament(tour.id, (tr) => prize.syncEntries(tr));
            panelState.onChange?.();
        }
        const fresh = getTournament();
        panel.innerHTML = summaryHtml(fresh, prize.summarize(fresh));
    }

    /**
     * Pinta la pestaña «Premios» de un torneo.
     * @param {string} tournamentId
     * @param {{onChange?: () => void}} [options] `onChange` se llama tras guardar (para repintar el listado).
     */
    function render(tournamentId, { onChange } = {}) {
        if (panelState.tournamentId !== tournamentId) {
            panelState.editing = false;
            panelState.onlyPending = false;
            panelState.editor = null;
        }
        panelState.tournamentId = tournamentId;
        panelState.onChange = onChange || null;
        renderPanel();
    }

    /** Texto para pegar en WhatsApp con la bolsa, el reparto y los pagos pendientes. */
    function buildSummaryText(tour, summary) {
        const lines = [
            `🏆 ${tour.name} · ${t('prize.sectionTitle').replace(/^💰\s*/, '')}`,
            t('prize.textCollected', { collected: i18n.money(summary.collected), expected: i18n.money(summary.expected), paid: summary.paidPlayers, total: summary.totalPlayers }),
            t('prize.textPool', { percent: percent(summary.poolPercent), amount: i18n.money(summary.pool) }),
            ''
        ];
        summary.awards.forEach((award) => {
            const places = award.shared
                ? t('prize.sharedPlaces', { from: i18n.ordinal(award.rank), to: i18n.ordinal(award.rankTo) })
                : i18n.ordinal(award.rank);
            const teams = award.teams.length ? award.teams.join(' / ') : t('prize.toBeDecided');
            lines.push(`${medal(award.rank)} ${places} (${percent(award.percent)} %): ${i18n.money(award.amount)} — ${teams}`);
        });
        const pending = summary.entries.filter((e) => e.paidCount < 2);
        if (pending.length) {
            lines.push('', t('prize.textPending'));
            pending.forEach((e) => {
                const who = prize.PLAYER_KEYS.filter((k) => !e.paid?.[k]).map((k) => e[k] || t(k === 'p1' ? 'common.player1' : 'common.player2'));
                lines.push(`• ${e.name}: ${who.join(', ')} (${i18n.money(e.owed)})`);
            });
        }
        return lines.join('\n');
    }

    /** Copia al portapapeles, con respaldo para navegadores sin Clipboard API. */
    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            const area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.className = 'visually-hidden';
            document.body.appendChild(area);
            area.select();
            const ok = document.execCommand('copy');
            area.remove();
            return ok;
        }
    }

    async function handlePanelAction(action) {
        const tour = getTournament();
        if (!tour) return;

        if (action === 'enable' || action === 'edit') {
            panelState.editing = true;
            panelState.editor = null;
            renderPanel();
            return;
        }
        if (action === 'cancel') {
            panelState.editing = false;
            renderPanel();
            return;
        }
        if (action === 'save') {
            const validation = panelState.editor.validate();
            if (!validation.ok) {
                toast(settingsError(validation), { type: 'error' });
                return;
            }
            const settings = panelState.editor.read();
            const wasEnabled = prize.isEnabled(tour);
            panelState.editing = false;
            update((tr) => prize.enablePrize(tr, settings));
            toast(t(wasEnabled ? 'prize.toastUpdated' : 'prize.toastEnabled'), { type: 'success' });
            return;
        }
        if (action === 'disable') {
            const accepted = await confirm({
                title: t('prize.disableTitle'),
                message: t('prize.disableMessage'),
                confirmLabel: t('prize.disable'),
                danger: true
            });
            if (!accepted) return;
            update((tr) => prize.disablePrize(tr));
            toast(t('prize.toastDisabled'), { type: 'info' });
            return;
        }
        if (action === 'copy') {
            const ok = await copyText(buildSummaryText(tour, prize.summarize(tour)));
            toast(t(ok ? 'prize.toastCopied' : 'prize.toastCopyFailed'), { type: ok ? 'success' : 'error' });
        }
    }

    // =====================================================================
    // INICIALIZACIÓN
    // =====================================================================

    function init() {
        // Formulario de creación
        byId('t-prize-enabled').addEventListener('change', syncCreateForm);
        const teamRows = byId('t-dynamic-teams');
        teamRows.addEventListener('input', renderCreatePreview);
        teamRows.addEventListener('change', renderCreatePreview);

        // Pestaña del detalle (delegación: el contenido se repinta entero)
        const panel = byId('panel-prizes');
        panel.addEventListener('change', (event) => {
            const input = event.target;
            if (input.dataset.pay) {
                const index = Number(input.dataset.entry);
                update((tr) => prize.setPayment(tr, tr.prize.entries[index].name, input.dataset.pay, input.checked));
                // Repintar pierde el foco: se devuelve a la misma casilla para poder seguir con el teclado
                byId(input.id)?.focus();
            } else if (input.dataset.prizeAction === 'toggle-pending') {
                panelState.onlyPending = input.checked;
                renderPanel();
                byId('prize-only-pending')?.focus();
            }
        });
        delegate(panel, 'click', 'button[data-prize-action]', (_event, button) => handlePanelAction(button.dataset.prizeAction));

        // Cambio de idioma: los textos generados con JS se vuelven a pintar
        i18n.onChange(() => {
            if (createForm.settings) {
                mountCreateSettings(createForm.settings.read());
                syncCreateForm();
            }
        });
    }

    VP.views = VP.views || {};
    VP.views.prizePanel = Object.freeze({
        init,
        render,
        resetCreateForm,
        readCreateForm,
        syncTeamRowPayments,
        renderCreatePreview
    });
})(window);
