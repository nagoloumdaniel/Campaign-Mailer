import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { campaignTypeIcon } from '@/components/campaign/campaignTypeIcon'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button, LinkButton } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { TextField } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { ApiError } from '@/services/api'
import {
  CAMPAIGN_TYPES,
  campaignTypeLabel,
  campaignsApi,
  type CampaignType,
  type StarterTemplate,
} from '@/services/campaigns'

const FROM_SCRATCH = 'vide'

/** What each type is for, in the words of someone choosing one. */
const TYPE_DESCRIPTIONS: Record<CampaignType, string> = {
  prospection:
    'Un premier contact avec des entreprises que vous ne connaissez pas encore.',
  relance: 'Un second message à des contacts déjà écrits.',
  alternance: 'Une candidature spontanée pour une alternance ou un stage.',
  marketing: 'Une annonce, une newsletter, le lancement d’un produit.',
  autre: 'Tout le reste. Vous pourrez changer ce type plus tard.',
}

/**
 * Creating a campaign: a name, a purpose, a starting point.
 *
 * Three decisions and no more, because everything else — the message, the
 * contacts, the pace — is better decided on the campaign's own page where the
 * preview is. A creation form that asks for all of it up front is a form
 * people abandon halfway.
 *
 * The type is asked here rather than left to a default, because it is what
 * the history groups by later, and a field nobody was asked for is a field
 * nobody fills in.
 */
export function CampaignNew() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [type, setType] = useState<CampaignType>('prospection')
  const [templates, setTemplates] = useState<StarterTemplate[]>([])
  const [chosen, setChosen] = useState<string>(FROM_SCRATCH)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void campaignsApi
      .templates()
      .then((catalogue) => {
        setTemplates(catalogue.templates)
      })
      .catch(() => {
        // A missing catalogue is not worth blocking creation: the user can
        // still start from an empty message and write their own.
        setTemplates([])
      })
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()

    if (submitting) {
      return
    }

    setSubmitting(true)
    setError(null)

    const template = templates.find((candidate) => candidate.id === chosen)

    try {
      const campaign = await campaignsApi.create({
        name: name.trim(),
        type,
        ...(template
          ? {
              subject: template.subject,
              body_text: template.bodyText,
              body_html: template.bodyHtml,
            }
          : {}),
      })

      void navigate(`/campaigns/${campaign.id}`, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'La création a échoué.')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="mx-auto max-w-2xl">
      <PageHeader
        title="Nouvelle campagne"
        description="Vous pourrez tout modifier ensuite : le message, les contacts et le rythme d’envoi."
        back={{ to: '/campaigns', label: 'Campagnes' }}
      />

      <div className="space-y-4">
        <Card as="section" className="p-5">
          <TextField
            label="Nom de la campagne"
            value={name}
            required
            maxLength={200}
            autoFocus
            placeholder="Candidatures alternance — septembre"
            onChange={(event) => {
              setName(event.target.value)
            }}
            note="Visible par vous seul. Les destinataires ne le voient pas."
          />
        </Card>

        <Card as="section" aria-labelledby="type-heading" className="p-5">
          <CardHeader
            id="type-heading"
            title="Type de campagne"
            description="Sert à regrouper l’historique et à retrouver une campagne parmi les autres."
          />

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {CAMPAIGN_TYPES.map((candidate) => (
              <Choice
                key={candidate}
                name="type"
                value={candidate}
                selected={type === candidate}
                onChoose={() => {
                  setType(candidate)
                }}
                title={campaignTypeLabel(candidate)}
                description={TYPE_DESCRIPTIONS[candidate]}
                icon={campaignTypeIcon[candidate]}
              />
            ))}
          </div>
        </Card>

        <Card as="section" aria-labelledby="starter-heading" className="p-5">
          <CardHeader
            id="starter-heading"
            title="Point de départ"
            description="Un modèle vous donne une structure à remplir. Tout reste modifiable ensuite."
          />

          <div className="mt-4 space-y-2">
            <Choice
              name="starter"
              value={FROM_SCRATCH}
              selected={chosen === FROM_SCRATCH}
              onChoose={() => {
                setChosen(FROM_SCRATCH)
              }}
              title="Partir de zéro"
              description="Un message vide, à écrire entièrement."
              icon="edit"
            />

            {templates.map((template) => (
              <Choice
                key={template.id}
                name="starter"
                value={template.id}
                selected={chosen === template.id}
                onChoose={() => {
                  setChosen(template.id)
                }}
                title={template.name}
                description={template.description}
                icon="file"
              />
            ))}
          </div>
        </Card>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 flex enter items-center gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger"
        >
          <Icon name="alert" size={15} />
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="primary"
          icon="plus"
          loading={submitting}
          disabled={name.trim() === ''}
        >
          Créer la campagne
        </Button>
        <LinkButton to="/campaigns" variant="ghost">
          Annuler
        </LinkButton>
      </div>
    </form>
  )
}

/**
 * A radio dressed as a card.
 *
 * The native input stays, hidden but present, so the whole group keeps its
 * keyboard behaviour: arrow keys move between the options and the label is
 * read out with its description.
 */
function Choice({
  name,
  value,
  selected,
  onChoose,
  title,
  description,
  icon,
}: {
  name: string
  value: string
  selected: boolean
  onChoose: () => void
  title: string
  description: string
  icon: Parameters<typeof Icon>[0]['name']
}) {
  return (
    <label
      className={`flex press cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors duration-150 ${
        selected
          ? 'border-accent bg-accent-soft'
          : 'border-border hover:border-border-strong hover:bg-surface-2'
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={selected}
        onChange={onChoose}
        className="sr-only"
      />

      <span
        aria-hidden="true"
        className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
          selected ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-ink-muted'
        }`}
      >
        <Icon name={icon} size={16} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">
          {description}
        </span>
      </span>

      {selected && <Icon name="check" size={16} className="mt-1 text-accent" />}
    </label>
  )
}
