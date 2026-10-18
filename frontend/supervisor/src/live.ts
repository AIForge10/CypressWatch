// Live backend service for the supervisor app. Talks to the CypressWatch API (M4):
// /api/sites/summary, /api/sites/{id}, /api/sites/{id}/briefing, /api/alerts, /api/demo/*, /api/reports,
// /api/ledger/*, /api/ws.
// Falls back to the bundled demo data whenever the backend is unreachable, so the
// screens always render something; every consumer marks the feed "Live" vs "Demo".

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

import type { Site, StopWorkEvent, LedgerVerify } from './data';

export type AccessTokenGetter = (options?: { forceRefresh?: boolean }) => Promise<string | null>;

type BackendRisk = 'low' | 'moderate' | 'high' | 'extreme';
export type SiteSummary = {
  site_id: string; name: string; location: string; lat: number; lon: number; timezone: string;
  hazard_score: number | null; risk_level: BackendRisk | null;
  top_factors: { feature: string; label: string; contribution: number; rule?: boolean }[];
  scored_at: string | null; weather_fetched_at?: string | null; data_freshness: string;
  stop_work: null | { alert_id: string; reason: string; started_at: string; stop_work_until: string; last_strike_at?: string; acknowledged: boolean; simulated?: boolean };
  flood_warning?: null | { alert_id: string; reason: string; message: string; started_at: string; simulated: boolean };
};
type SummaryResponse = { server_time: string; sites: SiteSummary[] };
export type AlertsResponse = {
  server_time: string;
  alerts: { alert_id: string; site_id: string; status: string; title: string; started_at: string; stop_work_until: string; ledger_record_id: string | null }[];
};
export type LedgerRecord = {
  record_id: string; record_type: string; site_id: string; created_at: string; anchored: boolean;
  merkle_root: string | null; transaction_signature: string | null;
};
export type HazardKey = 'lightning' | 'heat' | 'storm' | 'flood' | 'soil_saturation' | 'wildfire' | 'wildlife';
export type Severity = 'low' | 'medium' | 'high';
export type ReportStatus = 'pending_review' | 'confirmed' | 'dismissed';
export type CrewReport = {
  report_id: string; site_id: string; lat: number | null; lon: number | null; note: string; photo_url: string;
  captured_at: string; uploaded_at: string; reported_by: { user_id: string; name: string };
  triage: { hazard: HazardKey; severity: Severity; description: string; confidence: number; model: string } | null;
  status: ReportStatus; confirmed_hazard: HazardKey | null; confirmed_severity: Severity | null; ledger_record_id: string | null;
};
export type Lang = 'en' | 'es';
export type Briefing = {
  briefing_id: string; site_id: string; for_date: string; generated_at: string; language: Lang;
  headline: string; hazard_score_forecast: number | null; risk_level: BackendRisk | null;
  best_work_window: { date: string; start_local: string; end_local: string; reason: string } | null;
  items: { hazard: HazardKey; level: BackendRisk; text: string; source_ids: string[] }[];
  missing_data: string[]; sources: { id: string; source: string; observed_at: string | null; description: string }[];
  disclaimer: string; validated: boolean;
};
export type SiteScore = {
  hazard_score: number | null; risk_level: BackendRisk | null; explanation: string | null; scored_at: string | null;
  model_version: string | null; top_factors: { feature: string; label: string; contribution: number }[];
};
export type SiteInsights = {
  forecast_drift: { variable: string; valid_at: string; summary?: string; snapshots: { issued_at: string; value: number }[] } | null;
  days_like_today: { summary?: string; event_rate?: number; base_rate?: number } | null;
  storm_approach: { approaching?: boolean; strikes?: number; speed_mph?: number | null; nearest_miles?: number | null;
    direction?: string | null; eta_minutes?: number | null; summary?: string; message?: string; watch_miles?: number } | null;
};
export type ReportConfirmRequest = { status: 'confirmed' | 'dismissed'; confirmed_hazard: HazardKey | null; confirmed_severity: Severity | null };

