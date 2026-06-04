import { defineConfig, defineDocs } from "fumadocs-mdx/config";

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
});

export const docsV020 = defineDocs({
  dir: "content/docs-v/0.2.0",
  docs: {
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
});

export const docsV021 = defineDocs({
  dir: "content/docs-v/0.2.1",
  docs: {
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
});

export const docsV030 = defineDocs({
  dir: "content/docs-v/0.3.0",
  docs: {
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
});

export const docsV040 = defineDocs({
  dir: "content/docs-v/0.4.0",
  docs: {
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
});

export const docsV050 = defineDocs({
  dir: "content/docs-v/0.5.0",
  docs: {
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
});

export const docsV060 = defineDocs({
  dir: "content/docs-v/0.6.0",
  docs: {
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
});

export default defineConfig();
