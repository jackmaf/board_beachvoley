document.addEventListener('DOMContentLoaded', () => {
    // State
    let state = {
        config: null,
        sets: [
            { scoreA: 0, scoreB: 0, timeoutsA: 0, timeoutsB: 0 } // index 0 = Set 1
        ],
        currentSetIndex: 0,
        points: [], // { equipo, jugadorId, tipoAccion, coordenadas: {x, y}, marcadorMomento, timestamp, setNumber, matchSecond }
        currentPendingPoint: null,
        matchStartTime: null, // Legacy real-world start time
        matchTimeSeconds: 0,  // Official stopwatch time in seconds
        isTimerRunning: false
    };

    // DOM Elements - Timer
    const uiBogotaClock = document.getElementById('bogota-clock');
    const uiMatchStopwatch = document.getElementById('match-stopwatch');
    const btnTimerPlay = document.getElementById('btn-timer-play');
    const btnTimerPause = document.getElementById('btn-timer-pause');

    let timerInterval = null;
    let clockInterval = null;

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
    const btnResetDb = document.getElementById('btn-reset-db');

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
    const btnTimeoutA = document.getElementById('btn-timeout-a');
    const btnTimeoutB = document.getElementById('btn-timeout-b');
    const toCountA = document.getElementById('to-count-a');
    const toCountB = document.getElementById('to-count-b');

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
    const btnExportPdf = document.getElementById('btn-export-pdf');
    const btnExportCsv = document.getElementById('btn-export-csv');
    const btnExportJson = document.getElementById('btn-export-json');

    // Filter state
    let activeFilters = {
        player: 'all', // 'all', 'A1', 'A2', 'B1', 'B2'
        action: 'all', // 'all', 'punto', 'error'
        maxTimePct: 100 // 0 to 100
    };

    // Keep track of current dashboard data for exports
    let currentDashData = null;

    let currentMarker = null;

    // Timeline Animation state
    let timelineInterval = null;
    const btnPlayTimeline = document.getElementById('btn-play-timeline');

    // Theme initialization
    const savedTheme = localStorage.getItem('voley-theme') || 'classic';
    document.body.setAttribute('data-theme', savedTheme);
    const themeRadios = document.querySelectorAll('.theme-options input[name="appTheme"]');
    themeRadios.forEach(r => {
        if (r.value === savedTheme) r.checked = true;
        r.addEventListener('change', (e) => {
            document.body.setAttribute('data-theme', e.target.value);
            localStorage.setItem('voley-theme', e.target.value);
        });
    });

    // --- CLOCK AND TIMER LOGIC ---
    function updateBogotaClock() {
        if (!uiBogotaClock) return;
        const now = new Date();
        const options = { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
        const timeString = new Intl.DateTimeFormat('es-CO', options).format(now);
        uiBogotaClock.innerText = `${timeString} (Bogotá)`;
    }

    function updateStopwatchUI() {
        if (!uiMatchStopwatch) return;
        const m = Math.floor(state.matchTimeSeconds / 60).toString().padStart(2, '0');
        const s = (state.matchTimeSeconds % 60).toString().padStart(2, '0');
        uiMatchStopwatch.innerText = `${m}:${s}`;

        btnTimerPlay.disabled = state.isTimerRunning;
        btnTimerPause.disabled = !state.isTimerRunning;
    }

    function toggleTimer(running) {
        state.isTimerRunning = running;
        if (running) {
            timerInterval = setInterval(() => {
                state.matchTimeSeconds++;
                updateStopwatchUI();
            }, 1000);
        } else {
            clearInterval(timerInterval);
        }
        updateStopwatchUI();
    }

    btnTimerPlay?.addEventListener('click', () => toggleTimer(true));
    btnTimerPause?.addEventListener('click', () => toggleTimer(false));

    // Start Real time clock once
    clockInterval = setInterval(updateBogotaClock, 1000);
    updateBogotaClock();

    // Setup navigation load
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
        activeFilters = { player: 'all', action: 'all', maxTimePct: 100, set: 'all' };
        document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
        document.querySelector('#filter-players [data-filter="all"]').classList.add('active');
        document.querySelector('#filter-actions [data-filter="all"]').classList.add('active');

        filterTimeline.value = 100;
        timelineVal.innerText = "Todo el partido";

        if (state.config) {
            generateSetFilters();
        }
    }

    function generateSetFilters() {
        const container = document.getElementById('filter-sets');
        if (!container) return;

        container.innerHTML = `<button class="filter-pill active" data-filter="all">Todos los Sets</button>`;

        const maxSets = state.config.maxSets || 3;
        // Solo mostrar selector si hay mas de 1 set
        document.getElementById('filter-sets-container').style.display = maxSets > 1 ? 'flex' : 'none';

        if (maxSets > 1) {
            for (let i = 1; i <= maxSets; i++) {
                container.innerHTML += `<button class="filter-pill" data-filter="${i}">Set ${i}</button>`;
            }
        }

        // Attach events to new buttons
        const setBtns = container.querySelectorAll('.filter-pill');
        setBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                setBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                activeFilters.set = btn.getAttribute('data-filter') === 'all' ? 'all' : parseInt(btn.getAttribute('data-filter'));
                renderStatistics();
            });
        });
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

    // --- TIMELINE ANIMATION LOGIC ---
    btnPlayTimeline.addEventListener('click', () => {
        if (timelineInterval) {
            // Stop playing
            clearInterval(timelineInterval);
            timelineInterval = null;
            btnPlayTimeline.innerHTML = '▶️ Play';
            btnPlayTimeline.classList.remove('playing');
        } else {
            // Start playing
            const slider = document.getElementById('filter-timeline');
            if (parseInt(slider.value) >= 100) {
                slider.value = 0;
                activeFilters.maxTimePct = 0;
                document.getElementById('timeline-val').innerText = '0%';
                renderStatistics();
            }

            btnPlayTimeline.innerHTML = '⏸️ Pausa';
            btnPlayTimeline.classList.add('playing');

            timelineInterval = setInterval(() => {
                let currentVal = parseInt(slider.value);

                if (currentVal >= 100) {
                    // Loop back to 0
                    currentVal = 0;
                } else {
                    currentVal += 10;
                }

                slider.value = currentVal;
                activeFilters.maxTimePct = currentVal;
                document.getElementById('timeline-val').innerText = currentVal === 100 ? 'Todo el partido' : `Hasta el ${currentVal}%`;

                // Force UI update on slider handle natively
                slider.dispatchEvent(new Event('input', { bubbles: true }));

                renderStatistics();
            }, 800);
        }
    });

    // Close Modal
    closeDashboardBtn.addEventListener('click', () => {
        playerDashboard.classList.add('hidden');
    });

    // Exports
    btnExportCsv.addEventListener('click', exportToCSV);
    btnExportJson.addEventListener('click', exportToJSON);
    btnExportPdf.addEventListener('click', exportToPDF);

    navConfig.addEventListener('click', () => setView('vista-configuracion'));
    navRegistro.addEventListener('click', () => setView('vista-registro'));
    navEstadisticas.addEventListener('click', () => setView('vista-estadisticas'));

    // Form submit starts match
    // --- RESET DATABASE LOGIC ---
    btnResetDb?.addEventListener('click', () => {
        const confirm1 = confirm("🚨 ATENCIÓN 🚨\n\nEstás a punto de borrar TODO el historial de partidos, jugadores y datos guardados en este dispositivo.\n\n¿Estás seguro de que deseas proceder?");
        if (confirm1) {
            const confirm2 = confirm("⚠️ ÚLTIMA ADVERTENCIA ⚠️\n\nEsta acción NO se puede deshacer. ¿Borrar absolutamente todo el progreso?");
            if (confirm2) {
                // Wipe local storage keys (keeping the theme intact if desired, but we wipe the gameplay data)
                localStorage.removeItem('voley-currentMatch');
                localStorage.removeItem('voley-lastMatch');
                localStorage.removeItem('voley-history');

                // Reload app to pristine state
                window.location.reload();
            }
        }
    });

    configForm.addEventListener('submit', (e) => {
        e.preventDefault();

        state.config = {
            teamA: document.getElementById('input-team-a').value.trim() || 'Equipo A',
            teamB: document.getElementById('input-team-b').value.trim() || 'Equipo B',
            pA1: document.getElementById('input-a1').value.trim() || 'A1',
            pA2: document.getElementById('input-a2').value.trim() || 'A2',
            pB1: document.getElementById('input-b1').value.trim() || 'B1',
            pB2: document.getElementById('input-b2').value.trim() || 'B2',
            maxSets: parseInt(document.getElementById('input-max-sets').value) || 3,
            ptsNormal: parseInt(document.getElementById('input-pts-normal').value) || 21,
            ptsTiebreak: parseInt(document.getElementById('input-pts-tiebreak').value) || 15
        };

        // Reset match data if it's a new match start
        if (state.points.length === 0) {
            state.sets = [{ scoreA: 0, scoreB: 0, timeoutsA: 0, timeoutsB: 0 }];
            state.currentSetIndex = 0;
            state.matchStartTime = null;
            state.matchTimeSeconds = 0;
            toggleTimer(false); // Make sure it's stopped initially
        } else {
            // Re-bind timer if reloading an active match
            if (state.isTimerRunning) {
                toggleTimer(true);
            } else {
                updateStopwatchUI();
            }
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

        // Timeout Buttons
        document.getElementById('btn-timeout-a').innerHTML = `⏱️ T. ${state.config.teamA} <span id="to-count-a">(0/1)</span>`;
        document.getElementById('btn-timeout-b').innerHTML = `⏱️ T. ${state.config.teamB} <span id="to-count-b">(0/1)</span>`;
        document.getElementById('set-name-a').innerText = state.config.teamA;
        document.getElementById('set-name-b').innerText = state.config.teamB;

        // Pre-fill config form if revisiting
        document.getElementById('input-team-a').value = state.config.teamA;
        document.getElementById('input-team-b').value = state.config.teamB;
        document.getElementById('input-a1').value = state.config.pA1;
        document.getElementById('input-a2').value = state.config.pA2;
        document.getElementById('input-b1').value = state.config.pB1;
        document.getElementById('input-b2').value = state.config.pB2;

        document.getElementById('input-max-sets').value = state.config.maxSets || 3;
        document.getElementById('input-pts-normal').value = state.config.ptsNormal || 21;
        document.getElementById('input-pts-tiebreak').value = state.config.ptsTiebreak || 15;

        // Setup Set boxes based on maxSets
        const maxSets = state.config.maxSets || 3;
        const boxesA = document.getElementById('set-boxes-a');
        const boxesB = document.getElementById('set-boxes-b');
        boxesA.innerHTML = '';
        boxesB.innerHTML = '';

        for (let i = 1; i <= maxSets; i++) {
            boxesA.innerHTML += `<div class="set-box" id="box-a-s${i}"></div>`;
            boxesB.innerHTML += `<div class="set-box" id="box-b-s${i}"></div>`;
        }

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

    // Timeouts
    btnTimeoutA.addEventListener('click', () => registerTimeout('A'));
    btnTimeoutB.addEventListener('click', () => registerTimeout('B'));

    function registerTimeout(team) {
        if (!state.config) return;

        // Auto pause the official stopwatch
        if (state.isTimerRunning) {
            toggleTimer(false);
        }

        const currentSet = state.sets[state.currentSetIndex];
        const maxTimeouts = 1;

        if (team === 'A' && currentSet.timeoutsA < maxTimeouts) {
            currentSet.timeoutsA++;
            // Add to log (fake coordinates since it's a timeout)
            state.points.push({
                pointNumber: state.points.length + 1, // This will be adjusted by renderStatistics for non-timeout points
                equipo: team,
                jugadorId: `Eq.${team}`,
                tipoAccion: 'timeout',
                coordenadas: { x: 50, y: 50 }, // middle of court conceptually
                marcadorMomento: `${currentSet.scoreA}-${currentSet.scoreB}`,
                timestamp: Date.now(),
                setNumber: state.currentSetIndex + 1,
                matchSecond: state.matchTimeSeconds
            });
        } else if (team === 'B' && currentSet.timeoutsB < maxTimeouts) {
            currentSet.timeoutsB++;
            // Add to log (fake coordinates since it's a timeout)
            state.points.push({
                pointNumber: state.points.length + 1, // This will be adjusted by renderStatistics for non-timeout points
                equipo: team,
                jugadorId: `Eq.${team}`,
                tipoAccion: 'timeout',
                coordenadas: { x: 50, y: 50 }, // middle of court conceptually
                marcadorMomento: `${currentSet.scoreA}-${currentSet.scoreB}`,
                timestamp: Date.now(),
                setNumber: state.currentSetIndex + 1,
                matchSecond: state.matchTimeSeconds
            });
        } else {
            alert(`El Equipo ${team} ya no tiene tiempos muertos en este set.`);
        }
        saveState();
        updateScoreUI();
    }

    btnEndMatch.addEventListener('click', () => {
        if (confirm('¿Estás seguro de terminar el partido? Esto lo guardará en el historial.')) {
            let history = JSON.parse(localStorage.getItem('voley-history')) || [];
            if (state.points.length > 0) {
                history.push(state);
                localStorage.setItem('voley-history', JSON.stringify(history));
                localStorage.setItem('voley-lastMatch', JSON.stringify(state));
            }

            setView('vista-estadisticas');

            // Reset current state
            state = {
                config: null,
                sets: [{ scoreA: 0, scoreB: 0, timeoutsA: 0, timeoutsB: 0 }],
                currentSetIndex: 0,
                points: [],
                currentPendingPoint: null,
                matchStartTime: null,
                matchTimeSeconds: 0,
                isTimerRunning: false
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
        const curSet = state.sets[state.currentSetIndex];

        let pointGoesTo = team;
        if (actionType === 'error') {
            pointGoesTo = team === 'A' ? 'B' : 'A';
        }

        if (pointGoesTo === 'A') curSet.scoreA++;
        else curSet.scoreB++;

        const pointData = {
            equipo: team,
            jugadorId: playerId,
            tipoAccion: actionType,
            coordenadas: { ...state.currentPendingPoint },
            marcadorMomento: `${state.sets[state.currentSetIndex].scoreA}-${state.sets[state.currentSetIndex].scoreB}`,
            timestamp: Date.now(),
            setNumber: state.currentSetIndex + 1,
            matchSecond: state.matchTimeSeconds, // Capturing exact official time of action
            pointNumber: state.points.filter(p => p.tipoAccion !== 'timeout').length + 1
        };

        state.points.push(pointData);
        checkSetWinner();
        saveState();
        updateScoreUI();
        closePlayerMenu();
    }

    function checkSetWinner() {
        const curSet = state.sets[state.currentSetIndex];
        const maxSets = state.config.maxSets || 3;
        const ptsNormal = state.config.ptsNormal || 21;
        const ptsTiebreak = state.config.ptsTiebreak || 15;

        let isTiebreak = (state.currentSetIndex === maxSets - 1);
        const winThreshold = isTiebreak ? ptsTiebreak : ptsNormal;

        if ((curSet.scoreA >= winThreshold || curSet.scoreB >= winThreshold) &&
            Math.abs(curSet.scoreA - curSet.scoreB) >= 2) {

            // Set Won!
            const winner = curSet.scoreA > curSet.scoreB ? state.config.teamA : state.config.teamB;

            // Calculate total sets won
            let winsA = 0; let winsB = 0;
            state.sets.forEach((s, idx) => {
                const threshold = (idx === maxSets - 1) ? ptsTiebreak : ptsNormal;
                if ((s.scoreA >= threshold || s.scoreB >= threshold) && Math.abs(s.scoreA - s.scoreB) >= 2) {
                    if (s.scoreA > s.scoreB) winsA++;
                    else if (s.scoreB > s.scoreA) winsB++;
                }
            });

            // Target wins
            const setsToWinMatch = Math.ceil(maxSets / 2);

            if (winsA >= setsToWinMatch || winsB >= setsToWinMatch) {
                alert(`¡${winner} ha ganado el partido! Puedes finalizarlo ahora.`);
            } else if (state.currentSetIndex < maxSets - 1) { // Match isn't over and there are sets left
                alert(`¡${winner} ha ganado el Set ${state.currentSetIndex + 1}! Iniciando siguiente Set...`);
                state.sets.push({ scoreA: 0, scoreB: 0, timeoutsA: 0, timeoutsB: 0 });
                state.currentSetIndex++;
            }
        }
    }

    function closePlayerMenu() {
        if (currentMarker) currentMarker.remove();
        playerMenu.classList.add('hidden');
        state.currentPendingPoint = null;
    }

    function updateScoreUI() {
        const curSet = state.sets[state.currentSetIndex];
        uiScoreA.innerText = curSet.scoreA;
        uiScoreB.innerText = curSet.scoreB;

        // Update Timeout status
        const btnTimeoutA = document.getElementById('btn-timeout-a');
        const btnTimeoutB = document.getElementById('btn-timeout-b');

        document.getElementById('to-count-a').innerText = `(${curSet.timeoutsA}/1)`;
        document.getElementById('to-count-b').innerText = `(${curSet.timeoutsB}/1)`;

        btnTimeoutA.disabled = curSet.timeoutsA >= 1;
        btnTimeoutB.disabled = curSet.timeoutsB >= 1;

        // Update sets visual tracker
        let winsA = 0; let winsB = 0;
        const maxSets = state.config.maxSets || 3;
        const ptsNormal = state.config.ptsNormal || 21;
        const ptsTiebreak = state.config.ptsTiebreak || 15;

        state.sets.forEach((s, i) => {
            if (s.scoreA === 0 && s.scoreB === 0) return; // Unplayed

            const winThreshold = i === (maxSets - 1) ? ptsTiebreak : ptsNormal;
            if ((s.scoreA >= winThreshold || s.scoreB >= winThreshold) && Math.abs(s.scoreA - s.scoreB) >= 2) {
                if (s.scoreA > s.scoreB) {
                    winsA++;
                    const boxA = document.getElementById(`box-a-s${i + 1}`);
                    if (boxA) boxA.classList.add('won-a');
                } else {
                    winsB++;
                    const boxB = document.getElementById(`box-b-s${i + 1}`);
                    if (boxB) boxB.classList.add('won-b');
                }
            }
        });
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

        // Apply Set Filter strictly FIRST to both Summary and Visuals
        let pointsBySet = pointsInTime;
        if (activeFilters.set && activeFilters.set !== 'all') {
            pointsBySet = pointsInTime.filter(p => p.setNumber === activeFilters.set);
        }

        // Calculate score at the chosen time for the chosen Set(s)
        let tempScoreA = 0; let tempScoreB = 0;
        pointsBySet.forEach(p => {
            let pointGoesTo = p.equipo;
            if (p.tipoAccion === 'error') pointGoesTo = p.equipo === 'A' ? 'B' : 'A';
            if (pointGoesTo === 'A') tempScoreA++; else tempScoreB++;
        });

        uiFinalScore.innerText = activeFilters.set !== 'all'
            ? `${teamNameA} ${tempScoreA} - ${tempScoreB} ${teamNameB} (S${activeFilters.set})`
            : `${teamNameA} ${tempScoreA} - ${tempScoreB} ${teamNameB}`;

        uiTotalPoints.innerText = pointsBySet.length;

        // Custom duration logic based on set
        let matchSeconds = 0;
        if (pointsBySet.length > 0) {
            // Find max matchSecond recorded in the filtered view
            const maxSec = Math.max(...pointsBySet.map(p => p.matchSecond || 0));
            const minSec = Math.min(...pointsBySet.map(p => p.matchSecond || 0));
            matchSeconds = maxSec - minSec;
        } else if (activeFilters.set === 'all') {
            matchSeconds = statsState.matchTimeSeconds || 0;
        }

        const minutes = Math.floor(matchSeconds / 60);
        const seconds = matchSeconds % 60;
        uiMatchDuration.innerText = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

        // Player Breakdown & Heatmap
        const playerStats = {
            'A1': { pts: 0, errs: 0, name: statsState.config.pA1 },
            'A2': { pts: 0, errs: 0, name: statsState.config.pA2 },
            'B1': { pts: 0, errs: 0, name: statsState.config.pB1 },
            'B2': { pts: 0, errs: 0, name: statsState.config.pB2 }
        };

        heatmapPoints.innerHTML = '';

        // Filter points for visuals
        let filteredPoints = pointsBySet.filter(p => {
            if (p.tipoAccion === 'timeout') return false; // Ignore timeouts for heatmap and stats
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

        // Tracker for Best Minute (points per minute)
        const pointsPerMinute = {};

        // Track points for detailed log
        let detailedLog = [];
        const tbody = document.getElementById('dash-table-body');
        tbody.innerHTML = '';

        allPointsInTime.forEach(p => {
            // Include timeouts for the logged player/team if requested, but mainly filter by player logic
            if (p.jugadorId !== playerId && !(p.tipoAccion === 'timeout' && p.equipo === myTeam)) return;

            const isTimeout = (p.tipoAccion === 'timeout');

            let realX = "-";
            let realY = "-";

            if (!isTimeout) {
                // Real court logic (0-100% width = 8m, 0-100% height = 16m total but half is 8m)
                realX = ((p.coordenadas.x / 100) * 8).toFixed(2);
                realY = ((p.coordenadas.y / 100) * 16).toFixed(2);

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

                // Analyze Best Minute
                if (p.tipoAccion === 'punto') {
                    // matchSecond / 60 = official minute zero-indexed
                    const officialMinute = Math.floor((p.matchSecond || 0) / 60) + 1; // +1 to say "Minute 1", "Minute 2"
                    pointsPerMinute[officialMinute] = (pointsPerMinute[officialMinute] || 0) + 1;
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
            }

            // Build detailed log
            const isPoint = p.tipoAccion === 'punto';
            let actionLabel = isTimeout ? 'TIEMPO MUERTO' : (isPoint ? 'Punto Ganador' : 'Error');

            detailedLog.push({
                punto_nro: p.pointNumber,
                set_nro: p.setNumber || 1,
                accion: actionLabel,
                marcador: p.marcadorMomento,
                x_metros: String(realX),
                y_metros: String(realY)
            });

            // Populate HTML Table for PDF
            const tr = document.createElement('tr');
            if (isTimeout) tr.style.backgroundColor = 'rgba(0,0,0,0.05)';

            tr.innerHTML = `
                <td>#${p.pointNumber} (Set ${p.setNumber || 1})</td>
                <td class="${isTimeout ? '' : (isPoint ? 'log-pts' : 'log-err')}">${actionLabel}</td>
                <td>${p.marcadorMomento}</td>
                <td>${realX !== "-" ? realX + 'm' : '-'}</td>
                <td>${realY !== "-" ? realY + 'm' : '-'}</td>
            `;
            tbody.appendChild(tr);
        });

        const totalActions = playerPts + playerErrs;

        // Net Efficiency
        let efficiency = 0;
        if (totalActions > 0) {
            efficiency = ((playerPts - playerErrs) / totalActions) * 100;
        }
        document.getElementById('dash-eff').innerText = `${efficiency.toFixed(1)}%`;
        document.getElementById('dash-eff').style.color = efficiency < 0 ? '#e84118' : 'var(--primary)';

        // Calculate Best Minute string
        let bestMinText = "--";
        let bestMinVal = 0;
        let bestMinCount = 0;

        Object.keys(pointsPerMinute).forEach(minute => {
            if (pointsPerMinute[minute] > bestMinCount) {
                bestMinCount = pointsPerMinute[minute];
                bestMinVal = minute;
            }
        });

        if (bestMinCount > 0) {
            bestMinText = `${bestMinVal} (${bestMinCount} pts)`;
        }
        document.getElementById('dash-best-minute').innerText = bestMinText === "--" ? "Ninguno aún" : `Minuto ${bestMinText}`;

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

        let activeSetFilterText = activeFilters.set === 'all' ? 'All' : `Set_${activeFilters.set}`;

        // Save data for exports
        currentDashData = {
            playerName, playerId, team: myTeam, nameTeamA, nameTeamB,
            playerPts, playerErrs, clutchPoints, efficiency, leftZoneAtks, rightZoneAtks, pctL, pctR,
            bitacora_acciones: detailedLog,
            activeSetFilterText,
            bestMinute: bestMinText
        };

        playerDashboard.classList.remove('hidden');
    }

    // EXPORT FUNCTIONS
    function exportToJSON() {
        if (!currentDashData) return;
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentDashData, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", `VoleyPlaya_Scouting_${currentDashData.playerName.replace(/\s+/g, '_')}.json`);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    }

    function exportToCSV() {
        if (!currentDashData) return;
        const d = currentDashData;

        // Tabla 1: Resumen
        let csvContent = "data:text/csv;charset=utf-8,"
            + "--- RESUMEN DEL JUGADOR ---\n"
            + "Metrica,Valor\n"
            + `Jugador,${d.playerName} (${d.playerId})\n`
            + `Eficiencia Neta (%),${d.efficiency.toFixed(1)}\n`
            + `Puntos Ganadores,${d.playerPts}\n`
            + `Errores,${d.playerErrs}\n`
            + `Puntos Clutch,${d.clutchPoints}\n`
            + `Ataques Zona Izquierda (%),${d.pctL.toFixed(1)}\n`
            + `Ataques Zona Derecha (%),${d.pctR.toFixed(1)}\n\n`;

        // Tabla 2: Bitacora
        csvContent += "--- BITACORA DE ACCIONES (Orden Cronologico) ---\n";
        csvContent += "Nro. Punto,Set,Accion,Marcador,Coord X (m),Coord Y (m)\n";

        d.bitacora_acciones.forEach(act => {
            csvContent += `${act.punto_nro},${act.set_nro},${act.accion},${act.marcador},${act.x_metros},${act.y_metros}\n`;
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `VoleyPlaya_Scouting_${d.playerName.replace(/\s+/g, '_')}_${d.activeSetFilterText}.csv`);
        document.body.appendChild(link);
        link.click();
        link.remove();
    }

    function exportToPDF() {
        if (!currentDashData) return;

        // Hide UI elements naturally via CSS during print process
        const element = document.querySelector('.dashboard-content');

        // Temporarily change background so the PDF isn't transparent/dark
        // And remove any dark-theme rules by temporarily overriding the body theme just for printing
        const originalBodyTheme = document.body.getAttribute('data-theme');
        if (originalBodyTheme === 'dark') {
            document.body.setAttribute('data-theme', 'classic'); // Force light background for PDF
        }

        const originalBg = element.style.background;
        element.style.background = '#F6F6F6'; // var(--light)
        element.classList.add('html2pdf__container'); // Apply print styles

        const opt = {
            margin: 10,
            filename: `VoleyPlaya_Scouting_${currentDashData.playerName.replace(/\s+/g, '_')}_${currentDashData.activeSetFilterText}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, backgroundColor: '#F6F6F6', windowWidth: 800, scrollY: 0 },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        // If html2pdf is loaded, execute promise
        if (window.html2pdf) {
            btnExportPdf.innerText = "Exportando...";
            html2pdf().set(opt).from(element).save().then(() => {
                element.style.background = originalBg;
                element.classList.remove('html2pdf__container');
                document.body.setAttribute('data-theme', originalBodyTheme); // Restore original theme
                btnExportPdf.innerText = "📄 PDF";
            });
        } else {
            alert("La librería de PDF no pudo cargar. Comprueba tu conexión a internet.");
            element.style.background = originalBg;
            element.classList.remove('html2pdf__container');
            document.body.setAttribute('data-theme', originalBodyTheme); // Restore
        }
    }
});
