import { defaultSettings } from '@/config/default-settings'
import { normalizeDeviceId } from '@/lib/media-devices'
import type { AppSettings } from '@/types/settings'

const STORAGE_KEY = 'streamstudio-settings'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mergeDeep<T>(base: T, patch: unknown): T {
  if (!isObject(base) || !isObject(patch)) {
    return (patch as T) ?? base
  }

  const result = { ...base } as Record<string, unknown>

  for (const key of Object.keys(patch)) {
    const baseValue = base[key as keyof T]
    const patchValue = patch[key]

    if (isObject(baseValue) && isObject(patchValue)) {
      result[key] = mergeDeep(baseValue, patchValue)
    } else if (patchValue !== undefined) {
      result[key] = patchValue
    }
  }

  return result as T
}

export function loadSettings(): AppSettings {
  if (typeof window === 'undefined') return defaultSettings

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultSettings

    const parsed = JSON.parse(raw) as Partial<AppSettings>
    const merged = mergeDeep(defaultSettings, parsed)

    return {
      account: { ...defaultSettings.account, ...merged.account },
      camera: {
        ...defaultSettings.camera,
        ...merged.camera,
        cameraId: normalizeDeviceId(merged.camera.cameraId),
        microphoneId: normalizeDeviceId(merged.camera.microphoneId),
      },
      youtube: { ...defaultSettings.youtube, ...merged.youtube },
    }
  } catch {
    return defaultSettings
  }
}

export function saveSettings(settings: AppSettings): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export function getFirstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || 'there'
}
