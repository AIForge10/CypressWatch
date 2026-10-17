// CypressWatch API client. Frontend calls these functions only.
// With VITE_USE_MOCKS=true it returns the sample JSON; otherwise it calls the backend.
// Place this folder at web/src/contracts/.

import type * as T from "./types";

import sitesMock from "./mocks/sites.json";
import meMock from "./mocks/me.json";
import siteDetailMock from "./mocks/site_detail.json";
import historyMock from "./mocks/site_history.json";
import alertsMock from "./mocks/alerts.json";
import briefingMock from "./mocks/briefing.json";
import reportsMock from "./mocks/reports.json";
import reportCreatedMock from "./mocks/report_created.json";
import ackMock from "./mocks/ack_response.json";
import overrideMock from "./mocks/override_response.json";
import ledgerMock from "./mocks/ledger_verify.json";
import modelMock from "./mocks/model_card.json";

const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === "true";
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

// JSON imports lose literal types, so mocks are cast to the contract type here, once.
const mock = <R>(data: unknown): Promise<R> =>
  new Promise((resolve) => setTimeout(() => resolve(data as R), 300));

let getToken: () => Promise<string> = async () => "";
export const setTokenGetter = (fn: () => Promise<string>) => { getToken = fn; };

async function call<R>(path: string, init: RequestInit = {}): Promise<R> {
  const token = await getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...init.headers },
  });
  if (!res.ok) throw (await res.json()) as T.ApiError;
  return res.json() as Promise<R>;
}

export const api = {
  me: () => USE_MOCKS ? mock<T.Me>(meMock) : call<T.Me>("/api/me"),
  sites: () => USE_MOCKS ? mock<T.SitesResponse>(sitesMock) : call<T.SitesResponse>("/api/sites"),
  site: (id: string) => USE_MOCKS ? mock<T.SiteDetail>(siteDetailMock) : call<T.SiteDetail>(`/api/sites/${id}`),
  history: (id: string, hours = 48) => USE_MOCKS ? mock<T.SiteHistory>(historyMock) : call<T.SiteHistory>(`/api/sites/${id}/history?hours=${hours}`),
  alerts: () => USE_MOCKS ? mock<T.AlertsResponse>(alertsMock) : call<T.AlertsResponse>("/api/alerts?status=active"),
  acknowledge: (alertId: string) => USE_MOCKS ? mock<T.AckResponse>(ackMock) : call<T.AckResponse>(`/api/alerts/${alertId}/acknowledge`, { method: "POST" }),
  override: (alertId: string, body: T.OverrideRequest) => USE_MOCKS ? mock<T.OverrideResponse>(overrideMock) : call<T.OverrideResponse>(`/api/alerts/${alertId}/override`, { method: "POST", body: JSON.stringify(body) }),
  briefing: (id: string, date: string) => USE_MOCKS ? mock<T.Briefing>(briefingMock) : call<T.Briefing>(`/api/sites/${id}/briefing?date=${date}`),
  reports: (id: string) => USE_MOCKS ? mock<T.ReportsResponse>(reportsMock) : call<T.ReportsResponse>(`/api/sites/${id}/reports`),
  createReport: (data: T.ReportRequest, photo: Blob) => {
    if (USE_MOCKS) return mock<T.Report>(reportCreatedMock);
    const form = new FormData();
    form.append("photo", photo);
    form.append("data", JSON.stringify(data));
    return call<T.Report>("/api/reports", { method: "POST", body: form });
  },
  verify: (recordId: string) => USE_MOCKS ? mock<T.LedgerVerify>(ledgerMock) : call<T.LedgerVerify>(`/api/ledger/verify/${recordId}`),
  model: () => USE_MOCKS ? mock<T.ModelCard>(modelMock) : call<T.ModelCard>("/api/model"),
};

// Countdown helper: works offline. Pass serverOffsetMs = server_time - Date.now() from the last response.
export function secondsLeft(stopWorkUntil: string | null, serverOffsetMs = 0): number {
  if (!stopWorkUntil) return 0;
  return Math.max(0, Math.round((Date.parse(stopWorkUntil) - (Date.now() + serverOffsetMs)) / 1000));
}
