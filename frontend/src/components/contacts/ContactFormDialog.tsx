import { useId, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import {
  addressBookApi,
  type BookContact,
  type ContactFields,
} from '@/services/addressBook'
import { ApiError } from '@/services/api'
import { campaignsApi, type Campaign } from '@/services/campaigns'

/**
 * Adding a contact to the address book, or editing one.
 *
 * One dialog for both, because the four fields are the same four and a
 * difference in layout between "add" and "edit" is one the user has to learn
 * twice. A contact always belongs to a campaign, so adding asks for one: a
 * draft, or a new campaign named on the spot. Without that second choice the
 * button would be dead on an account with no draft, which is exactly the
 * account that most needs to add someone.
 *
 * The dialog has three faces. The form; a confirmation once the contact is
 * saved, which carries the next action (add another, or close); and an error
 * that says what went wrong and leads back to the form with everything typed
 * still in place. A toast would slide away before a user who looked at the
 * keyboard read it.
 */

type Form = {
  email: string
  contact_name: string
  company_name: string
  salutation: string
}

const EMPTY: Form = { email: '', contact_name: '', company_name: '', salutation: '' }

/** The campaign select's value for "create a new campaign". */
const NEW_CAMPAIGN = '__new__'

type Face =
  | { kind: 'form' }
  | { kind: 'saved'; contact: BookContact; campaignName: string }
  | { kind: 'error'; message: string }

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
  onCampaignCreated,
}: {
  open: boolean
  /** The contact being edited, or null to add one. */
  contact: BookContact | null
  /** The campaigns a new contact may join: the drafts. */
  drafts: readonly Campaign[]
  onClose: () => void
  /** Called as soon as the contact is saved, so the list behind reloads. */
  onSaved: (contact: BookContact) => void
  /** A campaign was created from this dialog: the page adds it to its lists. */
  onCampaignCreated: (campaign: Campaign) => void
}) {
  const formId = useId()
  const editing = contact !== null
  const [form, setForm] = useState<Form>(() => formOf(contact))
  const [campaignId, setCampaignId] = useState(drafts[0]?.id ?? NEW_CAMPAIGN)
  const [newCampaignName, setNewCampaignName] = useState('')
  const [saving, setSaving] = useState(false)
  const [face, setFace] = useState<Face>({ kind: 'form' })
  const [emailError, setEmailError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)

  const creatingCampaign = !editing && campaignId === NEW_CAMPAIGN

  function set(field: keyof Form, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
    if (field === 'email') {
      setEmailError(null)
    }
  }

  /** Back to an empty form, for the next contact, in the same campaign. */
  function another() {
    setForm(EMPTY)
    setEmailError(null)
    setFace({ kind: 'form' })
  }

  async function submit() {
    if (saving) {
      return
    }

    // A first pass here only so the obvious mistake does not cost a round
    // trip. The server validates everything again and has the last word.
    if (form.email.trim() === '') {
      setEmailError('Indiquez une adresse e-mail.')
      return
    }

    if (creatingCampaign && newCampaignName.trim() === '') {
      setNameError('Donnez un nom à la nouvelle campagne.')
      return
    }

    setSaving(true)

    // Every field is sent: an emptied field is a cleared one.
    const fields: ContactFields = {
      email: form.email.trim(),
      contact_name: form.contact_name.trim(),
      company_name: form.company_name.trim(),
      salutation: form.salutation.trim(),
    }

    try {
      if (editing) {
        const saved = await addressBookApi.update(contact.id, fields)
        onSaved(saved)
        setFace({ kind: 'saved', contact: saved, campaignName: saved.campaign.name })
        return
      }

      let target = drafts.find((draft) => draft.id === campaignId)

      if (!target) {
        // Created first, then selected: if adding the contact fails, a retry
        // uses this campaign rather than creating a second one.
        target = await campaignsApi.create({ name: newCampaignName.trim().slice(0, 200) })
        onCampaignCreated(target)
        setCampaignId(target.id)
      }

      const saved = await addressBookApi.create(target.id, fields)
      onSaved(saved)
      setFace({ kind: 'saved', contact: saved, campaignName: target.name })
    } catch (err) {
      setFace({ kind: 'error', message: explain(err) })
    } finally {
      setSaving(false)
    }
  }

  /** Turns the refusal into the sentence that says what to do about it. */
  function explain(err: unknown): string {
    if (!(err instanceof ApiError)) {
      return 'L’enregistrement a échoué. Réessayez.'
    }

    if (err.code === 'invalid_email' || err.status === 400) {
      setEmailError('Cette adresse e-mail n’est pas valide.')
      return 'Cette adresse e-mail n’est pas valide. Corrigez-la, puis réessayez.'
    }

    if (err.code === 'duplicate_email') {
      setEmailError('Cette adresse est déjà dans cette campagne.')
      return 'Cette adresse est déjà dans cette campagne. Choisissez-en une autre, ou une autre campagne.'
    }

    if (err.code === 'campaign_not_editable') {
      return 'La campagne a été lancée entre-temps : ses contacts ne peuvent plus être modifiés.'
    }

    if (err.status === 404) {
      return 'Ce contact ou cette campagne n’existe plus. Rechargez la page.'
    }

    return err.status === 0
      ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
      : 'L’enregistrement a échoué. Réessayez.'
  }

  if (face.kind === 'saved') {
    return (
      <Modal
        open={open}
        onClose={onClose}
        icon="check-circle"
        tone="success"
        title={editing ? 'Contact modifié' : 'Contact ajouté'}
        description={
          <>
            <strong className="font-semibold text-ink">{face.contact.email}</strong>{' '}
            {editing
              ? 'a bien été enregistré.'
              : `rejoint la campagne « ${face.campaignName} », en attente d’envoi.`}
          </>
        }
        footer={
          <>
            {!editing && (
              <Button variant="ghost" icon="plus" onClick={another}>
                Ajouter un autre contact
              </Button>
            )}
            <Button variant="primary" onClick={onClose}>
              Terminé
            </Button>
          </>
        }
      />
    )
  }

  if (face.kind === 'error') {
    return (
      <Modal
        open={open}
        onClose={onClose}
        icon="alert"
        tone="danger"
        title={
          editing ? 'Le contact n’a pas été modifié' : 'Le contact n’a pas été ajouté'
        }
        description={face.message}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Fermer
            </Button>
            <Button
              variant="primary"
              icon="edit"
              onClick={() => {
                setFace({ kind: 'form' })
              }}
            >
              Revenir au formulaire
            </Button>
          </>
        }
      />
    )
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
          : 'Il rejoint une campagne en brouillon, existante ou nouvelle. Seule l’adresse e-mail est obligatoire.'
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
      {/* A real form, so Enter in any field submits. `noValidate` because the
          browser's own bubble speaks the browser's language, not the page's. */}
      <form
        id={formId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        className="space-y-3.5"
      >
        {!editing && (
          <>
            <Select
              label="Campagne"
              value={campaignId}
              onChange={(value) => {
                setCampaignId(value)
                setNameError(null)
              }}
              options={[
                ...drafts.map((draft) => ({ value: draft.id, label: draft.name })),
                { value: NEW_CAMPAIGN, label: 'Nouvelle campagne…' },
              ]}
            />

            {creatingCampaign && (
              <TextField
                label="Nom de la nouvelle campagne"
                autoComplete="off"
                placeholder="Candidatures alternance, octobre"
                maxLength={200}
                value={newCampaignName}
                error={nameError}
                note="Créée en brouillon : vous rédigerez le message avant de la lancer."
                onChange={(event) => {
                  setNewCampaignName(event.target.value)
                  setNameError(null)
                }}
              />
            )}
          </>
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

        <div className="grid gap-3.5 sm:grid-cols-2">
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
        </div>

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
