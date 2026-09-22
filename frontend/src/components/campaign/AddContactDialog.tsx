import { useId, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import { ApiError } from '@/services/api'
import { contactsApi, type MappedRow } from '@/services/contacts'

/**
 * Adding one contact by hand, or editing one: the same dialog in a campaign
 * and on the Contacts page (owner's request, 22 September 2026: the same
 * fields, nothing more, nothing less).
 *
 * The import exists for a list; this exists for the one address that arrives
 * after it — a name met at a forum, a second contact at a company already in
 * the campaign. Writing a one-line CSV to add it is the kind of chore that
 * makes people keep their real list somewhere else.
 *
 * The four fields are the four a contact has, so anything the template merges
 * can be filled in here. Only the address is required: a message written with
 * `{{contact_name|Bonjour}}` sends perfectly well without a name, and asking
 * for one would be inventing a rule the import does not have.
 *
 * Both answers stay in the dialog rather than becoming a toast. A failure has
 * to be read next to the field that caused it and leave what was typed in
 * place, and the confirmation carries the one action that follows an add —
 * adding the next one — which a toast that slides away cannot offer.
 */

const EMPTY = {
  email: '',
  contact_name: '',
  company_name: '',
  salutation: '',
}

type Form = typeof EMPTY

/** Where the contact goes: a campaign's recipients, or the account's contacts. */
type Target = 'campaign' | 'book'

const WORDING: Record<Target, { intro: string; added: string; duplicate: string }> = {
  campaign: {
    intro:
      'Il s’ajoute à la suite des contacts existants. Seule l’adresse e-mail est obligatoire.',
    added: 'rejoint les destinataires de cette campagne, en attente d’envoi.',
    duplicate: 'Cette adresse est déjà dans la campagne.',
  },
  book: {
    intro: 'Il rejoint vos contacts. Seule l’adresse e-mail est obligatoire.',
    added: 'est enregistré dans vos contacts.',
    duplicate: 'Cette adresse est déjà dans vos contacts.',
  },
}

function formOf(initial: MappedRow | undefined): Form {
  return initial
    ? {
        email: initial.email,
        contact_name: initial.contact_name ?? '',
        company_name: initial.company_name ?? '',
        salutation: initial.salutation ?? '',
      }
    : EMPTY
}

export function AddContactDialog({
  open,
  onClose,
  onAdded,
  campaignId,
  save,
  initial,
  target = 'campaign',
}: {
  open: boolean
  onClose: () => void
  /** The table and the counts move when a contact lands or changes. */
  onAdded: () => void
  /** Adds to this campaign, unless `save` says otherwise. */
  campaignId?: string | undefined
  /** How the contact is saved, for a use other than a campaign's add. */
  save?: ((row: MappedRow) => Promise<{ email: string }>) | undefined
  /** The contact being edited; absent to add one. */
  initial?: MappedRow | undefined
  target?: Target
}) {
  const formId = useId()
  const editing = initial !== undefined
  const wording = WORDING[target]
  const [form, setForm] = useState<Form>(() => formOf(initial))
  const [saving, setSaving] = useState(false)
  /** Shown under the address field, where the address is the problem. */
  const [emailError, setEmailError] = useState<string | null>(null)
  /** Shown above the fields, for a refusal that is not about one field. */
  const [failure, setFailure] = useState<string | null>(null)
  const [added, setAdded] = useState<{ email: string } | null>(null)

  function set(field: keyof Form, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
    if (field === 'email') {
      setEmailError(null)
    }
  }

  function clear() {
    setForm(formOf(initial))
    setEmailError(null)
    setFailure(null)
    setAdded(null)
    setSaving(false)
  }

  function dismiss() {
    clear()
    onClose()
  }

  async function submit() {
    if (saving) {
      return
    }

    // A first pass here only so the obvious mistake does not cost a round trip.
    // The server validates every address again, and it has the last word.
    if (form.email.trim() === '') {
      setEmailError('Indiquez une adresse e-mail.')
      return
    }

    setSaving(true)
    setEmailError(null)
    setFailure(null)

    const payload: MappedRow = { email: form.email.trim() }

    for (const field of ['contact_name', 'company_name', 'salutation'] as const) {
      const value = form[field].trim()
      // Editing sends every field: an emptied one is a cleared one.
      if (value !== '' || editing) {
        payload[field] = value
      }
    }

    try {
      const saved = save
        ? await save(payload)
        : await contactsApi.add(campaignId ?? '', payload)
      setAdded(saved)
      onAdded()
    } catch (err) {
      apply(err)
    } finally {
      setSaving(false)
    }
  }

  /** Turns the refusal into the sentence that says what to do about it. */
  function apply(err: unknown) {
    if (!(err instanceof ApiError)) {
      setFailure('Le contact n’a pas pu être enregistré. Réessayez.')
      return
    }

    if (err.code === 'invalid_email' || err.status === 400) {
      setEmailError('Cette adresse e-mail n’est pas valide.')
      return
    }

    if (err.code === 'duplicate_email') {
      setEmailError(wording.duplicate)
      return
    }

    if (err.code === 'campaign_not_editable') {
      // The campaign was launched somewhere else while this dialog was open.
      setFailure(
        'Cette campagne n’accepte plus de nouveaux contacts : elle a été lancée. Rechargez la page.',
      )
      return
    }

    setFailure(
      err.status === 0
        ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
        : err.status === 404
          ? 'Ce contact n’existe plus. Rechargez la page.'
          : 'Le contact n’a pas pu être enregistré. Réessayez.',
    )
  }

  if (added) {
    return (
      <Modal
        open={open}
        onClose={dismiss}
        icon="check-circle"
        tone="success"
        title={editing ? 'Contact modifié' : 'Contact ajouté'}
        description={
          <>
            <strong className="font-semibold text-ink">{added.email}</strong>{' '}
            {editing
              ? 'est à jour. Les campagnes à venir utiliseront ces informations ; les messages déjà envoyés ne changent pas.'
              : wording.added}
          </>
        }
        footer={
          <>
            {!editing && (
              <Button variant="ghost" icon="plus" onClick={clear}>
                Ajouter un autre contact
              </Button>
            )}
            <Button variant="primary" onClick={dismiss}>
              Terminé
            </Button>
          </>
        }
      />
    )
  }

  return (
    <Modal
      open={open}
      onClose={dismiss}
      icon={editing ? 'edit' : 'user'}
      title={editing ? 'Modifier le contact' : 'Ajouter un contact'}
      description={
        editing
          ? 'Les campagnes à venir utiliseront ces informations ; les messages déjà envoyés ne changent pas.'
          : wording.intro
      }
      footer={
        <>
          <Button variant="ghost" onClick={dismiss} disabled={saving}>
            Annuler
          </Button>
          <Button
            variant="primary"
            icon={editing ? 'check' : 'plus'}
            type="submit"
            form={formId}
            loading={saving}
          >
            {editing ? 'Enregistrer' : 'Ajouter le contact'}
          </Button>
        </>
      }
    >
      {/* A real form, so Enter in any field adds the contact. `noValidate`
          because the browser's own bubble says "include an @" in the language
          of the browser rather than of the page, and disappears on a click. */}
      <form
        id={formId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        className="space-y-3.5"
      >
        {failure && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-3 text-[13px] text-danger"
          >
            <Icon name="alert" size={15} className="mt-px shrink-0" />
            <span>{failure}</span>
          </p>
        )}

        <TextField
          label="Adresse e-mail"
          type="email"
          inputMode="email"
          autoComplete="off"
          autoFocus
          placeholder="camille.martin@exemple.fr"
          value={form.email}
          error={emailError}
          onChange={(event) => {
            set('email', event.target.value)
          }}
        />

        <TextField
          label="Nom du contact"
          hint="Facultatif"
          autoComplete="off"
          placeholder="Camille Martin"
          note="Remplace {{contact_name}} dans votre message."
          value={form.contact_name}
          onChange={(event) => {
            set('contact_name', event.target.value)
          }}
        />

        <TextField
          label="Entreprise"
          hint="Facultatif"
          autoComplete="off"
          placeholder="Société Exemple"
          note="Remplace {{company_name}}."
          value={form.company_name}
          onChange={(event) => {
            set('company_name', event.target.value)
          }}
        />

        <TextField
          label="Civilité"
          hint="Facultatif"
          autoComplete="off"
          placeholder="Madame"
          note="Remplace {{salutation}}."
          value={form.salutation}
          onChange={(event) => {
            set('salutation', event.target.value)
          }}
        />
      </form>
    </Modal>
  )
}
