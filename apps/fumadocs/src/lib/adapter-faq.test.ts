import { describe, expect, test } from "bun:test";

import { buildAdapterFaq, getAdapterSupportEntry } from "@/lib/adapter-faq";
import { ADAPTER_SUPPORT_ENTRIES } from "@/lib/adapter-support";

describe("adapter FAQ", () => {
  test("resolves only current adapter pages", () => {
    expect(getAdapterSupportEntry("adapters/postmark.mdx")?.id).toBe("postmark");
    expect(getAdapterSupportEntry("adapters/field-support.mdx")).toBeUndefined();
    expect(getAdapterSupportEntry("guides/schedule-email.mdx")).toBeUndefined();
  });

  test("every adapter doc has a support entry with the same id", () => {
    for (const entry of ADAPTER_SUPPORT_ENTRIES) {
      expect(getAdapterSupportEntry(`adapters/${entry.id}.mdx`)?.id).toBe(entry.id);
    }
  });

  test("answers follow the support data", () => {
    const postmark = getAdapterSupportEntry("adapters/postmark.mdx")!;
    const faq = buildAdapterFaq(postmark);
    const byQuestion = Object.fromEntries(faq.map((item) => [item.question, item.answer]));

    expect(byQuestion["Does Email SDK support Postmark?"]).toContain(
      "@opencoredev/email-sdk/postmark",
    );
    expect(byQuestion["Which message fields does the Postmark adapter support?"]).toContain(
      "does not support Scheduled sending (sendAt)",
    );
    expect(byQuestion["Can Postmark schedule email for later with Email SDK?"]).toMatch(/^No\./);
    expect(byQuestion["Does the Postmark adapter support idempotent sends?"]).toMatch(/^No\./);

    const resend = buildAdapterFaq(getAdapterSupportEntry("adapters/resend.mdx")!);
    expect(resend[2]!.answer).toMatch(/^Yes\./);
    expect(resend[3]!.answer).toMatch(/^Yes\./);

    for (const item of faq) {
      expect(item.answer).not.toContain("\u2014");
    }
  });
});
