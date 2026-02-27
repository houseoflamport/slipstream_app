// ── SLIPSTREAM app.js ──────────────────────────────────────────────────────
// Story 1: GPX import and parsing
// Story 2: Name and share a run
// Story 3: Load a ghost run
// Story 4: Race the ghost
// Story 5: End of run summary + export

// ── STATE ──────────────────────────────────────────────────────────────────
const state = {
  ghostRun: null,       // parsed ghost run data
  activeRun: null,      // current user run in progress
  isPaused: false,
  runInterval: null,
  locationWatch: null,
  startTime: null,
  positions: [],        // user's recorded positions during run
  gapHistory: [],       // ahead/behind log throughout run
};

// ── SCREEN NAVIGATION ──────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── GPX PARSING ────────────────────────────────────────────────────────────
function parseGPX(text) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, 'application/xml');

  const parseError = xml.querySelector('parsererror');
  if (parseError) throw new Error('Invalid GPX file — could not be read.');

  const trkpts = xml.querySelectorAll('trkpt');
  if (trkpts.length === 0) throw new Error('No track points found in this GPX file.');

  const points = [];
  let hasTime = false;

  trkpts.forEach(pt => {
    const lat = parseFloat(pt.getAttribute('lat'));
    const lon = parseFloat(pt.getAttribute('lon'));
    const timeEl = pt.querySelector('time');
    const time = timeEl ? new Date(timeEl.textContent).getTime() : null;
    if (time) hasTime = true;

    // Cadence — Garmin extension
    let cadence = null;
    const cad = pt.querySelector('cad') ||
                pt.querySelector('RunCadence') ||
                pt.querySelector('cadence');
    if (cad) cadence = parseInt(cad.textContent);

    points.push({ lat, lon, time, cadence });
  });

  if (!hasTime) throw new Error('This GPX file has no timing data. Slipstream needs timestamped runs to create a ghost.');

  // Calculate pace and distance between points
  const processed = [];
  let totalDistance = 0;

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    if (i === 0) {
      processed.push({ ...pt, distance: 0, totalDistance: 0, pace: null });
      continue;
    }
    const prev = points[i - 1];
    const dist = haversine(prev.lat, prev.lon, pt.lat, pt.lon);
    const timeDiff = (pt.time - prev.time) / 1000; // seconds
    totalDistance += dist;

    let pace = null;
    if (dist > 0 && timeDiff > 0) {
      pace = timeDiff / dist; // seconds per metre
    }

    processed.push({ ...pt, distance: dist, totalDistance, pace });
  }

  const totalTime = (points[points.length - 1].time - points[0].time) / 1000;
  const avgPace = totalDistance > 0 ? totalTime / totalDistance : 0;
  const hasCadence = points.some(p => p.cadence !== null);

  return {
    points: processed,
    totalDistance,          // metres
    totalTime,              // seconds
    avgPace,                // seconds per metre
    startTime: points[0].time,
    hasCadence,
    name: '',
  };
}

// ── HAVERSINE DISTANCE ─────────────────────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000; // metres
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ/2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── FORMAT HELPERS ─────────────────────────────────────────────────────────
function formatPace(secondsPerMetre) {
  if (!secondsPerMetre || secondsPerMetre <= 0) return '--:--';
  const secPerKm = secondsPerMetre * 1000;
  const mins = Math.floor(secPerKm / 60);
  const secs = Math.round(secPerKm % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60).toString().padStart(2, '0');
  if (h > 0) return `${h}:${m.toString().padStart(2,'0')}:${s}`;
  return `${m}:${s}`;
}

function formatDistance(metres) {
  return (metres / 1000).toFixed(2);
}

// ── GHOST POSITION AT ELAPSED TIME ────────────────────────────────────────
// Returns how far the ghost has run (in metres) at a given elapsed time (seconds)
function ghostDistanceAtTime(ghostRun, elapsedSeconds) {
  const ghostElapsed = elapsedSeconds;
  const points = ghostRun.points;

  for (let i = 1; i < points.length; i++) {
    const ptTime = (points[i].time - points[0].time) / 1000;
    if (ptTime >= ghostElapsed) {
      return points[i].totalDistance;
    }
  }
  // Ghost has finished
  return ghostRun.totalDistance;
}

