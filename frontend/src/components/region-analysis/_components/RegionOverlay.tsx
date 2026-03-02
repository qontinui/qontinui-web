import type {
  RegionAnalysisResponse,
  FusedRegion,
  DetectedRegion,
} from "@/services/regionAnalysis";
import { getColorForSource } from "../utils";

interface RegionOverlayProps {
  results: RegionAnalysisResponse;
  selectedView: "fused" | "individual";
  selectedAnalyzer: string | null;
  showGridCells: boolean;
  showCellNumbers: boolean;
  imageWidth: number;
  imageHeight: number;
}

function RegionSvgGroup({
  region,
  regionIndex,
  color,
  showGridCells,
  showCellNumbers,
  strokeWidth,
  cellStrokeWidth,
  fontSize,
  cellFontSize,
  cellDash,
  cellOpacity,
  labelOffsetY,
  cellTextOffsetY,
}: {
  region: FusedRegion | DetectedRegion;
  regionIndex: number;
  color: string;
  showGridCells: boolean;
  showCellNumbers: boolean;
  strokeWidth: number;
  cellStrokeWidth: number;
  fontSize: number;
  cellFontSize: number;
  cellDash: string;
  cellOpacity: number;
  labelOffsetY: number;
  cellTextOffsetY: number;
}) {
  const hasGrid = region.grid_metadata && region.grid_metadata.cells.length > 0;

  return (
    <g>
      <rect
        x={region.bounding_box.x}
        y={region.bounding_box.y}
        width={region.bounding_box.width}
        height={region.bounding_box.height}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        opacity="0.9"
      />

      <text
        x={region.bounding_box.x + 5}
        y={region.bounding_box.y + labelOffsetY}
        fill={color}
        fontSize={fontSize}
        fontWeight="bold"
        style={{
          textShadow: "0 0 4px black, 0 0 4px black",
        }}
      >
        {region.label || region.region_type || `R${regionIndex + 1}`}
        {hasGrid &&
          ` (${region.grid_metadata!.rows}×${region.grid_metadata!.cols})`}
      </text>

      {showGridCells &&
        hasGrid &&
        region.grid_metadata!.cells.map((cell, cellIndex) => (
          <g key={cellIndex}>
            <rect
              x={cell.bounding_box.x}
              y={cell.bounding_box.y}
              width={cell.bounding_box.width}
              height={cell.bounding_box.height}
              fill="none"
              stroke={color}
              strokeWidth={cellStrokeWidth}
              strokeDasharray={cellDash}
              opacity={cellOpacity}
            />

            {showCellNumbers && (
              <text
                x={cell.bounding_box.x + cell.bounding_box.width / 2}
                y={
                  cell.bounding_box.y +
                  cell.bounding_box.height / 2 +
                  cellTextOffsetY
                }
                fill={color}
                fontSize={cellFontSize}
                fontWeight="bold"
                textAnchor="middle"
                style={{
                  textShadow: "0 0 3px black, 0 0 3px black",
                }}
              >
                [{cell.row},{cell.col}]
              </text>
            )}
          </g>
        ))}
    </g>
  );
}

export function RegionOverlay({
  results,
  selectedView,
  selectedAnalyzer,
  showGridCells,
  showCellNumbers,
  imageWidth,
  imageHeight,
}: RegionOverlayProps) {
  return (
    <svg
      className="absolute top-0 left-0 pointer-events-none"
      width={imageWidth}
      height={imageHeight}
      viewBox={`0 0 ${imageWidth} ${imageHeight}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {selectedView === "fused" &&
        (results.fused_regions || []).map((region, regionIndex) => (
          <RegionSvgGroup
            key={regionIndex}
            region={region}
            regionIndex={regionIndex}
            color={getColorForSource(region.sources[0] ?? "", regionIndex)}
            showGridCells={showGridCells}
            showCellNumbers={showCellNumbers}
            strokeWidth={4}
            cellStrokeWidth={2}
            fontSize={16}
            cellFontSize={12}
            cellDash="4,4"
            cellOpacity={0.6}
            labelOffsetY={25}
            cellTextOffsetY={5}
          />
        ))}

      {selectedView === "individual" &&
        selectedAnalyzer &&
        (
          results.analyzer_results.find(
            (r) => r.analyzer_name === selectedAnalyzer
          )?.regions || []
        ).map((region, regionIndex) => (
          <RegionSvgGroup
            key={regionIndex}
            region={region}
            regionIndex={regionIndex}
            color="#3b82f6"
            showGridCells={showGridCells}
            showCellNumbers={showCellNumbers}
            strokeWidth={3}
            cellStrokeWidth={1.5}
            fontSize={14}
            cellFontSize={10}
            cellDash="3,3"
            cellOpacity={0.5}
            labelOffsetY={20}
            cellTextOffsetY={4}
          />
        ))}
    </svg>
  );
}
