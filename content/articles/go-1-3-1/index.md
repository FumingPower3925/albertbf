---
title: "Go 1.3.1: The Bad Character"
date: 2026-10-06
description: "Go 1.3.1 fixed a miscompile that corrupted bytes, a resolver crash on eight-letter words, and a liveness analysis that took 30 seconds to compile a literal."
tags: [go, go-history]
series: go-version-by-version
links:
  - { label: "Go 1.3.1 (release history)", url: "https://go.dev/doc/devel/release#go1.3.1" }
  - { label: "Byte-sized magic multiply fix", url: "https://github.com/golang/go/commit/5b63ce4e1929914da33a0a53a0a2868b3fb092d2" }
  - { label: "Liveness 10x fix", url: "https://github.com/golang/go/commit/7aa3031ebaa5dc641808f55cb1cb27ddc409fbca" }
---

Go 1.3.1 shipped on 13 August 2014, eight weeks after Go 1.3.[^rel] Sixteen commits sit between the tags, and every one of the fifteen cherry-picks carries Andrew Gerrand's name, thirteen of them landed on 12 and 13 August. There is no blog post and the whole release note is one paragraph in the release history, complete with a doubled word: "bug fixes to the compiler and the the runtime, net, and crypto/rsa packages."[^rel]

It is a point release in the classic mold: one miscompile, three panics, a spurious connect, and a compile-time fix worth ten times its weight.

## The bad character

The lead bug came from a service upgrade. After moving to Go 1.3, psnim2000's program started emitting garbage from a generator constrained to `[A-Z0-9]`: lowercase letters and punctuation where none should be possible, bytes the reporter was not even sure were valid UTF-8.[^8325]

Rémy Oudompheng reduced it to a byte modulo. His test, committed verbatim as `test/fixedbugs/issue8325.go`, indexes into an alphanumeric string with `b % byte(len(alphanum))` and panics on anything outside `[0-9A-Z]`.[^8325] The culprit was the byte-sized magic multiply in `6g` and `8g`: division by a constant gets compiled into a multiplication by a magic number, and the byte-sized version of that optimization got it wrong. Russ Cox's fix of 11 August corrects the code generation and adds the test.[^8325]

The test needs no adaptation. On the old toolchain it finds the bad character; on the new one it prints nothing:[^repro]

```
$ go run issue8325.go     # go1.3
found a bad character
panic: BUG
$ go run issue8325.go     # go1.3.1
$
```

The same byte-modulo expression, printing its result so there is something to see. Hit Run.

```go run title="alphanum.go"
package main

import "fmt"

const alphanum = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

func main() {
	bytes := []byte{95, 96, 83, 102, 88, 100}
	for i, b := range bytes {
		bytes[i] = alphanum[b%byte(len(alphanum))]
	}
	fmt.Printf("%q\n", bytes)
}
```

```output
"NOBUGS"
```

## Liveness, ten times faster

Go 1.3's precise stacks were computed by a brand-new liveness analysis, and the analysis was slow. Brad Fitzpatrick filed the numbers: compiling a slice of interface literals took 0.003 seconds at 100 elements, 4 seconds at 5,000, and 29 seconds at 14,000, growing worse than linearly.[^8354] A second report, table-driven test code taking forever to build, gave Russ Cox's fix its headline case: `x.go` compiling in 9.48 seconds before and 0.84 after.[^live]

The fix, landed 6 August, has three parts: an O(n) variable lookup becomes O(1), an O(n²) check that exists purely for debugging now runs only under the debugging flags, and sparse bitmaps are iterated word by word.[^live] The commit message carries the full table, `x100.go` through `x10000.go`, topping out at 13.78 seconds against 2.09.

The shape reproduces exactly. Generating the issue's interface slices at 3,000 and 6,000 elements:[^repro]

```
$ time go build -o x3-13 x3000.go     # go1.3
real  0m0.731s
$ time go build -o x3-131 x3000.go    # go1.3.1
real  0m0.254s
$ time go build -o x6-13 x6000.go     # go1.3
real  0m2.626s
$ time go build -o x6-131 x6000.go    # go1.3.1
real  0m0.562s
```

Doubling the input nearly quadruples the old compiler's time (0.73 to 2.63 seconds) while the new one a bit more than doubles (0.25 to 0.56): 2.9x faster at 3,000 elements, 4.7x at 6,000.

## Eight characters

Jakob Borg reported that Go crashed parsing his `resolv.conf`: an off-by-one between a length check and a slice index meant any unrecognized eight-character option on an `options` line panicked the resolver.[^8252] His example was `options attempts 1`, "attempts" being exactly eight letters.

