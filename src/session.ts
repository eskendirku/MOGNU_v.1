import { ProcessedTrial, SubjectData, ApexTargetConfig, TargetZoneId, AnalysisMode } from './types';
import { calibrateTrial } from './geometry';

export interface SessionSnapshot {
  subjects: SubjectData[];
  processedData: ProcessedTrial[];
  manualOverrides: Set<string>;
  excludedLines: Set<string>;
  excludedSubjects: Set<string>;
  excludedTrials: Set<string>;
  activeSubjectId: string | null;
  analysisMode: AnalysisMode;
  subjectGroups: Record<string, string>;
  angleThreshold: number;
  minLineLength: number;
  usePhasedMode?: boolean;
  subjectApexConfigs: Record<string, ApexTargetConfig>;
  globalBoxPadding: number;
  manualZoneOverrides: Record<string, TargetZoneId>;
}

export interface SerializedSessionPayload {
  subjects: SubjectData[];
  processedData: any[];
  manualOverrides: string[];
  excludedLines: string[];
  excludedSubjects: string[];
  excludedTrials: string[];
  activeSubjectId: string | null;
  analysisMode: AnalysisMode;
  subjectGroups: Record<string, string>;
  angleThreshold: number;
  minLineLength: number;
  usePhasedMode?: boolean;
  subjectApexConfigs: Record<string, ApexTargetConfig>;
  globalBoxPadding: number;
  manualZoneOverrides: Record<string, TargetZoneId>;
}

/**
 * Deep Session Serialization Module
 * Encapsulates stripping of high-frequency 1ms kinematic arrays (t, x, y, vt)
 * to keep session JSON payload compact (< 2MB) and prevent browser string memory limits.
 */
export function serializeSession(session: SessionSnapshot): string {
  const cleanProcessedData = session.processedData.map(t => {
    const { kinematics, ...rest } = t;
    const cleanKinematics = kinematics ? {
      metrics: kinematics.metrics,
      peaks: kinematics.peaks,
      pauses: kinematics.pauses,
      segments: kinematics.segments
    } : undefined;
    return {
      ...rest,
      kinematics: cleanKinematics
    };
  });

  const payload: SerializedSessionPayload = {
    subjects: session.subjects,
    processedData: cleanProcessedData,
    manualOverrides: Array.from(session.manualOverrides),
    excludedLines: Array.from(session.excludedLines),
    excludedSubjects: Array.from(session.excludedSubjects),
    excludedTrials: Array.from(session.excludedTrials),
    activeSubjectId: session.activeSubjectId,
    analysisMode: session.analysisMode,
    subjectGroups: session.subjectGroups,
    angleThreshold: session.angleThreshold,
    minLineLength: session.minLineLength,
    usePhasedMode: session.usePhasedMode,
    subjectApexConfigs: session.subjectApexConfigs,
    globalBoxPadding: session.globalBoxPadding,
    manualZoneOverrides: session.manualZoneOverrides
  };

  return JSON.stringify(payload);
}

/**
 * Deep Session Deserialization Module
 * Rehydrates compact session JSON back into fully calibrated trials
 * with complete high-frequency kinematics.
 */
export function deserializeSession(
  jsonStr: string,
  defaultAngle = 30,
  defaultMinLen = 100
): {
  snapshot: SessionSnapshot;
  importedAngle: number;
  importedMinLen: number;
} {
  const data = JSON.parse(jsonStr);
  const importedSubjects: SubjectData[] = data.subjects || [];
  const importedAngle = data.angleThreshold || defaultAngle;
  const importedMinLen = data.minLineLength || defaultMinLen;

  const rehydratedTrials = ((data.processedData || []) as ProcessedTrial[]).map(t => {
    const sub = importedSubjects.find(s => s.id === t.subjectId);
    if (!sub) return t;
    return calibrateTrial(t, sub.calibration, sub.nodes, importedAngle, importedMinLen);
  });

  const importedBoxPadding = data.globalBoxPadding ?? 15.0;
  const rawApexConfigs: Record<string, ApexTargetConfig> = data.subjectApexConfigs || {};
  const migratedApexConfigs: Record<string, ApexTargetConfig> = {};
  Object.entries(rawApexConfigs).forEach(([sid, cfg]) => {
    if (!cfg) return;
    if (cfg.isAutoAligned && !cfg.isCenterAnchored) {
      migratedApexConfigs[sid] = {
        ...cfg,
        idealOvershoot: Math.round((cfg.idealOvershoot ?? 116) + importedBoxPadding),
        isCenterAnchored: true
      };
    } else {
      migratedApexConfigs[sid] = { ...cfg, isCenterAnchored: true };
    }
  });

  const snapshot: SessionSnapshot = {
    subjects: importedSubjects,
    processedData: rehydratedTrials,
    manualOverrides: new Set(data.manualOverrides || []),
    excludedLines: new Set(data.excludedLines || []),
    excludedSubjects: new Set(data.excludedSubjects || []),
    excludedTrials: new Set(data.excludedTrials || []),
    activeSubjectId: data.activeSubjectId || null,
    analysisMode: data.analysisMode || 'duplex',
    subjectGroups: data.subjectGroups || {},
    angleThreshold: importedAngle,
    minLineLength: importedMinLen,
    usePhasedMode: data.usePhasedMode,
    subjectApexConfigs: migratedApexConfigs,
    globalBoxPadding: importedBoxPadding,
    manualZoneOverrides: data.manualZoneOverrides || {}
  };

  return { snapshot, importedAngle, importedMinLen };
}
