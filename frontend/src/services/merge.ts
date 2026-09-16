/**
 * Mail merge, in the browser, for the live preview only.
 *
 * The rules here mirror `backend/src/services/template.ts` line for line: the
 * same placeholder grammar, the same fallback after a vertical bar, the same
 * escaping of every contact value in the HTML part, the same neutralising of
 * a link whose scheme would carry a script. That duplication is deliberate
 * and it is the narrow kind: what actually leaves the account is rendered by
 * the server, always, and this exists so the panel on the right of the editor
 * can follow the keyboard.
 *
 * It has to be in the browser. The API renders a preview from the *stored*
 * campaign, so a server-side preview would show the last save rather than the
 * sentence being typed — and a save on every keystroke is not a trade worth
 * making.
 *
 * The result is written into a sandboxed iframe, so even a mistake in the
 * escaping below cannot reach the session.
 */

export const TEMPLATE_VARIABLES = [
  'contact_name',
  'company_name',
  'salutation',
  'email',
] as const

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number]

export type MergeContact = Record<TemplateVariable, string | null | undefined>

/**
 * The values a preview falls back to when no contact has been imported yet.
 *
 * Obviously fictional on purpose: a preview that looks like a real recipient
 * invites the reader to check the message against that person rather than
 * against the template.
 */
export const SAMPLE_CONTACT: MergeContact = {
  salutation: 'Madame',
  contact_name: 'Camille Martin',
  company_name: 'Société Exemple',
  email: 'contact@exemple.fr',
}

/** Every quantifier bounded, as on the server: no name past 40, no fallback past 200. */
const PLACEHOLDER = /\{\{ {0,8}([a-z_]{1,40}) {0,8}(?:\|([^}]{0,200}))?\}\}/gi

const HTML_ESCAPES = new Map<string, string>([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
])

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES.get(char) ?? char)
}

function isKnown(name: string): name is TemplateVariable {
  return (TEMPLATE_VARIABLES as readonly string[]).includes(name)
}

/** A switch, not a lookup: indexing an object by a parsed name answers for `__proto__`. */
function valueOf(contact: MergeContact, name: TemplateVariable) {
  switch (name) {
    case 'contact_name':
      return contact.contact_name
    case 'company_name':
      return contact.company_name
    case 'salutation':
      return contact.salutation
    case 'email':
      return contact.email
  }
}

function resolve(
  contact: MergeContact,
  name: string,
  fallback: string | undefined,
): string {
  if (!isKnown(name)) {
    return ''
  }

  const value = valueOf(contact, name)

  // Whitespace counts as missing: a CSV column full of spaces should read as
  // an absent value, not push an empty gap into the sentence.
  if (typeof value === 'string' && value.trim() !== '') {
    return value
  }

  return fallback ?? ''
}

function render(
  template: string,
  contact: MergeContact,
  transform: (value: string) => string,
): string {
  return template.replace(PLACEHOLDER, (_match, name: string, fallback?: string) =>
    transform(resolve(contact, name, fallback)),
  )
}

const UNSAFE_LINK =
  /(\s(?:href|src) {0,4}= {0,4}["']? {0,20})(?:javascript|vbscript|data) {0,4}:/gi

export function renderText(template: string, contact: MergeContact): string {
  return render(template, contact, (value) => value)
}

export function renderHtml(template: string, contact: MergeContact): string {
  return render(template, contact, escapeHtml).replace(UNSAFE_LINK, '$1#')
}

/** The known variables a template uses, each once. */
export function usedVariables(template: string): TemplateVariable[] {
  const found = new Set<TemplateVariable>()

  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1]

    if (name && isKnown(name)) {
      found.add(name)
    }
  }

  return [...found]
}

/**
 * The contact a preview is rendered against: the first one imported, with the
 * sample filling any field its CSV did not carry.
 *
 * Filled rather than left blank, because a contact imported from a file that
 * lacks a column would otherwise preview with a hole exactly where the user
 * is trying to check their sentence.
 */
export function previewContact(source?: Partial<MergeContact> | null): MergeContact {
  return {
    salutation: source?.salutation ?? SAMPLE_CONTACT.salutation,
    contact_name: source?.contact_name ?? SAMPLE_CONTACT.contact_name,
    company_name: source?.company_name ?? SAMPLE_CONTACT.company_name,
    email: source?.email ?? SAMPLE_CONTACT.email,
  }
}
