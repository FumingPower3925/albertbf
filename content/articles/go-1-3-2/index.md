---
title: "Go 1.3.2: The Borrowed Identity"
date: 2026-10-07
description: "Go 1.3.2 closed a TLS hole that let clients inherit identities without proof, fixed cgo callback corruption, and un-shipped a GC fix in eighteen minutes."
tags: [go, go-history]
series: go-version-by-version
links:
  - { label: "Go 1.3.2 (release history)", url: "https://go.dev/doc/devel/release#go1.3.2" }
  - { label: "TLS resumption fix", url: "https://github.com/golang/go/commit/64df53ed7f46db4a404812e2ef347521dc95a039" }
  - { label: "cgo callback fix", url: "https://github.com/golang/go/commit/7283e08cbf06bcd32a391183e26080cff301e7f" }
---

Go 1.3.2 shipped on 25 September 2014, six weeks after 1.3.1.[^rel] Nine commits sit between the tags, seven carrying Andrew Gerrand's name and two Russ Cox's, and the release note is again one paragraph with no blog post.[^rel] It is a security release wearing a point release's clothes: one identity bug, one corruption bug, and a third fix that landed and un-landed on the same August afternoon.

## The borrowed identity

The headliner is a security bug in `crypto/tls`, and it dated back to Go 1.1. If a server authenticated clients with certificates (rare) and explicitly set `SessionTicketsDisabled` to true, a malicious client could falsely assert ownership of any client certificate it wished. The issue was discovered internally, and there is no evidence of exploitation.[^tls]

Session resumption is an abbreviated handshake: both sides reuse the master secret from an earlier session, and the server never sees a fresh proof of possession, the CertificateVerify message. That is safe when resumption is a deliberate feature. The bug was that `SessionTicketsDisabled` disabled only half of it: the server stopped issuing tickets but kept honoring presented ones, `decryptTicket` and `checkForResumption` having no gate at all. A client holding a ticket from an earlier certificate-authenticated session, issued before the flag was flipped, could reconnect and inherit that verified identity while presenting nothing.[^tls]

The fix is a gate in each of the two places. The regression test performs the flag flip against `openssl s_client` (RC4-SHA, of all ciphers), saving a session before the flip and presenting it after, and ends with a comment of unusual honesty: "One needs to manually confirm that the handshake in the golden data file for ResumeDisabled does not include a resumption handshake."[^tls]

Replaying it takes a Go client and server, a cached session, and the flag flipped between connections: connect once with a client certificate, disable tickets, reconnect presenting the ticket but no certificate. On the old server the second handshake succeeds and the server logs the inherited identity; on the new one it fails asking for a certificate:[^repro]

```
$ go run tlsresume.go     # go1.3.1
server conn1: ok, peer certs: [testclient]
client conn1 (with cert): ok
client conn2 (no cert): ok
server conn2: ok, peer certs: [testclient]
$ go run tlsresume.go     # go1.3.2
server conn1: ok, peer certs: [testclient]
client conn1 (with cert): ok
server conn2: handshake failed: tls: client didn't provide a certificate
client conn2 (no cert): dial failed: remote error: bad certificate
```

The second connection proves nothing and inherits everything: the server records peer certs `[testclient]` for a client that sent no Certificate message at all. That is the borrowed identity.

## The dangling frame

The cgo fix starts in May, on ARM, with an OpenSSL wrapper. leterip's report: tip crashes with "unexpected return pc ... called from 0xffffffff" where 1.2.1 passed everywhere and tip passed on amd64, 386, and darwin. Only linux/arm failed. He could not simplify the repro further and offered ssh access to a ready-to-go box.[^cgo]

Then the sightings spread: Brad Fitzpatrick on the linux-386-387 builder, another reporter on OSX 10.8.5, and Hector Martin on linux-amd64, a libjpeg wrapper with callbacks under load testing. Russ's reply to the ssh offer was two words, "Too late", and the issue moved to the 1.4 milestone.[^cgo]

