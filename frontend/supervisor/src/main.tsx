import { StrictMode, Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import Map, { Marker, NavigationControl, Popup } from 'react-map-gl/maplibre';
import type { StyleSpecification } from 'maplibre-gl';
import { Badge, Button, Card, PageHeader } from '@cypresswatch/ui';
import { AccessDenied, AuthProvider, RequireAuth, RequireRole, useAuth } from './auth';
import { live, summaryToSite } from './live';
import type { SiteSummary } from './live';
import { riskTone, siteDetailData, sites as demoSites, type RiskLevel, type Site } from './data';
import './app.css';
import '@cypresswatch/ui/tokens.css';
import 'maplibre-gl/dist/maplibre-gl.css';

const floridaMapStyle: StyleSpecification = {
  version: 8,
  sources: {
    openstreetmap: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'openstreetmap', type: 'raster', source: 'openstreetmap' }],
};

const SiteBeaconScene = lazy(() => import('./SiteBeaconScene').then(({ SiteBeaconScene }) => ({ default: SiteBeaconScene })));

function AppShell() {
  const { user, logout } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const initials = user?.name.split(' ').map((part) => part[0]).join('').slice(0, 2);
  const roleLabel = user?.role === 'supervisor' ? 'Supervisor' : user?.role === 'crew' ? 'Crew member' : user?.role === 'owner' ? 'Project owner' : 'Unassigned role';
  return <div className="cw-app"><div className="cw-shell">
    <button className={`cw-menu-toggle${navOpen ? ' cw-menu-toggle-hidden' : ''}`} type="button" aria-label="Show navigation" aria-expanded={navOpen} onMouseEnter={() => setNavOpen(true)} onFocus={() => setNavOpen(true)}><span aria-hidden="true">☰</span></button>
    <aside className={`cw-sidebar${navOpen ? ' cw-sidebar-open' : ''}`} onMouseEnter={() => setNavOpen(true)} onMouseLeave={() => setNavOpen(false)} onFocus={() => setNavOpen(true)}>
      <div className="cw-brand"><span className="cw-brand-mark">CW</span><div><div className="cw-brand-name">CypressWatch</div><p className="cw-brand-subtitle">Safety command center</p></div></div>
      <div className="cw-role">Current workspace<strong>{roleLabel}</strong></div>
      <div className="cw-nav-label">Operations</div>
      <nav className="cw-nav" aria-label="Primary navigation">
        {user?.role === 'supervisor' && <><NavLink to="/app/supervisor" end>Overview</NavLink><NavLink to="/app/supervisor/briefings">Briefings</NavLink><NavLink to="/app/supervisor/verify">Safety Ledger / Verify</NavLink></>}
        {user?.role === 'crew' && <><NavLink to="/app/crew" end>My Site</NavLink><NavLink to="/app/crew/site">Briefing</NavLink><NavLink to="/app/crew/report">Report Hazard</NavLink></>}
        {user?.role === 'owner' && <><NavLink to="/app/owner" end>Sites</NavLink><NavLink to="/app/owner/sites/demo/history">Safety History</NavLink><NavLink to="/app/owner/verify">Verify Records</NavLink></>}
      </nav>
      <div className="cw-sidebar-footer">Decisions are backed by measured data, forecasts, and a verifiable safety record.</div>
    </aside>
    <main className="cw-main"><header className="cw-topbar"><div className="cw-connection"><span className="cw-connection-dot" aria-hidden="true" /> Connected <span>·</span> Last sync just now</div><div className="cw-user-menu"><span>{user?.email}</span><span className="cw-user-avatar" aria-hidden="true">{initials}</span><Button variant="quiet" onClick={logout}>Log out</Button></div></header><div className="cw-content"><Outlet /></div></main>
  </div></div>;
}

