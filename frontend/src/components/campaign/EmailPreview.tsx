import { useMemo, useState } from 'react'

import { Avatar } from '@/components/layout/UserMenu'
import { Badge } from '@/components/ui/Badge'
import { IconButton } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Icon } from '@/components/ui/Icon'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import type { CampaignAttachment } from '@/services/campaigns'
import type { Contact } from '@/services/contacts'
import { formatBytes, formatNumber } from '@/services/format'
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
 * Drawn as a mail client draws an opened message — subject on top, the sender
 * beside an initial, the recipient under it, the attachments as tiles below the
 * body — because the question the user is asking is "what will they see", and
 * a form-like table of De / À / Objet answers a different one. A second view
 * narrows the body to a phone's width: most recruiters read their mail on one,
 * and a paragraph that looks fine at 700 pixels can be a wall at 375.
 *
 * The values come from the campaign's own contacts, and the arrows step
 * through the first few, because a merge that reads right for the first row
 * can still break on the third — an empty company, a name in capitals. With no
 * contacts imported yet it falls back to obviously fictional samples, never to
 * an empty preview: a message reading "Bonjour ," teaches nothing except that
 * something is broken.
 *
 * The body goes into a sandboxed iframe rather than into the page. Two
 * reasons, and both matter. It is a faithful preview: email HTML must not
 * inherit the application's stylesheet, or the message looks right here and
 * wrong in a mailbox. And it is isolation — this HTML is authored in a rich
 * editor whose dependency carries a known XSS advisory, and the values merged
 * into it come from a CSV file. An empty `sandbox` attribute blocks scripts,
 * forms and same-origin access, so nothing in it can reach the session.
 */

type Device = 'desktop' | 'mobile'

