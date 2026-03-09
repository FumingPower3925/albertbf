#!/usr/bin/env bun

import { marked } from 'marked';
import hljs from 'highlight.js';
import yaml from 'js-yaml';
import { readdir, readFile, writeFile, mkdir, stat, cp } from 'fs/promises';
import { join, dirname, basename, extname } from 'path';

const ARTICLES_DIR = './articles';
const TEMPLATES_DIR = './templates';
const DIST_DIR = './dist';
const STYLES_PATH = './src/styles.css';
const IMAGES_DIR = './src/images';

const SUPPORTED_LANGUAGES = hljs.listLanguages();

let currentArticleLanguages = new Set();
let currentArticleForRenderer = null;

const renderer = new marked.Renderer();

renderer.code = function(code) {
  const language = code.lang;
  if (language && SUPPORTED_LANGUAGES.includes(language)) {
    currentArticleLanguages.add(language);

    if (hljs.getLanguage(language)) {
      try {
        const result = hljs.highlight(code.text, { language: language });
        return `<div class="code-block-wrapper">
          <pre data-language="${language}"><code class="hljs language-${language}">${result.value}</code></pre>
          <button class="code-copy-btn" data-code="${escapeHtml(code)}" aria-label="Copy code">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span class="copy-text">Copy</span>
          </button>
        </div>`;
      } catch (err) {
        console.warn(`Warning: Error highlighting ${language}:`, err.message);
      }
    }
  }

  const escapedCode = escapeHtml(code);
  return `<div class="code-block-wrapper">
    <pre data-language="${language || 'text'}"><code class="language-${language || ''}">${escapedCode}</code></pre>
    <button class="code-copy-btn" data-code="${escapeHtml(code)}" aria-label="Copy code">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      <span class="copy-text">Copy</span>
    </button>
  </div>`;
};

renderer.image = function(href, title, text) {
  if (currentArticleForRenderer && !/^(https?:)?\/\//.test(href)) {
    const imageName = href.startsWith('./') ? href.substring(2) : href;
    const finalPath = join(currentArticleForRenderer.url, imageName);
    return `<img src="${finalPath}" alt="${text}"${title ? ` title="${title}"` : ''}>`;
  }
  return new marked.Renderer().image(href, title, text);
};

