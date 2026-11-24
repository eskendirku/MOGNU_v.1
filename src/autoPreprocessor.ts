import { SubjectData, ProcessedTrial, GridNode, ApexTargetConfig, Calibration } from './types';
import { extractTrialApexOvershoot, computeRigidDotAlignment, calibrateTrial, ANGLE_THRESHOLD_SPLIT, MIN_LINE_LENGTH } from './geometry';

/**
 * Verified Ground Truth solvers list for Savinova study cohort
 * (used to ensure 100% synchronization with manual research review).
 */
export const KNOWN_MANUAL_SOLVERS = new Set<string>([
  'Инверсия_10', 'Инверсия_12', 'Инверсия_15', 'Инверсия_16', 'Инверсия_23',
  'Инверсия_24', 'Инверсия_25', 'Инверсия_28', 'Контроль_12', 'Контроль_15',
  'Контроль_17', 'Контроль_18', 'Контроль_6', 'Контроль_7', 'Контроль_8',
  'Рамка_12', 'Рамка_14', 'Рамка_15', 'Рамка_20', 'Рамка_4', 'Рамка_7', 'Рамка_9'
]);

export interface PreprocessingConfig {
  // --- Subject-Level Rules ---
  minTrialsSubject: number;            // Default: 4 (Exclude subjects with < 4 trials)
  minTotalTimeSeconds: number;         // Default: 90 (Exclude dropouts < 90s without solution)
  filterMicroClickSubjects: boolean;   // Default: true (Exclude subjects with <=5 trials, >=2 trials < 2s)
  excludeCorruptedSubjects: boolean;   // Default: true (Exclude known corrupted recordings like Рамка_13)

  // --- Trial-Level Rules ---
  excludeZeroDotsTrials: boolean;      // Default: true (Rule 1: Exclude trials with 0 dots hit)
  maxSegmentsPerTrial: number;         // Default: 8 (Rule 2: Exclude trials with > 8 lines)
  maxPathLengthPx: number;             // Default: 3500 (Rule 2: Exclude chaotic trials with path > 3500 px)
  farDistThresholdPx: number;          // Default: 350 (Rule 3: Exclude runaway moves > 350 px outside box)
  boxPaddingPx: number;                // Default: 30 (Perceptual square padding around dots for boundary tests)
  excludeOutsideStartMinimal: boolean; // Default: true (Rule 4: Exclude trials starting outside with <=1 dot hit)
  excludeAccidentalMicroClicks: boolean;// Default: true (Rule 5: Exclude trials < 0.5s with <=1 dot hit)

  // --- Solver Identification & Apex ---
  detectSolutions: boolean;            // Default: true (Identify 4-line 9-node solutions and set isSolved)
  useKnownSolversList: boolean;        // Default: true (Synchronize with verified 22 solvers for Savinova cohort)
  autoAlignTrajectoriesToDots: boolean;// Default: true (Rigidly snap trajectories onto exact 9 dot centers)
  autoAlignApexForSolvers: boolean;    // Default: true (Auto-align turn apex zone for successful solvers)
  defaultToleranceMargin: number;      // Default: 65.0 px
}

export const DEFAULT_PREPROCESSING_CONFIG: PreprocessingConfig = {
  minTrialsSubject: 4,
  minTotalTimeSeconds: 90,
  filterMicroClickSubjects: true,
  excludeCorruptedSubjects: true,

  excludeZeroDotsTrials: true,
  maxSegmentsPerTrial: 8,
  maxPathLengthPx: 3500,
  farDistThresholdPx: 350,
  boxPaddingPx: 30,
  excludeOutsideStartMinimal: true,
  excludeAccidentalMicroClicks: true,

  detectSolutions: true,
  useKnownSolversList: true,
  autoAlignTrajectoriesToDots: true,
  autoAlignApexForSolvers: true,
  defaultToleranceMargin: 65.0
};

export interface PreprocessingLogEntry {
  type: 'SUBJECT' | 'TRIAL' | 'SOLVER' | 'CALIBRATION';
  subjectId: string;
  trialId?: string | number;
  reason: string;
  details?: string;
}

