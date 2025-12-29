/**
 * Action Animations - Canvas-based animation renderers
 *
 * Provides rendering functions for each action type animation.
 * All functions draw directly to a Canvas 2D context.
 */

import {
  ActionAnimationConfig,
  ACTION_CATEGORY_COLORS,
} from "@/types/transition-animation";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Draw corner markers around a region (for FIND animations)
 */
function drawCornerMarkers(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  size: number = 15
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";

  // Top-left
  ctx.beginPath();
  ctx.moveTo(x, y + size);
  ctx.lineTo(x, y);
  ctx.lineTo(x + size, y);
  ctx.stroke();

  // Top-right
  ctx.beginPath();
  ctx.moveTo(x + width - size, y);
  ctx.lineTo(x + width, y);
  ctx.lineTo(x + width, y + size);
  ctx.stroke();

  // Bottom-left
  ctx.beginPath();
  ctx.moveTo(x, y + height - size);
  ctx.lineTo(x, y + height);
  ctx.lineTo(x + size, y + height);
  ctx.stroke();

  // Bottom-right
  ctx.beginPath();
  ctx.moveTo(x + width - size, y + height);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x + width, y + height - size);
  ctx.stroke();
}

/**
 * Draw an arrow pointing in a direction
 */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  direction: "up" | "down" | "left" | "right",
  size: number = 20,
  color: string
): void {
  ctx.save();
  ctx.translate(x, y);

  // Rotate based on direction
  switch (direction) {
    case "up":
      ctx.rotate(-Math.PI / 2);
      break;
    case "down":
      ctx.rotate(Math.PI / 2);
      break;
    case "left":
      ctx.rotate(Math.PI);
      break;
    case "right":
      // No rotation needed
      break;
  }

  ctx.beginPath();
  ctx.moveTo(-size / 2, -size / 3);
  ctx.lineTo(size / 2, 0);
  ctx.lineTo(-size / 2, size / 3);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.restore();
}

// ============================================================================
// Action Animation Renderers
// ============================================================================

/**
 * Render FIND action animation - pulsing dashed box with corner markers
 */
export function renderFindAnimation(
  ctx: CanvasRenderingContext2D,
  config: ActionAnimationConfig,
  progress: number
): void {
  if (!config.targetRegion) return;

  const { x, y, width, height } = config.targetRegion;
  const colors = ACTION_CATEGORY_COLORS.find;
  const pulse = Math.sin(progress * Math.PI * 4) * 0.3 + 0.7;

  // Pulsing background fill
  ctx.fillStyle = colors.bg.replace("0.2", `${0.1 + pulse * 0.15}`);
  ctx.fillRect(x, y, width, height);

  // Dashed border
  ctx.strokeStyle = colors.primary
    .replace(")", `, ${pulse})`)
    .replace("#", "rgba(");
  // Convert hex to rgba for opacity
  const r = parseInt(colors.primary.slice(1, 3), 16);
  const g = parseInt(colors.primary.slice(3, 5), 16);
  const b = parseInt(colors.primary.slice(5, 7), 16);
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${pulse})`;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 4]);
  ctx.strokeRect(x, y, width, height);
  ctx.setLineDash([]);

  // Corner markers
  drawCornerMarkers(ctx, x, y, width, height, colors.primary, 15);

  // Scanning line effect
  const scanY = y + ((height * progress) % height);
  ctx.beginPath();
  ctx.moveTo(x, scanY);
  ctx.lineTo(x + width, scanY);
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.5)`;
  ctx.lineWidth = 2;
  ctx.stroke();
}

/**
 * Render CLICK action animation - expanding ripple effect
 */
