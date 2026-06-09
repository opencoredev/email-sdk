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
import { createHighlighterCoreSync } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import typescriptLanguage from "shiki/langs/typescript.mjs";
import githubDarkTheme from "shiki/themes/github-dark.mjs";
import githubLightTheme from "shiki/themes/github-light.mjs";

import { DocsVersionLink } from "@/components/docs-version-link";
import {
  formatBlogDate,
  getBlogPost,
  getBlogPostMetaTitle,
  getBlogPostUrl,
  type BlogPost,
} from "@/lib/blog";
import { baseOptions } from "@/lib/layout.shared";
import { siteUrl } from "@/lib/shared";

type BlogPostLoaderData = {
  fallbackPost: BlogPost | null;
  post: BlogPost;
};

const blogCodeHighlighter = createHighlighterCoreSync({
  engine: createJavaScriptRegexEngine(),
  langs: [typescriptLanguage],
  themes: [githubLightTheme, githubDarkTheme],
});

export const Route = createFileRoute("/blog/$slug")({
  head: ({ params }) => {
    const post = getBlogPost(params.slug, { includeFuture: true });
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
  loader: ({ params }) => {
    const post = getBlogPost(params.slug, { includeFuture: true });
    if (!post) throw notFound();

    return {
      fallbackPost:
        post.slug === "introducing-email-sdk"
          ? (getBlogPost("email-provider-fallbacks") ?? null)
          : null,
      post,
    };
  },
});

function BlogPostPage() {
  const { fallbackPost, post } = Route.useLoaderData() as BlogPostLoaderData;

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

          <BlogPostContent fallbackPost={fallbackPost} slug={post.slug} />
        </article>
      </main>
    </HomeLayout>
  );
}

function BlogPostContent({ fallbackPost, slug }: { fallbackPost: BlogPost | null; slug: string }) {
  if (slug === "introducing-email-sdk") return <IntroducingPost fallbackPost={fallbackPost} />;
  if (slug === "email-provider-fallbacks") return <FallbacksPost />;
  if (slug === "nodemailer-alternative-typescript") return <NodemailerAlternativePost />;
  if (slug in plannedPosts) return <PlannedPostContent content={plannedPosts[slug]} />;

  throw new Error(`Missing blog post content for slug: ${slug}`);
}

