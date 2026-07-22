"use client";

import {
  EmailButton,
  EmailCard,
  EmailHeading,
  EmailSeparator,
  EmailText,
  ShadcnEmail,
} from "@opencoredev/email-sdk/react";
import { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Moon, Sun } from "@/components/icon";

const categories = [
  {
    description: "Sign-in, recovery, and workspace access.",
    key: "account",
    title: "Account",
  },
  {
    description: "Activation, retention, and product limits.",
    key: "product",
    title: "Product",
  },
  {
    description: "Payments, invoices, and money movement.",
    key: "commerce",
    title: "Commerce",
  },
] as const;

const examples = {
  "verification-code": {
    category: "account",
    description: "A focused one-time code with a clear expiry.",
    path: "/docs/ui/account/verification-code",
    preview: "482 901 is your verification code",
    subject: "Your verification code",
    title: "Verification code",
  },
  "password-reset": {
    category: "account",
    description: "A secure reset action with request context.",
    path: "/docs/ui/account/password-reset",
    preview: "Reset your password within the next 30 minutes",
    subject: "Reset your password",
    title: "Password reset",
  },
  "team-invite": {
    category: "account",
    description: "A personal invitation to join a workspace.",
    path: "/docs/ui/account/team-invite",
    preview: "Maya invited you to join Acme",
    subject: "You’re invited to Acme",
    title: "Team invite",
  },
  welcome: {
    category: "product",
    description: "A useful first step after account creation.",
    path: "/docs/ui/product/welcome",
    preview: "Your workspace is ready",
    subject: "Welcome to Acme",
    title: "Welcome",
  },
  "trial-ending": {
    category: "product",
    description: "An honest reminder before a trial expires.",
    path: "/docs/ui/product/trial-ending",
    preview: "Your Acme trial ends in 3 days",
    subject: "Your trial ends Friday",
    title: "Trial ending",
  },
  "usage-alert": {
    category: "product",
    description: "A calm limit warning with a direct next action.",
    path: "/docs/ui/product/usage-alert",
    preview: "You have used 85% of this month’s email volume",
    subject: "You’re nearing your email limit",
    title: "Usage alert",
  },
  receipt: {
    category: "commerce",
    description: "A compact payment confirmation and receipt link.",
    path: "/docs/ui/commerce/receipt",
    preview: "Payment received for order #1842",
    subject: "Receipt for order #1842",
    title: "Receipt",
  },
  "invoice-due": {
    category: "commerce",
    description: "A clear invoice summary before payment is due.",
    path: "/docs/ui/commerce/invoice-due",
    preview: "Invoice INV-2048 is due August 1",
    subject: "Invoice INV-2048 is due soon",
    title: "Invoice due",
  },
  "refund-confirmed": {
    category: "commerce",
    description: "A reassuring refund status with timing details.",
    path: "/docs/ui/commerce/refund-confirmed",
    preview: "Your $49.00 refund is on its way",
    subject: "Your refund has been issued",
    title: "Refund confirmed",
  },
} as const;

type ExampleId = keyof typeof examples;

type EmailExampleProps = {
  id: ExampleId;
};

type EmailTheme = "light" | "dark";

