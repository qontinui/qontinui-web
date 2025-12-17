"""
MOVED to qontinui-train/data_preparation/visualize_dataset.py

Import from qontinui_train.data_preparation instead.
"""

import sys
import warnings

warnings.warn(
    "visualize_dataset.py has been moved to qontinui-train. "
    "Import from qontinui_train.data_preparation instead.",
    DeprecationWarning,
    stacklevel=2,
)

try:
    from qontinui_train.data_preparation.visualize_dataset import *
except ImportError:
    print("Error: qontinui-train is not installed.", file=sys.stderr)
    sys.exit(1)
