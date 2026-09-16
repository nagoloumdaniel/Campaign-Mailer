import express, { Router } from 'express'

import {
  campaignIdParam,
  isUuid,
  requireAuth,
  signedInUserId,
} from '../middleware/auth.js'
import {
  AttachmentRejected,
  MAX_ATTACHMENT_BYTES,
  contentDisposition,
  extensionOfKey,
  safeFileName,
} from '../services/attachmentRules.js'
import { canEditContent } from '../services/campaignState.js'
import {
  MAX_ATTACHMENTS,
  type CampaignAttachmentRow,
  type CampaignRepository,
} from '../services/campaigns.js'
import { deleteAttachment, getAttachment, putAttachment } from '../services/storage.js'

/**
 * A campaign's attachments: up to five files, added and removed one at a time.
 *
 * The body is the file itself rather than a multipart form. The browser can
 * post a File straight through fetch, so multipart buys nothing here and costs
 * a parser dependency; the filename travels in a header instead.
 */

/**
 * The filename header, decoded, or the default name.
 *
 * The client URI-encodes it; a stray `%` from any other client made
 * decodeURIComponent throw, which answered 500 for what is a naming detail.
 */
function decodeFileName(header: string | undefined): string {
  if (!header) {
    return 'piece-jointe'
  }

  try {
    return decodeURIComponent(header)
  } catch {
    return 'piece-jointe'
  }
}

/** The shape a client sees. The object key stays server-side. */
function toPublicAttachment(row: CampaignAttachmentRow) {
  return {
    id: row.id,
    name: row.name,
    size: row.size_bytes,
    contentType: row.content_type,
    createdAt: row.created_at.toISOString(),
  }
}

export function createAttachmentRouter(campaigns: CampaignRepository): Router {
  const router = Router({ mergeParams: true })

  router.use(requireAuth)

  const load = async (req: { params: unknown; user?: unknown }) => {
    const id = campaignIdParam(req)
    return id ? campaigns.findForUser(id, signedInUserId(req)) : null
  }

  /** The attachment id from the path, checked before it reaches Postgres. */
  const attachmentIdParam = (req: { params: unknown }): string | null => {
    const raw = (req.params as Record<string, unknown>).attachmentId
    return isUuid(raw) ? raw : null
  }

  router.get('/', (req, res, next) => {
    void (async () => {
      const campaign = await load(req)

      if (!campaign) {
        res.status(404).json({ error: 'Campaign not found' })
        return
      }

      const rows = await campaigns.listAttachments(campaign.id)

      res.json({
        attachments: rows.map(toPublicAttachment),
        max: MAX_ATTACHMENTS,
      })
    })().catch(next)
  })

  router.post(
    '/',
    // Any type is accepted at this layer so an unsupported one produces a
    // readable refusal rather than an empty body and a confusing 400.
    express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES }),
    (req, res, next) => {
      void (async () => {
        const campaign = await load(req)

        if (!campaign) {
          res.status(404).json({ error: 'Campaign not found' })
          return
        }

        if (!canEditContent(campaign.status)) {
          res.status(409).json({
            error: 'The attachments can no longer change once the campaign is scheduled',
          })
          return
        }

        // Checked before the upload as well as inside the insert. The insert is
        // what actually holds the cap against two uploads racing; this only
        // spares the bucket a write it would then have to undo.
        if ((await campaigns.listAttachments(campaign.id)).length >= MAX_ATTACHMENTS) {
          res.status(409).json({
            error: `A campaign carries ${String(MAX_ATTACHMENTS)} attachments at most`,
          })
          return
        }

        // The header is URI-encoded by the client, because a filename with an
        // accent is not a valid header value as it stands.
        const rawName = decodeFileName(req.get('x-file-name'))
        const contentType = req.get('content-type') ?? ''

        let stored
        try {
          stored = await putAttachment(
            campaign.id,
            req.body as Buffer,
            rawName,
            contentType,
          )
        } catch (err) {
          if (err instanceof AttachmentRejected) {
            res.status(err.status).json({ error: err.message })
            return
          }
          throw err
        }

        const row = await campaigns.addAttachment(campaign.id, {
          object_key: stored.key,
          name: stored.name,
          size_bytes: stored.size,
          content_type: stored.contentType,
        })

        if (!row) {
          // The cap was reached between the check and the insert. The object is
          // already in the bucket, so it is removed rather than left orphaned.
          await deleteAttachment(stored.key).catch((err: unknown) => {
            req.log.warn(
              { err, campaignId: campaign.id },
              'Could not delete an attachment refused by the cap',
            )
          })

          res.status(409).json({
            error: `A campaign carries ${String(MAX_ATTACHMENTS)} attachments at most`,
          })
          return
        }

        res.status(201).json({ attachment: toPublicAttachment(row) })
      })().catch(next)
    },
  )

  router.get('/:attachmentId', (req, res, next) => {
    void (async () => {
      const campaign = await load(req)
      const attachmentId = attachmentIdParam(req)
      const row =
        campaign && attachmentId
          ? await campaigns.findAttachment(campaign.id, attachmentId)
          : null

      if (!row) {
        res.status(404).json({ error: 'No attachment' })
        return
      }

      const body = await getAttachment(row.object_key)
      // The extension from the stored key, not a fixed "pdf": a Word document
      // used to download named .pdf and open as a broken file.
      const name = safeFileName(row.name, extensionOfKey(row.object_key))

      // attachment, not inline: a PDF rendered in the tab would run in this
      // origin.
      res.setHeader('content-disposition', contentDisposition(name))
      res.setHeader('content-type', 'application/octet-stream')
      res.send(body)
    })().catch(next)
  })

  router.delete('/:attachmentId', (req, res, next) => {
    void (async () => {
      const campaign = await load(req)

      if (!campaign) {
        res.status(404).json({ error: 'Campaign not found' })
        return
      }

      if (!canEditContent(campaign.status)) {
        res.status(409).json({
          error: 'The attachments can no longer change once the campaign is scheduled',
        })
        return
      }

      const attachmentId = attachmentIdParam(req)
      const row = attachmentId
        ? await campaigns.findAttachment(campaign.id, attachmentId)
        : null

      if (!row) {
        res.status(404).json({ error: 'No attachment' })
        return
      }

      await campaigns.removeAttachment(campaign.id, row.id)

      // Only once the row is gone. Deleting the object first would leave the
      // campaign pointing at nothing if the delete below failed.
      await deleteAttachment(row.object_key).catch((err: unknown) => {
        // The campaign is already correct; an orphan object costs storage,
        // not correctness.
        req.log.warn(
          { err, campaignId: campaign.id },
          'Could not delete the attachment object',
        )
      })

      res.status(204).end()
    })().catch(next)
  })

  return router
}
