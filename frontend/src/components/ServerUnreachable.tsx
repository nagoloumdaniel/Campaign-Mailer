import { useState } from 'react'

import { useAuth } from '@/auth/useAuth'

import { Logo } from './layout/Logo'
import { Button } from './ui/Button'

/**
 * Shown when the session could not be read because the API did not answer.
 *
 * Deliberately not the login page. "Sign in" is advice the user cannot act on
 * while the server is down, and it makes them suspect their own account
 * rather than the service.
 */
export function ServerUnreachable() {
  const { refresh } = useAuth()
  const [retrying, setRetrying] = useState(false)

  return (
    <main
      role="alert"
      className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-5 text-center"
    >
      <Logo size={30} className="text-ink-subtle" />

      <h1 className="mt-5 text-lg font-semibold tracking-tight">Serveur injoignable</h1>

      <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
        Impossible de vérifier votre session. Le service est peut-être momentanément
        indisponible, ou votre connexion est interrompue.
      </p>

      <Button
        variant="secondary"
        icon="refresh"
        loading={retrying}
        className="mt-6"
        onClick={() => {
          setRetrying(true)
          void refresh().finally(() => {
            setRetrying(false)
          })
        }}
      >
        Réessayer
      </Button>
    </main>
  )
}
