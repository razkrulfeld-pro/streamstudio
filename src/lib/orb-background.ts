import type { BubbleRect } from '@/lib/recording-layout'
import type { OrbPreset } from '@/types/recording-layout'

export type { OrbPreset } from '@/types/recording-layout'

export const ORB_PRESET_ORDER: OrbPreset[] = [
  'brand',
  'aurora',
  'sunset',
  'ocean',
  'bloom',
  'midnight',
  'citrus',
  'frost',
]

export const ORB_PRESET_LABELS: Record<OrbPreset, string> = {
  brand: 'Brand',
  aurora: 'Aurora',
  sunset: 'Sunset',
  ocean: 'Ocean',
  bloom: 'Bloom',
  midnight: 'Midnight',
  citrus: 'Citrus',
  frost: 'Frost',
}

const MOTION_SCALE = 1.62

interface OrbSpec {
  anchorX: number
  anchorY: number
  radius: number
  color: string
  driftX: number
  driftY: number
  speed: number
  phase: number
  driftRateX?: number
  driftRateY?: number
  pulseRate?: number
  coreAlpha?: number
  midAlpha?: number
}

interface OrbPresetConfig {
  baseColor: string
  motionScale?: number
  orbs: OrbSpec[]
}

function rgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '')
  const value = Number.parseInt(normalized, 16)
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const ORB_PRESETS: Record<OrbPreset, OrbPresetConfig> = {
  brand: {
    baseColor: '#f8f9fb',
    orbs: [
      { anchorX: 0.12, anchorY: 0.88, radius: 0.78, color: '#5b3dea', driftX: 0.11, driftY: 0.07, speed: 0.00072, phase: 0, coreAlpha: 0.58 },
      { anchorX: 0.88, anchorY: 0.14, radius: 0.66, color: '#9461fa', driftX: 0.1, driftY: 0.12, speed: 0.00055, phase: 1.7, coreAlpha: 0.52 },
      { anchorX: 0.52, anchorY: 0.52, radius: 0.54, color: '#6d5ef8', driftX: 0.09, driftY: 0.1, speed: 0.00063, phase: 3.1 },
    ],
  },
  aurora: {
    baseColor: '#07121f',
    motionScale: 1.12,
    orbs: [
      { anchorX: 0.18, anchorY: 0.76, radius: 0.82, color: '#2dd4bf', driftX: 0.13, driftY: 0.09, speed: 0.00068, phase: 0.4, driftRateY: 1.15, coreAlpha: 0.56 },
      { anchorX: 0.8, anchorY: 0.24, radius: 0.7, color: '#b794f6', driftX: 0.11, driftY: 0.13, speed: 0.00058, phase: 2.1, coreAlpha: 0.54 },
      { anchorX: 0.46, anchorY: 0.4, radius: 0.58, color: '#34d399', driftX: 0.12, driftY: 0.08, speed: 0.00074, phase: 4.3, pulseRate: 1.28 },
      { anchorX: 0.64, anchorY: 0.84, radius: 0.46, color: '#38bdf8', driftX: 0.08, driftY: 0.11, speed: 0.0008, phase: 5.6, coreAlpha: 0.48 },
    ],
  },
  sunset: {
    baseColor: '#fff7ed',
    orbs: [
      { anchorX: 0.1, anchorY: 0.82, radius: 0.76, color: '#ff7b1a', driftX: 0.12, driftY: 0.08, speed: 0.0007, phase: 0.2, coreAlpha: 0.6 },
      { anchorX: 0.84, anchorY: 0.18, radius: 0.68, color: '#ff5a7a', driftX: 0.1, driftY: 0.11, speed: 0.00062, phase: 1.9, coreAlpha: 0.56 },
      { anchorX: 0.48, anchorY: 0.56, radius: 0.52, color: '#fbbf24', driftX: 0.09, driftY: 0.1, speed: 0.00076, phase: 3.4, pulseRate: 1.3, coreAlpha: 0.58 },
    ],
  },
  ocean: {
    baseColor: '#e0f2fe',
    orbs: [
      { anchorX: 0.14, anchorY: 0.84, radius: 0.8, color: '#0369a1', driftX: 0.11, driftY: 0.06, speed: 0.00066, phase: 0.8, coreAlpha: 0.58 },
      { anchorX: 0.86, anchorY: 0.16, radius: 0.68, color: '#0891b2', driftX: 0.09, driftY: 0.12, speed: 0.0006, phase: 2.4, driftRateX: 1.12, coreAlpha: 0.54 },
      { anchorX: 0.54, anchorY: 0.48, radius: 0.5, color: '#2563eb', driftX: 0.1, driftY: 0.09, speed: 0.00072, phase: 4.1 },
      { anchorX: 0.32, anchorY: 0.26, radius: 0.42, color: '#22d3ee', driftX: 0.07, driftY: 0.08, speed: 0.00084, phase: 5.2, coreAlpha: 0.5 },
    ],
  },
  bloom: {
    baseColor: '#fdf2f8',
    orbs: [
      { anchorX: 0.14, anchorY: 0.86, radius: 0.74, color: '#f43f8e', driftX: 0.11, driftY: 0.09, speed: 0.00074, phase: 0.5, coreAlpha: 0.58 },
      { anchorX: 0.82, anchorY: 0.2, radius: 0.64, color: '#f472b6', driftX: 0.1, driftY: 0.11, speed: 0.00064, phase: 2.2, coreAlpha: 0.54 },
      { anchorX: 0.44, anchorY: 0.46, radius: 0.56, color: '#a855f7', driftX: 0.09, driftY: 0.1, speed: 0.0007, phase: 3.8, pulseRate: 1.25 },
      { anchorX: 0.7, anchorY: 0.74, radius: 0.44, color: '#fb7185', driftX: 0.08, driftY: 0.07, speed: 0.00078, phase: 5.1 },
    ],
  },
  midnight: {
    baseColor: '#0c0c16',
    motionScale: 1.02,
    orbs: [
      { anchorX: 0.18, anchorY: 0.78, radius: 0.84, color: '#5b3dea', driftX: 0.1, driftY: 0.07, speed: 0.00058, phase: 0.3, midAlpha: 0.26, coreAlpha: 0.52 },
      { anchorX: 0.8, anchorY: 0.22, radius: 0.72, color: '#6366f1', driftX: 0.09, driftY: 0.1, speed: 0.00052, phase: 1.8, coreAlpha: 0.5 },
      { anchorX: 0.5, anchorY: 0.52, radius: 0.56, color: '#818cf8', driftX: 0.08, driftY: 0.09, speed: 0.0006, phase: 3.6, coreAlpha: 0.46 },
      { anchorX: 0.34, anchorY: 0.16, radius: 0.44, color: '#c4b5fd', driftX: 0.07, driftY: 0.06, speed: 0.00066, phase: 4.9, coreAlpha: 0.42 },
    ],
  },
  citrus: {
    baseColor: '#fffbeb',
    motionScale: 1.18,
    orbs: [
      { anchorX: 0.12, anchorY: 0.86, radius: 0.76, color: '#65a30d', driftX: 0.12, driftY: 0.08, speed: 0.00076, phase: 0.1, coreAlpha: 0.58 },
      { anchorX: 0.88, anchorY: 0.16, radius: 0.62, color: '#eab308', driftX: 0.11, driftY: 0.11, speed: 0.00068, phase: 1.6, driftRateX: 1.2, coreAlpha: 0.6 },
      { anchorX: 0.48, anchorY: 0.5, radius: 0.52, color: '#f97316', driftX: 0.1, driftY: 0.09, speed: 0.00074, phase: 3.2, pulseRate: 1.32 },
      { anchorX: 0.26, anchorY: 0.32, radius: 0.42, color: '#84cc16', driftX: 0.08, driftY: 0.07, speed: 0.00082, phase: 4.7, coreAlpha: 0.52 },
    ],
  },
  frost: {
    baseColor: '#f0f9ff',
    orbs: [
      { anchorX: 0.16, anchorY: 0.82, radius: 0.78, color: '#0ea5e9', driftX: 0.1, driftY: 0.08, speed: 0.0007, phase: 0.6, coreAlpha: 0.56 },
      { anchorX: 0.84, anchorY: 0.18, radius: 0.66, color: '#8b9cf8', driftX: 0.09, driftY: 0.11, speed: 0.0006, phase: 2.3, coreAlpha: 0.52 },
      { anchorX: 0.52, anchorY: 0.48, radius: 0.5, color: '#38bdf8', driftX: 0.08, driftY: 0.09, speed: 0.00066, phase: 4.0, pulseRate: 1.22 },
      { anchorX: 0.38, anchorY: 0.7, radius: 0.4, color: '#c7d2fe', driftX: 0.07, driftY: 0.06, speed: 0.00078, phase: 5.4, coreAlpha: 0.5 },
    ],
  },
}

