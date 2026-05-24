import { isWhatsAppWebConnected, sendViaWhatsAppWeb } from './whatsappWeb'

/** Apenas WhatsApp Web pessoal do Wanderson — separado de autotrack-whatsapp / OrbitHub OS */
export async function sendWhatsAppMessage(to: string, message: string): Promise<{ ok: boolean; error?: string }> {
  if (!isWhatsAppWebConnected()) {
    return {
      ok: false,
      error:
        'WhatsApp pessoal não ligado. Em /orbit → Configuração liga o TEU número (QR no telemóvel pessoal). Não uses o WhatsApp das empresas.',
    }
  }
  return sendViaWhatsAppWeb(to, message)
}

export async function isWhatsAppConfigured(): Promise<boolean> {
  return isWhatsAppWebConnected()
}
