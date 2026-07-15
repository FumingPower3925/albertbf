---
title: "Go 1.1.2: It Returned Nil"
date: 2026-07-19
description: "Every headline bug in Go 1.1.2 reported that it had worked. The sharpest of them zeroed your process's file limit and returned nil."
tags: [go, go-history]
series: go-version-by-version
links:
  - { label: "Go 1.1.2 release history", url: "https://go.dev/doc/devel/release#go1.1.minor" }
  - { label: "Issue #5949", url: "https://github.com/golang/go/issues/5949" }
  - { label: "Issue #5809", url: "https://github.com/golang/go/issues/5809" }
---

Go 1.1.2 shipped on 13 August 2013, two months after Go 1.1.1. Fifteen commits, described as fixes to the gc compiler and cgo, and to the bufio, runtime, syscall, and time packages.[^rel] Then the notes do something they do nowhere else on the page: they address you in the second person and tell you to go and read a change.[^note]

They picked the right one. It is also the clearest case of the habit this release has. The bugs here report that they worked. One returns nil while ruining the process that called it, one prints the wrong answer with no diagnostic at all, and one throws your data away and tells you it wrote nothing, which is true.

## The syscall

The warned-about bug is issue #5949: on 32-bit Linux, `syscall.Getrlimit` and `syscall.Setrlimit` did each other's jobs.

### A program that asks its own limit

This program asks the kernel for its own open-file limit twice. Once through `/proc/self/limits`, which is the kernel's own account and does not go through package `syscall` at all, and once through `Getrlimit`. Then it tries to open a file.

```go title="rlimit.go"
package main

import (
	"fmt"
	"io/ioutil"
	"os"
	"strings"
	"syscall"
)

// kernelNofile reads the process's real open-file limit from the kernel,
// bypassing package syscall entirely.
func kernelNofile() string {
	b, err := ioutil.ReadFile("/proc/self/limits")
	if err != nil {
		return "cannot read: " + err.Error()
	}
	for _, line := range strings.Split(string(b), "\n") {
		if strings.Contains(line, "open files") {
			return strings.Join(strings.Fields(line), " ")
		}
	}
	return "not found"
}

func main() {
	fmt.Println("kernel says, before:", kernelNofile())

	var rlim syscall.Rlimit
	err := syscall.Getrlimit(syscall.RLIMIT_NOFILE, &rlim)
	fmt.Printf("Getrlimit(RLIMIT_NOFILE) -> err=%v rlim=%+v\n", err, rlim)

	fmt.Println("kernel says, after: ", kernelNofile())

	if _, err := os.Open("/etc/hostname"); err != nil {
		fmt.Println("open /etc/hostname:", err)
	} else {
		fmt.Println("open /etc/hostname: ok")
	}
}
```

Nothing in it writes. It is four questions and no answers.

### It returns nil

Built with Go 1.1.1 for linux/386 and run on a machine whose soft limit is 1024:[^repro]

```
$ ./rlimit     # Go 1.1.1, linux/386
kernel says, before: Max open files 1024 524288 files
Getrlimit(RLIMIT_NOFILE) -> err=<nil> rlim={Cur:0 Max:0}
kernel says, after:  cannot read: open /proc/self/limits: too many open files
open /etc/hostname: open /etc/hostname: too many open files
exit=0
```

Read the four lines in order. The kernel starts out willing to give the process 1024 file descriptors. `Getrlimit` returns `err=<nil>`, which by the contract of the function means the `rlim` beside it holds the answer. That struct is what the process's limit has just been changed to. The third line asks the same question as the first, and it can no longer be asked, because asking it needs a file descriptor and the process is allowed zero. From here the program cannot open anything for as long as it lives, and an unprivileged process that has lowered its own hard limit cannot raise it back.

Then it exits 0. There was no error to check.

Go 1.1.2, same program, same machine:

```
$ ./rlimit     # Go 1.1.2, linux/386
kernel says, before: Max open files 1024 524288 files
Getrlimit(RLIMIT_NOFILE) -> err=<nil> rlim={Cur:1024 Max:524288}
kernel says, after:  Max open files 1024 524288 files
open /etc/hostname: ok
exit=0
```

