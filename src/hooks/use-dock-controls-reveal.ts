import { useCallback, useEffect, useRef, useState } from 'react'

const DOCK_ZONE_PX = 80
const HIDE_DELAY_MS = 500

export function useDockControlsReveal(options?: { keepVisible?: boolean }) {
  const [visible, setVisible] = useState(false)
  const hideTimerRef = useRef<number | null>(null)

  const reveal = useCallback(() => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    setVisible(true)
  }, [])

  const scheduleHide = useCallback(() => {
    if (options?.keepVisible) return

    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = window.setTimeout(() => {
      setVisible(false)
      hideTimerRef.current = null
    }, HIDE_DELAY_MS)
  }, [options?.keepVisible])

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const nearBottom = window.innerHeight - event.clientY <= DOCK_ZONE_PX
      if (nearBottom) {
        reveal()
      } else if (!options?.keepVisible) {
        scheduleHide()
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current)
    }
  }, [options?.keepVisible, reveal, scheduleHide])

  useEffect(() => {
    if (options?.keepVisible) reveal()
  }, [options?.keepVisible, reveal])

  return { visible, reveal, scheduleHide }
}
