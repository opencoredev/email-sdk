import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { ArrowRight } from "lucide-react";

import { formatBlogDate, getBlogPostMetaTitle, getBlogPostUrl, type BlogPost } from "@/lib/blog";
import { baseOptions } from "@/lib/layout.shared";
import { getBlogPostServerFn } from "@/lib/notra-runtime";
import { siteUrl } from "@/lib/shared";

type BlogPostLoaderData = {
  html: string;
  post: BlogPost;
};

export const Route = createFileRoute("/blog/$slug")({
  head: ({ params, loaderData }) => {
    const post = (loaderData as BlogPostLoaderData | undefined)?.post;
    const title = post ? getBlogPostMetaTitle(post.title) : "Email SDK Blog";
    const description = post?.description ?? "Email SDK blog post.";
    const canonicalUrl = `${siteUrl}${getBlogPostUrl(params.slug)}`;
    const imageUrl = post ? `${siteUrl}${post.image}` : `${siteUrl}/og/email-sdk.png`;

    const meta = [
      { title },
      { name: "description", content: description },
      { property: "og:type", content: "article" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: canonicalUrl },
      { property: "og:image", content: imageUrl },
      { property: "og:image:alt", content: post?.imageAlt ?? "Email SDK blog post preview" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: imageUrl },
      { name: "twitter:image:alt", content: post?.imageAlt ?? "Email SDK blog post preview" },
      ...(post
        ? [
            { property: "article:published_time", content: `${post.publishedAt}T00:00:00.000Z` },
            { property: "article:modified_time", content: `${post.updatedAt}T00:00:00.000Z` },
            ...post.tags.map((tag) => ({ property: "article:tag", content: tag })),
            {
              "script:ld+json": {
                "@context": "https://schema.org",
                "@graph": [
                  {
                    "@type": "BlogPosting",
                    headline: post.title,
                    description: post.description,
                    datePublished: post.publishedAt,
                    dateModified: post.updatedAt,
                    image: `${siteUrl}${post.image}`,
                    url: canonicalUrl,
                    mainEntityOfPage: canonicalUrl,
                    articleSection: post.tags,
                    author: {
                      "@type": "Organization",
                      name: "OpenCore",
                    },
                    publisher: {
                      "@type": "Organization",
                      name: "OpenCore",
                      logo: {
                        "@type": "ImageObject",
                        url: `${siteUrl}/logo.png`,
                      },
                    },
                  },
                  {
                    "@type": "BreadcrumbList",
                    itemListElement: [
                      {
                        "@type": "ListItem",
                        position: 1,
                        name: "Email SDK",
                        item: siteUrl,
                      },
                      {
                        "@type": "ListItem",
                        position: 2,
                        name: "Blog",
                        item: `${siteUrl}/blog`,
                      },
                      {
                        "@type": "ListItem",
                        position: 3,
                        name: post.title,
                        item: canonicalUrl,
                      },
                    ],
                  },
                ],
              },
            },
          ]
        : []),
    ];

    return {
      meta,
      links: [{ rel: "canonical", href: canonicalUrl }],
    };
  },
  component: BlogPostPage,
  loader: async ({ params }) => {
    const detail = await getBlogPostServerFn({ data: params.slug });
    if (!detail) throw notFound();

    return detail;
  },
  headers: () => ({
    // Edge-cache the SSR'd post; updates and new posts appear within s-maxage, no rebuild.
    "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
  }),
});

function BlogPostPage() {
  const { html, post } = Route.useLoaderData() as BlogPostLoaderData;

  // `html` is the post body, rendered from the post's Markdown and sanitized
  // server-side in scripts/notra-content.ts, so it is safe to inject here.
  return (
    <HomeLayout {...baseOptions()}>
      <main className="border-b border-fd-border bg-fd-background text-fd-foreground">
        <article className="mx-auto max-w-4xl px-6 py-12 md:px-10 lg:px-14">
          <header>
            <Link
              className="inline-flex items-center gap-2 text-sm font-medium text-fd-muted-foreground transition hover:text-fd-foreground"
              to="/blog"
            >
              <ArrowRight className="size-4 rotate-180" />
              Blog
            </Link>
            {post.tags.length > 0 ? (
              <div className="mt-8 flex flex-wrap gap-2">
                {post.tags.map((tag) => (
                  <span
                    className="rounded-md border border-fd-border bg-fd-card px-2 py-1 text-xs text-fd-muted-foreground"
                    key={tag}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
            <h1
              className={`${post.tags.length > 0 ? "mt-5" : "mt-8"} text-4xl font-medium leading-tight md:text-6xl`}
            >
              {post.title}
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-fd-muted-foreground">
              {post.description}
            </p>
            <div className="mt-6 flex flex-wrap gap-2 text-sm text-fd-muted-foreground">
              <span>{formatBlogDate(post.publishedAt)}</span>
              <span aria-hidden="true">/</span>
              <span>{post.readTime}</span>
            </div>
          </header>

          <figure className="mt-10 overflow-hidden rounded-lg border border-fd-border bg-fd-card">
            <img alt={post.imageAlt} className="w-full object-cover" src={post.image} />
          </figure>

          {html ? (
            <div
              className="blog-content mt-10"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <p className="mt-10 text-base leading-8 text-fd-muted-foreground">
              This post does not have any content yet.
            </p>
          )}
        </article>
      </main>
    </HomeLayout>
  );
}
