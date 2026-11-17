// --- Domain Types for 9-Dots Research Lab (SIGMA-2.0) ---

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
