---
title: "Auto-Grade: Shipping v0.2.0 — From Prototype to Product"
date: "29-12-2024"
description: "Announcing Auto-Grade v0.2.0: a milestone release featuring complete file management, polished UI, Python 3.13 upgrade, and the foundation for AI-powered grading. A reflection on the journey from hackathon prototype to production-ready platform."
tags: ["release", "python", "fastapi", "docker", "ui", "crud", "devops"]
---

## The Road to v0.2.0

If you've been following the Auto-Grade journey, you know it started as an ambitious experiment: an AI-powered grading assistant that could help educators provide faster, more consistent feedback to students. The [first article](https://albertbf.com/articles/projects/auto-grade/auto-grade-foundation/) laid the architectural groundwork. The [second](https://albertbf.com/articles/projects/auto-grade/auto-grade-testing/) tackled the chaos of 100% test coverage. The [third](https://albertbf.com/articles/projects/auto-grade/auto-grade-ai-intelligence/) brought AI-powered document intelligence.

Today, I'm thrilled to announce **Auto-Grade v0.2.0**—a milestone that marks the transition from "interesting prototype" to "something you might actually want to use."

---

## What's New in v0.2.0

### Complete File Management

The most visible change in v0.2.0 is the completion of the file management system. Users can now fully manage all documents within the platform:

- **Upload rubrics** with automatic AI-powered extraction of criteria, point values, and grade levels
- **Upload additional documents** (examples, guidelines, reference materials) that provide context for grading
- **View PDFs directly** in-browser with consistent styling across all file types
- **Delete any file** with proper cleanup of associated data, embeddings, and GridFS content

The delete functionality may seem trivial, but implementing it correctly required careful orchestration across multiple layers:

```python
def delete_file(self, file_id: str) -> bool:
    try:
        obj_id = ObjectId(file_id)
        file_doc = self.files_collection.find_one({"_id": obj_id})

        if not file_doc:
            return False

        # Delete GridFS content
        if "gridfs_id" in file_doc:
            self.fs.delete(file_doc["gridfs_id"])

        # Remove reference from assignment
        assignment_id = file_doc["assignment_id"]
        file_type = file_doc["file_type"]

        if file_type == "rubric":
            self.assignments_collection.update_one(
                {"_id": assignment_id},
                {"$pull": {"evaluation_rubrics": obj_id}}
            )
        elif file_type == "relevant_document":
            self.assignments_collection.update_one(
                {"_id": assignment_id},
                {"$pull": {"relevant_documents": obj_id}}
            )

        # Delete the file document
        result = self.files_collection.delete_one({"_id": obj_id})
        return result.deleted_count > 0
    except Exception:
        return False
```

Every delete operation ensures that:
1. The binary content is removed from GridFS
2. The file reference is removed from the parent assignment
3. The file metadata document is deleted
4. Any associated embeddings are cleaned up

No orphaned data. No dangling references. Just clean, complete deletion.

---

### A Polished User Interface

The UI received significant attention in this release. Small details that seemed unimportant in a prototype become critical when you're interacting with the application daily:

**Consistent button styling**: All action buttons now share the same visual language. "View PDF" buttons are blue with document icons. "Delete" buttons are red with trash icons. "Edit" buttons match the primary theme.

**Right-aligned action buttons**: Document lists now properly align their action buttons to the right, matching the rubric section and providing visual consistency.

**Processing feedback**: When uploading documents that require OCR and embedding generation, users see a progress modal with real-time status updates. The "Close & Refresh" button turns blue when processing completes, providing clear visual feedback.

These may sound like minor polish items, but they represent a shift in mindset: from "does it work?" to "is it pleasant to use?"

---

### Python 3.13.11 Upgrade

Under the hood, we upgraded to Python 3.13.11 with the new Debian Trixie base image. This wasn't just about chasing the latest version—it brought tangible benefits:

- **Performance improvements** from Python's ongoing optimization work
- **Better type hints** with the latest `typing` module features
- **Security patches** from the latest stable release

The Dockerfile now uses `ghcr.io/astral-sh/uv:python3.13-trixie-slim` as the base, giving us a leaner, more modern foundation:

```dockerfile
FROM ghcr.io/astral-sh/uv:python3.13-trixie-slim AS base
```

The migration was smooth thanks to our comprehensive test suite. All 366 unit tests passed with 100% coverage, 58 integration tests validated the system interactions, and 26 end-to-end tests confirmed everything worked in the browser.

---

### Developer Experience Improvements

The project now includes a comprehensive `Makefile` that standardizes all common operations:

```bash
make build          # Build Docker images
make up             # Start the application
make down           # Stop services and clean volumes
make test-unit      # Run unit tests (100% coverage required)
make test-integration # Run integration tests
make test-e2e       # Run end-to-end tests with Playwright
make lint           # Run linting and formatting
make type-check     # Run mypy type checking
```

No more copying long Docker commands from the README. No more forgetting the correct pytest flags. Just simple, memorable make targets.

---

## The Numbers

For those who appreciate metrics, here's where Auto-Grade v0.2.0 stands:

| Metric | Value |
|--------|-------|
| **Unit Tests** | 366 |
| **Integration Tests** | 58 |
| **E2E Tests** | 26 |
| **Code Coverage** | 100% |
| **Source Files** | 14 |
| **Lines of Code** | ~1,500 |

The 100% coverage requirement has been a double-edged sword (as discussed in [Part 2](https://albertbf.com/articles/projects/auto-grade/auto-grade-testing/)), but it's also forced us to write testable, modular code. Every new feature comes with its full suite of tests before merging.

---

## What's Still Ahead

Let's be clear: v0.2.0 is a *foundation* release, not a final product. The AI grading functionality itself—where the system actually evaluates student work against rubrics—is still in development. But the infrastructure is now in place:

- **Document processing**: Rubrics and reference materials can be extracted, chunked, and embedded
- **Vector storage**: Embeddings are stored and ready for retrieval-augmented generation
- **Clean architecture**: Adding the grading logic will be a matter of connecting existing pieces

The roadmap for v0.3.0 includes:

1. **Grading pipeline**: The core LLM integration for evaluating student submissions
2. **Feedback generation**: Structured, criterion-by-criterion feedback with score justifications
3. **Batch processing**: Upload multiple submissions and grade them efficiently
4. **Export functionality**: Generate grading reports in various formats

---

## A Note on Contributions

This project is part of my Master's Thesis at [Universitat Politècnica de Catalunya (UPC)](https://www.upc.edu/). Until the thesis is presented and defended (expected mid-2025), I can't accept external contributions. But after that milestone, all contributions will be welcome!

In the meantime, feel free to explore the codebase, open issues for bugs or feature requests, and watch the repository for updates.

---

## The Journey Continues

Releasing v0.2.0 is both an ending and a beginning. It marks the completion of the foundational work—the architecture, the testing strategy, the document processing, the file management—that makes everything else possible. But it's also the starting line for the most exciting phase: building the AI grading engine itself.

Thank you to everyone who has followed along, provided feedback, or simply found these articles interesting. Building in public, writing about the process, and sharing both the successes and the struggles has made this journey more rewarding.

The road to truly intelligent grading is still long, but with v0.2.0, we're finally ready to start walking it.

---

**Download Auto-Grade v0.2.0**

- [GitHub Repository](https://github.com/FumingPower3925/auto-grade)
- [Release Notes](https://github.com/FumingPower3925/auto-grade/releases/tag/v0.2.0)

*Questions, feedback, or just want to say hello? Reach out at albert.bausili@gmail.com or find me on [GitHub](https://github.com/FumingPower3925).*
