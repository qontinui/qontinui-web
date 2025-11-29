"""
Custom CNN Architecture for Button Classification

Lightweight model (< 5M parameters) for button detection and classification.
Supports pretrained backbones from ImageNet.
"""

from typing import Any

import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision import models


class ConvBlock(nn.Module):
    """Convolutional block with BatchNorm and ReLU"""

    def __init__(
        self,
        in_channels: int,
        out_channels: int,
        kernel_size: int = 3,
        stride: int = 1,
        padding: int = 1,
    ):
        super().__init__()
        self.conv = nn.Conv2d(
            in_channels,
            out_channels,
            kernel_size,
            stride=stride,
            padding=padding,
            bias=False,
        )
        self.bn = nn.BatchNorm2d(out_channels)
        self.relu = nn.ReLU(inplace=True)

    def forward(self, x):
        return self.relu(self.bn(self.conv(x)))


class ButtonCNN(nn.Module):
    """
    Custom CNN for button classification

    Input: (B, 3, 224, 224) - RGB image regions
    Output:
        - is_button: (B, 2) - binary classification logits
        - button_type: (B, num_classes) - button type logits
        - confidence: (B, 1) - confidence score

    Architecture options:
        - 'custom': Lightweight custom CNN (< 5M params)
        - 'mobilenet_v3': MobileNetV3-Small (pretrained available)
        - 'efficientnet_b0': EfficientNet-B0 (pretrained available)
    """

    def __init__(
        self,
        num_button_types: int = 4,  # primary, secondary, icon, text
        architecture: str = "custom",
        pretrained: bool = True,
        dropout: float = 0.3,
    ):
        """
        Initialize ButtonCNN

        Args:
            num_button_types: Number of button type classes
            architecture: Model architecture ('custom', 'mobilenet_v3', 'efficientnet_b0')
            pretrained: Use pretrained ImageNet weights (for backbone)
            dropout: Dropout rate for regularization
        """
        super().__init__()

        self.num_button_types = num_button_types
        self.architecture = architecture

        if architecture == "custom":
            self._build_custom_architecture(dropout)
        elif architecture == "mobilenet_v3":
            self._build_mobilenet_architecture(pretrained, dropout)
        elif architecture == "efficientnet_b0":
            self._build_efficientnet_architecture(pretrained, dropout)
        else:
            raise ValueError(f"Unknown architecture: {architecture}")

    def _build_custom_architecture(self, dropout: float):
        """Build lightweight custom CNN architecture"""
        # Feature extractor - 4 conv blocks
        self.features = nn.Sequential(
            ConvBlock(3, 32, kernel_size=3, stride=2, padding=1),  # 112x112
            ConvBlock(32, 64, kernel_size=3, stride=2, padding=1),  # 56x56
            ConvBlock(64, 128, kernel_size=3, stride=2, padding=1),  # 28x28
            ConvBlock(128, 256, kernel_size=3, stride=2, padding=1),  # 14x14
            nn.AdaptiveAvgPool2d((1, 1)),  # Global pooling
        )

        feature_dim = 256

        # Multi-head outputs
        self.is_button_head = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(feature_dim, 128),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout),
            nn.Linear(128, 2),  # Binary: [not_button, is_button]
        )

        self.button_type_head = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(feature_dim, 128),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout),
            nn.Linear(128, self.num_button_types),
        )

        self.confidence_head = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(feature_dim, 64),
            nn.ReLU(inplace=True),
            nn.Linear(64, 1),
            nn.Sigmoid(),  # Confidence between 0 and 1
        )

    def _build_mobilenet_architecture(self, pretrained: bool, dropout: float):
        """Build MobileNetV3-based architecture"""
        # Load pretrained MobileNetV3-Small
        if pretrained:
            weights = models.MobileNet_V3_Small_Weights.IMAGENET1K_V1
            backbone = models.mobilenet_v3_small(weights=weights)
        else:
            backbone = models.mobilenet_v3_small(weights=None)

        # Use backbone as feature extractor
        self.features = backbone.features
        self.avgpool = backbone.avgpool

        feature_dim = 576  # MobileNetV3-Small output

        # Multi-head outputs
        self.is_button_head = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(feature_dim, 128),
            nn.Hardswish(inplace=True),
            nn.Dropout(dropout),
            nn.Linear(128, 2),
        )

        self.button_type_head = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(feature_dim, 128),
            nn.Hardswish(inplace=True),
            nn.Dropout(dropout),
            nn.Linear(128, self.num_button_types),
        )

        self.confidence_head = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(feature_dim, 64),
            nn.Hardswish(inplace=True),
            nn.Linear(64, 1),
            nn.Sigmoid(),
        )

    def _build_efficientnet_architecture(self, pretrained: bool, dropout: float):
        """Build EfficientNet-based architecture"""
        # Load pretrained EfficientNet-B0
        if pretrained:
            weights = models.EfficientNet_B0_Weights.IMAGENET1K_V1
            backbone = models.efficientnet_b0(weights=weights)
        else:
            backbone = models.efficientnet_b0(weights=None)

        # Use backbone as feature extractor
        self.features = backbone.features
        self.avgpool = backbone.avgpool

        feature_dim = 1280  # EfficientNet-B0 output

        # Multi-head outputs
        self.is_button_head = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(feature_dim, 256),
            nn.SiLU(inplace=True),
            nn.Dropout(dropout),
            nn.Linear(256, 2),
        )

        self.button_type_head = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(feature_dim, 256),
            nn.SiLU(inplace=True),
            nn.Dropout(dropout),
            nn.Linear(256, self.num_button_types),
        )

        self.confidence_head = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(feature_dim, 128),
            nn.SiLU(inplace=True),
            nn.Linear(128, 1),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> dict[str, torch.Tensor]:
        """
        Forward pass

        Args:
            x: Input tensor (B, 3, 224, 224)

        Returns:
            Dictionary with keys:
                - 'is_button': (B, 2) logits
                - 'button_type': (B, num_classes) logits
                - 'confidence': (B, 1) confidence scores
        """
        # Extract features
        features = self.features(x)

        # Global pooling if not already done
        if self.architecture == "custom":
            features = features.view(features.size(0), -1)
        else:
            features = self.avgpool(features)
            features = torch.flatten(features, 1)

        # Multi-head outputs
        is_button = self.is_button_head(features)
        button_type = self.button_type_head(features)
        confidence = self.confidence_head(features)

        return {
            "is_button": is_button,
            "button_type": button_type,
            "confidence": confidence,
        }

    def predict(self, x: torch.Tensor, threshold: float = 0.5) -> dict[str, Any]:
        """
        Make predictions with post-processing

        Args:
            x: Input tensor (B, 3, 224, 224)
            threshold: Confidence threshold for button detection

        Returns:
            Dictionary with:
                - 'is_button': (B,) boolean tensor
                - 'button_type': (B,) class indices
                - 'confidence': (B,) confidence scores
                - 'button_type_probs': (B, num_classes) probabilities
        """
        with torch.no_grad():
            outputs = self.forward(x)

            # Process is_button predictions
            is_button_probs = F.softmax(outputs["is_button"], dim=1)
            is_button = is_button_probs[:, 1] > threshold  # Index 1 is "is_button"

            # Process button_type predictions
            button_type_probs = F.softmax(outputs["button_type"], dim=1)
            button_type = torch.argmax(button_type_probs, dim=1)

            # Get confidence scores
            confidence = outputs["confidence"].squeeze(1)

            return {
                "is_button": is_button,
                "button_type": button_type,
                "confidence": confidence,
                "button_type_probs": button_type_probs,
            }

    def count_parameters(self) -> int:
        """Count trainable parameters"""
        return sum(p.numel() for p in self.parameters() if p.requires_grad)

    def freeze_backbone(self):
        """Freeze feature extractor for transfer learning"""
        for param in self.features.parameters():
            param.requires_grad = False

    def unfreeze_backbone(self):
        """Unfreeze feature extractor"""
        for param in self.features.parameters():
            param.requires_grad = True


