import { AppBackground } from '@/components/app-background'
import { AppSidebar } from '@/components/app-sidebar'
import { Outlet } from 'react-router-dom'

export function AppShell() {
  return (
    <>
      <AppBackground />
      <div className="relative flex h-svh w-full overflow-hidden">
        <AppSidebar />
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain p-10 pb-16 md:p-14 md:pb-20 lg:p-16 lg:pb-24">
          <Outlet />
        </main>
      </div>
    </>
  )
}
