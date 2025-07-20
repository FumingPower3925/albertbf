#!/usr/bin/env bun

import { marked } from 'marked';
import hljs from 'highlight.js';
import yaml from 'js-yaml';
import { readdir, readFile, writeFile, mkdir, stat } from 'fs/promises';
import { join, dirname, basename, extname } from 'path';

const ARTICLES_DIR = './articles';
const TEMPLATES_DIR = './templates';
const DIST_DIR = './dist';
const STYLES_PATH = './src/styles.css';

// Supported languages for highlighting
const SUPPORTED_LANGUAGES = ['javascript', 'go', 'typescript', 'bash', 'yaml', 'json', 'html', 'css'];

// Track languages used in current article
let currentArticleLanguages = new Set();

// Configure marked with highlight.js using custom renderer
const renderer = new marked.Renderer();

renderer.code = function(code, language) {
  if (language && SUPPORTED_LANGUAGES.includes(language)) {
    currentArticleLanguages.add(language);
    
    if (hljs.getLanguage(language)) {
      try {
        const result = hljs.highlight(code, { language: language });
        // Add wrapper div with copy button
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
  
  // Return escaped code if no highlighting applied
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

// Helper function to escape HTML
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Apply the custom renderer
marked.use({ renderer });

// Article data structure
class Article {
  constructor(content, frontmatter, filePath) {
    this.content = content;
    this.title = frontmatter.title || 'Untitled';
    this.date = new Date(frontmatter.date || Date.now());
    this.description = frontmatter.description || '';
    this.tags = frontmatter.tags || [];
    this.filePath = filePath;
    this.languages = new Set();
    
    // Determine if this is a project article
    const pathParts = filePath.split('/');
    this.isProject = pathParts.includes('projects');
    this.projectName = this.isProject ? pathParts[pathParts.indexOf('projects') + 1] : null;
    
    // Generate URL slug
    const fileName = basename(filePath, '.md');
    if (this.isProject) {
      this.url = `/articles/projects/${this.projectName}/${fileName}`;
    } else {
      const year = this.date.getFullYear();
      this.url = `/articles/${year}/${fileName}`;
    }
  }
}

// Parse markdown file with frontmatter
async function parseMarkdownFile(filePath) {
  const content = await readFile(filePath, 'utf-8');
  
  // Extract frontmatter
  const frontmatterRegex = /^---\s*\n(.*?)\n---\s*\n(.*)/s;
  const match = content.match(frontmatterRegex);
  
  if (!match) {
    throw new Error(`No frontmatter found in ${filePath}`);
  }
  
  const frontmatter = yaml.load(match[1]);
  const markdownContent = match[2];
  
  const article = new Article(markdownContent, frontmatter, filePath);
  
  // Reset language tracking and parse content
  currentArticleLanguages.clear();
  
  // Parse to trigger language detection
  marked.parse(article.content);
  
  // Store detected languages
  article.languages = new Set(currentArticleLanguages);
  
  return article;
}

// Recursively find all markdown files
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

// Load templates
async function loadTemplates() {
  const templates = {};
  const templateFiles = ['layout.html', 'index.html', 'article.html', 'projects.html'];
  
  for (const file of templateFiles) {
    const name = basename(file, '.html');
    templates[name] = await readFile(join(TEMPLATES_DIR, file), 'utf-8');
  }
  
  return templates;
}

// Generate HTML from template
function renderTemplate(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return data[key] || '';
  });
}

// Generate article HTML
function generateArticleHTML(article, templates, styles) {
  const formattedDate = article.date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  // Re-parse content for final HTML
  const htmlContent = marked.parse(article.content);
  
  // Prepare conditional content
  const projectBadge = article.projectName 
    ? `<span class="project-badge">${article.projectName}</span>` 
    : '';
  
  const descriptionBlock = article.description 
    ? `<p class="article-description">${article.description}</p>` 
    : '';
  
  // Render article content into article template
  const articleContent = renderTemplate(templates.article, {
    title: article.title,
    content: htmlContent,
    date: formattedDate,
    projectBadge: projectBadge,
    descriptionBlock: descriptionBlock
  });
  
  // Wrap in layout template
  const fullHTML = renderTemplate(templates.layout, {
    title: article.title,
    description: article.description,
    content: articleContent,
    styles: styles
  });
  
  return fullHTML;
}

// Generate index page
function generateIndexHTML(articles, templates, styles) {
  const sortedArticles = articles.sort((a, b) => b.date - a.date);
  
  const articlesList = sortedArticles.map(article => {
    const formattedDate = article.date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
    
    const projectBadge = article.isProject 
      ? `<span class="project-badge">${article.projectName}</span>` 
      : '';
    
    // Clean content for search
    const cleanContent = article.content
      .replace(/```[\s\S]*?```/g, '')
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
    
    // Escape HTML attributes
    const escapeAttr = (str) => str
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    return `
      <article class="article-card" 
               data-title="${escapeAttr(article.title.toLowerCase())}" 
               data-content="${escapeAttr(cleanContent.toLowerCase())}" 
               data-project="${escapeAttr(article.projectName || '')}">
        <div class="article-meta">
          <time datetime="${article.date.toISOString()}">${formattedDate}</time>
          ${projectBadge}
        </div>
        <h2><a href="${article.url}">${article.title}</a></h2>
        <p class="article-description">${article.description}</p>
      </article>
    `;
  }).join('');
  
  // Render index content into index template
  const indexContent = renderTemplate(templates.index, {
    articles: articlesList
  });
  
  // Wrap in layout template
  const fullHTML = renderTemplate(templates.layout, {
    title: 'Albert BF\'s Blog',
    description: 'My personal minimalist technical blog',
    content: indexContent,
    styles: styles
  });
  
  return fullHTML;
}

// Generate projects page
function generateProjectsHTML(articles, templates, styles) {
  const projectArticles = articles.filter(a => a.isProject);
  const projectsMap = new Map();
  
  // Group articles by project
  projectArticles.forEach(article => {
    if (!projectsMap.has(article.projectName)) {
      projectsMap.set(article.projectName, []);
    }
    projectsMap.get(article.projectName).push(article);
  });
  
  // Sort articles within each project by date
  for (const [project, articles] of projectsMap) {
    articles.sort((a, b) => b.date - a.date);
  }
  
  const projectsList = Array.from(projectsMap.entries()).map(([projectName, articles]) => {
    const articlesList = articles.map(article => {
      const formattedDate = article.date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
      
      return `
        <li class="project-article">
          <a href="${article.url}">${article.title}</a>
          <time datetime="${article.date.toISOString()}">${formattedDate}</time>
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
  
  // Render projects content
  const projectsContent = renderTemplate(templates.projects, {
    projects: projectsList
  });
  
  // Wrap in layout template
  const fullHTML = renderTemplate(templates.layout, {
    title: 'Projects',
    description: 'A collection of my projects and their related articles',
    content: projectsContent,
    styles: styles
  });
  
  return fullHTML;
}

// Generate search index
function generateSearchIndex(articles) {
  return articles.map(article => {
    const cleanContent = article.content
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]*`/g, '')
      .replace(/#{1,6}\s+/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[>\-\*\+]/g, '')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 300);
    
    return {
      title: article.title,
      description: article.description,
      url: article.url,
      date: article.date.toISOString(),
      projectName: article.projectName,
      content: cleanContent,
      languages: Array.from(article.languages || [])
    };
  });
}

// Ensure directory exists
async function ensureDir(dir) {
  try {
    await mkdir(dir, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

// Main build function
async function build() {
  console.log('🚀 Starting build process...');
  
  try {
    await ensureDir(DIST_DIR);
    
    const styles = await readFile(STYLES_PATH, 'utf-8');
    const templates = await loadTemplates();
    
    console.log('📖 Parsing markdown files...');
    const markdownFiles = await findMarkdownFiles(ARTICLES_DIR);
    const articles = [];
    
    for (const file of markdownFiles) {
      try {
        const article = await parseMarkdownFile(file);
        articles.push(article);
        const languageInfo = article.languages.size > 0 
          ? ` (languages: ${Array.from(article.languages).join(', ')})` 
          : '';
        console.log(`✅ Parsed: ${article.title}${languageInfo}`);
      } catch (err) {
        console.error(`❌ Error parsing ${file}:`, err.message);
      }
    }
    
    console.log(`📚 Found ${articles.length} articles`);
    
    console.log('📝 Generating article pages...');
    for (const article of articles) {
      const articleHTML = generateArticleHTML(article, templates, styles);
      const outputPath = join(DIST_DIR, article.url.substring(1), 'index.html');
      
      await ensureDir(dirname(outputPath));
      await writeFile(outputPath, articleHTML);
      console.log(`✅ Generated: ${article.url}`);
    }
    
    console.log('🏠 Generating index page...');
    const indexHTML = generateIndexHTML(articles, templates, styles);
    await writeFile(join(DIST_DIR, 'index.html'), indexHTML);
    
    console.log('📂 Generating projects page...');
    const projectsHTML = generateProjectsHTML(articles, templates, styles);
    await ensureDir(join(DIST_DIR, 'projects'));
    await writeFile(join(DIST_DIR, 'projects', 'index.html'), projectsHTML);
    
    console.log('🔍 Generating search index...');
    const searchIndex = generateSearchIndex(articles);
    await writeFile(join(DIST_DIR, 'search-index.json'), JSON.stringify(searchIndex, null, 2));
    
    console.log('✨ Build completed successfully!');
    console.log(`📊 Generated ${articles.length} articles`);
    
    // Summary of languages used
    const allLanguages = new Set();
    articles.forEach(article => {
      if (article.languages) {
        article.languages.forEach(lang => allLanguages.add(lang));
      }
    });
    
    if (allLanguages.size > 0) {
      console.log(`🎨 Languages detected: ${Array.from(allLanguages).join(', ')}`);
    }
    
  } catch (err) {
    console.error('❌ Build failed:', err);
    process.exit(1);
  }
}

// Run build if called directly
if (import.meta.main) {
  build();
}