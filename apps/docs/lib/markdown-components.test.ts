import { describe, expect, test } from "bun:test";

import type { ComponentMarkdownContext } from "blume";

import { markdownComponents } from "./markdown-components";

// Blume calls each serializer with the component's literal props, as here.
function serialize(
  name: keyof typeof markdownComponents,
  props: ComponentMarkdownContext["props"] = {},
) {
  const context: ComponentMarkdownContext = {
    children: "",
    childBlocks: () => [],
    childComponents: () => [],
    frontmatter: {},
    lossy: false,
    props,
  };

  return markdownComponents[name](context) ?? "";
}

describe("markdown component serializers", () => {
  test("every data component the docs use has a serializer", () => {
    expect(Object.keys(markdownComponents).toSorted()).toEqual([
      "AdapterCapabilitySupport",
      "AdapterFieldSupport",
      "AdapterPricing",
      "AdapterVerification",
      "CommunityPluginRegistry",
      "EmailExample",
      "EmailExampleGallery",
      "PackageInstallTabs",
      "ProviderBadge",
      "ProviderGrid",
      "SponsorSpotlight",
    ]);
  });

  test("renders the provider badge with the adapter identity", () => {
    const output = serialize("ProviderBadge", { adapter: "resend" });

    expect(output).toContain("[Resend](https://resend.com)");
    expect(output).toContain("`@opencoredev/email-sdk/resend`");
  });

  test("renders data tables from the shared registry", () => {
    const output = [
      serialize("AdapterFieldSupport"),
      serialize("AdapterCapabilitySupport"),
      serialize("ProviderGrid"),
    ].join("\n");

    expect(output).toContain("| Adapter | Unsupported fields | Limits |");
    expect(output).toContain(
      "| Adapter | Repeated headers | Idempotency | Scheduling | Personalized fanout |",
    );
    expect(output).toContain("[Resend](/docs/adapters/resend)");
    expect(output).toContain("[AWS SES](/docs/adapters/ses)");
  });

  test("renders pricing with its sources", () => {
    const output = serialize("AdapterPricing");

    expect(output).toContain("| Provider | Model |");
    expect(output).toContain("### Pricing notes");
  });

  test("renders install commands for the requested package", () => {
    const output = serialize("PackageInstallTabs", { packageName: "@opencoredev/convex-email" });

    expect(output).toContain("npm install @opencoredev/convex-email");
    expect(output).toContain("bun add @opencoredev/convex-email");
  });

  test("skips an unknown email example instead of inventing one", () => {
    expect(serialize("EmailExample", { id: "not-a-real-example" })).toBe("");
  });
});
