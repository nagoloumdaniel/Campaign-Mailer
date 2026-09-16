import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildMimeMessage, toGmailRaw } from './message.js'

const BASE = {
  from: { name: 'Marie Dupont', address: 'marie@exemple.fr' },
  to: 'destinataire@exemple.fr',
  subject: 'Candidature',
  text: 'Bonjour',
  html: '<p>Bonjour</p>',
}

/** A header must be ASCII. Checked by code point, since a regular expression
 *  for the range would carry control characters the linter objects to. */
function isAscii(value: string): boolean {
  // The Unicode property escape says the same as a \x00-\x7F range without
  // putting control characters in the source.
  return /^\p{ASCII}*$/u.test(value)
}

const build = async (overrides = {}) =>
  (await buildMimeMessage({ ...BASE, ...overrides })).toString('utf8')

describe('buildMimeMessage', () => {
  it('carries the envelope headers', async () => {
    const mime = await build()

    assert.match(mime, /^From: .*marie@exemple\.fr/m)
    assert.match(mime, /^To: destinataire@exemple\.fr/m)
    assert.match(mime, /^Subject: /m)
  })

  it('includes both a text and an HTML part', async () => {
    // A message with only HTML scores worse with filters and is unreadable in
    // a client set to plain text.
    const mime = await build()

    assert.match(mime, /Content-Type: text\/plain/)
    assert.match(mime, /Content-Type: text\/html/)
    assert.match(mime, /multipart\/alternative/)
  })

  it('encodes an accented subject rather than sending raw bytes', async () => {
    // A header is ASCII. Raw accents there arrive as mojibake in some clients
    // and are stripped by others.
    const mime = await build({ subject: 'Candidature — Société Générale' })

    const subjectLine = mime.split('\r\n').find((line) => line.startsWith('Subject:'))

    assert.ok(subjectLine)
    assert.ok(isAscii(subjectLine), 'raw non-ASCII in the Subject header')
    assert.match(subjectLine, /=\?UTF-8\?/i)
  })

  it('declares a transfer encoding for an accented body', async () => {
    const mime = await build({ text: 'Chère Zoé — à bientôt', html: '<p>Chère Zoé</p>' })

    assert.match(mime, /Content-Transfer-Encoding: (quoted-printable|base64)/)
  })

  it('encodes a display name with an accent', async () => {
    const mime = await build({ from: { name: 'Amélie Röstig', address: 'a@exemple.fr' } })
    const fromLine = mime.split('\r\n').find((line) => line.startsWith('From:'))

    assert.ok(fromLine && isAscii(fromLine))
  })

  it('carries a Message-ID and a Date, which filters expect', async () => {
    const mime = await build()

    assert.match(mime, /^Message-ID: </m)
    assert.match(mime, /^Date: /m)
  })

  describe('with attachments', () => {
    const attachment = {
      filename: 'CV Marie Dupont.pdf',
      content: Buffer.from('%PDF-1.4 fake'),
      contentType: 'application/pdf',
    }

    it('nests the body inside a mixed part', async () => {
      const mime = await build({ attachments: [attachment] })

      assert.match(mime, /multipart\/mixed/)
      assert.match(mime, /multipart\/alternative/)
    })

    it('names the file and marks it as an attachment', async () => {
      const mime = await build({ attachments: [attachment] })

      assert.match(mime, /Content-Disposition: attachment/)
      assert.match(mime, /CV Marie Dupont\.pdf/)
    })

    it('encodes the bytes in base64', async () => {
      const mime = await build({ attachments: [attachment] })

      assert.match(mime, /Content-Type: application\/pdf/)
      assert.ok(mime.includes(Buffer.from('%PDF-1.4 fake').toString('base64')))
    })

    it('encodes an accented filename', async () => {
      const mime = await build({
        attachments: [{ ...attachment, filename: 'Curriculum vitæ Amélie.pdf' }],
      })

      const disposition = mime
        .split('\r\n')
        .find((line) => line.startsWith('Content-Disposition:'))

      assert.ok(disposition && isAscii(disposition))
    })

    it('carries several files, in the order they were given', async () => {
      const mime = await build({
        attachments: [
          attachment,
          {
            filename: 'Lettre.pdf',
            content: Buffer.from('%PDF lettre'),
            contentType: 'application/pdf',
          },
        ],
      })

      const cv = mime.indexOf('CV Marie Dupont.pdf')
      const letter = mime.indexOf('Lettre.pdf')

      assert.ok(cv > -1 && letter > -1, 'both files should be in the message')
      assert.ok(cv < letter, 'the order of the upload should be the order in the message')
    })
  })

  it('cannot be made to inject a header from the subject', async () => {
    // A subject is built from a template a user wrote and a value from a CSV.
    // A newline surviving into it would let either add a Bcc.
    const mime = await build({ subject: 'Bonjour\r\nBcc: victime@exemple.fr' })

    assert.ok(!/^Bcc:/m.test(mime))
  })

  it('refuses a recipient carrying a newline', async () => {
    // Left to the composer, this produces no Bcc header but does produce RFC
    // 5322 group syntax whose real recipient is the second address. The
    // message would reach someone else with nothing in the headers to show it.
    await assert.rejects(
      () => buildMimeMessage({ ...BASE, to: 'a@exemple.fr\r\nBcc: victime@exemple.fr' }),
      /Invalid recipient/,
    )
  })

  it('refuses the other shapes that redirect a message', async () => {
    for (const to of [
      'a@exemple.fr, victime@exemple.fr',
      '"groupe":victime@exemple.fr;',
      'Marie <victime@exemple.fr>',
      'a@exemple.fr\0',
      'pas-une-adresse',
    ]) {
      await assert.rejects(
        () => buildMimeMessage({ ...BASE, to }),
        /Invalid recipient/,
        to,
      )
    }
  })
})

describe('toGmailRaw', () => {
  it('uses the URL alphabet, which is what Gmail accepts', async () => {
    // `+` and `/` are rejected by the API, and padding with `=` too.
    const raw = toGmailRaw(await buildMimeMessage(BASE))

    assert.ok(!raw.includes('+'))
    assert.ok(!raw.includes('/'))
    assert.ok(!raw.includes('='))
  })

  it('round-trips', () => {
    const source = Buffer.from('Zoé — accents & symbols ?/+')

    assert.equal(
      Buffer.from(toGmailRaw(source), 'base64url').toString('utf8'),
      source.toString('utf8'),
    )
  })
})
