// One chart datum: a label field (a day, a version) plus numeric series
// fields, keyed by the names in the chart config.
export type ChartValue = string | number;

export type ChartRow = Readonly<Record<string, ChartValue | undefined>>;

/** A series value as a finite number; labels and gaps plot as 0. */
export function numericValue(value: ChartValue | undefined): number {
  const parsed = Number(value ?? 0);

  return Number.isFinite(parsed) ? parsed : 0;
}
