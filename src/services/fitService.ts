import { getValidAccessToken } from './googleAuth'

const FIT_BASE = 'https://www.googleapis.com/fitness/v1/users/me'

export async function getFitSteps(days = 7): Promise<{ date: string; steps: number }[]> {
  const token = await getValidAccessToken()
  if (!token) return []
  const endMs = Date.now()
  const startMs = endMs - days * 24 * 60 * 60 * 1000

  const body = {
    aggregateBy: [{ dataTypeName: 'com.google.step_count.delta' }],
    bucketByTime: { durationMillis: 86400000 },
    startTimeMillis: startMs,
    endTimeMillis: endMs,
  }

  const res = await fetch(`${FIT_BASE}/dataset:aggregate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return []
  const data = await res.json() as { bucket?: Array<{ startTimeMillis: string; dataset?: Array<{ point?: Array<{ value?: Array<{ intVal?: number }> }> }> }> }

  return (data.bucket || []).map((b) => {
    const date = new Date(parseInt(b.startTimeMillis)).toLocaleDateString('pt-PT')
    const steps = b.dataset?.[0]?.point?.reduce((sum, p) =>
      sum + (p.value?.[0]?.intVal || 0), 0) || 0
    return { date, steps }
  })
}

export async function getFitSleep(days = 7): Promise<{ date: string; durationHours: number }[]> {
  const token = await getValidAccessToken()
  if (!token) return []
  const endMs = Date.now()
  const startMs = endMs - days * 24 * 60 * 60 * 1000

  const body = {
    aggregateBy: [{ dataTypeName: 'com.google.sleep.segment' }],
    bucketByTime: { durationMillis: 86400000 },
    startTimeMillis: startMs,
    endTimeMillis: endMs,
  }

  const res = await fetch(`${FIT_BASE}/dataset:aggregate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return []
  const data = await res.json() as { bucket?: Array<{ startTimeMillis: string; dataset?: Array<{ point?: Array<{ startTimeNanos: string; endTimeNanos: string }> }> }> }

  return (data.bucket || []).map((b) => {
    const date = new Date(parseInt(b.startTimeMillis)).toLocaleDateString('pt-PT')
    const totalMs = b.dataset?.[0]?.point?.reduce((sum, p) => {
      const start = parseInt(p.startTimeNanos) / 1_000_000
      const end = parseInt(p.endTimeNanos) / 1_000_000
      return sum + (end - start)
    }, 0) || 0
    return { date, durationHours: Math.round((totalMs / 3600000) * 10) / 10 }
  }).filter((d) => d.durationHours > 0)
}

export async function getFitHeartRate(days = 7): Promise<{ date: string; avgBpm: number }[]> {
  const token = await getValidAccessToken()
  if (!token) return []
  const endMs = Date.now()
  const startMs = endMs - days * 24 * 60 * 60 * 1000

  const body = {
    aggregateBy: [{ dataTypeName: 'com.google.heart_rate.bpm' }],
    bucketByTime: { durationMillis: 86400000 },
    startTimeMillis: startMs,
    endTimeMillis: endMs,
  }

  const res = await fetch(`${FIT_BASE}/dataset:aggregate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return []
  const data = await res.json() as { bucket?: Array<{ startTimeMillis: string; dataset?: Array<{ point?: Array<{ value?: Array<{ fpVal?: number }> }> }> }> }

  return (data.bucket || []).map((b) => {
    const date = new Date(parseInt(b.startTimeMillis)).toLocaleDateString('pt-PT')
    const bpms = b.dataset?.[0]?.point?.map((p) => p.value?.[0]?.fpVal || 0).filter((v) => v > 0) || []
    const avgBpm = bpms.length ? Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length) : 0
    return { date, avgBpm }
  }).filter((d) => d.avgBpm > 0)
}
