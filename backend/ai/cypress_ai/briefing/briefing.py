# """Next-day safety briefing for each site, in English and Spanish (Sperry: "every evening at 6 PM").

# Usage (from the repo root, conda env active), after weather_live.py and score.py have run:
#     python backend/ai/cypress_ai/briefing/briefing.py --limit 3          # cheap test on 3 sites
#     python backend/ai/cypress_ai/briefing/briefing.py --site site_6043   # one site
#     python backend/ai/cypress_ai/briefing/briefing.py                    # all sites

# From Python (M4's 6 PM scheduler, per site time zone):
#     from cypress_ai.briefing.briefing import generate_briefing
#     result = generate_briefing(site, weather_record, tomorrow_score)   # result["en"], result["es"]

# How it stays grounded:
#   1. Plain code computes every fact from the hourly forecast, recent rain and the model score:
#      heat index peak, thunderstorm hours, gusts, rain, soil saturation, hazard levels, best work window.
#      Each fact is written in English and Spanish and tied to a source id.
#   2. Gemini (GEMINI_BRIEFING_MODEL, e.g. gemini-4-argon) only rewrites those facts as a readable briefing.
#   3. A validator rejects output that changes a level, drops or adds a hazard, cites an unknown source,
#      contains a number not in the facts, or claims work is safe. One retry listing the problems, then a template.
# """
# import argparse
# import json
# import re
# import sys
# from datetime import datetime, timedelta, timezone
# from pathlib import Path

# from pydantic import BaseModel

# sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # backend/ai
# from cypress_ai.config import BACKEND, BRIEFING_MODEL, generate_json  # noqa: E402

# LIVE = BACKEND / "workers" / "data" / "live"
# OUT_DIR = LIVE / "briefings"
# SITES_FILE = BACKEND / "data" / "sites" / "sites.json"

# WORK_START, WORK_END = 6, 18          # work-day hours considered for hazards and the best work window
# THUNDER_CODES = {95, 96, 99}
# LEVELS = ["low", "moderate", "high", "extreme"]
# ES_LEVEL = {"low": "bajo", "moderate": "moderado", "high": "alto", "extreme": "extremo"}
# DISCLAIMER = {
#     "en": "Decision support only. Follow your company's safety procedures and your supervisor's direction.",
#     "es": "Solo apoyo para decisiones. Siga los procedimientos de seguridad de su empresa y las indicaciones de su supervisor.",
# }
# BANNED = {"en": ("safe to", "is safe", "no risk", "risk-free", "guarantee"),
#           "es": ("es seguro", "seguro trabajar", "sin riesgo", "garantiza")}
# NUMBER = re.compile(r"\d+(?:\.\d+)?")

# SYSTEM = (
#     "You write next-day safety briefings for utility field crews in Florida. "
#     "You receive hazards, each with a level, facts in English and Spanish, and source ids, plus an overall model score. "
#     "Write the same briefing in English (en) and Spanish (es). "
#     "Rules: include every hazard given exactly once, using its hazard name exactly as given and its given level; "
#     "do not add hazards; use only numbers and times that appear in the facts; cite the given source ids; "
#     "never say work is safe or risk-free; each item is one or two short sentences a crew lead can read aloud. "
#     "The headline is one sentence with tomorrow's overall risk level and the best work window if one is given. "
#     "If the overall level is higher than every hazard item, add a short second sentence with the top one or two reasons, "
#     "rephrased naturally in lowercase (not copied as labels) "
#     "(English: overall.main_reasons; Spanish: overall.main_reasons_es), so the briefing does not look contradictory. "
#     "In Spanish text, write risk levels in Spanish (bajo, moderado, alto, extremo) as given in level_es; "
#     "the JSON field 'level' always stays in English."
# )
# EN_LEVEL_WORDS = re.compile(r"\b(low|moderate|high|extreme)\b", re.IGNORECASE)
# EN_WORDS = re.compile(r"\b(of|the|and|with|rain|days|hours|this week|this month)\b", re.IGNORECASE)

# ODD_SPACE = re.compile(r"[\u00a0\u1680\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]")


# def _clean(text: str) -> str:
#     """Turn invisible or unusual spaces from the model into normal spaces."""
#     return re.sub(r"\s+", " ", ODD_SPACE.sub(" ", text)).strip()


# # Spanish versions of the model's reason labels (from score.py LABELS), so Spanish text never copies English.
# ES_REASONS = [
#     (r"^Rain ([\d.]+) in$", "Lluvia de {0} pulgadas"),
#     (r"^([\d.]+) hours of rain$", "{0} horas de lluvia"),
#     (r"^Wind gusts ([\d.]+) mph$", "Ráfagas de viento de {0} mph"),
#     (r"^Feels like ([\d.]+)°F$", "Sensación térmica de {0}°F"),
#     (r"^High of ([\d.]+)°F$", "Temperatura máxima de {0}°F"),
#     (r"^([\d.]+) in of rain in 3 days$", "{0} pulgadas de lluvia en 3 días"),
#     (r"^([\d.]+) in of rain this week$", "{0} pulgadas de lluvia esta semana"),
#     (r"^([\d.]+) in of rain this month$", "{0} pulgadas de lluvia este mes"),
#     (r"^([\d.]+) days since rain$", "{0} días sin lluvia"),
#     (r"^Rain today$", "Lluvia hoy"),
#     (r"^Rain tomorrow$", "Lluvia mañana"),
#     (r"^Rain yesterday$", "Lluvia ayer"),
#     (r"^Heavy rain \(2\+ in\)$", "Lluvia intensa (2+ pulgadas)"),
#     (r"^Area with frequent past hazard reports$", "Historial de peligros frecuentes en el área"),
#     (r"^Site location$", "Ubicación del sitio"),
#     (r"^Time of year$", "Época del año"),
#     (r"^Lightning within 10 miles \(stop-work active\)$", "Rayos a menos de 10 millas (paro de trabajo activo)"),
# ]


