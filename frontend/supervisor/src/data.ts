export type RiskLevel = 'Low' | 'Guarded' | 'Elevated' | 'High' | 'Critical';
export type HazardType = 'Lightning' | 'Heat' | 'Flooding' | 'Wildfire' | 'Soil saturation';
export type SiteLandscape = 'woodland' | 'river' | 'wetland' | 'scrub';

export type HazardFactor = {
  type: HazardType;
  label: string;
  value: string;
  severity: RiskLevel;
  source: string;
  observedAt: string;
  contribution: number;
};

export type StopWorkEvent = {
  reason: string;
  startedAt: string;
  allClearAt: string;
  status: 'active' | 'expired';
  lastStrikeAt: string;
};

export type Site = {
  id: string;
  name: string;
  location: string;
  latitude: number;
  longitude: number;
  landscape: SiteLandscape;
  riskScore: number;
  riskLevel: RiskLevel;
  primaryHazards: HazardType[];
  activeAlert?: StopWorkEvent;
  lastUpdated: string;
  dataFreshness: 'Fresh' | 'Stale' | 'Unavailable';
  hazards: HazardFactor[];
};

export type ForecastPoint = { time: string; label: string; score: number; condition: string };
export type CrewReport = { id: string; author: string; hazardType: HazardType; severity: RiskLevel; description: string; createdAt: string; status: 'Synced' | 'Pending sync' };
export type Briefing = { summary: string; recommendedWorkWindow: string; generatedAt: string };

export const siteDetailData: Record<string, { forecast: ForecastPoint[]; briefing: Briefing; reports: CrewReport[] }> = {
  'site-01': {
    forecast: [{ time: 'Now', label: '10:45', score: 8.7, condition: 'Lightning within 10 miles' }, { time: '+1 hr', label: '11:45', score: 7.8, condition: 'Storm cell moving east' }, { time: '+2 hr', label: '12:45', score: 5.9, condition: 'Heat remains elevated' }, { time: '+4 hr', label: '2:45', score: 4.6, condition: 'Storm risk easing' }],
    briefing: { summary: 'Pause exposed work during the active lightning stop-work. Reassess heat and saturated soil before reopening elevated work.', recommendedWorkWindow: 'After 2:00 PM, subject to a fresh lightning check', generatedAt: 'Today, 8:15 AM' },
    reports: [{ id: 'report-01', author: 'A. Patel', hazardType: 'Soil saturation', severity: 'Elevated', description: 'Access road is soft near the east inverter row.', createdAt: '9:52 AM', status: 'Synced' }],
  },
};

