import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/useAuth'
import { Avatar } from '@/components/layout/UserMenu'
import { PageHeader } from '@/components/layout/PageHeader'
import { AnchorButton, Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { TextField } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { accountApi } from '@/services/account'
import { ApiError } from '@/services/api'
import { formatDate } from '@/services/format'
import { useTheme } from '@/theme/useTheme'
import type { ThemePreference } from '@/theme/context'

/**
 * The account: who is connected, how it looks, and the two rights over the
 * data it holds.
 *
 * Ordered by how often each is used, which puts the destructive one last and
 * on its own: identity, appearance, export, deletion. The export comes before
 * the deletion on purpose — the copy is what anyone about to delete should be
 * offered first, and putting it after would be a trap.
 */
export function Account() {
  const { user } = useAuth()
  const email = user?.email ?? ''

  return (
    <>
      <PageHeader
        title="Mon compte"
        description="Le compte Google connecté, l’apparence de l’application et vos données."
      />

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="space-y-4">
          <Identity email={email} createdAt={user?.createdAt} />
          <Appearance />
        </div>

        <div className="space-y-4">
          <DataExport />
          <DeleteAccount email={email} />
        </div>
      </div>
    </>
  )
}

function Identity({
  email,
  createdAt,
}: {
  email: string
  createdAt?: string | undefined
}) {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [leaving, setLeaving] = useState(false)

  return (
    <Card as="section" aria-labelledby="identity-heading" className="p-5">
      <CardHeader id="identity-heading" title="Compte connecté" />

      <div className="mt-4 flex items-center gap-3.5">
        <Avatar email={email} size={52} />

        <div className="min-w-0">
          <p className="truncate font-display text-[15px] font-semibold">{email}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-muted">
            <Icon name="mail" size={13} />
            Les campagnes partent de cette adresse
          </p>
        </div>
      </div>

      <dl className="mt-5 space-y-2 border-t border-border pt-4 text-[13px]">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-muted">Fournisseur</dt>
          <dd className="font-medium">Google</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-muted">Compte créé le</dt>
          <dd className="font-medium">{createdAt ? formatDate(createdAt) : '—'}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-muted">Autorisation</dt>
          <dd className="font-medium">Envoi d’e-mails uniquement</dd>
        </div>
      </dl>

      {/* Said plainly here, because it is the one thing users assume an email
          application does and this one deliberately cannot. */}
      <p className="mt-4 flex items-start gap-2 rounded-xl bg-surface-2 px-3.5 py-2.5 text-xs leading-relaxed text-ink-muted">
        <Icon name="info" size={13} className="mt-px shrink-0" />
        <span>
          L’application ne peut pas lire votre boîte de réception. Elle ne demande que
          l’autorisation d’envoyer en votre nom.
        </span>
      </p>

      <Button
        variant="secondary"
        icon="logout"
        loading={leaving}
        className="mt-4"
        onClick={() => {
          setLeaving(true)
          void signOut().finally(() => {
            void navigate('/login', { replace: true })
          })
        }}
      >
        Se déconnecter
      </Button>
    </Card>
  )
}

/**
 * The full three-way theme choice, which the header's single button cannot
 * offer: light, dark, or follow the operating system.
 */
function Appearance() {
  const { preference, resolved, setPreference } = useTheme()

  return (
    <Card as="section" aria-labelledby="theme-heading" className="p-5">
      <CardHeader
        id="theme-heading"
        title="Apparence"
        description="Appliquée immédiatement et retenue sur cet appareil."
      />

      <SegmentedControl
        value={preference}
        onChange={setPreference}
        label="Thème de l’interface"
        className="mt-4 w-full"
        segments={[
          { value: 'light' as ThemePreference, label: 'Clair', icon: 'sun' },
          { value: 'dark' as ThemePreference, label: 'Sombre', icon: 'moon' },
          { value: 'system' as ThemePreference, label: 'Système', icon: 'monitor' },
        ]}
      />

      <p className="mt-3 text-xs leading-relaxed text-ink-muted">
        {preference === 'system'
          ? `L’application suit votre système, actuellement en thème ${resolved === 'dark' ? 'sombre' : 'clair'}.`
          : `Thème ${preference === 'dark' ? 'sombre' : 'clair'} forcé, quel que soit le réglage de votre système.`}
      </p>
    </Card>
  )
}

function DataExport() {
  return (
    <Card as="section" aria-labelledby="export-heading" className="p-5">
      <CardHeader
        id="export-heading"
        title="Vos données"
        description="Une copie de tout ce que l’application conserve : vos campagnes, leurs messages, vos contacts et le journal de chaque envoi."
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <AnchorButton
          href={accountApi.exportUrl('json')}
          download
          variant="secondary"
          icon="download"
        >
          Toutes mes données (JSON)
        </AnchorButton>
        <AnchorButton
          href={accountApi.exportUrl('csv')}
          download
          variant="secondary"
          icon="download"
        >
          Mes contacts (CSV)
        </AnchorButton>
      </div>
    </Card>
  )
}

/**
 * Deleting the account.
 *
 * The confirmation is the address typed out rather than a checkbox, because
 * this cannot be undone and typing is the one gesture nobody performs by
 * accident. The same comparison runs on the server, so the button is only
 * enabled for a request the server will accept.
 */
function DeleteAccount({ email }: { email: string }) {
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmed = email !== '' && typed.trim().toLowerCase() === email.toLowerCase()

  async function submit(event: FormEvent) {
    event.preventDefault()

    if (!confirmed || busy) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      const report = await accountApi.delete(typed.trim())
      // The session is gone server-side; reading it again turns the interface
      // anonymous, so the login page shows instead of redirecting back here.
      await refresh()
      void navigate('/login', { replace: true, state: { deleted: report } })
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'La suppression a échoué. Réessayez.',
      )
      setBusy(false)
    }
  }

  return (
    <Card as="section" aria-labelledby="delete-heading" className="border-danger/30 p-5">
      <CardHeader
        id="delete-heading"
        title="Supprimer mon compte"
        description="Définitif. Téléchargez vos données avant, si vous voulez les garder."
      />

      <ul className="mt-4 space-y-1.5 text-[13px] text-ink-muted">
        {[
          'Vos campagnes, vos contacts, leurs journaux et vos pièces jointes sont effacés.',
          'Les campagnes en cours s’arrêtent : plus aucun message ne part.',
          'L’accès de l’application à votre compte Google est révoqué.',
        ].map((line) => (
          <li key={line} className="flex items-start gap-2">
            <Icon name="close" size={13} className="mt-1 shrink-0 text-danger" />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <form onSubmit={(event) => void submit(event)} className="mt-5">
        <TextField
          label="Pour confirmer, saisissez votre adresse e-mail"
          type="email"
          value={typed}
          autoComplete="off"
          placeholder={email}
          onChange={(event) => {
            setTyped(event.target.value)
          }}
          {...(error ? { error } : {})}
        />

        <Button
          type="submit"
          variant="danger"
          icon="trash"
          loading={busy}
          disabled={!confirmed}
          className="mt-4"
        >
          Supprimer définitivement mon compte
        </Button>
      </form>
    </Card>
  )
}
