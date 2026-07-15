import { AccountSettingsSection } from '@/components/settings/account-settings-section'
import { AssetLibrarySection } from '@/components/settings/asset-library-section'
import { AutoSaveIndicator } from '@/components/settings/auto-save-indicator'
import { CameraSettingsSection } from '@/components/settings/camera-settings-section'
import { YoutubeSettingsSection } from '@/components/settings/youtube-settings-section'
import { PageTitle } from '@/components/page-title'
import { useSettings } from '@/context/settings-context'

export function SettingsPage() {
  const { lastSavedAt } = useSettings()

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <PageTitle>Settings</PageTitle>
          <p className="mt-2 text-sm text-neutral-600 md:text-base">
            Manage your account, camera, assets, and YouTube upload preferences.
          </p>
        </div>
        <AutoSaveIndicator lastSavedAt={lastSavedAt} className="sm:pb-1" />
      </div>

      <div className="mt-8 space-y-6">
        <AccountSettingsSection />
        <CameraSettingsSection />
        <AssetLibrarySection />
        <YoutubeSettingsSection />
      </div>
    </div>
  )
}
