"use client";

import { BarCanvas } from "./bar-canvas";
import { type CartesianChartProps, CartesianRoot } from "./cartesian-root";

type Row = Record<string, unknown>;

/** Composable dither **bar** chart — `<Bar>` series, grouped or stacked. */
export function BarChart<TData extends Row>(props: CartesianChartProps<TData>) {
  return <CartesianRoot chartType="bar" Canvas={BarCanvas} {...props} />;
}
