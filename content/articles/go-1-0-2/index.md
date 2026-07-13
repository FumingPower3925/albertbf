---
title: "Go 1.0.2: The Cancelling Hash"
date: 2026-07-15
description: "Go's second point release fixed two ways a map could crash on struct or array keys, one of them a struct hash that XORed its own fields back to zero."
tags: [go, go-history, runtime]
series: go-version-by-version
links:
  - { label: "runtime: struct-key hash bug (issue 3695)", url: "https://github.com/golang/go/issues/3695" }
  - { label: "Go release history", url: "https://go.dev/doc/devel/release" }
---

Go 1.0.2 shipped on 13 June 2012, seven weeks after 1.0.1. It was the second point release, and like the first it went out for one part of the language: the map. Two bugs, both in how the runtime handled maps whose keys are structs or arrays, both able to crash a running program.[^release]

A map is the container a Go programmer reaches for without thinking, and both of these bugs sat under that reflex. One turned an ordinary struct key into a hash that ignored its own contents. The other let a large enough key corrupt memory during garbage collection. Neither needed unsafe code, cgo, or a data race. Both needed only a map and a key of the wrong shape.

## A struct that hashed to nothing

The sharper of the two is issue #3695, reported by Dan Kortschak on 2 June 2012.[^issue] The title is the whole diagnosis: "computed hash value for struct map key ignores some fields." His program keys a map by a struct and inserts a few hundred entries. Here is the shape of it. Hit Run.

```go run title="pair.go"
package main

import "fmt"

type sf struct {
	id string
	i  int
}
type pair struct{ a, b sf }

func main() {
	seen := map[pair]bool{}
	for i := 0; i < 500; i++ {
		x := sf{"", i}
		seen[pair{x, x}] = true
	}
	fmt.Println("distinct keys stored:", len(seen))
}
```

```output
distinct keys stored: 500
```

Five hundred distinct keys, five hundred entries. The detail that matters is the key: `pair{x, x}`, a struct whose two fields hold the same value. Every key differs from every other, because the `i` inside `x` changes each pass, but within a single key the two halves are identical.

Now the same program on Go 1.0, the release that still had the bug. I built that toolchain from source and ran it unchanged:[^repro]

```
$ go version
go version go1
$ go run pair.go
throw: hashmap assert

goroutine 1 [running]:
main.main()
	/pair.go:15 +0xde
```

It does not finish. The map accepts keys for a while, then the runtime throws `hashmap assert` and dies on the line that inserts. Kortschak's version printed each index as it went; it climbed to 81 and threw on the next insert. Change the string inside the key and the failure changes with it. The report lists a nil pointer dereference, an "unexpected fault address," and an infinite loop pinning a core at 100%, each tied to a particular value.[^variations] One struct key, four ways to die.

## Why two equal fields cancelled

The reporter left the clue that cracks it: "Using sf with only the int field or the string field results in normal behaviour." A one-field key was fine. A key whose two fields were equal was fatal. That points at how the runtime folded the fields into a single hash.

In Go 1.0, a struct or array key that held a string, a float, an interface, or a nested struct got a hash function the compiler generated for its exact type, walking it field by field. Each field was hashed on its own and folded into a running accumulator, and the fold was an exclusive-or:

```c
*h ^= hash; // src/pkg/runtime/alg.c: fold this field into the running hash
```

XOR has a property that is useful almost everywhere and ruinous here: a value XORed with itself is zero. `x ^ x == 0`. So when a struct's two fields were equal, their two hashes were equal, and folding the second on top of the first cancelled it. The accumulator returned to exactly where it started, the seed, carrying no trace of either field.

You can watch it. This is the essential shape of the Go 1.0 combiner, on current Go:

```go run title="cancel.go"
package main

import "fmt"

// Go 1.0 folded each struct field's hash into the accumulator with XOR.
// XOR is self-inverse (x ^ x == 0), so two equal fields cancelled, and
// every key of the form pair{x, x} collapsed onto the same seed.
func go10StructHash(seed, fieldA, fieldB uint64) uint64 {
	h := seed
	h ^= fieldA
	h ^= fieldB
	return h
}

func main() {
	const seed = 0x9e3779b9
	for _, fh := range []uint64{1, 42, 0xdeadbeef, 999999} {
		fmt.Printf("field hash %-10d -> pair{x,x} hash %#x\n", fh, go10StructHash(seed, fh, fh))
	}
}
```

