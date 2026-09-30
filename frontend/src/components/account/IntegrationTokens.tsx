import { useEffect, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { TextField } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import { ApiError } from '@/services/api'
import { formatDate } from '@/services/format'
import {
  INTEGRATION_SCOPES,
  integrationTokensApi,
  type IntegrationScope,
  type IntegrationToken,
} from '@/services/integrationTokens'

/**
 * Tokens for the MailFind integration (roadmap, Phase 9).
 *
 * The secret is shown once, right after creation: the server keeps only its
 * hash and could not show it again. Revoking asks first, because the other
 * application loses access at once.
 */
export function IntegrationTokens() {
  const [tokens, setTokens] = useState<IntegrationToken[] | null>(null)
  const [maxActive, setMaxActive] = useState(10)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<IntegrationScope[]>([
    'campaigns:write',
    'contacts:write',
  ])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [toRevoke, setToRevoke] = useState<IntegrationToken | null>(null)
  const [revoking, setRevoking] = useState(false)

  useEffect(() => {
    let active = true
    integrationTokensApi
      .list()
      .then(({ tokens: list, max_active }) => {
        if (!active) return
        setTokens(list)
        setMaxActive(max_active)
      })
      .catch(() => {
        if (active) setError('Les jetons n’ont pas pu être chargés.')
      })
    return () => {
      active = false
    }
  }, [])

  const activeCount = tokens?.filter((token) => token.revoked_at === null).length ?? 0

  async function create(event: FormEvent) {
    event.preventDefault()
    if (busy || name.trim() === '' || scopes.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const created = await integrationTokensApi.create(name.trim(), scopes)
      setTokens((current) => [created.token, ...(current ?? [])])
      setSecret(created.secret)
      setCopied(false)
      setName('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'La création a échoué. Réessayez.')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (secret === null) return
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
    } catch {
      // Clipboard refused: the field stays selectable by hand.
      setCopied(false)
    }
  }

  async function revoke() {
    if (toRevoke === null) return
    setRevoking(true)
    try {
      await integrationTokensApi.revoke(toRevoke.id)
      const revokedAt = new Date().toISOString()
      setTokens(
        (current) =>
          current?.map((token) =>
            token.id === toRevoke.id ? { ...token, revoked_at: revokedAt } : token,
          ) ?? null,
      )
      setToRevoke(null)
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'La révocation a échoué. Réessayez.',
      )
    } finally {
      setRevoking(false)
    }
  }

  return (
    <Card as="section" aria-labelledby="tokens-heading" className="p-5">
      <CardHeader
        id="tokens-heading"
        title="Jetons d’intégration"
        description="Un jeton permet à MailFind de créer des campagnes en brouillon dans votre compte. Il ne peut rien lancer : vous gardez la main sur chaque envoi."
      />

      {secret !== null && (
        <div
          role="status"
          className="mt-4 rounded-xl border border-accent/40 bg-accent-soft px-3.5 py-3"
        >
          <p className="text-[13px] font-semibold">Copiez ce jeton maintenant.</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Il ne sera plus jamais affiché. Perdu, il se révoque et se remplace.
          </p>
          <TextField
            label="Nouveau jeton"
            value={secret}
            readOnly
            className="mt-2 font-mono"
            onFocus={(event) => {
              event.target.select()
            }}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" icon="check" onClick={() => void copy()}>
              {copied ? 'Copié' : 'Copier'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setSecret(null)
              }}
            >
              J’ai rangé le jeton
            </Button>
          </div>
        </div>
      )}

      <form onSubmit={(event) => void create(event)} className="mt-4 space-y-3">
        <TextField
          label="Nom du jeton"
          value={name}
          maxLength={100}
          placeholder="Par exemple : MailFind"
          autoComplete="off"
          onChange={(event) => {
            setName(event.target.value)
          }}
          {...(error ? { error } : {})}
        />
        <fieldset>
          <legend className="text-[13px] font-medium">Autorisations</legend>
          <div className="mt-1.5 space-y-1.5">
            {INTEGRATION_SCOPES.map((scope) => (
              <label key={scope.value} className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={scopes.includes(scope.value)}
                  onChange={(event) => {
                    const checked = event.target.checked
                    setScopes((current) =>
                      checked
                        ? [...current, scope.value]
                        : current.filter((s) => s !== scope.value),
                    )
                  }}
                />
                <span>{scope.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            icon="plus"
            loading={busy}
            disabled={
              name.trim() === '' || scopes.length === 0 || activeCount >= maxActive
            }
          >
            Créer un jeton
          </Button>
          <span className="text-xs text-ink-muted">
            {activeCount} sur {maxActive} jetons actifs
          </span>
        </div>
      </form>

      {tokens !== null && tokens.length > 0 && (
        <ul className="mt-5 divide-y divide-border border-t border-border">
          {tokens.map((token) => (
            <li
              key={token.id}
              className="flex items-start justify-between gap-3 py-3 text-[13px]"
            >
              <div
                className={`min-w-0 ${token.revoked_at === null ? '' : 'text-ink-muted'}`}
              >
                <p className="font-medium">
                  {token.name}{' '}
                  <span className="font-mono text-xs text-ink-muted">
                    {token.prefix}…
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  Créé le {formatDate(token.created_at)} ·{' '}
                  {token.revoked_at !== null
                    ? `révoqué le ${formatDate(token.revoked_at)}`
                    : token.last_used_at !== null
                      ? `utilisé le ${formatDate(token.last_used_at)}`
                      : 'jamais utilisé'}
                </p>
              </div>
              {token.revoked_at === null && (
                <Button
                  variant="danger"
                  icon="trash"
                  onClick={() => {
                    setToRevoke(token)
                  }}
                >
                  Révoquer
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={toRevoke !== null}
        onClose={() => {
          setToRevoke(null)
        }}
        title={`Révoquer le jeton ${toRevoke?.name ?? ''} ?`}
        description="L’application qui l’utilise perd l’accès tout de suite. Un jeton révoqué ne se rétablit pas."
        icon="alert"
        tone="danger"
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setToRevoke(null)
              }}
            >
              Annuler
            </Button>
            <Button variant="danger" loading={revoking} onClick={() => void revoke()}>
              Révoquer le jeton
            </Button>
          </>
        }
      />

      <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-ink-muted">
        <Icon name="info" size={13} className="mt-px shrink-0" />
        <span>
          Aucune session Google n’est partagée : le jeton ne donne accès qu’à ces deux
          actions.
        </span>
      </p>
    </Card>
  )
}
