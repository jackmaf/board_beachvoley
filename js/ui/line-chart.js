/**
 * @file line-chart.js
 * @description Gráfica de líneas escalonadas en SVG, sin dependencias.
 * Se usa para la evolución de puntos de un torneo Queen & King (puntos de
 * cada dupla tras cada rally).
 *
 * Decisiones de diseño (guía de visualización de datos del proyecto):
 *  - Líneas ESCALONADAS: los puntos sólo cambian al terminar un rally.
 *  - Colores categóricos en orden FIJO (--series-1…8) y asignados por la
 *    entidad (orden de inscripción de la dupla), nunca por su posición.
 *    Paleta validada (daltonismo y contraste) en tema claro y oscuro.
 *  - Leyenda siempre (≥ 2 series); etiquetas directas al final de cada línea
 *    sólo si hay ≤ 4 series y no se pisan.
 *  - Interacción: cruceta vertical que se ajusta al rally más cercano y un
 *    tooltip con TODAS las duplas. También con teclado (← →).
 *  - Los nombres son datos del usuario: siempre `textContent`, nunca innerHTML.
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const SVG_NS = 'http://www.w3.org/2000/svg';
    /** Series con color propio; las demás se omiten (siguen en la tabla). */
    const MAX_SERIES = 8;
    const HEIGHT = 260;
    /** Textos en el idioma activo (se piden al pintar, no al cargar). */
    const t = (key, params) => root.VP.i18n.t(key, params);

    /** Crea un elemento SVG con atributos. */
    function svgEl(tag, attrs = {}) {
        const node = document.createElementNS(SVG_NS, tag);
        Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
        return node;
    }

    /** Marcas "redondas" para el eje Y (enteros: son puntos). */
    function niceTicks(max) {
        const step = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : 10;
        const ticks = [];
        for (let v = 0; v <= max; v += step) ticks.push(v);
        if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
        return ticks;
    }

    /**
     * Pinta la gráfica dentro de `container` (reemplaza su contenido).
     * @param {HTMLElement} container
     * @param {Object} options
     * @param {number[]} options.labels     Valores del eje X (nº de rally).
     * @param {Array<{id:string,name:string,values:number[]}>} options.series En orden de inscripción.
     * @param {number} [options.target]     Línea de referencia (puntos para ganar).
     * @param {string} [options.ariaLabel]
     */
    function render(container, { labels, series, target, ariaLabel }) {
        container.innerHTML = '';
        const drawn = series.slice(0, MAX_SERIES).map((s, i) => ({ ...s, slot: i + 1 }));
        const omitted = series.length - drawn.length;

        // --- Leyenda (HTML: se adapta al ancho y es accesible) ---------------
        const legend = document.createElement('ul');
        legend.className = 'points-chart__legend';
        drawn.forEach((s) => {
            const item = document.createElement('li');
            item.className = 'points-chart__legend-item';
            const key = document.createElement('span');
            key.className = `points-chart__key points-chart__key--s${s.slot}`;
            const name = document.createElement('span');
            name.textContent = s.name;
            item.append(key, name);
            legend.appendChild(item);
        });
        container.appendChild(legend);

        // --- Geometría ------------------------------------------------------
        const width = Math.max(280, container.clientWidth || 600);
        const ends = drawn.map((s) => ({ s, value: s.values[s.values.length - 1] }));
        const yMax = Math.max(1, target || 0, ...drawn.flatMap((s) => s.values));
        const ticks = niceTicks(yMax);
        const top = ticks[ticks.length - 1];

        // Etiquetas directas: ≤ 4 series y sin colisiones verticales
        const plotHeight = HEIGHT - 16 - 34;
        const yPx = (v) => 16 + plotHeight - (v / top) * plotHeight;
        const sortedEnds = [...ends].sort((a, b) => yPx(a.value) - yPx(b.value));
        const fits = sortedEnds.every((e, i) => i === 0 || yPx(e.value) - yPx(sortedEnds[i - 1].value) >= 14);
        const directLabels = drawn.length <= 4 && fits;

        const margin = { top: 16, right: directLabels ? 96 : 16, bottom: 34, left: 34 };
        const plotWidth = width - margin.left - margin.right;
        const lastX = Math.max(1, labels.length - 1);
        const xPx = (i) => margin.left + (i / lastX) * plotWidth;

        const svg = svgEl('svg', {
            class: 'points-chart__svg',
            viewBox: `0 0 ${width} ${HEIGHT}`,
            width: '100%',
            height: HEIGHT,
            role: 'img',
            'aria-label': ariaLabel || t('tStats.chartLabel')
        });

        // Rejilla horizontal y eje Y (recesivos)
        ticks.forEach((t) => {
            svg.appendChild(svgEl('line', { class: 'points-chart__grid', x1: margin.left, x2: margin.left + plotWidth, y1: yPx(t), y2: yPx(t) }));
            const label = svgEl('text', { class: 'points-chart__axis-label', x: margin.left - 8, y: yPx(t) + 4, 'text-anchor': 'end' });
            label.textContent = t;
            svg.appendChild(label);
        });

        // Eje X: ~6 marcas de nº de rally
        const every = Math.max(1, Math.ceil(lastX / 6));
        labels.forEach((value, i) => {
            if (i % every !== 0 && i !== lastX) return;
            const label = svgEl('text', { class: 'points-chart__axis-label', x: xPx(i), y: HEIGHT - 14, 'text-anchor': 'middle' });
            label.textContent = value;
            svg.appendChild(label);
        });
        const xTitle = svgEl('text', { class: 'points-chart__axis-label', x: margin.left + plotWidth, y: HEIGHT - 1, 'text-anchor': 'end' });
        xTitle.textContent = t('tStats.chartAxis');
        svg.appendChild(xTitle);

        // Línea de referencia: puntos para ganar
        if (target) {
            svg.appendChild(svgEl('line', { class: 'points-chart__target', x1: margin.left, x2: margin.left + plotWidth, y1: yPx(target), y2: yPx(target) }));
            const label = svgEl('text', { class: 'points-chart__axis-label', x: margin.left + 4, y: yPx(target) - 5 });
            label.textContent = t('tStats.chartTarget', { target });
            svg.appendChild(label);
        }

        // Líneas escalonadas + marcador final (anillo del color de la superficie)
        drawn.forEach((s) => {
            let d = `M ${xPx(0)} ${yPx(s.values[0])}`;
            for (let i = 1; i < s.values.length; i++) d += ` H ${xPx(i)} V ${yPx(s.values[i])}`;
            svg.appendChild(svgEl('path', { class: `points-chart__line points-chart__line--s${s.slot}`, d }));
            const lastIndex = s.values.length - 1;
            svg.appendChild(svgEl('circle', {
                class: `points-chart__dot points-chart__dot--s${s.slot}`,
                cx: xPx(lastIndex),
                cy: yPx(s.values[lastIndex]),
                r: 4
            }));
            if (directLabels) {
                const label = svgEl('text', { class: 'points-chart__label', x: xPx(lastIndex) + 8, y: yPx(s.values[lastIndex]) + 4 });
                label.textContent = `${s.name} · ${s.values[lastIndex]}`;
                svg.appendChild(label);
            }
        });

        // --- Interacción: cruceta + tooltip ----------------------------------
        const crosshair = svgEl('line', { class: 'points-chart__crosshair', y1: margin.top, y2: margin.top + plotHeight, visibility: 'hidden' });
        svg.appendChild(crosshair);
        const hit = svgEl('rect', {
            class: 'points-chart__hit',
            x: margin.left,
            y: margin.top,
            width: plotWidth,
            height: plotHeight,
            tabindex: '0',
            'aria-label': t('tStats.chartExplore')
        });
        svg.appendChild(hit);

        const frame = document.createElement('div');
        frame.className = 'points-chart__frame';
        frame.appendChild(svg);
        const tooltip = document.createElement('div');
        tooltip.className = 'points-chart__tooltip';
        tooltip.hidden = true;
        frame.appendChild(tooltip);
        container.appendChild(frame);

        let current = null;
        function show(index) {
            current = Math.max(0, Math.min(lastX, index));
            const x = xPx(current);
            crosshair.setAttribute('x1', x);
            crosshair.setAttribute('x2', x);
            crosshair.setAttribute('visibility', 'visible');

            tooltip.innerHTML = '';
            const title = document.createElement('div');
            title.className = 'points-chart__tooltip-title';
            title.textContent = current === 0 ? t('tStats.chartStart') : t('tStats.chartAfter', { number: labels[current] });
            tooltip.appendChild(title);
            [...drawn]
                .sort((a, b) => b.values[current] - a.values[current])
                .forEach((s) => {
                    const row = document.createElement('div');
                    row.className = 'points-chart__tooltip-row';
                    const key = document.createElement('span');
                    key.className = `points-chart__key points-chart__key--s${s.slot}`;
                    const name = document.createElement('span');
                    name.className = 'points-chart__tooltip-name';
                    name.textContent = s.name;
                    const value = document.createElement('strong');
                    value.className = 'points-chart__tooltip-value';
                    value.textContent = s.values[current];
                    row.append(key, name, value);
                    tooltip.appendChild(row);
                });
            tooltip.hidden = false;
            // Posición: a la derecha de la cruceta salvo que no quepa
            const scale = frame.clientWidth / width;
            const left = x * scale;
            const tipWidth = tooltip.offsetWidth;
            tooltip.style.left = `${left + 12 + tipWidth > frame.clientWidth ? left - tipWidth - 12 : left + 12}px`;
        }
        function hide() {
            crosshair.setAttribute('visibility', 'hidden');
            tooltip.hidden = true;
        }

        hit.addEventListener('pointermove', (event) => {
            const box = svg.getBoundingClientRect();
            const xInView = ((event.clientX - box.left) / box.width) * width;
            show(Math.round(((xInView - margin.left) / plotWidth) * lastX));
        });
        hit.addEventListener('pointerleave', hide);
        hit.addEventListener('focus', () => show(current ?? lastX));
        hit.addEventListener('blur', hide);
        hit.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowLeft') show((current ?? lastX) - 1);
            else if (event.key === 'ArrowRight') show((current ?? 0) + 1);
            else if (event.key === 'Escape') hide();
            else return;
            event.preventDefault();
        });

        if (omitted > 0) {
            const note = document.createElement('p');
            note.className = 'small text-body-secondary text-center mb-0';
            note.textContent = t('tStats.chartOmitted', { count: omitted });
            container.appendChild(note);
        }
    }

    VP.charts = Object.freeze({ renderLineChart: render });
})(window);
