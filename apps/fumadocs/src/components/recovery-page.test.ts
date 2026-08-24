import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AppErrorPage,
  NotFoundPage,
  RootRecoveryShell,
  classifyRecoveryError,
  getErrorMessage,
  recoveryRobots,
} from "./recovery-page";

describe("recovery page helpers", () => {
  test("classifies stale chunk load failures", () => {
    expect(
      classifyRecoveryError(
        new Error(
          "error loading dynamically imported module: https://email-sdk.dev/assets/create-adapter-old.js",
        ),
      ),
    ).toBe("chunk");
  });

  test("classifies external DOM mutation failures", () => {
    expect(
      classifyRecoveryError(
        new Error(
          "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
        ),
      ),
    ).toBe("dom");
  });

  test("keeps unknown errors generic", () => {
    expect(classifyRecoveryError(new Error("Unexpected request failure"))).toBe("runtime");
  });

  test("extracts error messages safely", () => {
    expect(getErrorMessage("plain failure")).toBe("plain failure");
    expect(getErrorMessage({ message: "object failure" })).toBe("object failure");
    expect(getErrorMessage(new Error("instance failure"))).toBe("instance failure");
    expect(getErrorMessage(0)).toBe("0");
    expect(getErrorMessage(null)).toBe("No error details were provided.");
    expect(getErrorMessage(undefined)).toBe("No error details were provided.");

    const namelessError = new Error();
    namelessError.name = "";
    expect(getErrorMessage(namelessError)).toBe("Unknown error");
  });
});

describe("recovery page markup", () => {
  test("error page renders without a fumadocs provider and stays off the default TanStack copy", () => {
    const html = renderToStaticMarkup(
      AppErrorPage({
        error: new Error("You need to wrap your application inside FrameworkProvider"),
        reset: () => undefined,
      }),
    );

    expect(html).not.toContain("Something went wrong");
    expect(html).not.toContain("Show Error");
    expect(html).toContain('name="robots"');
    expect(html).toContain(recoveryRobots);
    expect(html).toContain("The docs could not finish loading.");
  });

  test("not-found page is noindex and does not use the default error copy", () => {
    const html = renderToStaticMarkup(NotFoundPage());

    expect(html).not.toContain("Something went wrong");
    expect(html).not.toContain("Show Error");
    expect(html).toContain(recoveryRobots);
    expect(html).toContain("That docs route is not here.");
  });

  test("root recovery shell ships a titled noindex document", () => {
    const html = renderToStaticMarkup(
      RootRecoveryShell({
        children: "recovery",
        stylesheetHref: "/app.css",
      }),
    );

    expect(html).toContain("<title>Email SDK</title>");
    expect(html).toContain('name="robots"');
    expect(html).toContain(recoveryRobots);
    expect(html).toContain('href="/app.css"');
    expect(html).not.toContain("Untitled");
  });
});