### The names were the bug

32-bit Linux has no `getrlimit` that handles 64-bit limits, so Go reaches for `prlimit64`. The kernel's signature is:

```c
int prlimit64(pid_t pid, int resource,
              const struct rlimit64 *new_limit,   /* argument 3 sets */
              struct rlimit64 *old_limit);        /* argument 4 gets */
```

Argument 3 is what you want the limit to become. Argument 4 is where the kernel writes what it was. Go declared the wrapper like this:

```go
//sysnb prlimit(pid int, resource int, old *Rlimit, newlimit *Rlimit) (err error) = SYS_PRLIMIT64
```

The names are inverted against the kernel. The parameter in position 3 is called `old`, and position 3 is the one that sets. `//sysnb` generates the wrapper from that line, so the call it emits is correct. A caller reading the declaration sees the names.

```table
caption: The prlimit64 arguments, what Go called them, and what Go 1.1.1's Getrlimit put there.
cols: position | the kernel does | Go's parameter name | Getrlimit passed
3 | sets the limit | old | rlim, your zero struct
4 | reports the limit | newlimit | nil
```

Both callers read the names and trusted them. `Getrlimit` wanted the old value, saw a parameter called `old`, and passed its `rlim` there. That is argument 3. So `Getrlimit(RLIMIT_NOFILE, &rlim)` handed the kernel a zeroed `Rlimit` as the new limit and asked for the previous value to be written to `nil`. `Setrlimit` made the mirror mistake and read the limit instead of writing it. Both callers passed the arguments the parameter names asked for.

amd64 never went near any of this. It has a `getrlimit` that takes 64-bit values, so it never called `prlimit64`, and nobody working on amd64 could trip over it. The change that introduced the inversion went into the tree in July 2012, making 32-bit rlimits handle 64-bit values. It shipped in Go 1.1, survived Go 1.1.1, and went a year and three weeks before anyone reported it.[^fix] 386 and ARM were both affected.

### The fix reads backwards

The fix swaps the two call sites and leaves the declaration exactly as it was.[^fix] In Go 1.1.2, `Getrlimit` reads like this:

```go
func Getrlimit(resource int, rlim *Rlimit) (err error) {
	err = prlimit(0, resource, nil, rlim)
```

The code is correct. The parameter it passes `rlim` to is named `newlimit`.

The fix also added `rlimit_linux_test.go`, because there had not been a test for any of this. It checks the error first, and then, because the error was never the problem, that the getter did not return zeros.

## The compiler

The second bug is issue #5809. The reporter hit it on 6g, on amd64.

### Four hex digits

```go run title="hex.go"
package main

import "fmt"

const hexdigits = "0123456789ABCDEF"

// hex16 formats v as four hex digits, the ordinary way: index a constant
// digit string by each nibble.
func hex16(v uint16) string {
	var b [4]byte
	b[0] = hexdigits[v>>12&0xf]
	b[1] = hexdigits[v>>8&0xf]
	b[2] = hexdigits[v>>4&0xf]
	b[3] = hexdigits[v&0xf]
	return string(b[:])
}

func main() {
	fmt.Printf("hex16(0x1234) = %q\n", hex16(0x1234))
	fmt.Printf("hex16(0xbeef) = %q\n", hex16(0xbeef))
}
```

```output
hex16(0x1234) = "1234"
hex16(0xbeef) = "BEEF"
```

This is the ordinary way to write it: mask each nibble and index a constant string. Nothing in it is clever. Run it here and it prints what it should.[^repro]

### It prints 1111

Built with Go 1.1.1 for amd64:

```
$ ./hex     # Go 1.1.1, linux/amd64
hex16(0x1234) = "1111"
hex16(0xbeef) = "BBBB"
```

Every digit is the first digit. `1111` is `hexdigits[1]` four times, and `1` is the top nibble of `0x1234`; `BBBB` is `hexdigits[0xb]`, the top nibble of `0xbeef`. So the index was computed once, for `b[0]`, and the other three loads used the address it produced.

