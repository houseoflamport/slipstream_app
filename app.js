// ── SLIPSTREAM — Stories 1 + 2 + 3 + 4A ─────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function parseGPX(text) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('Invalid GPX file.');
  const trkpts = xml.querySelectorAll('trkpt');
  if (trkpts.length === 0) throw new Error('No track points found.');
  const points = [];
  trkpts.forEach(pt => {
    const lat = parseFloat(pt.getAttribute('lat'));
    const lon = parseFloat(pt.getAttribute('lon'));
    const timeEl = pt.querySelector('time');
    const time = timeEl ? new Date(timeEl.textContent).getTime() : null;
    let cadence = null;
    const cad = pt.querySelector('cad') || pt.querySelector('RunCadence') || pt.querySelector('cadence');
    if (cad) cadence = parseInt(cad.textContent);
    points.push({ lat, lon, time, cadence });
  });
  if (!points.some(p => p.time)) throw new Error('No timing data found. Slipstream needs timestamped runs.');
  let totalDistance = 0;
  const processed = [];
  for (let i = 0; i < points.length; i++) {
    if (i === 0) { processed.push({ ...points[i], totalDistance: 0 }); continue; }
    const dist = haversine(points[i-1].lat, points[i-1].lon, points[i].lat, points[i].lon);
    totalDistance += dist;
    processed.push({ ...points[i], totalDistance });
  }
  const totalTime = (points[points.length-1].time - points[0].time) / 1000;
  const avgPace = totalDistance > 0 ? totalTime / totalDistance : 0;
  return { points: processed, totalDistance, totalTime, avgPace, hasCadence: points.some(p => p.cadence), name: '' };
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = lat1*Math.PI/180, φ2 = lat2*Math.PI/180;
  const Δφ = (lat2-lat1)*Math.PI/180, Δλ = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function formatPace(secPerMetre) {
  if (!secPerMetre || secPerMetre <= 0) return '--:--';
  const secPerKm = secPerMetre * 1000;
  return `${Math.floor(secPerKm/60)}:${Math.round(secPerKm%60).toString().padStart(2,'0')}`;
}

function formatTime(seconds) {
  const h = Math.floor(seconds/3600), m = Math.floor((seconds%3600)/60);
  const s = Math.round(seconds%60).toString().padStart(2,'0');
  return h > 0 ? `${h}:${m.toString().padStart(2,'0')}:${s}` : `${m}:${s}`;
}

function formatDistance(metres) { return (metres/1000).toFixed(2); }

function showResult(run) {
  const resultEl = document.getElementById('import-result');
  resultEl.classList.remove('hidden');
  resultEl.innerHTML = `
    <div class="result-row"><span class="result-label">Distance</span><span class="result-value">${formatDistance(run.totalDistance)} km</span></div>
    <div class="result-row"><span class="result-label">Time</span><span class="result-value">${formatTime(run.totalTime)}</span></div>
    <div class="result-row"><span class="result-label">Avg Pace</span><span class="result-value">${formatPace(run.avgPace)} /km</span></div>
    <div class="result-row"><span class="result-label">Cadence</span><span class="result-value">${run.hasCadence ? '✓ Available' : 'Not available'}</span></div>
  `;
  document.getElementById('share-row').classList.remove('hidden');
  document.getElementById('run-name-input').value = '';
  document.getElementById('btn-share').disabled = true;
}

function showPreview(run) {
  const card = document.getElementById('preview-card');
  card.innerHTML = `
    <div class="result-row"><span class="result-label">Name</span><span class="result-value">${run.name || 'Unnamed Run'}</span></div>
    <div class="result-row"><span class="result-label">Distance</span><span class="result-value">${formatDistance(run.totalDistance)} km</span></div>
    <div class="result-row"><span class="result-label">Time</span><span class="result-value">${formatTime(run.totalTime)}</span></div>
    <div class="result-row"><span class="result-label">Avg Pace</span><span class="result-value">${formatPace(run.avgPace)} /km</span></div>
    <div class="result-row"><span class="result-label">Cadence</span><span class="result-value">${run.hasCadence ? '✓ Available' : 'Not available'}</span></div>
  `;
  showScreen('screen-preview');
}

function shareRun(run) {
  const totalMinutes = Math.ceil(run.totalTime / 60);
  const step = Math.max(1, Math.floor(run.points.length / totalMinutes));
  const payload = {
    name: run.name,
    totalDistance: run.totalDistance,
    totalTime: run.totalTime,
    avgPace: run.avgPace,
    hasCadence: run.hasCadence,
    points: run.points.filter((p, i) => i === 0 || i === run.points.length - 1 || i % step === 0).map(p => ({
      t: p.time - run.points[0].time,
      d: Math.round(p.totalDistance),
      c: p.cadence,
    })),
  };
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const url = `${window.location.origin}${window.location.pathname}?ghost=${encoded}`;
  console.log('Share URL length:', url.length);
  if (navigator.share) {
    navigator.share({
      title: `Race ${run.name} on Slipstream`,
      text: `Can you beat ${run.name}? ${formatDistance(run.totalDistance)}km at ${formatPace(run.avgPace)}/km`,
      url,
    }).catch(err => console.log('Share cancelled:', err));
  } else {
    navigator.clipboard.writeText(url).then(() => {
      alert('Link copied to clipboard!');
    }).catch(() => {
      prompt('Copy this link:', url);
    });
  }
}

