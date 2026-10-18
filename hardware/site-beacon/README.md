# Site Beacon (optional, decided at hour 16)

- `firmware/`: Arduino sketch (buzzer, red/green LED, LCD countdown that runs on the board).
- `bridge/`: Python serial bridge that receives stop-work / all-clear events and writes to USB serial.

Setup: install the Arduino IDE (https://www.arduino.cc/en/software) or
`brew install arduino-cli`. After the event, upload the blank `BareMinimum` sketch.

## Serial protocol (9600 baud)

| Command | Effect |
|---|---|
| `STRIKE <seconds>` / `STOP <seconds>` | red LED, buzzer sweep, LCD countdown `mm:ss` (each new strike resets it) |
| `ALLCLEAR` / `CLEAR` | green LED, "All clear" |
| `HAZARD <0..10>` | shows `Hazard: n/10` on the LCD's second line while all-clear |

## ML integration

The hazard-index model is scored server-side (`backend/ml/src/cypress_ml/score.py`
→ `backend/workers/data/live/scores_latest.json`). The bridge polls that file and
writes the score to the beacon; a score ≥ 8 (`--trigger`) starts a 30-minute
stop-work (`STRIKE 1800`), matching the 10-mile/30-minute alert rule in `contracts/`.

```bash
pip install -r hardware/site-beacon/bridge/requirements.txt
python backend/ml/src/cypress_ml/score.py             # refresh scores
python hardware/site-beacon/bridge/bridge.py --site site_6043 --port COM5
python hardware/site-beacon/bridge/bridge.py --site site_6043 --no-device   # dry run
```

## Watch mode (mirrors the live engine)

With the worker engine running, a site can follow the real stop-work state instead of the
score threshold. The bridge polls `stop_work.json` every `--interval` seconds:

```bash
python hardware/site-beacon/bridge/bridge.py --watch-state site_6043 --port COM5
```

`STRIKE <remaining>` is sent when a stop-work starts or is extended (LCD shows the real
countdown); `ALLCLEAR` is sent when the state expires or is overridden. Parse errors just
log a warning and keep polling.

