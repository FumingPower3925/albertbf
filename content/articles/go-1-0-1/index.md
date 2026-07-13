---
title: "Go 1.0.1: The Escaping Bug"
date: 2026-07-14
description: "Go's first point release fixed an escape-analysis bug that could corrupt memory, a case where a wrong stack-versus-heap decision breaks memory safety."
tags: [go, go-history, compiler]
series: go-version-by-version
links:
  - { label: "cmd/gc: escape analysis bug (issue 3545)", url: "https://github.com/golang/go/issues/3545" }
  - { label: "Go release history", url: "https://go.dev/doc/devel/release" }
---

Go 1.0.1 shipped on 25 April 2012, twenty-eight days after Go 1. It was the first point release, and it existed to fix one thing. The release note lists it in a single clause: an escape-analysis bug that can lead to memory corruption.[^release]

Escape analysis is a compiler optimization. It decides whether a value lives in a function's stack frame or on the heap, and getting that wrong usually costs you an allocation and nothing else. This bug was the other kind of wrong. It left a pointer aimed at stack memory that had already been handed back and reused, so a program could read or write through it and see garbage. That is why a memory-corruption fix shipped as a change to an optimization pass. In Go the stack-versus-heap decision is load-bearing for memory safety, and the compiler shipped it wrong.

## The report

The report is issue #3545, "cmd/gc: escape analysis bug," opened by Russ Cox on 18 April 2012 against the Go1.0.1 milestone.[^issue] His description is two sentences:

> In the program below, 'i' is treated as not escaping, yet it does escape. This can cause crashes and memory corruption.

Here is that program's shape, cut down to the moving parts. Hit Run.

```go run title="corruption.go"
package main

import "fmt"

type box struct{ v *int }

func send(ch chan *box, n int) {
	i := n
	b := box{&i}
	defer func() { ch <- &b }()
}

func main() {
	ch := make(chan *box, 2)
	send(ch, 1)
	send(ch, 2)
	close(ch)
	for b := range ch {
		fmt.Println(*b.v)
	}
}
```

```output
1
2
```

It prints 1 and 2. That is the fixed compiler doing its job.

Here is the same program compiled with Go 1.0 itself, the release that shipped the bug. I built that toolchain from its source tag in a period container and ran the program unchanged:[^repro]

```
$ go version
go version go1
$ go run corruption.go
2
0
```

Not 1 and 2. The first value the channel hands back is wrong and the second is zeroed garbage, the same on every run. Both pointers were left aimed at `send`'s stack frame, and the second call reused that frame before the range loop read through them. The exact wrong values depend on what the reused stack held; that they are wrong does not. That is issue #3545, running.

Look at what has to escape. Inside `send`, the local `i` has its address taken into `b`. The deferred closure sends `&b` on a channel that is buffered and outlives the call. So both `i` and `b` genuinely outlive `send`'s frame. The compiler's one job is to notice that and put them somewhere that survives the return. In Go 1.0 it did not notice.

## What escape analysis decides

Escape analysis runs at compile time. For every value a function creates, it asks one question: does any reference to this value survive past the function's return? If the compiler can prove the answer is no, the value stays in the stack frame and is reclaimed for free when the frame pops, zero garbage-collector involvement. If a reference can outlive the call, the value escapes and goes on the heap, where the collector keeps it alive as long as something points at it.

This is what makes `return &local` legal in Go. In C that is a dangling pointer and undefined behavior. In Go the compiler sees the address leaving the frame and silently promotes the variable to the heap, so the pointer stays valid. The analysis is what lets you take the address of a local without thinking about its lifetime.

The two ways to be wrong are not symmetric.

A false positive means the compiler thinks a value escapes when it does not. The value lands on the heap when it could have stayed on the stack. You pay one allocation. The program is still correct.

A false negative means the compiler thinks a value does not escape when it does. The value stays on the stack, a pointer to it is kept past the return, the frame is reclaimed, the next call reuses that stack region, and every read or write through the stale pointer hits whatever now lives there. That is memory corruption, up to and including a pointer field sitting over bytes that were never a pointer.

So the analysis has one hard constraint: it may over-approximate escaping as much as it wants, and it may never under-approximate. Heap-allocating something that was stack-safe is a slowdown. Stack-allocating something that escapes is a hole. Issue #3545 was an under-approximation, which is the only kind that can corrupt memory, which is why it was worth a point release.

