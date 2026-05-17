"""Background task definitions for ARQ worker."""

import asyncio
import re
import tempfile
import time
from pathlib import Path
from typing import Any
from uuid import UUID

import structlog

logger = structlog.get_logger(__name__)


# ----------------------------------------------------------------------
# Training task — module-level constants
# ----------------------------------------------------------------------
#
# The training/finetune repos live as siblings of ``qontinui-web``. From
# this file the layout is::
#
#     qontinui-root/                       <- 5 parents up
#       qontinui-web/
#         backend/
#           app/
#             worker/
#               tasks.py                     <- __file__
#       qontinui-train/                      <- _training_repo()
#       qontinui-finetune/                   <- _finetune_repo()
#
# Resolved lazily at call time. The cloud-deployed web image has neither
# `qontinui-train` nor `qontinui-finetune` siblings (they live next to
# the runner, not in the FastAPI service). Module-import must succeed
# without these — only the training/finetune task entrypoints below
# actually consult these paths.
def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _training_repo() -> Path:
    return _repo_root() / "qontinui-train"


def _finetune_repo() -> Path:
    return _repo_root() / "qontinui-finetune"


# Training subprocess output handling.
#
# - ``MAX_LOGS_BYTES``: cap stored stdout at 1 MiB. Beyond this the tail
#   is kept (most recent output is what's useful for debugging) and the
#   prefix is dropped — written into a single ``logs`` text column.
# - ``LOG_FLUSH_LINES`` / ``LOG_FLUSH_SECONDS``: throttle DB commits so a
#   chatty trainer (yolo prints per-step) doesn't hammer the worker
#   connection. Whichever threshold trips first triggers a flush.
# - ``CANCEL_POLL_SECONDS``: how often to re-read ``status`` from the
#   DB to detect external cancellation. Cheap (single-row PK lookup) so
#   3 s is well within budget; the subprocess sees SIGTERM within that
#   window.
# - ``ERROR_TAIL_BYTES``: when the trainer fails, store this much of
#   the tail of stdout in ``error`` so the UI shows the actual stack
#   trace without dragging in megabytes.
MAX_LOGS_BYTES = 1024 * 1024  # 1 MiB
LOG_FLUSH_LINES = 10
LOG_FLUSH_SECONDS = 5.0
CANCEL_POLL_SECONDS = 3.0
ERROR_TAIL_BYTES = 4 * 1024  # 4 KiB

# Regex used to scrape epoch progress from trainer stdout. Both YOLO
# (ultralytics) and the qontinui-train scripts emit lines like
# ``Epoch 12/100`` somewhere in the output. We intentionally don't
# anchor — the line typically has a leading "[INFO]" or progress bar.
_EPOCH_RE = re.compile(r"Epoch\s+(\d+)\s*/\s*(\d+)")


async def send_email_task(
    ctx: dict[str, Any],
    to_email: str,
    subject: str,
    html_content: str,
    text_content: str | None = None,
) -> dict[str, Any]:
    """
    Send an email in the background.

    Args:
        ctx: ARQ context (contains redis, job_id, etc.)
        to_email: Recipient email address
        subject: Email subject
        html_content: HTML email body
        text_content: Plain text email body (optional)

    Returns:
        Dict with status and message
    """
    logger.info("sending_email", to_email=to_email, subject=subject)

    try:
        from app.services.email.email_transport_service import EmailTransportService

        transport = EmailTransportService()
        await transport.send_email(
            to_email=to_email,
            subject=subject,
            html_body=html_content,
            text_body=text_content,
        )

        logger.info("email_sent_successfully", to_email=to_email)
        return {"status": "success", "to_email": to_email, "subject": subject}

    except Exception as e:
        logger.error(
            "email_send_failed",
            to_email=to_email,
            error=str(e),
            error_type=type(e).__name__,
        )
        return {"status": "error", "error": str(e), "to_email": to_email}


async def send_verification_email_task(
    ctx: dict[str, Any],
    to_email: str,
    username: str,
    verification_token: str,
) -> dict[str, Any]:
    """
    Send email verification in the background.

    Args:
        ctx: ARQ context
        to_email: Recipient email address
        username: User's username
        verification_token: Verification token

    Returns:
        Dict with status
    """
    logger.info("sending_verification_email", to_email=to_email)

    try:
        from app.core.config import settings
        from app.services.email.email_template_service import EmailTemplateService
        from app.services.email.email_transport_service import EmailTransportService

        verify_url = f"{settings.FRONTEND_URL}/verify-email?token={verification_token}"
        context = {"username": username, "verify_url": verify_url}

        template_service = EmailTemplateService()
        html_body, text_body = template_service.render_template(
            "email_verification", context
        )

        transport = EmailTransportService()
        await transport.send_email(
            to_email=to_email,
            subject="Qontinui - Verify Your Email Address",
            html_body=html_body,
            text_body=text_body,
        )

        logger.info("verification_email_sent_successfully", to_email=to_email)
        return {"status": "success", "to_email": to_email}

    except Exception as e:
        logger.error(
            "verification_email_send_failed",
            to_email=to_email,
            error=str(e),
            error_type=type(e).__name__,
        )
        return {"status": "error", "error": str(e), "to_email": to_email}


