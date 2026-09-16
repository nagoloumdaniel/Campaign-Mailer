import { useId, useState } from 'react'
import { toast } from 'sonner'

import { Button, IconButton } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Icon } from '@/components/ui/Icon'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { Progress } from '@/components/ui/Progress'
import { MAX_ATTACHMENTS, attachmentsApi, rejectionFor } from '@/services/attachments'
import type { CampaignAttachment } from '@/services/campaigns'
import { countOf, formatBytes } from '@/services/format'

/**
 * The files joined to every message of the campaign.
 *
 * Up to five, because a candidature is rarely one file — a CV, a cover
 * letter, sometimes a transcript — and the previous single slot forced the
 * user to merge them into one PDF by hand.
 *
 * Adding one confirms in a dialog rather than in a toast that slides away.
 * An attachment goes to every recipient of the campaign, and "which files am
 * I actually sending" is a question worth answering at the moment the answer
 * changes, with the full list in front of the user.
 *
 * The ceiling is said before it is reached, not when it refuses: the counter
 * in the header reads "2 / 5" from the first file.
 */
export function AttachmentList({
  campaignId,
  attachments,
  disabled,
  onChanged,
}: {
  campaignId: string
  attachments: CampaignAttachment[]
  disabled: boolean
  onChanged: () => void
}) {
  const inputId = useId()
  const [progress, setProgress] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [added, setAdded] = useState<CampaignAttachment | null>(null)
  const [toRemove, setToRemove] = useState<CampaignAttachment | null>(null)
  const [removing, setRemoving] = useState(false)

  const full = attachments.length >= MAX_ATTACHMENTS

  async function upload(file: File) {
    const refusal = rejectionFor(file, attachments.length)

    if (refusal) {
      toast.error(refusal)
      return
    }

    setProgress(0)

    try {
      const stored = await attachmentsApi.upload(campaignId, file, setProgress)
      onChanged()
      setAdded(stored)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'L’envoi a échoué.')
    } finally {
      setProgress(null)
    }
  }

  async function remove() {
    if (!toRemove) {
      return
    }

    setRemoving(true)

    try {
      await attachmentsApi.remove(campaignId, toRemove.id)
      toast.success(`« ${toRemove.name} » retirée.`)
      setToRemove(null)
      onChanged()
    } catch {
      toast.error('La suppression a échoué. Réessayez dans un instant.')
    } finally {
      setRemoving(false)
    }
  }

  return (
    <Card as="section" aria-labelledby="attachments-heading" className="p-5">
      <CardHeader
        id="attachments-heading"
        title="Pièces jointes"
        description="Un PDF ou un document Word, 10 Mo par fichier. Jointes à chaque e-mail de la campagne."
        action={
          <span
            className={`tabular rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              full
                ? 'border-warning/30 bg-warning-soft text-warning'
                : 'border-border bg-surface-2 text-ink-muted'
            }`}
          >
            {attachments.length} / {MAX_ATTACHMENTS}
          </span>
        }
      />

      {attachments.length > 0 && (
        <ul className="mt-4 space-y-2">
          {attachments.map((file) => (
            <li
              key={file.id}
              className="flex enter items-center gap-3 rounded-xl border border-border bg-surface-2 px-3.5 py-2.5"
            >
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface text-ink-muted"
              >
                <Icon name="file" size={17} />
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">
                  {file.name}
                </span>
                <span className="block text-xs text-ink-subtle">
                  {file.contentType.includes('pdf') ? 'PDF' : 'Document Word'}
                  {file.size !== null && ` · ${formatBytes(file.size)}`}
                </span>
              </span>

              <a
                href={attachmentsApi.downloadUrl(campaignId, file.id)}
                download
                aria-label={`Télécharger ${file.name}`}
                title="Télécharger"
                className="flex size-8 shrink-0 press items-center justify-center rounded-lg text-ink-muted hover:bg-surface hover:text-ink"
              >
                <Icon name="download" size={16} />
              </a>

              {!disabled && (
                <IconButton
                  icon="trash"
                  label={`Retirer ${file.name}`}
                  size="sm"
                  onClick={() => {
                    setToRemove(file)
                  }}
                  className="hover:text-danger"
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {!disabled && !full && (
        <label
          htmlFor={inputId}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => {
            setDragging(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            const file = event.dataTransfer.files[0]
            if (file) {
              void upload(file)
            }
          }}
          className={`mt-4 flex cursor-pointer flex-col items-center rounded-xl border border-dashed px-6 py-7 text-center transition-colors duration-150 ${
            dragging
              ? 'border-accent bg-accent-soft'
              : 'border-border hover:border-border-strong hover:bg-surface-2'
          }`}
        >
          <Icon name="upload" size={19} className="text-ink-subtle" />
          <span className="mt-2 text-[13px] font-medium">
            Déposez un fichier, ou cliquez pour le choisir
          </span>
          <span className="mt-1 text-xs text-ink-muted">
            {countOf(MAX_ATTACHMENTS - attachments.length, 'fichier')} encore possible
            {MAX_ATTACHMENTS - attachments.length > 1 ? 's' : ''}
          </span>

          <input
            id={inputId}
            type="file"
            accept=".pdf,.doc,.docx"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) {
                void upload(file)
              }
              // Cleared, so choosing the same file twice fires the event again.
              event.target.value = ''
            }}
          />
        </label>
      )}

      {attachments.length === 0 && disabled && (
        <p className="mt-4 text-[13px] text-ink-muted">Aucune pièce jointe.</p>
      )}

      {full && !disabled && (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-surface-2 px-3.5 py-2.5 text-xs text-ink-muted">
          <Icon name="info" size={13} className="mt-px" />
          <span>
            Vous avez atteint les {MAX_ATTACHMENTS} pièces jointes autorisées. Retirez-en
            une pour en ajouter une autre.
          </span>
        </p>
      )}

      {progress !== null && (
        <div className="mt-4">
          <Progress value={progress} label="Envoi de la pièce jointe" size="sm" />
          <p className="tabular mt-1.5 text-xs text-ink-muted">
            Envoi en cours… {progress}%
          </p>
        </div>
      )}

      <Modal
        open={added !== null}
        onClose={() => {
          setAdded(null)
        }}
        icon="check-circle"
        tone="success"
        title="Pièce jointe ajoutée"
        description={
          added && (
            <>
              <strong className="font-semibold text-ink">{added.name}</strong> sera jointe
              à chaque e-mail de cette campagne.
            </>
          )
        }
        footer={
          <Button
            variant="primary"
            onClick={() => {
              setAdded(null)
            }}
          >
            Très bien
          </Button>
        }
      >
        <div className="rounded-xl border border-border bg-surface-2 px-3.5 py-3 text-[13px]">
          <p className="flex items-center justify-between gap-3">
            <span className="text-ink-muted">Pièces jointes de la campagne</span>
            <span className="tabular font-semibold">
              {attachments.length} / {MAX_ATTACHMENTS}
            </span>
          </p>
          <ul className="mt-2.5 space-y-1">
            {attachments.map((file) => (
              <li key={file.id} className="flex items-center gap-2 text-ink-muted">
                <Icon name="paperclip" size={13} />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <span className="text-ink-subtle">{formatBytes(file.size)}</span>
              </li>
            ))}
          </ul>
        </div>
      </Modal>

      <ConfirmDialog
        open={toRemove !== null}
        onClose={() => {
          setToRemove(null)
        }}
        onConfirm={() => void remove()}
        busy={removing}
        tone="danger"
        icon="trash"
        title="Retirer cette pièce jointe ?"
        confirmLabel="Retirer"
        description={
          toRemove && (
            <>
              <strong className="font-semibold text-ink">{toRemove.name}</strong> ne sera
              plus jointe aux messages de cette campagne.
            </>
          )
        }
      />
    </Card>
  )
}