function loadGhostFromURL() {
  const params = new URLSearchParams(window.location.search);
  const encoded = params.get('ghost');
  if (!encoded) return null;
  try {
    const data = JSON.parse(decodeURIComponent(escape(atob(encoded))));
    const baseTime = Date.now();
    data.points = data.points.map(p => ({
      time: baseTime + p.t,
      totalDistance: p.d,
      cadence: p.c,
      lat: null, lon: null,
    }));
    console.log('Ghost loaded from URL:', data.name, formatDistance(data.totalDistance) + 'km');
    return data;
  } catch(e) {
    console.error('Failed to decode ghost URL:', e);
    return null;
  }
}

// ── RUN STATE ─────────────────────────────────────────────────────────────
let currentRun = null;
let ghostRun = null;
let runInterval = null;
let startTime = null;
let isPaused = false;
let pausedAt = null;
let totalPausedTime = 0;

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

function startRun() {
  startTime = Date.now();
  totalPausedTime = 0;
  isPaused = false;
  document.getElementById('ghost-ref-pace').textContent = formatPace(ghostRun.avgPace);
  runInterval = setInterval(tick, 1000);
  console.log('Run started');
}

function ghostDistanceAtTime(elapsedSeconds) {
  const pts = ghostRun.points;
  for (let i = 1; i < pts.length; i++) {
    const ptElapsed = (pts[i].time - pts[0].time) / 1000;
    if (ptElapsed >= elapsedSeconds) return pts[i].totalDistance;
  }
  return ghostRun.totalDistance;
}

function updateGapDisplay(gapSeconds) {
  const ref = document.getElementById('ghost-ref-pace');
  const LOCKED = 5;
  if (Math.abs(gapSeconds) <= LOCKED) {
    ref.style.color = '#00E5FF';
    ref.textContent = `±${Math.abs(gapSeconds)}s — Locked In`;
  } else if (gapSeconds > 0) {
    ref.style.color = '#FF9F0A';
    ref.textContent = `+${gapSeconds}s — Ghost ahead`;
  } else {
    ref.style.color = '#30D158';
    ref.textContent = `−${Math.abs(gapSeconds)}s — You're ahead`;
  }
}

function tick() {
  if (isPaused) return;
  const elapsed = (Date.now() - startTime - totalPausedTime) / 1000;
  document.getElementById('stat-time').textContent = formatTime(elapsed);
  const ghostDist = ghostDistanceAtTime(elapsed);
  const gapSeconds = Math.round((ghostDist - 0) * ghostRun.avgPace);
  updateGapDisplay(gapSeconds);
}

function togglePause() {
  isPaused = !isPaused;
  const btn = document.getElementById('btn-pause');
  if (isPaused) {
    pausedAt = Date.now();
    btn.textContent = '▶ Resume';
    console.log('Run paused');
  } else {
    totalPausedTime += Date.now() - pausedAt;
    btn.textContent = '⏸ Pause';
    console.log('Run resumed');
  }
}

// ── INIT ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

const urlGhost = loadGhostFromURL();
if (urlGhost) {
  ghostRun = urlGhost;
  showPreview(ghostRun);
}

  document.getElementById('btn-import').addEventListener('click', () => showScreen('screen-import'));
  document.getElementById('back-import').addEventListener('click', () => showScreen('screen-home'));
  document.getElementById('back-preview').addEventListener('click', () => showScreen('screen-home'));

  document.getElementById('file-drop').addEventListener('click', () => {
    document.getElementById('gpx-file-input').click();
  });

  document.getElementById('gpx-file-input').addEventListener('change', function() {
    const file = this.files[0];
    if (!file) return;
    console.log('File selected:', file.name);
    const errorEl = document.getElementById('import-error');
    errorEl.classList.add('hidden');
    document.getElementById('import-result').classList.add('hidden');
    document.getElementById('share-row').classList.add('hidden');
    const reader = new FileReader();
    reader.onload = function(evt) {
      try {
        currentRun = parseGPX(evt.target.result);
        console.log('Parsed OK:', formatDistance(currentRun.totalDistance), 'km');
        showResult(currentRun);
      } catch(err) {
        console.error('Parse error:', err.message);
        errorEl.classList.remove('hidden');
        errorEl.textContent = err.message;
      }
    };
    reader.onerror = function() {
      errorEl.classList.remove('hidden');
      errorEl.textContent = 'Could not read the file. Please try again.';
    };
    reader.readAsText(file);
  });

  document.getElementById('run-name-input').addEventListener('input', function() {
    document.getElementById('btn-share').disabled = this.value.trim().length === 0;
    if (currentRun) currentRun.name = this.value.trim();
  });

  document.getElementById('btn-share').addEventListener('click', () => {
    if (currentRun && currentRun.name) shareRun(currentRun);
  });

  document.getElementById('btn-run-ghost').addEventListener('click', () => {
    showScreen('screen-run');
    startCountdown(() => startRun());
  });

  document.getElementById('btn-pause').addEventListener('click', togglePause);

  document.getElementById('btn-stop').addEventListener('click', () => {
    if (confirm('End this run?')) {
      clearInterval(runInterval);
      showScreen('screen-preview');
    }
  });

});