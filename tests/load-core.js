/**
 * Carga los módulos puros del núcleo en Node, en el mismo orden que index.html.
 * Cada módulo se cuelga de `globalThis.VP`, igual que en el navegador.
 */
require('../js/core/constants.js');
require('../js/core/utils.js');
require('../js/core/rules.js');
require('../js/core/tournament-engine.js');
require('../js/core/prize-engine.js');
require('../js/core/stats-engine.js');

module.exports = globalThis.VP;
