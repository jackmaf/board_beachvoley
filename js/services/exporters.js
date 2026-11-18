/**
 * @file exporters.js
 * @description Generación y descarga de archivos: reporte del jugador
 * (PDF / CSV / JSON) y copia de seguridad completa de la app.
 *
 * Las descargas usan URIs "data:" (no `blob:`): cuando la app se abre desde
 * una ruta de red como `file://wsl.localhost/…`, Chrome bloquea las URLs
 * `blob:` ("Not allowed to load local resource") y no se descargaría nada.
 * El contenido se codifica con `encodeURIComponent` para que caracteres
 * como "#" o tildes no corten el archivo (el código anterior usaba `encodeURI`).
 */
(function (root) {
    'use strict';

    const VP = (root.VP = root.VP || {});
    const { toCsv, slugify, getAvatarUrl } = VP.utils;
    const { SKILLS } = VP.constants;
    /** Traducción en el momento de exportar (i18n se carga después de este archivo). */
    const t = (key, params) => VP.i18n.t(key, params);

    /**
     * Descarga un archivo generado en memoria.
     * @param {string} filename
     * @param {string} content
     * @param {string} mimeType
     */
    function downloadFile(filename, content, mimeType) {
        downloadUrl(filename, `data:${mimeType},${encodeURIComponent(content)}`);
    }

    /** Dispara la descarga de una URL (data URI) con un nombre de archivo. */
    function downloadUrl(filename, url) {
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
    }

    /** Nombre base de los archivos del reporte: VoleyPlaya_Scouting_<Jugador>_<Set>. */
    const reportBaseName = (report) => `VoleyPlaya_Scouting_${slugify(report.playerName)}_${report.setLabel}`;

    /**
     * @typedef {Object} PlayerReport
     * @property {string} playerName
     * @property {string} playerId
     * @property {string} teamName
     * @property {string} setLabel  'All' o 'Set_2'
     * @property {Object} profile   Resultado de statsEngine.computePlayerProfile
     * @property {Object} reception Recepción del jugador (statsEngine.computeProIndicators)
     */

    /** Filas de recepción para el CSV (vacías si no hay recepciones registradas). */
    function receptionRows(reception) {
        if (!reception || !reception.count) return [[t('csv.receptions'), 0]];
        const pct = (v) => (v === null ? '-' : v.toFixed(1));
        return [
            [t('csv.receptions'), reception.count],
            [t('csv.receptionAverage'), reception.average.toFixed(2)],
            [t('csv.receptionPositive'), pct(reception.positivePct)],
            [t('csv.receptionPerfect'), pct(reception.perfectPct)],
            [t('csv.receptionSideOut'), pct(reception.sideOutPct)],
            [t('csv.receptionByGrade'), [3, 2, 1, 0].map((g) => reception.grades[g]).join(' / ')]
        ];
    }

    /** Exporta el reporte completo del jugador en JSON. */
    function exportPlayerJson(report) {
        const payload = {
            jugador: report.playerName,
            id: report.playerId,
            equipo: report.teamName,
            filtroSet: report.setLabel,
            recepcion: report.reception,
            ...report.profile
        };
        downloadFile(`${reportBaseName(report)}.json`, JSON.stringify(payload, null, 2), 'application/json');
    }

    /**
     * Exporta el reporte en CSV con dos tablas: resumen de KPIs y bitácora.
     * Se antepone el BOM UTF-8 (﻿) para que Excel muestre bien las tildes.
     */
    function exportPlayerCsv(report) {
        const { profile } = report;
        const rows = [
            [t('csv.summaryHeader')],
            [t('csv.metric'), t('csv.value')],
            [t('common.player'), `${report.playerName} (${report.playerId})`],
            [t('csv.team'), report.teamName],
            [t('csv.efficiency'), profile.efficiency.toFixed(1)],
            ['Plus/Minus', profile.plusMinus],
            [t('csv.winners'), profile.pts],
            [t('stats.errors'), profile.errs],
            [t('dash.clutch'), profile.clutch],
            [t('csv.zoneLeft'), profile.zones.pctLeft.toFixed(1)],
            [t('csv.zoneRight'), profile.zones.pctRight.toFixed(1)],
            [t('csv.bestMinute'), profile.bestMinute ? `${profile.bestMinute.minute} (${profile.bestMinute.count} pts)` : '-'],
            ...SKILLS.map((skill) => [t('csv.skillPoints', { skill: VP.i18n.skill(skill.key) }), profile.skills[skill.key] || 0]),
            ...receptionRows(report.reception),
            [],
            [t('csv.logHeader')],
            [t('csv.colPoint'), 'Set', t('csv.colAvatar'), t('stats.colAction'), t('stats.colScore'), 'X (m)', 'Y (m)'],
            ...profile.log.map((row) => [
                row.pointNumber ?? '-',
                row.setNumber,
                getAvatarUrl(report.playerName),
                VP.i18n.describeAction({ tipoAccion: row.kind, actionDetail: row.detail }),
                row.score,
                row.xMeters,
                row.yMeters
            ])
        ];
        downloadFile(`${reportBaseName(report)}.csv`, `﻿${toCsv(rows)}`, 'text/csv;charset=utf-8');
    }

    /**
     * Exporta a PDF el panel del dashboard usando html2pdf (cargado por CDN).
     * Durante la captura se aplica el modificador `player-dash--printing`
     * (sin scroll ni botones) y se fuerza el tema claro para que el PDF sea legible.
     *
     * @param {HTMLElement} element Panel a capturar.
     * @param {PlayerReport} report
     * @returns {Promise<void>}
     */
    async function exportPlayerPdf(element, report) {
        if (!window.html2pdf) {
            throw new Error(t('errors.pdfLibrary'));
        }
        const body = document.body;
        const originalTheme = body.dataset.theme;
        const originalBsTheme = body.dataset.bsTheme;
        if (originalTheme === 'dark') {
            body.dataset.theme = 'classic';
            body.dataset.bsTheme = 'light'; // También el modo de color de Bootstrap
        }
        element.classList.add('player-dash--printing');

        try {
            // Se pide el PDF como data URI y se descarga con nuestro helper
            // (`.save()` de html2pdf usa `blob:` y falla en rutas de red file://).
            const dataUri = await window
                .html2pdf()
                .set({
                    margin: 10,
                    image: { type: 'jpeg', quality: 0.98 },
                    html2canvas: { scale: 2, useCORS: true, backgroundColor: '#F6F6F6', windowWidth: 800, scrollY: 0 },
                    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
                })
                .from(element)
                .outputPdf('datauristring');
            downloadUrl(`${reportBaseName(report)}.pdf`, dataUri);
        } finally {
            // Restaurar SIEMPRE, aunque la exportación falle
            element.classList.remove('player-dash--printing');
            body.dataset.theme = originalTheme;
            body.dataset.bsTheme = originalBsTheme;
        }
    }

    /** Descarga la copia de seguridad completa. */
    function exportBackup() {
        const date = new Date().toISOString().slice(0, 10);
        downloadFile(`VoleyPlaya_Backup_${date}.json`, JSON.stringify(VP.storage.exportBackup(), null, 2), 'application/json');
    }

    /**
     * Lee un archivo JSON de copia de seguridad elegido por el usuario.
     * @param {File} file
     * @returns {Promise<Object>} Contenido parseado.
     */
    function readJsonFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    resolve(JSON.parse(reader.result));
                } catch {
                    reject(new Error(t('errors.invalidJson')));
                }
            };
            reader.onerror = () => reject(new Error(t('errors.readFile')));
            reader.readAsText(file);
        });
    }

    VP.exporters = Object.freeze({ downloadFile, exportPlayerJson, exportPlayerCsv, exportPlayerPdf, exportBackup, readJsonFile });
})(window);
