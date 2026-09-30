---
title: "Go 1.2.2: The Open Socket"
date: 2026-10-02
description: "Go 1.2.2 changed no code in the main repository. Its one fix closed a hole that let any website run programs on your machine through the tour."
tags: [go, go-history]
series: go-version-by-version
links:
  - { label: "Go 1.2.2 release history", url: "https://go.dev/doc/devel/release#go1.2.minor" }
  - { label: "The socket fix", url: "https://github.com/golang/tools/commit/3d0528640bbb4f77bdd8872d7a58629651dc2f9c" }
  - { label: "The tour change", url: "https://github.com/golang/tour/commit/c4f59b9e860bd24bef959381ef0aedbdfe390d2e" }
---

Go 1.2.2 shipped on 5 May 2014, two months after Go 1.2.1. The notes give it one paragraph, quoted here in full:[^rel]

> go1.2.2 (released 2014/05/05) includes a security fix that affects the tour binary included in the binary distributions (thanks to Guillaume T). This point release only affects binary distributions; no code in the main repository has changed.

Two commits sit between the `go1.2.1` and `go1.2.2` tags: that paragraph and the version bump. The fix itself lives in two other repositories. This article is about the socket the tour left open to every website you visited.

## The socket

The tour is a local web server. It listens on 127.0.0.1:3999, serves the lessons, and runs the code you type: each lesson page opens a websocket to `/socket` and sends messages like `{"Kind":"run","Body":"<your program>"}`. The server compiles the body with the local toolchain, runs the binary, and streams stdout back as messages. Convenient, and exactly as dangerous as it sounds when anyone can connect.

Before the fix, anyone could. The tour registered the socket with a bare handler, `http.Handle(socketPath, socket.Handler)`, a stock websocket handler with no handshake check. Websocket handshakes carry an `Origin` header naming the page that opened them; the socket never looked at it.

## The attack

With the tour running, visit a page on `evil.com`: its script opens `ws://127.0.0.1:3999/socket` and sends a `run` message. The browser attaches `Origin: http://evil.com`, which the tour ignores. Your machine compiles and runs the attacker's program and returns the output. Localhost is not a security boundary when the browser will carry anyone's traffic to it.

### The program

The attacker's program for this article, in full. Hit Run.

```go run title="payload.go"
package main

import "fmt"

func main() {
	fmt.Println("hello from evil.com")
}
```

```output
hello from evil.com
```

### Against the old tour

There is no browser in the test setup, so a small client plays its part: it dials with `Origin: http://evil.com` and sends one `run` message carrying that program. Against the pre-fix tour:[^repro]

```
$ ./evil     # pre-fix tour
stdout: hello from evil.com
end: 
```

The handshake alone tells the story. The same forged origin through `curl`:

```
$ curl -s -i -N -m 5 -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Origin: http://evil.com' http://127.0.0.1:3999/socket     # pre-fix tour
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=

```

Switched protocols, no questions asked.

## The fix

The fix teaches the handshake to check the origin. `NewHandler` takes the expected origin, and every handshake must match it exactly, scheme and host:[^csrf]

```diff
+// NewHandler returns a websocket server which checks the origin of requests.
+func NewHandler(origin *url.URL) websocket.Server {
+	return websocket.Server{
+		Config:    websocket.Config{Origin: origin},
+		Handshake: handshake,
+		Handler:   websocket.Handler(socketHandler),
+	}
+}
+
+// handshake checks the origin of a request during the websocket handshake.
+func handshake(c *websocket.Config, req *http.Request) error {
+	o, err := websocket.Origin(c, req)
+	if err != nil {
+		log.Println("bad websocket origin:", err)
+		return websocket.ErrBadWebSocketOrigin
+	}
+	ok := c.Origin.Scheme == o.Scheme && c.Origin.Host == o.Host
+	if !ok {
+		log.Println("bad websocket origin:", o)
+		return websocket.ErrBadWebSocketOrigin
+	}
+	return nil
+}
```

And the tour passes its own address as the only acceptable origin:[^tourcall]

```diff
-	http.Handle(socketPath, socket.Handler)
+	origin := &url.URL{Scheme: "http", Host: host + ":" + port}
+	http.Handle(socketPath, socket.NewHandler(origin))
```

Both hunks omit import-only lines, and the first omits the deleted bare `Handler`.

### Against the fixed tour

Same client, same forged origin:

```
$ ./evil     # fixed tour
dial: websocket.Dial ws://127.0.0.1:3999/socket: bad status
```

The handshake bytes:

```
$ curl -s -i -N -m 5 -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Origin: http://evil.com' http://127.0.0.1:3999/socket     # fixed tour
HTTP/1.1 403 Forbidden

```

And with the tour's own origin, the identical program still runs:

```
$ ./evil http://127.0.0.1:3999     # fixed tour
stdout: hello from evil.com
end: 
```

## The release

Both halves landed on 5 May within a minute of each other, Gerrand writing, rsc approving both. The release notes thank Guillaume T, whose surname no public record gives.[^who] The tag followed that morning, with binaries rebuilt from the fixed tour: the notes say the release only affects binary distributions, because the tour binary ships inside them. Updating sources changed nothing, only a fresh download.

The documentation commit also tidied the release page, moving the 1.2.1 notes under a new Go 1.2 heading and fixing a stale release-notes link.

That is the whole release: a rebuilt tour around unchanged Go. Go 1.3 followed on 18 June.[^minor]

[^rel]: [Release History](https://go.dev/doc/devel/release), the source for the 5 May 2014 date and the paragraph quoted above. Two commits sit between the `go1.2.1` (`9c9802f`) and `go1.2.2` (`43d00b0`) tags: the documentation commit `2c19e64` and the version bump.
[^csrf]: [go.tools/playground/socket commit `3d05286`](https://github.com/golang/tools/commit/3d0528640bbb4f77bdd8872d7a58629651dc2f9c), "require origin to set up socket handler", Andrew Gerrand, 5 May 2014 (CL 95030044, LGTM=rsc). It adds `NewHandler` and the handshake check shown above and deletes the bare `Handler`.
[^tourcall]: [go-tour commit `c4f59b9e`](https://github.com/golang/tour/commit/c4f59b9e860bd24bef959381ef0aedbdfe390d2e), "use new socket interface", Gerrand, 5 May 2014 (CL 100090043, LGTM=rsc), one minute after the socket fix. It passes the tour's own listen address as the only acceptable origin.
[^who]: No public issue, thread, or commit message found gives the surname; the thanks in the release notes is the whole public record.
[^repro]: The runnable cell runs on the current Go Playground, which is amd64. The recorded transcripts come from tour binaries built from era source pairs (pre-fix: go.tools `30b1abe2f` with go-tour `66c0d07cc`; fixed: `3d05286` with `c4f59b9e`; both with go.net `c286e19`) with the Go 1.2 toolchain (gcc 4.6.3 on ubuntu 12.04, `make.bash`, `CGO_ENABLED=0`), as linux/amd64 binaries run in a container. The evil client dials the 2014 websocket endpoint with a forged `Origin` and sends one `run` message; there is no browser in the setup. The payload cell is the program it sends.
[^minor]: [Release History](https://go.dev/doc/devel/release), the source for the 18 June 2014 date of Go 1.3, the next release in the series.