export function EmailPreview({
  subject,
  bodyHtml,
  senderEmail,
  contacts,
  attachments = [],
  className = '',
}: {
  subject: string
  bodyHtml: string
  senderEmail: string
  /** The campaign's first contacts, oldest first; empty before any import. */
  contacts: readonly Contact[]
  attachments?: CampaignAttachment[]
  className?: string
}) {
  const [device, setDevice] = useState<Device>('desktop')
  const [position, setPosition] = useState(0)

  // Clamped rather than reset: a contact list that shrinks under the cursor
  // should land on its last row, not jump back to the first.
  const index = Math.min(position, Math.max(0, contacts.length - 1))
  const contact = contacts[index] ?? null

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

  const recipient = [contact?.contactName, contact?.companyName]
    .filter(Boolean)
    .join(' · ')

  return (
    <Card as="section" aria-labelledby="preview-heading" className={`p-5 ${className}`}>
      <CardHeader
        id="preview-heading"
        title="Aperçu"
        description={
          contact
            ? 'Tel que vos contacts le recevront, variables remplacées.'
            : 'Avec des valeurs d’exemple, en attendant vos contacts.'
        }
        action={
          <SegmentedControl
            value={device}
            onChange={setDevice}
            label="Format de l’aperçu"
            size="sm"
            segments={[
              { value: 'desktop', label: 'Ordinateur', icon: 'monitor' },
              { value: 'mobile', label: 'Mobile', icon: 'smartphone' },
            ]}
          />
        }
      />

      <article
        aria-label="Message tel que reçu"
        className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface shadow-soft"
      >
        <header className="border-b border-border px-4 pt-4 pb-3.5">
          {/* Rendered as text: a mail client shows a subject literally. */}
          <h3 className="text-[17px] leading-snug font-semibold tracking-tight text-ink">
            {rendered.subject || (
              <em className="font-normal text-ink-subtle">(objet vide)</em>
            )}
          </h3>

          <div className="mt-3 flex items-center gap-3">
            {/* The same avatar as the account menu: the sender is the user. */}
            <Avatar email={senderEmail} size={36} />

            <div className="min-w-0 flex-1 text-[13px] leading-tight">
              <p className="truncate font-semibold text-ink">{senderEmail}</p>
              <p className="mt-1 truncate text-xs text-ink-muted">
                à <span className="text-ink">{merge.email}</span>
              </p>
            </div>

            <span className="shrink-0 text-xs text-ink-subtle">
              {attachments.length > 0 && (
                <Icon name="paperclip" size={13} className="me-1 inline align-[-2px]" />
              )}
              Maintenant
            </span>
          </div>
        </header>

        <div
          className={
            device === 'mobile' ? 'flex justify-center bg-surface-2 px-4 py-5' : ''
          }
        >
          <iframe
            title="Corps du message"
            sandbox=""
            srcDoc={htmlDocument(rendered.body, device)}
            className={
              device === 'mobile'
                ? // 375 pixels: the width of the phone most mail is read on.
                  'h-120 w-full max-w-93.75 rounded-panel border-[6px] border-ink/85 bg-white shadow-soft'
                : 'block h-104 w-full bg-white'
            }
          />
        </div>

        {attachments.length > 0 && (
          <footer className="border-t border-border px-4 py-3.5">
            <p className="text-xs font-medium text-ink-muted">
              {attachments.length === 1
                ? '1 pièce jointe'
                : `${formatNumber(attachments.length)} pièces jointes`}
            </p>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {attachments.map((file) => (
                <li
                  key={file.id}
                  className="flex min-w-0 items-center gap-2.5 rounded-xl border border-border bg-surface-2 px-2.5 py-2"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md bg-danger/10 text-[9px] font-bold text-danger uppercase"
                  >
                    {extensionOf(file.name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-ink">
                      {file.name}
                    </span>
                    {file.size !== null && (
                      <span className="block text-[11px] text-ink-subtle">
                        {formatBytes(file.size)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </footer>
        )}
      </article>

      <div className="mt-3 flex items-center gap-2">
        {contacts.length > 1 ? (
          <>
            <IconButton
              icon="chevron-left"
              label="Contact précédent"
              size="sm"
              variant="secondary"
              disabled={index === 0}
              onClick={() => {
                setPosition(index - 1)
              }}
            />
            <p className="min-w-0 flex-1 text-center text-xs text-ink-muted">
              <span className="tabular font-medium text-ink">
                Contact {formatNumber(index + 1)} sur {formatNumber(contacts.length)}
              </span>
              {recipient && <span className="block truncate">{recipient}</span>}
            </p>
            <IconButton
              icon="chevron-right"
              label="Contact suivant"
              size="sm"
              variant="secondary"
              disabled={index >= contacts.length - 1}
              onClick={() => {
                setPosition(index + 1)
              }}
            />
          </>
        ) : (
          <p className="flex flex-1 items-start gap-1.5 text-xs leading-relaxed text-ink-muted">
            <Icon name="info" size={13} className="mt-px shrink-0" />
            <span>
              Les valeurs affichées remplacent les variables&nbsp;: chaque destinataire
              recevra les siennes.
            </span>
          </p>
        )}

        <Badge tone={contact ? 'success' : 'neutral'} icon={contact ? 'users' : 'eye'}>
          {contact ? 'Vrai contact' : 'Exemple'}
        </Badge>
      </div>
    </Card>
  )
}

/** "pdf" from "CV Daniel.pdf", at most four letters; "doc" without one. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1, dot + 5) : 'doc'
}

/**
 * The body, wrapped in a document of its own.
 *
 * Without a wrapper the iframe inherits the browser's default 16px Times, and
 * a dark-theme reader sees black text on the white body this sets — which is
 * exactly what a mail client will show, and therefore the honest preview. The
 * phone view uses a phone client's larger type and tighter margins.
 */
function htmlDocument(body: string, device: Device): string {
  const mobile = device === 'mobile'

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1"><style>
    :root { color-scheme: light }
    body {
      margin: 0;
      padding: ${mobile ? '16px' : '20px 24px'};
      background: #ffffff;
      color: #1b1d21;
      font: ${mobile ? '16px/1.55' : '15px/1.6'} -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      word-break: break-word;
    }
    a { color: #1a56c4 }
    p { margin: 0 0 1em }
    :where(p, li):last-child { margin-bottom: 0 }
    img { max-width: 100%; height: auto }
  </style></head><body>${body || '<p style="color:#8b8f98">(message vide)</p>'}</body></html>`
}
