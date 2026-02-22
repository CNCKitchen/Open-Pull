/*########################################
  ##### OPEN PULL
  ##### DIY Universal Test Machine
  ##### V2.1 (non-blocking + ramped motion)
  ##### Stefan Hermann aka CNC Kitchen
  ##### https://www.youtube.com/cnckitchen
  ##### Libraries:
  ##### HX711 by Bogde: https://github.com/bogde/HX711
  ########################################*/

#include <HX711.h>
#include <EEPROM.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>

////// Load Cell Variables
float gainValue = -875.7f * (1.0f - 0.001f); // CALIBRATION FACTOR
long tareValue = 0;
HX711 loadCell;

////// Stepper / Kinematics
const uint8_t directionPin = 3;
const uint8_t stepPin = 2;
const uint8_t speedPin = 5;
const uint8_t upPin = 4;
const uint8_t downPin = 6;
const uint8_t led1Pin = 7;

const float stepsPerMM = 200.0f * 2.0f * (13.0f + 212.0f / 289.0f) / 2.0f; // Steps per rev * Microstepping * Gear reduction / Pitch
const float baseTestSpeedSps = stepsPerMM / 60.0f; // 1 mm/min

// Legacy jog delays mapped to SPS to preserve feel
float jogSlowSps = 1000000.0f / 3000.0f;
float jogFastSps = 1000000.0f / 300.0f;

// Motion profile defaults
float slowTestSps = baseTestSpeedSps;
float fastTestSps = 25.0f * baseTestSpeedSps; // 25 mm/min
float accelSps2 = 4000.0f;
float gotoZeroSps = 8.0f * baseTestSpeedSps;
float preloadN = 2.0f;
float loadFilterAlpha = 0.20f;
bool autoBreakDetectionEnabled = true;
bool tareAfterBreakEnabled = false;
const float gainAbsMin = 100.0f;
const float gainAbsMax = 5000.0f;
const unsigned long gainWriteDelayMs = 30000UL;
const unsigned long gainWriteWindowMs = 30000UL;
const unsigned long tareAfterBreakDelayMs = 2000UL;

// Timing
const unsigned long yMTestTimeMs = 30000UL;
const unsigned long accelUpdateIntervalUs = 5000UL;
unsigned long sampleIntervalUs = 12500UL; // target 80 Hz stream
const unsigned long hx711MissingDataTimeoutMs = 1500UL;
const float hx711UpwardSpikeThresholdN = 300.0f;
const uint8_t hx711MedianWindowSize = 5;
const float preloadToleranceN = 0.15f;
const float breakDetectNegativeThresholdN = -0.20f;
const uint8_t breakDetectConsecutiveSamples = 10;
const float breakDetectMinPeakForceN = 0.50f;

// Mode definitions
const byte MODE_TEST_SLOW = 1;
const byte MODE_MANUAL = 2;
const byte MODE_TEST_FAST = 3;
const byte MODE_YOUNGS = 4;
const byte MODE_GOTO_ZERO = 5;
const byte MODE_RELATIVE_MOVE = 6;

volatile bool motionEnabled = false;
volatile bool stepDirLow = true;
volatile long stepPosition = 0;
volatile uint16_t stepIntervalTicks = 4000; // 2000us default @ prescaler 8 (0.5us/tick)

byte mode = MODE_MANUAL;
byte modeAddition = 0;

float targetSpeedSps = 0.0f;
float currentSpeedSps = 0.0f;
float maxForce = 0.0f;
float loweringCounter = 0.0f;
float lastLoadValue = 0.0f;
float lastRawLoadValue = 0.0f;
bool hasLoadSample = false;
bool hasFilteredLoadSample = false;
float hx711RawWindow[hx711MedianWindowSize];
uint8_t hx711RawWindowCount = 0;
uint8_t hx711RawWindowIndex = 0;
long zeroStepOffset = 0;
long relativeMoveTargetStep = 0;
float relativeMoveSpeedSps = 0.0f;
uint8_t negativeLoadStreak = 0;
bool delayedStartPending = false;
byte delayedStartStage = 0;
unsigned long delayedStartStageMs = 0;
byte delayedStartMode = MODE_TEST_SLOW;
byte delayedStartModeAddition = 0;
const byte START_STAGE_WAIT_BEFORE_TARE = 0;
const byte START_STAGE_WAIT_AFTER_TARE = 1;
const byte START_STAGE_PRELOAD_APPROACH = 2;
const byte START_STAGE_WAIT_AFTER_PRELOAD = 3;
const byte START_STAGE_WAIT_AFTER_SECOND_TARE = 4;
unsigned long startTimeMs = 0;
unsigned long lastSampleUs = 0;
unsigned long lastAccelUpdateUs = 0;
unsigned long lastHx711WarnMs = 0;
unsigned long lastHx711DataMs = 0;
bool debug = false;
bool gainWriteArmed = false;
unsigned long gainWriteAllowedFromMs = 0;
unsigned long gainWriteAllowedUntilMs = 0;
bool quickTareAfterBreakPending = false;
unsigned long quickTareAfterBreakAtMs = 0;

