import { createFileRoute } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { ArrowRight, ChevronLeft, ChevronRight, Check, Copy, Terminal } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { DocsVersionLink } from "@/components/docs-version-link";
import { SponsorSpotlight } from "@/components/sponsors";
import { baseOptions } from "@/lib/layout.shared";
import { homeStructuredData, siteTitle } from "@/lib/metadata";
import { appDescription, siteUrl } from "@/lib/shared";

const providers = [
  {
    key: "resend",
    label: "Resend",
    import: "resend",
    importPath: "@opencoredev/email-sdk/resend",
    logo: "https://cdn.simpleicons.org/resend/111111",
    rotationConfig: ["    resend({", "      apiKey: process.env.RESEND_API_KEY!,", "    }),"],
  },
  {
    key: "sequenzy",
    label: "Sequenzy",
    import: "sequenzy",
    importPath: "@opencoredev/email-sdk/sequenzy",
    logo: "/og/provider-logos/sequenzy.jpeg",
    rotationConfig: ["    sequenzy({", "      apiKey: process.env.SEQUENZY_API_KEY!,", "    }),"],
  },
  {
    key: "loops",
    label: "Loops",
    import: "loops",
    importPath: "@opencoredev/email-sdk/loops",
    logo: "https://cdn.simpleicons.org/loops",
    rotationConfig: [
      "    loops({",
      "      apiKey: process.env.LOOPS_API_KEY!,",
      "      transactionalId: process.env.LOOPS_TRANSACTIONAL_ID!,",
      "    }),",
    ],
  },
  {
    key: "cloudflare",
    label: "Cloudflare Email Sending",
    import: "cloudflare",
    importPath: "@opencoredev/email-sdk/cloudflare",
    logo: "https://cdn.simpleicons.org/cloudflare",
    rotationConfig: [
      "    cloudflare({",
      "      apiToken: process.env.CLOUDFLARE_API_TOKEN!,",
      "      accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,",
      "    }),",
    ],
  },
  {
    key: "ses",
    label: "AWS SES",
    import: "ses",
    importPath: "@opencoredev/email-sdk/ses",
    logo: "https://www.google.com/s2/favicons?domain=aws.amazon.com&sz=64",
    rotationConfig: [
      "    ses({",
      "      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,",
      "      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,",
      "      sessionToken: process.env.AWS_SESSION_TOKEN,",
      "      region: process.env.AWS_REGION!,",
      "    }),",
    ],
  },
  {
    key: "smtp",
    label: "SMTP",
    import: "smtp",
    importPath: "@opencoredev/email-sdk/smtp",
    logo: "",
    rotationConfig: [
      "    smtp({",
      '      host: "smtp.purelymail.com",',
      "      port: 587,",
      "      secure: false,",
      "      auth: {",
      "        user: process.env.SMTP_USER!,",
      "        pass: process.env.SMTP_PASS!,",
      "      },",
      "    }),",
    ],
  },
] as const;

type ProviderProfile = (typeof providers)[number];

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