The address of `hexdigits[i]` is an LEA that adds the string's base to an index register. `hex16` asks for four of them, and as instructions they are identical: same symbol, same index register, same destination. Only the contents of the register differ between them. A peephole pass compared each LEA with the earlier one field by field, including the index by register number rather than by what the register held, found them the same, and deleted the later ones as redundant.[^lea] The register kept the address it had been given for the first nibble, and every load read that one byte.

The same toolchain, with the optimiser switched off:

```
$ ./hex     # Go 1.1.1, linux/amd64, built with -gcflags=-N
hex16(0x1234) = "1234"
hex16(0xbeef) = "BEEF"
```

That is the same compiler, the same source, the same machine, and the right answer. In 2013 the remedy for a Go miscompile was to ask the compiler to try less hard, and it worked. Go 1.1.2 fixes the pass:

```
$ ./hex     # Go 1.1.2, linux/amd64
hex16(0x1234) = "1234"
hex16(0xbeef) = "BEEF"
```

## The buffer

Issue #5947.[^buf] A `bufio.Writer` with a ten-byte buffer, filled with exactly ten bytes, then asked to read six more from a reader:

```go run title="buf.go"
package main

import (
	"bufio"
	"bytes"
	"fmt"
	"strings"
)

func main() {
	var sink bytes.Buffer
	w := bufio.NewWriterSize(&sink, 10)
	w.Write([]byte("0123456789")) // fills the buffer exactly
	n, err := w.ReadFrom(strings.NewReader("abcdef"))
	fmt.Printf("ReadFrom -> n=%d err=%v\n", n, err)
	w.Flush()
	fmt.Printf("sink = %q\n", sink.String())
}
```

```output
ReadFrom -> n=6 err=<nil>
sink = "0123456789abcdef"
```

Go 1.1.1 does not read the six bytes, and says so, in the way that `io.ReaderFrom` uses to mean success:

```
$ ./buf     # Go 1.1.1, linux/amd64
ReadFrom -> n=0 err=<nil>
sink = "0123456789"
```

`ReadFrom` found the buffer exactly full, read into the zero bytes of room that were left, got nothing back, and returned. `n=0` with `err=<nil>` is how `io.ReaderFrom` reports a reader that had nothing in it. `abcdef` is still sitting in the reader, untouched, and the `sink` line shows where it did not go. `io.Copy` takes this path whenever its destination implements `io.ReaderFrom`, and reports a successful copy of zero bytes.

```
$ ./buf     # Go 1.1.2, linux/amd64
ReadFrom -> n=6 err=<nil>
sink = "0123456789abcdef"
```

## The rest of the release

Three of the other compiler fixes are the counterexample, and worth naming for it: a pointer composite literal in an exported `if`, export data still going missing for inlining, and unevaluated constant expressions reaching the back ends. Those tell you. They fail at compile time, loudly, before anything runs.[^rest] The remaining fixes are a method wrapper that escape analysis never visited, `clearfat` interleaving with pointer arithmetic on 386, a panic that could leave the timer mutex held, and cgo under gccgo.

The runtime has one more that never shipped. Issue #5922 was that sysmon, once ten milliseconds had passed without the network being polled, would poll it on every iteration, every twenty microseconds, until some other thread blocked in netpoll. A fix landed on the release branch on 22 July at 23:50:35Z. Nineteen minutes later it was undone, because it broke the build:[^sysmon]

```
undo 6efaa14e2e7f

It breaks the build.
```

Go 1.1.2 shipped three weeks after that with the fix out. It was the last release of the 1.1 line, so the revert stood, and sysmon kept polling.

