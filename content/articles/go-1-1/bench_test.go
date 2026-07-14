// Package gobench is a self-contained benchmark suite that compiles unchanged
// on the Go 1.0 and Go 1.1 gc toolchains (it uses only Go 1.0 APIs). The same
// source is compiled by each toolchain and run on the same machine, so the
// difference in ns/op is attributable to the compiler and runtime alone.
package gobench

import (
	"bytes"
	"compress/gzip"
	"encoding/gob"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"regexp"
	"sort"
	"testing"
)

// Sinks keep results live so the (non-optimizing) compilers cannot discard the
// work; both toolchains see identical code, so the comparison stays fair.
var (
	sinkInt   int
	sinkBytes []byte
)

// ---- allocation + GC + pointer chasing --------------------------------------

type node struct {
	left, right *node
	value       int
}

func bottomUpTree(item, depth int) *node {
	if depth <= 0 {
		return &node{value: item}
	}
	return &node{
		left:  bottomUpTree(2*item-1, depth-1),
		right: bottomUpTree(2*item, depth-1),
		value: item,
	}
}

func (n *node) itemCheck() int {
	if n.left == nil {
		return n.value
	}
	return n.value + n.left.itemCheck() - n.right.itemCheck()
}

func BenchmarkBinaryTree(b *testing.B) {
	for i := 0; i < b.N; i++ {
		sinkInt = bottomUpTree(0, 13).itemCheck()
	}
}

// ---- integer compute (loops, bounds checks, swaps) --------------------------

func fannkuch(n int) int {
	perm := make([]int, n)
	perm1 := make([]int, n)
	count := make([]int, n)
	for i := range perm1 {
		perm1[i] = i
	}
	r := n
	maxFlips := 0
	for {
		for r != 1 {
			count[r-1] = r
			r--
		}
		copy(perm, perm1)
		flips := 0
		for {
			k := perm[0]
			if k == 0 {
				break
			}
			for i, j := 0, k; i < j; i, j = i+1, j-1 {
				perm[i], perm[j] = perm[j], perm[i]
			}
			flips++
		}
		if flips > maxFlips {
			maxFlips = flips
		}
		for {
			if r == n {
				return maxFlips
			}
			perm0 := perm1[0]
			i := 0
			for i < r {
				perm1[i] = perm1[i+1]
				i++
			}
			perm1[r] = perm0
			count[r]--
			if count[r] > 0 {
				break
			}
			r++
		}
	}
	return maxFlips // unreachable; Go 1.0 requires it (no infinite-loop terminating rule)
}

func BenchmarkFannkuch(b *testing.B) {
	for i := 0; i < b.N; i++ {
		sinkInt = fannkuch(8)
	}
}

// ---- floating point compute -------------------------------------------------

func mandelbrot(size int) int {
	count := 0
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			zr, zi := 0.0, 0.0
			cr := 2.0*float64(x)/float64(size) - 1.5
			ci := 2.0*float64(y)/float64(size) - 1.0
			for i := 0; i < 50; i++ {
				zr2 := zr*zr - zi*zi + cr
				zi = 2*zr*zi + ci
				zr = zr2
				if zr*zr+zi*zi > 4 {
					break
				}
			}
			count += int(zr)
		}
	}
	return count
}

func BenchmarkMandelbrot(b *testing.B) {
	for i := 0; i < b.N; i++ {
		sinkInt = mandelbrot(64)
	}
}

// ---- fmt: interface conversions + formatting --------------------------------

func BenchmarkFmtFprintfInt(b *testing.B) {
	for i := 0; i < b.N; i++ {
		fmt.Fprintf(ioutil.Discard, "%d", i)
	}
}

func BenchmarkFmtFprintfString(b *testing.B) {
	for i := 0; i < b.N; i++ {
		fmt.Fprintf(ioutil.Discard, "%s", "hello")
	}
}

// ---- append: slice growth (inlined in Go 1.1) -------------------------------

func BenchmarkAppendBytes(b *testing.B) {
	for i := 0; i < b.N; i++ {
		var buf []byte
		for j := 0; j < 2048; j++ {
			buf = append(buf, byte(j))
		}
		sinkBytes = buf
	}
}

