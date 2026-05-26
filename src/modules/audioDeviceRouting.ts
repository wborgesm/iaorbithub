import { Request } from 'express'
import { getOrbitConfig } from '../services/orbitConfig'

export interface AudioRouteDecision {
  sourceDevice: string
  deliverViaApiOnly: boolean
  includeTtsAudio: boolean
  suppressMobilePush: boolean
}

export function parseSourceDevice(req: Request): string {
  const bodyVal = (req.body as { source_device?: unknown })?.source_device
  const headerVal = req.headers['x-source-device']
  if (typeof bodyVal === 'string' && bodyVal.trim()) return bodyVal.trim()
  if (typeof headerVal === 'string' && headerVal.trim()) return headerVal.trim()
  return ''
}

export function resolveAudioRoute(sourceDevice: string): AudioRouteDecision {
  if (sourceDevice === 'siri_iphone') {
    return {
      sourceDevice,
      deliverViaApiOnly: true,
      includeTtsAudio: false,
      suppressMobilePush: true,
    }
  }
  if (sourceDevice === 'mac_microphone') {
    return {
      sourceDevice,
      deliverViaApiOnly: false,
      includeTtsAudio: true,
      suppressMobilePush: true,
    }
  }
  return {
    sourceDevice: sourceDevice || 'default',
    deliverViaApiOnly: false,
    includeTtsAudio: false,
    suppressMobilePush: false,
  }
}

export async function fetchOrbitTtsAudio(text: string): Promise<Buffer | null> {
  const apiKey = await getOrbitConfig('elevenlabs_key')
  if (!apiKey || !text.trim()) return null

  const voiceId = (await getOrbitConfig('elevenlabs_voice_id')) || 'XB0fDUnXU5powFXDhCwa'
  try {
    const elRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?optimize_streaming_latency=3`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: text.slice(0, 2000),
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.45, similarity_boost: 0.82, style: 0.0, use_speaker_boost: true },
      }),
    })
    if (!elRes.ok) return null
    return Buffer.from(await elRes.arrayBuffer())
  } catch {
    return null
  }
}

export async function buildRoutedVoiceResponse(
  reply: string,
  sessionId: string,
  route: AudioRouteDecision,
): Promise<Record<string, unknown>> {
  if (route.sourceDevice === 'default') {
    return { reply, sessionId }
  }

  const base: Record<string, unknown> = {
    reply,
    sessionId,
    source_device: route.sourceDevice,
    suppressMobilePush: route.suppressMobilePush,
  }

  if (route.deliverViaApiOnly) {
    return { ...base, route: 'api_only' }
  }

  if (route.includeTtsAudio) {
    const audio = await fetchOrbitTtsAudio(reply)
    return {
      ...base,
      route: 'mac_tts',
      ...(audio ? { audioBase64: audio.toString('base64'), contentType: 'audio/mpeg' } : {}),
    }
  }

  return { reply, sessionId }
}
