---
title: "Auto-Grade Part 2: Navigating the Chaos of 100% Test Coverage"
date: "18-09-2025"
description: "A deep dive into the evolution of the Auto-Grade project, exploring the challenges of maintaining 100% test coverage, the decision to refactor for sanity, and the performance gains from integrating GridFS."
tags: ["llm", "testing", "refactoring", "fastapi", "python", "gridfs", "docker"]
---

## The Unforeseen Consequences of Perfection

In the [first chapter of the Auto-Grade saga](/articles/projects/auto-grade/auto-grade-foundation/), we laid down a robust architectural foundation for an AI-powered grading system. The goal was clear: build a production-ready application with a clean three-layer architecture, a lightweight HTMX frontend, and a rigorous testing strategy that boasted **100% code coverage**. It was a testament to pragmatic engineering, a solid starting point for a project with ambitious goals. But as any seasoned developer will tell you, the map is not the territory.

The pursuit of 100% test coverage, while noble in theory, led to a host of unforeseen challenges. The tests, once a safety net, became a tangled mess of mocks, patches, and convoluted setups that made refactoring a nightmare. At the same time, the initial approach to handling file uploads began to show its limitations, with performance bottlenecks emerging as the system was pushed to its limits.

This article is the story of what happened next. It's a tale of confronting the chaos, refactoring for sanity, and making the tough decisions that were necessary to keep the project on track.

---

## The Perils of 100% Coverage

Achieving 100% test coverage is a seductive goal. It provides a sense of security, a feeling that every line of code has been vetted and verified. But as the Auto-Grade project evolved, the cost of maintaining this perfect score became increasingly apparent.

### The Mocking Nightmare

The initial test suite was a marvel of mock objects and patches. Every external dependency, from the database to the OpenAI API, was meticulously mocked out to ensure that unit tests were running in complete isolation. Here's a taste of what the tests for the `DeliverableService` looked like:

```python
@patch('src.service.deliverable_service.get_database_repository')
def test_upload_deliverable_success(self, mock_get_repo: MagicMock) -> None:
    """Test successful deliverable upload."""
    mock_repo = MagicMock()
    mock_assignment = self._create_mock_assignment()
    mock_repo.get_assignment.return_value = mock_assignment
    mock_repo.store_deliverable.return_value = "deliverable_id_123"
    mock_get_repo.return_value = mock_repo
    
    with patch.object(DeliverableService, 'extract_student_name_from_pdf', 
                     return_value=("John Doe", "extracted text")):
        service = DeliverableService()
        deliverable_id = service.upload_deliverable(
            "assignment_id", "submission.pdf", b"pdf content",
            "pdf", "application/pdf", extract_name=True
        )
    
    assert deliverable_id == "deliverable_id_123"
    mock_repo.store_deliverable.assert_called_once_with(...)
```

While this approach allowed for granular testing of individual methods, it created a tight coupling between the tests and the implementation details of the code. A simple refactoring in the service layer could trigger a cascade of failures in the test suite, not because the logic was wrong, but because the mocks were no longer in sync with the new implementation.

### The Refactoring Gridlock

The more the codebase grew, the more brittle the tests became. The dream of a safety net had turned into a web of tripwires. It was clear that a change was needed. The focus shifted from maintaining a perfect coverage score to writing tests that were more resilient, more readable, and more reflective of real-world usage.

The solution was to introduce a clear separation between **unit tests** and **integration tests**. Unit tests would continue to focus on individual components, but with a renewed emphasis on testing behavior rather than implementation. Integration tests, on the other hand, would be responsible for verifying the interactions between different layers of the application, from the API endpoints to the database.

This led to a comprehensive refactor of the test suite. The new structure was cleaner, more organized, and far more maintainable:

```
tests/
├── unit/
│   ├── controller/
│   ├── service/
│   └── repository/
├── integration/
│   ├── controller/
│   └── repository/
└── e2e/
```

The result was a more balanced and effective testing strategy. The project still maintains a high level of coverage, but the tests are now a genuine asset rather than a liability.

-----

## Taming Large Files with GridFS

As the project evolved, another challenge emerged: performance. The initial implementation stored file uploads directly in the database, which worked fine for small text files but quickly became a bottleneck when dealing with larger documents like PDFs. The application would hang, and the database would struggle under the load.

The solution was **GridFS**, a specification for storing and retrieving large files in MongoDB. Instead of storing the entire file in a single document, GridFS breaks it into smaller chunks, allowing for more efficient storage and retrieval.

The transition to GridFS required a significant refactoring of the repository layer. The `FerretDBRepository` was updated to use the `GridFS` library, and the logic for storing and retrieving documents was completely overhauled:

```python
class FerretDBRepository(DatabaseRepository):

    def __init__(self) -> None:
        # ...
        self.fs = GridFS(self.db)

    def store_document(self, assignment: str, deliverable: str, student_name: str, document: bytes, extension: str) -> str:
        file_id = self.fs.put(document, filename=f"{student_name}_{assignment}.{extension}")
        
        document_data: Dict[str, Any] = {
            "assignment": assignment,
            "deliverable": deliverable,
            "student_name": student_name,
            "gridfs_id": file_id,
            "extension": extension,
            "file_size": len(document),
        }
        result = self.collection.insert_one(document_data)
        return str(result.inserted_id)
    
    def get_document(self, document_id: str) -> Optional[DocumentModel]:
        try:
            obj_id = ObjectId(document_id)
            document = self.collection.find_one({"_id": obj_id})
            if document:
                if 'gridfs_id' in document:
                    file_data = self.fs.get(document['gridfs_id'])
                    document['document'] = file_data.read()
                return DocumentModel.model_validate(document)
            return None
        except Exception:
            return None
```

The impact was immediate. The application could now handle large file uploads without breaking a sweat, and the database was no longer a bottleneck. It was a classic case of choosing the right tool for the job, and a reminder that performance considerations are crucial, even in the early stages of a project.

-----

## What's Next?

The journey of Auto-Grade is far from over. The recent refactoring has solidified the project's foundation, paving the way for the next phase of development:

  - **LLM Integration**: With the architecture now more robust, the focus will shift to integrating LLM providers for automated grading.
  - **Enhanced UI**: The HTMX frontend will be expanded to include more advanced features, such as real-time progress updates and detailed feedback visualization. Also it will be refactored into a more Dashboard like look.

## The Journey Continues

The evolution of Auto-Grade is a testament to the iterative nature of software development. The initial pursuit of 100% test coverage, while well-intentioned, ultimately gave way to a more pragmatic and maintainable testing strategy. The performance bottlenecks with file uploads were a valuable lesson in the importance of choosing the right tools for the job.

By embracing the chaos, refactoring for sanity, and making the tough decisions, the Auto-Grade project is now stronger, more resilient, and better prepared for the challenges that lie ahead. The road to building a truly intelligent grading assistant is a long one, but with a solid foundation in place, the journey is well underway.

*Check out the [GitHub repository](https://github.com/FumingPower3925/auto-grade) to explore the latest code and see the evolution of the project firsthand.*