export const sites: Site[] = [
  { id: 'site-01', name: 'Cypress North', location: 'Alachua County, FL', latitude: 29.72, longitude: -82.4, landscape: 'wetland', riskScore: 8.7, riskLevel: 'High', primaryHazards: ['Lightning', 'Heat', 'Soil saturation'], lastUpdated: '2 min ago', dataFreshness: 'Fresh', hazards: [{ type: 'Lightning', label: 'Lightning proximity', value: '8.4 mi', severity: 'High', source: 'National Weather Service', observedAt: '10:42 AM', contribution: 3.8 }, { type: 'Heat', label: 'Heat index', value: '104°F', severity: 'Elevated', source: 'NOAA weather station', observedAt: '10:40 AM', contribution: 2.7 }, { type: 'Soil saturation', label: 'Soil saturation', value: '86%', severity: 'Elevated', source: 'On-site sensor', observedAt: '10:39 AM', contribution: 2.2 }], activeAlert: { reason: 'Lightning within 10 miles', startedAt: '10:30 AM', allClearAt: '11:00 AM', status: 'active', lastStrikeAt: '10:30 AM' } },
  { id: 'site-02', name: 'Cypress East', location: 'Putnam County, FL', latitude: 29.65, longitude: -81.9, landscape: 'river', riskScore: 6.4, riskLevel: 'Elevated', primaryHazards: ['Heat', 'Flooding'], lastUpdated: '4 min ago', dataFreshness: 'Fresh', hazards: [{ type: 'Heat', label: 'Heat index', value: '101°F', severity: 'Elevated', source: 'NOAA weather station', observedAt: '10:38 AM', contribution: 3.4 }, { type: 'Flooding', label: 'Standing water risk', value: 'Moderate', severity: 'Guarded', source: 'Hydrology model', observedAt: '10:35 AM', contribution: 3.0 }] },
  { id: 'site-03', name: 'Palmetto Solar Field', location: 'Baker County, FL', latitude: 30.3, longitude: -82.2, landscape: 'scrub', riskScore: 5.1, riskLevel: 'Elevated', primaryHazards: ['Wildfire', 'Heat'], lastUpdated: '7 min ago', dataFreshness: 'Fresh', hazards: [{ type: 'Wildfire', label: 'Fire weather index', value: 'Moderate', severity: 'Elevated', source: 'Florida Forestry Service', observedAt: '10:35 AM', contribution: 2.9 }, { type: 'Heat', label: 'Heat index', value: '98°F', severity: 'Guarded', source: 'NOAA weather station', observedAt: '10:33 AM', contribution: 2.2 }] },
  { id: 'site-04', name: 'Oak Hammock', location: 'Marion County, FL', latitude: 29.1, longitude: -82.0, landscape: 'wetland', riskScore: 3.8, riskLevel: 'Guarded', primaryHazards: ['Soil saturation'], lastUpdated: '12 min ago', dataFreshness: 'Stale', hazards: [{ type: 'Soil saturation', label: 'Soil saturation', value: '68%', severity: 'Guarded', source: 'On-site sensor', observedAt: '9:58 AM', contribution: 3.8 }] },
  { id: 'site-05', name: 'Sandhill Array', location: 'Duval County, FL', latitude: 30.4, longitude: -81.7, landscape: 'scrub', riskScore: 2.1, riskLevel: 'Low', primaryHazards: ['Heat'], lastUpdated: '3 min ago', dataFreshness: 'Fresh', hazards: [{ type: 'Heat', label: 'Heat index', value: '91°F', severity: 'Low', source: 'NOAA weather station', observedAt: '10:41 AM', contribution: 2.1 }] },
  { id: 'site-06', name: 'Riverbend Storage', location: 'Clay County, FL', latitude: 29.9, longitude: -81.8, landscape: 'river', riskScore: 1.4, riskLevel: 'Low', primaryHazards: [], lastUpdated: '5 min ago', dataFreshness: 'Fresh', hazards: [] },
  { id: 'site-07', name: 'Suwannee Crossing', location: 'Suwannee County, FL', latitude: 30.36, longitude: -83.17, landscape: 'river', riskScore: 5.8, riskLevel: 'Elevated', primaryHazards: ['Flooding', 'Lightning'], lastUpdated: '6 min ago', dataFreshness: 'Fresh', hazards: [{ type: 'Flooding', label: 'River level watch', value: 'Elevated', severity: 'Elevated', source: 'Demo hydrology feed', observedAt: '10:36 AM', contribution: 3.1 }, { type: 'Lightning', label: 'Lightning proximity', value: '12.2 mi', severity: 'Guarded', source: 'Demo weather feed', observedAt: '10:37 AM', contribution: 2.7 }] },
  { id: 'site-08', name: 'Indian River Station', location: 'Brevard County, FL', latitude: 28.37, longitude: -80.72, landscape: 'river', riskScore: 4.9, riskLevel: 'Guarded', primaryHazards: ['Heat', 'Flooding'], lastUpdated: '8 min ago', dataFreshness: 'Fresh', hazards: [{ type: 'Heat', label: 'Heat index', value: '96°F', severity: 'Guarded', source: 'Demo weather feed', observedAt: '10:31 AM', contribution: 2.6 }, { type: 'Flooding', label: 'Coastal water watch', value: 'Guarded', severity: 'Guarded', source: 'Demo hydrology feed', observedAt: '10:29 AM', contribution: 2.3 }] },
  { id: 'site-09', name: 'Prairie Ridge Site', location: 'Highlands County, FL', latitude: 27.5, longitude: -81.4, landscape: 'scrub', riskScore: 3.2, riskLevel: 'Guarded', primaryHazards: ['Heat'], lastUpdated: '9 min ago', dataFreshness: 'Fresh', hazards: [{ type: 'Heat', label: 'Heat index', value: '95°F', severity: 'Guarded', source: 'Demo weather feed', observedAt: '10:27 AM', contribution: 3.2 }] },
  { id: 'site-10', name: 'Pine Flats Solar', location: 'Polk County, FL', latitude: 28.0, longitude: -81.9, landscape: 'woodland', riskScore: 2.7, riskLevel: 'Low', primaryHazards: ['Heat'], lastUpdated: '11 min ago', dataFreshness: 'Fresh', hazards: [{ type: 'Heat', label: 'Heat index', value: '89°F', severity: 'Low', source: 'Demo weather feed', observedAt: '10:25 AM', contribution: 2.7 }] },
];

export function riskTone(level: RiskLevel): 'success' | 'warning' | 'danger' | 'info' {
  if (level === 'Low') return 'success';
  if (level === 'Guarded' || level === 'Elevated') return 'warning';
  return 'danger';
}
