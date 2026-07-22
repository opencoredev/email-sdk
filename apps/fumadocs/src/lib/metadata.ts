import type { MetaDescriptor } from "@tanstack/react-router";

import { appDescription, appName, siteOgImageUrl, siteUrl } from "@/lib/shared";

export const siteTitle = `${appName} - TypeScript email SDK for every provider`;
export const siteImageAlt = "Email SDK unified email sending preview";
export const siteKeywords =
  "email SDK, TypeScript email SDK, transactional email SDK, unified email API, Resend SDK, SendGrid SDK, Postmark SDK, Mailgun SDK, Unosend SDK, AWS SES SDK, Cloudflare Email Sending SDK, SMTP TypeScript";

export const siteMeta = [
  {
    charSet: "utf-8",
  },
  {
    name: "viewport",
    content: "width=device-width, initial-scale=1",
  },
  {
    title: siteTitle,
  },
  {
    name: "description",
    content: appDescription,
  },
  {
    name: "keywords",
    content: siteKeywords,
  },
  {
    property: "og:type",
    content: "website",
  },
  {
    property: "og:title",
    content: siteTitle,
  },
  {
    property: "og:url",
    content: siteUrl,
  },
  {
    property: "og:description",
    content: appDescription,
  },
  {
    property: "og:image",
    content: siteOgImageUrl,
  },
  {
    property: "og:image:alt",
    content: siteImageAlt,
  },
  {
    property: "og:image:width",
    content: "1200",
  },
  {
    property: "og:image:height",
    content: "630",
  },
  {
    name: "twitter:card",
    content: "summary_large_image",
  },
  {
    name: "twitter:title",
    content: siteTitle,
  },
  {
    name: "twitter:description",
    content: appDescription,
  },
  {
    name: "twitter:image",
    content: siteOgImageUrl,
  },
  {
    name: "twitter:image:alt",
    content: siteImageAlt,
  },
  {
    name: "robots",
    content: "index, follow",
  },
] satisfies MetaDescriptor[];

export const homeStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
      name: "OpenCore",
      url: "https://opencore.dev",
      logo: `${siteUrl}/logo.png`,
      // sameAs links let agents disambiguate the brand against real, verifiable profiles.
      sameAs: [
        "https://github.com/opencoredev",
        "https://github.com/opencoredev/email-sdk",
        "https://www.npmjs.com/package/@opencoredev/email-sdk",
      ],
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "technical support",
        url: "https://github.com/opencoredev/email-sdk/issues",
        availableLanguage: "English",
      },
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      name: appName,
      url: siteUrl,
      description: appDescription,
      inLanguage: "en",
      publisher: {
        "@id": `${siteUrl}/#organization`,
      },
    },
    {
      "@type": "WebPage",
      "@id": `${siteUrl}/#webpage`,
      url: siteUrl,
      name: siteTitle,
      description: appDescription,
      inLanguage: "en",
      isPartOf: {
        "@id": `${siteUrl}/#website`,
      },
      about: {
        "@id": `${siteUrl}/#software`,
      },
      primaryImageOfPage: siteOgImageUrl,
      // Tells assistants which sections of the homepage are suitable for
      // text-to-speech readout (the hero heading and one-line summary).
      speakable: {
        "@type": "SpeakableSpecification",
        cssSelector: ["#hero-heading", "#hero-summary"],
      },
    },
    {
      "@type": "Service",
      "@id": `${siteUrl}/#service`,
      name: "Email SDK transactional email integration",
      serviceType: "Transactional email integration",
      description:
        "Send transactional email through 22 provider APIs plus SMTP behind one typed TypeScript client, with retries and compatible fallbacks.",
      provider: {
        "@id": `${siteUrl}/#organization`,
      },
      areaServed: "Worldwide",
      url: `${siteUrl}/docs`,
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${siteUrl}/#software`,
      name: appName,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Any",
      url: siteUrl,
      image: siteOgImageUrl,
      description: appDescription,
      programmingLanguage: "TypeScript",
      runtimePlatform: ["Node.js", "Bun", "JavaScript"],
      softwareHelp: `${siteUrl}/docs`,
      codeRepository: "https://github.com/opencoredev/email-sdk",
      downloadUrl: "https://www.npmjs.com/package/@opencoredev/email-sdk",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
      featureList: [
        "Unified transactional email sending",
        "Provider adapters for Resend, SMTP, Postmark, SendGrid, Mailgun, Unosend, AWS SES, and more",
        "Fallback routes and retries",
        "Plugins for defaults, observability, capture, and community adapters",
        "CLI for local checks and smoke-test sends",
      ],
    },
    {
      "@type": "FAQPage",
      "@id": `${siteUrl}/#faq`,
      mainEntity: [
        {
          "@type": "Question",
          name: "What is Email SDK?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Email SDK is a TypeScript email SDK that gives applications one typed client and one message shape for sending transactional email through providers such as Resend, SMTP, Postmark, SendGrid, Mailgun, Unosend, Cloudflare, and AWS SES.",
          },
        },
        {
          "@type": "Question",
          name: "Which email providers does Email SDK support?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Email SDK supports adapters for Resend, SMTP, Postmark, SendGrid, Mailgun, Cloudflare Email Sending, Unosend, AWS SES, MailerSend, Brevo, Mailchimp Transactional, SparkPost, Iterable, Loops, Sequenzy, JetEmail, Primitive, Lettermint, Plunk, Mailtrap, Scaleway, ZeptoMail, and MailPace.",
          },
        },
        {
          "@type": "Question",
          name: "How do you install Email SDK?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Install the npm package with npm install @opencoredev/email-sdk. The package includes the email-sdk CLI binary for local adapter checks and smoke-test sends.",
          },
        },
      ],
    },
    {
      // Machine-readable enumeration of supported providers so agents can resolve
      // "does Email SDK support <provider>?" without parsing prose.
      "@type": "ItemList",
      "@id": `${siteUrl}/#supported-providers`,
      name: "Email providers supported by Email SDK",
      itemListElement: [
        "Resend",
        "SMTP",
        "Postmark",
        "SendGrid",
        "Mailgun",
        "Cloudflare Email Sending",
        "Unosend",
        "AWS SES",
        "MailerSend",
        "Brevo",
        "Mailchimp Transactional",
        "SparkPost",
        "Iterable",
        "Loops",
        "Sequenzy",
        "JetEmail",
        "Primitive",
        "Lettermint",
        "Plunk",
        "Mailtrap",
        "Scaleway",
        "ZeptoMail",
        "MailPace",
      ].map((name, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name,
      })),
    },
  ],
} as const;
