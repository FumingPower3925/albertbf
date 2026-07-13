---
title: "Go 1.0.3: The Unchecked Length"
date: 2026-07-16
description: "Go's third point release was 223 commits the release note called minor. Two of them were a decompressor that crashed on malformed input and an RSA signature that came out a byte short."
tags: [go, go-history, security]
series: go-version-by-version
links:
  - { label: "compress/flate: panic on index out of range (issue 3815)", url: "https://github.com/golang/go/issues/3815" }
  - { label: "Go release history", url: "https://go.dev/doc/devel/release" }
---

Go 1.0.3 shipped on 21 September 2012, the third point release and by far the largest: 223 commits against 1.0.2. The release note describes all of it in one line: "includes minor code and documentation fixes."[^release] Most of it is exactly that, typo corrections and CLA additions and doc tweaks. The note tells you nothing about which of those commits you actually needed.

Two of them are the subject here, and neither is minor. One let a few malformed bytes crash any program that decompressed untrusted data. The other made a Go TLS server fail about one handshake in a few hundred against OpenSSL, at random, for a year. Both shipped as one-line entries in the log.

## A few bytes that crash the decompressor

Start with the crash. You have some compressed bytes from a source you do not control, and you inflate them. Here is that, with a stream built to be malformed. On current Go, hit Run.

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

Current Go reads three bytes, decides the stream is corrupt, and returns an error for the caller to handle. Now the same program on Go 1.0, built from source and run unchanged:[^repro]

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

No error value this time. The panic comes up from inside `compress/flate`, three stack frames deep in the standard library, on input the program was handed from outside, and none of it ever decompressed to anything.

## The length the decoder trusted

DEFLATE, the algorithm behind gzip and zlib, encodes a block by first describing the Huffman codes it will use, then the data. A dynamic-Huffman block opens with three counts: how many literal and length codes follow, how many distance codes, and how many code-length codes. The decoder reads those counts and then reads exactly that many entries.

Two of those counts drive the bug. Decode them out of the stream's first two bytes:

```go run title="header.go"
package main

import "fmt"

func main() {
	// The block header lives in the first two bytes, read low bit first:
	// BFINAL(1) BTYPE(2) HLIT(5) HDIST(5) HCLEN(4).
	b0, b1 := byte(0xfc), byte(0xfe)
	bits := uint16(b0) | uint16(b1)<<8

	btype := (bits >> 1) & 3
	hlit := (bits >> 3) & 0x1f
	hdist := (bits >> 8) & 0x1f

	fmt.Printf("BTYPE = %d (2 is a dynamic-Huffman block)\n", btype)
	fmt.Printf("HLIT  = %d, so nlit  = %d\n", hlit, int(hlit)+257)
	fmt.Printf("HDIST = %d, so ndist = %d\n", hdist, int(hdist)+1)
	fmt.Printf("nlit + ndist = %d, and the table holds 286 + 32 = 318\n",
		int(hlit)+257+int(hdist)+1)
}
```

```output
BTYPE = 2 (2 is a dynamic-Huffman block)
HLIT  = 31, so nlit  = 288
HDIST = 30, so ndist = 31
nlit + ndist = 319, and the table holds 286 + 32 = 318
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

The array holds 318 entries, and 318 is `maxLit + maxDist`, exactly `286 + 32`. Those 318 slots are the largest header the format permits. RFC 1951 caps HLIT at 29, so a well-formed `nlit` never exceeds 286.[^rfc] The array was sized for legal input, with no room to spare.

But `nlit` came straight from the stream, and the stream said 288, two more than the 286 the array budgeted for literal codes. The decoder fills `nlit + ndist` entries, and for this header that is 319, one more than the array holds. The write to `f.bits[318]` lands one index past the end, where the last valid slot is 317, so Go's bounds check fires and turns the out-of-bounds write into a panic instead of the silent memory corruption it would be in C.

## One bounds check

The fix is a single guard, added right after the count is read. Nigel Tao's change checks `nlit` against the size the array was built for, and returns a corrupt-input error when it does not fit:[^cl]

```diff
 	nlit := int(f.b&0x1F) + 257
