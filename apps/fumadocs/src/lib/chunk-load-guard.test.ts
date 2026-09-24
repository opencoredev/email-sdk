import { describe, expect, test } from "bun:test";

import { chunkLoadGuardScript } from "./chunk-load-guard";

// The guard reads only these members of the events it receives.
type GuardEvent = {
  reason?: Error;
  preventDefault: () => void;
};

type GuardListener = (event: GuardEvent) => void;

function installGuard() {
  const listeners = new Map<string, GuardListener[]>();
  const storage = new Map<string, string>();
  let reloads = 0;

  const fakeWindow = {
    __emailSdkChunkLoadGuardInstalled: false,
    location: {
      pathname: "/docs/guides/authoring/create-adapter",
      search: "",
      reload: () => {
        reloads += 1;
      },
    },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    },
    addEventListener: (type: string, listener: GuardListener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
  };

  new Function("window", chunkLoadGuardScript)(fakeWindow);

  function dispatch(type: string, event: GuardEvent) {
    for (const listener of listeners.get(type) ?? []) {
      listener(event);
    }
  }

  return {
    dispatch,
    get reloads() {
      return reloads;
    },
  };
}

describe("chunk load guard", () => {
  test("reloads on Vite preload errors", () => {
    const guard = installGuard();
    let prevented = false;

    guard.dispatch("vite:preloadError", {
      preventDefault: () => {
        prevented = true;
      },
    });

    expect(prevented).toBe(true);
    expect(guard.reloads).toBe(1);
  });

  test("reloads once for dynamic import promise failures", () => {
    const guard = installGuard();

    const event = {
      reason: new Error(
        "error loading dynamically imported module: https://email-sdk.dev/assets/create-adapter-old.js",
      ),
      preventDefault: () => {},
    };

    guard.dispatch("unhandledrejection", event);
    guard.dispatch("unhandledrejection", event);

    expect(guard.reloads).toBe(1);
  });

  test("ignores unrelated runtime errors", () => {
    const guard = installGuard();

    guard.dispatch("unhandledrejection", {
      reason: new Error("User profile request failed"),
      preventDefault: () => {},
    });

    expect(guard.reloads).toBe(0);
  });
});
