---
title: "LibreUtils Part 2: Testing Infrastructure and Developer Experience"
date: "23-12-2025"
description: "How LibreUtils achieves zero-friction quality through Bun's test runner, TypeScript pre-commit hooks, smart CI pipelines, and a developer experience designed for open-source contribution."
tags: ["testing", "bun", "typescript", "ci-cd", "developer-experience", "open-source"]
project: "libre-utils"
project_version: "0.2.0"
project_url: "https://libreutils.org"
---

Contributing to open source should feel like a gift, not a chore. Yet too often, the experience goes something like this: clone the repo, spend 30 minutes debugging environment issues, run a cryptic test command, watch it fail for reasons unrelated to your code, and finally give up in frustration.

LibreUtils takes a different approach. From initial clone to passing tests, here's the entire process:

```bash
git clone https://github.com/FumingPower3925/libreutils.git
cd libreutils
bun install
bun run hooks:install
bun run dev
```

Five commands. Under a minute. No "make sure you have Node 18.x but not 20.x" warnings. No Docker requirements. No database to initialize. Just code.

## Bun as the Test Runner

I chose Bun's built-in test runner over Jest or Vitest for one reason that trumps all others: **simplicity**.

No configuration files. No plugins. No jest.config.js with 47 options you'll never understand. Just write tests:

```typescript
import { describe, test, expect } from 'bun:test';
import { TextEncoderTool } from './tool';

describe('TextEncoderTool', () => {
    test('encodes to Base64', () => {
        expect(TextEncoderTool.encode('Hello', 'base64')).toBe('SGVsbG8=');
    });
    
    test('handles Unicode correctly', () => {
        expect(TextEncoderTool.encode('你好', 'base64')).toBe('5L2g5aW9');
    });
});
```

Run with `bun test`. That's the entire mental model. No framework magic, no mocking libraries to configure, no "why isn't my mock working" debugging sessions.

Bun's test runner is also *fast*. Not "pretty fast." Fast enough that running the entire test suite feels instant. That changes how you work — you run tests constantly instead of batching them.

## Test Structure: Separation of Concerns

Each tool has two distinct test categories, and understanding why makes the whole system click:

**Unit Tests** (`src/tool.test.ts`)
- Pure function tests  
- No DOM, no browser APIs
- Test the logic in isolation
- Run on every commit

**E2E Tests** (`tests/e2e.test.ts`)
- PWA readiness checks
- HTML structure validation  
- Package configuration verification
- Ensure the tool integrates correctly

The web application itself has minimal tests — just enough to verify routing, PWA configuration, and version synchronization work. Why so few? Because the app is mostly glue code. The real complexity lives in the tools, and that's where testing effort should focus.

## Pre-Commit Hooks: TypeScript, Not Shell

Here's an unusual choice that deserves explanation: the git hooks are written in TypeScript, not shell scripts.

```typescript
// scripts/pre-commit.ts
import { $ } from 'bun';

console.log('[*] Running pre-commit checks...\n');

console.log('  > Type checking...');
const typecheck = await $`bun run typecheck`.quiet().nothrow();
if (typecheck.exitCode !== 0) {
    console.log('[X] Type check failed.');
    process.exit(1);
}

console.log('  > Syncing version...');
await $`bun run version:sync`.quiet();

console.log('  > Running tests...');
const tests = await $`bun test`.quiet().nothrow();
if (tests.exitCode !== 0) {
    console.log('[X] Tests failed.');
    process.exit(1);
}

console.log('\n[OK] All pre-commit checks passed!');
```

Why TypeScript instead of bash?

**Consistency** — Same language as the codebase. Contributors don't need to context-switch to "shell script brain" when understanding the development workflow.

**Error handling** — Proper async/await, try/catch, and typed return values. No arcane `set -e` behaviors to remember.

**Cross-platform** — Works identically on macOS, Linux, and Windows (with Bun). No "works on my machine" for contributor scripts.

