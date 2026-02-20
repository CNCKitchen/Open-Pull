const connectBtn = document.getElementById('connectBtn');
const emergencyStopBtn = document.getElementById('emergencyStopBtn');
const connectionState = document.getElementById('connectionState');
const statusLine = document.getElementById('statusLine');

const currentLoadEl = document.getElementById('currentLoad');
const maxLoadEl = document.getElementById('maxLoad');
const currentDispEl = document.getElementById('currentDisp');
const currentStressEl = document.getElementById('currentStress');
const maxStressEl = document.getElementById('maxStress');

const testTypeEl = document.getElementById('testType');
const speedInputEl = document.getElementById('speedInput');
const widthInputEl = document.getElementById('widthInput');
const heightInputEl = document.getElementById('heightInput');
const diameterInputEl = document.getElementById('diameterInput');
const diameterRowEl = document.getElementById('diameterRow');
const stressCardEl = document.getElementById('stressCard');
const sampleNameEl = document.getElementById('sampleName');
const gainInputEl = document.getElementById('gainInput');

const newTestBtn = document.getElementById('newTestBtn');
const startTestBtn = document.getElementById('startTestBtn');
const tareBtn = document.getElementById('tareBtn');
const setZeroBtn = document.getElementById('setZeroBtn');
const gotoZeroBtn = document.getElementById('gotoZeroBtn');
const exportBtn = document.getElementById('exportBtn');
const setGainBtn = document.getElementById('setGainBtn');

const canvas = document.getElementById('chartCanvas');
const ctx = canvas.getContext('2d');

let serialPort = null;
let serialReader = null;
let serialWriter = null;
let readerActive = false;
let readableStreamClosed = null;
let writableStreamClosed = null;

let samples = [];
let maxLoad = 0;
let maxStress = 0;

function resizeCanvasToDisplaySize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  const displayWidth = Math.max(1, Math.floor(rect.width));
  const displayHeight = Math.max(1, Math.floor(rect.height));
  const bufferWidth = Math.floor(displayWidth * dpr);
  const bufferHeight = Math.floor(displayHeight * dpr);

  if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
    canvas.width = bufferWidth;
    canvas.height = bufferHeight;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width: displayWidth, height: displayHeight };
}

function setStatus(text) {
  statusLine.textContent = `STATUS: ${text}`;
}

function setConnectionBadge(connected) {
  if (connected) {
    connectionState.textContent = 'Connected';
    connectionState.style.borderColor = '#2f6b43';
    connectionState.style.color = '#9ff0bd';
    connectionState.style.background = '#152b1f';
  } else {
    connectionState.textContent = 'Disconnected';
    connectionState.style.borderColor = '#2b3d60';
    connectionState.style.color = '#b5c7ea';
    connectionState.style.background = '#172236';
  }
}

function formatNum(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : (0).toFixed(digits);
}

function getAreaMm2() {
  if (testTypeEl.value === 'load') {
    return null;
  }

  if (testTypeEl.value === 'cylindrical') {
    const diameter = parseFloat(diameterInputEl.value);
    if (!Number.isFinite(diameter) || diameter <= 0) {
      return null;
    }
    const radius = diameter / 2;
    return Math.PI * radius * radius;
  }

  const width = parseFloat(widthInputEl.value);
  const height = parseFloat(heightInputEl.value);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return width * height;
}

function recomputeMaxStress() {
  const area = getAreaMm2();
  if (!area || testTypeEl.value === 'load') {
    maxStress = 0;
    return;
  }
  maxStress = samples.reduce((highest, sample) => {
    const stress = sample.loadN / area;
    return stress > highest ? stress : highest;
  }, 0);
}

function updateStressDisplay(stress) {
  if (testTypeEl.value === 'load') {
    currentStressEl.textContent = '--.- MPa';
    maxStressEl.textContent = '--.- MPa';
    stressCardEl.classList.add('disabled');
    return;
  }

  stressCardEl.classList.remove('disabled');
  currentStressEl.textContent = `${formatNum(stress, 1)} MPa`;
  maxStressEl.textContent = `${formatNum(maxStress, 1)} MPa`;
}

function refreshMetricsFromLatestSample() {
  const latest = samples[samples.length - 1];
  if (!latest) {
    updateMetrics(0, 0);
    return;
  }
  updateMetrics(latest.loadN, latest.displacementMm);
}