async def send_password_reset_email_task(
    ctx: dict[str, Any],
    to_email: str,
    username: str,
    reset_token: str,
) -> dict[str, Any]:
    """
    Send password reset email in the background.

    Args:
        ctx: ARQ context
        to_email: Recipient email address
        username: User's username
        reset_token: Password reset token

    Returns:
        Dict with status
    """
    logger.info("sending_password_reset_email", to_email=to_email)

    try:
        from app.core.config import settings
        from app.services.email.email_template_service import EmailTemplateService
        from app.services.email.email_transport_service import EmailTransportService

        reset_url = f"{settings.FRONTEND_URL}/reset-password?token={reset_token}"
        context = {"username": username, "reset_url": reset_url}

        template_service = EmailTemplateService()
        html_body, text_body = template_service.render_template(
            "password_reset", context
        )

        transport = EmailTransportService()
        await transport.send_email(
            to_email=to_email,
            subject="Qontinui - Password Reset Request",
            html_body=html_body,
            text_body=text_body,
        )

        logger.info("password_reset_email_sent_successfully", to_email=to_email)
        return {"status": "success", "to_email": to_email}

    except Exception as e:
        logger.error(
            "password_reset_email_send_failed",
            to_email=to_email,
            error=str(e),
            error_type=type(e).__name__,
        )
        return {"status": "error", "error": str(e), "to_email": to_email}


async def process_uploaded_image(
    ctx: dict[str, Any],
    s3_key: str,
    user_id: str,
    project_id: str,
    image_id: str,
) -> dict[str, Any]:
    """
    Process uploaded image in background: generate thumbnails and upload to S3.

    This task runs asynchronously after image upload to generate thumbnail
    variants without blocking the upload response.

    Args:
        ctx: ARQ context (contains redis, job_id, etc.)
        s3_key: S3 key of the original uploaded image
        user_id: User ID who uploaded the image
        project_id: Project ID the image belongs to
        image_id: Unique image identifier

    Returns:
        Dict with status, variant keys, and processing info
    """
    logger.info(
        "processing_uploaded_image",
        s3_key=s3_key,
        user_id=user_id,
        project_id=project_id,
        image_id=image_id,
    )

    try:
        from app.db.session import AsyncSessionLocal
        from app.services.image_processing_service import ImageProcessingService
        from app.services.object_storage import object_storage
        from app.services.storage_service import StorageService

        # Step 1: Download original image from S3
        logger.debug("downloading_original_from_s3", s3_key=s3_key)
        try:
            original_bytes = object_storage.download_file(s3_key)
        except Exception as e:
            logger.error(
                "s3_download_failed",
                s3_key=s3_key,
                error=str(e),
                error_type=type(e).__name__,
            )
            return {
                "status": "failed",
                "error": f"Failed to download original image: {str(e)}",
                "s3_key": s3_key,
            }

        # Step 2: Generate thumbnails (using parallel processing for 40-50% speed improvement)
        logger.debug("generating_thumbnails_parallel", image_id=image_id)
        try:
            thumbnails = ImageProcessingService.generate_thumbnails_parallel(
                original_bytes
            )
            logger.info(
                "thumbnails_generated_parallel",
                image_id=image_id,
                variants=list(thumbnails.keys()),
            )
        except Exception as e:
            logger.error(
                "thumbnail_generation_failed",
                image_id=image_id,
                error=str(e),
                error_type=type(e).__name__,
            )
            return {
                "status": "failed",
                "error": f"Failed to generate thumbnails: {str(e)}",
                "s3_key": s3_key,
            }

        # Step 3: Upload thumbnails to S3
        variant_keys = {}
        total_thumbnail_size = 0

        for variant_name, thumbnail_bytes in thumbnails.items():
            # Construct S3 key: images/{user_id}/{project_id}/{image_id}_{variant}.webp
            variant_key = (
                f"images/{user_id}/{project_id}/{image_id}_{variant_name}.webp"
            )

            try:
                # Upload thumbnail
                import io

                file_obj = io.BytesIO(thumbnail_bytes)
                object_storage.backend.upload_file(
                    file_obj=file_obj,
                    key=variant_key,
                    content_type="image/webp",
                    metadata={
                        "user_id": user_id,
                        "project_id": project_id,
                        "image_id": image_id,
                        "variant": variant_name,
                        "original_s3_key": s3_key,
                    },
                )

                variant_keys[variant_name] = variant_key
                total_thumbnail_size += len(thumbnail_bytes)

                logger.debug(
                    "thumbnail_uploaded",
                    variant=variant_name,
                    key=variant_key,
                    size_bytes=len(thumbnail_bytes),
                )

            except Exception as e:
                logger.error(
                    "thumbnail_upload_failed",
                    variant=variant_name,
                    key=variant_key,
                    error=str(e),
                    error_type=type(e).__name__,
                )
                # Continue with other variants even if one fails
                continue

        # Step 4: Update storage_usage metadata with variant paths
        async with AsyncSessionLocal() as db:
            try:
                metadata = {
                    "variants": variant_keys,
                    "processing_status": "completed",
                    "image_id": image_id,
                    "thumbnail_size_bytes": total_thumbnail_size,
                }

                updated = await StorageService.update_metadata(
                    db=db,
                    file_path=s3_key,
                    user_id=UUID(user_id),
                    metadata=metadata,
                )

                if not updated:
                    logger.warning(
                        "storage_metadata_update_failed",
                        s3_key=s3_key,
                        reason="record_not_found",
                    )

            except Exception as e:
                logger.error(
                    "storage_metadata_update_failed",
                    s3_key=s3_key,
                    error=str(e),
                    error_type=type(e).__name__,
                )
                # Don't fail the whole task if metadata update fails

        logger.info(
            "image_processing_completed",
            s3_key=s3_key,
            image_id=image_id,
            variants_count=len(variant_keys),
            total_thumbnail_size=total_thumbnail_size,
        )

        return {
            "status": "completed",
            "s3_key": s3_key,
            "image_id": image_id,
            "variants": variant_keys,
            "thumbnail_size_bytes": total_thumbnail_size,
        }

    except Exception as e:
        logger.exception(
            "image_processing_failed",
            s3_key=s3_key,
            error=str(e),
            error_type=type(e).__name__,
        )
        return {
            "status": "failed",
            "error": str(e),
            "s3_key": s3_key,
            "image_id": image_id,
        }


