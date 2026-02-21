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
const stressCardEl = document.getElementById('stressCard');
const sampleNameEl = document.getElementById('sampleName');
const sampleCommentEl = document.getElementById('sampleComment');
const sampleRateInputEl = document.getElementById('sampleRateInput');
const manualSlowInputEl = document.getElementById('manualSlowInput');
const manualFastInputEl = document.getElementById('manualFastInput');
const accelInputEl = document.getElementById('accelInput');
const gainInputEl = document.getElementById('gainInput');

const newSeriesBtn = document.getElementById('newSeriesBtn');
const newTestBtn = document.getElementById('newTestBtn');
const startTestBtn = document.getElementById('startTestBtn');
const manualStopBtn = document.getElementById('manualStopBtn');
const tareBtn = document.getElementById('tareBtn');
const setZeroBtn = document.getElementById('setZeroBtn');
const gotoZeroBtn = document.getElementById('gotoZeroBtn');
const exportBtn = document.getElementById('exportBtn');
const setSampleRateBtn = document.getElementById('setSampleRateBtn');
const setManualSlowBtn = document.getElementById('setManualSlowBtn');
const setManualFastBtn = document.getElementById('setManualFastBtn');
const setAccelBtn = document.getElementById('setAccelBtn');
const setGainBtn = document.getElementById('setGainBtn');
const jogPlus10Btn = document.getElementById('jogPlus10Btn');
const jogPlus1Btn = document.getElementById('jogPlus1Btn');
const jogPlus01Btn = document.getElementById('jogPlus01Btn');
const jogMinus01Btn = document.getElementById('jogMinus01Btn');
const jogMinus1Btn = document.getElementById('jogMinus1Btn');
const jogMinus10Btn = document.getElementById('jogMinus10Btn');

const seriesIdLabelEl = document.getElementById('seriesIdLabel');
const seriesEmptyEl = document.getElementById('seriesEmpty');
const seriesListEl = document.getElementById('seriesList');

const canvas = document.getElementById('chartCanvas');
const ctx = canvas.getContext('2d');

const STORAGE_KEY = 'openpull-series-v1';
const TEST_MODE_VALUES = new Set([1, 3, 4]);
const MANUAL_MODE_VALUE = 2;
const MAX_SAMPLES_PER_TEST = 5000;
const OVERLAY_COLORS = ['#ff9f6c', '#8ce99a', '#d0a6ff', '#6ee7ff', '#ffd166', '#ff8fab'];
const LOAD_SPIKE_JUMP_THRESHOLD_N = 300;

let serialPort = null;
let serialReader = null;
let serialWriter = null;
let readerActive = false;
let readableStreamClosed = null;
let writableStreamClosed = null;

let persistTimeoutId = null;
let lastIncomingMode = MANUAL_MODE_VALUE;
let lastAcceptedLoadN = null;

const seriesState = {
  version: 1,
  seriesId: null,
  createdAtIso: null,
  tests: [],
  activeTestId: null,
  readyForStart: false,
  overlaySelection: {}
};

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