# def reason_es(label: str) -> str | None:
#     for pattern, out in ES_REASONS:
#         m = re.match(pattern, label)
#         if m:
#             return out.format(*m.groups())
#     return None  # unknown label: left out of the Spanish reasons


# class Item(BaseModel):
#     hazard: str
#     level: str
#     text: str
#     source_ids: list[str]


# class Lang(BaseModel):
#     headline: str
#     items: list[Item]


# class Briefing(BaseModel):
#     en: Lang
#     es: Lang


# # ---------- facts (plain code, no AI) ----------

# def _t12(hour: int) -> str:
#     return f"{hour % 12 or 12} {'AM' if hour < 12 else 'PM'}"


# def _t24(hour: int) -> str:
#     return f"{hour:02d}:00"


# def _level(value, cuts: list[tuple[float, str]]) -> str:
#     level = "low"
#     for cut, name in cuts:
#         if value is not None and value >= cut:
#             level = name
#     return level


# def best_work_window(hours: list[dict]) -> dict | None:
#     """Longest run of 2+ work hours with heat index < 103°F, no thunderstorm, rain chance < 40%, gusts < 35 mph."""
#     def ok(h):
#         return ((h.get("heat_index_f") or 0) < 103 and h.get("weather_code") not in THUNDER_CODES
#                 and (h.get("precipitation_probability") or 0) < 40 and (h.get("wind_gusts_10m") or 0) < 35)
#     best, run = None, []
#     for h in hours:
#         hr = int(h["time"][11:13])
#         if WORK_START <= hr < WORK_END and ok(h):
#             run.append(hr)
#         else:
#             run = []
#         if len(run) >= 2 and (best is None or len(run) > best[1] - best[0]):
#             best = (run[0], run[-1] + 1)
#     if not best:
#         return None
#     return {"start_local": _t24(best[0]), "end_local": _t24(best[1]),
#             "reason": "Heat index under 103°F, no thunderstorms, rain chance under 40% and gusts under 35 mph."}


# def build_facts(site: dict, rec: dict, score: dict | None, for_date: str) -> dict:
#     """Everything the briefing may say. Each hazard: level, English and Spanish facts, source ids."""
#     hours = [h for h in rec.get("hourly", []) if h["time"].startswith(for_date)]
#     work = [h for h in hours if WORK_START <= int(h["time"][11:13]) < WORK_END]
#     sources, hazards, missing = [], [], []

#     if work:
#         sources.append({"id": "src_1", "source": "open-meteo", "observed_at": rec.get("fetched_at"),
#                         "description": f"Hourly forecast for {for_date}"})
#         peak = max(work, key=lambda h: h.get("heat_index_f") or -999)
#         hi, hr = round(peak.get("heat_index_f") or 0), int(peak["time"][11:13])
#         n103 = sum((h.get("heat_index_f") or 0) >= 103 for h in work)
#         hazards.append({"hazard": "heat", "level": _level(hi, [(90, "moderate"), (103, "high"), (125, "extreme")]),
#                         "source_ids": ["src_1"],
#                         "facts_en": f"Peak heat index {hi}°F around {_t12(hr)}; {n103} work hours at or above 103°F.",
#                         "facts_es": f"Índice de calor máximo de {hi}°F alrededor de las {_t24(hr)}; "
#                                     f"{n103} horas de trabajo a 103°F o más."})

#         storms = [int(h["time"][11:13]) for h in work if h.get("weather_code") in THUNDER_CODES]
#         pop = max((h.get("precipitation_probability") or 0) for h in work)
#         if storms:
#             en = (f"Thunderstorms forecast from {_t12(storms[0])}, {len(storms)} work hours in total. "
#                   f"Any lightning within 10 miles stops work for 30 minutes.")
#             es = (f"Tormentas eléctricas pronosticadas desde las {_t24(storms[0])}, {len(storms)} horas de trabajo en total. "
#                   f"Cualquier rayo a menos de 10 millas detiene el trabajo por 30 minutos.")
#         else:  # only shown when showers are likely enough that lightning is worth watching for
#             en = (f"Rain chance up to {pop}%; thunderstorms are not forecast, but watch for lightning with showers. "
#                   f"Any lightning within 10 miles stops work for 30 minutes.")
#             es = (f"Probabilidad de lluvia de hasta {pop}%; no se pronostican tormentas eléctricas, pero esté atento a rayos "
#                   f"con los chubascos. Cualquier rayo a menos de 10 millas detiene el trabajo por 30 minutos.")
#         hazards.append({"hazard": "lightning", "level": "high" if storms else _level(pop, [(60, "moderate")]),
#                         "source_ids": ["src_1"], "facts_en": en, "facts_es": es})

#         g = max(work, key=lambda h: h.get("wind_gusts_10m") or 0)
#         gv, gh = round(g.get("wind_gusts_10m") or 0), int(g["time"][11:13])
#         hazards.append({"hazard": "storm", "level": _level(gv, [(25, "moderate"), (40, "high"), (58, "extreme")]),
#                         "source_ids": ["src_1"],
#                         "facts_en": f"Wind gusts up to {gv} mph around {_t12(gh)}.",
#                         "facts_es": f"Ráfagas de viento de hasta {gv} mph alrededor de las {_t24(gh)}."})

#         rain = round(sum((h.get("precipitation") or 0) for h in hours), 1)
#         hazards.append({"hazard": "flood", "level": _level(rain, [(0.5, "moderate"), (2.0, "high")]),
#                         "source_ids": ["src_1"],
#                         "facts_en": f"About {rain} in of rain expected over the day.",
#                         "facts_es": f"Se esperan unas {rain} pulgadas de lluvia durante el día."})
#     else:
#         missing.append("hourly forecast")