```output
field hash 1          -> pair{x,x} hash 0x9e3779b9
field hash 42         -> pair{x,x} hash 0x9e3779b9
field hash 3735928559 -> pair{x,x} hash 0x9e3779b9
field hash 999999     -> pair{x,x} hash 0x9e3779b9
```

Whatever the fields hash to, `pair{x, x}` hashes to the seed. Every key in Kortschak's loop had two equal halves, so all five hundred distinct keys produced the same hash value. The hash did not skip a field by an off-by-one or a padding mistake. For this shape of key it dropped every field, by arithmetic.

That is why a single-field key was safe, and why a key with two different fields was safe too. Give the two halves different values and there is nothing to cancel. I ran that variant on Go 1.0 as well, `pair{a, b}` with `a` and `b` distinct, and it stores all five hundred keys and finishes clean. The bug needed symmetry.

## Why the map crashed instead of slowing down

A pile of keys that all hash the same is normally just slow. The map puts them in one bucket and walks the bucket on every lookup. It should not throw an assertion. The reason it did is worth the detour, because it says something about the map Go shipped in 2012.

The keys were genuinely distinct, so the equality check never matched, and the map kept all of them as separate entries. But they all carried the same hash, so they all wanted the same bucket. Go 1.0's map was an extendible hash table: when one bucket filled past its probe window, the table split it, looking at another bit of the hash and sending some entries each way. That split is the escape valve for a hot bucket, and it works only if the colliding keys differ somewhere in their bits. These did not. They were equal in every bit, so each split sent all of them to the same side, the bucket refilled at once, and the table split again with nothing gained. Once the entries stacked past the fixed window the bookkeeping walks, the probe arithmetic ran off the end of the subtable and the runtime threw its internal assertion. A different key string put the overrun on a live pointer, which is the fault, or left the never-progressing split running forever, which is the spin.

The hash and the equality check never disagreed. Equality was correct on every comparison, which is exactly what kept the map hunting for room it could not make.

## The other bug: a key too big to fit

Issue #3573, reported by Rémy Oudompheng on 28 April 2012, was the other map crash, and it came from the opposite direction. Not the key's shape, its size.

```go run title="big.go"
package main

import (
	"fmt"
	"unsafe"
)

type Big [50]int64 // 50 * 8 = 400 bytes

func main() {
	fmt.Println("key size in bytes:", unsafe.Sizeof(Big{}))
	seen := make(map[Big]bool)
	pow := Big{0: 2}
	for b := 0; b < 100; b++ {
		seen[pow] = true
	}
	fmt.Println("stored, map len:", len(seen))
}
```

```output
key size in bytes: 400
stored, map len: 1
```

A `[50]int64` is four hundred bytes of plain integers, so the runtime hashes it in one pass over the raw memory. No cancellation. Current Go stores the key and moves on. On Go 1.0:

```
$ go run big.go
key size in bytes: 400
panic: invalid memory address or nil pointer dereference
throw: panic during gc
[signal 0xb code=0x1 addr=0x0 pc=0x40737e]

goroutine 1 [running]:
main.main()
	/big.go:15 +0x169
```

The size is the bug. Go 1.0's map stored each key and value inline in its entries and tracked their sizes and offsets in single bytes. Ian Lance Taylor named it on the issue: "the hashmap code uses a uint8 to store the size of a data element," so it "fails if the total of the key size plus the data size, with appropriate rounding, is >= 256."[^ilt] Four hundred bytes is past 255. The byte-wide size wrapped, the offset that locates the value inside the entry came out wrong, and when the map grew and the garbage collector walked its entries it followed a bad pointer and faulted. There was no path in the code to hold a key that large by reference. It simply did not fit the bookkeeping.

The two issues share a thread. Kortschak first hit the struct-key failure in a comment on #3573, and after the large-key fix landed Russ Cox split the struct case out into its own report, #3695.[^thread] Same subsystem, overlapping crash signatures, two unrelated causes.

## The fix

Go 1.0.2 carried one runtime change for each bug.

For #3695, Jan Ziak replaced the cancelling XOR with a fold that cannot cancel. Change 6304062, "runtime: improved continuity in hash computation," rewrote the combiner in `src/pkg/runtime/alg.c` to multiply the accumulator by an odd constant every time it takes in a field:[^cl3695]

```diff
-	*h ^= hash;
+	*h = (*h ^ hash) * M1;
```

