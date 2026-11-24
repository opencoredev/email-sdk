// components.ts imports the .astro wrappers in components/mdx. tsc can't read
// Astro files, so it sees each one as an Astro component factory; Blume and
// `blume check` type-check the files themselves.
declare module "*.astro" {
  import type { AstroComponentFactory } from "astro/runtime/server/index.js";

  const component: AstroComponentFactory;
  export default component;
}
