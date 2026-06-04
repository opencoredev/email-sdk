import type { GenericSchema, SchemaDefinition } from "convex/server";
import type { TestConvex } from "convex-test";

import schema from "./component/schema.js";
import type { ConvexEmailAdapterConfig } from "./shared/types.js";

const modules = {
  "./component/_generated/api.ts": () => import("./component/_generated/api.js"),
  "./component/_generated/server.ts": () => import("./component/_generated/server.js"),
  "./component/lib.ts": () => import("./component/lib.js"),
  "./component/providers.ts": () => import("./component/providers.js"),
  "./component/worker.ts": () => import("./component/worker.js"),
};

export function memoryAdapter(name = "memory"): ConvexEmailAdapterConfig {
  return { kind: "memory", name };
}

export function registerConvexEmail(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name = "convexEmail",
) {
  t.registerComponent(name, schema, modules);
}

export const testEmailConfig = {
  testMode: true,
  sandboxTo: ["delivered@example.test"],
  maxAttempts: 2,
  retryBaseMs: 10,
} as const;

export { modules, schema };

export default {
  memoryAdapter,
  modules,
  registerConvexEmail,
  schema,
  testEmailConfig,
};