char serialLine[96];
uint8_t serialLineIndex = 0;

void setupTimer1();
void setDirectionLow(bool low);
void setStepIntervalFromSpeed(float speedSps);
void setMotionEnabled(bool enabled);
void enterManualMode();
void emitStatus(const char *code, const char *message);
void emitAck(const char *command, const char *message);
void processSerial();
void processCommand(char *line);
void updateModeAndTargets();
void updateAcceleration();
void sampleAndStream();
float getDisplacementMm();
void performTare();
void performQuickTare();
void emitHx711NotReady();
void loadConfigFromEeprom();
void saveConfigToEeprom();
void emitConfig();
float computeMedian(const float *values, uint8_t count);
float getMedianFilteredLoad(float measuredLoad);
bool isGainPlausible(float gain);
bool isGainWriteWindowActive();

struct PersistedConfig {
  uint16_t magic;
  uint8_t version;
  float slowMmPerMin;
  float fastMmPerMin;
  float accelMmPerS2;
  float gain;
  float sampleRateHz;
  float manualSlowMmPerMin;
  float manualFastMmPerMin;
  float preloadN;
  float loadFilterAlpha;
  uint8_t autoBreakDetectionEnabled;
  uint8_t tareAfterBreakEnabled;
};

const uint16_t persistedConfigMagic = 0x504FULL;
const uint8_t persistedConfigVersion = 4;

ISR(TIMER1_COMPA_vect) {
  if (!motionEnabled) {
    return;
  }
  digitalWrite(stepPin, HIGH);
  digitalWrite(stepPin, LOW);
  if (stepDirLow) {
    stepPosition++;
  } else {
    stepPosition--;
  }
}

void setup() {
  Serial.begin(115200);

  pinMode(directionPin, OUTPUT);
  pinMode(stepPin, OUTPUT);
  digitalWrite(directionPin, LOW);
  digitalWrite(stepPin, LOW);

  pinMode(upPin, INPUT);
  digitalWrite(upPin, HIGH);

  pinMode(downPin, INPUT);
  digitalWrite(downPin, HIGH);

  pinMode(speedPin, INPUT);
  digitalWrite(speedPin, HIGH);

  pinMode(led1Pin, OUTPUT);
  digitalWrite(led1Pin, LOW);

  loadCell.begin(A0, A1);
  loadConfigFromEeprom();
  lastHx711DataMs = millis();
  setupTimer1();
  performTare();
  lastAccelUpdateUs = micros();
  lastSampleUs = micros();
  emitStatus("BOOT", "ready");
}

void saveConfigToEeprom() {
  PersistedConfig config;
  config.magic = persistedConfigMagic;
  config.version = persistedConfigVersion;
  config.slowMmPerMin = (slowTestSps / stepsPerMM) * 60.0f;
  config.fastMmPerMin = (fastTestSps / stepsPerMM) * 60.0f;
  config.accelMmPerS2 = accelSps2 / stepsPerMM;
  config.gain = gainValue;
  config.sampleRateHz = 1000000.0f / (float)sampleIntervalUs;
  config.manualSlowMmPerMin = (jogSlowSps / stepsPerMM) * 60.0f;
  config.manualFastMmPerMin = (jogFastSps / stepsPerMM) * 60.0f;
  config.preloadN = preloadN;
  config.loadFilterAlpha = loadFilterAlpha;
  config.autoBreakDetectionEnabled = autoBreakDetectionEnabled ? 1 : 0;
  config.tareAfterBreakEnabled = tareAfterBreakEnabled ? 1 : 0;
  EEPROM.put(0, config);
}

void loadConfigFromEeprom() {
  PersistedConfig config;
  EEPROM.get(0, config);

  if (config.magic != persistedConfigMagic || config.version != persistedConfigVersion) {
    saveConfigToEeprom();
    return;
  }

  if (isfinite(config.slowMmPerMin) && config.slowMmPerMin > 0.01f) {
    slowTestSps = (config.slowMmPerMin / 60.0f) * stepsPerMM;
  }

  if (isfinite(config.fastMmPerMin) && config.fastMmPerMin > 0.01f) {
    fastTestSps = (config.fastMmPerMin / 60.0f) * stepsPerMM;
  }

  if (isfinite(config.accelMmPerS2) && config.accelMmPerS2 > 0.01f) {
    accelSps2 = config.accelMmPerS2 * stepsPerMM;
  }

  if (isGainPlausible(config.gain)) {
    gainValue = config.gain;
  }

  if (isfinite(config.sampleRateHz) && config.sampleRateHz > 0.1f) {
    unsigned long intervalUs = (unsigned long)(1000000.0f / config.sampleRateHz);
    if (intervalUs < 1000UL) {
      intervalUs = 1000UL;
    }
    sampleIntervalUs = intervalUs;
  }

  if (isfinite(config.manualSlowMmPerMin) && config.manualSlowMmPerMin > 0.01f) {
    jogSlowSps = (config.manualSlowMmPerMin / 60.0f) * stepsPerMM;
  }

  if (isfinite(config.manualFastMmPerMin) && config.manualFastMmPerMin > 0.01f) {
    jogFastSps = (config.manualFastMmPerMin / 60.0f) * stepsPerMM;
  }

  if (isfinite(config.preloadN) && config.preloadN >= 0.0f) {
    preloadN = config.preloadN;
  }

  if (isfinite(config.loadFilterAlpha) && config.loadFilterAlpha > 0.0f && config.loadFilterAlpha <= 1.0f) {
    loadFilterAlpha = config.loadFilterAlpha;
  }

  autoBreakDetectionEnabled = config.autoBreakDetectionEnabled != 0;
  tareAfterBreakEnabled = config.tareAfterBreakEnabled != 0;
}