def create_button_cnn(config: dict[str, Any]) -> ButtonCNN:
    """
    Factory function to create ButtonCNN from configuration

    Args:
        config: Configuration dictionary with keys:
            - architecture: Model architecture
            - num_button_types: Number of button classes
            - pretrained: Use pretrained weights
            - dropout: Dropout rate

    Returns:
        ButtonCNN instance
    """
    model = ButtonCNN(
        num_button_types=config.get("num_button_types", 4),
        architecture=config.get("architecture", "custom"),
        pretrained=config.get("pretrained", True),
        dropout=config.get("dropout", 0.3),
    )

    print(f"Created ButtonCNN with {model.count_parameters():,} parameters")

    return model


if __name__ == "__main__":
    # Test model creation and forward pass
    print("Testing ButtonCNN architectures...\n")

    for arch in ["custom", "mobilenet_v3", "efficientnet_b0"]:
        print(f"Architecture: {arch}")
        model = create_button_cnn(
            {
                "architecture": arch,
                "num_button_types": 4,
                "pretrained": False,  # Don't download weights for testing
                "dropout": 0.3,
            }
        )

        # Test forward pass
        dummy_input = torch.randn(2, 3, 224, 224)
        outputs = model(dummy_input)

        print(f"  is_button shape: {outputs['is_button'].shape}")
        print(f"  button_type shape: {outputs['button_type'].shape}")
        print(f"  confidence shape: {outputs['confidence'].shape}")

        # Test predict
        predictions = model.predict(dummy_input)
        print(f"  Predictions: {predictions['is_button']}")
        print()
