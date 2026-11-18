/**
 * @file player-dashboard.js
 * @description Modal con el reporte analítico de un jugador: KPIs, zonas,
 * heatmap personal, desglose por gesto, radar (heptagrama) y exportaciones.
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { byId, openModal } = VP.dom;
    const { getAvatarUrl } = VP.utils;
    const { SKILLS, RECEPTION_GRADES } = VP.constants;
    const { toast } = VP.feedback;

    /** Datos del reporte abierto (los usan los botones de exportar). */
    let currentReport = null;
    let el = {};

    /**
     * Lee un token CSS (p. ej. `--color-primary`) del tema activo.
     * Necesario porque <canvas> NO entiende `var(--x)`: el código anterior
     * pasaba 'var(--primary)' a fillStyle y el navegador lo ignoraba.
     */
    const cssToken = (name) => getComputedStyle(document.body).getPropertyValue(name).trim();

    /** Pinta un KPI con color según su signo (modificadores BEM). */
    function setSignedValue(element, value, text) {
        element.textContent = text;
        element.classList.toggle('kpi__value--positive', value > 0);
        element.classList.toggle('kpi__value--negative', value < 0);
        element.classList.toggle('kpi__value--neutral', value === 0);
    }

    function renderHeatmap(points, team) {
        el.heatmap.innerHTML = '';
        points.forEach((coords) => {
            const dot = document.createElement('span');
            dot.className = `heat-dot heat-dot--${team.toLowerCase()}`;
            dot.style.left = `${coords.x}%`;
            dot.style.top = `${coords.y}%`;
            el.heatmap.appendChild(dot);
        });
    }

    /**
     * Bloque de recepción: KPIs (recepciones, media, % positivas) y
     * distribución por calidad 3·2·1·0 reutilizando el componente zone-bar.
     * @param {Object} reception Resultado de statsEngine.computeProIndicators().players[id]
     */
    function renderReception(reception) {
        if (!reception.count) {
            el.reception.innerHTML = `
                <p class="empty-state__text">
                    Sin recepciones registradas. En Scout, marca 3·2·1·0 sobre este jugador cuando reciba.
                </p>`;
            return;
        }
        const pct = (v) => (v === null ? '—' : `${Math.round(v)}%`);
        const bars = RECEPTION_GRADES.map((g) => {
            const count = reception.grades[g.grade];
            const share = (count / reception.count) * 100;
            return `
                <div class="zone-bar">
                    <span class="zone-bar__label"><span class="grade-badge grade-badge--g${g.grade}">${g.grade}</span></span>
                    <div class="zone-bar__track"><div class="zone-bar__fill zone-bar__fill--g${g.grade}" style="width:${share}%"></div></div>
                    <span class="zone-bar__value">${count}</span>
                </div>`;
        }).join('');

        el.reception.innerHTML = `
            <div class="player-dash__kpis">
                <div class="kpi"><span class="kpi__label">Recepciones</span><strong class="kpi__value kpi__value--neutral">${reception.count}</strong></div>
                <div class="kpi"><span class="kpi__label">Media</span><strong class="kpi__value">${reception.average.toFixed(2)}</strong><span class="kpi__sub">sobre 3</span></div>
                <div class="kpi"><span class="kpi__label">Positivas (2-3)</span><strong class="kpi__value kpi__value--accent">${pct(reception.positivePct)}</strong><span class="kpi__sub">Side-out tras recibir: ${pct(reception.sideOutPct)}</span></div>
            </div>
            ${bars}`;
    }

    function renderSkills(skills) {
        el.skills.innerHTML = SKILLS.map(
            (skill) => `
            <div class="skill-tile">
                <span class="skill-tile__icon" aria-hidden="true">${skill.emoji}</span>
                <span class="skill-tile__name">${skill.key}</span>
                <span class="skill-tile__count">${skills[skill.key] || 0}</span>
            </div>`
        ).join('');
    }

    /**
     * Dibuja el radar de habilidades en <canvas>.
     * Escala por `devicePixelRatio` para que se vea nítido en pantallas retina.
     * @param {Object<string, number>} skills Puntos por gesto técnico.
     */
    function drawRadarChart(skills) {
        const canvas = el.radar;
        const ctx = canvas.getContext('2d');
        const size = 300; // Tamaño lógico (CSS)
        const ratio = window.devicePixelRatio || 1;
        canvas.width = size * ratio;
        canvas.height = size * ratio;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

        const center = size / 2;
        const radius = center - 50; // Margen para las etiquetas
        const labels = SKILLS.map((s) => s.key);
        const values = labels.map((key) => skills[key] || 0);
        const count = labels.length;
        const maxValue = Math.max(...values, 5); // Escala mínima de 5 para que no quede diminuto
        const angleOf = (i) => (Math.PI * 2 * i) / count - Math.PI / 2;
        const pointAt = (i, r) => [center + Math.cos(angleOf(i)) * r, center + Math.sin(angleOf(i)) * r];

        const colors = {
            grid: cssToken('--color-border') || '#e0e0e0',
            text: cssToken('--color-text-muted') || '#555',
            primary: cssToken('--color-primary') || '#FF7B54',
            fill: cssToken('--color-primary-soft') || 'rgba(255, 123, 84, 0.35)',
            dot: cssToken('--color-surface') || '#fff'
        };

        ctx.clearRect(0, 0, size, size);

        // Telaraña de fondo (3 niveles)
        ctx.strokeStyle = colors.grid;
        ctx.lineWidth = 1;
        for (let level = 1; level <= 3; level++) {
            ctx.beginPath();
            for (let i = 0; i < count; i++) {
                const [x, y] = pointAt(i, (radius * level) / 3);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.stroke();
        }

        // Ejes, etiquetas y valores
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let i = 0; i < count; i++) {
            const [axisX, axisY] = pointAt(i, radius);
            ctx.beginPath();
            ctx.moveTo(center, center);
            ctx.lineTo(axisX, axisY);
            ctx.stroke();

            const [labelX, labelY] = pointAt(i, radius + 26);
            ctx.font = '600 11px Outfit, sans-serif';
            ctx.fillStyle = colors.text;
            ctx.fillText(labels[i], labelX, labelY);
            ctx.font = '900 11px Outfit, sans-serif';
            ctx.fillStyle = colors.primary;
            ctx.fillText(String(values[i]), labelX, labelY + 13);
        }

        // Polígono del jugador
        ctx.beginPath();
        values.forEach((value, i) => {
            const [x, y] = pointAt(i, (value / maxValue) * radius);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fillStyle = colors.fill;
        ctx.fill();
        ctx.strokeStyle = colors.primary;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Vértices
        values.forEach((value, i) => {
            const [x, y] = pointAt(i, (value / maxValue) * radius);
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fillStyle = colors.dot;
            ctx.fill();
            ctx.stroke();
        });
    }

    /**
     * Abre el dashboard de un jugador.
     * @param {Object} params
     * @param {Array} params.points   Registros con `servingTeam` (filtrados por línea de tiempo y set).
     * @param {string} params.playerId 'A1'…'B2'
     * @param {Object} params.config  Config del partido analizado.
     * @param {'all'|number} params.set Filtro de set activo.
     */
    function open({ points, playerId, config, set }) {
        const profile = VP.statsEngine.computePlayerProfile(points, playerId);
        // La recepción la registra el rally (no la acción del jugador), por eso va aparte
        const reception = VP.statsEngine.computeProIndicators(points).players[playerId];
        const playerName = config[`p${playerId}`] || playerId;
        const teamName = profile.team === 'A' ? config.teamA : config.teamB;

        currentReport = {
            playerName,
            playerId,
            teamName,
            setLabel: set === 'all' ? 'All' : `Set_${set}`,
            profile,
            reception
        };

        // Cabecera
        el.avatar.src = getAvatarUrl(playerName);
        el.avatar.alt = `Avatar de ${playerName}`;
        el.avatar.className = `avatar avatar--xl avatar--team-${profile.team.toLowerCase()}`;
        el.name.textContent = playerName;
        el.context.textContent = `${teamName} · ${set === 'all' ? 'Todo el partido' : `Set ${set}`}`;

        // KPIs
        setSignedValue(el.plusMinus, profile.plusMinus, profile.plusMinus > 0 ? `+${profile.plusMinus}` : String(profile.plusMinus));
        setSignedValue(el.efficiency, profile.efficiency, `${profile.efficiency.toFixed(1)} %`);
        el.clutch.textContent = profile.clutch;

        // Zonas
        el.zoneL.style.width = `${profile.zones.pctLeft}%`;
        el.zoneR.style.width = `${profile.zones.pctRight}%`;
        el.zoneLValue.textContent = `${profile.zones.pctLeft.toFixed(0)}%`;
        el.zoneRValue.textContent = `${profile.zones.pctRight.toFixed(0)}%`;
        el.bestMinute.textContent = profile.bestMinute
            ? `Minuto ${profile.bestMinute.minute} (${profile.bestMinute.count} pts)`
            : 'Ninguno aún';

        renderReception(reception);
        renderHeatmap(profile.heatPoints, profile.team);
        renderSkills(profile.skills);
        openModal(el.dialog);
        drawRadarChart(profile.skills); // Tras abrir: así getComputedStyle lee el tema real
    }

    async function handlePdf() {
        if (!currentReport) return;
        const button = byId('btn-export-pdf');
        button.disabled = true;
        button.textContent = 'Exportando…';
        try {
            await VP.exporters.exportPlayerPdf(el.panel, currentReport);
            toast('PDF descargado.', { type: 'success' });
        } catch (error) {
            toast(error.message, { type: 'error' });
        } finally {
            button.disabled = false;
            button.textContent = '📄 PDF';
        }
    }

    function init() {
        el = {
            dialog: byId('player-dashboard'),
            panel: byId('player-dash-panel'),
            avatar: byId('dash-avatar-img'),
            name: byId('dash-name'),
            context: byId('dash-context'),
            plusMinus: byId('dash-plus-minus'),
            efficiency: byId('dash-eff'),
            clutch: byId('dash-clutch'),
            zoneL: byId('dash-zone-l'),
            zoneR: byId('dash-zone-r'),
            zoneLValue: byId('dash-zone-l-val'),
            zoneRValue: byId('dash-zone-r-val'),
            bestMinute: byId('dash-best-minute'),
            heatmap: byId('dash-heatmap-points'),
            reception: byId('dash-reception'),
            skills: byId('dash-skills-grid'),
            radar: byId('player-radar-chart')
        };

        byId('btn-export-pdf').addEventListener('click', handlePdf);
        byId('btn-export-csv').addEventListener('click', () => currentReport && VP.exporters.exportPlayerCsv(currentReport));
        byId('btn-export-json').addEventListener('click', () => currentReport && VP.exporters.exportPlayerJson(currentReport));
    }

    VP.views = VP.views || {};
    VP.views.playerDashboard = Object.freeze({ init, open });
})(window);
