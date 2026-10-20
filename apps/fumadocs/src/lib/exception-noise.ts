import type { CaptureResult } from "posthog-js";
import { z } from "zod";

// Only the fields the filter reads. PostHog's exception list carries more.
const exceptionListSchema = z.array(
  z.object({
    value: z.string().optional(),
    stacktrace: z
      .object({
        frames: z
          .array(z.object({ filename: z.string().optional(), source: z.string().optional() }))
          .optional(),
      })
      .nullish(),
  }),
);

// Messages that only browser extensions and in-app browsers produce on this site.
const EXTENSION_MESSAGE_PATTERN =
  /webkit\.messageHandlers|No Listener: tabs:|Extension context invalidated|runtime\.sendMessage/i;

const EXTENSION_FRAME_PATTERN = /^(?:chrome|moz|safari|safari-web)-extension:\/\//;

export type ExceptionList = z.infer<typeof exceptionListSchema>;

/** The exception list of a captured `$exception` event, or nothing for other events. */
export function capturedExceptionList(event: CaptureResult): ExceptionList | undefined {
  if (event.event !== "$exception") return undefined;

  const parsed = exceptionListSchema.safeParse(event.properties.$exception_list);

  return parsed.success ? parsed.data : undefined;
}

/**
 * True when a captured exception comes from a browser extension or is a
 * cross-origin "Script error." with nothing to debug. Those drown out real
 * site errors and must not open incidents.
 */
export function isBrowserNoiseException(exceptionList: ExceptionList) {
  if (exceptionList.length === 0) return false;

  return exceptionList.every((exception) => {
    const frames = exception.stacktrace?.frames ?? [];
    const files = frames.map((frame) => frame.filename ?? frame.source ?? "");
    const value = exception.value ?? "";

    if (files.length > 0 && files.every((file) => EXTENSION_FRAME_PATTERN.test(file))) return true;

    return value === "Script error." || EXTENSION_MESSAGE_PATTERN.test(value);
  });
}
