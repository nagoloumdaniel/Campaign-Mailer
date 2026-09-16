import type { IconName } from '@/components/ui/Icon'
import type { CampaignType } from '@/services/campaigns'

/**
 * One glyph per campaign type, in its own module.
 *
 * Kept out of the badge component so that file exports components only, which
 * is what Vite's fast refresh needs to swap a component without reloading the
 * page — and so the creation form can draw the same icon without importing a
 * badge it does not render.
 */
export const campaignTypeIcon: Record<CampaignType, IconName> = {
  prospection: 'send',
  relance: 'refresh',
  marketing: 'chart',
  alternance: 'building',
  autre: 'flag',
}