export function renderClickAnimation(
  ctx: CanvasRenderingContext2D,
  config: ActionAnimationConfig,
  progress: number,
  canvasCenter?: { x: number; y: number }
): void {
  // Use endPosition if available, otherwise use canvasCenter
  const position = config.endPosition || canvasCenter;
  if (!position) return;

  const { x, y } = position;
  const colors = ACTION_CATEGORY_COLORS.mouse;

  // Multiple expanding rings
  for (let i = 0; i < 3; i++) {
    const ringProgress = (progress + i * 0.2) % 1;
    const radius = 10 + ringProgress * 50;
    const opacity = 1 - ringProgress;

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(0, 217, 255, ${opacity * 0.8})`;
    ctx.lineWidth = 3 - ringProgress * 2;
    ctx.stroke();
  }

  // Center dot
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.fillStyle = colors.primary;
  ctx.fill();

  // Cross-hair
  const crossSize = 15;
  ctx.beginPath();
  ctx.moveTo(x - crossSize, y);
  ctx.lineTo(x + crossSize, y);
  ctx.moveTo(x, y - crossSize);
  ctx.lineTo(x, y + crossSize);
  ctx.strokeStyle = colors.primary;
  ctx.lineWidth = 2;
  ctx.stroke();
}

/**
 * Render TYPE action animation - text appearing with cursor
 */
export function renderTypeAnimation(
  ctx: CanvasRenderingContext2D,
  config: ActionAnimationConfig,
  progress: number,
  canvasCenter?: { x: number; y: number }
): void {
  if (!config.text) return;

  // Use endPosition if available, otherwise use canvasCenter
  const position = config.endPosition || canvasCenter;
  if (!position) return;

  const { x, y } = position;
  const colors = ACTION_CATEGORY_COLORS.keyboard;
  const text = config.text;
  const visibleChars = Math.floor(text.length * progress);
  const displayText = text.substring(0, visibleChars);

  // Background
  ctx.font = "bold 14px monospace";
  const textWidth = ctx.measureText(displayText || " ").width;
  const padding = 8;
  const height = 24;

  ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
  ctx.fillRect(
    x - padding,
    y - height / 2 - 2,
    textWidth + padding * 2 + 10,
    height
  );

  // Border
  ctx.strokeStyle = colors.primary;
  ctx.lineWidth = 2;
  ctx.strokeRect(
    x - padding,
    y - height / 2 - 2,
    textWidth + padding * 2 + 10,
    height
  );

  // Text
  ctx.fillStyle = colors.primary;
  ctx.textBaseline = "middle";
  ctx.fillText(displayText, x, y);

  // Blinking cursor
  const cursorVisible = Math.floor(progress * 10) % 2 === 0 || progress >= 1;
  if (cursorVisible && progress < 1) {
    const cursorX = x + textWidth + 2;
    ctx.fillRect(cursorX, y - 8, 2, 16);
  }
}

/**
 * Render DRAG action animation - animated dot along path
 */
export function renderDragAnimation(
  ctx: CanvasRenderingContext2D,
  config: ActionAnimationConfig,
  progress: number
): void {
  if (!config.startPosition || !config.endPosition) return;

  const start = config.startPosition;
  const end = config.endPosition;
  const colors = ACTION_CATEGORY_COLORS.mouse;

  // Calculate current position
  const currentX = start.x + (end.x - start.x) * progress;
  const currentY = start.y + (end.y - start.y) * progress;

  // Trail line (fading)
  const gradient = ctx.createLinearGradient(
    start.x,
    start.y,
    currentX,
    currentY
  );
  gradient.addColorStop(0, "rgba(249, 115, 22, 0.3)");
  gradient.addColorStop(1, "rgba(249, 115, 22, 0.8)");

  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(currentX, currentY);
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Remaining path (ghosted)
  ctx.beginPath();
  ctx.moveTo(currentX, currentY);
  ctx.lineTo(end.x, end.y);
  ctx.strokeStyle = "rgba(249, 115, 22, 0.2)";
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 8]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Start point
  ctx.beginPath();
  ctx.arc(start.x, start.y, 8, 0, Math.PI * 2);
  ctx.fillStyle = colors.primary;
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.stroke();

  // End point (target)
  ctx.beginPath();
  ctx.arc(end.x, end.y, 8, 0, Math.PI * 2);
  ctx.strokeStyle = colors.secondary;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Moving dot
  ctx.beginPath();
  ctx.arc(currentX, currentY, 10, 0, Math.PI * 2);
  ctx.fillStyle = "#F97316";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.stroke();
}

/**
 * Render SCROLL action animation - directional arrows with motion
 */
export function renderScrollAnimation(
  ctx: CanvasRenderingContext2D,
  config: ActionAnimationConfig,
  progress: number,
  canvasCenter?: { x: number; y: number }
): void {
  if (!config.direction) return;

  // Use endPosition if available, otherwise use canvasCenter
  const position = config.endPosition || canvasCenter;
  if (!position) return;

  const { x, y } = position;
  const direction = config.direction;
  const colors = ACTION_CATEGORY_COLORS.mouse;

  // Motion offset based on direction
  const offset = Math.sin(progress * Math.PI * 3) * 15;
  let dx = 0,
    dy = 0;
  switch (direction) {
    case "up":
      dy = -offset;
      break;
    case "down":
      dy = offset;
      break;
    case "left":
      dx = -offset;
      break;
    case "right":
      dx = offset;
      break;
  }

  // Background circle
  ctx.beginPath();
  ctx.arc(x, y, 40, 0, Math.PI * 2);
  ctx.fillStyle = colors.bg;
  ctx.fill();
  ctx.strokeStyle = colors.primary;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Multiple arrows with stagger
  for (let i = -1; i <= 1; i++) {
    const arrowOffset = i * 15;
    let arrowX = x,
      arrowY = y;

    if (direction === "up" || direction === "down") {
      arrowX += arrowOffset;
      arrowY += dy;
    } else {
      arrowY += arrowOffset;
      arrowX += dx;
    }

    const opacity = 0.4 + (1 - Math.abs(i) * 0.3);
    const arrowColor = `rgba(0, 217, 255, ${opacity})`;
    drawArrow(ctx, arrowX, arrowY, direction, 25, arrowColor);
  }

  // Direction label
  ctx.font = "bold 12px sans-serif";
  ctx.fillStyle = colors.primary;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(direction.toUpperCase(), x, y + 60);
}

/**
 * Render MOUSE_MOVE action animation - cursor trail
 */
export function renderMouseMoveAnimation(
  ctx: CanvasRenderingContext2D,
  config: ActionAnimationConfig,
  progress: number
): void {
  if (!config.startPosition || !config.endPosition) return;

  const start = config.startPosition;
  const end = config.endPosition;
  const colors = ACTION_CATEGORY_COLORS.mouse;

  // Calculate current position
  const currentX = start.x + (end.x - start.x) * progress;
  const currentY = start.y + (end.y - start.y) * progress;

  // Trail with fading dots
  const numDots = 8;
  for (let i = 0; i < numDots; i++) {
    const dotProgress = Math.max(0, progress - i * 0.1);
    if (dotProgress <= 0) continue;

    const dotX = start.x + (end.x - start.x) * dotProgress;
    const dotY = start.y + (end.y - start.y) * dotProgress;
    const opacity = ((numDots - i) / numDots) * 0.5;
    const radius = 4 - i * 0.3;

    ctx.beginPath();
    ctx.arc(dotX, dotY, Math.max(1, radius), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 217, 255, ${opacity})`;
    ctx.fill();
  }

  // Cursor icon at current position
  ctx.save();
  ctx.translate(currentX, currentY);

  // Simple cursor shape
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 16);
  ctx.lineTo(4, 12);
  ctx.lineTo(8, 20);
  ctx.lineTo(10, 19);
  ctx.lineTo(6, 11);
  ctx.lineTo(11, 11);
  ctx.closePath();

  ctx.fillStyle = colors.primary;
  ctx.fill();
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

