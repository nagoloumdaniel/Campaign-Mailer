import { expect, test } from '@playwright/test'

import { API_URL } from './playwright.config'

/**
 * The journey the product exists for: sign in, prepare a campaign, import the
 * contacts, launch, and follow it until every message has gone.
 *
 * Playwright's locators are strict, and this interface gives them two ways to
 * be ambiguous. Several panels say "Enregistrer" or "À jour", so those are
 * matched exactly and taken first; and three file inputs live on the campaign
 * page — the attachments, the CSV import, and the import's own dialog — so
 * every file is set through the dialog that owns it.
 */

const CSV = [
  'email,nom,entreprise',
  'ana@example.test,Ana,Acme',
  'pas-une-adresse,X,Y',
  'bob@example.test,Bob,Globex',
].join('\n')

test('a user prepares a campaign, launches it and follows it to the end', async ({
  page,
  context,
  request,
}) => {
  // Sign-in: the session Google would have opened.
  const session = (await (await request.post(`${API_URL}/e2e/session`)).json()) as {
    name: string
    value: string
  }
  await context.addCookies([
    { ...session, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ])

  await page.goto('/')

  await test.step('accepts the terms at first sign-in', async () => {
    await page.getByRole('checkbox', { name: /J’ai lu et j’accepte/ }).check()
    await page.getByRole('button', { name: 'Accepter et continuer' }).click()
  })

  await test.step('creates a campaign and writes its message', async () => {
    await page.getByRole('link', { name: 'Nouvelle campagne' }).first().click()
    await page.getByLabel('Nom de la campagne').fill('Candidatures E2E')
    await page.getByRole('button', { name: 'Créer la campagne' }).click()

    await expect(
      page.getByRole('heading', { level: 1, name: 'Candidatures E2E' }),
    ).toBeVisible()

    // The editor is loaded on demand; the field only exists once it arrives.
    await page.getByLabel('Objet').fill('Candidature chez {{company_name|votre équipe}}')
    await page.locator('.ql-editor').fill('Bonjour {{contact_name|Madame, Monsieur}},')

    // No button: the message saves itself a moment after the last keystroke.
    await expect(page.getByText('Enregistré', { exact: true })).toBeVisible()
  })

  await test.step('the preview renders the message without being asked', async () => {
    const preview = page.getByRole('region', { name: 'Aperçu' })

    // No contact yet, so the sample values stand in for a real one.
    await expect(preview.getByText('Société Exemple')).toBeVisible()
    await expect(
      preview.frameLocator('iframe').getByText('Bonjour Camille Martin,'),
    ).toBeVisible()
  })

  await test.step('imports a CSV file, the invalid row set aside', async () => {
    await page.getByRole('button', { name: 'Importer un fichier CSV' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'contacts.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(CSV),
    })

    await dialog.getByRole('button', { name: 'Importer 3 lignes' }).click()

    // The confirmation says what was added, not what the campaign now holds.
    await expect(
      page.getByRole('heading', { name: '2 nouveaux contacts ajoutés' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Terminé' }).click()

    await expect(page.getByText('bob@example.test').first()).toBeVisible()
  })

  await test.step('adds one contact by hand, and is refused a duplicate', async () => {
    // Exact: the header's "Ajouter" would otherwise also match the dialog's
    // "Ajouter le contact" and the confirmation's "Ajouter un autre contact".
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Adresse e-mail').fill('cleo@example.test')
    await dialog.getByLabel('Nom du contact').fill('Cléo')
    await dialog.getByRole('button', { name: 'Ajouter le contact' }).click()

    await expect(page.getByRole('heading', { name: 'Contact ajouté' })).toBeVisible()
    await page.getByRole('button', { name: 'Ajouter un autre contact' }).click()

    // The same address twice is the mistake this dialog invites, so the
    // refusal is read under the field rather than in a toast.
    await dialog.getByLabel('Adresse e-mail').fill('ana@example.test')
    await dialog.getByRole('button', { name: 'Ajouter le contact' }).click()
    await expect(
      dialog.getByText('Cette adresse est déjà dans la campagne.'),
    ).toBeVisible()

    await dialog.getByRole('button', { name: 'Annuler' }).click()
    await expect(page.getByRole('heading', { name: 'Contacts (3)' })).toBeVisible()
  })

  await test.step('removes the contact added by hand', async () => {
    // Back to the two imported ones, so the rest of the journey counts what
    // the file held.
    await page.getByRole('button', { name: 'Supprimer cleo@example.test' }).click()

    await expect(page.getByRole('heading', { name: 'Contacts (2)' })).toBeVisible()
  })

  await test.step('the preview switches to the first imported contact', async () => {
    await expect(
      page.getByRole('region', { name: 'Aperçu' }).getByText('ana@example.test'),
    ).toBeVisible()
  })

  await test.step('launches it', async () => {
    await page.getByRole('button', { name: 'Lancer la campagne…' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('2 contacts en attente')).toBeVisible()
    await dialog.getByRole('button', { name: 'Lancer les 2 envois' }).click()
  })

  await test.step('follows the sending until both messages are out', async () => {
    // The page polls every ten seconds while the campaign is sending.
    await expect(page.getByText(/2 envoyés/).first()).toBeVisible({ timeout: 45_000 })
  })

  await test.step('Gmail received exactly one message per valid contact', async () => {
    const sent = (await (await request.get(`${API_URL}/e2e/sent`)).json()) as {
      recipients: string[]
    }

    expect(sent.recipients.sort()).toEqual(['ana@example.test', 'bob@example.test'])
  })

  await test.step('the history lists both messages and can seed a follow-up', async () => {
    await page.getByRole('link', { name: 'Historique' }).click()

    await expect(
      page.getByRole('heading', { level: 1, name: 'Historique' }),
    ).toBeVisible()
    await expect(page.getByRole('cell', { name: /Ana/ })).toBeVisible()

    await page.getByRole('checkbox', { name: 'Tout sélectionner sur cette page' }).check()
    await page.getByRole('button', { name: 'Créer une relance' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Nom de la campagne').fill('Relance E2E')
    await dialog.getByRole('button', { name: 'Créer la campagne' }).click()

    await expect(
      page.getByRole('heading', { level: 1, name: 'Relance E2E' }),
    ).toBeVisible()
    // The contacts were copied server-side: nothing had to be re-imported.
    await expect(page.getByRole('heading', { name: 'Contacts (2)' })).toBeVisible()
  })

  await test.step('the contacts list each address once, and every one can be edited', async () => {
    // Exact: the campaign page has a "Contacts (2)" heading, not a link.
    await page.getByRole('link', { name: 'Contacts', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Contacts' })).toBeVisible()

    // Ana and Bob sit in two campaigns each, and Cléo, removed from the
    // campaign earlier, stays a contact: three, not five.
    await expect(page.getByText('3 contacts au total.')).toBeVisible()

    await page.getByRole('searchbox').fill('ana@')
    await expect(page.getByText('1 contact correspond à ces filtres.')).toBeVisible()

    // Ana has already been sent to; she can still be edited.
    await page.getByRole('button', { name: 'Modifier ana@example.test' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Nom du contact').fill('Ana Lopez')
    await dialog.getByRole('button', { name: 'Enregistrer' }).click()

    // The answer is a confirmation in the dialog, not a toast that slides away.
    await expect(page.getByRole('heading', { name: 'Contact modifié' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Terminé' }).click()
    await expect(page.getByRole('cell', { name: 'Ana Lopez' })).toBeVisible()
  })

  await test.step('turns a selection of contacts into a new campaign', async () => {
    await page.getByRole('searchbox').fill('')
    await expect(page.getByText('3 contacts au total.')).toBeVisible()

    await page.getByRole('checkbox', { name: 'Tout sélectionner sur cette page' }).check()
    await page.getByRole('button', { name: 'Créer une campagne' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Nom de la campagne').fill('Depuis les contacts')
    await dialog.getByRole('button', { name: 'Créer la campagne' }).click()

    await expect(
      page.getByRole('heading', { level: 1, name: 'Depuis les contacts' }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Contacts (3)' })).toBeVisible()
    // The new campaign takes the contact as it is now.
    await expect(page.getByText('Ana Lopez').first()).toBeVisible()
  })

  await test.step('offers the account’s contacts to a draft, minus the ones it has', async () => {
    await page.getByRole('button', { name: 'Mes contacts' }).click()

    // Every address of the account is already in this campaign.
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Aucun contact à ajouter')).toBeVisible()
    await dialog.getByRole('button', { name: 'Annuler' }).click()
  })

  await test.step('exports the contacts as a CSV, the page’s columns only', async () => {
    const response = await page.request.get('/api/contacts/export?timezone=Europe/Paris')
    expect(response.status()).toBe(200)

    const csv = await response.text()
    expect(csv).toContain('"nom","email","entreprise","civilite","ajoute_le","origine"')
    expect(csv).toContain('"ana@example.test"')
  })

  await test.step('the history leads with the campaigns, and keeps what was sent', async () => {
    await page.getByRole('link', { name: 'Historique' }).click()

    await expect(page.getByRole('heading', { name: 'Vos campagnes' })).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Candidatures E2E', exact: true }),
    ).toBeVisible()

    // The message went to "Ana"; renaming the contact does not rewrite it.
    await expect(page.getByRole('cell', { name: /^Ana/ }).first()).toBeVisible()
    await expect(page.getByText('Ana Lopez')).toHaveCount(0)
  })
})