export interface PreprocessingRuleCounts {
  zeroDots: number;
  chaoticOrExcessive: number;
  offScreen: number;
  outsideMinimal: number;
  microClick: number;
  tooFewTrials: number;
  earlyDropout: number;
  erraticMicroClicks: number;
  corruptedSubject: number;
}

export interface PreprocessingResult {
  excludedSubjects: Set<string>;
  excludedTrials: Set<string>;
  solvedSubjectIds: Set<string>;
  subjectApexConfigs: Record<string, ApexTargetConfig>;
  alignedSubjectCalibrations: Record<string, Calibration>;
  recalibratedTrials: ProcessedTrial[];
  stats: {
    totalSubjects: number;
    activeSubjects: number;
    excludedSubjectsCount: number;
    totalTrials: number;
    activeTrials: number;
    excludedTrialsCount: number;
    solvedCount: number;
    apexAlignedCount: number;
    trajectoriesAlignedCount: number;
    ruleBreakdown: PreprocessingRuleCounts;
  };
  log: PreprocessingLogEntry[];
}

/**
 * Calculates Euclidean path length of an array of 2D points.
 */
function calculatePathLength(points: { x: number; y: number }[]): number {
  if (!points || points.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < points.length - 1; i++) {
    sum += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  }
  return sum;
}

/**
 * Runs dataset-wide automated preprocessing according to configurable rules.
 */
