<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <xsl:output method="html" version="5.0" encoding="UTF-8" indent="yes"/>
  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <meta name="robots" content="noindex"/>
        <title><xsl:value-of select="/rss/channel/title"/> — RSS feed</title>
        <style>
          :root { color-scheme: light dark; }
          body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.6;
            max-width: 46rem; margin: 0 auto; padding: 2.5rem 1.25rem; color: #1c1b1a; background: #faf9f7; }
          @media (prefers-color-scheme: dark) { body { color: #ece9e4; background: #131211; } a { color: #ef6a61; } .note { background: #1c1a19; border-color: #2e2b28; } }
          a { color: #c22a2a; }
          h1 { font-size: 1.6rem; margin-bottom: .25rem; }
          .lead { color: #6e6a63; margin-top: 0; }
          .note { background: #fff; border: 1px solid #e7e4de; border-radius: 10px; padding: 1rem 1.25rem; margin: 1.5rem 0; }
          code { font-family: ui-monospace, Menlo, Consolas, monospace; background: rgba(127,127,127,.16); padding: .1em .4em; border-radius: 4px; }
          ul { list-style: none; padding: 0; }
          li { padding: .9rem 0; border-bottom: 1px solid #e7e4de; }
          .date { color: #6e6a63; font-size: .85rem; }
        </style>
      </head>
      <body>
        <p class="lead">RSS feed</p>
        <h1><xsl:value-of select="/rss/channel/title"/></h1>
        <p><xsl:value-of select="/rss/channel/description"/></p>
        <div class="note">
          This is a web feed, meant to be read in a feed reader. Copy this page's URL —
          <code><xsl:value-of select="/rss/channel/atom:link/@href"/></code> — and paste it into your
          reader (NetNewsWire, Feedly, Reeder, …) to subscribe. New posts arrive automatically.
        </div>
        <h2>Recent posts</h2>
        <ul>
          <xsl:for-each select="/rss/channel/item">
            <li>
              <a href="{link}"><xsl:value-of select="title"/></a>
              <div class="date"><xsl:value-of select="pubDate"/></div>
            </li>
          </xsl:for-each>
        </ul>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
