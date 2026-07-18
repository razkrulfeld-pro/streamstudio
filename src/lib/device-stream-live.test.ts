import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEVICE_LIVE_EDGE_MARGIN_S,
  DEVICE_LIVE_EDGE_SEEK_THRESHOLD_S,
  dimensionsChanged,
  dimensionsToAspectLabel,
  getDeviceStreamBufferedEnd,
  readVideoDimensions,
  resolveDeviceStageDimensions,
  seekDeviceStreamToLiveEdge,
  tickDeviceLiveEdge,
} from './device-stream-live.ts'

function mockVideo(opts: {
  currentTime?: number
  bufferedEnd?: number | null
  videoWidth?: number
  videoHeight?: number
}): HTMLVideoElement {
  const currentTime = { value: opts.currentTime ?? 0 }
  const bufferedEnd = opts.bufferedEnd
  return {
    get currentTime() {
      return currentTime.value
    },
    set currentTime(v: number) {
      currentTime.value = v
    },
    get videoWidth() {
      return opts.videoWidth ?? 0
    },
    get videoHeight() {
      return opts.videoHeight ?? 0
    },
    buffered:
      bufferedEnd == null
        ? { length: 0, end: () => 0, start: () => 0 }
        : {
            length: 1,
            start: () => 0,
            end: () => bufferedEnd,
          },
  } as unknown as HTMLVideoElement
}

test('getDeviceStreamBufferedEnd reads last range end', () => {
  const video = mockVideo({ bufferedEnd: 12.5 })
  assert.equal(getDeviceStreamBufferedEnd(video), 12.5)
  assert.equal(getDeviceStreamBufferedEnd(mockVideo({ bufferedEnd: null })), null)
})

test('seekDeviceStreamToLiveEdge seeks aggressively to end-margin', () => {
  const video = mockVideo({ currentTime: 1, bufferedEnd: 30 })
  const lag = seekDeviceStreamToLiveEdge(video)
  assert.ok(lag > DEVICE_LIVE_EDGE_SEEK_THRESHOLD_S)
  assert.ok(
    Math.abs(video.currentTime - (30 - DEVICE_LIVE_EDGE_MARGIN_S)) < 0.001,
  )
})

test('seekDeviceStreamToLiveEdge skips tiny lag', () => {
  const video = mockVideo({ currentTime: 9.98, bufferedEnd: 10 })
  const before = video.currentTime
  const lag = seekDeviceStreamToLiveEdge(video)
  assert.ok(lag < DEVICE_LIVE_EDGE_SEEK_THRESHOLD_S)
  assert.equal(video.currentTime, before)
})

test('tickDeviceLiveEdge reports wall clock and lag', () => {
  const video = mockVideo({ currentTime: 0, bufferedEnd: 12 })
  const sample = tickDeviceLiveEdge(video)
  assert.ok(sample.lagS > 10)
  assert.ok(sample.wallMs > 0)
  assert.equal(sample.bufferedEnd, 12)
  assert.ok(Math.abs(sample.currentTime - (12 - DEVICE_LIVE_EDGE_MARGIN_S)) < 0.001)
})

test('dimensionsChanged detects rotation swaps', () => {
  assert.equal(
    dimensionsChanged({ width: 1080, height: 1920 }, { width: 1920, height: 1080 }),
    true,
  )
  assert.equal(
    dimensionsChanged({ width: 1080, height: 1920 }, { width: 1080, height: 1920 }),
    false,
  )
  assert.equal(dimensionsChanged(null, { width: 1, height: 1 }), false)
})

test('readVideoDimensions requires both axes', () => {
  assert.deepEqual(readVideoDimensions(mockVideo({ videoWidth: 720, videoHeight: 1280 })), {
    width: 720,
    height: 1280,
  })
  assert.equal(readVideoDimensions(mockVideo({ videoWidth: 720, videoHeight: 0 })), null)
})

test('resolveDeviceStageDimensions swaps portrait session to landscape phone', () => {
  const stage = resolveDeviceStageDimensions(
    { width: 1920, height: 1080 },
    { width: 1080, height: 1920 },
  )
  assert.equal(stage.width, 1920)
  assert.equal(stage.height, 1080)
  assert.equal(dimensionsToAspectLabel({ width: 1920, height: 1080 }), '16:9')
  assert.equal(dimensionsToAspectLabel({ width: 1080, height: 1920 }), '9:16')
})
