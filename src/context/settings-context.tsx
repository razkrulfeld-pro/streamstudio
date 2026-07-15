import { loadSettings, saveSettings } from '@/lib/settings-storage'
import type {
  AccountSettings,
  AppSettings,
  CameraSettings,
  YoutubeSettings,
} from '@/types/settings'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

interface SettingsContextValue {
  settings: AppSettings
  lastSavedAt: number | null
  updateAccount: (patch: Partial<AccountSettings>) => void
  updateCamera: (patch: Partial<CameraSettings>) => void
  updateYoutube: (patch: Partial<YoutubeSettings>) => void
}

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined)

function persist(settings: AppSettings): number {
  saveSettings(settings)
  return Date.now()
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)

  const commit = useCallback((updater: (current: AppSettings) => AppSettings) => {
    setSettings((current) => {
      const next = updater(current)
      setLastSavedAt(persist(next))
      return next
    })
  }, [])

  const updateAccount = useCallback(
    (patch: Partial<AccountSettings>) => {
      commit((current) => ({ ...current, account: { ...current.account, ...patch } }))
    },
    [commit],
  )

  const updateCamera = useCallback(
    (patch: Partial<CameraSettings>) => {
      commit((current) => ({ ...current, camera: { ...current.camera, ...patch } }))
    },
    [commit],
  )

  const updateYoutube = useCallback(
    (patch: Partial<YoutubeSettings>) => {
      commit((current) => ({ ...current, youtube: { ...current.youtube, ...patch } }))
    },
    [commit],
  )

  const value = useMemo(
    () => ({
      settings,
      lastSavedAt,
      updateAccount,
      updateCamera,
      updateYoutube,
    }),
    [settings, lastSavedAt, updateAccount, updateCamera, updateYoutube],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  const context = useContext(SettingsContext)
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
}
