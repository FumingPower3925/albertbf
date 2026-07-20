---
title: "Go 1.2: Yielding at the Door"
date: 2026-07-21
description: "Go 1.2 could finally take the processor back from a goroutine that never yielded, but only when the goroutine entered a function."
tags: [go, go-history]
series: go-version-by-version
links:
  - { label: "Go 1.2 release notes", url: "https://go.dev/doc/go1.2" }
  - { label: "Full slice expressions (spec)", url: "https://go.dev/ref/spec#Slice_expressions" }
---

Go 1.2 shipped on 1 December 2013, seven months after Go 1.1. The release notes call it a smaller delta than the step to 1.1 and name two things worth attention: a better scheduler and one new piece of language.[^rel] The scheduler is the change that alters what a program can do. A program that hung forever under Go 1.1 can finish under Go 1.2, as long as it does one particular thing.

## The scheduler

### A goroutine that never lets go

Here is a program that does nothing useful, on a single processor:

```go title="preempt.go"
package main

import (
	"fmt"
	"runtime"
	"time"
)

var sink int

// burn does a little work in a frame large enough to keep its stack-split
// prologue, which is the only place Go 1.2 can preempt the goroutine.
func burn() {
	var scratch [64]int
	for i := range scratch {
		scratch[i] = i
	}
	sink = scratch[0]
}

func main() {
	runtime.GOMAXPROCS(1)
	fmt.Println("start")
	go func() {
		for {
			burn()
		}
	}()
	time.Sleep(100 * time.Millisecond)
	fmt.Println("main got the processor back")
}
```

`GOMAXPROCS(1)` gives the program one processor to run goroutines on. `main` starts a goroutine that loops forever, calling `burn` on every pass, then sleeps for a tenth of a second and tries to print a last line.

### The same program, built twice

Built with Go 1.1.2 and run, it prints the first line and stops:[^repro]

```
$ ./preempt     # Go 1.1.2
start
[still running after 6s, killed]
```

The scheduler in Go 1.1 is cooperative. A running goroutine keeps the processor until it does something that gives the processor up: it sends or receives on a channel, makes a blocking system call, or calls `runtime.Gosched` by hand. The goroutine here does none of those. It loops. `main`'s sleep expires and `main` becomes ready to run, but it is behind a goroutine that will never yield, on the only processor there is. Nothing is deadlocked, so the runtime does not complain. The program never reaches its last line.

Built with Go 1.2, the same program finishes:

```
$ ./preempt     # Go 1.2
start
main got the processor back
```

It takes about a tenth of a second, the length of the sleep. The goroutine was made to yield.

### The sentinel at the door

Go 1.2 gave the runtime a way to take the processor back from a goroutine that will not give it up, and the mechanism is one value written into the wrong place.

A separate runtime thread, the system monitor, wakes up periodically and looks for a goroutine that has held its processor for more than ten milliseconds. When it finds one, it writes a sentinel into that goroutine's `stackguard0` field. On a 64-bit build the sentinel is `0xfffffffffffffade`, near the top of the address space and above any real stack pointer.[^preempt]

Most compiled Go functions begin with a few instructions that compare the stack pointer against `stackguard0`, and when the stack has grown too close to the guard, the function calls into the runtime for more room. That check is how goroutine stacks grow. The sentinel turns it to a second purpose. Because the planted value is higher than any real stack pointer, the comparison always reports the stack exhausted, so the next function the goroutine enters calls into the runtime, and the runtime, finding the sentinel where a real limit should be, parks the goroutine rather than growing its stack. It is set aside as if it had called `Gosched` on its own.

```diagram
dir: LR
sysmon: the monitor sees a goroutine\nhold the processor past 10ms
plant: it plants the sentinel\nin stackguard0
check: the goroutine's next\nfunction entry reads stackguard0
yield (accent): the check fails,\nso the goroutine is parked
sysmon -> plant -> check -> yield
```

The check runs on entry to a function. That is the whole of the mechanism, and it is the catch.

### Only at a call

Change the loop so it calls nothing:

```go
go func() {
	for {
	}
}()
```

and Go 1.2 hangs on it exactly as Go 1.1 did:

```
$ ./preempt     # Go 1.2, empty loop
start
[still running after 6s, killed]
```

An empty loop enters no function, so the check never runs and the sentinel is never read. Go 1.2 can preempt a goroutine only while it keeps entering functions; one spinning in a tight loop with no calls holds the processor for as long as it runs.

## The language

### Three-index slices

The one new piece of language is a third index in a slice expression.

```go run title="slice3.go"
package main

import "fmt"

func main() {
	a := make([]int, 10)
	b := a[2:4:7]
	fmt.Println("len", len(b), "cap", cap(b))
}
```

```output
len 2 cap 5
```

