import { campaignTypeLabel, statusLabel, type Campaign } from './campaigns'

/**
 * The exports the browser builds itself.
 *
 * Two of them go through the API instead — a campaign's send log and the
 * history — because those are rows the browser does not hold and should not
 * have to fetch page by page to assemble. What is left is the summary of what
 * is already on screen, and building it here spares the API a route whose
 * only reader is a button.
 *
 * Two dangers, both about what a spreadsheet does with a cell, and both
 * handled the same way the server handles them. A campaign name was typed by
 * the user and may start with `=`, which a spreadsheet runs as a formula — the
 * classic CSV injection. And a comma, a quote or a newline inside a value
 * would shift every column after it. Every cell is therefore neutralised and
 * quoted, without exception.
 */

/** Characters a spreadsheet reads as the start of a formula or a control. */
const FORMULA_START = /^[=+\-@\t\r]/

export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

export function toCsv(header: readonly string[], rows: readonly string[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(','))
  // A BOM, so Excel reads the accents as UTF-8; CRLF, as RFC 4180 specifies.
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

/**
 * Hands the browser a file.
 *
 * The object URL is revoked on the next frame rather than immediately:
 * revoking it in the same tick cancels the download in Firefox, which has not
 * started reading it yet.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = filename
  link.click()

  requestAnimationFrame(() => {
    URL.revokeObjectURL(url)
  })
}

/** `campagnes-2026-09-16.csv`, so two exports do not overwrite each other. */
function dated(prefix: string): string {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}.csv`
}

function iso(value: string | null): string {
  return value ? new Date(value).toLocaleString('fr-FR') : ''
}

/** Every campaign and its figures: the summary behind the dashboard. */
export function exportCampaignsCsv(campaigns: readonly Campaign[]): void {
  const csv = toCsv(
    [
      'campagne',
      'type',
      'statut',
      'contacts',
      'envoyes',
      'erreurs',
      'restants',
      'taux_de_reussite',
      'envois_par_jour',
      'heure_de_depart',
      'fuseau',
      'creee_le',
      'lancee_le',
      'terminee_le',
    ],
    campaigns.map((campaign) => {
      const attempted = campaign.sentCount + campaign.errorCount
      const remaining = Math.max(
        0,
        campaign.totalContacts - campaign.sentCount - campaign.errorCount,
      )

      return [
        campaign.name,
        campaignTypeLabel(campaign.type),
        statusLabel(campaign.status),
        String(campaign.totalContacts),
        String(campaign.sentCount),
        String(campaign.errorCount),
        String(remaining),
        attempted > 0 ? `${((campaign.sentCount / attempted) * 100).toFixed(1)} %` : '',
        String(campaign.mailsPerDay),
        `${String(campaign.startHour).padStart(2, '0')}:00`,
        campaign.timezone,
        iso(campaign.createdAt),
        iso(campaign.startedAt),
        iso(campaign.completedAt),
      ]
    }),
  )

  downloadCsv(dated('campagnes'), csv)
}
