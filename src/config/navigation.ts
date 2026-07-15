import { LayoutGrid, Settings } from 'lucide-react'
import { createElement } from 'react'

export const navigationLinks = [
  {
    label: 'Lobby',
    href: '/',
    end: true,
    icon: createElement(LayoutGrid, {
      className: 'h-5 w-5 flex-shrink-0',
    }),
  },
  {
    label: 'Settings',
    href: '/settings',
    icon: createElement(Settings, {
      className: 'h-5 w-5 flex-shrink-0',
    }),
  },
] as const
