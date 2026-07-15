import type { ReactNode } from 'react'

export function PageTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-3xl font-semibold tracking-tight text-neutral-900 md:text-4xl">
      {children}
    </h2>
  )
}
