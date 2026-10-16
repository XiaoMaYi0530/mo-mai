/** Rebase pending renderer edits on a newer SQLite/AI snapshot. IDs are stable for workspace lists. */
export function mergeRemoteWorkspace<T>(
  base: T,
  local: T,
  remote: T,
  onConflict?: (path: string[], remoteValue: unknown) => void,
  path: string[] = []
): T {
  if (equal(local, base)) return remote
  if (equal(remote, base)) return local
  if (Array.isArray(local) && Array.isArray(remote) && Array.isArray(base)) {
    if (![...base, ...local, ...remote].every((item) => hasId(item))) return local
    const baseById = new Map(base.map((item) => [item.id, item]))
    const localById = new Map(local.map((item) => [item.id, item]))
    const remoteById = new Map(remote.map((item) => [item.id, item]))
    const ids = [...new Set([...remoteById.keys(), ...localById.keys()])]
    return ids.flatMap((id) => {
      const merged = mergeRemoteWorkspace(baseById.get(id), localById.get(id), remoteById.get(id), onConflict, [...path, id])
      return merged === undefined ? [] : [merged]
    }) as T
  }
  if (isRecord(local) && isRecord(remote) && (isRecord(base) || base === undefined)) {
    const previous: Record<string, unknown> = isRecord(base) ? base : {}
    const result: Record<string, unknown> = {}
    for (const key of new Set([...Object.keys(previous), ...Object.keys(local), ...Object.keys(remote)])) {
      const merged = mergeRemoteWorkspace(previous[key], local[key], remote[key], onConflict, [...path, key])
      if (merged !== undefined) result[key] = merged
    }
    return result as T
  }
  // A genuine same-field conflict keeps the author's current input; callers can archive the remote value.
  onConflict?.(path, remote)
  return local
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasId(value: unknown): value is { id: string } {
  return isRecord(value) && typeof value.id === 'string'
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