+	if nlit > maxLit {
+		return CorruptInputError(f.roffset)
+	}
```

Three lines. `ndist` and the code-length count could not exceed their arrays, so only `nlit` needed the check. With the guard in place the 288 is rejected at the header, before a single code length is written, and the corrupt stream becomes the `flate: corrupt input` error the runnable at the top prints.

## The panic as denial of service

A panic is not a returned error, and that difference is why this is a security bug. An error travels up the call stack as a value the caller chose to ask for. A panic unwinds the stack on its own, and if nothing recovers it, it ends the program. Code that decompresses untrusted input is often exactly the code that does not expect to fail this way: it calls `io.Copy` from a flate reader and handles the error, never imagining the read itself could bring the program down.

So a malformed header becomes a denial of service. The input needs no valid compressed data and no credentials, just a handful of bytes with the wrong count in the first one, and it triggers every time. Anything that inflated bytes off the wire was exposed, and in 2012 that surface was widening, anywhere a server accepted compressed input it had not created.

## A signature a byte short

The flate panic was one bug the note buried. The other is quieter and stranger. In July 2012 someone reported that a Go TLS server worked against Go clients and against browsers, and failed against OpenSSL, roughly one handshake in every few hundred, with nothing to distinguish the connections that broke.[^rsaissue]

During a TLS handshake the server signs part of the exchange with its RSA private key and the client verifies it. The signature Go produced was mathematically valid, and verifying it as a number succeeded. What OpenSSL rejected was its length. Here is one message signed with one RSA key, on Go 1.0 and on a current toolchain. The key was generated by the Go 1.0 toolchain so both accept it, and PKCS#1 v1.5 signing is deterministic, so the value is fixed:[^rsarepro]

```
# Go 1.0, the toolchain that shipped the bug:
$ go run sign.go
modulus is 128 bytes; signature is 127 bytes
first 6 bytes: c8fe05bee5e3

# a current toolchain, same key and message:
$ go run sign.go
modulus is 128 bytes; signature is 128 bytes
first 6 bytes: 00c8fe05bee5
```

The modulus is 128 bytes, so a signature under this key is 128 bytes. On Go 1.0 this one is 127. The two outputs are the same value: the current signature is the Go 1.0 signature with a `00` byte in front. Go 1.0 left off a leading zero.

## The missing zero

A PKCS#1 v1.5 signature is a large integer, and putting it on the wire means encoding it as bytes. The standard fixes the width. The octet string is exactly as many bytes as the modulus, big-endian, padded on the left with zeros when the number is small.[^i2osp] A 128-byte modulus takes a 128-byte signature, always.

Go 1.0 computed the integer correctly, then encoded it with `big.Int.Bytes`, which returns the shortest big-endian form and drops leading zeros:

```go run title="pad.go"
package main

import (
	"fmt"
	"math/big"
)

// leftPad is what the fix added: pad the big-endian bytes back out to k.
func leftPad(b []byte, k int) []byte {
	out := make([]byte, k)
	copy(out[k-len(b):], b)
	return out
}

