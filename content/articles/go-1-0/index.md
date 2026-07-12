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

Here is a program that was legal Go 1.0 in March 2012. It also compiles and runs, unchanged, on today's Go toolchain, fourteen years on. Every construct in it, the goroutines, the unbuffered channel, the one-method interface, the value-receiver method, the builtin `error`, `append`, `sort.Strings`, was present and spelled this way at 1.0. The program is the promise executing.

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

In the months that followed, three point releases shipped, all bug fixes, nothing that touched the promise.[^release]

## The 2012 engine

Freeze the contract and you are free to gut everything behind it. The engine underneath the March 2012 language was primitive, and almost all of it was later ripped out and rebuilt without a single Go program changing a line.

Goroutine stacks were segmented. A goroutine grew by allocating a fresh stack segment and chaining it to the last, and a tight loop that repeatedly crossed a segment boundary paid to allocate and free a segment on every pass, the hot-split problem, sometimes an order of magnitude of overhead.

The garbage collector stopped the world. It was a mark-and-sweep collector that halted every goroutine while it ran, with pauses that reached the hundreds of milliseconds on a large heap.

`GOMAXPROCS` defaulted to 1. Out of the box a Go program ran its goroutines on one OS thread, and you raised the limit by hand to touch a second core. Parallelism was opt-in.

The scheduler behind that was naive: goroutines multiplexed onto threads through one global run queue behind one global lock, with no work-stealing.

And the runtime itself was substantially written in C, with a custom C compiler kept in the tree to manage goroutine stacks.

The runtime was never part of the promise. It covered the language and the standard library, the surface a program could see, and left the machinery underneath free to move. The team used that freedom in full. The stacks, the collector, the scheduler, the single-thread default, the C itself: every one was torn out and rebuilt over the years that followed, and not one of those rebuilds asked a Go program to change a line. That is the promise paying off. They could replace the entire runtime because they had never exposed it as a contract.

## What held

Fourteen years on, the parts of Go 1.0 that were contracts are still the parts you use. The compatibility promise itself is intact. Error handling works the way it did, error values and `if err != nil`, added to over time but never replaced. `gofmt` still formats to one canonical style, and it still ends the argument before it starts. The `go` tool still drives build, test, and run from commands a 2012 user would recognize. Goroutines, channels, and `select` are the same concurrency you wrote then. `io.Reader` and `io.Writer` never needed a revision. Even the deliberately random map-iteration order, put in at 1.0 so that no program could come to depend on a fixed order, held its ground, and it is exactly what later let the runtime swap in a faster map with nothing to fix in anyone's code.

One 1.0 decision did not survive: GOPATH. The single global workspace, with `go get` pulling whatever sat at the tip of a repo's default branch and no notion of versions, was a design Go 1.0 put in front of users rather than under them. So its replacement could not be silent. The runtime got rebuilt without anyone noticing; the workspace could not, because it was the one part of the machinery users actually touched.

The promise itself has only hardened. The original document scoped itself to the lifetime of the Go 1 specification and left a Go 2 possible at some indefinite point. Everything once imagined for that clean break has instead shipped inside Go 1, added beside the old code rather than in place of it. The door the first document left cracked is now shut: asked when a Go 2 that stops compiling old programs would arrive, Russ Cox answered *"never"*: *"There will not be a Go 2 that breaks Go 1 programs."*[^cox2023]

[^go1blog]: [*Go version 1 is released*](https://go.dev/blog/go1), the Go team, 28 March 2012, on stability as the driving motivation for Go 1 and the release date.
[^go1notes]: [*Go 1 Release Notes*](https://go.dev/doc/go1), the source for the builtin `error` interface, `rune`, `delete`, the redesigned `time` and `strconv`, and the reorganized standard-library hierarchy.
[^compat]: [*Go 1 and the Future of Go Programs*](https://go.dev/doc/go1compat), published with the Go 1 release, the source for the central compatibility sentence and the source-level (not binary) scope.
[^exceptions]: The same document enumerates the carve-outs to the guarantee, including security fixes, behavior the specification leaves unspecified, and fixes to bugs where a program depended on the buggy behavior.
[^cox2023]: Russ Cox, [*Backward Compatibility*](https://go.dev/blog/compat), the source for compatibility as the most important Go 1 design decision and the "never" answer on a breaking Go 2.
[^release]: [*Release History*](https://go.dev/doc/devel/release), on go1.0.1 (25 April 2012), go1.0.2 (13 June 2012), and go1.0.3 (21 September 2012).
