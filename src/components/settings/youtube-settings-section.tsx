import { SettingsSection } from '@/components/settings/settings-section'
import { useSettings } from '@/context/settings-context'
import { getAuthStatus, getAuthUrl, getChannelInfo, logout } from '@/lib/api'
import type { ChannelInfo } from '@/lib/types/youtube'
import { cn } from '@/lib/utils'
import { categoryOptions, visibilityOptions } from '@/lib/youtube-upload-options'
import type { YoutubeVisibility } from '@/types/settings'
import { CheckCircle2, Loader2, Video } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

export function YoutubeSettingsSection() {
  const { settings, updateYoutube } = useSettings()
  const youtube = settings.youtube
  const [connected, setConnected] = useState(false)
  const [channel, setChannel] = useState<ChannelInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshStatus = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const status = await getAuthStatus()
      setConnected(status.connected)
      if (!status.connected) {
        setChannel(null)
        updateYoutube({ isConnected: false })
        return
      }
      const info = await getChannelInfo()
      setChannel(info)
      updateYoutube({
        isConnected: true,
        channelName: info.channel_title,
        channelId: info.channel_id,
      })
    } catch (err) {
      setConnected(false)
      setChannel(null)
      updateYoutube({ isConnected: false })
      setError(err instanceof Error ? err.message : 'Failed to check YouTube connection.')
    } finally {
      setLoading(false)
    }
  }, [updateYoutube])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const handleConnect = async () => {
    setBusy(true)
    setError(null)
    try {
      const { auth_url } = await getAuthUrl()
      window.location.href = auth_url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start YouTube connection.')
      setBusy(false)
    }
  }

  const handleDisconnect = async () => {
    setBusy(true)
    setError(null)
    try {
      await logout()
      setConnected(false)
      setChannel(null)
      updateYoutube({ isConnected: false, channelName: '', channelId: '' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect YouTube.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsSection
      title="YouTube integration"
      description="Connect your channel and set defaults for seamless uploads after each recording."
    >
      <div className="space-y-6">
        <div className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            {channel?.thumbnail_url ? (
              <img
                src={channel.thumbnail_url}
                alt=""
                className="size-10 rounded-full object-cover"
              />
            ) : (
              <div className="flex size-10 items-center justify-center rounded-full bg-red-600 text-white">
                <Video className="size-5" />
              </div>
            )}
            <div>
              <p className="text-sm font-semibold text-neutral-900">
                {loading
                  ? 'Checking connection…'
                  : connected
                    ? 'Connected to YouTube'
                    : 'Not connected'}
              </p>
              <p className="mt-0.5 text-sm text-neutral-500">
                {loading
                  ? 'Looking up your YouTube account status.'
                  : connected
                    ? `${channel?.channel_title ?? youtube.channelName}${
                        channel?.subscriber_count
                          ? ` · ${Number(channel.subscriber_count).toLocaleString()} subscribers`
                          : ''
                      }`
                    : 'Connect your Google account to upload recordings directly.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={loading || busy}
            onClick={() => void (connected ? handleDisconnect() : handleConnect())}
            className={cn(
              'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50',
              connected
                ? 'border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100'
                : 'bg-red-600 text-white hover:bg-red-700',
            )}
          >
            {busy || loading ? <Loader2 className="size-4 animate-spin" /> : null}
            {connected ? 'Disconnect' : 'Connect YouTube Account'}
          </button>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {connected ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-neutral-700">
                  Default visibility
                </span>
                <select
                  value={youtube.defaultVisibility}
                  onChange={(event) =>
                    updateYoutube({
                      defaultVisibility: event.target.value as YoutubeVisibility,
                    })
                  }
                  className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
                >
                  {visibilityOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-neutral-700">
                  Default category
                </span>
                <select
                  value={youtube.defaultCategory}
                  onChange={(event) => updateYoutube({ defaultCategory: event.target.value })}
                  className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
                >
                  {categoryOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-neutral-700">Default tags</span>
              <input
                type="text"
                value={youtube.defaultTags}
                onChange={(event) => updateYoutube({ defaultTags: event.target.value })}
                placeholder="comma, separated, tags"
                className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-neutral-700">
                Default description
              </span>
              <textarea
                value={youtube.defaultDescription}
                onChange={(event) => updateYoutube({ defaultDescription: event.target.value })}
                rows={3}
                className="w-full resize-y rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2.5">
                <span className="text-sm font-medium text-neutral-700">Auto-upload when published</span>
                <input
                  type="checkbox"
                  checked={youtube.autoUpload}
                  onChange={(event) => updateYoutube({ autoUpload: event.target.checked })}
                  className="size-4 rounded border-neutral-300"
                />
              </label>

              <label className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2.5">
                <span className="text-sm font-medium text-neutral-700">Notify subscribers</span>
                <input
                  type="checkbox"
                  checked={youtube.notifySubscribers}
                  onChange={(event) => updateYoutube({ notifySubscribers: event.target.checked })}
                  className="size-4 rounded border-neutral-300"
                />
              </label>

              <label className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2.5">
                <span className="text-sm font-medium text-neutral-700">Allow comments</span>
                <input
                  type="checkbox"
                  checked={youtube.allowComments}
                  onChange={(event) => updateYoutube({ allowComments: event.target.checked })}
                  className="size-4 rounded border-neutral-300"
                />
              </label>

              <label className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2.5">
                <span className="text-sm font-medium text-neutral-700">Made for kids</span>
                <input
                  type="checkbox"
                  checked={youtube.madeForKids}
                  onChange={(event) => updateYoutube({ madeForKids: event.target.checked })}
                  className="size-4 rounded border-neutral-300"
                />
              </label>
            </div>

            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
              <CheckCircle2 className="size-4 flex-shrink-0" />
              These defaults apply to future uploads only. Saved recordings keep their existing metadata.
            </div>
          </>
        ) : null}
      </div>
    </SettingsSection>
  )
}