function StopWorkBanner({ site, onSimulateStrike, onAcknowledge, acknowledgePending, demo = false }: { site: Site; onSimulateStrike?: () => void; onAcknowledge?: () => void; acknowledgePending?: boolean; demo?: boolean }) {
  if (!site.activeAlert || site.activeAlert.status !== 'active') return null;
  return <div className={`cw-alert${demo ? ' cw-alert-demo' : ''}`} role="alert"><div><h2>{demo ? 'Demo stop-work' : 'Active stop-work'} · {site.name}</h2><p><strong>{site.activeAlert.reason}</strong>. Work remains paused until <strong>{site.activeAlert.allClearAt}</strong>. Another strike restarts the 30-minute countdown.</p><p className="cw-muted" style={{ marginTop: 6, color: '#8b332c' }}>{demo ? 'Illustrative timer · Not a live safety clearance.' : `Triggered at ${site.activeAlert.startedAt} · Live backend state${site.activeAlert.acknowledged ? ' · acknowledged' : ''}.`}</p>{(onSimulateStrike || (onAcknowledge && !site.activeAlert.acknowledged)) && <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>{onSimulateStrike && <button className="cw-button cw-button-secondary" onClick={onSimulateStrike}>Simulate strike <span className="cw-muted">(demo)</span></button>}{onAcknowledge && !site.activeAlert.acknowledged && <button className="cw-button cw-button-secondary" disabled={acknowledgePending} onClick={onAcknowledge}>{acknowledgePending ? 'Acknowledging…' : 'Acknowledge'}</button>}</div>}</div><Badge tone="danger">STOP WORK</Badge></div>;
}

function Metric({ label, value, note }: { label: string; value: string | number; note: string }) { return <Card className="cw-metric"><p className="cw-metric-label">{label}</p><p className="cw-metric-value">{value}</p><p className="cw-metric-note">{note}</p></Card>; }

const hazardIcons: Record<Site['primaryHazards'][number], string> = { Lightning: '⚡', Heat: '☀', Flooding: '◉', Wildfire: '♨', 'Soil saturation': '◒' };

function SiteRow({ site }: { site: Site }) { return <Link className="cw-site-row" to={`/app/supervisor/sites/${site.id}`}><div><p className="cw-site-name">{site.name}</p><p className="cw-site-meta">{site.location} · Updated {site.lastUpdated}</p>{site.primaryHazards.length ? <div className="cw-site-hazards" aria-label="Active hazards">{site.primaryHazards.map((hazard) => <span className="cw-site-hazard" key={hazard}><span className="cw-site-hazard-icon" aria-hidden="true">{hazardIcons[hazard]}</span>{hazard}</span>)}</div> : <p className="cw-site-meta">No active hazards</p>}</div><div className="cw-site-score"><span className="cw-score">{site.riskScore.toFixed(1)}</span><Badge tone={riskTone(site.riskLevel)}>{site.riskLevel}</Badge></div></Link>; }

function SiteMap({ filteredSites }: { filteredSites: Site[] }) {
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const toneClass = (site: Site) => site.riskLevel === 'Low' ? 'success' : site.riskLevel === 'Guarded' || site.riskLevel === 'Elevated' ? 'warning' : 'danger';
  return <div className="cw-map cw-interactive-map" aria-label="Interactive map of assigned Florida sites">
    <Map initialViewState={{ longitude: -81.7, latitude: 28.2, zoom: 6.4 }} mapStyle={floridaMapStyle} reuseMaps>
      <NavigationControl position="top-right" />
      {filteredSites.map((site) => <Marker key={site.id} longitude={site.longitude} latitude={site.latitude} anchor="center">
        <button type="button" className={`cw-map-marker cw-map-marker-${toneClass(site)}`} style={{ width: `${28 + site.riskScore * 2}px`, height: `${28 + site.riskScore * 2}px` }} aria-label={`${site.name}, risk ${site.riskScore}`} onClick={() => setSelectedSite(site)}>{site.riskScore.toFixed(1)}</button>
      </Marker>)}
      {selectedSite && <Popup longitude={selectedSite.longitude} latitude={selectedSite.latitude} anchor="bottom" closeOnClick={false} onClose={() => setSelectedSite(null)}>
        <div className="cw-map-popup"><strong>{selectedSite.name}</strong><span>{selectedSite.location}</span><span>Risk score: {selectedSite.riskScore.toFixed(1)} · {selectedSite.riskLevel}</span><Link to={`/app/supervisor/sites/${selectedSite.id}`}>View site details</Link></div>
      </Popup>}
    </Map>
  </div>;
}