void emitConfig() {
  Serial.print("CFG,");
  Serial.print(millis());
  Serial.print(',');
  Serial.print((slowTestSps / stepsPerMM) * 60.0f, 3);
  Serial.print(',');
  Serial.print((fastTestSps / stepsPerMM) * 60.0f, 3);
  Serial.print(',');
  Serial.print(accelSps2 / stepsPerMM, 3);
  Serial.print(',');
  Serial.print(gainValue, 3);
  Serial.print(',');
  Serial.print(1000000.0f / (float)sampleIntervalUs, 3);
  Serial.print(',');
  Serial.print((jogSlowSps / stepsPerMM) * 60.0f, 3);
  Serial.print(',');
  Serial.print((jogFastSps / stepsPerMM) * 60.0f, 3);
  Serial.print(',');
  Serial.print(preloadN, 3);
  Serial.print(',');
  Serial.print(loadFilterAlpha, 3);
  Serial.print(',');
  Serial.print(autoBreakDetectionEnabled ? 1 : 0);
  Serial.print(',');
  Serial.println(tareAfterBreakEnabled ? 1 : 0);
}

void loop() {
  processSerial();

  if (quickTareAfterBreakPending && mode == MODE_MANUAL && !delayedStartPending && currentSpeedSps < 0.5f) {
    if ((long)(millis() - quickTareAfterBreakAtMs) >= 0) {
      performTare();
      quickTareAfterBreakPending = false;
      emitStatus("AUTO", "tare_after_break_done");
    }
  }

  updateModeAndTargets();
  updateAcceleration();
  sampleAndStream();
}

void setupTimer1() {
  noInterrupts();
  TCCR1A = 0;
  TCCR1B = 0;
  TCNT1 = 0;
  OCR1A = stepIntervalTicks;
  TCCR1B |= (1 << WGM12);  // CTC
  TCCR1B |= (1 << CS11);   // prescaler 8 => 0.5us per tick
  TIMSK1 |= (1 << OCIE1A); // compare interrupt
  interrupts();
}

void setDirectionLow(bool low) {
  digitalWrite(directionPin, low ? LOW : HIGH);
  noInterrupts();
  stepDirLow = low;
  interrupts();
}

void setStepIntervalFromSpeed(float speedSps) {
  if (speedSps < 0.1f) {
    speedSps = 0.1f;
  }
  float intervalUs = 1000000.0f / speedSps;
  float ticks = intervalUs * 2.0f; // 0.5us per tick
  if (ticks < 60.0f) {
    ticks = 60.0f;
  }
  if (ticks > 65535.0f) {
    ticks = 65535.0f;
  }
  noInterrupts();
  stepIntervalTicks = (uint16_t)ticks;
  OCR1A = stepIntervalTicks;
  interrupts();
}

void setMotionEnabled(bool enabled) {
  noInterrupts();
  motionEnabled = enabled;
  interrupts();
}

void enterManualMode() {
  mode = MODE_MANUAL;
  modeAddition = 0;
  targetSpeedSps = 0.0f;
  emitStatus("MODE", "manual");
}

void emitStatus(const char *code, const char *message) {
  Serial.print("STATUS,");
  Serial.print(millis());
  Serial.print(',');
  Serial.print(code);
  Serial.print(',');
  Serial.println(message);
}

void emitAck(const char *command, const char *message) {
  Serial.print("ACK,");
  Serial.print(millis());
  Serial.print(',');
  Serial.print(command);
  Serial.print(',');
  Serial.println(message);
}

void emitHx711NotReady() {
  unsigned long nowMs = millis();
  if ((unsigned long)(nowMs - lastHx711DataMs) < hx711MissingDataTimeoutMs) {
    return;
  }
  if ((unsigned long)(nowMs - lastHx711WarnMs) >= 1000UL) {
    emitStatus("ERR", "hx711_not_ready");
    lastHx711WarnMs = nowMs;
  }
}

