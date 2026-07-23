import { describe, expect, test } from "bun:test";
import { createElement } from "react";

import {
  createShadcnEmailTheme,
  EmailButton,
  EmailCard,
  EmailHeading,
  EmailText,
  renderEmail,
  ShadcnEmail,
} from "./react.js";

describe("renderEmail", () => {
  test("renders one React template to HTML and plain text", async () => {
    const content = await renderEmail(
      createElement("main", null, createElement("h1", null, "Welcome, Ada")),
    );

    expect(content.html).toContain("<h1>Welcome, Ada</h1>");
    expect(content.text).toBe("WELCOME, ADA");
  });

  test("renders shadcn-themed email primitives with inline styles", async () => {
    const content = await renderEmail(
      createElement(
        ShadcnEmail,
        { preview: "Your account is ready.", theme: "dark" },
        createElement(
          EmailCard,
          null,
          createElement(EmailHeading, null, "Welcome, Ada"),
          createElement(EmailText, { muted: true }, "Your account is ready."),
          createElement(EmailButton, { href: "https://example.com" }, "Open dashboard"),
        ),
      ),
    );

    expect(content.html).toContain("background-color:#09090b");
    expect(content.html).toContain("background-color:#18181b");
    expect(content.html).toContain("color:#a1a1aa");
    expect(content.html).toContain('href="https://example.com"');
    expect(content.html).not.toContain("class=");
    expect(content.text).toContain("WELCOME, ADA");
  });

  test("accepts resolved shadcn token overrides", () => {
    expect(
      createShadcnEmailTheme({
        mode: "dark",
        primary: "#7c3aed",
        radius: 12,
      }),
    ).toMatchObject({
      background: "#09090b",
      primary: "#7c3aed",
      radius: 12,
    });
  });
});
