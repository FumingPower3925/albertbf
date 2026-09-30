---
title: "Go 1.2.1: The Double Wakeup"
date: 2026-09-30
description: "Every fix in Go 1.2.1 is a bug with no workaround. The sharpest is a GC data race that took the better part of a year to reproduce."
tags: [go, go-history]
series: go-version-by-version
links:
  - { label: "Go 1.2.1 release history", url: "https://go.dev/doc/devel/release#go1.2.minor" }
  - { label: "Issue #5139", url: "https://github.com/golang/go/issues/5139" }
  - { label: "Issue #6946", url: "https://github.com/golang/go/issues/6946" }
---

Go 1.2.1 shipped on 2 March 2014, three months after Go 1.2. The notes give it one sentence: bug fixes to the `runtime`, `net`, and `database/sql` packages.[^rel] Behind that sentence are seven commits touching fourteen files: five code fixes, the release notes, and the version bump. Every one of the five is a bug with no workaround, and that is the bar this release is clearing. The profiler crashed unless you stopped profiling. The database wedged unless you forked three packages. The collector miscounted so seldom that the team gave up on it twice.

## The double wakeup

The collector bug is issue #5139, and it was eleven months old when the fix landed. Albert Strasheim reported it in March 2013: a `math/rand` test on 386 under `GOMAXPROCS=48`, ending in:

```
fatal error: notewakeup - double wakeup
```

He had seen it once. He spent the next night trying to see it again, a matrix of processor counts and test flags left running on two machines, and nothing fell out.[^race]

### No glue

Dmitry Vyukov took the issue that summer. He tried to reproduce it hard, read the sources closely, and reported back:

> I've tried to reproduce this very hard, and looked at the sources very closely. No glue.

The typo is in the original. He added better debug output for inconsistent notes so the next sighting would say more, then admitted:

> Frankly I am out of ideas. It happens so infrequently...

Others kept seeing it about once each: Brad Fitzpatrick in an `os/signal` stress test, Strasheim again in `compress/flate` and `reflect`, karalabe on Go 1.1.2. In September, Russ Cox demoted the issue: "It seems unlikely we'll figure this out in time." In December, Vyukov closed it as timed out: "Probably it was caused by a memory corruption that is already fixed."

### Okay, this is real

On 14 January 2014, ten months after the report, Vyukov reopened it himself:

> Okay, this is real. I can reproduce it by running 200 time tests in parallel continuously.

The fix landed the next day. Strasheim's entire review was one word: "whoot!" A month later, Cox marked it "Okay for 1.2.1."

### The window

Parallel collection in Go 1.2 works like this: the main M stops the world, starts `nproc-1` helper threads, and sleeps on a note called `alldone`. Each helper marks and sweeps its share, then counts itself done. The helper whose increment brings the count to `nproc-1` wakes the note. The count and the wakeup live in `gchelper`, and the comparison target was read after the increment:

```diff
 	runtime·parfordo(work.sweepfor);
 	bufferList[m->helpgc].busy = 0;
-	if(runtime·xadd(&work.ndone, +1) == work.nproc-1)
+	nproc = work.nproc;  // work.nproc can change right after we increment work.ndone
+	if(runtime·xadd(&work.ndone, +1) == nproc-1)
 		runtime·notewakeup(&work.alldone);
```

That is the whole fix, plus a declaration at the top of the function: if `work.nproc` changes between a helper's increment and its read, two helpers can both believe they are last, and the note gets woken twice. A double wakeup is a fatal error. The comment is the whole of the official explanation. The commit message says only `Fixes #5139. Update #7065.`

### Difficult to say

Issue #7065 is the `Update`. A database author running Go 1.2 on a Mac watched his server segfault about once in fifty runs, always with the profiler on, always deep in the scheduler. Vyukov sent the GC fix with a caveat:

> I've sent CL 52090045 that fixes a very obscure data race in runtime. It can be potentially the cause of the crashes you see. Difficult to say.

`Update`, not `Fixes`: he could not prove the link. The reporter compiled Go 1.2 with the patch, ran his program a hundred times in a loop, and wrote back: "the bug has disappeared." Vyukov: "Let's consider this as Fixed."[^segv]

## The profiler

Issue #6946 is the crash the release notes do not name, and it comes with its own program. Russ Cox filed it in December 2013:

