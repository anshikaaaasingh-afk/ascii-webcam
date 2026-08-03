(() => {
  const video = document.getElementById('video');
  const asciiCanvas = document.getElementById('asciiCanvas');
  const sourceCanvas = document.getElementById('sourceCanvas');
  const asciiCtx = asciiCanvas.getContext('2d');
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });

  const startBtn = document.getElementById('startBtn');
  const startOverlay = document.getElementById('startOverlay');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');

  const resSlider = document.getElementById('resSlider');
  const resValue = document.getElementById('resValue');
  const resReadout = document.getElementById('resReadout');
  const fpsReadout = document.getElementById('fpsReadout');

  const colorToggle = document.getElementById('colorToggle');
  const invertToggle = document.getElementById('invertToggle');
  const mirrorToggle = document.getElementById('mirrorToggle');

  const rampSelect = document.getElementById('rampSelect');
  const themeSelect = document.getElementById('themeSelect');

  const snapBtn = document.getElementById('snapBtn');
  const snapTextBtn = document.getElementById('snapTextBtn');

  const RAMPS = {
    standard: '@%#*+=-:. ',
    blocks: '█▓▒░ ',
    binary: '10 ',
    minimal: '#. '
  };

  const THEMES = {
    paper:    { bg: '#EDE8DB', ink: '#1C1B17' },
    phosphor: { bg: '#0C1A0F', ink: '#42E86B' },
    amber:    { bg: '#1A1208', ink: '#E8A63D' },
    midnight: { bg: '#0B0E1A', ink: '#7CA8FF' }
  };

  let state = {
    cellScale: parseFloat(resSlider.value), // fraction of video width used as column count basis
    ramp: 'standard',
    theme: 'paper',
    color: false,
    invert: false,
    mirror: true,
    running: false
  };

  let stream = null;
  let rafId = null;
  let lastFrameTime = performance.now();
  let fpsSmoothed = 0;

  function setStatus(mode, text){
    statusDot.classList.remove('is-live', 'is-error');
    if (mode === 'live') statusDot.classList.add('is-live');
    if (mode === 'error') statusDot.classList.add('is-error');
    statusText.textContent = text;
  }

  async function startCamera(){
    try{
      setStatus('idle', 'requesting camera…');
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      });
      video.srcObject = stream;
      await video.play();
      startOverlay.style.display = 'none';
      snapBtn.disabled = false;
      snapTextBtn.disabled = false;
      setStatus('live', 'live');
      state.running = true;
      resizeSourceCanvas();
      lastFrameTime = performance.now();
      renderLoop();
    }catch(err){
      console.error(err);
      setStatus('error', 'camera access denied');
    }
  }

  function resizeSourceCanvas(){
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    sourceCanvas.width = w;
    sourceCanvas.height = h;
  }

  function computeGrid(){
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
    // cellScale is a fraction; smaller fraction = fewer, bigger cells
    const cols = Math.max(20, Math.round(w * state.cellScale));
    // character cells are taller than wide, compensate aspect ratio (~0.55)
    const cellW = w / cols;
    const cellH = cellW / 0.55;
    const rows = Math.max(10, Math.round(h / cellH));
    return { cols, rows };
  }

  function renderLoop(){
    if (!state.running) return;
    drawFrame();
    const now = performance.now();
    const dt = now - lastFrameTime;
    lastFrameTime = now;
    const instFps = 1000 / dt;
    fpsSmoothed = fpsSmoothed ? fpsSmoothed * 0.9 + instFps * 0.1 : instFps;
    fpsReadout.textContent = `${Math.round(fpsSmoothed)} fps`;
    rafId = requestAnimationFrame(renderLoop);
  }

  function drawFrame(){
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
    if (!w || !h) return;

    sourceCtx.save();
    if (state.mirror){
      sourceCtx.translate(w, 0);
      sourceCtx.scale(-1, 1);
    }
    sourceCtx.drawImage(video, 0, 0, w, h);
    sourceCtx.restore();

    const { cols, rows } = computeGrid();
    resReadout.textContent = `${cols} × ${rows} cells`;

    // sample at low res: draw scaled-down image into an offscreen-sized read
    const sampleData = sourceCtx.getImageData(0, 0, w, h).data;

    const ramp = RAMPS[state.ramp];
    const rampLen = ramp.length;
    const theme = THEMES[state.theme];

    // size the output canvas to match container, then compute cell pixel size
    const cssW = asciiCanvas.clientWidth || 640;
    const cssH = asciiCanvas.clientHeight || 480;
    const dpr = window.devicePixelRatio || 1;
    if (asciiCanvas.width !== cssW * dpr || asciiCanvas.height !== cssH * dpr){
      asciiCanvas.width = cssW * dpr;
      asciiCanvas.height = cssH * dpr;
    }
    asciiCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    asciiCtx.fillStyle = theme.bg;
    asciiCtx.fillRect(0, 0, cssW, cssH);

    const cellPxW = cssW / cols;
    const cellPxH = cssH / rows;
    const fontSize = Math.max(cellPxH * 0.95, 4);
    asciiCtx.font = `${fontSize}px "IBM Plex Mono", monospace`;
    asciiCtx.textBaseline = 'middle';
    asciiCtx.textAlign = 'center';

    const stepX = w / cols;
    const stepY = h / rows;

    for (let row = 0; row < rows; row++){
      const sy = Math.min(h - 1, Math.floor(row * stepY));
      for (let col = 0; col < cols; col++){
        const sx = Math.min(w - 1, Math.floor(col * stepX));
        const idx = (sy * w + sx) * 4;
        const r = sampleData[idx];
        const g = sampleData[idx + 1];
        const b = sampleData[idx + 2];
        let brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        if (state.invert) brightness = 1 - brightness;

        const charIdx = Math.min(rampLen - 1, Math.floor((1 - brightness) * (rampLen - 1)));
        const char = ramp[charIdx];
        if (char === ' ') continue;

        asciiCtx.fillStyle = state.color ? `rgb(${r},${g},${b})` : theme.ink;
        const px = col * cellPxW + cellPxW / 2;
        const py = row * cellPxH + cellPxH / 2;
        asciiCtx.fillText(char, px, py);
      }
    }
  }

  function buildAsciiText(){
    // regenerate a plain-text version at the current grid for export
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
    const { cols, rows } = computeGrid();
    const sampleData = sourceCtx.getImageData(0, 0, w, h).data;
    const ramp = RAMPS[state.ramp];
    const rampLen = ramp.length;
    const stepX = w / cols;
    const stepY = h / rows;
    let lines = [];
    for (let row = 0; row < rows; row++){
      const sy = Math.min(h - 1, Math.floor(row * stepY));
      let line = '';
      for (let col = 0; col < cols; col++){
        const sx = Math.min(w - 1, Math.floor(col * stepX));
        const idx = (sy * w + sx) * 4;
        const r = sampleData[idx], g = sampleData[idx+1], b = sampleData[idx+2];
        let brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        if (state.invert) brightness = 1 - brightness;
        const charIdx = Math.min(rampLen - 1, Math.floor((1 - brightness) * (rampLen - 1)));
        line += ramp[charIdx];
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  function downloadBlob(blob, filename){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // --- Event bindings ---

  startBtn.addEventListener('click', startCamera);

  resSlider.addEventListener('input', () => {
    state.cellScale = parseFloat(resSlider.value);
    resValue.textContent = state.cellScale.toFixed(2);
  });

  rampSelect.addEventListener('click', (e) => {
    const btn = e.target.closest('.ramp-option');
    if (!btn) return;
    state.ramp = btn.dataset.ramp;
    [...rampSelect.children].forEach(c => c.classList.toggle('is-active', c === btn));
  });

  themeSelect.addEventListener('click', (e) => {
    const btn = e.target.closest('.theme-option');
    if (!btn) return;
    state.theme = btn.dataset.theme;
    [...themeSelect.children].forEach(c => c.classList.toggle('is-active', c === btn));
  });

  colorToggle.addEventListener('change', () => { state.color = colorToggle.checked; });
  invertToggle.addEventListener('change', () => { state.invert = invertToggle.checked; });
  mirrorToggle.addEventListener('change', () => { state.mirror = mirrorToggle.checked; });

  snapBtn.addEventListener('click', () => {
    asciiCanvas.toBlob((blob) => {
      downloadBlob(blob, `ascii-webcam-${Date.now()}.png`);
    });
  });

  snapTextBtn.addEventListener('click', () => {
    const text = buildAsciiText();
    const blob = new Blob([text], { type: 'text/plain' });
    downloadBlob(blob, `ascii-webcam-${Date.now()}.txt`);
  });

  window.addEventListener('resize', () => {
    // canvas will resize on next drawFrame call automatically
  });

  window.addEventListener('beforeunload', () => {
    if (stream) stream.getTracks().forEach(t => t.stop());
  });
})();
