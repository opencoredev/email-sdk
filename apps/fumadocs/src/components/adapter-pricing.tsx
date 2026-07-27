"use client";

import { useMemo, useState } from "react";

import { DocsVersionLink } from "@/components/docs-version-link";
import { ProviderMark } from "@/components/provider-catalog";
import {
  adapterPricing,
  formatPrice,
  formatPricingVolume,
  getAdapterPricingRows,
  pricingVolumes,
  type PricingSort,
  type PricingStatusFilter,
  type PricingVolume,
} from "@/lib/adapter-pricing";

const defaultVolume: PricingVolume = 50_000;
const defaultSort: PricingSort = "cost-asc";

export function AdapterPricing() {
  const [query, setQuery] = useState("");
  const [volume, setVolume] = useState<PricingVolume>(defaultVolume);
  const [status, setStatus] = useState<PricingStatusFilter>("all");
  const [sort, setSort] = useState<PricingSort>(defaultSort);

  const rows = useMemo(
    () => getAdapterPricingRows({ query, status, volume, sort }),
    [query, status, volume, sort],
  );
  const hasFilters =
    query !== "" || volume !== defaultVolume || status !== "all" || sort !== defaultSort;

  function reset() {
    setQuery("");
    setVolume(defaultVolume);
    setStatus("all");
    setSort(defaultSort);
  }

  return (
    <div className="not-prose my-8">
      <div className="border-y border-fd-border bg-fd-card/30">
        <div className="grid gap-4 border-b border-fd-border p-4 lg:grid-cols-[minmax(13rem,1fr)_auto_auto] lg:items-end">
          <label className="grid gap-1.5 text-xs font-medium text-fd-muted-foreground">
            Search providers
            <span className="relative">
              <input
                className="h-10 w-full rounded-md border border-fd-border bg-fd-background px-3 pr-16 text-sm text-fd-foreground outline-none transition placeholder:text-fd-muted-foreground focus-visible:border-fd-primary focus-visible:ring-2 focus-visible:ring-fd-primary/20"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Resend, SMTP, Mailgun…"
                type="search"
                value={query}
              />
              {query ? (
                <button
                  className="absolute inset-y-1 right-1 rounded px-2 text-xs text-fd-muted-foreground outline-none hover:bg-fd-accent hover:text-fd-foreground focus-visible:ring-2 focus-visible:ring-fd-primary"
                  onClick={() => setQuery("")}
                  type="button"
                >
                  Clear
                </button>
              ) : null}
            </span>
          </label>

          <label className="grid gap-1.5 text-xs font-medium text-fd-muted-foreground">
            Availability
            <select
              className="h-10 min-w-44 rounded-md border border-fd-border bg-fd-background px-3 text-sm text-fd-foreground outline-none focus-visible:border-fd-primary focus-visible:ring-2 focus-visible:ring-fd-primary/20"
              onChange={(event) => setStatus(event.target.value as PricingStatusFilter)}
              value={status}
            >
              <option value="all">All prices</option>
              <option value="public">Public price</option>
              <option value="free">Free at selected volume</option>
              <option value="variable">Custom / variable</option>
            </select>
          </label>

          <label className="grid gap-1.5 text-xs font-medium text-fd-muted-foreground">
            Sort rows
            <select
              className="h-10 min-w-44 rounded-md border border-fd-border bg-fd-background px-3 text-sm text-fd-foreground outline-none focus-visible:border-fd-primary focus-visible:ring-2 focus-visible:ring-fd-primary/20"
              onChange={(event) => setSort(event.target.value as PricingSort)}
              value={sort}
            >
              <option value="provider">Provider A–Z</option>
              <option value="cost-asc">Lowest USD first</option>
              <option value="cost-desc">Highest USD first</option>
            </select>
          </label>
        </div>

        <fieldset className="min-w-0 p-4">
          <legend className="mb-2 text-xs font-medium text-fd-muted-foreground">
            Selected monthly volume
          </legend>
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-fd-border bg-fd-background p-1 sm:grid-cols-6">
            {pricingVolumes.map((option) => {
              const selected = option === volume;
              return (
                <button
                  aria-pressed={selected}
                  className={`min-h-10 rounded-md px-2 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-fd-primary ${
                    selected
                      ? "bg-fd-primary text-fd-primary-foreground shadow-sm"
                      : "text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground"
                  }`}
                  key={option}
                  onClick={() => setVolume(option)}
                  type="button"
                >
                  {formatPricingVolume(option)}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="flex min-h-11 items-center justify-between gap-3 border-t border-fd-border px-4 py-2 text-xs text-fd-muted-foreground">
          <p aria-live="polite">
            <span className="font-semibold tabular-nums text-fd-foreground">{rows.length}</span> of{" "}
            {adapterPricing.length} adapters
          </p>
          <button
            className="min-h-8 rounded-md border border-fd-border px-3 font-medium text-fd-foreground outline-none transition hover:bg-fd-accent focus-visible:ring-2 focus-visible:ring-fd-primary disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!hasFilters}
            onClick={reset}
            type="button"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[72rem] border-collapse text-left text-xs">
          <caption className="sr-only">
            Estimated recurring monthly email adapter prices at six sending volumes
          </caption>
          <thead>
            <tr className="border-b border-fd-border text-fd-muted-foreground">
              <th
                className="sticky left-0 z-20 w-56 bg-fd-background py-3 pr-4 font-medium after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-fd-border"
                scope="col"
              >
                Provider
              </th>
              <th className="w-40 px-4 py-3 font-medium" scope="col">
                Pricing model
              </th>
              {pricingVolumes.map((option) => {
                const selected = option === volume;
                return (
                  <th
                    aria-current={selected ? "true" : undefined}
                    className={`w-28 px-3 py-3 text-right font-medium ${
                      selected
                        ? "border-x border-fd-primary/40 bg-fd-primary/10 text-fd-foreground"
                        : ""
                    }`}
                    key={option}
                    scope="col"
                  >
                    <span className="block">{formatPricingVolume(option)}</span>
                    {selected ? (
                      <span className="mt-0.5 block text-[10px] uppercase tracking-wider text-fd-primary">
                        Selected
                      </span>
                    ) : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="border-b border-fd-border align-top" key={row.provider.key}>
                <th
                  className="sticky left-0 z-10 bg-fd-background py-3 pr-4 text-sm font-medium after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-fd-border"
                  scope="row"
                >
                  <span className="flex items-center gap-2.5">
                    <ProviderMark provider={row.provider} />
                    <span className="min-w-0">
                      <DocsVersionLink
                        className="block text-fd-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-primary"
                        docsPath={row.provider.docs}
                        forceLatest={"currentOnly" in row.provider && row.provider.currentOnly}
                      >
                        {row.provider.name}
                      </DocsVersionLink>
                      <span className="mt-0.5 block text-[10px] font-normal uppercase tracking-wider text-fd-muted-foreground">
                        Setup guide
                      </span>
                    </span>
                  </span>
                </th>
                <td className="px-4 py-3">
                  <span className="block font-medium text-fd-foreground">{row.model}</span>
                  <span className="flex flex-wrap gap-x-2">
                    {row.sources.map((source, index) => (
                      <PricingSource
                        href={source.href}
                        key={source.href}
                        label={row.sources.length === 1 ? "Official source" : `Source ${index + 1}`}
                      />
                    ))}
                  </span>
                </td>
                {row.prices.map((price, index) => {
                  const selected = pricingVolumes[index] === volume;
                  return (
                    <td
                      className={`px-3 py-3 text-right font-medium tabular-nums ${
                        selected
                          ? "border-x border-fd-primary/40 bg-fd-primary/10 text-fd-foreground"
                          : price.kind === "unavailable"
                            ? "text-fd-muted-foreground"
                            : "text-fd-foreground"
                      }`}
                      key={pricingVolumes[index]}
                    >
                      {formatPrice(price)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 ? (
          <div className="border-b border-fd-border px-4 py-10 text-center text-sm text-fd-muted-foreground">
            No adapters match these filters.{" "}
            <button
              className="font-medium text-fd-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-fd-primary"
              onClick={reset}
              type="button"
            >
              Reset filters
            </button>
          </div>
        ) : null}
      </div>

      <details className="mt-6 border-y border-fd-border">
        <summary className="cursor-pointer py-3 text-sm font-medium text-fd-foreground outline-none marker:text-fd-muted-foreground focus-visible:ring-2 focus-visible:ring-fd-primary">
          Pricing notes, formulas, and constraints
        </summary>
        <div className="grid border-t border-fd-border md:grid-cols-2">
          {adapterPricing.map((row) => (
            <article
              className="border-b border-fd-border py-4 md:odd:pr-5 md:even:border-l md:even:pl-5"
              key={row.provider.key}
            >
              <h3 className="text-sm font-semibold text-fd-foreground">{row.provider.name}</h3>
              <p className="mt-1.5 text-xs leading-5 text-fd-muted-foreground">{row.note}</p>
              <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {row.sources.map((source) => (
                  <PricingSource href={source.href} key={source.href} label={source.label} />
                ))}
              </p>
            </article>
          ))}
        </div>
      </details>
    </div>
  );
}

function PricingSource({ href, label }: { href: string; label: string }) {
  const external = href.startsWith("http");

  return (
    <a
      className="mt-1 inline-flex text-[11px] text-fd-muted-foreground underline decoration-fd-border underline-offset-4 outline-none hover:text-fd-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-fd-primary"
      href={href}
      rel={external ? "noreferrer" : undefined}
      target={external ? "_blank" : undefined}
    >
      {label}
      {external ? <span aria-hidden="true">&nbsp;↗</span> : null}
    </a>
  );
}