> This program should run forever. It crashes quickly, because GoroutineProfile is using the wrong pc/sp combination for the traceback if the corresponding goroutine has just come out of a system call.
>
> The only workaround is not to call GoroutineProfile. Possible #go121 candidate.

Ian Lance Taylor agreed it met the bar, "a critical bug with no workaround", and tagged it for the release.[^prof]

### Should run forever

Ten goroutines spinning on a failing syscall, the main goroutine profiling them in a loop. The issue's program loops forever; the cell below caps it at five thousand rounds so it can finish. The recorded runs use the unbounded program. Hit Run.

```go run title="profile.go"
package main

import (
	"fmt"
	"runtime"
	"syscall"
)

func main() {
	runtime.GOMAXPROCS(200)
	for i := 0; i < 10; i++ {
		go func() {
			for {
				syscall.Close(-1)
			}
		}()
	}
	stk := make([]runtime.StackRecord, 1000)
	const rounds = 5000
	for n := 0; n < rounds; n++ {
		if _, ok := runtime.GoroutineProfile(stk); !ok {
			panic("GoroutineProfile refused")
		}
	}
	fmt.Println("survived", rounds, "profiles")
}
```

```output
survived 5000 profiles
```

### It crashes quickly

The unbounded program, built with Go 1.2:[^repro]

```
$ ./profile     # Go 1.2
0
1
2
4
8
panic: invalid memory address or nil pointer dereference
fatal error: panic during gc
[signal 0xb code=0x1 addr=0x0 pc=0x418963]

goroutine 1 [running]:
runtime.throw(0x46484c)
	/root/go1.2/src/pkg/runtime/panic.c:464 +0x69 fp=0x7fffff630d40
runtime.panicstring(0x464588)
	/root/go1.2/src/pkg/runtime/panic.c:479 +0x8d fp=0x7fffff630d68
runtime.sigpanic()
	/root/go1.2/src/pkg/runtime/os_linux.c:234 +0x16a fp=0x7fffff630d80
runtime.gentraceback(0x406230, 0x0, 0x0, 0xc210070000, 0x0, ...)
	/root/go1.2/src/pkg/runtime/traceback_x86.c:101 +0x743 fp=0x7fffff630e40
saveg(0x406230, 0x0, 0xc210070000, 0xc210077700)
	/root/go1.2/src/pkg/runtime/mprof.goc:480 +0x76 fp=0x7fffff630ea0
runtime.GoroutineProfile(0xc210077000, 0x3e8, 0x3e8, 0xc, 0x301)
	/root/go1.2/src/pkg/runtime/mprof.goc:508 +0x148 fp=0x7fffff630ee8
main.main()
	/work/profile.go:19 +0xbd fp=0x7fffff630f48
runtime.main()
	/root/go1.2/src/pkg/runtime/proc.c:220 +0x11f fp=0x7fffff630fa0
runtime.goexit()
	/root/go1.2/src/pkg/runtime/proc.c:1394 fp=0x7fffff630fa8
```

Five numbers, then the crash. Every run I made died within its first few iterations, always on the same line of `gentraceback`. The dump continues with ten spinners, all inside the same `Close`. Read the `saveg` frame: it was handed a stack pointer of zero.

### Stale pc

That zero is the bug. `gp->sched.pc` and `gp->sched.sp` describe where a goroutine parked, and `GoroutineProfile` passed them to the traceback for every goroutine it sampled. A goroutine fresh out of a system call is not parked there; its saved position is stale, and here the stack pointer was simply zero. The traceback walked off nothing and faulted, and a fault there is fatal: `panic during gc`.

The fix passes a sentinel both sides cannot mistake for an address, and teaches the traceback to fetch the real values from the goroutine itself: the syscall position when it is in one, the parked position otherwise:

```diff
-			saveg(gp->sched.pc, gp->sched.sp, gp, r++);
+			saveg(~(uintptr)0, ~(uintptr)0, gp, r++);
```

The same stale read lived in `tracebackothers`, the function that dumps the other goroutines when the runtime prints a stack, and the fix changed those call sites too. A crashing program could crash its own crash report.

### The backport

The 1.2.1 change is a cherry-pick, and its description is unusually honest about the surgery:

