/*########################################
  ##### OPEN PULL
  ##### DIY Universal Test Machnine
  ##### V1.0
  ##### Stefan Hermann aka CNC Kitchen
  ##### https://www.youtube.com/cnckitchen
  ##### 31.01.2019
  ##### Libraries:
  ##### HX711 by aguegu: https://github.com/aguegu/ardulibs/tree/master/hx711
  ########################################*/

#include "hx711.h"

////// Load Cell Variables
float gainValue = -875.7 * (1 - 0.001); //CALIBRATION FACTOR
float measuringIntervall = 2;       //Measuring interval when IDLE
float measuringIntervallTest = .5;  //Measuring interval during SLOW test
float measuringIntervallTestFast = .15; ///Measuring interval during FAST test

long tareValue;

Hx711 loadCell(A0, A1);

////// Stepper Variables

int pulseLength = 10;
float stepsPerMM = 200 * 2 * (13 + 212.0 / 289.0) / 2; // Steps per rev * Microstepping * Gear reduction ratio / Pitch
float stepsPerSecond = stepsPerMM / 60; //1mm/min
int slowSpeedDelay = 3000;    //Time delay between steps for jogging slowly
int fastSpeedDelay = 300;     ////Time delay between steps for jogging fast
boolean dir = 0;


////// PIN definitions
#define directionPin 3
#define stepPin 2
#define speedPin 5
#define upPin 4
#define downPin 6
#define led1Pin 7


///// Variables
byte mode = 2;
byte modeAddition = 0;
float currentSpeed = stepsPerSecond;    //SLOW Test speed
float fastSpeed = 25 * stepsPerSecond;  //FAST Test speed (x25 = 25mm/min)
long currentMicros = micros();
long lastLoadValue = 0;
long lastStep = 0;
String inputString;
float maxForce = 0;
float loweringCounter = 0;
long startTime = 0;
long yMTestTime = 30 * 1000; //Modulus Test time for SLOW speed (=30s)

void setup() {
  // Serial
  Serial.begin(115200);

  // Load Cell
  tareValue = loadCell.averageValue(32);

  // Stepper
  pinMode(directionPin, OUTPUT);
  pinMode(stepPin, OUTPUT);
  digitalWrite(directionPin, dir);
  digitalWrite(stepPin, LOW);

  //Up Button
  pinMode(upPin, INPUT);
  digitalWrite(upPin, HIGH);

  //Down Button
  pinMode(downPin, INPUT);
  digitalWrite(downPin, HIGH);

  //Speed Switch
  pinMode(speedPin, INPUT);
  digitalWrite(speedPin, HIGH);

  //LED Pin
  pinMode(led1Pin, OUTPUT);
  digitalWrite(led1Pin, LOW);

}

void loop() {
  int stringRead = 0;
  //Serial Communication
  inputString = "";
  while (Serial.available())
  {
    inputString = Serial.readString();
    stringRead = 1;
  }
  if (stringRead == 1) {
    int Mcode;
    String rest;
    Mcode = inputString.substring(1, inputString.indexOf(" ")).toInt();
    rest = inputString.substring(inputString.indexOf(" ") + 1);
    switch (Mcode)
    {
      case 10: //Start SLOW test
        mode = 1;
        if (rest == "S1") {
          modeAddition = 1;
        }
        startTest();
        break;
      case 11: //manual Mode (not implemented yet)
        Serial.println("Manual Mode");
        measuringIntervall = 2;
        mode = 2;
        break;
      case 12: //tare
        measuringIntervall = 2;
        Serial.println("Tare");
        tareValue = loadCell.averageValue(32);
        break;
      case 13: //Youngs Modulus Test Mode
        mode = 4;
        startTest();
        startTime = millis();
        break;
      case 14: //Start FAST test
        mode = 3;
        startTest();
        break;
      default:
        Serial.println("ERROR: Command not found!");
        break;
    }
  }

  switch (mode)
  {
    case 1: tensileTest(); break;
    case 2: manualTest(); break;
    case 3: fastTest(); break;
    case 4: youngsModulusTest(); break;
  }


  ///////////// Get load value
  currentMicros = micros();
  if ((micros() - lastLoadValue) >= measuringIntervall * 1000000) {
    digitalWrite(led1Pin, HIGH);
    float loadValue = (loadCell.averageValue(1) - tareValue) / gainValue;
    Serial.println(loadValue);
    //Serial.println((loadCell.averageValue(1)-tareValue));
    digitalWrite(led1Pin, LOW);
    lastLoadValue = currentMicros;
    if (mode == 1 && modeAddition == 1) {
      if (loadValue >= maxForce) {
        maxForce = loadValue;
        loweringCounter = 0;
      } else {
        loweringCounter++;
      }
      if (loweringCounter >= 20) {
        currentSpeed = currentSpeed * 4;
        modeAddition = 0;
      }
    }
  }
}