async def run_training_job_task(
    ctx: dict[str, Any],
    job_id: str,
) -> dict[str, Any]:
    """Run a TrainingJob end-to-end on the ARQ worker.

    Pipeline:

    1. Look up the TrainingJob row. If it's already cancelled (the API
       lets a user cancel before the worker picks it up), exit cleanly.
    2. Mark the job ``running`` and stamp ``started_at`` if missing.
    3. Export the associated TrainingDataset to a temp directory in YOLO
       format. The ``dataset_id`` is read from ``config["dataset_id"]``
       — TrainingJob doesn't have a dedicated FK column for it because
       the same job can be reused with different dataset snapshots in
       theory, and stuffing it in ``config`` matches how other tunable
       fields are passed.
    4. Build the trainer command. YOLO-family models (``base_model``
       starts with ``yolo`` or ``model_type == "classification"``) run
       under ``qontinui-finetune/scripts/train.py`` with the YAML config
       the exporter wrote. Detection / segmentation with non-YOLO bases
       run under ``qontinui-train/training/train.py`` directly against
       the dataset directory.
    5. Spawn the trainer as an async subprocess (stdout merged with
       stderr so a single stream covers both). Stream line-by-line:
       append to ``logs`` (truncating to keep the tail of
       ``MAX_LOGS_BYTES``), parse epoch progress, and flush to the DB
       every ``LOG_FLUSH_LINES`` lines or ``LOG_FLUSH_SECONDS``
       seconds.
    6. Periodically (``CANCEL_POLL_SECONDS``) re-read ``status`` from
       the DB. If a separate request set it to ``cancelled`` while the
       subprocess is running, ``terminate()`` the process and exit.
    7. On exit-code 0: locate the produced model artifact (search
       common ultralytics output paths under the dataset dir), upload
       it to object storage at ``models/{project_id}/{job_id}/...``,
       generate a 24-hour presigned URL, and mark the job
       ``completed``.
    8. On non-zero exit: store the tail of stdout in ``error`` and mark
       the job ``failed``.

    Returns ``{"status": <terminal-status>, "job_id": job_id}``.

    The worker isolates failures with a top-level try/except — anything
    unexpected (DB outage, exporter raising on a missing dataset) marks
    the job ``failed`` with the exception message rather than letting
    ARQ silently retry an unbounded number of times.
    """
    from datetime import UTC, datetime

    from sqlalchemy import select

    from app.db.session import AsyncSessionLocal
    from app.models.training_job import TrainingJob, TrainingJobStatus
    from app.services.storage import object_storage
    from app.services.training_dataset_export import TrainingDatasetExporter

    logger.info("training_job_task_started", job_id=job_id)

    try:
        job_uuid = UUID(job_id)
    except ValueError:
        logger.error("training_job_invalid_id", job_id=job_id)
        return {"status": "error", "error": "invalid job_id", "job_id": job_id}

    # ------------------------------------------------------------------
    # Step 1: Initial status check + transition to running.
    # We use a fresh session for each DB touch so a long-running
    # subprocess doesn't pin a connection from the pool.
    # ------------------------------------------------------------------
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(TrainingJob).where(TrainingJob.id == job_uuid))
        job = result.scalar_one_or_none()
        if job is None:
            logger.error("training_job_not_found", job_id=job_id)
            return {"status": "error", "error": "job not found", "job_id": job_id}

        if job.status == TrainingJobStatus.CANCELLED.value:
            # User cancelled before the worker picked it up — nothing to do.
            logger.info("training_job_cancelled_before_start", job_id=job_id)
            return {"status": "cancelled", "job_id": job_id}

        config = dict(job.config or {})
        project_id = str(job.project_id)
        model_type = str(job.model_type or "detection")
        # ``base_model`` lives in config (yolov8n, resnet50, ...).
        base_model = str(config.get("base_model", "yolov8n"))
        # ``dataset_id`` is required — the API stamps it onto config
        # when the job is created. Bail out early if missing.
        dataset_id_raw = config.get("dataset_id") or config.get("training_dataset_id")
        if not dataset_id_raw:
            error_msg = "config.dataset_id is required to run training"
            job.status = TrainingJobStatus.FAILED.value  # type: ignore[assignment]
            job.error = error_msg  # type: ignore[assignment]
            job.completed_at = datetime.now(UTC)  # type: ignore[assignment]
            await db.commit()
            logger.error("training_job_missing_dataset_id", job_id=job_id)
            return {"status": "failed", "error": error_msg, "job_id": job_id}

        try:
            dataset_uuid = UUID(str(dataset_id_raw))
        except ValueError:
            error_msg = f"config.dataset_id is not a valid UUID: {dataset_id_raw!r}"
            job.status = TrainingJobStatus.FAILED.value  # type: ignore[assignment]
            job.error = error_msg  # type: ignore[assignment]
            job.completed_at = datetime.now(UTC)  # type: ignore[assignment]
            await db.commit()
            logger.error("training_job_bad_dataset_id", job_id=job_id)
            return {"status": "failed", "error": error_msg, "job_id": job_id}

        # Mark running. ``started_at`` may already be set by the API's
        # ``start_training_job`` endpoint — only stamp if missing so we
        # preserve the queued-at timestamp for analytics.
        job.status = TrainingJobStatus.RUNNING.value  # type: ignore[assignment]
        if job.started_at is None:
            job.started_at = datetime.now(UTC)  # type: ignore[assignment]
        # Reset progress so a retried job doesn't show stale values.
        job.progress = 0  # type: ignore[assignment]
        job.current_epoch = None  # type: ignore[assignment]
        # ``total_epochs`` is set at create-time but re-stamp from
        # config so a manual UPDATE isn't required to change it.
        if "epochs" in config:
            job.total_epochs = int(config["epochs"])  # type: ignore[assignment]
        await db.commit()

    epochs = int(config.get("epochs", 50))
    batch_size = int(config.get("batch_size", 16))
    learning_rate = float(config.get("learning_rate", 0.001))

    # ------------------------------------------------------------------
    # Step 2: Export dataset + run trainer + stream logs.
    # The temp dir is scoped to this ``with`` so cleanup is automatic
    # whether we succeed, fail, or get cancelled.
    # ------------------------------------------------------------------
    final_status = TrainingJobStatus.FAILED.value
    final_error: str | None = None
    final_logs_tail = ""
    output_storage_key: str | None = None
    output_presigned_url: str | None = None

    try:
        with tempfile.TemporaryDirectory(prefix=f"qontinui-train-{job_id}-") as tmp:
            dest_dir = Path(tmp) / "dataset"
            dest_dir.mkdir(parents=True, exist_ok=True)

            # Export under its own session — the export issues several
            # SELECTs and we don't want the long-running training
            # subprocess holding a DB connection while it works.
            async with AsyncSessionLocal() as db:
                exporter = TrainingDatasetExporter(db, object_storage)
                await exporter.export_yolo(dataset_uuid, dest_dir)

            cmd, cwd = _build_training_command(
                model_type=model_type,
                base_model=base_model,
                dest_dir=dest_dir,
                epochs=epochs,
                batch_size=batch_size,
                learning_rate=learning_rate,
            )
            logger.info(
                "training_job_subprocess_starting",
                job_id=job_id,
                cwd=str(cwd),
                cmd=cmd,
            )

            # ``stderr=STDOUT`` collapses both streams onto one pipe so
            # we can show the full picture in ``logs`` without
            # interleaving complications.
            process = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=str(cwd),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )

            # Stream + flush loop. ``logs_buffer`` accumulates the full
            # stdout (capped to ``MAX_LOGS_BYTES``); ``pending_lines``
            # tracks how many lines have come in since the last flush.
            logs_buffer = ""
            pending_lines = 0
            last_flush = time.monotonic()
            last_cancel_check = time.monotonic()
            current_epoch = 0
            total_epochs = epochs
            cancelled = False

            assert process.stdout is not None  # noqa: S101 — set via PIPE above
            # Read with a timeout so cancellation fires even when the
            # trainer is silent (frozen, waiting on GPU, mid-evaluation).
            # An empty bytes return signals EOF.
            while True:
                try:
                    raw = await asyncio.wait_for(
                        process.stdout.readline(),
                        timeout=CANCEL_POLL_SECONDS,
                    )
                except TimeoutError:
                    raw = b""  # no line; fall through to cancel-check

                if raw:
                    line = raw.decode("utf-8", errors="replace")
                    logs_buffer = _append_logs(logs_buffer, line)
                    pending_lines += 1

                    # Parse epoch progress. Last match on a line wins
                    # (some progress bars print ``Epoch 1/100  Epoch
                    # 2/100`` as the bar redraws).
                    m = _EPOCH_RE.search(line)
                    if m:
                        current_epoch = int(m.group(1))
                        total_epochs = int(m.group(2))
                elif process.returncode is not None:
                    # EOF + process has exited.
                    break

                now = time.monotonic()
                # Flush logs/progress to DB on either threshold.
                if pending_lines and (
                    pending_lines >= LOG_FLUSH_LINES
                    or now - last_flush >= LOG_FLUSH_SECONDS
                ):
                    await _flush_progress(
                        job_uuid,
                        logs=logs_buffer,
                        current_epoch=current_epoch,
                        total_epochs=total_epochs,
                    )
                    pending_lines = 0
                    last_flush = now

                # Cancellation check (cheap PK lookup).
                if now - last_cancel_check >= CANCEL_POLL_SECONDS:
                    last_cancel_check = now
                    if await _check_cancelled(job_uuid):
                        logger.info("training_job_cancellation_detected", job_id=job_id)
                        cancelled = True
                        try:
                            process.terminate()
                        except ProcessLookupError:
                            # Already exited between the check and the
                            # signal — harmless race.
                            pass
                        break

            # Wait for exit, escalating to kill() if the trainer ignores
            # SIGTERM (e.g. ultralytics workers on Windows that survive
            # TerminateProcess on the parent python.exe).
            try:
                await asyncio.wait_for(process.wait(), timeout=30)
            except TimeoutError:
                logger.warning(
                    "training_job_terminate_timeout_killing",
                    job_id=job_id,
                )
                try:
                    process.kill()
                except ProcessLookupError:
                    pass
                await process.wait()

            # Final flush of any unflushed lines + the now-known exit
            # code. We compute the artifact AFTER this so a cancelled
            # job doesn't try to upload a half-written model.
            await _flush_progress(
                job_uuid,
                logs=logs_buffer,
                current_epoch=current_epoch,
                total_epochs=total_epochs,
            )

            final_logs_tail = logs_buffer[-ERROR_TAIL_BYTES:]

            if cancelled:
                final_status = TrainingJobStatus.CANCELLED.value
            elif process.returncode == 0:
                # ------------------------------------------------------
                # Success: locate + upload artifact.
                # ------------------------------------------------------
                artifact = _find_model_artifact(dest_dir)
                if artifact is None:
                    final_status = TrainingJobStatus.FAILED.value
                    final_error = (
                        "trainer exited 0 but no model artifact was found "
                        f"under {dest_dir}"
                    )
                    logger.warning(
                        "training_job_artifact_not_found",
                        job_id=job_id,
                        dest_dir=str(dest_dir),
                    )
                else:
                    storage_key = f"models/{project_id}/{job_id}/{artifact.name}"

                    def _upload_artifact() -> None:
                        with artifact.open("rb") as fh:
                            object_storage.backend.upload_file(
                                fh,
                                storage_key,
                                "application/octet-stream",
                                {
                                    "job_id": job_id,
                                    "project_id": project_id,
                                    "dataset_id": str(dataset_uuid),
                                },
                            )

                    try:
                        # Run blocking S3 upload in a thread so the
                        # event loop stays responsive. The closure owns
                        # the file handle so it's closed even on error.
                        await asyncio.to_thread(_upload_artifact)
                        # 24 h presigned URL — long enough for a user
                        # to click through from the UI without making
                        # the link permanent.
                        output_presigned_url = await asyncio.to_thread(
                            object_storage.generate_presigned_url,
                            storage_key,
                            24 * 3600,
                        )
                        output_storage_key = storage_key
                        final_status = TrainingJobStatus.COMPLETED.value
                        logger.info(
                            "training_job_artifact_uploaded",
                            job_id=job_id,
                            key=storage_key,
                            artifact_size=artifact.stat().st_size,
                        )
                    except Exception as upload_exc:
                        final_status = TrainingJobStatus.FAILED.value
                        final_error = f"model artifact upload failed: {upload_exc}"
                        logger.exception(
                            "training_job_upload_failed",
                            job_id=job_id,
                            error=str(upload_exc),
                        )
            else:
                final_status = TrainingJobStatus.FAILED.value
                final_error = (
                    f"trainer exited {process.returncode}\n"
                    f"--- last {len(final_logs_tail)} bytes of output ---\n"
                    f"{final_logs_tail}"
                )

    except Exception as exc:
        # Catch-all for export errors, exporter ValueError on empty
        # datasets, subprocess spawn failures (e.g. Python missing
        # from the trainer repo), etc. Surface as job failure rather
        # than letting ARQ retry blindly.
        logger.exception("training_job_task_failed", job_id=job_id, error=str(exc))
        final_status = TrainingJobStatus.FAILED.value
        final_error = f"{type(exc).__name__}: {exc}"

    # ------------------------------------------------------------------
    # Step 3: Final DB write — terminal status + outputs.
    # ------------------------------------------------------------------
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(TrainingJob).where(TrainingJob.id == job_uuid))
        job = result.scalar_one_or_none()
        if job is not None:
            job.status = final_status  # type: ignore[assignment]
            job.completed_at = datetime.now(UTC)  # type: ignore[assignment]
            if final_status == TrainingJobStatus.COMPLETED.value:
                job.progress = 100  # type: ignore[assignment]
                if output_storage_key:
                    job.output_path = output_storage_key  # type: ignore[assignment]
                if output_presigned_url:
                    job.model_url = output_presigned_url  # type: ignore[assignment]
                # ``metrics`` is left as-is for now; parsing
                # trainer-specific metric blobs (mAP, val_loss, ...)
                # belongs in a follow-up that knows the trainer's
                # output format.
                if job.metrics is None:
                    job.metrics = {}  # type: ignore[assignment]
            elif final_status == TrainingJobStatus.FAILED.value and final_error:
                job.error = final_error  # type: ignore[assignment]
            await db.commit()

    logger.info(
        "training_job_task_finished",
        job_id=job_id,
        status=final_status,
    )
    return {"status": final_status, "job_id": job_id}


