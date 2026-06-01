export const chunkLoadGuardScript = `
(() => {
  const win = window;

  if (win.__emailSdkChunkLoadGuardInstalled) {
    return;
  }

  win.__emailSdkChunkLoadGuardInstalled = true;

  const reloadTtlMs = 60 * 1000;
  const storageKey = "__emailSdkChunkLoadReload";
  const chunkErrorPattern =
    /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk [\\w-]+ failed/i;

  function getMessage(value) {
    if (!value) {
      return "";
    }

    if (typeof value === "string") {
      return value;
    }

    return String(value.message || value.reason?.message || value.error?.message || value);
  }

  function shouldRecover(value) {
    return chunkErrorPattern.test(getMessage(value));
  }

  function recover() {
    const now = Date.now();
    const key = storageKey + ":" + win.location.pathname + win.location.search;
    const previous = Number(win.sessionStorage?.getItem(key) || 0);

    if (previous && now - previous < reloadTtlMs) {
      return;
    }

    win.sessionStorage?.setItem(key, String(now));
    win.location.reload();
  }

  win.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    recover();
  });

  win.addEventListener("unhandledrejection", (event) => {
    if (!shouldRecover(event.reason)) {
      return;
    }

    event.preventDefault();
    recover();
  });

  win.addEventListener(
    "error",
    (event) => {
      if (!shouldRecover(event)) {
        return;
      }

      event.preventDefault();
      recover();
    },
    true,
  );
})();
`;
