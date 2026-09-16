import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'

import { AuthProvider } from '@/auth/AuthProvider'
import { Toasts } from '@/components/ui/Toasts'
import { router } from '@/router'
import { initErrorReporting, onReactError } from '@/services/errorReporting'
import { ThemeProvider } from '@/theme/ThemeProvider'

import './index.css'

initErrorReporting()

const container = document.getElementById('root')

if (!container) {
  throw new Error('Root element #root is missing from index.html')
}

createRoot(container, {
  onUncaughtError: onReactError,
  // Caught by a boundary, the router's included: the page recovered, the bug
  // did not go away.
  onCaughtError: onReactError,
  onRecoverableError: onReactError,
}).render(
  <StrictMode>
    {/* Outermost, so the toasts and any error surface rendered above the
        router already know which theme they are in. */}
    <ThemeProvider>
      <AuthProvider>
        <RouterProvider router={router} />
        <Toasts />
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
)
