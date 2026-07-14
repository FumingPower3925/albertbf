---
title: "Go 1.1.1: The Return Address"
date: 2026-07-18
description: "Go 1.1.1 patched both enforcers of Go's memory safety at once: a compiler that could write your data over a function's return address, and a garbage collector that could free memory still in use."
tags: [go, go-history, security]
series: go-version-by-version
links:
  - { label: "Go 1.1.1 release history", url: "https://go.dev/doc/devel/release#go1.1.minor" }
  - { label: "Issue #5515", url: "https://github.com/golang/go/issues/5515" }
  - { label: "Issue #5443", url: "https://github.com/golang/go/issues/5443" }
---

Go 1.1.1 shipped on 13 June 2013, a month after Go 1.1, and went out described as a handful of compiler and runtime fixes.[^rel] Go's promise is memory safety, and two pieces of machinery keep it: the compiler, which controls what the generated code may touch, and the collector, which judges what memory is still in use. This release corrected both. Between them they held three ways to corrupt memory the language calls safe, one on the stack and two on the heap, and the sharpest is a compiler bug that, on 386, made a function write a value of your choosing over its own return address.

## A program that does nothing

Here is the whole thing, a program that swaps two entries of a slice:

```go run title="swap.go"
package main

import "fmt"

type T uint32

func main() {
	b := make([]T, 8)
	b[0] = 0xdeadbeef
	rs := Slice(b)
	sort(rs)
	fmt.Println("returned normally")
}

type Slice []T

func (s Slice) Swap(i, j int) {
	tmp := s[i]
	s[i] = s[j]
	s[j] = tmp
}

type Interface interface {
	Swap(i, j int)
}

func sort(data Interface) {
	data.Swap(0, 4)
}
```

```output
returned normally
```

It makes a slice of eight 32-bit values, writes `0xdeadbeef` into the first, and calls `Swap` through an interface to exchange entries 0 and 4. Run it here, on a 64-bit build, and it does exactly that and says so.[^repro] Go 1.1 compiled it correctly for amd64. The 386 build is where it goes wrong.

## On 386, it does not return

Compile the same source with the same Go 1.1, targeting 386, and run it:

```
$ GOARCH=386 go run swap.go     # Go 1.1
panic: runtime error: invalid memory address or nil pointer dereference
[signal 0xb code=0x1 addr=0x1 pc=0xdeadbeef]

goroutine 1 [running]:

goroutine 2 [runnable]:
exit status 2
```

Read the second line. `pc=0xdeadbeef` is the program counter, the address of the instruction the processor tried to run, and `0xdeadbeef` is the number the program put in the slice a moment earlier. A value it stored as data came back as an address to jump to. The function returned, and the return sent it to `0xdeadbeef`. There is no stack trace under the two goroutines because the overwritten word is the return address itself, so a stack walk has nothing to follow back to the caller.

## How a swap reaches the return address

`Swap` uses one temporary, `tmp`, to hold a value while it exchanges the two entries. The bug is about where that temporary lived.

Calling `Swap` through the `Interface` does not call the method directly. The compiler generates a small wrapper that adapts the interface call to `Slice.Swap`, and it inlines the body of `Swap` into that wrapper. The trouble is the order it works in: the wrapper is built after `Swap` has already been compiled on its own, and compiling `Swap` ran an optimization that decided `tmp` was unused and struck it from the function's list of variables.

The inlined copy in the wrapper still uses `tmp`. So when the 386 back end, `8g`, laid out the wrapper's stack frame, `tmp` was not on the list of locals it needed to reserve room for, and it put `tmp` in a slot it believed was free: the one holding the return address. `tmp` held `0xdeadbeef`. Writing the temporary wrote `0xdeadbeef` onto the return address, and the wrapper returned into it.

```diagram
dir: LR
compile: compile Swap,\ndrop the unused tmp
wrapper: build the wrapper,\ninline Swap (tmp returns)
reuse: 8g reuses\ntmp's missing slot
addr (accent): the return address
compile -> wrapper -> reuse
reuse ~> addr: lands on
```