/**
 * Render KEY_PRESS action animation - keyboard key press
 */
export function renderKeyPressAnimation(
  ctx: CanvasRenderingContext2D,
  config: ActionAnimationConfig,
  progress: number,
  canvasCenter?: { x: number; y: number }
): void {
  // Use endPosition if available, otherwise use canvasCenter
  const position = config.endPosition || canvasCenter;
  if (!position) return;

  const { x, y } = position;
  const colors = ACTION_CATEGORY_COLORS.keyboard;
  const keyText = config.label || config.text || "KEY";

  // Key dimensions
  const keyWidth = Math.max(50, keyText.length * 12 + 20);
  const keyHeight = 40;
  const pressDepth = 4;

  // Key shadow (pressed effect)
  const pressed = progress < 0.5;
  const depth = pressed
    ? pressDepth * (1 - progress * 2)
    : pressDepth * (progress - 0.5) * 2;

  // Shadow
  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  ctx.fillRect(
    x - keyWidth / 2 + 2,
    y - keyHeight / 2 + 2 + depth,
    keyWidth,
    keyHeight
  );

  // Key body
  ctx.fillStyle = pressed ? "#2a2a2a" : "#3a3a3a";
  ctx.fillRect(
    x - keyWidth / 2,
    y - keyHeight / 2 - depth,
    keyWidth,
    keyHeight
  );

  // Key border
  ctx.strokeStyle = colors.primary;
  ctx.lineWidth = 2;
  ctx.strokeRect(
    x - keyWidth / 2,
    y - keyHeight / 2 - depth,
    keyWidth,
    keyHeight
  );

  // Key text
  ctx.font = "bold 14px monospace";
  ctx.fillStyle = pressed ? colors.primary : colors.secondary;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(keyText, x, y - depth);

  // Press indicator
  if (pressed) {
    ctx.beginPath();
    ctx.arc(x, y + keyHeight / 2 + 10, 6, 0, Math.PI * 2);
    ctx.fillStyle = colors.primary;
    ctx.fill();
  }
}