function applyTestTypeUiState() {
  const isCylindrical = testTypeEl.value === 'cylindrical';
  const isLoad = testTypeEl.value === 'load';

  const widthRow = widthInputEl.closest('.inline-input');
  const heightRow = heightInputEl.closest('.inline-input');
  const diameterRow = diameterInputEl.closest('.inline-input');

  widthInputEl.disabled = isCylindrical || isLoad;
  heightInputEl.disabled = isCylindrical || isLoad;
  diameterInputEl.disabled = !isCylindrical;

  widthRow.classList.toggle('disabled', widthInputEl.disabled);
  heightRow.classList.toggle('disabled', heightInputEl.disabled);
  diameterRow.classList.toggle('disabled', diameterInputEl.disabled);

  recomputeMaxStress();
  refreshMetricsFromLatestSample();
}

function updateMetrics(loadN, dispMm) {
  const area = getAreaMm2();
  const stress = area ? loadN / area : 0;

  if (loadN > maxLoad) maxLoad = loadN;
  if (testTypeEl.value !== 'load' && stress > maxStress) maxStress = stress;

  currentLoadEl.textContent = `${formatNum(loadN, 0)} N`;
  maxLoadEl.textContent = `${formatNum(maxLoad, 0)} N`;
  currentDispEl.textContent = `${formatNum(dispMm, 2)} mm`;
  updateStressDisplay(stress);
}

function resetTestData() {
  samples = [];
  maxLoad = 0;
  maxStress = 0;
  updateMetrics(0, 0);
  renderChart();
}

function renderChart() {
  const { width, height } = resizeCanvasToDisplaySize();

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#121b2c';
  ctx.fillRect(0, 0, width, height);

  const margin = 50;
  const plotW = width - margin * 2;
  const plotH = height - margin * 2;

  ctx.strokeStyle = '#2f3f61';
  ctx.lineWidth = 1;
  ctx.strokeRect(margin, margin, plotW, plotH);

  ctx.fillStyle = '#8ea7d6';
  ctx.font = '14px "Segoe UI", Arial, sans-serif';
  ctx.fillText('Force (N)', 10, margin - 8);
  ctx.fillText('Time (s)', width - 90, height - 12);

  if (samples.length < 2) return;

  const t0 = samples[0].timestampMs;
  const tMax = Math.max(...samples.map(s => (s.timestampMs - t0) / 1000));
  const fMax = Math.max(...samples.map(s => s.loadN), 1);

  ctx.strokeStyle = '#6ea1ff';
  ctx.lineWidth = 2;
  ctx.beginPath();

  samples.forEach((s, i) => {
    const t = (s.timestampMs - t0) / 1000;
    const x = margin + (tMax > 0 ? (t / tMax) * plotW : 0);
    const y = margin + plotH - (s.loadN / fMax) * plotH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();
}

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;

  const parts = trimmed.split(',');
  const tag = parts[0];

  if (tag === 'DATA' && parts.length >= 7) {
    const timestampMs = parseInt(parts[1], 10);
    const loadN = parseFloat(parts[2]);
    const stepPos = parseInt(parts[3], 10);
    const displacementMm = parseFloat(parts[4]);
    const mode = parseInt(parts[5], 10);
    const speedSps = parseFloat(parts[6]);

    const area = getAreaMm2();
    const stressMpa = area ? loadN / area : 0;

    samples.push({
      timestampMs,
      loadN,
      stepPos,
      displacementMm,
      stressMpa,
      mode,
      speedSps,
      sampleName: sampleNameEl.value || ''
    });

    if (samples.length > 5000) {
      samples.shift();
    }

    updateMetrics(loadN, displacementMm);
    renderChart();
    return;
  }

  if (tag === 'STATUS' && parts.length >= 4) {
    setStatus(`${parts[2]} ${parts.slice(3).join(',')}`);
    return;
  }

  if (tag === 'ACK' && parts.length >= 4) {
    setStatus(`ACK ${parts[2]} ${parts.slice(3).join(',')}`);
    return;
  }

  setStatus(trimmed);
}

async function readSerialLoop() {
  let textBuffer = '';
  readerActive = true;

  try {
    while (readerActive && serialReader) {
      const { value, done } = await serialReader.read();
      if (done) break;
      if (!value) continue;

      textBuffer += value;
      const lines = textBuffer.split('\n');
      textBuffer = lines.pop() || '';
      for (const line of lines) parseLine(line);
    }
  } catch (error) {
    setStatus(`read_error ${error.message}`);
  } finally {
    if (serialReader) {
      serialReader.releaseLock();
      serialReader = null;
    }
  }
}

async function connectSerial() {
  if (!('serial' in navigator)) {
    setStatus('Web Serial not supported in this browser');
    return;
  }

  try {
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: 115200 });

    const decoder = new TextDecoderStream();
    readableStreamClosed = serialPort.readable.pipeTo(decoder.writable);
    serialReader = decoder.readable.getReader();

    const encoder = new TextEncoderStream();
    writableStreamClosed = encoder.readable.pipeTo(serialPort.writable);
    serialWriter = encoder.writable.getWriter();

    connectBtn.textContent = 'Disconnect';
    setConnectionBadge(true);
    setStatus('connected');
    readSerialLoop();
  } catch (error) {
    setStatus(`connect_error ${error.message}`);
  }
}

