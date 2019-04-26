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
int directionPin = 3;
int stepPin = 2;
int speedPin = 5;
int upPin = 4;
int downPin = 6;
int led1Pin = 7;


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
bool debug = false; //debug mode to test the remote

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
  //Serial COmmunication
  inputString = "";
  while (Serial.available())
  {
    inputString = Serial.readString();
    stringRead = 1;
  }
  if (stringRead == 1) {
    String taskPart;
    String rest;
    taskPart = inputString.substring(0, inputString.indexOf(" "));
    rest = inputString.substring(inputString.indexOf(" ") + 1);
    if (taskPart == "M10") { //Start SLOW test
      mode = 1;
      if (rest == "S1") {
        modeAddition = 1;
      }
      measuringIntervall = measuringIntervallTest;
      maxForce = 0;
      loweringCounter = 0;
      digitalWrite(directionPin, LOW);
      printSpaces(5);
      Serial.println("Tare");
      tareValue = loadCell.averageValue(32);    //Tare
      Serial.println("Start Test");
      digitalWrite(led1Pin, HIGH);
      delay(500);
      digitalWrite(led1Pin, LOW);
      delay(200);
      digitalWrite(led1Pin, HIGH);
      delay(500);
      digitalWrite(led1Pin, LOW);
    } else if (taskPart == "M11") { //manual Mode (not implemented yet)
      Serial.println("Manual Mode");
      measuringIntervall = 2;
      mode = 2;
    } else if (taskPart == "M12") { //tare
      measuringIntervall = 2;
      Serial.println("Tare");
      tareValue = loadCell.averageValue(32);
    } else if (taskPart == "M13") { //Youngs Modulus Test Mode
      mode = 4;
      measuringIntervall = measuringIntervallTest;
      maxForce = 0;
      loweringCounter = 0;
      digitalWrite(directionPin, LOW);
      printSpaces(5);
      Serial.println("Tare");
      tareValue = loadCell.averageValue(32);
      Serial.println("Start Test");
      digitalWrite(led1Pin, HIGH);
      delay(500);
      digitalWrite(led1Pin, LOW);
      delay(200);
      digitalWrite(led1Pin, HIGH);
      delay(500);
      digitalWrite(led1Pin, LOW);
      startTime = millis();
    } else if (taskPart == "M14") { //Start FAST test
      mode = 3;
      measuringIntervall = measuringIntervallTestFast;
      maxForce = 0;
      loweringCounter = 0;
      digitalWrite(directionPin, LOW);
      printSpaces(5);
      Serial.println("Tare");
      tareValue = loadCell.averageValue(32);
      Serial.println("Start Fast Test");
      digitalWrite(led1Pin, HIGH);
      delay(500);
      digitalWrite(led1Pin, LOW);
      delay(200);
      digitalWrite(led1Pin, HIGH);
      delay(500);
      digitalWrite(led1Pin, LOW);
    } else {
      Serial.println("ERROR: Command not found!");
    }
  }
  ///////////////// Tensile Test Mode ////////////
  if (mode == 1) {
    currentMicros = micros();
    if ((currentMicros - lastStep) >= 1000000. / currentSpeed) {
      digitalWrite(stepPin, HIGH);
      delayMicroseconds(pulseLength);
      digitalWrite(stepPin, LOW);
      lastStep = currentMicros;
    }
    if (!digitalRead(downPin)) { //Stop test if DOWN Button is pressed
      Serial.println("Test aborted - entering manual mode");
      printSpaces(5);
      mode = 2;
      modeAddition = 0;
      measuringIntervall = 2;
      currentSpeed = stepsPerSecond;
    }



    ///////////////// MANUAL MODE //////////////////
  } else if (mode == 2) {
    boolean performStep = 0;
    if (!digitalRead(upPin)) {
      digitalWrite(directionPin, LOW);
      performStep = 1;
      if(debug){ Serial.println("UP"); }
    } else if (!digitalRead(downPin)) {
      digitalWrite(directionPin, HIGH);
      performStep = 1;
      if(debug){ Serial.println("DOWN"); }
    }
    //Perform Step
    if (performStep) {
      digitalWrite(stepPin, HIGH);
      delayMicroseconds(pulseLength);
      digitalWrite(stepPin, LOW);
    }
    if (digitalRead(speedPin)) {
      delayMicroseconds(slowSpeedDelay);
      if(debug){Serial.println("Slow Speed");}
    } else {
      delayMicroseconds(fastSpeedDelay);
      if(debug){Serial.println("Fast Speed");}
    }

    // Fast Test Mode
  } else if (mode == 3) {
    currentMicros = micros();
    if ((currentMicros - lastStep) >= 1000000. / fastSpeed) {
      digitalWrite(stepPin, HIGH);
      delayMicroseconds(pulseLength);
      digitalWrite(stepPin, LOW);
      lastStep = currentMicros;
    }
    if (!digitalRead(downPin)) {
      Serial.println("Test aborted - entering manual mode");
      printSpaces(5);
      mode = 2;
      modeAddition = 0;
      measuringIntervall = 2;
      currentSpeed = stepsPerSecond;
    }
    // Youngs Modulus Test
  } else if (mode == 4) {
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
      Serial.println("Test aborted - entering manual mode");
      printSpaces(5);
      mode = 2;
      modeAddition = 0;
      measuringIntervall = 2;
      currentSpeed = stepsPerSecond;
    }
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

void printSpaces(int numberOfSpaces) { //This function will print a given amount of empty lines
  for (int i = numberOfSpaces; i > 0; i--) {
    Serial.println("");
  }
}
