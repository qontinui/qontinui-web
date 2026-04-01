"""RAG Builder service package.

This package provides modular components for managing RAG configuration:
- entity_crud: Generic CRUD operations for elements, states, transitions
- embedding_processor: Embedding results processing and storage

The main RAGBuilderService facade is exported from app.services.rag_builder.
"""

from app.services.rag.embedding_processor import EmbeddingProcessor, embedding_processor
from app.services.rag.entity_crud import (
                                                  RAGEntityCRUD,
                                                  element_crud,
                                                  state_crud,
                                                  transition_crud,
)

__all__ = [
    # Entity CRUD
    "RAGEntityCRUD",
    "element_crud",
    "state_crud",
    "transition_crud",
    # Embedding Processor
    "EmbeddingProcessor",
    "embedding_processor",
]