The bug is one line in `dnsconfig_unix.go`: the guard reads `len(s) >= 8` while the slice reads `s[0:9]`, so an eight-byte field passes the check and explodes on the index.[^8252] Borg's July fix corrects the bound and adds a test embedding his exact configuration, nameservers `10.60.60.151` and all.[^8252]

Replaying it needs the pure Go resolver, so both binaries below are built with `CGO_ENABLED=0`; otherwise libc parses the file and the bug never triggers. With his configuration in place:[^repro]

```
$ ./resolv2-13     # go1.3
panic: runtime error: slice bounds out of range
net.dnsReadConfig(...)
$ ./resolv2-131    # go1.3.1
addrs: [] err: read udp 127.0.0.1:53: connection refused
```

A panic becomes an ordinary lookup error. (The nameserver here points at localhost so the fixed binary answers at once instead of waiting out timeouts to Borg's original addresses.)

## The short session key

The crypto fix has no issue number. Cedric Staub noticed that decrypting a short message into a longer session-key buffer walked out of bounds: the constant-time copy loops over the length of the destination, so a 1-byte message copied into a 32-byte key reads 31 bytes past the message.[^rsa] Constant-time code cannot branch away from the overrun; that is the point of it being constant-time.

Adam Langley's July fix restructures the decryption to return the full padded block plus an index, so the copy always reads from a correctly-sized tail, and hardens `ConstantTimeCopy` itself to panic loudly on mismatched lengths instead of overrunning them.[^rsa] The added `TestShortSessionKey` is exactly the program below, which encrypts one byte and decrypts it into 32. Hit Run.

```go run title="rsashort.go"
package main

import (
	"crypto/rand"
	"crypto/rsa"
	"fmt"
)

func main() {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		panic(err)
	}
	ciphertext, err := rsa.EncryptPKCS1v15(rand.Reader, &priv.PublicKey, []byte{1})
	if err != nil {
		panic(err)
	}
	var key [32]byte
	err = rsa.DecryptPKCS1v15SessionKey(nil, priv, ciphertext, key[:])
	fmt.Println("err:", err)
	modified := false
	for _, v := range key {
		if v != 0 {
			modified = true
		}
	}
	fmt.Println("key modified:", modified)
}
```

```output
err: <nil>
key modified: false
```

Against the old toolchain, the same file panics:[^repro]

```
$ go run rsashort.go     # go1.3
panic: runtime error: index out of range
$ go run rsashort.go     # go1.3.1
err: <nil>
key modified: false
```

## The spurious connect

The networking fix has the widest blast radius, and the best paper trail. coocood ran a sentinel: it dialed other applications to detect failures, reading a nil error as proof of life. After the move to Go 1.3, dead hosts started reporting alive. He compared the source against 1.2 and fingered the rewritten `connect` in `net/fd_unix.go`.[^epoll]

Jason Eggleston diagnosed it down to the syscall order. Go registered the socket with epoll *before* connecting: `fd.dial` called `fd.init`, which flowed through `runtime_pollOpen` to `epoll_ctl(ADD)`, and only then issued `connect`. A second thread blocked in `epoll_wait` could wake with an `EPOLLOUT|EPOLLHUP` event for a socket that `connect` had not even been called on yet; Go took the descriptor for ready, `getsockopt` found no error pending (`EINPROGRESS` is not one), and the dial returned success. Polling a file descriptor before connecting it is undefined behavior, and he brought the cross-project receipts: nginx also adds before connecting, but runs one thread per epoll instance, so nothing witnesses the window; libuv, under node and Rust, calls `connect` first and registers the fd after, on every platform.[^epoll]

Reproducing it takes garton's loop, dialing a down host on repeat and counting the nil errors:[^repro]

```
$ go run epollock.go     # go1.3
attempts=300 nil-errors=95 first-write-err=write tcp 10.255.255.1:12345: i/o timeout
$ go run epollock.go     # go1.3.1
attempts=300 nil-errors=0 first-write-err=<nil>
```

Ninety-five dials out of three hundred report success against an address that answers nothing, and the phantom connections are good for nothing: the first write hangs until its deadline. On the fixed toolchain every dial waits out its hundred milliseconds and times out. (The repro needs a true black hole: a host answering RST, or a network returning ICMP unreachable, settles the connect and the window never opens. `10.255.255.1` goes unanswered in this container.)

The fix reorders the two calls: `fd.init` moves to after `connect` returns `EINPROGRESS`, with care for a `connect` that succeeds immediately against localhost, which registers the fd and returns without entering the wait loop. The deadline travels into `connect` with the move.[^epoll]

Even the merge has texture. Russ Cox balked: a big change whose description said it "could be" the fix, for a point release. Then he approved it, with a warning that has outlived the bug: "This code needs to stop changing. It seems to get rewritten on every release... If the rewrites can't stop on their own, we will have to introduce an explicit freeze for large parts of package net." Mikio Hara's reply owned the history: the bug dated to Go 1.1, and he had missed the new poller's spurious-readiness warning when reworking the code for DragonFly's async connects in 1.3. "so pls blame me, ugh."[^epoll]

## The recursive typedef

Two cgo reports, one root cause. Jonathan Plona's build crashed inside `cmd/cgo` itself, a nil pointer dereference in `typeConv.Type` on a recursive use of typedefs. jvshahid got the stranger symptom: an intermittent compilation error, `cannot use o.a (type *C.inner) as type *C.struct___0`, that printed a few times and then went away if you kept re-running the build. His complaint reads like a motto for deterministic builds: the compiler should either always fail or always succeed.[^cgo]

Both bugs lived in cgo's DWARF type translation. Translating a typedef recursed into the underlying type first and patched up the Go mapping after, but the recursion could loop back through a struct naming the same typedef again, pocketing the not-yet-patched mapping on the way. Which half-finished mapping each pointer ended up with varied run to run: sometimes a crash, sometimes a type error, sometimes clean. Matthew Dempsky's debugging is visible in the issue: he first blamed GCC, attaching object files and readelf diffs to prove the DWARF differed run to run, then turned on `-debug-gcc` and watched cgo hand GCC the types in a different order each time. cgo was randomizing its own input.[^cgo]

The thread also holds the series' best exchange about tricky code. Ian Lance Taylor: "This bit of code in cgo is really bothering me now. We've had to change it several times, and it's not getting any simpler or easier to understand. Can you think of any way to make this simpler so that we can believe that it is correct?" Dempsky, who had already uploaded a fix: "it took me a long time to understand what was even going on here :(" Then came the insight behind the final patch: pointers are the only way a type can recurse, so translating pointer targets through a completion queue instead of recursion breaks every cycle at once. Russ approved it the way he approved the epoll fix, reluctantly and on the strength of the test: "it fixes intermittent crashes that have no workaround (other than try again)."[^cgo]

The regression test is two mutually recursive structs with the comment "No runtime test; just make sure it compiles." Fifteen runs of `go tool cgo` on the adapted file, dots for clean runs:[^repro]

```
$ for i in $(seq 1 15); do rm -rf _obj; go tool cgo typedef.go >/dev/null 2>&1 && echo -n . || echo -n X; done; echo     # go1.3
XXX.X.XXX.XXX.X
$ for i in $(seq 1 15); do rm -rf _obj; go tool cgo typedef.go >/dev/null 2>&1 && echo -n . || echo -n X; done; echo     # go1.3.1
...............
```

Eleven crashes out of fifteen on the old toolchain, each the same nil-pointer panic; fifteen clean runs on the new one. (This drives `cmd/cgo` directly, which is where the bug lives; the full `go build` path needs a cgo-enabled toolchain build.)

## Roundup

The rest in brief: `ParseMultipartForm` gets documentation for its Go 1.3 behavior of requiring a multipart Content-Type.[^8403] Windows stops crashing when foreign threads raise exceptions inside the Go handler, fixed by Shenghou Ma.[^win] ARM stops printing a harmless "unexpected return pc" when a profiling signal lands at the wrong moment, an event the reporter measured at about one in fifteen minutes.[^arm] The `8g` toolchain builds again after an undefined `D_R15B` broke it.[^8g] NaCl/amd64p32 loses its leftover traceback panics; the cause, that `newproc` takes two extra pointers rather than two extra registers and the two differ on amd64p32, was diagnosed before the 1.3 tree froze but missed the cut.[^nacl] The build learns `_DEFAULT_SOURCE` for glibc 2.20, which started deprecating `_BSD_SOURCE`.[^glibc] And two documentation-only picks round out the sixteen: a note that `gzip`/`zlib` `Close` flushes, and HTTPS scheme cleanup across the docs.[^docs]

Go 1.3.2 followed on 25 September with security fixes to `crypto/tls` and further cgo fixes.[^minor]

[^rel]: [Release History](https://go.dev/doc/devel/release#go1.3.1), the source for the 13 August 2014 date, the one-paragraph note (doubled word included), and the commit count: sixteen commits between the `go1.3` (`1cdd48c8`) and `go1.3.1` (`f466851b`) tags. Unlike 1.3, the point release got no blog post (`/blog/go1.3.1` is a 404).
[^8325]: [Issue 8325](https://github.com/golang/go/issues/8325), "Slice access of const causes strange string errors", psnim2000: the `[A-Z0-9]` generator emitting lowercase and punctuation on 1.3 but not 1.2. Fixed by [commit `5b63ce4e`](https://github.com/golang/go/commit/5b63ce4e1929914da33a0a53a0a2868b3fb092d2), "fix, test byte-sized magic multiply", Russ Cox, 11 August 2014 (CL 124950043, LGTM=r): "Credit to Rémy for finding and writing test case." Cherry-picked as [`3fa4a784`](https://github.com/golang/go/commit/3fa4a7849c51eaad5a5c67f80489e0e12ff10005).
[^8354]: [Issue 8354](https://github.com/golang/go/issues/8354), "superlinear slow-down compiling slice of interface literal", Brad Fitzpatrick, with the 100-to-14000 timing table quoted above.
[^live]: [Commit `7aa3031e`](https://github.com/golang/go/commit/7aa3031ebaa5dc641808f55cb1cb27ddc409fbca), "make liveness ~10x faster", Russ Cox, 6 August 2014 (CL 125720043, LGTM=iant, r): the O(1) lookup, the debug-only O(n²) check, `bvnext`, and the `x.go`/`x100.go`…`x10000.go` table, all quoted from the message. Fixes #8354 and [issue 8259](https://github.com/golang/go/issues/8259) ("go build takes too long to compile table driven test code"). Cherry-picked as [`69dc3a91`](https://github.com/golang/go/commit/69dc3a910f5fbd37d9ead0147ca8bc8c998c7d01).
[^8252]: [Issue 8252](https://github.com/golang/go/issues/8252), "slice bounds out of range parsing resolv.conf with unknown eight character options", calmh (Jakob Borg), with the `options attempts 1` configuration. Fixed by [commit `0a5cb7dc`](https://github.com/golang/go/commit/0a5cb7dc49263ff63e09dfca27df5888e55aeeba), 15 July 2014 (CL 117250043): the bound becomes `len(s) > 8` and `TestDNSConfig` embeds the reporter's configuration verbatim. Cherry-picked as [`1798bb29`](https://github.com/golang/go/commit/1798bb298f5339f7aebcac819e70f3314926fcb5).
[^rsa]: [Commit `372f399e`](https://github.com/golang/go/commit/372f399e00693b1d49bc1243feb66f2c9bf0dd5c), "fix out-of-bound access with short session keys", Adam Langley, 2 July 2014 (CL 102670044, LGTM=davidben, bradfitz): "Thanks to Cedric Staub for noting that a short session key would lead to an out-of-bounds access when conditionally copying the too short buffer over the random session key." Restructures `decryptPKCS1v15` around an explicit index, adds the length-mismatch panic to `ConstantTimeCopy`, and adds `TestShortSessionKey`. Cherry-picked as [`78a4cf7f`](https://github.com/golang/go/commit/78a4cf7f39dd1bd3debedc85d736b35aabec7d5b).
[^epoll]: [Issue 8276](https://github.com/golang/go/issues/8276), "dial to a non-existent address doen't return an error", typo included, coocood: the sentinel that read nil errors as proof of life, caught on CentOS 6.3 in production and reproduced on stock Ubuntu 14.04, bisected to the rewritten `connect`. [Issue 8426](https://github.com/golang/go/issues/8426), "connect after polling initialization", Jason Eggleston: the syscall-order diagnosis, the `EPOLLOUT|EPOLLHUP` mechanism, the nginx and libuv comparisons, and garton's millisecond repro loop with its black-hole condition. Fixed by [commit `c0325f50`](https://github.com/golang/go/commit/c0325f50832489f2060549d6b19ce156df45b044), "prevent spurious on-connect events via epoll on linux", Mikio Hara, 29 July 2014 (CL 120820043, LGTM=dvyukov): "All credit to Jason Eggleston". Russ's "this code needs to stop changing" approval and Mikio's "so pls blame me, ugh" are comments 20 and 21 on #8426. Cherry-picked as [`1657de2d`](https://github.com/golang/go/commit/1657de2d6dbb020e15908668f209f3be7dcef151).
[^cgo]: [Issue 8368](https://github.com/golang/go/issues/8368) ("go 1.3 panics on recursive use of typedef"), Jonathan Plona: the `typeConv.Type` nil-pointer crash, plus quarnster's drive-by patch ("unsure if it's correct") and "Sorry, I don't have time over to do it proper I'm afraid" when asked to follow the contribution process. [Issue 8441](https://github.com/golang/go/issues/8441) ("intermittent compilation errors"), jvshahid: the `*C.inner` vs `*C.struct___0` flip-flop, Dempsky's GCC-then-cgo debugging arc, Ian's "so that we can believe that it is correct", and Russ's "(other than try again)" approval. Fixed by [commit `0da4b2db`](https://github.com/golang/go/commit/0da4b2dbc20e6d8a01bb44516257fda56e713523), "fix recursive type mapping", Matthew Dempsky, 5 August 2014 (CL 122850043, LGTM=iant): pointer mappings join a completion queue instead of completing inline. The run above uses `misc/cgo/test/issue8441.go` adapted to `package main`. Cherry-picked as [`b0454f5d`](https://github.com/golang/go/commit/b0454f5d2b6acfb291d44a7281b0aef461ac6807).
[^8403]: [Issue 8403](https://github.com/golang/go/issues/8403), "document that ParseMultipartForm requires Content-Type: multipart/form-data as of Go 1.3": a documentation-only cherry-pick of Brad Fitzpatrick's note.
[^win]: [Issue 8224](https://github.com/golang/go/issues/8224), "crash while in Go exception handler on windows", fixed by [commit `a1778ec1`](https://github.com/golang/go/commit/a1778ec1462c2f3f8865e02e5fd7e72ee25c2b64), "ignore exceptions from foreign threads", Shenghou Ma, 9 July 2014.
[^arm]: [Issue 8153](https://github.com/golang/go/issues/8153), "spurious prints during profiling on arm (about 1 in 15 minutes)", fixed by [commit `e5e547c7`](https://github.com/golang/go/commit/e5e547c71f72722ca5fdd8ee67cf75f99ee586cf), "turn off 'unexpected return pc' print on arm traceback", Russ Cox, 6 August 2014: "It can happen legitimately if a profiling signal arrives at just the wrong moment. It's harmless."
[^8g]: [Issue 8510](https://github.com/golang/go/issues/8510), "build failed: undefined D_R15B", fixed by [commit `b5674a2b`](https://github.com/golang/go/commit/b5674a2b728d174bbd30be8e655b003528056d9f), Shenghou Ma, 11 August 2014.
[^nacl]: [Issue 8199](https://github.com/golang/go/issues/8199), "leftover panics in traceback on nacl/amd64p32", fixed by [commit `84a36434`](https://github.com/golang/go/commit/84a36434d92e18eb12d8a86770bdb4936dff4703), Russ Cox, 27 June 2014: "newproc takes two extra pointers, not two extra registers. On amd64p32 (nacl) they are different." The message notes it was "diagnosed before the 1.3 cut but the tree was frozen".
[^glibc]: [Commit `b48cd4b9`](https://github.com/golang/go/commit/b48cd4b9dcb6cefb8dcff6ee571234620a879b68) cherry-picks the `_DEFAULT_SOURCE` definition for glibc 2.20, whose release notes deprecate `_BSD_SOURCE`.
[^docs]: The `compress/{gzip,zlib}` Close-flushes note ([`329d3ce9`](https://github.com/golang/go/commit/329d3ce984fdf2478f15e834076aa38957972e00)) and the HTTPS link-scheme cleanup ([`57435625`](https://github.com/golang/go/commit/57435625e5037643f74a23b80b74bb60dac37125)).
[^repro]: The runnable cells run on current Go. The recorded transcripts come from `go1.3` and `go1.3.1` toolchains built from the release tags with gcc 4.6.3 on ubuntu 12.04 (`make.bash`, `CGO_ENABLED=0`), as linux/amd64 binaries run in a container. `issue8325.go` is the regression test file verbatim from the tree. The resolver binaries were built `CGO_ENABLED=0` to force the pure Go resolver; `/etc/resolv.conf` was restored after the runs. The dial loop follows garton's program from issue 8426, counting nil errors over 300 dials to `10.255.255.1`, whose SYNs go unanswered in the container; the first-write probe carries a 200ms deadline. The cgo runs drive `cmd/cgo` directly on the issue8441 regression file as `package main`; each X is the nil-pointer panic.
[^minor]: [Release History](https://go.dev/doc/devel/release), the source for the 25 September 2014 date of Go 1.3.2, the next release in the series.
