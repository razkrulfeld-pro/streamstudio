import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEVICE_STREAM_MIN_BYTES,
  DEVICE_STREAM_MIN_DURATION_MS,
  deviceStreamAttemptUrl,
  deviceStreamBackoffMs,
  shouldRetryDeviceStream,
} from './device-stream-retry.ts'

test('shouldRetryDeviceStream when closed under 10s', () => {
  assert.equal(
    shouldRetryDeviceStream({ elapsedMs: 2, bytesReceived: 500_000 }),
    true,
  )
})

test('shouldRetryDeviceStream when under 100KB even if long-lived', () => {
  assert.equal(
    shouldRetryDeviceStream({
      elapsedMs: DEVICE_STREAM_MIN_DURATION_MS + 1,
      bytesReceived: DEVICE_STREAM_MIN_BYTES - 1,
    }),
    true,
  )
})

test('shouldRetryDeviceStream false when long enough and enough bytes', () => {
  assert.equal(
    shouldRetryDeviceStream({
      elapsedMs: DEVICE_STREAM_MIN_DURATION_MS,
      bytesReceived: DEVICE_STREAM_MIN_BYTES,
    }),
    false,
  )
})

test('deviceStreamBackoffMs doubles then caps', () => {
  assert.equal(deviceStreamBackoffMs(0), 250)
  assert.equal(deviceStreamBackoffMs(1), 500)
  assert.equal(deviceStreamBackoffMs(2), 1000)
  assert.equal(deviceStreamBackoffMs(10), 8000)
})

test('deviceStreamAttemptUrl adds reconnect query on relative path', () => {
  const url = deviceStreamAttemptUrl('/api/device/stream', 3)
  assert.match(url, /^\/api\/device\/stream\?/)
  assert.match(url, /reconnect=3/)
})