Martin's diagnosis, posted twice under two addresses, nailed it: `cgocallbackg` breaks the `entersyscall`/`exitsyscall` contract. Entering a syscall records the caller's stack pointer for the GC and the traceback code, but returning from a C-to-Go callback that frame is already gone, leaving `g->syscallsp` dangling. His comment includes an ASCII diagram of the stacks.[^cgo] Dmitry Vyukov: "we need to fix it for 1.4. It renders cgo callbacks broken." Martin's master fix saves the syscall pc and sp around the callback and restores them through a new `reentersyscall`, plus a check in `exitsyscall` that throws "syscall frame is no longer valid" when the recorded frame is clearly gone. Russ then did a manual backport to the 1.3 branch for 1.3.2, warning that the bug "can cause arbitrary corruption in programs that call into C from Go and then call back into Go from C."[^cgo]

The regression test stages a Go-to-C-to-Go round trip with atomic handshakes and checks the goroutine's stack at four points: in C before the callback, in Go during it, in C after it, in Go after the return. The adapted program:[^repro]

```
$ GOTRACEBACK=2 go run cgocb.go     # go1.3.1
in-c-before-cb: ok
in-go-during-cb: ok
in-c-after-cb: bad stack: found runtime.cgocallback
in-go-after-cgo: ok
FAIL: 1 bad stacks
$ GOTRACEBACK=2 go run cgocb.go     # go1.3.2
in-c-before-cb: ok
in-go-during-cb: ok
in-c-after-cb: ok
in-go-after-cgo: ok
PASS
```

Back in C after the callback, the old runtime still traces the goroutine through the dead callback frames, `runtime.cgocallbackg` at cgocall.c:244 on top of a stack that no longer exists. The GC reads the same fiction when it scans.

## Eighteen minutes

The strangest two commits sum to nothing. Dmitry Vyukov reported that `markfreed` updates the GC bitmap non-atomically while other threads mark, losing mark bits; he caught it red-handed by sleeping ten microseconds in `markfreed` and watching net/http tests die with "markfreed messed bitmap: 0x1000->0x100000001000" and "fatal error: BAD".[^gc]

The master fix landed, and Russ doubted it happened outside synthetic conditions: "Does it really happen?" Dmitry: one bitmap word covers 128 bytes, "doing selects can trigger this race", and he voted for 1.3.1. Russ: "Approved for Go 1.3.1 but I don't feel good about this."[^gc]

At 13:20 on 13 August, Gerrand applied the port to the release branch. At 13:38 he reverted it: "It broke the build across all platforms. The original change wasn't even reviewed. Probably should never have been ported to this branch." Russ: "This corruption is hypothetical. Until we see it without artificial sleeps, this can wait until 1.4 or 1.3.2." It waited: nothing re-landed the port, the pair nets to an empty diff, and 1.3.2 shipped without the fix. The fix itself shipped in 1.4.[^gc]

## Roundup

Russ disabled the flaky `TestIssue7264`, a thousand-iteration httptest loop: "This fails on my OS X machine, just like it did in default branch... It's just buggy." The whole fix is one line, `t.Skip("broken test - removed at tip")`.[^test] The documentation picks are the 1.3.2 note itself, a corrected revision in the 1.3.1 note's change-history link, and the removal of the doubled "the" this series quoted from the 1.3.1 notes, gone from the page since 15 August (the 1.3.1 article now carries a correction).[^docs]

Go 1.3.3 followed five days later, on 30 September, with further fixes to cgo, the runtime, and the nacl port.[^minor]

