# albertbf.com Blog

This is the source code for my minimalist, fast, and zero-cost personal blog, built with a focus on performance and simplicity.

## ✨ Features

  * **Static Site Generation**: All pages are pre-built for maximum performance.
  * **Markdown-based**: Content is written in Markdown with YAML frontmatter.
  * **Dark Mode**: Theme support for light and dark modes.
  * **Client-side Search**: A lightweight search index for finding articles.
  * **Zero-Cost Hosting**: Deployed on Cloudflare's free tier.

## 🛠️ Tech Stack

  * **Runtime**: Bun
  * **Deployment**: Cloudflare Workers & Pages
  * **Framework**: Hono (for setting headers)
  * **Markdown Parsing**: `marked`
  * **Syntax Highlighting**: `highlight.js`
  * **Styling**: Vanilla CSS, no frameworks.

## 🚀 Getting Started

### Prerequisites

  * [Bun](https://bun.sh/)

### Installation & Development

1.  **Clone the repository:**

    ```sh
    git clone https://github.com/FumingPower3925/albertbf.git
    cd albertbf
    ```

2.  **Install dependencies:**

    ```sh
    bun install
    ```

3.  **Run the development server:**
    This will start a local server with live-reloading.

    ```sh
    bun run dev
    ```

### Build

To build the static site for production:

```sh
bun run build
```

The output will be in the `./dist` directory.

## ☁️ Deployment

The project is deployed to Cloudflare Workers. The `wrangler.toml` file contains the configuration.

To deploy, run:

```sh
bun run deploy
```