import type { ConvexEmailComponentApi } from "../../shared/componentApi.js";

/**
 * Committed stub for the component's app-facing API. Its types derive from the component's own
 * validators in `shared/componentApi.ts`.
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  ConvexEmailComponentApi<Name>;
