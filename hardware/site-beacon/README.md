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

## ML integration (secondary, display only)

The hazard-index model is scored server-side (`backend/ml/src/cypress_ml/score.py`
→ `backend/workers/data/live/scores_latest.json`). A hazard score is a probability,
not a stop-work authority — the bridge only mirrors it on the LCD:

```bash
pip install -r hardware/site-beacon/bridge/requirements.txt
python backend/ml/src/cypress_ml/score.py             # refresh scores
python hardware/site-beacon/bridge/bridge.py --site site_6043 --ml-score --port COM5
```

## Live mode (default: mirrors the stop-work engine)

The beacon's stop-work state must come from the deterministic engine, not the model.
The bridge listens to the engine's decision log (`events.json`) and resyncs from the
authoritative state (`stop_work.json`) — reacts within ~1 s to:

- `stop_work_started` / `stop_work_extended` → `STRIKE <remaining>` (LCD shows the real countdown)
- `all_clear` (30-minute rule expiry) / override → `ALLCLEAR`

A fresh bridge boot picks up an in-progress stop-work from state, so a restart never
misses an active stop-work.

```bash
python hardware/site-beacon/bridge/bridge.py --site site_6043 --port COM5          # live (default)
python hardware/site-beacon/bridge/bridge.py --site site_6043 --no-device          # dry run
```

