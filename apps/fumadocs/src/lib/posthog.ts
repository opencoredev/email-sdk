import posthog from "posthog-js";

// Same PostHog project as the SDK/CLI telemetry (write-only public key).
const POSTHOG_PROJECT_KEY = "phc_D62r4m5ivBr6LPCBqjKHg8GL6QTxT57LTzKrmkg5hNZS";

let initialized = false;

export function initPostHog() {
  if (typeof window === "undefined" || initialized) {
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
    // Docs traffic is anonymous (we never identify), so no person profiles are
    // created — mirroring the SDK's server-side $process_person_profile: false.
    person_profiles: "identified_only",
    // Flip to false (plus a sampling rate in project settings) to enable replay.
    disable_session_recording: true,
  });
}
