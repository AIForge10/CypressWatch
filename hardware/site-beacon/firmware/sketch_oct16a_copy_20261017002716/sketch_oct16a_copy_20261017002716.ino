#include <rgb_lcd.h>
#include <Wire.h>

#define RED_PIN 2
#define GREEN_PIN 3
#define BUZZER_PIN 5

rgb_lcd lcd{};

  const auto colorR{0};   // Red component
  const auto colorG{128}; // Green component
  const auto colorB{255}; // Blue component

void flash_pin(int pin_num, int d= 1000){

  digitalWrite(pin_num, HIGH);   
  delay(d);                   
  digitalWrite(pin_num, LOW);    
  delay(d);          
}
void display_message(String& message){
  lcd.begin(16, 2);
  lcd.setRGB(colorR, colorG, colorB);
  lcd.print(message);
    lcd.setCursor(0, 1);
}

bool is_risky(){ //TODO
   return python_harness_function();
}

void play_sound(){
  for (int frequency = 1500; frequency <= 3000; frequency += 15) {
    tone(BUZZER_PIN, frequency);
    delay(1); 
  }
  for (int frequency = 3000; frequency >= 1500; frequency -= 15) {
    tone(BUZZER_PIN, frequency);
    delay(2);
  }
}

void setup() {
  pinMode(pin_num, OUTPUT); 
  pinMode(BUZZER_PIN, OUTPUT);
  display_message("Ok");
}

void loop() {
  if(is_risky){
    flash_pin(RED,50);
    display_message("DANGER");
    play_sound();
  }
  else{
    flash_pin(green,100000);
    display_message("OK");
  }

}