void performTare() {
  digitalWrite(led1Pin, HIGH);
  unsigned long tareStartMs = millis();
  while (!loadCell.is_ready()) {
    if ((unsigned long)(millis() - tareStartMs) >= 500UL) {
      emitStatus("ERR", "tare_timeout");
      digitalWrite(led1Pin, LOW);
      return;
    }
    delay(5);
  }
  tareValue = loadCell.read_average(32);
  hasLoadSample = false;
  hasFilteredLoadSample = false;
  lastLoadValue = 0.0f;
  lastRawLoadValue = 0.0f;
  hx711RawWindowCount = 0;
  hx711RawWindowIndex = 0;
  lastHx711DataMs = millis();
  digitalWrite(led1Pin, LOW);
}

void performQuickTare() {
  digitalWrite(led1Pin, HIGH);
  unsigned long tareStartMs = millis();
  while (!loadCell.is_ready()) {
    if ((unsigned long)(millis() - tareStartMs) >= 300UL) {
      emitStatus("ERR", "quick_tare_timeout");
      digitalWrite(led1Pin, LOW);
      return;
    }
    delay(2);
  }

  tareValue = loadCell.read_average(8);
  hasLoadSample = false;
  hasFilteredLoadSample = false;
  lastLoadValue = 0.0f;
  lastRawLoadValue = 0.0f;
  hx711RawWindowCount = 0;
  hx711RawWindowIndex = 0;
  lastHx711DataMs = millis();
  digitalWrite(led1Pin, LOW);
}

float computeMedian(const float *values, uint8_t count) {
  if (count == 0) {
    return 0.0f;
  }

  float sorted[hx711MedianWindowSize];
  for (uint8_t i = 0; i < count; i++) {
    sorted[i] = values[i];
  }

  for (uint8_t i = 1; i < count; i++) {
    float value = sorted[i];
    int8_t j = (int8_t)i - 1;
    while (j >= 0 && sorted[j] > value) {
      sorted[j + 1] = sorted[j];
      j--;
    }
    sorted[j + 1] = value;
  }

  if ((count & 0x01) == 1) {
    return sorted[count / 2];
  }
  return 0.5f * (sorted[(count / 2) - 1] + sorted[count / 2]);
}

float getMedianFilteredLoad(float measuredLoad) {
  hx711RawWindow[hx711RawWindowIndex] = measuredLoad;
  hx711RawWindowIndex = (uint8_t)((hx711RawWindowIndex + 1) % hx711MedianWindowSize);
  if (hx711RawWindowCount < hx711MedianWindowSize) {
    hx711RawWindowCount++;
  }

  float orderedWindow[hx711MedianWindowSize];
  for (uint8_t i = 0; i < hx711RawWindowCount; i++) {
    uint8_t sourceIndex = (uint8_t)((hx711RawWindowIndex + hx711MedianWindowSize - hx711RawWindowCount + i) % hx711MedianWindowSize);
    orderedWindow[i] = hx711RawWindow[sourceIndex];
  }
  return computeMedian(orderedWindow, hx711RawWindowCount);
}

bool isGainPlausible(float gain) {
  if (!isfinite(gain)) {
    return false;
  }
  float absGain = fabs(gain);
  return absGain >= gainAbsMin && absGain <= gainAbsMax;
}

bool isGainWriteWindowActive() {
  if (!gainWriteArmed) {
    return false;
  }
  unsigned long nowMs = millis();
  if ((long)(gainWriteAllowedUntilMs - nowMs) <= 0) {
    gainWriteArmed = false;
    return false;
  }
  return (long)(nowMs - gainWriteAllowedFromMs) >= 0;
}

void processSerial() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\r') {
      continue;
    }
    if (c == '\n') {
      if (serialLineIndex > 0) {
        serialLine[serialLineIndex] = '\0';
        processCommand(serialLine);
        serialLineIndex = 0;
      }
      continue;
    }
    if (serialLineIndex < sizeof(serialLine) - 1) {
      serialLine[serialLineIndex++] = c;
    }
  }
}