function Home() {
  const [providerIndex, setProviderIndex] = useState(0);
  const activeProvider = providers[providerIndex];

  const handleNextProvider = () => {
    setProviderIndex((index) => (index + 1) % providers.length);
  };

  const handlePreviousProvider = () => {
    setProviderIndex((index) => (index - 1 + providers.length) % providers.length);
  };

  return (
    <HomeLayout {...baseOptions()}>
      <main className="border-b border-fd-border bg-fd-background text-fd-foreground">
        <section className="mx-auto grid min-h-[calc(100svh-64px)] max-w-[1512px] items-center gap-10 px-6 py-10 md:px-10 lg:grid-cols-[0.78fr_1.22fr] lg:px-14 xl:px-16">
          <div className="max-w-2xl py-4">
            <h1
              className="text-5xl font-medium leading-[1.04] text-fd-foreground md:text-6xl"
              id="hero-heading"
            >
              One email SDK for every provider.
            </h1>

            <p
              className="mt-6 max-w-xl text-base leading-7 text-fd-muted-foreground md:text-lg"
              id="hero-summary"
            >
              Email SDK is a TypeScript email SDK for transactional sending through Resend,
              Postmark, SendGrid, Mailgun, Unosend, AWS SES, Brevo, SMTP, and more with one clean
              API.
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

            <div className="mt-8 divide-y divide-fd-border/80 border-y border-fd-border/80 text-sm">
              <ProofPoint label="Retries" text="Retry transient failures without changing code." />
              <ProofPoint label="Adapters" text="Keep provider-specific code out of your app." />
              <ProofPoint label="CLI" text="Run setup checks and test sends locally." />
            </div>

            <SponsorSpotlight compact />
          </div>

          <div className="min-w-0">
            <div className="flex h-[680px] overflow-hidden rounded-lg border border-fd-border bg-fd-card shadow-xl shadow-black/10 lg:h-[760px]">
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="border-b border-fd-border bg-fd-background px-4 py-4">
                  <div className="mb-3 grid grid-cols-[1fr_auto_1fr] items-center text-xs text-fd-muted-foreground">
                    <span>Provider</span>
                    <span className="inline-flex h-7 min-w-32 items-center justify-center rounded-full bg-fd-muted px-3 text-[11px] font-semibold text-fd-foreground shadow-inner shadow-black/10 sm:min-w-40">
                      <span className="max-w-32 truncate sm:max-w-36">{activeProvider.label}</span>
                    </span>
                    <span className="hidden justify-self-end sm:block">
                      Use arrows or click a logo
                    </span>
                  </div>
                  <div className="grid min-h-16 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-2 sm:grid-cols-[3.25rem_minmax(0,1fr)_3.25rem] sm:gap-3">
                    <button
                      aria-label="Show previous provider"
                      className="inline-flex size-10 items-center justify-center rounded-full border border-fd-border bg-fd-card text-fd-muted-foreground transition hover:border-fd-primary hover:bg-fd-muted hover:text-fd-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring sm:size-11"
                      onClick={handlePreviousProvider}
                      type="button"
                    >
                      <ChevronLeft className="size-4" strokeWidth={2} />
                    </button>
                    <div className="mx-auto flex h-16 w-full max-w-full items-center justify-start gap-1.5 overflow-x-auto px-1 sm:justify-center sm:gap-2">
                      {providers.map((provider, index) => {
                        const isActive = index === providerIndex;

                        return (
                          <button
                            aria-label={`Select ${provider.label} adapter`}
                            aria-pressed={isActive}
                            className={`relative inline-flex size-11 shrink-0 items-center justify-center rounded-full transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring sm:size-12 ${
                              isActive
                                ? "bg-fd-foreground text-fd-background shadow-lg shadow-black/20"
                                : "bg-transparent text-fd-muted-foreground opacity-70 hover:bg-fd-muted/45 hover:text-fd-foreground hover:opacity-100"
                            }`}
                            key={provider.key}
                            onClick={() => {
                              setProviderIndex(index);
                            }}
                            type="button"
                          >
                            {isActive ? (
                              <span className="absolute -bottom-2 h-1 w-1 rounded-full bg-fd-primary" />
                            ) : null}
                            <ProviderLogo
                              active={isActive}
                              label={provider.label}
                              logo={provider.logo}
                            />
                          </button>
                        );
                      })}
                    </div>
                    <button
                      aria-label="Show next provider"
                      className="inline-flex size-10 items-center justify-center justify-self-end rounded-full border border-fd-border bg-fd-card text-fd-muted-foreground transition hover:border-fd-primary hover:bg-fd-muted hover:text-fd-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring sm:size-11"
                      onClick={handleNextProvider}
                      type="button"
                    >
                      <ChevronRight className="size-4" strokeWidth={2} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between border-b border-fd-border px-4 py-3">
                  <div className="flex items-center gap-2 text-sm text-fd-muted-foreground">
                    <Terminal className="size-4" strokeWidth={2} />
                    <span>email.ts</span>
                  </div>
                  <CopyCodeButton provider={activeProvider} />
                </div>
                <pre
                  className="min-h-0 flex-1 overflow-auto p-4 text-[12px] leading-[1.3] text-fd-foreground transition duration-500 md:p-5 md:text-[13px] md:leading-[1.4]"
                  key={activeProvider.key}
                >
                  <code>
                    <SyntaxCode key={activeProvider.key} provider={activeProvider} />
                  </code>
                </pre>
              </div>
            </div>
          </div>
        </section>
      </main>
    </HomeLayout>
  );
}