// ── GAP CALCULATION ────────────────────────────────────────────────────────
// Returns gap in seconds: positive = ghost ahead, negative = user ahead
function calculateGap(userDistance, ghostRun, elapsedSeconds) {
  const ghostDist = ghostDistanceAtTime(ghostRun, elapsedSeconds);
  const distanceDiff = ghostDist - userDistance; // positive = ghost ahead

  // Convert distance difference to time using ghost avg pace
  const gapSeconds = distanceDiff * ghostRun.avgPace;
  return Math.round(gapSeconds);
}

// ── RENDER GHOST CARD ──────────────────────────────────────────────────────
function renderGhostCard(run, containerId) {
  const el = document.getElementById(containerId);
  el.innerHTML = `
    <div class="result-row">
      <span class="result-label">Name</span>
      <span class="result-value">${run.name || 'Unnamed Run'}</span>
    </div>
    <div class="result-row">
      <span class="result-label">Distance</span>
      <span class="result-value">${formatDistance(run.totalDistance)} km</span>
    </div>
    <div class="result-row">
      <span class="result-label">Time</span>
      <span class="result-value">${formatTime(run.totalTime)}</span>
    </div>
    <div class="result-row">
      <span class="result-label">Avg Pace</span>
      <span class="result-value">${formatPace(run.avgPace)} /km</span>
    </div>
    ${run.hasCadence ? '<div class="result-row"><span class="result-label">Cadence</span><span class="result-value">✓ Available</span></div>' : ''}
  `;
}

// ── UPDATE RUN SCREEN STATE ────────────────────────────────────────────────
function updateRunState(gapSeconds) {
  const figureArea = document.getElementById('figure-area');
  const gapTop = document.getElementById('gap-top');
  const gapBottom = document.getElementById('gap-bottom');
  const distTop = document.getElementById('dist-top');
  const distBottom = document.getElementById('dist-bottom');
  const subTop = document.getElementById('sub-top');
  const statusLine = document.getElementById('status-line');
  const arrowTop = document.getElementById('arrow-top');
  const arrowBottom = document.getElementById('arrow-bottom');

  const LOCKED_THRESHOLD = 5; // seconds

  if (Math.abs(gapSeconds) <= LOCKED_THRESHOLD) {
    // LOCKED IN
    figureArea.className = 'figure-area state-locked';
    gapTop.classList.remove('hidden');
    gapBottom.classList.add('hidden');
    arrowTop.style.color = 'var(--locked)';
    arrowTop.style.filter = 'drop-shadow(0 0 5px var(--locked))';
    distTop.style.color = 'var(--locked)';
    distTop.style.textShadow = '0 0 16px var(--locked)';
    distTop.textContent = `±${Math.abs(gapSeconds)}s`;
    subTop.style.color = 'var(--locked)';
    subTop.textContent = 'locked in';
    statusLine.style.color = 'var(--locked)';
    statusLine.textContent = 'Locked In';

  } else if (gapSeconds > 0) {
    // BEHIND — ghost is ahead
    figureArea.className = 'figure-area state-behind';
    gapTop.classList.remove('hidden');
    gapBottom.classList.add('hidden');
    arrowTop.style.color = 'var(--behind)';
    arrowTop.style.filter = 'drop-shadow(0 0 5px var(--behind))';
    distTop.style.color = 'var(--behind)';
    distTop.style.textShadow = '0 0 16px var(--behind)';
    distTop.textContent = `+${gapSeconds}s`;
    subTop.style.color = 'var(--behind)';
    subTop.textContent = 'ghost ahead';
    statusLine.style.color = 'var(--behind)';
    statusLine.textContent = 'Behind Ghost';

  } else {
    // AHEAD — user is winning
    figureArea.className = 'figure-area state-ahead';
    gapTop.classList.add('hidden');
    gapBottom.classList.remove('hidden');
    arrowBottom.style.color = 'var(--ahead)';
    arrowBottom.style.filter = 'drop-shadow(0 0 5px var(--ahead))';
    distBottom.style.color = 'var(--ahead)';
    distBottom.style.textShadow = '0 0 16px var(--ahead)';
    distBottom.textContent = `−${Math.abs(gapSeconds)}s`;
    document.getElementById('sub-bottom').style.color = 'var(--ahead)';
    document.getElementById('sub-bottom').textContent = "you're ahead";
    statusLine.style.color = 'var(--ahead)';
    statusLine.textContent = 'Ahead of Ghost';
  }
}

