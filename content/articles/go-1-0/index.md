---
title: "Go 1.0: The Promise"
date: 2026-07-13
description: "On 28 March 2012 Go 1 shipped almost no new features and one promise: the code you wrote would keep compiling for years."
tags: [go, go-history, compatibility]
series: go-version-by-version
links:
  - { label: "Go 1 and the Future of Go Programs", url: "https://go.dev/doc/go1compat" }
  - { label: "Go version 1 is released (2012)", url: "https://go.dev/blog/go1" }
---

Go 1 shipped on 28 March 2012, and its release notes read like an inventory of removals. Packages renamed, moved, and some deleted outright. The two-assignment map-delete form removed, POSIX error constants pulled out of `os`. The genuinely new language fits in a short paragraph. For a 1.0, it added almost nothing on purpose. The headline was compatibility. From that day, the code you wrote would keep compiling.

For two and a half years before it, there had been no such promise, and using Go meant treating breakage as a routine cost. Go 1 ended that by freezing the language.

## A release that mostly took things away

Go 1 was a stability release. It defined one version of the language and one set of standard libraries and drew a line: this is the surface, and it stops moving here.[^go1blog]

To draw that line cleanly the team bundled the last batch of backward-incompatible cleanups into the release itself, so the breaks happened going *into* 1.0 and not after it. The list is short and deliberately dull. A builtin `error` interface replaced the old `os.Error`. `rune` became a basic type for a Unicode code point. `delete(m, k)` replaced the two-assignment map-deletion form. The `time` package was redesigned around `time.Time` and `time.Duration`. `strconv` traded its `Atoi64`-style names for `ParseInt` and `FormatInt`. The standard library was reorganized into a hierarchy: `net/http`, `encoding/json`, `os/exec`, and the rest.[^go1notes]

That was the language's last cleanup before a long freeze. Go 1 locked the API rather than adding to it.

## The promise

The promise is one document, "Go 1 and the Future of Go Programs," published with the release. Its thesis is a single sentence:

> It is intended that programs written to the Go 1 specification will continue to compile and run correctly, unchanged, over the lifetime of that specification.[^compat]

Read the scope carefully. It is source-level, not binary. You still recompile against each new release; what you do not do is edit your source to make it build. The document is explicit:

> Compatibility is at the source level. Binary compatibility for compiled packages is not guaranteed between releases. After a point release, Go source will need to be recompiled to link against the new release.[^compat]

That was the bet. The team gave up the freedom to keep tinkering with the language in exchange for the trust an organization needs before it will build on you. Boring upgrades were the product. Russ Cox later put the weight of the decision plainly: *"prioritizing compatibility was the most important design decision we made for Go 1."*[^cox2023]

The cost came attached, and the team knew it. Once shipped, nothing in the Go 1 API can be removed or renamed. A clumsy function signature, a badly named parameter, an interface that turned out one method short: all permanent. New work can only be added beside the old, never substituted for it. Every awkward corner of the 2012 standard library is still there in 2026 because the promise forbids deleting it.

The promise carries a few narrow exceptions worth knowing in advance. Security fixes may break code. Programs that lean on behavior the spec leaves undefined may break. Programs that depend on an outright bug may break when the bug is fixed.[^exceptions] Everything outside those carve-outs is guaranteed.

## The promise, running

Here is a program that was legal Go 1.0 in March 2012. It also compiles and runs, unchanged, on the Go 1.26 toolchain from 2026. Every construct in it, the goroutines, the unbuffered channel, the one-method interface, the value-receiver method, the builtin `error`, `append`, `sort.Strings`, was present and spelled this way at 1.0. The program is the promise executing.

```go run title="promise.go"
package main

import (
	"errors"
	"fmt"
	"sort"
)

// Speaker is a one-method interface. Interfaces shipped in Go 1.0.
type Speaker interface {
	Say() string
}

// greeting is a plain struct with a value-receiver method.
type greeting struct {
	lang, text string
}

func (g greeting) Say() string {
	return fmt.Sprintf("%s: %s", g.lang, g.text)
}

// verify returns the builtin error interface. Go 1.0 replaced the
// pre-1.0 os.Error type with this builtin.
func verify(year int) error {
	if year < 2012 {
		return errors.New("before Go 1")
	}
	return nil
}

func main() {
	greetings := []greeting{
		{"en", "Hello"},
		{"es", "Hola"},
		{"ja", "こんにちは"},
		{"de", "Hallo"},
	}

	// Fan out: one goroutine per greeting, results over a channel.
	ch := make(chan string)
	for _, g := range greetings {
		go func(s Speaker) {
			ch <- s.Say()
		}(g)
	}

	out := []string{}
	for i := 0; i < len(greetings); i++ {
		out = append(out, <-ch)
	}
	sort.Strings(out) // deterministic, independent of goroutine order

	for _, line := range out {
		fmt.Println(line)
	}

	if err := verify(2012); err != nil {
		fmt.Println("error:", err)
	} else {
		fmt.Println("Go 1 compatibility: still compiling in 2026")
	}
}
```

```output
de: Hallo
en: Hello
es: Hola
ja: こんにちは
Go 1 compatibility: still compiling in 2026
```

The `verify` function points at one change that touched nearly every Go program of the era. The builtin `error` interface already existed before 1.0. Go 1 finished the transition: it removed `os.Error` and its `os.NewError` constructor, leaving `error` and the `errors` package as the only spelling.

