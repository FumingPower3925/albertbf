import { site } from "../config";
import type { Article } from "../content";

export function websiteJsonLd(): object {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: site.fullTitle,
    url: site.url,
    description: site.description,
    author: { "@id": `${site.url}/about/#person` },
  };
}

export function personJsonLd(): object {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": `${site.url}/about/#person`,
    name: site.author,
    url: `${site.url}/about/`,
    sameAs: [site.github, ...(site.linkedin ? [site.linkedin] : [])],
    jobTitle: "Software Engineer",
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
    author: {
      "@type": "Person",
      "@id": `${site.url}/about/#person`,
      name: site.author,
      url: `${site.url}/about/`,
    },
    keywords: article.fm.tags.join(", "),
    wordCount: article.plainText.split(/\s+/).length,
    ...(ogImage ? { image: site.url + ogImage } : {}),
    mainEntityOfPage: { "@type": "WebPage", "@id": site.url + article.url },
  };
}

export function breadcrumbJsonLd(article: Article): object {
  const items = [
    { name: "Articles", item: `${site.url}/articles/` },
    ...(article.series ? [{ name: article.series.meta.title, item: `${site.url}/projects/#${article.series.meta.slug}` }] : []),
    { name: article.fm.title, item: site.url + article.url },
  ];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((entry, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: entry.name,
      item: entry.item,
    })),
  };
}
