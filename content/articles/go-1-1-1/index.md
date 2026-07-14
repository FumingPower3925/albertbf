---
title: "Go 1.1.1: The Return Address"
date: 2026-07-18
description: "Go 1.1.1's one security fix was a compiler bug: on 386, a generated method wrapper wrote a value you chose over its own return address."
tags: [go, go-history, security]
series: go-version-by-version
links:
  - { label: "Go 1.1.1 release history", url: "https://go.dev/doc/devel/release#go1.1.minor" }
  - { label: "Issue #5515", url: "https://github.com/golang/go/issues/5515" }
---

Go 1.1.1 shipped on 13 June 2013, a month after Go 1.1. It is a point release of the kind you take without reading: sixteen commits, most of them small compiler and runtime fixes. The release history gives one of them a label the rest do not have, a security fix to the compiler.[^rel] That fix is for a bug where, on 386, the compiler could generate a function that wrote a value of your choosing over its own return address.

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

amd64 and ARM were spared. Their back ends laid the frame out differently, so the reused slot did not fall on the return address.

## A value you control, on the return address

The release notes give it the security label because the word written over the return address was slice data, and a program builds its slices from its input. Get a chosen 32-bit value into the wrong entry and you choose where the corrupted function returns to. `0xdeadbeef` is a sentinel that segfaults loudly, but a real value would be an address, and returning to an address you picked is the whole aim of a control-flow attack. No exploit was ever written for this, and 386 was the minority target by 2013, but an externally controlled word landing on the return address is memory corruption with control-flow-hijack potential, and that is reason enough to fix it quietly and fast.

## The fix

The fix stops the wrapper from inlining a variable list that compilation has already pruned. The compiler now snapshots `Swap`'s declarations before the pass that drops unused locals runs, and the wrapper inlines from the snapshot, so `tmp` is still on the list and gets a slot of its own.[^fix] Built by Go 1.1.1, the same 386 program returns:

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

## The rest of the release

The other fifteen commits are the usual point-release mix.[^rest] Four are in the runtime, two of those memory-safety bugs in their own right: the garbage collector could rescan an object with the wrong size when its own scan reached a channel, and it could scan past the end of a slice that pointed into an array embedded in a struct. Two more fix the compiler's export data, the records that let one package inline a function from another, where a `make` of an unexported type, or slice and array types, could go missing and break the importer. Of the sixteen commits, the security line went to just the wrapper bug, the one that could write a value you chose over its own return address.

[^rel]: [Go 1.1.1 release history](https://go.dev/doc/devel/release#go1.1.minor), the source for the 13 June 2013 date and the "security fix to the compiler" wording.
[^repro]: The runnable cell runs on the current Go Playground, which is amd64. The 386 transcripts are from Go 1.1 and Go 1.1.1 toolchains built from their `go1.1` and `go1.1.1` source tags with a period compiler (gcc on ubuntu 12.04), cross-compiled to linux/386; the resulting static binaries run natively on msa2-client, an amd64 Linux machine that executes 386 binaries. Go 1.1 runs the same program cleanly on amd64, so the miscompile is specific to the 386 back end. The crash is deterministic across runs, though the goroutine numbers can vary.
[^fix]: [Issue #5515](https://github.com/golang/go/issues/5515), fixed in [commit 13af44f8](https://github.com/golang/go/commit/13af44f8a57b) (CL 10210043), "cmd/gc: save local var list before inlining." It saves the declaration list before compilation prunes it and inlines from that copy.
[^rest]: The runtime fixes are issues #5554 (GC rescan size), #5443 (GC scanning of a slice into an embedded array), and #5493 (a closure kept alive by a stale `g.fnstart`), plus a supporting allocation helper. The compiler export-data fixes are #5470 (`make` of an unexported type) and #5614 (missing slice and array types); #5244 and #5607 fix initialization ordering for blank-identifier variables.