async function call<T>(path: string, getAccessToken: AccessTokenGetter, init: RequestInit = {}): Promise<T> {
  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error('API access token unavailable. Sign in again and retry.');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail: unknown = null;
    try { detail = (await res.json()).detail; } catch { /* non-JSON error */ }
    const message = detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string'
      ? detail.message : null;
    throw Object.assign(new Error(message ? `API ${res.status}: ${message}` : `API ${res.status} on ${path}`), { status: res.status, detail });
  }
  return res.json() as Promise<T>;
}

export const isRiskLevel = (value: string | null): value is BackendRisk =>
  value === 'low' || value === 'moderate' || value === 'high' || value === 'extreme';

export function normalizeRisk(level: BackendRisk): Site['riskLevel'] {
  if (level === 'low') return 'Low';
  if (level === 'moderate') return 'Guarded';
  return level === 'extreme' ? 'Critical' : 'High';
}

const hazardTypeFor = (feature: string): Site['primaryHazards'][number] =>
  feature.includes('lightning') ? 'Lightning'
  : feature.includes('flood') ? 'Flooding'
  : feature.includes('precip') || feature.includes('rain') ? 'Rain'
  : feature.includes('temp') || feature.includes('heat') ? 'Heat'
  : feature.includes('wind') || feature.includes('gust') ? 'Wind'
  : 'Context';

export function summaryToSite(s: SiteSummary): Site {
  const active = Boolean(s.stop_work);
  const stopWork: StopWorkEvent | undefined = active ? {
    reason: s.stop_work!.reason,
    startedAt: s.stop_work!.started_at,
    allClearAt: s.stop_work!.stop_work_until,
    status: 'active',
    lastStrikeAt: s.stop_work!.last_strike_at ?? s.stop_work!.started_at,
    acknowledged: s.stop_work!.acknowledged,
    alertId: s.stop_work!.alert_id,
    simulated: Boolean(s.stop_work!.simulated),
  } : undefined;
  return {
    id: s.site_id,
    name: s.name,
    location: s.location,
    latitude: s.lat,
    longitude: s.lon,
    // The summary API has no landscape field. Keep this explicitly illustrative.
    landscape: 'woodland',
    riskScore: s.hazard_score ?? 0,
    riskLevel: isRiskLevel(s.risk_level) ? normalizeRisk(s.risk_level) : 'Low',
    primaryHazards: [...new Set([
      ...(s.flood_warning ? ['Flooding' as const] : []),
      ...s.top_factors.slice(0, 3).map((factor) => hazardTypeFor(factor.feature)).filter((type) => type !== 'Context'),
    ])],
    activeAlert: stopWork,
    activeFloodWarning: s.flood_warning ? {
      reason: s.flood_warning.reason,
      message: s.flood_warning.message,
      startedAt: s.flood_warning.started_at,
      simulated: s.flood_warning.simulated,
    } : undefined,
    lastUpdated: s.scored_at ?? 'unknown',
    dataFreshness: s.data_freshness === 'Fresh' ? 'Fresh' : s.data_freshness === 'Stale' ? 'Stale' : 'Unavailable',
    hazards: s.top_factors.map((factor) => ({
      type: hazardTypeFor(factor.feature),
      label: factor.label,
      value: `${factor.contribution.toFixed(1)} pts`,
      severity: factor.contribution >= 1.5 ? 'High' : factor.contribution >= 0.4 ? 'Elevated' : 'Guarded',
      source: factor.rule ? 'Deterministic alert rule' : 'Open-Meteo weather · hazard model',
      observedAt: s.weather_fetched_at ? `${s.weather_fetched_at.slice(11, 19)} UTC` : s.scored_at ? `${s.scored_at.slice(11, 19)} UTC` : '',
      contribution: factor.contribution,
    })),
  };
}

