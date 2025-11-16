# ML Button Detection Infrastructure

This directory contains the ML training infrastructure for button detection in the Qontinui system.

## Overview

The ML infrastructure provides:
- **Multiple model architectures**: MobileNetV3, EfficientNet, Custom CNN, YOLOv8/v5
- **Training pipeline**: Complete training loop with validation, checkpointing, and logging
- **Inference engine**: Unified interface for running predictions
- **Analyzer integration**: Seamless integration with the Qontinui analysis system

## Directory Structure

```
ml/
├── models/
│   ├── __init__.py
│   ├── button_cnn.py       # Custom CNN architectures
│   └── button_yolo.py      # YOLO-based detection
├── train_button_detector.py # Main training script
├── inference.py            # Inference wrapper
├── ml_button_analyzer.py   # Integration with analysis system
├── config.yaml             # CNN training configuration
├── config_yolo.yaml        # YOLO training configuration
└── README.md               # This file
```

## Supported Model Architectures

### 1. MobileNetV3 (Recommended for production)
- **Size**: ~2.5M parameters
- **Speed**: Fast inference (~10ms on CPU)
- **Accuracy**: Good for most button types
- **Use case**: Production deployment, mobile/edge devices

```python
model_type: mobilenet_v3
pretrained: true
```

### 2. EfficientNet-B0 (Balanced)
- **Size**: ~5M parameters
- **Speed**: Moderate (~20ms on CPU)
- **Accuracy**: Better than MobileNetV3
- **Use case**: When accuracy is more important than speed

```python
model_type: efficientnet_b0
pretrained: true
```

### 3. Custom CNN (Lightweight)
- **Size**: <5M parameters (configurable)
- **Speed**: Very fast (~5ms on CPU)
- **Accuracy**: Good for simple button detection
- **Use case**: Minimal resource environments

```python
model_type: custom
pretrained: false
```

### 4. YOLOv8 (Best for detection)
- **Size**: Varies by model size (n/s/m/l/x)
- **Speed**: Fast with GPU (~15ms for yolov8n)
- **Accuracy**: Excellent for object detection
- **Use case**: Full-image button detection, multiple buttons

```python
model_type: yolov8
model_size: n  # nano - fastest
```

### 5. YOLOv5 (Alternative detection)
- **Size**: Similar to YOLOv8
- **Speed**: Comparable to YOLOv8
- **Accuracy**: Very good
- **Use case**: If YOLOv8 not available

## Data Format

### COCO Format Annotations

The training system expects COCO format JSON annotations:

```json
{
  "images": [
    {
      "id": 1,
      "file_name": "screenshot_001.png",
      "width": 1920,
      "height": 1080
    }
  ],
  "annotations": [
    {
      "id": 1,
      "image_id": 1,
      "category_id": 1,
      "bbox": [100, 200, 150, 50],
      "area": 7500,
      "iscrowd": 0
    }
  ],
  "categories": [
    {"id": 1, "name": "primary_button"},
    {"id": 2, "name": "secondary_button"},
    {"id": 3, "name": "icon_button"},
    {"id": 4, "name": "text_button"}
  ]
}
```

### YOLO Format (for YOLOv8/v5)

Create a `data.yaml` file:

```yaml
path: /path/to/button_dataset
train: images/train
val: images/val

nc: 4  # Number of classes
names: ['primary_button', 'secondary_button', 'icon_button', 'text_button']
```

## Training Models

### Training CNN Models

1. **Prepare your dataset** in COCO format
2. **Configure training** in `config.yaml`
3. **Run training**:

```bash
# Using config file
python train_button_detector.py --config config.yaml

# Using command line arguments
python train_button_detector.py \
  --model mobilenet_v3 \
  --epochs 50 \
  --batch-size 32 \
  --lr 0.001 \
  --data-root /path/to/images \
  --train-annotations /path/to/train.json \
  --val-annotations /path/to/val.json \
  --pretrained
```

### Training YOLO Models

1. **Prepare YOLO format dataset**
2. **Create data.yaml**
3. **Configure training** in `config_yolo.yaml`
4. **Run training**:

```bash
python train_button_detector.py --config config_yolo.yaml
```

## Running Inference

### Standalone Inference

```python
from ml.inference import create_inference_engine

# Create inference engine
inference = create_inference_engine(
    model_path='checkpoints/best.pt',
    model_type='mobilenet_v3',
    confidence_threshold=0.5
)

# Run inference on single image
prediction = inference.predict_classification('test_button.png')
print(f"Is button: {prediction['is_button']}")
print(f"Button type: {prediction['button_type']}")
print(f"Confidence: {prediction['confidence']:.2f}")

# Run inference on regions
import cv2
image = cv2.imread('screenshot.png')
regions = [[100, 200, 150, 50], [300, 400, 120, 45]]
predictions = inference.predict_regions(image, regions)

# Run batch inference
images = ['img1.png', 'img2.png', 'img3.png']
batch_predictions = inference.predict_batch(images, batch_size=8)
```

