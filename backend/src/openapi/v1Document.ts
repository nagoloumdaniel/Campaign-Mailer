import { z } from 'zod'

import { CAMPAIGN_TYPES } from '../schemas/campaign.js'
import { v1AddContactsSchema, v1CreateCampaignSchema } from '../schemas/v1.js'

/**
 * The OpenAPI 3.1 document of the v1 API (roadmap, Phase 9), built from the
 * zod schemas the routes validate requests with and from strict schemas of
 * what they answer. The contract tests validate real responses against the
 * same response schemas, so the document cannot drift from the code unnoticed.
 */

const rejectedRowSchema = z.strictObject({
  line: z.number().int(),
  email: z.string(),
  reason: z.enum(['invalid_email', 'duplicate_in_file', 'already_imported']),
})

export const v1ImportResponseSchema = z
  .strictObject({
    campaign: z.strictObject({
      id: z.uuid(),
      name: z.string(),
      type: z.enum(CAMPAIGN_TYPES),
      status: z.enum(['draft', 'scheduled', 'running', 'paused', 'completed']),
      url: z.string().describe('Where the owner finds the draft, in the web app.'),
    }),
    report: z.strictObject({
      read: z.number().int(),
      imported: z.number().int().describe('What the database actually took.'),
      rejected: z.array(rejectedRowSchema),
    }),
  })
  .meta({ id: 'ImportResponse' })

export const v1ErrorSchema = z
  .object({
    error: z.string().describe('For a developer, in English.'),
    code: z.string().optional().describe('Stable, for a program to match on.'),
  })
  .meta({ id: 'Error' })

type Json = Record<string, unknown>

/** A zod schema as JSON Schema 2020-12, its definitions moved into `components`. */
function convert(schema: z.ZodType, io: 'input' | 'output', components: Json): Json {
  const raw = JSON.parse(
    JSON.stringify(z.toJSONSchema(schema, { io, unrepresentable: 'any' })).replaceAll(
      '"#/$defs/',
      '"#/components/schemas/',
    ),
  ) as Json
  const { $schema: _schema, $defs, ...rest } = raw
  Object.assign(components, $defs ?? {})
  return rest
}

const ERRORS: Record<string, string> = {
  '400': 'Invalid body, or no Idempotency-Key',
  '401': 'Missing, unknown or revoked token',
  '403': 'Scope missing, or current terms not accepted',
  '409':
    'A request under this key is still running, or the campaign is no longer a draft',
  '422': 'This Idempotency-Key was used for another request',
  '429': 'Too many requests: see Retry-After',
}

export function buildV1Document(serverUrl: string): Json {
  const components: Json = {}
  const error = { $ref: '#/components/schemas/Error' }
  const errorResponses = Object.fromEntries(
    Object.entries(ERRORS).map(([status, description]) => [
      status,
      { description, content: { 'application/json': { schema: error } } },
    ]),
  )
  const idempotencyKey = {
    name: 'Idempotency-Key',
    in: 'header',
    required: true,
    description:
      'Required. The same key replays the first response for 24 hours, so a batch sent again after a lost answer is not imported twice.',
    schema: { type: 'string', minLength: 1, maxLength: 255 },
  }
  const created = {
    description: 'Created. The contacts rejected by the import rules are in the report.',
    headers: {
      'Idempotent-Replayed': {
        description: 'true when this is the replay of the first response.',
        schema: { type: 'string' },
      },
    },
    content: {
      'application/json': {
        schema: convert(v1ImportResponseSchema, 'output', components),
      },
    },
  }

  const document: Json = {
    openapi: '3.1.0',
    info: {
      title: 'Campaign Mailer v1 API',
      version: '1.0.0',
      description:
        'For MailFind: create a draft campaign with its contacts, then add contacts to it. A campaign created here stays a draft; only its owner launches it, from the web app. Authenticate with `Authorization: Bearer cm_...`, a personal integration token created on the account page. 60 requests a minute per token (RateLimit-* headers).',
    },
    servers: [{ url: `${serverUrl}/api/v1` }],
    security: [{ integrationToken: [] }],
    paths: {
      '/campaigns': {
        post: {
          operationId: 'createDraftCampaign',
          summary: 'Create a draft campaign with its contacts',
          'x-scope': 'campaigns:write',
          parameters: [idempotencyKey],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: convert(v1CreateCampaignSchema, 'input', components),
              },
            },
          },
          responses: { '201': created, ...errorResponses },
        },
      },
      '/campaigns/{id}/contacts': {
        post: {
          operationId: 'addContactsToDraft',
          summary: 'Add contacts to a draft',
          description:
            'Addresses already in the campaign are reported as already_imported.',
          'x-scope': 'contacts:write',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
            idempotencyKey,
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: convert(v1AddContactsSchema, 'input', components),
              },
            },
          },
          responses: {
            '201': created,
            '404': {
              description: 'No such campaign for this account',
              content: { 'application/json': { schema: error } },
            },
            ...errorResponses,
          },
        },
      },
    },
    components: {
      schemas: { ...components, Error: convert(v1ErrorSchema, 'output', {}) },
      securitySchemes: {
        integrationToken: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Personal integration token. Scopes: campaigns:write, contacts:write.',
        },
      },
    },
  }
  return document
}