def _build_training_command(
    *,
    model_type: str,
    base_model: str,
    dest_dir: Path,
    epochs: int,
    batch_size: int,
    learning_rate: float,
) -> tuple[list[str], Path]:
    """Pick the trainer entrypoint + arguments for this job.

    YOLO-family detection / classification dispatches to the
    fine-tuning repo (``qontinui-finetune/scripts/train.py``) which
    consumes a YOLO ``data.yaml``. Everything else (custom detection
    backbones, segmentation) goes to the from-scratch trainer in
    ``qontinui-train/training/train.py`` which reads the YOLO directory
    layout but doesn't require a YAML config.

    Returns a ``(cmd, cwd)`` pair. ``cwd`` matters because both
    repos resolve relative imports / data paths from their own root.
    """
    base_model_lc = base_model.lower()
    is_yolo = base_model_lc.startswith("yolo")
    is_classification = model_type == "classification"

    if is_yolo or is_classification:
        cmd = [
            "python",
            "scripts/train.py",
            "--data",
            str(dest_dir / "data.yaml"),
            "--model",
            base_model,
            "--epochs",
            str(epochs),
            "--batch",
            str(batch_size),
            "--lr",
            str(learning_rate),
            "--project",
            str(dest_dir / "runs"),
        ]
        return cmd, _finetune_repo()

    cmd = [
        "python",
        "training/train.py",
        "--data",
        str(dest_dir),
        "--model",
        base_model,
        "--epochs",
        str(epochs),
        "--batch",
        str(batch_size),
        "--lr",
        str(learning_rate),
        "--out",
        str(dest_dir / "runs"),
    ]
    return cmd, _training_repo()


