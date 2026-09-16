import { useState } from 'react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/ui/Modal'
import { ApiError } from '@/services/api'
import { campaignsApi, type Campaign } from '@/services/campaigns'
import { countOf } from '@/services/format'

/**
 * Deleting a campaign, asked once and in full.
 *
 * The dialog names the campaign, says what goes with it, and says that it
 * cannot be undone — because all three are true and none of them is obvious
 * from a red button. Deleting cascades the contacts and the send log away, so
 * a user who deletes a finished campaign loses the record of who they already
 * wrote to, which is the part they are least expecting and most likely to
 * miss later.
 *
 * A running campaign cannot be deleted at all; the API refuses it, and the
 * dialog says why rather than offering a button that will fail.
 */
export function DeleteCampaignDialog({
  campaign,
  onClose,
  onDeleted,
}: {
  campaign: Campaign | null
  onClose: () => void
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function remove() {
    if (!campaign) {
      return
    }

    setBusy(true)

    try {
      await campaignsApi.remove(campaign.id)
      toast.success(`Campagne « ${campaign.name} » supprimée.`)
      onDeleted()
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : 'La suppression a échoué. Réessayez dans un instant.',
      )
    } finally {
      setBusy(false)
    }
  }

  const running = campaign?.status === 'running'

  return (
    <ConfirmDialog
      open={campaign !== null}
      onClose={onClose}
      onConfirm={() => void remove()}
      busy={busy}
      tone="danger"
      icon="trash"
      title={
        running ? 'Cette campagne est en cours d’envoi' : 'Supprimer cette campagne ?'
      }
      confirmLabel={running ? 'Supprimer quand même' : 'Supprimer définitivement'}
      description={
        running ? (
          <>
            Mettez d’abord{' '}
            <strong className="font-semibold text-ink">{campaign.name}</strong> en pause.
            Supprimer une campagne pendant qu’elle envoie effacerait le journal des
            messages déjà partis.
          </>
        ) : (
          campaign && (
            <>
              <strong className="font-semibold text-ink">{campaign.name}</strong> et tout
              ce qu’elle contient seront effacés.
            </>
          )
        )
      }
    >
      {campaign && !running && (
        <>
          <ul className="space-y-1.5 rounded-xl border border-border bg-surface-2 px-4 py-3 text-[13px] text-ink-muted">
            <li>Son message et ses pièces jointes.</li>
            <li>
              Ses {countOf(campaign.totalContacts, 'contact')} et le journal de chaque
              envoi.
            </li>
            {campaign.sentCount > 0 && (
              <li className="text-ink">
                Les {countOf(campaign.sentCount, 'e-mail')} déjà envoyés disparaîtront de
                votre historique. Les messages restent dans la boîte de leurs
                destinataires : supprimer la campagne ne les rappelle pas.
              </li>
            )}
          </ul>

          <p className="mt-3 text-xs text-ink-muted">
            Cette action est définitive. Exportez le journal depuis la campagne si vous
            voulez en garder une trace.
          </p>
        </>
      )}
    </ConfirmDialog>
  )
}
