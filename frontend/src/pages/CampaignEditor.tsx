import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { useAuth } from '@/auth/useAuth'
import { AttachmentList } from '@/components/campaign/AttachmentList'
import { CadencePanel } from '@/components/campaign/CadencePanel'
import { StatusBadge, TypeBadge } from '@/components/campaign/CampaignBadges'
import { CampaignStats } from '@/components/campaign/CampaignStats'
import { ContactsSection } from '@/components/campaign/ContactsSection'
import { DeleteCampaignDialog } from '@/components/campaign/DeleteCampaignDialog'
import { EmailPreview } from '@/components/campaign/EmailPreview'
import { SendControls } from '@/components/campaign/SendControls'
import { PageHeader } from '@/components/layout/PageHeader'
import { EditorSkeleton } from '@/components/skeletons/PageSkeletons'
import { Button, IconButton, LinkButton } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/EmptyState'
import { Icon } from '@/components/ui/Icon'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Skeleton } from '@/components/ui/Skeleton'
import { Select } from '@/components/ui/Select'
import { ApiError } from '@/services/api'
import {
  CAMPAIGN_TYPES,
  campaignTypeLabel,
  campaignsApi,
  canEditCadence,
  isEditable,
  type Campaign,
  type CampaignType,
} from '@/services/campaigns'
import { contactsApi, type Contact } from '@/services/contacts'

/**
 * The rich text editor, loaded on demand.
 *
 * Quill and its stylesheet are the heaviest thing this application ships, and
 * the only page that needs them is this one — a user who signs in to check a
 * dashboard should not pay for an editor they never open. The fallback is a
 * block of the editor's own height, so the column does not jump when it
 * arrives.
 */
const EmailEditor = lazy(async () => import('@/components/campaign/EmailEditor'))

/** The editor's own height, so the column does not jump when it arrives. */
function EditorFallback() {
  return (
    <Card as="section" className="p-5">
      <div role="status" aria-busy="true">
        <span className="sr-only">Chargement de l’éditeur</span>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-4 h-10 w-full" rounded="rounded-xl" />
        <Skeleton className="mt-5 h-64 w-full" rounded="rounded-xl" />
      </div>
    </Card>
  )
}

type Load =
  | { state: 'loading' }
  | { state: 'ready'; campaign: Campaign }
  | { state: 'missing' }
  | { state: 'failed' }

interface Draft {
  subject: string
  bodyHtml: string
  bodyText: string
}

/**
 * One campaign: writing it on the left, seeing it on the right.
 *
 * The split is the whole design of this page. Writing an email whose merge
 * fields resolve to somebody's real name is guesswork until you see it
 * resolved, and a preview behind a button is a preview you check once. So the
 * right column follows the keyboard, and the "Générer l'aperçu" button is
 * gone.
 *
 * Below a laptop the two columns cannot sit side by side without both being
 * too narrow to use, so they become two tabs. That is a real switch between
 * writing and checking rather than a squeeze of the same layout.
 *
 * A finished campaign is not this page at all: it drops the editor, the
 * import, the pace and the send controls, and keeps the figures, the
 * recipients and a read-only look at what went out. Those controls are absent
 * rather than disabled — a column of greyed panels asks the reader to work
 * out why each one is dead.
 */
