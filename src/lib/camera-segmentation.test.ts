import assert from 'node:assert/strict'
import test from 'node:test'

import { isSegmentationMaskFresh } from './camera-segmentation.ts'

test('isSegmentationMaskFresh rejects stale masks so cutout does not freeze', () => {
  assert.equal(isSegmentationMaskFresh(100, 200, 250), true)
  assert.equal(isSegmentationMaskFresh(100, 400, 250), false)
  assert.equal(isSegmentationMaskFresh(null, 400, 250), false)
})