#     week = [d for d in rec.get("daily", []) if d["date"] <= for_date][-7:]
#     if len(week) == 7:
#         wk = round(sum((d.get("precipitation_sum") or 0) for d in week), 1)
#         if "src_1" not in {s["id"] for s in sources}:
#             sources.append({"id": "src_1", "source": "open-meteo", "observed_at": rec.get("fetched_at"),
#                             "description": f"Daily weather through {for_date}"})
#         hazards.append({"hazard": "soil_saturation", "level": _level(wk, [(1.5, "moderate"), (3.0, "high")]),
#                         "source_ids": ["src_1"],
#                         "facts_en": f"{wk} in of rain over the past 7 days; expect soft, muddy ground and slow vehicle access.",
#                         "facts_es": f"{wk} pulgadas de lluvia en los últimos 7 días; espere suelo blando, lodo y acceso lento de vehículos."})

#     overall = None
#     if score:
#         sources.append({"id": "src_2", "source": "cypresswatch-model", "observed_at": score.get("scored_at"),
#                         "description": f"Hazard index {score['model_version']}"})
#         overall = {"score": score["hazard_score"], "risk_level": score["risk_level"],
#                    "level_es": ES_LEVEL[score["risk_level"]], "source_ids": ["src_2"],
#                    "main_reasons": [f["label"] for f in score.get("top_factors", [])[:3]],
#                    "main_reasons_es": [r for f in score.get("top_factors", [])[:3] if (r := reason_es(f["label"]))]}
#     else:
#         missing.append("model score")

#     shown = [h for h in hazards if LEVELS.index(h["level"]) >= 1]  # only hazards at moderate or above
#     for h in shown:
#         h["level_es"] = ES_LEVEL[h["level"]]
#     return {"site_id": site["site_id"], "name": site.get("name", site["site_id"]), "for_date": for_date,
#             "hazards": shown, "overall": overall, "sources": sources, "missing_data": missing,
#             "best_work_window": best_work_window(hours)}


# # ---------- validation ----------


# def validate(lang: str, out: dict, facts: dict) -> list[str]:
#     problems = []
#     given = {h["hazard"]: h for h in facts["hazards"]}
#     got = [i["hazard"] for i in out["items"]]
#     if sorted(got) != sorted(given):
#         problems.append(f"{lang}: hazards {sorted(got)} must be exactly {sorted(given)}")
#     allowed = set(NUMBER.findall(" ".join([facts["name"], json.dumps(facts["hazards"], ensure_ascii=False),
#                                            json.dumps(facts["overall"] or {}), json.dumps(facts["best_work_window"] or {})])))
#     allowed |= {n.lstrip("0") or "0" for n in allowed}
#     source_ids = {s["id"] for s in facts["sources"]}
#     for item in out["items"]:
#         ref = given.get(item["hazard"])
#         if ref and item["level"] != ref["level"]:
#             problems.append(f"{lang}: {item['hazard']} level '{item['level']}' should be '{ref['level']}'")
#         if not item["source_ids"] or not set(item["source_ids"]) <= source_ids:
#             problems.append(f"{lang}: {item['hazard']} cites unknown source {item['source_ids']}")

#         src_text = " ".join([facts["name"], *(h[f"facts_{lang}"] for h in facts["hazards"]),
#                          *(facts["overall"] or {}).get("main_reasons" if lang == "en" else "main_reasons_es", [])])
#     src_words = re.findall(r"[A-Za-zÁÉÍÓÚáéíóúñ]+", src_text)
#     glued = {(a + b).lower() for a, b in zip(src_words, src_words[1:]) if len(a) > 2 and len(b) > 2}

#     for t in [out["headline"]] + [i["text"] for i in out["items"]]:
#         extra = sorted({n for n in NUMBER.findall(t) if n not in allowed and (n.lstrip("0") or "0") not in allowed})
#         if extra:
#             problems.append(f"{lang}: numbers not in facts {extra} in '{t[:60]}'")
#         if any(b in t.lower() for b in BANNED[lang]):
#             problems.append(f"{lang}: safety claim in '{t[:60]}'")
#         if lang == "es" and EN_LEVEL_WORDS.search(t.replace(facts["name"], "")):
#             problems.append(f"es: English level word in Spanish text '{t[:60]}'")
#         if lang == "es" and EN_WORDS.search(t.replace(facts["name"], "")):
#             problems.append(f"es: English words in Spanish text '{t[:60]}'; use main_reasons_es and facts_es")
#         if re.search(r"\d[A-Za-zÁÉÍÓÚáéíóúñ]", t.replace(facts["name"], "")):
#             problems.append(f"{lang}: missing space after a number in '{t[:60]}'")

#         stuck = [w for w in re.findall(r"[A-Za-zÁÉÍÓÚáéíóúñ]+", t) if w.lower() in glued]
#         if stuck:
#             problems.append(f"{lang}: missing space in {stuck}")
        
#         if len(t) > 300:
#             problems.append(f"{lang}: text over 300 characters")
#     return problems


# # ---------- template fallback (no AI) ----------

