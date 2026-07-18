import assert from 'node:assert/strict'
import test from 'node:test'

import {
  needsSourceSeek,
  resolveExportCanvasSize,
  shouldDrawSegmentedPersonOnly,
} from './export-cutout-helpers.ts'
import { buildExportPlan, defaultEditorProject } from '../types/editor-project.ts'

test('resolveExportCanvasSize prefers decoded video dimensions', () => {
  assert.deepEqual(resolveExportCanvasSize(1080, 1920, '9:16'), {
    width: 1080,
    height: 1920,
  })
  assert.deepEqual(resolveExportCanvasSize(1920, 1080, '16:9'), {
    width: 1920,
    height: 1080,
  })
})

test('resolveExportCanvasSize falls back to aspect ratio when video size is missing', () => {
  assert.deepEqual(resolveExportCanvasSize(0, 0, '9:16'), {
    width: 1080,
    height: 1920,
  })
  assert.deepEqual(resolveExportCanvasSize(0, 0, '16:9'), {
    width: 1920,
    height: 1080,
  })
  assert.deepEqual(resolveExportCanvasSize(0, 0, undefined), {
    width: 1920,
    height: 1080,
  })
})

test('when a cutout background is active and mask is ready, draw person only', () => {
  assert.equal(
    shouldDrawSegmentedPersonOnly({
      hasBackground: true,
      hasFreshSegmentedPerson: true,
    }),
    true,
  )
})

test('when cutout background is active but mask is not ready, do not draw opaque full camera', () => {
  assert.equal(
    shouldDrawSegmentedPersonOnly({
      hasBackground: true,
      hasFreshSegmentedPerson: false,
    }),
    false,
  )
})

test('export plan inserts a skip-cut step so cut-out footage is not recorded', () => {
  const project = defaultEditorProject(20)
  project.cuts = [{ id: 'c1', start: 4, end: 10 }]

  const plan = buildExportPlan(project)
  assert.deepEqual(
    plan.map((step) => step.kind),
    ['video', 'cut', 'video'],
  )

  const cut = plan[1]
  assert.ok(cut && cut.kind === 'cut')
  assert.equal(cut.sourceStart, 4)
  assert.equal(cut.sourceEnd, 10)

  const before = plan[0]
  const after = plan[2]
  assert.ok(before && before.kind === 'video')
  assert.ok(after && after.kind === 'video')
  assert.equal(before.sourceEnd, 4)
  assert.equal(after.sourceStart, 10)
  // Edited timeline must jump across the cut with no gap for the removed range.
  assert.equal(before.timelineEnd, after.timelineStart)
  assert.equal(after.timelineEnd - before.timelineStart, 14)
})

test('after playing through a cut, export should not seek (avoids WebM freeze frames)', () => {
  assert.equal(needsSourceSeek(10, 10), false)
  assert.equal(needsSourceSeek(9.98, 10), false)
  assert.equal(needsSourceSeek(4, 10), true)
})
