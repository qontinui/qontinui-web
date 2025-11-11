"""
Pydantic schemas for annotation API
"""

from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime


# Annotation schemas

class AnnotationBase(BaseModel):
    x: int = Field(..., ge=0)
    y: int = Field(..., ge=0)
    width: int = Field(..., gt=0)
    height: int = Field(..., gt=0)
    label: Optional[str] = None
    description: Optional[str] = None
    reason: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class AnnotationCreate(AnnotationBase):
    pass


class AnnotationUpdate(BaseModel):
    x: Optional[int] = Field(None, ge=0)
    y: Optional[int] = Field(None, ge=0)
    width: Optional[int] = Field(None, gt=0)
    height: Optional[int] = Field(None, gt=0)
    label: Optional[str] = None
    description: Optional[str] = None
    reason: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class AnnotationResponse(AnnotationBase):
    id: str
    annotation_set_id: str
    order: int

    class Config:
        from_attributes = True


# Annotation Set schemas

class AnnotationSetBase(BaseModel):
    screenshot_name: str
    screenshot_url: str
    image_width: int = Field(..., gt=0)
    image_height: int = Field(..., gt=0)
    notes: Optional[str] = None


class AnnotationSetCreate(AnnotationSetBase):
    annotations: Optional[List[AnnotationCreate]] = None


class AnnotationSetUpdate(BaseModel):
    screenshot_name: Optional[str] = None
    screenshot_url: Optional[str] = None
    notes: Optional[str] = None
    annotations: Optional[List[AnnotationCreate]] = None


class AnnotationSetResponse(AnnotationSetBase):
    id: str
    created_at: datetime
    updated_at: datetime
    created_by_id: str
    annotations: List[AnnotationResponse] = []

    class Config:
        from_attributes = True
