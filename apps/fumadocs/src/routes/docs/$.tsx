import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { staticFunctionMiddleware } from "@tanstack/start-static-server-functions";
import browserCollections from "collections/browser";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page";

import { useMDXComponents } from "@/components/mdx";
import { VersionPicker } from "@/components/version-picker";
import { baseOptions } from "@/lib/layout.shared";
import { appName, gitConfig, siteUrl } from "@/lib/shared";
import { getDocsSource, slugsToMarkdownPath, source } from "@/lib/source";
import {
  type DocsVersionCollection,
  getDocsVersionBase,
  getDocsVersionHref,
  latestDocsVersion,
  resolveDocsVersionedSlugs,
} from "@/lib/versions";

type DocsLoaderData = {
  title: string;
  description?: string;
  path: string;
  markdownUrl: string;
  versionCollection: DocsVersionCollection;
  contentPath: string;
  docsBasePath: string;
  pageTree: Awaited<ReturnType<typeof source.serializePageTree>>;
};

export const Route = createFileRoute("/docs/$")({
  head: ({ loaderData }) => {
    const data = loaderData as DocsLoaderData | undefined;
    const title = data?.title
      ? data.title === appName
        ? `${appName} Documentation - TypeScript email SDK`
        : `${data.title} - ${appName}`
      : appName;
    const description =
      data?.description ?? "Email SDK documentation for TypeScript email adapters.";
    const docsPath = data?.path.replace(/\/?index\.mdx$/, "").replace(/\.mdx$/, "");
    const canonicalPath = data?.docsBasePath
      ? docsPath
        ? `${data.docsBasePath}/${docsPath}`
        : data.docsBasePath
      : "/docs";
    const canonicalUrl = `${siteUrl}${canonicalPath}`;

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:type", content: "article" },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: canonicalUrl },
      ],
      links: [{ rel: "canonical", href: canonicalUrl }],
    };
  },
  component: Page,
  loader: async ({ params }) => {
    const slugs = params._splat?.split("/").filter(Boolean) ?? [];
    const data = await loader({ data: slugs });
    await getClientLoader(data.versionCollection).preload(data.path);
    return data;
  },
});

const loader = createServerFn({
  method: "GET",
})
  .inputValidator((slugs: string[]) => slugs)
  .middleware([staticFunctionMiddleware])
  .handler(async ({ data: slugs }) => {
    const resolved = resolveDocsVersionedSlugs(slugs);
    const docsSource = getDocsSource(resolved.version);
    const page = docsSource.getPage(resolved.slugs);
    if (!page) {
      throw resolveMissingVersionedDocsPage(resolved);
    }

    return {
      title: page.data.title,
      description: page.data.description,
      path: page.path,
      markdownUrl: slugsToMarkdownPath(page.slugs, resolved.version).url,
      versionCollection: resolved.version.collection,
      contentPath: resolved.version.contentPath,
      docsBasePath: getDocsVersionBase(resolved.version),
      pageTree: await docsSource.serializePageTree(docsSource.getPageTree()),
    };
  });

function resolveMissingVersionedDocsPage(resolved: ReturnType<typeof resolveDocsVersionedSlugs>) {
  if (resolved.version.current) return notFound();

  const latestPage = getDocsSource(latestDocsVersion).getPage(resolved.slugs);
  if (latestPage) {
    const docsPath = resolved.slugs.length > 0 ? `/docs/${resolved.slugs.join("/")}` : "/docs";

    return redirect({
      href: getDocsVersionHref(latestDocsVersion, docsPath),
      statusCode: 302,
    });
  }

  return redirect({
    href: getDocsVersionBase(resolved.version),
    statusCode: 302,
  });
}

function createDocsClientLoader(collection: (typeof browserCollections)[DocsVersionCollection]) {
  return collection.createClientLoader({
    component(
      { toc, frontmatter, default: MDX },
      // you can define props for the component
      {
        contentPath,
        docsBasePath,
        markdownUrl,
        path,
      }: {
        contentPath: string;
        docsBasePath: string;
        markdownUrl: string;
        path: string;
      },
    ) {
      return (
        <DocsPage toc={toc}>
          <DocsTitle>{frontmatter.title}</DocsTitle>
          <DocsDescription>{frontmatter.description}</DocsDescription>
          <div className="flex flex-row gap-2 items-center border-b -mt-4 pb-6">
            <MarkdownCopyButton markdownUrl={markdownUrl} />
            <ViewOptionsPopover
              markdownUrl={markdownUrl}
              githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/${contentPath}/${path}`}
            />
          </div>
          <DocsBody>
            <MDX components={useMDXComponents(undefined, { docsBasePath })} />
          </DocsBody>
        </DocsPage>
      );
    },
  });
}

const clientLoaders = {
  docs: createDocsClientLoader(browserCollections.docs),
  docsV062: createDocsClientLoader(browserCollections.docsV062),
  docsV061: createDocsClientLoader(browserCollections.docsV061),
  docsV060: createDocsClientLoader(browserCollections.docsV060),
  docsV050: createDocsClientLoader(browserCollections.docsV050),
  docsV040: createDocsClientLoader(browserCollections.docsV040),
  docsV030: createDocsClientLoader(browserCollections.docsV030),
  docsV021: createDocsClientLoader(browserCollections.docsV021),
  docsV020: createDocsClientLoader(browserCollections.docsV020),
};

function getClientLoader(collection: DocsVersionCollection) {
  return clientLoaders[collection];
}

function Page() {
  const { contentPath, docsBasePath, markdownUrl, pageTree, path, versionCollection } =
    useFumadocsLoader(Route.useLoaderData() as DocsLoaderData);
  const contentLoader = getClientLoader(versionCollection);

  return (
    <DocsLayout
      {...baseOptions({ mainLinks: false, versionPicker: false })}
      sidebar={{
        footer: (
          <div className="mt-2">
            <VersionPicker variant="sidebar" />
          </div>
        ),
      }}
      tree={pageTree}
    >
      <Link to={markdownUrl} hidden />
      {contentLoader.useContent(path, { contentPath, docsBasePath, markdownUrl, path })}
    </DocsLayout>
  );
}
