export interface GraphCanvasTransform {
  panX: number;
  panY: number;
  zoom: number;
  viewBoxWidth: number;
  viewBoxHeight: number;
  clientWidth: number;
  clientHeight: number;
}

export interface GraphCanvasHitTarget {
  id: string;
  x: number;
  y: number;
  radius: number;
}

export interface GraphCanvasViewportTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function getGraphCanvasViewportTransform(transform: GraphCanvasTransform): GraphCanvasViewportTransform {
  const scale = Math.min(
    transform.clientWidth / Math.max(1, transform.viewBoxWidth),
    transform.clientHeight / Math.max(1, transform.viewBoxHeight)
  );
  const renderedWidth = transform.viewBoxWidth * scale;
  const renderedHeight = transform.viewBoxHeight * scale;
  return {
    scale,
    offsetX: (transform.clientWidth - renderedWidth) / 2,
    offsetY: (transform.clientHeight - renderedHeight) / 2,
  };
}

export function clientPointToGraphPoint(
  clientX: number,
  clientY: number,
  rectLeft: number,
  rectTop: number,
  transform: GraphCanvasTransform
): { x: number; y: number } {
  const viewport = getGraphCanvasViewportTransform(transform);
  const viewX = (clientX - rectLeft - viewport.offsetX) / Math.max(0.001, viewport.scale);
  const viewY = (clientY - rectTop - viewport.offsetY) / Math.max(0.001, viewport.scale);
  return {
    x: (viewX - transform.panX) / transform.zoom,
    y: (viewY - transform.panY) / transform.zoom,
  };
}

export function hitTestGraphCanvasNode(
  point: { x: number; y: number },
  targets: GraphCanvasHitTarget[]
): GraphCanvasHitTarget | null {
  let best: GraphCanvasHitTarget | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const target of targets) {
    const distance = Math.hypot(point.x - target.x, point.y - target.y);
    if (distance > target.radius || distance >= bestDistance) {
      continue;
    }

    best = target;
    bestDistance = distance;
  }

  return best;
}