/**
 * Render GO_TO_STATE action animation - state transition indicator
 */
export function renderGoToStateAnimation(
  ctx: CanvasRenderingContext2D,
  config: ActionAnimationConfig,
  progress: number,
  canvasCenter?: { x: number; y: number }
): void {
  // Use endPosition if available, otherwise use canvasCenter
  const position = config.endPosition || canvasCenter;
  if (!position) return;

  const { x, y } = position;
  const colors = ACTION_CATEGORY_COLORS.state;
  const stateNames =
    config.targetStateIds?.join(", ") || config.label || "State";

  // Expanding circle
  const maxRadius = 60;
  const radius = maxRadius * progress;
  const opacity = 1 - progress * 0.5;

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(249, 115, 22, ${opacity})`;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Inner glow
  ctx.beginPath();
  ctx.arc(x, y, 15, 0, Math.PI * 2);
  ctx.fillStyle = colors.bg;
  ctx.fill();
  ctx.strokeStyle = colors.primary;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Arrow icon
  ctx.font = "bold 16px sans-serif";
  ctx.fillStyle = colors.primary;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("→", x, y);

  // State name
  ctx.font = "bold 12px sans-serif";
  ctx.fillStyle = colors.secondary;
  ctx.textBaseline = "top";
  ctx.fillText(stateNames, x, y + 25);
}

/**
 * Render non-visual action indicator (SET_VARIABLE, CODE_BLOCK, etc.)
 */
export function renderNonVisualActionIndicator(
  ctx: CanvasRenderingContext2D,
  config: ActionAnimationConfig,
  progress: number,
  canvasCenter: { x: number; y: number }
): void {
  const { x, y } = canvasCenter;
  const colors = ACTION_CATEGORY_COLORS[config.category];
  const label = config.label || config.name || config.type;

  // Fade in/out
  const opacity =
    progress < 0.2 ? progress * 5 : progress > 0.8 ? (1 - progress) * 5 : 1;

  // Background pill
  ctx.font = "bold 14px sans-serif";
  const textWidth = ctx.measureText(label).width;
  const padding = 16;
  const pillWidth = textWidth + padding * 2 + 30; // Extra for icon
  const pillHeight = 36;

  ctx.fillStyle = `rgba(0, 0, 0, ${0.85 * opacity})`;
  ctx.beginPath();
  ctx.roundRect(
    x - pillWidth / 2,
    y - pillHeight / 2,
    pillWidth,
    pillHeight,
    pillHeight / 2
  );
  ctx.fill();

  // Border
  const r = parseInt(colors.primary.slice(1, 3), 16);
  const g = parseInt(colors.primary.slice(3, 5), 16);
  const b = parseInt(colors.primary.slice(5, 7), 16);
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Icon circle
  ctx.beginPath();
  ctx.arc(x - pillWidth / 2 + 22, y, 10, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
  ctx.fill();

  // Icon symbol based on category
  ctx.font = "bold 12px sans-serif";
  ctx.fillStyle = `rgba(0, 0, 0, ${opacity})`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  let icon = "?";
  switch (config.category) {
    case "data":
      icon = "x";
      break;
    case "code":
      icon = "<>";
      break;
    case "shell":
      icon = "$";
      break;
    case "ai":
      icon = "AI";
      break;
    case "control":
      icon = "⎇";
      break;
    default:
      icon = "•";
  }
  ctx.fillText(icon, x - pillWidth / 2 + 22, y);

  // Label text
  ctx.font = "bold 14px sans-serif";
  ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
  ctx.textAlign = "left";
  ctx.fillText(label, x - pillWidth / 2 + 40, y);
}

/**
 * Render branch indicator (for IF/SWITCH actions)
 */
export function renderBranchIndicator(
  ctx: CanvasRenderingContext2D,
  config: ActionAnimationConfig,
  progress: number,
  canvasCenter: { x: number; y: number }
): void {
  const { x, y } = canvasCenter;
  const colors = ACTION_CATEGORY_COLORS.branch;
  const branchCount = config.branchCount || 2;
  const labels = config.branchLabels || [];

  // Fade in
  const opacity = Math.min(1, progress * 3);

  // Central node
  ctx.beginPath();
  ctx.arc(x, y, 20, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(217, 70, 239, ${0.3 * opacity})`;
  ctx.fill();
  ctx.strokeStyle = `rgba(217, 70, 239, ${opacity})`;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Branch lines
  const angleStep = Math.PI / (branchCount + 1);
  const startAngle = Math.PI / 2 + angleStep;

  for (let i = 0; i < branchCount; i++) {
    const angle = startAngle + angleStep * i;
    const lineLength = 50 + progress * 30;
    const endX = x + Math.cos(angle) * lineLength;
    const endY = y - Math.sin(angle) * lineLength;

    // Line
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = `rgba(217, 70, 239, ${opacity * 0.8})`;
    ctx.lineWidth = 2;
    ctx.stroke();

    // End circle
    ctx.beginPath();
    ctx.arc(endX, endY, 8, 0, Math.PI * 2);
    ctx.fillStyle = colors.primary;
    ctx.fill();

    // Label
    const label = labels[i];
    if (label) {
      ctx.font = "bold 11px sans-serif";
      ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(label, endX, endY - 12);
    }
  }

  // Center icon
  ctx.font = "bold 14px sans-serif";
  ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("?", x, y);
}