function escapeCsv(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function getActiveTest() {
  if (!seriesState.activeTestId) {
    return null;
  }
  return seriesState.tests.find(test => test.id === seriesState.activeTestId) || null;
}

function isRunningTest(test) {
  return !!test && test.status === 'running';
}

function getGeometryFromInputs() {
  const testType = testTypeEl.value;
  const speedMmMin = parseFloat(speedInputEl.value);
  const widthMm = parseFloat(widthInputEl.value);
  const heightMm = parseFloat(heightInputEl.value);
  const diameterMm = parseFloat(diameterInputEl.value);

  return {
    testType,
    speedMmMin,
    widthMm,
    heightMm,
    diameterMm
  };
}

function getAreaMm2FromMeta(meta) {
  if (!meta || meta.testType === 'load') {
    return null;
  }

  if (meta.testType === 'cylindrical') {
    if (!Number.isFinite(meta.diameterMm) || meta.diameterMm <= 0) {
      return null;
    }
    const radius = meta.diameterMm / 2;
    return Math.PI * radius * radius;
  }

  if (!Number.isFinite(meta.widthMm) || !Number.isFinite(meta.heightMm) || meta.widthMm <= 0 || meta.heightMm <= 0) {
    return null;
  }

  return meta.widthMm * meta.heightMm;
}

function getCurrentFormAreaMm2() {
  const meta = getGeometryFromInputs();
  return getAreaMm2FromMeta(meta);
}

function getValidationErrors() {
  const errors = [];
  const sampleName = (sampleNameEl.value || '').trim();
  const meta = getGeometryFromInputs();

  if (!serialWriter) {
    errors.push('connect interface first');
  }

  if (!seriesState.seriesId) {
    errors.push('create a series first');
  }

  if (!seriesState.readyForStart) {
    errors.push('press New Test before START TEST');
  }

  if (!sampleName) {
    errors.push('sample name required');
  }

  if (!Number.isFinite(meta.speedMmMin) || meta.speedMmMin <= 0) {
    errors.push('valid speed required');
  }

  if (!meta.testType) {
    errors.push('sample type required');
  }

  if (meta.testType === 'cylindrical') {
    if (!Number.isFinite(meta.diameterMm) || meta.diameterMm <= 0) {
      errors.push('valid diameter required');
    }
  } else if (meta.testType !== 'load') {
    if (!Number.isFinite(meta.widthMm) || meta.widthMm <= 0) {
      errors.push('valid width required');
    }
    if (!Number.isFinite(meta.heightMm) || meta.heightMm <= 0) {
      errors.push('valid height required');
    }
  }

  const activeTest = getActiveTest();
  if (isRunningTest(activeTest)) {
    errors.push('test already running');
  }

  return errors;
}

function updateStartButtonState() {
  const canStart = getValidationErrors().length === 0;
  startTestBtn.disabled = !canStart;
}

function getConfiguredAccelerationMmPerS2() {
  const accel = parseFloat(accelInputEl?.value);
  if (!Number.isFinite(accel) || accel <= 0) {
    return null;
  }
  const roundedAccel = Number(accel.toFixed(1));
  if (accelInputEl) {
    accelInputEl.value = roundedAccel.toFixed(1);
  }
  return roundedAccel;
}

function getConfiguredPositiveNumber(inputEl, decimals = 1) {
  const value = parseFloat(inputEl?.value);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  const rounded = Number(value.toFixed(decimals));
  if (inputEl) {
    inputEl.value = rounded.toFixed(decimals);
  }
  return rounded;
}

function clearSampleFieldsForNextTest() {
  sampleNameEl.value = '';
  sampleCommentEl.value = '';
  widthInputEl.value = '';
  heightInputEl.value = '';
  diameterInputEl.value = '';
  updateStartButtonState();
}

function resetMetricsDisplay() {
  if (Number.isFinite(lastAcceptedLoadN)) {
    currentLoadEl.textContent = `${formatNum(lastAcceptedLoadN, 0)} N`;
  } else {
    currentLoadEl.textContent = '0 N';
  }
  maxLoadEl.textContent = '0 N';
  currentDispEl.textContent = '0.00 mm';
  if (testTypeEl.value === 'load') {
    currentStressEl.textContent = '--.- MPa';
    maxStressEl.textContent = '--.- MPa';
    stressCardEl.classList.add('disabled');
  } else {
    currentStressEl.textContent = '0.0 MPa';
    maxStressEl.textContent = '0.0 MPa';
    stressCardEl.classList.remove('disabled');
  }
}

function normalizeTestStatus(status) {
  if (status === 'aborded') {
    return 'aborted';
  }
  if (status === 'running' || status === 'aborted' || status === 'finished') {
    return status;
  }
  return 'finished';
}

function sanitizeIncomingLoad(loadN) {
  if (!Number.isFinite(loadN)) {
    return Number.isFinite(lastAcceptedLoadN) ? lastAcceptedLoadN : 0;
  }

  if (!Number.isFinite(lastAcceptedLoadN)) {
    lastAcceptedLoadN = loadN;
    return loadN;
  }

  const upwardJump = loadN - lastAcceptedLoadN;
  if (upwardJump > LOAD_SPIKE_JUMP_THRESHOLD_N) {
    return lastAcceptedLoadN;
  }

  lastAcceptedLoadN = loadN;
  return loadN;
}

function updateMetricsFromTest(test) {
  if (!test || test.samples.length === 0) {
    resetMetricsDisplay();
    return;
  }

  const latest = test.samples[test.samples.length - 1];
  const maxLoad = test.samples.reduce((highest, sample) => (sample.loadN > highest ? sample.loadN : highest), 0);
  const area = getAreaMm2FromMeta(test.meta);
  const currentStress = area ? latest.loadN / area : 0;
  const maxStress = area
    ? test.samples.reduce((highest, sample) => {
      const sampleStress = sample.loadN / area;
      return sampleStress > highest ? sampleStress : highest;
    }, 0)
    : 0;

  currentLoadEl.textContent = `${formatNum(latest.loadN, 0)} N`;
  maxLoadEl.textContent = `${formatNum(maxLoad, 0)} N`;
  currentDispEl.textContent = `${formatNum(latest.displacementMm, 2)} mm`;

  if (test.meta.testType === 'load') {
    currentStressEl.textContent = '--.- MPa';
    maxStressEl.textContent = '--.- MPa';
    stressCardEl.classList.add('disabled');
  } else {
    stressCardEl.classList.remove('disabled');
    currentStressEl.textContent = `${formatNum(currentStress, 1)} MPa`;
    maxStressEl.textContent = `${formatNum(maxStress, 1)} MPa`;
  }
}

function getTestDisplayLabel(test, index) {
  const name = (test.meta.sampleName || '').trim();
  return name || `Test ${index + 1}`;
}

function getVisibleChartSeries() {
  const activeTest = getActiveTest();
  const visible = [];

  if (activeTest && activeTest.samples.length > 1) {
    visible.push({
      test: activeTest,
      color: '#6ea1ff',
      isActive: true
    });
  }

  const selectable = seriesState.tests.filter(test => test.id !== seriesState.activeTestId && test.samples.length > 1);
  let colorIdx = 0;
  selectable.forEach(test => {
    if (!seriesState.overlaySelection[test.id]) {
      return;
    }
    visible.push({
      test,
      color: OVERLAY_COLORS[colorIdx % OVERLAY_COLORS.length],
      isActive: false
    });
    colorIdx += 1;
  });

  return visible;
}

function renderChart() {
  const { width, height } = resizeCanvasToDisplaySize();

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#121b2c';
  ctx.fillRect(0, 0, width, height);

  const marginLeft = 56;
  const marginRight = 20;
  const marginTop = 20;
  const marginBottom = 42;
  const plotX = marginLeft;
  const plotY = marginTop;
  const plotW = width - marginLeft - marginRight;
  const plotH = height - marginTop - marginBottom;

  const seriesEntries = getVisibleChartSeries();
  let tMax = 1;
  let fMax = 1;

  seriesEntries.forEach(entry => {
    const samples = entry.test.samples;
    const t0 = samples[0].timestampMs;
    const testTMax = samples[samples.length - 1].timestampMs > t0
      ? (samples[samples.length - 1].timestampMs - t0) / 1000
      : 0;
    const testFMax = samples.reduce((maxVal, sample) => (sample.loadN > maxVal ? sample.loadN : maxVal), 0);
    if (testTMax > tMax) tMax = testTMax;
    if (testFMax > fMax) fMax = testFMax;
  });

  const yTicks = 6;
  const xTicks = 8;

  ctx.strokeStyle = '#2f3f61';
  ctx.lineWidth = 1;
  ctx.strokeRect(plotX, plotY, plotW, plotH);

  ctx.font = '12px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#8ea7d6';

  for (let i = 0; i <= yTicks; i += 1) {
    const ratio = i / yTicks;
    const y = plotY + plotH - ratio * plotH;
    const forceVal = ratio * fMax;

    ctx.beginPath();
    ctx.moveTo(plotX, y);
    ctx.lineTo(plotX + plotW, y);
    ctx.stroke();

    ctx.fillText(formatNum(forceVal, forceVal >= 100 ? 0 : 1), 6, y + 4);
  }

  for (let i = 0; i <= xTicks; i += 1) {
    const ratio = i / xTicks;
    const x = plotX + ratio * plotW;
    const timeVal = ratio * tMax;

    ctx.beginPath();
    ctx.moveTo(x, plotY);
    ctx.lineTo(x, plotY + plotH);
    ctx.stroke();

    ctx.fillText(formatNum(timeVal, timeVal >= 10 ? 0 : 1), x - 10, plotY + plotH + 16);
  }

  ctx.fillText('Force (N)', 8, plotY - 6);
  ctx.fillText('Time (s)', plotX + plotW - 50, plotY + plotH + 32);

  if (seriesEntries.length === 0) {
    return;
  }

  seriesEntries.forEach(entry => {
    const samples = entry.test.samples;
    const t0 = samples[0].timestampMs;
    const originX = plotX;
    const originY = plotY + plotH;

    ctx.beginPath();
    ctx.moveTo(originX, originY);
    let lastX = originX;

    samples.forEach(sample => {
      const relTimeS = (sample.timestampMs - t0) / 1000;
      const x = plotX + (tMax > 0 ? (relTimeS / tMax) * plotW : 0);
      const y = plotY + plotH - (sample.loadN / fMax) * plotH;
      ctx.lineTo(x, y);
      lastX = x;
    });

    ctx.lineTo(lastX, originY);
    ctx.closePath();

    ctx.save();
    ctx.globalAlpha = entry.isActive ? 0.18 : 0.1;
    ctx.fillStyle = entry.color;
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = entry.color;
    ctx.lineWidth = entry.isActive ? 2.2 : 1.6;
    ctx.beginPath();

    ctx.moveTo(originX, originY);
    samples.forEach(sample => {
      const relTimeS = (sample.timestampMs - t0) / 1000;
      const x = plotX + (tMax > 0 ? (relTimeS / tMax) * plotW : 0);
      const y = plotY + plotH - (sample.loadN / fMax) * plotH;
      ctx.lineTo(x, y);
    });

    ctx.stroke();
  });
}

function schedulePersistState() {
  if (persistTimeoutId) {
    clearTimeout(persistTimeoutId);
  }
  persistTimeoutId = setTimeout(() => {
    persistTimeoutId = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seriesState));
    } catch (_) {}
  }, 250);
}

