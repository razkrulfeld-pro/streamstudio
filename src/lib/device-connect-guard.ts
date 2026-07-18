/**
 * Synchronous re-entrancy guard for Connect Device.
 * React state updates are async, so a second click can fire before
 * deviceState leaves `idle` — this blocks that race.
 */
export function createDeviceConnectGuard() {
  let inFlight = false

  return {
    tryAcquire(): boolean {
      if (inFlight) return false
      inFlight = true
      return true
    },
    release(): void {
      inFlight = false
    },
    get inFlight(): boolean {
      return inFlight
    },
  }
}

export type DeviceConnectGuard = ReturnType<typeof createDeviceConnectGuard>
