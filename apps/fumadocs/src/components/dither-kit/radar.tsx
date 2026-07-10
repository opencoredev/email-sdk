"use client";

import { useEffect } from "react";
import type { AreaVariant } from "./chart-context";
import { usePolarPart } from "./polar-context";

export type RadarProps = {
  dataKey: string;
  variant?: AreaVariant;
};

/**
 * One radar series — a closed polygon over the spokes. Sets this series' fill
 * variant; the dithered polygon is painted on the canvas.
 */
export function Radar({ dataKey, variant = "gradient" }: RadarProps) {
  const ctx = usePolarPart("Radar", "radar");
  const { registerVariant, unregisterVariant } = ctx;

  if (process.env.NODE_ENV !== "production" && !ctx.config[dataKey]) {
    console.warn(
      `<Radar dataKey="${dataKey}" />: "${dataKey}" is not in the chart \`config\`. Add it so the series has a colour and label.`,
    );
  }

  useEffect(() => {
    registerVariant(dataKey, variant);
    return () => unregisterVariant(dataKey);
  }, [dataKey, variant, registerVariant, unregisterVariant]);

  return null;
}
