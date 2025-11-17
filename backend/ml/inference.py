"""
Model Inference Wrapper for Button Detection

Provides unified interface for running inference with trained models.
Supports batch processing, preprocessing, and post-processing.
"""

import torch
import numpy as np
from PIL import Image
from pathlib import Path
from typing import List, Dict, Any, Union, Optional, Tuple
import cv2

from models.button_cnn import ButtonCNN
from models.button_yolo import ButtonYOLO


class ButtonDetectorInference:
    """
    Unified inference interface for button detection models

    Supports:
        - CNN-based classification models
        - YOLO-based detection models
        - Batch inference
        - GPU/CPU inference
        - Preprocessing pipeline
        - Post-processing (NMS, confidence filtering)
    """

    def __init__(self,
                 model_path: str,
                 model_type: str = 'mobilenet_v3',
                 device: str = 'auto',
                 confidence_threshold: float = 0.5,
                 nms_threshold: float = 0.45):
        """
        Initialize inference engine

        Args:
            model_path: Path to trained model checkpoint
            model_type: Model architecture type
            device: Device to use ('auto', 'cpu', 'cuda')
            confidence_threshold: Confidence threshold for detections
            nms_threshold: IoU threshold for NMS
        """
        self.model_path = Path(model_path)
        self.model_type = model_type
        self.confidence_threshold = confidence_threshold
        self.nms_threshold = nms_threshold

        # Determine device
        if device == 'auto':
            self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        else:
            self.device = torch.device(device)

        print(f"Inference device: {self.device}")

        # Load model
        self.model = self._load_model()
        self.model.eval()

        # Class names
        self.class_names = [
            'primary_button',
            'secondary_button',
            'icon_button',
            'text_button'
        ]

    def _load_model(self):
        """Load trained model from checkpoint"""
        if self.model_type in ['yolov8', 'yolov5']:
            # Load YOLO model
            from models.button_yolo import ButtonYOLO
            model = ButtonYOLO(
                model_type=self.model_type,
                model_size='n',  # Will be overridden by checkpoint
                num_classes=4,
                pretrained=False,
                device=str(self.device)
            )
            model.load(str(self.model_path))
            return model

        else:
            # Load CNN model
            checkpoint = torch.load(self.model_path, map_location=self.device)

            # Get model config from checkpoint
            config = checkpoint.get('config', {})

            from models.button_cnn import create_button_cnn
            model = create_button_cnn({
                'architecture': self.model_type,
                'num_button_types': config.get('num_classes', 4),
                'pretrained': False,
                'dropout': config.get('dropout', 0.3)
            })

            # Load state dict
            model.load_state_dict(checkpoint['model_state_dict'])
            model = model.to(self.device)

            return model

    def preprocess_image(self,
                        image: Union[str, Path, Image.Image, np.ndarray],
                        target_size: Tuple[int, int] = (224, 224)) -> torch.Tensor:
        """
        Preprocess image for inference

        Args:
            image: Input image (path, PIL Image, or numpy array)
            target_size: Target size for resizing

        Returns:
            Preprocessed image tensor
        """
        # Load image if path
        if isinstance(image, (str, Path)):
            image = Image.open(image).convert('RGB')
        elif isinstance(image, np.ndarray):
            image = Image.fromarray(image).convert('RGB')

        # Resize
        image = image.resize(target_size)

        # Convert to tensor and normalize
        image_np = np.array(image)
        image_tensor = torch.from_numpy(image_np).permute(2, 0, 1).float() / 255.0

        # Add batch dimension
        image_tensor = image_tensor.unsqueeze(0)

        return image_tensor

    def preprocess_region(self,
                         image: np.ndarray,
                         bbox: List[int],
                         target_size: Tuple[int, int] = (224, 224)) -> torch.Tensor:
        """
        Extract and preprocess image region

        Args:
            image: Full image as numpy array
            bbox: Bounding box [x, y, width, height]
            target_size: Target size for resizing

        Returns:
            Preprocessed region tensor
        """
        x, y, w, h = bbox

        # Ensure coordinates are within image bounds
        height, width = image.shape[:2]
        x = max(0, min(x, width - 1))
        y = max(0, min(y, height - 1))
        w = max(1, min(w, width - x))
        h = max(1, min(h, height - y))

        # Extract region
        region = image[y:y+h, x:x+w]

        # Convert to PIL Image for easier processing
        region_pil = Image.fromarray(region)

        return self.preprocess_image(region_pil, target_size)

    @torch.no_grad()
    def predict_classification(self,
                              image: Union[str, Path, Image.Image, np.ndarray, torch.Tensor]
                              ) -> Dict[str, Any]:
        """
        Run classification inference on single image/region

        Args:
            image: Input image

        Returns:
            Prediction dictionary with keys:
                - is_button: boolean
                - button_type: class name
                - button_type_id: class index
                - confidence: confidence score
                - probabilities: class probabilities
        """
        # Preprocess
        if not isinstance(image, torch.Tensor):
            image_tensor = self.preprocess_image(image)
        else:
            image_tensor = image

        image_tensor = image_tensor.to(self.device)

        # Inference
        predictions = self.model.predict(image_tensor, threshold=self.confidence_threshold)

        # Extract results
        is_button = predictions['is_button'][0].item()
        button_type_id = predictions['button_type'][0].item()
        confidence = predictions['confidence'][0].item()
        button_type_probs = predictions['button_type_probs'][0].cpu().numpy()

        return {
            'is_button': bool(is_button),
            'button_type': self.class_names[button_type_id] if button_type_id < len(self.class_names) else f'class_{button_type_id}',
            'button_type_id': int(button_type_id),
            'confidence': float(confidence),
            'probabilities': button_type_probs.tolist()
        }

    @torch.no_grad()
    def predict_detection(self,
                         image: Union[str, Path, Image.Image, np.ndarray]
                         ) -> List[Dict[str, Any]]:
        """
        Run detection inference on full image (YOLO)

        Args:
            image: Input image

        Returns:
            List of detections, each with:
                - bbox: [x, y, width, height]
                - confidence: confidence score
                - class_id: class index
                - class_name: class name
        """
        if isinstance(self.model, ButtonYOLO):
            # Use YOLO inference
            detections = self.model.predict(
                image,
                conf_threshold=self.confidence_threshold,
                iou_threshold=self.nms_threshold
            )
            return detections[0] if detections else []
        else:
            raise ValueError("Detection mode requires YOLO model")

    def predict_regions(self,
                       image: np.ndarray,
                       regions: List[List[int]]) -> List[Dict[str, Any]]:
        """
        Predict button types for multiple regions in an image

        Args:
            image: Full image as numpy array
            regions: List of bounding boxes [x, y, width, height]

        Returns:
            List of predictions for each region
        """
        predictions = []

        for bbox in regions:
            # Preprocess region
            region_tensor = self.preprocess_region(image, bbox)
            region_tensor = region_tensor.to(self.device)

            # Predict
            pred = self.model.predict(region_tensor, threshold=self.confidence_threshold)

            # Extract results
            is_button = pred['is_button'][0].item()
            button_type_id = pred['button_type'][0].item()
            confidence = pred['confidence'][0].item()

            predictions.append({
                'bbox': bbox,
                'is_button': bool(is_button),
                'button_type': self.class_names[button_type_id] if button_type_id < len(self.class_names) else f'class_{button_type_id}',
                'button_type_id': int(button_type_id),
                'confidence': float(confidence)
            })

        return predictions

    def predict_batch(self,
                     images: List[Union[str, Path, Image.Image, np.ndarray]],
                     batch_size: int = 32) -> List[Dict[str, Any]]:
        """
        Run batch inference on multiple images

        Args:
            images: List of input images
            batch_size: Batch size for processing

        Returns:
            List of predictions
        """
        all_predictions = []

        # Process in batches
        for i in range(0, len(images), batch_size):
            batch = images[i:i + batch_size]

            # Preprocess batch
            batch_tensors = []
            for img in batch:
                tensor = self.preprocess_image(img)
                batch_tensors.append(tensor)

            # Stack into batch
            batch_tensor = torch.cat(batch_tensors, dim=0).to(self.device)

            # Inference
            predictions = self.model.predict(batch_tensor, threshold=self.confidence_threshold)

            # Extract results
            for j in range(len(batch)):
                is_button = predictions['is_button'][j].item()
                button_type_id = predictions['button_type'][j].item()
                confidence = predictions['confidence'][j].item()

                all_predictions.append({
                    'is_button': bool(is_button),
                    'button_type': self.class_names[button_type_id] if button_type_id < len(self.class_names) else f'class_{button_type_id}',
                    'button_type_id': int(button_type_id),
                    'confidence': float(confidence)
                })

        return all_predictions

    def apply_nms(self,
                 detections: List[Dict[str, Any]],
                 iou_threshold: float = None) -> List[Dict[str, Any]]:
        """
        Apply Non-Maximum Suppression to detections

        Args:
            detections: List of detections with 'bbox' and 'confidence'
            iou_threshold: IoU threshold (uses self.nms_threshold if None)

        Returns:
            Filtered detections after NMS
        """
        if not detections:
            return []

        if iou_threshold is None:
            iou_threshold = self.nms_threshold

        # Convert to numpy arrays
        boxes = np.array([d['bbox'] for d in detections])  # [x, y, w, h]
        scores = np.array([d['confidence'] for d in detections])

        # Convert [x, y, w, h] to [x1, y1, x2, y2]
        x1 = boxes[:, 0]
        y1 = boxes[:, 1]
        x2 = boxes[:, 0] + boxes[:, 2]
        y2 = boxes[:, 1] + boxes[:, 3]

        areas = (x2 - x1) * (y2 - y1)
        order = scores.argsort()[::-1]

        keep = []
        while order.size > 0:
            i = order[0]
            keep.append(i)

            # Calculate IoU with remaining boxes
            xx1 = np.maximum(x1[i], x1[order[1:]])
            yy1 = np.maximum(y1[i], y1[order[1:]])
            xx2 = np.minimum(x2[i], x2[order[1:]])
            yy2 = np.minimum(y2[i], y2[order[1:]])

            w = np.maximum(0, xx2 - xx1)
            h = np.maximum(0, yy2 - yy1)
            intersection = w * h

            iou = intersection / (areas[i] + areas[order[1:]] - intersection)

            # Keep only boxes with IoU below threshold
            inds = np.where(iou <= iou_threshold)[0]
            order = order[inds + 1]

        return [detections[i] for i in keep]

    def visualize_predictions(self,
                            image: np.ndarray,
                            predictions: List[Dict[str, Any]],
                            save_path: Optional[str] = None) -> np.ndarray:
        """
        Visualize predictions on image

        Args:
            image: Input image
            predictions: List of predictions with 'bbox', 'confidence', 'button_type'
            save_path: Optional path to save visualization

        Returns:
            Image with visualizations
        """
        vis_image = image.copy()

        for pred in predictions:
            if not pred.get('is_button', True):
                continue

            bbox = pred['bbox']
            x, y, w, h = bbox
            confidence = pred['confidence']
            class_name = pred.get('button_type', 'button')

            # Draw bounding box
            color = (0, 255, 0)  # Green
            cv2.rectangle(vis_image, (x, y), (x + w, y + h), color, 2)

            # Draw label
            label = f"{class_name}: {confidence:.2f}"
            font = cv2.FONT_HERSHEY_SIMPLEX
            font_scale = 0.5
            thickness = 1

            # Get text size
            (text_w, text_h), _ = cv2.getTextSize(label, font, font_scale, thickness)

            # Draw background for text
            cv2.rectangle(vis_image, (x, y - text_h - 5), (x + text_w, y), color, -1)

            # Draw text
            cv2.putText(vis_image, label, (x, y - 5), font, font_scale, (0, 0, 0), thickness)

        # Save if path provided
        if save_path:
            cv2.imwrite(save_path, cv2.cvtColor(vis_image, cv2.COLOR_RGB2BGR))

        return vis_image


def create_inference_engine(model_path: str,
                           model_type: str = 'mobilenet_v3',
                           **kwargs) -> ButtonDetectorInference:
    """
    Factory function to create inference engine

    Args:
        model_path: Path to trained model
        model_type: Model architecture type
        **kwargs: Additional configuration

    Returns:
        ButtonDetectorInference instance
    """
    return ButtonDetectorInference(
        model_path=model_path,
        model_type=model_type,
        **kwargs
    )


if __name__ == "__main__":
    # Example usage
    print("Button Detector Inference Example\n")

    # Create inference engine
    # Note: This requires a trained model checkpoint
    try:
        model_path = "checkpoints/best.pt"
        inference = create_inference_engine(
            model_path=model_path,
            model_type='mobilenet_v3',
            confidence_threshold=0.5
        )

        print("Inference engine created successfully!")
        print(f"Device: {inference.device}")
        print(f"Model type: {inference.model_type}")

    except FileNotFoundError:
        print(f"Model checkpoint not found. Train a model first using train_button_detector.py")
