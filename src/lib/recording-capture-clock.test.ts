import assert from 'node:assert/strict'
import test from 'node:test'

import { selectCaptureSources } from './recording-capture-clock.ts'

test('falls back to video elements when processor frames become stale', () => {
  const staleCamera = { kind: 'camera' } as unknown as VideoFrame
  const staleScreen = { kind: 'screen' } as unknown as VideoFrame

  assert.deepEqual(
    selectCaptureSources({
      latestCamera: staleCamera,
      latestCameraAt: 100,
      latestScreen: staleScreen,
      latestScreenAt: 100,
      now: 500,
      staleAfterMs: 250,
    }),
    { camera: null, screen: null },
  )
})

test('keeps fresh processor frames for background-safe capture', () => {
  const camera = { kind: 'camera' } as unknown as VideoFrame
  const screen = { kind: 'screen' } as unknown as VideoFrame

  assert.deepEqual(
    selectCaptureSources({
      latestCamera: camera,
      latestCameraAt: 400,
      latestScreen: screen,
      latestScreenAt: 450,
      now: 500,
      staleAfterMs: 250,
    }),
    { camera, screen },
  )
})
