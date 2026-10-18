import { StrictMode, Suspense, lazy, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import Map, { Marker, NavigationControl, Popup } from 'react-map-gl/maplibre';
import type { StyleSpecification } from 'maplibre-gl';
import { Badge, Button, Card, PageHeader } from '@cypresswatch/ui';
import { AccessDenied, AuthProvider, RequireAuth, RequireRole, useAuth } from './auth';
import { isRiskLevel, live, summaryToSite, type Briefing, type CrewReport, type HazardKey, type Lang, type ReportStatus, type Severity, type SiteScore } from './live';
import { riskTone, siteDetailData, sites as demoSites, type RiskLevel, type Site } from './data';
import './app.css';
import '@cypresswatch/ui/tokens.css';
import 'maplibre-gl/dist/maplibre-gl.css';

const crewAppUrl = import.meta.env.VITE_CREW_APP_URL || 'https://cypresswatch-crew.app.space/';

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
const HazardStatusOrb = lazy(() => import('./HazardStatusOrb').then(({ HazardStatusOrb }) => ({ default: HazardStatusOrb })));

function AppShell() {
  const { user, logout } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => localStorage.getItem('cypresswatch-theme') === 'dark' ? 'dark' : 'light');
  const initials = user?.name.split(' ').map((part) => part[0]).join('').slice(0, 2);
  const roleLabel = user?.role === 'supervisor' ? 'Supervisor' : user?.role === 'crew' ? 'Crew member' : user?.role === 'owner' ? 'Project owner' : 'Unassigned role';
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('cypresswatch-theme', theme);
  }, [theme]);
  return <div className="cw-app"><div className="cw-shell">
    <button className={`cw-menu-toggle${navOpen ? ' cw-menu-toggle-hidden' : ''}`} type="button" aria-label="Show navigation" aria-expanded={navOpen} onMouseEnter={() => setNavOpen(true)} onFocus={() => setNavOpen(true)}><span aria-hidden="true">☰</span></button>
    <aside className={`cw-sidebar${navOpen ? ' cw-sidebar-open' : ''}`} onMouseEnter={() => setNavOpen(true)} onMouseLeave={() => setNavOpen(false)} onFocus={() => setNavOpen(true)}>
      <div className="cw-brand"><span className="cw-brand-mark">CW</span><div><div className="cw-brand-name">CypressWatch</div><p className="cw-brand-subtitle">Safety command center</p></div></div>
      <div className="cw-role">Current workspace<strong>{roleLabel}</strong></div>
      <div className="cw-nav-label">Operations</div>
      <nav className="cw-nav" aria-label="Primary navigation">
        {user?.role === 'supervisor' && <><NavLink to="/app/supervisor" end>Overview</NavLink><NavLink to="/app/supervisor/reports">Crew reports</NavLink><NavLink to="/app/supervisor/briefings">Briefings</NavLink><NavLink to="/app/supervisor/verify">Safety Ledger / Verify</NavLink></>}
        {user?.role === 'crew' && <NavLink to="/app/crew">Crew app</NavLink>}
        {user?.role === 'owner' && <><NavLink to="/app/owner" end>Sites</NavLink><NavLink to="/app/owner/sites/demo/history">Safety History</NavLink><NavLink to="/app/owner/verify">Verify Records</NavLink></>}
      </nav>
      <div className="cw-sidebar-footer">Decisions are backed by measured data, forecasts, and a verifiable safety record.</div>
    </aside>
    <main className="cw-main"><header className="cw-topbar"><div className="cw-connection">Source status shown on the overview</div><div className="cw-user-menu"><button className="cw-theme-toggle" type="button" aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} aria-pressed={theme === 'dark'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><span aria-hidden="true">{theme === 'light' ? '☾' : '☀'}</span></button><span>{user?.email}</span><span className="cw-user-avatar" aria-hidden="true">{initials}</span><Button variant="quiet" onClick={logout}>Log out</Button></div></header><div className="cw-content"><Outlet /></div></main>
  </div></div>;
}

function StopWorkBanner({ site, onSimulateStrike, onAcknowledge, acknowledgePending, demo = false }: { site: Site; onSimulateStrike?: () => void; onAcknowledge?: () => void; acknowledgePending?: boolean; demo?: boolean }) {
  if (!site.activeAlert || site.activeAlert.status !== 'active') return null;
  return <div className={`cw-alert${demo ? ' cw-alert-demo' : ''}`} role="alert"><div><h2>{demo ? 'Demo stop-work' : 'Active stop-work'} · {site.name}</h2><p><strong>{site.activeAlert.reason}</strong>. Work remains paused until <strong>{site.activeAlert.allClearAt}</strong>. Another strike restarts the 30-minute countdown.</p><p className="cw-muted" style={{ marginTop: 6, color: '#8b332c' }}>{demo ? 'Illustrative timer · Not a live safety clearance.' : `Triggered at ${site.activeAlert.startedAt} · Live backend state${site.activeAlert.acknowledged ? ' · acknowledged' : ''}.`}</p>{(onSimulateStrike || (onAcknowledge && !site.activeAlert.acknowledged)) && <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>{onSimulateStrike && <button className="cw-button cw-button-secondary" onClick={onSimulateStrike}>Simulate strike <span className="cw-muted">(demo)</span></button>}{onAcknowledge && !site.activeAlert.acknowledged && <button className="cw-button cw-button-secondary" disabled={acknowledgePending} onClick={onAcknowledge}>{acknowledgePending ? 'Acknowledging…' : 'Acknowledge'}</button>}</div>}</div><Badge tone="danger">STOP WORK</Badge></div>;
}

function Metric({ label, value, note }: { label: string; value: string | number; note: string }) { return <Card className="cw-metric"><p className="cw-metric-label">{label}</p><p className="cw-metric-value">{value}</p><p className="cw-metric-note">{note}</p></Card>; }

const hazardIcons: Record<Site['primaryHazards'][number], string> = { Lightning: '⚡', Heat: '☀', Flooding: '◉', Wildfire: '♨', 'Soil saturation': '◒', Rain: '☔', Wind: '〰', Context: '◈' };
const landscapeLabels: Record<Site['landscape'], string> = { woodland: 'woodland', river: 'riverside', wetland: 'wetland', scrub: 'dry scrub' };

function SiteRow({ site }: { site: Site }) { return <Link className="cw-site-row" to={`/app/supervisor/sites/${site.id}`}><div><p className="cw-site-name">{site.name}</p><p className="cw-site-meta">{site.location} · Updated {site.lastUpdated}</p>{site.primaryHazards.length ? <div className="cw-site-hazards" aria-label="Contributing factors and alerts">{site.primaryHazards.map((hazard) => <span className="cw-site-hazard" key={hazard}><span className="cw-site-hazard-icon" aria-hidden="true">{hazardIcons[hazard]}</span>{hazard}</span>)}</div> : <p className="cw-site-meta">No weather factor among top drivers</p>}</div><div className="cw-site-score"><span className="cw-score">{site.riskScore.toFixed(1)}</span><Badge tone={riskTone(site.riskLevel)}>{site.riskLevel}</Badge></div></Link>; }

