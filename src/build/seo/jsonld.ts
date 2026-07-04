import { site } from "../config";
import type { Article } from "../content";

const PERSON_ID = `${site.url}/about/#person`;

export function websiteJsonLd(): object {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: site.fullTitle,
    url: `${site.url}/`,
    description: site.description,
    inLanguage: site.locale,
    author: { "@id": PERSON_ID },
  };
}

export function personJsonLd(): object {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": PERSON_ID,
    name: site.author,
    url: `${site.url}/about/`,
    sameAs: [
      site.github,
      ...(site.linkedin ? [site.linkedin] : []),
      ...(site.x ? [site.x] : []),
    ],
    jobTitle: "Software & Systems Engineer",
    alumniOf: {
      "@type": "CollegeOrUniversity",
      name: "Universitat Politècnica de Catalunya",
      url: "https://www.upc.edu/",
    },
  };
}

export function blogPostingJsonLd(article: Article, ogImage?: string): object {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: article.fm.title,
    description: article.fm.description,
    url: site.url + article.url,
    datePublished: article.fm.date.toISOString(),
    dateModified: (article.fm.updated ?? article.fm.date).toISOString(),
    inLanguage: site.locale,
    author: {
      "@type": "Person",
      "@id": PERSON_ID,
      name: site.author,
      url: `${site.url}/about/`,
    },
    publisher: { "@type": "Person", "@id": PERSON_ID, name: site.author },
    keywords: article.fm.tags.join(", "),
    wordCount: article.plainText.split(/\s+/).length,
    ...(ogImage ? { image: site.url + ogImage } : {}),
    mainEntityOfPage: { "@type": "WebPage", "@id": site.url + article.url },
  };
}

export interface Crumb {
  name: string;
  path: string;
}

/** BreadcrumbList; a Home item is prepended automatically. */
export function breadcrumbJsonLd(crumbs: Crumb[]): object {
  const items = [{ name: "Home", path: "/" }, ...crumbs];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((entry, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: entry.name,
      item: site.url + entry.path,
    })),
  };
}

/** Crumbs for an article (Articles -> [series] -> title). */
export function articleCrumbs(article: Article): Crumb[] {
  return [
    { name: "Articles", path: "/articles/" },
    ...(article.series
      ? [{ name: article.series.meta.title, path: `/projects/#${article.series.meta.slug}` }]
      : []),
    { name: article.fm.title, path: article.url },
  ];
}
