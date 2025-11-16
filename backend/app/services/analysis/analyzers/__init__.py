"""
Analyzer implementations
"""

# Stable Region Analyzers
from .stable_region_variance import StableRegionVarianceAnalyzer
from .stable_region_difference import StableRegionDifferenceAnalyzer

# Pattern Match Analyzers
from .pattern_template_match import PatternTemplateMatchAnalyzer
from .pattern_feature_match import PatternFeatureMatchAnalyzer

# Single Shot Analyzers
from .single_shot_edge import SingleShotEdgeAnalyzer
from .single_shot_color import SingleShotColorAnalyzer

# Specialized GUI Element Detectors
from .input_field_detector import InputFieldDetector
from .dropdown_detector import DropdownDetector
from .menu_bar_detector import MenuBarDetector
from .sidebar_detector import SidebarDetector
from .icon_button_detector import IconButtonDetector
from .modal_dialog_detector import ModalDialogDetector

# Button Detection Analyzers
from .button_shape_detector import ButtonShapeDetector
from .button_text_rectangle import ButtonTextRectangleDetector
from .button_shadow_detector import ButtonShadowDetector
from .button_color_detector import ButtonColorDetector
from .button_hover_detector import ButtonHoverDetector
from .button_affordance_scorer import ButtonAffordanceScorer

# Hybrid and Advanced Detection Strategies
from .button_fusion_detector import ButtonFusionDetector
from .button_ensemble_detector import ButtonEnsembleDetector
from .negative_space_analyzer import NegativeSpaceAnalyzer
from .typography_detector import TypographyDetector
from .consistency_detector import ConsistencyDetector
from .active_learning_detector import ActiveLearningDetector
from .accessibility_analyzer import AccessibilityAnalyzer
from .temporal_analyzer import TemporalAnalyzer
from .graph_neural_detector import GraphNeuralDetector

__all__ = [
    # Stable Region
    "StableRegionVarianceAnalyzer",
    "StableRegionDifferenceAnalyzer",
    # Pattern Match
    "PatternTemplateMatchAnalyzer",
    "PatternFeatureMatchAnalyzer",
    # Single Shot
    "SingleShotEdgeAnalyzer",
    "SingleShotColorAnalyzer",
    # Specialized GUI Element Detectors
    "InputFieldDetector",
    "DropdownDetector",
    "MenuBarDetector",
    "SidebarDetector",
    "IconButtonDetector",
    "ModalDialogDetector",
    # Button Detection
    "ButtonShapeDetector",
    "ButtonTextRectangleDetector",
    "ButtonShadowDetector",
    "ButtonColorDetector",
    "ButtonHoverDetector",
    "ButtonAffordanceScorer",
    # Hybrid and Advanced Detection
    "ButtonFusionDetector",
    "ButtonEnsembleDetector",
    "NegativeSpaceAnalyzer",
    "TypographyDetector",
    "ConsistencyDetector",
    "ActiveLearningDetector",
    "AccessibilityAnalyzer",
    "TemporalAnalyzer",
    "GraphNeuralDetector",
]
