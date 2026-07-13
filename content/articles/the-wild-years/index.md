---
title: "The Wild Years"
date: 2026-07-12
description: "From the 2009 open-source launch to the Go 1 freeze in March 2012, Go shipped no compatibility promise and broke your code most weeks."
tags: [go, go-history, release-engineering]
series: go-version-by-version
links:
  - { label: "Pre-Go 1 Release History", url: "https://go.dev/doc/devel/pre_go1" }
  - { label: "A preview of Go version 1 (Russ Cox, 2011)", url: "https://go.dev/blog/preview-of-go-version-1" }
---

`m[k] = 0, false`. That line deleted a map key in Go for the first two and a half years the language was public. Paste it into any toolchain shipped since 2012 and the compiler rejects it outright. From the open-source launch on 10 November 2009 to the Go 1 freeze on 28 March 2012, the language changed under you on a near-weekly schedule, and nothing promised it wouldn't. That one line is the whole era: ordinary Go then, a syntax error now.

## No promise

From 10 November 2009 to 28 March 2012 there was no compatibility guarantee. None. If you tracked the weekly branch, your code could stop building any given week, and the release notes were where you found out why.

Little was settled. At the 2009 launch the `go` command did not exist yet; you ran `6g` to compile and `6l` to link, driven by makefiles. Statements ended in semicolons. Garbage collection stopped the entire program while it ran. Go built for Linux and Mac only, on 32- and 64-bit x86 and 32-bit ARM.[^tenyears] Everything above that floor was in motion.

So using Go meant a standing ritual. Pull the snapshot. Rebuild the toolchain. Run gofix. Read the diff by hand. Run the tests. Fix what the tool missed. Every upgrade was that loop.

You picked a lane. Either you pinned a numbered release and swallowed a batch of breakage every few weeks, or you rode the weekly branch and paid the tax continuously, and either way the things that could move under you were builtins, whole packages, and the syntax itself.

## Two tracks

Development ran on two parallel tracks in Mercurial.

The weekly track was tagged `weekly.YYYY-MM-DD`: near-weekly cuts of the tip of tree, the bleeding edge. You rode it with `hg pull` then `hg update weekly`.[^cmd] Weeklies broke constantly, because that was the point of them.

The numbered track was tagged `release.rNN`. Each numbered release was a blessed pin of one specific weekly snapshot plus extra bug fixes. There were five in the entire run: r56 on 2011/03/16 (the first stable release, pinning `weekly.2011-03-07.1`), r57 on 2011/05/03, r58 on 2011/06/29, r59 on 2011/08/01, and r60 on 2011/09/07.[^pregoone] Five stable pins across roughly two and a half years.

The numbering is the tell. The first stable release carried the number 56, not 1. The pre_go1 page explains it plainly: before this, what we now call weekly snapshots were themselves called releases, so r56 continued the running count.[^pregoone] That implies somewhere around 55 earlier releases going back to launch, though the page lists none of them.

The last numbered release was r60.3. There was no r61. After r60 the project turned its full attention to Go 1, and about six more months of weekly-only churn separated that last pin from the freeze. Go 1 itself corresponds to `weekly.2012-03-27`, released 2012/03/28.[^pregoone] So the numbered track went quiet about six months before the churn actually stopped.

```diagram
dir: LR
r56: r56\nMar 2011\nfirst stable
r57: r57\nMay 2011
r58: r58\nJun 2011
r59: r59\nAug 2011
r60: r60\nSep 2011
go1 (accent): Go 1\nMar 2012\nthe freeze
r56 -> r57 -> r58 -> r59 -> r60
r60 ~> go1: 6 months, weekly only
```

A numbered release only changed the shape of the breakage: it arrived in batches instead of continuously. And third-party libraries lagged the snapshots, so one dependency built against last month's tip could block your upgrade entirely.

## The ritual, and the tool that made it survivable

gofix debuted in r57, in May 2011, built for exactly this problem. From the release notes: it finds programs that use old APIs and rewrites them to the new ones after you update.[^pregoone] It is the direct ancestor of today's `go fix`.

The four steps ran like this. Update the toolchain and rebuild. Run gofix to rewrite the mechanical bulk of your call sites across the changed APIs. Read the diff by hand, because gofix handled the rote edits but not the semantic edge cases, and printed warnings where it could not rewrite something. Run the tests to catch what slipped through the first three steps.

gofix shipped named fixes for the specific breaks as they landed: http, os, syscall, url, template, reflect. The release notes kept pointing at it. When r60 moved URL parsing into a new package, the note just said client code can be updated automatically with gofix.[^pregoone]

That tool is why adopters tolerated the instability. It turned most breaks from a rewrite into a one-command chore, and then a diff you skimmed.

## The week half your code broke