# def template(facts: dict) -> dict:
#     w, o = facts["best_work_window"], facts["overall"]
#     win_en = f"Best work window: {w['start_local']}–{w['end_local']}." if w else "No clear low-risk work window."
#     win_es = f"Mejor horario de trabajo: {w['start_local']}–{w['end_local']}." if w else "No hay un horario claro de bajo riesgo."
#     head_en = (f"{o['risk_level'].capitalize()} risk tomorrow (score {o['score']}). " if o else "Risk score unavailable. ") + win_en
#     head_es = (f"Riesgo {ES_LEVEL[o['risk_level']]} mañana (puntuación {o['score']}). " if o else "Puntuación no disponible. ") + win_es
#     items = lambda lang: [{"hazard": h["hazard"], "level": h["level"], "text": h[f"facts_{lang}"],
#                            "source_ids": h["source_ids"]} for h in facts["hazards"]]
#     return {"en": {"headline": head_en, "items": items("en")}, "es": {"headline": head_es, "items": items("es")}}


# # ---------- main entry ----------

# def generate_briefing(site: dict, rec: dict, score: dict | None, for_date: str | None = None,
#                       model: str = BRIEFING_MODEL) -> dict:
#     local_today = (rec.get("current", {}).get("observed_at_local") or datetime.now().isoformat())[:10]
#     for_date = for_date or (datetime.fromisoformat(local_today) + timedelta(days=1)).strftime("%Y-%m-%d")
#     facts = build_facts(site, rec, score, for_date)
#     payload = {k: facts[k] for k in ("name", "for_date", "hazards", "overall", "best_work_window", "missing_data")}
#     prompt = "Write tomorrow's briefing from these facts only:\n" + json.dumps(payload, indent=1, ensure_ascii=False)

#     out, info, problems, attempts = None, {"model": None, "latency_s": None}, [], 0
#     for attempts in (1, 2):
#         try:
#             data, info = generate_json(prompt, Briefing, model=model, system=SYSTEM)
#         except RuntimeError as e:
#             problems = [str(e)]
#             break

#         for lang in ("en", "es"):
#             data[lang]["headline"] = _clean(data[lang]["headline"])
#             for it in data[lang]["items"]:
#                 it["text"] = _clean(it["text"])
#         problems = validate("en", data["en"], facts) + validate("es", data["es"], facts)
#         if not problems:
#             out = data
#             break
#         prompt += "\n\nYour previous answer was rejected for these problems; fix them:\n- " + "\n- ".join(problems)

#     validated = out is not None
#     out = out or template(facts)
#     generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
#     result = {"site_id": site["site_id"], "for_date": for_date, "validated": validated,
#               "source": f"gemini:{info['model']}" if validated else "template",
#               "latency_s": info.get("latency_s"), "attempts": attempts,
#               "problems": [] if validated else problems, "facts": facts}
#     for lang in ("en", "es"):
#         result[lang] = {  # same shape as Briefing in contracts/types.ts
#             "briefing_id": f"brf_{site['site_id']}_{for_date.replace('-', '')}_{lang}",
#             "site_id": site["site_id"], "for_date": for_date, "generated_at": generated_at,
#             "language": lang, "available_languages": ["en", "es"],
#             "headline": out[lang]["headline"],
#             "hazard_score_forecast": score["hazard_score"] if score else None,
#             "risk_level": score["risk_level"] if score else None,
#             "best_work_window": {"date": for_date, **facts["best_work_window"]} if facts["best_work_window"] else None,
#             "items": out[lang]["items"], "missing_data": facts["missing_data"],
#             "sources": facts["sources"], "disclaimer": DISCLAIMER[lang], "validated": validated,
#         }
#     return result


# def main() -> None:
#     ap = argparse.ArgumentParser()
#     ap.add_argument("--site", default=None, help="one site_id")
#     ap.add_argument("--limit", type=int, default=None, help="only the N highest-risk sites (cheap testing)")
#     args = ap.parse_args()

#     snapshot = json.loads((LIVE / "weather_latest.json").read_text())
#     scores = json.loads((LIVE / "scores_latest.json").read_text())["scores"]
#     sites_json = json.loads(SITES_FILE.read_text())
#     sites = {s["site_id"]: s for s in (sites_json["sites"] if isinstance(sites_json, dict) else sites_json)}
#     tomorrow = {s["site_id"]: s for s in scores if s["day_offset"] == 1}
#     records = [r for r in snapshot["sites"] if r["site_id"] in sites]
#     if args.site:
#         records = [r for r in records if r["site_id"] == args.site]
#     records.sort(key=lambda r: -(tomorrow.get(r["site_id"], {}).get("hazard_score") or 0))
#     if args.limit:
#         records = records[:args.limit]
#     if records and not records[0].get("hourly"):
#         print("Note: no hourly forecast in weather_latest.json. Re-run weather_live.py first.")

#     OUT_DIR.mkdir(parents=True, exist_ok=True)
#     print(f"Briefing model: {BRIEFING_MODEL} | sites: {len(records)}")
#     for rec in records:
#         r = generate_briefing(sites[rec["site_id"]], rec, tomorrow.get(rec["site_id"]))
#         (OUT_DIR / f"{r['site_id']}_{r['for_date']}.json").write_text(json.dumps(r, indent=2, ensure_ascii=False))
#         status = "validated" if r["validated"] else f"TEMPLATE ({'; '.join(r['problems'])[:150]})"
#         print(f"\n{sites[r['site_id']].get('name', r['site_id'])} — {r['for_date']} — {r['source']} "
#               f"{r['latency_s']}s, attempt {r['attempts']} — {status}")
#         print(f"  EN: {r['en']['headline']}")
#         for it in r["en"]["items"]:
#             print(f"    [{it['level']}] {it['hazard']}: {it['text']}")
#         print(f"  ES: {r['es']['headline']}")
#     print(f"\nSaved to {OUT_DIR}/")


# if __name__ == "__main__":
#     main()


