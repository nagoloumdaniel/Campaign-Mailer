import { Card } from '@/components/ui/Card'
import { Icon } from '@/components/ui/Icon'
import { Progress } from '@/components/ui/Progress'
import type { Dashboard } from '@/services/dashboard'
import { countOf, formatNumber, formatPercent } from '@/services/format'
import { QUOTA_TONE, quotaLevel } from '@/services/quota'

/**
 * The account's 24-hour ceiling, as a meter.
 *
 * The one number on the dashboard that can stop everything else, so it gets
 * the size and the whole width of its column. Google blocks a personal Gmail
 * account past 500 messages over a rolling 24 hours; the application stops at
 * 450, which leaves room for what the user sends by hand from the same
 * mailbox.
 *
 * The bar changes colour as it fills, in four steps rather than as a
 * gradient, because the reader is not measuring a percentage — they are
 * deciding whether to do something. And it says so in words at every step:
 * the colour is the second channel, never the only one.
 *
 * Reaching the ceiling does not pause anything. The sending holds and resumes
 * by itself as the window frees, and the sentence under the bar says that,
 * because a campaign that is "running" and sending nothing looks broken.
 */
export function QuotaCard({
  account,
  plannedToday,
}: {
  account: Dashboard['account']
  /** What the live campaigns intend to send today, from their own paces. */
  plannedToday: number
}) {
  const used = Math.min(account.sentLast24h, account.dailyLimit)
  const level = quotaLevel(account.sentLast24h, account.dailyLimit)
  const tone = QUOTA_TONE[level]
  const share = account.dailyLimit > 0 ? account.sentLast24h / account.dailyLimit : 0

  return (
    <Card as="section" aria-labelledby="quota-heading" className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="quota-heading" className="text-[15px] font-semibold tracking-tight">
            Quota quotidien
          </h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            Sur les dernières 24 heures, toutes campagnes confondues.
          </p>
        </div>

        <span
          aria-hidden="true"
          className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${
            level === 'full'
              ? 'bg-danger-soft text-danger'
              : level === 'high'
                ? 'bg-warning-soft text-warning'
                : 'bg-accent-soft text-accent'
          }`}
        >
          <Icon name="gauge" size={18} />
        </span>
      </div>

      <p className="mt-5 flex items-baseline gap-2">
        <span className="tabular font-display text-4xl leading-none font-semibold tracking-tight">
          {formatNumber(account.sentLast24h)}
        </span>
        <span className="text-sm text-ink-muted">
          sur {formatNumber(account.dailyLimit)} autorisés
        </span>
      </p>

      <Progress
        value={used}
        max={account.dailyLimit}
        tone={tone}
        size="lg"
        label="Part du quota quotidien utilisée"
        className="mt-4"
      />

      <p className="tabular mt-2 flex items-center justify-between text-xs text-ink-muted">
        <span>{formatPercent(share)} utilisé</span>
        <span>{formatNumber(account.remaining)} restants</span>
      </p>

      <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4">
        <Figure label="Envoyés" value={formatNumber(account.sentLast24h)} />
        <Figure label="Planifiés" value={formatNumber(plannedToday)} />
        <Figure label="Restants" value={formatNumber(account.remaining)} />
      </dl>

      <p
        className={`mt-4 flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs leading-relaxed ${
          level === 'full'
            ? 'bg-danger-soft text-danger'
            : level === 'high'
              ? 'bg-warning-soft text-warning'
              : 'bg-surface-2 text-ink-muted'
        }`}
      >
        <Icon name={level === 'calm' ? 'info' : 'alert'} size={14} className="mt-px" />
        <span>
          {level === 'full'
            ? 'Plafond atteint. L’envoi reprend seul à mesure que la fenêtre de 24 heures se libère — rien n’est perdu, aucune campagne n’est mise en pause.'
            : level === 'high'
              ? `Il ne reste que ${countOf(account.remaining, 'envoi')} avant le plafond. Au-delà, l’envoi attend que la fenêtre se libère.`
              : `Le plafond de ${formatNumber(account.dailyLimit)} reste sous la limite de Gmail, qui bloque un compte personnel au-delà de 500 envois sur 24 heures.`}
        </span>
      </p>
    </Card>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-subtle">{label}</dt>
      <dd className="tabular mt-0.5 font-display text-lg font-semibold">{value}</dd>
    </div>
  )
}