export function EmailExampleGallery() {
  return (
    <div className="not-prose my-8 space-y-10">
      {categories.map((category) => (
        <section key={category.key}>
          <div className="mb-4 flex flex-col gap-1 border-b border-fd-border pb-3 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="text-lg font-semibold tracking-tight text-fd-foreground">
              {category.title}
            </h2>
            <p className="text-sm text-fd-muted-foreground">{category.description}</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {(Object.entries(examples) as [ExampleId, (typeof examples)[ExampleId]][])
              .filter(([, example]) => example.category === category.key)
              .map(([id, example]) => (
                <a
                  className="group overflow-hidden rounded-xl border border-fd-border bg-fd-card transition hover:border-fd-muted-foreground/60 hover:bg-fd-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring"
                  href={example.path}
                  key={id}
                >
                  <div className="relative h-56 overflow-hidden bg-[#ededed]">
                    <EmailIframe compact id={id} />
                  </div>
                  <div className="border-t border-fd-border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-medium text-fd-foreground">{example.title}</h3>
                      <span className="text-fd-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-fd-foreground">
                        →
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm leading-5 text-fd-muted-foreground">
                      {example.description}
                    </p>
                  </div>
                </a>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function EmailExample({ id }: EmailExampleProps) {
  const example = examples[id];
  const [theme, setTheme] = useState<EmailTheme>("light");

  return (
    <figure className="not-prose my-8 overflow-hidden rounded-xl border border-fd-border bg-fd-card">
      <figcaption className="border-b border-fd-border">
        <div className="flex flex-col gap-3 border-b border-fd-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <span className="text-xs font-medium text-fd-foreground">Email preview</span>
          <div
            aria-label="Email color theme"
            className="inline-flex w-fit rounded-lg border border-fd-border bg-fd-muted p-1"
            role="group"
          >
            <ThemeButton active={theme === "light"} onClick={() => setTheme("light")}>
              <Sun aria-hidden="true" className="size-3.5" />
              Light
            </ThemeButton>
            <ThemeButton active={theme === "dark"} onClick={() => setTheme("dark")}>
              <Moon aria-hidden="true" className="size-3.5" />
              Dark
            </ThemeButton>
          </div>
        </div>
        <div className="grid gap-3 px-4 py-3 text-xs sm:grid-cols-[5rem_minmax(0,1fr)] sm:px-5">
          <span className="text-fd-muted-foreground">From</span>
          <span className="font-medium text-fd-foreground">Acme &lt;hello@acme.com&gt;</span>
          <span className="text-fd-muted-foreground">Subject</span>
          <span className="font-medium text-fd-foreground">{example.subject}</span>
          <span className="text-fd-muted-foreground">Preview</span>
          <span className="text-fd-muted-foreground">{example.preview}</span>
        </div>
      </figcaption>
      <div className={theme === "dark" ? "bg-[#050505] p-3 sm:p-6" : "bg-[#ededed] p-3 sm:p-6"}>
        <EmailIframe id={id} theme={theme} />
      </div>
    </figure>
  );
}

function ThemeButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={
        active
          ? "inline-flex h-7 items-center gap-1.5 rounded-md bg-fd-background px-2.5 text-xs font-medium text-fd-foreground shadow-sm"
          : "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-fd-muted-foreground transition hover:text-fd-foreground"
      }
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function EmailIframe({
  compact = false,
  id,
  theme = "light",
}: EmailExampleProps & { compact?: boolean; theme?: EmailTheme }) {
  const example = examples[id];
  const html = `<!doctype html>${renderToStaticMarkup(<Template id={id} theme={theme} />)}`;

  return (
    <iframe
      className={
        compact
          ? "pointer-events-none absolute left-1/2 top-3 h-[560px] w-[600px] max-w-none origin-top -translate-x-1/2 scale-[0.42] border-0 bg-white"
          : "h-[620px] w-full rounded-lg border-0 bg-white"
      }
      loading="lazy"
      srcDoc={html}
      title={`${example.title} email preview`}
    />
  );
}

function Template({ id, theme }: EmailExampleProps & { theme: EmailTheme }) {
  const preview = examples[id].preview;
  const mutedBrand = theme === "dark" ? "#a1a1aa" : "#52525b";

  return (
    <ShadcnEmail preview={preview} theme={theme}>
      <EmailCard>
        <div
          style={{
            color: mutedBrand,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.18em",
            marginBottom: 28,
          }}
        >
          ACME
        </div>
        <TemplateBody id={id} theme={theme} />
        <EmailSeparator />
        <EmailText muted style={{ fontSize: 12, lineHeight: "20px", marginBottom: 0 }}>
          Acme, Inc. · 100 Market Street · San Francisco, CA
        </EmailText>
      </EmailCard>
    </ShadcnEmail>
  );
}

function TemplateBody({ id, theme }: EmailExampleProps & { theme: EmailTheme }) {
  const subtleBackground = theme === "dark" ? "#27272a" : "#f4f4f5";
  const subtleBorder = theme === "dark" ? "#52525b" : "#d4d4d8";
  const subtleText = theme === "dark" ? "#d4d4d8" : "#52525b";
  const progressTrack = theme === "dark" ? "#3f3f46" : "#e4e4e7";
  const progressFill = theme === "dark" ? "#fafafa" : "#18181b";

  switch (id) {
    case "verification-code":
      return (
        <>
          <EmailHeading>Verify your email</EmailHeading>
          <EmailText>Enter this code to finish signing in. It expires in 10 minutes.</EmailText>
          <EmailText
            style={{
              backgroundColor: subtleBackground,
              borderRadius: 8,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: 8,
              padding: "18px 20px",
              textAlign: "center",
            }}
          >
            482 901
          </EmailText>
          <EmailText muted style={{ fontSize: 13, marginBottom: 0 }}>
            If you didn’t request this code, you can safely ignore this email.
          </EmailText>
        </>
      );
    case "password-reset":
      return (
        <>
          <EmailHeading>Reset your password</EmailHeading>
          <EmailText>
            We received a request to reset the password for your Acme account.
          </EmailText>
          <EmailButton href="https://acme.com/reset">Reset password</EmailButton>
          <EmailText muted style={{ fontSize: 13, marginBottom: 0, marginTop: 20 }}>
            This link expires in 30 minutes. The request came from Safari on macOS.
          </EmailText>
        </>
      );
    case "team-invite":
      return (
        <>
          <EmailHeading>Join Maya on Acme</EmailHeading>
          <EmailText>Maya Chen invited you to collaborate in the Acme workspace.</EmailText>
          <EmailText
            style={{
              borderLeft: `2px solid ${subtleBorder}`,
              color: subtleText,
              fontStyle: "italic",
              paddingLeft: 16,
            }}
          >
            “We’re keeping launch notes, approvals, and customer updates here.”
          </EmailText>
          <EmailButton href="https://acme.com/invite">Join workspace</EmailButton>
        </>
      );
    case "welcome":
      return (
        <>
          <EmailHeading>Your workspace is ready</EmailHeading>
          <EmailText>
            Welcome, Ada. Send your first email or invite your team when you’re ready.
          </EmailText>
          <Checklist items={["Connect a provider", "Send a test email", "Invite your team"]} />
          <EmailButton href="https://acme.com/dashboard">Open dashboard</EmailButton>
        </>
      );
    case "trial-ending":
      return (
        <>
          <EmailHeading>Your trial ends in 3 days</EmailHeading>
          <EmailText>
            Your Acme trial ends Friday. Your workspace and data will stay available.
          </EmailText>
          <Details
            rows={[["Current plan", "Pro trial"], ["Trial ends", "Friday, August 1"]]}
            theme={theme}
          />
          <EmailButton href="https://acme.com/plans">Choose a plan</EmailButton>
        </>
      );
    case "usage-alert":
      return (
        <>
          <EmailHeading>You’re nearing your email limit</EmailHeading>
          <EmailText>Your workspace has used 85% of its monthly email volume.</EmailText>
          <div
            style={{
              backgroundColor: progressTrack,
              borderRadius: 999,
              height: 8,
              margin: "24px 0",
              overflow: "hidden",
            }}
          >
            <div style={{ backgroundColor: progressFill, height: "100%", width: "85%" }} />
          </div>
          <Details
            rows={[["Used", "85,240 emails"], ["Plan limit", "100,000 emails"]]}
            theme={theme}
          />
          <EmailButton href="https://acme.com/usage">Review usage</EmailButton>
        </>
      );
    case "receipt":
      return (
        <>
          <EmailHeading>Payment received</EmailHeading>
          <EmailText>Thanks for your payment. Here’s a summary for order #1842.</EmailText>
          <Details
            rows={[["Acme Pro · July", "$49.00"], ["Tax", "$0.00"], ["Total", "$49.00"]]}
            strongLast
            theme={theme}
          />
          <EmailButton href="https://acme.com/receipts/1842">View receipt</EmailButton>
        </>
      );
    case "invoice-due":
      return (
        <>
          <EmailHeading>Invoice due August 1</EmailHeading>
          <EmailText>
            Invoice INV-2048 is ready and will be charged to your saved payment method.
          </EmailText>
          <Details
            rows={[["Amount due", "$249.00"], ["Due date", "August 1, 2026"]]}
            theme={theme}
          />
          <EmailButton href="https://acme.com/invoices/2048">View invoice</EmailButton>
        </>
      );
    case "refund-confirmed":
      return (
        <>
          <EmailHeading>Your refund is on its way</EmailHeading>
          <EmailText>We issued a $49.00 refund to your Visa ending in 4242.</EmailText>
          <Details
            rows={[["Refund amount", "$49.00"], ["Expected", "3–5 business days"]]}
            theme={theme}
          />
          <EmailText muted style={{ fontSize: 13, marginBottom: 0 }}>
            Your bank may take additional time to post the credit.
          </EmailText>
        </>
      );
  }
}

function Checklist({ items }: { items: string[] }) {
  return (
    <table cellPadding="0" cellSpacing="0" role="presentation" style={{ marginBottom: 20 }}>
      <tbody>
        {items.map((item) => (
          <tr key={item}>
            <td style={{ color: "#71717a", fontSize: 14, padding: "4px 8px 4px 0" }}>✓</td>
            <td style={{ color: "#3f3f46", fontSize: 14, padding: "4px 0" }}>{item}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Details({
  rows,
  strongLast = false,
  theme,
}: {
  rows: string[][];
  strongLast?: boolean;
  theme: EmailTheme;
}) {
  const foreground = theme === "dark" ? "#fafafa" : "#18181b";
  const muted = theme === "dark" ? "#a1a1aa" : "#71717a";
  const border = theme === "dark" ? "#3f3f46" : "#e4e4e7";

  return (
    <table
      cellPadding="0"
      cellSpacing="0"
      role="presentation"
      style={{ margin: "4px 0 22px", width: "100%" }}
    >
      <tbody>
        {rows.map(([label, value], index) => {
          const strong = strongLast && index === rows.length - 1;
          return (
            <tr key={label}>
              <td
                style={{
                  borderTop: strong ? `2px solid ${foreground}` : `1px solid ${border}`,
                  color: strong ? foreground : muted,
                  fontSize: strong ? 16 : 14,
                  fontWeight: strong ? 700 : 400,
                  padding: "12px 0",
                }}
              >
                {label}
              </td>
              <td
                style={{
                  borderTop: strong ? `2px solid ${foreground}` : `1px solid ${border}`,
                  color: foreground,
                  fontSize: strong ? 16 : 14,
                  fontWeight: strong ? 700 : 600,
                  padding: "12px 0",
                  textAlign: "right",
                }}
              >
                {value}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