You can watch the decision happen at runtime. `testing.AllocsPerRun` is an ordinary exported function, so it runs anywhere, no build flags. It counts heap allocations per call.

```go run title="allocs.go"
package main

import (
	"fmt"
	"testing"
)

// makeOnHeap returns the address of a local, so n must live on the heap.
func makeOnHeap() *int {
	n := 42
	return &n
}

// sumOnStack computes a value that never leaves the frame: zero heap allocs.
func sumOnStack() int {
	total := 0
	for i := 0; i < 10; i++ {
		total += i
	}
	return total
}

// Package-level sinks keep the compiler from optimizing the calls away.
var sink *int
var stackSink int

func main() {
	escaping := testing.AllocsPerRun(100, func() { sink = makeOnHeap() })
	stacked := testing.AllocsPerRun(100, func() { stackSink = sumOnStack() })
	fmt.Printf("makeOnHeap (returns &local): %.0f alloc(s)/call\n", escaping)
	fmt.Printf("sumOnStack (stays in frame): %.0f alloc(s)/call\n", stacked)
}
```

```output
makeOnHeap (returns &local): 1 alloc(s)/call
sumOnStack (stays in frame): 0 alloc(s)/call
```

The 1 versus the 0 is the escape decision, counted. `makeOnHeap` returns a pointer to its local, so `n` is forced onto the heap and every call allocates. `sumOnStack` keeps everything in the frame and allocates nothing. The package-level sinks matter: without them the compiler proves the calls are dead and deletes them, and you measure nothing.

To see the reasoning instead of the cost, ask the compiler directly. Pass `-m` through `-gcflags` and it prints its escape verdicts to stderr at build time.[^gcflags] This one is recorded from a local build, not the Playground, because the flag output never reaches the browser.

```go
package main

var sink any

//go:noinline
func escapes(x int) {
	sink = x // stored in a package-level interface: must outlive the call
}

//go:noinline
func stays(p *int) int {
	return *p + 1 // only reads through p; nothing leaves the frame
}

func main() {
	escapes(42)
	n := 7
	_ = stays(&n)
}
```

```
$ go build -gcflags=-m escape.go
./escape.go:7:9: x escapes to heap
./escape.go:11:12: p does not escape
```

Two functions, two verdicts. `escapes` stores its argument into a package-level `interface`, which outlives the call, so the value goes to the heap. `stays` only reads through its pointer parameter, so nothing leaves the frame. `does not escape` and `escapes to heap` are the two answers the analysis exists to give, and the bug was the compiler giving the first when the truth was the second.

## Why this pattern fooled the 2012 compiler

The trigger in #3545 is narrow. The local's address escapes only through a closure that is invoked in place, here the deferred func literal. That is the corner the 1.0 analyzer got wrong.

A closure captures the locals it uses by reference. Inside the compiler that captured local is represented as a `PPARAMREF`, a reference node standing in for the original variable. When code inside the closure took the address of a captured local and let that address escape, the 1.0 analyzer walked the escaping value back as far as the `PPARAMREF` and stopped. It never followed the last edge, from the reference back to the variable it referred to. So the original local was still classed as non-escaping and left on the stack, even though the closure had just leaked its address to a channel.

The corruption follows from stack reuse:

1. `send(ch, 1)` returns. Its frame, holding `i` and `b`, is free stack again.
2. `send(ch, 2)` is called and reuses that same stack region for its own `i` and `b`.
3. Both `*box` pointers now sitting in the channel alias that reused memory. The value the first call queued no longer exists at the address the channel remembers.
4. The range loop reads `*b.v` through those pointers and gets whatever the second call, or anything after it, left in the slot.

A dangling pointer, produced by the pass whose job is to prevent exactly that. The fix is to heap-allocate `i` and `b` so each call gets its own storage that stays valid as long as the channel holds a pointer to it.

## The fix

Luuk van Dijk, who wrote the escape analyzer, fixed it in CL 6061043, "cmd/gc: fix addresses escaping through closures called in-place," with Russ Cox reviewing. The description is one line: "Fixes issue 3545."[^cl] The change is in `escwalk()`, the function that walks the value-flow graph, and it adds the missing edge: when it reaches a captured reference, follow it back to the original.