> This CL is not exactly a copy of the original quoted below. This CL omits the changes made to mgc0.c in the original. Those changes do not apply cleanly to the Go 1.2 tree, and they were cosmetic, simplifying code that was already doing the right thing.
>
> To double-check that omitting the mgc0.c change has not invalidated the fix, I have verified by hand that the test program in issue 6946 fails without this CL and passes with this CL.

My runs are that verification, repeated. Go 1.2.1, same program, same machine:

```
$ ./profile     # Go 1.2.1
0
1
2
4
8
16
32
64
128
256
512
1024
2048
4096
8192
16384
[still running after 6s, killed]
```

Six seconds, sixteen thousand profiles, no crash.

## The pool

Issue #7219 came in as a mailing-list thread Brad Fitzpatrick forwarded in January 2014. A user ran a small program against either MySQL driver and watched it "block forever on the second time through the for loop", with both `Query` and `QueryRow`. Turning idle connections off made it work. The reply on the thread:

> It's a known bug in Go 1.2, fixed in 1.3 via commit 8a7ac002f840. ... Maybe a candidate for Go 1.2.1?

Cox agreed, with reasoning worth quoting in full:

> Okay for Go 1.2.1. My reasoning is that people cannot easily make a copy of database/sql because other code they want to use (the drivers) depends on using database/sql, so you'd have to fork database/sql, database/sql/driver, and the actual driver, just to get a 1-line fix for a bug that makes database/sql wedge.

Wedge. The commit that carried the fix onto the release branch has no `Fixes` line; the issue proposed it, Cox approved it, and that was the paper trail.[^pool]

### One connection

No MySQL here. This cell registers a minimal in-memory driver, one table, one row, and runs the issue's shape against it: a pool of one connection, the same query twice.

```go run title="pool.go"
package main

import (
	"database/sql"
	"database/sql/driver"
	"fmt"
	"io"
)

// A minimal in-memory driver: one table, one row, no database.
type fakeDriver struct{}

func (d *fakeDriver) Open(name string) (driver.Conn, error) { return &fakeConn{}, nil }

type fakeConn struct{}

func (c *fakeConn) Prepare(query string) (driver.Stmt, error) { return &fakeStmt{}, nil }
func (c *fakeConn) Close() error                              { return nil }
func (c *fakeConn) Begin() (driver.Tx, error)                 { return &fakeTx{}, nil }

type fakeStmt struct{}

func (s *fakeStmt) Close() error                                    { return nil }
func (s *fakeStmt) NumInput() int                                   { return 0 }
func (s *fakeStmt) Exec(args []driver.Value) (driver.Result, error) { return fakeResult{}, nil }
func (s *fakeStmt) Query(args []driver.Value) (driver.Rows, error)  { return &fakeRows{}, nil }

type fakeTx struct{}

func (t *fakeTx) Commit() error   { return nil }
func (t *fakeTx) Rollback() error { return nil }

type fakeResult struct{}

func (r fakeResult) LastInsertId() (int64, error) { return 0, nil }
func (r fakeResult) RowsAffected() (int64, error) { return 0, nil }

type fakeRows struct{ done bool }

func (r *fakeRows) Columns() []string { return []string{"name"} }
func (r *fakeRows) Close() error      { return nil }
func (r *fakeRows) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	dest[0] = "ada"
	return nil
}

func main() {
	sql.Register("fake", &fakeDriver{})
	db, err := sql.Open("fake", "")
	if err != nil {
		panic(err)
	}
	db.SetMaxOpenConns(1)
	for i := 0; i < 2; i++ {
		rows, err := db.Query("SELECT name")
		if err != nil {
			panic(err)
		}
		rows.Close()
		fmt.Println("query", i, "done")
	}
}
```

```output
query 0 done
query 1 done
```

### It wedges

Go 1.2 prints the first line and dies on the second query:[^repro]

```
$ ./pool     # Go 1.2
query 0 done
fatal error: all goroutines are asleep - deadlock!

goroutine 1 [chan receive]:
database/sql.(*DB).conn(0xc21003e000, 0x434169, 0xc210037150, 0x4c0e80)
	/root/go1.2/src/pkg/database/sql/sql.go:632 +0x448
database/sql.(*DB).query(0xc21003e000, 0x4d0cf0, 0xb, 0x0, 0x0, ...)
	/root/go1.2/src/pkg/database/sql/sql.go:908 +0x2c
database/sql.(*DB).Query(0xc21003e000, 0x4d0cf0, 0xb, 0x0, 0x0, ...)
	/root/go1.2/src/pkg/database/sql/sql.go:899 +0x8b
main.main()
	/work/pool.go:59 +0x143

goroutine 3 [chan receive]:
database/sql.(*DB).connectionOpener(0xc21003e000)
	/root/go1.2/src/pkg/database/sql/sql.go:574 +0x3e
created by database/sql.Open
	/root/go1.2/src/pkg/database/sql/sql.go:436 +0x24d
```

