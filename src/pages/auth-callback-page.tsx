import { exchangeAuthCode, getChannelInfo } from '@/lib/api'
import { useSettings } from '@/context/settings-context'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

export function AuthCallbackPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { updateYoutube } = useSettings()
  const [message, setMessage] = useState('Connecting YouTube…')
  const [isError, setIsError] = useState(false)
  const hasFetched = useRef(false)

  useEffect(() => {
    if (hasFetched.current) return
    hasFetched.current = true

    const code = searchParams.get('code')
    const oauthError = searchParams.get('error')

    if (oauthError) {
      setIsError(true)
      setMessage(`YouTube authorization failed: ${oauthError}`)
      return
    }

    if (!code) {
      setIsError(true)
      setMessage('Missing authorization code. Try connecting again from Settings.')
      return
    }

    let cancelled = false

    async function complete() {
      try {
        await exchangeAuthCode(code!)
        try {
          const channel = await getChannelInfo()
          if (!cancelled) {
            updateYoutube({
              isConnected: true,
              channelName: channel.channel_title,
              channelId: channel.channel_id,
            })
          }
        } catch {
          if (!cancelled) {
            updateYoutube({ isConnected: true })
          }
        }
        if (cancelled) return
        setMessage('YouTube connected successfully')
        window.setTimeout(() => navigate('/settings', { replace: true }), 2000)
      } catch (error) {
        if (cancelled) return
        setIsError(true)
        setMessage(error instanceof Error ? error.message : 'Failed to connect YouTube.')
      }
    }

    void complete()
    return () => {
      cancelled = true
    }
  }, [navigate, searchParams, updateYoutube])

  return (
    <div className="flex min-h-svh items-center justify-center bg-neutral-50 px-6">
      <div className="max-w-md text-center">
        <p className={`text-base font-medium ${isError ? 'text-red-600' : 'text-neutral-900'}`}>
          {message}
        </p>
        {isError ? (
          <button
            type="button"
            onClick={() => navigate('/settings', { replace: true })}
            className="mt-4 text-sm font-medium text-[#5234d2] hover:underline"
          >
            Back to Settings
          </button>
        ) : null}
      </div>
    </div>
  )
}
