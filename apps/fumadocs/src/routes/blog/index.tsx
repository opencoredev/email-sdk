import { createFileRoute, Link } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { ArrowRight } from "lucide-react";

import { baseOptions } from "@/lib/layout.shared";
import { blogPosts } from "@/lib/blog";
import { siteUrl } from "@/lib/shared";

export const Route = createFileRoute("/blog/")({
  head: () => ({
    meta: [
      { title: "Email SDK Blog - TypeScript email, adapters, and launch notes" },
      {
        name: "description",
        content:
          "Notes from the Email SDK team on TypeScript transactional email, provider adapters, fallbacks, and launch work.",
      },
      { property: "og:title", content: "Email SDK Blog" },
      {
        property: "og:description",
        content:
          "TypeScript email notes for developers who care about provider choice, fallbacks, and boring production behavior.",
      },
      { property: "og:url", content: `${siteUrl}/blog` },
    ],
    links: [{ rel: "canonical", href: `${siteUrl}/blog` }],
  }),
  component: BlogIndex,
});

function BlogIndex() {
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

          <div className="mt-10 grid gap-4">
            {blogPosts.map((post) => (
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
                    <span>{formatDate(post.publishedAt)}</span>
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
        </section>
      </main>
    </HomeLayout>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}