function SiteMap({ filteredSites }: { filteredSites: Site[] }) {
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const toneClass = (site: Site) => site.riskLevel === 'Low' ? 'success' : site.riskLevel === 'Guarded' || site.riskLevel === 'Elevated' ? 'warning' : 'danger';
  return <div className="cw-map cw-interactive-map" aria-label="Interactive map of assigned Florida sites">
    <Map initialViewState={{ longitude: -81.7, latitude: 28.2, zoom: 6.4 }} mapStyle={floridaMapStyle} reuseMaps>
      <NavigationControl position="top-right" />
      {filteredSites.map((site) => <Marker key={site.id} longitude={site.longitude} latitude={site.latitude} anchor="center">
        <div className="cw-map-marker-wrap" style={{ '--marker-size': `${28 + site.riskScore * 2}px` } as CSSProperties}><span className={`cw-map-marker-tail cw-map-marker-${toneClass(site)}`} aria-hidden="true" /><button type="button" className={`cw-map-marker cw-map-marker-${toneClass(site)}`} aria-label={`${site.name}, risk ${site.riskScore}`} onClick={() => setSelectedSite(site)}><span className="cw-map-marker-value">{site.riskScore.toFixed(1)}</span></button></div>
      </Marker>)}
      {selectedSite && <Popup longitude={selectedSite.longitude} latitude={selectedSite.latitude} anchor="bottom" closeOnClick={false} onClose={() => setSelectedSite(null)}>
        <div className="cw-map-popup"><strong>{selectedSite.name}</strong><span>{selectedSite.location}</span><span>Risk score: {selectedSite.riskScore.toFixed(1)} · {selectedSite.riskLevel}</span><Link to={`/app/supervisor/sites/${selectedSite.id}`}>View site details</Link></div>
      </Popup>}
    </Map>
  </div>;
}

function SiteLocationContext({ site, liveMode }: { site: Site; liveMode: boolean }) {
  return <Card className="cw-location-context">
    <div className="cw-location-context-heading">
      <div><p className="cw-eyebrow">Mapped surroundings</p><h2>Near this site pin</h2><p>Roads, waterways, and neighboring land shown at the site’s mapped coordinates.</p></div>
      <span className="cw-location-coordinates">{site.latitude.toFixed(3)}°, {site.longitude.toFixed(3)}°</span>
    </div>
    <div className="cw-location-map" aria-label={`Street map near the ${liveMode ? 'backend' : 'demo'} pin for ${site.name}`}>
      <Map key={site.id} initialViewState={{ latitude: site.latitude, longitude: site.longitude, zoom: 12 }} mapStyle={floridaMapStyle} reuseMaps>
        <NavigationControl position="top-right" showCompass={false} />
        <Marker longitude={site.longitude} latitude={site.latitude} anchor="bottom">
          <span className="cw-location-pin" aria-label={`${site.name} ${liveMode ? 'backend' : 'demo'} pin`}>●</span>
        </Marker>
      </Map>
    </div>
    <p className="cw-location-context-note">{liveMode ? 'Backend site coordinates, not a surveyed facility boundary.' : 'Demo pin, not a surveyed facility boundary.'} Basemap: OpenStreetMap contributors. The 3D plant and terrain above are illustrative and do not depict this mapped location.</p>
  </Card>;
}

