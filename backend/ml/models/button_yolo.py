"""
YOLO-based Button Detector

Fine-tuned YOLOv8 or YOLOv5 for button detection and classification.
Supports multi-class detection and ONNX export for fast inference.
"""

from typing import Any

import torch


class ButtonYOLO:
    """
    YOLO-based button detector wrapper

    Supports:
        - YOLOv8 (ultralytics)
        - YOLOv5 (torch hub)
        - Multi-class detection (primary_button, secondary_button, icon_button, text_button)
        - NMS post-processing
        - ONNX export for fast inference
    """

    def __init__(
        self,
        model_type: str = "yolov8",
        model_size: str = "n",  # n, s, m, l, x
        num_classes: int = 4,
        pretrained: bool = True,
        device: str = "auto",
    ):
        """
        Initialize ButtonYOLO

        Args:
            model_type: YOLO version ('yolov8', 'yolov5')
            model_size: Model size ('n', 's', 'm', 'l', 'x')
            num_classes: Number of button classes
            pretrained: Use pretrained COCO weights
            device: Device to use ('auto', 'cpu', 'cuda')
        """
        self.model_type = model_type
        self.model_size = model_size
        self.num_classes = num_classes

        # Determine device
        if device == "auto":
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
        else:
            self.device = device

        # Class names for button types
        self.class_names = [
            "primary_button",
            "secondary_button",
            "icon_button",
            "text_button",
        ][:num_classes]

        # Load model
        self.model = self._load_model(pretrained)

    def _load_model(self, pretrained: bool):
        """Load YOLO model"""
        if self.model_type == "yolov8":
            return self._load_yolov8(pretrained)
        elif self.model_type == "yolov5":
            return self._load_yolov5(pretrained)
        else:
            raise ValueError(f"Unknown model type: {self.model_type}")

    def _load_yolov8(self, pretrained: bool):
        """Load YOLOv8 model"""
        try:
            from ultralytics import YOLO

            if pretrained:
                # Load pretrained model
                model_name = f"yolov8{self.model_size}.pt"
                model = YOLO(model_name)
            else:
                # Load architecture only
                model_name = f"yolov8{self.model_size}.yaml"
                model = YOLO(model_name)

            # Modify for custom number of classes
            # This will be done during training with data.yaml
            return model

        except ImportError:
            raise ImportError(
                "ultralytics package required for YOLOv8. "
                "Install with: pip install ultralytics"
            )

    def _load_yolov5(self, pretrained: bool):
        """Load YOLOv5 model from torch hub"""
        try:
            if pretrained:
                model = torch.hub.load(
                    "ultralytics/yolov5", f"yolov5{self.model_size}", pretrained=True
                )
            else:
                model = torch.hub.load(
                    "ultralytics/yolov5", f"yolov5{self.model_size}", pretrained=False
                )

            # Set number of classes
            model.model[-1].nc = self.num_classes  # Modify detection head
            model.names = self.class_names

            return model.to(self.device)

        except Exception as e:
            raise RuntimeError(f"Failed to load YOLOv5: {e}")

    def train(
        self,
        data_yaml: str,
        epochs: int = 50,
        batch_size: int = 16,
        img_size: int = 640,
        **kwargs,
    ) -> dict[str, Any]:
        """
        Train the YOLO model

        Args:
            data_yaml: Path to data configuration YAML
            epochs: Number of training epochs
            batch_size: Batch size
            img_size: Input image size
            **kwargs: Additional training arguments

        Returns:
            Training results dictionary
        """
        if self.model_type == "yolov8":
            return self._train_yolov8(data_yaml, epochs, batch_size, img_size, **kwargs)
        elif self.model_type == "yolov5":
            return self._train_yolov5(data_yaml, epochs, batch_size, img_size, **kwargs)

    def _train_yolov8(
        self, data_yaml: str, epochs: int, batch_size: int, img_size: int, **kwargs
    ) -> dict[str, Any]:
        """Train YOLOv8 model"""
        results = self.model.train(
            data=data_yaml,
            epochs=epochs,
            batch=batch_size,
            imgsz=img_size,
            device=self.device,
            **kwargs,
        )
        return results

    def _train_yolov5(
        self, data_yaml: str, epochs: int, batch_size: int, img_size: int, **kwargs
    ) -> dict[str, Any]:
        """Train YOLOv5 model - requires custom training loop"""
        # Note: YOLOv5 training typically done via train.py script
        # This is a simplified version
        raise NotImplementedError(
            "YOLOv5 training should be done via the train.py script. "
            "Use YOLOv8 for integrated training or use external training script."
        )

    def predict(
        self,
        images: Any,
        conf_threshold: float = 0.25,
        iou_threshold: float = 0.45,
        max_det: int = 100,
    ) -> list[dict[str, Any]]:
        """
        Run inference on images

        Args:
            images: Input images (path, numpy array, PIL, tensor, list)
            conf_threshold: Confidence threshold
            iou_threshold: IoU threshold for NMS
            max_det: Maximum detections per image

        Returns:
            List of detection dictionaries per image
        """
        if self.model_type == "yolov8":
            return self._predict_yolov8(images, conf_threshold, iou_threshold, max_det)
        elif self.model_type == "yolov5":
            return self._predict_yolov5(images, conf_threshold, iou_threshold, max_det)

    def _predict_yolov8(
        self, images: Any, conf: float, iou: float, max_det: int
    ) -> list[dict[str, Any]]:
        """Run YOLOv8 inference"""
        results = self.model.predict(
            images,
            conf=conf,
            iou=iou,
            max_det=max_det,
            device=self.device,
            verbose=False,
        )

        detections = []
        for result in results:
            boxes = result.boxes
            image_detections = []

            if boxes is not None:
                for i in range(len(boxes)):
                    box = boxes.xyxy[i].cpu().numpy()  # x1, y1, x2, y2
                    conf_score = float(boxes.conf[i].cpu())
                    cls = int(boxes.cls[i].cpu())

                    detection = {
                        "bbox": [
                            float(box[0]),
                            float(box[1]),
                            float(box[2] - box[0]),
                            float(box[3] - box[1]),
                        ],  # x, y, w, h
                        "confidence": conf_score,
                        "class_id": cls,
                        "class_name": (
                            self.class_names[cls]
                            if cls < len(self.class_names)
                            else f"class_{cls}"
                        ),
                    }
                    image_detections.append(detection)

            detections.append(image_detections)

        return detections

    def _predict_yolov5(
        self, images: Any, conf: float, iou: float, max_det: int
    ) -> list[dict[str, Any]]:
        """Run YOLOv5 inference"""
        self.model.conf = conf
        self.model.iou = iou
        self.model.max_det = max_det

        results = self.model(images)

        detections = []
        for result in results.pandas().xyxy:
            image_detections = []
            for _, row in result.iterrows():
                detection = {
                    "bbox": [
                        float(row["xmin"]),
                        float(row["ymin"]),
                        float(row["xmax"] - row["xmin"]),
                        float(row["ymax"] - row["ymin"]),
                    ],
                    "confidence": float(row["confidence"]),
                    "class_id": int(row["class"]),
                    "class_name": row["name"],
                }
                image_detections.append(detection)
            detections.append(image_detections)

        return detections

    def export_onnx(
        self, output_path: str, img_size: int = 640, simplify: bool = True
    ) -> str:
        """
        Export model to ONNX format

        Args:
            output_path: Output path for ONNX model
            img_size: Input image size
            simplify: Simplify ONNX model

        Returns:
            Path to exported ONNX model
        """
        if self.model_type == "yolov8":
            return self._export_yolov8_onnx(output_path, img_size, simplify)
        elif self.model_type == "yolov5":
            return self._export_yolov5_onnx(output_path, img_size, simplify)

    def _export_yolov8_onnx(
        self, output_path: str, img_size: int, simplify: bool
    ) -> str:
        """Export YOLOv8 to ONNX"""
        self.model.export(
            format="onnx", imgsz=img_size, simplify=simplify, dynamic=False
        )
        # YOLOv8 saves with .onnx extension automatically
        return output_path

    def _export_yolov5_onnx(
        self, output_path: str, img_size: int, simplify: bool
    ) -> str:
        """Export YOLOv5 to ONNX"""
        try:
            import onnx
            from onnxsim import simplify as onnx_simplify

            # Create dummy input
            dummy_input = torch.randn(1, 3, img_size, img_size).to(self.device)

            # Export to ONNX
            torch.onnx.export(
                self.model,
                dummy_input,
                output_path,
                opset_version=12,
                input_names=["images"],
                output_names=["output"],
                dynamic_axes=None,
            )

            # Simplify if requested
            if simplify:
                onnx_model = onnx.load(output_path)
                onnx_model, check = onnx_simplify(onnx_model)
                onnx.save(onnx_model, output_path)

            return output_path

        except ImportError:
            raise ImportError(
                "onnx and onnx-simplifier required for export. "
                "Install with: pip install onnx onnx-simplifier"
            )

    def save(self, path: str):
        """Save model weights"""
        if self.model_type == "yolov8":
            self.model.save(path)
        elif self.model_type == "yolov5":
            torch.save(self.model.state_dict(), path)

    def load(self, path: str):
        """Load model weights"""
        if self.model_type == "yolov8":
            from ultralytics import YOLO

            self.model = YOLO(path)
        elif self.model_type == "yolov5":
            self.model.load_state_dict(torch.load(path, map_location=self.device))

    def get_model_info(self) -> dict[str, Any]:
        """Get model information"""
        return {
            "model_type": self.model_type,
            "model_size": self.model_size,
            "num_classes": self.num_classes,
            "class_names": self.class_names,
            "device": self.device,
        }