The multiply is what breaks the symmetry. Fold a field, multiply. Fold the second, equal field, and it mixes against an accumulator the first field has already moved, so the two contributions are no longer equal and there is nothing left to cancel. The same one-line idea went into every combiner in the file, for interfaces and floats as much as for plain memory.

For #3573, Russ Cox taught the map to hold big keys by reference. Change 6215078, "runtime: handle and test large map values," added an indirection flag so a key or value too large for the inline entry is stored as a pointer to a heap copy, and made the byte-wide size ceiling an explicit constant.[^cl3573] A four-hundred-byte key now costs one pointer in the table, and the offset arithmetic stays inside a byte where it belongs.

A third fix rode along in the same window, a compiler crash on any struct that had a blank `_` field, from the same family of type-algorithm code.[^blank] The map machinery was getting a hard look that month.

## The second point release

Go 1.0.2 was 118 commits on the release branch.[^release] Most were the usual point-release freight, documentation and small library fixes. A few were real: a superpolynomial blowup fixed in `math/big`'s Karatsuba multiplication, a panic in `crypto/x509` when a certificate named an unavailable hash function, a deadlock in `time.Sleep(0)`.[^minor] The two map bugs are why the release was cut.

They are an odd pair to headline a release, because neither is exotic. One is a struct with two equal fields. The other is an array that happens to be large. Both are keys you would write without a second thought, and on the compiler that had shipped eleven weeks earlier both of them crashed. The map is the one container nearly every Go program leans on, and in Go 1.0 its hash could be zeroed out by a symmetric key or overrun by a big one.

Neither failure survives on a toolchain you can install today. The only way to watch a struct of two equal fields throw `hashmap assert` is to rebuild the 2012 runtime, which is what threw the one above.

[^release]: [Release History](https://go.dev/doc/devel/release), the source for the 13 June 2012 date and the verbatim description of go1.0.2 as a fix for two bugs in maps using struct or array keys (issue 3695 and issue 3573), plus minor code and documentation fixes. There are 118 commits between the go1.0.1 and go1.0.2 tags.
[^issue]: [golang/go issue #3695](https://github.com/golang/go/issues/3695), "runtime: computed hash value for struct map key ignores some fields," reported by Dan Kortschak (kortschak) on 2 June 2012; the source for the reproduction program and the note that single-field keys behave normally.
[^repro]: Reproduced by building the `go1` source tag with a period compiler (gcc 4.6 on ubuntu 12.04, linux/amd64) and running the programs unchanged on the resulting toolchain. The failure is memory corruption, so the exact outcome depends on the build and the bytes in the key; the run shown threw `hashmap assert`, and the report documents the other outcomes.
[^variations]: The issue lists the result as `hashmap assert`, an invalid-memory-address nil pointer dereference, an "unexpected fault address," or a non-terminating loop at 100% CPU, depending on the string constant used in the key.
[^ilt]: Ian Lance Taylor, on [issue #3573](https://github.com/golang/go/issues/3573): the hashmap stored the size of a data element in a `uint8`, so once the key size plus the value size reached 256 bytes the field overflowed and the entry offsets went wrong.
[^thread]: [golang/go issue #3573](https://github.com/golang/go/issues/3573), "runtime: use of large map key causes crash," reported by Rémy Oudompheng on 28 April 2012. The struct-key case was raised inside it and split out into #3695 after the large-key fix landed.
[^cl3695]: Change 6304062, "runtime: improved continuity in hash computation," by Jan Ziak, "Fixes #3695." It changed `src/pkg/runtime/alg.c`, replacing the XOR fold with a multiply-mix using the odd constants `M0` and `M1` across the memory, interface, and float combiners.
[^cl3573]: Change 6215078, "runtime: handle and test large map values," by Russ Cox, "Fixes #3573." It changed `src/pkg/runtime/hashmap.c` and added `test/bigmap.go`, storing oversized keys and values by pointer instead of inline.
[^blank]: Change 6296052, "cmd/gc: do not crash on struct with _ field," which fixed issue #3607 by stopping a memory-hash run from starting on a blank field. It touched the same struct hash and equality generation in `src/cmd/gc/subr.c`.
[^minor]: Among the non-map fixes in 1.0.2: the `math/big` Karatsuba complexity fix (Rémy Oudompheng), a `crypto/x509` panic on an unavailable hash function (Adam Langley), and a `time.Sleep(0)` deadlock (Dmitriy Vyukov).
