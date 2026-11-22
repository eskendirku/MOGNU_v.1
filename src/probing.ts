import { ProcessedTrial, GridNode, SubjectData, ApexTargetConfig, TargetZoneId } from './types';
import { extractTrialApexOvershoot } from './geometry';

export interface ProbingPoint {
  trialId: string | number;
  trialNum: number;
  overshootPx: number;
  deltaL: number;
  absDeltaL: number;
  status: 'hit' | 'undershoot' | 'overshoot' | 'inside';
  isExcluded: boolean;
  hasChordLine: boolean;
  activeZoneName?: string | null;
}

export interface LinearRegressionResult {
  slope: number;
  rSquared: number;
}

export interface SubjectProbingMetrics {
  points: ProbingPoint[];
  validCount: number;
  slope: number;
  rSquared: number;
  avgErrorFirstThird: number;
  avgErrorLastThird: number;
  meanDeltaL: number;
  meanAbsDeltaL: number;
  corridorHitCount: number;
  corridorHitRatio: number;
}

export interface PopulationProbingPoint {
  trialNum: number;
  avgError: number;
  count: number;
}

export interface PopulationProbingSeries {
  solversCount: number;
  points: PopulationProbingPoint[];
  slope: number;
  rSquared: number;
  avgFirstThird: number;
  avgLastThird: number;
}

export interface GroupProbingSeries {
  groupName: string;
  color: { stroke: string; fill: string };
  solversCount: number;
  points: PopulationProbingPoint[];
  slope: number;
  rSquared: number;
}

/**
 * Calculates Ordinary Least Squares (OLS) linear regression slope and R²
 * over a collection of 2D data points.
 */
export function calculateOLS(points: { x: number; y: number }[]): LinearRegressionResult {
  if (!points || points.length <= 1) {
    return { slope: 0, rSquared: 0 };
  }

  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;

  for (let i = 0; i < n; i++) {
    const pt = points[i];
    sumX += pt.x;
    sumY += pt.y;
    sumXY += pt.x * pt.y;
    sumXX += pt.x * pt.x;
    sumYY += pt.y * pt.y;
  }

  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) {
    return { slope: 0, rSquared: 0 };
  }

  const slope = (n * sumXY - sumX * sumY) / denom;
  const numR = n * sumXY - sumX * sumY;
  const denR = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
  const rSquared = denR !== 0 ? Math.pow(numR / denR, 2) : 0;

  return { slope, rSquared };
}

/**
 * Computes mean values for the first third and last third of a numeric series.
 */
export function computeThirdsAverages(values: number[]): { firstThird: number; lastThird: number } {
  if (!values || values.length === 0) {
    return { firstThird: 0, lastThird: 0 };
  }

  const thirdSize = Math.max(1, Math.floor(values.length / 3));
  const firstSlice = values.slice(0, thirdSize);
  const lastSlice = values.slice(values.length - thirdSize);

  const firstThird = firstSlice.length > 0
    ? firstSlice.reduce((s, v) => s + v, 0) / firstSlice.length
    : 0;

  const lastThird = lastSlice.length > 0
    ? lastSlice.reduce((s, v) => s + v, 0) / lastSlice.length
    : 0;

  return { firstThird, lastThird };
}

/**
 * Computes trial-by-trial probing points and overall convergence metrics
 * for a single participant.
 */
