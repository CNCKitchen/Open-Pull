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

// Timing
const unsigned long yMTestTimeMs = 30000UL;
const unsigned long accelUpdateIntervalUs = 5000UL;
unsigned long sampleIntervalUs = 12500UL; // target 80 Hz stream
const unsigned long hx711MissingDataTimeoutMs = 1500UL;
const float hx711UpwardSpikeThresholdN = 300.0f;

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
bool hasLoadSample = false;
long zeroStepOffset = 0;
long relativeMoveTargetStep = 0;
float relativeMoveSpeedSps = 0.0f;
bool delayedStartPending = false;
byte delayedStartStage = 0;
unsigned long delayedStartStageMs = 0;
byte delayedStartMode = MODE_TEST_SLOW;
byte delayedStartModeAddition = 0;
unsigned long startTimeMs = 0;
unsigned long lastSampleUs = 0;
unsigned long lastAccelUpdateUs = 0;
unsigned long lastHx711WarnMs = 0;
unsigned long lastHx711DataMs = 0;
bool debug = false;

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
void emitHx711NotReady();
void loadConfigFromEeprom();
void saveConfigToEeprom();
void emitConfig();

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
};

const uint16_t persistedConfigMagic = 0x504FULL;
const uint8_t persistedConfigVersion = 1;

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

  if (isfinite(config.gain) && config.gain != 0.0f) {
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
  Serial.println((jogFastSps / stepsPerMM) * 60.0f, 3);
}

void loop() {
  processSerial();
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
  if (!loadCell.is_ready()) {
    emitHx711NotReady();
    digitalWrite(led1Pin, LOW);
    return;
  }
  tareValue = loadCell.read_average(32);
  lastHx711DataMs = millis();
  digitalWrite(led1Pin, LOW);
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
    delayedStartPending = true;
    delayedStartStage = 0;
    delayedStartStageMs = millis();
    delayedStartMode = MODE_TEST_SLOW;
    delayedStartModeAddition = (arg1 != NULL && strcmp(arg1, "S1") == 0) ? 1 : 0;
    mode = MODE_MANUAL;
    targetSpeedSps = 0.0f;
    emitAck("M10", "start_slow_test_pending_tare");
  } else if (strcmp(cmd, "M11") == 0) {
    delayedStartPending = false;
    enterManualMode();
    emitAck("M11", "manual_mode");
  } else if (strcmp(cmd, "M12") == 0) {
    performTare();
    emitAck("M12", "tare_ok");
  } else if (strcmp(cmd, "M13") == 0) {
    mode = MODE_YOUNGS;
    maxForce = 0.0f;
    loweringCounter = 0.0f;
    setDirectionLow(true);
    performTare();
    startTimeMs = millis();
    emitAck("M13", "start_youngs_test");
  } else if (strcmp(cmd, "M14") == 0) {
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
  } else if (strcmp(cmd, "M43") == 0 && arg1 != NULL) {
    float newGain = atof(arg1);
    if (newGain != 0.0f) {
      gainValue = newGain;
      saveConfigToEeprom();
      emitAck("M43", "gain_set");
    } else {
      emitStatus("ERR", "invalid_gain");
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

    if (delayedStartStage == 0) {
      if ((unsigned long)(nowMs - delayedStartStageMs) >= 500UL) {
        performTare();
        delayedStartStage = 1;
        delayedStartStageMs = nowMs;
      }
      targetSpeedSps = 0.0f;
      return;
    }

    if (delayedStartStage == 1) {
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

    if (delta > 0) {
      setDirectionLow(true);
      targetSpeedSps = fastTestSps;
    } else if (delta < 0) {
      setDirectionLow(false);
      targetSpeedSps = fastTestSps;
    } else {
      targetSpeedSps = 0.0f;
      enterManualMode();
      emitStatus("DONE", "at_zero");
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

    if (delta > 0) {
      setDirectionLow(true);
      targetSpeedSps = relativeMoveSpeedSps;
    } else if (delta < 0) {
      setDirectionLow(false);
      targetSpeedSps = relativeMoveSpeedSps;
    } else {
      targetSpeedSps = 0.0f;
      enterManualMode();
      emitStatus("DONE", "relative_move_done");
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
    if (hasLoadSample) {
      float upwardJump = measuredLoad - lastLoadValue;
      if (upwardJump > hx711UpwardSpikeThresholdN) {
        measuredLoad = lastLoadValue;
      }
    } else {
      hasLoadSample = true;
    }
    loadValue = measuredLoad;
    lastLoadValue = loadValue;
    lastHx711DataMs = millis();
  } else {
    emitHx711NotReady();
  }
  digitalWrite(led1Pin, LOW);

  if (mode == MODE_TEST_SLOW && modeAddition == 1) {
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
