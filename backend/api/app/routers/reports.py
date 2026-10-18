"""Crew hazard reports: photo upload -> Gemini triage -> supervisor confirm -> Solana ledger.

Backend: M3. Crew upload screen: M2. Supervisor confirm screen: M1.

POST  /api/reports                   multipart: photo file + data (report_request.json) -> Report (201)
                                     same client_id again (offline replay) -> 409 + the existing report
GET   /api/reports?status=           supervisor queue across all sites (default: pending_review)
GET   /api/reports/{report_id}       one Report
GET   /api/reports/{report_id}/photo the stored photo (EXIF/GPS stripped, max 1280 px)
PATCH /api/reports/{report_id}       report_confirm_request.json -> Report, written to the Solana ledger
GET   /api/sites/{site_id}/reports   ReportsResponse

Photos are saved in backend/data/reports/ (git-ignored). photo_url points at /api/reports/{id}/photo.

Auth: every endpoint needs a token (Auth0, or a DeepSpace crew token for listed crew emails) and only covers the
caller's sites. POST takes the reporter from the token; PATCH is supervisor-only and records who decided.
"""
import hashlib
import json
import secrets
import uuid
from datetime import datetime, timezone
from functools import lru_cache

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from app.auth import AuthenticatedUser, get_current_user, require_roles, require_site_access
from app.routers.common import BACKEND, api_error, now_iso
from cypress_db import db
from cypress_workers.common import append_events, make_event

router = APIRouter(prefix="/api", tags=["reports"])

PHOTO_DIR = BACKEND / "data" / "reports"
MAX_PHOTO_BYTES = 15 * 1024 * 1024
HAZARDS = {"lightning", "heat", "storm", "flood", "soil_saturation", "wildfire", "wildlife"}  # contract HazardKey
SEVERITIES = {"low", "medium", "high"}


# ---------- helpers ----------

@lru_cache(maxsize=1)
def _ledger():
    from cypress_ledger.ledger import Ledger  # lazy: needs solders + the devnet wallet
    return Ledger()


def _anchor_now() -> None:
    """Runs after the response: write the new ledger record's Merkle root to Solana devnet."""
    try:
        batch = _ledger().anchor()
        print("ledger anchored:", (batch or {}).get("transaction_signature"))
    except Exception as e:  # noqa: BLE001 - the record is saved; it gets anchored on the next run
        print("ledger anchor skipped:", str(e).splitlines()[0])


def _by_client_id(client_id: str) -> dict | None:
    with db.conn() as c:
        row = c.execute("SELECT * FROM reports WHERE client_id = %s", (client_id,)).fetchone()
    return db._clean(row) if row else None


def _emit(type_: str, site_id: str, data: dict) -> None:
    """Contract live event -> events.json; /api/ws pushes it, the scheduler anchors report_created."""
    try:
        append_events([make_event(type_, site_id, data)])
    except Exception as e:  # noqa: BLE001 - the report is saved; live feed is best effort
        print("live event skipped:", e)


def _photo_path(report_id: str):
    return PHOTO_DIR / f"{report_id}.jpg"


def _parse_time(value) -> datetime:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return datetime.now(timezone.utc)


# ---------- create ----------

@router.post("/reports", status_code=201)
def create_report(photo: UploadFile = File(...), data: str = Form(...),
                  user: AuthenticatedUser = Depends(require_roles("crew", "supervisor"))):
    try:
        req = json.loads(data)
    except json.JSONDecodeError:
        return api_error(422, "invalid_request", "'data' must be JSON (contracts/mocks/report_request.json)")
    site_id = req.get("site_id")
    if not site_id or not db._site(site_id):
        return api_error(404, "not_found", f"Unknown site {site_id}")
    require_site_access(user, site_id)
    client_id = str(req.get("client_id") or uuid.uuid4())
    reporter_hazard = req.get("reporter_hazard") if req.get("reporter_hazard") in HAZARDS else None

    existing = _by_client_id(client_id)  # offline replay: don't pay for Gemini twice
    if existing and not user.can_access_site(existing["site_id"]):
        return api_error(409, "duplicate", "This report was already uploaded.")
    if existing:
        return JSONResponse(status_code=409, content={
            "error": "duplicate", "message": "This report was already uploaded.",
            "request_id": f"req_{uuid.uuid4().hex[:10]}", "report": json.loads(json.dumps(existing, default=str))})

    raw = photo.file.read()
    if not raw:
        return api_error(422, "invalid_request", "Photo is empty")
    if len(raw) > MAX_PHOTO_BYTES:
        return api_error(413, "too_large", "Photo is larger than 15 MB")

    # Gemini triage (strips EXIF/GPS and resizes; safety rules only ever raise severity)
    from cypress_ai.triage.triage import prepare_image, triage_photo
    try:
        clean_bytes, _ = prepare_image(raw, photo.content_type)
    except Exception:  # noqa: BLE001
        return api_error(422, "invalid_request", "Could not read the photo. Send a JPEG or PNG.")
    try:
        result = triage_photo(raw, photo.content_type, req.get("note") or "", reporter_hazard)
        triage = result.get("triage")
    except Exception as e:  # noqa: BLE001 - never lose a crew report because the AI failed
        print("triage failed:", e)
        triage = None

    report_id = f"rpt_{secrets.token_hex(4)}"
    PHOTO_DIR.mkdir(parents=True, exist_ok=True)
    _photo_path(report_id).write_bytes(clean_bytes)

    report, created = db.save_report({
        "report_id": report_id, "client_id": client_id, "site_id": site_id,
        "lat": req.get("lat"), "lon": req.get("lon"), "note": req.get("note") or "",
        "photo_url": f"/api/reports/{report_id}/photo",
        "captured_at": _parse_time(req.get("captured_at")),
        "reported_by": {"user_id": user.user_id, "name": user.name},  # from the token, never the request body
        "triage": triage, "status": "pending_review"})
    if not created:  # two uploads raced; keep the first
        _photo_path(report_id).unlink(missing_ok=True)
        return JSONResponse(status_code=409, content={
            "error": "duplicate", "message": "This report was already uploaded.",
            "request_id": f"req_{uuid.uuid4().hex[:10]}", "report": json.loads(json.dumps(report, default=str))})
    _emit("report_created", site_id, {"report_id": report_id, "hazard": (triage or {}).get("hazard"),
                                      "severity": (triage or {}).get("severity"), "status": "pending_review"})
    return report


