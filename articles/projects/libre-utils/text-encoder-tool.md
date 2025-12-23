---
title: "LibreUtils Part 3: Anatomy of a Tool — Building the Text Encoder"
date: "29-12-2025"
description: "A deep dive into building a LibreUtils tool from scratch — separating pure logic from UI, establishing patterns that scale, and creating a text encoder that handles Base64, URL encoding, and six other formats."
tags: ["typescript", "web-components", "architecture", "encoding", "tutorial", "privacy"]
project: "libre-utils"
project_version: "0.2.0"
project_url: "https://libreutils.org"
---

Every project needs a starting point — that first feature that forces you to make real decisions instead of theoretical ones. For LibreUtils, that's the Text Encoder: a tool for encoding and decoding text in various formats.

Base64. URL encoding. HTML entities. Hexadecimal. Binary. Unicode escape sequences.

It's simple enough to build quickly, complex enough to establish patterns that scale, and useful enough that you'll actually use it. Let's build it from scratch.

## The Tool Architecture

Every LibreUtils tool follows a consistent structure. This isn't bureaucracy — it's a deliberate design that enables both isolation and integration:

```
tools/text-encoder/
├── src/
│   ├── tool.ts          # Core logic (pure functions)
│   ├── tool.test.ts     # Unit tests
│   ├── page.ts          # UI component
│   ├── index.html       # Standalone entry
│   └── standalone.ts    # Standalone bootstrap
├── tests/
│   └── e2e.test.ts      # Integration tests
└── package.json
```

The key insight, the one that makes everything else work: **separate logic from presentation**.

`tool.ts` contains zero DOM code. It's pure TypeScript that could run in Node, Bun, Deno, or the browser. Test it anywhere. Use it anywhere. The UI is just one possible consumer of this logic.

## The Core: Pure Functions

Let's look at `tool.ts`. Notice what's missing — no `document`, no `window`, no browser APIs at all:

```typescript
export type EncodingType = 
    | 'base64' 
    | 'url' 
    | 'html' 
    | 'hex' 
    | 'binary'
    | 'unicode';

export class TextEncoderTool {
    static encode(text: string, type: EncodingType): string {
        switch (type) {
            case 'base64':
                return btoa(unescape(encodeURIComponent(text)));
            case 'url':
                return encodeURIComponent(text);
            case 'html':
                return text
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#39;');
            case 'hex':
                return Array.from(new TextEncoder().encode(text))
                    .map(b => b.toString(16).padStart(2, '0'))
                    .join('');
            case 'binary':
                return Array.from(new TextEncoder().encode(text))
                    .map(b => b.toString(2).padStart(8, '0'))
                    .join(' ');
            case 'unicode':
                return Array.from(text)
                    .map(c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
                    .join('');
        }
    }
    
    static decode(text: string, type: EncodingType): string {
        switch (type) {
            case 'base64':
                try {
                    return decodeURIComponent(escape(atob(text)));
                } catch {
                    throw new Error('Invalid Base64 input');
                }
            case 'url':
                return decodeURIComponent(text);
            // ... inverse operations for each type
        }
    }
}
```

This separation enables powerful possibilities:

- **Unit testing without browser APIs** — Tests run in pure Bun, milliseconds each
- **Reuse in different contexts** — Want a CLI version? Import the same module
- **Clear responsibility boundaries** — Logic bugs can only be in `tool.ts`, UI bugs can only be in `page.ts`

Wait, you might say — `btoa` and `TextEncoder` are browser APIs! True, but they're also available in Bun and Deno. The key distinction is that nothing in this file *manipulates the DOM*. It's compute-only.

## The UI: Direct DOM Manipulation

`page.ts` renders the interface. No React, no Vue, no virtual DOM. Just template literals and native DOM APIs:

```typescript
const ENCODING_OPTIONS = [
    { id: 'base64', name: 'Base64' },
    { id: 'url', name: 'URL Encoding' },
    { id: 'html', name: 'HTML Entities' },
    { id: 'hex', name: 'Hexadecimal' },
    { id: 'binary', name: 'Binary' },
    { id: 'unicode', name: 'Unicode Escape' },
];

export function renderTextEncoderPage(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'lu-tool-page text-encoder-page';
    
    container.innerHTML = `
        <h1>Text Encoder / Decoder</h1>
        <p class="tool-description">
            Encode and decode text in various formats. 
            All processing happens in your browser.
        </p>
        
        <div class="encoding-selector">
            <label for="encoding-type">Format:</label>
            <select id="encoding-type">
                ${ENCODING_OPTIONS.map(opt => 
                    `<option value="${opt.id}">${opt.name}</option>`
                ).join('')}
            </select>
        </div>
        
        <div class="text-areas">
            <textarea id="input-text" placeholder="Enter text to encode or decode..."></textarea>
            
            <div class="button-group">
                <button id="encode-btn" class="lu-btn primary">Encode ↓</button>
                <button id="swap-btn" class="lu-btn secondary">⇅ Swap</button>
                <button id="decode-btn" class="lu-btn primary">↑ Decode</button>
            </div>
            
            <textarea id="output-text" placeholder="Result will appear here..." readonly></textarea>
        </div>
        
        <div class="actions">
            <lu-copy-to-clipboard target="#output-text" label="Copy Result"></lu-copy-to-clipboard>
            <button id="clear-btn" class="lu-btn ghost">Clear All</button>
        </div>
    `;
    
    setupEventListeners(container);
    return container;
}
```

Is this more verbose than JSX? Slightly. But look at what you gain:

