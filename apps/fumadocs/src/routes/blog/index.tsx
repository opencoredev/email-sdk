import { createFileRoute, Link } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";

import { ArrowRight } from "@/components/icon";
import { formatBlogDate, type BlogPost } from "@/lib/blog";
import { baseOptions } from "@/lib/layout.shared";
import { getBlogPostsServerFn } from "@/lib/notra-runtime";
import { appName, siteOgImageUrl, siteUrl } from "@/lib/shared";

export const Route = createFileRoute("/blog/")({
  head: ({ loaderData }) => {
    const posts = (loaderData as BlogPost[] | undefined) ?? [];
    const description =
      "TypeScript email notes for developers who care about provider choice, fallbacks, testing, and boring production behavior.";

    return {
      meta: [
        { title: "Email SDK Blog - TypeScript email, adapters, and launch notes" },
        {
          name: "description",
          content: description,
        },
        { property: "og:type", content: "website" },
        { property: "og:title", content: "Email SDK Blog" },
        {
          property: "og:description",
          content: description,
        },
        { property: "og:url", content: `${siteUrl}/blog` },
        { property: "og:image", content: siteOgImageUrl },
        { property: "og:image:alt", content: "Email SDK blog preview" },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: "Email SDK Blog" },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: siteOgImageUrl },
        { name: "twitter:image:alt", content: "Email SDK blog preview" },
        {
          "script:ld+json": {
            "@context": "https://schema.org",
            "@type": "Blog",
            name: `${appName} Blog`,
            url: `${siteUrl}/blog`,
            description,
            publisher: {
              "@type": "Organization",
              name: "OpenCore",
              url: "https://opencore.dev",
            },
            blogPost: posts.map((post) => ({
              "@type": "BlogPosting",
              headline: post.title,
              description: post.description,
              datePublished: post.publishedAt,
              dateModified: post.updatedAt,
              url: `${siteUrl}/blog/${post.slug}`,
              image: `${siteUrl}${post.image}`,
            })),
          },
        },
        {
          "script:ld+json": {
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: `${appName} Blog posts`,
            itemListElement: posts.map((post, index) => ({
              "@type": "ListItem",
              position: index + 1,
              name: post.title,
              url: `${siteUrl}/blog/${post.slug}`,
            })),
          },
        },
      ],
      links: [{ rel: "canonical", href: `${siteUrl}/blog` }],
    };
  },
  loader: () => getBlogPostsServerFn(),
  headers: () => ({
    // Edge-cache the SSR'd page; new Notra posts appear within s-maxage without a rebuild.
    "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
  }),
  component: BlogIndex,
});

function BlogIndex() {
  const posts = Route.useLoaderData() as BlogPost[];

  return (
    <HomeLayout {...baseOptions()}>
      <main className="border-b border-fd-border bg-fd-background text-fd-foreground">
        <section className="mx-auto max-w-5xl px-6 py-14 md:px-10 lg:px-14">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-fd-muted-foreground">Email SDK Blog</p>
            <h1 className="mt-3 text-4xl font-medium leading-tight md:text-5xl">
              Notes on sending email without marrying one provider.
            </h1>
            <p className="mt-5 text-base leading-7 text-fd-muted-foreground md:text-lg">
              Launch notes, adapter design, and the parts of transactional email that usually get
              rediscovered during an outage.
            </p>
          </div>

          {posts.length > 0 ? (
            <div className="mt-10 grid gap-4">
              {posts.map((post) => (
                <Link
                  className="group grid gap-4 rounded-lg border border-fd-border bg-fd-card p-4 transition hover:bg-fd-accent/40 md:grid-cols-[220px_1fr]"
                  key={post.slug}
                  params={{ slug: post.slug }}
                  to="/blog/$slug"
                >
                  <img
                    alt={post.imageAlt}
                    className="aspect-[16/10] w-full rounded-md border border-fd-border object-cover"
                    height={138}
                    src={post.image}
                    width={220}
                  />
                  <article className="min-w-0">
                    <div className="flex flex-wrap gap-2 text-xs text-fd-muted-foreground">
                      <span>{formatBlogDate(post.publishedAt)}</span>
                      <span aria-hidden="true">/</span>
                      <span>{post.readTime}</span>
                    </div>
                    <h2 className="mt-2 text-2xl font-medium tracking-normal text-fd-foreground">
                      {post.title}
                    </h2>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-fd-muted-foreground">
                      {post.description}
                    </p>
                    <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-fd-primary">
                      Read post
                      <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
                    </div>
                  </article>
                </Link>
              ))}
            </div>
          ) : (
            <div className="mt-10 rounded-lg border border-dashed border-fd-border bg-fd-card/40 px-6 py-16 text-center">
              <h2 className="text-lg font-medium text-fd-foreground">No posts yet</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-fd-muted-foreground">
                New writing on transactional email, adapters, and reliability is on the way. Check
                back soon.
              </p>
            </div>
          )}
        </section>
      </main>
    </HomeLayout>
  );
}