def _append_logs(buffer: str, line: str) -> str:
    """Append ``line`` to ``buffer`` and trim to the tail of MAX_LOGS_BYTES.

    We keep the tail (most recent output) rather than the head because
    that's what's useful for diagnosing failure or reading the latest
    progress bar frame.
    """
    new_buffer = buffer + line
    if len(new_buffer) > MAX_LOGS_BYTES:
        # Trim from the front. UTF-8 boundaries don't matter here
        # because we already decoded with ``errors="replace"`` upstream.
        new_buffer = new_buffer[-MAX_LOGS_BYTES:]
    return new_buffer


async def _flush_progress(
    job_uuid: UUID,
    *,
    logs: str,
    current_epoch: int,
    total_epochs: int,
) -> None:
    """Persist current logs + progress to the TrainingJob row.

    Each call opens a fresh session — this is run periodically while
    the trainer subprocess is alive, and we don't want a single long
    transaction holding pool connections for the duration of training.
    """
    from sqlalchemy import select

    from app.db.session import AsyncSessionLocal
    from app.models.training_job import TrainingJob

    progress = 0
    if total_epochs > 0:
        progress = max(0, min(100, int(100 * current_epoch / total_epochs)))

    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(TrainingJob).where(TrainingJob.id == job_uuid)
            )
            job = result.scalar_one_or_none()
            if job is None:
                return
            job.logs = logs  # type: ignore[assignment]
            job.current_epoch = current_epoch  # type: ignore[assignment]
            job.total_epochs = total_epochs  # type: ignore[assignment]
            job.progress = progress  # type: ignore[assignment]
            await db.commit()
    except Exception as exc:
        # Don't let a transient DB hiccup tank the trainer subprocess —
        # log and move on. The next flush will retry.
        logger.warning(
            "training_job_progress_flush_failed",
            job_id=str(job_uuid),
            error=str(exc),
        )


