import type { readFile } from "node:fs/promises";

import { EmailValidationError } from "../errors.js";

type NodeFsPromises = { readFile: typeof readFile };

/**
 * Node-only: reads an attachment given by `path`.
 *
 * The module specifier is a variable on purpose. Bundlers (esbuild, wrangler, Bun) resolve a
 * string-literal `import("node:fs/promises")` at build time, which fails or stubs the module
 * when targeting Cloudflare Workers or the browser. A variable specifier stays a runtime
 * lookup, so adapters bundle for edge runtimes and only a `path` attachment needs Node.
 */
const NODE_FS_PROMISES = "node:fs/promises";

let nodeFs: Promise<NodeFsPromises> | undefined;

function loadNodeFs(): Promise<NodeFsPromises> {
  nodeFs ??= import(NODE_FS_PROMISES).then(
    (module: NodeFsPromises) => module,
    (cause: unknown) => {
      nodeFs = undefined;

      throw new EmailValidationError(
        "Attachments given by path need a runtime with node:fs/promises (Node.js, Bun, or Deno). Pass the file bytes as content instead.",
        cause,
      );
    },
  );

  return nodeFs;
}

export async function readAttachmentFile(path: string): Promise<Uint8Array> {
  const fs = await loadNodeFs();

  return fs.readFile(path);
}
