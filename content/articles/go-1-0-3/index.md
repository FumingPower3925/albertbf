---
title: "Go 1.0.3: The Unchecked Length"
date: 2026-07-16
description: "Go's third point release was 223 commits the release note called minor. One of them stopped a few bytes of malformed input from crashing any program that decompressed data it did not write."
tags: [go, go-history, security]
series: go-version-by-version
links:
  - { label: "compress/flate: panic on index out of range (issue 3815)", url: "https://github.com/golang/go/issues/3815" }
  - { label: "Go release history", url: "https://go.dev/doc/devel/release" }
---

Go 1.0.3 shipped on 21 September 2012, the third point release and by far the largest: 223 commits against 1.0.2. The release note describes all of it in one line: "includes minor code and documentation fixes."[^release] Most of it is exactly that, typo corrections and CLA additions and doc tweaks. The note tells you nothing about which of those commits you actually needed.

One of them closed a way to crash a Go program from the outside. If your code decompressed data it did not produce, a gzip request body, an uploaded archive, a zlib blob off a socket, then a few malformed bytes could take it down. Not corrupt a value, not leak memory, just crash, with a stack trace out of the standard library. That is issue #3815, and it hid in a release the note called minor.[^issue]

## A few bytes that crash the decompressor

The setup is ordinary. You have some compressed bytes from a source you do not control, and you inflate them. Here is that, with a stream built to be malformed. On current Go, hit Run.

```go run title="decompress.go"
package main

import (
	"compress/flate"
	"fmt"
	"io"
	"io/ioutil"
	"strings"
)

func main() {
	// A crafted DEFLATE stream with a malformed block header.
	bad := "\xfc\xfe\x36\xe7\x5e\x1c\xef\xb3\x55\x58\x77\xb6\x56\xb5\x43\xf4" +
		"\x6f\xf2\xd2\xe6\x3d\x99\xa0\x85\x8c\x48\xeb\xf8\xda\x83\x04\x2a" +
		"\x75\xc4\xf8\x0f\x12\x11\xb9\xb4\x4b\x09\xa0\xbe\x8b\x91\x4c"
	r := flate.NewReader(strings.NewReader(bad))
	n, err := io.Copy(ioutil.Discard, r)
	fmt.Printf("copied=%d err=%v\n", n, err)
}
```

```output
copied=0 err=flate: corrupt input before offset 3
```

Current Go reads three bytes, decides the stream is corrupt, and returns an error. That is the whole point of returning an error: the caller handles it and moves on. Now the same program on Go 1.0, built from source and run unchanged:[^repro]

```
$ go version
go version go1
$ go run decompress.go
panic: runtime error: index out of range

goroutine 1 [running]:
compress/flate.(*decompressor).readHuffman(0xf840059000, 0x0, 0x0, 0x1)
	/goroot/src/pkg/compress/flate/inflate.go:343 +0x3cf
compress/flate.(*decompressor).nextBlock(0xf840059000, 0x405fc6)
	/goroot/src/pkg/compress/flate/inflate.go:262 +0x1ab
```

No error value. A panic, thrown from inside `compress/flate`, three stack frames deep in the standard library, on input the program was handed from outside. The bytes never decompressed to anything. They only had to be shaped wrong.

## The length the decoder trusted

DEFLATE, the algorithm behind gzip and zlib, encodes a block by first describing the Huffman codes it will use, then the data. A dynamic-Huffman block opens with three counts: how many literal and length codes follow, how many distance codes, and how many code-length codes. The decoder reads those counts and then reads exactly that many entries.

The first count is the one that matters here. Decode the first byte of the malformed stream:

```go run title="header.go"
package main

import "fmt"

func main() {
	b := byte(0xfc) // first byte of the malformed stream
	fmt.Printf("byte %#02x, bits low to high: %08b\n", b, b)
	fmt.Println("BFINAL =", b&1)
	fmt.Println("BTYPE  =", (b>>1)&3, "(2 means a dynamic-Huffman block)")
	hlit := (b >> 3) & 0x1f
	fmt.Println("HLIT   =", hlit)
	fmt.Println("nlit = HLIT + 257 =", int(hlit)+257)
}
```

```output
byte 0xfc, bits low to high: 11111100
BFINAL = 0
BTYPE  = 2 (2 means a dynamic-Huffman block)
HLIT   = 31
nlit = HLIT + 257 = 288
```

HLIT is a five-bit field, so it holds 0 through 31, and the decoder reads it as `nlit = HLIT + 257`, a number from 257 to 288. This stream sets it to its maximum: 288 code lengths to follow.

The decoder writes those code lengths into a fixed array. In the Go 1.0 source that array is declared for the largest valid header:

```go
const (
	maxLit  = 286
	maxDist = 32
)

// inside the decompressor:
bits [maxLit + maxDist]int // 318 entries

func (f *decompressor) readHuffman() error {
	// ...
	nlit := int(f.b&0x1F) + 257 // 257..288, taken straight from the stream
	// ...
	for i, n := 0, nlit+ndist; i < n; {
		// ...
		f.bits[i] = x // writes indices 0 .. nlit+ndist-1
		i++
	}
}
```