void startTest() {
  measuringIntervall = measuringIntervallTestFast;
  maxForce = 0;
  loweringCounter = 0;
  digitalWrite(directionPin, LOW);
  Serial.println("\n\n\n\nTare");
  tareValue = loadCell.averageValue(32);
  Serial.println("Start Fast Test");
  digitalWrite(led1Pin, HIGH);
  delay(500);
  digitalWrite(led1Pin, LOW);
  delay(200);
  digitalWrite(led1Pin, HIGH);
  delay(500);
  digitalWrite(led1Pin, LOW);
}

void tensileTest() {
  currentMicros = micros();
  if ((currentMicros - lastStep) >= 1000000. / currentSpeed) {
    digitalWrite(stepPin, HIGH);
    delayMicroseconds(pulseLength);
    digitalWrite(stepPin, LOW);
    lastStep = currentMicros;
  }
  if (!digitalRead(downPin)) { //Stop test if DOWN Button is pressed
    Serial.println("Test aborted - entering manual mode\n\n\n\n\n");
    mode = 2;
    modeAddition = 0;
    measuringIntervall = 2;
    currentSpeed = stepsPerSecond;
  }
}

void manualTest() {
  boolean performStep = 0;
  if (!digitalRead(upPin)) {
    digitalWrite(directionPin, LOW);
    performStep = 1;
    //Serial.println("UP");
  } else if (!digitalRead(downPin)) {
    digitalWrite(directionPin, HIGH);
    performStep = 1;
    //Serial.println("DOWN");
  }
  //Perform Step
  if (performStep) {
    digitalWrite(stepPin, HIGH);
    delayMicroseconds(pulseLength);
    digitalWrite(stepPin, LOW);
  }
  if (digitalRead(speedPin)) {
    delayMicroseconds(slowSpeedDelay);
    //Serial.println("Slow Step");
  } else {
    delayMicroseconds(fastSpeedDelay);
    //Serial.println("Fast Step");
  }
}

void fastTest() {
  currentMicros = micros();
  if ((currentMicros - lastStep) >= 1000000. / fastSpeed) {
    digitalWrite(stepPin, HIGH);
    delayMicroseconds(pulseLength);
    digitalWrite(stepPin, LOW);
    lastStep = currentMicros;
  }
  if (!digitalRead(downPin)) {
    Serial.println("Test aborted - entering manual mode\n\n\n\n");
    mode = 2;
    modeAddition = 0;
    measuringIntervall = 2;
    currentSpeed = stepsPerSecond;
  }
}

void youngsModulusTest() {
  currentMicros = micros();
  if ((currentMicros - lastStep) >= 1000000. / currentSpeed) {
    digitalWrite(stepPin, HIGH);
    delayMicroseconds(pulseLength);
    digitalWrite(stepPin, LOW);
    lastStep = currentMicros;
  }
  if (millis() - startTime >= yMTestTime) {
    mode = 3;
    measuringIntervall = measuringIntervallTestFast;
  }
  if (!digitalRead(downPin)) {
    Serial.println("Test aborted - entering manual mode\n\n\n\n");
    mode = 2;
    modeAddition = 0;
    measuringIntervall = 2;
    currentSpeed = stepsPerSecond;
  }
}