```diff
-import "os"
-
-func verify(year int) os.Error {
+import "errors"
+
+func verify(year int) error {
 	if year < 2012 {
-		return os.NewError("before Go 1")
+		return errors.New("before Go 1")
 	}
 	return nil
 }
```

That edit was mechanical and it was everywhere; it touched essentially every function that returned an error. Go 1 made it once. The promise means it has not had to be made since, and neither has anything like it.

In the months that followed, three point releases shipped, 1.0.1 in April, 1.0.2 in June, and 1.0.3 in September 2012, each a bag of bug fixes with nothing that touched the promise.[^release]

## The 2012 engine

Freeze the contract and you are free to gut everything behind it. Almost every runtime feature a programmer now associates with Go arrived after 1.0. The engine underneath the March 2012 language was primitive, and most of it was later thrown out and replaced without a single Go program changing a line.

Goroutine stacks were segmented. A goroutine grew by allocating a fresh stack segment and chaining it to the last. A tight loop that repeatedly crossed a segment boundary paid to allocate and free a segment on every pass, the hot-split problem. Contiguous copying stacks replaced the scheme in Go 1.3 (2014).

The garbage collector stopped the world. It was a mark-and-sweep collector that halted every goroutine while it ran, with pauses that reached the hundreds of milliseconds on a large heap. The concurrent collector that pushed pauses under ten milliseconds shipped in Go 1.5 (2015).

`GOMAXPROCS` defaulted to 1. Out of the box a Go program ran its goroutines on one OS thread, and you raised the limit by hand to use more than a single core. Parallel-by-default did not arrive until Go 1.5 changed the default to the CPU count (2015).

The scheduler was naive. Goroutines multiplexed onto threads through one global run queue behind one global lock, with no work-stealing. The scalable work-stealing scheduler, the G-M-P model still in use, was contributed by Dmitry Vyukov and landed in Go 1.1 (2013).

And the runtime was substantially written in C, with a custom C compiler kept in the tree to interoperate with goroutine stack management. The rewrite that moved the compiler and runtime to Go, and deleted the C, was Go 1.5 (2015).

## What held and what got torn out

Fourteen years and twenty-six minor releases on, the split is clean. What Go 1.0 published as a contract survived. What it hid as implementation was rebuilt.

The contract held down to the details. The compatibility promise itself is intact through Go 1.26. Error values work exactly as they did, with `errors.Is` and `errors.As` added beside them in Go 1.13. `gofmt` still formats to one canonical style. The `go` tool still drives build, test, and run from the commands a 2012 user would recognize. Goroutines, channels, and `select` are the same concurrency you wrote then. `io.Reader` and `io.Writer` never needed a revision. Even the deliberately random map-iteration order shipped in 1.0, put there so code could not come to depend on a particular order, held its ground, and it is what let the runtime swap in a new hash-table implementation in Go 1.24 (2025) with nothing to fix in user code.

Underneath, the whole engine from the last section is gone. Segmented stacks, the stop-the-world collector, the single-thread default, the C substrate: all torn out and rebuilt, most of it in the one Go 1.5 release, and none of it asked a Go program to change. That invisibility is the promise paying off. The team could replace the entire runtime precisely because they had never exposed it as a contract.

One 1.0 decision did not survive: GOPATH. The single global workspace, with `go get` pulling whatever sat at the tip of a repo's default branch and no notion of versions, was a design Go 1.0 put in front of users rather than under them. So its replacement could not be silent. Modules arrived as an experiment in Go 1.11 (2018) and became the default in Go 1.16 (2021), and the migration was visible work for everyone with code in a GOPATH tree. The runtime got rebuilt without anyone noticing. The workflow could not, because it was the one part of the engine users actually touched.

Since then the promise has been made permanent. The original document scoped itself to the lifetime of the Go 1 specification and left a Go 2 possible at some indefinite point. Generics, in Go 1.18, and every other change once filed under Go 2 shipped inside Go 1 as new API, because the promise ruled out the clean break. The loop-variable scoping fix in Go 1.22 changed language semantics and still broke no existing program, gated on the `go` version each module declares in its `go.mod`.[^cox2023] In 2023, asked when a Go 2 that stops compiling old programs would arrive, Russ Cox answered *"never"*: *"There will not be a Go 2 that breaks Go 1 programs."*[^cox2023]

[^go1blog]: [*Go version 1 is released*](https://go.dev/blog/go1), the Go team, 28 March 2012, on stability as the driving motivation for Go 1 and the release date.
[^go1notes]: [*Go 1 Release Notes*](https://go.dev/doc/go1), the source for the builtin `error` interface, `rune`, `delete`, the redesigned `time` and `strconv`, and the reorganized standard-library hierarchy.
[^compat]: [*Go 1 and the Future of Go Programs*](https://go.dev/doc/go1compat), published with the Go 1 release, the source for the central compatibility sentence and the source-level (not binary) scope.
[^exceptions]: The same document enumerates the carve-outs to the guarantee, including security fixes, behavior the specification leaves unspecified, and fixes to bugs where a program depended on the buggy behavior.
[^cox2023]: Russ Cox, [*Backward Compatibility, Go 1.21, and Go 2*](https://go.dev/blog/compat), 2023, the source for compatibility as the most important Go 1 design decision, the "never" answer on a breaking Go 2, and the `go.mod`-version-gated loop-variable change.
[^release]: [*Release History*](https://go.dev/doc/devel/release), on go1.0.1 (25 April 2012), go1.0.2 (13 June 2012), and go1.0.3 (21 September 2012).