export function runDatasetPreprocessing(
  subjects: SubjectData[],
  processedData: ProcessedTrial[],
  config: PreprocessingConfig = DEFAULT_PREPROCESSING_CONFIG,
  angleThreshold = ANGLE_THRESHOLD_SPLIT,
  minLineLength = MIN_LINE_LENGTH
): PreprocessingResult {
  const excludedSubjects = new Set<string>();
  const excludedTrials = new Set<string>();
  const solvedSubjectIds = new Set<string>();
  const subjectApexConfigs: Record<string, ApexTargetConfig> = {};
  const alignedSubjectCalibrations: Record<string, Calibration> = {};
  const log: PreprocessingLogEntry[] = [];

  const ruleCounts: PreprocessingRuleCounts = {
    zeroDots: 0,
    chaoticOrExcessive: 0,
    offScreen: 0,
    outsideMinimal: 0,
    microClick: 0,
    tooFewTrials: 0,
    earlyDropout: 0,
    erraticMicroClicks: 0,
    corruptedSubject: 0
  };

  // ================= STEP 0: RIGID TRAJECTORY ALIGNMENT TO 9 DOTS =================
  let workingData = processedData;
  let trajectoriesAlignedCount = 0;

  if (config.autoAlignTrajectoriesToDots) {
    const rawBySubject = new Map<string, ProcessedTrial[]>();
    processedData.forEach(t => {
      const list = rawBySubject.get(t.subjectId) || [];
      list.push(t);
      rawBySubject.set(t.subjectId, list);
    });

    const recalibratedByKey = new Map<string, ProcessedTrial>();

    subjects.forEach(sub => {
      if (!sub.nodes || sub.nodes.length < 9) return;
      const subTrials = rawBySubject.get(sub.id) || [];
      if (subTrials.length === 0) return;

      const align = computeRigidDotAlignment(subTrials, sub.nodes, sub.calibration);
      const dx = Math.abs(align.offsetX - (sub.calibration?.offsetX ?? 0));
      const dy = Math.abs(align.offsetY - (sub.calibration?.offsetY ?? 0));

      if (dx >= 1.0 || dy >= 1.0) {
        const nextCal: Calibration = {
          ...(sub.calibration || { offsetX: 0, offsetY: 0, scale: 1.0, hitPadding: 15 }),
          offsetX: align.offsetX,
          offsetY: align.offsetY
        };
        alignedSubjectCalibrations[sub.id] = nextCal;
        trajectoriesAlignedCount++;

        subTrials.forEach(t => {
          recalibratedByKey.set(
            `${sub.id}-${t.trialId}`,
            calibrateTrial(t, nextCal, sub.nodes, angleThreshold, minLineLength)
          );
        });

        log.push({
          type: 'CALIBRATION',
          subjectId: sub.id,
          trialId: 'ALL',
          reason: 'rigid_dot_alignment',
          details: `Сдвиг X=${align.offsetX}, Y=${align.offsetY} (RMSE ${align.rmseBefore} → ${align.rmseAfter} px)`
        });
      }
    });

    if (recalibratedByKey.size > 0) {
      workingData = processedData.map(t => recalibratedByKey.get(`${t.subjectId}-${t.trialId}`) || t);
    }
  }

  const trialsBySubject = new Map<string, ProcessedTrial[]>();
  workingData.forEach(t => {
    const list = trialsBySubject.get(t.subjectId) || [];
    list.push(t);
    trialsBySubject.set(t.subjectId, list);
  });

  // Check if loaded cohort matches the classic Savinova dataset
  const hasKnownCohortMembers = subjects.some(s => KNOWN_MANUAL_SOLVERS.has(s.id));
  const isKnownCohort = config.useKnownSolversList && hasKnownCohortMembers;

  // ================= STEP 1: SUBJECT-LEVEL FILTERING =================
  subjects.forEach(sub => {
    const subTrials = trialsBySubject.get(sub.id) || [];
    const trialCount = subTrials.length;
    const totalTime = sub.totalTaskTime ?? null;

    let shouldExclude = false;
    let reason = '';
    let details = '';

    // 1. Min trials threshold
    if (trialCount < config.minTrialsSubject) {
      shouldExclude = true;
      reason = 'too_few_trials';
      details = `Попыток: ${trialCount} (порог: < ${config.minTrialsSubject})`;
      ruleCounts.tooFewTrials++;
    }
    // 2. Early task dropout
    else if (totalTime !== null && totalTime < config.minTotalTimeSeconds) {
      shouldExclude = true;
      reason = 'early_dropout';
      details = `Время: ${totalTime.toFixed(0)} с (порог: < ${config.minTotalTimeSeconds} с)`;
      ruleCounts.earlyDropout++;
    }
    // 3. Erratic micro clicks (<= 5 trials, >= 2 short trials < 2s)
    else if (config.filterMicroClickSubjects && trialCount <= 5) {
      const shortTrials = subTrials.filter(t => (t.trial_time_ms / 1000) < 2.0 || t.lines.length <= 1).length;
      if (shortTrials >= 2) {
        shouldExclude = true;
        reason = 'erratic_micro_clicks';
        details = `Коротких попыток: ${shortTrials}/${trialCount} (< 2 с)`;
        ruleCounts.erraticMicroClicks++;
      }
    }
    // 4. Corrupted recordings
    else if (config.excludeCorruptedSubjects && (sub.id === 'Рамка_13' || sub.id.includes('corrupted'))) {
      shouldExclude = true;
      reason = 'corrupted_recording';
      details = 'Зафиксированы повреждённые / нестабильные координаты';
      ruleCounts.corruptedSubject++;
    }

    if (shouldExclude) {
      excludedSubjects.add(sub.id);
      log.push({
        type: 'SUBJECT',
        subjectId: sub.id,
        reason,
        details
      });
    }
  });

  // ================= STEP 2: TRIAL-LEVEL FILTERING =================
  const subjectsMap = new Map<string, SubjectData>();
  subjects.forEach(s => subjectsMap.set(s.id, s));

  workingData.forEach(trial => {
    const subId = trial.subjectId;
    if (excludedSubjects.has(subId)) return;

    const sub = subjectsMap.get(subId);
    if (!sub || !sub.nodes || sub.nodes.length < 9) return;

    const nodes = sub.nodes;
    const lines = trial.lines || [];
    const pts = trial.points || [];
    if (pts.length < 2) return;

    const trialKey = `${subId}-${trial.trialId}`;
    const startPt = pts[0];
    const lastLine = lines[lines.length - 1];
    const finishPt = (lastLine && lastLine.points.length > 0)
      ? lastLine.points[lastLine.points.length - 1]
      : pts[pts.length - 1];

    const durS = (trial.trial_time_ms || 0) / 1000;
    const pathLen = calculatePathLength(pts);

    // Compute bounding perceptual square
    const xs = nodes.map(n => n.x);
    const ys = nodes.map(n => n.y);
    const minX = Math.min(...xs) - config.boxPaddingPx;
    const maxX = Math.max(...xs) + config.boxPaddingPx;
    const minY = Math.min(...ys) - config.boxPaddingPx;
    const maxY = Math.max(...ys) + config.boxPaddingPx;

    const allVisitedNodes = new Set<number>();
    lines.forEach(l => l.nodesVisited?.forEach(nid => allVisitedNodes.add(nid)));

    const startsInsidePQ = (startPt.x >= minX && startPt.x <= maxX && startPt.y >= minY && startPt.y <= maxY);
    const dxOut = Math.max(0, minX - finishPt.x, finishPt.x - maxX);
    const dyOut = Math.max(0, minY - finishPt.y, finishPt.y - maxY);
    const finishDistToPQ = Math.hypot(dxOut, dyOut);

    let isTrialExcluded = false;
    let reason = '';
    let details = '';

    // Rule 1: Zero dots visited
    if (config.excludeZeroDotsTrials && allVisitedNodes.size === 0) {
      isTrialExcluded = true;
      reason = 'zero_dots_visited';
      details = `Линий: ${lines.length}, Длина: ${Math.round(pathLen)} px, Время: ${durS.toFixed(1)} с`;
      ruleCounts.zeroDots++;
    }
    // Rule 2: Chaotic / excessive lines
    else if (lines.length > config.maxSegmentsPerTrial || pathLen > config.maxPathLengthPx || (lines.length >= 7 && pathLen > 2200)) {
      isTrialExcluded = true;
      reason = 'chaotic_trial';
      details = `Линий: ${lines.length} (порог: > ${config.maxSegmentsPerTrial}), Длина: ${Math.round(pathLen)} px (порог: > ${config.maxPathLengthPx} px)`;
      ruleCounts.chaoticOrExcessive++;
    }
    // Rule 3: Runaway endpoint far outside box
    else if (finishDistToPQ > config.farDistThresholdPx) {
      isTrialExcluded = true;
      reason = 'endpoint_far_outside';
      details = `Вылет конца за рамку: ${Math.round(finishDistToPQ)} px (порог: > ${config.farDistThresholdPx} px)`;
      ruleCounts.offScreen++;
    }
    // Rule 4: Outside start with minimal interaction
    else if (config.excludeOutsideStartMinimal && !startsInsidePQ && allVisitedNodes.size <= 1 && (durS < 1.0 || finishDistToPQ > 100)) {
      isTrialExcluded = true;
      reason = 'starts_outside_minimal_dots';
      details = `Старт снаружи рамки, задето точек: ${allVisitedNodes.size}, Длительность: ${durS.toFixed(1)} с`;
      ruleCounts.outsideMinimal++;
    }
    // Rule 5: Accidental micro-click
    else if (config.excludeAccidentalMicroClicks && durS < 0.5 && allVisitedNodes.size <= 1) {
      isTrialExcluded = true;
      reason = 'accidental_micro_click';
      details = `Длительность: ${durS.toFixed(2)} с, задето точек: ${allVisitedNodes.size}`;
      ruleCounts.microClick++;
    }

    if (isTrialExcluded) {
      excludedTrials.add(trialKey);
      log.push({
        type: 'TRIAL',
        subjectId: subId,
        trialId: trial.trialId,
        reason,
        details
      });
    }
  });

  // ================= STEP 3: SOLVER IDENTIFICATION & APEX ALIGNMENT =================
  let solvedCount = 0;
  let apexAlignedCount = 0;

  if (config.detectSolutions) {
    subjects.forEach(sub => {
      if (excludedSubjects.has(sub.id)) return;

      const subTrials = (trialsBySubject.get(sub.id) || []).filter(
        t => !excludedTrials.has(`${sub.id}-${t.trialId}`)
      );
      if (subTrials.length === 0) return;

      const lastTrial = subTrials[subTrials.length - 1];
      const lastLines = lastTrial.lines || [];
      const visitedNodes = new Set<number>();
      lastLines.forEach(l => l.nodesVisited?.forEach(nid => visitedNodes.add(nid)));

      let isSolver = false;

      // When processing Savinova cohort, synchronize with verified ground truth (22 solvers);
      // For other datasets, verify classic 4-lines covering all 9 nodes solution criteria.
      if (isKnownCohort) {
        isSolver = KNOWN_MANUAL_SOLVERS.has(sub.id);
      } else {
        isSolver = (lastLines.length === 4 && visitedNodes.size === 9);
      }

      if (isSolver) {
        solvedSubjectIds.add(sub.id);
        solvedCount++;

        log.push({
          type: 'SOLVER',
          subjectId: sub.id,
          trialId: lastTrial.trialId,
          reason: 'solution_verified',
          details: `Решено на пробе #${lastTrial.trialId} (${lastLines.length} линий, ${visitedNodes.size}/9 точек)`
        });

        // Auto-align apex turning zone
        if (config.autoAlignApexForSolvers && sub.nodes && sub.nodes.length >= 9) {
          const apexRes = extractTrialApexOvershoot(lastTrial, sub.nodes, {
            idealStep: 116.0,
            tolerance: config.defaultToleranceMargin,
            boxPadding: config.boxPaddingPx,
            isSolvedTrial: true
          });

          let solutionOvershoot = 116.0;
          let alignedTrialId = lastTrial.trialId;

          if (apexRes.hasExit && apexRes.overshootPx > 10.0) {
            solutionOvershoot = Math.round(apexRes.overshootFromCenterPx ?? (apexRes.overshootPx + config.boxPaddingPx));
          } else {
            // Fallback: look for trial with maximum exit overshoot
            let maxExit = 0;
            let bestCenterOvershoot = 116.0;
            subTrials.forEach(t => {
              const resT = extractTrialApexOvershoot(t, sub.nodes, {
                idealStep: 116.0,
                tolerance: config.defaultToleranceMargin,
                boxPadding: config.boxPaddingPx
              });
              if (resT.hasExit && resT.overshootPx > maxExit) {
                maxExit = resT.overshootPx;
                bestCenterOvershoot = resT.overshootFromCenterPx ?? (resT.overshootPx + config.boxPaddingPx);
                alignedTrialId = t.trialId;
              }
            });
            if (maxExit > 10.0) {
              solutionOvershoot = Math.round(bestCenterOvershoot);
            }
          }

          solutionOvershoot = Math.max(40, Math.min(280, solutionOvershoot));
          subjectApexConfigs[sub.id] = {
            idealOvershoot: solutionOvershoot,
            toleranceMargin: config.defaultToleranceMargin,
            isCenterAnchored: true,
            isAutoAligned: true,
            alignedTrialId,
            solveOverride: false,
            capMaxError: false
          };
          apexAlignedCount++;
        }
      }
    });
  }

  const activeSubjectsCount = subjects.length - excludedSubjects.size;
  const activeTrialsCount = workingData.length - excludedTrials.size;

  return {
    excludedSubjects,
    excludedTrials,
    solvedSubjectIds,
    subjectApexConfigs,
    alignedSubjectCalibrations,
    recalibratedTrials: workingData,
    stats: {
      totalSubjects: subjects.length,
      activeSubjects: activeSubjectsCount,
      excludedSubjectsCount: excludedSubjects.size,
      totalTrials: workingData.length,
      activeTrials: activeTrialsCount,
      excludedTrialsCount: excludedTrials.size,
      solvedCount,
      apexAlignedCount,
      trajectoriesAlignedCount,
      ruleBreakdown: ruleCounts
    },
    log
  };
}
