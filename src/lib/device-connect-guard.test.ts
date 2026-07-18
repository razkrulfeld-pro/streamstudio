import assert from 'node:assert/strict'
import test from 'node:test'

import { createDeviceConnectGuard } from './device-connect-guard.ts'

test('tryAcquire succeeds once then rejects until release', () => {
  const guard = createDeviceConnectGuard()

  assert.equal(guard.tryAcquire(), true)
  assert.equal(guard.inFlight, true)
  assert.equal(guard.tryAcquire(), false)
  assert.equal(guard.tryAcquire(), false)

  guard.release()
  assert.equal(guard.inFlight, false)
  assert.equal(guard.tryAcquire(), true)
})

test('release is idempotent', () => {
  const guard = createDeviceConnectGuard()
  guard.release()
  guard.release()
  assert.equal(guard.tryAcquire(), true)
})