# ---------- read ----------

@router.get("/reports")
def list_reports(status: str = Query("pending_review", pattern="^(pending_review|confirmed|dismissed|all)$"),
                 limit: int = Query(100, ge=1, le=500),
                 user: AuthenticatedUser = Depends(require_roles("supervisor", "owner"))):
    where, args = ("", (limit,)) if status == "all" else ("WHERE status = %s", (status, limit))
    with db.conn() as c:
        rows = c.execute(f"SELECT * FROM reports {where} ORDER BY uploaded_at DESC LIMIT %s", args).fetchall()
    return {"server_time": now_iso(), "status": status,
            "reports": [db._clean(r) for r in rows if user.can_access_site(r["site_id"])]}


@router.get("/reports/{report_id}")
def get_report(report_id: str, user: AuthenticatedUser = Depends(get_current_user)):
    report = db.get_report(report_id)
    if not report:
        return api_error(404, "not_found", f"Unknown report {report_id}")
    require_site_access(user, report["site_id"])
    return report


@router.get("/reports/{report_id}/photo")
def get_photo(report_id: str, user: AuthenticatedUser = Depends(get_current_user)):
    report = db.get_report(report_id)
    if report:
        require_site_access(user, report["site_id"])
    path = _photo_path(report_id)
    if not path.exists():
        return api_error(404, "not_found", f"No photo for {report_id}")
    return FileResponse(path, media_type="image/jpeg")


@router.get("/sites/{site_id}/reports")
def site_reports(site_id: str, limit: int = Query(50, ge=1, le=200),
                 user: AuthenticatedUser = Depends(get_current_user)):
    require_site_access(user, site_id)
    if not db._site(site_id):
        return api_error(404, "not_found", f"Unknown site {site_id}")
    return {"site_id": site_id, "reports": db.site_reports(site_id, limit)}


# ---------- supervisor confirm / dismiss -> Solana ----------

@router.patch("/reports/{report_id}")
def confirm_report(report_id: str, body: dict, background: BackgroundTasks,
                   user: AuthenticatedUser = Depends(require_roles("supervisor"))):
    report = db.get_report(report_id)
    if not report:
        return api_error(404, "not_found", f"Unknown report {report_id}")
    require_site_access(user, report["site_id"])
    status = body.get("status")
    if status not in ("confirmed", "dismissed"):
        return api_error(422, "invalid_request", "status must be 'confirmed' or 'dismissed'")
    triage = report.get("triage") or {}
    hazard = body.get("confirmed_hazard") or (triage.get("hazard") if status == "confirmed" else None)
    severity = body.get("confirmed_severity") or (triage.get("severity") if status == "confirmed" else None)
    if hazard is not None and hazard not in HAZARDS:
        return api_error(422, "invalid_request", f"Unknown hazard {hazard}")
    if severity is not None and severity not in SEVERITIES:
        return api_error(422, "invalid_request", "severity must be low, medium or high")

    # Tamper-evident record: the photo's fingerprint + the AI's call + the human decision.
    path = _photo_path(report_id)
    payload = {"report_id": report_id, "status": status, "confirmed_hazard": hazard, "confirmed_severity": severity,
               "ai_hazard": triage.get("hazard"), "ai_severity": triage.get("severity"),
               "ai_confidence": triage.get("confidence"), "reported_by": report.get("reported_by"),
               "captured_at": str(report.get("captured_at")), "decided_at": now_iso(),
               "decided_by": {"user_id": user.user_id, "name": user.name},
               "photo_sha256": hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None}
    record_id = None
    try:
        record_id = _ledger().record("crew_report", report["site_id"], payload)
        background.add_task(_anchor_now)
    except Exception as e:  # noqa: BLE001 - the decision still saves; ledger is the audit layer
        print("ledger record skipped:", str(e).splitlines()[0])

    updated = db.update_report(report_id, status=status, confirmed_hazard=hazard, confirmed_severity=severity,
                               ledger_record_id=record_id)
    if status == "confirmed":
        _emit("report_confirmed", report["site_id"], {"report_id": report_id, "confirmed_hazard": hazard,
                                                      "confirmed_severity": severity})
    return updated