export function calculateSubjectProbingMetrics(
  trials: ProcessedTrial[],
  nodes: GridNode[],
  options: {
    subjectId: string;
    apexConfig?: ApexTargetConfig;
    isCurrentSubjectSolved?: boolean;
    excludedTrials?: Set<string>;
    manualZoneOverrides?: Record<string, TargetZoneId>;
    globalBoxPadding?: number;
  }
): SubjectProbingMetrics {
  const empty: SubjectProbingMetrics = {
    points: [],
    validCount: 0,
    slope: 0,
    rSquared: 0,
    avgErrorFirstThird: 0,
    avgErrorLastThird: 0,
    meanDeltaL: 0,
    meanAbsDeltaL: 0,
    corridorHitCount: 0,
    corridorHitRatio: 0
  };

  if (!trials || trials.length === 0 || !nodes || nodes.length < 9) {
    return empty;
  }

  const {
    subjectId,
    apexConfig,
    isCurrentSubjectSolved = false,
    excludedTrials = new Set(),
    manualZoneOverrides = {},
    globalBoxPadding = 15.0
  } = options;

  const idealOvershoot = apexConfig?.idealOvershoot ?? 116.0;
  const toleranceMargin = apexConfig?.toleranceMargin ?? 65.0;
  const solveOverride = !!apexConfig?.solveOverride;
  const capMaxError = !!apexConfig?.capMaxError;

  const points: ProbingPoint[] = [];

  trials.forEach((t, idx) => {
    const isExcluded = excludedTrials.has(`${subjectId}-${t.trialId}`);
    const isSolutionTrial = (idx === trials.length - 1) && !!isCurrentSubjectSolved;
    const trialKey = `${subjectId}-${t.trialId}`;
    const manualOverrideZone = manualZoneOverrides[trialKey] || null;

    const apexRes = extractTrialApexOvershoot(t, nodes, {
      idealStep: idealOvershoot,
      tolerance: toleranceMargin,
      boxPadding: globalBoxPadding,
      isSolvedTrial: isSolutionTrial,
      solveOverride,
      capMaxError,
      overrideZoneId: manualOverrideZone
    });

    const hasChord = t.lines.some(l => l.type === 'хордовая');

    points.push({
      trialId: t.trialId,
      trialNum: idx + 1,
      overshootPx: apexRes.overshootPx,
      deltaL: apexRes.deltaL,
      absDeltaL: apexRes.absDeltaL,
      status: apexRes.status,
      isExcluded,
      hasChordLine: hasChord,
      activeZoneName: apexRes.activeZoneName
    });
  });

  const validPts = points.filter(p => !p.isExcluded);
  const validCount = validPts.length;

  if (validCount === 0) {
    return { ...empty, points };
  }

  // Linear regression
  const ols = calculateOLS(validPts.map(p => ({ x: p.trialNum, y: p.absDeltaL })));

  // First / Last third comparisons
  const thirds = computeThirdsAverages(validPts.map(p => p.absDeltaL));

  // Summary statistics
  const sumDeltaL = validPts.reduce((acc, p) => acc + p.deltaL, 0);
  const sumAbsDeltaL = validPts.reduce((acc, p) => acc + p.absDeltaL, 0);
  const corridorHitCount = validPts.filter(p => p.status === 'hit').length;

  return {
    points,
    validCount,
    slope: ols.slope,
    rSquared: ols.rSquared,
    avgErrorFirstThird: Math.round(thirds.firstThird),
    avgErrorLastThird: Math.round(thirds.lastThird),
    meanDeltaL: +(sumDeltaL / validCount).toFixed(1),
    meanAbsDeltaL: +(sumAbsDeltaL / validCount).toFixed(1),
    corridorHitCount,
    corridorHitRatio: +((corridorHitCount / validCount) * 100).toFixed(1)
  };
}

/**
 * Computes pooled population-level probing convergence across all successful solvers.
 */
export function calculateAllSolversSeries(
  allSubjects: SubjectData[],
  allProcessedData: ProcessedTrial[],
  options: {
    excludedSubjects?: Set<string>;
    excludedTrials?: Set<string>;
    subjectApexConfigs?: Record<string, ApexTargetConfig>;
    manualZoneOverrides?: Record<string, TargetZoneId>;
    globalBoxPadding?: number;
  } = {}
): PopulationProbingSeries {
  const empty: PopulationProbingSeries = {
    solversCount: 0,
    points: [],
    slope: 0,
    rSquared: 0,
    avgFirstThird: 0,
    avgLastThird: 0
  };

  if (!allSubjects || allSubjects.length === 0 || !allProcessedData || allProcessedData.length === 0) {
    return empty;
  }

  const {
    excludedSubjects = new Set(),
    excludedTrials = new Set(),
    subjectApexConfigs = {},
    manualZoneOverrides = {},
    globalBoxPadding = 15.0
  } = options;

  const solvers = allSubjects.filter(s => s.isSolved && !excludedSubjects.has(s.id));
  if (solvers.length === 0) {
    return empty;
  }

  const trialsBySubject = new Map<string, ProcessedTrial[]>();
  allProcessedData.forEach(t => {
    if (excludedTrials.has(`${t.subjectId}-${t.trialId}`)) return;
    if (!trialsBySubject.has(t.subjectId)) trialsBySubject.set(t.subjectId, []);
    trialsBySubject.get(t.subjectId)!.push(t);
  });

  let maxTrials = 0;
  const solverTrialsList: { errorByTrial: Map<number, number> }[] = [];

  solvers.forEach(s => {
    const subTrials = trialsBySubject.get(s.id) || [];
    if (subTrials.length > maxTrials) maxTrials = subTrials.length;

    const subApexConfig = subjectApexConfigs[s.id] || s.apexConfig || {
      idealOvershoot: 116.0,
      toleranceMargin: 65.0,
      solveOverride: false,
      capMaxError: false
    };

    const errorMap = new Map<number, number>();
    subTrials.forEach((t, idx) => {
      const isSolution = (idx === subTrials.length - 1);
      const trialKey = `${s.id}-${t.trialId}`;
      const manualOverrideZone = manualZoneOverrides[trialKey] || null;

      const apexRes = extractTrialApexOvershoot(t, s.nodes, {
        idealStep: subApexConfig.idealOvershoot,
        tolerance: subApexConfig.toleranceMargin,
        boxPadding: globalBoxPadding,
        isSolvedTrial: isSolution,
        solveOverride: !!subApexConfig.solveOverride,
        capMaxError: !!subApexConfig.capMaxError,
        overrideZoneId: manualOverrideZone
      });
      errorMap.set(idx + 1, apexRes.absDeltaL);
    });

    solverTrialsList.push({ errorByTrial: errorMap });
  });

  const points: PopulationProbingPoint[] = [];
  for (let tNum = 1; tNum <= maxTrials; tNum++) {
    let sum = 0;
    let count = 0;
    solverTrialsList.forEach(st => {
      if (st.errorByTrial.has(tNum)) {
        sum += st.errorByTrial.get(tNum)!;
        count++;
      }
    });
    if (count > 0) {
      points.push({ trialNum: tNum, avgError: Math.round(sum / count), count });
    }
  }

  const ols = calculateOLS(points.map(p => ({ x: p.trialNum, y: p.avgError })));
  const thirds = computeThirdsAverages(points.map(p => p.avgError));

  return {
    solversCount: solvers.length,
    points,
    slope: +ols.slope.toFixed(2),
    rSquared: +ols.rSquared.toFixed(2),
    avgFirstThird: Math.round(thirds.firstThird),
    avgLastThird: Math.round(thirds.lastThird)
  };
}

