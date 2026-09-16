import { useRef, useState } from 'react'
import ReactQuill from 'react-quill-new'

import 'react-quill-new/dist/quill.snow.css'

/*
 * This module is the application's heaviest single import: the rich text
 * editor and its stylesheet together are most of what a first visit
 * downloads, and the only page that needs them is this one. It is therefore
 * loaded lazily by the campaign editor, which is why the export below is a
 * default as well as a named one.
 */

import { Card, CardHeader } from '@/components/ui/Card'
import { Icon } from '@/components/ui/Icon'
import { TextField } from '@/components/ui/Field'

/**
 * Only what an email can actually render.
 *
 * Mail clients strip or ignore most of what a rich editor offers; a toolbar
 * that promises colours and fonts produces a message that looks nothing like
 * the preview once it lands in a mailbox.
 */
const TOOLBAR = [
  ['bold', 'italic', 'underline'],
  [{ list: 'bullet' }, { list: 'ordered' }],
  ['link'],
  ['clean'],
]

const MODULES = { toolbar: TOOLBAR }
const FORMATS = ['bold', 'italic', 'underline', 'list', 'link']

/** The four merge fields, with what each one is for. */
const VARIABLE_LABELS = new Map([
  ['salutation', 'Civilité'],
  ['contact_name', 'Nom du contact'],
  ['company_name', 'Entreprise'],
  ['email', 'Adresse'],
])

export interface EmailEditorProps {
  subject: string
  bodyHtml: string
  variables: string[]
  disabled: boolean
  onSubjectChange: (value: string) => void
  onBodyChange: (html: string, text: string) => void
}

/**
 * Where the message is written.
 *
 * The variable buttons insert at the cursor rather than at the end, and into
 * whichever field was last focused — appending would force the user to cut
 * and paste the token into the sentence they were in the middle of writing.
 *
 * Nothing here has a "preview" button. The panel beside this one follows the
 * keyboard, so there is no moment where the user has to ask to be shown what
 * they have just typed.
 */
export function EmailEditor({
  subject,
  bodyHtml,
  variables,
  disabled,
  onSubjectChange,
  onBodyChange,
}: EmailEditorProps) {
  const quillRef = useRef<ReactQuill>(null)
  const subjectRef = useRef<HTMLInputElement>(null)
  /** Which field a variable button should insert into. */
  const [target, setTarget] = useState<'subject' | 'body'>('body')

  function insert(name: string) {
    const token = `{{${name}}}`

    if (target === 'subject') {
      const input = subjectRef.current

      if (!input) {
        return
      }

      const at = input.selectionStart ?? subject.length
      onSubjectChange(subject.slice(0, at) + token + subject.slice(at))
      return
    }

    const editor = quillRef.current?.getEditor()

    if (!editor) {
      return
    }

    const at = editor.getSelection(true)?.index ?? editor.getLength()
    editor.insertText(at, token, 'user')
    editor.setSelection(at + token.length, 0)
  }

  return (
    <Card as="section" aria-labelledby="message-heading" className="p-5">
      <CardHeader
        id="message-heading"
        title="Message"
        description="Ce que chaque destinataire recevra. Les variables sont remplacées à l’envoi."
      />

      <TextField
        ref={subjectRef}
        label="Objet"
        value={subject}
        disabled={disabled}
        maxLength={500}
        placeholder="Candidature — {{company_name}}"
        onFocus={() => {
          setTarget('subject')
        }}
        onChange={(event) => {
          onSubjectChange(event.target.value)
        }}
        className="mt-5"
        hint={`${String(subject.length)} / 500`}
      />

      <div className="mt-5">
        <span className="text-[13px] font-medium text-ink">Corps du message</span>

        <div
          className="editor mt-1.5 overflow-hidden rounded-xl border border-border bg-surface transition-[border-color] duration-150 ease-out focus-within:border-accent"
          onFocus={() => {
            setTarget('body')
          }}
        >
          <ReactQuill
            ref={quillRef}
            theme="snow"
            value={bodyHtml}
            readOnly={disabled}
            modules={MODULES}
            formats={FORMATS}
            placeholder="Bonjour {{salutation}} {{contact_name}},"
            onChange={(html, _delta, _source, editor) => {
              // The text body is derived rather than written twice. Keeping
              // two editors in step is a chore users lose interest in, and a
              // message whose text part drifts from its HTML part is worse
              // than one with no text part at all.
              onBodyChange(html, editor.getText())
            }}
          />
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-border bg-surface-2 px-3.5 py-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-ink">
          <Icon name="plus" size={13} className="text-ink-muted" />
          Insérer une variable dans {target === 'subject' ? 'l’objet' : 'le message'}
        </p>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {variables.map((name) => (
            <button
              key={name}
              type="button"
              disabled={disabled}
              title={VARIABLE_LABELS.get(name) ?? name}
              onClick={() => {
                insert(name)
              }}
              className="press rounded-lg border border-border bg-surface px-2 py-1 font-mono text-[11px] text-ink-muted hover:border-accent/40 hover:text-accent disabled:opacity-50"
            >
              {`{{${name}}}`}
            </button>
          ))}
        </div>

        {/* The fallback syntax is the difference between "Bonjour Marie," and
            "Bonjour ," on a CSV that was missing a column. Worth saying where
            the user is writing, not in a help page. */}
        <p className="mt-2.5 text-xs leading-relaxed text-ink-muted">
          Ajoutez un repli après une barre verticale — par exemple{' '}
          <code className="rounded bg-surface px-1 font-mono text-[11px]">
            {'{{contact_name|à vous}}'}
          </code>{' '}
          — pour les contacts dont la valeur manque.
        </p>
      </div>
    </Card>
  )
}

export default EmailEditor
