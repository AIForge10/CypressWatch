// Live backend service for the supervisor app. Talks to the CypressWatch API (M4):
// /api/sites/summary, /api/alerts, /api/demo/strike, /api/ledger/*, /api/ws.
// Falls back to the bundled demo data whenever the backend is unreachable, so the
// screens always render something; every consumer marks the feed "Live" vs "Demo".

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

import type { Site, StopWorkEvent, LedgerVerify } from './data';

type BackendRisk = 'low' | 'moderate' | 'high' | 'extreme';
export type SiteSummary = {
  site_id: string; name: string; location: string; lat: number; lon: number; timezone: string;
  hazard_score: number | null; risk_level: BackendRisk | null;
  top_factors: { feature: string; label: string; contribution: number; rule?: boolean }[];
  scored_at: string | null; data_freshness: string;
  stop_work: null | { alert_id: string; reason: string; started_at: string; stop_work_until: string; acknowledged: boolean };
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
export type Person = { userId: string; name: string } | { user_id: string; name: string } | null | undefined;

function headers(user: Person, mfa = false): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (user) {
    const id = 'userId' in user ? user.userId : user.user_id;
    h['X-User-Id'] = id ?? 'unknown';
    h['X-User-Name'] = user?.name ?? '';
  }
  if (mfa) h['X-MFA-Verified'] = 'true';
  return h;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);
  if (!res.ok) {
    let detail: unknown = null;
    try { detail = (await res.json()).detail; } catch { /* non-JSON error */ }
    throw Object.assign(new Error(`API ${res.status} on ${path}`), { status: res.status, detail });
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
  : feature.includes('precip') || feature.includes('rain') || feature.includes('flood') ? 'Flooding'
  : feature.includes('temp') || feature.includes('heat') ? 'Heat'
  : 'Soil saturation';

export function summaryToSite(s: SiteSummary): Site {
  const active = Boolean(s.stop_work);
  const stopWork: StopWorkEvent | undefined = active ? {
    reason: s.stop_work!.reason,
    startedAt: s.stop_work!.started_at,
    allClearAt: s.stop_work!.stop_work_until,
    status: 'active',
    lastStrikeAt: s.stop_work!.started_at,
    acknowledged: s.stop_work!.acknowledged,
    alertId: s.stop_work!.alert_id,
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
    primaryHazards: s.top_factors.slice(0, 3).map((factor) => hazardTypeFor(factor.feature)),
    activeAlert: stopWork,
    lastUpdated: s.scored_at ?? 'unknown',
    dataFreshness: s.data_freshness === 'Fresh' ? 'Fresh' : s.data_freshness === 'Stale' ? 'Stale' : 'Unavailable',
    hazards: s.top_factors.map((factor) => ({
      type: hazardTypeFor(factor.feature),
      label: factor.label,
      value: `${factor.contribution.toFixed(1)} pts`,
      severity: factor.contribution >= 1.5 ? 'High' : factor.contribution >= 0.4 ? 'Elevated' : 'Guarded',
      source: factor.rule ? 'Deterministic alert rule' : 'Hazard model',
      observedAt: s.scored_at ? `${s.scored_at.slice(11, 19)} UTC` : '',
      contribution: factor.contribution,
    })),
  };
}

export const live = {
  summary: () => call<SummaryResponse>('/api/sites/summary'),

  alerts: () => call<AlertsResponse>('/api/alerts?status=active'),

  acknowledge: (alertId: string, user: Person) =>
    call<{ ledger_record_id: string | null }>(`/api/alerts/${alertId}/acknowledge`, { method: 'POST', headers: headers(user) }),

  override: (alertId: string, user: Person, reason: string, mfa = true) =>
    call<{ ledger_record_id: string | null }>(`/api/alerts/${alertId}/override`,
      { method: 'POST', headers: headers(user, mfa), body: JSON.stringify({ reason: reason || 'verified all-clear' }) }),

  demoStrike: (siteId: string, distanceMiles = 4.2) =>
    call<{ queued_strike: unknown }>('/api/demo/strike', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_id: siteId, distance_miles: distanceMiles }),
    }),

  // Simulated heavy-rain night: the flood rule raises flood_risk alerts on river sites
  // (river flag / FEMA zone / near a USGS gauge) on its next flood tick. Simulated: true.
  demoHeavyRain: (siteId: string, overnightIn = 4.5) =>
    call<{ flood_alert_expected: boolean; river_sites: { site_id: string; name: string }[] }>(
      '/api/demo/flood-rain', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_id: siteId, overnight_in: overnightIn }),
    }),

  ledgerRecords: () => call<{ records: LedgerRecord[] }>('/api/ledger/records'),

  verify: (recordId: string) =>
    call<LedgerVerify>(`/api/ledger/verify/${recordId}`),

  openEvents: (onEvent: (event: { type: string; site_id: string; data: Record<string, unknown> }) => void): WebSocket => {
    const ws = new WebSocket(`${API_URL.replace(/^http/, 'ws')}/api/ws`);
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