async def _check_cancelled(job_uuid: UUID) -> bool:
    """Return True if the job's status has been externally set to ``cancelled``.

    Errors are swallowed (logged only) so a transient DB issue can't
    spuriously kill a running trainer; we'll get another shot on the
    next poll.
    """
    from sqlalchemy import select

    from app.db.session import AsyncSessionLocal
    from app.models.training_job import TrainingJob, TrainingJobStatus

    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(TrainingJob.status).where(TrainingJob.id == job_uuid)
            )
            status_value = result.scalar_one_or_none()
            return status_value == TrainingJobStatus.CANCELLED.value
    except Exception as exc:
        logger.warning(
            "training_job_cancel_check_failed",
            job_id=str(job_uuid),
            error=str(exc),
        )
        return False


def _find_model_artifact(dest_dir: Path) -> Path | None:
    """Locate the trained model artifact under ``dest_dir``.

    Searches the conventional ultralytics paths first (``runs/train/...``,
    ``runs/detect/...`` with ``weights/best.pt``) then falls back to a
    recursive glob for any ``best.pt`` / ``last.pt`` / ``*.pt`` /
    ``*.onnx``. Returns ``None`` if nothing is found — the caller treats
    that as a failure rather than guessing at outputs.
    """
    # Most-specific first.
    candidates = [
        "runs/train/weights/best.pt",
        "runs/detect/weights/best.pt",
        "runs/segment/weights/best.pt",
        "runs/classify/weights/best.pt",
        "runs/train/weights/last.pt",
        "runs/detect/weights/last.pt",
    ]
    for rel in candidates:
        path = dest_dir / rel
        if path.is_file():
            return path

    # Generic fallback — pick the most-recently-modified .pt under runs/.
    runs_dir = dest_dir / "runs"
    if runs_dir.is_dir():
        pt_files = sorted(
            runs_dir.rglob("*.pt"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if pt_files:
            return pt_files[0]
        onnx_files = sorted(
            runs_dir.rglob("*.onnx"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if onnx_files:
            return onnx_files[0]

    return None


async def cleanup_old_data_task(
    ctx: dict[str, Any], days_to_keep: int = 90
) -> dict[str, Any]:
    """
    Clean up old audit logs and usage metrics (periodic task).

    This task should be run daily via cron or scheduled job.
    Keeps audit logs and detailed metrics for the specified number of days.

    Args:
        ctx: ARQ context
        days_to_keep: Number of days to keep detailed data (default 90)

    Returns:
        Dict with cleanup statistics
    """
    logger.info("running_cleanup_task", days_to_keep=days_to_keep)

    try:
        from datetime import timedelta

        from qontinui_schemas.common import utc_now
        from sqlalchemy import delete

        from app.db.session import AsyncSessionLocal
        from app.models.audit_log import AuditLog
        from app.models.usage_metric import UsageMetric

        cutoff_date = utc_now() - timedelta(days=days_to_keep)
        audit_logs_deleted = 0
        metrics_deleted = 0

        async with AsyncSessionLocal() as db:
            # Clean up old audit logs
            audit_delete_stmt = delete(AuditLog).where(
                AuditLog.created_at < cutoff_date
            )
            result = await db.execute(audit_delete_stmt)
            audit_logs_deleted = result.rowcount

            # Clean up old usage metrics
            # Note: Keep aggregated monthly summaries, only delete detailed metrics
            metrics_delete_stmt = delete(UsageMetric).where(
                UsageMetric.timestamp < cutoff_date
            )
            result = await db.execute(metrics_delete_stmt)
            metrics_deleted = result.rowcount

            await db.commit()

        logger.info(
            "cleanup_completed",
            audit_logs_deleted=audit_logs_deleted,
            metrics_deleted=metrics_deleted,
        )

        return {
            "status": "success",
            "audit_logs_deleted": audit_logs_deleted,
            "metrics_deleted": metrics_deleted,
            "cutoff_date": cutoff_date.isoformat(),
        }

    except Exception as e:
        logger.exception("cleanup_failed", error=str(e), error_type=type(e).__name__)
        return {"status": "error", "error": str(e)}


async def send_analytics_report_task(
    ctx: dict[str, Any],
    user_id: UUID,
    report_type: str = "weekly",
) -> dict[str, Any]:
    """
    Generate and send analytics report to admin users.

    This task generates a comprehensive usage report and emails it to admin users.
    Should be scheduled to run weekly for admins.

    Args:
        ctx: ARQ context
        user_id: User ID to generate report for (must be admin)
        report_type: Type of report (daily, weekly, monthly)

    Returns:
        Dict with status
    """
    logger.info("generating_analytics_report", report_type=report_type, user_id=user_id)

    try:
        from qontinui_schemas.common import utc_now
        from sqlalchemy import select

        from app.core.config import settings
        from app.db.session import AsyncSessionLocal
        from app.models.user import User
        from app.services.analytics_service import analytics_service
        from app.services.email.email_transport_service import EmailTransportService

        # Determine days based on report type
        days_map = {"daily": 1, "weekly": 7, "monthly": 30}
        days = days_map.get(report_type, 7)

        async with AsyncSessionLocal() as db:
            # Get user
            result = await db.execute(select(User).where(User.id == user_id))
            user = result.scalar_one_or_none()

            if not user:
                return {
                    "status": "error",
                    "error": f"User {user_id} not found",
                    "user_id": user_id,
                }

            if not user.is_superuser:
                return {
                    "status": "error",
                    "error": f"User {user_id} is not an admin",
                    "user_id": user_id,
                }

            # Generate analytics summary
            summary = await analytics_service.get_analytics_summary(user_id, days, db)

            # Format email content
            period_start = summary.period_start.strftime("%Y-%m-%d")
            period_end = summary.period_end.strftime("%Y-%m-%d")

            html_content = f"""
            <html>
            <head>
                <style>
                    body {{ font-family: Arial, sans-serif; line-height: 1.6; }}
                    .header {{ background-color: #4CAF50; color: white; padding: 20px; text-align: center; }}
                    .content {{ padding: 20px; }}
                    .metric {{ background-color: #f4f4f4; padding: 15px; margin: 10px 0; border-left: 4px solid #4CAF50; }}
                    .metric-label {{ font-weight: bold; color: #333; }}
                    .metric-value {{ font-size: 24px; color: #4CAF50; }}
                    .footer {{ background-color: #f4f4f4; padding: 20px; text-align: center; color: #666; }}
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>Qontinui {report_type.capitalize()} Analytics Report</h1>
                    <p>{period_start} to {period_end}</p>
                </div>

                <div class="content">
                    <h2>Usage Summary</h2>

                    <div class="metric">
                        <div class="metric-label">API Calls</div>
                        <div class="metric-value">{summary.api_calls:,}</div>
                    </div>

                    <div class="metric">
                        <div class="metric-label">Projects Created</div>
                        <div class="metric-value">{summary.projects_created}</div>
                    </div>

                    <div class="metric">
                        <div class="metric-label">States Created</div>
                        <div class="metric-value">{summary.states_created}</div>
                    </div>

                    <div class="metric">
                        <div class="metric-label">Images Uploaded</div>
                        <div class="metric-value">{summary.images_uploaded}</div>
                    </div>

                    <h2>Overall Statistics</h2>

                    <div class="metric">
                        <div class="metric-label">Total Projects</div>
                        <div class="metric-value">{summary.total_projects}</div>
                    </div>

                    <div class="metric">
                        <div class="metric-label">Storage Used</div>
                        <div class="metric-value">{summary.total_storage_bytes / (1024**2):.2f} MB</div>
                    </div>

                    <div class="metric">
                        <div class="metric-label">Avg Response Time</div>
                        <div class="metric-value">{summary.avg_response_time_seconds:.3f}s</div>
                    </div>
                </div>

                <div class="footer">
                    <p>Generated on {utc_now().strftime("%Y-%m-%d %H:%M:%S")} UTC</p>
                    <p><a href="{settings.FRONTEND_URL}/admin/analytics">View Detailed Analytics</a></p>
                </div>
            </body>
            </html>
            """

            text_content = f"""
            Qontinui {report_type.capitalize()} Analytics Report
            {period_start} to {period_end}

            Usage Summary:
            - API Calls: {summary.api_calls:,}
            - Projects Created: {summary.projects_created}
            - States Created: {summary.states_created}
            - Images Uploaded: {summary.images_uploaded}

            Overall Statistics:
            - Total Projects: {summary.total_projects}
            - Storage Used: {summary.total_storage_bytes / (1024**2):.2f} MB
            - Avg Response Time: {summary.avg_response_time_seconds:.3f}s

            Generated on {utc_now().strftime("%Y-%m-%d %H:%M:%S")} UTC
            View details: {settings.FRONTEND_URL}/admin/analytics
            """

            # Send email
            transport = EmailTransportService()
            await transport.send_email(
                to_email=user.email,
                subject=f"Qontinui {report_type.capitalize()} Analytics Report - {period_start} to {period_end}",
                html_body=html_content,
                text_body=text_content,
            )

        logger.info(
            "analytics_report_sent_successfully",
            to_email=user.email,
            user_id=user_id,
            report_type=report_type,
        )
        return {
            "status": "success",
            "user_id": user_id,
            "report_type": report_type,
            "to_email": user.email,
        }

    except Exception as e:
        logger.exception(
            "analytics_report_generation_failed",
            user_id=user_id,
            error=str(e),
            error_type=type(e).__name__,
        )
        return {"status": "error", "error": str(e), "user_id": user_id}


# Export all task functions
__all__ = [
    "send_email_task",
    "send_verification_email_task",
    "send_password_reset_email_task",
    "process_uploaded_image",
    "run_training_job_task",
    "cleanup_old_data_task",
    "send_analytics_report_task",
]
