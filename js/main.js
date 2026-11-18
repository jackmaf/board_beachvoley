/**
 * @file main.js
 * @description Punto de arranque de la aplicación.
 *
 * Orden de inicialización:
 *   0. Idioma: traduce el HTML antes de que las vistas pinten nada.
 *   1. Comportamiento global (modales, navegación).
 *   2. Cada vista registra sus eventos y sus hooks en el router.
 *   3. El store carga el partido guardado (si lo hay) y avisa a las vistas.
 *   4. Se muestra la vista inicial según haya o no partido en curso.
 */
(function (root) {
    'use strict';

    const VP = root.VP;
    const store = VP.matchStore;

    function start() {
        VP.language.init();
        VP.dom.initModals();
        VP.router.init();

        VP.views.config.init();
        VP.views.tournaments.init();
        VP.views.scout.init();
        VP.views.live.init();
        VP.views.playerDashboard.init();
        VP.views.stats.init();

        // Los accesos a Scout / Marcador sólo se habilitan con un partido en curso
        store.subscribe((event) => {
            if (event === 'change') VP.router.setMatchViewsEnabled(store.hasMatch());
        });
        store.load();

        // Vista inicial: retomar el partido en curso o ir a Torneos
        if (!store.hasMatch()) VP.router.go('vista-torneos');
        else VP.router.go(store.isTournamentMatch() ? 'vista-marcador-vivo' : 'vista-registro');
    }

    // Red de seguridad: cualquier error no controlado se registra y se avisa
    // al usuario en lugar de dejar la app "congelada" sin explicación.
    root.addEventListener('error', (event) => {
        console.error('[app] Error no controlado:', event.error || event.message);
        VP.feedback?.toast(VP.i18n ? VP.i18n.t('errors.unexpected') : 'Ocurrió un error inesperado.', { type: 'error' });
    });

    // Los scripts usan `defer`, así que el DOM ya está listo al llegar aquí.
    start();
})(window);
