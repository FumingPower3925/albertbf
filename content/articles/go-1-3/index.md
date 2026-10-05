---
title: "Go 1.3: The Hot Spot"
date: 2026-10-05
description: "Go 1.3 gave every goroutine a contiguous stack and a precise collector, then nearly shipped a 4KB default that turned Bolt seventy times slower."
tags: [go, go-history]
series: go-version-by-version
links:
  - { label: "Go 1.3 release notes", url: "https://go.dev/doc/go1.3" }
  - { label: "Go 1.3 is released (blog)", url: "https://go.dev/blog/go1.3" }
  - { label: "Contiguous stacks design doc", url: "https://go.dev/s/contigstacks" }
  - { label: "Go 1.3 linker overhaul", url: "https://go.dev/s/go13linker" }
---

Go 1.3 shipped on 18 June 2014, six months after Go 1.2, with no language changes at all.[^rel] The 1,710 commits between the tags are almost entirely implementation: a new stack, a precise collector, a refactored linker, four new platforms. The first two share a single root. For the first time, the runtime knew exactly which stack words were pointers, and it spent that knowledge twice.

## The hot spot

Until 1.3, every goroutine stack was a chain of 8KB segments. A call that crossed the end of a segment ran `morestack`, which allocated a fresh segment; the return ran `lessstack`, which freed it. A program sitting exactly on a boundary paid that alloc/free pair on every iteration of a loop. The design document calls this the hot split problem, and its benchmark runs the same program both ways: 5.37 seconds on segmented stacks, 1.26 on contiguous.[^doc]

The victims were real programs. The document names `encoding/json`'s `BenchmarkEncode`, complained about since bug 3787, and `html/template`'s `BenchmarkEscapedExecute`, whose author found it by hitting a bad case at a 4096-byte segment size.[^doc]

The fix stops splitting: one contiguous stack per goroutine, copied to a larger block when it fills. Copying a stack means finding every pointer into the old block and adjusting it, which needs a map of which stack words are pointers. That map arrived first, in Carl Shapiro's December commit generating pointer maps from liveness analysis.[^ptrmap] The design doc names the dependency outright: "Fortunately, Carl is generating just such a data structure to be used for precise GC."

### A hot split, measured

A small program pins the boundary on purpose: `main` holds a 7KB array while a loop calls a function with a 64KB frame one million times. Built with inlining disabled, every call crosses the end of the 8KB segment:[^repro]

```
$ ./hotspot-122     # go1.2.2
outer[0]=0 elapsed=5.612785s
$ ./hotspot-13      # go1.3
outer[0]=0 elapsed=1.974982s
```

The old runtime allocates and frees a 64KB segment a million times; the new one grows the stack once and never touches it again. The third run is the same 1.3 binary with copying switched off:

```
$ GOCOPYSTACK=0 ./hotspot-13     # go1.3, segmented
outer[0]=0 elapsed=5.133409s
```

Back beside 1.2.2. One environment variable isolates the whole speedup to the stack strategy.

### Landing it

The switch is Keith Randall's "grow stack by copying" of 26 February: on overflow, copy to a stack twice as large when every frame is copyable; at GC time, halve stacks less than a quarter full.[^copy] It was disabled overnight and re-enabled the next afternoon, once stack shrinking moved past the sweep.[^reenable] Precise stacks took the same road a week earlier: enabled 17 February, undone the same day for breaking 32-bit builds, re-enabled on the 19th after the 32-bit fix.[^precise]

The copying commit also cut the default stack from 8KB to 4KB, on the theory that copying ended hot spots for good. Three months later Bolt proved otherwise: Ben Johnson reported `TestBucket_Put_Multiple` taking 0.27 seconds on 1.2.2 and 18.72 on 1.3beta1, a reflect call near the top of the stack inhibiting every copy on that segment.[^bolt] Russ Cox put the default back to 8KB the next day: "Go back to 8kB until stack copying can be used 100% of the time."[^8k]

## Precise collection

