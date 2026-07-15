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

Go 1.1.2 shipped on 13 August 2013, two months after Go 1.1.1. Fifteen commits, described as fixes to the gc compiler and cgo, and to the bufio, runtime, syscall, and time packages.[^rel] Then the notes do something they do nowhere else in Go's release history: they name one bug and warn you about it.[^note]

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

Read the four lines in order. The kernel starts out willing to give the process 1024 file descriptors. `Getrlimit` returns `err=<nil>`, which by the contract of the function means the `rlim` beside it is now the answer, and the answer is `{Cur:0 Max:0}`. It is not the answer. It is what the process's limit has just been changed to. The third line is the same question as the first, and it can no longer be asked, because asking it needs a file descriptor and the process is allowed zero. From here the program cannot open anything for as long as it lives, and an unprivileged process that has lowered its own hard limit cannot raise it back.

Then it exits 0. Nothing the process says about itself is false. There was no error to check.

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

Argument 3 is what you want the limit to become. Argument 4 is where the kernel writes what it was. Go declared the wrapper like this, and the declaration is where it went wrong:

```go
//sysnb prlimit(pid int, resource int, old *Rlimit, newlimit *Rlimit) (err error) = SYS_PRLIMIT64
```

The names are inverted against the kernel. The parameter in position 3 is called `old`, and position 3 is the one that sets. `//sysnb` generates the wrapper from that line, so the generated code is correct and the names on it are not, and the names are all a caller sees.

```table
caption: The prlimit64 arguments, what Go called them, and what Go 1.1.1's Getrlimit put there.
cols: position | the kernel does | Go's parameter name | Getrlimit passed
3 | sets the limit | old | rlim, your zero struct
4 | reports the limit | newlimit | nil
```

Both callers read the names and trusted them. `Getrlimit` wanted the old value, saw a parameter called `old`, and passed its `rlim` there. That is argument 3. So `Getrlimit(RLIMIT_NOFILE, &rlim)` handed the kernel a zeroed `Rlimit` as the new limit and asked for the previous value to be written to `nil`. `Setrlimit` made the mirror mistake and read the limit instead of writing it. Neither is a logic error. Both are a careful reading of a lie.

amd64 never went near any of this. It has a `getrlimit` that takes 64-bit values, so it never called `prlimit64`, so nobody working on amd64 could trip over it. The bug shipped in Go 1.1, survived Go 1.1.1, and lasted ten and a half months until somebody on a 32-bit box reported it. 386 and ARM were both affected, which in 2013 meant the Raspberry Pi that Go 1.1's own release notes had been pleased to support.

### The fix reads backwards

The fix swaps the two call sites and leaves the declaration exactly as it was.[^fix] So from Go 1.1.2 on, the correct code is the code that looks wrong:

```go
func Getrlimit(resource int, rlim *Rlimit) (err error) {
	err = prlimit(0, resource, nil, rlim)
```

A function called `Getrlimit`, passing its output parameter to something called `newlimit`. It is right, and it reads backwards, and the trap that caught the first two readers is still armed for the third.

The fix also added `rlimit_linux_test.go`, because there had not been a test for any of this. Its first assertion is that a getter did not return zeros.

## The compiler

The second bug is issue #5809, and it is not about 32-bit anything. It hit 6g, on amd64.

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

There is one way to write this and that is it: shift a nibble out, mask it, index a constant string. Run it here and it prints what it should.[^repro]

### It prints 1111

Built with Go 1.1.1 for amd64:

```
$ ./hex     # Go 1.1.1, linux/amd64
hex16(0x1234) = "1111"
hex16(0xbeef) = "BBBB"
```

Every digit is the first digit. Indexing `hexdigits` by `v>>12&0xf` and by `v&0xf` produced the same byte four times, so whatever the index was, it was not being used.

The address of `hexdigits[i]` is computed with an LEA, which adds a base and an index register. A peephole pass looked at that LEA, decided it was constant, and propagated the base while dropping the index.[^lea] The load then read the string's first byte forever. `0x1234` became `1111` and `0xbeef` became `BBBB`, and both are the shape of the bug rather than random damage.

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

Issue #5947 is eight lines and the shortest way to say what this release is about. A `bufio.Writer` with a ten-byte buffer, filled with exactly ten bytes, then asked to read six more from a reader:

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

`ReadFrom` found the buffer exactly full, read into the zero bytes of room that were left, got nothing, and returned. `n=0` and `err=<nil>` together mean the reader was empty. The `sink` line is there to show that it was not. `abcdef` is gone, and the writer that dropped it is the one `io.Copy` would have been using.

```
$ ./buf     # Go 1.1.2, linux/amd64
ReadFrom -> n=6 err=<nil>
sink = "0123456789abcdef"
```

