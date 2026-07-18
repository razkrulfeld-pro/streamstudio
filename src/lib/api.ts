import type { ChannelInfo, UploadMetadata } from '@/lib/types/youtube'

function apiBaseUrl(): string {
  const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim()
  if (configured) return configured.replace(/\/$/, '')
  return 'http://localhost:8080'
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, init)
  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text) as unknown
    } catch {
      data = { error: text }
    }
  }

  if (!response.ok) {
    const error =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${response.status})`
    throw new Error(error)
  }

  return data as T
}

export function getAuthUrl(): Promise<{ auth_url: string }> {
  return request<{ auth_url: string }>('/auth/google')
}

export function getAuthStatus(): Promise<{ connected: boolean }> {
  return request<{ connected: boolean }>('/auth/status')
}

export function logout(): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('/auth/logout', { method: 'POST' })
}

export function getChannelInfo(): Promise<ChannelInfo> {
  return request<ChannelInfo>('/youtube/channel')
}

export function initiateUpload(metadata: UploadMetadata): Promise<{ upload_uri: string }> {
  return request<{ upload_uri: string }>('/youtube/initiate-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: metadata.title,
      description: metadata.description ?? '',
      privacy_status: metadata.privacy_status,
      category_id: metadata.category_id ?? '22',
      tags: metadata.tags ?? [],
      made_for_kids: metadata.made_for_kids ?? false,
      contains_synthetic_media: metadata.contains_synthetic_media ?? false,
      mime_type: metadata.mime_type ?? 'video/webm',
    }),
  })
}

export function exchangeAuthCode(code: string): Promise<{ success: boolean; message: string }> {
  return request<{ success: boolean; message: string }>(
    `/auth/callback?code=${encodeURIComponent(code)}`,
  )
}

export type DeviceMirrorState =
  | 'idle'
  | 'searching'
  | 'found'
  | 'connecting'
  | 'connected'
  | 'error'

export interface DeviceStatus {
  state: DeviceMirrorState
  deviceAddress: string | null
  message: string | null
  error: string | null
}

export function connectDevice(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/device/connect', { method: 'POST' })
}

export function getDeviceStatus(): Promise<DeviceStatus> {
  return request<DeviceStatus>('/api/device/status')
}

export function disconnectDevice(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/device/disconnect', { method: 'POST' })
}

export function deviceStreamUrl(): string {
  // Prefer same-origin via the Vite /api proxy so <video> + captureStream
  // stay first-party. Fall back to absolute API host when configured.
  const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim()
  if (configured) return `${configured.replace(/\/$/, '')}/api/device/stream`
  return '/api/device/stream'
}
