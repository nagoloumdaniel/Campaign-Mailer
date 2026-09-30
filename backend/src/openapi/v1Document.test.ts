import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildV1Document, v1ImportResponseSchema } from './v1Document.js'

describe('the v1 OpenAPI document', () => {
  const document = buildV1Document('https://api.example.test') as {
    openapi: string
    paths: Record<
      string,
      Record<string, { parameters: { name: string; required: boolean }[] }>
    >
    components: { schemas: Record<string, unknown> }
  }

  it('is OpenAPI 3.1 and documents the two operations', () => {
    assert.equal(document.openapi, '3.1.0')
    assert.deepEqual(Object.keys(document.paths).sort(), [
      '/campaigns',
      '/campaigns/{id}/contacts',
    ])
  })

  it('resolves every reference to a component', () => {
    const text = JSON.stringify(document)
    assert.equal(text.includes('$defs'), false)
    for (const [, name] of text.matchAll(/"\$ref":"#\/components\/schemas\/(\w+)"/g)) {
      assert.ok(name && name in document.components.schemas, name)
    }
  })

  it('marks the Idempotency-Key as required on both creations', () => {
    for (const operations of Object.values(document.paths)) {
      const key = operations.post?.parameters.find((p) => p.name === 'Idempotency-Key')
      assert.equal(key?.required, true)
    }
  })

  it('describes a response strictly: an undocumented field fails', () => {
    const response = {
      campaign: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'x',
        type: 'autre',
        status: 'draft',
        url: 'u',
      },
      report: { read: 0, imported: 0, rejected: [] },
    }
    assert.equal(v1ImportResponseSchema.safeParse(response).success, true)
    assert.equal(
      v1ImportResponseSchema.safeParse({ ...response, extra: 1 }).success,
      false,
    )
  })
})
