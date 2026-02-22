const connectBtn = document.getElementById('connectBtn');
const emergencyStopBtn = document.getElementById('emergencyStopBtn');
const connectionState = document.getElementById('connectionState');
const statusLine = document.getElementById('statusLine');
const serialMonitorEl = document.getElementById('serialMonitor');

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
const sampleModalEl = document.getElementById('sampleModal');
const sampleModalCancelBtn = document.getElementById('sampleModalCancelBtn');
const sampleModalSaveBtn = document.getElementById('sampleModalSaveBtn');
const sampleSummaryNameEl = document.getElementById('sampleSummaryName');
const sampleSummaryTypeEl = document.getElementById('sampleSummaryType');
const sampleSummaryGeometryEl = document.getElementById('sampleSummaryGeometry');
const preloadInputEl = document.getElementById('preloadInput');
const alphaInputEl = document.getElementById('alphaInput');
const sampleRateInputEl = document.getElementById('sampleRateInput');
const autoBreakInputEl = document.getElementById('autoBreakInput');
const tareAfterBreakInputEl = document.getElementById('tareAfterBreakInput');
const pinLastTestInputEl = document.getElementById('pinLastTestInput');
const yAxisModeInputEl = document.getElementById('yAxisModeInput');
const xAxisModeInputEl = document.getElementById('xAxisModeInput');
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
const cleanExportBtn = document.getElementById('cleanExportBtn');
const fullExportBtn = document.getElementById('fullExportBtn');
const setPreloadBtn = document.getElementById('setPreloadBtn');
const setAlphaBtn = document.getElementById('setAlphaBtn');
const setSampleRateBtn = document.getElementById('setSampleRateBtn');
const setAutoBreakBtn = document.getElementById('setAutoBreakBtn');
const setTareAfterBreakBtn = document.getElementById('setTareAfterBreakBtn');
const setManualSlowBtn = document.getElementById('setManualSlowBtn');
const setManualFastBtn = document.getElementById('setManualFastBtn');
const setAccelBtn = document.getElementById('setAccelBtn');
const armGainBtn = document.getElementById('armGainBtn');
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
const MAX_SERIAL_MONITOR_LINES = 250;
const BREAK_TAIL_SAMPLES = 2;
const BREAK_TAIL_TIMEOUT_MS = 1000;
const DEFAULT_CHART_PREFERENCES = {
  pinLastTestOverlay: true,
  yAxisMode: 'force',
  xAxisMode: 'time'
};

let serialPort = null;
let serialReader = null;
let serialWriter = null;
let readerActive = false;
let readableStreamClosed = null;
let writableStreamClosed = null;

let persistTimeoutId = null;
let lastIncomingMode = MANUAL_MODE_VALUE;
let lastAcceptedLoadN = null;
let serialMonitorLines = [];
let configSyncTimeoutId = null;
let hasReceivedMachineData = false;
let breakTailFinalizeTimeoutId = null;
let gainUiUnlockReadyAtMs = 0;
let gainUiUnlockDeadlineMs = 0;
let gainUiUnlockTimerId = null;

const configSetBindings = [
  { command: 'M47', inputEl: preloadInputEl, buttonEl: setPreloadBtn, appliedValue: '' },
  { command: 'M48', inputEl: alphaInputEl, buttonEl: setAlphaBtn, appliedValue: '' },
  { command: 'M49', inputEl: autoBreakInputEl, buttonEl: setAutoBreakBtn, appliedValue: '' },
  { command: 'M51', inputEl: tareAfterBreakInputEl, buttonEl: setTareAfterBreakBtn, appliedValue: '' },
  { command: 'M44', inputEl: sampleRateInputEl, buttonEl: setSampleRateBtn, appliedValue: '' },
  { command: 'M45', inputEl: manualSlowInputEl, buttonEl: setManualSlowBtn, appliedValue: '' },
  { command: 'M46', inputEl: manualFastInputEl, buttonEl: setManualFastBtn, appliedValue: '' },
  { command: 'M42', inputEl: accelInputEl, buttonEl: setAccelBtn, appliedValue: '' },
  { command: 'M43', inputEl: gainInputEl, buttonEl: setGainBtn, appliedValue: '' }
].filter(binding => binding.inputEl && binding.buttonEl);

const configBindingByCommand = Object.fromEntries(configSetBindings.map(binding => [binding.command, binding]));

const seriesState = {
  version: 1,
  seriesId: null,
  createdAtIso: null,
  tests: [],
  activeTestId: null,
  readyForStart: false,
  overlaySelection: {},
  chartPreferences: { ...DEFAULT_CHART_PREFERENCES }
};

function getChartPreferences() {
  return {
    pinLastTestOverlay: !!seriesState.chartPreferences?.pinLastTestOverlay,
    yAxisMode: seriesState.chartPreferences?.yAxisMode === 'stress' ? 'stress' : 'force',
    xAxisMode: seriesState.chartPreferences?.xAxisMode === 'displacement' ? 'displacement' : 'time'
  };
}

function applyChartPreferenceControls() {
  const prefs = getChartPreferences();
  if (pinLastTestInputEl) {
    pinLastTestInputEl.value = prefs.pinLastTestOverlay ? '1' : '0';
  }
  if (yAxisModeInputEl) {
    yAxisModeInputEl.value = prefs.yAxisMode;
  }
  if (xAxisModeInputEl) {
    xAxisModeInputEl.value = prefs.xAxisMode;
  }
}

function getSampleXValue(test, sample, xAxisMode, xBaseline) {
  if (xAxisMode === 'displacement') {
    return sample.displacementMm - xBaseline;
  }
  return (sample.timestampMs - xBaseline) / 1000;
}

function getSampleYValue(test, sample, yAxisMode) {
  if (yAxisMode === 'stress') {
    const area = getAreaMm2FromMeta(test.meta);
    if (Number.isFinite(area) && area > 0) {
      return sample.loadN / area;
    }
  }
  return sample.loadN;
}

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

