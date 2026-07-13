---
title: "Go 1.1: The Dividend"
date: 2026-07-17
description: "A year after freezing the language, Go 1.1 recompiled the same code about a third faster and added a tool that could find a data race. The engine moved while the language sat still."
tags: [go, go-history, runtime]
series: go-version-by-version
links:
  - { label: "Go 1.1 Release Notes", url: "https://go.dev/doc/go1.1" }
  - { label: "Go release history", url: "https://go.dev/doc/devel/release" }
---

Go 1.1 shipped on 13 May 2013, thirteen months after Go 1. Read its release notes looking for language changes and there is almost nothing: a few small additions, no removals, nothing you were forced to fix. The compatibility promise from a year earlier held, and the surface of the language stayed where it was.

The change was all underneath. Recompile a Go 1.0 program with the 1.1 toolchain, no edits, and it ran about a third faster. The scheduler had been rebuilt, the garbage collector made precise, the compiler taught to emit better code. And the toolchain could now do something the 1.0 toolchain could not do at all: watch a running program and tell you where two goroutines were touching the same memory without synchronization.

The headline is speed, and it is the one thing I can cite but not show. A benchmark is worth publishing only on real hardware, and the runnable code here runs in a playground with a faked clock. The speedup also lives in the compiler and the runtime, not in your source, which is why it needed no code change and why there is nothing to paste into a cell. So I cite the figure the Go team reported and spend the runnable part of this piece on what is visible: a new tool and some sharper edges on the language.

## The dividend

The release notes state the performance claim directly:[^relnotes]

> The performance of code compiled with the Go 1.1 gc tool suite should be noticeably better for most Go programs. Typical improvements relative to Go 1.0 seem to be about 30%-40%, sometimes much more, but occasionally less or even non-existent.

The gains came from several places at once. The compiler inlined more, including small operations like `append` and interface conversions that had been function calls. The map implementation was rewritten to use less memory and less CPU. The runtime and the network library were coupled more tightly, so network operations caused fewer trips through the scheduler. None of it touched the language. A program written to the Go 1 spec got faster by being handed to a newer compiler, with no source change.

## The engine that moved

The largest single change was the scheduler. In Go 1.0 every goroutine in a program lived on one global run queue, and the runtime guarded that queue with one global lock. Creating a goroutine took the lock. Choosing the next goroutine to run took the lock. Entering and leaving a system call took the lock. On a single core none of that mattered. On several it was the ceiling: the threads meant to do the work spent their time waiting to touch the one queue.

Go 1.1 replaced it with the G, M, P model. A goroutine is a G. An operating-system thread is an M. The new piece is P, a processor, meaning a scheduling context rather than a physical core, and there are exactly `GOMAXPROCS` of them. A thread must hold a P to run Go code. Each P carries its own local run queue, so creating and picking goroutines became a local operation with no global lock on the common path. When a P's queue empties, it pulls from the global queue, and if that is empty too, it steals about half the runnable goroutines from another P chosen at random. Dmitry Vyukov wrote both the design and the implementation, in a document called the "Scalable Go Scheduler Design Doc."[^sched]

```mermaid
flowchart LR
  subgraph before["Go 1.0"]
    direction TB
    Q["one global run queue"] --> K(["one global lock"])
    K --> Ta["thread"]
    K --> Tb["thread"]
  end
  subgraph after["Go 1.1"]
    direction TB
    P1["P: local queue"] --> Ma["thread"]
    P2["P: local queue"] --> Mb["thread"]
    P1 -. "steals half" .-> P2
  end
```

One thing this did not change is the default. `GOMAXPROCS` still defaulted to 1 in Go 1.1, the same as in 1.0, so out of the box a program still ran its goroutines through a single P. The rewrite let the runtime scale across cores, but `GOMAXPROCS` still had to be raised by hand to use more than one P.

The garbage collector changed in a quieter way. Go 1.0's collector was conservative about pointers: shown a word that might be an address, it kept whatever that word pointed at alive, to be safe. Go 1.1 made the collector precise for values on the heap. It knew which words in a heap object were real pointers and which were plain integers, so a stray number that happened to look like an address could no longer keep dead memory from being reclaimed. The heap footprint fell, and it fell hard on 32-bit systems, where an integer and an address are the same width and the guessing was worst.[^relnotes]

## A bug the old tool could not see

The visible addition was a tool. With the `-race` flag, the Go 1.1 toolchain instruments every memory access a program makes and reports, at run time, when two goroutines reach the same variable with no synchronization between them and at least one is writing. It is built on ThreadSanitizer, the same detector used for C and C++.[^race]

Here is the smallest program that has a race. Two goroutines write one variable with nothing ordering them:

```go
package main

import "fmt"

func main() {
	done := make(chan bool)
	count := 0
	go func() {
		count++ // write in a second goroutine
		done <- true
	}()
	count++ // write in the main goroutine, with nothing ordering the two
	<-done
	fmt.Println(count)
}
```