async function disconnectSerial() {
  readerActive = false;

  try {
    if (serialReader) {
      await serialReader.cancel();
      serialReader.releaseLock();
      serialReader = null;
    }
  } catch (_) {}

  try {
    if (serialWriter) {
      await serialWriter.close();
      serialWriter.releaseLock();
      serialWriter = null;
    }
  } catch (_) {}

  try {
    if (readableStreamClosed) {
      await readableStreamClosed.catch(() => {});
      readableStreamClosed = null;
    }
  } catch (_) {}

  try {
    if (writableStreamClosed) {
      await writableStreamClosed.catch(() => {});
      writableStreamClosed = null;
    }
  } catch (_) {}

  try {
    if (serialPort) {
      await serialPort.close();
      serialPort = null;
    }
  } catch (_) {}

  connectBtn.textContent = 'Connect';
  setConnectionBadge(false);
  setStatus('disconnected');
}

async function sendCommand(command) {
  if (!serialWriter) {
    setStatus('not_connected');
    return;
  }
  await serialWriter.write(`${command}\n`);
}

connectBtn.addEventListener('click', async () => {
  if (serialPort) await disconnectSerial();
  else await connectSerial();
});

newTestBtn.addEventListener('click', async () => {
  resetTestData();
  await sendCommand('M11');
});

startTestBtn.addEventListener('click', async () => {
  const speed = parseFloat(speedInputEl.value);
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1.0;
  const roundedSpeed = Number(safeSpeed.toFixed(1));
  speedInputEl.value = roundedSpeed.toFixed(1);

  await sendCommand(`M40 ${roundedSpeed.toFixed(1)}`);
  await sendCommand('M10');
});

emergencyStopBtn.addEventListener('click', async () => {
  await sendCommand('M11');
  setStatus('emergency_stop');
});

tareBtn.addEventListener('click', async () => {
  await sendCommand('M12');
});

setZeroBtn.addEventListener('click', async () => {
  await sendCommand('M20');
});

gotoZeroBtn.addEventListener('click', async () => {
  await sendCommand('M21');
});

if (setGainBtn && gainInputEl) {
  setGainBtn.addEventListener('click', async () => {
    const gain = parseFloat(gainInputEl.value);
    if (!Number.isFinite(gain) || gain === 0) {
      setStatus('invalid_gain');
      return;
    }
    await sendCommand(`M43 ${gain}`);
  });
}

testTypeEl.addEventListener('change', applyTestTypeUiState);
widthInputEl.addEventListener('input', () => {
  recomputeMaxStress();
  refreshMetricsFromLatestSample();
});
heightInputEl.addEventListener('input', () => {
  recomputeMaxStress();
  refreshMetricsFromLatestSample();
});
if (diameterInputEl) {
  diameterInputEl.addEventListener('input', () => {
    recomputeMaxStress();
    refreshMetricsFromLatestSample();
  });
}

window.addEventListener('resize', renderChart);

exportBtn.addEventListener('click', () => {
  if (samples.length === 0) {
    setStatus('no_data_to_export');
    return;
  }

  const header = [
    'timestamp_ms',
    'sample_name',
    'load_N',
    'step_position',
    'displacement_mm',
    'stress_MPa',
    'mode',
    'speed_steps_per_s'
  ].join(',');

  const rows = samples.map(s => [
    s.timestampMs,
    `"${(s.sampleName || '').replaceAll('"', '""')}"`,
    s.loadN,
    s.stepPos,
    s.displacementMm,
    s.stressMpa,
    s.mode,
    s.speedSps
  ].join(','));

  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sampleLabel = (sampleNameEl.value || 'open-pull').trim().replace(/\s+/g, '_');
  link.href = url;
  link.download = `${sampleLabel}_${stamp}.csv`;
  link.click();

  URL.revokeObjectURL(url);
  setStatus('csv_exported');
});

resetTestData();
setConnectionBadge(false);
setStatus('ready');
applyTestTypeUiState();
renderChart();
