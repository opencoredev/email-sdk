import { durationToMs } from "./duration.js";
import type {
  WorkflowClock,
  WorkflowDuration,
  WorkflowEngine,
  WorkflowRun,
  WorkflowScheduler,
  WorkflowStore,
  WorkflowTimer,
} from "./types.js";

const terminalStatuses = new Set(["completed", "failed", "canceled"]);

/** True for `completed`, `failed`, and `canceled` runs, which never execute again. */
export function isTerminalRun(run: WorkflowRun): boolean {
  return terminalStatuses.has(run.status);
}

/** Round-trips through JSON, so tests see exactly what a database-backed store would return. */
function copyRun(run: WorkflowRun): WorkflowRun {
  // SAFETY: the value was produced by JSON.stringify of a WorkflowRun one line earlier, and every
  // WorkflowRun field is JSON, so parsing restores the same type.
  return JSON.parse(JSON.stringify(run)) as WorkflowRun;
}

/** The store `createMemoryWorkflowStore` returns, with `runs()` for test assertions. */
export type MemoryWorkflowStore = WorkflowStore & {
  /** Every stored run, in insertion order. */
  runs(): WorkflowRun[];
};

/** A process-local store for tests and development. State is lost on restart. */
export function createMemoryWorkflowStore(): MemoryWorkflowStore {
  const runs = new Map<string, WorkflowRun>();

  return {
    async get(id) {
      const run = runs.get(id);

      return run ? copyRun(run) : undefined;
    },
    async create(run) {
      if (runs.has(run.id)) return false;
      runs.set(run.id, copyRun(run));

      return true;
    },
    async save(run, expectedRevision) {
      const current = runs.get(run.id);

      if (!current || current.revision !== expectedRevision) return false;
      runs.set(run.id, copyRun(run));

      return true;
    },
    async listActiveBySubject(subject) {
      return [...runs.values()].flatMap((run) =>
        run.subject === subject && !isTerminalRun(run) ? [copyRun(run)] : [],
      );
    },
    async listDue(now, limit, cursor) {
      // The cursor is `<dueAt>:<id>` of the last id returned, ordered by (dueAt, id), so a page
      // boundary stays put while runs that were just resumed move their dueAt into the future.
      const split = cursor === undefined ? -1 : cursor.indexOf(":");
      const afterDue = cursor === undefined ? undefined : Number(cursor.slice(0, split));
      const afterId = cursor?.slice(split + 1) ?? "";

      const isAfterCursor = (run: { dueAt: number; id: string }) =>
        afterDue === undefined || run.dueAt > afterDue || (run.dueAt === afterDue && run.id > afterId);

      const due = [...runs.values()]
        .flatMap((run) => (run.dueAt !== undefined && run.dueAt <= now ? [{ dueAt: run.dueAt, id: run.id }] : []))
        .filter(isAfterCursor)
        .sort((a, b) => a.dueAt - b.dueAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

      const page = due.slice(0, Math.max(0, limit));
      const last = page.at(-1);
      const ids = page.map((run) => run.id);

      return due.length > page.length && last !== undefined ? { ids, cursor: `${last.dueAt}:${last.id}` } : { ids };
    },
    runs() {
      return [...runs.values()].map(copyRun);
    },
  };
}

/** The clock `createManualClock` returns. */
export type ManualClock = WorkflowClock & {
  /** Jumps to an absolute time. */
  set(at: Date | number): void;
  /** Moves forward by `duration` and returns the new time. Fires no timers on its own. */
  advance(duration: WorkflowDuration): number;
};

/** A clock that only moves when told to. Pair it with the memory scheduler for deterministic tests. */
export function createManualClock(start: Date | number = 0): ManualClock {
  let now = Number(start);

  return {
    now: () => now,
    set(at) {
      now = Number(at);
    },
    advance(duration) {
      now += durationToMs(duration);

      return now;
    },
  };
}

/** The scheduler `createMemoryWorkflowScheduler` returns, with controls for firing timers in tests. */
export type MemoryWorkflowScheduler = WorkflowScheduler & {
  /** Pending timers sorted by fire time. */
  pending(): WorkflowTimer[];
  /** Fires, in order, every timer due at the clock's current time. Returns how many fired. */
  runDue(engine: Pick<WorkflowEngine, "resume">): Promise<number>;
  /** Advances the clock timer by timer, resuming runs as their timers come due. */
  advance(duration: WorkflowDuration, engine: Pick<WorkflowEngine, "resume">): Promise<number>;
};

/**
 * Holds one timer per run in memory and fires it only when `runDue` or `advance` is called. A
 * timer from an older run revision than the newest one scheduled for that run is dropped, so a
 * claim's lease-expiry wake and a later wait's wake replace each other in the order they were saved.
 */
export function createMemoryWorkflowScheduler(clock: ManualClock): MemoryWorkflowScheduler {
  const timers = new Map<string, WorkflowTimer>();
  const newestRevision = new Map<string, number>();

  const sorted = () => [...timers.values()].sort((a, b) => a.at - b.at);

  async function fireDueAt(now: number, engine: Pick<WorkflowEngine, "resume">) {
    let fired = 0;

    for (let next = sorted()[0]; next && next.at <= now; next = sorted()[0]) {
      timers.delete(next.runId);
      fired += 1;
      await engine.resume(next.runId);
    }

    return fired;
  }

  return {
    schedule(timer) {
      if (timer.revision < (newestRevision.get(timer.runId) ?? -1)) return;

      newestRevision.set(timer.runId, timer.revision);
      timers.set(timer.runId, { ...timer });
    },
    cancel(runId) {
      timers.delete(runId);
      newestRevision.delete(runId);
    },
    pending: sorted,
    runDue: (engine) => fireDueAt(clock.now(), engine),
    async advance(duration, engine) {
      const target = clock.now() + durationToMs(duration);
      let fired = 0;

      for (let next = sorted()[0]; next && next.at <= target; next = sorted()[0]) {
        if (next.at > clock.now()) clock.set(next.at);
        fired += await fireDueAt(clock.now(), engine);
      }

      clock.set(target);

      return fired;
    },
  };
}
