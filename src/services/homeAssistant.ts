import { getOrbitConfig } from './orbitConfig'
import { getHomeAssistantAccessToken } from './homeAssistantAuth'

export interface HAEntity {
  entity_id: string
  state: string
  friendly_name?: string
  attributes?: Record<string, unknown>
}

async function haConfig(): Promise<{ baseUrl: string; token: string } | null> {
  return getHomeAssistantAccessToken()
}

export async function isHomeAssistantConfigured(): Promise<boolean> {
  return !!(await haConfig())
}

async function haFetch(path: string, init?: RequestInit): Promise<Response> {
  const cfg = await haConfig()
  if (!cfg) throw new Error('Home Assistant não configurado (URL + token em /orbit → Configuração)')
  const url = `${cfg.baseUrl}/api${path}`
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
}

export async function getHomeAssistantStates(filter?: string): Promise<HAEntity[]> {
  const res = await haFetch('/states')
  if (!res.ok) throw new Error(`Home Assistant HTTP ${res.status}`)
  const states = (await res.json()) as HAEntity[]
  if (!filter) return states
  const q = filter.toLowerCase()
  return states.filter(s =>
    s.entity_id.toLowerCase().includes(q)
    || (s.attributes?.friendly_name as string | undefined)?.toLowerCase().includes(q),
  )
}

export async function getEntityState(entityId: string): Promise<HAEntity | null> {
  const res = await haFetch(`/states/${encodeURIComponent(entityId)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Home Assistant HTTP ${res.status}`)
  return res.json() as Promise<HAEntity>
}

function resolveDomain(entityId: string): string {
  return entityId.split('.')[0] || 'homeassistant'
}

export async function callHomeAssistantService(
  domain: string,
  service: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  const res = await haFetch(`/services/${domain}/${service}`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
  return res.ok
}

export async function controlHomeAssistantEntity(
  entityOrName: string,
  action: 'on' | 'off' | 'toggle',
  value?: string,
): Promise<{ ok: boolean; entity_id?: string; error?: string }> {
  let entityId = entityOrName.includes('.') ? entityOrName : null

  if (!entityId) {
    const matches = await getHomeAssistantStates(entityOrName)
    const pick = matches.find(e =>
      ['light', 'switch', 'fan', 'climate', 'cover', 'input_boolean'].includes(resolveDomain(e.entity_id)),
    )
    if (!pick) return { ok: false, error: `Entidade não encontrada: ${entityOrName}` }
    entityId = pick.entity_id
  }

  const domain = resolveDomain(entityId)
  let service = action === 'toggle' ? 'toggle' : action === 'on' ? 'turn_on' : 'turn_off'
  const data: Record<string, unknown> = { entity_id: entityId }

  if (domain === 'climate' && action === 'on' && value) {
    service = 'set_temperature'
    data.temperature = parseFloat(value) || 22
  } else if (domain === 'light' && value && action === 'on') {
    const pct = parseInt(value.replace(/\D/g, ''), 10)
    if (!isNaN(pct)) data.brightness_pct = Math.min(100, Math.max(1, pct))
  }

  const ok = await callHomeAssistantService(domain, service, data)
  return ok ? { ok: true, entity_id: entityId } : { ok: false, error: 'Home Assistant recusou o comando' }
}

export async function notifyHomeAssistant(title: string, message: string): Promise<boolean> {
  const notifyTarget = await getOrbitConfig('home_assistant_notify')
  if (!notifyTarget) return false
  const [domain, service] = notifyTarget.includes('.')
    ? notifyTarget.split('.')
    : ['notify', notifyTarget]
  return callHomeAssistantService(domain, service, { title, message })
}

export async function listControllableDevices(limit = 40): Promise<Array<{ entity_id: string; name: string; state: string }>> {
  const states = await getHomeAssistantStates('')
  return states
    .filter(s => ['light', 'switch', 'fan', 'climate', 'cover', 'media_player', 'input_boolean'].includes(resolveDomain(s.entity_id)))
    .slice(0, limit)
    .map(s => ({
      entity_id: s.entity_id,
      name: (s.attributes?.friendly_name as string) || s.entity_id,
      state: s.state,
    }))
}
