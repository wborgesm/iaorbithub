import { google } from 'googleapis'
import { getOAuth2Client } from './googleAuth'

export interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string
  location?: string
  description?: string
}

export async function listCalendarEvents(days = 7): Promise<CalendarEvent[]> {
  const auth = await getOAuth2Client()
  const calendar = google.calendar({ version: 'v3', auth })
  const now = new Date()
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 20,
  })

  return (res.data.items || []).map(e => ({
    id: e.id || '',
    title: e.summary || '(sem título)',
    start: e.start?.dateTime || e.start?.date || '',
    end: e.end?.dateTime || e.end?.date || '',
    location: e.location || undefined,
    description: e.description || undefined,
  }))
}

export async function createCalendarEvent(params: {
  title: string
  start: string
  end: string
  description?: string
  location?: string
}): Promise<string> {
  const auth = await getOAuth2Client()
  const calendar = google.calendar({ version: 'v3', auth })

  const res = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: params.title,
      description: params.description,
      location: params.location,
      start: { dateTime: new Date(params.start).toISOString(), timeZone: 'Europe/Lisbon' },
      end: { dateTime: new Date(params.end).toISOString(), timeZone: 'Europe/Lisbon' },
    },
  })

  return res.data.id || ''
}
