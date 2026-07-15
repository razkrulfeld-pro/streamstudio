import { cn } from '@/lib/utils'
import { AnimatePresence, motion } from 'framer-motion'
import { Menu, X } from 'lucide-react'
import {
  createContext,
  useContext,
  useState,
  type ComponentProps,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { NavLink, type NavLinkProps } from 'react-router-dom'

interface Links {
  label: string
  href: string
  icon: ReactNode
  end?: boolean
}

interface SidebarContextProps {
  open: boolean
  setOpen: Dispatch<SetStateAction<boolean>>
  animate: boolean
}

const SidebarContext = createContext<SidebarContextProps | undefined>(undefined)

export const useSidebar = () => {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider')
  }
  return context
}

export const SidebarProvider = ({
  children,
  open: openProp,
  setOpen: setOpenProp,
  animate = true,
}: {
  children: ReactNode
  open?: boolean
  setOpen?: Dispatch<SetStateAction<boolean>>
  animate?: boolean
}) => {
  const [openState, setOpenState] = useState(false)

  const open = openProp !== undefined ? openProp : openState
  const setOpen = setOpenProp !== undefined ? setOpenProp : setOpenState

  return (
    <SidebarContext.Provider value={{ open, setOpen, animate }}>
      {children}
    </SidebarContext.Provider>
  )
}

export const Sidebar = ({
  children,
  open,
  setOpen,
  animate,
}: {
  children: ReactNode
  open?: boolean
  setOpen?: Dispatch<SetStateAction<boolean>>
  animate?: boolean
}) => {
  return (
    <SidebarProvider open={open} setOpen={setOpen} animate={animate}>
      {children}
    </SidebarProvider>
  )
}

export const SidebarBody = (props: ComponentProps<typeof motion.div>) => {
  return (
    <>
      <DesktopSidebar {...props} />
      <MobileSidebar {...(props as ComponentProps<'div'>)} />
    </>
  )
}

export const DesktopSidebar = ({
  className,
  children,
  ...props
}: ComponentProps<typeof motion.div>) => {
  const { open, setOpen, animate } = useSidebar()

  return (
    <motion.div
      className={cn(
        'hidden h-full flex-shrink-0 flex-col bg-transparent py-4 md:flex',
        open ? 'px-4' : 'items-center px-2',
        className,
      )}
      animate={{
        width: animate ? (open ? '220px' : '52px') : '220px',
      }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      {...props}
    >
      {children}
    </motion.div>
  )
}

export const MobileSidebar = ({
  className,
  children,
  ...props
}: ComponentProps<'div'>) => {
  const { open, setOpen } = useSidebar()

  return (
    <>
      <div
        className={cn(
          'flex h-10 w-full flex-row items-center justify-between bg-transparent px-4 py-4 md:hidden',
        )}
        {...props}
      >
        <div className="z-20 flex w-full justify-end">
          <Menu
            className="cursor-pointer text-neutral-800"
            onClick={() => setOpen(!open)}
          />
        </div>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ x: '-100%', opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '-100%', opacity: 0 }}
              transition={{
                duration: 0.3,
                ease: 'easeInOut',
              }}
              className={cn(
                'fixed inset-0 z-[100] flex h-full w-full flex-col justify-between bg-[#f8f9fb]/95 p-10 backdrop-blur-xl',
                className,
              )}
            >
              <div
                className="absolute right-10 top-10 z-50 cursor-pointer text-neutral-800"
                onClick={() => setOpen(!open)}
              >
                <X />
              </div>
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  )
}

export const SidebarLink = ({
  link,
  className,
  ...props
}: {
  link: Links
  className?: string
} & Omit<NavLinkProps, 'to' | 'className'>) => {
  const { open, animate } = useSidebar()

  return (
    <NavLink
      to={link.href}
      end={link.end}
      className={({ isActive }) =>
        cn(
          'group/sidebar flex items-center rounded-lg py-2.5 transition-colors',
          open ? 'w-full justify-start gap-2 px-3' : 'w-full justify-center px-0',
          isActive
            ? 'bg-white/80 font-medium text-neutral-900 shadow-sm [&_svg]:text-[#5234d2]'
            : 'text-neutral-600 hover:bg-white/50 hover:text-neutral-900 [&_svg]:text-neutral-400 hover:[&_svg]:text-neutral-600',
          className,
        )
      }
      {...props}
    >
      {link.icon}
      <motion.span
        animate={{
          display: animate ? (open ? 'inline-block' : 'none') : 'inline-block',
          opacity: animate ? (open ? 1 : 0) : 1,
        }}
        className="inline-block whitespace-pre !m-0 !p-0 text-sm transition duration-150 group-hover/sidebar:translate-x-1"
      >
        {link.label}
      </motion.span>
    </NavLink>
  )
}