On Go 1.0 you cannot even ask the question, because the flag does not exist:

```
$ go version
go version go1
$ go run -race race.go
flag provided but not defined: -race
usage: run [build flags] gofiles... [arguments...]
```

On Go 1.1, built from source and run with the flag, the toolchain finds it:[^repro]

```
$ go version
go version go1.1
$ go run -race race.go
==================
WARNING: DATA RACE
Write by goroutine 4:
  main.func·001()
      /race.go:9 +0x40

Previous write by goroutine 1:
  main.main()
      /race.go:12 +0x115
==================
Found 1 data race(s)
exit status 66
```

Two writes to `count`, one from the goroutine at line 9 and one from `main` at line 12, with no channel or lock ordering them, and the detector names both. It checks correctness, and says nothing about speed. The bug it catches is the kind that survives every reading of the code, because whether it corrupts anything depends on timing that changes from run to run, and a tool that watches every access does not depend on catching the bad interleaving live. It reasons about which accesses could overlap at all. Shipping it in 1.1 put a correctness tool for concurrency in the standard toolchain.

The playground cannot run `-race`, so those two transcripts are recorded rather than live cells.[^repro]

## Sharper edges

The language did change, in small and additive ways. Two of them you can run here.

Go 1.0 let you take a method as a value in only one form, the method expression, which takes the receiver as an explicit first argument. Go 1.1 added the method value: bind the receiver in, and you get a plain function.

```go run title="methodvalue.go"
package main

import "fmt"

type greeter struct{ name string }

func (g greeter) hello() string { return "hello, " + g.name }

func main() {
	g := greeter{"world"}
	say := g.hello // a method value: the receiver g is bound in
	fmt.Println(say())
}
```

```output
hello, world
```

In Go 1.1, `g.hello` is a `func() string` closed over `g`, and you can store it and call it later. On Go 1.0 the same line does not compile:

```
$ go run methodvalue.go
./methodvalue.go:11: method g.hello is not an expression, must be called
```

The other change you can feel is the width of `int`. On a 64-bit machine, Go 1.0's `int` was 32 bits; Go 1.1's is 64.

```go run title="intsize.go"
package main

import (
	"fmt"
	"unsafe"
)

func main() {
	fmt.Println("int is", unsafe.Sizeof(int(0))*8, "bits")
}
```

```output
int is 64 bits
```

On a 64-bit build it prints 64. Go 1.0 printed 32, and a constant too large for a 32-bit `int` was an error there but compiles in 1.1:

```
$ go run intsize.go        # Go 1.0
int is 32 bits
$ go run big.go            # Go 1.0, with: var n int = 1 << 40
./big.go:6: constant 1099511627776 overflows int
```

The wider `int` raised the ceilings that came with it. A slice could now hold more than two billion elements, and the heap could grow from a few gigabytes into the tens.[^relnotes] The remaining language changes were smaller: dividing by a constant zero became a compile error instead of a run-time panic, a function whose final statement is an infinite loop no longer needed a trailing `return`, and Unicode surrogate halves were rejected as rune and string constants. None of them broke code that already compiled.

## What the year bought

Go 1.1 is the first release where the compatibility promise paid out. A year earlier the team had frozen the language and accepted the cost that came with it, that no mistake in the Go 1 API could ever be removed. The freeze bought the freedom to change everything below the language: the scheduler and the collector rebuilt, the compiler's output improved, all of it handed back as a recompile that ran a third faster and could now find a program's races.[^points]

[^relnotes]: [Go 1.1 Release Notes](https://go.dev/doc/go1.1), the source for the 13 May 2013 release, the performance claim (quoted verbatim), the inlining and map and network improvements, the precise garbage collector, the 64-bit `int` on 64-bit platforms and its effect on slice and heap sizes, and the language changes.
[^sched]: Dmitry Vyukov, "Scalable Go Scheduler Design Doc," which lays out the Go 1.0 single-global-lock, single-run-queue scheduler as the problem and the G-M-P work-stealing model as the fix; Vyukov wrote both the document and the Go 1.1 implementation. `GOMAXPROCS` is the number of P's; it defaulted to 1 in both Go 1.0 and Go 1.1.
[^race]: The race detector was introduced in Go 1.1, enabled with the `-race` build flag, and is built on ThreadSanitizer. See "Introducing the Go Race Detector," Dmitry Vyukov and Andrew Gerrand, 2013.
[^repro]: The two transcripts are recorded from toolchains built from the `go1` and `go1.1` source tags with a period compiler (gcc on ubuntu 12.04, linux/amd64) and run under emulation. A `-race` build needs a C compiler for its runtime. The finding is stable across runs here, but the goroutine numbers, the stack addresses, and which of the two writes is reported as "previous" can vary between runs and machines; the full report also lists where each goroutine was created. The Go Playground does not support `-race`, so this cannot be a live cell.
[^points]: Two point releases followed, go1.1.1 (13 June 2013) and go1.1.2 (13 August 2013), each a bag of compiler and runtime fixes.
