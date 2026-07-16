import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatTagsInput,
  getCategoryLabel,
  getCombinedPublishProgress,
  getVisibilityLabel,
  parseTagsInput,
} from './youtube-upload-options.ts'

test('parseTagsInput trims blanks and removes duplicate tags case-insensitively', () => {
  assert.deepEqual(parseTagsInput('streaming, demo, streaming,  Demo , , youtube'), [
    'streaming',
    'demo',
    'youtube',
  ])
})

test('formatTagsInput joins tags for the editable text field', () => {
  assert.equal(formatTagsInput(['streaming', 'demo', 'youtube']), 'streaming, demo, youtube')
})

test('getCombinedPublishProgress maps export to the first 35 percent', () => {
  assert.equal(getCombinedPublishProgress('idle', 0, 0), 0)
  assert.equal(getCombinedPublishProgress('exporting', 50, 0), 18)
  assert.equal(getCombinedPublishProgress('exporting', 100, 0), 35)
})

test('getCombinedPublishProgress maps upload to the remaining 65 percent', () => {
  assert.equal(getCombinedPublishProgress('uploading', 0, 0), 35)
  assert.equal(getCombinedPublishProgress('uploading', 0, 50), 68)
  assert.equal(getCombinedPublishProgress('uploading', 100, 100), 100)
})

test('labels fall back gracefully for unknown category ids', () => {
  assert.equal(getVisibilityLabel('unlisted'), 'Unlisted')
  assert.equal(getCategoryLabel('22'), 'People & Blogs')
  assert.equal(getCategoryLabel('999'), 'Category 999')
})
