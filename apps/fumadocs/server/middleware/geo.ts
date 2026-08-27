import { Tracker } from "@usenotra/geo";
import { defineMiddleware } from "nitro";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const tracker = new Tracker({
  token: process.env.NOTRA_GEO_TOKEN ?? "",
  endpoint: "https://app.usenotra.com",
  exclude: [
    "/api",
    // The build-time prerender pass requests every page against localhost
    // through this same bundle; without this rule every deploy would log
    // hundreds of phantom page hits. Also keeps local dev out of analytics.
    (_request, url) => LOCAL_HOSTNAMES.has(url.hostname),
  ],
});

export default defineMiddleware((event) => {
  event.waitUntil(tracker.track(event.req));
});
