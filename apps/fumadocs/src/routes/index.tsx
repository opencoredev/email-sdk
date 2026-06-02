import { createFileRoute } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { ArrowRight, Check, Copy, Terminal } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { DocsVersionLink } from "@/components/docs-version-link";
import { SponsorSpotlight } from "@/components/sponsors";
import { baseOptions } from "@/lib/layout.shared";
import { homeStructuredData, siteTitle } from "@/lib/metadata";
import { appDescription, siteUrl } from "@/lib/shared";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: siteTitle },
      { name: "description", content: appDescription },
      { property: "og:url", content: siteUrl },
      { "script:ld+json": homeStructuredData },
    ],
    links: [{ rel: "canonical", href: siteUrl }],
  }),
  component: Home,
});

const example = `import { createEmailClient } from "@opencoredev/email-sdk";
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
});`;

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="border-b border-fd-border bg-fd-background text-fd-foreground">
        <section className="mx-auto grid min-h-[calc(100svh-64px)] max-w-[1512px] items-center gap-10 px-6 py-10 md:px-10 lg:grid-cols-[0.78fr_1.22fr] lg:px-14 xl:px-16">
          <div className="max-w-2xl py-4">
            <h1 className="text-5xl font-medium leading-[1.04] text-fd-foreground md:text-6xl">
              One email SDK for every provider.
            </h1>

            <p className="mt-6 max-w-xl text-base leading-7 text-fd-muted-foreground md:text-lg">
              Email SDK is a TypeScript email SDK for transactional sending through Resend,
              Postmark, SendGrid, Mailgun, AWS SES, Brevo, SMTP, and more with one clean API.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <DocsVersionLink className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-fd-primary px-4 text-sm font-medium text-fd-primary-foreground transition hover:opacity-90">
                Read the docs
                <ArrowRight className="size-4" strokeWidth={2} />
              </DocsVersionLink>
              <DocsVersionLink
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-fd-border bg-fd-card px-4 text-sm font-medium text-fd-foreground transition hover:bg-fd-accent"
                docsPath="/docs/adapters"
              >
                Browse adapters
              </DocsVersionLink>
            </div>

            <div className="mt-10 divide-y divide-fd-border/80 border-y border-fd-border/80 text-sm">
              <ProofPoint label="Fallbacks" text="Retry failed sends and move to backup routes." />
              <ProofPoint label="Adapters" text="Keep provider-specific code out of your app." />
              <ProofPoint label="CLI" text="Run setup checks and test sends locally." />
            </div>
          </div>

          <div className="min-w-0">
            <div className="overflow-hidden rounded-lg border border-fd-border bg-fd-card shadow-xl shadow-black/10">
              <div className="flex items-center justify-between border-b border-fd-border px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-fd-muted-foreground">
                  <Terminal className="size-4" strokeWidth={2} />
                  <span>email.ts</span>
                </div>
                <CopyCodeButton />
              </div>
              <pre className="overflow-x-auto p-4 text-[12px] leading-[1.3] text-fd-foreground md:p-5 md:text-[13px] md:leading-[1.4]">
                <code>
                  <SyntaxCode />
                </code>
              </pre>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 pb-12 md:px-10 lg:px-14 xl:px-16">
          <SponsorSpotlight />
        </section>
      </main>
    </HomeLayout>
  );
}

function CopyCodeButton() {
  const [copied, setCopied] = useState(false);
  const [label, setLabel] = useState("Copy");
  const [labelState, setLabelState] = useState("");
  const swapTimerRef = useRef<number | null>(null);
  const resetTimerRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  function clearTimers() {
    if (swapTimerRef.current !== null) {
      window.clearTimeout(swapTimerRef.current);
      swapTimerRef.current = null;
    }

    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }

    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }

  useEffect(() => clearTimers, []);

  function swapLabel(next: string) {
    const duration = readTextSwapDuration();

    setLabelState("is-exit");
    swapTimerRef.current = window.setTimeout(() => {
      setLabel(next);
      setLabelState("is-enter-start");
      frameRef.current = window.requestAnimationFrame(() => {
        setLabelState("");
        frameRef.current = null;
      });
      swapTimerRef.current = null;
    }, duration);
  }

  async function handleCopy() {
    clearTimers();

    const copiedToClipboard = await copyToClipboard(example);
    setCopied(copiedToClipboard);
    swapLabel(copiedToClipboard ? "Copied" : "Copy failed");

    resetTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      swapLabel("Copy");
      resetTimerRef.current = null;
    }, 1200);
  }

  return (
    <button
      aria-label="Copy code example"
      className="inline-flex items-center gap-2 overflow-hidden rounded-md border border-fd-border px-2.5 py-1.5 text-xs text-fd-muted-foreground transition-colors duration-200 hover:bg-fd-accent hover:text-fd-foreground"
      onClick={() => {
        void handleCopy();
      }}
      type="button"
    >
      <span className="t-icon-swap size-3.5" data-state={copied ? "b" : "a"}>
        <Copy className="t-icon size-3.5" data-icon="a" strokeWidth={2} />
        <Check className="t-icon size-3.5 text-fd-primary" data-icon="b" strokeWidth={2} />
      </span>
      <span aria-atomic="true" aria-live="polite" className={`t-text-swap ${labelState}`}>
        {label}
      </span>
    </button>
  );
}

