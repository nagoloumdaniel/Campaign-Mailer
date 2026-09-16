import { createBrowserRouter } from 'react-router-dom'

import { AppLayout } from '@/components/layout/AppLayout'
import { RequireAuth } from '@/components/RequireAuth'
import { Account } from '@/pages/Account'
import { CampaignEditor } from '@/pages/CampaignEditor'
import { CampaignNew } from '@/pages/CampaignNew'
import { Campaigns } from '@/pages/Campaigns'
import { Dashboard } from '@/pages/Dashboard'
import { History } from '@/pages/History'
import { LegalNotice } from '@/pages/legal/LegalNotice'
import { Login } from '@/pages/Login'
import { NotFound } from '@/pages/NotFound'
import { Privacy } from '@/pages/legal/Privacy'
import { Terms } from '@/pages/legal/Terms'

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
  { path: '/legal/mentions', element: <LegalNotice /> },
  { path: '/legal/cgu', element: <Terms /> },
  { path: '/legal/confidentialite', element: <Privacy /> },
  {
    element: <RequireAuth />,
    children: [
      {
        path: '/',
        element: <AppLayout />,
        children: [
          { index: true, element: <Dashboard /> },
          { path: 'campaigns', element: <Campaigns /> },
          { path: 'campaigns/new', element: <CampaignNew /> },
          { path: 'campaigns/:id', element: <CampaignEditor /> },
          { path: 'history', element: <History /> },
          { path: 'account', element: <Account /> },
        ],
      },
    ],
  },
  {
    path: '*',
    element: <NotFound />,
  },
])