/**
 * Computes probing convergence series grouped by experimental condition.
 */
export function calculateGroupSeries(
  allSubjects: SubjectData[],
  allProcessedData: ProcessedTrial[],
  subjectGroups: Record<string, string> = {},
  options: {
    excludedSubjects?: Set<string>;
    excludedTrials?: Set<string>;
    subjectApexConfigs?: Record<string, ApexTargetConfig>;
    manualZoneOverrides?: Record<string, TargetZoneId>;
    globalBoxPadding?: number;
  } = {}
): GroupProbingSeries[] {
  if (!allSubjects || allSubjects.length === 0 || !allProcessedData || allProcessedData.length === 0) {
    return [];
  }

  const {
    excludedSubjects = new Set(),
    excludedTrials = new Set(),
    subjectApexConfigs = {},
    manualZoneOverrides = {},
    globalBoxPadding = 15.0
  } = options;

  const solvers = allSubjects.filter(s => s.isSolved && !excludedSubjects.has(s.id));
  if (solvers.length === 0) return [];

  const trialsBySubject = new Map<string, ProcessedTrial[]>();
  allProcessedData.forEach(t => {
    if (excludedTrials.has(`${t.subjectId}-${t.trialId}`)) return;
    if (!trialsBySubject.has(t.subjectId)) trialsBySubject.set(t.subjectId, []);
    trialsBySubject.get(t.subjectId)!.push(t);
  });

  const groupsMap = new Map<string, SubjectData[]>();
  solvers.forEach(s => {
    const gName = subjectGroups[s.id] || s.group || 'Без группы';
    if (!groupsMap.has(gName)) groupsMap.set(gName, []);
    groupsMap.get(gName)!.push(s);
  });

  const colors = [
    { stroke: '#10b981', fill: '#10b981' }, // Emerald
    { stroke: '#a855f7', fill: '#a855f7' }, // Purple
    { stroke: '#f59e0b', fill: '#f59e0b' }, // Amber
    { stroke: '#38bdf8', fill: '#38bdf8' }, // Sky
    { stroke: '#f43f5e', fill: '#f43f5e' }, // Rose
    { stroke: '#06b6d4', fill: '#06b6d4' }  // Cyan
  ];

  const results: GroupProbingSeries[] = [];
  let colorIdx = 0;

  groupsMap.forEach((gSolvers, gName) => {
    let maxTrials = 0;
    const solverTrialsList: { errorByTrial: Map<number, number> }[] = [];

    gSolvers.forEach(s => {
      const subTrials = trialsBySubject.get(s.id) || [];
      if (subTrials.length > maxTrials) maxTrials = subTrials.length;

      const subApexConfig = subjectApexConfigs[s.id] || s.apexConfig || {
        idealOvershoot: 116.0,
        toleranceMargin: 65.0,
        solveOverride: false,
        capMaxError: false
      };

      const errorMap = new Map<number, number>();
      subTrials.forEach((t, idx) => {
        const isSolution = (idx === subTrials.length - 1);
        const trialKey = `${s.id}-${t.trialId}`;
        const manualOverrideZone = manualZoneOverrides[trialKey] || null;

        const apexRes = extractTrialApexOvershoot(t, s.nodes, {
          idealStep: subApexConfig.idealOvershoot,
          tolerance: subApexConfig.toleranceMargin,
          boxPadding: globalBoxPadding,
          isSolvedTrial: isSolution,
          solveOverride: !!subApexConfig.solveOverride,
          capMaxError: !!subApexConfig.capMaxError,
          overrideZoneId: manualOverrideZone
        });
        errorMap.set(idx + 1, apexRes.absDeltaL);
      });

      solverTrialsList.push({ errorByTrial: errorMap });
    });

    const points: PopulationProbingPoint[] = [];
    for (let tNum = 1; tNum <= maxTrials; tNum++) {
      let sum = 0;
      let count = 0;
      solverTrialsList.forEach(st => {
        if (st.errorByTrial.has(tNum)) {
          sum += st.errorByTrial.get(tNum)!;
          count++;
        }
      });
      if (count > 0) {
        points.push({ trialNum: tNum, avgError: Math.round(sum / count), count });
      }
    }

    const ols = calculateOLS(points.map(p => ({ x: p.trialNum, y: p.avgError })));

    results.push({
      groupName: gName,
      color: colors[colorIdx % colors.length],
      solversCount: gSolvers.length,
      points,
      slope: +ols.slope.toFixed(2),
      rSquared: +ols.rSquared.toFixed(2)
    });
    colorIdx++;
  });

  return results;
}