amd64 ran the same generated wrapper, but its optimizer removed the leftover `tmp` from it, so no write to a missing slot was emitted. The 386 back end kept `tmp`, and its write landed on the return address.

## A value you control, on the return address

The word written over the return address was slice data, and a program builds its slices from its input. Put a chosen 32-bit value into the wrong entry and you choose where the corrupted function returns to. That is the shape of a control-flow attack: the overwritten word is externally controllable, and with the right value the return jumps into code the attacker picked.[^sec] `0xdeadbeef` segfaults loudly, but a real value would be an address. No exploit was written for it, and the release went out described as ordinary compiler and runtime fixes.

## The fix

The inlining that broke this was itself recent. A month earlier an optimization had turned inlining on inside these generated wrappers, to spare interface method calls the cost of a real call; on some sort benchmarks it cut the time by a fifth to over a third.[^fix] The crash that turned the bug up was in a program that sorted. The fix keeps the optimization and pays a pointer per declaration for it: the compiler now snapshots a function's variable list before the pass that drops unused locals runs, and the wrapper inlines from the snapshot, so `tmp` keeps a slot of its own. Built by Go 1.1.1, the same 386 program returns:

```
$ GOARCH=386 go run swap.go     # Go 1.1.1
returned normally
```

```table
caption: One program, three builds. Only Go 1.1 on 386 miscompiled it.
cols: toolchain | target | result
Go 1.1 | amd64 | returned normally
Go 1.1 | 386 | panic, pc=0xdeadbeef
Go 1.1.1 | 386 | returned normally
```

## A slice that hides a struct

The compiler is one enforcer. The other is the collector, and in Go 1.1 it had just changed. Go 1.1 made the garbage collector more precise: rather than treat every word that looked like a pointer as one, it read a program's types to know which words actually held pointers.[^precise] Give the collector the wrong type for a block of memory and it scans the wrong thing.

Here is a program that gives it the wrong type without meaning to:

```go run title="gcslice.go"
package main

import (
	"fmt"
	"runtime"
)

// X leads with an array, so a slice of X.buf points at offset 0 of the
// whole struct.
type X struct {
	buf     [1]byte
	nextbuf []byte
	next    *X
}

func main() {
	var head *X
	for i := 0; i < 10; i++ {
		p := &X{}
		p.buf[0] = 42
		p.next = head
		if head != nil {
			p.nextbuf = head.buf[:] // a []byte over the previous node
		}
		head = p
		runtime.GC()
	}

	vals := make([]byte, 0, 10)
	for p := head; p != nil; p = p.next {
		vals = append(vals, p.buf[0])
	}
	fmt.Println(vals)
}
```

```output
[42 42 42 42 42 42 42 42 42 42]
```

It builds a ten-node linked list. Each node leads with a one-byte array, `buf`, and carries a `[]byte` and a pointer to the next node. Every `buf[0]` is set to 42, and every node's slice is set to `head.buf[:]`, a slice of the previous node's array. Run it here and each node comes back 42.[^repro]

`head.buf[:]` is the ordinary act of slicing an array. The slice it produces points at `buf`, which sits at the very start of the node, so the slice's backing array and the node share an address. When the precise collector scanned that slice, it scanned the backing array using the slice's element type, `byte`, and `byte` holds no pointers. So it read the whole node as a run of bytes with nothing to follow, and the node's pointer to the next node went unmarked. The tail of the list, reachable only through that pointer, was collected while the list still pointed at it.

```diagram
dir: LR
slice: nextbuf,\na []byte
node: the previous node\n(buf, nextbuf, next)
scan: scanned as bytes,\nno pointers to follow
lost (accent): next unmarked,\nthe tail is freed
slice ~> node: backing array at offset 0
node -> scan -> lost
```

## The heap comes back reused

Built with Go 1.1 and run, the program reports what survived:

```
$ go run gcslice.go     # Go 1.1
[42 42 42 64 16 224 176 128 80 0]
```

The first three nodes still hold 42. The rest were freed and handed out again, and their leading byte is now the low byte of whatever took their place. Go 1.1.1 scans each node by its own type and keeps the list whole:

```
$ go run gcslice.go     # Go 1.1.1
[42 42 42 42 42 42 42 42 42 42]
```

Here the corruption is a wrong number in a slice, which is the tidy case. In a long-running program the same bug surfaced as a crash instead, a freed word read back as `0xdeaddeaddeaddead`, the runtime's fill for freed memory, in the middle of a type assertion.[^field]

## The rest of the release

The collector had a second bug of the same family: scanning an object that held a channel, it could take the channel's capacity for the object's size and rescan the wrong range, missing pointers the same way.[^rest] A third runtime fix was a leak, where a finished goroutine kept its start function set and pinned the closure it had captured. The compiler's other fixes are quieter: two repair the export data that lets one package inline a function from another, so a type does not go missing across the boundary, and two concern blank-identifier variables, one the order that top-level `var _ = ...` initializers run in, one a blank initializer inside a closure that was wrongly pulled into package startup.

Four of the sixteen commits are in the runtime, two of them in a garbage collector that was a month old.

[^rel]: [Go 1.1.1 release history](https://go.dev/doc/devel/release#go1.1.minor), the source for the 13 June 2013 date. The release notes at the time described it as several compiler and runtime bug fixes; the "security fix to the compiler" wording was added to the page later.
[^repro]: The runnable cells run on the current Go Playground, which is amd64. The recorded transcripts come from Go 1.1 and Go 1.1.1 toolchains built from their `go1.1` and `go1.1.1` source tags with a period compiler (gcc on ubuntu 12.04); the `swap.go` transcripts are cross-compiled to linux/386, the `gcslice.go` transcripts are linux/amd64, and all run natively on msa2-client, an amd64 Linux machine. The 386 crash and the amd64 heap corruption are both deterministic across runs, though the panic's goroutine numbers can vary.
[^sec]: On the issue the day it was filed, the maintainer minux described the overwritten word as externally controllable and laid out remote code execution through return-oriented programming; Daniel Morsing, who diagnosed the cause, noted the amd64 back end carried the same hazard and only avoided it because its optimizer removed the temporary from the wrapper.
[^fix]: The wrapper inlining that exposed the bug came from CL 7214044, which enabled inlining in generated method wrappers; its own sort benchmarks ran a fifth to over a third faster. The bug is [issue #5515](https://github.com/golang/go/issues/5515), fixed in [commit 13af44f8](https://github.com/golang/go/commit/13af44f8a57b) (CL 10210043), "cmd/gc: save local var list before inlining," which saves the declaration list before compilation prunes it. Its message calls the failure mode "hilarity ensues," and shipped the phrase with a typo, "beingused."
[^precise]: Go 1.1 made the garbage collector more precise, reading a program's types to decide which words hold pointers rather than scanning conservatively; the [Go 1.1 release notes](https://go.dev/doc/go1.1) call this out, with the largest effect on 32-bit systems.
[^field]: [Issue #5443](https://github.com/golang/go/issues/5443) was opened by a crash in a long-running program, where a freed interface word read back as `0xdeaddeaddeaddead`, the runtime's poison for freed memory, and faulted inside a type assertion. Fixed in "runtime: fix GC scanning of slices," which scans the object by its own type instead of the slice's element type.
[^rest]: The second collector fix is [issue #5554](https://github.com/golang/go/issues/5554) (heap corruption when the rescan size was overwritten by a channel's capacity). The leak is #5493 (a finished goroutine's start function left set, pinning its closure). The export-data fixes are #5470 (a `make` of an unexported type) and #5614 (missing slice and array types). The blank-identifier fixes are #5244 (initialization order of top-level `var _ = ...`) and #5607 (a blank initializer inside a closure wrongly emitted into package `init()`).
