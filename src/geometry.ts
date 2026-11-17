import { Point, LineSegment, ProcessedTrial, GridNode, Calibration } from './types';
import { analyzeKinematics } from './kinematics';

export const CANVAS_SIZE = 800;
export const DOT_RADIUS = 6;
export const ANGLE_THRESHOLD_SPLIT = 30; // Threshold for bend detection (degrees)
export const MIN_LINE_LENGTH = 100;      // Minimum length to be considered a valid line (pixels)
export const LOOKAHEAD_MIN_LENGTH = 50;   // Minimum length after bend to justify a split (pixels)
export const SMOOTHING_WINDOW = 3;

export const computeGridBoundingBox = (
  nodes: GridNode[],
  paddingX = 49,
  paddingY = 54
): { xl: number; xr: number; yu: number; yd: number } => {
  if (!nodes || nodes.length === 0) return { xl: 0, xr: CANVAS_SIZE, yu: 0, yd: CANVAS_SIZE };
  const xs = nodes.map(n => n.x);
  const ys = nodes.map(n => n.y);
  return {
    xl: Math.min(...xs) - paddingX + 20,
    xr: Math.max(...xs) + paddingX + 20,
    yu: Math.min(...ys) - paddingY + 23,
    yd: Math.max(...ys) + paddingY + 23
  };
};

export const smoothPoints = (points: Point[], windowSize: number): Point[] => {
  if (points.length < windowSize) return points;
  const smoothed: Point[] = [];
  const half = Math.floor(windowSize / 2);
  const len = points.length;

  for (let i = 0; i < len; i++) {
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    const start = Math.max(0, i - half);
    const end = Math.min(len - 1, i + half);
    for (let j = start; j <= end; j++) {
      const p = points[j];
      if (p) {
        sumX += p.x;
        sumY += p.y;
        count++;
      }
    }
    smoothed.push({ x: sumX / count, y: sumY / count, t: points[i].t });
  }
  return smoothed;
};

export const getAngle = (p1?: Point, p2?: Point, p3?: Point): number => {
  if (!p1 || !p2 || !p3) return 0;
  const v1 = { x: p2.x - p1.x, y: p2.y - p1.y };
  const v2 = { x: p3.x - p2.x, y: p3.y - p2.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
  const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
  if (mag1 < 0.001 || mag2 < 0.001) return 0;
  const cos = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
  return (Math.acos(cos) * 180) / Math.PI;
};

export const calculateDistance = (p1: Point, p2: Point): number => {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
};

export const distToSegment = (p: Point, a: Point, b: Point): number => {
  const l2 = Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2);
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
};

export const classifyLine = (nodesVisited: number[]): string => {
  const nodes = Array.from(new Set(nodesVisited)).sort((a, b) => a - b);

  if (nodes.length === 0) return 'внешняя';
  if (nodes.length === 1) return 'касательная';

  const isSubsetOfPattern = (pattern: number[]) =>
    nodes.length >= 2 && nodes.every(n => pattern.includes(n));

  const sides = [[1, 2, 3], [1, 4, 7], [7, 8, 9], [3, 6, 9]];
  if (sides.some(isSubsetOfPattern)) return 'боковая';

  const diagonals = [[1, 5, 9], [3, 5, 7]];
  if (diagonals.some(isSubsetOfPattern)) return 'диагональная';

  const central = [[2, 5, 8], [4, 5, 6]];
  if (central.some(isSubsetOfPattern)) return 'центральная';

  const chords = [[2, 4], [2, 6], [6, 8], [4, 8]];
  if (chords.some(isSubsetOfPattern)) return 'хордовая';

  const longChords = [[1, 8], [3, 8], [1, 6], [7, 6], [4, 9], [3, 4], [2, 7], [2, 9]];
  if (longChords.some(isSubsetOfPattern)) return 'хорды_длинные';

  return 'прочая';
};

