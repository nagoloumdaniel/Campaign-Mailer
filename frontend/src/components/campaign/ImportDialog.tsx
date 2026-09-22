import Papa from 'papaparse'
import { useId, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import { Progress } from '@/components/ui/Progress'
import { Select } from '@/components/ui/Select'
import { ApiError } from '@/services/api'
import {
  contactsApi,
  reasonLabel,
  type ImportReport,
  type MappedRow,
} from '@/services/contacts'
import { countOf, formatNumber } from '@/services/format'

/**
 * Importing a CSV, in three steps that are one dialog.
 *
 * Choose a file, check that the columns landed in the right fields, import.
 * The middle step is the one that matters: a mapping off by one column is
 * obvious in five preview rows and invisible in a report of five hundred
 * rejections, so the preview is shown before anything is sent rather than
 * after.
 *
 * The import **adds** to the campaign; it never replaces. A second file is a
 * second batch of contacts, which is how anyone who exports a directory in
 * pieces expects it to work — and the confirmation says how many were added
 * rather than how many the campaign now holds, because the first number is
 * the one that tells them the file was read correctly.
 */

/** The four fields a contact has, in the order they read. */
const FIELDS = [
  { key: 'email', label: 'Adresse e-mail', required: true },
  { key: 'contact_name', label: 'Nom du contact', required: false },
  { key: 'company_name', label: 'Entreprise', required: false },
  { key: 'salutation', label: 'Civilité', required: false },
] as const

type FieldKey = (typeof FIELDS)[number]['key']

const NOT_MAPPED = ''

interface Parsed {
  fileName: string
  columns: string[]
  rows: Record<string, string>[]
}

/**
 * Guesses which column holds which field.
 *
 * Most exports use one of a handful of headers, and getting it right on the
 * first try is the difference between an import and a form to fill in.
 */
const HINTS: Record<FieldKey, string[]> = {
  email: ['email', 'e-mail', 'mail', 'adresse', 'address'],
  contact_name: ['nom', 'name', 'contact', 'prenom', 'prénom', 'firstname', 'lastname'],
  company_name: [
    'entreprise',
    'societe',
    'société',
    'company',
    'organisation',
    'organization',
  ],
  salutation: ['civilite', 'civilité', 'salutation', 'titre', 'title'],
}

function guessMapping(columns: string[]): Record<FieldKey, string> {
  const used = new Set<string>()
  const mapping = {} as Record<FieldKey, string>

  for (const field of FIELDS) {
    const hints = HINTS[field.key]
    const match = columns.find((column) => {
      if (used.has(column)) {
        return false
      }
      const normalised = column.trim().toLowerCase()
      return hints.some((hint) => normalised === hint || normalised.includes(hint))
    })

    mapping[field.key] = match ?? NOT_MAPPED
    if (match) {
      used.add(match)
    }
  }

  return mapping
}

export function ImportDialog({
  open,
  campaignId,
  existingCount = 0,
  onClose,
  onImported,
  importRows,
}: {
  open: boolean
  /** The campaign the rows go into, unless `importRows` sends them elsewhere. */
  campaignId?: string | undefined
  /** How many contacts the campaign already holds, so the dialog can say "ajoutés à". */
  existingCount?: number
  onClose: () => void
  onImported: () => void
  /**
   * Sends the mapped rows somewhere other than a campaign: the Contacts page
   * imports into the account's contacts with the very same dialog.
   */
  importRows?:
    | ((
        rows: MappedRow[],
        onProgress: (done: number, total: number) => void,
      ) => Promise<ImportReport>)
    | undefined
}) {
  const intoBook = importRows !== undefined
  const inputId = useId()
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [mapping, setMapping] = useState<Record<FieldKey, string>>({
    email: '',
    contact_name: '',
    company_name: '',
    salutation: '',
  })
  const [dragging, setDragging] = useState(false)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [report, setReport] = useState<ImportReport | null>(null)

  function reset() {
    setParsed(null)
    setReport(null)
    setImporting(false)
    setProgress(0)
  }

  function read(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      // Papa strips the byte order mark Excel writes, which would otherwise
      // prefix the first column name with an invisible character and break
      // every mapping. It also detects a semicolon separator on its own, which
      // is what a French Excel export produces.
      complete: (result) => {
        const columns = (result.meta.fields ?? []).filter((field) => field.trim() !== '')

        if (columns.length === 0 || result.data.length === 0) {
          toast.error('Ce fichier ne contient aucune ligne exploitable.')
          return
        }

        setParsed({ fileName: file.name, columns, rows: result.data })
        setMapping(guessMapping(columns))
      },
      error: () => {
        toast.error('Ce fichier n’a pas pu être lu.')
      },
    })
  }

  async function run() {
    if (!parsed || importing) {
      return
    }

    setImporting(true)
    setProgress(0)

    try {
      const rows: MappedRow[] = parsed.rows.map((row) => {
        const mapped: MappedRow = { email: row[mapping.email] ?? '' }

        for (const field of FIELDS) {
          if (field.key === 'email') {
            continue
          }
          const column = mapping[field.key]
          const value = column ? row[column] : undefined
          if (value) {
            mapped[field.key] = value
          }
        }

        return mapped
      })

      const onProgress = (done: number, total: number) => {
        setProgress(Math.round((done / total) * 100))
      }
      const result = importRows
        ? await importRows(rows, onProgress)
        : await contactsApi.import(campaignId ?? '', rows, { onProgress })

      setReport(result)
      setParsed(null)
      onImported()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'L’import a échoué.')
    } finally {
      setImporting(false)
    }
  }

  const emailMapped = mapping.email !== NOT_MAPPED

  // The confirmation, once the rows are in. A dialog of its own rather than a
  // toast: a partial import has a report to read, and a toast that slides
  // away takes it with it.
  if (report) {
    return (
      <Modal
        open={open}
        onClose={() => {
          reset()
          onClose()
        }}
        icon={report.rejected.length === 0 ? 'check-circle' : 'alert'}
        tone={report.rejected.length === 0 ? 'success' : 'warning'}
        size="md"
        title={`${countOf(report.imported, 'nouveau contact', 'nouveaux contacts')} ajouté${report.imported > 1 ? 's' : ''}`}
        description={
          intoBook ? (
            <>
              Ils ont été <strong className="font-semibold text-ink">ajoutés</strong> à
              vos contacts.
              {(report.known ?? 0) > 0 &&
                ` ${countOf(report.known ?? 0, 'adresse était', 'adresses étaient')} déjà dans vos contacts : leurs informations sont conservées, seuls les champs vides ont été complétés.`}
            </>
          ) : (
            <>
              Ils ont été <strong className="font-semibold text-ink">ajoutés</strong> à la
              suite de vos contacts existants — rien n’a été remplacé. La campagne en
              compte maintenant {formatNumber(existingCount + report.imported)}.
            </>
          )
        }
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                reset()
              }}
            >
              Importer un autre fichier
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                reset()
                onClose()
              }}
            >
              Terminé
            </Button>
          </>
        }
      >
        {report.rejected.length > 0 && <RejectedRows report={report} />}
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      icon="users"
      size="md"
      title="Importer des contacts"
      description={
        intoBook
          ? 'Chaque adresse du fichier rejoint vos contacts, une seule fois. Une adresse déjà présente garde ses informations.'
          : 'Les contacts du fichier seront ajoutés à la suite de ceux que la campagne contient déjà.'
      }
      footer={
        parsed && (
          <>
            <Button
              variant="ghost"
              disabled={importing}
              onClick={() => {
                setParsed(null)
              }}
            >
              Changer de fichier
            </Button>
            <Button
              variant="primary"
              icon="upload"
              disabled={!emailMapped}
              loading={importing}
              onClick={() => void run()}
            >
              Importer {formatNumber(parsed.rows.length)} lignes
            </Button>
          </>
        )
      }
    >
      {!parsed ? (
        <label
          htmlFor={inputId}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => {
            setDragging(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            const file = event.dataTransfer.files[0]
            if (file) {
              read(file)
            }
          }}
          className={`flex cursor-pointer flex-col items-center rounded-xl border border-dashed px-6 py-10 text-center transition-colors duration-150 ${
            dragging
              ? 'border-accent bg-accent-soft'
              : 'border-border hover:border-border-strong hover:bg-surface-2'
          }`}
        >
          <Icon name="upload" size={22} className="text-ink-subtle" />
          <span className="mt-2.5 text-sm font-medium">
            Déposez un fichier CSV, ou cliquez pour le choisir
          </span>
          <span className="mt-1 text-xs text-ink-muted">
            Une colonne d’adresses suffit. Le séparateur et l’encodage sont détectés.
          </span>

          <input
            id={inputId}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) {
                read(file)
              }
              event.target.value = ''
            }}
          />
        </label>
      ) : (
        <>
          <p className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 text-[13px]">
            <Icon name="file" size={15} className="text-ink-muted" />
            <span className="min-w-0 flex-1 truncate font-medium">{parsed.fileName}</span>
            <span className="tabular shrink-0 text-ink-muted">
              {formatNumber(parsed.rows.length)} lignes
            </span>
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {FIELDS.map((field) => (
              <Select
                key={field.key}
                value={mapping[field.key]}
                label={field.required ? `${field.label} *` : field.label}
                onChange={(value) => {
                  setMapping((current) => ({ ...current, [field.key]: value }))
                }}
                size="sm"
                options={[
                  { value: NOT_MAPPED, label: '— aucune colonne —' },
                  ...parsed.columns.map((column) => ({ value: column, label: column })),
                ]}
              />
            ))}
          </div>

          {!emailMapped && (
            <p
              role="alert"
              className="mt-3 flex items-center gap-1.5 text-xs text-danger"
            >
              <Icon name="alert" size={13} />
              Choisissez la colonne qui contient les adresses e-mail.
            </p>
          )}

          <PreviewRows parsed={parsed} mapping={mapping} />

          {importing && (
            <div className="mt-4">
              <Progress value={progress} label="Import des contacts" size="sm" />
              <p className="tabular mt-1.5 text-xs text-ink-muted">
                Import en cours… {progress}%
              </p>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}

/**
 * The first five rows as they will be imported.
 *
 * Shown before anything is sent, because a mapping that is off by one column
 * is obvious here and invisible in a report of five hundred rejections.
 */
function PreviewRows({
  parsed,
  mapping,
}: {
  parsed: Parsed
  mapping: Record<FieldKey, string>
}) {
  return (
    <div className="mt-4">
      <p className="text-xs text-ink-muted">
        Cinq premières lignes, telles qu’elles seront importées :
      </p>

      <div className="mt-1.5 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-lg text-left text-xs">
          <thead className="bg-surface-2 text-ink-muted">
            <tr>
              {FIELDS.map((field) => (
                <th key={field.key} className="px-3 py-2 font-medium whitespace-nowrap">
                  {field.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {parsed.rows.slice(0, 5).map((row, index) => (
              <tr key={index} className="border-t border-border">
                {FIELDS.map((field) => {
                  const column = mapping[field.key]
                  const value = column ? row[column] : ''

                  return (
                    <td key={field.key} className="max-w-40 truncate px-3 py-2">
                      {value || <span className="text-ink-subtle">—</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * The rows the import refused, and a way to fix them.
 *
 * Downloadable as a CSV because the useful next step is fixing them in the
 * spreadsheet they came from, and copying line numbers off a screen is how
 * that goes wrong.
 */
function RejectedRows({ report }: { report: ImportReport }) {
  function download() {
    const header = 'ligne,adresse,motif\n'
    const body = report.rejected
      .map(
        (row) =>
          `${String(row.line)},"${row.email.replace(/"/g, '""')}","${reasonLabel(row.reason)}"`,
      )
      .join('\n')

    // A BOM, so Excel opens the accented labels as UTF-8 instead of mojibake.
    const blob = new Blob([`\uFEFF${header}${body}\n`], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = 'lignes-rejetees.csv'
    link.click()
    requestAnimationFrame(() => {
      URL.revokeObjectURL(url)
    })
  }

  return (
    <div>
      <p className="text-[13px] text-ink-muted">
        {countOf(report.rejected.length, 'ligne')} sur {formatNumber(report.read)} n’
        {report.rejected.length > 1 ? 'ont' : 'a'} pas pu être importée
        {report.rejected.length > 1 ? 's' : ''}. Les numéros correspondent à ceux de votre
        tableur.
      </p>

      <div className="mt-2.5 max-h-48 overflow-y-auto rounded-xl border border-border">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-surface-2 text-ink-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Ligne</th>
              <th className="px-3 py-2 font-medium">Valeur lue</th>
              <th className="px-3 py-2 font-medium">Motif</th>
            </tr>
          </thead>
          <tbody>
            {report.rejected.map((row) => (
              <tr
                key={`${String(row.line)}-${row.email}`}
                className="border-t border-border"
              >
                <td className="tabular px-3 py-2">{row.line}</td>
                <td className="max-w-48 truncate px-3 py-2 font-mono">{row.email}</td>
                <td className="px-3 py-2 whitespace-nowrap">{reasonLabel(row.reason)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Button
        variant="secondary"
        size="sm"
        icon="download"
        onClick={download}
        className="mt-3"
      >
        Télécharger les lignes rejetées
      </Button>
    </div>
  )
}