r57, on 3 May 2011, is the emblem of the era. It is also the clearest picture of what a gofix run actually did to your code.

Start with the builtin that vanished. Pre-r57, you tested whether a channel was drained with `closed(ch)`. r57 deleted the builtin and made the receive operator return an optional second boolean instead.[^pregoone] Here is the shape it removed, which no longer compiles on any modern toolchain:

```go
// pre-r57: the closed() builtin, gone as of 3 May 2011.
// `closed` is undefined on any toolchain since; this will not build.
for {
	v := <-ch
	if closed(ch) {
		break
	}
	fmt.Println(v)
}
```

And here is the replacement, the comma-ok receive, which is still exactly how you do this today:

```go run title="drain.go"
package main

import "fmt"

func main() {
	ch := make(chan int, 3)
	ch <- 1
	ch <- 2
	ch <- 3
	close(ch)

	for {
		v, ok := <-ch
		if !ok {
			fmt.Println("channel closed")
			return
		}
		fmt.Println(v)
	}
}
```

```output
1
2
3
channel closed
```

`ok` is false once the channel is drained and closed. That was one of the most common rewrites gofix performed after 3 May 2011, and the modern form has not changed since.

The same release redesigned reflect wholesale. Type became an interface, so instead of a type switch on the concrete Type you switch on `t.Kind()`. `Typeof` became `TypeOf`, `NewValue` became `ValueOf`, and a writable Value now comes from `New(t).Elem()` rather than `Zero(t)`.[^pregoone] The old concrete types are gone, so this diff is a fossil, not something you can run:

```diff
-t := reflect.Typeof(x)
-v := reflect.NewValue(x)
-switch t.(type) {
-case *reflect.IntType:
-case *reflect.StructType:
-}
+t := reflect.TypeOf(x)
+v := reflect.ValueOf(x)
+switch t.Kind() {
+case reflect.Int:
+case reflect.Struct:
+}
```

The rest of the r57 blast radius fits in a paragraph. http was redesigned around `Client` and `Transport`. `net.Dial` dropped its `laddr` argument. os gained a simplified `Open` and `Create`, with the old `Open` renamed to `OpenFile`. Unused labels became illegal, the way unused locals already were. And gotest was rewritten from a shell script into a Go program.[^pregoone] One release touched channels, reflection, HTTP, networking, the filesystem API, and the test runner.

That breadth is why r57 is the release people remember. If you upgraded through it, half your imports moved.

## The churn keeps its rhythm

r58 through r60 kept the cadence, at lower amplitude.

r58, on 29 June 2011, reworked exec into the `exec.Command` shape still in use. `http.Client.Get` dropped its `finalURL` return value, which moved onto a field of the response. `exp/draw` was renamed `image/draw`, and `strconv.Quote` narrowed its escaping, keeping the old behavior as `QuoteToASCII`.[^pregoone]

r59, on 1 August 2011, restricted `goto`: a goto outside a block can no longer jump to a label inside it. `sort.IntArray` became `IntSlice`, and `strings.Split` split into `Split` and `SplitN`. It also changed struct-tag syntax to the raw-string, space-separated `key:"value"` scheme, and pointed you at govet to find the tags that needed rewriting.[^pregoone] That was a syntax change: struct tags now had a fixed grammar.

```diff
-Name string "name"
+Name string `json:"name"`
```

`StructField.Tag` became a `StructTag` type with a `Get` method at the same time, so reading a single key stopped meaning parsing the whole string yourself.

r60, on 7 September 2011, was the package-restructuring release. URL parsing was extracted from http into a new `url` package, auto-migratable with gofix. The template package was replaced, and the old one was demoted to `old/template` and deprecated. An `else` now required braces unless its body was another `if`, though gofmt already formatted code that way, so formatted code was unaffected.[^pregoone]

## The last wild stretch

After r60.3 the numbered track went silent, and about six more months of weekly-only churn ran before Go 1. Some of the loudest breaks landed in that stretch.

Map deletion is the one from the cold open. Before `weekly.2011-10-18`, the only way to remove a key was a two-value assignment:

```go
// pre-1.0 map delete, deprecated at weekly.2011-10-18, removed at Go 1.
// `m[k] = v, false` is a hard syntax error on every toolchain since.
m[k] = 0, false
```

That snapshot added the `delete(m, k)` builtin. The old `m[k] = v, false` form kept compiling, deprecated, until Go 1 removed it in March 2012, and it is a hard syntax error on every toolchain since. Two other changes rode the same weeks. `os.Error` and `os.NewError` gave way to the builtin `error` interface plus `errors.New`, with the interface method renamed from `String()` to `Error()` around `weekly.2011-11-01`. And composite-literal pointer elision arrived in `weekly.2011-12-06`, so `[]*T{&T{}, &T{}}` could be written `[]*T{{}, {}}`, collapsible with `gofmt -s`.[^pregoone] The single most-used type in every Go program today, the `error` interface, did not exist under that name during the wild years.

