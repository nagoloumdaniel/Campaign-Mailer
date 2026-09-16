import type { CampaignAttachment } from './campaigns'

/**
 * A campaign's files.
 *
 * The upload is an XMLHttpRequest rather than a fetch, and only for the
 * progress events: fetch still cannot report how much of a request body has
 * been sent, and a CV on a slow connection is exactly where a person needs to
 * see something moving.
 *
 * The file travels as the raw body with its name in a header, which is what
 * the API expects — multipart would buy nothing here and cost a parser on the
 * server.
 */

/** Mirrors MAX_ATTACHMENTS on the server. */
export const MAX_ATTACHMENTS = 5

/** Mirrors MAX_ATTACHMENT_BYTES: ten megabytes, per file. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

export const ACCEPTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
] as const

export const ACCEPTED_EXTENSIONS = '.pdf,.doc,.docx'

/**
 * The error the API gave, turned into something a person can act on.
 *
 * The body is not always JSON: a proxy refusing a large file answers with an
 * HTML page, and parsing it threw inside the event handler, where nobody saw
 * it and no message appeared at all.
 */
function messageFor(request: XMLHttpRequest): string {
  if (request.status === 413) {
    return 'Ce fichier dépasse 10 Mo.'
  }

  if (request.status === 401) {
    return 'Votre session a expiré. Reconnectez-vous, puis réessayez.'
  }

  if (request.status === 409) {
    return `Une campagne peut porter ${String(MAX_ATTACHMENTS)} pièces jointes au maximum.`
  }

  try {
    const body = JSON.parse(request.responseText) as { error?: unknown }

    if (typeof body.error === 'string') {
      return body.error
    }
  } catch {
    // Not JSON; fall through to the plain message.
  }

  return 'L’envoi a échoué. Réessayez dans un instant.'
}

/** Why this file cannot be attached, in the user's terms; null when it can. */
export function rejectionFor(file: File, existing: number): string | null {
  if (existing >= MAX_ATTACHMENTS) {
    return `Vous avez déjà ${String(MAX_ATTACHMENTS)} pièces jointes. Retirez-en une pour en ajouter une autre.`
  }

  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return 'Seuls un PDF ou un document Word peuvent être joints.'
  }

  if (file.size > MAX_ATTACHMENT_BYTES) {
    return 'Ce fichier dépasse 10 Mo.'
  }

  return null
}

export const attachmentsApi = {
  list: (campaignId: string) =>
    fetch(`/api/campaigns/${campaignId}/attachments`, { credentials: 'include' })
      .then(
        (response) => response.json() as Promise<{ attachments: CampaignAttachment[] }>,
      )
      .then((body) => body.attachments),

  upload: (
    campaignId: string,
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<CampaignAttachment> =>
    new Promise((resolve, reject) => {
      const request = new XMLHttpRequest()

      request.open('POST', `/api/campaigns/${campaignId}/attachments`)
      request.withCredentials = true
      request.setRequestHeader('content-type', file.type)
      // Encoded, because an accented filename is not a valid header value.
      request.setRequestHeader('x-file-name', encodeURIComponent(file.name))

      request.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          onProgress?.(Math.round((event.loaded / event.total) * 100))
        }
      })

      request.addEventListener('load', () => {
        if (request.status !== 201) {
          reject(new Error(messageFor(request)))
          return
        }

        try {
          const body = JSON.parse(request.responseText) as {
            attachment: CampaignAttachment
          }
          resolve(body.attachment)
        } catch {
          reject(new Error('La réponse du serveur n’a pas pu être lue.'))
        }
      })

      request.addEventListener('error', () => {
        reject(new Error('L’envoi a échoué. Vérifiez votre connexion.'))
      })

      request.send(file)
    }),

  remove: async (campaignId: string, attachmentId: string): Promise<void> => {
    const response = await fetch(
      `/api/campaigns/${campaignId}/attachments/${attachmentId}`,
      { method: 'DELETE', credentials: 'include' },
    )

    if (!response.ok) {
      throw new Error('La suppression a échoué.')
    }
  },

  /** A plain link: the browser downloads, the session cookie rides along. */
  downloadUrl: (campaignId: string, attachmentId: string) =>
    `/api/campaigns/${campaignId}/attachments/${attachmentId}`,
}
