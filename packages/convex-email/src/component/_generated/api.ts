import type { AnyApi, AnyComponents } from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

export const api: AnyApi = anyApi;
export const internal: AnyApi = anyApi;
export const components: AnyComponents = componentsGeneric();