"""Next-day safety briefing for each site, in English and Spanish (Sperry: "every evening at 6 PM").

Usage (from the repo root, conda env active), after weather_live.py and score.py have run:
    python backend/ai/cypress_ai/briefing/briefing.py --limit 3          # cheap test on 3 sites
    python backend/ai/cypress_ai/briefing/briefing.py --site site_6043   # one site
    python backend/ai/cypress_ai/briefing/briefing.py                    # all sites

From Python (M4's 6 PM scheduler, per site time zone):
    from cypress_ai.briefing.briefing import generate_briefing
    result = generate_briefing(site, weather_record, tomorrow_score)   # result["en"], result["es"]

How it stays grounded:
  1. Plain code computes every fact from the hourly forecast, recent rain and the model score:
     heat index peak, thunderstorm hours, gusts, rain, soil saturation, hazard levels, best work window.
     Each fact is written in English and Spanish and tied to a source id.
  2. Gemini (GEMINI_BRIEFING_MODEL, e.g. gemini-4-argon) only rewrites those facts as a readable briefing.
  3. Code repairs spacing slips (hidden characters, words run together like "raintomorrow").
  4. A validator rejects output that changes a level, drops or adds a hazard, cites an unknown source,
     contains a number not in the facts, mixes English into Spanish, or claims work is safe.
     One retry listing the problems, then a plain bilingual template, so a briefing is always produced.
"""
import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # backend/ai
from cypress_ai.config import BACKEND, BRIEFING_MODEL, generate_json  # noqa: E402

LIVE = BACKEND / "workers" / "data" / "live"
OUT_DIR = LIVE / "briefings"
SITES_FILE = BACKEND / "data" / "sites" / "sites.json"

WORK_START, WORK_END = 6, 18          # work-day hours considered for hazards and the best work window
THUNDER_CODES = {95, 96, 99}
LEVELS = ["low", "moderate", "high", "extreme"]
ES_LEVEL = {"low": "bajo", "moderate": "moderado", "high": "alto", "extreme": "extremo"}
DISCLAIMER = {
    "en": "Decision support only. Follow your company's safety procedures and your supervisor's direction.",
    "es": "Solo apoyo para decisiones. Siga los procedimientos de seguridad de su empresa y las indicaciones de su supervisor.",
}
BANNED = {"en": ("safe to", "is safe", "no risk", "risk-free", "guarantee"),
          "es": ("es seguro", "seguro trabajar", "sin riesgo", "garantiza")}
NUMBER = re.compile(r"\d+(?:\.\d+)?")

SYSTEM = (
    "You write next-day safety briefings for utility field crews in Florida. "
    "You receive hazards, each with a level, facts in English and Spanish, and source ids, plus an overall model score. "
    "Write the same briefing in English (en) and Spanish (es). "
    "Rules: include every hazard given exactly once, using its hazard name exactly as given and its given level; "
    "do not add hazards; use only numbers and times that appear in the facts; cite the given source ids; "
    "never say work is safe or risk-free; each item is one or two short sentences a crew lead can read aloud. "
    "The headline is one sentence with tomorrow's overall risk level and the best work window if one is given. "
    "If the overall level is higher than every hazard item, add a short second sentence with the top one or two reasons, "
    "rephrased naturally in lowercase (not copied as labels) "
    "(English: overall.main_reasons; Spanish: overall.main_reasons_es), so the briefing does not look contradictory. "
    "In Spanish text, write risk levels in Spanish (bajo, moderado, alto, extremo) as given in level_es; "
    "the JSON field 'level' always stays in English."
)
EN_LEVEL_WORDS = re.compile(r"\b(low|moderate|high|extreme)\b", re.IGNORECASE)
EN_WORDS = re.compile(r"\b(of|the|and|with|rain|days|hours|this week|this month)\b", re.IGNORECASE)
ODD_SPACE = re.compile(r"[\u00a0\u1680\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]")
LETTERS = r"[A-Za-zÁÉÍÓÚáéíóúñü]+"
MENTE_GLUE = re.compile(r"\b(\w+mente)(a|al|de|del|con|en|por|la|el|los|las|y)\b")  # "principalmentea"

# Spanish versions of the model's reason labels (from score.py LABELS), so Spanish text never copies English.
ES_REASONS = [
    (r"^Rain ([\d.]+) in$", "Lluvia de {0} pulgadas"),
    (r"^([\d.]+) hours of rain$", "{0} horas de lluvia"),
    (r"^Wind gusts ([\d.]+) mph$", "Ráfagas de viento de {0} mph"),
    (r"^Feels like ([\d.]+)°F$", "Sensación térmica de {0}°F"),
    (r"^High of ([\d.]+)°F$", "Temperatura máxima de {0}°F"),
    (r"^([\d.]+) in of rain in 3 days$", "{0} pulgadas de lluvia en 3 días"),
    (r"^([\d.]+) in of rain this week$", "{0} pulgadas de lluvia esta semana"),
    (r"^([\d.]+) in of rain this month$", "{0} pulgadas de lluvia este mes"),
    (r"^([\d.]+) days since rain$", "{0} días sin lluvia"),
    (r"^Rain today$", "Lluvia hoy"),
    (r"^Rain tomorrow$", "Lluvia mañana"),
    (r"^Rain yesterday$", "Lluvia ayer"),
    (r"^Heavy rain \(2\+ in\)$", "Lluvia intensa (2+ pulgadas)"),
    (r"^Area with frequent past hazard reports$", "Historial de peligros frecuentes en el área"),
    (r"^Site location$", "Ubicación del sitio"),
    (r"^Time of year$", "Época del año"),
    (r"^Lightning within 10 miles \(stop-work active\)$", "Rayos a menos de 10 millas (paro de trabajo activo)"),
]


def reason_es(label: str) -> str | None:
    for pattern, out in ES_REASONS:
        m = re.match(pattern, label)
        if m:
            return out.format(*m.groups())
    return None  # unknown label: left out of the Spanish reasons


