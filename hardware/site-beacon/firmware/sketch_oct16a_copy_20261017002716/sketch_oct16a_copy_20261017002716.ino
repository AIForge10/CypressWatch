#include <rgb_lcd.h>
#include <Wire.h>

#define RED_PIN 2
#define GREEN_PIN 3
#define BUZZER_PIN 5

rgb_lcd lcd;

enum State { ALL_CLEAR, STRIKE_ACTIVE };

State currentState = ALL_CLEAR;

// Latest hazard score from the backend ML model (0-10), or -1 if unknown
int hazardScore = -1;

// Timing
unsigned long strikeEndMillis = 0;  // when countdown ends
unsigned long lastLcdUpdate = 0;     // last time we updated LCD
const unsigned long lcdUpdateInterval = 1000; // ms

// Colors
const int colorRedR = 255;
const int colorRedG = 0;
const int colorRedB = 0;

const int colorGreenR = 0;
const int colorGreenG = 255;
const int colorGreenB = 0;

// Serial buffer
String cmdBuffer;

void setLedRed() {
  digitalWrite(RED_PIN, HIGH);
  digitalWrite(GREEN_PIN, LOW);
  lcd.setRGB(colorRedR, colorRedG, colorRedB);
}

void setLedGreen() {
  digitalWrite(RED_PIN, LOW);
  digitalWrite(GREEN_PIN, HIGH);
  lcd.setRGB(colorGreenR, colorGreenG, colorGreenB);
}

void soundBuzzerOnce() {
  const int duty = 64; // 25% duty cycle (0-255); increase if too quiet
  const int cyclesPerStep = 5;

  // upward sweep 1500-2000 Hz
  for (int f = 1500; f <= 2000; f += 20) {
    unsigned long periodUs = 1000000UL / (unsigned long)f;
    unsigned long onUs = (periodUs * (unsigned long)duty) / 255UL;
    unsigned long offUs = periodUs - onUs;
    for (int c = 0; c < cyclesPerStep; c++) {
      digitalWrite(BUZZER_PIN, HIGH);
      delayMicroseconds(onUs);
      digitalWrite(BUZZER_PIN, LOW);
      delayMicroseconds(offUs);
    }
  }
  // downward sweep 2000-1500 Hz
  for (int f = 2000; f >= 1500; f -= 20) {
    unsigned long periodUs = 1000000UL / (unsigned long)f;
    unsigned long onUs = (periodUs * (unsigned long)duty) / 255UL;
    unsigned long offUs = periodUs - onUs;
    for (int c = 0; c < cyclesPerStep; c++) {
      digitalWrite(BUZZER_PIN, HIGH);
      delayMicroseconds(onUs);
      digitalWrite(BUZZER_PIN, LOW);
      delayMicroseconds(offUs);
    }
  }
  digitalWrite(BUZZER_PIN, LOW);
}

void enterAllClear() {
  currentState = ALL_CLEAR;
  strikeEndMillis = 0;
  digitalWrite(BUZZER_PIN, LOW); // stop any sound
  setLedGreen();
  showAllClear();
}

void showAllClear() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("All clear");
  lcd.setCursor(0, 1);
  if (hazardScore >= 0) {
    lcd.print("Hazard: ");
    lcd.print(hazardScore);
    lcd.print("/10");
  }
}

void handleHazard(const String &payload) {
  int val = payload.toInt();
  if (val < 0 || val > 10) return;
  bool changed = val != hazardScore;
  hazardScore = val;
  if (currentState == ALL_CLEAR && changed) {
    showAllClear();
  }
}

void enterStrike(unsigned long durationSeconds) {
  unsigned long now = millis();
  strikeEndMillis = now + (durationSeconds * 1000UL);
  currentState = STRIKE_ACTIVE;
  setLedRed();
  soundBuzzerOnce();
  lastLcdUpdate = 0;
}

void updateCountdownDisplay() {
  unsigned long now = millis();
  if (strikeEndMillis <= now) {
    enterAllClear();
    return;
  }
  unsigned long remaining = (strikeEndMillis - now) / 1000UL;
  unsigned long mins = remaining / 60;
  unsigned long secs = remaining % 60;
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("STRIKE");
  lcd.setCursor(0, 1);
  if (mins < 10) lcd.print('0');
  lcd.print(mins);
  lcd.print(':');
  if (secs < 10) lcd.print('0');
  lcd.print(secs);
}

void handleSerial() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (cmdBuffer.length() > 0) {
        parseCommand(cmdBuffer);
        cmdBuffer = "";
      }
    } else {
      cmdBuffer += c;
    }
  }
}

void parseCommand(const String &s) {
  String cmd = s;
  cmd.trim();
  cmd.toUpperCase();

  if (cmd.startsWith("STRIKE") || cmd.startsWith("STOP")) {
    int spaceIdx = cmd.indexOf(' ');
    if (spaceIdx > 0) {
      String secStr = cmd.substring(spaceIdx + 1);
      secStr.trim();
      unsigned long dur = secStr.toInt();
      if (dur > 0) {
        enterStrike(dur);
      } else {
        enterAllClear();
      }
    }
    return;
  }
  if (cmd == "ALLCLEAR" || cmd == "CLEAR") {
    enterAllClear();
    return;
  }
  if (cmd.startsWith("HAZARD") && cmd.length() > 7) {
    handleHazard(cmd.substring(7));
    return;
  }
}

void updateState() {
  if (currentState == STRIKE_ACTIVE) {
    unsigned long now = millis();
    if (now >= strikeEndMillis) {
      enterAllClear();
    }
  }
}

void updateDisplay() {
  if (currentState == STRIKE_ACTIVE) {
    unsigned long now = millis();
    if (now - lastLcdUpdate >= lcdUpdateInterval) {
      updateCountdownDisplay();
      lastLcdUpdate = now;
    }
  }
}

void setup() {
  pinMode(RED_PIN, OUTPUT);
  pinMode(GREEN_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  Serial.begin(9600);
  Wire.begin();
  Wire.setClock(100000);

  lcd.begin(16, 2);
  lcd.setRGB(colorGreenR, colorGreenG, colorGreenB);

  enterAllClear();
}

void loop() {
  handleSerial();
  updateState();
  updateDisplay();
}
