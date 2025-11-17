# Background Removal API

## Overview

The Background Removal API provides endpoints for removing dynamic backgrounds from screenshots to enable robust State Discovery.

## Endpoints

### POST /api/v1/remove-background

Remove backgrounds from screenshots using configurable detection strategies.

**Request Body:**
```json
{
  "screenshots": ["data:image/png;base64,...", "data:image/png;base64,..."],
  "config": {
    "use_temporal_variance": true,
    "use_edge_density": true,
    "use_uniformity": true,
    "variance_threshold": 20.0,
    "min_screenshots_for_variance": 3,
    "edge_density_threshold": 0.05,
    "edge_kernel_size": 3,
    "uniformity_threshold": 15.0,
    "uniformity_region_size": 20,
    "apply_morphology": true,
    "morphology_kernel_size": 3,
    "min_foreground_region_size": 50,
    "foreground_alpha": 255,
    "background_alpha": 0
  },
  "debug": false
}
```

**Response:**
```json
{
  "masked_screenshots": ["data:image/png;base64,...", "data:image/png;base64,..."],
  "statistics": {
    "total_pixels": 2073600,
    "background_pixels": 1800000,
    "foreground_pixels": 273600,
    "background_percentage": 86.8,
    "foreground_percentage": 13.2,
    "num_screenshots": 5,
    "image_size": [1920, 1080]
  },
  "background_mask": "data:image/png;base64,..." // Only if debug=true
}
```

**Status Codes:**
- 200: Success
- 400: Invalid request (bad images, missing data)
- 500: Server error (processing failed)

### GET /api/v1/background-removal/presets

Get available preset configurations.

**Response:**
```json
{
  "presets": {
    "balanced": { /* default config */ },
    "dynamic": { /* optimized for animated backgrounds */ },
    "subtle": { /* for solid color backgrounds */ },
    "aggressive": { /* more aggressive removal */ },
    "gentle": { /* conservative removal */ }
  }
}
```

## Configuration Parameters

### Detection Strategies

- **use_temporal_variance** (boolean): Enable temporal variance detection
  - Identifies pixels that change between screenshots
  - Best for: Animated backgrounds, video backgrounds

- **use_edge_density** (boolean): Enable edge density detection
  - Identifies regions with low edge density
  - Best for: Solid color backgrounds, subtle textures

- **use_uniformity** (boolean): Enable uniformity detection
  - Identifies large uniform color regions
  - Best for: Solid backgrounds, gentle gradients

### Thresholds

- **variance_threshold** (float, default: 20.0): Pixel variance threshold
  - Higher = more strict (fewer pixels marked as background)
  - Range: 5.0 - 50.0

- **edge_density_threshold** (float, default: 0.05): Edge density threshold
  - Lower = more pixels marked as background
  - Range: 0.01 - 0.15

- **uniformity_threshold** (float, default: 15.0): Uniformity threshold
  - Lower = stricter uniformity check
  - Range: 5.0 - 30.0

### Post-Processing

- **apply_morphology** (boolean): Enable morphological cleanup
- **morphology_kernel_size** (int, default: 3): Kernel size for operations
- **min_foreground_region_size** (int, default: 50): Minimum component size

## Usage Example (Python)

```python
import requests
import base64

# Load screenshots
with open('screenshot1.png', 'rb') as f:
    img1_b64 = base64.b64encode(f.read()).decode()

with open('screenshot2.png', 'rb') as f:
    img2_b64 = base64.b64encode(f.read()).decode()

# Prepare request
request_data = {
    "screenshots": [
        f"data:image/png;base64,{img1_b64}",
        f"data:image/png;base64,{img2_b64}"
    ],
    "config": {
        "use_temporal_variance": True,
        "variance_threshold": 15.0
    },
    "debug": False
}

# Call API
response = requests.post(
    'http://localhost:8000/api/v1/remove-background',
    json=request_data
)

result = response.json()
print(f"Foreground: {result['statistics']['foreground_percentage']:.1f}%")
```

## Usage Example (JavaScript/TypeScript)

```typescript
// Prepare screenshots (assuming File objects)
const screenshots = await Promise.all(
  files.map(file => {
    return new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
  })
);

// Call API
const response = await fetch('/api/v1/remove-background', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    screenshots,
    config: {
      use_temporal_variance: true,
      variance_threshold: 15.0,
    },
    debug: false,
  }),
});

const result = await response.json();
console.log(`Foreground: ${result.statistics.foreground_percentage.toFixed(1)}%`);
```

## Error Handling

The API returns detailed error messages:

```json
{
  "detail": "Failed to decode screenshot 2: Invalid image format"
}
```

Common errors:
- Invalid base64 encoding
- Unsupported image format
- Too few screenshots (< min_screenshots_for_variance)
- Processing failure (insufficient memory, etc.)

## Performance Considerations

- Processing time scales linearly with:
  - Number of screenshots
  - Image resolution
  - Enabled detection strategies
- Typical processing time: 0.5-2 seconds per screenshot (1920x1080)
- Memory usage: ~2x total image data

## Implementation Details

### Backend Service

File: `app/services/background_removal_service.py`

- Wraps the qontinui `BackgroundRemovalAnalyzer`
- Handles image encoding/decoding
- Manages Python path for qontinui library import

### Qontinui Module

File: `qontinui/discovery/background_removal.py`

- Implements three detection strategies
- Performs morphological post-processing
- Outputs RGBA images with transparency

## Testing

Test the API using the Web UI:
1. Navigate to: Develop State Structure → Create Images → Background Removal
2. Upload 2+ screenshots
3. Adjust configuration parameters
4. Click "Remove Backgrounds"
5. Review results in Preview and Statistics panels

## Troubleshooting

### Import Error
```
Failed to import qontinui modules
```
**Solution**: Ensure qontinui library is in the correct location relative to backend:
```
qontinui_parent_directory/
├── qontinui/          # Library location
└── qontinui-web/
    └── backend/       # Backend location
```

### Processing Failure
```
Background removal processing failed
```
**Common causes**:
- Invalid image format
- Corrupted image data
- Insufficient memory for large images

**Solutions**:
- Validate images before upload
- Reduce image resolution
- Increase server memory allocation

### Poor Results
```
Too much foreground/background detected
```
**Solutions**:
- Try different presets (balanced, dynamic, subtle)
- Adjust thresholds manually
- Enable/disable specific detection strategies
- Add more screenshots for temporal variance

## Future Enhancements

- Streaming API for large batches
- Progress reporting via WebSocket
- Caching of processed screenshots
- Batch processing with job queue
- Machine learning-based background detection