def _clean(text: str) -> str:
    """Turn invisible or unusual spaces from the model into normal spaces."""
    return re.sub(r"\s+", " ", ODD_SPACE.sub(" ", text)).strip()


def _glue_map(lang: str, facts: dict) -> dict[str, str]:
    """Neighbouring words from our own facts, keyed by how they look with the space missing.
    {"raintomorrow": "Rain tomorrow", "slowvehicle": "slow vehicle", ...}"""
    reasons = (facts["overall"] or {}).get("main_reasons" if lang == "en" else "main_reasons_es", [])
    words = re.findall(LETTERS, " ".join([facts["name"], *(h[f"facts_{lang}"] for h in facts["hazards"]), *reasons]))
    return {(a + b).lower(): f"{a} {b}" for a, b in zip(words, words[1:]) if len(a) > 2 and len(b) > 2}


def repair(text: str, lang: str, facts: dict) -> str:
    """Fix spacing slips the model makes (hidden spaces, words run together) without another Gemini call."""
    text = _clean(text)
    glue = _glue_map(lang, facts)

    def split(m: re.Match) -> str:
        spaced = glue[m.group(0).lower()]
        return (spaced[0].upper() if m.group(0)[0].isupper() else spaced[0].lower()) + spaced[1:]

    text = re.sub(LETTERS, lambda m: split(m) if m.group(0).lower() in glue else m.group(0), text)
    if lang == "es":
        text = MENTE_GLUE.sub(r"\1 \2", text)
    return text


class Item(BaseModel):
    hazard: str
    level: str
    text: str
    source_ids: list[str]


class Lang(BaseModel):
    headline: str
    items: list[Item]


class Briefing(BaseModel):
    en: Lang
    es: Lang


# ---------- facts (plain code, no AI) ----------

def _t12(hour: int) -> str:
    return f"{hour % 12 or 12} {'AM' if hour < 12 else 'PM'}"


def _t24(hour: int) -> str:
    return f"{hour:02d}:00"


def _level(value, cuts: list[tuple[float, str]]) -> str:
    level = "low"
    for cut, name in cuts:
        if value is not None and value >= cut:
            level = name
    return level


def best_work_window(hours: list[dict]) -> dict | None:
    """Longest run of 2+ work hours with heat index < 103°F, no thunderstorm, rain chance < 40%, gusts < 35 mph."""
    def ok(h):
        return ((h.get("heat_index_f") or 0) < 103 and h.get("weather_code") not in THUNDER_CODES
                and (h.get("precipitation_probability") or 0) < 40 and (h.get("wind_gusts_10m") or 0) < 35)
    best, run = None, []
    for h in hours:
        hr = int(h["time"][11:13])
        if WORK_START <= hr < WORK_END and ok(h):
            run.append(hr)
        else:
            run = []
        if len(run) >= 2 and (best is None or len(run) > best[1] - best[0]):
            best = (run[0], run[-1] + 1)
    if not best:
        return None
    return {"start_local": _t24(best[0]), "end_local": _t24(best[1]),
            "reason": "Heat index under 103°F, no thunderstorms, rain chance under 40% and gusts under 35 mph."}