Even with the numbered releases gone, the ritual held. gofix and `gofmt -s` still carried most of the load, so the loop stayed pull, fix, read, test.

## What never moved

Some primitives shipped right at launch and never moved. `new(T)` returns a pointer to a zeroed T; `make(T, ...)` initializes a slice, map, or channel. Both have worked identically since 2009, through Go 1 and today. The `<-` send and receive arrow never had a competing form. The `func (recv Recv) Method(...)` receiver syntax has been stable since the first public release.

```go
p := new(Point)         // *Point, zeroed
s := make([]int, 0, 8)  // slice, len 0 cap 8
ch := make(chan int)    // channel
```

The parts that felt solid in 2011 are the parts spelled the same way now. The wild years were churn on top of a stable spine, and the spine is most of what you actually type.

## Who bet on it anyway

People shipped real Go while it was this liquid.

On 21 April 2011, Heroku systems engineers Keith Rarick and Blake Mizerany wrote up Doozer, a consistent, highly-available data store they had built in Go, deep in the pre-1.0 window a month after r56.[^heroku] The post is worth reading for three concrete draws. They implemented Paxos processes as goroutines communicating over channels, and said they were amazed at how few lines it took. They stopped arguing about formatting because the buck stopped at the default output from gofmt. And Go's statically linked binaries meant Doozer was a single file with no external dependencies, copyable to any machine and launched to join a cluster.[^heroku]

Google gave its own signal. On 10 May 2011, at Google I/O, Go became App Engine's first compiled runtime, marked experimental, while the language was still pre-1.0.[^appengine]

SoundCloud adopted Go pre-1.0 in the r59 era, late 2011, and ran it in production; the Berlin Go users group formed around the same time.

## The freeze

The turn came on 5 October 2011, when Russ Cox posted "A preview of Go version 1." The promise: code that compiled in Go 1 would, with few exceptions, keep compiling over the lifetime of that version, through 1.1, 1.2, and on.[^preview]

The key line here is about timing. Cox wrote that the intended backwards-incompatible changes were significant enough that they had to be planned, announced, implemented, and tested as part of preparing Go 1, rather than delayed until after release.[^preview] The wild-years churn was that work, done in the open, front-loaded on purpose. Every removed builtin and relocated package was a break spent before the freeze so it would not have to be spent after.

The motivation was adoption. People should be able to write a book about Go, name a version, and have that number still mean something years later.[^preview] The goal was to stabilize the Go that already existed, not to redesign it. No new features by committee.

The five numbered releases and the weekly churn between them were the price of getting the API right before locking it. On 28 March 2012 the ground stopped moving. After that, code broke when you reached for something new, never because a Tuesday snapshot decided `closed(ch)` was gone.[^gooncompat]

[^pregoone]: All r-release dates, the reason numbering starts at 56, the closed()/reflect/exec/goto/struct-tag/URL/template/map-delete changes, and the gofix introduction are from the [Pre-Go 1 Release History](https://go.dev/doc/devel/pre_go1). The pre-r57 concrete reflect type spellings (`*reflect.IntType`, `*reflect.StructType`) and the `Typeof`/`NewValue` constructor names are confirmed against the release.r56 reflect source.
[^tenyears]: Russ Cox, [*Go turns 10*](https://go.dev/blog/10years), on the 2009 launch state: `6g`/`6l` driven by makefiles, semicolons, whole-program garbage collection, and the Linux/Mac, x86/ARM platform set.
[^cmd]: The `hg pull` / `hg update weekly` command is well attested from contemporary docs but varied over time; later `goinstall` used a `go.`-prefixed tag-selection scheme matching your local version.
[^heroku]: Keith Rarick and Blake Mizerany, [*Go at Heroku*](https://go.dev/blog/go-at-heroku), 21 April 2011, the source for Doozer, the Paxos-as-goroutines description, the gofmt line, and the single-file static-binary claim.
[^appengine]: [*Go and Google App Engine*](https://go.dev/blog/appengine), 10 May 2011, announcing Go as App Engine's first compiled runtime, marked experimental.
[^preview]: Russ Cox, [*A preview of Go version 1*](https://go.dev/blog/preview-of-go-version-1), 5 October 2011, the source for the compatibility promise, the front-loading rationale, and the books-and-version-numbers motivation.
[^gooncompat]: The source-level compatibility promise that ended the ritual is set out in [*Go 1 and the Future of Go Programs*](https://go.dev/doc/go1compat), published with the Go 1 release in March 2012.
