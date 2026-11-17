// --- Domain Types for M.O.G.N.U. (SIGMA-2.0 Evolution) ---

export type AnalysisMode = 'kinematics' | 'geometry' | 'duplex';

export interface Point {
  x: number;
  y: number;
  t?: number;
}

export interface LineSegment {
  points: Point[];
  nodesVisited: number[];
  type: string;
}

export interface KinematicPeak {
  dnIdx: number;
  peakIdx: number;
  upIdx: number;
  t: number;
  v: number;
}

export interface KinematicPause {
  startIdx: number;
  endIdx: number;
  tStart: number;
  tEnd: number;
  durationMs: number;
}

export interface KinematicSegment {
  startIdx: number;
  endIdx: number;
  tStart: number;
  tEnd: number;
  durationMs: number;
  lengthPx: number;
  lengthMm: number;
  angleDeg: number;
  isOutsideBox: boolean;
  peakVelocityPxS?: number;
  meanVelocityPxS?: number;
}

export interface KinematicMetrics {
  durationMs: number;
  durationS: number;
  movementTimeMs: number;
  movementTimeS: number;
  movementTimeRatio?: number;
  pauseTimeMs: number;
  pauseTimeS: number;
  pauseCount: number;
  maxPauseMs: number;
  maxPauseS: number;
  peakVelocityPxMs: number;
  peakVelocityMmS: number;
  peakVelocityPxS?: number;
  avgVelocityPxMs: number;
  meanVelocityPxS?: number;
  totalPathPx: number;
  totalPathMm: number;
  isOutsideBox: boolean;
  outsideBoxTimeMs?: number;
  outsideBoxTimeS?: number;
  segmentsCount: number;
  segmentCount?: number;
}

export interface TrialKinematics {
  t: number[];          // interpolated 1 ms time grid
  x: number[];          // 15 Hz filtered X
  y: number[];          // 15 Hz filtered Y
  vt: number[];         // instantaneous velocity profile (15 Hz)
  peaks: KinematicPeak[];
  pauses: KinematicPause[];
  segments: KinematicSegment[];
  metrics: KinematicMetrics;
}

export interface ProcessedTrial {
  subjectId: string;
  trialId: string | number;
  points: Point[];
  basePoints?: Point[];
  smoothedPoints: Point[];
  startPoint: Point;
  lines: LineSegment[];
  breakPoints: Point[];
  trial_time_ms: number;
  kinematics?: TrialKinematics;
}

export interface GridNode {
  id: number;
  x: number;
  y: number;
  rawX: number;
  rawY: number;
  w: number;
  h: number;
}

export interface Calibration {
  offsetX: number;
  offsetY: number;
  scale: number;
  hitPadding: number;
}

export interface SubjectData {
  id: string;
  nodes: GridNode[];
  cellSize: { w: number; h: number };
  calibration: Calibration;
  isSolved?: boolean;
  lastName: string;
  firstName: string;
  age: string;
  experience: string;
  gender: string;
  solvedBefore?: string;
  insight?: string;
  totalTaskTime?: number;
  surveyScales?: Record<string, number>;
  group?: string;
}

export interface HeatPoint {
  x: number;
  y: number;
  subjectId: string;
  trialId: string | number;
}

export interface HeatLine {
  points: { x: number; y: number }[];
  subjectId: string;
  trialId: string | number;
}

export interface CSVParseMetadata {
  lastName: string;
  firstName: string;
  age: string;
  gender: string;
  solvedBefore: string;
  insight: string;
  totalTaskTime?: number;
  surveyScales: Record<string, number>;
  group: string;
}

export interface CSVParseResult {
  trials: ProcessedTrial[];
  nodes: GridNode[];
  cellSize: { w: number; h: number };
  metadata: CSVParseMetadata;
}
