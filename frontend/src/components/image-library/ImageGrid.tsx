/**
 * ImageGrid Module
 *
 * Re-exports image display components that were extracted into _components/
 * for Single Responsibility Principle compliance:
 *
 * - ImageGrid (grid view) -> _components/ImageGridView
 * - ImageList (list view) -> _components/ImageListView
 * - ImageDetailsPanel (detail sidebar) -> _components/ImageDetailsSidebar
 *
 * The original component names and prop interfaces are preserved
 * for backward compatibility with existing consumers.
 */

export {
  ImageGridView as ImageGrid,
  type ImageGridViewProps as ImageGridProps,
} from "./_components/ImageGridView";

export {
  ImageListView as ImageList,
  type ImageListViewProps as ImageListProps,
} from "./_components/ImageListView";

export {
  ImageDetailsSidebar as ImageDetailsPanel,
  type ImageDetailsSidebarProps as ImageDetailsPanelProps,
} from "./_components/ImageDetailsSidebar";
