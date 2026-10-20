import posthog, { type CaptureResult } from "posthog-js";

import { capturedExceptionList, isBrowserNoiseException } from "./exception-noise";
import { siteUrl } from "./shared";

// Same PostHog project as the SDK/CLI telemetry (write-only public key).
const POSTHOG_PROJECT_KEY = "phc_D62r4m5ivBr6LPCBqjKHg8GL6QTxT57LTzKrmkg5hNZS";

let initialized = false;

// Local dev servers and preview deployments would otherwise report their own
// errors (hydration mismatches during development) as production incidents.
function isProductionHost(hostname: string) {
  const productionHost = new URL(siteUrl).hostname;

  return hostname === productionHost || hostname === `www.${productionHost}`;
}

function dropBrowserNoise(event: CaptureResult | null) {
  const exceptionList = event ? capturedExceptionList(event) : undefined;

  return exceptionList && isBrowserNoiseException(exceptionList) ? null : event;
}

export function initPostHog() {
  if (typeof window === "undefined" || initialized || !isProductionHost(window.location.hostname)) {
    return;
  }

  initialized = true;

  posthog.init(POSTHOG_PROJECT_KEY, {
    api_host: "https://us.i.posthog.com",
    // 2026-01-30 defaults capture pageviews on history changes, covering
    // TanStack Router client-side navigations without a router subscription.
    defaults: "2026-01-30",
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      // Explicitly off: console.error noise would drown real exceptions.
      capture_console_errors: false,
    },
    capture_performance: { web_vitals: true },
    before_send: dropBrowserNoise,
    // Docs traffic is anonymous (we never identify), so no person profiles are
    // created — mirroring the SDK's server-side $process_person_profile: false.
    person_profiles: "identified_only",
    // Flip to false (plus a sampling rate in project settings) to enable replay.
    disable_session_recording: true,
  });
}