Heap collection had been precise since Go 1.1. The stack was still scanned conservatively: any word holding a heap address counted as a root. Go 1.3 spends the pointer maps a second time and scans stacks precisely, so an integer is never again mistaken for a pointer.[^rel]

The program below keeps a 20MB block reachable only as a `uintptr`. Hit Run.

```go run title="precise.go"
package main

import (
	"fmt"
	"runtime"
	"unsafe"
)

// alloc returns ONLY the address as a plain integer.
// The slice header and its pointer die with this frame.
func alloc() uintptr {
	buf := make([]byte, 20<<20)
	return uintptr(unsafe.Pointer(&buf[0]))
}

func main() {
	addr := alloc() // a uintptr, not a pointer

	runtime.GC()
	runtime.GC()
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	fmt.Printf("heap still allocated: %d MB\n", m.HeapAlloc>>20)
	fmt.Printf("integer kept alive across GC: %x\n", addr)
}
```

```output
heap still allocated: 0 MB
integer kept alive across GC: 7e01fa680000
```

The address differs each run; the zero does not. On the old toolchain the block survives both collections:[^repro]

```
$ go run precise.go     # go1.2.2
heap still allocated: 20 MB
integer kept alive across GC: c21003e000
$ go run precise.go     # go1.3
heap still allocated: 0 MB
integer kept alive across GC: c20802c000
```

The integer is alive in both runs. Only 1.2.2 treats its value as a root.

Precision cuts both ways for package `unsafe`. Storing integers in pointer-typed values is illegal and crashes when the runtime detects it. Storing pointers in integer-typed values hides them from the collector and the stack copier alike, so a collection or a stack growth can free the memory out from under the dangling pointer. Code doing the detectable half can be found with `go vet`.[^rel]

## Small maps

Go 1.1's new map implementation forgot to randomize iteration for maps of eight or fewer entries: a single bucket, always walked from the start. Tests written against 1.1 and 1.2 depended on the fixed order and failed only under gccgo, whose maps order differently. Ian Lance Taylor filed the issue in November with a fix sketch: walk each bucket from a random offset.[^mapissue] Josh Bleecher Snyder's January commit implements it, choosing one random intra-bucket offset per iteration, and notes that small-map iteration now has only eight possible orders.[^mapfix]

```go run title="maporder.go"
package main

import "fmt"

func main() {
	m := map[string]int{"alpha": 1, "bravo": 2, "charlie": 3}
	for i := 0; i < 6; i++ {
		for k := range m {
			fmt.Printf("%s ", k)
		}
		fmt.Println()
	}
}
```

```output
charlie alpha bravo
alpha bravo charlie
alpha bravo charlie
alpha bravo charlie
alpha bravo charlie
alpha bravo charlie
```

One possible outcome; hit Run a few times and it shuffles. Against the old toolchain it never does:[^repro]

```
$ go run maporder.go     # go1.2.2
alpha bravo charlie
alpha bravo charlie
alpha bravo charlie
alpha bravo charlie
alpha bravo charlie
alpha bravo charlie
$ go run maporder.go     # go1.3
alpha bravo charlie
alpha bravo charlie
alpha bravo charlie
bravo charlie alpha
charlie alpha bravo
alpha bravo charlie
```

## Roundup

`sync.Pool` arrives from issue 4720. Brad Fitzpatrick added the type in December as a temporary implementation "until Dmitry makes it fast"; Dmitry Vyukov's January rewrite around per-P caches cut the parallel benchmark by 98 percent, and Rob Pike's April documentation pass closed the "document Pool better" issue.[^pool] It does not exist at all on the old toolchain:

```
$ go run pool.go     # go1.2.2
./pool.go:9: undefined: sync.Pool
$ go run pool.go     # go1.3
pooled and reused
same buffer back: true
```

`crypto/tls` closes an inadvertent verification skip. The low-level `Client` API silently skipped hostname verification when the config named no server; Adam Langley's February commit forces every caller to say `ServerName` or `InsecureSkipVerify`, after a review found nearly all users of `Client` got it wrong.[^tls] Against a server whose certificate names `wrong-name.example`:

