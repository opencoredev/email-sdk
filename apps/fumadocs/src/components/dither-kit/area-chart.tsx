"use client";

import { CartesianCanvas } from "./cartesian-canvas";
import { type CartesianChartProps, CartesianRoot } from "./cartesian-root";

type Row = Record<string, unknown>;

/** Composable dither **area** chart. Compose `<Area>`, `<Grid>`, axes, … inside. */
export function AreaChart<TData extends Row>(props: CartesianChartProps<TData>) {
  return <CartesianRoot chartType="area" Canvas={CartesianCanvas} {...props} />;
}

/** Composable dither **line** chart — `<Line>` series with a glow under the line. */
export function LineChart<TData extends Row>(props: CartesianChartProps<TData>) {
  return <CartesianRoot chartType="line" Canvas={CartesianCanvas} {...props} />;
}

export type AreaChartProps<TData extends Row> = CartesianChartProps<TData>;