The actual git hook is a tiny shell wrapper: `#!/bin/sh` followed by `bun run scripts/pre-commit.ts`. The hook just bootstraps into TypeScript-land.

## Version Synchronization: One Source of Truth

Version lives in exactly one place: `package.json`. The pre-commit hook automatically syncs it everywhere else:

```typescript
// scripts/sync-version.ts
const pkg = await Bun.file('./package.json').json();
const version = pkg.version;

// Update manifest.json for PWA
const manifest = await Bun.file('./public/manifest.json').json();
manifest.version = version;
await Bun.write('./public/manifest.json', JSON.stringify(manifest, null, 4));

// Update sw.js cache version
let sw = await Bun.file('./public/sw.js').text();
sw = sw.replace(/const CACHE_VERSION = '[^']+';/, `const CACHE_VERSION = '${version}';`);
await Bun.write('./public/sw.js', sw);
```

Contributors never need to remember "update the version in three places." They update `package.json`, and the hook handles propagation. Automation eliminates entire categories of mistakes.

## CI Pipeline: Test Only What Changed

As a project grows, CI time grows. A naive approach runs all tests on every PR, and suddenly you're waiting 15 minutes for feedback on a one-line change.

LibreUtils's GitHub Actions workflow does something clever: it only runs tests for tools that actually changed:

```yaml
- name: Detect changed tools
  id: detect-changes
  run: |
    CHANGED_FILES=$(git diff --name-only ${{ github.event.pull_request.base.sha }} ${{ github.sha }})
    TOOLS=$(echo "$CHANGED_FILES" | grep "^tools/" | cut -d'/' -f2 | sort -u)
    echo "tools=$TOOLS" >> $GITHUB_OUTPUT

- name: Run tool tests
  if: steps.detect-changes.outputs.tools != ''
  run: |
    for tool in ${{ steps.detect-changes.outputs.tools }}; do
      bun test tools/$tool
    done
```

Modify `tools/text-encoder/`? Only text-encoder tests run. Touch `shared/`? All tool tests run (because shared code affects everything). Change just documentation? Skip tests entirely.

This keeps CI fast as the project grows — a critical factor for maintaining contributor momentum.

## Update Notifications: Respecting User Agency

When users have an old version installed and visit the updated site, the service worker detects the change. But instead of forcing a refresh (jarring and potentially data-losing), we show a gentle toast:

```typescript
function showUpdateToast(version?: string): void {
    const toast = document.createElement('div');
    toast.id = 'update-toast';
    toast.className = 'lu-update-toast';
    toast.innerHTML = `
        <span>New version${version ? ` (v${version})` : ''} available!</span>
        <button onclick="location.reload()">Refresh</button>
        <button class="dismiss" onclick="this.parentElement.remove()">×</button>
    `;
    document.body.appendChild(toast);
}
```

The user decides when to update. Maybe they're in the middle of encrypting a file. Maybe they're comparing two encoded strings. Their workflow shouldn't be interrupted by our deployment schedule.

This philosophy — respecting user agency in small ways — extends from privacy (your data) to workflow (your timing) to presentation (no forced dark mode). Users are adults. Treat them that way.

## The Developer Experience Payoff

All these investments in developer experience serve one goal: **making contribution feel effortless**.

When tests run in milliseconds, you run them constantly. When pre-commit hooks catch errors before they hit CI, you get faster feedback. When CI only runs relevant tests, PRs merge faster. When version sync is automatic, you focus on code instead of coordination.

The result? A codebase that welcomes contributions rather than intimidating them away.

## What's Next

With the testing infrastructure solid, the next article dives into building an actual tool from scratch. We'll walk through the Text Encoder — the first tool in LibreUtils — from pure logic to polished UI.

The code is open source: [github.com/FumingPower3925/libreutils](https://github.com/FumingPower3925/libreutils)

Clone it, install the hooks, run the tests. See for yourself how fast "fast" can feel.

---

*Previous: Part 1 — Philosophy and Architecture*  
*Next: Part 3 — Anatomy of a Tool: Text Encoder*
