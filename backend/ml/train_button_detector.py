"""
Training Script for Button Detection Models

Supports multiple architectures:
    - MobileNetV3 (fast, lightweight)
    - EfficientNet (balanced)
    - YOLO-based detection
    - Custom CNN

Usage:
    python train_button_detector.py --config config.yaml
    python train_button_detector.py --model mobilenet_v3 --epochs 50 --batch-size 32
"""

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
import yaml
from models.button_cnn import ButtonCNN, create_button_cnn
from models.button_yolo import ButtonYOLO, create_button_yolo
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from torch.utils.tensorboard import SummaryWriter


class COCOButtonDataset(Dataset):
    """
    Dataset loader for COCO format button annotations

    COCO JSON format:
    {
        "images": [{"id": 1, "file_name": "img1.jpg", "width": 1920, "height": 1080}, ...],
        "annotations": [
            {
                "id": 1,
                "image_id": 1,
                "category_id": 1,
                "bbox": [x, y, width, height],
                "area": width * height,
                "iscrowd": 0
            }, ...
        ],
        "categories": [
            {"id": 1, "name": "primary_button"},
            {"id": 2, "name": "secondary_button"},
            ...
        ]
    }
    """

    def __init__(
        self,
        root_dir: str,
        annotation_file: str,
        transform=None,
        mode: str = "classification",
        img_size: int = 224,
    ):
        """
        Initialize COCO dataset

        Args:
            root_dir: Root directory containing images
            annotation_file: Path to COCO JSON annotation file
            transform: Image transformations
            mode: 'classification' or 'detection'
            img_size: Image size for classification mode
        """
        self.root_dir = Path(root_dir)
        self.transform = transform
        self.mode = mode
        self.img_size = img_size

        # Load annotations
        with open(annotation_file, "r") as f:
            self.coco_data = json.load(f)

        # Build mappings
        self.images = {img["id"]: img for img in self.coco_data["images"]}
        self.categories = {cat["id"]: cat for cat in self.coco_data["categories"]}

        # Group annotations by image
        self.image_annotations = {}
        for ann in self.coco_data["annotations"]:
            img_id = ann["image_id"]
            if img_id not in self.image_annotations:
                self.image_annotations[img_id] = []
            self.image_annotations[img_id].append(ann)

        # For classification mode, create samples from bounding boxes
        if mode == "classification":
            self.samples = self._create_classification_samples()
        else:
            self.image_ids = list(self.images.keys())

    def _create_classification_samples(self):
        """Create classification samples from bounding boxes"""
        samples = []
        for img_id, annotations in self.image_annotations.items():
            img_info = self.images[img_id]
            for ann in annotations:
                samples.append(
                    {
                        "image_id": img_id,
                        "image_path": self.root_dir / img_info["file_name"],
                        "bbox": ann["bbox"],
                        "category_id": ann["category_id"] - 1,  # Zero-indexed
                        "is_button": 1,  # All samples are buttons
                    }
                )
        return samples

    def __len__(self):
        if self.mode == "classification":
            return len(self.samples)
        else:
            return len(self.image_ids)

    def __getitem__(self, idx):
        if self.mode == "classification":
            return self._get_classification_item(idx)
        else:
            return self._get_detection_item(idx)

    def _get_classification_item(self, idx) -> Tuple[torch.Tensor, Dict[str, Any]]:
        """Get classification sample"""
        sample = self.samples[idx]

        # Load image
        image = Image.open(sample["image_path"]).convert("RGB")

        # Crop to bounding box
        x, y, w, h = sample["bbox"]
        image = image.crop((x, y, x + w, y + h))

        # Resize
        image = image.resize((self.img_size, self.img_size))

        # Apply transforms
        if self.transform:
            image = self.transform(image)
        else:
            image = torch.from_numpy(np.array(image)).permute(2, 0, 1).float() / 255.0

        # Create target
        target = {
            "is_button": torch.tensor(sample["is_button"], dtype=torch.long),
            "button_type": torch.tensor(sample["category_id"], dtype=torch.long),
        }

        return image, target

    def _get_detection_item(self, idx) -> Tuple[torch.Tensor, Dict[str, Any]]:
        """Get detection sample (for YOLO)"""
        img_id = self.image_ids[idx]
        img_info = self.images[img_id]

        # Load image
        image_path = self.root_dir / img_info["file_name"]
        image = Image.open(image_path).convert("RGB")

        # Get annotations
        annotations = self.image_annotations.get(img_id, [])

        # Convert to tensor
        if self.transform:
            image = self.transform(image)
        else:
            image = torch.from_numpy(np.array(image)).permute(2, 0, 1).float() / 255.0

        # Format targets for detection
        boxes = []
        labels = []
        for ann in annotations:
            boxes.append(ann["bbox"])
            labels.append(ann["category_id"] - 1)

        target = {
            "boxes": (
                torch.tensor(boxes, dtype=torch.float32)
                if boxes
                else torch.zeros((0, 4))
            ),
            "labels": (
                torch.tensor(labels, dtype=torch.long)
                if labels
                else torch.zeros((0,), dtype=torch.long)
            ),
            "image_id": torch.tensor([img_id]),
        }

        return image, target


