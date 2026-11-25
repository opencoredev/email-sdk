import { WorkflowError } from "./errors.js";
import type { WorkflowDuration } from "./types.js";

const unitMs = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
} as const;

const durationPattern = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)$/;

function isUnit(unit: string): unit is keyof typeof unitMs {
  return Object.hasOwn(unitMs, unit);
}

// Number.isFinite never coerces, so every string duration fails this check.
function isMilliseconds(duration: WorkflowDuration): duration is number {
  return Number.isFinite(duration);
}

/** Converts a workflow duration to milliseconds. Throws on negative or malformed values. */
export function durationToMs(duration: WorkflowDuration): number {
  if (isMilliseconds(duration)) {
    if (duration < 0) {
      throw new WorkflowError("invalid_duration", `Duration ${duration} must not be negative.`);
    }

    return duration;
  }

  const match = durationPattern.exec(String(duration));
  const unit = match?.[2];

  if (!match || unit === undefined || !isUnit(unit)) {
    throw new WorkflowError(
      "invalid_duration",
      `Invalid duration "${String(duration)}". Use a number of ms or a value like "30s", "15m", "2h", "3d", "1w".`,
    );
  }

  return Number(match[1]) * unitMs[unit];
}