void processCommand(char *line) {
  char *cmd = strtok(line, " ");
  char *arg1 = strtok(NULL, " ");
  if (cmd == NULL) {
    return;
  }

  if (strcmp(cmd, "M10") == 0) {
    quickTareAfterBreakPending = false;
    delayedStartPending = true;
    delayedStartStage = (preloadN > 0.0f) ? START_STAGE_PRELOAD_APPROACH : START_STAGE_WAIT_BEFORE_TARE;
    delayedStartStageMs = millis();
    delayedStartMode = MODE_TEST_SLOW;
    delayedStartModeAddition = (arg1 != NULL && strcmp(arg1, "S1") == 0) ? 1 : 0;
    mode = MODE_MANUAL;
    targetSpeedSps = 0.0f;
    emitAck("M10", (preloadN > 0.0f) ? "start_slow_test_pending_preload" : "start_slow_test_pending_tare");
  } else if (strcmp(cmd, "M11") == 0) {
    quickTareAfterBreakPending = false;
    delayedStartPending = false;
    enterManualMode();
    emitAck("M11", "manual_mode");
  } else if (strcmp(cmd, "M15") == 0) {
    quickTareAfterBreakPending = false;
    delayedStartPending = false;
    enterManualMode();
    emitStatus("ABORT", "emergency_stop");
    emitAck("M15", "emergency_stop");
  } else if (strcmp(cmd, "M12") == 0) {
    quickTareAfterBreakPending = false;
    performTare();
    emitAck("M12", "tare_ok");
  } else if (strcmp(cmd, "M13") == 0) {
    quickTareAfterBreakPending = false;
    mode = MODE_YOUNGS;
    maxForce = 0.0f;
    loweringCounter = 0.0f;
    setDirectionLow(true);
    performTare();
    startTimeMs = millis();
    emitAck("M13", "start_youngs_test");
  } else if (strcmp(cmd, "M14") == 0) {
    quickTareAfterBreakPending = false;
    mode = MODE_TEST_FAST;
    maxForce = 0.0f;
    loweringCounter = 0.0f;
    setDirectionLow(true);
    performTare();
    emitAck("M14", "start_fast_test");
  } else if (strcmp(cmd, "M20") == 0) {
    noInterrupts();
    zeroStepOffset = stepPosition;
    interrupts();
    emitAck("M20", "set_zero");
  } else if (strcmp(cmd, "M21") == 0) {
    mode = MODE_GOTO_ZERO;
    emitAck("M21", "goto_zero");
  } else if (strcmp(cmd, "M22") == 0 && arg1 != NULL) {
    float deltaMm = atof(arg1);
    if (fabs(deltaMm) >= 0.001f) {
      long currentPos;
      noInterrupts();
      currentPos = stepPosition;
      interrupts();

      long deltaSteps = (long)(deltaMm * stepsPerMM);
      if (deltaSteps == 0) {
        deltaSteps = (deltaMm > 0.0f) ? 1L : -1L;
      }

      relativeMoveTargetStep = currentPos + deltaSteps;
      relativeMoveSpeedSps = (fabs(deltaMm) >= 1.0f) ? jogFastSps : jogSlowSps;
      mode = MODE_RELATIVE_MOVE;
      emitAck("M22", "relative_move_started");
    } else {
      emitStatus("ERR", "invalid_relative_move");
    }
  } else if (strcmp(cmd, "M40") == 0 && arg1 != NULL) {
    float mmPerMin = atof(arg1);
    if (mmPerMin > 0.01f) {
      slowTestSps = (mmPerMin / 60.0f) * stepsPerMM;
      saveConfigToEeprom();
      emitAck("M40", "slow_speed_set");
    } else {
      emitStatus("ERR", "invalid_slow_speed");
    }
  } else if (strcmp(cmd, "M41") == 0 && arg1 != NULL) {
    float mmPerMin = atof(arg1);
    if (mmPerMin > 0.01f) {
      fastTestSps = (mmPerMin / 60.0f) * stepsPerMM;
      saveConfigToEeprom();
      emitAck("M41", "fast_speed_set");
    } else {
      emitStatus("ERR", "invalid_fast_speed");
    }
  } else if (strcmp(cmd, "M42") == 0 && arg1 != NULL) {
    float accelMmPerS2 = atof(arg1);
    if (accelMmPerS2 > 0.01f) {
      accelSps2 = accelMmPerS2 * stepsPerMM;
      saveConfigToEeprom();
      emitAck("M42", "accel_set");
    } else {
      emitStatus("ERR", "invalid_accel");
    }
  } else if (strcmp(cmd, "M53") == 0) {
    if (mode != MODE_MANUAL || delayedStartPending) {
      emitStatus("ERR", "gain_arm_only_manual");
    } else {
      gainWriteArmed = true;
      gainWriteAllowedFromMs = millis() + gainWriteDelayMs;
      gainWriteAllowedUntilMs = gainWriteAllowedFromMs + gainWriteWindowMs;
      emitAck("M53", "gain_set_wait_30s_then_30s_window");
    }
  } else if (strcmp(cmd, "M43") == 0 && arg1 != NULL) {
    if (gainWriteArmed && (long)(millis() - gainWriteAllowedFromMs) < 0) {
      emitStatus("ERR", "gain_wait_not_elapsed");
      return;
    }

    if (!isGainWriteWindowActive()) {
      gainWriteArmed = false;
      emitStatus("ERR", "gain_locked_use_m53");
      return;
    }

    float newGain = atof(arg1);
    if (isGainPlausible(newGain)) {
      gainValue = newGain;
      gainWriteArmed = false;
      saveConfigToEeprom();
      emitAck("M43", "gain_set");
    } else {
      emitStatus("ERR", "invalid_gain_range");
    }
  } else if (strcmp(cmd, "M44") == 0 && arg1 != NULL) {
    float sampleRateHz = atof(arg1);
    if (sampleRateHz > 0.1f) {
      unsigned long newIntervalUs = (unsigned long)(1000000.0f / sampleRateHz);
      if (newIntervalUs < 1000UL) {
        newIntervalUs = 1000UL;
      }
      sampleIntervalUs = newIntervalUs;
      saveConfigToEeprom();
      emitAck("M44", "sample_rate_set");
    } else {
      emitStatus("ERR", "invalid_sample_rate");
    }
  } else if (strcmp(cmd, "M45") == 0 && arg1 != NULL) {
    float mmPerMin = atof(arg1);
    if (mmPerMin > 0.01f) {
      jogSlowSps = (mmPerMin / 60.0f) * stepsPerMM;
      saveConfigToEeprom();
      emitAck("M45", "manual_slow_speed_set");
    } else {
      emitStatus("ERR", "invalid_manual_slow_speed");
    }
  } else if (strcmp(cmd, "M46") == 0 && arg1 != NULL) {
    float mmPerMin = atof(arg1);
    if (mmPerMin > 0.01f) {
      jogFastSps = (mmPerMin / 60.0f) * stepsPerMM;
      saveConfigToEeprom();
      emitAck("M46", "manual_fast_speed_set");
    } else {
      emitStatus("ERR", "invalid_manual_fast_speed");
    }
  } else if (strcmp(cmd, "M47") == 0 && arg1 != NULL) {
    float configuredPreloadN = atof(arg1);
    if (configuredPreloadN >= 0.0f) {
      preloadN = configuredPreloadN;
      saveConfigToEeprom();
      emitAck("M47", "preload_set");
    } else {
      emitStatus("ERR", "invalid_preload");
    }
  } else if (strcmp(cmd, "M48") == 0 && arg1 != NULL) {
    float configuredAlpha = atof(arg1);
    if (configuredAlpha > 0.0f && configuredAlpha <= 1.0f) {
      loadFilterAlpha = configuredAlpha;
      saveConfigToEeprom();
      emitAck("M48", "filter_alpha_set");
    } else {
      emitStatus("ERR", "invalid_filter_alpha");
    }
  } else if (strcmp(cmd, "M49") == 0 && arg1 != NULL) {
    int enabled = atoi(arg1);
    if (enabled == 0 || enabled == 1) {
      autoBreakDetectionEnabled = enabled == 1;
      saveConfigToEeprom();
      emitAck("M49", autoBreakDetectionEnabled ? "auto_break_enabled" : "auto_break_disabled");
    } else {
      emitStatus("ERR", "invalid_auto_break_value");
    }
  } else if (strcmp(cmd, "M51") == 0 && arg1 != NULL) {
    int enabled = atoi(arg1);
    if (enabled == 0 || enabled == 1) {
      tareAfterBreakEnabled = enabled == 1;
      saveConfigToEeprom();
      emitAck("M51", tareAfterBreakEnabled ? "tare_after_break_enabled" : "tare_after_break_disabled");
    } else {
      emitStatus("ERR", "invalid_tare_after_break_value");
    }
  } else if (strcmp(cmd, "M50") == 0) {
    emitConfig();
    emitAck("M50", "config_reported");
  } else {
    emitStatus("ERR", "unknown_command");
  }
}

