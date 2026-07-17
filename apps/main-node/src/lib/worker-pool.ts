export interface WorkerPoolJob {
  jobId: string;
  tenantId: string;
  sessionId: string;
  run(signal: AbortSignal): Promise<void>;
}

export type WorkerPoolOutcome = "completed" | "failed" | "cancelled" | "timeout";

export interface WorkerPoolOptions {
  maxActive: number;
  tenantMaxActive: number;
  timeoutMs?: number;
  onEvent?: (event: { type: "started" | "completed" | "failed" | "cancelled" | "timeout"; jobId: string; tenantId: string; durationMs: number }) => void;
}

export class WorkerPool {
  private readonly queue: WorkerPoolJob[] = [];
  private readonly running = new Map<string, { job: WorkerPoolJob; controller: AbortController; promise: Promise<void> }>();
  private readonly tenantActive = new Map<string, number>();
  private readonly completions = new Map<string, Promise<WorkerPoolOutcome>>();
  private readonly completionResolvers = new Map<string, (outcome: WorkerPoolOutcome) => void>();
  private stopped = false;

  constructor(private readonly options: WorkerPoolOptions) {
    if (options.maxActive < 1 || options.tenantMaxActive < 1) throw new Error("worker limits must be positive");
  }

  async submit(job: WorkerPoolJob): Promise<{ jobId: string; status: "queued" }> {
    if (this.stopped) throw new Error("worker pool is shut down");
    if (this.running.has(job.jobId) || this.queue.some((queued) => queued.jobId === job.jobId)) {
      throw new Error(`duplicate worker job: ${job.jobId}`);
    }
    this.queue.push(job);
    let resolveCompletion!: (outcome: WorkerPoolOutcome) => void;
    this.completions.set(job.jobId, new Promise<WorkerPoolOutcome>((resolve) => {
      resolveCompletion = resolve;
    }));
    this.completionResolvers.set(job.jobId, resolveCompletion);
    this.pump();
    return { jobId: job.jobId, status: "queued" };
  }

  async waitFor(jobId: string): Promise<WorkerPoolOutcome | undefined> {
    const completion = this.completions.get(jobId);
    if (!completion) return undefined;
    const outcome = await completion;
    this.completions.delete(jobId);
    this.completionResolvers.delete(jobId);
    return outcome;
  }

  async cancel(jobId: string): Promise<boolean> {
    const queuedIndex = this.queue.findIndex((job) => job.jobId === jobId);
    if (queuedIndex >= 0) {
      const [job] = this.queue.splice(queuedIndex, 1);
      this.completionResolvers.get(job!.jobId)?.("cancelled");
      return true;
    }
    const current = this.running.get(jobId);
    if (!current) return false;
    current.controller.abort("cancelled");
    return true;
  }

  async stats(): Promise<{ queued: number; running: number; byTenant: Record<string, number> }> {
    const byTenant: Record<string, number> = {};
    for (const job of this.queue) byTenant[job.tenantId] = (byTenant[job.tenantId] ?? 0) + 1;
    for (const { job } of this.running.values()) byTenant[job.tenantId] = (byTenant[job.tenantId] ?? 0) + 1;
    return { queued: this.queue.length, running: this.running.size, byTenant };
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    for (const job of this.queue.splice(0)) {
      this.completionResolvers.get(job.jobId)?.("cancelled");
    }
    for (const current of this.running.values()) current.controller.abort("shutdown");
    await Promise.all([...this.completions.values()]);
    this.completions.clear();
    this.completionResolvers.clear();
  }

  private pump(): void {
    while (!this.stopped && this.running.size < this.options.maxActive) {
      const index = this.queue.findIndex((job) => (this.tenantActive.get(job.tenantId) ?? 0) < this.options.tenantMaxActive);
      if (index < 0) return;
      const job = this.queue.splice(index, 1)[0]!;
      const controller = new AbortController();
      this.tenantActive.set(job.tenantId, (this.tenantActive.get(job.tenantId) ?? 0) + 1);
      const startedAt = Date.now();
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const promise = (async () => {
        this.options.onEvent?.({ type: "started", jobId: job.jobId, tenantId: job.tenantId, durationMs: 0 });
        let outcome: WorkerPoolOutcome = "completed";
        try {
          if (this.options.timeoutMs && this.options.timeoutMs > 0) {
            timeoutId = setTimeout(() => controller.abort("timeout"), this.options.timeoutMs);
          }
          await job.run(controller.signal);
          outcome = controller.signal.aborted
            ? controller.signal.reason === "timeout" ? "timeout" : "cancelled"
            : "completed";
          this.options.onEvent?.({ type: outcome, jobId: job.jobId, tenantId: job.tenantId, durationMs: Date.now() - startedAt });
        } catch (error) {
          outcome = controller.signal.reason === "timeout" ? "timeout" : controller.signal.reason === "cancelled" || controller.signal.reason === "shutdown" ? "cancelled" : "failed";
          this.options.onEvent?.({ type: outcome, jobId: job.jobId, tenantId: job.tenantId, durationMs: Date.now() - startedAt });
          void error;
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
          this.running.delete(job.jobId);
          this.completionResolvers.get(job.jobId)?.(outcome);
          const count = (this.tenantActive.get(job.tenantId) ?? 1) - 1;
          if (count <= 0) this.tenantActive.delete(job.tenantId); else this.tenantActive.set(job.tenantId, count);
          this.pump();
        }
      })();
      this.running.set(job.jobId, { job, controller, promise });
    }
  }
}
