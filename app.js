document.addEventListener('DOMContentLoaded', () => {
    // State
    let state = {
        config: null,
        scoreA: 0,
        scoreB: 0,
        points: [], // { equipo, jugadorId, tipoAccion, coordenadas: {x, y}, marcadorMomento, timestamp }
        currentPendingPoint: null,
        matchStartTime: null
    };

    // DOM Elements - Nav
    const navConfig = document.getElementById('nav-config');
    const navRegistro = document.getElementById('nav-registro');
    const navEstadisticas = document.getElementById('nav-estadisticas');

    // DOM Elements - Views
    const vistaConfig = document.getElementById('vista-configuracion');
    const vistaRegistro = document.getElementById('vista-registro');
    const vistaEstadisticas = document.getElementById('vista-estadisticas');

    // DOM Elements - Config
    const configForm = document.getElementById('config-form');

    // DOM Elements - Registro
    const uiScoreA = document.getElementById('score-a');
    const uiScoreB = document.getElementById('score-b');
    const nameTeamA = document.getElementById('name-team-a');
    const nameTeamB = document.getElementById('name-team-b');
    const mainCourt = document.getElementById('main-court');

    // Player Menu
    const playerMenu = document.getElementById('player-menu');
    const cancelPointBtn = document.getElementById('cancel-point');
    const btnA1 = document.getElementById('btn-a1');
    const btnA2 = document.getElementById('btn-a2');
    const btnB1 = document.getElementById('btn-b1');
    const btnB2 = document.getElementById('btn-b2');

    const btnEndMatch = document.getElementById('btn-end-match');

    // Stats
    const uiFinalScore = document.getElementById('final-score');
    const uiMatchDuration = document.getElementById('match-duration');
    const uiTotalPoints = document.getElementById('total-points');
    const playersStatsContainer = document.getElementById('players-stats-container');
    const heatmapPoints = document.getElementById('heatmap-points');

    // DOM Elements - Form controls
    const filterPlayerBtns = document.querySelectorAll('#filter-players .filter-pill');
    const filterActionBtns = document.querySelectorAll('#filter-actions .filter-pill');
    const filterTimeline = document.getElementById('filter-timeline');
    const timelineVal = document.getElementById('timeline-val');

    // Modal
    const playerDashboard = document.getElementById('player-dashboard');
    const closeDashboardBtn = document.getElementById('close-dashboard');

    // Filter state
    let activeFilters = {
        player: 'all', // 'all', 'A1', 'A2', 'B1', 'B2'
        action: 'all', // 'all', 'punto', 'error'
        maxTimePct: 100 // 0 to 100
    };

    let currentMarker = null;

    // init load
    loadState();

    // Setup navigation
    function setView(viewId) {
        // Update nav buttons
        [navConfig, navRegistro, navEstadisticas].forEach(btn => btn.classList.remove('active'));
        if (viewId === 'vista-configuracion') navConfig.classList.add('active');
        if (viewId === 'vista-registro') navRegistro.classList.add('active');
        if (viewId === 'vista-estadisticas') navEstadisticas.classList.add('active');

        // Show specific view
        [vistaConfig, vistaRegistro, vistaEstadisticas].forEach(view => {
            if (view.id === viewId) {
                view.classList.add('active-view');
            } else {
                view.classList.remove('active-view');
            }
        });

        if (viewId === 'vista-estadisticas') {
            resetFilters();
            renderStatistics();
        }
    }

    // Filter Logic setup
    function resetFilters() {
        activeFilters = { player: 'all', action: 'all', maxTimePct: 100 };
        document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
        document.querySelector('#filter-players [data-filter="all"]').classList.add('active');
        document.querySelector('#filter-actions [data-filter="all"]').classList.add('active');
        filterTimeline.value = 100;
        timelineVal.innerText = "Todo el partido";
    }

    filterPlayerBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterPlayerBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeFilters.player = btn.getAttribute('data-filter');
            renderStatistics();
        });
    });

    filterActionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterActionBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeFilters.action = btn.getAttribute('data-filter');
            renderStatistics();
        });
    });

    filterTimeline.addEventListener('input', (e) => {
        activeFilters.maxTimePct = parseInt(e.target.value);
        if (activeFilters.maxTimePct === 100) timelineVal.innerText = "Todo el partido";
        else timelineVal.innerText = `Hasta el ${activeFilters.maxTimePct}%`;
        renderStatistics();
    });

    // Close Modal
    closeDashboardBtn.addEventListener('click', () => {
        playerDashboard.classList.add('hidden');
    });

    navConfig.addEventListener('click', () => setView('vista-configuracion'));
    navRegistro.addEventListener('click', () => setView('vista-registro'));
    navEstadisticas.addEventListener('click', () => setView('vista-estadisticas'));

    // Form submit starts match
    configForm.addEventListener('submit', (e) => {
        e.preventDefault();

        state.config = {
            teamA: document.getElementById('input-team-a').value.trim() || 'Equipo A',
            teamB: document.getElementById('input-team-b').value.trim() || 'Equipo B',
            pA1: document.getElementById('input-a1').value.trim() || 'A1',
            pA2: document.getElementById('input-a2').value.trim() || 'A2',
            pB1: document.getElementById('input-b1').value.trim() || 'B1',
            pB2: document.getElementById('input-b2').value.trim() || 'B2'
        };

        // Reset match data if it's a new match start
        if (state.points.length === 0) {
            state.scoreA = 0;
            state.scoreB = 0;
            state.matchStartTime = null;
        }

        saveState();
        applyConfigToUI();

        navRegistro.disabled = false;
        navEstadisticas.disabled = false;
        setView('vista-registro');
    });

    function applyConfigToUI() {
        if (!state.config) return;

        // Names in scoreboard
        nameTeamA.innerText = state.config.teamA;
        nameTeamB.innerText = state.config.teamB;

        // Names in menu buttons
        btnA1.innerText = state.config.pA1;
        btnA2.innerText = state.config.pA2;
        btnB1.innerText = state.config.pB1;
        btnB2.innerText = state.config.pB2;

        // Pre-fill config form if revisiting
        document.getElementById('input-team-a').value = state.config.teamA;
        document.getElementById('input-team-b').value = state.config.teamB;
        document.getElementById('input-a1').value = state.config.pA1;
        document.getElementById('input-a2').value = state.config.pA2;
        document.getElementById('input-b1').value = state.config.pB1;
        document.getElementById('input-b2').value = state.config.pB2;

        updateScoreUI();
    }

    // Court interactions
    const freeZone = document.getElementById('free-zone');
    freeZone.addEventListener('click', (e) => {
        if (!playerMenu.classList.contains('hidden') && e.target.closest('#player-menu')) {
            return;
        }

        const rect = mainCourt.getBoundingClientRect();
        // Allow calculating x and y outside [0, 100]
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        state.currentPendingPoint = { x, y };

        if (!state.matchStartTime) {
            state.matchStartTime = Date.now();
        }

        // Show marker
        if (currentMarker) currentMarker.remove();
        currentMarker = document.createElement('div');
        currentMarker.classList.add('point-marker');
        currentMarker.style.left = `${x}%`;
        currentMarker.style.top = `${y}%`;
        mainCourt.appendChild(currentMarker);

        // Reset radio to Punto Ganador
        document.querySelector('input[name="actionType"][value="punto"]').checked = true;

        playerMenu.classList.remove('hidden');
    });

    cancelPointBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closePlayerMenu();
    });

    const playerBtns = document.querySelectorAll('.player-btn');
    playerBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const player = btn.getAttribute('data-player');
            const team = btn.getAttribute('data-team');
            registerPoint(team, player);
        });
    });

    btnEndMatch.addEventListener('click', () => {
        if (confirm('¿Estás seguro de terminar el partido? Esto lo guardará en el historial.')) {
            let history = JSON.parse(localStorage.getItem('voley-history')) || [];
            if (state.points.length > 0) {
                history.push(state);
                localStorage.setItem('voley-history', JSON.stringify(history));
                localStorage.setItem('voley-lastMatch', JSON.stringify(state));
            }

            setView('vista-estadisticas');

            // Reset current state but keep viewing stats of the match just ended
            state = {
                config: null,
                scoreA: 0,
                scoreB: 0,
                points: [],
                currentPendingPoint: null,
                matchStartTime: null
            };
            saveState();

            navRegistro.disabled = true;
            navEstadisticas.disabled = true;

            // Optional: reset config form
            configForm.reset();
        }
    });

    function registerPoint(team, playerId) {
        if (!state.currentPendingPoint) return;

        const actionType = document.querySelector('input[name="actionType"]:checked').value;

        // Determinar a qué equipo va el punto
        // Si el jugador de A hace un punto, va para A. 
        // Si el jugador de A hace un error, el punto va para B.
        let pointGoesTo = team;
        if (actionType === 'error') {
            pointGoesTo = team === 'A' ? 'B' : 'A';
        }

        if (pointGoesTo === 'A') state.scoreA++;
        else state.scoreB++;

        state.points.push({
            pointNumber: state.points.length + 1, // Chronological Tracking
            equipo: team, // Quién ejecutó la acción
            jugadorId: playerId, // A1, A2...
            tipoAccion: actionType, // 'punto' o 'error'
            coordenadas: state.currentPendingPoint,
            marcadorMomento: `${state.scoreA}-${state.scoreB}`,
            timestamp: Date.now()
        });

        saveState();
        updateScoreUI();
        closePlayerMenu();
    }

    function closePlayerMenu() {
        if (currentMarker) currentMarker.remove();
        playerMenu.classList.add('hidden');
        state.currentPendingPoint = null;
    }

    function updateScoreUI() {
        uiScoreA.innerText = state.scoreA;
        uiScoreB.innerText = state.scoreB;
    }

    function saveState() {
        localStorage.setItem('voley-currentMatch', JSON.stringify(state));
    }

    function loadState() {
        const saved = localStorage.getItem('voley-currentMatch');
        if (saved) {
            state = JSON.parse(saved);
            if (state.config) {
                navRegistro.disabled = false;
                navEstadisticas.disabled = false;
                applyConfigToUI();
                setView('vista-registro'); // Jump to match if running
            } else {
                setView('vista-configuracion');
            }
        }
    }

    function renderStatistics() {
        let statsState = state;
        if (!statsState.config || statsState.points.length === 0) {
            const lastMatch = localStorage.getItem('voley-lastMatch');
            if (lastMatch) {
                statsState = JSON.parse(lastMatch);
            }
        }

        if (!statsState.config || statsState.points.length === 0) {
            uiFinalScore.innerText = `0 - 0`;
            uiMatchDuration.innerText = `00:00`;
            uiTotalPoints.innerText = `0`;
            playersStatsContainer.innerHTML = '<p style="text-align:center; padding: 2rem;">No hay datos registrados aún.</p>';
            heatmapPoints.innerHTML = '';
            return;
        }

        const teamNameA = statsState.config.teamA;
        const teamNameB = statsState.config.teamB;

        // Summary ignores Action/Player filters, but respects Time filter
        const lastIndexForTime = Math.floor((statsState.points.length * activeFilters.maxTimePct) / 100);
        const pointsInTime = statsState.points.slice(0, lastIndexForTime);

        // Calculate score at the chosen time
        let tempScoreA = 0; let tempScoreB = 0;
        pointsInTime.forEach(p => {
            let pointGoesTo = p.equipo;
            if (p.tipoAccion === 'error') pointGoesTo = p.equipo === 'A' ? 'B' : 'A';
            if (pointGoesTo === 'A') tempScoreA++; else tempScoreB++;
        });

        uiFinalScore.innerText = `${teamNameA} ${tempScoreA} - ${tempScoreB} ${teamNameB}`;
        uiTotalPoints.innerText = pointsInTime.length;

        const lastPointTime = pointsInTime.length > 0 ? pointsInTime[pointsInTime.length - 1].timestamp : (statsState.matchStartTime || Date.now());
        const diffMs = statsState.matchStartTime ? Math.max(0, lastPointTime - statsState.matchStartTime) : 0;

        const totalSeconds = Math.floor(diffMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;

        uiMatchDuration.innerText = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

        // Player Breakdown & Heatmap
        const playerStats = {
            'A1': { pts: 0, errs: 0, name: statsState.config.pA1 },
            'A2': { pts: 0, errs: 0, name: statsState.config.pA2 },
            'B1': { pts: 0, errs: 0, name: statsState.config.pB1 },
            'B2': { pts: 0, errs: 0, name: statsState.config.pB2 }
        };

        heatmapPoints.innerHTML = '';

        // Filter points
        let filteredPoints = pointsInTime.filter(p => {
            if (activeFilters.player !== 'all' && activeFilters.player !== p.jugadorId) return false;
            if (activeFilters.action !== 'all' && activeFilters.action !== p.tipoAccion) return false;
            return true;
        });

        filteredPoints.forEach((p, displayIndex) => {
            // Aggregating Stats (still compute for all players inside the time range, regardless of player filter for the table)
            if (playerStats[p.jugadorId]) {
                if (p.tipoAccion === 'punto') playerStats[p.jugadorId].pts++;
                else playerStats[p.jugadorId].errs++;
            }

            // Heatmap Dots
            const dot = document.createElement('div');
            dot.classList.add('heat-dot');
            dot.classList.add(p.equipo === 'A' ? 'dot-a' : 'dot-b');
            if (p.tipoAccion === 'error') {
                dot.classList.add('is-error');
            }
            dot.style.left = `${p.coordenadas.x}%`;
            dot.style.top = `${p.coordenadas.y}%`;

            // Display chronological order number
            dot.innerText = p.pointNumber; // Real chronological number logic added later in register

            const actionText = p.tipoAccion === 'punto' ? 'Punto' : 'Error';
            const pName = playerStats[p.jugadorId] ? playerStats[p.jugadorId].name : p.jugadorId;
            dot.title = `(#${p.pointNumber}) ${actionText} de ${pName} (${p.marcadorMomento})`;

            heatmapPoints.appendChild(dot);
        });

        playersStatsContainer.innerHTML = '';

        ['A1', 'A2', 'B1', 'B2'].forEach(id => {
            const team = id.charAt(0);
            const teamTotalPoints = team === 'A' ? tempScoreA : tempScoreB;

            const stats = playerStats[id];

            // Recompute stats natively from pointsInTime to ensure it matches the timeline regardless of visual filters
            const badgeClass = team === 'A' ? 'badge-a' : 'badge-b';

            const row = document.createElement('div');
            row.classList.add('player-stat-row');
            // Click to open Individual Dashboard
            row.addEventListener('click', () => openPlayerDashboard(id, stats.name, pointsInTime, badgeClass, teamNameA, teamNameB));

            row.innerHTML = `
                <div class="player-info">
                    <div class="player-badge ${badgeClass}">${id}</div>
                    <span class="player-name-txt">${stats.name}</span>
                </div>
                <div class="stat-values">
                    <div class="stat-pts">${stats.pts} <span style="font-size:0.8rem; font-weight:400; color:#555">Pts ganadores</span></div>
                    <div class="stat-errs">${stats.errs} Errores</div>
                </div>
            `;
            playersStatsContainer.appendChild(row);
        });
    }

    // INDIVIDUAL PLAYER DASHBOARD METRICS
    function openPlayerDashboard(playerId, playerName, allPointsInTime, badgeClass, nameTeamA, nameTeamB) {
        document.getElementById('dash-badge').innerText = playerId;
        document.getElementById('dash-badge').className = `dash-badge ${badgeClass}`;
        document.getElementById('dash-name').innerText = playerName;

        // Extract player points
        let playerPts = 0;
        let playerErrs = 0;
        let clutchPoints = 0;
        let leftZoneAtks = 0;
        let rightZoneAtks = 0;

        const myTeam = playerId.charAt(0);

        // Heatmap for dashboard
        const dashHeatmap = document.getElementById('dash-heatmap-points');
        dashHeatmap.innerHTML = '';

        allPointsInTime.forEach(p => {
            if (p.jugadorId !== playerId) return;

            if (p.tipoAccion === 'punto') playerPts++;
            else playerErrs++;

            // Clutch Calculation: score diff <= 2
            const scores = p.marcadorMomento.split('-');
            const sA = parseInt(scores[0]);
            const sB = parseInt(scores[1]);
            const diff = Math.abs(sA - sB);

            if (p.tipoAccion === 'punto' && diff <= 2) {
                clutchPoints++;
            }

            // Zones (only considering points, normally attacks/serves)
            if (p.tipoAccion === 'punto') {
                // If x < 50% it's left side of court, >= 50% is right side
                if (p.coordenadas.x < 50) leftZoneAtks++;
                else rightZoneAtks++;

                // Personal Heatmap
                const dot = document.createElement('div');
                dot.classList.add('heat-dot');
                dot.classList.add(myTeam === 'A' ? 'dot-a' : 'dot-b');
                dot.style.left = `${p.coordenadas.x}%`;
                dot.style.top = `${p.coordenadas.y}%`;
                dashHeatmap.appendChild(dot);
            }
        });

        const totalActions = playerPts + playerErrs;

        // Net Efficiency
        let efficiency = 0;
        if (totalActions > 0) {
            efficiency = ((playerPts - playerErrs) / totalActions) * 100;
        }
        document.getElementById('dash-eff').innerText = `${efficiency.toFixed(1)}%`;
        document.getElementById('dash-eff').style.color = efficiency < 0 ? '#e84118' : 'var(--primary)';

        // Clutch
        document.getElementById('dash-clutch').innerText = clutchPoints;

        // Zones
        const totalZone = leftZoneAtks + rightZoneAtks;
        let pctL = 0, pctR = 0;
        if (totalZone > 0) {
            pctL = (leftZoneAtks / totalZone) * 100;
            pctR = (rightZoneAtks / totalZone) * 100;
        }

        document.getElementById('dash-zone-l').style.width = `${pctL}%`;
        document.getElementById('dash-zone-l-val').innerText = `${pctL.toFixed(0)}%`;

        document.getElementById('dash-zone-r').style.width = `${pctR}%`;
        document.getElementById('dash-zone-r-val').innerText = `${pctR.toFixed(0)}%`;

        playerDashboard.classList.remove('hidden');
    }
});
