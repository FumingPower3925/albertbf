---
title: "LibreUtils Part 4: Reaching v0.2.0 — The Privacy Core"
date: "06-01-2026"
description: "Celebrating LibreUtils v0.2.0 with two new cryptographic tools, zero external runtime dependencies, and lessons learned from shipping privacy-first software."
tags: ["cryptography", "aes-gcm", "privacy", "web-crypto-api", "release", "lessons-learned"]
project: "libre-utils"
project_version: "0.2.0"
project_url: "https://libreutils.org"
---

We've hit a milestone. LibreUtils v0.2.0 is live, and it transforms the project from a basic tool collection into something more ambitious: a genuine privacy-focused platform built on cryptographic operations that never leave your browser.

Two new tools. Two reusable components. A complete security infrastructure. Zero external runtime dependencies for crypto operations.

Let's talk about what we built and what we learned.

## The New Tools

### Encryptor / Decryptor

Full-featured AES-GCM encryption, running entirely in your browser:

```typescript
type EncryptionAlgorithm = 
    | 'AES-128-GCM' 
    | 'AES-192-GCM' 
    | 'AES-256-GCM' 
    | 'ChaCha20-Poly1305';

// PBKDF2 key derivation with serious (and configurable) iteration count
const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
);

const key = await crypto.subtle.deriveKey(
    {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,  // Slow by design
        hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
);
```

Files and text. Binary detection (through MIME types). Original filename preservation in the encrypted payload. ChaCha20-Poly1305 when the browser supports it (modern Firefox and Chrome do).

The 100,000 PBKDF2 iterations aren't arbitrary — they're deliberately slow to make brute-force attacks expensive. A password that takes milliseconds to verify takes months to crack at scale. That's the tradeoff we want.

### Checksum Generator

Six hash algorithms: MD5, SHA-1, SHA-256, SHA-384, SHA-512, and BLAKE3.

The challenge: we needed cryptographic hashes without external dependencies. Loading a random npm package for crypto operations undermines the entire privacy premise. What if the package phones home? What if a future update adds telemetry? Or worse, what if the package is infected?

