// Shared blog post shape. Kept in its own module so the generated Notra data
// file and the blog helpers can both depend on the type without an import cycle.
export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  updatedAt: string;
  readTime: string;
  image: string;
  imageAlt: string;
  tags: string[];
};