// Live feed: /api/sites/summary polled every 20 s and nudged by /api/ws events.
// While the backend is unreachable the bundled demo data renders and a banner says so.
function useLiveSites() {
  const [sitesLive, setSitesLive] = useState<Site[] | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await live.summary();
        if (!cancelled) { setSitesLive(data.sites.map(summaryToSite)); setLiveError(null); }
      } catch (error) {
        if (!cancelled) setLiveError(`Live feed unavailable — showing demo data (${error instanceof Error ? error.message : 'error'}).`);
      }
    };
    let timer = 0;
    const loop = () => { void poll(); timer = window.setTimeout(loop, 20000); };
    loop();
    const ws = live.openEvents(() => { void poll(); });
    return () => { cancelled = true; window.clearTimeout(timer); ws.close(); };
  }, []);
  return { sitesLive, liveError };
}

function SupervisorHome() {
  const [search, setSearch] = useState('');
  const [risk, setRisk] = useState<'All' | RiskLevel>('All');
  const [hazard, setHazard] = useState('All');
  const { sitesLive, liveError } = useLiveSites();
  const sites = sitesLive ?? demoSites;
  const filteredSites = sites.filter((site) => (risk === 'All' || site.riskLevel === risk) && (hazard === 'All' || site.primaryHazards.includes(hazard as Site['primaryHazards'][number])) && `${site.name} ${site.location}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.riskScore - a.riskScore);
  const alertSite = sites.find((site) => site.activeAlert?.status === 'active');
  const staleCount = sites.filter((site) => site.dataFreshness !== 'Fresh').length;
  return <div><PageHeader eyebrow="Supervisor workspace" title="Site operations overview" description={liveError ?? 'What needs attention right now across your assigned sites. Live scores refresh every 15 minutes by the workers.'} /><div>{alertSite && <StopWorkBanner site={alertSite} />}</div><div className="cw-grid-metrics"><Metric label="Assigned sites" value={sites.length} note="All operational sites" /><Metric label="High or critical risk" value={sites.filter((site) => site.riskScore >= 7).length} note="Requires supervisor attention" /><Metric label="Active stop-work" value={sites.filter((site) => site.activeAlert?.status === 'active').length} note="Deterministic alert state" /><Metric label="Stale sources" value={staleCount} note="Review before relying on data" /></div><div className="cw-filter-bar"><input className="cw-input" aria-label="Search sites" placeholder="Search site or location" value={search} onChange={(event) => setSearch(event.target.value)} /><select className="cw-select" aria-label="Filter by risk level" value={risk} onChange={(event) => setRisk(event.target.value as typeof risk)}><option>All</option><option>Critical</option><option>High</option><option>Elevated</option><option>Guarded</option><option>Low</option></select><select className="cw-select" aria-label="Filter by hazard" value={hazard} onChange={(event) => setHazard(event.target.value)}><option>All</option><option>Lightning</option><option>Heat</option><option>Flooding</option><option>Wildfire</option><option>Soil saturation</option></select></div><div className="cw-dashboard-grid"><Card><div className="cw-section-heading"><h2>Site map</h2><span className="cw-muted">Last updated just now</span></div><SiteMap filteredSites={filteredSites} /></Card><Card><div className="cw-section-heading"><h2>Ranked sites</h2><span className="cw-muted">{filteredSites.length} shown</span></div><div className="cw-site-list">{filteredSites.length ? filteredSites.map((site) => <SiteRow key={site.id} site={site} />) : <div style={{ padding: 24 }}><p style={{ margin: 0 }}>No sites match these filters.</p></div>}</div></Card></div></div>;
}

const STOP_WORK_SECONDS = 30 * 60;

function SiteBeacon({ site, active, secondsLeft, strikeCount, strikeAnimationId, liveMode, strikePending, onStrike, onRequestAllClear, verificationMessage }: {
  site: Site;
  active: boolean;
  secondsLeft: number;
  strikeCount: number;
  strikeAnimationId: number;
  liveMode: boolean;
  strikePending: boolean;
  onStrike: () => void;
  onRequestAllClear: () => void;
  verificationMessage: string | null;
}) {
  const countdown = `${String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:${String(secondsLeft % 60).padStart(2, '0')}`;
  const weather = site.primaryHazards.includes('Lightning') ? 'storm' : site.primaryHazards.some((hazard) => hazard === 'Flooding' || hazard === 'Soil saturation') ? 'overcast' : 'sunny';
  const weatherLabel = weather === 'storm' ? 'Thunderstorms nearby' : weather === 'overcast' ? 'Cloudy conditions' : 'Sunny conditions';
  return <Card className={`cw-beacon ${active ? 'cw-beacon-stop' : 'cw-beacon-clear'}`}>
    <div className="cw-beacon-header">
      <div><p className="cw-eyebrow">Site visualization · {liveMode ? 'Live backend' : 'Demo'}</p><h2>Site Beacon</h2><p>Interactive 3D plant and 10-mile lightning safety perimeter</p></div>
      <span className="cw-beacon-status" role="status">{active ? '● STOP WORK' : '● ALL CLEAR'}</span>
    </div>
    <div className="cw-beacon-layout">
      <div className="cw-beacon-scene" aria-label={`${site.name}: ${weatherLabel}; ${active ? 'stop-work' : 'all-clear'}; 10-mile perimeter; ${strikeCount} simulated lightning ${strikeCount === 1 ? 'strike' : 'strikes'}`}>
        <Suspense fallback={<div className="cw-beacon-loading">Loading 3D site view…</div>}><SiteBeaconScene active={active} strikeCount={strikeCount} strikeAnimationId={strikeAnimationId} weather={weather} /></Suspense>
        <div className="cw-beacon-perimeter-tag">10-mile safety perimeter</div>
        <div className="cw-beacon-weather-tag">{weatherLabel}</div>
        <div className="cw-beacon-scene-tag">{site.name} · {site.location}</div>
      </div>
      <div className="cw-beacon-readout">
        <p className="cw-beacon-readout-label">{active ? 'Time until all-clear (30 min rule)' : 'Perimeter status'}</p>
        <div className="cw-beacon-timer" aria-live="off">{active ? countdown : '00:00'}</div>
        <div className="cw-beacon-progress" role="progressbar" aria-label="Stop-work countdown" aria-valuemin={0} aria-valuemax={STOP_WORK_SECONDS} aria-valuenow={secondsLeft}><span style={{ width: `${(secondsLeft / STOP_WORK_SECONDS) * 100}%` }} /></div>
        <p className="cw-beacon-message" role="status">{active ? 'Work remains paused. A new strike within 10 miles resets the 30-minute timer.' : liveMode ? 'All clear. Other site hazards still need review; a new strike returns this beacon to stop-work.' : 'Demo lightning all-clear. Connect the worker stack for live alerts.'}</p>
        <div className="cw-beacon-actions"><Button onClick={onStrike} disabled={strikePending}>{strikePending ? 'Queuing strike…' : 'Simulate lightning strike (demo)'}</Button>{active && <Button variant="quiet" onClick={onRequestAllClear}>Request early all-clear</Button>}</div>
        {verificationMessage && <p className="cw-step-up-feedback" role="status">{verificationMessage}</p>}
        <p className="cw-beacon-disclaimer">{liveMode ? 'The strike queues a simulated lightning event with the API; the stop-work engine (only writer of alert state) decides whether a stop-work starts. Decisions are the authority chain.' : 'Visualization only. Strike distances and locations are illustrative, not geographic scale. Strikes and status do not authorize field work.'}</p>
      </div>
    </div>
  </Card>;
}

function SiteDetail() {
  const { siteId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isMockAuth, requestStepUp, hasFreshMfa } = useAuth();
  const { sitesLive, liveError } = useLiveSites();
  const liveMode = sitesLive !== null;
  const site = (sitesLive ?? demoSites).find((item) => item.id === siteId);
  const detail = siteId ? siteDetailData[siteId] : undefined;
  const [strikeCount, setStrikeCount] = useState(0);
  const [strikeAnimationId, setStrikeAnimationId] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);
  const [stepUpPending, setStepUpPending] = useState(false);
  const [ackPending, setAckPending] = useState(false);
  const [overridePending, setOverridePending] = useState(false);
  const [strikePending, setStrikePending] = useState(false);
  const processingStepUp = useRef(false);
  const alertId = liveMode ? site?.activeAlert?.alertId : undefined;
  const lastSiteId = useRef(siteId);
  useEffect(() => {
    if (lastSiteId.current === siteId) return;
    lastSiteId.current = siteId;
    setStrikeAnimationId(0);
    setNow(Date.now());
    setVerificationMessage(null);
  }, [siteId]);
  // Live stops work stop_work_until ISO from the backend; a local snapshot is used in offline demo mode.
  const [demoUntil, setDemoUntil] = useState<number | null>(null);
  const liveUntilEpoch = site?.activeAlert?.allClearAt ? Date.parse(site.activeAlert.allClearAt) : NaN;
  const stopWorkUntil: number | null = liveMode ? (Number.isFinite(liveUntilEpoch) ? liveUntilEpoch : null) : demoUntil;
  useEffect(() => {
    if (stopWorkUntil === null) return;
    const interval = window.setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);
      if (currentTime >= stopWorkUntil) window.clearInterval(interval);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [stopWorkUntil]);
  const doOverride = useCallback((reason: string) => {
    if (!alertId || !user) return Promise.resolve(false);
    setOverridePending(true);
    return live.override(alertId, { userId: user.id, name: user.name }, reason).then((response) => {
      setStepUpOpen(false);
      setVerificationMessage(response?.ledger_record_id
        ? `Override queued. The decision is recorded as ${response.ledger_record_id} in the safety ledger.`
        : 'Override queued with the backend.');
    }).catch((error: Error & { status?: number; detail?: { error?: string } }) => {
      setVerificationMessage(error.status === 401 && error.detail?.error === 'step_up_required'
        ? 'The backend requires step-up MFA before an override. Sign in with Auth0 and re-verify.'
        : liveMode ? `Backend refused the override (${error.message}).` : 'Demo-only outcome shown. No live alert was changed.');
      setStepUpOpen(false);
    }).finally(() => setOverridePending(false));
  }, [alertId, user, liveMode]);
  useEffect(() => {
    if (new URLSearchParams(location.search).get('step_up') !== 'returned' || !siteId) {
      processingStepUp.current = false;
      return;
    }
    if (processingStepUp.current) return;
    processingStepUp.current = true;
    const rawRequest = sessionStorage.getItem('cypresswatch-step-up-preview');
    sessionStorage.removeItem('cypresswatch-step-up-preview');
    navigate(location.pathname, { replace: true });
    let request: { siteId: string; requestedAt: number } | null = null;
    try { request = rawRequest ? JSON.parse(rawRequest) : null; } catch { /* Invalid state fails closed. */ }
    if (request?.siteId === siteId && Date.now() - request.requestedAt < 5 * 60 * 1000 && hasFreshMfa(request.requestedAt)) {
      void doOverride('Step-up MFA verified via Auth0 reauthentication');
      setVerificationMessage('Auth0 MFA completed. Recording the override with the backend…');
    } else {
      setVerificationMessage('MFA was not confirmed. Stop-work remains active. Ask an admin to enable the step-up MFA Action in Auth0.');
    }
  }, [hasFreshMfa, location.pathname, location.search, navigate, siteId, doOverride]);
  if (!site) return <Placeholder title="Site not found" description="This site is not available in the current assignment." />;
  const secondsLeft = stopWorkUntil === null ? 0 : Math.max(0, Math.ceil((stopWorkUntil - now) / 1000));
  const active = secondsLeft > 0;
  const bannerSite: Site = active ? { ...site, activeAlert: { reason: site.activeAlert?.reason ?? 'Lightning within 10 miles', startedAt: site.activeAlert?.startedAt ?? 'now', allClearAt: site.activeAlert?.allClearAt ?? new Date(stopWorkUntil!).toISOString(), status: 'active', lastStrikeAt: site.activeAlert?.lastStrikeAt ?? 'now', acknowledged: site.activeAlert?.acknowledged } } : { ...site, activeAlert: undefined };
  const siteDetail = detail ?? { forecast: [], briefing: null, reports: [] };
  const simulateStrike = () => {
    setStrikeCount((previous) => previous + 1);
    setStrikeAnimationId((previous) => previous + 1);
    setNow(Date.now());
    setVerificationMessage(null);
    if (liveMode && site) {
      setStrikePending(true);
      void live.demoStrike(site.id)
        .then(() => setVerificationMessage("Simulated strike queued. The engine's next tick starts the stop-work if it lands within 10 miles."))
        .catch((error: Error) => setVerificationMessage(`Could not queue the strike (${error.message}).`))
        .finally(() => setStrikePending(false));
    } else {
      setDemoUntil(Date.now() + STOP_WORK_SECONDS * 1000); // offline demo countdown
    }
  };
  const acknowledge = () => {
    if (!alertId || !user) return;
    setAckPending(true);
    void live.acknowledge(alertId, { userId: user.id, name: user.name })
      .then(() => setVerificationMessage('Acknowledged. The decision reaches the safety ledger on the next anchor.'))
      .catch((error: Error) => setVerificationMessage(`Acknowledgment failed (${error.message}).`))
      .finally(() => setAckPending(false));
  };
  const verifyWithAuth0 = async () => {
    if (!siteId || isMockAuth) return;
    setStepUpPending(true);
    sessionStorage.setItem('cypresswatch-step-up-preview', JSON.stringify({ siteId, requestedAt: Date.now() }));
    try {
      await requestStepUp(`/app/supervisor/sites/${siteId}`);
    } catch {
      sessionStorage.removeItem('cypresswatch-step-up-preview');
      setVerificationMessage('Auth0 verification could not start. Stop-work remains active.');
      setStepUpOpen(false);
      setStepUpPending(false);
    }
  };
  return <div>
    <PageHeader eyebrow="Site risk detail" title={site.name} description={`${site.location} · Last updated ${site.lastUpdated}`} actions={<Link to="/app/supervisor" className="cw-button cw-button-secondary">Back to overview</Link>} />
    {(active || liveError) && <StopWorkBanner site={bannerSite} onSimulateStrike={liveMode ? simulateStrike : undefined} onAcknowledge={liveMode ? acknowledge : undefined} acknowledgePending={ackPending} demo={Boolean(liveError)} />}
    <SiteBeacon site={site} active={active} secondsLeft={secondsLeft} strikeCount={strikeCount} strikeAnimationId={strikeAnimationId} liveMode={liveMode} strikePending={strikePending} onStrike={simulateStrike} onRequestAllClear={() => setStepUpOpen(true)} verificationMessage={verificationMessage} />
    {stepUpOpen && <div className="cw-step-up-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setStepUpOpen(false); }}><div className="cw-step-up-dialog" role="dialog" aria-modal="true" aria-labelledby="cw-step-up-title">
      <p className="cw-eyebrow">Supervisor approval · {liveMode ? 'Live' : 'Demo'}</p>
      <h2 id="cw-step-up-title">Early all-clear requires step-up MFA</h2>
      <p>{liveMode ? 'Before clearing a stop-work alert early, the supervisor must confirm the site and complete a fresh Auth0 MFA challenge. The backend then queues the override for the engine and records it.' : 'Demo screen: in offline mode the action is simulated; the real flow posts a queued override to the backend.'}</p>
      <div className="cw-step-up-summary"><strong>{site.name}</strong><span>Lightning perimeter · {secondsLeft > 0 ? `${Math.floor(secondsLeft / 60)}m ${String(secondsLeft % 60).padStart(2, '0')}s` : 'Expired'} remaining</span></div>
      <ol className="cw-step-up-steps"><li>Review the active hazard and site.</li><li>Reauthenticate with Auth0 and complete MFA.</li><li>Backend validates role, MFA freshness, alert state, and records the decision.</li></ol>
      <div className="cw-step-up-actions">
        <Button variant="quiet" onClick={() => setStepUpOpen(false)}>Cancel</Button>
        {isMockAuth && liveMode && alertId && <Button disabled={overridePending} onClick={() => { void doOverride('Demo override (mock authentication, not MFA-verified)'); }}>{overridePending ? 'Sending override…' : 'Send override (demo clearance)'}</Button>}
        {!isMockAuth && liveMode && alertId && <Button onClick={() => { void verifyWithAuth0(); }} disabled={stepUpPending}>{stepUpPending ? 'Opening Auth0…' : 'Verify with Auth0'}</Button>}
        <Button variant="quiet" onClick={() => { setDemoUntil(null); setStepUpOpen(false); setVerificationMessage(liveMode ? 'Demo-only preview shown. No backend action taken.' : 'Demo-only verified outcome shown. No MFA completed and no live alert was changed.'); }}>Preview verified outcome (demo)</Button>
      </div>
    </div></div>}
    <div className="cw-detail-grid"><div>
      <Card className="cw-panel"><div className="cw-risk-hero"><div className="cw-risk-score-large">{site.riskScore.toFixed(1)}</div><div><Badge tone={riskTone(site.riskLevel)}>{site.riskLevel} risk</Badge><p className="cw-muted">Current hazard score out of 10</p></div></div><h2 style={{ marginTop: 26 }}>Why this score?</h2><p style={{ lineHeight: 1.6, marginBottom: 22 }}>{site.primaryHazards.length ? `${site.primaryHazards.join(' and ')} are driving the current score. Review the contributing evidence below before making an operational decision.` : 'No significant hazard contributors are currently reported.'}</p>{site.hazards.map((factor) => <div className="cw-factor" key={factor.label}><div><p className="cw-factor-label">{factor.label}</p><p className="cw-factor-meta">{factor.source} · Observed {factor.observedAt}</p></div><div className="cw-factor-value"><div>{factor.value}</div><Badge tone={riskTone(factor.severity)}>{factor.severity}</Badge></div></div>)}</Card>
      <Card className="cw-panel" style={{ marginTop: 20 }}><h2>Forecast drift</h2>{siteDetail.forecast.length ? <div className="cw-forecast">{siteDetail.forecast.map((point) => <div className="cw-forecast-point" key={point.time}><div className="cw-forecast-bar" style={{ height: `${Math.max(18, point.score * 10)}%` }}><span>{point.score.toFixed(1)}</span></div><strong>{point.time}</strong><small>{point.label}</small><p>{point.condition}</p></div>)}</div> : <p className="cw-muted">Forecast unavailable. This does not indicate safe conditions.</p>}</Card>
      <Card className="cw-panel" style={{ marginTop: 20 }}><h2>Latest safety briefing</h2>{siteDetail.briefing ? <><p style={{ lineHeight: 1.55 }}>{siteDetail.briefing.summary}</p><p className="cw-muted"><strong>Recommended work window:</strong> {siteDetail.briefing.recommendedWorkWindow}</p><p className="cw-muted">Generated {siteDetail.briefing.generatedAt}</p></> : <p className="cw-muted">No briefing is available for this site.</p>}</Card>
      <Card className="cw-panel" style={{ marginTop: 20 }}><h2>Recent crew reports</h2>{siteDetail.reports.length ? siteDetail.reports.map((report) => <div className="cw-factor" key={report.id}><div><p className="cw-factor-label">{report.hazardType} · {report.author}</p><p className="cw-factor-meta">{report.description} · {report.createdAt}</p></div><Badge tone={riskTone(report.severity)}>{report.status}</Badge></div>) : <p className="cw-muted">No recent crew reports.</p>}</Card>
    </div><div>
      <Card className="cw-panel"><h2>Data freshness</h2><Badge tone={site.dataFreshness === 'Fresh' ? 'success' : 'warning'}>{site.dataFreshness}</Badge><p className="cw-muted" style={{ lineHeight: 1.5 }}>Source timestamps are shown with each factor. Missing or stale data does not indicate safe conditions.</p></Card>
      <Card className="cw-panel" style={{ marginTop: 20 }}><h2>Safety record</h2><p className="cw-muted">Verification history is available from the Safety Ledger / Verify section.</p><Link to="/app/supervisor/verify" className="cw-button cw-button-secondary">View verification history</Link></Card>
    </div></div>
  </div>;
}
function Placeholder({ title, description }: { title: string; description: string }) { return <><PageHeader eyebrow="Placeholder destination" title={title} description={description} /><Card><div style={{ padding: 24 }}><p style={{ margin: 0, color: 'var(--cw-muted)' }}>This route is available for navigation and will be built in a later slice.</p></div></Card></>; }

function VerifyPage() {
  const [records, setRecords] = useState<Record<string, Awaited<ReturnType<typeof live.verify>>> | null>(null);
  const [list, setList] = useState<Awaited<ReturnType<typeof live.ledgerRecords>>['records'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    void live.ledgerRecords().then((data) => setList(data.records)).catch((err: Error) => setError(err.message));
  }, []);
  const check = (recordId: string) => {
    setBusy(recordId);
    void live.verify(recordId).then((result) => setRecords((prev) => ({ ...(prev ?? {}), [recordId]: result })))
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(null));
  };
  return <div>
    <PageHeader eyebrow="Safety ledger" title="Verify records" description="Every safety decision is hashed into a Merkle tree and the root is written to Solana devnet. Verify recomputes the proof and compares it with the chain." />
    {error && <Card><p style={{ margin: 0, color: '#8b332c' }}>Live ledger unavailable: {error}</p></Card>}
    <Card>
      <div className="cw-section-heading"><h2>Recent records</h2><span className="cw-muted">{list?.length ?? '…'} most recent</span></div>
      {!list && <p className="cw-muted">Loading records…</p>}
      <div id="cw-verify-list" style={{ display: 'grid', gap: 10 }}>
        {list?.map((record) => {
          const result = records?.[record.record_id];
          return <div key={record.record_id} className="cw-factor" style={{ alignItems: 'center' }}>
            <div>
              <p className="cw-factor-label">{record.record_id} · {record.record_type} · {record.site_id}</p>
              <p className="cw-factor-meta">{record.created_at} · {record.anchored ? `root ${record.merkle_root?.slice(0, 16)}…` : 'waiting for the next hourly anchor'}</p>
              {result && <p className="cw-factor-meta" style={{ color: result.verified ? '#1a7f37' : '#8b332c' }}>{result.message}{result.explorer_url && <> · <a href={result.explorer_url} target="_blank" rel="noreferrer">explorer</a></>}</p>}
            </div>
            <Button variant="quiet" disabled={busy === record.record_id} onClick={() => check(record.record_id)}>{busy === record.record_id ? 'Verifying…' : 'Verify'}</Button>
          </div>;
        })}
        {list?.length === 0 && <p className="cw-muted">No ledger records yet — they appear once the engine emits safety events and the scheduler anchors them.</p>}
      </div>
    </Card>
  </div>;
}
function Login() { const { login, isMockAuth, isAuthenticated } = useAuth(); const navigate = useNavigate(); useEffect(() => { if (isAuthenticated) navigate('/app', { replace: true }); }, [isAuthenticated, navigate]); return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--cw-subtle)' }}><Card><div style={{ width: 'min(440px, 80vw)', padding: 32 }}><p className="cw-eyebrow">CypressWatch</p><h1 style={{ margin: '0 0 10px' }}>Sign in to safety operations</h1><p style={{ color: 'var(--cw-muted)', lineHeight: 1.5 }}>{isMockAuth ? 'Auth0 is not configured, so local demo authentication is active.' : 'Sign in with your CypressWatch Auth0 account.'}</p><Button onClick={() => { login(); if (isMockAuth) navigate('/app'); }}>{isMockAuth ? 'Continue as supervisor demo' : 'Continue with Auth0'}</Button><p style={{ margin: '18px 0 0', color: 'var(--cw-muted)', fontSize: 12 }}>{isMockAuth ? 'Demo mode · supervisor@example.com' : 'Production authentication · Auth0'}</p></div></Card></div>; }
function AuthCallback() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const isAuth0Callback = params.has('code') || params.has('state') || params.has('error');
  return isAuth0Callback ? <div className="cw-auth-loading">Completing sign in…</div> : <Navigate to="/login" replace />;
}
function RoleHomeRedirect() { const { user } = useAuth(); return user?.role === 'supervisor' ? <Navigate to="/app/supervisor" replace /> : user?.role === 'crew' ? <Navigate to="/app/crew" replace /> : user?.role === 'owner' ? <Navigate to="/app/owner" replace /> : <AccessDenied />; }

createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><AuthProvider><Routes>
  <Route path="/" element={<AuthCallback />} />
  <Route path="/login" element={<Login />} />
  <Route element={<RequireAuth />}><Route path="/app" element={<AppShell />}><Route index element={<RoleHomeRedirect />} />
    <Route element={<RequireRole role="supervisor" />}><Route path="supervisor" element={<SupervisorHome />} /><Route path="supervisor/sites" element={<SupervisorHome />} /><Route path="supervisor/sites/:siteId" element={<SiteDetail />} /><Route path="supervisor/briefings" element={<Placeholder title="Briefings" description="Prepare and review the latest safety briefings." />} /><Route path="supervisor/verify" element={<VerifyPage />} /></Route>
    <Route element={<RequireRole role="crew" />}><Route path="crew" element={<Placeholder title="My site" description="Crew-facing site status and stop-work information." />} /><Route path="crew/site" element={<Placeholder title="Briefing" description="The latest field briefing for the assigned site." />} /><Route path="crew/report" element={<Placeholder title="Report hazard" description="Submit a hazard report when the crew experience is connected." />} /></Route>
    <Route element={<RequireRole role="owner" />}><Route path="owner" element={<Placeholder title="Sites" description="Read-only site visibility for project owners." />} /><Route path="owner/sites/:siteId/history" element={<Placeholder title="Safety history" description="Read-only history for a selected site." />} /><Route path="owner/verify" element={<Placeholder title="Verify records" description="Read-only verification records." />} /></Route>
  </Route></Route>
  <Route path="*" element={<Navigate to="/app" replace />} />
</Routes></AuthProvider></BrowserRouter></StrictMode>);
