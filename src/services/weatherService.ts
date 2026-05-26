// Serviço de clima — OpenWeatherMap (módulo 49)
const OWM_API_KEY = process.env.OPENWEATHER_API_KEY || ''
const DEFAULT_LAT = 38.7169  // Lisboa
const DEFAULT_LNG = -9.1399

export interface WeatherData {
  temp_c: number
  humidity: number
  rain_mm: number   // precipitação última hora
  wind_kmh: number
  description: string
  fetchedAt: string
}

export async function getCurrentWeather(lat = DEFAULT_LAT, lng = DEFAULT_LNG): Promise<WeatherData | null> {
  if (!OWM_API_KEY) return null
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${OWM_API_KEY}&units=metric`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const data = await res.json() as Record<string, unknown>
    const weather = (data.weather as Array<Record<string, string>>)?.[0]
    const main = data.main as Record<string, number>
    const wind = data.wind as Record<string, number>
    const rain = data.rain as Record<string, number> | undefined
    return {
      temp_c: main?.temp ?? 0,
      humidity: main?.humidity ?? 0,
      rain_mm: rain?.['1h'] ?? 0,
      wind_kmh: Math.round((wind?.speed ?? 0) * 3.6),
      description: weather?.description ?? '',
      fetchedAt: new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export const MADRID_COORDS = { lat: 40.4168, lon: -3.7038, label: 'Madrid' } as const

export interface TripWeatherDay {
  date: string
  summary: string
  tempMin: number
  tempMax: number
}

export interface TripWeatherResult {
  ok: boolean
  location: string
  days: TripWeatherDay[]
}

export async function fetchTripWeather(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string,
  label = '',
): Promise<TripWeatherResult> {
  const empty: TripWeatherResult = { ok: false, location: label, days: [] }
  if (!OWM_API_KEY) return empty
  try {
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${OWM_API_KEY}&units=metric&lang=pt`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return empty
    const data = await res.json() as { list?: Array<Record<string, unknown>> }
    const list = data.list || []

    // Agrupar por dia (YYYY-MM-DD)
    const byDay = new Map<string, { mins: number[]; maxs: number[]; descs: string[] }>()
    for (const item of list) {
      const dtTxt = String(item.dt_txt || '')
      const day = dtTxt.slice(0, 10)
      if (!day) continue
      if (day < startDate || day > endDate) continue
      const main = (item.main as Record<string, number>) || {}
      const w = ((item.weather as Array<Record<string, string>>) || [])[0]
      const bucket = byDay.get(day) || { mins: [], maxs: [], descs: [] }
      bucket.mins.push(Number(main.temp_min ?? main.temp ?? 0))
      bucket.maxs.push(Number(main.temp_max ?? main.temp ?? 0))
      if (w?.description) bucket.descs.push(w.description)
      byDay.set(day, bucket)
    }

    const days: TripWeatherDay[] = Array.from(byDay.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, b]) => {
        const summary = b.descs.length
          ? Array.from(new Set(b.descs)).slice(0, 2).join(', ')
          : 'sem dados'
        return {
          date,
          summary,
          tempMin: Math.round(Math.min(...b.mins)),
          tempMax: Math.round(Math.max(...b.maxs)),
        }
      })

    return { ok: days.length > 0, location: label, days }
  } catch {
    return empty
  }
}