export const live = {
  summary: (getAccessToken: AccessTokenGetter) => call<SummaryResponse>('/api/sites/summary', getAccessToken),

  alerts: (getAccessToken: AccessTokenGetter) => call<AlertsResponse>('/api/alerts?status=active', getAccessToken),

  acknowledge: (alertId: string, getAccessToken: AccessTokenGetter) =>
    call<{ ledger_record_id: string | null }>(`/api/alerts/${alertId}/acknowledge`, getAccessToken, { method: 'POST' }),

  override: (alertId: string, getAccessToken: AccessTokenGetter, reason: string) =>
    call<{ ledger_record_id: string | null }>(`/api/alerts/${alertId}/override`, getAccessToken,
      { method: 'POST', body: JSON.stringify({ reason: reason || 'verified all-clear' }) }),

  demoStrike: (siteId: string, getAccessToken: AccessTokenGetter, distanceMiles = 4.2) =>
    call<{ queued_strike: unknown }>('/api/demo/strike', getAccessToken, {
      method: 'POST',
      body: JSON.stringify({ site_id: siteId, distance_miles: distanceMiles }),
    }),

  briefing: (siteId: string, lang: Lang, getAccessToken: AccessTokenGetter) =>
    call<Briefing>(`/api/sites/${siteId}/briefing?lang=${lang}`, getAccessToken),

  siteScore: (siteId: string, getAccessToken: AccessTokenGetter) =>
    call<{ score: SiteScore | null }>(`/api/sites/${siteId}`, getAccessToken).then((detail) => detail.score),

  insights: (siteId: string, getAccessToken: AccessTokenGetter) =>
    call<SiteInsights>(`/api/sites/${siteId}/insights`, getAccessToken),

  reports: (getAccessToken: AccessTokenGetter, status: ReportStatus | 'all' = 'pending_review') =>
    call<{ server_time: string; reports: CrewReport[] }>(`/api/reports?status=${status}`, getAccessToken),

  confirmReport: (reportId: string, getAccessToken: AccessTokenGetter, body: ReportConfirmRequest) =>
    call<CrewReport>(`/api/reports/${reportId}`, getAccessToken, { method: 'PATCH', body: JSON.stringify(body) }),

  // <img> cannot send a Bearer token, so the photo is fetched with one and shown from a blob URL.
  photoObjectUrl: async (report: CrewReport, getAccessToken: AccessTokenGetter) => {
    const accessToken = await getAccessToken();
    const res = await fetch(`${API_URL}${report.photo_url}`, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
    if (!res.ok) throw new Error(`API ${res.status} on ${report.photo_url}`);
    return URL.createObjectURL(await res.blob());
  },

  // Simulated heavy-rain night: the flood rule raises flood_risk alerts on river sites
  // (river flag / FEMA zone / near a USGS gauge) on its next flood tick. Simulated: true.
  demoHeavyRain: (siteId: string, getAccessToken: AccessTokenGetter, overnightIn = 4.5) =>
    call<{ flood_alert_expected: boolean; river_sites: { site_id: string; name: string }[] }>(
      '/api/demo/flood-rain', getAccessToken, {
      method: 'POST',
      body: JSON.stringify({ site_id: siteId, overnight_in: overnightIn }),
    }),

  ledgerRecords: (getAccessToken: AccessTokenGetter) => call<{ records: LedgerRecord[] }>('/api/ledger/records', getAccessToken),

  verify: (recordId: string, getAccessToken: AccessTokenGetter) =>
    call<LedgerVerify>(`/api/ledger/verify/${recordId}`, getAccessToken),

  openEvents: (getAccessToken: AccessTokenGetter, onEvent: (event: { type: string; site_id: string; data: Record<string, unknown> }) => void): WebSocket => {
    const ws = new WebSocket(`${API_URL.replace(/^http/, 'ws')}/api/ws`);
    ws.addEventListener('open', () => {
      void getAccessToken().then((accessToken) => {
        if (accessToken && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ access_token: accessToken }));
        else ws.close(4401);
      }).catch(() => ws.close(4401));
    });
    ws.addEventListener('message', (message) => {
      try {
        const payload = JSON.parse(message.data) as { event?: { type: string; site_id: string; data: Record<string, unknown> } };
        if (payload.event) onEvent(payload.event);
      } catch { /* keepalive or malformed frame */ }
    });
    return ws;
  },
};

export type { LedgerVerify } from './data';