```
$ go run tlsdemo.go     # go1.2.2
handshake succeeded (no hostname checked), server said: pong!
$ go run tlsdemo.go     # go1.3
handshake failed: tls: either ServerName or InsecureSkipVerify must be specified in the tls.Config
```

The rest of the release in brief: `regexp` gains a one-pass execution engine ported from RE2 by David Covert, chosen automatically per expression.[^regexp] The linker is overhauled after Russ Cox's November design: instruction selection moves from the linker into a new `liblink` library used by the compilers, so large projects stop paying for it on every link. The design opens with Ken Thompson's verdict on the Plan 9 toolchain, "compile quickly, load slowly," and calls the split the future he proposed.[^linker] Cgo learns distinct named types for pointers to incomplete structs, so passing a `*C.FILE` where a `*C.DIR` belongs finally fails to compile.[^cgo] Native Client support returns on 386 and amd64p32, with a new `go run`/`go test -exec` flag to launch binaries under it; DragonFly BSD, Plan 9, and Solaris gain experimental ports; Windows 2000 support is removed.[^rel] Godoc grows a `-analysis` flag with call graphs and definition references; the memory model blesses buffered channels as semaphores; defers get cheaper, the collector's concurrent sweep cuts pause times by half or more, the race detector runs 40 percent faster, and stack dumps report how long each goroutine has been blocked.[^rel]

Go 1.3.1 followed on 13 August with compiler, runtime, `net`, and `crypto/rsa` fixes.[^minor]

