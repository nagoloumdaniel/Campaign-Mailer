import { Badge, type BadgeTone } from '@/components/ui/Badge'
import type { IconName } from '@/components/ui/Icon'
import {
  campaignTypeLabel,
  statusLabel,
  type CampaignStatus,
  type CampaignType,
} from '@/services/campaigns'

import { campaignTypeIcon } from './campaignTypeIcon'

/**
 * Where a campaign is, and what it is for.
 *
 * Two badges, never one: the state changes on its own and the type never
 * does, so folding them together would make a label that sometimes means a
 * lifecycle and sometimes a category.
 *
 * Colour is the second channel in both. Each badge always carries its word,
 * and the running one carries a dot as well, so "en cours" is recognisable at
 * a glance without relying on a hue.
 */

const STATUS_TONE: Record<CampaignStatus, BadgeTone> = {
  draft: 'neutral',
  scheduled: 'info',
  running: 'accent',
  paused: 'warning',
  completed: 'success',
}

const STATUS_ICON: Record<CampaignStatus, IconName | undefined> = {
  draft: 'edit',
  scheduled: 'clock',
  running: undefined,
  paused: 'pause',
  completed: 'check-circle',
}

export function StatusBadge({ status }: { status: CampaignStatus }) {
  const icon = STATUS_ICON[status]

  return (
    <Badge
      tone={STATUS_TONE[status]}
      dot={status === 'running'}
      {...(icon ? { icon } : {})}
    >
      {statusLabel(status)}
    </Badge>
  )
}

export function TypeBadge({ type }: { type: CampaignType }) {
  return (
    <Badge tone="neutral" icon={campaignTypeIcon[type]}>
      {campaignTypeLabel(type)}
    </Badge>
  )
}
