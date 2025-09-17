---
title: "Auto-Grade: Building a Foundation for AI-Powered Assignment Grading"
date: "09-08-2025"
description: "Exploring the architecture and design decisions behind a proof-of-concept for automated bulk assignment grading using LLMs, FastAPI, and modern web technologies."
tags: ["llm", "agentic-ui", "fastapi", "python", "architecture", "htmx", "docker"]
---

## The Grading Dilemma

Picture this: it's 2 AM, you're on your fifth cup of coffee, and you're only halfway through grading a stack of assignments that seems to regenerate faster than you can mark them. Sound familiar? Whether you're a teacher, professor, or training coordinator, the time-consuming nature of grading is a universal pain point in education. What if we could harness the power of Large Language Models to handle the heavy lifting?

Enter **Auto-Grade**: a proof-of-concept that lays the groundwork for an intelligent bulk assignment grading system powered by LLMs. While still in its early stages, this project establishes a robust architectural foundation that's ready to scale from grading a handful of essays to processing hundreds of submissions without breaking a sweat.

## Architecture: Building on Solid Ground

When designing Auto-Grade, I didn't want to just throw an LLM at the problem and call it a day. The goal was to create a production-ready foundation that could evolve from a proof-of-concept into a battle-tested grading assistant. This meant making deliberate choices about every layer of the stack.

### The Three-Layer Symphony

The codebase follows a clean three-layer architecture that would make any software architect nod in approval:

```
src/
├── controller/   # The conductors of our orchestra
│   ├── api/     # RESTful API endpoints
│   ├── web/     # Web interface controllers
│   └── mcp/     # Future Model Context Protocol integration
├── service/      # Business logic lives here
└── repository/   # Data persistence layer
```

This separation isn't just organizational eye candy – it's a deliberate design choice that keeps concerns separated and makes the codebase maintainable as it grows. The **controller** layer handles incoming requests, the **service** layer processes the business logic (where our LLM magic will eventually live), and the **repository** layer manages data persistence.

### FastAPI: The Speed Demon

At the heart of Auto-Grade sits **FastAPI**, and the choice wasn't arbitrary. FastAPI brings several superpowers to the table:

- **Automatic API documentation** via OpenAPI/Swagger (because who has time to maintain docs manually?)
- **Type hints everywhere** with Pydantic models, catching errors before they become 3 AM debugging sessions
- **Async support** out of the box, perfect for handling concurrent grading requests
- **Lightning-fast performance** thanks to Starlette and Pydantic

Here's a glimpse of our health check endpoint – simple, typed, and self-documenting:

```python
@app.get("/health", response_model=HealthResponse, tags=["Health"])
async def health_check() -> HealthResponse:
    """Health check endpoint to verify API is running."""
    return HealthResponse(
        status="healthy",
        message="Auto Grade API is running"
    )
```

## The Frontend Philosophy: HTMX and Simplicity

In an era of JavaScript fatigue, Auto-Grade takes a refreshingly different approach. Instead of reaching for React, Vue, or the framework-of-the-week, the project embraces **HTMX** – a library that lets you build dynamic interfaces with good old HTML.

The health check button in the navbar is a perfect example. No virtual DOM, no state management libraries, just declarative HTML attributes:

```html
<button class="healthcheck" 
        id="healthcheck-btn"
        hx-get="/api/health"
        hx-trigger="click"
        hx-on::after-request="...">
    Health Check
</button>
```

This approach keeps the frontend lightweight and maintainable. When you click that button, HTMX makes an AJAX request, and the button transforms to show the result – all without writing a single line of JavaScript. It's like magic, except it's just good engineering.

## Testing: The Safety Net

One thing that sets this project apart is its comprehensive testing strategy. With **100% code coverage** (yes, really!), Auto-Grade doesn't just hope things work – it verifies them at every level:

### Unit Tests
Testing individual components in isolation:
```python
def test_health_endpoint_returns_correct_status_code(self):
    response = self.client.get("/health")
    assert response.status_code == status.HTTP_200_OK
```

### Integration Tests
Ensuring components play nicely together:
```python
def test_full_application_startup(self):
    with TestClient(app) as client:
        response = client.get("/health")
        assert response.status_code == status.HTTP_200_OK
```

### End-to-End Tests
Using Playwright to test the full user experience:
```python
def test_healthcheck_button_success_flow(self, page: Page):
    healthcheck_button = page.locator("#healthcheck-btn")
    healthcheck_button.click()
    expect(healthcheck_button).to_have_text("✓ Healthy", timeout=5000)
```

## Docker: Consistency is Key

The entire application is containerized with a multi-stage Docker setup that's optimized for both development and production:

```dockerfile
FROM python:3.13.6-slim AS base
# ... base setup

FROM base AS production
# Production dependencies only

FROM base AS test
# Includes testing tools and Playwright
```

This approach ensures that whether you're developing locally, running tests in CI, or deploying to production, the environment is consistent. No more "works on my machine" mysteries!

## Configuration: TOML and Pydantic

Configuration management might not be the most exciting topic, but Auto-Grade makes it elegant with TOML files and Pydantic validation:

```toml
[server]
host = "0.0.0.0"
port = 8080

[llm]
provider = "openai"
model = "o4-mini"
```

The configuration is strongly typed and validated at startup, catching configuration errors before they can cause runtime issues. It's the kind of boring reliability that lets you sleep soundly at night.

## What's Next?

While the current implementation focuses on establishing a solid foundation, the architecture is designed with the future in mind:

- **LLM Integration**: The service layer is ready for LLM providers like OpenAI, Anthropic, or local models
- **Batch Processing**: The async architecture can handle multiple grading requests concurrently
- **Rubric Management**: The repository pattern makes it easy to add rubric storage and retrieval
- **Feedback Generation**: Beyond just grades, providing constructive feedback to students
- **Analytics Dashboard**: Track grading patterns and identify common issues across submissions

## The Philosophy

Auto-Grade embodies a philosophy of **pragmatic engineering**. It's not about using the latest trendy technology or the most complex architecture. It's about choosing the right tools for the job and building something that's maintainable, testable, and ready to evolve.

Every decision – from using HTMX instead of a heavy JavaScript framework to the comprehensive testing strategy – is made with an eye toward creating a system that can grow from a proof-of-concept to a production-grade application without requiring a complete rewrite.

## Getting Started

Want to take Auto-Grade for a spin? It's as simple as:

```bash
git clone https://github.com/FumingPower3925/auto-grade.git
cd auto-grade
cp .env.example .env
docker compose up --build auto-grade
```

Visit `http://localhost:8080` and you'll see the foundation of what could become the grading assistant you've always dreamed of.

## Final Thoughts

Auto-Grade might not be grading your assignments just yet, but it represents something important: a thoughtful approach to building educational technology. By focusing on solid architecture, comprehensive testing, and pragmatic technology choices, it creates a foundation that's ready for the challenges of real-world deployment.

Whether you're interested in educational technology, curious about FastAPI and HTMX, or just appreciate clean code architecture, Auto-Grade offers insights into building modern web applications that are both powerful and maintainable.

The stack of assignments might still be there, but with projects like Auto-Grade, the future of automated grading is looking brighter – and your coffee consumption might finally return to healthy levels.

*Check out the [GitHub repository](https://github.com/FumingPower3925/auto-grade) to explore the code and contribute to the project.*