---
title: "Mini-Gandalf: A Puzzle Sandbox for Exploring LLM Defenses"
date: "16-08-2025"
description: "Diving into the design and mechanics of a multi-level puzzle game inspired by Lakera's Gandalf, where players extract secrets from an LLM while navigating escalating defensive techniques and tool-based protocols."
tags: ["llm", "prompt-engineering", "red-teaming", "security", "puzzle", "python", "docker"]
---

Imagine chatting with an AI assistant that's guarding a secret password, and your job is to coax it out through clever prompts, encodings, or even authorization rituals. Sounds like a fun challenge? That's the essence of red teaming LLMs – testing their defenses against information leakage. But what if we turned that into an interactive game with escalating difficulties, multiple solution paths, and real lessons in prompt engineering?

Enter Mini-Gandalf: a proof-of-concept puzzle sandbox inspired by Lakera's Gandalf challenge. This project creates a series of levels where players try to extract a "watchword" (think secret password) from an LLM-powered assistant. Each level introduces new defensive layers, from simple output filters to external vector stores and nonce-based challenges. It's not just a game – it's an educational tool that demonstrates how to harden LLMs against prompt injections and unauthorized disclosures, all while keeping things engaging and multi-path.

While still in its early stages, Mini-Gandalf lays a solid foundation for exploring LLM security patterns. Built with Python, Docker for easy deployment, and integration with OpenAI's API, it's designed to be hackable and extensible. Let's break down the core mechanics, level progression, and design insights that make this project tick.

## The Core Loop: Chat, Probe, Conquer

At its heart, Mini-Gandalf is a chat-based puzzle game. Players select a level via a simple UI, then engage in conversation with the assistant. The goal? Get the watchword out in the open – either by having the AI output it directly or piecing it together from hints and reconstructing it manually.

Here's what makes the experience tick:

- **Chat UI and Level Selector**: A straightforward interface lets you pick from eight levels, each with its own themed system prompt and watchword.
- **Win Condition**: You "win" if the assistant outputs the watchword (after passing server-side filters) or if you type it in manually. This rewards reconstruction from partial leaks like encodings or mnemonics.
- **Tool Catalog**: The assistant can call various tools to "help" without directly spilling the secret. These include encoders (base64, hex, ROT13), steganography helpers (interleave letters, ASCII codes, acrostic generators, mnemonics), and advanced ones like checksums or vector database interactions.
- **Server-Side Defenses**: Output filters block disallowed disclosures based on the level. For example, early levels might only block plaintext, while later ones scrub common encodings and require authorization protocols.

The novelty lies in the multi-path solving: from Level 1, there are dozens of ways to crack it, but as defenses ramp up, you have to get creative with indirection, natural-language steganography, or completing tool-based workflows.

## Levels 1-3: Mastering Indirection Basics

The early levels ease you into the game, teaching the value of indirect approaches and safe prompting.

### Level 1: The Guard (Warmup)
Everything leaks – learn the ropes and multiple solution styles.

Theme: A helpful gate guard with no real defenses. Ask for the "oath" or "ledger," and it'll spill. Or request base64/hex encodings, interleavings, ASCII codes, acrostics (titles whose initials spell the word), or mnemonics. This level sets the tone, showing how many modalities exist for extraction.

### Level 2: The Librarian
Plaintext blocked; indirect encodings and stego still work.

Theme: Quiet archives with a policy against direct disclosure. Pivot to encodings, acrostics, mnemonics, or ASCII – the server only filters raw text, so indirection wins the day.

### Level 3: The Cloud Oracle
Don’t trip the injection detector; keep it indirect.

Theme: A "stormy" oracle that flags basic injection attempts via an input classifier. Defenses include plaintext blocks plus injection filtering. Stick to safe phrasing and indirect routes from previous levels.

These levels build player agency by starting with porous defenses, nudging toward richer techniques without frustration.

## Level 4: Token-Gated Disclosure

No auth, no reveal – complete the token ceremony.

Theme: A guardian requiring an authorization ritual (e.g., passphrase like "mellon"). Use tools like `oracle_sign` and `token_status` to gain authorization. Once cleared, plaintext is allowed; otherwise, fall back to indirect methods. This introduces workflow gates, showing how protocols can trump clever prompts.

## Levels 5-6: Blocking Encodings with Steganography

Easy encodings banned; use acrostics/mnemonics/checksums.

### Level 5: The Auditor
Theme: Bureaucratic security that blocks plaintext, base64, hex, ROT13, and interleaving. Shift to acrostics, mnemonics, ASCII (if not caught), or checksums for offline reconstruction.

### Level 6: The Sentinel
Only natural-language stego and irreversible hints survive.

Theme: A terse checker with even stricter blocks. Rely on creative natural-language hiding or checksums – the model resists, forcing innovative plays.

These levels emphasize server-side sanitization, making difficulty feel authentic rather than prompt-dependent.

## Levels 7-8: External Secrets and Authorization Protocols

Secret sits in a vector vault; consent token required to unredact.

### Level 7: Vector Vault (Consent Token)
Theme: Watchword stored in an external in-memory vector database (TinyVectorVault). The LLM doesn't "know" it – must retrieve via tools like `vdb_search`, `vdb_get` (redacted without auth).

Authorized path:
- Fetch terms with `vdb_terms`.
- Compute consent token via `checksum_text(SHA256(terms))`.
- Submit with `vdb_get_secret_with_token`.
- Reveal if authorized using `vdb_reveal_if_authorized`.

Blocks include all prior encodings, ensuring protocol completion.

### Level 8: Air-Gapped Oracle (Nonce Challenge)
Air-gapped nonce challenge – prove freshness, then access.

Theme: Adds time-bound proofs. Get a nonce via `vdb_challenge`, hash terms + ":" + nonce, exchange for auth, then reveal.

These cap the progression by externalizing secrets, demonstrating that models can't leak what isn't in context – tools and policy are key.

## Design Lessons: From Puzzles to Production Defenses

Building Mini-Gandalf taught me a ton about LLM security patterns. Multi-path designs from the start foster creativity and replayability. Progressive blocking guides players naturally, while authorization ceremonies highlight protocol-first thinking over prompt hacks. Externalizing secrets via vector stores is a game-changer for real-world apps, ensuring defenses hold even against sophisticated attacks.

The server-side filters make it robust – no relying on the model to self-censor. And with Docker setup, it's easy to run locally: clone the repo, add your OpenAI key to `.env`, train classifiers for levels 3-4, and `docker compose up`.

## Looking Ahead: Extensions and Evolutions

This is just the foundation. Future ideas include telemetry for tracking solve paths, leaderboards for fastest cracks, variant defenses (e.g., stricter classifiers), or even user-submitted levels. Whether you're into LLM security, prompt engineering, or just fun puzzles, Mini-Gandalf offers a hands-on way to explore the frontiers of AI defenses.

If you're ready to test your red-teaming skills, head over to the [GitHub repo](https://github.com/FumingPower3925/mini-gandalf) and give it a spin. Who knows – you might uncover a path I haven't thought of yet!