func main() {
	// An RSA signature value whose big-endian form starts with a zero byte.
	s := new(big.Int).SetBytes([]byte{0x00, 0xc8, 0xfe, 0x05, 0xbe})
	k := 5 // the modulus is 5 bytes wide

	buggy := s.Bytes()
	fixed := leftPad(s.Bytes(), k)
	fmt.Printf("Go 1.0   c.Bytes():   % x  (%d bytes)\n", buggy, len(buggy))
	fmt.Printf("Go 1.0.3 left-padded: % x  (%d bytes)\n", fixed, len(fixed))
}
```

```output
Go 1.0   c.Bytes():   c8 fe 05 be  (4 bytes)
Go 1.0.3 left-padded: 00 c8 fe 05 be  (5 bytes)
```

The `leftPad` is the repair; the `Bytes` call above it is what Go 1.0 shipped. Whenever the signature integer was small enough to begin with a zero byte, `Bytes` returned one byte fewer than the modulus. For a value that looks random, a leading zero byte turns up about once in 256, which is the rate at which the handshakes failed.

Go's own verifier accepted the short encoding, so Go talking to Go never noticed. OpenSSL did not. Adam Langley put the requirement in the change description itself: *"OpenSSL requires that RSA signatures be exactly the same byte-length as the modulus."* His fix left-pads the output to that length, and it covered both functions that had the bug, PKCS#1 v1.5 signing and encryption.[^rsacl]

## The third point release

Go 1.0.3 was 223 commits, and the two bugs above are two of them. Most of the rest is the freight the release note names: documentation, typos, contributor additions. A few more were real. The amd64 compiler had been rounding float-to-integer conversions when the language requires truncation, so `uint64` of a runtime `2.9` returned 3.[^float] Each of these is a single line in the log.

That is the shape of a point release once people depend on the language: a long tail of small corrections, and buried in it, a denial of service and a signature that OpenSSL would not accept, filed under minor code and documentation fixes.

[^release]: [Release History](https://go.dev/doc/devel/release), the source for the 21 September 2012 date and the verbatim description of go1.0.3 as "minor code and documentation fixes." There are 223 commits between the go1.0.2 and go1.0.3 tags.
[^issue]: [golang/go issue #3815](https://github.com/golang/go/issues/3815), "compress/flate: panic on index out of range." A malformed dynamic-Huffman header made the flate decoder index past a fixed array and panic instead of returning an error.
[^repro]: Reproduced by building the `go1` source tag with a period compiler (gcc 4.6 on ubuntu 12.04, linux/amd64) and running the program unchanged on the resulting toolchain. The malformed byte string is the input from the fix's regression test; on Go 1.0 it panics inside `compress/flate`, on a current toolchain it returns a `flate: corrupt input` error.
[^rfc]: [RFC 1951](https://www.rfc-editor.org/rfc/rfc1951) section 3.2.7 defines HLIT as the number of literal/length codes minus 257; a well-formed stream keeps it at most 29, so `nlit` stays at or below 286. The field is five bits wide, so a malformed stream can encode HLIT up to 31, giving `nlit` = 288.
[^cl]: Change 6352109 (go1.0.3 backport commit d74aea6fdc36), "compress/flate: fix panic when nlit is out of bounds," by Nigel Tao, "Fixes #3815," reviewed by Rob Pike. It added the `nlit > maxLit` guard in `readHuffman` in `src/pkg/compress/flate/inflate.go`.
[^rsaissue]: [golang/go issue #3796](https://github.com/golang/go/issues/3796), "crypto/tls: Intermittent errors with OpenSSL client," opened 3 July 2012. A Go TLS server produced occasional RSA signatures that OpenSSL-based clients rejected as bad.
[^rsarepro]: Reproduced with a 1024-bit RSA key generated by the go1 toolchain, so both toolchains accept it, reconstructed from its raw components (modulus, exponents, primes) to bypass version-specific key validation. Signing used `rsa.SignPKCS1v15` with a nil random source, which skips blinding and makes the signature value deterministic. For the message shown, Go 1.0 produces a 127-byte signature and a current toolchain produces the same value at 128 bytes, with the leading zero restored.
[^i2osp]: [RFC 3447](https://www.rfc-editor.org/rfc/rfc3447) specifies the integer-to-octet-string primitive I2OSP with a fixed output length equal to the modulus size in bytes, k = (modulus bit length + 7) / 8.
[^rsacl]: Change 6352093 (go1.0.3 backport commit 9dec2eb42a3a), "crypto/rsa: left-pad PKCS#1 v1.5 outputs," by Adam Langley, fixes issue #3796. It left-pads the output of `SignPKCS1v15` and `EncryptPKCS1v15` to the modulus length; the quoted line is from the change description.
[^float]: Also in 1.0.3: `cmd/6g` fixed a float-to-`uint64` conversion that used the rounding convert instruction instead of the truncating one, so a runtime `uint64(2.9)` returned 3 rather than 2. Issue #3804, change 6352079, by Shenghou Ma.