// ── COUNTDOWN ─────────────────────────────────────────────────────────────
function startCountdown(callback) {
  const overlay = document.getElementById('countdown-overlay');
  const number = document.getElementById('countdown-number');
  overlay.classList.remove('hidden');
  let count = 5;
  number.textContent = count;

  const interval = setInterval(() => {
    count--;
    if (count <= 0) {
      clearInterval(interval);
      overlay.classList.add('hidden');
      callback();
    } else {
      number.textContent = count;
    }
  }, 1000);
}

// ── START RUN ──────────────────────────────────────────────────────────────
function startRun() {
  state.startTime = Date.now();
  state.positions = [];
  state.gapHistory = [];
  state.isPaused = false;

  // Set ghost ref pace display
  document.getElementById('ghost-ref-pace').textContent =
    formatPace(state.ghostRun.avgPace) + ' /km';

  // Set ghost label
  document.getElementById('run-ghost-label').textContent =
    state.ghostRun.name || 'Ghost';

  // Start GPS tracking
  if ('geolocation' in navigator) {
    state.locationWatch = navigator.geolocation.watchPosition(
      pos => {
        if (!state.isPaused) {
          state.positions.push({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            time: Date.now(),
          });
        }
      },
      err => {
        console.warn('GPS error:', err.message);
      },
      { enableHighAccuracy: true, maximumAge: 0 }
    );
  }

  // Tick every second
  state.runInterval = setInterval(() => {
    if (state.isPaused) return;
    tick();
  }, 1000);
}

// ── TICK ───────────────────────────────────────────────────────────────────
function tick() {
  const elapsed = (Date.now() - state.startTime) / 1000;

  // Calculate user distance from GPS positions
  let userDistance = 0;
  for (let i = 1; i < state.positions.length; i++) {
    userDistance += haversine(
      state.positions[i-1].lat, state.positions[i-1].lon,
      state.positions[i].lat,   state.positions[i].lon
    );
  }

  // Current pace (last 30 seconds of movement)
  let currentPace = null;
  const now = Date.now();
  const recentPositions = state.positions.filter(p => now - p.time < 30000);
  if (recentPositions.length >= 2) {
    let recentDist = 0;
    for (let i = 1; i < recentPositions.length; i++) {
      recentDist += haversine(
        recentPositions[i-1].lat, recentPositions[i-1].lon,
        recentPositions[i].lat,   recentPositions[i].lon
      );
    }
    const recentTime = (recentPositions[recentPositions.length-1].time - recentPositions[0].time) / 1000;
    if (recentDist > 0) currentPace = recentTime / recentDist;
  }

  // Update stats display
  document.getElementById('stat-time').textContent = formatTime(elapsed);
  document.getElementById('stat-dist').textContent = formatDistance(userDistance);
  document.getElementById('stat-pace').textContent = formatPace(currentPace);

  // Calculate gap
  const gap = calculateGap(userDistance, state.ghostRun, elapsed);
  state.gapHistory.push({ elapsed, gap, userDistance });

  // Update visual state
  updateRunState(gap);

  // Check if ghost run has ended
  if (elapsed >= state.ghostRun.totalTime && userDistance >= state.ghostRun.totalDistance * 0.95) {
    endRun();
  }
}

// ── PAUSE / RESUME ─────────────────────────────────────────────────────────
function togglePause() {
  state.isPaused = !state.isPaused;
  const btn = document.getElementById('btn-pause');
  btn.textContent = state.isPaused ? '▶ Resume' : '⏸ Pause';
}

// ── END RUN ────────────────────────────────────────────────────────────────
function endRun() {
  clearInterval(state.runInterval);
  if (state.locationWatch) navigator.geolocation.clearWatch(state.locationWatch);

  const elapsed = (Date.now() - state.startTime) / 1000;
  let userDistance = 0;
  for (let i = 1; i < state.positions.length; i++) {
    userDistance += haversine(
      state.positions[i-1].lat, state.positions[i-1].lon,
      state.positions[i].lat,   state.positions[i].lon
    );
  }

  const userAvgPace = userDistance > 0 ? elapsed / userDistance : 0;
  const finalGap = calculateGap(userDistance, state.ghostRun, elapsed);

  state.activeRun = {
    totalTime: elapsed,
    totalDistance: userDistance,
    avgPace: userAvgPace,
    positions: state.positions,
    gapHistory: state.gapHistory,
    finalGap,
  };

  renderSummary();
  showScreen('screen-summary');
}