class ButtonDetectorTrainer:
    """Trainer for button detection models"""

    def __init__(self, config: Dict[str, Any]):
        """
        Initialize trainer

        Args:
            config: Training configuration
        """
        self.config = config
        self.device = torch.device(
            "cuda"
            if torch.cuda.is_available() and config.get("use_gpu", True)
            else "cpu"
        )

        print(f"Using device: {self.device}")

        # Create model
        self.model = self._create_model()

        # Create datasets
        self.train_loader, self.val_loader = self._create_dataloaders()

        # Create optimizer and scheduler
        self.optimizer = self._create_optimizer()
        self.scheduler = self._create_scheduler()

        # Loss functions
        self.criterion_classification = nn.CrossEntropyLoss()
        self.criterion_confidence = nn.BCELoss()

        # Setup logging
        self.writer = SummaryWriter(config.get("log_dir", "runs/button_detector"))
        self.checkpoint_dir = Path(config.get("checkpoint_dir", "checkpoints"))
        self.checkpoint_dir.mkdir(exist_ok=True, parents=True)

        # Training state
        self.start_epoch = 0
        self.best_val_loss = float("inf")
        self.global_step = 0

    def _create_model(self):
        """Create model based on configuration"""
        model_type = self.config.get("model", "mobilenet_v3")

        if model_type in ["mobilenet_v3", "efficientnet_b0", "custom"]:
            # CNN-based models
            model = create_button_cnn(
                {
                    "architecture": model_type,
                    "num_button_types": self.config.get("num_classes", 4),
                    "pretrained": self.config.get("pretrained", True),
                    "dropout": self.config.get("dropout", 0.3),
                }
            )
            model = model.to(self.device)

            # Freeze backbone if specified
            if self.config.get("freeze_backbone", False):
                model.freeze_backbone()

            return model

        elif model_type in ["yolov8", "yolov5"]:
            # YOLO-based models
            model_size = self.config.get("model_size", "n")
            return create_button_yolo(
                {
                    "model_type": model_type,
                    "model_size": model_size,
                    "num_classes": self.config.get("num_classes", 4),
                    "pretrained": self.config.get("pretrained", True),
                    "device": str(self.device),
                }
            )

        else:
            raise ValueError(f"Unknown model type: {model_type}")

    def _create_dataloaders(self) -> Tuple[DataLoader, DataLoader]:
        """Create training and validation dataloaders"""
        # Determine mode based on model type
        model_type = self.config.get("model", "mobilenet_v3")
        mode = "detection" if model_type in ["yolov8", "yolov5"] else "classification"

        # Create datasets
        train_dataset = COCOButtonDataset(
            root_dir=self.config["data_root"],
            annotation_file=self.config["train_annotations"],
            mode=mode,
            img_size=self.config.get("img_size", 224),
        )

        val_dataset = COCOButtonDataset(
            root_dir=self.config["data_root"],
            annotation_file=self.config["val_annotations"],
            mode=mode,
            img_size=self.config.get("img_size", 224),
        )

        # Create dataloaders
        train_loader = DataLoader(
            train_dataset,
            batch_size=self.config.get("batch_size", 32),
            shuffle=True,
            num_workers=self.config.get("num_workers", 4),
            pin_memory=True,
        )

        val_loader = DataLoader(
            val_dataset,
            batch_size=self.config.get("batch_size", 32),
            shuffle=False,
            num_workers=self.config.get("num_workers", 4),
            pin_memory=True,
        )

        print(f"Train samples: {len(train_dataset)}, Val samples: {len(val_dataset)}")

        return train_loader, val_loader

    def _create_optimizer(self) -> optim.Optimizer:
        """Create optimizer"""
        optimizer_name = self.config.get("optimizer", "adam").lower()
        lr = self.config.get("lr", 0.001)
        weight_decay = self.config.get("weight_decay", 1e-5)

        if isinstance(self.model, ButtonCNN):
            params = self.model.parameters()
        else:
            # For YOLO models, this will be handled differently
            return None

        if optimizer_name == "adam":
            return optim.Adam(params, lr=lr, weight_decay=weight_decay)
        elif optimizer_name == "adamw":
            return optim.AdamW(params, lr=lr, weight_decay=weight_decay)
        elif optimizer_name == "sgd":
            momentum = self.config.get("momentum", 0.9)
            return optim.SGD(
                params, lr=lr, momentum=momentum, weight_decay=weight_decay
            )
        else:
            raise ValueError(f"Unknown optimizer: {optimizer_name}")

    def _create_scheduler(self):
        """Create learning rate scheduler"""
        if not isinstance(self.model, ButtonCNN):
            return None

        scheduler_name = self.config.get("scheduler", "cosine")

        if scheduler_name == "cosine":
            return optim.lr_scheduler.CosineAnnealingLR(
                self.optimizer, T_max=self.config.get("epochs", 50)
            )
        elif scheduler_name == "step":
            return optim.lr_scheduler.StepLR(
                self.optimizer,
                step_size=self.config.get("step_size", 10),
                gamma=self.config.get("gamma", 0.1),
            )
        elif scheduler_name == "plateau":
            return optim.lr_scheduler.ReduceLROnPlateau(
                self.optimizer,
                mode="min",
                patience=self.config.get("patience", 5),
                factor=self.config.get("factor", 0.5),
            )
        else:
            return None

    def train_epoch(self, epoch: int) -> Dict[str, float]:
        """Train for one epoch"""
        self.model.train()

        total_loss = 0.0
        total_is_button_loss = 0.0
        total_button_type_loss = 0.0
        total_confidence_loss = 0.0

        for batch_idx, (images, targets) in enumerate(self.train_loader):
            images = images.to(self.device)

            # Forward pass
            self.optimizer.zero_grad()
            outputs = self.model(images)

            # Calculate losses
            is_button_loss = self.criterion_classification(
                outputs["is_button"], targets["is_button"].to(self.device)
            )

            button_type_loss = self.criterion_classification(
                outputs["button_type"], targets["button_type"].to(self.device)
            )

            # Confidence loss (should be high for correct predictions)
            confidence_target = torch.ones_like(outputs["confidence"])
            confidence_loss = self.criterion_confidence(
                outputs["confidence"], confidence_target.to(self.device)
            )

            # Combined loss
            loss = is_button_loss + button_type_loss + 0.1 * confidence_loss

            # Backward pass
            loss.backward()
            self.optimizer.step()

            # Accumulate metrics
            total_loss += loss.item()
            total_is_button_loss += is_button_loss.item()
            total_button_type_loss += button_type_loss.item()
            total_confidence_loss += confidence_loss.item()

            # Logging
            if batch_idx % self.config.get("log_interval", 10) == 0:
                self.writer.add_scalar(
                    "train/batch_loss", loss.item(), self.global_step
                )
                self.global_step += 1

            # Print progress
            if batch_idx % self.config.get("print_interval", 50) == 0:
                print(
                    f"Epoch {epoch} [{batch_idx}/{len(self.train_loader)}] "
                    f"Loss: {loss.item():.4f}"
                )

        # Average metrics
        num_batches = len(self.train_loader)
        return {
            "loss": total_loss / num_batches,
            "is_button_loss": total_is_button_loss / num_batches,
            "button_type_loss": total_button_type_loss / num_batches,
            "confidence_loss": total_confidence_loss / num_batches,
        }

    @torch.no_grad()
    def validate(self, epoch: int) -> Dict[str, float]:
        """Validate model"""
        self.model.eval()

        total_loss = 0.0
        total_is_button_loss = 0.0
        total_button_type_loss = 0.0
        correct_is_button = 0
        correct_button_type = 0
        total_samples = 0

        for images, targets in self.val_loader:
            images = images.to(self.device)

            # Forward pass
            outputs = self.model(images)

            # Calculate losses
            is_button_loss = self.criterion_classification(
                outputs["is_button"], targets["is_button"].to(self.device)
            )

            button_type_loss = self.criterion_classification(
                outputs["button_type"], targets["button_type"].to(self.device)
            )

            loss = is_button_loss + button_type_loss

            # Accumulate metrics
            total_loss += loss.item()
            total_is_button_loss += is_button_loss.item()
            total_button_type_loss += button_type_loss.item()

            # Calculate accuracy
            _, is_button_pred = outputs["is_button"].max(1)
            _, button_type_pred = outputs["button_type"].max(1)

            correct_is_button += (
                is_button_pred.eq(targets["is_button"].to(self.device)).sum().item()
            )
            correct_button_type += (
                button_type_pred.eq(targets["button_type"].to(self.device)).sum().item()
            )
            total_samples += images.size(0)

        # Average metrics
        num_batches = len(self.val_loader)
        return {
            "loss": total_loss / num_batches,
            "is_button_loss": total_is_button_loss / num_batches,
            "button_type_loss": total_button_type_loss / num_batches,
            "is_button_accuracy": 100.0 * correct_is_button / total_samples,
            "button_type_accuracy": 100.0 * correct_button_type / total_samples,
        }

    def save_checkpoint(self, epoch: int, is_best: bool = False):
        """Save model checkpoint"""
        checkpoint = {
            "epoch": epoch,
            "model_state_dict": self.model.state_dict(),
            "optimizer_state_dict": self.optimizer.state_dict(),
            "best_val_loss": self.best_val_loss,
            "config": self.config,
        }

        # Save latest checkpoint
        checkpoint_path = self.checkpoint_dir / "latest.pt"
        torch.save(checkpoint, checkpoint_path)

        # Save best checkpoint
        if is_best:
            best_path = self.checkpoint_dir / "best.pt"
            torch.save(checkpoint, best_path)
            print(f"Saved best checkpoint: {best_path}")

        # Save epoch checkpoint
        if epoch % self.config.get("save_interval", 10) == 0:
            epoch_path = self.checkpoint_dir / f"epoch_{epoch}.pt"
            torch.save(checkpoint, epoch_path)

    def train(self):
        """Main training loop"""
        print(f"\nStarting training for {self.config.get('epochs', 50)} epochs...")
        print(f"Model: {self.config.get('model', 'mobilenet_v3')}")
        print(f"Device: {self.device}\n")

        # Check if using YOLO
        if isinstance(self.model, ButtonYOLO):
            print("Using YOLO model - delegating to YOLO training pipeline...")
            # For YOLO, use built-in training
            data_yaml = self.config.get("data_yaml", "data.yaml")
            self.model.train(
                data_yaml=data_yaml,
                epochs=self.config.get("epochs", 50),
                batch_size=self.config.get("batch_size", 16),
                img_size=self.config.get("img_size", 640),
            )
            return

        # Train CNN models
        for epoch in range(self.start_epoch, self.config.get("epochs", 50)):
            # Train
            train_metrics = self.train_epoch(epoch)

            # Validate
            val_metrics = self.validate(epoch)

            # Log metrics
            self.writer.add_scalar("train/loss", train_metrics["loss"], epoch)
            self.writer.add_scalar("val/loss", val_metrics["loss"], epoch)
            self.writer.add_scalar(
                "val/is_button_accuracy", val_metrics["is_button_accuracy"], epoch
            )
            self.writer.add_scalar(
                "val/button_type_accuracy", val_metrics["button_type_accuracy"], epoch
            )

            # Print epoch summary
            print(f"\nEpoch {epoch}:")
            print(f"  Train Loss: {train_metrics['loss']:.4f}")
            print(f"  Val Loss: {val_metrics['loss']:.4f}")
            print(f"  Val Is-Button Acc: {val_metrics['is_button_accuracy']:.2f}%")
            print(f"  Val Button-Type Acc: {val_metrics['button_type_accuracy']:.2f}%")

            # Learning rate scheduler
            if self.scheduler:
                if isinstance(self.scheduler, optim.lr_scheduler.ReduceLROnPlateau):
                    self.scheduler.step(val_metrics["loss"])
                else:
                    self.scheduler.step()

            # Save checkpoint
            is_best = val_metrics["loss"] < self.best_val_loss
            if is_best:
                self.best_val_loss = val_metrics["loss"]

            self.save_checkpoint(epoch, is_best)

        print("\nTraining completed!")
        print(f"Best validation loss: {self.best_val_loss:.4f}")

        self.writer.close()


