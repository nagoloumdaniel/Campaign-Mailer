import MailComposer from 'nodemailer/lib/mail-composer/index.js'

/**
 * Builds the RFC 5322 message Gmail is asked to send.
 *
 * nodemailer composes it rather than string concatenation. Hand-rolled MIME
 * gets three things wrong in this order: an accented subject needs RFC 2047
 * encoding, a long header needs folding, and a body with an accent needs a
 * transfer encoding declared and applied. Each of them shows up as mojibake in
 * somebody's inbox, and only in some clients.
 */

export interface MessageAttachment {
  filename: string
  content: Buffer
  contentType: string
}

export interface MessageInput {
  from: { name?: string | undefined; address: string }
  to: string
  subject: string
  text: string
  html: string
  /** In the order the user uploaded them. Absent or empty means no attachment part. */
  attachments?: readonly MessageAttachment[] | undefined
}

/**
 * The Gmail API takes the whole message base64url encoded.
 *
 * base64url, not base64: the standard alphabet's `+` and `/` are rejected, and
 * the padding has to go.
 */
export function toGmailRaw(mime: Buffer): string {
  return mime.toString('base64url')
}

/**
 * Refuses a recipient that is not a single plain address.
 *
 * Relying on the composer alone is not enough, and the test that says so found
 * it: given `a@exemple.fr\r\nBcc: victime@exemple.fr`, nodemailer injects no
 * Bcc header — but it does produce RFC 5322 *group* syntax,
 * `"a@exemple.fr Bcc":victime@exemple.fr;`, whose actual recipient is the
 * second address. No header was injected and the message still goes to someone
 * else.
 *
 * Addresses reaching here are already validated on import, so this is the
 * second lock rather than the first. It is worth having because this is the
 * last point before a message leaves.
 */
function assertPlainAddress(address: string): void {
  if (/[\r\n\0<>,;:"]/.test(address) || !address.includes('@') || address.length > 254) {
    throw new Error('Invalid recipient address')
  }
}

export async function buildMimeMessage(input: MessageInput): Promise<Buffer> {
  assertPlainAddress(input.to)
  assertPlainAddress(input.from.address)

  const composer = new MailComposer({
    from: input.from.name
      ? { name: input.from.name, address: input.from.address }
      : input.from.address,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    // Both parts, always. A message with only HTML is scored as less
    // trustworthy by most filters, and unreadable in a client set to plain
    // text.
    ...(input.attachments && input.attachments.length > 0
      ? {
          attachments: input.attachments.map((attachment) => ({
            filename: attachment.filename,
            content: attachment.content,
            contentType: attachment.contentType,
          })),
        }
      : {}),
  })

  return composer.compile().build()
}
