import assert from 'node:assert/strict'
import test from 'node:test'

import { downsamplePeaks, slicePeaksForSourceRange } from './audio-waveform.ts'

test('downsamplePeaks returns empty for non-positive bucket count', () => {
  assert.deepEqual(downsamplePeaks([1, 2, 3], 0), [])
  assert.deepEqual(downsamplePeaks([1, 2, 3], -2), [])
})

test('downsamplePeaks returns zeros when samples are empty', () => {
  assert.deepEqual(downsamplePeaks([], 4), [0, 0, 0, 0])
})

test('downsamplePeaks normalizes constant amplitude to 1', () => {
  const peaks = downsamplePeaks([0.25, -0.25, 0.25, -0.25], 2)
  assert.equal(peaks.length, 2)
  assert.ok(peaks.every((peak) => Math.abs(peak - 1) < 1e-9))
})

test('downsamplePeaks preserves relative loudness across buckets', () => {
  const peaks = downsamplePeaks([0.1, 0.1, 1, 1], 2)
  assert.ok(peaks[0]! < peaks[1]!)
  assert.ok(Math.abs(peaks[1]! - 1) < 1e-9)
})

test('slicePeaksForSourceRange maps source window into peak indices', () => {
  const peaks = [0, 0.2, 0.4, 0.6, 0.8, 1]
  assert.deepEqual(slicePeaksForSourceRange(peaks, 0, 0.5, 1), [0, 0.2, 0.4])
  assert.deepEqual(slicePeaksForSourceRange(peaks, 0.5, 1, 1), [0.6, 0.8, 1])
})