// ---- maps -------------------------------------------------------------------

func BenchmarkMapAssignInt(b *testing.B) {
	m := make(map[int]int)
	for i := 0; i < b.N; i++ {
		m[i&0xffff] = i
	}
}

func BenchmarkMapAccessInt(b *testing.B) {
	m := make(map[int]int)
	for i := 0; i < 65536; i++ {
		m[i] = i
	}
	b.ResetTimer()
	sum := 0
	for i := 0; i < b.N; i++ {
		sum += m[i&0xffff]
	}
	sinkInt = sum
}

// ---- reflection-heavy encoders ----------------------------------------------

type payload struct {
	Name string
	Vals []int
	M    map[string]int
}

var sample = payload{
	Name: "benchmark",
	Vals: []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10},
	M:    map[string]int{"a": 1, "b": 2, "c": 3},
}

func BenchmarkGobEncode(b *testing.B) {
	var buf bytes.Buffer
	enc := gob.NewEncoder(&buf)
	for i := 0; i < b.N; i++ {
		buf.Reset()
		if err := enc.Encode(&sample); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkJSONMarshal(b *testing.B) {
	for i := 0; i < b.N; i++ {
		out, err := json.Marshal(&sample)
		if err != nil {
			b.Fatal(err)
		}
		sinkBytes = out
	}
}

// ---- regexp -----------------------------------------------------------------

var re = regexp.MustCompile("[a-z]+[0-9]+")
var reText = []byte("the quick brown fox123 jumps over the lazy dog456 while abc789 runs on")

func BenchmarkRegexpMatch(b *testing.B) {
	for i := 0; i < b.N; i++ {
		if !re.Match(reText) {
			b.Fatal("no match")
		}
	}
}

// ---- sort (interface Less/Swap dispatch) ------------------------------------

func BenchmarkSortInts(b *testing.B) {
	data := make([]int, 2048)
	for i := 0; i < b.N; i++ {
		for j := range data {
			data[j] = (j*1103515245 + i*40503) & 0xffff
		}
		sort.Ints(data)
	}
	sinkInt = data[0]
}

// ---- interface method dispatch ----------------------------------------------

type adder interface{ add(int) int }
type myInt int

func (m myInt) add(x int) int { return int(m) + x }

// A slice of an interface type forces real dynamic dispatch per call (no
// devirtualization in either toolchain). The inner loop keeps per-op cost well
// above a nanosecond so the iteration-count estimator stays in range: Go 1.0's
// estimator does that arithmetic in 32-bit int and overflows on a sub-ns op.
func BenchmarkInterfaceCall(b *testing.B) {
	adders := make([]adder, 256)
	for i := range adders {
		adders[i] = myInt(i)
	}
	sum := 0
	for i := 0; i < b.N; i++ {
		for _, a := range adders {
			sum = a.add(sum)
		}
	}
	sinkInt = sum
}

// ---- compress/flate throughput ----------------------------------------------

var gzInput = bytes.Repeat([]byte("the quick brown fox jumps over the lazy dog. "), 1000)

func BenchmarkGzip(b *testing.B) {
	for i := 0; i < b.N; i++ {
		var buf bytes.Buffer
		w := gzip.NewWriter(&buf)
		if _, err := w.Write(gzInput); err != nil {
			b.Fatal(err)
		}
		w.Close()
		sinkInt = buf.Len()
	}
}

// ---- scheduler: many short-lived goroutines + channel sync ------------------
// Sensitive to GOMAXPROCS: Go 1.0 funnels all scheduling through one global
// lock and one run queue; Go 1.1 uses per-P run queues with work stealing.

func BenchmarkGoroutineFanout(b *testing.B) {
	const g = 64
	for i := 0; i < b.N; i++ {
		done := make(chan int, g)
		for k := 0; k < g; k++ {
			go func(seed int) {
				s := 0
				for n := 0; n < 1000; n++ {
					s += n ^ seed
				}
				done <- s
			}(k)
		}
		total := 0
		for k := 0; k < g; k++ {
			total += <-done
		}
		sinkInt = total
	}
}
