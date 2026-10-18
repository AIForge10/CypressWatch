// CypressWatch API contract v0.1 — shared types.
// Change this file (and the matching mock) before changing an API shape.

// ---------- Shared ----------

export type ISODateTime = string; // ISO 8601 UTC, e.g. "2026-10-17T18:42:10Z"
export type ISODate = string;     // "2026-10-17"

export type HazardKey =
  | "lightning"
  | "heat"
  | "storm"
  | "flood"
  | "soil_saturation"
  | "wildfire"
  | "wildlife";

export type RiskLevel = "low" | "moderate" | "high" | "extreme";
// low < 4, moderate 4–5.9, high 6–7.9, extreme >= 8

export type Role = "supervisor" | "crew" | "project_owner";

export interface SourceRef {
  source: string;               // "open-meteo", "goes-glm", "nws", "usgs", "nasa-firms", "crew-report", "site-beacon"
  observed_at: ISODateTime;
}

export interface ApiError {
  error:
    | "bad_request"
    | "unauthorized"
    | "step_up_required"
    | "forbidden"
    | "not_found"
    | "duplicate"
    | "source_unavailable";
  message: string;
  request_id: string;
}

// ---------- User ----------

export interface Me {
  user_id: string;
  name: string;
  role: Role;
  site_ids: string[];           // sites this user may see (server-enforced)
  language: "en" | "es";
  server_time: ISODateTime;
}

// ---------- Sites ----------

export interface StopWork {
  active: boolean;
  reason: HazardKey | null;
  last_strike_at: ISODateTime | null;
  stop_work_until: ISODateTime | null; // countdown target; client computes remaining time
  strikes_last_30_min: number;
  nearest_strike_miles: number | null;
}

export interface SiteSummary {
  site_id: string;
  name: string;
  eia_plant_id: string | null;
  plant_type: string;           // "natural gas", "solar", "nuclear", ...
  county: string;
  state: string;
  lat: number;
  lon: number;
  timezone: string;             // IANA, e.g. "America/New_York"
  hazard_score: number;         // 0–10, one decimal
  risk_level: RiskLevel;
  rank: number;                 // 1 = highest risk
  top_hazard: HazardKey;
  stop_work: StopWork;
  active_alert_count: number;
  open_report_count: number;
  updated_at: ISODateTime;
}

export interface SitesResponse {
  server_time: ISODateTime;
  model_version: string;
  sites: SiteSummary[];         // sorted by rank
}

export interface HazardComponent {
  hazard: HazardKey;
  level: RiskLevel;
  score: number;                // 0–10 for this hazard alone
  summary: string;              // one short line for the UI
  value: number | null;         // the headline number, with unit below
  unit: string | null;          // "°F", "miles", "in", "%", ...
  source: string;
  observed_at: ISODateTime;
}

export interface ScoreFactor {
  feature: string;              // "max_heat_index_f"
  label: string;                // "Heat index 108°F"
  contribution: number;         // SHAP value; positive raises risk
}

export interface CurrentConditions {
  temperature_f: number | null;
  heat_index_f: number | null;
  humidity_pct: number | null;
  wind_gust_mph: number | null;
  rain_24h_in: number | null;
  rain_overnight_in: number | null;
  soil_moisture_pct: number | null;
  source: string;
  observed_at: ISODateTime;
}

export interface WorkWindow {
  date: ISODate;
  start_local: string;          // "06:00"
  end_local: string;            // "11:00"
  reason: string;
}

export interface SiteDetail {
  server_time: ISODateTime;
  site: SiteSummary & {
    flood_zone: string | null;  // FEMA zone, e.g. "AE"
    river_site: boolean;
    distance_to_river_miles: number | null;
  };
  score: {
    hazard_score: number;
    risk_level: RiskLevel;
    model_version: string;
    scored_at: ISODateTime;
    top_factors: ScoreFactor[];
    explanation: string;        // Gemini, from top_factors
  };
  hazards: HazardComponent[];
  conditions: CurrentConditions;
  forecast_drift: ForecastDrift | null;
  best_work_window: WorkWindow | null;
  active_alerts: Alert[];
  recent_reports: Report[];
}

export interface ForecastDrift {
  variable: string;             // "storm_probability_pct"
  valid_at: ISODateTime;        // the forecast hour being tracked
  snapshots: { issued_at: ISODateTime; value: number }[];
  summary: string;              // "3 PM storm chance rose from 20% to 60% since 7 AM"
}

// ---------- History (charts) ----------

export interface SiteHistory {
  site_id: string;
  hours: number;
  bucket: "1h";
  series: {
    time: ISODateTime;
    hazard_score: number | null;
    heat_index_f: number | null;
    rain_in: number | null;
    soil_moisture_pct: number | null;
    strikes_within_10mi: number;
  }[];
}

// ---------- Alerts ----------

export type AlertType = "stop_work_lightning" | "flood_risk" | "heat" | "wildfire" | "storm";
export type AlertStatus = "active" | "cleared" | "overridden";

export interface Alert {
  alert_id: string;
  site_id: string;
  type: AlertType;
  severity: "warning" | "stop_work";
  status: AlertStatus;
  title: string;
  message: string;
  started_at: ISODateTime;
  stop_work_until: ISODateTime | null;
  cleared_at: ISODateTime | null;
  acknowledged_by: { user_id: string; name: string; at: ISODateTime }[];
  evidence: SourceRef[];
  ledger_record_id: string | null;
  simulated: boolean;
  // flood_risk alerts add these (stop_work_until stays null: floods warn, lightning stops work)
  expires_at?: ISODateTime;         // auto-clear unless the triggers persist
  data?: Record<string, unknown>;   // rule reasons + overnight_rain_in ("why is this an alert?")
}

