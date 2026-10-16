/**
 * 全量工作区保存的乐观并发保护。
 * AI 暂存写回直接修改 SQLite；旧窗口随后提交的全量快照不能把新实体删除。
 */
export class WorkspaceRevisionGuard {
  private revision = 0
  private mutationsInProgress = 0

  get currentRevision(): number {
    return this.revision
  }

  get isMutationInProgress(): boolean {
    return this.mutationsInProgress > 0
  }

  stamp<T extends object>(payload: T): T & { workspaceRevision: number } {
    return { ...payload, workspaceRevision: this.revision }
  }

  accepts(payload: unknown): boolean {
    if (this.mutationsInProgress > 0 || !payload || typeof payload !== 'object') return false
    const revision = (payload as { workspaceRevision?: unknown }).workspaceRevision
    return (revision === undefined && this.revision === 0) || revision === this.revision
  }

  beginMutation(): void {
    this.mutationsInProgress += 1
  }

  endMutation(): void {
    this.mutationsInProgress = Math.max(0, this.mutationsInProgress - 1)
  }

  advance<T extends object>(payload: T): T & { workspaceRevision: number } {
    this.revision += 1
    return this.stamp(payload)
  }
}