function useLiveSites() {
  const { getAccessToken, isMockAuth } = useAuth();
  const [sitesLive, setSitesLive] = useState<Site[] | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  useEffect(() => {
    if (isMockAuth) {
      setSitesLive(null);
      setLiveError('Demo sign-in has no API access token');
      return;
    }
    let stopped = false;
    const refresh = async () => {
      try {
        const response = await live.summary(getAccessToken);
        if (!Array.isArray(response.sites) || response.sites.length === 0) throw new Error('Signed in, but no sites are assigned to your account. Ask an admin to set app_metadata.site_ids (or ["*"]) in Auth0, then sign in again');
        if (response.sites.some((site) => site.hazard_score === null || !isRiskLevel(site.risk_level) || !site.scored_at)) {
          throw new Error('Hazard scores are unavailable for one or more assigned sites');
        }
        if (!stopped) {
          setSitesLive(response.sites.map(summaryToSite));
          setLiveError(null);
        }
      } catch (error) {
        if (!stopped) {
          setSitesLive(null);
          setLiveError(error instanceof Error ? error.message : 'Live feed unavailable');
        }
      }
    };
    void refresh();
    const polling = window.setInterval(() => { void refresh(); }, 15_000);
    const socket = live.openEvents(getAccessToken, () => { void refresh(); });
    return () => { stopped = true; window.clearInterval(polling); socket.close(); };
  }, [getAccessToken, isMockAuth]);
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
  return <div>
    <PageHeader eyebrow="Supervisor workspace" title="Site operations overview" description="What needs attention right now across your assigned sites." />
    <p className="cw-muted" role="status">{sitesLive ? (sitesLive.every((site) => site.dataFreshness === 'Fresh') ? 'Live backend scores' : 'Backend scores · stale data') : `Demo data${liveError ? ` · ${liveError}` : ' · checking backend'}`}</p>
    {alertSite && <StopWorkBanner site={alertSite} demo={!sitesLive || Boolean(alertSite.activeAlert?.simulated)} />}
    <div className="cw-grid-metrics">
      <Metric label="Assigned sites" value={sites.length} note="All operational sites" />
      <Metric label="High or critical risk" value={sites.filter((site) => site.riskLevel === 'High' || site.riskLevel === 'Critical').length} note="Requires supervisor attention" />
      <Metric label="Active stop-work" value={sites.filter((site) => site.activeAlert?.status === 'active').length} note="Deterministic alert state" />
      <Metric label="Stale scores" value={staleCount} note="Review before relying on data" />
    </div>
    <div className="cw-filter-bar">
      <input className="cw-input" aria-label="Search sites" placeholder="Search site or location" value={search} onChange={(event) => setSearch(event.target.value)} />
      <select className="cw-select" aria-label="Filter by risk level" value={risk} onChange={(event) => setRisk(event.target.value as typeof risk)}><option>All</option><option>Critical</option><option>High</option><option>Elevated</option><option>Guarded</option><option>Low</option></select>
      <select className="cw-select" aria-label="Filter by hazard" value={hazard} onChange={(event) => setHazard(event.target.value)}><option>All</option><option>Lightning</option><option>Heat</option><option>Flooding</option><option>Rain</option><option>Wind</option><option>Wildfire</option><option>Soil saturation</option></select>
    </div>
    <div className="cw-dashboard-grid">
      <Card><div className="cw-section-heading"><h2>Site map</h2><span className="cw-muted">{sitesLive ? 'Backend site summary' : 'Demo site data'}</span></div><SiteMap filteredSites={filteredSites} /><p className="cw-map-note">{sitesLive ? 'Pins use the backend site coordinates; the 3D scenes remain illustrative.' : 'Pins use demo coordinates, not surveyed facility locations.'}</p></Card>
      <Card><div className="cw-section-heading"><h2>Ranked sites</h2><span className="cw-muted">{filteredSites.length} shown</span></div><div className="cw-site-list">{filteredSites.length ? filteredSites.map((site) => <SiteRow key={site.id} site={site} />) : <div style={{ padding: 24 }}><p style={{ margin: 0 }}>No sites match these filters.</p></div>}</div></Card>
    </div>
  </div>;
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
  const hasLightningHazard = site.primaryHazards.includes('Lightning');
  const weather = hasLightningHazard ? 'storm' : site.primaryHazards.some((hazard) => hazard === 'Flooding' || hazard === 'Rain' || hazard === 'Soil saturation') ? 'overcast' : 'sunny';
  const weatherLabel = weather === 'storm' ? 'Thunderstorms nearby' : weather === 'overcast' ? 'Cloudy conditions' : 'Sunny conditions';
  return <Card className={`cw-beacon ${active ? 'cw-beacon-stop' : 'cw-beacon-clear'}`}>
    <div className="cw-beacon-header">
      <div><p className="cw-eyebrow">Site visualization · Demo</p><h2>Site Beacon</h2><p>Interactive 3D plant and 10-mile lightning safety perimeter · Illustrative {landscapeLabels[site.landscape]} setting</p></div>
      <span className="cw-beacon-status" role="status">{active ? '● STOP WORK' : '● ALL CLEAR'}</span>
    </div>
    <div className="cw-beacon-layout">
      <div className="cw-beacon-scene" aria-label={`${site.name}: illustrative ${landscapeLabels[site.landscape]} setting; ${weatherLabel}; ${active ? 'demo stop-work' : 'demo all-clear'}; 10-mile perimeter; ${strikeCount} simulated lightning ${strikeCount === 1 ? 'strike' : 'strikes'}. Drag to rotate and scroll or pinch to zoom.`}>
        <Suspense fallback={<div className="cw-beacon-loading">Loading 3D site view…</div>}><SiteBeaconScene active={active} strikeCount={strikeCount} strikeAnimationId={strikeAnimationId} weather={weather} landscape={site.landscape} /></Suspense>
        <div className="cw-beacon-perimeter-tag">10-mile safety perimeter</div>
        <div className="cw-beacon-weather-tag">{weatherLabel}</div>
        <div className="cw-beacon-scene-tag">{site.name} · {site.location}</div>
        <div className="cw-beacon-controls-hint" aria-hidden="true">Drag to rotate · Scroll to zoom</div>
      </div>
      <div className="cw-beacon-readout">
        <p className="cw-beacon-readout-label">{active ? liveMode ? 'Time until eligible for backend all-clear' : 'Time until demo all-clear' : 'Perimeter status'}</p>
        <div className="cw-beacon-timer" aria-live="off">{active ? countdown : '00:00'}</div>
        <div className="cw-beacon-progress" role="progressbar" aria-label={liveMode ? 'Stop-work countdown' : 'Demo stop-work countdown'} aria-valuemin={0} aria-valuemax={STOP_WORK_SECONDS} aria-valuenow={secondsLeft}><span style={{ width: `${(secondsLeft / STOP_WORK_SECONDS) * 100}%` }} /></div>
        <p className="cw-beacon-message" role="status">{active ? `Work remains paused. A new strike within 10 miles resets the 30-minute timer.${liveMode ? ' Only the backend can clear a live alert.' : ''}` : hasLightningHazard ? 'No active lightning stop-work shown. Other hazards still need review; a new strike may return this beacon to stop-work.' : 'No lightning hazard is shown for this site. Review any other site hazards before authorizing work.'}</p>
        {/* Lightning can reach any site, so the demo strike is always offered (it is flagged simulated). */}<div className="cw-beacon-actions"><Button onClick={onStrike} disabled={strikePending}>{strikePending ? 'Queuing strike…' : 'Simulate lightning strike'}</Button>{active && <Button variant="quiet" onClick={onRequestAllClear}>Request early all-clear</Button>}</div>
        {verificationMessage && <p className="cw-step-up-feedback" role="status">{verificationMessage}</p>}
        <p className="cw-beacon-disclaimer">Visualization only. The 3D facility, terrain, and strike distances are illustrative, not geographic scale. Sky conditions are inferred from {liveMode ? 'backend score factors' : 'demo hazards'}; this scene does not authorize field work.</p>
      </div>
    </div>
  </Card>;
}

function SiteDecisionSummary({ site, active, secondsLeft, liveMode }: { site: Site; active: boolean; secondsLeft: number; liveMode: boolean }) {
  const leadingHazard = site.hazards[0];
  const orbState = active ? 'stop' : site.riskLevel === 'Critical' || site.riskLevel === 'High' || site.riskLevel === 'Elevated' ? 'watch' : 'monitor';
  const countdown = `${String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:${String(secondsLeft % 60).padStart(2, '0')}`;
  return <section className={`cw-decision-summary${active ? ' cw-decision-summary-active' : ''}`} aria-labelledby="site-decision-title">
    <div className="cw-decision-main">
      <p className="cw-decision-kicker">01 / Current site status <span>{liveMode ? site.activeAlert?.simulated ? 'Backend scores · simulated strike' : 'Backend site data' : 'Demo data'}</span></p>
      <h2 id="site-decision-title">{active ? 'Stop exposed work' : 'No active stop-work alert shown'}</h2>
      <p className="cw-decision-guidance">{active
        ? `${liveMode ? 'The backend reports an active lightning stop-work.' : 'A lightning strike is inside the demo 10-mile perimeter.'} Keep exposed work paused and review current conditions before any reopening decision.`
        : site.primaryHazards.length
          ? 'Other hazards are still reported for this site. Review their evidence and freshness before deciding whether work can proceed.'
          : `No leading weather hazard is reported in ${liveMode ? 'the latest score' : 'the demo data'}. Confirm current site conditions and source freshness before authorizing work.`}</p>
      <div className="cw-decision-actions"><a className="cw-button cw-button-primary" href="#hazard-evidence">Review hazard evidence</a><a className="cw-button cw-button-secondary" href="#site-context">View mapped surroundings</a></div>
    </div>
    <div className="cw-decision-side">
      <Suspense fallback={<span className="cw-status-orb-placeholder" aria-hidden="true" />}><HazardStatusOrb state={orbState} hazard={active ? 'Lightning' : leadingHazard?.type} /></Suspense>
      <dl className="cw-decision-facts">
        <div><dt>Current signal</dt><dd>{active ? 'Lightning · inside 10 mi' : leadingHazard ? `${leadingHazard.type} · ${leadingHazard.value}` : 'No hazards reported'}</dd></div>
        <div><dt>{active ? liveMode ? 'Stop-work countdown' : 'Demo countdown' : 'Risk score'}</dt><dd>{active ? countdown : `${site.riskScore.toFixed(1)} / 10`}</dd></div>
        <div><dt>Source freshness</dt><dd>{site.dataFreshness}{site.dataFreshness !== 'Fresh' ? ' · verify before use' : ''}</dd></div>
      </dl>
    </div>
  </section>;
}

