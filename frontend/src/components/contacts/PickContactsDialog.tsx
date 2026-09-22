import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Pagination } from '@/components/ui/Pagination'
import { SearchInput } from '@/components/ui/SearchInput'
import { Skeleton } from '@/components/ui/Skeleton'
import { addressBookApi, type BookContact } from '@/services/addressBook'
import { ApiError } from '@/services/api'
import { countOf } from '@/services/format'

/**
 * Loading contacts the account already has into a campaign.
 *
 * A user writing to the same companies again, a month later, already has them:
 * exporting a CSV from one campaign to import it into the next is the chore
 * this removes. The list is the address book, one entry per address, minus
 * the ones this campaign already holds, so everything on screen
 * is something that can actually be added. The copy happens on the server,
 * from the ids alone.
 *
 * It stays beside the other ways in: a CSV file, a contact typed by hand, and
 * MailFind once its integration lands (roadmap, Phase 9).
 */

const PAGE = 20

type Face =
  | { kind: 'pick' }
  | { kind: 'done'; imported: number }
  | { kind: 'error'; message: string }

export function PickContactsDialog({
  open,
  campaignId,
  onClose,
  onAdded,
}: {
  open: boolean
  campaignId: string
  onClose: () => void
  /** The campaign's table and counters reload. */
  onAdded: () => void
}) {
  const [contacts, setContacts] = useState<BookContact[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [face, setFace] = useState<Face>({ kind: 'pick' })

  const query = useMemo(
    () => ({
      sort: 'name' as const,
      order: 'asc' as const,
      limit: PAGE,
      offset,
      excludeCampaignId: campaignId,
      ...(search ? { search } : {}),
    }),
    [offset, search, campaignId],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const page = await addressBookApi.list(query)
      setContacts(page.contacts)
      setTotal(page.total)
    } catch {
      setContacts([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    if (open) {
      // oxlint-disable-next-line react/set-state-in-effect
      void load()
    }
  }, [open, load])

  function close() {
    setSelected(new Set())
    setSearch('')
    setOffset(0)
    setFace({ kind: 'pick' })
    onClose()
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const pageSelected =
    contacts.length > 0 && contacts.every((contact) => selected.has(contact.id))

  async function add() {
    setBusy(true)

    try {
      const { imported } = await addressBookApi.copyToCampaign(campaignId, [...selected])
      onAdded()
      setSelected(new Set())
      setFace({ kind: 'done', imported })
    } catch (err) {
      setFace({
        kind: 'error',
        message:
          err instanceof ApiError && err.code === 'campaign_not_editable'
            ? 'La campagne a été lancée entre-temps : elle n’accepte plus de contacts.'
            : err instanceof ApiError && err.status === 0
              ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
              : 'Les contacts n’ont pas pu être ajoutés. Réessayez.',
      })
    } finally {
      setBusy(false)
    }
  }

  if (face.kind === 'done') {
    return (
      <Modal
        open={open}
        onClose={close}
        icon="check-circle"
        tone="success"
        title="Contacts ajoutés"
        description={
          face.imported > 0
            ? `${countOf(face.imported, 'contact rejoint', 'contacts rejoignent')} cette campagne, en attente d’envoi.`
            : 'Ces adresses étaient déjà dans la campagne : rien n’a été ajouté en double.'
        }
        footer={
          <>
            <Button
              variant="ghost"
              icon="plus"
              onClick={() => {
                setFace({ kind: 'pick' })
                void load()
              }}
            >
              En ajouter d’autres
            </Button>
            <Button variant="primary" onClick={close}>
              Terminé
            </Button>
          </>
        }
      />
    )
  }

  if (face.kind === 'error') {
    return (
      <Modal
        open={open}
        onClose={close}
        icon="alert"
        tone="danger"
        title="Les contacts n’ont pas été ajoutés"
        description={face.message}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Fermer
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setFace({ kind: 'pick' })
              }}
            >
              Revenir à la sélection
            </Button>
          </>
        }
      />
    )
  }

  return (
    <Modal
      open={open}
      onClose={close}
      icon="users"
      size="md"
      title="Ajouter depuis mes contacts"
      description="Vos contacts, chaque adresse une fois. Ceux déjà présents dans cette campagne sont masqués."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Annuler
          </Button>
          <Button
            variant="primary"
            icon="plus"
            loading={busy}
            disabled={selected.size === 0}
            onClick={() => void add()}
          >
            {selected.size === 0
              ? 'Ajouter'
              : `Ajouter ${countOf(selected.size, 'contact')}`}
          </Button>
        </>
      }
    >
      <SearchInput
        value={search}
        onChange={(value) => {
          setSearch(value)
          setOffset(0)
        }}
        placeholder="Adresse, nom, entreprise ou campagne…"
        label="Rechercher dans mes contacts"
      />

      {!loading && total === 0 ? (
        <EmptyState
          compact
          icon="users"
          title={search ? 'Aucun résultat' : 'Aucun contact à ajouter'}
          description={
            search
              ? 'Aucun contact ne correspond à cette recherche.'
              : 'Tous vos contacts sont déjà dans cette campagne, ou vous n’en avez pas encore. Importez un fichier CSV ou ajoutez un contact à la main.'
          }
          className="mt-4"
        />
      ) : (
        <>
          <div className="mt-3 flex items-center justify-between gap-2 text-xs text-ink-muted">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={pageSelected}
                onChange={() => {
                  setSelected((current) => {
                    const next = new Set(current)
                    for (const contact of contacts) {
                      if (pageSelected) {
                        next.delete(contact.id)
                      } else {
                        next.add(contact.id)
                      }
                    }
                    return next
                  })
                }}
                className="size-4 accent-accent"
              />
              Tout sélectionner sur cette page
            </label>
            <span aria-live="polite">
              {countOf(total, 'contact disponible', 'contacts disponibles')}
            </span>
          </div>

          <ul className="mt-2 max-h-80 divide-y divide-border overflow-y-auto rounded-xl border border-border">
            {loading
              ? Array.from({ length: 5 }, (_, index) => (
                  <li key={index} className="px-3 py-3">
                    <Skeleton className="h-3 w-2/3" />
                  </li>
                ))
              : contacts.map((contact) => (
                  <li key={contact.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-surface-2">
                      <input
                        type="checkbox"
                        checked={selected.has(contact.id)}
                        onChange={() => {
                          toggle(contact.id)
                        }}
                        aria-label={`Sélectionner ${contact.email}`}
                        className="size-4 shrink-0 accent-accent"
                      />
                      <span className="min-w-0 flex-1 text-[13px]">
                        <span className="block truncate font-medium">
                          {contact.contactName ?? contact.email}
                        </span>
                        <span className="block truncate text-xs text-ink-muted">
                          {[
                            contact.contactName ? contact.email : null,
                            contact.companyName,
                          ]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
          </ul>

          <Pagination
            offset={offset}
            limit={PAGE}
            total={total}
            onChange={setOffset}
            label="Pagination de mes contacts"
            className="mt-3"
          />
        </>
      )}
    </Modal>
  )
}
