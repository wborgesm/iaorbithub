import { getOrbitConfig } from '../services/orbitConfig'

export interface DivisaoLucrosResult {
  faturamentoTotal: number
  despesasFixas: number
  liquido: number
  socios: Record<string, number>
}

export async function calcularDivisaoLucros(faturamentoTotal: number): Promise<DivisaoLucrosResult> {
  const rawDespesas = await getOrbitConfig('finance_fixed_expenses')
  let despesasFixas = 0
  if (rawDespesas) {
    try {
      const parsed = JSON.parse(rawDespesas) as Record<string, number> | number[]
      if (Array.isArray(parsed)) {
        despesasFixas = parsed.reduce((s, v) => s + (Number(v) || 0), 0)
      } else {
        despesasFixas = Object.values(parsed).reduce((s, v) => s + (Number(v) || 0), 0)
      }
    } catch {
      despesasFixas = parseFloat(rawDespesas) || 0
    }
  }

  const liquido = Math.max(0, faturamentoTotal - despesasFixas)
  const pctRaw = await getOrbitConfig('finance_partner_pct')
  let pct: Record<string, number> = { socio1: 40, socio2: 35, socio3: 25 }
  if (pctRaw) {
    try {
      pct = JSON.parse(pctRaw) as Record<string, number>
    } catch { /* defaults */ }
  }

  const socios: Record<string, number> = {}
  for (const [nome, percent] of Object.entries(pct)) {
    socios[nome] = Math.round((liquido * (Number(percent) || 0) / 100) * 100) / 100
  }

  return { faturamentoTotal, despesasFixas, liquido, socios }
}