function CopyCodeButton({ provider }: { provider: ProviderProfile }) {
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

  useEffect(() => {
    return clearTimers;
  }, []);

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

    const copiedToClipboard = await copyToClipboard(generateExample(provider));
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

function SyntaxCode({ provider }: { provider: ProviderProfile }) {
  const adapterEndLine = 6 + provider.rotationConfig.length;

  return (
    <>
      <CodeLine number={1}>
        <Token tone="keyword">import</Token> {"{ createEmailClient }"}{" "}
        <Token tone="keyword">from</Token> <Token tone="string">"@opencoredev/email-sdk"</Token>;
      </CodeLine>
      <CodeLine number={2}>
        <Token tone="keyword">import</Token>
        {" { "}
        <Token tone="function">{provider.import}</Token>
        {" } "}
        <Token tone="keyword">from</Token> <Token tone="string">{`"${provider.importPath}"`}</Token>
        ;
      </CodeLine>
      <CodeLine />
      <CodeLine number={4}>
        <Token tone="keyword">const</Token> <Token tone="variable">email</Token> ={" "}
        <Token tone="function">createEmailClient</Token>({"{"}
      </CodeLine>
      <CodeLine number={5}>
        {"  "}
        <Token tone="property">adapters</Token>: [
      </CodeLine>
      {provider.rotationConfig.map((line, index) => (
        <CodeLine key={`${provider.key}-${index}`} number={6 + index}>
          {renderConfigLine(line)}
        </CodeLine>
      ))}
      <CodeLine number={adapterEndLine}>{"  ],"}</CodeLine>
      <CodeLine number={adapterEndLine + 1}>
        {"  "}
        <Token tone="property">retry</Token>: {"{"} <Token tone="property">retries</Token>:{" "}
        <Token tone="number">1</Token> {"}"},
      </CodeLine>
      <CodeLine number={adapterEndLine + 2}>{"});"}</CodeLine>
      <CodeLine />
      <CodeLine number={adapterEndLine + 4}>
        <Token tone="keyword">await</Token> <Token tone="variable">email</Token>.
        <Token tone="function">send</Token>({"{"}
      </CodeLine>
      <CodeLine number={adapterEndLine + 5}>
        {"  "}
        <Token tone="property">from</Token>:{" "}
        <Token tone="string">{'"Acme <hello@acme.com>"'}</Token>,
      </CodeLine>
      <CodeLine number={adapterEndLine + 6}>
        {"  "}
        <Token tone="property">to</Token>: <Token tone="string">"user@example.com"</Token>,
      </CodeLine>
      <CodeLine number={adapterEndLine + 7}>
        {"  "}
        <Token tone="property">subject</Token>: <Token tone="string">"Welcome"</Token>,
      </CodeLine>
      <CodeLine number={adapterEndLine + 8}>
        {"  "}
        <Token tone="property">text</Token>: <Token tone="string">"Your account is ready."</Token>,
      </CodeLine>
      <CodeLine number={adapterEndLine + 9}>{"});"}</CodeLine>
    </>
  );
}

function renderConfigLine(line: string) {
  const leadingWhitespace = line.match(/^\s*/)?.[0] ?? "";
  const trimmedLine = line.trim();
  const callMatch = trimmedLine.match(/^([a-zA-Z]+)\(\{$/);
  const envMatch = trimmedLine.match(/^([a-zA-Z]+): process\.env\.([A-Z0-9_]+)!?,?$/);
  const stringMatch = trimmedLine.match(/^([a-zA-Z]+): "([^"]+)",?$/);
  const numberMatch = trimmedLine.match(/^([a-zA-Z]+): ([0-9]+),?$/);
  const booleanMatch = trimmedLine.match(/^([a-zA-Z]+): (true|false),?$/);
  const objectMatch = trimmedLine.match(/^([a-zA-Z]+): \{$/);
  const closingMatch = trimmedLine.match(/^([})]+),?$/);
  const trailingComma = trimmedLine.endsWith(",");

  if (callMatch?.[1]) {
    return (
      <>
        {leadingWhitespace}
        <Token tone="function">{callMatch[1]}</Token>({"{"}
      </>
    );
  }

  if (envMatch?.[1] && envMatch[2]) {
    const suffix = trimmedLine.endsWith("!,")
      ? "!,"
      : trimmedLine.endsWith("!")
        ? "!"
        : trailingComma
          ? ","
          : "";

    return (
      <>
        {leadingWhitespace}
        <Token tone="property">{envMatch[1]}</Token>: <Token tone="variable">process</Token>.env.
        {envMatch[2]}
        {suffix}
      </>
    );
  }

  if (stringMatch?.[1] && stringMatch[2]) {
    return (
      <>
        {leadingWhitespace}
        <Token tone="property">{stringMatch[1]}</Token>:{" "}
        <Token tone="string">{`"${stringMatch[2]}"`}</Token>
        {trailingComma ? "," : ""}
      </>
    );
  }

  if (numberMatch?.[1] && numberMatch[2]) {
    return (
      <>
        {leadingWhitespace}
        <Token tone="property">{numberMatch[1]}</Token>:{" "}
        <Token tone="number">{numberMatch[2]}</Token>
        {trailingComma ? "," : ""}
      </>
    );
  }

  if (booleanMatch?.[1] && booleanMatch[2]) {
    return (
      <>
        {leadingWhitespace}
        <Token tone="property">{booleanMatch[1]}</Token>:{" "}
        <Token tone="keyword">{booleanMatch[2]}</Token>
        {trailingComma ? "," : ""}
      </>
    );
  }

  if (objectMatch?.[1]) {
    return (
      <>
        {leadingWhitespace}
        <Token tone="property">{objectMatch[1]}</Token>: {"{"}
      </>
    );
  }

  if (closingMatch?.[1]) {
    return (
      <>
        {leadingWhitespace}
        <Token tone="keyword">{closingMatch[1]}</Token>
        {trailingComma ? "," : ""}
      </>
    );
  }

  return line;
}

function generateExample(provider: ProviderProfile) {
  return `import { createEmailClient } from "@opencoredev/email-sdk";
import { ${provider.import} } from "${provider.importPath}";

const email = createEmailClient({
  adapters: [
${provider.rotationConfig.join("\n")}
  ],
  retry: { retries: 1 },
});

await email.send({
  from: "Acme <hello@acme.com>",
  to: "user@example.com",
  subject: "Welcome",
  text: "Your account is ready.",
});`;
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
    textarea.remove();
  }
}

function readTextSwapDuration() {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--text-swap-dur");
  return Number.parseFloat(value) || 200;
}

function ProviderLogo({ active, label, logo }: { active: boolean; label: string; logo: string }) {
  const [imageFailed, setImageFailed] = useState(false);

  if (!logo || imageFailed) {
    return (
      <span
        className={`m-auto flex size-8 items-center justify-center rounded-full text-[9px] font-semibold sm:size-9 sm:text-[10px] ${
          active ? "bg-fd-background text-fd-foreground" : "bg-fd-foreground text-fd-background"
        }`}
      >
        {getProviderInitials(label)}
      </span>
    );
  }

  return (
    <span className="m-auto flex size-8 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-black/10 sm:size-9">
      <img
        alt={label}
        className="size-6 rounded-full object-contain sm:size-7"
        loading="lazy"
        src={logo}
        onError={() => {
          setImageFailed(true);
        }}
      />
    </span>
  );
}

function getProviderInitials(label: string) {
  if (label === "SMTP") {
    return "SMTP";
  }

  const words = label.split(" ");

  if (words.length > 1) {
    return words
      .map((word) => word.charAt(0))
      .join("")
      .toUpperCase();
  }

  return label.slice(0, 2).toUpperCase();
}