function persistStateNow() {
  if (persistTimeoutId) {
    clearTimeout(persistTimeoutId);
    persistTimeoutId = null;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seriesState));
  } catch (_) {}
}

function restoreStateFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw);

    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.tests)) {
      return;
    }

    seriesState.seriesId = typeof parsed.seriesId === 'string' ? parsed.seriesId : null;
    seriesState.createdAtIso = typeof parsed.createdAtIso === 'string' ? parsed.createdAtIso : null;
    seriesState.tests = parsed.tests.map(test => ({
      ...test,
      status: normalizeTestStatus(test?.status)
    }));
    seriesState.activeTestId = typeof parsed.activeTestId === 'string' ? parsed.activeTestId : null;
    seriesState.readyForStart = !!parsed.readyForStart;
    seriesState.overlaySelection = parsed.overlaySelection && typeof parsed.overlaySelection === 'object'
      ? parsed.overlaySelection
      : {};

    const activeTest = getActiveTest();
    if (activeTest && activeTest.samples.length > 0) {
      const latest = activeTest.samples[activeTest.samples.length - 1];
      lastIncomingMode = Number.isFinite(latest.mode) ? latest.mode : MANUAL_MODE_VALUE;
    } else {
      lastIncomingMode = MANUAL_MODE_VALUE;
    }

    setStatus('series_restored_from_storage');
  } catch (_) {
    setStatus('restore_failed_using_empty_state');
  }
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

  if (isLoad) {
    stressCardEl.classList.add('disabled');
  } else {
    stressCardEl.classList.remove('disabled');
  }

  updateStartButtonState();
}