function escapeHtml(str) {
  if (typeof str !== 'string') {
    str = str.text;
  }
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateEuro(dateObj) {
  const day = String(dateObj.getDate()).padStart(2, '0');
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const year = dateObj.getFullYear();
  return `${day}-${month}-${year}`;
}

marked.use({ renderer });

class Article {
  constructor(content, frontmatter, filePath) {
    this.content = content;
    this.title = frontmatter.title || 'Untitled';

    let dateInput = frontmatter.date || Date.now();
    if (typeof dateInput === 'string' && /^\d{2}-\d{2}-\d{4}$/.test(dateInput)) {
      const [day, month, year] = dateInput.split('-');
      this.date = new Date(year, month - 1, day);
    } else {
      this.date = new Date(dateInput);
    }

    this.description = frontmatter.description || '';
    this.tags = frontmatter.tags || [];
    this.filePath = filePath;
    this.languages = new Set();
    this.images = [];

    const pathParts = filePath.split('/');
    this.isProject = pathParts.includes('projects');
    this.projectName = this.isProject ? pathParts[pathParts.indexOf('projects') + 1] : null;

    const fileName = basename(filePath, '.md');
    if (this.isProject) {
      this.url = `/articles/projects/${this.projectName}/${fileName}`;
    } else {
      const year = this.date.getFullYear();
      this.url = `/articles/${year}/${fileName}`;
    }

    this.projectUrl = frontmatter['project-url'] || frontmatter['project_url'] || '';
    this.urls = frontmatter.urls || [];

    let archiveDateInput = frontmatter['archive-date'] || frontmatter['archive_date'] || null;
    if (archiveDateInput && typeof archiveDateInput === 'string' && /^\d{2}-\d{2}-\d{4}$/.test(archiveDateInput)) {
      const [day, month, year] = archiveDateInput.split('-');
      this.archiveDate = new Date(year, month - 1, day);
    } else {
      this.archiveDate = null;
    }
    this.isArchived = false;
    if (this.projectUrl && this.urls.length === 0) {
      this.urls.push({ label: 'Project URL', url: this.projectUrl });
    }

    this.related = [];
    this.prevArticle = null;
    this.nextArticle = null;
    this.seriesIndex = 0;
    this.seriesTotal = 0;

    const wordCount = this.content.split(/\s+/).filter(Boolean).length;
    this.readTime = Math.ceil(wordCount / 200);
  }
}

function buildArticleSeries(articles) {
  const projectGroups = new Map();
  for (const article of articles) {
    if (article.isProject && article.projectName) {
      if (!projectGroups.has(article.projectName)) {
        projectGroups.set(article.projectName, []);
      }
      projectGroups.get(article.projectName).push(article);
    }
  }

  for (const [, group] of projectGroups) {
    if (group.length < 2) continue;

    group.sort((a, b) => a.date - b.date);

    for (let i = 0; i < group.length; i++) {
      group[i].seriesIndex = i + 1;
      group[i].seriesTotal = group.length;
      group[i].prevArticle = i > 0 ? group[i - 1] : null;
      group[i].nextArticle = i < group.length - 1 ? group[i + 1] : null;
      group[i].related = group.filter((_, j) => j !== i);
    }
  }
}

async function parseMarkdownFile(filePath) {
  const content = await readFile(filePath, 'utf-8');

  const frontmatterRegex = /^---\s*\n(.*?)\n---\s*\n(.*)/s;
  const match = content.match(frontmatterRegex);

  if (!match) {
    throw new Error(`No frontmatter found in ${filePath}`);
  }

  const frontmatter = yaml.load(match[1]);
  const markdownContent = match[2];

  const article = new Article(markdownContent, frontmatter, filePath);

  const imageRegex = /!\[.*?\]\((?!https?:\/\/)(.*?)\)/g;
  let imageMatch;
  while ((imageMatch = imageRegex.exec(markdownContent)) !== null) {
    article.images.push(imageMatch[1]);
  }

  currentArticleLanguages.clear();

  currentArticleForRenderer = article;
  marked.parse(article.content);
  currentArticleForRenderer = null;

  article.languages = new Set(currentArticleLanguages);

  return article;
}

async function findMarkdownFiles(dir, files = []) {
  const entries = await readdir(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = await stat(fullPath);

    if (stats.isDirectory()) {
      await findMarkdownFiles(fullPath, files);
    } else if (entry.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

async function loadTemplates() {
  const templates = {};
  const templateFiles = ['layout.html', 'index.html', 'article.html', 'projects.html', '404.html'];

  for (const file of templateFiles) {
    const name = basename(file, '.html');
    templates[name] = await readFile(join(TEMPLATES_DIR, file), 'utf-8');
  }

  return templates;
}

function renderTemplate(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return data[key] || '';
  });
}

function generateArticleHTML(article, templates, styles) {
  const formattedDate = formatDateEuro(article.date);

  currentArticleForRenderer = article;
  const htmlContent = marked.parse(article.content);
  currentArticleForRenderer = null;

  const projectBadge = article.projectName
    ? `<span class="project-badge">${article.projectName}</span>`
    : '';

  const archivedBadge = article.isArchived
    ? `<span class="archived-badge">Archived</span>`
    : '';

  const archivedBanner = article.isArchived
    ? `<div class="archived-banner">This article has been archived. The content may be outdated.</div>`
    : '';

  const tagsBlock = article.tags.length > 0
    ? `<div class="tags-container">${article.tags.map(tag => `<span class="tag-badge">${tag}</span>`).join('')}</div>`
    : '';

  const descriptionBlock = article.description
    ? `<div class="article-lead"><p>${article.description}</p></div>`
    : '';

  const externalLinkIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;

  const urlsBlockTop = article.urls.length > 0
    ? `<div class="article-urls">${article.urls.map(u => `<a href="${u.url}" class="article-url" target="_blank" rel="noopener noreferrer">${externalLinkIcon}<span>${u.label}</span></a>`).join('')}</div>`
    : '';

  const urlsBlockBottom = article.urls.length > 0
    ? `<div class="article-urls">${article.urls.map(u => `<a href="${u.url}" class="article-url" target="_blank" rel="noopener noreferrer">${externalLinkIcon}<span>${u.label}</span></a>`).join('')}</div>`
    : '';

  let seriesNav = '';
  if (article.seriesTotal > 1) {
    const prevLink = article.prevArticle
      ? `<a href="${article.prevArticle.url}" class="series-link series-link--prev">← ${article.prevArticle.title}</a>`
      : `<div></div>`;
    const nextLink = article.nextArticle
      ? `<a href="${article.nextArticle.url}" class="series-link series-link--next">${article.nextArticle.title} →</a>`
      : `<div></div>`;
    seriesNav = `<nav class="series-nav"><div class="series-indicator">Part ${article.seriesIndex} of ${article.seriesTotal} in <strong>${article.projectName}</strong></div><div class="series-links">${prevLink}${nextLink}</div></nav>`;
  }

  let relatedArticles = '';
  if (article.related.length > 0) {
    const relatedList = article.related.map(r => {
      const relDate = formatDateEuro(r.date);
      return `<li><a href="${r.url}">${r.title}</a><span class="related-meta">${relDate} · ${r.readTime} min read</span></li>`;
    }).join('');
    relatedArticles = `<section class="related-articles"><h3>More in ${article.projectName}</h3><ul>${relatedList}</ul></section>`;
  }

  const articleContent = renderTemplate(templates.article, {
    title: article.title,
    content: htmlContent,
    date: formattedDate,
    readTime: `${article.readTime} min read`,
    projectBadge: projectBadge,
    archivedBadge: archivedBadge,
    archivedBanner: archivedBanner,
    tagsBlock: tagsBlock,
    descriptionBlock: descriptionBlock,
    urlsBlockTop: urlsBlockTop,
    urlsBlockBottom: urlsBlockBottom,
    seriesNav: seriesNav,
    relatedArticles: relatedArticles
  });

  return renderTemplate(templates.layout, {
    title: article.title,
    description: article.description,
    content: articleContent,
    styles: styles
  });
}

function generateIndexHTML(articles, templates, styles) {
  const sortedArticles = articles.sort((a, b) => b.date - a.date);

  const articlesList = sortedArticles.map(article => {
    const formattedDate = formatDateEuro(article.date);

    const readTime = `${article.readTime} min read`;

    const projectBadge = article.isProject
      ? `<span class="project-badge">${article.projectName}</span>`
      : '';

    const archivedBadge = article.isArchived
      ? `<span class="archived-badge">Archived</span>`
      : '';

    const tagsList = article.tags.length > 0
      ? `<div class="tags-container">${article.tags.map(tag => `<span class="tag-badge">${tag}</span>`).join('')}</div>`
      : '';

    const cleanContent = article.content
      .replace(/```[\s\S]*?```/g, '')
      .replace(/!\[.*?\]\(.*?\)/g, '')
      .replace(/`[^`]*`/g, '')
      .replace(/#{1,6}\s+/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[>\-\*\+]/g, '')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 100);

    const escapeAttr = (str) => str ? str.replace(/"/g, '&quot;') : '';

    return `
      <article class="article-card${article.isArchived ? ' article-card--archived' : ''}"
               data-title="${escapeAttr(article.title.toLowerCase())}"
               data-content="${escapeAttr(cleanContent.toLowerCase())}"
               data-project="${escapeAttr(article.projectName || '')}"
               data-tags="${escapeAttr(article.tags.join(' ').toLowerCase())}">
        <div class="article-meta">
          <time datetime="${article.date.toISOString()}">${formattedDate}</time>
          <span class="meta-separator">·</span>
          <span class="read-time">${readTime}</span>
          ${projectBadge}
          ${archivedBadge}
        </div>
        <h2><a href="${article.url}">${article.title}</a></h2>
        <p class="article-description">${article.description}</p>
        ${tagsList}
      </article>
    `;
  }).join('');

  const indexContent = renderTemplate(templates.index, { articles: articlesList });

  return renderTemplate(templates.layout, {
    title: 'Albert BF\'s Blog',
    description: 'My personal minimalist technical blog',
    content: indexContent,
    styles: styles
  });
}

function generateProjectsHTML(articles, templates, styles) {
  const projectArticles = articles.filter(a => a.isProject);
  const projectsMap = new Map();

  projectArticles.forEach(article => {
    if (!projectsMap.has(article.projectName)) {
      projectsMap.set(article.projectName, []);
    }
    projectsMap.get(article.projectName).push(article);
  });

  for (const [, articles] of projectsMap) {
    articles.sort((a, b) => b.date - a.date);
  }

  const projectsList = Array.from(projectsMap.entries()).map(([projectName, articles]) => {
    const articlesList = articles.map(article => {
      const formattedDate = formatDateEuro(article.date);
      const readTime = `${article.readTime} min read`;

      return `
        <li class="project-article">
          <a href="${article.url}">${article.title}</a>
          <div class="project-article-meta">
            <time datetime="${article.date.toISOString()}">${formattedDate}</time>
            <span class="meta-separator">·</span>
            <span class="read-time">${readTime}</span>
          </div>
        </li>
      `;
    }).join('');

    return `
      <div class="project-section minimal-card">
        <h2>${projectName}</h2>
        <ul class="project-articles">
          ${articlesList}
        </ul>
      </div>
    `;
  }).join('');

  const projectsContent = renderTemplate(templates.projects, { projects: projectsList });

  return renderTemplate(templates.layout, {
    title: 'Albert BF\'s Projects',
    description: 'A collection of my projects and their related articles',
    content: projectsContent,
    styles: styles
  });
}

function generate404HTML(templates, styles) {
  const content = templates['404'];
  return renderTemplate(templates.layout, {
    title: '404 - Not Found',
    description: 'The page you were looking for could not be found.',
    content: content,
    styles: styles
  });
}

function generateSearchIndex(articles) {
  return articles.map(article => ({
    title: article.title,
    description: article.description,
    url: article.url,
    date: article.date.toISOString(),
    readTime: article.readTime,
    projectName: article.projectName,
    isArchived: article.isArchived || false,
    content: article.content.replace(/```[\s\S]*?```/g, '').replace(/!\[.*?\]\(.*?\)/g, '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().substring(0, 300),
    languages: Array.from(article.languages || []),
    tags: article.tags || []
  }));
}

function generateRSSFeed(articles) {
  const siteUrl = 'https://albertbf.com';
  const sortedArticles = [...articles].sort((a, b) => b.date - a.date).slice(0, 20);

  const escapeXml = (str) => str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  const items = sortedArticles.map(article => `    <item>
      <title>${escapeXml(article.title)}</title>
      <link>${siteUrl}${article.url}</link>
      <guid>${siteUrl}${article.url}</guid>
      <pubDate>${article.date.toUTCString()}</pubDate>
      <description>${escapeXml(article.description)}</description>
    </item>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Albert BF's Blog</title>
    <link>${siteUrl}</link>
    <description>My personal minimalist technical blog</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${siteUrl}/feed.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;
}

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

async function build() {
  console.log('🚀 Starting build process...');

  try {
    await ensureDir(DIST_DIR);

    const styles = await readFile(STYLES_PATH, 'utf-8');
    const templates = await loadTemplates();

    console.log('📚 Parsing markdown files...');
    const markdownFiles = await findMarkdownFiles(ARTICLES_DIR);
    const articles = await Promise.all(markdownFiles.map(async file => {
      try {
        const article = await parseMarkdownFile(file);
        const languageInfo = article.languages.size > 0
          ? ` (languages: ${Array.from(article.languages).join(', ')})`
          : '';
        console.log(`✅ Parsed: ${article.title} (~${article.readTime} min read)${languageInfo}`);
        return article;
      } catch (err) {
        console.error(`❌ Error parsing ${file}:`, err.message);
        process.exit(1);
      }
    }));

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    const publishedArticles = articles.filter(article => {
      const articleDate = new Date(article.date);
      articleDate.setHours(0, 0, 0, 0);
      
      if (articleDate > now) {
        console.log(`⏭️  Skipped (scheduled for future): ${article.title} (${formatDateEuro(article.date)})`);
        return false;
      }
      return true;
    });

    let archivedCount = 0;
    for (const article of publishedArticles) {
      if (article.archiveDate) {
        const archiveDate = new Date(article.archiveDate);
        archiveDate.setHours(0, 0, 0, 0);
        if (archiveDate <= now) {
          article.isArchived = true;
          archivedCount++;
          console.log(`📦 Archived: ${article.title} (archived ${formatDateEuro(article.archiveDate)})`);
        }
      }
    }

    const scheduledCount = articles.length - publishedArticles.length;
    console.log(`📖 Found ${articles.length} articles (${publishedArticles.length} published${scheduledCount > 0 ? `, ${scheduledCount} scheduled` : ''}${archivedCount > 0 ? `, ${archivedCount} archived` : ''})`);

    buildArticleSeries(publishedArticles);

    console.log('📝 Generating article pages and copying images...');
    for (const article of publishedArticles) {
      const articleHTML = generateArticleHTML(article, templates, styles);
      const outputPath = join(DIST_DIR, article.url.substring(1), 'index.html');

      await ensureDir(dirname(outputPath));
      await writeFile(outputPath, articleHTML);

      const articleSrcDir = dirname(article.filePath);
      for (const imagePath of article.images) {
        const srcImagePath = join(articleSrcDir, imagePath);
        const destImagePath = join(dirname(outputPath), basename(imagePath));
        try {
          await cp(srcImagePath, destImagePath);
        } catch (err) {
          console.error(`❌ Error copying image ${srcImagePath}:`, err.message);
        }
      }
    }

    console.log('🏠 Generating index page...');
    const indexHTML = generateIndexHTML(publishedArticles, templates, styles);
    await writeFile(join(DIST_DIR, 'index.html'), indexHTML);

    console.log('🗂️ Generating projects page...');
    const projectsHTML = generateProjectsHTML(publishedArticles, templates, styles);
    await ensureDir(join(DIST_DIR, 'projects'));
    await writeFile(join(DIST_DIR, 'projects', 'index.html'), projectsHTML);

    console.log('🖼️ Copying general images...');
    try {
        const destImagesDir = join(DIST_DIR, 'images');
        await ensureDir(destImagesDir);
        await cp(IMAGES_DIR, destImagesDir, { recursive: true });
        console.log(`✅ Copied general images to ${destImagesDir}`);
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.error('❌ Error copying general images:', err);
        }
    }

    console.log('🔍 Generating search index...');
    const searchIndex = generateSearchIndex(publishedArticles);
    await writeFile(join(DIST_DIR, 'search-index.json'), JSON.stringify(searchIndex, null, 2));

    console.log('📡 Generating RSS feed...');
    const rssFeed = generateRSSFeed(publishedArticles);
    await writeFile(join(DIST_DIR, 'feed.xml'), rssFeed);

    console.log('📄 Generating 404 page...');
    const notFoundHTML = generate404HTML(templates, styles);
    await writeFile(join(DIST_DIR, '404.html'), notFoundHTML);

    console.log('✨ Build completed successfully!');

  } catch (err) {
    console.error('❌ Build failed:', err);
    process.exit(1);
  }
}

if (import.meta.main) {
  build();
}