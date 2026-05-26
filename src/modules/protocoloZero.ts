let active = false

export function isProtocoloZeroActive(): boolean {
  return active
}

export function activateProtocoloZero(): void {
  active = true
  console.warn('[protocoloZero] ACTIVO — serviços públicos suspensos (BD intacta)')
}

export function deactivateProtocoloZero(): void {
  active = false
  console.log('[protocoloZero] Desactivado — serviços públicos restaurados')
}

export function detectProtocoloZeroCommand(message: string): boolean {
  return /orbit\s*,?\s*protocolo\s+zero/i.test(message.trim())
}