function updateSeriesHeader() {
  if (!seriesState.seriesId) {
    seriesIdLabelEl.textContent = 'No active series';
    return;
  }
  seriesIdLabelEl.textContent = seriesState.seriesId;
}

function getTestStatusClass(status) {
  if (status === 'running') return 'running';
  if (status === 'aborted') return 'aborted';
  return 'finished';
}

function renderSeriesList() {
  seriesListEl.innerHTML = '';

  if (!seriesState.seriesId) {
    seriesEmptyEl.textContent = 'Create a series to begin recording tests.';
    seriesEmptyEl.style.display = 'block';
    return;
  }

  if (seriesState.tests.length === 0) {
    seriesEmptyEl.textContent = 'No tests recorded yet.';
    seriesEmptyEl.style.display = 'block';
    return;
  }

  seriesEmptyEl.style.display = 'none';

  seriesState.tests.forEach((test, idx) => {
    const row = document.createElement('div');
    row.className = 'series-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !!seriesState.overlaySelection[test.id];
    checkbox.disabled = test.id === seriesState.activeTestId || test.samples.length < 2;
    checkbox.addEventListener('change', () => {
      seriesState.overlaySelection[test.id] = checkbox.checked;
      schedulePersistState();
      renderChart();
    });

    const rowMain = document.createElement('div');
    rowMain.className = 'series-row-main';

    const title = document.createElement('div');
    title.className = 'series-row-title';
    title.textContent = `${idx + 1}. ${getTestDisplayLabel(test, idx)}`;

    const sub = document.createElement('div');
    sub.className = 'series-row-sub';
    const maxLoad = test.samples.reduce((highest, sample) => (sample.loadN > highest ? sample.loadN : highest), 0);
    sub.textContent = `${test.meta.testType} | points: ${test.samples.length} | max: ${formatNum(maxLoad, 0)} N`;

    rowMain.appendChild(title);
    rowMain.appendChild(sub);

    const badge = document.createElement('span');
    badge.className = `series-badge ${getTestStatusClass(test.status)}`;
    badge.textContent = test.status;

    row.appendChild(checkbox);
    row.appendChild(rowMain);
    row.appendChild(badge);

    seriesListEl.appendChild(row);
  });
}