The getter is asleep in `conn`, waiting for a connection to come back. Nothing is out.

### And, not or

The pool hands out connections in `conn`, and the wait condition was:

```diff
-	if db.maxOpen > 0 && (db.numOpen >= db.maxOpen || db.freeConn.Len() == 0) {
+	if db.maxOpen > 0 && db.numOpen >= db.maxOpen && db.freeConn.Len() == 0 {
```

One operator. With the pool capped at one: the first query opens the single connection, closing the rows returns it to the free list, and the second query finds `numOpen >= maxOpen` true. Under `||` that alone is enough to wait, so it waits for a return that already happened. Nobody is ever going to return another connection, because the only connection is already home, sitting in the free list. Under `&&`, a full pool with a free connection hands it out instead of waiting. The fix added a test that sets the cap to one and queries twice, annotated "shouldn't deadlock".[^pool]

Go 1.2.1:

```
$ ./pool     # Go 1.2.1
query 0 done
query 1 done
```

## The breakpoint

Issue #6776 is the debugger crashing the debuggee. In November 2013, on a development snapshot, setting a breakpoint on `main.main` and stepping once ended the program. The crash line names the culprit: the program counter points at `0xcc`, the breakpoint instruction gdb wrote over the code:

```
runtime: pc=0x400c1b 0xcc 0xe3 0x48 0x81 0xec
fatal error: runtime: misuse of rewindmorestack
```

Cox diagnosed it on the issue: "This occurs when you set a breakpoint on a function that will be preempted or need to grow the stack." And then:

> rewindmorestack assumes that it can look at the program code to understand how the stack will be unwound. ... rewindmorestack is unhappy because that next instruction has been overwritten with a breakpoint instruction, which it did not expect and cannot handle.

While the issue sat open, the reporters patched their own runtimes. One treated `0xcc` as a jump and found stepping mostly worked; later he hollowed the whole function out and wrote: "It is soooo nice to have gdb working without runaways again." Taylor: "If possible, fix this for 1.2.1."[^gdb]

### A function that grows on entry

Go 1.2 stacks grow in segments. After every call to `morestack` in a function prologue, the linker emits a jump back to the function's start, and `rewindmorestack` decodes that jump, long or short, to resume on the new stack. A breakpoint byte matches neither form, so the decoder prints the bytes and throws. The fix recognises the breakpoint and leaves the program counter alone:

```diff
+	if(pc[0] == 0xcc) {
+		// This is a breakpoint inserted by gdb.  We could use
+		// runtime·findfunc to find the function.  But if we
+		// do that, then we will continue execution at the
+		// function entry point, and we will not hit the gdb
+		// breakpoint.  So for this case we don't change
+		// gobuf->pc, so that when we return we will execute
+		// the jump instruction and carry on.  This means that
+		// stack unwinding may not work entirely correctly
+		// (http://golang.org/issue/5723) but the user is
+		// running under gdb anyhow.
+		return;
+	}
```

The commit message states the tradeoff plainly:

> Changing the PC confuses gdb, because execution does not continue where gdb expects it. Not changing the PC has the potential to confuse a stack dump, but when running under gdb it seems better to confuse a stack dump than to confuse gdb.

### Under the debugger

This program needs gdb, so it cannot run in a cell. Its `main` carries a 32-kilobyte frame, which forces stack growth on entry, the shape that tripped the decoder:

```go title="gdbfat.go"
package main

import "fmt"

func main() {
	var buf [32768]byte
	buf[0] = 1
	buf[32767] = 2
	fmt.Println(len(buf), buf[0]+buf[32767])
}
```

With this script. The breakpoint goes on `0x400c32` itself, the jump site from the crash line, so both toolchains meet the decoder with the breakpoint planted:[^repro]