- **Zero bundle size for framework code** — Just your logic
- **Predictable performance** — No virtual DOM diffing, no reconciliation
- **Simpler debugging** — The DOM is the source of truth, inspect it directly
- **No build step in development** — What you write is what runs

For a tool this size, React would add more complexity than it removes.

## Event Handling: Set Once, Run Forever

Event listeners attach when the component mounts. No change detection, no subscriptions to manage:

```typescript
function setupEventListeners(container: HTMLElement): void {
    const input = container.querySelector('#input-text') as HTMLTextAreaElement;
    const output = container.querySelector('#output-text') as HTMLTextAreaElement;
    const typeSelect = container.querySelector('#encoding-type') as HTMLSelectElement;
    
    container.querySelector('#encode-btn')?.addEventListener('click', () => {
        try {
            const type = typeSelect.value as EncodingType;
            output.value = TextEncoderTool.encode(input.value, type);
            output.classList.remove('error');
        } catch (error) {
            output.value = `Error: ${(error as Error).message}`;
            output.classList.add('error');
        }
    });
    
    container.querySelector('#decode-btn')?.addEventListener('click', () => {
        try {
            const type = typeSelect.value as EncodingType;
            output.value = TextEncoderTool.decode(input.value, type);
            output.classList.remove('error');
        } catch (error) {
            output.value = `Error: ${(error as Error).message}`;
            output.classList.add('error');
        }
    });
    
    container.querySelector('#swap-btn')?.addEventListener('click', () => {
        [input.value, output.value] = [output.value, input.value];
    });
    
    container.querySelector('#clear-btn')?.addEventListener('click', () => {
        input.value = '';
        output.value = '';
        output.classList.remove('error');
    });
}
```

Notice the error handling pattern: the core functions *throw*, the UI layer *catches and displays*. This keeps error presentation concerns out of the logic layer.

## Testing Strategy: Comprehensive but Fast

**Unit tests** cover every encoding type and edge cases:

```typescript
describe('TextEncoderTool', () => {
    describe('roundtrip integrity', () => {
        const testStrings = [
            'Hello, World!',
            '你好世界',
            'Emoji: 🎉🚀',
            '<script>alert("xss")</script>',
            'Special: @#$%^&*()',
        ];
        
        for (const str of testStrings) {
            for (const type of ['base64', 'url', 'html', 'hex', 'unicode'] as const) {
                test(`${type} roundtrip: "${str.slice(0, 20)}..."`, () => {
                    const encoded = TextEncoderTool.encode(str, type);
                    const decoded = TextEncoderTool.decode(encoded, type);
                    expect(decoded).toBe(str);
                });
            }
        }
    });
    
    describe('error handling', () => {
        test('throws on invalid Base64', () => {
            expect(() => TextEncoderTool.decode('!!!invalid!!!', 'base64'))
                .toThrow('Invalid Base64');
        });
        
        test('throws on invalid hex', () => {
            expect(() => TextEncoderTool.decode('zzzz', 'hex'))
                .toThrow();
        });
    });
});
```

**E2E tests** verify integration, not logic:

```typescript
test('standalone HTML has required PWA meta tags', async () => {
    const html = await Bun.file('./src/index.html').text();
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(html).toContain('viewport');
    expect(html).toContain('theme-color');
});

test('package.json has correct exports', async () => {
    const pkg = await Bun.file('./package.json').json();
    expect(pkg.exports['./page']).toBeDefined();
});
```

The distinction matters: unit tests verify *correctness*, E2E tests verify *integration*. Fast feedback on logic, thorough checks on configuration.

## Standalone Mode: Develop in Isolation

Each tool can run independently:

```bash
cd tools/text-encoder
bun run dev
# Opens at localhost:3001
```

The standalone dev server bundles TypeScript on-the-fly and injects shared CSS. Perfect for iterating on a single tool without rebuilding the entire application.

This isolation is powerful for contributors. Want to add a new encoding format? You can develop and test entirely within the tool directory, never touching the main app until you're ready.

## Integration: Two Lines of Code

Adding the tool to the main application:

```typescript
// src/routes.ts
import { renderTextEncoderPage } from '../tools/text-encoder/src/page';

const routes: Route[] = [
    { 
        path: '/tools/text-encoder', 
        title: 'Text Encoder', 
        render: renderTextEncoderPage 
    },
];
```

The tool card on the home page is data-driven. Add metadata to the tools registry, and it appears automatically. No component imports, no manual wiring.

## The Pattern, Generalized

The Text Encoder establishes a pattern that every LibreUtils tool follows:

1. **Pure logic in `tool.ts`** — No DOM, no browser-specific APIs beyond compute
2. **UI in `page.ts`** — Returns an HTMLElement, sets up its own listeners
3. **Standalone capability** — Each tool is a complete mini-application
4. **Shared components** — `<lu-copy-to-clipboard>`, `<lu-download-button>`, etc.
5. **Comprehensive tests** — Unit for logic, E2E for integration

New tools copy this template, implement their logic, and slot into the application. The architecture does the integration work.

## What's Next

With the first tool complete and patterns established, LibreUtils v0.2.0 adds cryptographic operations: encryption/decryption and checksum generation. The next article covers the journey to v0.2.0 — new tools, shared components, and problems solved along the way.

Try the Text Encoder yourself at [libreutils.org/tools/text-encoder](https://libreutils.org/tools/text-encoder). Your text stays in your browser. That's kind of the whole point.

---

*Previous: Part 2 — Testing Infrastructure and Developer Experience*  
*Next: Part 4 — Reaching v0.2.0: The Privacy Core*