// ── RENDER SUMMARY ─────────────────────────────────────────────────────────
function renderSummary() {
  const run = state.activeRun;
  const ghost = state.ghostRun;
  const gap = run.finalGap;

  // Result banner
  const resultEl = document.getElementById('summary-result');
  if (Math.abs(gap) <= 5) {
    resultEl.style.color = 'var(--locked)';
    resultEl.textContent = 'Locked In';
  } else if (gap < 0) {
    resultEl.style.color = 'var(--ahead)';
    resultEl.textContent = 'You Won';
  } else {
    resultEl.style.color = 'var(--behind)';
    resultEl.textContent = 'Ghost Won';
  }

  // Stats grid
  const grid = document.getElementById('summary-grid');
  grid.innerHTML = `
    <div class="summary-row">
      <span class="summary-row-label"></span>
      <span class="summary-row-you" style="font-size:11px;letter-spacing:0.15em;color:var(--text-dim)">YOU</span>
      <span class="summary-row-ghost" style="font-size:11px;letter-spacing:0.15em">GHOST</span>
    </div>
    <div class="summary-row">
      <span class="summary-row-label">Time</span>
      <span class="summary-row-you">${formatTime(run.totalTime)}</span>
      <span class="summary-row-ghost">${formatTime(ghost.totalTime)}</span>
    </div>
    <div class="summary-row">
      <span class="summary-row-label">Pace</span>
      <span class="summary-row-you">${formatPace(run.avgPace)}</span>
      <span class="summary-row-ghost">${formatPace(ghost.avgPace)}</span>
    </div>
    <div class="summary-row">
      <span class="summary-row-label">Distance</span>
      <span class="summary-row-you">${formatDistance(run.totalDistance)} km</span>
      <span class="summary-row-ghost">${formatDistance(ghost.totalDistance)} km</span>
    </div>
  `;
}

