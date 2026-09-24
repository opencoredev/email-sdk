import { describe, expect, test } from "bun:test";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

import { devJsonImports, devJsonImportsMiddleware } from "./dev-json-imports";

function request(url: string, destination?: string, method = "GET") {
  const req = new IncomingMessage(new Socket());
  req.url = url;
  req.method = method;
  // Bun 1.3 leaves `headers` unset on a socket-constructed IncomingMessage.
  req.headers = {};

  if (destination !== undefined) req.headers["sec-fetch-dest"] = destination;

  const nextCalls: unknown[] = [];
  devJsonImportsMiddleware(req, new ServerResponse(req), (error) => nextCalls.push(error));
  expect(nextCalls).toEqual([undefined]);
  expect(req.url).toBe(url);

  return req.headers["sec-fetch-dest"];
}

describe("development JSON import classification", () => {
  test("classifies only known source imports without Fetch Metadata", () => {
    expect(request("/content/community/plugins.json?import")).toBe("script");
    expect(request("/src/lib/docs-lastmod.generated.json?import")).toBe("script");
    expect(request("/src/lib/field-support.generated.json?t=123&import")).toBe("script");
  });

  test("classifies known source imports sent with an empty destination", () => {
    expect(request("/src/lib/docs-lastmod.generated.json?import", "empty")).toBe("script");
    expect(request("/api/data.json?import", "empty")).toBe("empty");
  });

  test("preserves existing document and script destinations", () => {
    for (const destination of ["document", "iframe", "frame", "script", ""]) {
      expect(request("/src/lib/docs-lastmod.generated.json?import", destination)).toBe(destination);
    }
  });

  test("leaves documents, APIs, unknown imports, and writes to the original stack", () => {
    for (const url of [
      "/src/lib/docs-lastmod.generated.json",
      "/src/lib/docs-lastmod.generated.json?import=no",
      "/src/lib/docs-lastmod.generated.json?notimport",
      "/api/search?import",
      "/api/data.json?import",
      "/feed.json?import",
      "/src/lib/missing.json?import",
      "/src/lib/file%20name.json?import",
      "/src/lib/%E6%96%87.json?import",
      "/@fs/etc/passwd?import",
    ]) {
      expect(request(url)).toBeUndefined();
    }

    expect(request("/src/lib/docs-lastmod.generated.json?import", undefined, "POST")).toBeUndefined();
  });

  test("recognizes encoded known paths without rewriting Vite's URL", () => {
    expect(request("/src/lib/%64ocs-lastmod.generated.json?import")).toBe("script");
    expect(request("/src/lib%2Fdocs-lastmod.generated.json?import")).toBeUndefined();
  });

  test("malformed URLs cannot throw or reject asynchronously", () => {
    for (const url of ["//[invalid/data.json?import", "/src/lib/%ZZ.json?import", "", "http://bad/import"]) {
      expect(request(url)).toBeUndefined();
    }
  });

  test("does not apply to production builds", () => {
    expect(devJsonImports().apply).toBe("serve");
  });

  test("registers the middleware on the dev server", () => {
    expect(devJsonImports().configureServer).toBeInstanceOf(Function);
  });
});
