(function attachDesktopDevHotReload(global) {
  const fallbackEndpoint = "http://127.0.0.1:39411/easy-mc-hot-reload";
  const endpoint = global.location?.protocol?.startsWith("http")
    ? `${global.location.origin}/easy-mc-hot-reload`
    : fallbackEndpoint;
  const intervalMs = 700;
  let seenVersion = null;
  let reloading = false;

  async function poll() {
    if (reloading || typeof global.fetch !== "function") {
      return;
    }

    try {
      const response = await global.fetch(endpoint, { cache: "no-store" });
      if (!response.ok) {
        return;
      }

      const payload = await response.json();
      if (payload?.app !== "easy-mc-desktop" || typeof payload.version !== "number") {
        return;
      }

      if (seenVersion === null) {
        seenVersion = payload.version;
        return;
      }

      if (payload.version !== seenVersion) {
        reloading = true;
        global.location.reload();
      }
    } catch {
      // The hot reload server only exists during desktop development.
    }
  }

  if (global.location && typeof global.setInterval === "function") {
    global.setInterval(poll, intervalMs);
    poll();
  }
})(typeof window !== "undefined" ? window : globalThis);
