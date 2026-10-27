export interface SyncRetryOptions {
  /** True means retryable work remains; reviewable conflicts alone return false. */
  attempt(): Promise<boolean>;
  isActive(): boolean;
  random?: () => number;
}

/** Foreground retry policy. The lifecycle owner must stop it on account/background changes. */
export function createSyncRetry({ attempt, isActive, random = Math.random }: SyncRetryOptions): {
  trigger(): void;
  stop(): void;
} {
  let stopped = false;
  let running = false;
  let retrigger = false;
  let retries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const active = () => !stopped && isActive();
  const cancelTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const schedule = () => {
    if (!active() || retries >= 6) return;
    const jitter = 0.8 + Math.max(0, Math.min(1, random())) * 0.4;
    const delay = Math.min(30_000, Math.round(1000 * 2 ** retries * jitter));
    retries += 1;
    timer = setTimeout(() => {
      timer = undefined;
      void run();
    }, delay);
    (timer as unknown as { unref?: () => void }).unref?.();
  };
  const run = async () => {
    if (!active() || running) return;
    running = true;
    let pending = true;
    try {
      pending = await attempt();
    } catch {
      // Transport/auth failures leave durable work for this bounded retry policy.
    } finally {
      running = false;
    }
    if (!active()) {
      retrigger = false;
      return;
    }
    if (retrigger) {
      // An enqueue near completion must not be lost after an earlier idle read.
      retrigger = false;
      retries = 0;
      void run();
    } else if (pending) schedule();
  };
  return {
    trigger() {
      if (!active()) return;
      retries = 0;
      cancelTimer();
      if (running) retrigger = true;
      else void run();
    },
    stop() {
      stopped = true;
      retrigger = false;
      cancelTimer();
    },
  };
}