// ── EXPORT RUN DATA ────────────────────────────────────────────────────────
function exportRunData() {
  const exportData = {
    exportedAt: new Date().toISOString(),
    app: 'Slipstream v1.0',
    ghost: {
      name: state.ghostRun.name || 'Unnamed Ghost',
      totalDistance: state.ghostRun.totalDistance,
      totalTime: state.ghostRun.totalTime,
      avgPace: state.ghostRun.avgPace,
      hasCadence: state.ghostRun.hasCadence,
    },
    yourRun: {
      totalDistance: state.activeRun.totalDistance,
      totalTime: state.activeRun.totalTime,
      avgPace: state.activeRun.avgPace,
      finalGap: state.activeRun.finalGap,
    },
    gapHistory: state.activeRun.gapHistory,
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `slipstream-run-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── SHARE RUN ──────────────────────────────────────────────────────────────
function shareRun(run) {
  // Encode run data as base64 in URL
  const data = {
    name: run.name || 'Ghost Run',
    totalDistance: run.totalDistance,
    totalTime: run.totalTime,
    avgPace: run.avgPace,
    hasCadence: run.hasCadence,
    // Include simplified point data (time offset + distance only, not full GPS)
    points: run.points.map(p => ({
      t: p.time - run.points[0].time, // ms from start
      d: Math.round(p.totalDistance), // metres
      c: p.cadence,
    })),
  };

  const encoded = btoa(JSON.stringify(data));
  const url = `${window.location.origin}${window.location.pathname}?ghost=${encoded}`;

  if (navigator.share) {
    navigator.share({
      title: `Run with ${run.name || 'my ghost'} on Slipstream`,
      text: `Can you keep up? ${formatDistance(run.totalDistance)}km at ${formatPace(run.avgPace)}/km`,
      url,
    });
  } else {
    navigator.clipboard.writeText(url).then(() => {
      alert('Link copied to clipboard!');
    });
  }
}

// ── LOAD GHOST FROM URL ────────────────────────────────────────────────────
function loadGhostFromURL() {
  const params = new URLSearchParams(window.location.search);
  const encoded = params.get('ghost');
  if (!encoded) return false;

  try {
    const data = JSON.parse(atob(encoded));
    // Reconstruct points with absolute times
    const baseTime = Date.now();
    data.points = data.points.map(p => ({
      time: baseTime + p.t,
      totalDistance: p.d,
      cadence: p.c,
      lat: null, lon: null, distance: 0, pace: null,
    }));
    state.ghostRun = data;
    saveGhostToStorage(data);
    return true;
  } catch (e) {
    console.error('Failed to load ghost from URL:', e);
    return false;
  }
}

// ── LOCAL STORAGE ──────────────────────────────────────────────────────────
function saveGhostToStorage(run) {
  try {
    localStorage.setItem('slipstream_ghost', JSON.stringify(run));
  } catch (e) {
    console.warn('Could not save to storage:', e);
  }
}

function loadGhostFromStorage() {
  try {
    const data = localStorage.getItem('slipstream_ghost');
    return data ? JSON.parse(data) : null;
  } catch (e) {
    return null;
  }
}

// ── EVENT LISTENERS ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Check for ghost run in URL first
  if (loadGhostFromURL()) {
    renderGhostCard(state.ghostRun, 'ghost-card');
    showScreen('screen-preview');
    return;
  }

  // Check for saved ghost in storage
  const saved = loadGhostFromStorage();
  if (saved) {
    state.ghostRun = saved;
  }

  // Home screen
  document.getElementById('btn-import').addEventListener('click', () => {
    showScreen('screen-import');
  });

  document.getElementById('btn-load').addEventListener('click', () => {
    if (state.ghostRun) {
      renderGhostCard(state.ghostRun, 'ghost-card');
      showScreen('screen-preview');
    } else {
      alert('No ghost run loaded yet. Import a run first, or open a shared ghost link.');
    }
  });

  // Back buttons
  document.getElementById('back-import').addEventListener('click', () => showScreen('screen-home'));
  document.getElementById('back-preview').addEventListener('click', () => showScreen('screen-home'));
  
  document.getElementById('file-drop').addEventListener('click', () => {
    document.getElementById('gpx-file-input').click();
});

  document.getElementById('gpx-file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;

    const errorEl = document.getElementById('import-error');
    const resultEl = document.getElementById('import-result');
    errorEl.classList.add('hidden');
    resultEl.classList.add('hidden');

    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const run = parseGPX(evt.target.result);
        state.ghostRun = run;
        saveGhostToStorage(run);

        // Show result
        resultEl.classList.remove('hidden');
        resultEl.innerHTML = `
          <div class="result-row">
            <span class="result-label">Distance</span>
            <span class="result-value">${formatDistance(run.totalDistance)} km</span>
          </div>
          <div class="result-row">
            <span class="result-label">Time</span>
            <span class="result-value">${formatTime(run.totalTime)}</span>
          </div>
          <div class="result-row">
            <span class="result-label">Avg Pace</span>
            <span class="result-value">${formatPace(run.avgPace)} /km</span>
          </div>
          ${run.hasCadence ? '<div class="result-row"><span class="result-label">Cadence</span><span class="result-value">✓ Detected</span></div>' : '<div class="result-row"><span class="result-label">Cadence</span><span class="result-value" style="color:var(--text-dim)">Not available</span></div>'}
        `;

        // After short delay go to preview
        setTimeout(() => {
          renderGhostCard(state.ghostRun, 'ghost-card');
          showScreen('screen-preview');
        }, 1500);

      } catch (err) {
        errorEl.classList.remove('hidden');
        errorEl.textContent = err.message;
      }
    };
    reader.readAsText(file);
  });

  // Preview screen — name input
  document.getElementById('run-name-input').addEventListener('input', e => {
    if (state.ghostRun) state.ghostRun.name = e.target.value;
  });

  // Start run
  document.getElementById('btn-start-run').addEventListener('click', () => {
    if (!state.ghostRun) return;
    showScreen('screen-run');
    startCountdown(() => startRun());
  });

  // Share run
  document.getElementById('btn-share-run').addEventListener('click', () => {
    if (state.ghostRun) shareRun(state.ghostRun);
  });

  // Pause
  document.getElementById('btn-pause').addEventListener('click', togglePause);

  // End run
  document.getElementById('btn-stop').addEventListener('click', () => {
    if (confirm('End this run?')) endRun();
  });

  // Summary actions
  document.getElementById('btn-share-ghost').addEventListener('click', () => {
    if (state.ghostRun) shareRun(state.ghostRun);
  });

  document.getElementById('btn-export').addEventListener('click', exportRunData);

  document.getElementById('btn-run-again').addEventListener('click', () => {
    renderGhostCard(state.ghostRun, 'ghost-card');
    showScreen('screen-preview');
  });

});

// ── SERVICE WORKER REGISTRATION ────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js')
      .then(() => console.log('Service worker registered'))
      .catch(err => console.warn('Service worker failed:', err));
  });
}