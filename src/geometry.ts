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

/**
 * Checks whether a given point falls inside a grid node's ellipse of attraction (AoI).
 */
export const isPointInNode = (p: Point, node: GridNode, hitPadding = 15): boolean => {
  const rx = (node.w / 2) + hitPadding;
  const ry = (node.h / 2) + hitPadding;
  const dx = (p.x - node.x) / rx;
  const dy = (p.y - node.y) / ry;
  return (dx * dx + dy * dy) <= 1.0;
};

/**
 * Checks whether a given point falls inside ANY grid node in the matrix.
 */
export const isPointInAnyNode = (p: Point, nodes: GridNode[], hitPadding = 15): boolean => {
  return nodes.some(node => isPointInNode(p, node, hitPadding));
};

/**
 * Computes total cumulative Euclidean path length in pixels along a sequence of points.
 */
export const getLineLengthPx = (points: Point[]): number => {
  if (!points || points.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < points.length - 1; i++) {
    sum += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  }
  return sum;
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

export type TargetZoneId = 'TR_H' | 'TR_V' | 'BR_H' | 'BR_V' | 'BL_H' | 'BL_V' | 'TL_H' | 'TL_V';

export interface TargetZoneInfo {
  id: TargetZoneId;
  name: string;
  x: number;
  y: number;
}

export interface ApexOvershootResult {
  hasExit: boolean;
  activeZoneId: TargetZoneId | null;
  activeZoneName: string | null;
  turnPoint: Point | null;
  startPoint: Point | null;
  overshootPx: number;
  deltaL: number;
  absDeltaL: number;
  status: 'hit' | 'undershoot' | 'overshoot' | 'inside';
}

export const TARGET_ZONES_DEF: { id: TargetZoneId; name: string }[] = [
  { id: 'TR_H', name: 'Справа-сверху (гор.)' },
  { id: 'TR_V', name: 'Сверху-справа (верт.)' },
  { id: 'BR_H', name: 'Справа-снизу (гор.)' },
  { id: 'BR_V', name: 'Снизу-справа (верт.)' },
  { id: 'BL_H', name: 'Слева-снизу (гор.)' },
  { id: 'BL_V', name: 'Снизу-слева (верт.)' },
  { id: 'TL_H', name: 'Слева-сверху (гор.)' },
  { id: 'TL_V', name: 'Сверху-слева (верт.)' }
];

export const getTargetZones = (nodes: GridNode[], step = 116, boxPadding = 15): TargetZoneInfo[] => {
  if (!nodes || nodes.length < 9) return [];
  const xs = nodes.map(n => n.x);
  const ys = nodes.map(n => n.y);
  const rawMinX = Math.min(...xs);
  const rawMaxX = Math.max(...xs);
  const rawMinY = Math.min(...ys);
  const rawMaxY = Math.max(...ys);

  const minX = rawMinX - boxPadding;
  const maxX = rawMaxX + boxPadding;
  const minY = rawMinY - boxPadding;
  const maxY = rawMaxY + boxPadding;

  return [
    { id: 'TR_H', name: 'Справа-сверху (гор.)', x: maxX + step, y: rawMinY },
    { id: 'TR_V', name: 'Сверху-справа (верт.)', x: rawMaxX, y: minY - step },
    { id: 'BR_H', name: 'Справа-снизу (гор.)', x: maxX + step, y: rawMaxY },
    { id: 'BR_V', name: 'Снизу-справа (верт.)', x: rawMaxX, y: maxY + step },
    { id: 'BL_H', name: 'Слева-снизу (гор.)', x: minX - step, y: rawMaxY },
    { id: 'BL_V', name: 'Снизу-слева (верт.)', x: rawMinX, y: maxY + step },
    { id: 'TL_H', name: 'Слева-сверху (гор.)', x: minX - step, y: rawMinY },
    { id: 'TL_V', name: 'Сверху-слева (верт.)', x: rawMinX, y: minY - step }
  ];
};

export interface ApexExtractionOptions {
  idealStep?: number;       // default 116.0
  tolerance?: number;       // default 65.0 (Variant 1: [51 .. 181 px])
  boxPadding?: number;      // default 15.0 (ручной отступ перцептивного квадрата от точек)
  isSolvedTrial?: boolean;  // whether this trial solves the problem
  solveOverride?: boolean;  // Option 1: if true and isSolvedTrial -> error = 0, status = 'hit'
  capMaxError?: boolean;    // Option 3: if true -> absDeltaL capped at idealStep (baseline penalty)
  overrideZoneId?: TargetZoneId | null; // Manual override: clicked target zone circle
}

export const extractTrialApexOvershoot = (
  trial: ProcessedTrial,
  nodes: GridNode[],
  idealStepOrOptions?: number | ApexExtractionOptions,
  toleranceParam = 65.0,
  isSolvedTrialParam = false,
  solveOverrideParam = false,
  capMaxErrorParam = false,
  boxPaddingParam = 15.0,
  overrideZoneIdParam: TargetZoneId | null = null
): ApexOvershootResult => {
  let idealStep = 116.0;
  let tolerance = 65.0;
  let boxPadding = 15.0;
  let isSolvedTrial = false;
  let solveOverride = false;
  let capMaxError = false;
  let overrideZoneId: TargetZoneId | null = null;

  if (typeof idealStepOrOptions === 'object' && idealStepOrOptions !== null) {
    idealStep = idealStepOrOptions.idealStep ?? 116.0;
    tolerance = idealStepOrOptions.tolerance ?? 65.0;
    boxPadding = idealStepOrOptions.boxPadding ?? 15.0;
    isSolvedTrial = !!idealStepOrOptions.isSolvedTrial;
    solveOverride = !!idealStepOrOptions.solveOverride;
    capMaxError = !!idealStepOrOptions.capMaxError;
    overrideZoneId = idealStepOrOptions.overrideZoneId ?? null;
  } else {
    if (typeof idealStepOrOptions === 'number') idealStep = idealStepOrOptions;
    tolerance = toleranceParam;
    isSolvedTrial = isSolvedTrialParam;
    solveOverride = solveOverrideParam;
    capMaxError = capMaxErrorParam;
    boxPadding = boxPaddingParam;
    overrideZoneId = overrideZoneIdParam;
  }

  const defaultNoExit: ApexOvershootResult = {
    hasExit: false,
    activeZoneId: null,
    activeZoneName: null,
    turnPoint: null,
    startPoint: null,
    overshootPx: 0,
    deltaL: (isSolvedTrial && solveOverride) ? 0 : -idealStep,
    absDeltaL: (isSolvedTrial && solveOverride) ? 0 : idealStep,
    status: (isSolvedTrial && solveOverride) ? 'hit' : 'inside'
  };

  if (!trial || !trial.lines || trial.lines.length === 0 || !nodes || nodes.length < 9) {
    return defaultNoExit;
  }

  const xs = nodes.map(n => n.x);
  const ys = nodes.map(n => n.y);
  const rawMinX = Math.min(...xs);
  const rawMaxX = Math.max(...xs);
  const rawMinY = Math.min(...ys);
  const rawMaxY = Math.max(...ys);

  // Perceptual bounding square boundaries with manual/custom padding (default 15px from outer pixels)
  const minX = rawMinX - boxPadding;
  const maxX = rawMaxX + boxPadding;
  const minY = rawMinY - boxPadding;
  const maxY = rawMaxY + boxPadding;
  const midX = (rawMinX + rawMaxX) / 2;
  const midY = (rawMinY + rawMaxY) / 2;

  // Margin for checking starting inside (within the padded perceptual square)
  const insideMargin = 10;
  // Threshold to consider a point definitely outside the perceptual square
  const exitMargin = 5;

  interface CandidateExit {
    lineIndex: number;
    startPoint: Point;
    endPoint: Point;
    activeZoneId: TargetZoneId;
    overshootPx: number;
  }

  const candidateExits: CandidateExit[] = [];

  trial.lines.forEach((line, lineIdx) => {
    if (!line.points || line.points.length < 2) return;

    const pStart = line.points[0];
    const pEnd = line.points[line.points.length - 1];

    // Condition 1: Line must start INSIDE the perceptual square (within dots area + padding)
    const startsInside =
      pStart.x >= minX - insideMargin &&
      pStart.x <= maxX + insideMargin &&
      pStart.y >= minY - insideMargin &&
      pStart.y <= maxY + insideMargin;

    if (!startsInside) {
      // Per user rule: If line started outside the square, do not count it
      return;
    }

    // Condition 2: Line end point must be OUTSIDE the perceptual square
    const isEndOutside =
      pEnd.x > maxX + exitMargin ||
      pEnd.x < minX - exitMargin ||
      pEnd.y > maxY + exitMargin ||
      pEnd.y < minY - exitMargin;

    if (!isEndOutside) return;

    // Movement vector from line start to end
    const dx = pEnd.x - pStart.x;
    const dy = pEnd.y - pStart.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    let zoneId: TargetZoneId;
    let overshootPx = 0;

    // Determine direction: horizontal vs vertical
    if (absDx >= absDy) {
      // Horizontal motion
      if (dx > 0) {
        // Rightward exit
        zoneId = pEnd.y <= midY ? 'TR_H' : 'BR_H';
        overshootPx = Math.max(0, pEnd.x - maxX);
      } else {
        // Leftward exit
        zoneId = pEnd.y <= midY ? 'TL_H' : 'BL_H';
        overshootPx = Math.max(0, minX - pEnd.x);
      }
    } else {
      // Vertical motion
      if (dy < 0) {
        // Upward exit
        zoneId = pEnd.x <= midX ? 'TL_V' : 'TR_V';
        overshootPx = Math.max(0, minY - pEnd.y);
      } else {
        // Downward exit
        zoneId = pEnd.x <= midX ? 'BL_V' : 'BR_V';
        overshootPx = Math.max(0, pEnd.y - maxY);
      }
    }

    if (overshootPx > 5) {
      candidateExits.push({
        lineIndex: lineIdx,
        startPoint: pStart,
        endPoint: pEnd,
        activeZoneId: zoneId,
        overshootPx
      });
    }
  });

  let bestExit: CandidateExit | null = null;

  if (overrideZoneId) {
    // 1. Try to find a candidate exit that matches overrideZoneId
    const matching = candidateExits.find(c => c.activeZoneId === overrideZoneId);
    if (matching) {
      bestExit = matching;
    } else {
      // 2. Compute overshoot directly relative to overrideZoneId across all line endpoints
      let bestDist = 0;
      let bestLineIdx = 0;
      let bestStart = trial.lines[0]?.points[0] || { x: minX, y: minY };
      let bestEnd = trial.lines[0]?.points[trial.lines[0].points.length - 1] || { x: minX, y: minY };

      trial.lines.forEach((line, lIdx) => {
        if (!line.points || line.points.length < 2) return;
        const pS = line.points[0];
        const pE = line.points[line.points.length - 1];
        let os = 0;

        switch (overrideZoneId) {
          case 'TR_H': case 'BR_H':
            os = Math.max(0, pE.x - maxX); break;
          case 'TL_H': case 'BL_H':
            os = Math.max(0, minX - pE.x); break;
          case 'TR_V': case 'TL_V':
            os = Math.max(0, minY - pE.y); break;
          case 'BR_V': case 'BL_V':
            os = Math.max(0, pE.y - maxY); break;
        }

        if (os >= bestDist) {
          bestDist = os;
          bestLineIdx = lIdx;
          bestStart = pS;
          bestEnd = pE;
        }
      });

      bestExit = {
        lineIndex: bestLineIdx,
        startPoint: bestStart,
        endPoint: bestEnd,
        activeZoneId: overrideZoneId,
        overshootPx: bestDist
      };
    }
  } else {
    if (candidateExits.length === 0) {
      return defaultNoExit;
    }
    // Pick candidate with greatest overshoot (primary apex probe)
    candidateExits.sort((a, b) => b.overshootPx - a.overshootPx);
    bestExit = candidateExits[0];
  }

  if (!bestExit) {
    return defaultNoExit;
  }

  const overshootPx = Math.round(bestExit.overshootPx);
  let deltaL = Math.round(overshootPx - idealStep);
  let absDeltaL = Math.abs(deltaL);

  let status: 'hit' | 'undershoot' | 'overshoot' | 'inside' = 'inside';

  // Option 1: Solve Override (solving the task overrides apex error to 0)
  if (isSolvedTrial && solveOverride) {
    absDeltaL = 0;
    deltaL = 0;
    status = 'hit';
  } else {
    // Option 3: Cap Max Error at baseline step (a large exploratory probe is not penalized more than non-exit)
    if (capMaxError && absDeltaL > idealStep) {
      absDeltaL = idealStep;
    }

    if (absDeltaL <= tolerance) {
      status = 'hit';
    } else if (deltaL < -tolerance) {
      status = 'undershoot';
    } else {
      status = 'overshoot';
    }
  }

  const zoneDef = TARGET_ZONES_DEF.find(z => z.id === bestExit!.activeZoneId);

  return {
    hasExit: true,
    activeZoneId: bestExit.activeZoneId,
    activeZoneName: zoneDef ? zoneDef.name : bestExit.activeZoneId,
    turnPoint: bestExit.endPoint,
    startPoint: bestExit.startPoint,
    overshootPx,
    deltaL,
    absDeltaL,
    status
  };
};