```
set pagination off
set debuginfod enabled off
break *0x400c32
run
continue
```

Go 1.2 dies before the breakpoint even fires:

```
$ gdb -batch -x gdbscript.txt ./gdbfat     # Go 1.2
Breakpoint 1 at 0x400c32: file /work/gdbfat.go, line 5.
runtime: pc=0x400c32 0xcc 0xcc 0x48 0x81 0xec
fatal error: runtime: misuse of rewindmorestack

runtime stack:
runtime.throw(0x56325f)
	/root/go1.2/src/pkg/runtime/panic.c:464 +0x69
runtime.rewindmorestack(0xc210001148)
	/root/go1.2/src/pkg/runtime/sys_x86.c:41 +0xb4
runtime.newstack()
	/root/go1.2/src/pkg/runtime/stack.c:230 +0x153
runtime.morestack()
	/root/go1.2/src/pkg/runtime/asm_amd64.s:225 +0x61

goroutine 1 [stack split]:
main.main()
	/work/gdbfat.go:5 +0x32 fp=0x7ffff7e28f48
runtime.main()
	/root/go1.2/src/pkg/runtime/proc.c:220 +0x11f fp=0x7ffff7e28fa0
runtime.goexit()
	/root/go1.2/src/pkg/runtime/proc.c:1394 fp=0x7ffff7e28fa8
[Inferior 1 (process 4306) exited with code 02]
gdbscript.txt:5: Error in sourced command file:
The program is not being run.
```

Exit code 02, the same code as the issue report. Go 1.2.1 trips the breakpoint and carries on through it:

```
$ gdb -batch -x gdbscript.txt ./gdbfat     # Go 1.2.1
Breakpoint 1 at 0x400c32: file /work/gdbfat.go, line 5.

Thread 1 "gdbfat-1.2.1" hit Breakpoint 1, 0x0000000000400c32 in main.main () at /work/gdbfat.go:5
5	func main() {
32768 3
[Inferior 1 (process 4319) exited normally]
```

## The rest of the release

The fifth fix is issue #6987, and it only ever bit on Windows. A twelve-line HTTP server under load testing died at random with:

```
panic: AcceptEx tcp [::]:8888: An existing connection was forcibly closed by the remote host.
```

Same code on Debian, no error no matter how long. When a client resets between connect and accept, `AcceptEx` reports the dead connection's error as the accept's error, and Go returned it, killing the listener. The reporter's complaint was the release thesis in miniature: "http.ListenAndServe just plain crashed." Vyukov: "it's more of an informational notification exposed through standard error reporting channel. Think of EINTR." Alex Brainman, who owned the Windows port: "WSAECONNRESET is actually about new connection, not about listening socket." The fix splits the accept into a single attempt plus a retry loop that ignores the two reset errors, and adds a Windows test file that did not exist.[^win]

The last commit of the seven is documentation: the release-notes block for 1.2.1 and a one-line install fix, where the tarball name still said `go1.1`. Andrew Gerrand: "I had to patch this in manually instead of using release-apply."

That is the whole release: seven commits, five fixes, no features, and nothing left on the list that a user could have routed around. Go 1.2.2 followed on 5 May.[^minor]