function SiteDetail() {
  const { siteId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { isMockAuth, requestStepUp, hasFreshMfa, getAccessToken } = useAuth();
  const { sitesLive, liveError } = useLiveSites();
  const liveSite = sitesLive?.find((item) => item.id === siteId);
  const liveMode = Boolean(liveSite);
  const site = liveSite ?? demoSites.find((item) => item.id === siteId);
  const detail = siteId ? siteDetailData[siteId] : undefined;
  const [strikeCount, setStrikeCount] = useState(() => demoSites.find((item) => item.id === siteId)?.activeAlert?.status === 'active' ? 1 : 0);
  const [strikeAnimationId, setStrikeAnimationId] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);
  const [stepUpPending, setStepUpPending] = useState(false);
  const [strikePending, setStrikePending] = useState(false);
  const processingStepUp = useRef(false);
  const lastSiteId = useRef(siteId);
  const [demoUntil, setDemoUntil] = useState<number | null>(() => demoSites.find((item) => item.id === siteId)?.activeAlert?.status === 'active' ? Date.now() + STOP_WORK_SECONDS * 1000 : null);
  useEffect(() => {
    if (lastSiteId.current === siteId) return;
    lastSiteId.current = siteId;
    setDemoUntil(demoSites.find((item) => item.id === siteId)?.activeAlert?.status === 'active' ? Date.now() + STOP_WORK_SECONDS * 1000 : null);
    setStrikeCount(demoSites.find((item) => item.id === siteId)?.activeAlert?.status === 'active' ? 1 : 0);
    setStrikeAnimationId(0);
    setNow(Date.now());
    setVerificationMessage(null);
  }, [siteId]);
  // Live countdown comes from backend state; the local snapshot is only for demo sites.
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
  useEffect(() => {
    if (new URLSearchParams(location.search).get('step_up') !== 'returned' || !siteId) {
      processingStepUp.current = false;
      return;
    }
    if (processingStepUp.current) return;
    processingStepUp.current = true;
    const rawRequest = sessionStorage.getItem('cypresswatch-step-up-request');
    sessionStorage.removeItem('cypresswatch-step-up-request');
    navigate(location.pathname, { replace: true });
    let request: { siteId: string; alertId: string; requestedAt: number } | null = null;
    try { request = rawRequest ? JSON.parse(rawRequest) : null; } catch { /* Invalid state fails closed. */ }
    if (request?.siteId === siteId && Date.now() - request.requestedAt < 5 * 60 * 1000 && hasFreshMfa(request.requestedAt)) {
      setStepUpPending(true);
      void live.override(request.alertId, () => getAccessToken({ forceRefresh: true }), 'Supervisor requested an early all-clear after step-up MFA')
        .then(() => {
          setStepUpOpen(false);
          setVerificationMessage('All-clear request accepted. The alert engine will record the final decision and refresh this site.');
        })
        .catch((error: Error) => setVerificationMessage(`The API rejected the all-clear request (${error.message}). The stop-work remains active.`))
        .finally(() => setStepUpPending(false));
    } else {
      setVerificationMessage('MFA was not confirmed. Stop-work remains active. Ask an admin to enable the step-up MFA Action in Auth0.');
    }
  }, [getAccessToken, hasFreshMfa, location.pathname, location.search, navigate, siteId]);
  if (!site) return <Placeholder title="Site not found" description="This site is not available in the current assignment." />;
  const secondsLeft = stopWorkUntil === null ? 0 : Math.max(0, Math.ceil((stopWorkUntil - now) / 1000));
  const active = liveMode ? site.activeAlert?.status === 'active' : secondsLeft > 0;
  const siteDetail = detail ?? { forecast: [], briefing: null, reports: [] };
  const simulateStrike = () => {
    setStrikeCount((previous) => previous + 1);
    setStrikeAnimationId((previous) => previous + 1);
    setNow(Date.now());
    setVerificationMessage(null);
    if (liveMode && site) {
      setStrikePending(true);
      void live.demoStrike(site.id, getAccessToken)
        .then(() => setVerificationMessage("Simulated strike queued. The engine's next tick starts the stop-work if it lands within 10 miles."))
        .catch((error: Error) => setVerificationMessage(`Could not queue the strike (${error.message}).`))
        .finally(() => setStrikePending(false));
    } else {
      setDemoUntil(Date.now() + STOP_WORK_SECONDS * 1000); // offline demo countdown
    }
  };
  const verifyWithAuth0 = async () => {
    const alertId = site?.activeAlert?.alertId;
    if (!siteId || !alertId || isMockAuth) return;
    setStepUpPending(true);
    sessionStorage.setItem('cypresswatch-step-up-request', JSON.stringify({ siteId, alertId, requestedAt: Date.now() }));
    try {
      await requestStepUp(`/app/supervisor/sites/${siteId}`);
    } catch {
      sessionStorage.removeItem('cypresswatch-step-up-request');
      setVerificationMessage('Auth0 verification could not start. Stop-work remains active.');
      setStepUpOpen(false);
      setStepUpPending(false);
    }
  };
  return <div>
    <PageHeader eyebrow="Site risk detail" title={site.name} description={`${site.location} · Last updated ${site.lastUpdated}`} actions={<Link to="/app/supervisor" className="cw-button cw-button-secondary">Back to overview</Link>} />
    {!liveMode && <p className="cw-muted" role="status">Demo site data{liveError ? ' · live backend unavailable' : sitesLive ? ' · not present in live feed' : ' · checking live backend'}</p>}
    <SiteDecisionSummary site={site} active={active} secondsLeft={secondsLeft} liveMode={liveMode} />
    {site.activeFloodWarning && <div className="cw-alert" role="status"><div><h2>{site.activeFloodWarning.simulated ? 'Demo flood warning' : 'Flood warning'} · {site.name}</h2><p>{site.activeFloodWarning.message}</p><p className="cw-muted">This warning is separate from a lightning stop-work decision.</p></div><Badge tone="warning">FLOOD</Badge></div>}
    <SiteBeacon site={site} active={active} secondsLeft={secondsLeft} strikeCount={strikeCount} strikeAnimationId={strikeAnimationId} liveMode={liveMode} strikePending={strikePending} onStrike={simulateStrike} onRequestAllClear={() => setStepUpOpen(true)} verificationMessage={verificationMessage} />
    <div id="site-context"><SiteLocationContext site={site} liveMode={liveMode} /></div>
    {stepUpOpen && <div className="cw-step-up-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setStepUpOpen(false); }}><div className="cw-step-up-dialog" role="dialog" aria-modal="true" aria-labelledby="cw-step-up-title">
      <p className="cw-eyebrow">Supervisor approval · {liveMode ? 'Live' : 'Demo'}</p>
      <h2 id="cw-step-up-title">Early all-clear requires step-up MFA</h2>
      <p>{liveMode ? 'The API will validate your Auth0 access token, supervisor role, assigned site, and fresh MFA claim before queuing this request. The alert engine remains the only component that can clear the stop-work.' : 'Demo screen: in offline mode the action is simulated. It cannot authorize field work.'}</p>
      <div className="cw-step-up-summary"><strong>{site.name}</strong><span>Lightning perimeter · {secondsLeft > 0 ? `${Math.floor(secondsLeft / 60)}m ${String(secondsLeft % 60).padStart(2, '0')}s` : 'Expired'} remaining</span></div>
      <ol className="cw-step-up-steps"><li>Review the active hazard and site.</li><li>Reauthenticate with Auth0 and complete MFA.</li><li>The API validates the signed token and queues the request for the alert engine.</li></ol>
      <div className="cw-step-up-actions">
        <Button variant="quiet" onClick={() => setStepUpOpen(false)}>Cancel</Button>
        {!isMockAuth && liveMode && <Button onClick={() => { void verifyWithAuth0(); }} disabled={stepUpPending}>{stepUpPending ? 'Opening Auth0…' : 'Continue with Auth0 MFA'}</Button>}
        {!liveMode && <Button variant="quiet" onClick={() => { setDemoUntil(null); setStepUpOpen(false); setVerificationMessage('Demo-only verified outcome shown. No MFA completed and no live alert was changed.'); }}>Preview verified outcome (demo)</Button>}
      </div>
    </div></div>}
    <div id="hazard-evidence" className="cw-detail-grid"><div>
      <Card className="cw-panel"><div className="cw-risk-hero"><div className="cw-risk-score-large">{site.riskScore.toFixed(1)}</div><div><Badge tone={riskTone(site.riskLevel)}>{site.riskLevel} risk</Badge><p className="cw-muted">Current hazard score out of 10</p></div></div><h2 style={{ marginTop: 26 }}>Why this score?</h2><ScoreExplanation siteId={site.id} liveMode={liveMode} />{site.hazards.map((factor, index) => <div className="cw-factor" key={`${factor.label}-${index}`}><div><p className="cw-factor-label">{factor.label}</p><p className="cw-factor-meta">{factor.source} · Observed {factor.observedAt}</p></div><div className="cw-factor-value"><div>{factor.value}</div><Badge tone={riskTone(factor.severity)}>{factor.severity}</Badge></div></div>)}</Card>
      <Card className="cw-panel" style={{ marginTop: 20 }}><h2>Forecast drift</h2>{siteDetail.forecast.length ? <div className="cw-forecast">{siteDetail.forecast.map((point) => <div className="cw-forecast-point" key={point.time}><div className="cw-forecast-bar" style={{ height: `${Math.max(18, point.score * 10)}%` }}><span>{point.score.toFixed(1)}</span></div><strong>{point.time}</strong><small>{point.label}</small><p>{point.condition}</p></div>)}</div> : <p className="cw-muted">Forecast unavailable. This does not indicate safe conditions.</p>}</Card>
      <Card className="cw-panel" style={{ marginTop: 20 }}><h2>Latest safety briefing</h2>{liveMode ? <BriefingCard siteId={site.id} compact /> : siteDetail.briefing ? <><p style={{ lineHeight: 1.55 }}>{siteDetail.briefing.summary}</p><p className="cw-muted"><strong>Recommended work window:</strong> {siteDetail.briefing.recommendedWorkWindow}</p><p className="cw-muted">Generated {siteDetail.briefing.generatedAt}</p></> : <p className="cw-muted">No briefing is available for this site.</p>}</Card>
      <Card className="cw-panel" style={{ marginTop: 20 }}><h2>Recent crew reports</h2>{siteDetail.reports.length ? siteDetail.reports.map((report) => <div className="cw-factor" key={report.id}><div><p className="cw-factor-label">{report.hazardType} · {report.author}</p><p className="cw-factor-meta">{report.description} · {report.createdAt}</p></div><Badge tone={riskTone(report.severity)}>{report.status}</Badge></div>) : <p className="cw-muted">No recent crew reports.</p>}</Card>
    </div><div>
      <Card className="cw-panel"><h2>Data freshness</h2><Badge tone={site.dataFreshness === 'Fresh' ? 'success' : 'warning'}>{site.dataFreshness}</Badge><p className="cw-muted" style={{ lineHeight: 1.5 }}>The score is fresh for one hour after calculation. Weather timestamps appear with each model factor. Missing or stale data does not indicate safe conditions.</p></Card>
      <Card className="cw-panel" style={{ marginTop: 20 }}><h2>Safety record</h2><p className="cw-muted">Verification history is available from the Safety Ledger / Verify section.</p><Link to="/app/supervisor/verify" className="cw-button cw-button-secondary">View verification history</Link></Card>
    </div></div>
  </div>;
}
const FALLBACK_EXPLANATION = 'These are the leading contributors to the hazard score. Review their source and timestamp before making an operational decision.';

