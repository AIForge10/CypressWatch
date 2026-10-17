"""Turn each site's score and top factors into one plain-English sentence (fills `explanation`).

Usage (from the repo root, conda env active), after score.py has run:
    python backend/ai/cypress_ai/explain/explainer.py            # today's scores
    python backend/ai/cypress_ai/explain/explainer.py --limit 3  # cheap test on 3 sites

From Python (M4):
    from cypress_ai.explain.explainer import explain_scores
    scores = explain_scores(scores, sites)   # adds "explanation" and "explanation_source" to each score

Design:
  - Gemini only rephrases facts we give it (score, risk level, top factor labels). It never computes anything.
  - Every sentence is validated: no numbers or hazards that are not in the facts, no "safe" claims, short.
  - If validation fails or Gemini is unavailable, a plain template sentence is used, so the UI never shows a blank.
  - Results are cached per (site, date, score, factors), so unchanged sites cost nothing on the next refresh.
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # backend/ai, so this file also runs as a script
from cypress_ai.config import BACKEND, FAST_MODEL, generate_json  # noqa: E402

SCORES_FILE = BACKEND / "workers" / "data" / "live" / "scores_latest.json"
SITES_FILE = BACKEND / "data" / "sites" / "sites.json"
CACHE_FILE = BACKEND / "ai" / "cache" / "explanations.json"
BATCH = 20
MAX_CHARS = 240

SYSTEM = (
    "You write one-sentence risk explanations for utility field supervisors in Florida. "
    "Use ONLY the facts provided for each site: its name, score, risk level and listed reasons. "
    "Do not add any hazard, number, time, place or advice that is not in the facts. "
    "Never say a site is safe or risk-free. Plain English, at most 30 words, one sentence per site."
)


class Explanation(BaseModel):
    site_id: str
    explanation: str


# Hazard words Gemini may only use when a matching reason is present.
HAZARD_WORDS = {
    "lightning": {"lightning_stop_work"},
    "thunder": {"lightning_stop_work"},
    "flood": {"precipitation_sum", "rain_3d_in", "rain_7d_in", "rain_30d_in", "heavy_rain_day", "precipitation_hours"},
    "storm": {"precipitation_sum", "precipitation_hours", "wind_gusts_10m_max", "lightning_stop_work"},
    "heat": {"apparent_temperature_max", "temperature_2m_max"},
    "fire": set(), "wildfire": set(), "tornado": set(), "hurricane": set(), "hail": set(),
    "alligator": set(), "snake": set(),
}
BANNED = ("safe to", "is safe", "no risk", "risk-free", "guarantee")
NUMBER = re.compile(r"\d+(?:\.\d+)?")


def _norm(n: str) -> str:
    return n.rstrip("0").rstrip(".") if "." in n else n


def validate(text: str, fact: dict) -> list[str]:
    """Return a list of problems; an empty list means the sentence is grounded in the facts."""
    problems = []
    t = text.strip()
    if not t:
        return ["empty"]
    if len(t) > MAX_CHARS:
        problems.append("too long")
    low = t.lower()
    if any(b in low for b in BANNED):
        problems.append("safety claim")
    allowed = {_norm(n) for n in NUMBER.findall(" ".join([fact["name"], fact["score_text"], *fact["reasons"]]))}
    allowed |= {"0", "10"}  # "out of 10" / "0–10" scale wording
    extra = sorted({_norm(n) for n in NUMBER.findall(t)} - allowed)
    if extra:
        problems.append(f"numbers not in facts: {extra}")
    features = set(fact["features"])
    for word, needs in HAZARD_WORDS.items():
        if re.search(rf"\b{word}", low) and not (needs & features):
            problems.append(f"hazard not in facts: {word}")
    return problems


def template(fact: dict) -> str:
    reasons = [r[0].lower() + r[1:] for r in fact["reasons"][:2]]
    if not reasons:
        return f"{fact['name']} scores {fact['score_text']} ({fact['risk_level']}); no single weather factor stands out."
    because = reasons[0] if len(reasons) == 1 else f"{reasons[0]} and {reasons[1]}"
    return f"{fact['name']} scores {fact['score_text']} ({fact['risk_level']}), mainly because of {because}."


def _key(fact: dict) -> str:
    raw = json.dumps([fact["site_id"], fact["date"], fact["score_text"], fact["reasons"]])
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


def _load_cache() -> dict:
    try:
        return json.loads(CACHE_FILE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def explain_scores(scores: list[dict], sites: list[dict], model: str = FAST_MODEL,
                   use_cache: bool = True) -> list[dict]:
    names = {s["site_id"]: s.get("name", s["site_id"]) for s in sites}
    cache = _load_cache() if use_cache else {}
    facts = []
    for s in scores:
        facts.append({
            "site_id": s["site_id"], "date": s["date"], "name": names.get(s["site_id"], s["site_id"]),
            "score_text": f"{s['hazard_score']:.1f}", "risk_level": s["risk_level"],
            "reasons": [f["label"] for f in s.get("top_factors", [])],
            "features": [f["feature"] for f in s.get("top_factors", [])],
        })

    todo = [f for f in facts if _key(f) not in cache]
    for i in range(0, len(todo), BATCH):
        chunk = todo[i:i + BATCH]
        prompt = "Write one explanation per site. Facts:\n" + json.dumps(
            [{k: f[k] for k in ("site_id", "name", "score_text", "risk_level", "reasons")} for f in chunk], indent=1)
        try:
            data, info = generate_json(prompt, list[Explanation], model=model, system=SYSTEM)
            got = {d["site_id"]: d["explanation"] for d in data}
        except RuntimeError as e:
            print(f"  Gemini unavailable, using templates for {len(chunk)} sites: {e}")
            got, info = {}, {"model": None}
        for f in chunk:
            text = got.get(f["site_id"], "")
            problems = validate(text, f) if text else ["missing"]
            cache[_key(f)] = ({"text": text, "source": f"gemini:{info['model']}"} if not problems
                              else {"text": template(f), "source": "template", "rejected": text, "problems": problems})

    if use_cache:
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        CACHE_FILE.write_text(json.dumps(cache, indent=1))
    for s, f in zip(scores, facts):
        entry = cache[_key(f)]
        s["explanation"] = entry["text"]
        s["explanation_source"] = entry["source"]
    return scores


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scores", default=str(SCORES_FILE))
    ap.add_argument("--sites", default=str(SITES_FILE))
    ap.add_argument("--limit", type=int, default=None, help="only explain the top N sites (cheap testing)")
    ap.add_argument("--no-cache", action="store_true")
    args = ap.parse_args()

    payload = json.loads(Path(args.scores).read_text())
    sites_json = json.loads(Path(args.sites).read_text())
    sites = sites_json["sites"] if isinstance(sites_json, dict) else sites_json
    today = sorted((s for s in payload["scores"] if s["day_offset"] == 0), key=lambda s: -s["hazard_score"])
    chosen = today[:args.limit] if args.limit else today

    explain_scores(chosen, sites, use_cache=not args.no_cache)
    Path(args.scores).write_text(json.dumps(payload, indent=2))  # chosen rows were updated in place

    sources = {}
    for s in chosen:
        sources[s["explanation_source"]] = sources.get(s["explanation_source"], 0) + 1
    print(f"Explained {len(chosen)} sites: {sources}")
    for s in chosen[:5]:
        print(f"  {s['hazard_score']:4.1f}  {s['explanation']}")
    print(f"Saved explanations into {args.scores}")


if __name__ == "__main__":
    main()