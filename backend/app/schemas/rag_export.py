"""Pydantic schemas for RAG (Retrieval-Augmented Generation) export format.

This schema defines the format for exporting project configurations in a
RAG-friendly format optimized for vector database storage and semantic search.
"""

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, Field


class BoundingBox(BaseModel):
    """Bounding box coordinates for element location."""

    x: int
    y: int
    width: int
    height: int


class ScreenshotInfo(BaseModel):
    """Screenshot metadata for RAG context."""

    screenshot_id: str
    file_path: str | None = None
    timestamp: datetime
    resolution: tuple[int, int]
    monitor: str | None = None


class VectorDBInfo(BaseModel):
    """Vector database metadata for RAG elements."""

    collection_name: str
    embedding_model: str
    vector_id: str | None = None
    indexed_at: datetime | None = None


class RAGElement(BaseModel):
    """
    RAG-optimized element representation.

    Each element represents a discrete visual component that can be:
    - Embedded as a vector for semantic search
    - Retrieved with full context for LLM processing
    - Used for state identification and action targeting
    """

    element_id: str = Field(..., description="Unique identifier for this element")
    element_hash: str = Field(
        ..., description="SHA-256 hash of element image data for deduplication"
    )
    element_type: str = Field(..., description="Type: button, input, icon, etc.")
    name: str | None = Field(default=None, description="Human-readable element name")
    description: str | None = Field(
        default=None, description="Detailed description for RAG context"
    )
    semantic_tags: list[str] = Field(
        default_factory=list, description="Tags for semantic search"
    )
    image_data: str | None = Field(
        default=None, description="Base64-encoded image of the element"
    )
    bounding_box: BoundingBox | None = Field(
        default=None, description="Location within screenshot"
    )
    screenshot_info: ScreenshotInfo | None = Field(
        default=None, description="Screenshot this element belongs to"
    )
    vector_db: VectorDBInfo | None = Field(
        default=None, description="Vector database metadata if indexed"
    )
    ocr_text: str | None = Field(
        default=None, description="OCR-extracted text from element if available"
    )
    confidence_score: float | None = Field(
        default=None, description="Detection confidence score"
    )
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    metadata: dict[str, Any] = Field(
        default_factory=dict, description="Additional metadata"
    )


class RAGAction(BaseModel):
    """Action definition with RAG-friendly element references."""

    action_id: str
    action_type: str
    name: str | None = None
    target_element_id: str | None = Field(
        default=None, description="ID of RAG element this action targets"
    )
    config: dict[str, Any]
    description: str | None = Field(
        default=None,
        description="Natural language description of what this action does",
    )
    expected_outcome: str | None = Field(
        default=None, description="Expected outcome for verification"
    )
    timeout: int | None = None
    retry_count: int | None = None


class RAGTransition(BaseModel):
    """State transition with RAG context."""

    transition_id: str
    transition_type: str
    name: str
    description: str | None = None
    from_state_id: str | None = None
    to_state_id: str | None = None
    trigger_element_ids: list[str] = Field(
        default_factory=list, description="RAG element IDs that trigger this transition"
    )
    workflow_ids: list[str] = Field(
        default_factory=list, description="Workflow IDs executed during transition"
    )
    activate_state_ids: list[str] = Field(default_factory=list)
    deactivate_state_ids: list[str] = Field(default_factory=list)
    stays_visible: bool = False
    timeout: int = 10000
    retry_count: int = 3


class RAGState(BaseModel):
    """Application state with RAG-indexed identifying elements."""

    state_id: str
    name: str
    description: str | None = None
    identifying_element_ids: list[str] = Field(
        default_factory=list,
        description="RAG element IDs that identify this state",
    )
    is_initial: bool = False
    is_final: bool = False
    semantic_context: str | None = Field(
        None, description="Natural language description for RAG retrieval"
    )
    position: dict[str, float] | None = None


class RAGWorkflow(BaseModel):
    """Workflow with RAG-friendly structure."""

    workflow_id: str
    name: str
    description: str | None = None
    category: str | None = None
    actions: list[RAGAction]
    initial_state_ids: list[str] = Field(
        default_factory=list,
        description="Initial active states when workflow starts",
    )
    semantic_intent: str | None = Field(
        None, description="Natural language intent for RAG retrieval"
    )
    tags: list[str] = Field(default_factory=list)
    version: str = "1.0.0"


class EmbeddingConfig(BaseModel):
    """Configuration for embedding model used in RAG."""

    model_name: str = Field(
        default="sentence-transformers/all-MiniLM-L6-v2",
        description="HuggingFace model name for embeddings",
    )
    embedding_dimension: int = Field(default=384, description="Vector dimension size")
    batch_size: int = Field(default=32, description="Batch size for embedding")
    device: str = Field(default="cpu", description="Device: cpu, cuda, mps")


class RAGMetadata(BaseModel):
    """Metadata for RAG configuration."""

    project_name: str
    project_id: str
    description: str | None = None
    author: str | None = None
    created_at: datetime
    exported_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    target_application: str | None = None
    tags: list[str] = Field(default_factory=list)
    embedding_config: EmbeddingConfig = Field(default_factory=EmbeddingConfig)
    version: str = "1.0.0"


class RAGConfigExport(BaseModel):
    """
    Complete RAG-optimized configuration export.

    This format is designed for:
    1. Vector database indexing (Chroma, Pinecone, Weaviate, etc.)
    2. Semantic search over UI elements and states
    3. LLM-based automation with retrieval augmentation
    4. Natural language to automation mapping
    """

    metadata: RAGMetadata
    elements: list[RAGElement] = Field(
        default_factory=list, description="All visual elements as RAG documents"
    )
    states: list[RAGState] = Field(
        default_factory=list, description="Application states"
    )
    workflows: list[RAGWorkflow] = Field(
        default_factory=list, description="Automation workflows"
    )
    transitions: list[RAGTransition] = Field(
        default_factory=list, description="State transitions"
    )


class RAGExportRequest(BaseModel):
    """Request model for RAG export."""

    include_screenshots: bool = Field(
        default=True, description="Include screenshot metadata in elements"
    )
    include_ocr: bool = Field(default=True, description="Include OCR text if available")
    embedding_model: str | None = Field(
        default=None, description="Override default embedding model"
    )
    tags_filter: list[str] | None = Field(
        default=None, description="Only export elements with these tags"
    )


class TransferStatus(BaseModel):
    """Status of RAG config transfer to runner."""

    success: bool
    message: str
    runner_url: str | None = None
    transferred_at: datetime | None = None
    error_details: str | None = None


class RAGExportResponse(BaseModel):
    """Response model for RAG export endpoint."""

    success: bool
    message: str
    config: RAGConfigExport | None = None
    transfer_status: TransferStatus | None = Field(
        default=None, description="Status if transferred to runner"
    )
    export_size_bytes: int | None = Field(
        default=None, description="Size of exported config in bytes"
    )
    element_count: int | None = Field(
        default=None, description="Number of elements exported"
    )
