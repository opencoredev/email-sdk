import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getMDXComponents } from "./mdx";

test("verification page renders the evidence table with the honest empty state", () => {
  const source = readFileSync(new URL("../../content/docs/adapters/verification.mdx", import.meta.url), "utf8");
  const components = getMDXComponents();
  expect(source).toContain("<AdapterVerification />");
  expect(typeof components.AdapterVerification).toBe("function");
  const html = renderToStaticMarkup(createElement(components.AdapterVerification, {}));
  expect(html).toContain("No published run evidence");
  expect(html).toContain("Live check available");
  expect(html).not.toMatch(/\bVerified\b(?! send| delivery)/);
  expect(html).not.toContain("Source run");
});

test("Convex overview uses the registered card container", () => {
  const source = readFileSync(new URL("../../content/docs/integrations/convex/index.mdx", import.meta.url), "utf8");
  const components = getMDXComponents();
  expect(source).toContain("<Cards>");
  expect(source).not.toContain("CardGroup");
  expect(typeof components.Cards).toBe("function");
  const html = renderToStaticMarkup(createElement(components.Cards, {}, createElement("a", { href: "/docs/integrations/convex/webhooks" }, "Process webhooks")));
  expect(html).toContain("Process webhooks");
  expect(html).toContain("/docs/integrations/convex/webhooks");
});
