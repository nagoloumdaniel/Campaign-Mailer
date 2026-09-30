import { api } from './api'

/** The two scopes of the roadmap, with what each lets the other application do. */
export const INTEGRATION_SCOPES = [
  { value: 'campaigns:write', label: 'Créer des campagnes en brouillon' },
  { value: 'contacts:write', label: 'Ajouter des contacts à un brouillon' },
] as const

export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number]['value']

export interface IntegrationToken {
  id: string
  name: string
  prefix: string
  scopes: IntegrationScope[]
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
}

export const integrationTokensApi = {
  list: () =>
    api.get<{ tokens: IntegrationToken[]; max_active: number }>('/integration-tokens'),
  create: (name: string, scopes: IntegrationScope[]) =>
    api.post<{ token: IntegrationToken; secret: string }>('/integration-tokens', {
      name,
      scopes,
    }),
  revoke: (id: string) => api.delete(`/integration-tokens/${encodeURIComponent(id)}`),
}