function getConfigComparableValue(inputEl) {
  if (!inputEl) {
    return '';
  }

  if (inputEl.tagName === 'SELECT') {
    return String(inputEl.value ?? '');
  }

  if (inputEl.type === 'number') {
    const parsed = parseFlexibleNumber(inputEl.value);
    if (!Number.isFinite(parsed)) {
      return '';
    }
    return String(Number(parsed.toFixed(4)));
  }

  return String(inputEl.value ?? '').trim();
}

function setConfigPendingState(binding, isPending) {
  if (!binding?.buttonEl) {
    return;
  }
  binding.buttonEl.classList.toggle('pending-set', !!isPending);
}

function updateConfigPendingState(binding) {
  if (!binding?.inputEl) {
    return;
  }
  const current = getConfigComparableValue(binding.inputEl);
  setConfigPendingState(binding, current !== binding.appliedValue);
}

function markConfigBindingApplied(binding) {
  if (!binding?.inputEl) {
    return;
  }
  binding.appliedValue = getConfigComparableValue(binding.inputEl);
  setConfigPendingState(binding, false);
}

function markConfigAppliedByCommand(command) {
  const binding = configBindingByCommand[command];
  if (!binding) {
    return;
  }
  markConfigBindingApplied(binding);
}

function initializeConfigPendingTracking() {
  configSetBindings.forEach(binding => {
    binding.appliedValue = getConfigComparableValue(binding.inputEl);
    setConfigPendingState(binding, false);

    const refreshPending = () => updateConfigPendingState(binding);
    binding.inputEl.addEventListener('input', refreshPending);
    binding.inputEl.addEventListener('change', refreshPending);
  });
}

function updateGainButtonLockState() {
  if (!setGainBtn) {
    return;
  }

  const nowMs = Date.now();
  const waitRemainingMs = gainUiUnlockReadyAtMs - nowMs;
  const activeRemainingMs = gainUiUnlockDeadlineMs - nowMs;

  if (waitRemainingMs > 0) {
    if (gainInputEl) {
      gainInputEl.disabled = true;
    }
    setGainBtn.disabled = true;
    const waitSec = Math.max(1, Math.ceil(waitRemainingMs / 1000));
    setGainBtn.textContent = `Set Gain (Wait ${waitSec}s)`;
    return;
  }

  if (gainInputEl) {
    gainInputEl.disabled = false;
  }

  const unlocked = activeRemainingMs > 0;
  setGainBtn.disabled = !unlocked;

  if (!unlocked) {
    setGainBtn.textContent = 'Set Gain (Locked)';
    return;
  }

  const remainingSec = Math.max(1, Math.ceil(activeRemainingMs / 1000));
  setGainBtn.textContent = `Set Gain (${remainingSec}s)`;
}

function clearGainUiUnlock() {
  gainUiUnlockReadyAtMs = 0;
  gainUiUnlockDeadlineMs = 0;
  if (gainUiUnlockTimerId) {
    clearInterval(gainUiUnlockTimerId);
    gainUiUnlockTimerId = null;
  }
  updateGainButtonLockState();
}

function startGainUiUnlockWindow(waitMs = 30000, activeMs = 30000) {
  gainUiUnlockReadyAtMs = Date.now() + waitMs;
  gainUiUnlockDeadlineMs = gainUiUnlockReadyAtMs + activeMs;
  if (gainUiUnlockTimerId) {
    clearInterval(gainUiUnlockTimerId);
  }
  gainUiUnlockTimerId = setInterval(() => {
    if (gainUiUnlockDeadlineMs <= Date.now()) {
      clearGainUiUnlock();
      return;
    }
    updateGainButtonLockState();
  }, 250);
  updateGainButtonLockState();
}

function scheduleMachineConfigSync() {
  if (configSyncTimeoutId) {
    clearTimeout(configSyncTimeoutId);
    configSyncTimeoutId = null;
  }

  configSyncTimeoutId = setTimeout(async () => {
    configSyncTimeoutId = null;
    if (!serialWriter) {
      return;
    }
    await sendCommand('M50');

    setTimeout(async () => {
      if (serialWriter) {
        await sendCommand('M50');
      }
    }, 1200);
  }, 1200);
}

function appendSerialMonitorLine(line) {
  if (!serialMonitorEl) {
    return;
  }

  const normalized = String(line ?? '').replace(/\r/g, '');
  if (!normalized) {
    return;
  }

  serialMonitorLines.push(normalized);
  if (serialMonitorLines.length > MAX_SERIAL_MONITOR_LINES) {
    serialMonitorLines = serialMonitorLines.slice(serialMonitorLines.length - MAX_SERIAL_MONITOR_LINES);
  }

  serialMonitorEl.textContent = serialMonitorLines.join('\n');
  serialMonitorEl.scrollTop = serialMonitorEl.scrollHeight;
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

function parseFlexibleNumber(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return NaN;
  }

  const normalized = String(rawValue)
    .trim()
    .replace(',', '.')
    .replace(/[^0-9eE+\-.]/g, '');

  return parseFloat(normalized);
}

