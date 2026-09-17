import type { ComponentType } from 'react'
import { createBrowserRouter } from 'react-router-dom'

import { AppLayout } from '@/components/layout/AppLayout'
import { RequireAuth } from '@/components/RequireAuth'
import { Dashboard } from '@/pages/Dashboard'
import { Login } from '@/pages/Login'
import { NotFound } from '@/pages/NotFound'

/*
 * Only the three pages a visit can open on are in the first download: the
 * login, the dashboard behind it, and the 404. Every other page is fetched the
 * first time it is navigated to, which keeps the initial bundle under the size
 * a phone on a slow connection parses without a visible pause. The pages keep
 * their own skeletons, so the fetch reads as the page loading, not as a stall.
 */
const page = <T extends Record<string, unknown>>(
  load: () => Promise<T>,
  name: keyof T,
) => ({
  lazy: async () => ({ Component: (await load())[name] as ComponentType }),
})

/**
 * Route table.
 *
 * Login and the legal pages stand alone: the first has no navigation to show,
 * the three others have to be readable by someone still deciding whether to
 * sign in. Everything else sits behind RequireAuth, inside the application
 * shell.
 *
 * The catch-all 404 is outside the shell too, so a wrong address does not
 * bounce a signed-out visitor to the login page before showing them what went
 * wrong.
 */
export const router = createBrowserRouter([
  {
    path: '/login',
    element: <Login />,
  },
  // Public: someone deciding whether to sign in must be able to read them.
  {
    path: '/legal/mentions',
    ...page(() => import('@/pages/legal/LegalNotice'), 'LegalNotice'),
  },
  { path: '/legal/cgu', ...page(() => import('@/pages/legal/Terms'), 'Terms') },
  {
    path: '/legal/confidentialite',
    ...page(() => import('@/pages/legal/Privacy'), 'Privacy'),
  },
  {
    element: <RequireAuth />,
    children: [
      {
        path: '/',
        element: <AppLayout />,
        children: [
          { index: true, element: <Dashboard /> },
          { path: 'campaigns', ...page(() => import('@/pages/Campaigns'), 'Campaigns') },
          {
            path: 'campaigns/new',
            ...page(() => import('@/pages/CampaignNew'), 'CampaignNew'),
          },
          {
            path: 'campaigns/:id',
            ...page(() => import('@/pages/CampaignEditor'), 'CampaignEditor'),
          },
          { path: 'history', ...page(() => import('@/pages/History'), 'History') },
          { path: 'account', ...page(() => import('@/pages/Account'), 'Account') },
        ],
      },
    ],
  },
  {
    path: '*',
    element: <NotFound />,
  },
])