/**
 * Calculates individual apex auto-alignment for a single successful solver.
 * Pinned to solution trial overshoot, or the candidate trial with maximum exit.
 */
export function autoAlignSolverApex(
  sub: SubjectData,
  subTrials: ProcessedTrial[],
  globalBoxPadding = 15.0
): { idealOvershoot: number; alignedTrialId: string | number } | null {
  if (!sub || !sub.isSolved || !subTrials || subTrials.length === 0) {
    return null;
  }

  const lastTrial = subTrials[subTrials.length - 1];
  const apexRes = extractTrialApexOvershoot(lastTrial, sub.nodes, {
    idealStep: 116,
    tolerance: 65,
    boxPadding: globalBoxPadding
  });

  let solutionOvershoot = 116;
  let alignedTrialId = lastTrial.trialId;

  if (apexRes.hasExit && apexRes.overshootPx > 10) {
    solutionOvershoot = Math.round(apexRes.overshootPx);
  } else {
    let maxExit = 0;
    let bestTrial = lastTrial;
    subTrials.forEach(t => {
      const res = extractTrialApexOvershoot(t, sub.nodes, {
        idealStep: 116,
        tolerance: 65,
        boxPadding: globalBoxPadding
      });
      if (res.hasExit && res.overshootPx > maxExit) {
        maxExit = res.overshootPx;
        bestTrial = t;
      }
    });
    if (maxExit > 10) {
      solutionOvershoot = Math.round(maxExit);
      alignedTrialId = bestTrial.trialId;
    }
  }

  return { idealOvershoot: solutionOvershoot, alignedTrialId };
}

/**
 * Batch auto-aligns apex target zones across all solvers.
 */
export function batchAutoAlignAllSolvers(
  solvers: SubjectData[],
  allTrials: ProcessedTrial[],
  options: {
    existingConfigs?: Record<string, ApexTargetConfig>;
    excludedTrials?: Set<string>;
    globalBoxPadding?: number;
  } = {}
): Record<string, ApexTargetConfig> {
  const {
    existingConfigs = {},
    excludedTrials = new Set(),
    globalBoxPadding = 15.0
  } = options;

  const newConfigs: Record<string, ApexTargetConfig> = {};

  const trialsBySubject = new Map<string, ProcessedTrial[]>();
  allTrials.forEach(t => {
    if (excludedTrials.has(`${t.subjectId}-${t.trialId}`)) return;
    if (!trialsBySubject.has(t.subjectId)) trialsBySubject.set(t.subjectId, []);
    trialsBySubject.get(t.subjectId)!.push(t);
  });

  solvers.forEach(sub => {
    if (!sub.isSolved) return;
    const subTrials = trialsBySubject.get(sub.id) || [];
    if (subTrials.length === 0) return;

    const alignResult = autoAlignSolverApex(sub, subTrials, globalBoxPadding);
    if (!alignResult) return;

    const existingCfg = existingConfigs[sub.id] || sub.apexConfig;
    newConfigs[sub.id] = {
      idealOvershoot: alignResult.idealOvershoot,
      toleranceMargin: existingCfg?.toleranceMargin ?? 65.0,
      boxPadding: globalBoxPadding,
      isAutoAligned: true,
      alignedTrialId: alignResult.alignedTrialId,
      solveOverride: existingCfg?.solveOverride ?? false,
      capMaxError: existingCfg?.capMaxError ?? false
    };
  });

  return newConfigs;
}
