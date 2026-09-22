import { useId, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import {
  addressBookApi,
  type BookContact,
  type ContactFields,
} from '@/services/addressBook'
import { ApiError } from '@/services/api'
import type { Campaign } from '@/services/campaigns'

/**
 * Adding a contact to the address book, or editing one.
 *
 * One dialog for both, because the four fields are the same four and a
 * difference in layout between "add" and "edit" is one the user has to learn
 * twice. Adding asks for a campaign, since a contact always belongs to one:
 * only drafts are offered, the same rule the campaign page applies.
 *
 * A refusal stays in the dialog, next to the field it is about, and what was
 * typed stays in place (see AddContactDialog for the same reasoning).
 */

type Form = {
  email: string
  contact_name: string
  company_name: string
  salutation: string
}

const EMPTY: Form = { email: '', contact_name: '', company_name: '', salutation: '' }

function formOf(contact: BookContact | null): Form {
  return contact
    ? {
        email: contact.email,
        contact_name: contact.contactName ?? '',
        company_name: contact.companyName ?? '',
        salutation: contact.salutation ?? '',
      }
    : EMPTY
}

export function ContactFormDialog({
  open,
  contact,
  drafts,
  onClose,
  onSaved,
}: {
  open: boolean
  /** The contact being edited, or null to add one. */
  contact: BookContact | null
  /** The campaigns a new contact may join: the drafts. */
  drafts: readonly Campaign[]
  onClose: () => void
  onSaved: (contact: BookContact) => void
}) {
  const formId = useId()
  const editing = contact !== null
  const [form, setForm] = useState<Form>(() => formOf(contact))
  const [campaignId, setCampaignId] = useState(drafts[0]?.id ?? '')
  const [saving, setSaving] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  function set(field: keyof Form, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
    if (field === 'email') {
      setEmailError(null)
    }
  }

  async function submit() {
    if (saving) {
      return
    }

    if (form.email.trim() === '') {
      setEmailError('Indiquez une adresse e-mail.')
      return
    }

    if (!editing && !campaignId) {
      setFailure('Choisissez la campagne où ajouter ce contact.')
      return
    }

    setSaving(true)
    setEmailError(null)
    setFailure(null)

    // Every field is sent when editing: an emptied field is a cleared one.
    const fields: ContactFields = {
      email: form.email.trim(),
      contact_name: form.contact_name.trim(),
      company_name: form.company_name.trim(),
      salutation: form.salutation.trim(),
    }

    try {
      onSaved(
        editing
          ? await addressBookApi.update(contact.id, fields)
          : await addressBookApi.create(campaignId, fields),
      )
    } catch (err) {
      apply(err)
    } finally {
      setSaving(false)
    }
  }

  function apply(err: unknown) {
    if (!(err instanceof ApiError)) {
      setFailure('L’enregistrement a échoué. Réessayez.')
      return
    }

    if (err.code === 'invalid_email' || err.status === 400) {
      setEmailError('Cette adresse e-mail n’est pas valide.')
    } else if (err.code === 'duplicate_email') {
      setEmailError('Cette adresse est déjà dans cette campagne.')
    } else if (err.code === 'campaign_not_editable') {
      setFailure(
        'La campagne a été lancée entre-temps : ses contacts ne peuvent plus être modifiés.',
      )
    } else if (err.status === 404) {
      setFailure('Ce contact ou cette campagne n’existe plus. Rechargez la page.')
    } else {
      setFailure(
        err.status === 0
          ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
          : 'L’enregistrement a échoué. Réessayez.',
      )
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={editing ? 'edit' : 'user'}
      title={editing ? 'Modifier le contact' : 'Ajouter un contact'}
      description={
        editing
          ? `Dans la campagne « ${contact.campaign.name} ».`
          : 'Il rejoint une campagne en brouillon. Seule l’adresse e-mail est obligatoire.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
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

        {!editing && (
          <Select
            label="Campagne"
            value={campaignId}
            onChange={setCampaignId}
            options={drafts.map((draft) => ({ value: draft.id, label: draft.name }))}
          />
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
          value={form.salutation}
          onChange={(event) => {
            set('salutation', event.target.value)
          }}
        />
      </form>
    </Modal>
  )
}