[^rel]: [Go 1.1.1 and 1.1.2 release history](https://go.dev/doc/devel/release#go1.1.minor), the source for the 13 August 2013 date and the package list. The `go1.1.1...go1.1.2` range is fifteen commits: thirteen fixes, the release notes, and the version bump.
[^note]: The notes read, in full: "If you use package syscall's Getrlimit and Setrlimit functions under Linux on the ARM or 386 architectures, please note change 11803043 that fixes issue 5949." Other entries name bugs, and go1.0.2 names two of them by issue number, but "please note" appears exactly once on the release-history page, across every release listed on it. Issue #5949 is titled for linux/386, though the fix patches `syscall_linux_arm.go` too, and the notes say ARM first.
[^repro]: The runnable cells run on the current Go Playground, which is amd64. The recorded transcripts come from Go 1.1.1 and Go 1.1.2 toolchains built from their source tags with a period compiler (gcc 4.6 on ubuntu 12.04); `rlimit.go` is cross-compiled to linux/386, the rest are linux/amd64, and all run natively on msa2-client, an amd64 Linux machine that also executes 386 binaries. The shell's soft limit was set to 1024 (`ulimit -Sn 1024`) so the numbers are round; the machine's own hard limit is 524288. All three reproductions are deterministic across runs. The damage in `rlimit.go` is confined to the process that runs it.
[^fix]: [Issue #5949](https://github.com/golang/go/issues/5949), reported by peterGo on 24 July 2013 and fixed by CL 11803043, on the release branch as commit `2041d55a`. It swaps the arguments at the `Getrlimit` and `Setrlimit` call sites in `syscall_linux_386.go` and `syscall_linux_arm.go`, and adds `src/pkg/syscall/rlimit_linux_test.go`. The `//sysnb prlimit(pid int, resource int, old *Rlimit, newlimit *Rlimit)` declaration is byte-identical at the `go1.1.1` and `go1.1.2` tags, line 930 of `syscall_linux.go` in both. The inversion arrived in commit `8b7d39e7` on 3 July 2012, "syscall: use 32 bits structure for Getrlimit/Setrlimit on 386/ARM", which fixed issue #2492; that is 387 days before the report.
[^lea]: [Issue #5809](https://github.com/golang/go/issues/5809), "cmd/gc: Optimizer bug involving constants, bit shifts and []byte literals", fixed on the release branch as `9db29c27`, "cmd/6g, cmd/8g: prevent constant propagation of non-constant LEA". At `go1.1.1`, `conprop` in `src/cmd/6g/peep.c` compares a later instruction with an earlier one and ends with `if(p->from.index == p0->from.index)` before calling `excise(r)`, which compares the index by register number and deletes the later instruction. The fix adds one line to each back end, `if(p->from.index == D_NONE || p->from.index == D_CONST)`, so an LEA with a live index register never reaches `conprop`. The 386 back end, `8g`, has the same one-line fix, so 386 had the bug too; the reporter hit it on amd64, and noted that `-gcflags=-N` made it go away.
[^buf]: [Issue #5947](https://github.com/golang/go/issues/5947), "bufio buffer exactly full", fixed on the release branch as `018854d2`, "bufio: check buffer availability before reading in ReadFrom".
[^rest]: The compile-time fixes are #4230 (pointer composite literals in exported `if` statements), #5755 (more missing export data for inlining) and #5841 (unevaluated constant expressions passed to the back ends). The others are #5753 (method wrappers not having escape analysis run on them), #5820 (`cmd/8g`: `clearfat` interleaved with pointer calculations), #5745 (a panic leaving the timer mutex held), #5905 (cgo under gccgo), and one runtime change with no issue number, setting the G status correctly after a syscall.
[^sysmon]: [Issue #5922](https://github.com/golang/go/issues/5922), "runtime: sysmon polls network excessivly". The fix is `ceeda72b` (22 July 2013, 23:50:35Z); the revert is `b5245b9c` (23 July, 00:10:11Z), nineteen minutes and thirty-six seconds later. The backport called `runtime·cas64` by value, while the release branch still declared it by pointer, so it did not compile. The sysmon block is byte-identical at the `go1.1.1` and `go1.1.2` tags. This is a wakeup and latency issue rather than a correctness one: `findrunnable` does a blocking network poll and covers the common case.