function IntroducingPost({ fallbackPost }: { fallbackPost: BlogPost | null }) {
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

type PlannedPostSection = {
  title: string;
  paragraphs?: string[];
  checklist?: string[];
  table?: {
    headers: [string, string, string];
    rows: [string, string, string][];
  };
  code?: string;
};

type PlannedPost = {
  paragraphs: string[];
  sections: PlannedPostSection[];
  callout: string;
  primaryCta: {
    label: string;
    docsPath: string;
  };
  secondaryCta?: {
    label: string;
    docsPath: string;
  };
};

const plannedPosts: Record<string, PlannedPost> = {
  "transactional-email-provider-checklist": {
    paragraphs: [
      "Most provider comparisons start in the wrong place. They rank dashboards, templates, prices, and brand names before asking what the app actually needs to send.",
      "Start with the product email, not the vendor. A login code, invoice receipt, export-ready notification, and customer-hosted sender domain do not have the same risk profile. One provider can be perfect for one and awkward for another.",
    ],
    sections: [
      {
        title: "Sort by message shape",
        paragraphs: [
          "Write down the fields each class of email needs before choosing a provider. Include attachments, custom headers, reply-to addresses, metadata, tags, and tenant-specific sender domains. Those details are where provider APIs stop feeling interchangeable.",
        ],
        table: {
          headers: ["Email", "Likely requirement", "Provider question"],
          rows: [
            [
              "Login code",
              "Plain text or simple HTML",
              "Can the backup send it from the same trusted domain?",
            ],
            [
              "Receipt",
              "Metadata, headers, maybe PDF attachments",
              "Does the fallback support every field?",
            ],
            [
              "Product digest",
              "Tags, unsubscribe behavior, template data",
              "Does this belong in a campaign tool instead?",
            ],
            ["Audit notice", "Stable IDs and traceability", "Can logs prove which route sent it?"],
          ],
        },
      },
      {
        title: "Pick a default and a boring backup",
        paragraphs: [
          "The default provider should match your normal product path. The backup provider should match the smallest safe version of the same message. If the backup cannot carry the fields your support or billing team relies on, it is not a backup. It is a different email.",
        ],
        checklist: [
          "Confirm the sender domain works on both routes.",
          "Check field support before enabling a fallback.",
          "Log the adapter name and provider response ID.",
          "Keep retry count low for emails a user might notice twice.",
        ],
      },
      {
        title: "Keep provider details at the boundary",
        paragraphs: [
          "Provider SDKs are fine inside an adapter. They get painful when their payload shape leaks into product code. A clean app boundary lets you replace, add, or split providers without hunting through every password reset and invoice path.",
        ],
        code: `const email = createEmailClient({
  adapters: [resendAdapter, postmarkAdapter, smtpAdapter],
  defaultAdapter: "resend",
  fallback: ["postmark"],
});`,
      },
    ],
    callout:
      "Provider choice is less about finding one winner and more about protecting the app from making provider-specific promises everywhere.",
    primaryCta: { label: "Read the adapter model", docsPath: "/docs/concepts/adapter-model" },
    secondaryCta: { label: "Check field support", docsPath: "/docs/adapters/field-support" },
  },
  "resend-postmark-sendgrid-comparison": {
    paragraphs: [
      "Resend, Postmark, and SendGrid all send transactional email, but they do not feel the same in a real product. The right choice depends on the shape of your team as much as the shape of your payload.",
      "Resend is clean for modern developer workflows. Postmark is steady and transactional-first. SendGrid is widely adopted and often already sitting in the company account. That does not make any of them a universal default.",
    ],
    sections: [
      {
        title: "Compare the job, not the logo",
        table: {
          headers: ["Provider", "Good fit", "Watch for"],
          rows: [
            [
              "Resend",
              "New product teams that want a sharp API and fast setup.",
              "You may still need a backup route for customer policy or region needs.",
            ],
            [
              "Postmark",
              "Receipt, login, and lifecycle email where transactional behavior matters.",
              "Streams and templates can become app assumptions if you are casual.",
            ],
            [
              "SendGrid",
              "Teams with existing accounts, enterprise procurement, or mixed email programs.",
              "The API surface is broad enough to invite one-off payload code.",
            ],
          ],
        },
      },
      {
        title: "What the app should own",
        paragraphs: [
          "The app should own the message contract, fallback order, and logging shape. The provider should own delivery infrastructure. When those responsibilities blur, a provider migration becomes a product migration.",
        ],
        checklist: [
          "Keep the product-level message shape independent from provider payloads.",
          "Keep template IDs, stream names, and tags close to the adapter or route config.",
          "Record provider response IDs under your own send attempt ID.",
        ],
      },
      {
        title: "A mixed setup is normal",
        paragraphs: [
          "Many teams end up with one provider for the primary path and another for backup, legacy, or customer-owned sending. That is fine. What matters is making the split explicit instead of letting provider calls spread through the codebase.",
        ],
      },
    ],
    callout:
      "The safest comparison is the one you can encode. If the decision cannot be represented in routing and validation, it will drift.",
    primaryCta: { label: "Browse adapters", docsPath: "/docs/adapters" },
    secondaryCta: { label: "Read fallback docs", docsPath: "/docs/concepts/fallbacks-and-retries" },
  },
  "sendgrid-alternative-typescript": {
    paragraphs: [
      "A SendGrid alternative is rarely just a different install command. The hidden work is removing SendGrid-shaped assumptions from your app without breaking every email that already works.",
      "The good news: you do not have to migrate everything at once. Start by wrapping SendGrid behind a small TypeScript boundary, then move one route at a time.",
    ],
    sections: [
      {
        title: "Find the SendGrid-shaped code",
        checklist: [
          "Search for direct SendGrid imports outside infrastructure code.",
          "List template IDs, categories, custom args, and attachment usage.",
          "Mark which emails are customer-visible if they duplicate or fail.",
          "Identify send paths that already have tests or CLI smoke coverage.",
        ],
      },
      {
        title: "Move to an app-owned message shape",
        paragraphs: [
          "The first migration step is not picking the replacement provider. It is making the app call one email function that you own. After that, SendGrid becomes one adapter instead of the object every feature has to understand.",
        ],
        code: `await email.send({
  from: "Acme <billing@acme.com>",
  to: customer.email,
  subject: "Your receipt",
  html: receiptHtml,
  metadata: { invoiceId: invoice.id },
});`,
      },
      {
        title: "Run providers side by side",
        paragraphs: [
          "Keep SendGrid as the known route while you test another provider on low-risk emails. Once the new adapter has field support, logging, and failure handling you trust, move the important paths.",
        ],
      },
    ],
    callout:
      "A clean migration lets SendGrid keep working while the app stops depending on SendGrid everywhere.",
    primaryCta: { label: "Read SendGrid docs", docsPath: "/docs/adapters/sendgrid" },
    secondaryCta: { label: "Create an adapter", docsPath: "/docs/guides/authoring/create-adapter" },
  },
  "postmark-alternative-typescript": {
    paragraphs: [
      "Postmark is good software. If it is working for your product, there is no prize for replacing it. The usual reason to add an alternative is routing: backup delivery, tenant-specific providers, region rules, or a customer who refuses to use your default.",
      "That means the migration question is not whether Postmark should go away. It is which Postmark assumptions should stay out of product code.",
    ],
    sections: [
      {
        title: "Separate templates from transport",
        paragraphs: [
          "Postmark templates and message streams can be useful, but they are provider concepts. Keep them in route config or adapter code so a reset-password flow does not need to know which provider is underneath.",
        ],
      },
      {
        title: "Keep the receipt path conservative",
        table: {
          headers: ["Path", "Risk", "Safer move"],
          rows: [
            [
              "Password reset",
              "Duplicate sends annoy users.",
              "Low retry count and clear logging.",
            ],
            ["Receipt", "Dropped metadata hurts support.", "Require equivalent field support."],
            [
              "Notification",
              "Template drift creates weird copy.",
              "Move one template family at a time.",
            ],
          ],
        },
      },
      {
        title: "Use Postmark as one adapter",
        paragraphs: [
          "A provider layer lets Postmark stay in the system without owning the app shape. That is the sweet spot: the provider can remain excellent at delivery, and your code can remain honest about what it sends.",
        ],
      },
    ],
    callout:
      "The best Postmark alternative plan may keep Postmark. It just stops letting Postmark define every product email.",
    primaryCta: { label: "Read Postmark docs", docsPath: "/docs/adapters/postmark" },
    secondaryCta: { label: "Read adapter model", docsPath: "/docs/concepts/adapter-model" },
  },
  "aws-ses-typescript-production": {
    paragraphs: [
      "AWS SES is attractive because it is cheap, serious, and already inside the AWS account many teams use for the rest of the stack. It also brings AWS-shaped setup into a part of the product that designers, support, and growth teams notice quickly when it breaks.",
      "A TypeScript app should be able to use SES without letting SES become the whole email architecture.",
    ],
    sections: [
      {
        title: "Treat SES as infrastructure",
        paragraphs: [
          "Keep regions, credentials, identities, and IAM concerns near the adapter. Product code should send a receipt or login email. It should not care whether the route signs an AWS request, calls a JSON API, or uses SMTP.",
        ],
      },
      {
        title: "Know where SES is strict",
        checklist: [
          "Sender identity and region have to match your production setup.",
          "Sandbox mode changes what you can test.",
          "Raw email and attachment behavior deserve their own smoke tests.",
          "Fallbacks should use the same verified domain posture where possible.",
        ],
      },
      {
        title: "Keep a second route",
        paragraphs: [
          "SES can be the low-cost primary route, but it is still a provider. If the product cannot tolerate a blocked send path, configure a backup route and test it before an incident.",
        ],
      },
    ],
    callout:
      "SES is a strong provider when the app boundary is clean. It gets messy when AWS details show up in every feature.",
    primaryCta: { label: "Read SES docs", docsPath: "/docs/adapters/ses" },
    secondaryCta: {
      label: "Read production guide",
      docsPath: "/docs/guides/production-send-pipeline",
    },
  },
  "multi-tenant-email-provider-routing": {
    paragraphs: [
      "A single ENV var is fine for a single product email route. Multi-tenant sending is different. One tenant wants Postmark, another needs SES in a specific region, and a third brings a domain that your default provider cannot send from.",
      "The hard part is not storing more API keys. It is making routing decisions explicit enough that support can explain what happened.",
    ],
    sections: [
      {
        title: "Store policy, not just credentials",
        paragraphs: [
          "Each tenant needs a provider choice, sender identity, allowed message classes, and fallback policy. If you store only the API key, every send path has to rediscover the rest.",
        ],
      },
      {
        title: "Separate route selection from sending",
        code: `const route = await selectTenantEmailRoute({
  tenantId,
  messageType: "receipt",
});

await email.send(message, { adapter: route.primary, fallback: route.fallback });`,
      },
      {
        title: "Make support possible",
        checklist: [
          "Log tenant ID, adapter ID, and sender domain.",
          "Keep provider response IDs attached to your own send attempt.",
          "Reject sends when tenant config cannot support the message fields.",
          "Use a safe default only for low-risk emails.",
        ],
      },
    ],
    callout:
      "Multi-tenant email fails quietly when route policy lives in scattered conditionals. Pull it into one place.",
    primaryCta: { label: "Read client reference", docsPath: "/docs/reference/client" },
    secondaryCta: { label: "Check field support", docsPath: "/docs/adapters/field-support" },
  },
  "email-fallbacks-without-data-loss": {
    paragraphs: [
      "Fallbacks are comforting. They also hide mistakes. If your backup provider cannot send the same fields as the primary route, you may trade a visible failure for a quiet data loss bug.",
      "The fix is simple but not glamorous: validate the message before it leaves the app, and make fallback eligibility part of the route design.",
    ],
    sections: [
      {
        title: "Fields are part of reliability",
        paragraphs: [
          "A receipt without metadata may still arrive in the inbox, but support loses the invoice ID it needed. A notification without tags may still send, but downstream reporting changes. That is not the same result.",
        ],
      },
      {
        title: "Choose fallback classes",
        table: {
          headers: ["Message class", "Fallback posture", "Reason"],
          rows: [
            ["Login code", "Broad fallback", "Small message, time-sensitive."],
            ["Receipt", "Strict fallback", "Metadata and attachments often matter."],
            ["Digest", "Maybe no fallback", "Template and unsubscribe behavior can drift."],
          ],
        },
      },
      {
        title: "Fail before the provider call",
        paragraphs: [
          "If a fallback route cannot represent the payload, the SDK should stop. That error is annoying in development. In production, it is much better than pretending the email was equivalent.",
        ],
      },
    ],
    callout:
      "A fallback is only safe when it can send the same kind of message, not merely any message.",
    primaryCta: { label: "Read fallback docs", docsPath: "/docs/concepts/fallbacks-and-retries" },
    secondaryCta: { label: "Check field support", docsPath: "/docs/adapters/field-support" },
  },
  "smtp-fallback-modern-apps": {
    paragraphs: [
      "SMTP has survived because it is boring in the useful way. It is not always the nicest primary interface for a new TypeScript app, but it can be a practical backup route when the message contract stays narrow.",
      "The trap is treating SMTP as if it can mirror every provider API feature. It cannot, and that is fine. Use it where it fits.",
    ],
    sections: [
      {
        title: "Use SMTP for simple critical mail",
        checklist: [
          "Login codes and password resets are usually good candidates.",
          "Receipts need more care if attachments or metadata matter.",
          "Campaign-like messages should probably stay out of the fallback route.",
          "Sender identity and bounce handling still need real setup.",
        ],
      },
      {
        title: "Keep the adapter honest",
        paragraphs: [
          "SMTP routes should reject fields they cannot safely carry instead of dropping them. That is the difference between a backup path and a silent downgrade.",
        ],
      },
      {
        title: "Do not confuse SMTP with Nodemailer",
        paragraphs: [
          "Nodemailer is a mature Node package for SMTP and related transports. SMTP itself is the protocol. A provider layer can include SMTP without making Nodemailer or SMTP the center of the product API.",
        ],
      },
    ],
    callout:
      "SMTP works best as a narrow, explicit route. It gets risky when it pretends to be every provider.",
    primaryCta: { label: "Read SMTP docs", docsPath: "/docs/adapters/smtp" },
    secondaryCta: {
      label: "Read Nodemailer comparison",
      docsPath: "/docs/getting-started/install",
    },
  },
  "testing-transactional-email-typescript": {
    paragraphs: [
      "The worst email test is the one that only proves an API key works. Production bugs usually come from message shape, unsupported fields, fallback order, duplicate sends, or a provider response your code did not expect.",
      "Good tests keep real sending rare. Most confidence should come from local adapters, dry runs, and small payload checks.",
    ],
    sections: [
      {
        title: "Test the contract first",
        checklist: [
          "Assert the message shape your app creates.",
          "Assert unsupported fields throw for limited adapters.",
          "Assert fallback order for transient failures.",
          "Assert provider response IDs are captured in logs.",
        ],
      },
      {
        title: "Use dry-run smoke checks",
        paragraphs: [
          "A CLI dry run is useful because it exercises configuration and payload normalization without sending mail. Keep one command for the primary route and one for a fallback route.",
        ],
        code: `email-sdk send --dry-run --adapter resend \\
  --from "Acme <hello@acme.com>" \\
  --to "user@example.com" \\
  --subject "Smoke test" \\
  --text "No mail should leave the app."`,
      },
      {
        title: "Send live mail sparingly",
        paragraphs: [
          "Live sends still matter, especially after changing provider credentials, domains, or attachment behavior. They should be deliberate checks, not the only test suite you have.",
        ],
      },
    ],
    callout:
      "A healthy email test suite proves the app knows what it is sending before any provider receives it.",
    primaryCta: { label: "Read testing guide", docsPath: "/docs/guides/test-email-behavior" },
    secondaryCta: { label: "Read CLI reference", docsPath: "/docs/reference/cli" },
  },
  "email-observability-provider-adapters": {
    paragraphs: [
      "Provider dashboards are useful, but they start too late. They can tell you what the provider saw. They usually cannot tell you why your app picked that adapter, why it retried, or which fields were rejected before the request.",
      "Email observability should start at the app boundary.",
    ],
    sections: [
      {
        title: "Log the send attempt",
        checklist: [
          "Your internal send attempt ID.",
          "Adapter name and fallback step.",
          "Message class, tenant, and route policy.",
          "Provider response ID or normalized error code.",
          "Duration and retry count.",
        ],
      },
      {
        title: "Keep sensitive data out",
        paragraphs: [
          "Useful logs do not need raw API keys, full recipient lists, message bodies, or private attachment contents. Keep identifiers and route decisions. Leave secrets and unnecessary personal data out.",
        ],
      },
      {
        title: "Make fallbacks visible",
        paragraphs: [
          "A fallback that succeeds should still be visible. Otherwise the first sign of trouble is a provider bill, a support ticket, or a weird dip in engagement numbers.",
        ],
      },
    ],
    callout: "The provider dashboard is one witness. Your app logs should be the timeline.",
    primaryCta: {
      label: "Read observability plugin docs",
      docsPath: "/docs/plugins/built-in/observability",
    },
    secondaryCta: { label: "Read plugin API", docsPath: "/docs/plugins/api" },
  },
  "idempotent-email-retries": {
    paragraphs: [
      "Retries sound harmless until the same receipt lands twice. Email is user-visible, and a retry policy that would be normal for a database write can feel sloppy in an inbox.",
      "The question is not whether to retry. It is which failures deserve another attempt and how you know a previous attempt did not already send.",
    ],
    sections: [
      {
        title: "Name the message before sending",
        paragraphs: [
          "Generate an app-level send attempt ID before calling a provider. Keep it with the message class, adapter, tenant, and provider response. That gives support one thing to search when a customer forwards a duplicate.",
        ],
      },
      {
        title: "Retry the right failures",
        table: {
          headers: ["Failure", "Retry?", "Reason"],
          rows: [
            ["Network timeout", "Maybe", "The provider may or may not have received it."],
            ["Rate limit", "Maybe", "Backoff can help if the email is still useful later."],
            ["Invalid sender", "No", "Configuration is broken; retrying repeats the mistake."],
            ["Unsupported field", "No", "The payload must change or the route must change."],
          ],
        },
      },
      {
        title: "Avoid duplicate-prone paths",
        paragraphs: [
          "Receipts, account security messages, and legal notices deserve conservative retry counts. A product digest can often wait. A password reset may need a fresh token instead of a blind retry.",
        ],
      },
    ],
    callout:
      "Retries are a product behavior. Treat them that way, especially when money or security is involved.",
    primaryCta: { label: "Read fallback docs", docsPath: "/docs/concepts/fallbacks-and-retries" },
    secondaryCta: { label: "Read errors reference", docsPath: "/docs/reference/errors" },
  },
  "adapter-pattern-email-apis": {
    paragraphs: [
      "The simplest email abstraction usually starts as a switch statement. If provider is Resend, call Resend. If provider is SendGrid, call SendGrid. It works until every branch grows its own validation, error shape, and fallback behavior.",
      "An adapter contract gives the mess a place to live.",
    ],
    sections: [
      {
        title: "Keep quirks local",
        paragraphs: [
          "Every provider has quirks. That is not a failure. The failure is spreading those quirks across product code. An adapter can translate one app-owned message into one provider-owned request and report what happened.",
        ],
      },
      {
        title: "Make capability explicit",
        checklist: [
          "Name which fields the adapter supports.",
          "Reject unsupported fields before sending.",
          "Normalize provider errors enough for routing decisions.",
          "Return provider IDs without forcing provider types into the app.",
        ],
      },
      {
        title: "Use the contract for community adapters",
        paragraphs: [
          "A clear adapter shape also makes third-party providers possible. Community packages can implement the same boundary, and the app does not need to learn a new send API for each one.",
        ],
      },
    ],
    callout:
      "An adapter is not fancy architecture here. It is a small fence around provider-specific behavior.",
    primaryCta: { label: "Read adapter contract", docsPath: "/docs/reference/adapter-contract" },
    secondaryCta: { label: "Create an adapter", docsPath: "/docs/guides/authoring/create-adapter" },
  },
  "migrate-from-provider-sdk": {
    paragraphs: [
      "Provider-specific SDKs are fine at the start. They are direct, documented, and usually the fastest way to send the first email. The bill comes later, when every product path knows about that provider.",
      "A calmer migration moves provider code behind a boundary before replacing the provider.",
    ],
    sections: [
      {
        title: "Do the inventory",
        checklist: [
          "List every direct provider import.",
          "Group sends by message type and risk.",
          "Find provider-only fields such as template IDs, streams, tags, and custom args.",
          "Mark paths with tests, live smoke checks, or no coverage at all.",
        ],
      },
      {
        title: "Wrap first, replace second",
        paragraphs: [
          "Move the existing provider into an adapter and keep behavior the same. Once product code calls your own email boundary, you can add another adapter without turning the migration into a rewrite.",
        ],
      },
      {
        title: "Move low-risk routes first",
        paragraphs: [
          "Start with a simple notification or internal email. Receipts, login codes, and compliance notices should wait until logging, retries, and field support are proven.",
        ],
      },
    ],
    callout:
      "The first milestone is not a new provider. It is fewer places in the app that care which provider is underneath.",
    primaryCta: { label: "Read quickstart", docsPath: "/docs/getting-started/quickstart" },
    secondaryCta: { label: "Read adapter model", docsPath: "/docs/concepts/adapter-model" },
  },
  "email-attachments-provider-limits": {
    paragraphs: [
      "Attachments are where email abstractions stop being cute. A filename, content type, base64 string, stream, size limit, and provider request shape all have to line up.",
      "If your product sends invoices, exports, contracts, or reports, attachment support is not a footnote. It is part of the route contract.",
    ],
    sections: [
      {
        title: "Check limits before launch",
        checklist: [
          "Maximum total message size.",
          "Accepted attachment encoding.",
          "Filename and content type handling.",
          "Whether the provider supports inline attachments.",
          "How failed attachment sends appear in logs.",
        ],
      },
      {
        title: "Do not fallback blindly",
        paragraphs: [
          "A fallback provider that cannot carry the attachment should reject the send. A receipt without its PDF might look successful from the outside while creating support work later.",
        ],
      },
      {
        title: "Test with real-ish files",
        paragraphs: [
          "A one-line text attachment does not prove much. Test a PDF near your expected production size, a weird filename, and a missing content type. Those cases catch adapter mistakes early.",
        ],
      },
    ],
    callout:
      "Attachment support should be verified for each route. It is too visible to leave to hope.",
    primaryCta: { label: "Check field support", docsPath: "/docs/adapters/field-support" },
    secondaryCta: { label: "Read message reference", docsPath: "/docs/reference/message" },
  },
  "email-metadata-tags-headers": {
    paragraphs: [
      "Metadata, tags, and headers all look like places to stash extra information. They are not the same thing, and mixing them casually makes debugging harder.",
      "Use each layer for the job it is good at, then keep your own app database as the source of truth for anything critical.",
    ],
    sections: [
      {
        title: "Use the right layer",
        table: {
          headers: ["Layer", "Good for", "Be careful with"],
          rows: [
            [
              "Metadata",
              "Provider-side lookup and webhook correlation.",
              "Provider support varies.",
            ],
            ["Tags", "Grouping sends in provider dashboards.", "Names and limits differ."],
            [
              "Headers",
              "Protocol-level behavior and downstream systems.",
              "Some providers restrict custom headers.",
            ],
          ],
        },
      },
      {
        title: "Keep critical IDs at home",
        paragraphs: [
          "Put invoice IDs, tenant IDs, and support-facing references in your app database first. Sending them through a provider can help with correlation, but it should not be the only place they exist.",
        ],
      },
      {
        title: "Validate by adapter",
        paragraphs: [
          "If a route needs metadata, use an adapter that supports metadata. If a backup route cannot send it, make that a configuration error instead of discovering it from a missing support trace.",
        ],
      },
    ],
    callout:
      "Extra fields are useful, but they are not portable by default. Treat them as provider capabilities.",
    primaryCta: { label: "Read message reference", docsPath: "/docs/reference/message" },
    secondaryCta: { label: "Check field support", docsPath: "/docs/adapters/field-support" },
  },
  "email-queue-vs-sdk-boundary": {
    paragraphs: [
      "Queues and email SDKs solve different problems. A queue decides when work runs and how it is retried. An email SDK decides how a message becomes a provider request.",
      "When those jobs blur, incidents get muddy. Nobody can tell whether the queue retried too much, the adapter rejected the payload, or the provider accepted a duplicate.",
    ],
    sections: [
      {
        title: "Let the queue own scheduling",
        paragraphs: [
          "Use the queue for delayed sends, background work, backoff, concurrency, and job history. It should pass a clear message request into the email boundary, not build provider payloads itself.",
        ],
      },
      {
        title: "Let the SDK own provider behavior",
        checklist: [
          "Normalize the message shape.",
          "Validate adapter field support.",
          "Choose provider and fallback routes.",
          "Return normalized results and errors.",
        ],
      },
      {
        title: "Put IDs across both systems",
        paragraphs: [
          "The queue job ID and email send attempt ID should be linked. That gives you a straight line from product event to background job to provider response.",
        ],
      },
    ],
    callout:
      "A queue can retry work. It should not be the only place your app understands email provider behavior.",
    primaryCta: {
      label: "Read production guide",
      docsPath: "/docs/guides/production-send-pipeline",
    },
    secondaryCta: { label: "Read client reference", docsPath: "/docs/reference/client" },
  },
  "deliverability-code-can-control": {
    paragraphs: [
      "Deliverability is bigger than code. Domains, DNS, reputation, content, and sending practices all matter. Still, code controls more than teams admit.",
      "Your app decides which sender to use, whether a retry can duplicate a receipt, whether metadata survives a fallback, and whether anyone can debug a failed route.",
    ],
    sections: [
      {
        title: "Control the message shape",
        checklist: [
          "Use stable from and reply-to addresses.",
          "Keep plain text available for important transactional email.",
          "Avoid provider fallbacks that remove headers or metadata you depend on.",
          "Log provider IDs and normalized errors.",
        ],
      },
      {
        title: "Control the send policy",
        paragraphs: [
          "Backoff, retries, and fallback order affect what users see. If a provider is rate limiting, retrying aggressively can make the problem worse. If a provider rejects sender identity, fallback may be safer than retry.",
        ],
      },
      {
        title: "Know what code cannot solve",
        paragraphs: [
          "Code cannot rescue a bad domain reputation or missing DNS records. It can make those problems visible early and stop the app from pretending every provider route is equivalent.",
        ],
      },
    ],
    callout:
      "Treat deliverability as a shared job. DNS and reputation matter, but app code still makes the send path safer or messier.",
    primaryCta: {
      label: "Read production guide",
      docsPath: "/docs/guides/production-send-pipeline",
    },
    secondaryCta: { label: "Browse adapters", docsPath: "/docs/adapters" },
  },
  "self-hosted-smtp-vs-email-api": {
    paragraphs: [
      "Self-hosted SMTP and email APIs are two different kinds of pain. SMTP gives control and responsibility. Email APIs give speed and a provider contract. Neither choice is morally superior.",
      "Pick based on what your team is willing to own when something fails at 2am.",
    ],
    sections: [
      {
        title: "The self-hosted trade",
        paragraphs: [
          "Running SMTP can make sense for infrastructure-heavy teams with strong operational reasons. It also means owning deliverability posture, monitoring, abuse handling, and mail server maintenance.",
        ],
      },
      {
        title: "The API provider trade",
        paragraphs: [
          "Provider APIs move a lot of operational work out of your app, but they add vendor limits, pricing, and product-specific payloads. A typed adapter boundary keeps that trade manageable.",
        ],
      },
      {
        title: "Keep both possible",
        table: {
          headers: ["Need", "Likely route", "Boundary"],
          rows: [
            ["Fast product launch", "Email API", "Adapter hides provider payload."],
            ["Internal infrastructure control", "SMTP", "Strict message subset."],
            ["Tenant choice", "Mixed", "Route policy selects adapter."],
          ],
        },
      },
    ],
    callout:
      "The winner is the setup your team can operate honestly, with failures you can see and explain.",
    primaryCta: { label: "Read SMTP docs", docsPath: "/docs/adapters/smtp" },
    secondaryCta: { label: "Browse provider APIs", docsPath: "/docs/adapters" },
  },
  "customer-byo-email-provider": {
    paragraphs: [
      "Bring-your-own email provider support sounds like a settings page with an API key input. In practice, customers bring sender domains, regions, provider limits, compliance preferences, and their own broken credentials.",
      "If the app lets customers own the route, the app also needs to own validation and supportability.",
    ],
    sections: [
      {
        title: "Collect enough configuration",
        checklist: [
          "Provider type and credentials.",
          "Verified sender domain or address.",
          "Allowed message classes.",
          "Region or compliance constraints.",
          "Fallback policy and support owner.",
        ],
      },
      {
        title: "Test before enabling",
        paragraphs: [
          "A save button should not be the moment you discover credentials are wrong. Run a dry check, show the provider identity state, and keep the route disabled until a smoke test passes.",
        ],
      },
      {
        title: "Protect the shared app",
        paragraphs: [
          "One tenant's provider outage should not make every tenant's email path unclear. Keep route policy tenant-scoped, log tenant IDs, and avoid global fallback behavior that crosses customer boundaries.",
        ],
      },
    ],
    callout:
      "BYO provider support is powerful, but it needs product-grade guardrails. API keys alone are not a routing model.",
    primaryCta: { label: "Read adapter docs", docsPath: "/docs/adapters" },
    secondaryCta: { label: "Read testing guide", docsPath: "/docs/guides/test-email-behavior" },
  },
  "agents-sending-email-safely": {
    paragraphs: [
      "Agents can draft email, collect context, and trigger workflows. That does not mean they should get a raw provider API key and a blank check. Email is too visible, too easy to duplicate, and too easy to make weird.",
      "The safer pattern is to let agents work inside a typed boundary with capture, approval, and provider-aware validation.",
    ],
    sections: [
      {
        title: "Separate draft from send",
        paragraphs: [
          "An agent can prepare the message body and metadata. The app should still decide whether the message is allowed, which route can send it, and whether a human approval step is required.",
        ],
      },
      {
        title: "Capture before delivery",
        checklist: [
          "Record the generated message before sending.",
          "Validate recipients and sender identity.",
          "Block unsupported fields by adapter.",
          "Require approval for high-risk message classes.",
          "Keep an audit trail of who or what triggered the send.",
        ],
      },
      {
        title: "Use tools with narrow permissions",
        paragraphs: [
          "A send tool should not expose every provider option. Give the agent the smallest useful interface: message type, approved recipients, and route policy chosen by the app.",
        ],
      },
    ],
    callout:
      "Agents should not bypass your email architecture. They should use the safest version of it.",
    primaryCta: { label: "Read agent tools", docsPath: "/docs/agents/skill" },
    secondaryCta: { label: "Read capture plugin", docsPath: "/docs/plugins/built-in/capture" },
  },
};

function PlannedPostContent({ content }: { content: PlannedPost }) {
  return (
    <BlogBody>
      {content.paragraphs.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}

      {content.sections.map((section) => (
        <Section key={section.title} title={section.title}>
          {section.paragraphs?.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {section.table ? (
            <Table>
              <thead>
                <tr>
                  {section.table.headers.map((header) => (
                    <th key={header}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {section.table.rows.map((row) => (
                  <tr key={row.join(":")}>
                    {row.map((cell) => (
                      <td key={cell}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : null}
          {section.checklist ? <Checklist items={section.checklist} /> : null}
          {section.code ? <CodeBlock>{section.code}</CodeBlock> : null}
        </Section>
      ))}

      <Callout>{content.callout}</Callout>

      <div className="not-prose mt-10 flex flex-col gap-3 sm:flex-row">
        <DocsVersionLink
          className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-fd-primary px-4 text-sm font-medium text-fd-primary-foreground transition hover:opacity-90"
          docsPath={content.primaryCta.docsPath}
        >
          {content.primaryCta.label}
          <ArrowRight className="size-4" />
        </DocsVersionLink>
        {content.secondaryCta ? (
          <DocsVersionLink
            className="inline-flex h-11 items-center justify-center rounded-md border border-fd-border px-4 text-sm font-medium transition hover:bg-fd-accent"
            docsPath={content.secondaryCta.docsPath}
          >
            {content.secondaryCta.label}
          </DocsVersionLink>
        ) : null}
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
  let highlightedCode: string | null = null;

  try {
    highlightedCode = blogCodeHighlighter.codeToHtml(children, {
      defaultColor: false,
      lang: "ts",
      tabindex: false,
      themes: {
        dark: "github-dark",
        light: "github-light",
      },
    });
  } catch {
    highlightedCode = null;
  }

  if (!highlightedCode) {
    return (
      <figure className="blog-code-block not-prose my-8 overflow-hidden rounded-lg border border-fd-border text-sm shadow-sm">
        <pre>
          <code>{children}</code>
        </pre>
      </figure>
    );
  }

  return (
    <figure
      className="blog-code-block not-prose my-8 overflow-hidden rounded-lg border border-fd-border text-sm shadow-sm"
      dangerouslySetInnerHTML={{
        __html: highlightedCode,
      }}
    />
  );
}

function Callout({ children }: { children: ReactNode }) {
  return (
    <aside className="not-prose mt-8 rounded-lg border border-fd-primary/30 bg-fd-primary/5 p-4 text-sm leading-6 text-fd-foreground">
      {children}
    </aside>
  );
}
