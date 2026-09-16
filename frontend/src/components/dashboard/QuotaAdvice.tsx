import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Icon } from '@/components/ui/Icon'
import { ConfirmDialog } from '@/components/ui/Modal'
import { ApiError } from '@/services/api'
import { campaignsApi, type Campaign } from '@/services/campaigns'
import { countOf, formatNumber } from '@/services/format'
import type { QuotaAdvice as Advice } from '@/services/quota'

/**
 * When the live campaigns ask for more than the day can give.
 *
 * Three campaigns set to 200 a day each add up to 600 against an allowance of
 * 450. Nothing refuses that: the send engine serves them in the order it
 * planned them, and the third sits at zero all day looking broken. The user
 * has no way to see why, because each campaign's own settings are perfectly
 * valid on their own — the conflict only exists between them.
 *
 * So the dashboard says it, in the only place where every campaign is
 * visible at once, and proposes a split proportional to what each has left.
 * It appears only when the sum actually exceeds the allowance; a panel that
 * is always there teaches the eye to skip the spot where a real warning would
 * appear.
 *
 * Applying it is two steps on purpose. The button opens a dialog that names
 * every campaign and both numbers, because this rewrites settings the user
 * chose by hand, on several campaigns at once, and a single click that
 * silently does that is not a kindness.
 */
export function QuotaAdvice({
  advice,
  onApplied,
}: {
  advice: Advice
  onApplied: (updated: Campaign[]) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const changing = advice.shares.filter((share) => share.suggested !== share.current)

  async function apply() {
    setBusy(true)

    try {
      // One request per campaign: the API has no bulk endpoint, and inventing
      // one for a button pressed a few times a month would be a route to keep
      // correct forever. They go together, so a slow connection does not
      // apply half the plan.
      const updated = await Promise.all(
        changing.map((share) =>
          campaignsApi.update(share.campaign.id, { mails_per_day: share.suggested }),
        ),
      )

      onApplied(updated)
      setConfirming(false)
      toast.success(`Rythme mis à jour sur ${countOf(updated.length, 'campagne')}.`)
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : 'La mise à jour n’a pas pu être appliquée. Réessayez.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card
        as="section"
        aria-labelledby="advice-heading"
        className="enter border-warning/40 bg-warning-soft/40 p-5"
      >
        <div className="flex items-start gap-3.5">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-warning-soft text-warning"
          >
            <Icon name="lightbulb" size={18} />
          </span>

          <div className="min-w-0 flex-1">
            <h2 id="advice-heading" className="text-[15px] font-semibold tracking-tight">
              Vos campagnes demandent plus que votre quota
            </h2>

            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
              Ensemble, elles prévoient{' '}
              <strong className="font-semibold text-ink">
                {formatNumber(advice.requested)} envois par jour
              </strong>{' '}
              alors que votre compte en autorise{' '}
              <strong className="font-semibold text-ink">
                {formatNumber(advice.limit)}
              </strong>
              . Les dernières servies n’enverront rien certains jours. Voici une
              répartition proportionnelle à ce qu’il reste à envoyer dans chacune.
            </p>

            <ul className="mt-4 space-y-2">
              {advice.shares.map((share) => (
                <li
                  key={share.campaign.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border border-border bg-surface px-3.5 py-2.5"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    {share.campaign.name}
                  </span>

                  <span className="tabular flex items-center gap-2 text-[13px]">
                    <span
                      className={
                        share.suggested === share.current
                          ? 'text-ink-muted'
                          : 'text-ink-subtle line-through'
                      }
                    >
                      {formatNumber(share.current)}
                    </span>
                    {share.suggested !== share.current && (
                      <>
                        <Icon
                          name="chevron-right"
                          size={13}
                          className="text-ink-subtle"
                        />
                        <span className="font-semibold text-accent">
                          {formatNumber(share.suggested)}
                        </span>
                      </>
                    )}
                    <span className="text-xs text-ink-muted">/ jour</span>
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                icon="check"
                onClick={() => {
                  setConfirming(true)
                }}
              >
                Mettre à jour
              </Button>
              <p className="text-xs text-ink-muted">
                Rien n’est modifié avant votre confirmation.
              </p>
            </div>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={confirming}
        onClose={() => {
          setConfirming(false)
        }}
        onConfirm={() => void apply()}
        busy={busy}
        icon="gauge"
        size="md"
        title="Appliquer la nouvelle répartition ?"
        confirmLabel="Confirmer et mettre à jour"
        description={
          <>
            Le rythme quotidien de {countOf(changing.length, 'campagne')} va changer.
            Chacune continuera d’envoyer, simplement à une cadence qui tient dans le quota
            du compte. Les campagnes mettront donc plus de temps à se terminer.
          </>
        }
      >
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {changing.map((share) => (
            <li
              key={share.campaign.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3.5 py-2.5"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                {share.campaign.name}
              </span>
              <span className="tabular flex items-center gap-2 text-[13px]">
                <span className="text-ink-muted">{formatNumber(share.current)}/jour</span>
                <Icon name="chevron-right" size={13} className="text-ink-subtle" />
                <span className="font-semibold text-accent">
                  {formatNumber(share.suggested)}/jour
                </span>
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-3 text-xs text-ink-muted">
          Vous pourrez ajuster chaque campagne individuellement à tout moment.
        </p>
      </ConfirmDialog>
    </>
  )
}