function normalizeDecimalInput(inputEl) {
  if (!inputEl) {
    return;
  }

  const normalizeValue = () => {
    const current = String(inputEl.value ?? '');
    if (!current.includes(',')) {
      return;
    }
    inputEl.value = current.replace(/,/g, '.');
  };

  inputEl.addEventListener('input', normalizeValue);
  inputEl.addEventListener('change', normalizeValue);

  inputEl.addEventListener('keydown', event => {
    if (event.key !== ',') {
      return;
    }

    event.preventDefault();
    inputEl.value = `${inputEl.value}.`;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function initializeDecimalInputNormalization() {
  [
    widthInputEl,
    heightInputEl,
    diameterInputEl,
    preloadInputEl,
    alphaInputEl,
    sampleRateInputEl,
    manualSlowInputEl,
    manualFastInputEl,
    accelInputEl,
    gainInputEl
  ].forEach(normalizeDecimalInput);
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
  const speedMmMin = parseFlexibleNumber(speedInputEl.value);
  const widthMm = parseFlexibleNumber(widthInputEl.value);
  const thicknessMm = parseFlexibleNumber(heightInputEl.value);
  const diameterMm = parseFlexibleNumber(diameterInputEl.value);

  return {
    testType,
    speedMmMin,
    widthMm,
    thicknessMm,
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

  const thicknessMm = Number.isFinite(meta.thicknessMm) ? meta.thicknessMm : meta.heightMm;

  if (!Number.isFinite(meta.widthMm) || !Number.isFinite(thicknessMm) || meta.widthMm <= 0 || thicknessMm <= 0) {
    return null;
  }

  return meta.widthMm * thicknessMm;
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
    errors.push('press New Sample before START TEST');
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
    if (!Number.isFinite(meta.thicknessMm) || meta.thicknessMm <= 0) {
      errors.push('valid thickness required');
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
  const accel = parseFlexibleNumber(accelInputEl?.value);
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
  const value = parseFlexibleNumber(inputEl?.value);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  const rounded = Number(value.toFixed(decimals));
  if (inputEl) {
    inputEl.value = rounded.toFixed(decimals);
  }
  return rounded;
}

function clearGeometryFieldsForNextTest() {
  widthInputEl.value = '';
  heightInputEl.value = '';
  diameterInputEl.value = '';
  renderSampleSummary();
}

function resetSampleDraftInputs() {
  sampleNameEl.value = '';
  sampleCommentEl.value = '';
  clearGeometryFieldsForNextTest();
}

function openSampleModal() {
  if (!sampleModalEl) {
    return;
  }
  sampleModalEl.classList.add('open');
  sampleModalEl.setAttribute('aria-hidden', 'false');
  if (sampleNameEl) {
    sampleNameEl.focus();
    sampleNameEl.select();
  }
}

function formatSummaryNumber(value) {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return Number(value.toFixed(2)).toString();
}

function renderSampleSummary() {
  if (!sampleSummaryNameEl || !sampleSummaryTypeEl || !sampleSummaryGeometryEl) {
    return;
  }

  const meta = getGeometryFromInputs();
  const sampleName = (sampleNameEl.value || '').trim();
  const sampleTypeLabel =
    meta.testType === 'rectangular' ? 'Rectangular' :
      meta.testType === 'cylindrical' ? 'Cylindrical' :
        meta.testType === 'load' ? 'Load Test' : '-';

  sampleSummaryNameEl.textContent = `Name: ${sampleName || '-'}`;
  sampleSummaryTypeEl.textContent = `Type: ${sampleTypeLabel}`;

  if (meta.testType === 'load') {
    sampleSummaryGeometryEl.textContent = 'n/a (load test)';
    return;
  }

  if (meta.testType === 'cylindrical') {
    sampleSummaryGeometryEl.textContent = `Diameter ${formatSummaryNumber(meta.diameterMm)} mm`;
    return;
  }

  sampleSummaryGeometryEl.textContent = `Width ${formatSummaryNumber(meta.widthMm)} mm, Thickness ${formatSummaryNumber(meta.thicknessMm)} mm`;
}

function closeSampleModal() {
  if (!sampleModalEl) {
    return;
  }
  sampleModalEl.classList.remove('open');
  sampleModalEl.setAttribute('aria-hidden', 'true');
}

function getSampleSetupValidationErrors() {
  const errors = [];
  const sampleName = (sampleNameEl.value || '').trim();
  const meta = getGeometryFromInputs();

  if (!sampleName) {
    errors.push('sample name required');
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
    if (!Number.isFinite(meta.thicknessMm) || meta.thicknessMm <= 0) {
      errors.push('valid thickness required');
    }
  }

  return errors;
}

function persistCommentToCurrentTest() {
  const activeTest = getActiveTest();
  if (!activeTest || !activeTest.meta) {
    return;
  }

  const nextComment = (sampleCommentEl.value || '').trim();
  if ((activeTest.meta.sampleComment || '') === nextComment) {
    return;
  }

  activeTest.meta.sampleComment = nextComment;
  schedulePersistState();
}

function prepareNewTestFromModal() {
  const errors = getSampleSetupValidationErrors();
  if (errors.length > 0) {
    setStatus(errors[0]);
    return;
  }

  seriesState.readyForStart = true;
  closeSampleModal();
  renderSampleSummary();
  schedulePersistState();
  updateStartButtonState();
  setStatus('new_sample_ready_press_start');
}

function resetMetricsDisplay() {
  if (!hasReceivedMachineData) {
    currentLoadEl.textContent = '-';
    currentDispEl.textContent = '-';
    currentStressEl.textContent = '-';
    maxLoadEl.textContent = '0 N';
    maxStressEl.textContent = '-';
    stressCardEl.classList.toggle('disabled', testTypeEl.value === 'load');
    return;
  }

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
  if (status === 'manual_stop') {
    return 'manual_stopped';
  }
  if (status === 'aborded') {
    return 'manual_stopped';
  }
  if (status === 'aborted') {
    return 'manual_stopped';
  }
  if (
    status === 'running' ||
    status === 'finished' ||
    status === 'break_detected' ||
    status === 'manual_stopped' ||
    status === 'failed'
  ) {
    return status;
  }
  return 'finished';
}

function mapCompletionReasonToStatus(reason) {
  if (reason === 'break_detected') {
    return 'break_detected';
  }
  if (reason === 'manual_stopped') {
    return 'manual_stopped';
  }
  if (reason === 'failed') {
    return 'failed';
  }
  if (reason === 'aborted') {
    return 'manual_stopped';
  }
  return 'finished';
}

function getStatusLabel(status) {
  if (status === 'break_detected') return 'BREAK DETECTED';
  if (status === 'manual_stopped') return 'MANUAL STOP';
  if (status === 'failed') return 'FAILED';
  if (status === 'running') return 'RUNNING';
  if (status === 'finished') return 'FINISHED';
  return String(status || '').replaceAll('_', ' ').toUpperCase();
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
  if (!hasReceivedMachineData) {
    resetMetricsDisplay();
    return;
  }

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
  const chartPreferences = getChartPreferences();
  const xAxisMode = chartPreferences.xAxisMode;
  const yAxisMode = chartPreferences.yAxisMode;
  const yAxisLabel = yAxisMode === 'stress' ? 'Stress (MPa)' : 'Force (N)';
  const xAxisLabel = xAxisMode === 'displacement' ? 'Displacement (mm)' : 'Time (s)';

  const seriesEntries = getVisibleChartSeries();
  let xMax = 1;
  let yMax = 1;

  seriesEntries.forEach(entry => {
    const samples = entry.test.samples;
    const xBaseline = xAxisMode === 'displacement' ? samples[0].displacementMm : samples[0].timestampMs;

    samples.forEach(sample => {
      const sampleX = getSampleXValue(entry.test, sample, xAxisMode, xBaseline);
      const sampleY = getSampleYValue(entry.test, sample, yAxisMode);
      if (sampleX > xMax) xMax = sampleX;
      if (sampleY > yMax) yMax = sampleY;
    });
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
    const yAxisValue = ratio * yMax;

    ctx.beginPath();
    ctx.moveTo(plotX, y);
    ctx.lineTo(plotX + plotW, y);
    ctx.stroke();

    ctx.fillText(formatNum(yAxisValue, yAxisValue >= 100 ? 0 : 1), 6, y + 4);
  }

  for (let i = 0; i <= xTicks; i += 1) {
    const ratio = i / xTicks;
    const x = plotX + ratio * plotW;
    const xAxisValue = ratio * xMax;

    ctx.beginPath();
    ctx.moveTo(x, plotY);
    ctx.lineTo(x, plotY + plotH);
    ctx.stroke();

    ctx.fillText(formatNum(xAxisValue, xAxisValue >= 10 ? 0 : 1), x - 10, plotY + plotH + 16);
  }

  ctx.fillText(yAxisLabel, 8, plotY - 6);
  ctx.fillText(xAxisLabel, plotX + plotW - 100, plotY + plotH + 32);

  if (seriesEntries.length === 0) {
    return;
  }

  seriesEntries.forEach(entry => {
    const samples = entry.test.samples;
    const xBaseline = xAxisMode === 'displacement' ? samples[0].displacementMm : samples[0].timestampMs;
    const originX = plotX;
    const originY = plotY + plotH;

    ctx.beginPath();
    ctx.moveTo(originX, originY);
    let lastX = originX;

    samples.forEach(sample => {
      const sampleX = getSampleXValue(entry.test, sample, xAxisMode, xBaseline);
      const sampleY = getSampleYValue(entry.test, sample, yAxisMode);
      const x = plotX + (xMax > 0 ? (sampleX / xMax) * plotW : 0);
      const y = plotY + plotH - (sampleY / yMax) * plotH;
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
      const sampleX = getSampleXValue(entry.test, sample, xAxisMode, xBaseline);
      const sampleY = getSampleYValue(entry.test, sample, yAxisMode);
      const x = plotX + (xMax > 0 ? (sampleX / xMax) * plotW : 0);
      const y = plotY + plotH - (sampleY / yMax) * plotH;
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
    seriesState.tests = parsed.tests.map(test => {
      const meta = test?.meta && typeof test.meta === 'object' ? test.meta : {};
      const thicknessMm = Number.isFinite(meta.thicknessMm) ? meta.thicknessMm : meta.heightMm;

      return {
        ...test,
        meta: {
          ...meta,
          thicknessMm
        },
        status: normalizeTestStatus(test?.status)
      };
    });
    seriesState.activeTestId = typeof parsed.activeTestId === 'string' ? parsed.activeTestId : null;
    seriesState.readyForStart = !!parsed.readyForStart;
    seriesState.overlaySelection = parsed.overlaySelection && typeof parsed.overlaySelection === 'object'
      ? parsed.overlaySelection
      : {};
    seriesState.chartPreferences = {
      ...DEFAULT_CHART_PREFERENCES,
      ...(parsed.chartPreferences && typeof parsed.chartPreferences === 'object' ? parsed.chartPreferences : {})
    };
    applyChartPreferenceControls();

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

  renderSampleSummary();
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
  if (status === 'break_detected') return 'break-detected';
  if (status === 'manual_stopped') return 'manual-stopped';
  if (status === 'failed') return 'failed';
  if (status === 'aborted') return 'manual-stopped';
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

  const totalTests = seriesState.tests.length;
  const testsNewestFirst = [...seriesState.tests].reverse();

  testsNewestFirst.forEach((test, reverseIdx) => {
    const originalIdx = totalTests - 1 - reverseIdx;
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
    title.textContent = `${originalIdx + 1}. ${getTestDisplayLabel(test, originalIdx)}`;

    const sub = document.createElement('div');
    sub.className = 'series-row-sub';
    const maxLoad = test.samples.reduce((highest, sample) => (sample.loadN > highest ? sample.loadN : highest), 0);
    sub.textContent = `${test.meta.testType} | points: ${test.samples.length} | max: ${formatNum(maxLoad, 0)} N`;

    rowMain.appendChild(title);
    rowMain.appendChild(sub);

    const badge = document.createElement('span');
    badge.className = `series-badge ${getTestStatusClass(test.status)}`;
    badge.textContent = getStatusLabel(test.status);

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

  const confirmed = window.confirm('Create a new series? This will clear all saved tests in the current series.');
  if (!confirmed) {
    setStatus('new_series_cancelled');
    return;
  }

  seriesState.seriesId = `series-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  seriesState.createdAtIso = new Date().toISOString();
  seriesState.tests = [];
  seriesState.activeTestId = null;
  seriesState.readyForStart = false;
  seriesState.overlaySelection = {};
  lastIncomingMode = MANUAL_MODE_VALUE;

  resetSampleDraftInputs();
  closeSampleModal();
  resetMetricsDisplay();
  setStatus('series_created_press_new_sample');
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
  seriesState.readyForStart = false;
  clearGeometryFieldsForNextTest();
  applyTestTypeUiState();
  resetMetricsDisplay();
  renderChart();
  schedulePersistState();
  refreshUi();

  if (serialWriter) {
    await sendCommand('M11');
  }
  openSampleModal();
  setStatus('new_sample_fill_popup');
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
    pendingStart: true,
    completionReason: '',
    meta: {
      sampleName,
      sampleComment,
      testType: geometry.testType,
      speedMmMin: geometry.speedMmMin,
      widthMm: geometry.widthMm,
      thicknessMm: geometry.thicknessMm,
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

  if (breakTailFinalizeTimeoutId) {
    clearTimeout(breakTailFinalizeTimeoutId);
    breakTailFinalizeTimeoutId = null;
  }

  if (activeTest) {
    delete activeTest.pendingBreakTailSamples;
  }

  activeTest.status = mapCompletionReasonToStatus(reason);
  activeTest.finishedAtIso = new Date().toISOString();
  activeTest.completionReason = reason;
  seriesState.readyForStart = false;
  schedulePersistState();
  refreshUi();
}

function scheduleBreakTailFinalize() {
  const activeTest = getActiveTest();
  if (!isRunningTest(activeTest)) {
    return;
  }

  activeTest.pendingBreakTailSamples = BREAK_TAIL_SAMPLES;

  if (breakTailFinalizeTimeoutId) {
    clearTimeout(breakTailFinalizeTimeoutId);
  }

  breakTailFinalizeTimeoutId = setTimeout(() => {
    breakTailFinalizeTimeoutId = null;
    const runningTest = getActiveTest();
    if (!isRunningTest(runningTest)) {
      return;
    }
    markActiveTestFinished('break_detected');
  }, BREAK_TAIL_TIMEOUT_MS);
}

function appendDataToActiveTest(sample) {
  const activeTest = getActiveTest();
  if (!isRunningTest(activeTest)) {
    return;
  }

  if (activeTest.pendingStart) {
    if (!TEST_MODE_VALUES.has(sample.mode)) {
      return;
    }
    activeTest.pendingStart = false;
    activeTest.startedAtIso = new Date().toISOString();
  }

  activeTest.samples.push(sample);
  if (activeTest.samples.length > MAX_SAMPLES_PER_TEST) {
    activeTest.samples.shift();
  }

  if (Number.isFinite(activeTest.pendingBreakTailSamples) && activeTest.pendingBreakTailSamples > 0) {
    activeTest.pendingBreakTailSamples -= 1;
    if (activeTest.pendingBreakTailSamples <= 0) {
      markActiveTestFinished('break_detected');
      return;
    }
  }

  updateMetricsFromTest(activeTest);
  renderChart();
  schedulePersistState();
}

function applyMachineConfigFromParts(parts) {
  if (parts.length < 11) {
    return;
  }

  const slowMmPerMin = parseFlexibleNumber(parts[2]);
  const fastMmPerMin = parseFlexibleNumber(parts[3]);
  const accelMmPerS2 = parseFlexibleNumber(parts[4]);
  const gain = parseFlexibleNumber(parts[5]);
  const sampleRateHz = parseFlexibleNumber(parts[6]);
  const manualSlowMmPerMin = parseFlexibleNumber(parts[7]);
  const manualFastMmPerMin = parseFlexibleNumber(parts[8]);
  const preloadN = parseFlexibleNumber(parts[9]);
  const alpha = parseFlexibleNumber(parts[10]);
  const autoBreakEnabled = parseInt(parts[11], 10);
  const tareAfterBreakEnabled = parseInt(parts[12], 10);

  if (Number.isFinite(preloadN) && preloadInputEl) {
    preloadInputEl.value = preloadN.toFixed(1);
    markConfigAppliedByCommand('M47');
  }

  if (Number.isFinite(alpha) && alphaInputEl && alpha > 0 && alpha <= 1) {
    alphaInputEl.value = alpha.toFixed(2);
    markConfigAppliedByCommand('M48');
  }

  if (Number.isFinite(accelMmPerS2) && accelInputEl) {
    accelInputEl.value = accelMmPerS2.toFixed(1);
    markConfigAppliedByCommand('M42');
  }

  if (Number.isFinite(gain) && gainInputEl) {
    gainInputEl.value = gain.toFixed(3);
    markConfigAppliedByCommand('M43');
  }

  if (Number.isFinite(sampleRateHz) && sampleRateInputEl) {
    sampleRateInputEl.value = sampleRateHz.toFixed(1);
    markConfigAppliedByCommand('M44');
  }

  if (autoBreakInputEl && (autoBreakEnabled === 0 || autoBreakEnabled === 1)) {
    autoBreakInputEl.value = String(autoBreakEnabled);
    markConfigAppliedByCommand('M49');
  }

  if (tareAfterBreakInputEl && (tareAfterBreakEnabled === 0 || tareAfterBreakEnabled === 1)) {
    tareAfterBreakInputEl.value = String(tareAfterBreakEnabled);
    markConfigAppliedByCommand('M51');
  }

  if (Number.isFinite(manualSlowMmPerMin) && manualSlowInputEl) {
    manualSlowInputEl.value = manualSlowMmPerMin.toFixed(1);
    markConfigAppliedByCommand('M45');
  }

  if (Number.isFinite(manualFastMmPerMin) && manualFastInputEl) {
    manualFastInputEl.value = manualFastMmPerMin.toFixed(1);
    markConfigAppliedByCommand('M46');
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
    hasReceivedMachineData = true;
    const timestampMs = parseInt(parts[1], 10);
    const loadN = sanitizeIncomingLoad(parseFloat(parts[2]));
    const stepPos = parseInt(parts[3], 10);
    const displacementMm = parseFloat(parts[4]);
    const mode = parseInt(parts[5], 10);
    const speedSps = parseFloat(parts[6]);

    currentLoadEl.textContent = `${formatNum(loadN, 0)} N`;
  currentDispEl.textContent = `${formatNum(displacementMm, 2)} mm`;

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
      const activeTest = getActiveTest();
      if (isRunningTest(activeTest) && Number.isFinite(activeTest.pendingBreakTailSamples) && activeTest.pendingBreakTailSamples > 0) {
        markActiveTestFinished('break_detected');
      } else {
        markActiveTestFinished('finished');
      }
      setStatus('test_finished_press_new_test');
    }

    lastIncomingMode = mode;
    return;
  }

  if (tag === 'STATUS' && parts.length >= 4) {
    const code = parts[2];
    const message = parts.slice(3).join(',');
    setStatus(`${code} ${message}`);

    if (code === 'BOOT') {
      scheduleMachineConfigSync();
    }

    if (code === 'ABORT') {
      markActiveTestFinished(message === 'emergency_stop' ? 'failed' : 'manual_stopped');
    }

    if (code === 'DONE' && message === 'specimen_break_detected') {
      scheduleBreakTailFinalize();
      setStatus('break_detected_capturing_tail_samples');
    }
    return;
  }

  if (tag === 'ACK' && parts.length >= 4) {
    const command = parts[2];
    const message = parts.slice(3).join(',');
    setStatus(`ACK ${command} ${message}`);

    if (command === 'M53' && message === 'gain_set_wait_30s_then_30s_window') {
      startGainUiUnlockWindow(30000, 30000);
    }

    if (command === 'M43' && message === 'gain_set') {
      clearGainUiUnlock();
    }

    markConfigAppliedByCommand(command);

    if (command === 'M11') {
      const activeTest = getActiveTest();
      if (isRunningTest(activeTest)) {
        markActiveTestFinished('manual_stopped');
      }
      lastIncomingMode = MANUAL_MODE_VALUE;
    }

    if (command === 'M15') {
      const activeTest = getActiveTest();
      if (isRunningTest(activeTest)) {
        markActiveTestFinished('failed');
      }
      lastIncomingMode = MANUAL_MODE_VALUE;
    }
    return;
  }

  if (tag === 'CFG' && parts.length >= 13) {
    applyMachineConfigFromParts(parts);
    return;
  }

  setStatus(trimmed);
}

async function readSerialLoop() {
  let textBuffer = '';
  readerActive = true;
  appendSerialMonitorLine('[read] serial loop started');

  try {
    while (readerActive && serialReader) {
      const { value, done } = await serialReader.read();
      if (done) break;
      if (!value) continue;

      textBuffer += value;
      const lines = textBuffer.split('\n');
      textBuffer = lines.pop() || '';
      for (const line of lines) {
        appendSerialMonitorLine(line);
        parseLine(line);
      }
    }
  } catch (error) {
    appendSerialMonitorLine(`[read_error] ${error.message}`);
    setStatus(`read_error ${error.message}`);
  } finally {
    appendSerialMonitorLine('[read] serial loop stopped');
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
    appendSerialMonitorLine('[port] connected');
    readSerialLoop();
    scheduleMachineConfigSync();
  } catch (error) {
    appendSerialMonitorLine(`[connect_error] ${error.message}`);
    setStatus(`connect_error ${error.message}`);
  }
}

async function disconnectSerial() {
  readerActive = false;

  if (configSyncTimeoutId) {
    clearTimeout(configSyncTimeoutId);
    configSyncTimeoutId = null;
  }

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
  clearGainUiUnlock();
  setConnectionBadge(false);
  updateStartButtonState();
  appendSerialMonitorLine('[port] disconnected');
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
    const thicknessMm = Number.isFinite(test.meta.thicknessMm) ? test.meta.thicknessMm : test.meta.heightMm;
    const safeSampleName = sanitizeSpreadsheetText(test.meta.sampleName);
    const safeComment = sanitizeSpreadsheetText(test.meta.sampleComment);

    samples.forEach(sample => {
      rows.push([
        seriesState.seriesId,
        test.id,
        index + 1,
        test.status,
        safeSampleName,
        safeComment,
        test.meta.testType,
        Number.isFinite(test.meta.speedMmMin) ? test.meta.speedMmMin : '',
        Number.isFinite(test.meta.widthMm) ? test.meta.widthMm : '',
        Number.isFinite(thicknessMm) ? thicknessMm : '',
        Number.isFinite(test.meta.diameterMm) ? test.meta.diameterMm : '',
        sample.timestampMs,
        Number(((sample.timestampMs - t0) / 1000).toFixed(4)),
        sample.loadN,
        sample.stepPos,
        sample.displacementMm,
        sample.stressMpa,
        sample.mode,
        sample.speedSps
      ]);
    });
  });

  return rows;
}

function sanitizeSpreadsheetText(value) {
  const text = String(value ?? '');
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function getSeriesExportHeader() {
  return [
    'series_id',
    'test_id',
    'test_index',
    'test_status',
    'sample_name',
    'comment',
    'test_type',
    'speed_mm_per_min',
    'width_mm',
    'thickness_mm',
    'diameter_mm',
    'timestamp_ms',
    'relative_time_s',
    'load_N',
    'step_position',
    'displacement_mm',
    'stress_MPa',
    'mode',
    'speed_steps_per_s'
  ];
}

function getExportStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function formatExportDateTime(isoText) {
  if (!isoText) {
    return '';
  }

  const date = new Date(isoText);
  if (Number.isNaN(date.getTime())) {
    return String(isoText);
  }
  return date.toLocaleString();
}

function roundForExport(value, decimals = 4) {
  if (!Number.isFinite(value)) {
    return '';
  }
  return Number(value.toFixed(decimals));
}

function getExportTestsWithSamples() {
  return seriesState.tests.filter(test => Array.isArray(test.samples) && test.samples.length > 0);
}

function getConfigurationExportRows() {
  const nowIso = new Date().toISOString();
  const chartPreferences = getChartPreferences();
  const currentTestType = testTypeEl?.value || '';
  const currentGeometry = getGeometryFromInputs();
  const activeTest = getActiveTest();

  return [
    ['key', 'value'],
    ['exported_at_iso', nowIso],
    ['series_id', seriesState.seriesId || ''],
    ['total_tests_in_series', seriesState.tests.length],
    ['tests_with_samples', getExportTestsWithSamples().length],
    ['active_test_id', activeTest?.id || ''],
    ['active_test_status', activeTest?.status || ''],
    ['selected_test_type', currentTestType],
    ['selected_speed_mm_per_min', speedInputEl?.value || ''],
    ['selected_width_mm', Number.isFinite(currentGeometry.widthMm) ? currentGeometry.widthMm : ''],
    ['selected_thickness_mm', Number.isFinite(currentGeometry.thicknessMm) ? currentGeometry.thicknessMm : ''],
    ['selected_diameter_mm', Number.isFinite(currentGeometry.diameterMm) ? currentGeometry.diameterMm : ''],
    ['pin_last_test_overlay', chartPreferences.pinLastTestOverlay ? 'On' : 'Off'],
    ['y_axis_mode', chartPreferences.yAxisMode],
    ['x_axis_mode', chartPreferences.xAxisMode],
    ['preload_N', preloadInputEl?.value || ''],
    ['filter_alpha', alphaInputEl?.value || ''],
    ['auto_break', autoBreakInputEl?.value === '1' ? 'On' : 'Off'],
    ['tare_after_break', tareAfterBreakInputEl?.value === '1' ? 'On' : 'Off'],
    ['sample_rate_Hz', sampleRateInputEl?.value || ''],
    ['manual_slow_mm_per_min', manualSlowInputEl?.value || ''],
    ['manual_fast_mm_per_min', manualFastInputEl?.value || ''],
    ['acceleration_mm_per_s2', accelInputEl?.value || ''],
    ['gain', gainInputEl?.value || '']
  ];
}

function buildConfigurationSheet() {
  const rows = getConfigurationExportRows();
  const worksheet = window.XLSX.utils.aoa_to_sheet(rows);
  worksheet['!cols'] = [{ wch: 30 }, { wch: 24 }];
  return worksheet;
}

function buildStructuredXlsxSheet(tests) {
  const dataStartRow = 9;
  const maxSampleCount = tests.reduce((maxValue, test) => {
    return Math.max(maxValue, test.samples.length);
  }, 0);
  const rowCount = dataStartRow + maxSampleCount;
  const colCount = tests.length * 2;
  const matrix = Array.from({ length: rowCount }, () => Array.from({ length: colCount }, () => ''));
  const merges = [];

  tests.forEach((test, index) => {
    const col = index * 2;
    const valueCol = col + 1;
    const isLoadTest = test.meta?.testType === 'load';
    const yHeader = isLoadTest ? 'force' : 'stress';
    const maxLabel = isLoadTest ? 'max force' : 'max stress';
    const thicknessMm = Number.isFinite(test.meta?.thicknessMm) ? test.meta.thicknessMm : test.meta?.heightMm;
    const areaMm2 = getAreaMm2FromMeta(test.meta);

    const peakY = test.samples.reduce((highest, sample) => {
      const value = isLoadTest
        ? sample.loadN
        : (Number.isFinite(sample.stressMpa) ? sample.stressMpa : getSampleYValue(test, sample, 'stress'));
      if (!Number.isFinite(value)) {
        return highest;
      }
      return value > highest ? value : highest;
    }, 0);

    matrix[0][col] = sanitizeSpreadsheetText(test.meta?.sampleName || `test_${index + 1}`);
    matrix[1][col] = sanitizeSpreadsheetText(test.meta?.sampleComment || '');
    matrix[2][col] = formatExportDateTime(test.startedAtIso);
    matrix[3][col] = 'speed';
    matrix[3][valueCol] = roundForExport(test.meta?.speedMmMin, 3);
    matrix[4][col] = 'width';
    matrix[4][valueCol] = roundForExport(test.meta?.widthMm, 4);
    matrix[5][col] = test.meta?.testType === 'cylindrical' ? 'diameter' : 'thickness';
    matrix[5][valueCol] = test.meta?.testType === 'cylindrical'
      ? roundForExport(test.meta?.diameterMm, 4)
      : roundForExport(thicknessMm, 4);
    matrix[6][col] = 'area';
    matrix[6][valueCol] = roundForExport(areaMm2, 4);
    matrix[7][col] = maxLabel;
    matrix[7][valueCol] = roundForExport(peakY, 4);
    matrix[8][col] = 'displacement';
    matrix[8][valueCol] = yHeader;

    test.samples.forEach((sample, sampleIndex) => {
      const row = dataStartRow + sampleIndex;
      matrix[row][col] = roundForExport(sample.displacementMm, 6);
      const yValue = isLoadTest
        ? sample.loadN
        : (Number.isFinite(sample.stressMpa) ? sample.stressMpa : getSampleYValue(test, sample, 'stress'));
      matrix[row][valueCol] = roundForExport(yValue, 6);
    });

    merges.push({ s: { r: 0, c: col }, e: { r: 0, c: valueCol } });
    merges.push({ s: { r: 1, c: col }, e: { r: 1, c: valueCol } });
    merges.push({ s: { r: 2, c: col }, e: { r: 2, c: valueCol } });
  });

  const worksheet = window.XLSX.utils.aoa_to_sheet(matrix);
  worksheet['!merges'] = merges;
  worksheet['!cols'] = Array.from({ length: colCount }, (_, colIndex) => ({
    wch: colIndex % 2 === 0 ? 15 : 12
  }));
  return worksheet;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function isXlsxLibraryAvailable() {
  if (window.XLSX) {
    return true;
  }
  setStatus('xlsx_library_not_loaded');
  return false;
}

function downloadWorkbook(workbook, suffix = 'export') {
  const workbookBytes = window.XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob(
    [workbookBytes],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  );
  const stamp = getExportStamp();
  downloadBlob(blob, `${seriesState.seriesId}_${suffix}_${stamp}.xlsx`);
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

  const header = getSeriesExportHeader();
  const csvRows = [
    header.join(','),
    ...rows.map(row => row.map(escapeCsv).join(','))
  ];

  const csv = csvRows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const stamp = getExportStamp();
  downloadBlob(blob, `${seriesState.seriesId}_${stamp}.csv`);
  setStatus('series_csv_exported');
}

function exportSeriesCleanXlsx() {
  if (!seriesState.seriesId) {
    setStatus('create_series_first');
    return;
  }

  const tests = getExportTestsWithSamples();
  if (tests.length === 0) {
    setStatus('no_data_to_export');
    return;
  }

  if (!isXlsxLibraryAvailable()) {
    return;
  }

  const workbook = window.XLSX.utils.book_new();
  const cleanWorksheet = buildStructuredXlsxSheet(tests);
  const configWorksheet = buildConfigurationSheet();
  window.XLSX.utils.book_append_sheet(workbook, cleanWorksheet, 'Clean Export');
  window.XLSX.utils.book_append_sheet(workbook, configWorksheet, 'Configuration');
  downloadWorkbook(workbook, 'clean');
  setStatus('series_clean_xlsx_exported');
}

function exportSeriesFullXlsx() {
  if (!seriesState.seriesId) {
    setStatus('create_series_first');
    return;
  }

  const rows = getSeriesExportRows();
  if (rows.length === 0) {
    setStatus('no_data_to_export');
    return;
  }

  if (!isXlsxLibraryAvailable()) {
    return;
  }

  const header = getSeriesExportHeader();
  const fullWorksheet = window.XLSX.utils.aoa_to_sheet([header, ...rows]);
  const configWorksheet = buildConfigurationSheet();
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, fullWorksheet, 'Full Export');
  window.XLSX.utils.book_append_sheet(workbook, configWorksheet, 'Configuration');
  downloadWorkbook(workbook, 'full');
  setStatus('series_full_xlsx_exported');
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

  const chartPreferences = getChartPreferences();
  const lastFinishedTest = seriesState.tests.length > 0 ? seriesState.tests[seriesState.tests.length - 1] : null;
  if (chartPreferences.pinLastTestOverlay && lastFinishedTest && lastFinishedTest.id !== test.id) {
    seriesState.overlaySelection[lastFinishedTest.id] = true;
  }

  seriesState.tests.push(test);
  seriesState.activeTestId = test.id;
  seriesState.readyForStart = false;
  seriesState.overlaySelection[test.id] = false;
  lastIncomingMode = MANUAL_MODE_VALUE;

  schedulePersistState();
  refreshUi();

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
  await sendCommand('M15');
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

if (armGainBtn) {
  armGainBtn.addEventListener('click', async () => {
    await sendCommand('M53');
  });
}

if (setGainBtn && gainInputEl) {
  setGainBtn.addEventListener('click', async () => {
    if (setGainBtn.disabled) {
      const waiting = gainUiUnlockReadyAtMs > Date.now();
      setStatus(waiting ? 'gain_wait_for_unlock_countdown' : 'gain_locked_press_unlock_gain');
      return;
    }
    const gain = parseFlexibleNumber(gainInputEl.value);
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

if (setPreloadBtn && preloadInputEl) {
  setPreloadBtn.addEventListener('click', async () => {
    const preloadN = parseFlexibleNumber(preloadInputEl.value);
    if (!Number.isFinite(preloadN) || preloadN < 0) {
      setStatus('invalid_preload');
      return;
    }
    const roundedPreloadN = Number(preloadN.toFixed(1));
    preloadInputEl.value = roundedPreloadN.toFixed(1);
    await sendCommand(`M47 ${roundedPreloadN.toFixed(1)}`);
  });
}

if (setAlphaBtn && alphaInputEl) {
  setAlphaBtn.addEventListener('click', async () => {
    const alpha = parseFlexibleNumber(alphaInputEl.value);
    if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1) {
      setStatus('invalid_alpha');
      return;
    }
    const roundedAlpha = Number(alpha.toFixed(2));
    alphaInputEl.value = roundedAlpha.toFixed(2);
    await sendCommand(`M48 ${roundedAlpha.toFixed(2)}`);
  });
}

if (setAutoBreakBtn && autoBreakInputEl) {
  setAutoBreakBtn.addEventListener('click', async () => {
    const enabled = autoBreakInputEl.value === '1' ? 1 : 0;
    await sendCommand(`M49 ${enabled}`);
  });
}

if (setTareAfterBreakBtn && tareAfterBreakInputEl) {
  setTareAfterBreakBtn.addEventListener('click', async () => {
    const enabled = tareAfterBreakInputEl.value === '1' ? 1 : 0;
    await sendCommand(`M51 ${enabled}`);
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
  el.addEventListener('input', () => {
    renderSampleSummary();
    updateStartButtonState();
  });
});

if (sampleModalSaveBtn) {
  sampleModalSaveBtn.addEventListener('click', prepareNewTestFromModal);
}

if (sampleModalCancelBtn) {
  sampleModalCancelBtn.addEventListener('click', () => {
    closeSampleModal();
    setStatus('new_sample_cancelled');
  });
}

if (sampleModalEl) {
  sampleModalEl.addEventListener('click', event => {
    if (event.target === sampleModalEl) {
      closeSampleModal();
    }
  });
}

window.addEventListener('keydown', event => {
  if (!sampleModalEl || !sampleModalEl.classList.contains('open')) {
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    closeSampleModal();
    setStatus('new_sample_cancelled');
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    prepareNewTestFromModal();
  }
});

if (sampleCommentEl) {
  sampleCommentEl.addEventListener('input', () => {
    persistCommentToCurrentTest();
  });
}

if (pinLastTestInputEl) {
  pinLastTestInputEl.addEventListener('change', () => {
    seriesState.chartPreferences.pinLastTestOverlay = pinLastTestInputEl.value === '1';
    schedulePersistState();
  });
}

if (yAxisModeInputEl) {
  yAxisModeInputEl.addEventListener('change', () => {
    seriesState.chartPreferences.yAxisMode = yAxisModeInputEl.value === 'stress' ? 'stress' : 'force';
    schedulePersistState();
    renderChart();
  });
}

if (xAxisModeInputEl) {
  xAxisModeInputEl.addEventListener('change', () => {
    seriesState.chartPreferences.xAxisMode = xAxisModeInputEl.value === 'displacement' ? 'displacement' : 'time';
    schedulePersistState();
    renderChart();
  });
}

window.addEventListener('resize', renderChart);
window.addEventListener('beforeunload', persistStateNow);

if (cleanExportBtn) {
  cleanExportBtn.addEventListener('click', exportSeriesCleanXlsx);
}

if (fullExportBtn) {
  fullExportBtn.addEventListener('click', exportSeriesFullXlsx);
}

initializeConfigPendingTracking();
initializeDecimalInputNormalization();
clearGainUiUnlock();
restoreStateFromStorage();
applyChartPreferenceControls();
setConnectionBadge(false);
applyTestTypeUiState();
renderSampleSummary();
refreshUi();
if (!seriesState.seriesId) {
  setStatus('ready_create_series');
}
