import { CloudLightning, CloudRain, Droplets, Flame, PawPrint, ThermometerSun, Waves, type LucideIcon } from 'lucide-react'
import type { HazardKey, RiskLevel } from '../contracts/types'

export const HAZARDS: Record<HazardKey, { label: string; Icon: LucideIcon }> = {
  lightning: { label: 'Lightning', Icon: CloudLightning },
  heat: { label: 'Heat', Icon: ThermometerSun },
  storm: { label: 'Storm', Icon: CloudRain },
  flood: { label: 'Flooding', Icon: Waves },
  soil_saturation: { label: 'Wet ground', Icon: Droplets },
  wildfire: { label: 'Wildfire', Icon: Flame },
  wildlife: { label: 'Wildlife', Icon: PawPrint },
}
export const HAZARD_KEYS = Object.keys(HAZARDS) as HazardKey[]

/** Level is always shown as a word and an icon too; color is only a hint. */
export const LEVELS: Record<RiskLevel, { label: string; cls: string }> = {
  low: { label: 'Low', cls: 'bg-success-soft border-success/40 text-success' },
  moderate: { label: 'Moderate', cls: 'bg-caution border-[#9a6700]/50 text-[#7a5200]' },
  high: { label: 'High', cls: 'bg-danger-soft border-destructive/50 text-destructive' },
  extreme: { label: 'Extreme', cls: 'bg-destructive border-[#721c16] text-white' },
}
