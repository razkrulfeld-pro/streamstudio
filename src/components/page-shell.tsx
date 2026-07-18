import { PageTitle } from '@/components/page-title'
import { cn } from '@/lib/utils'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface PageShellProps {
  title: string
  backHref?: string
  backLabel?: string
  children: ReactNode
  className?: string
}

export function PageShell({
  title,
  backHref = '/',
  backLabel = 'Back to Lobby',
  children,
  className,
}: PageShellProps) {
  return (
    <div className={cn('mx-auto flex w-full max-w-5xl flex-col', className)}>
      <div className="mb-8 flex items-center gap-3">
        <Link
          to={backHref}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900"
        >
          <ArrowLeft className="size-4" />
          {backLabel}
        </Link>
      </div>
      <PageTitle>{title}</PageTitle>
      <div className="mt-8 flex flex-1 flex-col">{children}</div>
    </div>
  )
}