export const performSegmentation = (
  points: Point[],
  angle: number,
  minLen: number,
  lookaheadMinLen = LOOKAHEAD_MIN_LENGTH
): { lines: { points: Point[] }[]; breakPoints: Point[]; smoothed: Point[] } => {
  const smoothed = smoothPoints(points, SMOOTHING_WINDOW);
  const breakIndices: number[] = [0];
  const windowSize = 3;

  // Precompute cumulative distances for O(1) lookahead calculation
  const cumDist = new Float64Array(smoothed.length);
  for (let m = 1; m < smoothed.length; m++) {
    cumDist[m] = cumDist[m - 1] + calculateDistance(smoothed[m - 1], smoothed[m]);
  }

  for (let i = windowSize; i < smoothed.length - windowSize; i++) {
    const ang = getAngle(smoothed[i - windowSize], smoothed[i], smoothed[i + windowSize]);

    if (ang >= angle) {
      let nextSplitIdx = smoothed.length - 1;
      for (let j = i + 1; j < smoothed.length - windowSize; j++) {
        const nextAngle = getAngle(smoothed[j - windowSize], smoothed[j], smoothed[j + windowSize]);
        if (nextAngle >= angle) {
          nextSplitIdx = j;
          break;
        }
      }

      const distToNext = cumDist[nextSplitIdx] - cumDist[i];

      if (distToNext >= lookaheadMinLen) {
        if (i - breakIndices[breakIndices.length - 1] > windowSize) {
          breakIndices.push(i);
        }
      }
    }
  }
  breakIndices.push(smoothed.length - 1);

  const lines: { points: Point[] }[] = [];
  const breakPoints: Point[] = [];

  for (let k = 0; k < breakIndices.length - 1; k++) {
    const start = breakIndices[k];
    const end = breakIndices[k + 1];
    const segPoints = smoothed.slice(start, end + 1);
    if (segPoints.length < 2) continue;

    const segLength = cumDist[end] - cumDist[start];
    if (segLength < minLen) continue;

    lines.push({ points: segPoints });

    if (k > 0) breakPoints.push(smoothed[start]);
  }
  return { lines, breakPoints, smoothed };
};

export const recalculateLineNodes = (
  rawLines: { points: Point[] }[],
  nodes: GridNode[],
  hitPadding: number
): LineSegment[] => {
  return rawLines.map(line => {
    const visited: number[] = [];
    for (let i = 0; i < line.points.length - 1; i++) {
      const p1 = line.points[i];
      const p2 = line.points[i + 1];
      nodes.forEach(node => {
        const rx = (node.w / 2) + (hitPadding ?? 15);
        const ry = (node.h / 2) + (hitPadding ?? 15);
        const d = distToSegment(
          { x: node.x / rx, y: node.y / ry },
          { x: p1.x / rx, y: p1.y / ry },
          { x: p2.x / rx, y: p2.y / ry }
        );
        if (d <= 1.0) {
          if (visited[visited.length - 1] !== node.id) visited.push(node.id);
        }
      });
    }
    return {
      points: line.points,
      nodesVisited: visited,
      type: classifyLine(visited)
    };
  });
};

export const calibrateTrial = (
  trial: ProcessedTrial,
  cal: Calibration,
  nodes: GridNode[],
  angle: number,
  minLen: number
): ProcessedTrial => {
  const basePoints = trial.basePoints || trial.points;
  const { offsetX, offsetY, scale, hitPadding } = cal;
  const center = CANVAS_SIZE / 2;

  const calibratedPoints: Point[] = basePoints.map(p => ({
    x: center + (p.x - center) * scale + offsetX,
    y: center + (p.y - center) * scale + offsetY,
    t: p.t
  }));

  const { lines, breakPoints, smoothed } = performSegmentation(calibratedPoints, angle, minLen);
  const updatedLines = recalculateLineNodes(lines, nodes, hitPadding);

  // Compute kinematics with calibrated coordinates and node bounding box
  const bbox = computeGridBoundingBox(nodes);
  const kinematics = analyzeKinematics(calibratedPoints, bbox);

  return {
    ...trial,
    basePoints,
    points: calibratedPoints,
    smoothedPoints: smoothed,
    startPoint: calibratedPoints[0] || trial.startPoint,
    breakPoints,
    lines: updatedLines,
    kinematics
  };
};
