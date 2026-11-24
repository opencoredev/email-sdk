import { describe, expect, test } from "bun:test";

import { UNRELEASED_MARKER, checkPublishedExports } from "./check-published-exports.ts";

const published = [".", "./webhooks", "./react"];

const local = [...published, "./inbound"];

describe("checkPublishedExports", () => {
  test("flags a page that imports an unpublished subpath without the marker", () => {
    const report = checkPublishedExports({
      localExports: local,
      publishedExports: published,
      files: [
        {
          path: "guide.mdx",
          content: 'import { handleInbound } from "@opencoredev/email-sdk/inbound";',
        },
        {
          path: "webhooks.mdx",
          content: 'import { verify } from "@opencoredev/email-sdk/webhooks";',
        },
      ],
    });

    expect(report.unpublished).toEqual(["./inbound"]);
    expect(report.unmarked).toEqual([{ path: "guide.mdx", subpaths: ["./inbound"] }]);
  });

  test("accepts the page once it carries the unreleased marker", () => {
    const report = checkPublishedExports({
      localExports: local,
      publishedExports: published,
      files: [
        {
          path: "guide.mdx",
          content: `\`@opencoredev/email-sdk/inbound\` ${UNRELEASED_MARKER}.\n\nimport "@opencoredev/email-sdk/inbound";`,
        },
      ],
    });

    expect(report.unmarked).toEqual([]);
    expect(report.staleMarkers).toEqual([]);
  });

  test("reports a leftover marker after the subpath is published", () => {
    const report = checkPublishedExports({
      localExports: local,
      publishedExports: local,
      files: [
        { path: "guide.mdx", content: `@opencoredev/email-sdk/inbound ${UNRELEASED_MARKER}.` },
      ],
    });

    expect(report.unmarked).toEqual([]);
    expect(report.staleMarkers).toEqual(["guide.mdx"]);
  });

  test("matches whole subpaths, so a published prefix does not hide an unpublished one", () => {
    const report = checkPublishedExports({
      localExports: [...published, "./react-email"],
      publishedExports: published,
      files: [
        { path: "react.mdx", content: 'import { render } from "@opencoredev/email-sdk/react";' },
        { path: "react-email.mdx", content: 'import "@opencoredev/email-sdk/react-email";' },
      ],
    });

    expect(report.unmarked).toEqual([{ path: "react-email.mdx", subpaths: ["./react-email"] }]);
  });
});
