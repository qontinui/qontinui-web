import os
import uuid
from pathlib import Path
from typing import BinaryIO

from fastapi import HTTPException, UploadFile, status
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.storage_service import StorageService


class AvatarService:
    """Service for handling user avatar uploads"""

    # Allowed image formats
    ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
    ALLOWED_CONTENT_TYPES = {
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
    }

    # Image constraints
    MAX_FILE_SIZE = 2 * 1024 * 1024  # 2MB
    AVATAR_SIZE = (200, 200)  # Target size for avatars

    # Storage configuration
    UPLOAD_DIR = Path("uploads/avatars")

    def __init__(self):
        """Initialize avatar service and ensure upload directory exists"""
        self.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    def _validate_file_extension(self, filename: str) -> None:
        """Validate file extension"""
        extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if extension not in self.ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File type not allowed. Allowed types: {', '.join(self.ALLOWED_EXTENSIONS)}",
            )

    def _validate_content_type(self, content_type: str) -> None:
        """Validate content type"""
        if content_type not in self.ALLOWED_CONTENT_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Content type not allowed. Must be an image file.",
            )

    def _validate_file_size(self, file: BinaryIO) -> None:
        """Validate file size"""
        file.seek(0, os.SEEK_END)
        file_size = file.tell()
        file.seek(0)

        if file_size > self.MAX_FILE_SIZE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File too large. Maximum size: {self.MAX_FILE_SIZE // (1024 * 1024)}MB",
            )

    def _resize_image(self, image: Image.Image) -> Image.Image:
        """Resize image to target size while maintaining aspect ratio"""
        # Convert RGBA to RGB if necessary
        if image.mode == "RGBA":
            # Create a white background
            background = Image.new("RGB", image.size, (255, 255, 255))
            background.paste(image, mask=image.split()[3])  # 3 is the alpha channel
            image = background
        elif image.mode != "RGB":
            image = image.convert("RGB")

        # Resize while maintaining aspect ratio
        image.thumbnail(self.AVATAR_SIZE, Image.Resampling.LANCZOS)

        # Create a square canvas and center the image
        canvas = Image.new("RGB", self.AVATAR_SIZE, (255, 255, 255))
        offset = (
            (self.AVATAR_SIZE[0] - image.size[0]) // 2,
            (self.AVATAR_SIZE[1] - image.size[1]) // 2,
        )
        canvas.paste(image, offset)

        return canvas

    def _generate_filename(self, original_filename: str) -> str:
        """Generate unique filename"""
        extension = original_filename.rsplit(".", 1)[-1].lower()
        unique_id = str(uuid.uuid4())
        return f"{unique_id}.{extension}"

    async def save_avatar(
        self,
        file: UploadFile,
        user_id: int,
        db: AsyncSession | None = None,
        subscription_tier: str = "free",
    ) -> str:
        """
        Save and process avatar image

        Args:
            file: Uploaded file from FastAPI
            user_id: ID of the user uploading the avatar
            db: Database session for storage tracking (optional)
            subscription_tier: User's subscription tier for quota checking

        Returns:
            URL path to the saved avatar

        Raises:
            HTTPException: If file validation fails or processing errors occur
        """
        # Validate file
        self._validate_file_extension(file.filename or "")
        self._validate_content_type(file.content_type or "")

        # Read file content
        content = await file.read()
        await file.seek(0)

        # Validate size
        self._validate_file_size(file.file)

        # Check storage quota if db session provided
        if db:
            # Get approximate final file size (after JPEG compression, usually smaller)
            estimated_size = len(content) // 2  # Rough estimate
            await StorageService.check_quota(
                db=db,
                user_id=user_id,
                subscription_tier=subscription_tier,
                additional_bytes=estimated_size,
            )

        # Process image
        try:
            image = Image.open(file.file)

            # Validate it's actually an image
            image.verify()

            # Reopen for processing (verify closes the file)
            image = Image.open(file.file)

            # Resize image
            processed_image = self._resize_image(image)

            # Generate filename
            filename = self._generate_filename(file.filename or "avatar.jpg")
            file_path = self.UPLOAD_DIR / filename

            # Save processed image
            processed_image.save(file_path, format="JPEG", quality=85, optimize=True)

            # Track storage usage if db session provided
            if db:
                file_size = os.path.getsize(file_path)
                await StorageService.track_upload(
                    db=db,
                    user_id=user_id,
                    file_path=str(file_path),
                    file_size_bytes=file_size,
                    file_type="avatar",
                )

            # Return URL path
            return f"/uploads/avatars/{filename}"

        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid image file: {str(e)}",
            )

    async def delete_avatar(
        self,
        avatar_url: str,
        db: AsyncSession | None = None,
        user_id: int | None = None,
    ) -> bool:
        """
        Delete avatar file from storage

        Args:
            avatar_url: URL path to the avatar
            db: Database session for storage tracking (optional)
            user_id: User ID for storage tracking (optional)

        Returns:
            True if deleted successfully, False otherwise
        """
        if not avatar_url:
            return False

        try:
            # Extract filename from URL
            filename = avatar_url.split("/")[-1]
            file_path = self.UPLOAD_DIR / filename

            # Delete file if it exists
            if file_path.exists():
                file_path.unlink()

                # Remove from storage tracking if db session provided
                if db and user_id:
                    await StorageService.delete_file_record(
                        db=db, file_path=str(file_path), user_id=user_id
                    )

                return True

        except Exception:
            # Log error but don't raise - file might already be deleted
            pass

        return False


# Create singleton instance
avatar_service = AvatarService()
