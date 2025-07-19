---
title: Syntax Highlighting Test
date: 2025-01-16
description: Testing the new syntax highlighting feature with JavaScript and Go code examples
tags: [code, testing, javascript, go]
---

# Syntax Highlighting Test

This article demonstrates the new build-time syntax highlighting feature with examples in JavaScript and Go.

## JavaScript Example

Here's a modern JavaScript function that demonstrates async/await:

```javascript
async function fetchUserData(userId) {
  try {
    const response = await fetch(`/api/users/${userId}`);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const userData = await response.json();
    
    return {
      id: userData.id,
      name: userData.name,
      email: userData.email,
      isActive: userData.status === 'active'
    };
  } catch (error) {
    console.error('Error fetching user data:', error);
    throw error;
  }
}

// Usage example
const user = await fetchUserData(123);
console.log(`Hello, ${user.name}!`);
```

## Go Example

Here's a Go HTTP server with graceful shutdown:

```go
package main

import (
    "context"
    "fmt"
    "log"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"
)

type Server struct {
    httpServer *http.Server
}

func NewServer(addr string) *Server {
    mux := http.NewServeMux()
    
    mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusOK)
        fmt.Fprint(w, "OK")
    })
    
    mux.HandleFunc("/api/hello", func(w http.ResponseWriter, r *http.Request) {
        name := r.URL.Query().Get("name")
        if name == "" {
            name = "World"
        }
        
        w.Header().Set("Content-Type", "application/json")
        fmt.Fprintf(w, `{"message": "Hello, %s!"}`, name)
    })
    
    return &Server{
        httpServer: &http.Server{
            Addr:    addr,
            Handler: mux,
        },
    }
}

func (s *Server) Start() error {
    log.Printf("Server starting on %s", s.httpServer.Addr)
    return s.httpServer.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
    log.Println("Server shutting down...")
    return s.httpServer.Shutdown(ctx)
}

func main() {
    server := NewServer(":8080")
    
    // Start server in a goroutine
    go func() {
        if err := server.Start(); err != nil && err != http.ErrServerClosed {
            log.Fatalf("Server failed to start: %v", err)
        }
    }()
    
    // Wait for interrupt signal
    quit := make(chan os.Signal, 1)
    signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
    <-quit
    
    // Graceful shutdown
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    
    if err := server.Shutdown(ctx); err != nil {
        log.Fatalf("Server forced to shutdown: %v", err)
    }
    
    log.Println("Server exited")
}
```

## Inline Code

You can also use inline code like `const result = await api.call()` or `fmt.Println("Hello")` which will be styled appropriately.

## Features

The syntax highlighting system:

- ✅ Processes code at build time for performance
- ✅ Only loads CSS for languages actually used in each article
- ✅ Supports JavaScript, Go, TypeScript, Bash, YAML, JSON, HTML, and CSS
- ✅ Uses the Atom One Dark theme that works well with the liquid glass aesthetic
- ✅ Includes language badges on code blocks
- ✅ Maintains the glass morphism design

## Configuration

The build script automatically:

1. Detects languages used in each article during markdown processing
2. Generates conditional CSS links for each article
3. Serves the highlight.js CSS from CDN only when needed
4. Tracks languages in the search index for better organization

This approach optimizes loading performance while providing beautiful, accessible code highlighting!