### Integration with Analysis System

```python
from ml.ml_button_analyzer import create_ml_button_analyzer
from app.services.analysis.base import AnalysisInput
from uuid import uuid4

# Create analyzer
analyzer = create_ml_button_analyzer({
    'model_path': 'checkpoints/best.pt',
    'model_type': 'mobilenet_v3',
    'confidence_threshold': 0.5,
    'mode': 'detection'
})

# Create analysis input
input_data = AnalysisInput(
    annotation_set_id=uuid4(),
    screenshots=[{'id': 1, 'filename': 'screenshot.png'}],
    screenshot_data=[image_bytes],
    parameters={'confidence_threshold': 0.6}
)

# Run analysis
result = await analyzer.analyze(input_data)

print(f"Found {len(result.elements)} buttons")
for elem in result.elements:
    print(f"  - {elem.label} at ({elem.bounding_box.x}, {elem.bounding_box.y}) "
          f"confidence: {elem.confidence:.2f}")
```

## Model Performance Expectations

### MobileNetV3
- **Training time**: ~2 hours on GPU (50 epochs, 10K samples)
- **Inference speed**: ~10ms per image (CPU), ~2ms (GPU)
- **Expected accuracy**: 85-90% button type classification
- **Model size**: ~10MB

### EfficientNet-B0
- **Training time**: ~3 hours on GPU (50 epochs, 10K samples)
- **Inference speed**: ~20ms per image (CPU), ~3ms (GPU)
- **Expected accuracy**: 88-93% button type classification
- **Model size**: ~20MB

### Custom CNN
- **Training time**: ~1 hour on GPU (50 epochs, 10K samples)
- **Inference speed**: ~5ms per image (CPU), ~1ms (GPU)
- **Expected accuracy**: 80-85% button type classification
- **Model size**: ~5MB

### YOLOv8n (nano)
- **Training time**: ~4 hours on GPU (100 epochs, 10K samples)
- **Inference speed**: ~15ms per image (GPU), ~50ms (CPU)
- **Expected mAP@0.5**: 0.75-0.85
- **Model size**: ~6MB

## Evaluation Metrics

The training script logs several metrics:

- **Classification Accuracy**: Percentage of correct predictions
- **Loss**: Combined training loss
- **Confidence Score**: Model confidence in predictions
- **mAP** (for YOLO): Mean Average Precision at IoU 0.5

TensorBoard logs are saved in the `runs/` directory:

```bash
tensorboard --logdir runs/button_detector
```

## Deployment

### Export to ONNX (for production)

```python
from ml.models.button_yolo import create_button_yolo

# For YOLO models
model = create_button_yolo(config)
model.export_onnx('button_detector.onnx', img_size=640, simplify=True)
```

### Register Analyzer

To register the ML analyzer with the analysis system:

```python
from app.services.analysis.register import register_analyzer
from ml.ml_button_analyzer import create_ml_button_analyzer

# Register analyzer
register_analyzer('ml_button', create_ml_button_analyzer, {
    'model_path': 'checkpoints/best.pt',
    'model_type': 'mobilenet_v3',
    'confidence_threshold': 0.5
})
```

## Dependencies

The ML infrastructure requires:

```bash
# Core ML libraries (add to requirements.txt)
torch>=2.0.0
torchvision>=0.15.0
tensorboard>=2.12.0

# For YOLO support (optional)
ultralytics>=8.0.0  # For YOLOv8

# For ONNX export (optional)
onnx>=1.14.0
onnx-simplifier>=0.4.0
```

## Training Tips

1. **Start with pretrained weights**: Always use `pretrained: true` for faster convergence
2. **Freeze backbone initially**: Set `freeze_backbone: true` for first few epochs
3. **Use data augmentation**: Enable augmentation for better generalization
4. **Monitor validation loss**: Stop when validation loss plateaus
5. **Adjust learning rate**: Use scheduler for optimal training
6. **Batch size**: Larger batches more stable but need more memory
7. **Class imbalance**: Ensure balanced samples across button types

## Troubleshooting

### Out of Memory
- Reduce `batch_size`
- Use smaller model (`mobilenet_v3` or `custom`)
- Reduce `img_size`

### Poor Accuracy
- Increase training `epochs`
- Enable `pretrained` weights
- Check dataset quality and balance
- Reduce `dropout` if underfitting
- Increase `dropout` if overfitting

### Slow Training
- Ensure GPU is being used (`use_gpu: true`)
- Increase `batch_size` (if memory allows)
- Reduce `num_workers` if CPU bottleneck
- Use smaller model architecture

## Future Enhancements

- [ ] Data augmentation pipeline
- [ ] Mixed precision training (FP16)
- [ ] Multi-GPU training support
- [ ] Active learning for data collection
- [ ] Model quantization for edge deployment
- [ ] Automatic hyperparameter tuning
- [ ] Cross-validation support
- [ ] Additional evaluation metrics (F1, precision, recall)

## License

Part of the Qontinui project.