function ScoreExplanation({ siteId, liveMode }: { siteId: string; liveMode: boolean }) {
  const { getAccessToken, isMockAuth } = useAuth();
  const [score, setScore] = useState<SiteScore | null>(null);
  useEffect(() => {
    if (!liveMode || isMockAuth) return;
    let stopped = false;
    void live.siteScore(siteId, getAccessToken).then((result) => { if (!stopped) setScore(result); }).catch(() => { if (!stopped) setScore(null); });
    return () => { stopped = true; };
  }, [getAccessToken, isMockAuth, liveMode, siteId]);
  if (!score?.explanation) return <p style={{ lineHeight: 1.6, marginBottom: 22 }}>{FALLBACK_EXPLANATION}</p>;
  return <div className="cw-ai-note">
    <p className="cw-eyebrow" style={{ margin: 0 }}>AI explanation · Gemini</p>
    <p className="cw-ai-note-text">{score.explanation}</p>
    <p className="cw-factor-meta">Gemini only rephrases the model's score and its top factors below; a validator rejects any number or hazard that is not in them.</p>
  </div>;
}

const HAZARD_NAMES: Record<Lang, Record<HazardKey, string>> = {
  en: { lightning: 'Lightning', heat: 'Heat', storm: 'Wind and storms', flood: 'Flooding', soil_saturation: 'Soil saturation', wildfire: 'Wildfire', wildlife: 'Wildlife' },
  es: { lightning: 'Rayos', heat: 'Calor', storm: 'Vientos fuertes', flood: 'Inundación', soil_saturation: 'Suelo saturado', wildfire: 'Incendio forestal', wildlife: 'Fauna silvestre' },
};
const LEVEL_NAMES: Record<Lang, Record<string, string>> = {
  en: { low: 'Low', moderate: 'Moderate', high: 'High', extreme: 'Extreme' },
  es: { low: 'Bajo', moderate: 'Moderado', high: 'Alto', extreme: 'Extremo' },
};
const BRIEFING_TEXT = {
  en: { day: 'Briefing for', window: 'Best work window', noWindow: 'No clear low-risk work window tomorrow.', forecast: 'Forecast score', risk: 'risk', generated: 'Generated', checked: 'Passed grounding checks', template: 'Plain template (AI text did not pass the checks)', sources: 'Sources', missing: 'Unavailable data', none: 'No hazards at moderate level or above are forecast for tomorrow.' },
  es: { day: 'Informe para el', window: 'Mejor horario de trabajo', noWindow: 'No hay un horario claro de bajo riesgo mañana.', forecast: 'Puntuación pronosticada', risk: 'riesgo', generated: 'Generado', checked: 'Verificado con los datos', template: 'Plantilla (el texto de IA no pasó la verificación)', sources: 'Fuentes', missing: 'Datos no disponibles', none: 'No se pronostican peligros de nivel moderado o superior para mañana.' },
};
const levelTone = (level: string | null | undefined) => level === 'extreme' || level === 'high' ? 'danger' : level === 'moderate' ? 'warning' : 'success';
const readLang = (): Lang => { try { return localStorage.getItem('cypresswatch-briefing-lang') === 'es' ? 'es' : 'en'; } catch { return 'en'; } };