The array holds 318 entries, and 318 is `maxLit + maxDist`, exactly `286 + 32`. That is the size of the largest header the format permits: RFC 1951 caps HLIT at 29, so a well-formed `nlit` never exceeds 286.[^rfc] The array was sized for legal input, with no room to spare.

But `nlit` was not read from a well-formed header. It was read from the stream, and the stream said 288. With `nlit` at 288 and `ndist` at 32, the loop runs `i` up to 319 and writes `f.bits[318]` and `f.bits[319]`, two past the end of a 318-entry array. Go's bounds check fires, and an out-of-bounds write becomes a panic instead of the silent memory corruption it would be in C. The safety net caught the write. Nothing had caught the length.

## One bounds check

The fix is a single guard, added right after the count is read. Nigel Tao's change checks `nlit` against the size the array was built for, and returns a corrupt-input error when it does not fit:[^cl]

```diff
 	nlit := int(f.b&0x1F) + 257
+	if nlit > maxLit {
+		return CorruptInputError(f.roffset)
+	}
```

Three lines. `ndist` and the code-length count could not exceed their arrays, so only `nlit` needed the check. With it in place, the 288 is rejected at the header, before a single code length is written, and the caller gets the `flate: corrupt input` error that the runnable at the top prints. The panic is gone because the length is now checked against the buffer instead of trusted into it.

## Why the panic mattered

A panic is not a returned error, and the difference is the whole security story. An error travels up the call stack as a value the caller chose to ask for. A panic unwinds the stack on its own, and if nothing recovers it, it ends the program. Code that decompresses untrusted input is often exactly the code that does not expect to fail this way: it calls `io.Copy` from a flate reader and handles the error, never imagining the read itself could abort the goroutine.

That turns a malformed header into a denial of service. The input needs no valid compressed data, no authentication, no size: a handful of bytes with the wrong count in the first one is enough, and it triggers every time. Anything that inflated bytes off the wire was exposed, and in 2012 that was a widening surface, gzip-encoded HTTP bodies, uploaded content, compressed data inside application protocols. The bug was not that the decoder rejected bad input. It was that it crashed on it.

## The biggest little release

Go 1.0.3 was 223 commits, and the flate fix is one of them. Most of the rest is the freight the release note names: documentation, typos, contributor additions. But the same release quietly fixed real bugs the note does not mention. The amd64 compiler had been rounding float-to-integer conversions when the language requires truncation, so `uint64` of a runtime `2.9` returned 3.[^float] The RSA code had been emitting PKCS#1 v1.5 signatures a byte short whenever the result had a leading zero, which made OpenSSL reject about one Go TLS handshake in 256.[^rsa] Each of those is a one-line entry in a 223-commit log, and each is the kind of bug you would want to know shipped a fix.

That is what a point release looks like once a language has real users: a long tail of small, specific corrections, most boring, a few that decide whether a program stays up. The note said minor code and documentation fixes. One of those minor fixes was the bounds check between a malformed length and a downed process, on every program that inflated bytes it had not written.

[^release]: [Release History](https://go.dev/doc/devel/release), the source for the 21 September 2012 date and the verbatim description of go1.0.3 as "minor code and documentation fixes." There are 223 commits between the go1.0.2 and go1.0.3 tags.
[^issue]: [golang/go issue #3815](https://github.com/golang/go/issues/3815), "compress/flate: panic on index out of range." A malformed dynamic-Huffman header made the flate decoder index past a fixed array and panic instead of returning an error.
[^repro]: Reproduced by building the `go1` source tag with a period compiler (gcc 4.6 on ubuntu 12.04, linux/amd64) and running the program unchanged on the resulting toolchain. The malformed byte string is the input from the fix's regression test; on Go 1.0 it panics inside `compress/flate`, on a current toolchain it returns a `flate: corrupt input` error.
[^rfc]: [RFC 1951](https://www.rfc-editor.org/rfc/rfc1951) section 3.2.7 defines HLIT as the number of literal/length codes minus 257; a well-formed stream keeps it at most 29, so `nlit` stays at or below 286. The field is five bits wide, so a malformed stream can encode HLIT up to 31, giving `nlit` = 288.
[^cl]: Change 6352109 (go1.0.3 backport commit d74aea6fdc36), "compress/flate: fix panic when nlit is out of bounds," by Nigel Tao, "Fixes #3815," reviewed by Rob Pike. It added the `nlit > maxLit` guard in `readHuffman` in `src/pkg/compress/flate/inflate.go`.
[^float]: Also in 1.0.3: `cmd/6g` fixed a float-to-`uint64` conversion that used the rounding convert instruction instead of the truncating one, so a runtime `uint64(2.9)` returned 3 rather than 2. Issue #3804, change 6352079, by Shenghou Ma.
[^rsa]: Also in 1.0.3: `crypto/rsa` began left-padding PKCS#1 v1.5 outputs to the modulus length, fixing signatures that came out a byte short when the result had a leading zero byte and were rejected by strict verifiers such as OpenSSL. Issue #3796, change 6352093, by Adam Langley.
