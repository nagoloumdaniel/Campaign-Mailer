/**
 * The single place the web app talks to the API.
 *
 * Every request sends credentials, because authentication is a cookie the
 * browser will otherwise withhold on a cross-origin call. In development the
 * Vite proxy keeps both on one origin; in production they sit behind one
 * domain. Either way, omitting this is the mistake that makes a working login
 * look broken on the very next request.
 */

export class ApiError extends Error {
  readonly status: number
  /**
   * The machine-readable reason, where the route carries one. The message is
   * written for a developer and is in English; a screen that has to tell two
   * refusals apart matches on this rather than on that prose.
   */
  readonly code: string | null

  constructor(status: number, message: string, code: string | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response

  try {
    response = await fetch(`/api${path}`, {
      credentials: 'include',
      headers: { accept: 'application/json', ...init.headers },
      ...init,
    })
  } catch {
    // fetch rejects only when the request never completed: offline, DNS,
    // the API down. Worth its own message, because it is not the API saying no.
    throw new ApiError(0, 'Impossible de joindre le serveur')
  }

  if (response.status === 204) {
    return undefined as T
  }

  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      body &&
      typeof body === 'object' &&
      'error' in body &&
      typeof body.error === 'string'
        ? body.error
        : `Erreur ${String(response.status)}`

    const code =
      body && typeof body === 'object' && 'code' in body && typeof body.code === 'string'
        ? body.code
        : null

    throw new ApiError(response.status, message, code)
  }

  return body as T
}

function withBody(method: string, payload: unknown): RequestInit {
  return payload === undefined
    ? { method }
    : {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, payload?: unknown) =>
    request<T>(path, withBody('POST', payload)),
  patch: <T>(path: string, payload?: unknown) =>
    request<T>(path, withBody('PATCH', payload)),
  delete: (path: string) => request<void>(path, { method: 'DELETE' }),
  /** A DELETE that carries a body, such as a confirmation. */
  deleteWith: <T>(path: string, payload: unknown) =>
    request<T>(path, withBody('DELETE', payload)),
}