function LanguageToggle({ lang, onChange }: { lang: Lang; onChange: (lang: Lang) => void }) {
  return <div className="cw-lang-toggle" role="group" aria-label="Briefing language">
    <button type="button" aria-pressed={lang === 'en'} onClick={() => onChange('en')}>English</button>
    <button type="button" aria-pressed={lang === 'es'} onClick={() => onChange('es')}>Español</button>
  </div>;
}

function BriefingCard({ siteId, compact = false }: { siteId: string; compact?: boolean }) {
  const { getAccessToken, isMockAuth } = useAuth();
  const [lang, setLang] = useState<Lang>(readLang);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const changeLang = (next: Lang) => { setLang(next); try { localStorage.setItem('cypresswatch-briefing-lang', next); } catch { /* per-viewer convenience only */ } };
  useEffect(() => {
    if (isMockAuth) { setError('Demo sign-in has no API access token. Sign in with Auth0 to see live briefings.'); return; }
    let stopped = false;
    setBriefing(null);
    setError(null);
    void live.briefing(siteId, lang, getAccessToken)
      .then((result) => { if (!stopped) setBriefing(result); })
      .catch((err: Error & { status?: number }) => { if (!stopped) setError(err.status === 404 ? 'No briefing has been generated for this site yet. Briefings are written at 6 PM site time.' : err.message); });
    return () => { stopped = true; };
  }, [getAccessToken, isMockAuth, lang, siteId]);
  const t = BRIEFING_TEXT[lang];
  const day = briefing ? new Date(`${briefing.for_date}T12:00:00Z`).toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '';
  return <div className="cw-briefing" lang={lang}>
    <div className="cw-briefing-top">
      <p className="cw-eyebrow" style={{ margin: 0 }}>{briefing ? `${t.day} ${day}` : 'Gemini briefing'}</p>
      <LanguageToggle lang={lang} onChange={changeLang} />
    </div>
    {error && <p className="cw-muted">{error}</p>}
    {!briefing && !error && <p className="cw-muted">{lang === 'es' ? 'Cargando informe…' : 'Loading briefing…'}</p>}
    {briefing && <>
      <p className="cw-briefing-headline">{briefing.headline}</p>
      <div className="cw-briefing-meta">
        {briefing.risk_level && <Badge tone={levelTone(briefing.risk_level)}>{lang === 'es' ? `${t.risk} ${LEVEL_NAMES.es[briefing.risk_level].toLowerCase()}` : `${LEVEL_NAMES.en[briefing.risk_level]} ${t.risk}`}</Badge>}
        {briefing.hazard_score_forecast !== null && <span className="cw-muted">{t.forecast}: <strong>{briefing.hazard_score_forecast.toFixed(1)}</strong> / 10</span>}
        <Badge tone={briefing.validated ? 'success' : 'neutral'}>{briefing.validated ? t.checked : t.template}</Badge>
      </div>
      <div className="cw-briefing-window">
        <p className="cw-factor-label" style={{ margin: 0 }}>{t.window}</p>
        {briefing.best_work_window ? <><p className="cw-briefing-window-time">{briefing.best_work_window.start_local} – {briefing.best_work_window.end_local}</p><p className="cw-factor-meta">{briefing.best_work_window.reason}</p></> : <p className="cw-factor-meta">{t.noWindow}</p>}
      </div>
      {briefing.items.length ? briefing.items.map((item) => <div className="cw-factor" key={item.hazard}>
        <div><p className="cw-factor-label">{HAZARD_NAMES[lang][item.hazard] ?? item.hazard}</p><p className="cw-briefing-item-text">{item.text}</p></div>
        <Badge tone={levelTone(item.level)}>{LEVEL_NAMES[lang][item.level] ?? item.level}</Badge>
      </div>) : <p className="cw-muted">{t.none}</p>}
      {!compact && <>
        {briefing.missing_data.length > 0 && <p className="cw-factor-meta" style={{ marginTop: 12 }}>{t.missing}: {briefing.missing_data.join(', ')}</p>}
        <details className="cw-briefing-sources"><summary>{t.sources} ({briefing.sources.length})</summary><ul>{briefing.sources.map((src) => <li key={src.id}><code>{src.id}</code> {src.description} · {src.source}{src.observed_at ? ` · ${src.observed_at.replace('T', ' ').slice(0, 16)} UTC` : ''}</li>)}</ul></details>
      </>}
      <p className="cw-factor-meta" style={{ marginTop: 12 }}>{t.generated} {briefing.generated_at.replace('T', ' ').slice(0, 16)} UTC · {briefing.disclaimer}</p>
    </>}
  </div>;
}

function BriefingsPage() {
  const { sitesLive, liveError } = useLiveSites();
  const [siteId, setSiteId] = useState<string | null>(null);
  const sites = sitesLive ?? [];
  const selected = siteId ?? sites[0]?.id ?? null;
  return <div>
    <PageHeader eyebrow="Gemini briefings" title="Next-day safety briefings" description="Written every evening at 6 PM site time in English and Spanish. Code computes every fact from the forecast and the hazard model; Gemini only writes them up, and a validator checks levels, numbers, sources and language before crews see it." />
    {!sitesLive && <Card><p style={{ margin: 0 }} className="cw-muted">{liveError ?? 'Loading your sites…'}</p></Card>}
    {sitesLive && <>
      <div className="cw-filter-bar">
        <select className="cw-select" aria-label="Choose a site" value={selected ?? ''} onChange={(event) => setSiteId(event.target.value)}>
          {[...sites].sort((a, b) => b.riskScore - a.riskScore).map((site) => <option key={site.id} value={site.id}>{site.name} · {site.riskScore.toFixed(1)} {site.riskLevel}</option>)}
        </select>
        {selected && <Link className="cw-button cw-button-secondary" to={`/app/supervisor/sites/${selected}`}>Open site</Link>}
      </div>
      {selected && <Card className="cw-panel"><BriefingCard key={selected} siteId={selected} /></Card>}
    </>}
  </div>;
}