def build_facts(site: dict, rec: dict, score: dict | None, for_date: str) -> dict:
    """Everything the briefing may say. Each hazard: level, English and Spanish facts, source ids."""
    hours = [h for h in rec.get("hourly", []) if h["time"].startswith(for_date)]
    work = [h for h in hours if WORK_START <= int(h["time"][11:13]) < WORK_END]
    sources, hazards, missing = [], [], []

    if work:
        sources.append({"id": "src_1", "source": "open-meteo", "observed_at": rec.get("fetched_at"),
                        "description": f"Hourly forecast for {for_date}"})
        peak = max(work, key=lambda h: h.get("heat_index_f") or -999)
        hi, hr = round(peak.get("heat_index_f") or 0), int(peak["time"][11:13])
        n103 = sum((h.get("heat_index_f") or 0) >= 103 for h in work)
        hazards.append({"hazard": "heat", "level": _level(hi, [(90, "moderate"), (103, "high"), (125, "extreme")]),
                        "source_ids": ["src_1"],
                        "facts_en": f"Peak heat index {hi}°F around {_t12(hr)}; {n103} work hours at or above 103°F.",
                        "facts_es": f"Índice de calor máximo de {hi}°F alrededor de las {_t24(hr)}; "
                                    f"{n103} horas de trabajo a 103°F o más."})

        storms = [int(h["time"][11:13]) for h in work if h.get("weather_code") in THUNDER_CODES]
        pop = max((h.get("precipitation_probability") or 0) for h in work)
        if storms:
            en = (f"Thunderstorms forecast from {_t12(storms[0])}, {len(storms)} work hours in total. "
                  f"Any lightning within 10 miles stops work for 30 minutes.")
            es = (f"Tormentas eléctricas pronosticadas desde las {_t24(storms[0])}, {len(storms)} horas de trabajo en total. "
                  f"Cualquier rayo a menos de 10 millas detiene el trabajo por 30 minutos.")
        else:  # only shown when showers are likely enough that lightning is worth watching for
            en = (f"Rain chance up to {pop}%; thunderstorms are not forecast, but watch for lightning with showers. "
                  f"Any lightning within 10 miles stops work for 30 minutes.")
            es = (f"Probabilidad de lluvia de hasta {pop}%; no se pronostican tormentas eléctricas, pero esté atento a rayos "
                  f"con los chubascos. Cualquier rayo a menos de 10 millas detiene el trabajo por 30 minutos.")
        hazards.append({"hazard": "lightning", "level": "high" if storms else _level(pop, [(60, "moderate")]),
                        "source_ids": ["src_1"], "facts_en": en, "facts_es": es})

        g = max(work, key=lambda h: h.get("wind_gusts_10m") or 0)
        gv, gh = round(g.get("wind_gusts_10m") or 0), int(g["time"][11:13])
        hazards.append({"hazard": "storm", "level": _level(gv, [(25, "moderate"), (40, "high"), (58, "extreme")]),
                        "source_ids": ["src_1"],
                        "facts_en": f"Wind gusts up to {gv} mph around {_t12(gh)}.",
                        "facts_es": f"Ráfagas de viento de hasta {gv} mph alrededor de las {_t24(gh)}."})

        rain = round(sum((h.get("precipitation") or 0) for h in hours), 1)
        hazards.append({"hazard": "flood", "level": _level(rain, [(0.5, "moderate"), (2.0, "high")]),
                        "source_ids": ["src_1"],
                        "facts_en": f"About {rain} in of rain expected over the day.",
                        "facts_es": f"Se esperan unas {rain} pulgadas de lluvia durante el día."})
    else:
        missing.append("hourly forecast")

    week = [d for d in rec.get("daily", []) if d["date"] <= for_date][-7:]
    if len(week) == 7:
        wk = round(sum((d.get("precipitation_sum") or 0) for d in week), 1)
        if "src_1" not in {s["id"] for s in sources}:
            sources.append({"id": "src_1", "source": "open-meteo", "observed_at": rec.get("fetched_at"),
                            "description": f"Daily weather through {for_date}"})
        hazards.append({"hazard": "soil_saturation", "level": _level(wk, [(1.5, "moderate"), (3.0, "high")]),
                        "source_ids": ["src_1"],
                        "facts_en": f"{wk} in of rain over the past 7 days; expect soft, muddy ground and slow vehicle access.",
                        "facts_es": f"{wk} pulgadas de lluvia en los últimos 7 días; espere suelo blando, lodo y acceso lento de vehículos."})

    overall = None
    if score:
        sources.append({"id": "src_2", "source": "cypresswatch-model", "observed_at": score.get("scored_at"),
                        "description": f"Hazard index {score['model_version']}"})
        overall = {"score": score["hazard_score"], "risk_level": score["risk_level"],
                   "level_es": ES_LEVEL[score["risk_level"]], "source_ids": ["src_2"],
                   "main_reasons": [f["label"] for f in score.get("top_factors", [])[:3]],
                   "main_reasons_es": [r for f in score.get("top_factors", [])[:3] if (r := reason_es(f["label"]))]}
    else:
        missing.append("model score")

    shown = [h for h in hazards if LEVELS.index(h["level"]) >= 1]  # only hazards at moderate or above
    for h in shown:
        h["level_es"] = ES_LEVEL[h["level"]]
    return {"site_id": site["site_id"], "name": site.get("name", site["site_id"]), "for_date": for_date,
            "hazards": shown, "overall": overall, "sources": sources, "missing_data": missing,
            "best_work_window": best_work_window(hours)}


# ---------- validation ----------

def validate(lang: str, out: dict, facts: dict) -> list[str]:
    problems = []
    given = {h["hazard"]: h for h in facts["hazards"]}
    got = [i["hazard"] for i in out["items"]]
    if sorted(got) != sorted(given):
        problems.append(f"{lang}: hazards {sorted(got)} must be exactly {sorted(given)}")
    allowed = set(NUMBER.findall(" ".join([facts["name"], json.dumps(facts["hazards"], ensure_ascii=False),
                                           json.dumps(facts["overall"] or {}), json.dumps(facts["best_work_window"] or {})])))
    allowed |= {n.lstrip("0") or "0" for n in allowed}
    source_ids = {s["id"] for s in facts["sources"]}
    glued = _glue_map(lang, facts)  # safety net; repair() normally fixes these before validation
    for item in out["items"]:
        ref = given.get(item["hazard"])
        if ref and item["level"] != ref["level"]:
            problems.append(f"{lang}: {item['hazard']} level '{item['level']}' should be '{ref['level']}'")
        if not item["source_ids"] or not set(item["source_ids"]) <= source_ids:
            problems.append(f"{lang}: {item['hazard']} cites unknown source {item['source_ids']}")
    for t in [out["headline"]] + [i["text"] for i in out["items"]]:
        extra = sorted({n for n in NUMBER.findall(t) if n not in allowed and (n.lstrip("0") or "0") not in allowed})
        if extra:
            problems.append(f"{lang}: numbers not in facts {extra} in '{t[:60]}'")
        if any(b in t.lower() for b in BANNED[lang]):
            problems.append(f"{lang}: safety claim in '{t[:60]}'")
        if lang == "es" and EN_LEVEL_WORDS.search(t.replace(facts["name"], "")):
            problems.append(f"es: English level word in Spanish text '{t[:60]}'")
        if lang == "es" and EN_WORDS.search(t.replace(facts["name"], "")):
            problems.append(f"es: English words in Spanish text '{t[:60]}'; use main_reasons_es and facts_es")
        if re.search(r"\d[A-Za-zÁÉÍÓÚáéíóúñ]", t.replace(facts["name"], "")):
            problems.append(f"{lang}: missing space after a number in '{t[:60]}'")
        stuck = [w for w in re.findall(LETTERS, t) if w.lower() in glued]
        if stuck:
            problems.append(f"{lang}: missing space in {stuck}; write each word separately")
        if lang == "es" and MENTE_GLUE.search(t):
            problems.append(f"es: missing space after a '-mente' word in '{t[:60]}'")
        if "src_" in t:
            problems.append(f"{lang}: source id written in text '{t[:60]}'; put it only in source_ids")
        if len(t) > 300:
            problems.append(f"{lang}: text over 300 characters")
    return problems


