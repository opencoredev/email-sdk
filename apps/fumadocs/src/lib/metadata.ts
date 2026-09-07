import type { MetaDescriptor } from "@tanstack/react-router";

import { providers } from "@/lib/providers";
import { appDescription, appName, siteOgImageUrl, siteUrl } from "@/lib/shared";

// Both the FAQ answer and the ItemList below used to spell the adapters out by
// hand, so each new adapter left the structured data one provider short of the
// code. Derive them from the adapter registry instead.
const supportedProviderNames = providers.map((provider) => provider.name);
const supportedProviderSentence = new Intl.ListFormat("en", {
  style: "long",
  type: "conjunction",
}).format(supportedProviderNames);

export const siteTitle = `${appName} - Email for TypeScript apps.`;
export const siteImageAlt =
  "Email SDK: Email for TypeScript apps. Alpine background with an illustrative send example.";
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

export function buildDocsStructuredData({
  canonicalUrl,
  dateModified,
  description,
  title,
}: {
  canonicalUrl: string;
  dateModified: string;
  description: string;
  title: string;
}) {
  const breadcrumbItems = [
    {
      "@type": "ListItem",
      position: 1,
      name: appName,
      item: siteUrl,
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "Documentation",
      item: `${siteUrl}/docs`,
    },
  ];

  if (canonicalUrl !== `${siteUrl}/docs`) {
    breadcrumbItems.push({
      "@type": "ListItem",
      position: 3,
      name: title,
      item: canonicalUrl,
    });
  }

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "TechArticle",
        "@id": `${canonicalUrl}#article`,
        headline: title,
        description,
        dateModified,
        url: canonicalUrl,
        mainEntityOfPage: canonicalUrl,
        inLanguage: "en",
        author: {
          "@id": `${siteUrl}/#organization`,
        },
        publisher: {
          "@id": `${siteUrl}/#organization`,
        },
        isPartOf: {
          "@id": `${siteUrl}/#website`,
        },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${canonicalUrl}#breadcrumb`,
        itemListElement: breadcrumbItems,
      },
    ],
  };
}

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
        cssSelector: ["#landing-heading", "#landing-summary"],
      },
    },
    {
      "@type": "Service",
      "@id": `${siteUrl}/#service`,
      name: "Email SDK transactional email integration",
      serviceType: "Transactional email integration",
      description: appDescription,
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
      runtimePlatform: ["Node.js 20+", "Bun 1.1+"],
      softwareHelp: `${siteUrl}/docs`,
      codeRepository: "https://github.com/opencoredev/email-sdk",
      downloadUrl: "https://www.npmjs.com/package/@opencoredev/email-sdk",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
      featureList: [
        "Transactional email through your existing provider account",
        "23 provider API adapters plus SMTP, 24 adapters total, including Resend, Postmark, SendGrid, Mailgun, and AWS SES",
        "Message validation, no-network test adapters, and common error types",
        "Configurable fallback routes and retries",
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
            text: "Email for TypeScript apps. Email SDK is an open-source, server-side TypeScript library for sending transactional email with your existing provider account. It adds message validation, no-network test adapters, and common error types. Your provider still handles credentials, billing, and delivery.",
          },
        },
        {
          "@type": "Question",
          name: "Which email providers does Email SDK support?",
          acceptedAnswer: {
            "@type": "Answer",
            text: `Email SDK supports adapters for ${supportedProviderSentence}.`,
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
      numberOfItems: supportedProviderNames.length,
      itemListElement: supportedProviderNames.map((name, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name,
      })),
    },
  ],
} as const;
