import { getOrbitConfig } from './orbitConfig'

export async function triggerIFTTT(
  eventName: string,
  value1?: string,
  value2?: string,
  value3?: string,
): Promise<boolean> {
  const key = await getOrbitConfig('ifttt_key')
  if (!key) return false
  try {
    const url = `https://maker.ifttt.com/trigger/${encodeURIComponent(eventName)}/with/key/${key}`
    const body: Record<string, string> = {}
    if (value1) body.value1 = value1
    if (value2) body.value2 = value2
    if (value3) body.value3 = value3
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return resp.ok
  } catch {
    return false
  }
}