## The rest of the release

Three of the other compiler fixes are the counterexample, and worth naming for it: a pointer composite literal in an exported `if`, export data still going missing for inlining, and unevaluated constant expressions reaching the back ends. Those tell you. They fail at compile time, loudly, before anything runs.[^rest] The remaining fixes are a method wrapper that escape analysis never visited, `clearfat` interleaving with pointer arithmetic on 386, a panic that could leave the timer mutex held, and cgo under gccgo.

The runtime has one more, and it is the release's own version of the habit. Issue #5922 was that sysmon's backup network poll ran when it was not needed and went quiet when it was, the comparison in it being backwards from the comment directly above it. A fix for it landed on the release branch on 22 July at 23:50:35. Nineteen minutes and thirty-six seconds later it was undone, with a commit message that reads, in full, "undo 6efaa14e2e7f. It breaks the build."[^sysmon] Go 1.1.2 shipped three weeks after that with the fix out and the release notes reporting fixes to the runtime. Go 1.1.2 was the last of the 1.1 line, so the nineteen-minute decision stood.

[^rel]: [Go 1.1.1 and 1.1.2 release history](https://go.dev/doc/devel/release#go1.1.minor), the source for the 13 August 2013 date and the package list. The `go1.1.1...go1.1.2` range is fifteen commits: thirteen fixes, the release notes, and the version bump.
[^note]: The notes read, in full: "If you use package syscall's Getrlimit and Setrlimit functions under Linux on the ARM or 386 architectures, please note change 11803043 that fixes issue 5949." That is the only "please note" on the release-history page, across every Go release listed on it. Issue #5949 is titled for linux/386, though the fix patches `syscall_linux_arm.go` too, and the notes say ARM first.
[^repro]: The runnable cells run on the current Go Playground, which is amd64. The recorded transcripts come from Go 1.1.1 and Go 1.1.2 toolchains built from their source tags with a period compiler (gcc 4.6 on ubuntu 12.04); `rlimit.go` is cross-compiled to linux/386, the rest are linux/amd64, and all run natively on msa2-client, an amd64 Linux machine that also executes 386 binaries. The shell's soft limit was set to 1024 (`ulimit -Sn 1024`) so the numbers are round; the machine's own hard limit is 524288. All three reproductions are deterministic across runs. The damage in `rlimit.go` is confined to the process that runs it.
[^fix]: [Issue #5949](https://github.com/golang/go/issues/5949), fixed by CL 11803043, on the release branch as commit `2041d55a`. It swaps the arguments at the `Getrlimit` and `Setrlimit` call sites in `syscall_linux_386.go` and `syscall_linux_arm.go`, and adds `src/pkg/syscall/rlimit_linux_test.go`. The `//sysnb prlimit(pid int, resource int, old *Rlimit, newlimit *Rlimit)` declaration is byte-identical at the `go1.1.1` and `go1.1.2` tags, line 930 of `syscall_linux.go` in both. The bug arrived with the fix for issue #2492, which had made 32-bit rlimits work with 64-bit values.
[^lea]: [Issue #5809](https://github.com/golang/go/issues/5809), "cmd/gc: Optimizer bug involving constants, bit shifts and []byte literals", fixed on the release branch as `9db29c27`, "cmd/6g, cmd/8g: prevent constant propagation of non-constant LEA". The fix is one condition in the peephole pass of each back end, requiring the LEA's index to be absent or itself constant before treating the whole address as constant. The reporter noted that `-gcflags=-N` made it go away, and that it reproduced on the Playground of the day.
[^buf]: [Issue #5947](https://github.com/golang/go/issues/5947), "bufio buffer exactly full", fixed on the release branch as `018854d2`, "bufio: check buffer availability before reading in ReadFrom".
[^rest]: The compile-time fixes are #4230 (pointer composite literals in exported `if` statements), #5755 (more missing export data for inlining) and #5841 (unevaluated constant expressions passed to the back ends). The others are #5753 (method wrappers not having escape analysis run on them), #5820 (`cmd/8g`: `clearfat` interleaved with pointer calculations), #5745 (a panic leaving the timer mutex held), #5905 (cgo under gccgo), and one runtime change with no issue number, setting the G status correctly after a syscall.
[^sysmon]: [Issue #5922](https://github.com/golang/go/issues/5922). The fix is `ceeda72b` (22 July 2013, 23:50:35Z); the revert is `b5245b9c` (23 July, 00:10:11Z). The sysmon block is byte-identical at the `go1.1.1` and `go1.1.2` tags. It broke the release branch because the backport used `runtime·cas64` by value, while the branch still declared it by pointer. This is a wakeup and latency issue rather than a correctness one: `findrunnable` does a blocking network poll and covers the common case.
