---
title: "Auto-Grade: Building AI-Powered Document Intelligence"
date: "29-12-2024"
description: "How we integrated OCR, LLMs, and vector embeddings to transform Auto-Grade from a file management system into an intelligent document processing platform capable of understanding rubrics and contextual grading materials."
tags: ["llm", "ocr", "embeddings", "rag", "fastapi", "python", "openai", "mistral"]
---

## From Storage to Understanding

In the [previous chapters](https://albertbf.com/articles/projects/auto-grade/auto-grade-testing/) of the Auto-Grade saga, we built a solid foundation: a three-layer architecture, 100% test coverage, and GridFS for handling large files. But there was a fundamental problem lurking beneath the surface. The system could *store* documents beautifully, but it couldn't *understand* them.

For an AI-powered grading assistant, simply storing PDFs isn't enough. The system needs to extract structured information from rubrics, understand the grading criteria, and provide relevant context when evaluating student submissions. This article chronicles the journey of transforming Auto-Grade from a glorified file cabinet into an intelligent document processing platform.

---

## The OCR Challenge: When PDFs Fight Back

The first obstacle was deceptively simple: extracting text from PDFs. You might think this is a solved problem, but anyone who has worked with academic documents knows the nightmare. Scanned rubrics, complex tables, handwritten annotations, and the endless variety of PDF generators all conspire against simple text extraction.

The initial approach using `pypdf` worked for well-formed, text-based PDFs. But the moment we encountered a scanned document or a rubric created in a design tool, the text would come out as gibberish or nothing at all.

### Enter Mistral's OCR API

The solution was to integrate a proper OCR service. After evaluating several options, Mistral's document processing API emerged as the clear winner for its balance of accuracy and speed. The `OCRService` was designed with simplicity in mind:

```python
class OCRService:
    """Service for OCR operations using Mistral API."""

    async def extract_text_from_pdf(self, content: bytes) -> str | None:
        if not self.api_key or self.provider != "mistral":
            logger.warning("OCR API key not set. Skipping OCR.")
            return None

        # Encode PDF content to base64
        base64_content = base64.b64encode(content).decode("utf-8")
        data_url = f"data:application/pdf;base64,{base64_content}"

        payload = {
            "model": self.model,
            "document": {"type": "document_url", "document_url": data_url}
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(url, headers=headers, json=payload)
            result = response.json()

            # Combine markdown from all pages
            extracted_text = ""
            if "pages" in result:
                for page in result["pages"]:
                    extracted_text += page.get("markdown", "") + "\n\n"

            return extracted_text.strip()
```

The beauty of Mistral's approach is that it returns text in markdown format, preserving the document's structure. Tables remain tables, headers remain headers, and the semantic meaning of the document survives the extraction process.

---

## The Rubric Extraction Pipeline: A Multi-Model Fallback Strategy

With OCR in place, the next challenge was more nuanced: extracting *structured* information from rubrics. A rubric isn't just text—it's a complex data structure with criteria, point values, descriptions, and grade levels. Turning messy PDF content into a clean JSON structure required some creative engineering.

### The Fallback Strategy

Not every LLM excels at every task, and not every extraction attempt succeeds. Rather than betting everything on a single approach, we implemented a multi-model fallback strategy:

```python
async def parse_rubric(self, content: bytes, content_type: str) -> ExtractedRubricModel:
    """Parse a rubric using fallback strategy.

    Strategy:
    1. OCR + Default Model
    2. OCR + Smart Model
    3. Raw PDF (pypdf) + Smart Model
    """
    # Step 1 & 2: Try OCR
    ocr_text = await self.ocr_service.extract_text_from_pdf(content)

    if ocr_text:
        # Attempt 1: OCR + Default Model (faster, cheaper)
        result = await self._try_llm_extraction(ocr_text, self.default_model)
        if result:
            return result

        # Attempt 2: OCR + Smart Model (more capable)
        result = await self._try_llm_extraction(ocr_text, self.smart_model)
        if result:
            return result

    # Step 3: Raw PDF + Smart Model (last resort)
    raw_text = self.extract_text_from_pdf_raw(content)
    if raw_text:
        result = await self._try_llm_extraction(raw_text, self.smart_model)
        if result:
            return result

    logger.error("All rubric extraction attempts failed.")
    return ExtractedRubricModel(raw_text=ocr_text if ocr_text else raw_text)
```

This approach has several advantages:

1. **Cost optimization**: The default model is cheaper and faster. We only escalate to the "smart" model when necessary.
2. **Robustness**: If OCR fails, we fall back to raw PDF extraction.
3. **Graceful degradation**: Even if all LLM attempts fail, we preserve the raw text for manual review.

### The Prompt Engineering

Getting an LLM to output consistent, parseable JSON is an art form. The prompt needed to be precise enough to ensure correct formatting while flexible enough to handle the wild variety of rubric formats in the academic world:

```python
def _build_extraction_prompt(self, text: str) -> str:
    return f"""Analyze this rubric and extract structured information.

Return ONLY valid JSON with this structure:
{{
    "title": "rubric title or null",
    "total_points": numeric value or null,
    "criteria": [
        {{
            "name": "criterion name",
            "max_points": numeric value,
            "weight": percentage as decimal (e.g., 0.25),
            "grades": [
                {{"label": "Excellent", "points": 10, "description": "..."}}
            ]
        }}
    ]
}}

Rubric text:
{text}"""
```

The resulting `ExtractedRubricModel` contains everything needed for intelligent grading: criteria names, point values, weights, and detailed descriptions of each grade level.

---

## Building the Embedding Pipeline

Extracting text from documents was only half the battle. For the AI grader to provide contextual feedback, it needs to understand the *meaning* of the documents, not just their words. This is where vector embeddings come in.

### The Text Splitting Challenge

You can't just throw an entire document at an embedding API. Most have token limits, and even if they didn't, chunking text intelligently leads to better retrieval performance. We implemented a `RecursiveCharacterTextSplitter` inspired by LangChain's approach:

```python
class RecursiveCharacterTextSplitter:
    """Splits text recursively by separators to respect document structure."""

    def __init__(self, chunk_size: int, chunk_overlap: int, separators: list[str] | None = None):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.separators = separators or ["\n\n", "\n", " ", ""]

    def split_text(self, text: str) -> list[str]:
        return self._split_text(text, self.separators)

    def _split_text(self, text: str, separators: list[str]) -> list[str]:
        final_chunks = []
        separator = separators[-1]

        for _s in separators:
            if _s in text:
                separator = _s
                break

        splits = text.split(separator) if separator else list(text)
        good_splits = []

        for s in splits:
            if self._length_function(s) < self.chunk_size:
                good_splits.append(s)
            else:
                # Recursively split with next separator
                final_chunks.extend(self._merge_splits(good_splits))
                good_splits = []
                if len(separators) > 1:
                    final_chunks.extend(self._split_text(s, separators[1:]))

        final_chunks.extend(self._merge_splits(good_splits))
        return final_chunks
```

The key insight is the *recursive* nature of the splitting. The algorithm first tries to split on double newlines (paragraph breaks), then single newlines, then spaces, and finally individual characters. This respects the document's natural structure while staying within size limits.

### The Embedding Service

With text properly chunked, the `EmbeddingService` handles the OpenAI API integration:

```python
class EmbeddingService:
    """Service for generating text embeddings using OpenAI-compatible API."""

    def generate_embedding(self, text: str) -> list[float] | None:
        if not self.client:
            return None

        try:
            response = self.client.embeddings.create(
                model=self.model,
                input=[text],
                dimensions=self.dimensions
            )
            return response.data[0].embedding
        except Exception as e:
            logger.error(f"Failed to generate embedding: {e}")
            return None

    def chunk_text(self, text: str) -> list[str]:
        return self.text_splitter.split_text(text)
```

The service is designed to be flexible—it works with any OpenAI-compatible API, making it easy to switch providers or use local models in the future.

---

## Smart OCR: Per-Page Fallback

One optimization that made a significant difference was implementing per-page OCR fallback. Not every page in a PDF needs OCR treatment. Some pages have perfectly extractable text while others are scanned images.

```python
def _extract_text_from_pdf_robust(self, content: bytes) -> str:
    """Extract text from PDF pages, using OCR for low-density pages."""
    reader = PdfReader(io.BytesIO(content))
    full_text_parts = [""] * len(reader.pages)
    ocr_tasks = []
    ocr_indices = []

    for i, page in enumerate(reader.pages):
        self._process_pdf_page(page, i, ocr_tasks, ocr_indices)

    # Run OCR tasks in parallel
    self._run_ocr_tasks(ocr_tasks, ocr_indices, full_text_parts)
    return "\n\n".join(full_text_parts)

def _process_pdf_page(self, page, index, ocr_tasks, ocr_indices):
    text = page.extract_text() or ""
    density = len(text) / (page.mediabox.width * page.mediabox.height)

    if density < self.ocr_threshold:
        # Low text density - queue for OCR
        ocr_tasks.append(self._ocr_single_page(page))
        ocr_indices.append(index)
```

This approach gives us the best of both worlds: fast native extraction for text-heavy pages and accurate OCR for scanned content.

---

## What's Next?

With the document intelligence layer complete, Auto-Grade can now:

- **Extract structured rubrics** from PDFs using OCR and LLM analysis
- **Generate embeddings** for semantic search across documents
- **Intelligently chunk** documents while preserving structure
- **Handle mixed-format PDFs** with per-page OCR decisions

The next phase will focus on bringing it all together: using the extracted rubrics and document embeddings to actually grade student submissions. The pieces are in place; now comes the exciting part.

---

## The Lessons Learned

Building an AI-powered document processing pipeline taught us several valuable lessons:

1. **Always have fallbacks**: LLMs are probabilistic. OCR can fail. Design systems that degrade gracefully.
2. **Structure matters**: The difference between raw text and structured JSON is the difference between unusable and actionable.
3. **Chunking is an art**: How you split text dramatically affects embedding quality and retrieval performance.
4. **Don't over-engineer early**: We started with simple `pypdf` extraction and only added OCR when the limitations became clear.

The journey from "store files" to "understand documents" was longer than anticipated, but the foundation we've built will power everything that comes next.

*Check out the [GitHub repository](https://github.com/FumingPower3925/auto-grade) to explore the implementation details and see how all the pieces fit together.*