// ============================================================================
// Main Render Function
// ============================================================================

/**
 * Render the appropriate animation for an action configuration
 */
export function renderActionAnimation(
  ctx: CanvasRenderingContext2D,
  config: ActionAnimationConfig,
  progress: number,
  canvasCenter: { x: number; y: number }
): void {
  // Handle pseudo-types first
  if (config.type === "BRANCH_START") {
    renderBranchIndicator(ctx, config, progress, canvasCenter);
    return;
  }

  if (config.type === "BRANCH_END") {
    // No visual for branch end
    return;
  }

  // Route to appropriate renderer based on action type
  switch (config.type) {
    case "FIND":
    case "VANISH":
    case "RAG_FIND":
      // FIND requires targetRegion
      if (config.targetRegion) {
        renderFindAnimation(ctx, config, progress);
      } else {
        renderNonVisualActionIndicator(ctx, config, progress, canvasCenter);
      }
      break;

    case "CLICK":
    case "MOUSE_DOWN":
    case "MOUSE_UP":
      renderClickAnimation(ctx, config, progress, canvasCenter);
      break;

    case "MOUSE_MOVE":
      // MOUSE_MOVE requires both start and end positions
      if (config.startPosition && config.endPosition) {
        renderMouseMoveAnimation(ctx, config, progress);
      } else {
        renderNonVisualActionIndicator(ctx, config, progress, canvasCenter);
      }
      break;

    case "DRAG":
      // DRAG requires both start and end positions
      if (config.startPosition && config.endPosition) {
        renderDragAnimation(ctx, config, progress);
      } else {
        renderNonVisualActionIndicator(ctx, config, progress, canvasCenter);
      }
      break;

    case "SCROLL":
      renderScrollAnimation(ctx, config, progress, canvasCenter);
      break;

    case "TYPE":
      renderTypeAnimation(ctx, config, progress, canvasCenter);
      break;

    case "KEY_PRESS":
    case "KEY_DOWN":
    case "KEY_UP":
    case "HOTKEY":
      renderKeyPressAnimation(ctx, config, progress, canvasCenter);
      break;

    case "GO_TO_STATE":
      renderGoToStateAnimation(ctx, config, progress, canvasCenter);
      break;

    default:
      // Non-visual actions get an indicator
      renderNonVisualActionIndicator(ctx, config, progress, canvasCenter);
  }
}