export function isOrbPreset(value: unknown): value is OrbPreset {
  return typeof value === 'string' && value in ORB_PRESETS
}

export function drawOrbBackground(
  context: CanvasRenderingContext2D,
  rect: BubbleRect,
  timeMs: number,
  preset: OrbPreset = 'brand',
) {
  const config = ORB_PRESETS[preset]
  const presetMotion = config.motionScale ?? 1

  context.save()
  context.beginPath()
  context.rect(rect.x, rect.y, rect.width, rect.height)
  context.clip()

  context.fillStyle = config.baseColor
  context.fillRect(rect.x, rect.y, rect.width, rect.height)

  const base = Math.min(rect.width, rect.height)

  for (const orb of config.orbs) {
    const speed = orb.speed * MOTION_SCALE * presetMotion
    const t = timeMs * speed + orb.phase
    const pulseRate = orb.pulseRate ?? 1.24
    const pulse = 0.95 + Math.sin(t * pulseRate) * 0.05
    const driftRateX = orb.driftRateX ?? 0.82
    const driftRateY = orb.driftRateY ?? 0.68
    const cx =
      rect.x +
      rect.width *
        (orb.anchorX +
          Math.sin(t * driftRateX) * orb.driftX +
          Math.sin(t * driftRateX * 0.43 + orb.phase) * orb.driftX * 0.24)
    const cy =
      rect.y +
      rect.height *
        (orb.anchorY +
          Math.cos(t * driftRateY) * orb.driftY +
          Math.cos(t * driftRateY * 0.51 + orb.phase * 1.2) * orb.driftY * 0.2)
    const radius = base * orb.radius * pulse

    const coreAlpha = orb.coreAlpha ?? 0.54
    const midAlpha = orb.midAlpha ?? 0.22

    const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, radius)
    gradient.addColorStop(0, rgba(orb.color, coreAlpha))
    gradient.addColorStop(0.22, rgba(orb.color, midAlpha))
    gradient.addColorStop(0.55, rgba(orb.color, midAlpha * 0.42))
    gradient.addColorStop(1, rgba(orb.color, 0))

    context.fillStyle = gradient
    context.beginPath()
    context.arc(cx, cy, radius, 0, Math.PI * 2)
    context.fill()
  }

  context.restore()
}