void updateModeAndTargets() {
  if (delayedStartPending) {
    unsigned long nowMs = millis();

    if (!digitalRead(downPin)) {
      emitStatus("ABORT", "start_sequence_stopped");
      delayedStartPending = false;
      enterManualMode();
      return;
    }

    if (delayedStartStage == START_STAGE_WAIT_BEFORE_TARE) {
      if ((unsigned long)(nowMs - delayedStartStageMs) >= 500UL) {
        performTare();
        delayedStartStage = START_STAGE_WAIT_AFTER_TARE;
        delayedStartStageMs = nowMs;
      }
      targetSpeedSps = 0.0f;
      return;
    }

    if (delayedStartStage == START_STAGE_WAIT_AFTER_TARE) {
      if ((unsigned long)(nowMs - delayedStartStageMs) >= 500UL) {
        delayedStartPending = false;
        mode = delayedStartMode;
        modeAddition = delayedStartModeAddition;
        maxForce = 0.0f;
        loweringCounter = 0.0f;
        setDirectionLow(true);
      } else {
        targetSpeedSps = 0.0f;
        return;
      }
    }

    if (delayedStartStage == START_STAGE_PRELOAD_APPROACH) {
      if (!hasFilteredLoadSample) {
        targetSpeedSps = 0.0f;
        return;
      }

      float preloadErrorN = preloadN - lastLoadValue;
      if (fabs(preloadErrorN) <= preloadToleranceN) {
        targetSpeedSps = 0.0f;
        if (currentSpeedSps < 0.5f) {
          delayedStartStage = START_STAGE_WAIT_AFTER_PRELOAD;
          delayedStartStageMs = nowMs;
        }
      } else {
        if (preloadErrorN > 0.0f) {
          setDirectionLow(true);
        } else {
          setDirectionLow(false);
        }
        targetSpeedSps = jogSlowSps;
      }
      return;
    }

    if (delayedStartStage == START_STAGE_WAIT_AFTER_PRELOAD) {
      if ((unsigned long)(nowMs - delayedStartStageMs) >= 500UL) {
        performTare();
        delayedStartStage = START_STAGE_WAIT_AFTER_SECOND_TARE;
        delayedStartStageMs = nowMs;
      }
      targetSpeedSps = 0.0f;
      return;
    }

    if (delayedStartStage == START_STAGE_WAIT_AFTER_SECOND_TARE) {
      if ((unsigned long)(nowMs - delayedStartStageMs) >= 500UL) {
        delayedStartPending = false;
        mode = delayedStartMode;
        modeAddition = delayedStartModeAddition;
        maxForce = 0.0f;
        loweringCounter = 0.0f;
        setDirectionLow(true);
      } else {
        targetSpeedSps = 0.0f;
        return;
      }
    }
  }

  if (mode == MODE_TEST_SLOW) {
    setDirectionLow(true);
    targetSpeedSps = slowTestSps;
    if (!digitalRead(downPin)) {
      emitStatus("ABORT", "slow_test_stopped");
      enterManualMode();
    }
  } else if (mode == MODE_MANUAL) {
    if (!digitalRead(upPin)) {
      setDirectionLow(true);
      targetSpeedSps = digitalRead(speedPin) ? jogSlowSps : jogFastSps;
      if (debug) {
        emitStatus("DBG", "manual_up");
      }
    } else if (!digitalRead(downPin)) {
      setDirectionLow(false);
      targetSpeedSps = digitalRead(speedPin) ? jogSlowSps : jogFastSps;
      if (debug) {
        emitStatus("DBG", "manual_down");
      }
    } else {
      targetSpeedSps = 0.0f;
    }
  } else if (mode == MODE_TEST_FAST) {
    setDirectionLow(true);
    targetSpeedSps = fastTestSps;
    if (!digitalRead(downPin)) {
      emitStatus("ABORT", "fast_test_stopped");
      enterManualMode();
    }
  } else if (mode == MODE_YOUNGS) {
    setDirectionLow(true);
    if (millis() - startTimeMs < yMTestTimeMs) {
      targetSpeedSps = slowTestSps;
    } else {
      targetSpeedSps = fastTestSps;
    }
    if (!digitalRead(downPin)) {
      emitStatus("ABORT", "youngs_test_stopped");
      enterManualMode();
    }
  } else if (mode == MODE_GOTO_ZERO) {
    long delta;
    noInterrupts();
    delta = zeroStepOffset - stepPosition;
    interrupts();

    long remainingSteps = (delta >= 0) ? delta : -delta;
    float brakingDistanceSteps = 0.0f;
    if (accelSps2 > 0.01f) {
      brakingDistanceSteps = (currentSpeedSps * currentSpeedSps) / (2.0f * accelSps2);
    }

    if (remainingSteps <= 1 && currentSpeedSps < 0.5f) {
      targetSpeedSps = 0.0f;
      enterManualMode();
      emitStatus("DONE", "at_zero");
    } else if (remainingSteps <= (long)(brakingDistanceSteps + 1.0f)) {
      targetSpeedSps = 0.0f;
    } else if (delta > 0) {
      setDirectionLow(true);
      targetSpeedSps = fastTestSps;
    } else if (delta < 0) {
      setDirectionLow(false);
      targetSpeedSps = fastTestSps;
    } else {
      targetSpeedSps = 0.0f;
    }

    if (!digitalRead(downPin)) {
      emitStatus("ABORT", "goto_zero_stopped");
      enterManualMode();
    }
  } else if (mode == MODE_RELATIVE_MOVE) {
    long delta;
    noInterrupts();
    delta = relativeMoveTargetStep - stepPosition;
    interrupts();

    long remainingSteps = (delta >= 0) ? delta : -delta;
    float brakingDistanceSteps = 0.0f;
    if (accelSps2 > 0.01f) {
      brakingDistanceSteps = (currentSpeedSps * currentSpeedSps) / (2.0f * accelSps2);
    }

    if (remainingSteps <= 1 && currentSpeedSps < 0.5f) {
      targetSpeedSps = 0.0f;
      enterManualMode();
      emitStatus("DONE", "relative_move_done");
    } else if (remainingSteps <= (long)(brakingDistanceSteps + 1.0f)) {
      targetSpeedSps = 0.0f;
    } else if (delta > 0) {
      setDirectionLow(true);
      targetSpeedSps = relativeMoveSpeedSps;
    } else if (delta < 0) {
      setDirectionLow(false);
      targetSpeedSps = relativeMoveSpeedSps;
    } else {
      targetSpeedSps = 0.0f;
    }

    if (!digitalRead(downPin)) {
      emitStatus("ABORT", "relative_move_stopped");
      enterManualMode();
    }
  }
}