function Placeholder({ title, description }: { title: string; description: string }) { return <><PageHeader eyebrow="Placeholder destination" title={title} description={description} /><Card><div style={{ padding: 24 }}><p style={{ margin: 0, color: 'var(--cw-muted)' }}>This route is available for navigation and will be built in a later slice.</p></div></Card></>; }

function CrewAppHandoff() { return <><PageHeader eyebrow="Crew workspace" title="Open the crew app" description="The crew experience runs in a separate DeepSpace app." /><Card><div style={{ padding: 24 }}><p>Use the crew app for your site status, briefings, and hazard reports. It has its own sign-in; your Auth0 session here will not sign you in there.</p><a className="cw-button cw-button-primary" href={crewAppUrl}>Open crew app</a></div></Card></>; }

function VerifyPage() {
  const { getAccessToken } = useAuth();
  const [records, setRecords] = useState<Record<string, Awaited<ReturnType<typeof live.verify>>> | null>(null);
  const [list, setList] = useState<Awaited<ReturnType<typeof live.ledgerRecords>>['records'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    void live.ledgerRecords(getAccessToken).then((data) => setList(data.records)).catch((err: Error) => setError(err.message));
  }, [getAccessToken]);
  const check = (recordId: string) => {
    setBusy(recordId);
    void live.verify(recordId, getAccessToken).then((result) => setRecords((prev) => ({ ...(prev ?? {}), [recordId]: result })))
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(null));
  };
  return <div>
    <PageHeader eyebrow="Safety ledger" title="Verify records" description="Every safety decision is hashed into a Merkle tree and the root is written to Solana devnet. Verify recomputes the proof and compares it with the chain." />
    {error && <Card><p style={{ margin: 0, color: '#8b332c' }}>Live ledger unavailable: {error}</p></Card>}
    <Card>
      <div className="cw-section-heading"><h2>Recent records</h2><span className="cw-muted">{list?.length ?? '…'} most recent</span></div>
      <div id="cw-verify-list" className="cw-verify-list">
        {!list && !error && <p className="cw-muted">Loading records…</p>}
        {list?.map((record) => {
          const result = records?.[record.record_id];
          return <div key={record.record_id} className="cw-factor">
            <div>
              <p className="cw-factor-label">{record.record_id} · {record.record_type} · {record.site_id}</p>
              <p className="cw-factor-meta">{record.created_at} · {record.anchored ? `root ${record.merkle_root?.slice(0, 16)}…` : 'waiting for the next hourly anchor'}</p>
              {result && <p className="cw-factor-meta" style={{ color: result.verified ? '#1a7f37' : '#8b332c' }}>{result.message}{result.explorer_url && <> · <a href={result.explorer_url} target="_blank" rel="noreferrer">explorer</a></>}</p>}
            </div>
            <Button variant="secondary" disabled={busy === record.record_id} onClick={() => check(record.record_id)}>{busy === record.record_id ? 'Verifying…' : 'Verify'}</Button>
          </div>;
        })}
        {list?.length === 0 && <p className="cw-muted">No ledger records yet — they appear once the engine emits safety events and the scheduler anchors them.</p>}
      </div>
    </Card>
  </div>;
}
const HAZARD_LABELS: Record<HazardKey, string> = { lightning: 'Lightning', heat: 'Heat', storm: 'Storm', flood: 'Flood', soil_saturation: 'Soil saturation', wildfire: 'Wildfire', wildlife: 'Wildlife' };
const severityTone = (severity: Severity | null | undefined) => severity === 'high' ? 'danger' : severity === 'medium' ? 'warning' : 'info';
const statusLabels: Record<ReportStatus, string> = { pending_review: 'Needs review', confirmed: 'Confirmed', dismissed: 'Dismissed' };

function ReportCard({ report, siteName, onDecided }: { report: CrewReport; siteName: string; onDecided: (report: CrewReport) => void }) {
  const { getAccessToken } = useAuth();
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    void live.photoObjectUrl(report, getAccessToken).then((objectUrl) => { url = objectUrl; setPhotoUrl(objectUrl); }).catch(() => setPhotoUrl(null));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [getAccessToken, report]);
  const [hazard, setHazard] = useState<HazardKey | ''>(report.confirmed_hazard ?? report.triage?.hazard ?? '');
  const [severity, setSeverity] = useState<Severity>(report.confirmed_severity ?? report.triage?.severity ?? 'medium');
  const [busy, setBusy] = useState<'confirmed' | 'dismissed' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = report.status === 'pending_review';
  const decide = (status: 'confirmed' | 'dismissed') => {
    setBusy(status);
    setError(null);
    void live.confirmReport(report.report_id, getAccessToken, status === 'confirmed'
      ? { status, confirmed_hazard: hazard || null, confirmed_severity: severity }
      : { status, confirmed_hazard: null, confirmed_severity: null })
      .then(onDecided)
      .catch((err: Error) => setError(`Could not save the decision (${err.message}).`))
      .finally(() => setBusy(null));
  };
  return <Card className="cw-report">
    <a className="cw-report-photo" href={photoUrl ?? undefined} target="_blank" rel="noreferrer">{photoUrl ? <img src={photoUrl} alt={`Crew photo from ${siteName}${report.note ? `: ${report.note}` : ''}`} /> : <span className="cw-report-photo-empty">Loading photo…</span>}</a>
    <div className="cw-report-body">
      <div className="cw-section-heading" style={{ marginBottom: 6 }}><h2>{siteName}</h2><Badge tone={pending ? 'warning' : report.status === 'confirmed' ? 'success' : 'neutral'}>{statusLabels[report.status]}</Badge></div>
      <p className="cw-factor-meta">{report.reported_by?.name ?? 'Crew'} · captured {report.captured_at.replace('T', ' ').slice(0, 16)} UTC · {report.report_id}</p>
      {report.note && <p className="cw-report-note">“{report.note}”</p>}
      <div className="cw-report-triage">
        <p className="cw-eyebrow" style={{ margin: 0 }}>AI triage · {report.triage?.model ?? 'unavailable'}</p>
        {report.triage ? <>
          <p style={{ margin: '6px 0' }}><strong>{HAZARD_LABELS[report.triage.hazard]}</strong> <Badge tone={severityTone(report.triage.severity)}>{report.triage.severity}</Badge> <span className="cw-muted">{Math.round(report.triage.confidence * 100)}% confidence</span></p>
          <p className="cw-factor-meta" style={{ fontSize: 13 }}>{report.triage.description}</p>
        </> : <p className="cw-factor-meta" style={{ fontSize: 13 }}>No hazard detected by AI. Review the photo and choose a hazard before confirming.</p>}
      </div>
      {pending ? <>
        <div className="cw-report-controls">
          <select className="cw-select" aria-label="Confirmed hazard" value={hazard} onChange={(event) => setHazard(event.target.value as HazardKey)}>
            <option value="" disabled>Choose hazard</option>
            {(Object.keys(HAZARD_LABELS) as HazardKey[]).map((key) => <option key={key} value={key}>{HAZARD_LABELS[key]}</option>)}
          </select>
          <select className="cw-select" aria-label="Confirmed severity" value={severity} onChange={(event) => setSeverity(event.target.value as Severity)}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
          </select>
          <Button onClick={() => decide('confirmed')} disabled={busy !== null || !hazard}>{busy === 'confirmed' ? 'Confirming…' : 'Confirm'}</Button>
          <Button variant="quiet" onClick={() => decide('dismissed')} disabled={busy !== null}>{busy === 'dismissed' ? 'Dismissing…' : 'Dismiss'}</Button>
        </div>
        <p className="cw-factor-meta">Your decision, the AI result and the photo fingerprint are written to the Safety Ledger on Solana.</p>
      </> : <p className="cw-factor-meta" style={{ marginTop: 10 }}>
        {report.status === 'confirmed' && <>Confirmed as <strong>{report.confirmed_hazard ? HAZARD_LABELS[report.confirmed_hazard] : 'unspecified'}</strong> · {report.confirmed_severity} severity. </>}
        {report.ledger_record_id ? <>Ledger record <Link to="/app/supervisor/verify">{report.ledger_record_id}</Link></> : 'No ledger record.'}
      </p>}
      {error && <p className="cw-factor-meta" role="alert" style={{ color: '#8b332c' }}>{error}</p>}
    </div>
  </Card>;
}