def load_config(config_path: str) -> Dict[str, Any]:
    """Load configuration from YAML file"""
    with open(config_path, "r") as f:
        config = yaml.safe_load(f)
    return config


def main():
    parser = argparse.ArgumentParser(description="Train Button Detector")
    parser.add_argument("--config", type=str, help="Path to config YAML file")
    parser.add_argument(
        "--model",
        type=str,
        default="mobilenet_v3",
        choices=["mobilenet_v3", "efficientnet_b0", "custom", "yolov8", "yolov5"],
        help="Model architecture",
    )
    parser.add_argument("--epochs", type=int, default=50, help="Number of epochs")
    parser.add_argument("--batch-size", type=int, default=32, help="Batch size")
    parser.add_argument("--lr", type=float, default=0.001, help="Learning rate")
    parser.add_argument("--data-root", type=str, help="Path to image root directory")
    parser.add_argument(
        "--train-annotations", type=str, help="Path to training annotations"
    )
    parser.add_argument(
        "--val-annotations", type=str, help="Path to validation annotations"
    )
    parser.add_argument(
        "--checkpoint-dir", type=str, default="checkpoints", help="Checkpoint directory"
    )
    parser.add_argument(
        "--pretrained", action="store_true", help="Use pretrained weights"
    )
    parser.add_argument(
        "--num-classes", type=int, default=4, help="Number of button classes"
    )

    args = parser.parse_args()

    # Load config from file if provided, otherwise use command line args
    if args.config:
        config = load_config(args.config)
    else:
        config = {
            "model": args.model,
            "epochs": args.epochs,
            "batch_size": args.batch_size,
            "lr": args.lr,
            "data_root": args.data_root,
            "train_annotations": args.train_annotations,
            "val_annotations": args.val_annotations,
            "checkpoint_dir": args.checkpoint_dir,
            "pretrained": args.pretrained,
            "num_classes": args.num_classes,
            "optimizer": "adam",
            "scheduler": "cosine",
            "use_gpu": True,
        }

    # Validate required fields
    required_fields = ["data_root", "train_annotations", "val_annotations"]
    for field in required_fields:
        if not config.get(field):
            raise ValueError(f"Missing required configuration: {field}")

    # Create trainer and start training
    trainer = ButtonDetectorTrainer(config)
    trainer.train()


if __name__ == "__main__":
    main()
