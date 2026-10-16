export function resolveAssistantWidth(preferred: number, viewport: number, hasSidebar: boolean): number {
  const reserved = (hasSidebar ? 280 : 0) + 420 + 4
  return Math.max(280, Math.min(Number.isFinite(preferred) ? preferred : 380, 760, viewport - reserved))
}
