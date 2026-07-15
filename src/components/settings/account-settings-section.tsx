import { SettingsSection } from '@/components/settings/settings-section'
import { useSettings } from '@/context/settings-context'
import { Camera, Upload } from 'lucide-react'

export function AccountSettingsSection() {
  const { settings, updateAccount } = useSettings()
  const { fullName, email, avatarUrl } = settings.account

  return (
    <SettingsSection
      title="My account"
      description="Manage your profile details used across StreamStudio."
    >
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <div className="flex flex-col items-center gap-3 sm:w-36">
          <div className="relative">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                className="size-24 rounded-full bg-neutral-100 object-cover ring-1 ring-neutral-200"
              />
            ) : (
              <div className="flex size-24 items-center justify-center rounded-full bg-neutral-100 ring-1 ring-neutral-200">
                <Camera className="size-8 text-neutral-400" />
              </div>
            )}
            <label className="absolute -bottom-1 -right-1 flex size-8 cursor-pointer items-center justify-center rounded-full bg-neutral-900 text-white shadow-sm transition-colors hover:bg-neutral-700">
              <Upload className="size-3.5" />
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (!file) return

                  const reader = new FileReader()
                  reader.onload = () => {
                    if (typeof reader.result === 'string') {
                      updateAccount({ avatarUrl: reader.result })
                    }
                  }
                  reader.readAsDataURL(file)
                }}
              />
            </label>
          </div>
          <p className="text-center text-xs text-neutral-500">Upload a new avatar</p>
        </div>

        <div className="grid flex-1 gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-sm font-medium text-neutral-700">Full name</span>
            <input
              type="text"
              value={fullName}
              onChange={(event) => updateAccount({ fullName: event.target.value })}
              className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-sm font-medium text-neutral-700">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => updateAccount({ email: event.target.value })}
              className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
            />
          </label>
        </div>
      </div>
    </SettingsSection>
  )
}