def create_button_yolo(config: dict[str, Any]) -> ButtonYOLO:
    """
    Factory function to create ButtonYOLO from configuration

    Args:
        config: Configuration dictionary with keys:
            - model_type: YOLO version ('yolov8', 'yolov5')
            - model_size: Model size ('n', 's', 'm', 'l', 'x')
            - num_classes: Number of button classes
            - pretrained: Use pretrained weights
            - device: Device to use

    Returns:
        ButtonYOLO instance
    """
    model = ButtonYOLO(
        model_type=config.get("model_type", "yolov8"),
        model_size=config.get("model_size", "n"),
        num_classes=config.get("num_classes", 4),
        pretrained=config.get("pretrained", True),
        device=config.get("device", "auto"),
    )

    print(f"Created ButtonYOLO: {model.get_model_info()}")

    return model


if __name__ == "__main__":
    # Test model creation
    print("Testing ButtonYOLO...\n")

    config = {
        "model_type": "yolov8",
        "model_size": "n",
        "num_classes": 4,
        "pretrained": False,  # Don't download for testing
        "device": "cpu",
    }

    try:
        model = create_button_yolo(config)
        print("Model created successfully!")
        print(f"Model info: {model.get_model_info()}")
    except ImportError as e:
        print(f"Note: {e}")
        print("Install ultralytics to use YOLOv8: pip install ultralytics")
