import { useMemo, type ReactNode } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { Icon } from '@/components/ui/Icon'
import type { CampaignAttachment } from '@/services/campaigns'
import type { Contact } from '@/services/contacts'
import { formatBytes } from '@/services/format'
import { previewContact, renderHtml, renderText } from '@/services/merge'

/**
 * The message as a recipient will receive it, updated as it is typed.
 *
 * No "generate" button. The preview is the whole reason the editor is split
 * in two, and a preview you have to ask for is one you look at once and then
 * stop trusting. It re-renders on every keystroke, which costs one regular
 * expression pass over a few kilobytes — nothing next to what the editor
 * itself does on the same keystroke.
 *
 * The values come from the first contact of the campaign, because that is the
 * one case where the user can check the merge against something real: if the
 * CSV column was mapped to the wrong field, the very first row shows it. With
 * no contacts imported yet it falls back to obviously fictional samples,
 * never to an empty preview — a message reading "Bonjour ," teaches nothing
 * except that something is broken.
 *
 * The body goes into a sandboxed iframe rather than into the page. Two
 * reasons, and both matter. It is a faithful preview: email HTML must not
 * inherit the application's stylesheet, or the message looks right here and
 * wrong in a mailbox. And it is isolation — this HTML is authored in a rich
 * editor whose dependency carries a known XSS advisory, and the values merged
 * into it come from a CSV file. An empty `sandbox` attribute blocks scripts,
 * forms and same-origin access, so nothing in it can reach the session.
 */
export function EmailPreview({
  subject,
  bodyHtml,
  senderEmail,
  contact,
  attachments = [],
  className = '',
}: {
  subject: string
  bodyHtml: string
  senderEmail: string
  /** The campaign's first contact, or null before any import. */
  contact: Contact | null
  attachments?: CampaignAttachment[]
  className?: string
}) {
  const merge = useMemo(
    () =>
      previewContact(
        contact
          ? {
              salutation: contact.salutation,
              contact_name: contact.contactName,
              company_name: contact.companyName,
              email: contact.email,
            }
          : null,
      ),
    [contact],
  )

  const rendered = useMemo(
    () => ({
      subject: renderText(subject, merge),
      body: renderHtml(bodyHtml, merge),
    }),
    [subject, bodyHtml, merge],
  )

  return (
    <Card as="section" aria-labelledby="preview-heading" className={`p-5 ${className}`}>
      <CardHeader
        id="preview-heading"
        title="Aperçu"
        description={
          contact
            ? 'Rendu avec les informations de votre premier contact.'
            : 'Rendu avec des valeurs d’exemple, en attendant vos contacts.'
        }
        action={
          <Badge tone={contact ? 'success' : 'neutral'} icon={contact ? 'users' : 'eye'}>
            {contact ? 'Premier contact' : 'Exemple'}
          </Badge>
        }
      />

      <div className="mt-4 overflow-hidden rounded-xl border border-border">
        {/* The envelope, as a mail client shows it. */}
        <dl className="divide-y divide-border bg-surface-2 text-[13px]">
          <Row label="De">
            <span className="truncate">{senderEmail}</span>
          </Row>
          <Row label="À">
            <span className="truncate">{merge.email}</span>
          </Row>
          <Row label="Objet">
            {/* Rendered as text: a mail client shows a subject literally. */}
            <span className="truncate font-medium text-ink">
              {rendered.subject || <em className="text-ink-subtle">(objet vide)</em>}
            </span>
          </Row>
        </dl>

        <iframe
          title="Aperçu du message"
          sandbox=""
          srcDoc={htmlDocument(rendered.body)}
          className="h-[26rem] w-full border-t border-border bg-white"
        />

        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-2 border-t border-border bg-surface-2 px-3.5 py-3">
            {attachments.map((file) => (
              <li
                key={file.id}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1 text-xs"
              >
                <Icon name="paperclip" size={13} className="text-ink-muted" />
                <span className="max-w-40 truncate">{file.name}</span>
                {file.size !== null && (
                  <span className="text-ink-subtle">{formatBytes(file.size)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-ink-muted">
        <Icon name="info" size={13} className="mt-px" />
        <span>
          Les valeurs affichées ici remplacent les variables&nbsp;: chaque destinataire
          recevra les siennes.
        </span>
      </p>
    </Card>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 px-3.5 py-2">
      <dt className="w-12 shrink-0 text-ink-subtle">{label}</dt>
      <dd className="min-w-0 flex-1 text-ink-muted">{children}</dd>
    </div>
  )
}

/**
 * The body, wrapped in a document of its own.
 *
 * Without a wrapper the iframe inherits the browser's default 16px Times, and
 * a dark-theme reader sees black text on the white body this sets — which is
 * exactly what a mail client will show, and therefore the honest preview.
 */
function htmlDocument(body: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
    :root { color-scheme: light }
    body {
      margin: 0;
      padding: 20px;
      background: #ffffff;
      color: #1b1d21;
      font: 15px/1.6 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      word-break: break-word;
    }
    a { color: #1a56c4 }
    p { margin: 0 0 1em }
    :where(p, li):last-child { margin-bottom: 0 }
    img { max-width: 100% }
  </style></head><body>${body || '<p style="color:#8b8f98">(message vide)</p>'}</body></html>`
}