The solution: vendor the excellent [noble-hashes](https://github.com/paulmillr/noble-hashes) library directly into the codebase.

```typescript
// Web Crypto for SHA family (fast, native)
if (['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'].includes(algorithm)) {
    const hashBuffer = await crypto.subtle.digest(algorithm, data);
    return bytesToHex(new Uint8Array(hashBuffer));
}

// Vendored noble-hashes for MD5, BLAKE3
import { md5 } from './lib/noble/legacy';
import { blake3 } from './lib/noble/blake3';
```

MD5 and SHA-1 get "Insecure" badges in the UI. They're still useful for file integrity checks and legacy compatibility — just not for security. Being honest about limitations builds trust.

## Problems Solved (The Hard Way)

Every release teaches lessons. Here are the ones that taught us most:

### The Cloudflare Pages Bun Problem

Cloudflare Pages defaults to npm for builds. Our `workspace:*` references — standard Bun workspace syntax — failed immediately:

```
npm error Unsupported URL Type "workspace:": workspace:*
```

The fix was surprisingly simple: replace `workspace:*` with `file:../../shared`. Works with both npm and Bun, requires no Cloudflare configuration changes.

```json
{
    "dependencies": {
        "@libreutils/shared": "file:../../shared"
    }
}
```

Lesson learned: when your build system differs from your deploy system, use the lowest common denominator for dependency references.

### Vendoring Noble-Hashes Properly

Third-party crypto libraries are inherently problematic for a privacy-first project. We vendored noble-hashes directly — copying the source into our repository with full audit trail and providing the required atribution (in the next release we will improve our license handling).

Unexpected consequence: Copilot (that is used in order to review the PRs) now complains (a lot) about `let` vs `const` in highly-optimized crypto code (where reassignment is deliberate for performance). Solution: `.github/copilot-instructions.md`:

```markdown
## Files to Ignore During Code Review

The following paths contain vendored third-party code 
that should not be modified without careful review:

- `tools/checksum-generator/src/lib/noble/**`

These files follow their upstream formatting and patterns.
Performance-critical code may use unconventional patterns.
```

Lesson learned: vendoring means owning the code. Own the tooling feedback too.

### The Router Cleanup Bug

Our secure cleanup — which scrubs sensitive data when leaving a tool — ran on every navigation. Including clicking the current route:

```typescript
// Before: cleanup fires even when staying on same page
if (currentRoute && currentRoute.onLeave) {
    currentRoute.onLeave();
}
```

Users would lose their encryption work if they accidentally double-clicked the nav link. Infuriating.

```typescript
// After: only cleanup when actually navigating away
if (currentRoute && currentRoute !== route && currentRoute.onLeave) {
    currentRoute.onLeave();
}
```

One line of code. Hours of debugging. Lesson learned: identity checks matter, especially in cleanup logic.

## Security Infrastructure

Every tool now implements `secureCleanup()`:

```typescript
export function secureCleanup(): void {
    if (cleanupHook) {
        cleanupHook();
    }
}

// Called by router when navigating away
```

The hook overwrites sensitive data before clearing:

```typescript
const scrubValueElement = (el: { value: string } | null): void => {
    if (!el) return;
    const len = el.value.length;
    if (len > 0) {
        // Overwrite with random data before clearing
        el.value = secureRandomString(len);
    }
    el.value = '';
};

// Scrub all text inputs and textareas
container.querySelectorAll('input[type="text"], input[type="password"], textarea')
    .forEach(el => scrubValueElement(el as HTMLInputElement));
```

Can JavaScript guarantee secure memory wiping? No. The runtime might have copies. The OS might page to disk. But best-effort scrubbing is meaningfully better than leaving plaintext passwords in DOM elements.

Sometimes "not perfect" is still "much better."

## New Shared Components

### `<lu-copy-to-clipboard>`

```html
<lu-copy-to-clipboard 
    text="content to copy" 
    label="Copy">
</lu-copy-to-clipboard>
```

Visual feedback ("Copied!"), consistent styling across all tools, error handling for clipboard permission issues. Write once, use everywhere.

### `<lu-download-button>`

```typescript
// Uses File System Access API when available (modern browsers)
if ('showSaveFilePicker' in window) {
    const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ accept: { [mimeType]: [`.${ext}`] } }]
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
} else {
    // Fallback: blob download with synthetic click
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
```

Native file picker on supported browsers (user chooses where to save). Automatic fallback on Safari and older browsers. Progressive enhancement that's invisible to users.

## The Numbers

- **153 tests** passing across all packages
- **6 packages** at v1.0.0 (tools) with main app at v0.2.0
- **Zero external runtime dependencies** for crypto operations
- **~6,000 lines** added/modified since v0.1.0

The test count matters less than the coverage: every encoding format, every encryption algorithm, every error path. When users trust you with sensitive data, you can't ship bugs.

## What's Next

The Privacy Core is complete. The foundation is solid. Now we build:

- **v0.3.0**: The Heavy Lifters (Files & Media) and Legal Compliance.

Each release adds utility while maintaining the core promise: your data never leaves your browser.

## Closing Thoughts

Building privacy-first software is harder than building privacy-optional software. Every convenience feature you want — cloud sync, crash reporting, analytics — becomes a liability. Every dependency is a risk. Every shortcut that "just calls this API" violates the architecture.

But it's worth it.

When users encrypt files with LibreUtils, they don't need to trust us. They don't need to trust our privacy policy, our server security, or our business model. The architecture is the guarantee.

That's a different kind of software. That's what v0.2.0 represents.

Try it at [libreutils.org](https://libreutils.org). The code is open source at [github.com/FumingPower3925/libreutils](https://github.com/FumingPower3925/libreutils).

Your data stays yours. Everything else is just implementation details.

---

*Previous: Part 3 — Anatomy of a Tool: Text Encoder*