function ReportsPage() {
  const [status, setStatus] = useState<ReportStatus | 'all'>('pending_review');
  const [reports, setReports] = useState<CrewReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { getAccessToken, isMockAuth } = useAuth();
  const { sitesLive } = useLiveSites();
  const siteNames = Object.fromEntries((sitesLive ?? demoSites).map((site) => [site.id, site.name]));
  useEffect(() => {
    if (isMockAuth) {
      setReports(null);
      setError('Demo sign-in has no API access token. Sign in with Auth0 to review live crew reports.');
      return;
    }
    let stopped = false;
    const refresh = () => live.reports(getAccessToken, status)
      .then((data) => { if (!stopped) { setReports(data.reports); setError(null); } })
      .catch((err: Error) => { if (!stopped) setError(err.message); });
    setReports(null);
    void refresh();
    const polling = window.setInterval(() => { void refresh(); }, 15_000);
    const socket = live.openEvents(getAccessToken, (event) => { if (event.type.startsWith('report_')) void refresh(); });
    return () => { stopped = true; window.clearInterval(polling); socket.close(); };
  }, [getAccessToken, isMockAuth, status]);
  const decided = (updated: CrewReport) => setReports((prev) => (prev ?? [])
    .map((report) => report.report_id === updated.report_id ? updated : report)
    .filter((report) => status === 'all' || report.status === status || report.report_id === updated.report_id));
  const tabs: { key: ReportStatus | 'all'; label: string }[] = [{ key: 'pending_review', label: 'Needs review' }, { key: 'confirmed', label: 'Confirmed' }, { key: 'dismissed', label: 'Dismissed' }, { key: 'all', label: 'All' }];
  return <div>
    <PageHeader eyebrow="Crew reports" title="Review hazard reports" description="Crew photos are triaged by Gemini in seconds. A supervisor confirms or dismisses each one, and the decision is recorded on the Safety Ledger." />
    <div className="cw-filter-bar" role="tablist" aria-label="Report status">
      {tabs.map((tab) => <Button key={tab.key} role="tab" aria-selected={status === tab.key} variant={status === tab.key ? 'primary' : 'secondary'} onClick={() => setStatus(tab.key)}>{tab.label}</Button>)}
    </div>
    {error && <Card><p style={{ margin: 0, color: '#8b332c' }}>Live reports unavailable: {error}</p></Card>}
    {!reports && !error && <p className="cw-muted">Loading reports…</p>}
    {reports?.length === 0 && <Card><div style={{ padding: 8 }}><p style={{ margin: 0 }}>{status === 'pending_review' ? 'No reports waiting for review.' : 'No reports in this list.'}</p><p className="cw-muted" style={{ marginBottom: 0 }}>New crew reports appear here automatically.</p></div></Card>}
    <div className="cw-report-list">{reports?.map((report) => <ReportCard key={`${report.report_id}-${report.status}`} report={report} siteName={siteNames[report.site_id] ?? report.site_id} onDecided={decided} />)}</div>
  </div>;
}

function Login() { const { login, isMockAuth, isAuthenticated } = useAuth(); const navigate = useNavigate(); useEffect(() => { if (isAuthenticated) navigate('/app', { replace: true }); }, [isAuthenticated, navigate]); return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--cw-subtle)' }}><Card><div style={{ width: 'min(440px, 80vw)', padding: 32 }}><p className="cw-eyebrow">CypressWatch</p><h1 style={{ margin: '0 0 10px' }}>Sign in to safety operations</h1><p style={{ color: 'var(--cw-muted)', lineHeight: 1.5 }}>{isMockAuth ? 'Auth0 is not configured, so local demo authentication is active.' : 'Sign in with your CypressWatch Auth0 account.'}</p><Button onClick={() => { login(); if (isMockAuth) navigate('/app'); }}>{isMockAuth ? 'Continue as supervisor demo' : 'Continue with Auth0'}</Button><p style={{ margin: '18px 0 0', color: 'var(--cw-muted)', fontSize: 12 }}>{isMockAuth ? 'Demo mode · supervisor@example.com' : 'Production authentication · Auth0'}</p><p style={{ margin: '18px 0 0', fontSize: 13 }}>Crew member? <a href={crewAppUrl}>Open the separate crew app</a>.</p></div></Card></div>; }
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
    <Route element={<RequireRole role="supervisor" />}><Route path="supervisor" element={<SupervisorHome />} /><Route path="supervisor/sites" element={<SupervisorHome />} /><Route path="supervisor/sites/:siteId" element={<SiteDetail />} /><Route path="supervisor/reports" element={<ReportsPage />} /><Route path="supervisor/briefings" element={<BriefingsPage />} /><Route path="supervisor/verify" element={<VerifyPage />} /></Route>
    <Route element={<RequireRole role="crew" />}><Route path="crew" element={<CrewAppHandoff />} /><Route path="crew/site" element={<Navigate to="/app/crew" replace />} /><Route path="crew/report" element={<Navigate to="/app/crew" replace />} /></Route>
    <Route element={<RequireRole role="owner" />}><Route path="owner" element={<Placeholder title="Sites" description="Read-only site visibility for project owners." />} /><Route path="owner/sites/:siteId/history" element={<Placeholder title="Safety history" description="Read-only history for a selected site." />} /><Route path="owner/verify" element={<Placeholder title="Verify records" description="Read-only verification records." />} /></Route>
  </Route></Route>
  <Route path="*" element={<Navigate to="/app" replace />} />
</Routes></AuthProvider></BrowserRouter></StrictMode>);
