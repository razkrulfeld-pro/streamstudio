import {
  Sidebar,
  SidebarBody,
  SidebarLink,
  useSidebar,
} from '@/components/ui/sidebar'
import { navigationLinks } from '@/config/navigation'
import { useSettings } from '@/context/settings-context'
import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'
import { Camera } from 'lucide-react'

function SidebarBrand() {
  const { open, animate } = useSidebar()
  const { settings } = useSettings()
  const { avatarUrl } = settings.account

  return (
    <div
      className={cn(
        'mb-6 flex w-full items-center py-2',
        open ? 'justify-start gap-3' : 'justify-center',
      )}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          className="h-8 w-8 flex-shrink-0 rounded-full bg-neutral-100 object-cover ring-1 ring-neutral-200"
        />
      ) : (
        <div
          aria-hidden
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-neutral-200"
        >
          <Camera className="size-4 text-neutral-500" />
        </div>
      )}
      <motion.span
        animate={{
          display: animate ? (open ? 'inline-block' : 'none') : 'inline-block',
          opacity: animate ? (open ? 1 : 0) : 1,
        }}
        className="whitespace-pre text-base font-semibold tracking-tight text-neutral-900"
      >
        StreamStudio
      </motion.span>
    </div>
  )
}

function SidebarContent() {
  const { open } = useSidebar()

  return (
    <div className={cn('flex h-full flex-col', !open && 'w-full items-center')}>
      <SidebarBrand />
      <nav className={cn('flex w-full flex-col gap-1', !open && 'items-center')}>
        {navigationLinks.map((link) => (
          <SidebarLink key={link.href} link={link} />
        ))}
      </nav>
    </div>
  )
}

export function AppSidebar({ className }: { className?: string }) {
  return (
    <Sidebar animate={true}>
      <SidebarBody className={cn('justify-between', className)}>
        <SidebarContent />
      </SidebarBody>
    </Sidebar>
  )
}