function refreshUi() {
  updateSeriesHeader();
  renderSeriesList();
  updateStartButtonState();
  const activeTest = getActiveTest();
  updateMetricsFromTest(activeTest);
  renderChart();
}

function beginNewSeries() {
  const activeTest = getActiveTest();
  if (isRunningTest(activeTest)) {
    setStatus('stop current test before new series');
    return;
  }

  seriesState.seriesId = `series-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  seriesState.createdAtIso = new Date().toISOString();
  seriesState.tests = [];
  seriesState.activeTestId = null;
  seriesState.readyForStart = false;
  seriesState.overlaySelection = {};
  lastIncomingMode = MANUAL_MODE_VALUE;

  clearSampleFieldsForNextTest();
  resetMetricsDisplay();
  setStatus('series_created_press_new_test');
  schedulePersistState();
  refreshUi();
}

async function beginNewTest() {
  if (!seriesState.seriesId) {
    setStatus('create_series_first');
    return;
  }

  const activeTest = getActiveTest();
  if (isRunningTest(activeTest)) {
    setStatus('cannot_new_test_while_running');
    return;
  }

  seriesState.activeTestId = null;
  seriesState.readyForStart = true;
  clearSampleFieldsForNextTest();
  resetMetricsDisplay();
  renderChart();
  schedulePersistState();
  refreshUi();

  if (serialWriter) {
    await sendCommand('M11');
  }
  setStatus('new_test_ready_fill_fields');
}

function createTestFromCurrentInputs() {
  const sampleName = (sampleNameEl.value || '').trim();
  const sampleComment = (sampleCommentEl.value || '').trim();
  const geometry = getGeometryFromInputs();

  return {
    id: makeId('test'),
    startedAtIso: new Date().toISOString(),
    finishedAtIso: null,
    status: 'running',
    completionReason: '',
    meta: {
      sampleName,
      sampleComment,
      testType: geometry.testType,
      speedMmMin: geometry.speedMmMin,
      widthMm: geometry.widthMm,
      heightMm: geometry.heightMm,
      diameterMm: geometry.diameterMm
    },
    samples: []
  };
}

function markActiveTestFinished(reason) {
  const activeTest = getActiveTest();
  if (!isRunningTest(activeTest)) {
    return;
  }

  activeTest.status = reason === 'aborted' ? 'aborted' : 'finished';
  activeTest.finishedAtIso = new Date().toISOString();
  activeTest.completionReason = reason;
  seriesState.readyForStart = false;
  schedulePersistState();
  refreshUi();
}

function appendDataToActiveTest(sample) {
  const activeTest = getActiveTest();
  if (!isRunningTest(activeTest)) {
    return;
  }

  activeTest.samples.push(sample);
  if (activeTest.samples.length > MAX_SAMPLES_PER_TEST) {
    activeTest.samples.shift();
  }

  updateMetricsFromTest(activeTest);
  renderChart();
  schedulePersistState();
}

function applyMachineConfigFromParts(parts) {
  if (parts.length < 9) {
    return;
  }

  const slowMmPerMin = parseFloat(parts[2]);
  const fastMmPerMin = parseFloat(parts[3]);
  const accelMmPerS2 = parseFloat(parts[4]);
  const gain = parseFloat(parts[5]);
  const sampleRateHz = parseFloat(parts[6]);
  const manualSlowMmPerMin = parseFloat(parts[7]);
  const manualFastMmPerMin = parseFloat(parts[8]);

  if (Number.isFinite(accelMmPerS2) && accelInputEl) {
    accelInputEl.value = accelMmPerS2.toFixed(1);
  }

  if (Number.isFinite(gain) && gainInputEl) {
    gainInputEl.value = gain.toFixed(3);
  }

  if (Number.isFinite(sampleRateHz) && sampleRateInputEl) {
    sampleRateInputEl.value = sampleRateHz.toFixed(1);
  }

  if (Number.isFinite(manualSlowMmPerMin) && manualSlowInputEl) {
    manualSlowInputEl.value = manualSlowMmPerMin.toFixed(1);
  }

  if (Number.isFinite(manualFastMmPerMin) && manualFastInputEl) {
    manualFastInputEl.value = manualFastMmPerMin.toFixed(1);
  }

  if (Number.isFinite(slowMmPerMin) && speedInputEl) {
    const roundedSlow = Math.round(slowMmPerMin);
    const allowedSpeedValues = new Set(['1', '2', '5', '10', '50']);
    const roundedSlowString = String(roundedSlow);
    if (allowedSpeedValues.has(roundedSlowString)) {
      speedInputEl.value = roundedSlowString;
    }
  }

  if (Number.isFinite(fastMmPerMin)) {
    setStatus(`machine_config_loaded fast=${fastMmPerMin.toFixed(1)}mm_min`);
  } else {
    setStatus('machine_config_loaded');
  }
}

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;

  const parts = trimmed.split(',');
  const tag = parts[0];

  if (tag === 'DATA' && parts.length >= 7) {
    const timestampMs = parseInt(parts[1], 10);
    const loadN = sanitizeIncomingLoad(parseFloat(parts[2]));
    const stepPos = parseInt(parts[3], 10);
    const displacementMm = parseFloat(parts[4]);
    const mode = parseInt(parts[5], 10);
    const speedSps = parseFloat(parts[6]);

    currentLoadEl.textContent = `${formatNum(loadN, 0)} N`;

    const activeTest = getActiveTest();
    const area = activeTest ? getAreaMm2FromMeta(activeTest.meta) : getCurrentFormAreaMm2();
    const stressMpa = area ? loadN / area : 0;

    appendDataToActiveTest({
      timestampMs,
      loadN,
      stepPos,
      displacementMm,
      stressMpa,
      mode,
      speedSps
    });

    if (TEST_MODE_VALUES.has(lastIncomingMode) && mode === MANUAL_MODE_VALUE) {
      markActiveTestFinished('finished');
      setStatus('test_finished_press_new_test');
    }

    lastIncomingMode = mode;
    return;
  }

  if (tag === 'STATUS' && parts.length >= 4) {
    const code = parts[2];
    const message = parts.slice(3).join(',');
    setStatus(`${code} ${message}`);

    if (code === 'ABORT') {
      markActiveTestFinished('aborted');
    }
    return;
  }

  if (tag === 'ACK' && parts.length >= 4) {
    const command = parts[2];
    const message = parts.slice(3).join(',');
    setStatus(`ACK ${command} ${message}`);

    if (command === 'M11') {
      const activeTest = getActiveTest();
      if (isRunningTest(activeTest)) {
        markActiveTestFinished('aborted');
      }
      lastIncomingMode = MANUAL_MODE_VALUE;
    }
    return;
  }

  if (tag === 'CFG' && parts.length >= 9) {
    applyMachineConfigFromParts(parts);
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
      for (const line of lines) {
        parseLine(line);
      }
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
    updateStartButtonState();
    setStatus('connected');
    readSerialLoop();
    await sendCommand('M50');
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
  updateStartButtonState();
  setStatus('disconnected');
}

async function sendCommand(command) {
  if (!serialWriter) {
    setStatus('not_connected');
    return;
  }
  await serialWriter.write(`${command}\n`);
}

async function sendRelativeMoveMm(deltaMm) {
  if (!Number.isFinite(deltaMm) || deltaMm === 0) {
    return;
  }
  await sendCommand(`M22 ${deltaMm.toFixed(3)}`);
}

function getSeriesExportRows() {
  const rows = [];
  seriesState.tests.forEach((test, index) => {
    const samples = test.samples;
    if (samples.length === 0) {
      return;
    }

    const t0 = samples[0].timestampMs;
    samples.forEach(sample => {
      rows.push([
        seriesState.seriesId,
        test.id,
        index + 1,
        test.status,
        escapeCsv(test.meta.sampleName),
        escapeCsv(test.meta.sampleComment),
        test.meta.testType,
        Number.isFinite(test.meta.speedMmMin) ? test.meta.speedMmMin : '',
        Number.isFinite(test.meta.widthMm) ? test.meta.widthMm : '',
        Number.isFinite(test.meta.heightMm) ? test.meta.heightMm : '',
        Number.isFinite(test.meta.diameterMm) ? test.meta.diameterMm : '',
        sample.timestampMs,
        formatNum((sample.timestampMs - t0) / 1000, 4),
        sample.loadN,
        sample.stepPos,
        sample.displacementMm,
        sample.stressMpa,
        sample.mode,
        sample.speedSps
      ].join(','));
    });
  });

  return rows;
}

function exportSeriesCsv() {
  if (!seriesState.seriesId) {
    setStatus('create_series_first');
    return;
  }

  const rows = getSeriesExportRows();
  if (rows.length === 0) {
    setStatus('no_data_to_export');
    return;
  }

  const header = [
    'series_id',
    'test_id',
    'test_index',
    'test_status',
    'sample_name',
    'comment',
    'test_type',
    'speed_mm_per_min',
    'width_mm',
    'height_mm',
    'diameter_mm',
    'timestamp_ms',
    'relative_time_s',
    'load_N',
    'step_position',
    'displacement_mm',
    'stress_MPa',
    'mode',
    'speed_steps_per_s'
  ].join(',');

  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  link.href = url;
  link.download = `${seriesState.seriesId}_${stamp}.csv`;
  link.click();

  URL.revokeObjectURL(url);
  setStatus('series_csv_exported');
}

connectBtn.addEventListener('click', async () => {
  if (serialPort) await disconnectSerial();
  else await connectSerial();
});

newSeriesBtn.addEventListener('click', beginNewSeries);
newTestBtn.addEventListener('click', beginNewTest);

startTestBtn.addEventListener('click', async () => {
  const errors = getValidationErrors();
  if (errors.length > 0) {
    setStatus(errors[0]);
    updateStartButtonState();
    return;
  }

  if (!serialWriter) {
    setStatus('not_connected');
    return;
  }

  const speed = parseFloat(speedInputEl.value);
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1.0;
  const roundedSpeed = Number(safeSpeed.toFixed(1));
  speedInputEl.value = String(roundedSpeed);

  const accelMmPerS2 = getConfiguredAccelerationMmPerS2();
  if (accelMmPerS2 === null) {
    setStatus('invalid_accel');
    return;
  }

  const test = createTestFromCurrentInputs();
  test.meta.speedMmMin = roundedSpeed;

  seriesState.tests.push(test);
  seriesState.activeTestId = test.id;
  seriesState.readyForStart = false;
  seriesState.overlaySelection[test.id] = false;
  lastIncomingMode = MANUAL_MODE_VALUE;

  schedulePersistState();
  refreshUi();

  await sendCommand('M12');
  await sendCommand(`M42 ${accelMmPerS2.toFixed(1)}`);
  await sendCommand(`M40 ${roundedSpeed.toFixed(1)}`);
  await sendCommand('M10');
  setStatus('test_started');
});

if (manualStopBtn) {
  manualStopBtn.addEventListener('click', async () => {
    await sendCommand('M11');
    setStatus('manual_stop');
  });
}

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

if (setAccelBtn && accelInputEl) {
  setAccelBtn.addEventListener('click', async () => {
    const accelMmPerS2 = getConfiguredAccelerationMmPerS2();
    if (accelMmPerS2 === null) {
      setStatus('invalid_accel');
      return;
    }
    await sendCommand(`M42 ${accelMmPerS2.toFixed(1)}`);
  });
}

if (setSampleRateBtn && sampleRateInputEl) {
  setSampleRateBtn.addEventListener('click', async () => {
    const sampleRateHz = getConfiguredPositiveNumber(sampleRateInputEl, 1);
    if (sampleRateHz === null) {
      setStatus('invalid_sample_rate');
      return;
    }
    await sendCommand(`M44 ${sampleRateHz.toFixed(1)}`);
  });
}

if (setManualSlowBtn && manualSlowInputEl) {
  setManualSlowBtn.addEventListener('click', async () => {
    const manualSlowMmPerMin = getConfiguredPositiveNumber(manualSlowInputEl, 1);
    if (manualSlowMmPerMin === null) {
      setStatus('invalid_manual_slow_speed');
      return;
    }
    await sendCommand(`M45 ${manualSlowMmPerMin.toFixed(1)}`);
  });
}

if (setManualFastBtn && manualFastInputEl) {
  setManualFastBtn.addEventListener('click', async () => {
    const manualFastMmPerMin = getConfiguredPositiveNumber(manualFastInputEl, 1);
    if (manualFastMmPerMin === null) {
      setStatus('invalid_manual_fast_speed');
      return;
    }
    await sendCommand(`M46 ${manualFastMmPerMin.toFixed(1)}`);
  });
}

[
  [jogPlus10Btn, 10],
  [jogPlus1Btn, 1],
  [jogPlus01Btn, 0.1],
  [jogMinus01Btn, -0.1],
  [jogMinus1Btn, -1],
  [jogMinus10Btn, -10]
].forEach(([buttonEl, deltaMm]) => {
  if (!buttonEl) {
    return;
  }
  buttonEl.addEventListener('click', async () => {
    await sendRelativeMoveMm(deltaMm);
  });
});

testTypeEl.addEventListener('change', () => {
  applyTestTypeUiState();
  updateStartButtonState();
});

[speedInputEl, widthInputEl, heightInputEl, diameterInputEl, sampleNameEl].forEach(el => {
  el.addEventListener('input', updateStartButtonState);
});

window.addEventListener('resize', renderChart);
window.addEventListener('beforeunload', persistStateNow);

exportBtn.addEventListener('click', exportSeriesCsv);

restoreStateFromStorage();
setConnectionBadge(false);
applyTestTypeUiState();
refreshUi();
if (!seriesState.seriesId) {
  setStatus('ready_create_series');
}