void updateAcceleration() {
  unsigned long nowUs = micros();
  if ((unsigned long)(nowUs - lastAccelUpdateUs) < accelUpdateIntervalUs) {
    return;
  }
  float dt = (float)(nowUs - lastAccelUpdateUs) / 1000000.0f;
  lastAccelUpdateUs = nowUs;

  float maxDelta = accelSps2 * dt;
  float diff = targetSpeedSps - currentSpeedSps;
  if (diff > maxDelta) {
    diff = maxDelta;
  } else if (diff < -maxDelta) {
    diff = -maxDelta;
  }
  currentSpeedSps += diff;

  if (currentSpeedSps < 0.5f) {
    currentSpeedSps = 0.0f;
    setMotionEnabled(false);
  } else {
    setStepIntervalFromSpeed(currentSpeedSps);
    setMotionEnabled(true);
  }
}

float getDisplacementMm() {
  long pos;
  noInterrupts();
  pos = stepPosition;
  interrupts();
  return (float)(pos - zeroStepOffset) / stepsPerMM;
}

void sampleAndStream() {
  unsigned long nowUs = micros();
  if ((unsigned long)(nowUs - lastSampleUs) < sampleIntervalUs) {
    return;
  }
  lastSampleUs = nowUs;

  digitalWrite(led1Pin, HIGH);
  float loadValue = lastLoadValue;
  if (loadCell.is_ready()) {
    float measuredLoad = ((float)loadCell.read_average(1) - (float)tareValue) / gainValue;
    measuredLoad = getMedianFilteredLoad(measuredLoad);
    if (hasLoadSample) {
      float deltaLoad = measuredLoad - lastRawLoadValue;
      if (deltaLoad > hx711UpwardSpikeThresholdN) {
        measuredLoad = lastRawLoadValue + hx711UpwardSpikeThresholdN;
      } else if (deltaLoad < -hx711UpwardSpikeThresholdN) {
        measuredLoad = lastRawLoadValue - hx711UpwardSpikeThresholdN;
      }
    } else {
      hasLoadSample = true;
    }

    lastRawLoadValue = measuredLoad;

    if (!hasFilteredLoadSample) {
      loadValue = measuredLoad;
      hasFilteredLoadSample = true;
    } else {
      loadValue = lastLoadValue + loadFilterAlpha * (measuredLoad - lastLoadValue);
    }

    lastLoadValue = loadValue;
    lastHx711DataMs = millis();
  } else {
    emitHx711NotReady();
  }
  digitalWrite(led1Pin, LOW);

  if (autoBreakDetectionEnabled && mode == MODE_TEST_SLOW && modeAddition == 1) {
    if (loadValue >= maxForce) {
      maxForce = loadValue;
      loweringCounter = 0.0f;
    } else {
      loweringCounter += 1.0f;
    }
    if (loweringCounter >= 20.0f) {
      targetSpeedSps = targetSpeedSps * 4.0f;
      modeAddition = 0;
      emitStatus("MODE", "slow_test_break_detected_speedup");
    }
  } else {
    if (loadValue > maxForce) {
      maxForce = loadValue;
    }
  }

  bool inActiveTest = (mode == MODE_TEST_SLOW || mode == MODE_TEST_FAST || mode == MODE_YOUNGS);
  if (inActiveTest && autoBreakDetectionEnabled) {
    if (maxForce >= breakDetectMinPeakForceN && loadValue <= breakDetectNegativeThresholdN) {
      if (negativeLoadStreak < 255) {
        negativeLoadStreak++;
      }
    } else {
      negativeLoadStreak = 0;
    }

    if (negativeLoadStreak >= breakDetectConsecutiveSamples) {
      emitStatus("DONE", "specimen_break_detected");
      negativeLoadStreak = 0;
      enterManualMode();
      if (tareAfterBreakEnabled) {
        quickTareAfterBreakPending = true;
        quickTareAfterBreakAtMs = millis() + tareAfterBreakDelayMs;
      }
    }
  } else {
    negativeLoadStreak = 0;
  }

  long positionSnapshot;
  noInterrupts();
  positionSnapshot = stepPosition;
  interrupts();
  float displacement = (float)(positionSnapshot - zeroStepOffset) / stepsPerMM;

  Serial.print("DATA,");
  Serial.print(millis());
  Serial.print(',');
  Serial.print(loadValue, 5);
  Serial.print(',');
  Serial.print(positionSnapshot);
  Serial.print(',');
  Serial.print(displacement, 5);
  Serial.print(',');
  Serial.print(mode);
  Serial.print(',');
  Serial.println(currentSpeedSps, 2);
}
