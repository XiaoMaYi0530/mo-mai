export type BackgroundTaskRunner<T> = (signal: AbortSignal) => Promise<T>

type RunningTask<T = unknown> = {
  fingerprint: string
  controller: AbortController
  promise: Promise<T>
  launch: () => void
}

/**
 * 按业务键协调后台任务：相同输入复用，更新输入则取消旧任务并以最新任务为准。
 */
export class BackgroundTaskCoordinator {
  private readonly running = new Map<string, RunningTask>()
  private readonly queue: Array<() => void> = []
  private activeCount = 0
  private readonly maxConcurrent: number

  constructor(maxConcurrent = Number.POSITIVE_INFINITY) {
    this.maxConcurrent = Math.max(1, maxConcurrent)
  }

  private drain(): void {
    while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
      this.queue.shift()?.()
    }
  }

  runLatest<T>(
    key: string,
    fingerprint: string,
    runner: BackgroundTaskRunner<T>
  ): Promise<T> {
    const existing = this.running.get(key)
    if (existing?.fingerprint === fingerprint) {
      return existing.promise as Promise<T>
    }

    existing?.controller.abort(new Error(`Background task superseded: ${key}`))

    const controller = new AbortController()
    let resolvePromise!: (value: T | PromiseLike<T>) => void
    let rejectPromise!: (reason?: unknown) => void
    const record: RunningTask<T> = {
      fingerprint,
      controller,
      promise: new Promise<T>((resolve, reject) => {
        resolvePromise = resolve
        rejectPromise = reject
      }),
      launch: () => {}
    }
    record.launch = () => {
      if (controller.signal.aborted) {
        rejectPromise(controller.signal.reason)
        if (this.running.get(key) === record) this.running.delete(key)
        this.drain()
        return
      }
      this.activeCount += 1
      const finish = () => {
        this.activeCount = Math.max(0, this.activeCount - 1)
        if (this.running.get(key) === record) this.running.delete(key)
        this.drain()
      }
      Promise.resolve()
        .then(() => runner(controller.signal))
        .then(
          (value) => {
            finish()
            resolvePromise(value)
          },
          (error) => {
            finish()
            rejectPromise(error)
          }
        )
    }
    this.running.set(key, record)
    this.queue.push(record.launch)
    this.drain()
    return record.promise
  }

  isRunning(key: string): boolean {
    return this.running.has(key)
  }

  get queuedCount(): number {
    return Math.max(0, this.running.size - this.activeCount)
  }

  cancel(key: string): boolean {
    const task = this.running.get(key)
    if (!task) return false
    task.controller.abort(new Error(`Background task canceled: ${key}`))
    return true
  }
}