# ---------- template fallback (no AI) ----------

def template(facts: dict) -> dict:
    w, o = facts["best_work_window"], facts["overall"]
    win_en = f"Best work window: {w['start_local']}–{w['end_local']}." if w else "No clear low-risk work window."
    win_es = f"Mejor horario de trabajo: {w['start_local']}–{w['end_local']}." if w else "No hay un horario claro de bajo riesgo."
    head_en = (f"{o['risk_level'].capitalize()} risk tomorrow (score {o['score']}). " if o else "Risk score unavailable. ") + win_en
    head_es = (f"Riesgo {ES_LEVEL[o['risk_level']]} mañana (puntuación {o['score']}). " if o else "Puntuación no disponible. ") + win_es
    items = lambda lang: [{"hazard": h["hazard"], "level": h["level"], "text": h[f"facts_{lang}"],
                           "source_ids": h["source_ids"]} for h in facts["hazards"]]
    return {"en": {"headline": head_en, "items": items("en")}, "es": {"headline": head_es, "items": items("es")}}


# ---------- main entry ----------

def generate_briefing(site: dict, rec: dict, score: dict | None, for_date: str | None = None,
                      model: str = BRIEFING_MODEL) -> dict:
    local_today = (rec.get("current", {}).get("observed_at_local") or datetime.now().isoformat())[:10]
    for_date = for_date or (datetime.fromisoformat(local_today) + timedelta(days=1)).strftime("%Y-%m-%d")
    facts = build_facts(site, rec, score, for_date)
    payload = {k: facts[k] for k in ("name", "for_date", "hazards", "overall", "best_work_window", "missing_data")}
    prompt = "Write tomorrow's briefing from these facts only:\n" + json.dumps(payload, indent=1, ensure_ascii=False)

    out, info, problems, attempts = None, {"model": None, "latency_s": None}, [], 0
    for attempts in (1, 2):
        try:
            data, info = generate_json(prompt, Briefing, model=model, system=SYSTEM)
        except RuntimeError as e:
            problems = [str(e)]
            break
        for lang in ("en", "es"):  # fix spacing slips in code, so they never cost a retry
            data[lang]["headline"] = repair(data[lang]["headline"], lang, facts)
            for it in data[lang]["items"]:
                it["text"] = repair(it["text"], lang, facts)
        problems = validate("en", data["en"], facts) + validate("es", data["es"], facts)
        if not problems:
            out = data
            break
        prompt += "\n\nYour previous answer was rejected for these problems; fix them:\n- " + "\n- ".join(problems)

    validated = out is not None
    out = out or template(facts)
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    result = {"site_id": site["site_id"], "for_date": for_date, "validated": validated,
              "source": f"gemini:{info['model']}" if validated else "template",
              "latency_s": info.get("latency_s"), "attempts": attempts,
              "problems": [] if validated else problems, "facts": facts}
    for lang in ("en", "es"):
        result[lang] = {  # same shape as Briefing in contracts/types.ts
            "briefing_id": f"brf_{site['site_id']}_{for_date.replace('-', '')}_{lang}",
            "site_id": site["site_id"], "for_date": for_date, "generated_at": generated_at,
            "language": lang, "available_languages": ["en", "es"],
            "headline": out[lang]["headline"],
            "hazard_score_forecast": score["hazard_score"] if score else None,
            "risk_level": score["risk_level"] if score else None,
            "best_work_window": {"date": for_date, **facts["best_work_window"]} if facts["best_work_window"] else None,
            "items": out[lang]["items"], "missing_data": facts["missing_data"],
            "sources": facts["sources"], "disclaimer": DISCLAIMER[lang], "validated": validated,
        }
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", default=None, help="one site_id")
    ap.add_argument("--limit", type=int, default=None, help="only the N highest-risk sites (cheap testing)")
    args = ap.parse_args()

    snapshot = json.loads((LIVE / "weather_latest.json").read_text())
    scores = json.loads((LIVE / "scores_latest.json").read_text())["scores"]
    sites_json = json.loads(SITES_FILE.read_text())
    sites = {s["site_id"]: s for s in (sites_json["sites"] if isinstance(sites_json, dict) else sites_json)}
    tomorrow = {s["site_id"]: s for s in scores if s["day_offset"] == 1}
    records = [r for r in snapshot["sites"] if r["site_id"] in sites]
    if args.site:
        records = [r for r in records if r["site_id"] == args.site]
    records.sort(key=lambda r: -(tomorrow.get(r["site_id"], {}).get("hazard_score") or 0))
    if args.limit:
        records = records[:args.limit]
    if records and not records[0].get("hourly"):
        print("Note: no hourly forecast in weather_latest.json. Re-run weather_live.py first.")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Briefing model: {BRIEFING_MODEL} | sites: {len(records)}")
    for rec in records:
        r = generate_briefing(sites[rec["site_id"]], rec, tomorrow.get(rec["site_id"]))
        (OUT_DIR / f"{r['site_id']}_{r['for_date']}.json").write_text(json.dumps(r, indent=2, ensure_ascii=False))
        status = "validated" if r["validated"] else f"TEMPLATE ({'; '.join(r['problems'])[:150]})"
        print(f"\n{sites[r['site_id']].get('name', r['site_id'])} — {r['for_date']} — {r['source']} "
              f"{r['latency_s']}s, attempt {r['attempts']} — {status}")
        print(f"  EN: {r['en']['headline']}")
        for it in r["en"]["items"]:
            print(f"    [{it['level']}] {it['hazard']}: {it['text']}")
        print(f"  ES: {r['es']['headline']}")
    print(f"\nSaved to {OUT_DIR}/")


if __name__ == "__main__":
    main()

