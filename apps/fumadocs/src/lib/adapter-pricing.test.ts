import { describe, expect, test } from "bun:test";

import {
  adapterPricing,
  getAdapterPricingRows,
  getPrice,
  pricingVolumes,
} from "@/lib/adapter-pricing";
import { providers } from "@/lib/providers";

describe("adapter pricing", () => {
  test("covers every provider once at all six volumes", () => {
    const providerKeys = providers.map((provider) => provider.key).sort();
    const pricingKeys = adapterPricing.map((row) => row.provider.key).sort();

    expect(adapterPricing).toHaveLength(24);
    expect(new Set(pricingKeys).size).toBe(pricingKeys.length);
    expect(pricingKeys).toEqual(providerKeys);
    expect(adapterPricing.every((row) => row.prices.length === pricingVolumes.length)).toBe(true);
  });

  test("sorts numeric USD prices before EUR and non-numeric prices", () => {
    for (const sort of ["cost-asc", "cost-desc"] as const) {
      const rows = getAdapterPricingRows({ volume: 500_000, sort });
      const firstNonUsd = rows.findIndex((row) => {
        const price = getPrice(row, 500_000);
        return price.kind !== "money" || price.currency !== "USD";
      });

      expect(firstNonUsd).toBeGreaterThan(0);
      expect(
        rows.slice(firstNonUsd).some((row) => {
          const price = getPrice(row, 500_000);
          return price.kind === "money" && price.currency === "USD";
        }),
      ).toBe(false);
    }
  });

  test("defaults to the lowest USD price first", () => {
    const rows = getAdapterPricingRows({ volume: 50_000 });

    expect(rows[0]?.provider.key).toBe("primitive");
    expect(getPrice(rows[0]!, 50_000)).toMatchObject({
      kind: "money",
      currency: "USD",
      cents: 0,
    });
  });

  test("Lettr uses published volume tiers", () => {
    const row = adapterPricing.find((entry) => entry.provider.key === "lettr");

    expect(row).toBeDefined();
    expect(getPrice(row!, 1_000)).toMatchObject({ kind: "money", currency: "USD", cents: 0 });
    expect(getPrice(row!, 50_000)).toMatchObject({
      kind: "money",
      currency: "USD",
      cents: 1_500,
    });
    expect(getPrice(row!, 100_000)).toMatchObject({
      kind: "money",
      currency: "USD",
      cents: 3_000,
    });
    expect(getPrice(row!, 250_000)).toMatchObject({
      kind: "money",
      currency: "USD",
      cents: 25_000,
    });
    expect(getPrice(row!, 500_000)).toMatchObject({
      kind: "money",
      currency: "USD",
      cents: 25_000,
    });
    expect(getPrice(row!, 1_000_000)).toMatchObject({
      kind: "money",
      currency: "USD",
      cents: 45_000,
    });
  });

  test("searches by provider name and filters selected-volume status", () => {
    expect(
      getAdapterPricingRows({ query: "SeQuEnZy" }).map((row) => row.provider.key),
    ).toEqual(["sequenzy"]);
    expect(
      getAdapterPricingRows({ status: "variable", volume: 1_000 }).map(
        (row) => row.provider.key,
      ),
    ).toEqual(["iterable", "smtp"]);
  });
});