[^rel]: [Go 1.3 release notes](https://go.dev/doc/go1.3), the source for the 18 June 2014 date, the platform changes, the `unsafe` rules, and the performance figures. 1,710 commits sit between the `go1.2.2` (`43d00b0`) and `go1.3` (`1cdd48c8`) tags. The [announcement](https://go.dev/blog/go1.3) is Andrew Gerrand's blog post of the same day.
[^doc]: [Contiguous stacks](https://go.dev/s/contigstacks), the design document behind the stack work: the hot split numbers (segmented "with split" 5.37s against contiguous 1.26s), the `encoding/json` and `html/template` benchmarks, bug 3787, and the Carl Shapiro dependency quoted above.
[^ptrmap]: [Commit `f056daf0`](https://github.com/golang/go/commit/f056daf075f303918343fd79af7ee0bfdcf6738e), "generate pointer maps by liveness analysis", Carl Shapiro, 5 December 2013.
[^copy]: [Commit `1665b006`](https://github.com/golang/go/commit/1665b006a57099d7bdf5c9f1277784d36b7168d9), "grow stack by copying", Keith Randall, 26 February 2014 (CL 54650044, LGTM=rsc). Disabled overnight in [`f50a8705`](https://github.com/golang/go/commit/f50a87058b6773f277d139b9c85ad421b92620d2) (TBR=dvyukov).
[^reenable]: [Commit `e9445547`](https://github.com/golang/go/commit/e9445547b6d04edc358ae60e2eb29db88fd67654), "move stack shrinking until after sweepgen is incremented", Keith Randall, 27 February 2014 (CL 69620043, LGTM=bradfitz), ending "Reenable stack copying."
[^precise]: Enabled in [`ecf700b5`](https://github.com/golang/go/commit/ecf700b5ee878519344fc521cb0d02837a943c0d), undone the same day in [`aad23e70`](https://github.com/golang/go/commit/aad23e708c55f063a64eaa055e8d9d6c2294c9f4) ("broke 32-bit builds"), re-enabled in [`53061193`](https://github.com/golang/go/commit/53061193f1b35aa6eda405909db41900fdc2c5de) after the 32-bit fix (CL 66170043); all Russ Cox, 17 to 19 February 2014.
[^bolt]: [Issue 8030](https://github.com/golang/go/issues/8030), "stack split hot spot on github.com/benbjohnson/bolt new in Go 1.3", filed 19 May 2014: 0.27s on 1.2.2, 18.72s on 1.3beta1 for `TestBucket_Put_Multiple`.
[^8k]: [Commit `6aee2964`](https://github.com/golang/go/commit/6aee29648fce3af20507787035ae22d06d75d39b), "switch default stack size back to 8kB", Russ Cox, 20 May 2014 (CL 92540043, LGTM=khr, dave, iant). Fixes #8030. The 8KB default dates to Go 1.2 (`StackMin` was 4096 in Go 1.1); the copying commit had cut it to 4KB.
[^mapissue]: [Issue 6719](https://github.com/golang/go/issues/6719), "randomize iteration order of small maps", Ian Lance Taylor, 5 November 2013: fixed small-map order lets tests depend on it unnoticed, then fail under gccgo.
[^mapfix]: [Commit `3be4d957`](https://github.com/golang/go/commit/3be4d95731a17073afb1f69bde264eecbdfa32bb), "change map iteration randomization to use intra-bucket offset", Josh Bleecher Snyder, 14 January 2014 (CL 47370043, R=khr, bradfitz). Fixes #6719. `BenchmarkMapIter` improved 5.47 percent on the author's laptop.
[^pool]: [Commit `8c6ef061`](https://github.com/golang/go/commit/8c6ef061e3c189e3ac90a451d5680aab9d142618), "add Pool type", Brad Fitzpatrick, 18 December 2013 (CL 41860043), updating issue 4720; [commit `f8e0057b`](https://github.com/golang/go/commit/f8e0057bb71cded5bb2d0b09c6292b13c59b5748), "scalable Pool", Dmitry Vyukov, 24 January 2014 (`BenchmarkPool-4` 400359 to 5904 ns/op); [commit `a8787cd8`](https://github.com/golang/go/commit/a8787cd820fb39575efed14617dde2fb8131b354), "better documentation", Rob Pike, 10 April 2014, fixing issue 7167.
[^tls]: [Commit `fca335e9`](https://github.com/golang/go/commit/fca335e91a915b6aae536936a7694c4a2a007a60), "enforce that either ServerName or InsecureSkipVerify be given", Adam Langley, 21 February 2014. The error text is from `handshake_client.go`. `net/smtp` learned to set `ServerName` the next month in [`a18bfb8c`](https://github.com/golang/go/commit/a18bfb8c673591b7cbf5d16842e09e87c2c9b8cf) (Mike Andrews, 4 March 2014).
[^regexp]: [Commit `76236ef1`](https://github.com/golang/go/commit/76236ef13684fd63555ae4be90ca31e94eda670f), "add one-pass optimization from RE2", David Covert, 7 March 2014.
[^linker]: [Go 1.3 Linker Overhaul](https://go.dev/s/go13linker), Russ Cox, November 2013: the `liblink` split, the Thompson quote, and the plan (not yet taken) for a Go linker.
[^cgo]: [Commit `0f82cfd3`](https://github.com/golang/go/commit/0f82cfd3f0ef84b553cd0f1e8cd578b3c29ea5d9), "enforce typing of 0-sized types", Daniel Morsing, 27 March 2014; [commit `0782ee3a`](https://github.com/golang/go/commit/0782ee3ad57a21bd3566f20e76e4e453613e7a23), "make C.T and C.struct_S interchangeable", Russ Cox, 28 May 2014.
[^repro]: The runnable cells run on current Go. The recorded transcripts come from `go1.2.2` and `go1.3` toolchains built from the release tags with gcc 4.6.3 on ubuntu 12.04 (`make.bash`, `CGO_ENABLED=0`), as linux/amd64 binaries run in a container. The hotspot binaries were built with `-gcflags=-l` to disable inlining. The TLS demo uses a CA plus a leaf certificate for `wrong-name.example`, generated with the 1.3 `crypto/x509` code; the server presents the leaf and the client trusts only the CA.
[^minor]: [Release History](https://go.dev/doc/devel/release), the source for the 13 August 2014 date of Go 1.3.1, the next release in the series.
