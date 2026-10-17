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
  low: { label: 'Low', cls: 'bg-[#d6efdf] border-[#14663a] text-[#0f1b14]' },
  moderate: { label: 'Moderate', cls: 'bg-[#fff0c2] border-[#8a5a00] text-[#0f1b14]' },
  high: { label: 'High', cls: 'bg-[#ffd9b8] border-[#a24100] text-[#0f1b14]' },
  extreme: { label: 'Extreme', cls: 'bg-[#c0152a] border-[#7a0c1b] text-white' },
}
