// The site's schema.org JSON-LD. components/layout/Layout.astro emits it on
// every content page in place of Blume's graph, and pages/blog/index.astro on
// the blog index, so pages keep the types the Fumadocs site served: FAQPage
// beside a visible FAQ, a BreadcrumbList under each section, a WebApplication
// for each tool, and collection types for the /compare and /blog indexes.
import { buildAdapterFaq, getAdapterSupportEntry } from "./adapter-faq";
import { comparePairs, getComparePair, getComparePairTitle } from "./compare";
import { buildCompareFaq } from "./compare-page";
import { appName, siteUrl } from "./shared";

export type JsonLdValue = string | number | JsonLdValue[] | JsonLdNode;

export interface JsonLdNode {
  [key: string]: JsonLdValue;
}

/** The organization behind the site; blume.config.ts reads it too. */
export const siteOrganization = {
  name: "OpenCore",
  url: "https://github.com/opencoredev",
  logo: "/logo.png",
  sameAs: ["https://github.com/opencoredev", "https://www.npmjs.com/org/opencoredev"],
};

const organizationId = `${siteUrl}#organization`;

const websiteId = `${siteUrl}#website`;

// The navigation tabs in blume.config.ts: each section's breadcrumb label.
const sectionLabels = new Map([
  ["/docs", "Docs"],
  ["/compare", "Compare"],
  ["/blog", "Blog"],
  ["/tools", "Tools"],
]);

const identityNodes: JsonLdNode[] = [
  {
    "@id": websiteId,
    "@type": "WebSite",
    name: appName,
    url: siteUrl,
    publisher: { "@id": organizationId },
  },
  {
    "@id": organizationId,
    "@type": "Organization",
    name: siteOrganization.name,
    url: siteOrganization.url,
    logo: `${siteUrl}${siteOrganization.logo}`,
    sameAs: siteOrganization.sameAs,
  },
];

export type PageStructuredDataInput = {
  route: string;
  title: string;
  description?: string;
  /** Blume's lastModified prop: an ISO date string, or null when unknown. */
  modified?: string | null;
  /** Front matter `date`, as a string or a YAML date. */
  published?: string | Date | null;
  /** Front matter `type`; `blog` marks a post. */
  pageType?: string;
  image?: string | null;
  /** Each route's page title, for the breadcrumb names of parent pages. */
  routeTitles: ReadonlyMap<string, string>;
};

export type BlogListing = {
  title: string;
  description: string;
  href: string;
  date: Date;
  image: string;
};

function isoDate(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined;

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function breadcrumbNode(url: string, trail: readonly { name: string; path: string }[]): JsonLdNode {
  return {
    "@id": `${url}#breadcrumb`,
    "@type": "BreadcrumbList",
    itemListElement: [{ name: appName, path: "/" }, ...trail].map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: crumb.path === "/" ? siteUrl : `${siteUrl}${crumb.path}`,
    })),
  };
}

/** The parent pages between the site root and a route, each a real page. */
function parentCrumbs(route: string, routeTitles: ReadonlyMap<string, string>) {
  const segments = route.split("/").slice(1, -1);

  return segments.flatMap((_, index) => {
    const path = `/${segments.slice(0, index + 1).join("/")}`;
    const name = sectionLabels.get(path) ?? routeTitles.get(path);

    return name ? [{ name, path }] : [];
  });
}

/** The question-and-answer pairs a page shows in its FAQ section. */
function visibleFaq(route: string): { question: string; answer: string }[] {
  const comparePair = route.startsWith("/compare/")
    ? getComparePair(route.slice("/compare/".length))
    : undefined;

  if (comparePair) return buildCompareFaq(comparePair);

  const adapter = route.startsWith("/docs/adapters/")
    ? getAdapterSupportEntry(`adapters/${route.slice("/docs/adapters/".length)}.mdx`)
    : undefined;

  return adapter ? buildAdapterFaq(adapter) : [];
}

function faqNode(url: string, faq: readonly { question: string; answer: string }[]): JsonLdNode {
  return {
    "@id": `${url}#faq`,
    "@type": "FAQPage",
    mainEntity: faq.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
}

function pageNodes(input: PageStructuredDataInput, url: string): JsonLdNode[] {
  const node: JsonLdNode = {
    "@id": `${url}#page`,
    "@type": "TechArticle",
    name: input.title,
    url,
    inLanguage: "en",
    isPartOf: { "@id": websiteId },
    publisher: { "@id": organizationId },
  };

  if (input.description) node.description = input.description;

  if (input.image) node.image = input.image;

  const modified = isoDate(input.modified);

  if (modified) node.dateModified = modified;

  if (input.route.startsWith("/tools/")) {
    return [
      {
        ...node,
        "@type": "WebApplication",
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Any",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      },
    ];
  }

  if (input.route === "/compare") {
    return [
      { ...node, "@type": "CollectionPage", mainEntity: { "@id": `${url}#comparisons` } },
      {
        "@id": `${url}#comparisons`,
        "@type": "ItemList",
        name: "Head-to-head provider comparisons",
        numberOfItems: comparePairs.length,
        itemListElement: comparePairs.map((pair, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: getComparePairTitle(pair),
          url: `${siteUrl}/compare/${pair.slug}`,
        })),
      },
    ];
  }

  const published = isoDate(input.published);

  if (published) node.datePublished = published;

  return [
    {
      ...node,
      "@type": input.pageType === "blog" ? "BlogPosting" : "TechArticle",
      headline: input.title,
      author: { "@id": organizationId },
    },
  ];
}

/** The JSON-LD graph for a content page: identity, the page, its breadcrumbs, and its FAQ. */
export function buildPageStructuredData(input: PageStructuredDataInput): JsonLdNode {
  const url = `${siteUrl}${input.route}`;
  const faq = visibleFaq(input.route);

  const trail = [...parentCrumbs(input.route, input.routeTitles), { name: input.title, path: input.route }];

  return {
    "@context": "https://schema.org",
    "@graph": [
      ...identityNodes,
      ...pageNodes(input, url),
      breadcrumbNode(url, trail),
      ...(faq.length > 0 ? [faqNode(url, faq)] : []),
    ],
  };
}

/** The JSON-LD graph for the /blog index: a Blog with its posts, as a list too. */
export function buildBlogIndexStructuredData(
  posts: readonly BlogListing[],
  description: string,
): JsonLdNode {
  const url = `${siteUrl}/blog`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      ...identityNodes,
      {
        "@id": `${url}#blog`,
        "@type": "Blog",
        name: `${appName} Blog`,
        url,
        description,
        inLanguage: "en",
        isPartOf: { "@id": websiteId },
        publisher: { "@id": organizationId },
        blogPost: posts.map((post) => ({
          "@type": "BlogPosting",
          headline: post.title,
          description: post.description,
          datePublished: post.date.toISOString(),
          url: `${siteUrl}${post.href}`,
          image: `${siteUrl}${post.image}`,
        })),
      },
      {
        "@id": `${url}#posts`,
        "@type": "ItemList",
        name: `${appName} Blog posts`,
        numberOfItems: posts.length,
        itemListElement: posts.map((post, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: post.title,
          url: `${siteUrl}${post.href}`,
        })),
      },
      breadcrumbNode(url, [{ name: "Blog", path: "/blog" }]),
    ],
  };
}

/** JSON for an inline <script>: `<` escaped so content can't close the tag. */
export function serializeJsonLd(graph: JsonLdNode): string {
  return JSON.stringify(graph).replaceAll("<", "\\u003c");
}
