import { describe, expect, test } from "bun:test";

import { comparePairs, getComparePair } from "./compare";
import {
  buildCompareDescription,
  buildCompareFaq,
  buildComparePageTitle,
  renderCompareMarkdown,
} from "./compare-page";

describe("comparison Markdown mirrors", () => {
  test("renders a valid pair as Markdown with a canonical link", () => {
    const pair = getComparePair("resend-vs-postmark");
    expect(pair).toBeDefined();
    const markdown = renderCompareMarkdown(pair!);

    expect(markdown.startsWith("# Resend vs Postmark")).toBe(true);
    expect(markdown).toContain("Canonical page: https://email-sdk.dev/compare/resend-vs-postmark");
    expect(markdown).toContain("| Message field | Resend | Postmark |");
    expect(markdown).toContain("## Frequently asked questions");
  });

  test("fallback FAQ names repeated headers and adapter limits, not only missing fields", () => {
    const sendgridMailgun = getComparePair("sendgrid-vs-mailgun");
    const postmarkSes = getComparePair("postmark-vs-ses");

    if (!sendgridMailgun || !postmarkSes) throw new Error("expected both pairs to exist");

    const repeatedHeaders = buildCompareFaq(sendgridMailgun).at(-1)?.answer;
    expect(repeatedHeaders).toStartWith("Partially.");
    expect(repeatedHeaders).toContain("from Mailgun to SendGrid for messages using repeated header names");

    const oneTag = buildCompareFaq(postmarkSes).at(-1)?.answer;
    expect(oneTag).toContain("from Postmark to AWS SES for messages using Metadata");
    expect(oneTag).toContain("Postmark: Accepts one tag");
  });

  test("does not render an unknown pair", () => {
    expect(getComparePair("unknown-vs-provider")).toBeUndefined();
  });

  test("uses a pair's search copy for title, description, first FAQ and Markdown verdict", () => {
    const pair = getComparePair("resend-vs-loops");

    if (!pair?.search) throw new Error("resend-vs-loops should have search copy");

    expect(buildComparePageTitle(pair)).toBe(pair.search.title);
    expect(buildCompareDescription(pair)).toBe(pair.search.description);
    expect(buildCompareFaq(pair)[0]).toEqual({
      question: "Should I use Resend or Loops?",
      answer: pair.search.verdict,
    });
    expect(renderCompareMarkdown(pair)).toContain(`**Short answer:** ${pair.search.verdict}`);
  });

  test("keeps the template copy for pairs without search copy", () => {
    const pair = getComparePair("resend-vs-postmark");

    if (!pair) throw new Error("resend-vs-postmark should exist");

    expect(pair.search).toBeUndefined();
    expect(buildComparePageTitle(pair)).toBe(
      "Resend vs Postmark: transactional email API comparison",
    );
    expect(buildCompareFaq(pair)[0]?.question).toStartWith("Can I switch from Resend");
    expect(renderCompareMarkdown(pair)).not.toContain("Short answer");
  });

  test("search copy stays unique and within snippet lengths", () => {
    const withSearch = comparePairs.flatMap((pair) => (pair.search ? [pair.search] : []));

    expect(new Set(withSearch.map((copy) => copy.title)).size).toBe(withSearch.length);

    for (const copy of withSearch) {
      expect(copy.title.length).toBeLessThanOrEqual(65);
      expect(copy.description.length).toBeLessThanOrEqual(160);
    }
  });
});
