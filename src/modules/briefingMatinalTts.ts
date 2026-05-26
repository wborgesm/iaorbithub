import { listCalendarEvents } from '../services/calendarService'
import { isGoogleConnected } from '../services/googleAuth'
import { getOrbitConfig } from '../services/orbitConfig'
import { generateMorningBriefing } from '../workers/morningBriefing'

export async function generateMorningBriefingTts(): Promise<string> {
  const vendas = await getOrbitConfig('yesterday_sales')
  const vendasLine = vendas ? `Vendas de ontem: ${vendas} euros.` : 'Vendas de ontem: sem dados registados.'

  let compromissosLine = 'Compromissos de hoje: calendário não ligado.'
  if (await isGoogleConnected()) {
    try {
      const events = await listCalendarEvents(1)
      if (events.length === 0) {
        compromissosLine = 'Compromissos de hoje: agenda livre.'
      } else {
        const list = events.slice(0, 5).map(e => e.title || 'Evento').join(', ')
        compromissosLine = `Compromissos de hoje: ${list}.`
      }
    } catch {
      compromissosLine = 'Compromissos de hoje: não foi possível ler o calendário.'
    }
  }

  const briefing = (await generateMorningBriefing()) || ''
  const briefingShort = briefing.replace(/\n+/g, '. ').slice(0, 600)

  return `Bom dia Wanderson. ${vendasLine} ${compromissosLine} ${briefingShort}`.slice(0, 1900)
}