`a[2:4:7]` is `a[2:4]` with its capacity set by the third index: length `4-2`, capacity `7-2`. Before Go 1.2 there was no third index, and the syntax for it did not parse. Built with Go 1.1.2, the program does not compile:[^repro]

```
$ go build slice3.go     # Go 1.1.2
./slice3.go:7: syntax error: unexpected :, expecting ]
```

The grammar had no room for a second colon. The feature spent months on the development tree behind an experimental gate, but the gate never reached the 1.1 release branch, so Go 1.1.2 has no production for it at all: the parser reaches the second colon and gives up.

### What the third index is for

Capacity is what `append` reads to decide whether it can grow a slice in place or must allocate a new one. Without a third index, a reslice inherits the whole backing array's capacity, which leads to a particular bug:

```go run title="aliasing.go"
package main

import "fmt"

func main() {
	// A two-index reslice keeps the backing array's full capacity, so append
	// writes through it and overwrites the third element.
	src := []int{10, 20, 30}
	two := src[0:2]
	_ = append(two, 999)
	fmt.Println("two-index:   src[2] =", src[2])

	// A three-index reslice caps the capacity, so append must allocate a new
	// array and the original is left alone.
	safe := []int{10, 20, 30}
	three := safe[0:2:2]
	_ = append(three, 999)
	fmt.Println("three-index: safe[2] =", safe[2])
}
```

```output
two-index:   src[2] = 999
three-index: safe[2] = 30
```

`src[0:2]` has length 2 but capacity 3, because it still reaches the end of `src`. Appending to it writes `999` into the spare slot, which is `src[2]`, and the original changes underfoot. `safe[0:2:2]` sets the capacity to 2, so `append` finds no room, allocates a new array, and writes there. The original is untouched. A function that returns part of a slice it does not want its caller to grow into hands back `s[i:j:j]`. The third index was added for that case.

### A nil pointer that used to lie

The other language change tightened what happens on a dereference through a nil pointer. One case is a nil pointer to an array:

```go title="nilptr.go"
package main

import "fmt"

func main() {
	var p *[10]int
	s := p[:]
	fmt.Println("len", len(s), "cap", cap(s))
	fmt.Println("survived the slice expression")
}
```

Slicing `p` should not work, because there is no array to slice. Built with Go 1.1.2, it works anyway, quietly:

```
$ ./nilptr     # Go 1.1.2
len 10 cap 10
survived the slice expression
```

The slice expression produced a header pointing at address zero with length and capacity ten, and the program walked on past it. The crash comes later, whenever something first indexes `s`, far from the line that was actually wrong. Go 1.2 stops it at the slice:

```
$ ./nilptr     # Go 1.2
panic: runtime error: invalid memory address or nil pointer dereference
[signal 0xb code=0x1 addr=0x0 pc=0x400e0a]
```

## The clock

The announcement puts the release cadence up front: seven months since Go 1.1, against the fourteen between Go 1.1 and Go 1.0, and a stated intent to make a major release about every six months from then on.[^rel]

[^rel]: [Go 1.2 release notes](https://go.dev/doc/go1.2). Go 1.2 was released on 1 December 2013 (the tag is dated three days earlier). The announcement opens by contrasting the seven months since Go 1.1 with the fourteen months between Go 1.1 and Go 1.0, and states the intent to make a major release roughly every six months.
[^repro]: The runnable cells run on the current Go Playground, which is amd64. The recorded transcripts come from Go 1.1.2 and Go 1.2 toolchains built from their source tags with a period compiler (gcc 4.6 on ubuntu 12.04, `make.bash`, `CGO_ENABLED=0`), as linux/amd64 binaries run natively on msa2-client, an amd64 Linux machine. `preempt.go` is run under `GOMAXPROCS(1)`; the Go 1.1.2 runs and the empty-loop Go 1.2 run never terminate, and were stopped with a six-second timeout, shown as `[still running after 6s, killed]`. The Go 1.2 completion is deterministic at about 0.14 seconds across runs.
[^preempt]: The sentinel is `runtime.StackPreempt`, defined in the Go 1.2 source as `((uint64)-1314)`. On a 64-bit build that is `0xfffffffffffffade`, whose low bits spell `fade`; it sits near the top of the address space, above any valid stack pointer, so the prologue's compare always fails. On 386 the same constant is `0xfffffade`, above any 32-bit stack pointer. The system monitor (`sysmon`) calls `retake`, which calls `preemptone`, which sets `gp->stackguard0 = StackPreempt`. Go 1.2 split the goroutine's guard into two fields for this: `stackguard0`, the one the function prologue reads and the one the sentinel overwrites, and `stackguard`, the real limit that `newstack` uses to tell a genuine stack overflow from a preemption request. A function whose frame is small enough to need no stack check is compiled without the prologue, so a call to such a function is not a preemption point either.
