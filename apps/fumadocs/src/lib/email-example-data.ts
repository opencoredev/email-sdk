// The rendered previews are client components (email-examples.tsx); the catalog
// data lives here so markdown mirrors (src/lib/markdown-components.ts) can emit
// subject/preview metadata without importing client code.
export const emailExampleCategories = [
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

export const emailExamples = {
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

export type EmailExampleId = keyof typeof emailExamples;
