import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import {
  ArrowRight,
  CheckCircle2,
  GitBranch,
  Mail,
  Route as RouteIcon,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";

import { DocsVersionLink } from "@/components/docs-version-link";
import { formatBlogDate, getBlogPost, getBlogPostUrl, type BlogPost } from "@/lib/blog";
import { baseOptions } from "@/lib/layout.shared";
import { siteOgImageUrl, siteUrl } from "@/lib/shared";

export const Route = createFileRoute("/blog/$slug")({
  head: ({ params }) => {
    const post = getBlogPost(params.slug);
    const title = post ? `${post.title} - Email SDK` : "Email SDK Blog";
    const description = post?.description ?? "Email SDK blog post.";
    const canonicalUrl = `${siteUrl}${getBlogPostUrl(params.slug)}`;

    const meta = [
      { title },
      { name: "description", content: description },
      { property: "og:type", content: "article" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: canonicalUrl },
      { property: "og:image", content: `${siteUrl}${post?.image ?? "/og/email-sdk.png"}` },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: siteOgImageUrl },
      ...(post
        ? [
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
  loader: ({ params }) => {
    const post = getBlogPost(params.slug);
    if (!post) throw notFound();
    return post;
  },
});

function BlogPostPage() {
  const post = Route.useLoaderData() as BlogPost;

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
            <h1 className="mt-5 text-4xl font-medium leading-tight md:text-6xl">{post.title}</h1>
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

          <BlogPostContent slug={post.slug} />
        </article>
      </main>
    </HomeLayout>
  );
}

function BlogPostContent({ slug }: { slug: string }) {
  if (slug === "introducing-email-sdk") return <IntroducingPost />;
  if (slug === "email-provider-fallbacks") return <FallbacksPost />;
  if (slug === "nodemailer-alternative-typescript") return <NodemailerAlternativePost />;

  throw new Error(`Missing blog post content for slug: ${slug}`);
}

function IntroducingPost() {
  const fallbackPost = getBlogPost("email-provider-fallbacks");

  return (
    <BlogBody>
      <p>
        Email SDK launched on June 1, 2026. It is a small TypeScript package for transactional
        email, built around a boring idea: your app should not have to know every detail of every
        provider just to send a receipt, a login code, or an onboarding email.
      </p>
      <p>
        Most teams start with one provider. That is sensible. Resend is nice. Postmark is steady.
        SendGrid is everywhere. SES is cheap and deeply tied into AWS. SMTP is still there, quietly
        doing its job. The trouble starts later, when one provider-specific payload leaks across the
        app and every product email becomes a small migration risk.
      </p>
      <p>
        Email SDK gives you one typed client, separate adapter entry points, and explicit provider
        limits. It does not pretend all email APIs are the same. They are not.
      </p>

      <CodeBlock>{`import { createEmailClient } from "@opencoredev/email-sdk";
import { resend } from "@opencoredev/email-sdk/resend";
import { smtp } from "@opencoredev/email-sdk/smtp";

const email = createEmailClient({
  adapters: [
    resend({ apiKey: process.env.RESEND_API_KEY! }),
    smtp({
      host: process.env.SMTP_HOST!,
      auth: {
        user: process.env.SMTP_USER!,
        pass: process.env.SMTP_PASS!,
      },
    }),
  ],
  fallback: ["smtp"],
  retry: { retries: 1 },
});

await email.send({
  from: "Acme <hello@acme.com>",
  to: "user@example.com",
  subject: "Welcome",
  text: "Your account is ready.",
});`}</CodeBlock>

      <Section title="What shipped">
        <FeatureGrid>
          <Feature icon={<Mail />} title="One message shape">
            Your app calls <code>email.send()</code>. The adapter handles the provider request.
          </Feature>
          <Feature icon={<RouteIcon />} title="Fallback routes">
            Retry transient failures and move to backup adapters in the order you configure.
          </Feature>
          <Feature icon={<GitBranch />} title="Separate entry points">
            Import only the provider adapter you use. No giant all-provider bundle.
          </Feature>
          <Feature icon={<ShieldCheck />} title="Fail-fast limits">
            Unsupported fields throw before the request instead of being silently dropped.
          </Feature>
        </FeatureGrid>
      </Section>

      <Section title="The adapter list">
        <p>
          The first public version covers the common routes people actually reach for in production.
          Some are API-first, some are infrastructure-heavy, and SMTP is included without pulling in
          Nodemailer.
        </p>
        <Table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Entry point</th>
              <th>Good fit</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Resend</td>
              <td>
                <code>/resend</code>
              </td>
              <td>Modern default for product teams that want a clean email API.</td>
            </tr>
            <tr>
              <td>Postmark</td>
              <td>
                <code>/postmark</code>
              </td>
              <td>Transactional email where delivery behavior matters more than campaign tools.</td>
            </tr>
            <tr>
              <td>SendGrid</td>
              <td>
                <code>/sendgrid</code>
              </td>
              <td>Existing SendGrid accounts and teams already invested in that ecosystem.</td>
            </tr>
            <tr>
              <td>AWS SES</td>
              <td>
                <code>/ses</code>
              </td>
              <td>AWS-heavy apps that want low-cost infrastructure and explicit credentials.</td>
            </tr>
            <tr>
              <td>SMTP</td>
              <td>
                <code>/smtp</code>
              </td>
              <td>
                Cheap fallback routes, self-managed mail, or providers without a dedicated API.
              </td>
            </tr>
          </tbody>
        </Table>
      </Section>

      <Section title="What it is not">
        <p>
          Email SDK is not a campaign platform, template builder, queue, analytics suite, or
          deliverability consultant in a trench coat. Those are real products with real complexity.
          This package sits lower in the stack: create the client, choose the adapters, send the
          message, and know when a provider cannot represent the fields you care about.
        </p>
        <p>
          That last part matters. A fallback is only safe if the fallback can send the same class of
          email. If your primary route supports tags, metadata, attachments, and custom headers, but
          your backup route does not, the SDK should make that obvious.
        </p>
      </Section>

      <Callout>
        If you are wiring this into a new app, start with the install guide, send one message, then
        read the field support page before adding fallbacks.
      </Callout>

      <div className="not-prose mt-10 flex flex-col gap-3 sm:flex-row">
        <DocsVersionLink
          className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-fd-primary px-4 text-sm font-medium text-fd-primary-foreground transition hover:opacity-90"
          docsPath="/docs/getting-started/install"
        >
          Install Email SDK
          <ArrowRight className="size-4" />
        </DocsVersionLink>
        {fallbackPost ? (
          <Link
            className="inline-flex h-11 items-center justify-center rounded-md border border-fd-border px-4 text-sm font-medium transition hover:bg-fd-accent"
            params={{ slug: fallbackPost.slug }}
            to="/blog/$slug"
          >
            Read the fallback guide
          </Link>
        ) : (
          <DocsVersionLink
            className="inline-flex h-11 items-center justify-center rounded-md border border-fd-border px-4 text-sm font-medium transition hover:bg-fd-accent"
            docsPath="/docs/concepts/fallbacks-and-retries"
          >
            Read fallback docs
          </DocsVersionLink>
        )}
      </div>
    </BlogBody>
  );
}

function FallbacksPost() {
  return (
    <BlogBody>
      <p>
        A fallback route is not a magic second chance. It is a product decision. If the backup
        provider cannot send the same message, the fallback can turn a provider outage into a
        quieter bug: the email leaves your app, but the data you meant to send does not.
      </p>
      <p>
        That is why Email SDK treats adapter limits as part of the API. Providers do not agree on
        tags, metadata, attachments, headers, reply-to behavior, or batch semantics. A good email
        layer should admit that instead of smoothing it over.
      </p>

      <Section title="Start with the email, not the provider">
        <p>
          Before picking a backup provider, sort emails by what they need to carry. Password resets
          and login codes are usually plain. Receipts often need headers, attachments, or metadata.
          Product notifications sit somewhere in the middle.
        </p>
        <Table>
          <thead>
            <tr>
              <th>Email type</th>
              <th>Usually needs</th>
              <th>Fallback posture</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Login code</td>
              <td>Plain text or simple HTML</td>
              <td>Good candidate for a broad fallback route.</td>
            </tr>
            <tr>
              <td>Receipt</td>
              <td>Headers, metadata, maybe attachments</td>
              <td>Use a provider with equivalent field support.</td>
            </tr>
            <tr>
              <td>Product digest</td>
              <td>Template data, tags, unsubscribe behavior</td>
              <td>Fallback only after checking provider-specific behavior.</td>
            </tr>
            <tr>
              <td>Audit or compliance email</td>
              <td>Stable IDs, metadata, traceability</td>
              <td>Be conservative. Dropped metadata is not harmless.</td>
            </tr>
          </tbody>
        </Table>
      </Section>

      <Section title="A small fallback checklist">
        <Checklist
          items={[
            "Does the backup adapter support every field this email uses?",
            "Will the sender identity work from the same domain?",
            "Do you need a different from address, reply-to address, or region?",
            "Can your logs tell which provider actually sent the message?",
            "Does retrying risk duplicate emails, or is the send idempotent enough?",
          ]}
        />
      </Section>

      <p>
        The boring answer is usually the right one: use fallbacks for simple, time-sensitive
        transactional email first. Then add stricter routes for messages that carry richer data.
      </p>

      <CodeBlock>{`const email = createEmailClient({
  adapters: [
    resend({ apiKey: process.env.RESEND_API_KEY! }),
    postmark({ serverToken: process.env.POSTMARK_SERVER_TOKEN! }),
  ],
  defaultAdapter: "resend",
  fallback: ["postmark"],
  retry: { retries: 1 },
});`}</CodeBlock>

      <Section title="Why fail-fast beats silent fallback">
        <p>
          Silent fallback feels friendly until something important disappears. If a provider cannot
          represent <code>metadata</code>, <code>attachments</code>, or custom headers, Email SDK
          should stop before the request. That failure is annoying, but it is visible. Visible is
          fixable.
        </p>
        <p>
          The alternative is worse: a message goes out, dashboards look green, and three weeks later
          somebody asks why customer receipts stopped carrying the IDs your support team relies on.
        </p>
      </Section>

      <Callout>
        The field support guide is the page to keep open while designing routes. Pick providers by
        the message shape, not the logo.
      </Callout>

      <div className="not-prose mt-10 flex flex-col gap-3 sm:flex-row">
        <DocsVersionLink
          className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-fd-primary px-4 text-sm font-medium text-fd-primary-foreground transition hover:opacity-90"
          docsPath="/docs/adapters/field-support"
        >
          Check field support
          <ArrowRight className="size-4" />
        </DocsVersionLink>
        <DocsVersionLink
          className="inline-flex h-11 items-center justify-center rounded-md border border-fd-border px-4 text-sm font-medium transition hover:bg-fd-accent"
          docsPath="/docs/concepts/fallbacks-and-retries"
        >
          Read fallback docs
        </DocsVersionLink>
      </div>
    </BlogBody>
  );
}

function NodemailerAlternativePost() {
  return (
    <BlogBody>
      <p>
        Nodemailer is still the right answer for plenty of apps. If you need direct SMTP control,
        custom transport behavior, or you are maintaining an older Node.js service, it is mature and
        battle-tested. The question is not whether Nodemailer is good. The question is whether your
        app wants SMTP to be the whole email layer.
      </p>
      <p>
        Most new TypeScript products do not stop at SMTP. They start with Resend or Postmark, add
        SendGrid because a customer already has it, keep SES around for cost or AWS policy, then
        discover that every provider wants a slightly different payload. That is the problem Email
        SDK is built around.
      </p>

      <Section title="Nodemailer vs Email SDK">
        <Table>
          <thead>
            <tr>
              <th>Need</th>
              <th>Nodemailer</th>
              <th>Email SDK</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>SMTP transport</td>
              <td>Excellent direct SMTP support.</td>
              <td>SMTP adapter without making SMTP the only path.</td>
            </tr>
            <tr>
              <td>Provider APIs</td>
              <td>Usually handled outside Nodemailer or through custom transport work.</td>
              <td>Dedicated adapters for Resend, Postmark, SendGrid, Mailgun, SES, and more.</td>
            </tr>
            <tr>
              <td>Fallback routing</td>
              <td>You own the routing, retries, and failure policy.</td>
              <td>Fallback adapters and retries are part of the client configuration.</td>
            </tr>
            <tr>
              <td>TypeScript message shape</td>
              <td>Typed, but centered on Nodemailer's transport model.</td>
              <td>One normalized message shape with provider-aware validation.</td>
            </tr>
            <tr>
              <td>Unsupported fields</td>
              <td>Depends on your transport and app code.</td>
              <td>Limited adapters reject fields they cannot safely send.</td>
            </tr>
          </tbody>
        </Table>
      </Section>

      <Section title="Use Nodemailer when">
        <Checklist
          items={[
            "SMTP is your only transport and you want direct control over it.",
            "You already have a stable Nodemailer setup and no provider-switching pain.",
            "Your app depends on custom transport behavior that should stay close to SMTP.",
          ]}
        />
      </Section>

      <Section title="Use Email SDK when">
        <Checklist
          items={[
            "You want one TypeScript email API across SMTP and provider APIs.",
            "You need fallback routes without copying provider-specific code through the app.",
            "You want unsupported fields to fail before a provider silently drops them.",
            "You expect to support more than one customer, tenant, or email provider over time.",
          ]}
        />
      </Section>

      <CodeBlock>{`import { createEmailClient } from "@opencoredev/email-sdk";
import { postmark } from "@opencoredev/email-sdk/postmark";
import { smtp } from "@opencoredev/email-sdk/smtp";

const email = createEmailClient({
  adapters: [
    postmark({ serverToken: process.env.POSTMARK_SERVER_TOKEN! }),
    smtp({
      host: process.env.SMTP_HOST!,
      auth: {
        user: process.env.SMTP_USER!,
        pass: process.env.SMTP_PASS!,
      },
    }),
  ],
  fallback: ["smtp"],
});

await email.send({
  from: "Acme <hello@acme.com>",
  to: "user@example.com",
  subject: "Reset your password",
  text: "Use this link to reset your password.",
});`}</CodeBlock>

      <Callout>
        The practical difference is scope. Nodemailer is a great SMTP tool. Email SDK is a provider
        layer for TypeScript apps that may use SMTP, but do not want SMTP to define the whole email
        architecture.
      </Callout>

      <div className="not-prose mt-10 flex flex-col gap-3 sm:flex-row">
        <DocsVersionLink
          className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-fd-primary px-4 text-sm font-medium text-fd-primary-foreground transition hover:opacity-90"
          docsPath="/docs/getting-started/install"
        >
          Try Email SDK
          <ArrowRight className="size-4" />
        </DocsVersionLink>
        <DocsVersionLink
          className="inline-flex h-11 items-center justify-center rounded-md border border-fd-border px-4 text-sm font-medium transition hover:bg-fd-accent"
          docsPath="/docs/adapters/smtp"
        >
          Read SMTP docs
        </DocsVersionLink>
      </div>
    </BlogBody>
  );
}

function BlogBody({ children }: { children: ReactNode }) {
  return (
    <div className="prose prose-fd mt-10 max-w-none text-fd-foreground prose-p:leading-7 prose-code:rounded prose-code:bg-fd-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-code:before:content-none prose-code:after:content-none">
      {children}
    </div>
  );
}

function Section({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="mt-10">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function FeatureGrid({ children }: { children: ReactNode }) {
  return <div className="not-prose mt-6 grid gap-3 sm:grid-cols-2">{children}</div>;
}

function Feature({
  children,
  icon,
  title,
}: {
  children: ReactNode;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="rounded-lg border border-fd-border bg-fd-card p-4">
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-md border border-fd-border bg-fd-muted text-fd-primary [&>svg]:size-4">
          {icon}
        </span>
        <h3 className="m-0 text-base font-medium">{title}</h3>
      </div>
      <p className="mt-3 text-sm leading-6 text-fd-muted-foreground">{children}</p>
    </div>
  );
}

function Table({ children }: { children: ReactNode }) {
  return (
    <div className="not-prose my-6 overflow-hidden rounded-lg border border-fd-border">
      <div className="overflow-x-auto">
        <table className="blog-post-table w-full min-w-[680px] border-collapse text-left text-sm">
          {children}
        </table>
      </div>
    </div>
  );
}

function Checklist({ items }: { items: string[] }) {
  return (
    <ul className="not-prose mt-5 grid gap-3">
      {items.map((item) => (
        <li
          className="flex gap-3 rounded-lg border border-fd-border bg-fd-card p-3 text-sm leading-6 text-fd-muted-foreground"
          key={item}
        >
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-fd-primary" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="blog-code-block not-prose my-8 overflow-x-auto rounded-lg border border-fd-border bg-fd-card p-4 text-sm leading-6 text-fd-foreground">
      <code>{highlightTypeScript(children)}</code>
    </pre>
  );
}

const codeTokenPattern =
  /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\n]*|\/\*[\s\S]*?\*\/|\b(?:import|from|const|await|return|export|type|satisfies)\b|\b(?:true|false|null|undefined)\b|\b(?:process|env)\b|\b[A-Z0-9]+(?:_[A-Z0-9]+)+\b|\b[A-Za-z_$][\w$]*(?=\s*\()|\b\d+\b)/g;

function highlightTypeScript(code: string) {
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of code.matchAll(codeTokenPattern)) {
    const [token] = match;
    const index = match.index ?? 0;

    if (index > cursor) parts.push(code.slice(cursor, index));

    parts.push(
      <span className={getCodeTokenClassName(token)} key={`${index}-${token}`}>
        {token}
      </span>,
    );
    cursor = index + token.length;
  }

  if (cursor < code.length) parts.push(code.slice(cursor));

  return parts;
}

function getCodeTokenClassName(token: string) {
  if (token.startsWith('"') || token.startsWith("'") || token.startsWith("`")) {
    return "blog-code-string";
  }

  if (token.startsWith("//") || token.startsWith("/*")) return "blog-code-comment";
  if (/^(true|false|null|undefined|\d+)$/.test(token)) return "blog-code-literal";
  if (/^[A-Z0-9]+(?:_[A-Z0-9]+)+$/.test(token)) return "blog-code-constant";
  if (/^(process|env)$/.test(token)) return "blog-code-runtime";

  return /^(import|from|const|await|return|export|type|satisfies)$/.test(token)
    ? "blog-code-keyword"
    : "blog-code-function";
}

function Callout({ children }: { children: ReactNode }) {
  return (
    <aside className="not-prose mt-8 rounded-lg border border-fd-primary/30 bg-fd-primary/5 p-4 text-sm leading-6 text-fd-foreground">
      {children}
    </aside>
  );
}