[^rel]: [Release History](https://go.dev/doc/devel/release), the source for the 2 March 2014 date and the verbatim "bug fixes to the `runtime`, `net`, and `database/sql` packages". Seven commits and fourteen files sit between the `go1.2` (`402d3590`) and `go1.2.1` (`9c9802f`) tags: five code fixes, the release-notes commit `f4e8e6d`, and the version bump. Andrew Gerrand announced the release on golang-nuts on 3 March 2014.
[^race]: [Issue #5139](https://github.com/golang/go/issues/5139), "runtime: fatal error: notewakeup - double wakeup", reported by Albert Strasheim on 27 March 2013 against a `math/rand` test on 386 at `GOMAXPROCS=48`. Dmitry Vyukov's "No glue" is comment 13 (31 July 2013) and "Frankly I am out of ideas" comment 15 (10 August); he closed it TimedOut on 28 December and reproduced it on 14 January 2014 "by running 200 time tests in parallel continuously". The fix is CL 52090045, commit `b3a3afc` on main (15 January), cherry-picked as `495b914` (28 February). Strasheim's "whoot!" is comment 26; Cox's "Okay for 1.2.1" is comment 27 (16 February).
[^segv]: [Issue #7065](https://github.com/golang/go/issues/7065), segfault at `proc.c:2273` in `acquirep`, reported against Go 1.2 on darwin/amd64 on 5 January 2014 by a tiedot author seeing one crash in forty or fifty runs with profiling on. Vyukov's "very obscure data race" and "Difficult to say" are comment 18 (14 January); the reporter's hundred clean runs are comment 24 (16 February), after which Vyukov wrote "Let's consider this as Fixed." The cherry-pick says `Update #7065`, not `Fixes`. CPU profiling being disabled on OS X in Go 1.2 is Vyukov's comment 12; the reporter had been optimising against hollow profiles: "the performance output has been inaccurate and useless hahaha."
[^prof]: [Issue #6946](https://github.com/golang/go/issues/6946), "runtime: crash in GoroutineProfile", reported by Russ Cox on 13 December 2013 with the program quoted above. Taylor's "a critical bug with no workaround" is comment 2, which also set the Release-Go1.2.1 tag. Fixed on main the same day by CL 41640043 (`bc135f6`); Cox's "Okay for 1.2.1" is comment 4 (16 February); the backport is `1685fbd` (28 February), whose description admits omitting the cosmetic `mgc0.c` hunk and records the hand verification quoted above.
[^pool]: [Issue #7219](https://github.com/golang/go/issues/7219), "database/sql: last connection in pool not handed out correctly", filed by Brad Fitzpatrick on 27 January 2014 to forward a golang-dev thread about either MySQL driver blocking "forever on the second time through the for loop" with `SetMaxIdleConns` set. Cox's fork reasoning and "wedge" are its only comment (16 February). The original fix is CL 40410043 (`8a7ac002`); the cherry-pick `d905670` (28 February) carries no `Fixes` line. It adds `TestSingleOpenConn`, "shouldn't deadlock".
[^gdb]: [Issue #6776](https://github.com/golang/go/issues/6776), "runtime: code text inspection confused by gdb breakpoints", reported on 16 November 2013 against a development snapshot: break on `main.main`, run, step once, and the runtime throws on the `0xcc` byte. Cox's "unhappy" diagnosis is comment 3 (24 November); the `0xcc`-as-jump workaround is comment 4 and the no-op variant comment 14 (8 January), both by glycerine, whose "soooo nice" is comment 16. Taylor's "If possible, fix this for 1.2.1" is comment 9. The fix is CL 49580044, commit `0d2f5c0` (28 February), whose message holds the tradeoff quoted above and cites issue #5723 for the unwinding caveat.
[^win]: [Issue #6987](https://github.com/golang/go/issues/6987), Windows `AcceptEx` returning `WSAECONNRESET` for a reset client and killing `http.ListenAndServe`, reported 19 December 2013 with a twelve-line server and load testing, clean on Debian. Vyukov's "Why does windows even return them?.." is comment 1 and "Think of EINTR" comment 4; Brainman's "actually about new connection, not about listening socket" is comment 7 (20 December). The fix is CL 49490043, commit `950555c` (28 February): `acceptOne` plus a retry loop over `WSAECONNRESET` and `ERROR_NETNAME_DELETED`, a new `net_windows_test.go`, and the `ztypes_windows.go` constant.
[^repro]: The runnable cells run on the current Go Playground, which is amd64. The recorded transcripts come from Go 1.2 and Go 1.2.1 toolchains built from their source tags (`402d3590`, `9c9802f`) with a period compiler (gcc 4.6.3 on ubuntu 12.04, `make.bash`, `CGO_ENABLED=0`), as linux/amd64 binaries. The profile and pool runs execute in a container; the debugger runs in a microVM, under gdb 12.1 with the script shown, its startup warning and thread announcements trimmed from the transcripts. The profile crash fired on all seven Go 1.2 runs, always within the first few iterations; the Go 1.2.1 run passed 16384 profiles in six seconds and was stopped with a timeout, shown as `[still running after 6s, killed]`. The pool deadlock is deterministic, a fatal at `sql.go:632`. The profile cell caps the issue program's infinite loop at 5000 rounds; the recorded runs use it unbounded.
[^minor]: [Release History](https://go.dev/doc/devel/release), the source for the 5 May 2014 date of Go 1.2.2, the next release in the series.