export interface AlertsResponse {
  server_time: ISODateTime;
  alerts: Alert[];
}

export interface AckResponse {
  alert_id: string;
  acknowledged_by: { user_id: string; name: string; at: ISODateTime };
  ledger_record_id: string;
}

export interface OverrideRequest {
  action: "early_all_clear";
  reason: string;
}

export interface OverrideResponse {
  alert_id: string;
  status: "overridden";
  overridden_by: { user_id: string; name: string; at: ISODateTime };
  mfa_verified: true;
  ledger_record_id: string;
}

// ---------- Briefing (6 PM next-day) ----------

export interface BriefingItem {
  hazard: HazardKey;
  level: RiskLevel;
  text: string;
  source_ids: string[];         // ids from `sources`
}

export interface Briefing {
  briefing_id: string;
  site_id: string;
  for_date: ISODate;            // the work day it covers
  generated_at: ISODateTime;    // 6 PM local the evening before
  language: "en" | "es";
  available_languages: ("en" | "es")[];
  headline: string;
  hazard_score_forecast: number;
  risk_level: RiskLevel;
  best_work_window: WorkWindow | null;
  items: BriefingItem[];
  missing_data: string[];       // sources that were unavailable
  sources: { id: string; source: string; observed_at: ISODateTime; description: string }[];
  disclaimer: string;
  validated: boolean;           // passed the grounding validator
}

// ---------- Crew hazard reports ----------

export interface ReportRequest {
  client_id: string;            // UUID made on the phone; used to ignore duplicate replays
  site_id: string;
  lat: number;
  lon: number;
  note: string;
  reporter_hazard: HazardKey | null; // what the crew member picked, if anything
  captured_at: ISODateTime;     // when the photo was taken (may be long before upload)
}

export interface Triage {
  hazard: HazardKey;
  severity: "low" | "medium" | "high";
  description: string;
  confidence: number;           // 0–1
  model: string;                // "gemini"
}

export interface Report {
  report_id: string;
  client_id: string;
  site_id: string;
  lat: number;
  lon: number;
  note: string;
  photo_url: string;
  captured_at: ISODateTime;
  uploaded_at: ISODateTime;
  reported_by: { user_id: string; name: string };
  triage: Triage | null;        // null while Gemini is still working
  status: "pending_review" | "confirmed" | "dismissed";
  confirmed_hazard: HazardKey | null;
  confirmed_severity: "low" | "medium" | "high" | null;
  ledger_record_id: string | null;
}

export interface ReportConfirmRequest {
  status: "confirmed" | "dismissed";
  confirmed_hazard: HazardKey | null;
  confirmed_severity: "low" | "medium" | "high" | null;
}

export interface ReportsResponse {
  site_id: string;
  reports: Report[];
}

// ---------- Solana Safety Ledger ----------

export interface LedgerVerify {
  record_id: string;
  record_type: "stop_work" | "all_clear" | "acknowledgment" | "override" | "crew_report";
  site_id: string;
  verified: boolean;
  computed_hash: string;
  merkle_root_onchain: string;
  merkle_root_from_proof: string;
  period_start: ISODateTime;
  period_end: ISODateTime;
  records_in_root: number;
  network: "devnet";
  transaction_signature: string;
  explorer_url: string;
  checked_at: ISODateTime;
  message: string;
}

// ---------- Model card ----------

export interface ModelCard {
  model_version: string;
  algorithm: string;
  trained_at: ISODateTime;
  training_data: { name: string; rows: number; years: string }[];
  label: string;
  features: string[];
  evaluation: {
    split: string;
    metric: string;
    model: number;
    baseline: number;
    baseline_name: string;
  }[];
  calibration_note: string;
  top_global_features: { feature: string; importance: number }[];
  limitations: string[];
}

// ---------- Live events (DeepSpace) ----------

export type LiveEventType =
  | "stop_work_started"
  | "stop_work_extended"
  | "all_clear"
  | "alert_acknowledged"
  | "flood_alert_started"
  | "flood_alert_cleared"
  | "report_created"
  | "report_confirmed"
  | "score_updated"
  | "briefing_ready";

export interface LiveEvent<T = Record<string, unknown>> {
  event_id: string;
  type: LiveEventType;
  site_id: string;
  occurred_at: ISODateTime;
  simulated: boolean;
  data: T;
}

// ---------- Demo ----------

export interface DemoStrikeRequest {
  site_id: string;
  distance_miles: number;       // must be <= 10 to trigger stop-work
  bearing_deg: number;          // direction from the site
}

export interface DemoHeavyRainRequest {
  site_id: string;
  overnight_in: number;         // simulated overnight rainfall total; >= 3 triggers on river sites
}

// ---------- Offline queue (crew app, IndexedDB) ----------

export interface OfflineQueueItem {
  client_id: string;
  kind: "create_report" | "acknowledge_alert";
  created_at: ISODateTime;
  attempts: number;
  payload: ReportRequest | { alert_id: string };
  photo_blob_key: string | null; // IndexedDB key of the stored photo
}
