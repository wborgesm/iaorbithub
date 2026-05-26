import { getOrbitConfig } from './orbitConfig'
import { callHomeAssistantService, isHomeAssistantConfigured } from './homeAssistant'

export async function triggerFocusModeWebhook(active: boolean): Promise<{ ok: boolean; error?: string }> {
  const customUrl = (await getOrbitConfig('ha_focus_webhook_url')).trim()
  if (customUrl) {
    try {
      const res = await fetch(customUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: active ? 'focus_on' : 'focus_off', source: 'orbit' }),
      })
      return res.ok ? { ok: true } : { ok: false, error: `Webhook HA HTTP ${res.status}` }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Erro webhook' }
    }
  }

  if (!(await isHomeAssistantConfigured())) {
    return { ok: false, error: 'HA não configurado — define ha_focus_webhook_url ou liga Home Assistant' }
  }

  const script = await getOrbitConfig('ha_focus_script')
  if (script) {
    const [domain, service] = script.includes('.') ? script.split('.') : ['script', script]
    const ok = await callHomeAssistantService(domain, service, { action: active ? 'on' : 'off' })
    return ok ? { ok: true } : { ok: false, error: 'Script HA falhou' }
  }

  const ok = await callHomeAssistantService('light', 'turn_off', {
    entity_id: (await getOrbitConfig('ha_focus_lights')) || 'light.escritorio',
  })
  return ok ? { ok: true } : { ok: false, error: 'Comando luz HA falhou' }
}

export async function haEnergySaveMode(): Promise<boolean> {
  const script = await getOrbitConfig('ha_idle_script')
  if (script) {
    const [domain, service] = script.includes('.') ? script.split('.') : ['script', script]
    return callHomeAssistantService(domain, service, {})
  }
  return callHomeAssistantService('media_player', 'turn_off', {
    entity_id: (await getOrbitConfig('ha_media_players')) || 'media_player.sala',
  })
}

export async function haPlayTts(text: string): Promise<{ ok: boolean; error?: string }> {
  const player = (await getOrbitConfig('ha_tts_media_player')) || 'media_player.sala'
  const ttsService = (await getOrbitConfig('ha_tts_service')) || 'tts.google_translate_say'
  const [domain, service] = ttsService.includes('.') ? ttsService.split('.') : ['tts', 'google_translate_say']
  const ok = await callHomeAssistantService(domain, service, {
    entity_id: player,
    message: text.slice(0, 2000),
    language: 'pt',
  })
  return ok ? { ok: true } : { ok: false, error: 'TTS HA falhou' }
}
