import { createFileRoute, Link } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { ArrowRight, Check, Copy, Mail, Terminal } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { baseOptions } from "@/lib/layout.shared";

export const Route = createFileRoute("/")({
  component: Home,
});

const example = `import { createEmailClient } from "email-sdk";
import { resend } from "email-sdk/resend";
import { smtp } from "email-sdk/smtp";

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
      <main className="h-[calc(100svh-64px)] overflow-hidden border-b border-fd-border bg-fd-background text-fd-foreground">
        <section className="mx-auto grid h-full max-w-[1512px] items-center gap-10 px-6 py-8 md:px-10 lg:grid-cols-[0.82fr_1.18fr] lg:px-14 xl:px-16">
          <div className="max-w-2xl">
            <p className="mb-7 inline-flex items-center gap-2 text-sm font-medium text-fd-muted-foreground">
              <span className="grid size-7 place-items-center rounded-md border border-fd-border bg-fd-card">
                <Mail className="size-4 text-fd-primary" strokeWidth={2} />
              </span>
              Unified email sending for TypeScript
            </p>

            <h1 className="text-5xl font-medium leading-[1.04] tracking-[-0.02em] text-fd-foreground md:text-6xl">
              One email client. Every provider you trust.
            </h1>

            <p className="mt-6 max-w-xl text-base leading-7 text-fd-muted-foreground md:text-lg">
              Send through Resend, SMTP, Postmark, and more without rewriting provider glue or
              hiding what each adapter supports.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-fd-primary px-4 text-sm font-medium text-fd-primary-foreground transition hover:opacity-90"
                params={{
                  _splat: "",
                }}
                to="/docs/$"
              >
                Read the docs
                <ArrowRight className="size-4" strokeWidth={2} />
              </Link>
              <Link
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-fd-border bg-fd-card px-4 text-sm font-medium text-fd-foreground transition hover:bg-fd-accent"
                params={{
                  _splat: "adapters",
                }}
                to="/docs/$"
              >
                Browse adapters
              </Link>
            </div>

            <div className="mt-9 grid max-w-xl gap-3 text-sm sm:grid-cols-3">
              <ProofPoint label="Fallbacks" text="Fail over by route" />
              <ProofPoint label="Contracts" text="No silent field drops" />
              <ProofPoint label="CLI" text="Test sends locally" />
            </div>
          </div>

          <div className="min-w-0">
            <div className="overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-xl shadow-black/10">
              <div className="flex items-center justify-between border-b border-fd-border px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-fd-muted-foreground">
                  <Terminal className="size-4" strokeWidth={2} />
                  <span>email.ts</span>
                </div>
                <CopyCodeButton />
              </div>
              <pre className="max-h-[64svh] overflow-hidden p-5 text-[13px] leading-6 text-fd-foreground md:p-6 md:text-sm">
                <code>
                  <SyntaxCode />
                </code>
              </pre>
            </div>
          </div>
        </section>
      </main>
    </HomeLayout>
  );
}

function CopyCodeButton() {
  const [copied, setCopied] = useState(false);
  const [label, setLabel] = useState("Copy");
  const [labelState, setLabelState] = useState("");

  function swapLabel(next: string) {
    const duration = readTextSwapDuration();

    setLabelState("is-exit");
    window.setTimeout(() => {
      setLabel(next);
      setLabelState("is-enter-start");
      window.requestAnimationFrame(() => setLabelState(""));
    }, duration);
  }

  return (
    <button
      aria-label="Copy code example"
      className="inline-flex items-center gap-2 overflow-hidden rounded-md border border-fd-border px-2.5 py-1.5 text-xs text-fd-muted-foreground transition-colors duration-200 hover:bg-fd-accent hover:text-fd-foreground"
      onClick={() => {
        void copyToClipboard(example).then(() => {
          setCopied(true);
          swapLabel("Copied");
          window.setTimeout(() => {
            setCopied(false);
            swapLabel("Copy");
          }, 1200);
        });
      }}
      type="button"
    >
      <span className="t-icon-swap size-3.5" data-state={copied ? "b" : "a"}>
        <Copy className="t-icon size-3.5" data-icon="a" strokeWidth={2} />
        <Check className="t-icon size-3.5 text-fd-primary" data-icon="b" strokeWidth={2} />
      </span>
      <span className={`t-text-swap ${labelState}`}>{label}</span>
    </button>
  );
}

function ProofPoint({ label, text }: { label: string; text: string }) {
  return (
    <div className="border-l border-fd-primary/70 pl-3">
      <p className="font-medium text-fd-foreground">{label}</p>
      <p className="mt-1 text-fd-muted-foreground">{text}</p>
    </div>
  );
}

function SyntaxCode() {
  return (
    <>
      <CodeLine number={1}>
        <Token tone="keyword">import</Token> {"{ createEmailClient }"}{" "}
        <Token tone="keyword">from</Token> <Token tone="string">"email-sdk"</Token>;
      </CodeLine>
      <CodeLine number={2}>
        <Token tone="keyword">import</Token> {"{ resend }"} <Token tone="keyword">from</Token>{" "}
        <Token tone="string">"email-sdk/resend"</Token>;
      </CodeLine>
      <CodeLine number={3}>
        <Token tone="keyword">import</Token> {"{ smtp }"} <Token tone="keyword">from</Token>{" "}
        <Token tone="string">"email-sdk/smtp"</Token>;
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
        <Token tone="property">auth</Token>: {"{"} <Token tone="property">user</Token>,{" "}
        <Token tone="property">pass</Token> {"}"},
      </CodeLine>
      <CodeLine number={11}>{"    })"},</CodeLine>
      <CodeLine number={12}>{"  ],"}</CodeLine>
      <CodeLine number={13}>
        {"  "}
        <Token tone="property">fallback</Token>: [<Token tone="string">"smtp"</Token>],
      </CodeLine>
      <CodeLine number={14}>
        {"  "}
        <Token tone="property">retry</Token>: {"{"} <Token tone="property">retries</Token>:{" "}
        <Token tone="number">1</Token> {"}"},
      </CodeLine>
      <CodeLine number={15}>{"});"}</CodeLine>
      <CodeLine />
      <CodeLine number={17}>
        <Token tone="keyword">await</Token> <Token tone="variable">email</Token>.
        <Token tone="function">send</Token>({"{"}
      </CodeLine>
      <CodeLine number={18}>
        {"  "}
        <Token tone="property">to</Token>: <Token tone="string">"user@example.com"</Token>,
      </CodeLine>
      <CodeLine number={19}>
        {"  "}
        <Token tone="property">subject</Token>: <Token tone="string">"Welcome"</Token>,
      </CodeLine>
      <CodeLine number={20}>{"});"}</CodeLine>
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
    function: "text-sky-300",
    keyword: "text-purple-300",
    number: "text-amber-300",
    property: "text-rose-300",
    string: "text-emerald-300",
    variable: "text-blue-300",
  }[tone];

  return <span className={className}>{children}</span>;
}

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}

function readTextSwapDuration() {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--text-swap-dur");
  return Number.parseFloat(value) || 200;
}