```c
// Follow the missing edge: a captured reference back to its original.
if(src->class == PPARAMREF) {
	if(leaks && debug['m'])
		warnl(src->lineno, "leaking closure reference %hN", src);
	escwalk(level, dst, src->closure);
}
```

With that edge in place, the escape flooding reaches the original variables and tags them. Run the bug program through the same `-m` flag and the compiler now reports what it missed in 1.0:

```
$ go build -gcflags=-m corruption.go
./corruption.go:8:2: moved to heap: i
./corruption.go:9:2: moved to heap: b
./corruption.go:19:15: *b.v escapes to heap
```

Lines 8 and 9 are `i` and `b`, the two locals the 1.0 compiler wrongly left on the stack, now moved to the heap where they belong. The CL also added regression tests `foo124` through `foo137` to `test/escape2.go`, covering the in-place closure across every form it can take: immediate call, `defer`, `go`, nested, and inside a loop. Those tests are why no later rewrite reintroduced #3545.

## A young pass

Escape analysis was new. It entered the tree on 24 August 2011, off by default behind a flag, and was turned on for everyone four days later.[^birth] Go 1.0 tagged seven months after that. What shipped in March 2012 was a single file, `src/cmd/gc/esc.c`, about eight hundred lines, doing flow-based analysis with a deliberately coarse set of escape states and no notion of partial or per-field escape.

It was conservative on purpose, and it carried author TODOs marking the places it gave up. Closures were one of the known rough spots. The commit log for the seven months before 1.0 has more than one entry along the lines of "fix escape analysis bug," including one landing about a month before the release that dealt specifically with escape analysis interacting badly with closures. Issue #3545 is the same corner, found a month after release instead of a month before. It fits the maturity of the code exactly. Escape analysis has been rewritten many times since, and none of those rewrites touched a line of anyone's Go source, because escape analysis is an implementation detail, not part of the Go 1 spec.

## The first point release

Go 1 had shipped a compatibility promise four weeks earlier: source you wrote to the Go 1 spec would keep compiling. Go 1.0.1 was the first live test of how that promise handles a bug. The answer was a template the project has followed ever since. The fix landed on tip, was cherry-picked onto the release branch, and a new release was cut by tagging that branch. No API changed. No source needed editing. A memory-corruption bug in the compiler was closed by recompiling with a fixed compiler, and nothing else.

The release carried a handful of smaller standard-library fixes alongside it, among them a `text/template` typecheck on pipelined arguments and a panic in `encoding/base64` on input whose length was not a multiple of four. The headline was the escape-analysis fix, and it is the one that mattered.

Under-approximating what escapes swaps a slowdown for a memory-safety hole, which is why #3545 shipped as a point release instead of waiting for the next feature version.

[^release]: [Release History](https://go.dev/doc/devel/release), the source for the 25 April 2012 date and the verbatim description of go1.0.1 as a fix for an escape-analysis bug that can lead to memory corruption.
[^issue]: [golang/go issue #3545](https://github.com/golang/go/issues/3545), "cmd/gc: escape analysis bug," opened by Russ Cox on 18 April 2012 against the Go1.0.1 milestone; the source for the reporter's description and the reproduction program.
[^gcflags]: The `-m` escape diagnostics are part of the gc toolchain and are printed to stderr at build time; pass them with `go build -gcflags=-m`. The `moved to heap`, `escapes to heap`, and `does not escape` phrasings shown here were captured on a current toolchain; the three core messages have been stable for years.
[^cl]: Change 6061043, "cmd/gc: fix addresses escaping through closures called in-place," written by Luuk van Dijk with Russ Cox as reviewer, description "Fixes issue 3545." It changed `src/cmd/gc/esc.c` and added the `foo124`–`foo137` regression tests to `test/escape2.go`.
[^birth]: Escape analysis entered the compiler on 24 August 2011 (Luuk van Dijk, "gc: Escape analysis"), initially off by default and selectable with a flag, and was enabled by default four days later (Russ Cox, "gc: tweak and enable escape analysis"). The pass that shipped in Go 1 was the state of that single-file analysis at the go1 tag.
[^repro]: Reproduced by building the `go1` source tag with a period compiler (gcc 4.6 on ubuntu 12.04, linux/amd64) and running the program unchanged on the resulting toolchain. Go 1.0's stack-versus-heap mistake is undefined behavior, so a different build or machine could print different wrong values or crash; the values being wrong is the invariant, not the specific `2` and `0`.