function ProofPoint({ label, text }: { label: string; text: string }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[120px_1fr]">
      <p className="font-medium text-fd-foreground">{label}</p>
      <p className="text-fd-muted-foreground">{text}</p>
    </div>
  );
}

function SyntaxCode() {
  return (
    <>
      <CodeLine number={1}>
        <Token tone="keyword">import</Token> {"{ createEmailClient }"}{" "}
        <Token tone="keyword">from</Token> <Token tone="string">"@opencoredev/email-sdk"</Token>;
      </CodeLine>
      <CodeLine number={2}>
        <Token tone="keyword">import</Token> {"{ resend }"} <Token tone="keyword">from</Token>{" "}
        <Token tone="string">"@opencoredev/email-sdk/resend"</Token>;
      </CodeLine>
      <CodeLine number={3}>
        <Token tone="keyword">import</Token> {"{ smtp }"} <Token tone="keyword">from</Token>{" "}
        <Token tone="string">"@opencoredev/email-sdk/smtp"</Token>;
      </CodeLine>
      <CodeLine />
      <CodeLine number={5}>
        <Token tone="keyword">const</Token> <Token tone="variable">email</Token> ={" "}
        <Token tone="function">createEmailClient</Token>({"{"}
      </CodeLine>
      <CodeLine number={6}>
        {"  "}
        <Token tone="property">adapters</Token>: [
      </CodeLine>
      <CodeLine number={7}>
        {"    "}
        <Token tone="function">resend</Token>({"{"} <Token tone="property">apiKey</Token>:{" "}
        <Token tone="variable">process</Token>.env.RESEND_API_KEY! {"}"}),
      </CodeLine>
      <CodeLine number={8}>
        {"    "}
        <Token tone="function">smtp</Token>({"{"}
      </CodeLine>
      <CodeLine number={9}>
        {"      "}
        <Token tone="property">host</Token>: <Token tone="variable">process</Token>.env.SMTP_HOST!,
      </CodeLine>
      <CodeLine number={10}>
        {"      "}
        <Token tone="property">auth</Token>: {"{"}
      </CodeLine>
      <CodeLine number={11}>
        {"        "}
        <Token tone="property">user</Token>: <Token tone="variable">process</Token>.env.SMTP_USER!,
      </CodeLine>
      <CodeLine number={12}>
        {"        "}
        <Token tone="property">pass</Token>: <Token tone="variable">process</Token>.env.SMTP_PASS!,
      </CodeLine>
      <CodeLine number={13}>{"      },"}</CodeLine>
      <CodeLine number={14}>{"    }),"}</CodeLine>
      <CodeLine number={15}>{"  ],"}</CodeLine>
      <CodeLine number={16}>
        {"  "}
        <Token tone="property">fallback</Token>: [<Token tone="string">"smtp"</Token>],
      </CodeLine>
      <CodeLine number={17}>
        {"  "}
        <Token tone="property">retry</Token>: {"{"} <Token tone="property">retries</Token>:{" "}
        <Token tone="number">1</Token> {"}"},
      </CodeLine>
      <CodeLine number={18}>{"});"}</CodeLine>
      <CodeLine />
      <CodeLine number={20}>
        <Token tone="keyword">await</Token> <Token tone="variable">email</Token>.
        <Token tone="function">send</Token>({"{"}
      </CodeLine>
      <CodeLine number={21}>
        {"  "}
        <Token tone="property">from</Token>:{" "}
        <Token tone="string">{'"Acme <hello@acme.com>"'}</Token>,
      </CodeLine>
      <CodeLine number={22}>
        {"  "}
        <Token tone="property">to</Token>: <Token tone="string">"user@example.com"</Token>,
      </CodeLine>
      <CodeLine number={23}>
        {"  "}
        <Token tone="property">subject</Token>: <Token tone="string">"Welcome"</Token>,
      </CodeLine>
      <CodeLine number={24}>
        {"  "}
        <Token tone="property">text</Token>: <Token tone="string">"Your account is ready."</Token>,
      </CodeLine>
      <CodeLine number={25}>{"});"}</CodeLine>
    </>
  );
}

function CodeLine({ children, number }: { children?: ReactNode; number?: number }) {
  return (
    <span className="block min-h-6">
      <span className="mr-5 inline-block w-5 select-none text-right text-fd-muted-foreground/55">
        {number ?? ""}
      </span>
      {children}
    </span>
  );
}

function Token({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "function" | "keyword" | "number" | "property" | "string" | "variable";
}) {
  const className = {
    function: "text-sky-700 dark:text-sky-300",
    keyword: "text-purple-700 dark:text-purple-300",
    number: "text-amber-700 dark:text-amber-300",
    property: "text-rose-700 dark:text-rose-300",
    string: "text-emerald-700 dark:text-emerald-300",
    variable: "text-blue-700 dark:text-blue-300",
  }[tone];

  return <span className={className}>{children}</span>;
}

async function copyToClipboard(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    return copyWithTextarea(text);
  }

  return copyWithTextarea(text);
}

function copyWithTextarea(text: string) {
  const textarea = document.createElement("textarea");

  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    if (textarea.parentNode) {
      textarea.parentNode.removeChild(textarea);
    }
  }
}

function readTextSwapDuration() {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--text-swap-dur");
  return Number.parseFloat(value) || 200;
}
