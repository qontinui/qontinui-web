/**
 * Palette Item Component
 *
 * Individual node item in the palette with drag-and-drop,
 * click-to-add, hover preview, and favorite/recent indicators.
 */

import React, { useState } from 'react';
import { ActionType } from '@/lib/action-schema/action-types';
import { NodeMetadata, CATEGORIES } from './palette-config';
import { useIsFavoriteNode, useToggleFavorite } from '@/stores/favorite-nodes';
import { useIsRecentNode } from '@/stores/recent-nodes';
import { Star, Plus, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

export interface PaletteItemProps {
  metadata: NodeMetadata;
  onDragStart?: (nodeType: ActionType, event: React.DragEvent) => void;
  onAdd?: (nodeType: ActionType) => void;
  compact?: boolean;
  showCategory?: boolean;
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

export const PaletteItem: React.FC<PaletteItemProps> = ({
  metadata,
  onDragStart,
  onAdd,
  compact = false,
  showCategory = false,
  className,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const isFavorite = useIsFavoriteNode(metadata.type);
  const isRecent = useIsRecentNode(metadata.type);
  const toggleFavorite = useToggleFavorite();

  const category = CATEGORIES[metadata.category];
  const IconComponent = metadata.icon;

  const handleDragStart = (event: React.DragEvent) => {
    if (onDragStart) {
      onDragStart(metadata.type, event);
    }
  };

  const handleClick = () => {
    if (onAdd) {
      onAdd(metadata.type);
    }
  };

  const handleToggleFavorite = (event: React.MouseEvent) => {
    event.stopPropagation();
    toggleFavorite(metadata.type);
  };

  return (
    <div
      className={cn(
        'palette-item',
        compact && 'palette-item--compact',
        isHovered && 'palette-item--hovered',
        className
      )}
      draggable
      onDragStart={handleDragStart}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-node-type={metadata.type}
    >
      {/* Drag Handle */}
      <div className="palette-item__drag-handle">
        <GripVertical className="h-4 w-4 text-gray-400" />
      </div>

      {/* Icon */}
      <div
        className="palette-item__icon"
        style={{
          backgroundColor: `${category.color}20`,
          color: category.color,
        }}
      >
        <IconComponent className="h-4 w-4" />
      </div>

      {/* Content */}
      <div className="palette-item__content">
        <div className="palette-item__header">
          <span className="palette-item__name">{metadata.displayName}</span>

          {/* Indicators */}
          <div className="palette-item__indicators">
            {isRecent && (
              <span
                className="palette-item__badge palette-item__badge--recent"
                title="Recently used"
              >
                Recent
              </span>
            )}
            {metadata.multiOutput && (
              <span
                className="palette-item__badge palette-item__badge--multi"
                title="Multiple outputs"
              >
                Multi
              </span>
            )}
          </div>
        </div>

        {!compact && (
          <p className="palette-item__description">{metadata.description}</p>
        )}

        {showCategory && (
          <span
            className="palette-item__category"
            style={{ color: category.color }}
          >
            {category.label}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="palette-item__actions">
        {/* Favorite Button */}
        <button
          className={cn(
            'palette-item__action-btn palette-item__favorite-btn',
            isFavorite && 'palette-item__favorite-btn--active'
          )}
          onClick={handleToggleFavorite}
          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Star
            className={cn('h-4 w-4', isFavorite && 'fill-current')}
          />
        </button>

        {/* Add Button */}
        <button
          className="palette-item__action-btn palette-item__add-btn"
          onClick={handleClick}
          title="Add to canvas"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Hover Tooltip */}
      {isHovered && !compact && (
        <div className="palette-item__tooltip">
          <div className="palette-item__tooltip-header">
            <IconComponent className="h-5 w-5" style={{ color: category.color }} />
            <span className="palette-item__tooltip-title">
              {metadata.displayName}
            </span>
          </div>
          <p className="palette-item__tooltip-description">
            {metadata.description}
          </p>
          {metadata.keywords.length > 0 && (
            <div className="palette-item__tooltip-keywords">
              {metadata.keywords.slice(0, 5).map((keyword) => (
                <span key={keyword} className="palette-item__keyword">
                  {keyword}
                </span>
              ))}
            </div>
          )}
          {metadata.tags && metadata.tags.length > 0 && (
            <div className="palette-item__tooltip-tags">
              {metadata.tags.map((tag) => (
                <span key={tag} className="palette-item__tag">
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Compact Variant
// ============================================================================

export const CompactPaletteItem: React.FC<PaletteItemProps> = (props) => {
  return <PaletteItem {...props} compact={true} />;
};

// ============================================================================
// Category Badge Component
// ============================================================================

interface CategoryBadgeProps {
  category: keyof typeof CATEGORIES;
  size?: 'sm' | 'md' | 'lg';
}

export const CategoryBadge: React.FC<CategoryBadgeProps> = ({
  category,
  size = 'md',
}) => {
  const categoryInfo = CATEGORIES[category];
  const IconComponent = categoryInfo.icon;

  return (
    <div
      className={cn('category-badge', `category-badge--${size}`)}
      style={{
        backgroundColor: `${categoryInfo.color}20`,
        color: categoryInfo.color,
      }}
    >
      <IconComponent className={cn(
        size === 'sm' && 'h-3 w-3',
        size === 'md' && 'h-4 w-4',
        size === 'lg' && 'h-5 w-5'
      )} />
      <span>{categoryInfo.label}</span>
    </div>
  );
};

// ============================================================================
// Node Preview Component
// ============================================================================

interface NodePreviewProps {
  metadata: NodeMetadata;
  showFullDetails?: boolean;
}

export const NodePreview: React.FC<NodePreviewProps> = ({
  metadata,
  showFullDetails = false,
}) => {
  const category = CATEGORIES[metadata.category];
  const IconComponent = metadata.icon;

  return (
    <div className="node-preview">
      <div className="node-preview__header">
        <div
          className="node-preview__icon"
          style={{
            backgroundColor: `${category.color}20`,
            color: category.color,
          }}
        >
          <IconComponent className="h-6 w-6" />
        </div>
        <div className="node-preview__title-section">
          <h4 className="node-preview__title">{metadata.displayName}</h4>
          <CategoryBadge category={metadata.category} size="sm" />
        </div>
      </div>

      <p className="node-preview__description">{metadata.description}</p>

      {showFullDetails && (
        <>
          {metadata.keywords.length > 0 && (
            <div className="node-preview__section">
              <h5 className="node-preview__section-title">Keywords</h5>
              <div className="node-preview__keywords">
                {metadata.keywords.map((keyword) => (
                  <span key={keyword} className="node-preview__keyword">
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
          )}

          {metadata.multiOutput && (
            <div className="node-preview__section">
              <h5 className="node-preview__section-title">Outputs</h5>
              <p className="node-preview__section-text">
                This node has {metadata.outputCount || 'multiple'} output{' '}
                {(metadata.outputCount || 2) > 1 ? 'branches' : 'branch'}
              </p>
            </div>
          )}

          {metadata.tags && metadata.tags.length > 0 && (
            <div className="node-preview__section">
              <h5 className="node-preview__section-title">Tags</h5>
              <div className="node-preview__tags">
                {metadata.tags.map((tag) => (
                  <span key={tag} className="node-preview__tag">
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PaletteItem;
