# Site Beacon (optional, decided at hour 16)

- `firmware/`: Arduino sketch (buzzer, red/green LED, LCD countdown that runs on the board).
- `bridge/`: Python serial bridge that receives stop-work / all-clear events and writes to USB serial.

Setup: install the Arduino IDE (https://www.arduino.cc/en/software) or
`brew install arduino-cli`. After the event, upload the blank `BareMinimum` sketch.