[^rel]: [Release History](https://go.dev/doc/devel/release#go1.3.2), the source for the 25 September 2014 date and the commit count: nine commits between the `go1.3.1` and `go1.3.2` (`f3c81ed8`) tags, seven by Gerrand and two by Cox, spanning 13 August to 25 September. As committed, on both branch and master, the note reads "bug fixes to cgo and the crypto/tls packages"; the live page now says "security fixes to the crypto/tls package and bug fixes to cgo", reworded after the history moved to the website repo. Like 1.3.1, the release got no blog post (`/blog/go1.3.2` is a 404).
[^tls]: The advisory quoted above is the message of [`247820ff`](https://github.com/golang/go/commit/247820ff6bfba6e1b7891f4bfc25511d68761d5d), Gerrand's 25 September cherry-pick: client-certificate authentication plus `SessionTicketsDisabled` since Go 1.1, internal discovery, no evidence of exploitation. The master fix is [commit `64df53ed`](https://github.com/golang/go/commit/64df53ed7f46db4a404812e2ef347521dc95a039), "ensure that we don't resume when tickets are disabled", Adam Langley, 26 September 2014 (CL 148080043, LGTM=r): the two gates plus `TestResumptionDisabled` with its openssl transcript and golden files.
[^cgo]: [Issue 7978](https://github.com/golang/go/issues/7978), "crash on arm (unexpected return pc) around tip with large cgo library", leterip: the ARM-only OpenSSL crash, the ssh offer, and Russ's "Too late". The thread collects the 386-builder, OSX, and amd64 sightings, Martin's twice-posted diagnosis with its stack diagram, and Dmitry's "renders cgo callbacks broken". Fixed on master by [commit `7283e08c`](https://github.com/golang/go/commit/7283e08cbf06bcd32a391183e26080cff301e7f), Hector Martin Cantero, 24 September 2014 (CL 131910043, LGTM=dvyukov, rsc). Russ's manual backport is [`7935b51b`](https://github.com/golang/go/commit/7935b51b8b5cbc07f572a28dc2f82e03e5fcb449) (CL 142690043, LGTM=iant), including the adapted stack-trace test run above.
[^gc]: [Issue 8299](https://github.com/golang/go/issues/8299), "markfreed corrupts GC bitmap", Dmitry Vyukov: the non-atomic update, the `usleep(10)` trap, the net/http catch, and "doing selects can trigger this race". Fixed on master by [commit `5bfe8ade`](https://github.com/golang/go/commit/5bfe8adee5100444cdde78d4897d1673df96c81) (CL 103640044). Gerrand's branch port [`df7a37ef`](https://github.com/golang/go/commit/df7a37efd74b3b9bca093eadf0ed596c745efce6) landed 13:20 on 13 August and his revert [`7769be7d`](https://github.com/golang/go/commit/7769be7d2f10cedc653d654b6c9924bcbf5d4480) followed at 13:38; the diff between the 1.3.1 tag and the revert is empty. (`941ef9ddbada`, named in the revert and the issue, is the port's Mercurial ID; it does not resolve on GitHub.)
[^test]: [`a3bfff1f`](https://github.com/golang/go/commit/a3bfff1fbd67a91c1397abf5ec0332ac636c5360), Russ Cox, 25 September 2014 (CL 144610043, LGTM=bradfitz): the one-line skip, matching the test's removal at tip.
[^docs]: [`ef34616d`](https://github.com/golang/go/commit/ef34616d6b292c3ef30d16e553efcca66c3052f) documents the release; [`4a05139f`](https://github.com/golang/go/commit/4a05139f6fed4755bb49f8fcc2970e38c1778e61) (15 August 2014) removes the doubled word; [`881f0d1e`](https://github.com/golang/go/commit/881f0d1e9e0618cb71987d68e15ab1cedbd31c70) (15 August 2014) points the 1.3.1 change-history link at `073fc578434b` instead of `40272ab1339a`.
[^repro]: The recorded transcripts come from `go1.3.1` and `go1.3.2` toolchains built from the release tags with gcc 4.6.3 on ubuntu 12.04 (`make.bash`, `CGO_ENABLED=0`), as linux/amd64 binaries run in a container, with `runtime.h` and `cgocall.h` installed into `pkg/linux_amd64` afterwards exactly as `dist` would, to allow cgo builds. The TLS certificates (RSA 2048, proper server/client EKUs) were generated with current Go's `crypto/x509`; the server requires and verifies client certs, the client caches one session, and the tickets flag flips between the two connections. The callback program adapts the backported `misc/cgo/test/issue7978.go` to `package main` and runs with `GOTRACEBACK=2`.
[^minor]: [Release History](https://go.dev/doc/devel/release), the source for the 30 September 2014 date of Go 1.3.3, the next release in the series.