export function CampaignEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [draft, setDraft] = useState<Draft>({ subject: '', bodyHtml: '', bodyText: '' })
  const [variables, setVariables] = useState<string[]>([])
  const [firstContact, setFirstContact] = useState<Contact | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [pane, setPane] = useState<'edit' | 'preview'>('edit')
  /** Bumped when contacts change, so the table and the counters reload together. */
  const [contactsVersion, setContactsVersion] = useState(0)

  const refresh = useCallback(async () => {
    if (!id) {
      setLoad({ state: 'missing' })
      return
    }

    try {
      const campaign = await campaignsApi.get(id)
      setLoad({ state: 'ready', campaign })
      setDraft({
        subject: campaign.subject ?? '',
        bodyHtml: campaign.bodyHtml ?? '',
        bodyText: campaign.bodyText ?? '',
      })
      setDirty(false)
    } catch (err) {
      // Only a 404 means the campaign is gone. An unreachable server or a 500
      // said "introuvable" would send the user looking for a deleted campaign
      // that is still there.
      setLoad(
        err instanceof ApiError && err.status === 404
          ? { state: 'missing' }
          : { state: 'failed' },
      )
    }
  }, [id])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh()
  }, [refresh])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void campaignsApi
      .templates()
      .then((catalogue) => {
        setVariables(catalogue.variables)
      })
      .catch(() => {
        setVariables([])
      })
  }, [])

  /**
   * The contact the preview renders against: the first one imported.
   *
   * Reloaded whenever the contact list changes, so the very first import
   * replaces the sample values without a page reload — which is the moment a
   * mis-mapped CSV column becomes visible.
   */
  useEffect(() => {
    if (!id) {
      return
    }

    // oxlint-disable-next-line react/set-state-in-effect
    void contactsApi
      .list(id, { limit: 1, offset: 0 })
      .then((result) => {
        setFirstContact(result.contacts[0] ?? null)
      })
      .catch(() => {
        setFirstContact(null)
      })
  }, [id, contactsVersion])

  const live =
    load.state === 'ready' &&
    (load.campaign.status === 'scheduled' || load.campaign.status === 'running')

  /**
   * Follows a sending campaign without a reload.
   *
   * Polling every ten seconds rather than a push channel: the numbers move at
   * the pace of one message every few seconds at best, and a poll needs
   * nothing new on the server. Skipped while the tab is hidden, and stopped as
   * soon as the campaign is no longer sending.
   */
  useEffect(() => {
    if (!live || !id) {
      return
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return
      }

      campaignsApi
        .get(id)
        .then((campaign) => {
          setLoad((current) => {
            if (
              current.state === 'ready' &&
              (current.campaign.sentCount !== campaign.sentCount ||
                current.campaign.errorCount !== campaign.errorCount)
            ) {
              // The table shows each contact's status; it moves with the counters.
              setContactsVersion((version) => version + 1)
            }
            return { state: 'ready', campaign }
          })
        })
        .catch(() => {
          // A missed poll is not worth a toast; the next one will try again.
        })
    }, 10_000)

    return () => {
      window.clearInterval(timer)
    }
  }, [live, id])

  /**
   * Warns before leaving with unsaved work. A campaign body is ten minutes of
   * writing, and the browser gives it away for free.
   */
  useEffect(() => {
    if (!dirty) {
      return
    }

    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }

    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('beforeunload', warn)
    }
  }, [dirty])

  async function save() {
    if (load.state !== 'ready' || saving) {
      return
    }

    setSaving(true)

    try {
      const campaign = await campaignsApi.update(load.campaign.id, {
        subject: draft.subject,
        body_html: draft.bodyHtml,
        body_text: draft.bodyText,
      })

      setLoad({ state: 'ready', campaign })
      setDirty(false)
      toast.success('Message enregistré.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'L’enregistrement a échoué.')
    } finally {
      setSaving(false)
    }
  }

  async function changeType(type: CampaignType) {
    if (load.state !== 'ready') {
      return
    }

    try {
      setLoad({
        state: 'ready',
        campaign: await campaignsApi.update(load.campaign.id, { type }),
      })
    } catch {
      toast.error('Le type n’a pas pu être modifié.')
    }
  }

  if (load.state === 'loading') {
    return <EditorSkeleton />
  }

  if (load.state === 'failed') {
    return (
      <>
        <PageHeader title="Campagne" back={{ to: '/campaigns', label: 'Campagnes' }} />
        <ErrorState
          title="Impossible de charger cette campagne"
          onRetry={() => {
            setLoad({ state: 'loading' })
            void refresh()
          }}
        />
      </>
    )
  }

  if (load.state === 'missing') {
    return (
      <>
        <PageHeader
          title="Campagne introuvable"
          back={{ to: '/campaigns', label: 'Campagnes' }}
        />
        <ErrorState
          title="Cette campagne n’existe pas"
          description="Elle a peut-être été supprimée, ou l’adresse est incorrecte."
        />
        <p className="mt-4 text-center">
          <LinkButton to="/campaigns" variant="primary" icon="send">
            Voir mes campagnes
          </LinkButton>
        </p>
      </>
    )
  }

  const { campaign } = load
  const editable = isEditable(campaign.status)
  const finished = campaign.status === 'completed'

  return (
    <>
      <PageHeader
        title={campaign.name}
        back={{ to: '/campaigns', label: 'Campagnes' }}
        badges={
          <>
            <StatusBadge status={campaign.status} />
            <TypeBadge type={campaign.type} />
          </>
        }
        action={
          <>
            {editable && (
              <Button
                variant="primary"
                icon="check"
                loading={saving}
                disabled={!dirty}
                onClick={() => void save()}
              >
                {dirty ? 'Enregistrer' : 'À jour'}
              </Button>
            )}
            {campaign.status !== 'running' && (
              <IconButton
                icon="trash"
                label="Supprimer la campagne"
                variant="secondary"
                onClick={() => {
                  setDeleting(true)
                }}
                className="hover:text-danger"
              />
            )}
          </>
        }
      />

      <div className="space-y-4">
        <SendControls
          campaign={campaign}
          dirty={dirty}
          onChanged={(updated) => {
            setLoad({ state: 'ready', campaign: updated })
          }}
        />

        {/* A draft has sent nothing: statistics would be a panel of zeros. */}
        {campaign.status !== 'draft' && <CampaignStats campaign={campaign} />}
      </div>

      {/* Below a laptop the two columns become two tabs. */}
      <div className="mt-6 lg:hidden">
        <SegmentedControl
          value={pane}
          onChange={setPane}
          label="Affichage"
          segments={[
            { value: 'edit', label: finished ? 'Détails' : 'Édition', icon: 'edit' },
            { value: 'preview', label: 'Aperçu', icon: 'eye' },
          ]}
          className="w-full"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:mt-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] lg:items-start">
        <div className={`space-y-4 ${pane === 'edit' ? '' : 'max-lg:hidden'}`}>
          {finished ? (
            <Card as="section" className="p-5">
              <CardHeader
                title="Message envoyé"
                description="Le contenu d’une campagne terminée ne peut plus être modifié."
              />
              <dl className="mt-4 space-y-3 text-[13px]">
                <div>
                  <dt className="text-xs text-ink-subtle">Objet</dt>
                  <dd className="mt-0.5 font-medium">{campaign.subject ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-subtle">Type de campagne</dt>
                  <dd className="mt-1">
                    <TypeBadge type={campaign.type} />
                  </dd>
                </div>
              </dl>
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-surface-2 px-3.5 py-2.5 text-xs text-ink-muted">
                <Icon name="info" size={13} className="mt-px shrink-0" />
                Le rendu complet du message est affiché dans l’aperçu.
              </p>
            </Card>
          ) : (
            <Suspense fallback={<EditorFallback />}>
              <EmailEditor
                subject={draft.subject}
                bodyHtml={draft.bodyHtml}
                variables={variables}
                disabled={!editable}
                onSubjectChange={(subject) => {
                  setDraft((current) => ({ ...current, subject }))
                  setDirty(true)
                }}
                onBodyChange={(bodyHtml, bodyText) => {
                  setDraft((current) => ({ ...current, bodyHtml, bodyText }))
                  setDirty(true)
                }}
              />
            </Suspense>
          )}

          {!finished && (
            <Card as="section" aria-labelledby="settings-heading" className="p-5">
              <CardHeader
                id="settings-heading"
                title="Type de campagne"
                description="Sert à regrouper l’historique et à retrouver une campagne. Modifiable à tout moment."
              />
              <Select
                value={campaign.type}
                onChange={(type) => void changeType(type)}
                label="Type"
                labelHidden
                className="mt-4 max-w-xs"
                options={CAMPAIGN_TYPES.map((type) => ({
                  value: type,
                  label: campaignTypeLabel(type),
                }))}
              />
            </Card>
          )}

          <AttachmentList
            campaignId={campaign.id}
            attachments={campaign.attachments ?? []}
            disabled={!editable}
            onChanged={() => void refresh()}
          />

          <ContactsSection
            campaignId={campaign.id}
            campaignStatus={campaign.status}
            totalContacts={campaign.totalContacts}
            editable={editable}
            reloadKey={contactsVersion}
            onChanged={() => {
              setContactsVersion((version) => version + 1)
              void refresh()
            }}
          />

          {!finished && (
            <CadencePanel
              campaign={campaign}
              disabled={!canEditCadence(campaign.status)}
              onSaved={(updated) => {
                setLoad({ state: 'ready', campaign: updated })
              }}
            />
          )}
        </div>

        {/* Sticky on a laptop and up: the preview stays beside the paragraph
            being written rather than scrolling away from it. */}
        <div
          className={`lg:sticky lg:top-24 ${pane === 'preview' ? '' : 'max-lg:hidden'}`}
        >
          <EmailPreview
            subject={draft.subject}
            bodyHtml={draft.bodyHtml}
            senderEmail={user?.email ?? 'vous@gmail.com'}
            contact={firstContact}
            attachments={campaign.attachments ?? []}
          />
        </div>
      </div>

      <DeleteCampaignDialog
        campaign={deleting ? campaign : null}
        onClose={() => {
          setDeleting(false)
        }}
        onDeleted={() => {
          setDeleting(false)
          // Replace, not push: the page of a campaign that no longer exists
          // must not come back with the browser's back button.
          void navigate('/campaigns', { replace: true })
        }}
      />
    </>
  )
}
