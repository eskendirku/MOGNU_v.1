import { Point, ProcessedTrial, SubjectData, ApexTargetConfig, TargetZoneId } from './types';
import { calculateDistance, extractTrialApexOvershoot, isPointInAnyNode, getLineLengthPx } from './geometry';
import { calculateOLS } from './probing';
import { downloadBlob } from './utils/download';
import * as XLSX from 'xlsx';

export const generateFilteredCSV = (
  filteredTrials: ProcessedTrial[],
  subjects: SubjectData[],
  manualOverrides: Set<string>,
  subjectGroups: Record<string, string>,
  excludedSubjects: Set<string> = new Set(),
  excludedTrials: Set<string> = new Set()
): string => {
  subjects = subjects.filter(s => !excludedSubjects.has(s.id));
  filteredTrials = filteredTrials.filter(t => !excludedSubjects.has(t.subjectId) && !excludedTrials.has(`${t.subjectId}-${t.trialId}`));
  const headers = [
    'LastName', 'FirstName', 'Age', 'Gender', 'SolvedBefore', 'Insight', 'totalTaskTime',
    'SubjectId', 'Group', 'IsSolved', 'IsOnline', 'TrialId', 'trial_time_ms',
    'LineIdx', 'OriginalType', 'ActualType', 'IsManualOverride', 'Nodes',
    'StartX', 'StartY', 'FinishX', 'FinishY', 'StartsAtNode', 'EndsAtNode',
    'BothInDots', 'AnyOutDots', 'TrialFinishNode',
    'CalibrationOffsetX', 'CalibrationOffsetY', 'CalibrationScale', 'AoI'
  ];

  const subjectsMap = new Map<string, SubjectData>();
  subjects.forEach(s => subjectsMap.set(s.id, s));

  const rows = filteredTrials.flatMap(t => {
    const overrideKey = `${t.subjectId}-${t.trialId}`;
    const isOverridden = manualOverrides.has(overrideKey);
    const lastLineOfTrial = t.lines[t.lines.length - 1];
    const trialFinishNode = lastLineOfTrial?.nodesVisited[lastLineOfTrial.nodesVisited.length - 1] || 'none';
    const subject = subjectsMap.get(t.subjectId);
    const cal = subject?.calibration || { offsetX: 0, offsetY: 0, scale: 1, hitPadding: 15 };
    const isSolved = subject?.isSolved || false;
    const hitPadding = cal.hitPadding ?? 15;
    const subNodes = subject ? subject.nodes : [];

    const isAtNode = (p: Point) => isPointInAnyNode(p, subNodes, hitPadding);

    return t.lines.map((l, idx) => {
      const startAtNode = isAtNode(l.points[0]);
      const endAtNode = isAtNode(l.points[l.points.length - 1]);
      return [
        subject?.lastName || '',
        subject?.firstName || '',
        subject?.age || '',
        subject?.gender || '',
        subject?.solvedBefore || '',
        subject?.insight || '',
        subject?.totalTaskTime !== undefined ? subject.totalTaskTime.toString() : '',
        t.subjectId,
        subjectGroups[t.subjectId] || 'None',
        isSolved ? '1' : '0',
        subject?.isOnline ? '1' : '0',
        t.trialId,
        t.trial_time_ms.toFixed(0),
        idx + 1,
        l.type,
        isOverridden ? 'прочая' : l.type,
        isOverridden ? 'true' : 'false',
        l.nodesVisited.join('-'),
        l.points[0].x.toFixed(1),
        l.points[0].y.toFixed(1),
        l.points[l.points.length - 1].x.toFixed(1),
        l.points[l.points.length - 1].y.toFixed(1),
        startAtNode ? '1' : '0',
        endAtNode ? '1' : '0',
        (startAtNode && endAtNode) ? '1' : '0',
        (!startAtNode || !endAtNode) ? '1' : '0',
        trialFinishNode,
        cal.offsetX,
        cal.offsetY,
        cal.scale,
        hitPadding
      ];
    });
  });

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
};

export const generateAllDataCSV = (
  subjects: SubjectData[],
  processedData: ProcessedTrial[],
  manualOverrides: Set<string>,
  subjectGroups: Record<string, string>,
  excludedSubjects: Set<string> = new Set(),
  excludedTrials: Set<string> = new Set()
): string => {
  subjects = subjects.filter(s => !excludedSubjects.has(s.id));
  processedData = processedData.filter(t => !excludedSubjects.has(t.subjectId) && !excludedTrials.has(`${t.subjectId}-${t.trialId}`));
  const headers = [
    'LastName', 'FirstName', 'Age', 'Gender', 'SolvedBefore', 'Insight', 'totalTaskTime',
    'SubjectId', 'Group', 'IsSolved', 'IsOnline', 'TrialId', 'trial_time_ms',
    'LineIdx', 'OriginalType', 'ActualType', 'IsManualOverride', 'Nodes',
    'StartX', 'StartY', 'FinishX', 'FinishY', 'StartsAtNode', 'EndsAtNode',
    'BothInDots', 'AnyOutDots', 'TrialFinishNode',
    'CalibrationOffsetX', 'CalibrationOffsetY', 'CalibrationScale', 'AoI'
  ];

  // Pre-group trials by subject for O(1) retrieval
  const trialsBySubject = new Map<string, ProcessedTrial[]>();
  processedData.forEach(t => {
    if (!trialsBySubject.has(t.subjectId)) trialsBySubject.set(t.subjectId, []);
    trialsBySubject.get(t.subjectId)!.push(t);
  });

  const rows = subjects.flatMap(subject => {
    const hitPadding = subject.calibration.hitPadding ?? 15;
    const subNodes = subject.nodes;
    const subjectTrials = trialsBySubject.get(subject.id) || [];
    const isSolved = subject.isSolved || false;
    const cal = subject.calibration;

    const isAtNode = (p: Point) => isPointInAnyNode(p, subNodes, hitPadding);

    return subjectTrials.flatMap(t => {
      const overrideKey = `${t.subjectId}-${t.trialId}`;
      const isOverridden = manualOverrides.has(overrideKey);
      const lastLineOfTrial = t.lines[t.lines.length - 1];
      const trialFinishNode = lastLineOfTrial?.nodesVisited[lastLineOfTrial.nodesVisited.length - 1] || 'none';

      return t.lines.map((l, idx) => {
        const startAtNode = isAtNode(l.points[0]);
        const endAtNode = isAtNode(l.points[l.points.length - 1]);
        return [
          subject.lastName || '',
          subject.firstName || '',
          subject.age || '',
          subject.gender || '',
          subject.solvedBefore || '',
          subject.insight || '',
          subject.totalTaskTime !== undefined ? subject.totalTaskTime.toString() : '',
          t.subjectId,
          subjectGroups[subject.id] || 'None',
          isSolved ? '1' : '0',
          subject.isOnline ? '1' : '0',
          t.trialId,
          t.trial_time_ms.toFixed(0),
          idx + 1,
          l.type,
          isOverridden ? 'прочая' : l.type,
          isOverridden ? 'true' : 'false',
          l.nodesVisited.join('-'),
          l.points[0].x.toFixed(1),
          l.points[0].y.toFixed(1),
          l.points[l.points.length - 1].x.toFixed(1),
          l.points[l.points.length - 1].y.toFixed(1),
          startAtNode ? '1' : '0',
          endAtNode ? '1' : '0',
          (startAtNode && endAtNode) ? '1' : '0',
          (!startAtNode || !endAtNode) ? '1' : '0',
          trialFinishNode,
          cal.offsetX,
          cal.offsetY,
          cal.scale,
          hitPadding
        ];
      });
    });
  });

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
};

export interface SummaryDataset {
  headers: string[];
  categoryHeaders: string[];
  sheet1RowsRaw: any[][];
  sheet1RowsCSV: string[][];
  phaseSheetHeaders: string[];
  phaseSheetCategory: string[];
  sheet2RowsRaw: any[][];
  probingLongHeaders: string[];
  probingLongCategory: string[];
  probingLongRowsRaw: any[][];
  probingLongRowsCSV: string[][];
}

export const computeSummaryDataset = (
  subjectsInput: any,
  processedDataInput: any,
  manualOverridesInput: any = new Set(),
  excludedLinesInput: any = new Set(),
  subjectGroupsInput: any = {},
  excludedSubjectsInput: any = new Set(),
  excludedTrialsInput: any = new Set(),
  subjectApexConfigsInput: any = {},
  globalBoxPaddingInput: number = 15.0,
  manualZoneOverridesInput: any = {}
): SummaryDataset => {
  let subjects: SubjectData[] = Array.isArray(subjectsInput) ? subjectsInput : [];
  let processedData: ProcessedTrial[] = Array.isArray(processedDataInput) ? processedDataInput : [];

  // Defensive swap if caller inverted (processedData, subjects)
  if (subjects.length > 0 && ('trialId' in subjects[0]) && processedData.length > 0 && ('nodes' in processedData[0])) {
    const tmp = subjects;
    subjects = processedData as any;
    processedData = tmp as any;
  }

  const manualOverrides = manualOverridesInput instanceof Set ? manualOverridesInput : new Set<string>();
  const excludedLines = excludedLinesInput instanceof Set ? excludedLinesInput : new Set<string>();
  const subjectGroups = (subjectGroupsInput && typeof subjectGroupsInput === 'object' && !(subjectGroupsInput instanceof Set))
    ? (subjectGroupsInput as Record<string, string>)
    : {};
  const excludedSubjects = excludedSubjectsInput instanceof Set ? excludedSubjectsInput : new Set<string>();
  const excludedTrials = excludedTrialsInput instanceof Set ? excludedTrialsInput : new Set<string>();
  const subjectApexConfigs: Record<string, ApexTargetConfig> = (subjectApexConfigsInput && typeof subjectApexConfigsInput === 'object') ? subjectApexConfigsInput : {};
  const globalBoxPadding = typeof globalBoxPaddingInput === 'number' ? globalBoxPaddingInput : 15.0;
  const manualZoneOverrides: Record<string, TargetZoneId> = (manualZoneOverridesInput && typeof manualZoneOverridesInput === 'object') ? manualZoneOverridesInput : {};

  subjects = subjects.filter(s => !excludedSubjects.has(s.id));
  processedData = processedData.filter(t => !excludedSubjects.has(t.subjectId) && !excludedTrials.has(`${t.subjectId}-${t.trialId}`));

  const lineTypes = ['боковая', 'центральная', 'диагональная', 'хордовая', 'хорды_длинные', 'внешняя', 'касательная', 'прочая'];
  const nodeIds = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  // Build headers for the 4 positions
  const posHeaders = [1, 2, 3, 4].flatMap(pos =>
    lineTypes.map(type => `Pos${pos}_Type_${type}`)
  );

  const phases = ['Beg', 'Mid', 'End'];

  const phaseHeaders = phases.flatMap(p => [
    `${p}_TrialsCount`, `${p}_LinesCount`, `${p}_mean_trial_time_ms`, `${p}_total_solution_time_ms`,
    `${p}_Kin_MeanVelocityPxS`, `${p}_Kin_MaxPeakVelocityPxS`,
    `${p}_Kin_MeanMovementTimeS`, `${p}_Kin_MeanPauseTimeS`, `${p}_Kin_PauseTimeRatio`,
    `${p}_Kin_TotalPauseCount`, `${p}_Kin_TrialsWithOutsideBoxCount`, `${p}_Kin_TrialsWithOutsideBoxRatio`,
    `${p}_TotalTurns`, `${p}_NonDotTurns`, `${p}_NonDotTurnsRatio`,
    `${p}_LinesStartOutsideMatrixAbs`, `${p}_LinesStartOutsideMatrixRel`,
    `${p}_LinesFinishOutsideMatrixAbs`, `${p}_LinesFinishOutsideMatrixRel`,
    `${p}_Lines3PointsAbs`, `${p}_Lines3PointsRel`,
    `${p}_Lines2PointsAbs`, `${p}_Lines2PointsRel`,
    `${p}_Lines1PointAbs`, `${p}_Lines1PointRel`,
    `${p}_LinesBothEndsInNodesAbs`, `${p}_LinesBothEndsInNodesRel`,
    `${p}_LinesAnyEndOutsideAbs`, `${p}_LinesAnyEndOutsideRel`,
    `${p}_AvgAllLinesLength`, `${p}_AvgOutsideLinesLength`,
    ...lineTypes.map(t => `${p}_LineType_${t}`),
    ...nodeIds.map(n => `${p}_StartNode_${n}`),
    ...nodeIds.map(n => `${p}_FinishNode_${n}`)
  ]);

  const allScaleNames = Array.from(
    new Set(subjects.flatMap(s => Object.keys(s.surveyScales || {})))
  );

  const kinHeaders = [
    'Kin_MeanVelocityPxS',
    'Kin_MeanVelocityMmS',
    'Kin_MaxPeakVelocityPxS',
    'Kin_MeanPeakVelocityPxS',
    'Kin_MeanMovementTimeS',
    'Kin_TotalMovementTimeS',
    'Kin_MovementTimeRatio',
    'Kin_MeanPauseTimeS',
    'Kin_TotalPauseTimeS',
    'Kin_PauseTimeRatio',
    'Kin_TotalPauseCount',
    'Kin_MeanPauseCountPerTrial',
    'Kin_MaxPauseS',
    'Kin_TotalPathPx',
    'Kin_TotalPathMm',
    'Kin_MeanPathPerTrialPx',
    'Kin_MeanPathPerTrialMm',
    'Kin_TotalSegmentsCount',
    'Kin_MeanSegmentsCountPerTrial',
    'Kin_MeanSegmentDurationMs',
    'Kin_TrialsWithOutsideBoxCount',
    'Kin_TrialsWithOutsideBoxRatio',
    'Kin_TotalOutsideBoxTimeS',
    'Kin_MeanOutsideBoxTimePerTrialS',
    'Kin_FirstTrialOutsideBox',
    'Kin_HasAnyOutsideBox',
    'Kin_SolutionTrialOutsideBox'
  ];

  const headers = [
    'SubjectId', 'Group', 'IsOnline', 'LastName', 'FirstName', 'Age', 'Gender', 'SolvedBefore', 'Insight', 'totalTaskTime', 'IsSolved',
    'TrialsCount', 'LinesCount', 'mean_trial_time_ms', 'total_solution_time_ms',
    ...allScaleNames.map(sc => `Scale_${sc}`),
    ...kinHeaders,
    'SolutionStartNode', 'SolutionFinishNode', 'SolutionStartLine',
    'FirstTrialStartNode', 'FirstTrialFinishNode', 'FirstTrialFirstLineType',
    'TotalTurns', 'NonDotTurns', 'NonDotTurnsRatio',
    'LinesStartOutsideMatrixAbs', 'LinesStartOutsideMatrixRel',
    'LinesFinishOutsideMatrixAbs', 'LinesFinishOutsideMatrixRel',
    'Lines3PointsAbs', 'Lines3PointsRel',
    'Lines2PointsAbs', 'Lines2PointsRel',
    'Lines1PointAbs', 'Lines1PointRel',
    'LinesBothEndsInNodesAbs', 'LinesBothEndsInNodesRel',
    'LinesAnyEndOutsideAbs', 'LinesAnyEndOutsideRel',
    'AvgAllLinesLength', 'AvgOutsideLinesLength',
    'Probing_Slope', 'Probing_MeanOvershootPx', 'Probing_MeanAbsErrorPx', 'Probing_InCorridorCount', 'Probing_InCorridorRatio',
    ...lineTypes.map(t => `LineType_${t}`),
    ...nodeIds.map(n => `StartNode_${n}`),
    ...nodeIds.map(n => `FinishNode_${n}`),
    ...posHeaders,
    ...phaseHeaders
  ];

  const categoryHeaders = [
    'ДЕМОГРАФИЯ И МЕТАДАННЫЕ', 'ДЕМОГРАФИЯ И МЕТАДАННЫЕ', 'ДЕМОГРАФИЯ И МЕТАДАННЫЕ', 'ДЕМОГРАФИЯ И МЕТАДАННЫЕ',
    'ДЕМОГРАФИЯ И МЕТАДАННЫЕ', 'ДЕМОГРАФИЯ И МЕТАДАННЫЕ', 'ДЕМОГРАФИЯ И МЕТАДАННЫЕ', 'ДЕМОГРАФИЯ И МЕТАДАННЫЕ',
    'ДЕМОГРАФИЯ И МЕТАДАННЫЕ', 'ДЕМОГРАФИЯ И МЕТАДАННЫЕ', 'ДЕМОГРАФИЯ И МЕТАДАННЫЕ',
    'ОСНОВНЫЕ РЕЗУЛЬТАТЫ ЗАДАЧИ', 'ОСНОВНЫЕ РЕЗУЛЬТАТЫ ЗАДАЧИ', 'ОСНОВНЫЕ РЕЗУЛЬТАТЫ ЗАДАЧИ', 'ОСНОВНЫЕ РЕЗУЛЬТАТЫ ЗАДАЧИ',
    ...allScaleNames.map(() => 'ШКАЛЫ ОПРОСНИКА'),
    ...kinHeaders.map(() => 'КИНЕМАТИКА (MOGNU)'),
    'КЛЮЧЕВЫЕ ТОЧКИ И ЛИНИИ', 'КЛЮЧЕВЫЕ ТОЧКИ И ЛИНИИ', 'КЛЮЧЕВЫЕ ТОЧКИ И ЛИНИИ',
    'КЛЮЧЕВЫЕ ТОЧКИ И ЛИНИИ', 'КЛЮЧЕВЫЕ ТОЧКИ И ЛИНИИ', 'КЛЮЧЕВЫЕ ТОЧКИ И ЛИНИИ',
    'ПОВОРОТЫ И ВЫХОДЫ ЗА ПРЕДЕЛЫ', 'ПОВОРОТЫ И ВЫХОДЫ ЗА ПРЕДЕЛЫ', 'ПОВОРОТЫ И ВЫХОДЫ ЗА ПРЕДЕЛЫ',
    'ПОВОРОТЫ И ВЫХОДЫ ЗА ПРЕДЕЛЫ', 'ПОВОРОТЫ И ВЫХОДЫ ЗА ПРЕДЕЛЫ', 'ПОВОРОТЫ И ВЫХОДЫ ЗА ПРЕДЕЛЫ', 'ПОВОРОТЫ И ВЫХОДЫ ЗА ПРЕДЕЛЫ',
    'ЧИСЛО ТОЧЕК НА ЛИНИЯХ', 'ЧИСЛО ТОЧЕК НА ЛИНИЯХ', 'ЧИСЛО ТОЧЕК НА ЛИНИЯХ',
    'ЧИСЛО ТОЧЕК НА ЛИНИЯХ', 'ЧИСЛО ТОЧЕК НА ЛИНИЯХ', 'ЧИСЛО ТОЧЕК НА ЛИНИЯХ',
    'КОНЦЫ ЛИНИЙ И ДЛИНЫ', 'КОНЦЫ ЛИНИЙ И ДЛИНЫ', 'КОНЦЫ ЛИНИЙ И ДЛИНЫ',
    'КОНЦЫ ЛИНИЙ И ДЛИНЫ', 'КОНЦЫ ЛИНИЙ И ДЛИНЫ', 'КОНЦЫ ЛИНИЙ И ДЛИНЫ',
    'ЗОНА ПОВОРОТА И НАЩУПЫВАНИЕ (PROBING)', 'ЗОНА ПОВОРОТА И НАЩУПЫВАНИЕ (PROBING)', 'ЗОНА ПОВОРОТА И НАЩУПЫВАНИЕ (PROBING)',
    'ЗОНА ПОВОРОТА И НАЩУПЫВАНИЕ (PROBING)', 'ЗОНА ПОВОРОТА И НАЩУПЫВАНИЕ (PROBING)',
    ...lineTypes.map(() => 'ТИПЫ ЛИНИЙ'),
    ...nodeIds.map(() => 'ТОЧКИ СТАРТА ЛИНИЙ'),
    ...nodeIds.map(() => 'ТОЧКИ ФИНИША ЛИНИЙ'),
    ...posHeaders.map(() => 'ПОЗИЦИИ ЛИНИЙ В ПРОБАХ (1-4)'),
    ...phaseHeaders.map(() => 'ДИНАМИКА ПО ЭТАПАМ (ШИРОКИЙ ФОРМАТ)')
  ];

  const phaseSheetHeaders = [
    'SubjectId', 'Group', 'IsOnline', 'LastName', 'FirstName', 'Age', 'Gender', 'SolvedBefore', 'Insight', 'IsSolved',
    'PhaseNum', 'PhaseName',
    'Phase_TrialsCount', 'Phase_LinesCount', 'Phase_mean_trial_time_ms', 'Phase_total_solution_time_ms',
    'Phase_Kin_MeanVelocityPxS', 'Phase_Kin_MaxPeakVelocityPxS',
    'Phase_Kin_MeanMovementTimeS', 'Phase_Kin_MeanPauseTimeS', 'Phase_Kin_PauseTimeRatio',
    'Phase_Kin_TotalPauseCount', 'Phase_Kin_TrialsWithOutsideBoxCount', 'Phase_Kin_TrialsWithOutsideBoxRatio',
    'Phase_TotalTurns', 'Phase_NonDotTurns', 'Phase_NonDotTurnsRatio',
    'Phase_LinesStartOutsideMatrixAbs', 'Phase_LinesStartOutsideMatrixRel',
    'Phase_LinesFinishOutsideMatrixAbs', 'Phase_LinesFinishOutsideMatrixRel',
    'Phase_Lines3PointsAbs', 'Phase_Lines3PointsRel',
    'Phase_Lines2PointsAbs', 'Phase_Lines2PointsRel',
    'Phase_Lines1PointAbs', 'Phase_Lines1PointRel',
    'Phase_LinesBothEndsInNodesAbs', 'Phase_LinesBothEndsInNodesRel',
    'Phase_LinesAnyEndOutsideAbs', 'Phase_LinesAnyEndOutsideRel',
    'Phase_AvgAllLinesLength', 'Phase_AvgOutsideLinesLength',
    ...lineTypes.map(t => `Phase_LineType_${t}`),
    ...nodeIds.map(n => `Phase_StartNode_${n}`),
    ...nodeIds.map(n => `Phase_FinishNode_${n}`)
  ];

  const phaseSheetCategory = phaseSheetHeaders.map((_, i) => i < 12 ? 'ИДЕНТИФИКАТОРЫ И ЭТАП' : 'МЕТРИКИ ЭТАПА');

  // Pre-group trials by subject for O(1) lookup
  const trialsBySubject = new Map<string, ProcessedTrial[]>();
  processedData.forEach(t => {
    if (!trialsBySubject.has(t.subjectId)) trialsBySubject.set(t.subjectId, []);
    trialsBySubject.get(t.subjectId)!.push(t);
  });

  const escapeCSV = (val: any): string => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const toNumericOrOriginal = (val: any) => {
    if (val === null || val === undefined || val === '') return '';
    if (typeof val === 'number') return val;
    if (typeof val === 'boolean') return val ? 1 : 0;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed === '') return '';
      if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        const num = Number(trimmed);
        if (!isNaN(num)) return num;
      }
    }
    return val;
  };

  const sheet1RowsRaw: any[][] = [];
  const sheet1RowsCSV: string[][] = [];
  const sheet2RowsRaw: any[][] = [];

  const probingLongHeaders = [
    'SubjectId', 'Group', 'IsOnline', 'LastName', 'FirstName', 'Age', 'Gender', 'SolvedBefore', 'Insight', 'IsSolved',
    'TotalSubjectTrials', 'TrialIndex', 'RelativeTrial', 'TrialId', 'TrialDurationMs', 'MovementTimeMs', 'PauseTimeMs',
    'PhaseNum', 'PhaseName', 'IsSolutionTrial', 'IsOutsideMatrix', 'TargetZoneId', 'TargetZoneName', 'IsManualZoneOverride',
    'ApexOvershootPx', 'IdealOvershootPx', 'ApexErrorPx', 'SignedErrorPx', 'ApexFromDotCenterPx', 'IdealFromDotCenterPx', 'ToleranceMarginPx', 'InCorridor', 'ApexStatus',
    'TotalPathPx', 'PeakVelocityPxMs', 'AvgVelocityPxMs', 'LinesCount', 'TurnsCount'
  ];

  const probingLongCategory = [
    'ДЕМОГРАФИЯ И ГРУППА', 'ДЕМОГРАФИЯ И ГРУППА', 'ДЕМОГРАФИЯ И ГРУППА', 'ДЕМОГРАФИЯ И ГРУППА', 'ДЕМОГРАФИЯ И ГРУППА', 'ДЕМОГРАФИЯ И ГРУППА', 'ДЕМОГРАФИЯ И ГРУППА', 'ДЕМОГРАФИЯ И ГРУППА', 'ДЕМОГРАФИЯ И ГРУППА', 'РЕЗУЛЬТАТ',
    'ПОРЯДОК И ВРЕМЯ ПРОБЫ', 'ПОРЯДОК И ВРЕМЯ ПРОБЫ', 'ПОРЯДОК И ВРЕМЯ ПРОБЫ', 'ПОРЯДОК И ВРЕМЯ ПРОБЫ', 'ПОРЯДОК И ВРЕМЯ ПРОБЫ', 'КИНЕМАТИКА', 'КИНЕМАТИКА',
    'ФАЗА СЕССИИ', 'ФАЗА СЕССИИ', 'РЕЗУЛЬТАТ', 'ТОПОЛОГИЯ', 'ЗОНА ПОВОРОТА', 'ЗОНА ПОВОРОТА', 'ЭКСПЕРТНАЯ РАЗМЕТКА',
    'НАЩУПЫВАНИЕ (PROBING)', 'НАЩУПЫВАНИЕ (PROBING)', 'НАЩУПЫВАНИЕ (PROBING)', 'НАЩУПЫВАНИЕ (PROBING)', 'НАЩУПЫВАНИЕ (PROBING)', 'НАЩУПЫВАНИЕ (PROBING)', 'НАЩУПЫВАНИЕ (PROBING)', 'НАЩУПЫВАНИЕ (PROBING)', 'НАЩУПЫВАНИЕ (PROBING)',
    'КИНЕМАТИКА', 'КИНЕМАТИКА', 'КИНЕМАТИКА', 'СТРУКТУРА ПРОБЫ', 'СТРУКТУРА ПРОБЫ'
  ];

  const probingLongRowsRaw: any[][] = [];
  const probingLongRowsCSV: string[][] = [];

  subjects.forEach(s => {
    const hitPadding = s.calibration.hitPadding ?? 15;
    const subNodes = s.nodes;
    const subjectTrials = trialsBySubject.get(s.id) || [];

    const isPointInAnyNodeLocal = (p: Point) => isPointInAnyNode(p, subNodes, hitPadding);

    // First Trial Info
    const firstTrial = subjectTrials.length > 0 ? subjectTrials[0] : null;
    let firstTrialStartNode = 'none';
    let firstTrialFinishNode = 'none';
    let firstTrialFirstLineType = 'none';
    if (firstTrial) {
      const allNodes = firstTrial.lines.flatMap(l => l.nodesVisited);
      if (allNodes.length > 0) {
        firstTrialStartNode = allNodes[0].toString();
        firstTrialFinishNode = allNodes[allNodes.length - 1].toString();
      }
      const isOverridden = manualOverrides.has(`${firstTrial.subjectId}-${firstTrial.trialId}`);
      firstTrialFirstLineType = firstTrial.lines[0] ? (isOverridden ? 'прочая' : firstTrial.lines[0].type) : 'none';
    }

    // Kinematic Aggregation for Subject
    let kinTrialsCount = 0;
    let totalMovementTimeMs = 0;
    let totalPauseTimeMs = 0;
    let totalPauseCount = 0;
    let maxPauseMsInSubject = 0;
    let totalPathPxInSubject = 0;
    let totalPathMmInSubject = 0;
    let totalSegmentsInSubject = 0;
    let totalSegmentDurationMs = 0;
    let totalOutsideBoxTimeMs = 0;
    let trialsWithOutsideBoxCount = 0;
    let maxPeakVelPxMsInSubject = 0;
    let sumAvgVelPxMs = 0;
    let sumPeakVelPxMs = 0;

    subjectTrials.forEach(t => {
      const k = t.kinematics;
      if (!k) return;
      kinTrialsCount++;
      const m = k.metrics;
      totalMovementTimeMs += m.movementTimeMs;
      totalPauseTimeMs += m.pauseTimeMs;
      totalPauseCount += m.pauseCount;
      if (m.maxPauseMs > maxPauseMsInSubject) maxPauseMsInSubject = m.maxPauseMs;
      totalPathPxInSubject += m.totalPathPx;
      totalPathMmInSubject += m.totalPathMm;
      totalSegmentsInSubject += (m.segmentsCount || k.segments.length);
      totalOutsideBoxTimeMs += (m.outsideBoxTimeMs || 0);
      if (m.isOutsideBox) trialsWithOutsideBoxCount++;
      if (m.peakVelocityPxMs > maxPeakVelPxMsInSubject) maxPeakVelPxMsInSubject = m.peakVelocityPxMs;
      sumAvgVelPxMs += m.avgVelocityPxMs;
      sumPeakVelPxMs += m.peakVelocityPxMs;

      k.segments.forEach(seg => {
        totalSegmentDurationMs += seg.durationMs;
      });
    });

    const totalDurationMsInSubject = totalMovementTimeMs + totalPauseTimeMs;
    const meanMovementTimeS = kinTrialsCount > 0 ? (totalMovementTimeMs / kinTrialsCount / 1000).toFixed(2) : '0';
    const totalMovementTimeS = (totalMovementTimeMs / 1000).toFixed(2);
    const movementTimeRatio = totalDurationMsInSubject > 0 ? ((totalMovementTimeMs / totalDurationMsInSubject) * 100).toFixed(1) : '0';

    const meanPauseTimeS = kinTrialsCount > 0 ? (totalPauseTimeMs / kinTrialsCount / 1000).toFixed(2) : '0';
    const totalPauseTimeS = (totalPauseTimeMs / 1000).toFixed(2);
    const pauseTimeRatio = totalDurationMsInSubject > 0 ? ((totalPauseTimeMs / totalDurationMsInSubject) * 100).toFixed(1) : '0';
    const meanPauseCountPerTrial = kinTrialsCount > 0 ? (totalPauseCount / kinTrialsCount).toFixed(1) : '0';
    const maxPauseS = (maxPauseMsInSubject / 1000).toFixed(2);

    const meanVelocityPxS = kinTrialsCount > 0 ? ((sumAvgVelPxMs / kinTrialsCount) * 1000).toFixed(1) : '0';
    const meanVelocityMmS = kinTrialsCount > 0 ? (((sumAvgVelPxMs / kinTrialsCount) * 1000) * 0.264583).toFixed(1) : '0';
    const maxPeakVelocityPxS = (maxPeakVelPxMsInSubject * 1000).toFixed(1);
    const meanPeakVelocityPxS = kinTrialsCount > 0 ? ((sumPeakVelPxMs / kinTrialsCount) * 1000).toFixed(1) : '0';

    const totalPathPx = totalPathPxInSubject.toFixed(1);
    const totalPathMm = totalPathMmInSubject.toFixed(1);
    const meanPathPerTrialPx = kinTrialsCount > 0 ? (totalPathPxInSubject / kinTrialsCount).toFixed(1) : '0';
    const meanPathPerTrialMm = kinTrialsCount > 0 ? (totalPathMmInSubject / kinTrialsCount).toFixed(1) : '0';

    const meanSegmentsCountPerTrial = kinTrialsCount > 0 ? (totalSegmentsInSubject / kinTrialsCount).toFixed(1) : '0';
    const meanSegmentDurationMs = totalSegmentsInSubject > 0 ? (totalSegmentDurationMs / totalSegmentsInSubject).toFixed(0) : '0';

    const trialsWithOutsideBoxRatio = kinTrialsCount > 0 ? ((trialsWithOutsideBoxCount / kinTrialsCount) * 100).toFixed(1) : '0';
    const totalOutsideBoxTimeS = (totalOutsideBoxTimeMs / 1000).toFixed(2);
    const meanOutsideBoxTimePerTrialS = kinTrialsCount > 0 ? (totalOutsideBoxTimeMs / kinTrialsCount / 1000).toFixed(2) : '0';

    const lastTrial = subjectTrials.length > 0 ? subjectTrials[subjectTrials.length - 1] : null;
    const firstTrialOutsideBox = firstTrial?.kinematics?.metrics.isOutsideBox ? '1' : '0';
    const hasAnyOutsideBox = trialsWithOutsideBoxCount > 0 ? '1' : '0';
    const solutionTrialOutsideBox = (lastTrial && s.isSolved && lastTrial.kinematics?.metrics.isOutsideBox) ? '1' : '0';

    const subjectKinematicsValues = [
      meanVelocityPxS,
      meanVelocityMmS,
      maxPeakVelocityPxS,
      meanPeakVelocityPxS,
      meanMovementTimeS,
      totalMovementTimeS,
      movementTimeRatio,
      meanPauseTimeS,
      totalPauseTimeS,
      pauseTimeRatio,
      totalPauseCount,
      meanPauseCountPerTrial,
      maxPauseS,
      totalPathPx,
      totalPathMm,
      meanPathPerTrialPx,
      meanPathPerTrialMm,
      totalSegmentsInSubject,
      meanSegmentsCountPerTrial,
      meanSegmentDurationMs,
      trialsWithOutsideBoxCount,
      trialsWithOutsideBoxRatio,
      totalOutsideBoxTimeS,
      meanOutsideBoxTimePerTrialS,
      firstTrialOutsideBox,
      hasAnyOutsideBox,
      solutionTrialOutsideBox
    ];

    // Turn Stats
    let totalTurns = 0;
    let nonDotTurns = 0;
    subjectTrials.forEach(t => {
      totalTurns += t.breakPoints.length;
      t.breakPoints.forEach(p => {
        if (!isPointInAnyNodeLocal(p)) nonDotTurns++;
      });
    });
    const nonDotTurnsRatio = totalTurns > 0 ? (nonDotTurns / totalTurns).toFixed(4) : '0';

    // Start/Finish Outside Matrix Stats
    let linesStartOutside = 0;
    let linesFinishOutside = 0;
    let totalLinesCountInSubject = 0;
    subjectTrials.forEach(t => {
      t.lines.forEach((l, idx) => {
        if (excludedLines.has(`${t.subjectId}-${t.trialId}-${idx}`)) return;
        totalLinesCountInSubject++;
        if (!isPointInAnyNodeLocal(l.points[0])) linesStartOutside++;
        if (!isPointInAnyNodeLocal(l.points[l.points.length - 1])) linesFinishOutside++;
      });
    });
    const linesStartOutsideRel = totalLinesCountInSubject > 0 ? (linesStartOutside / totalLinesCountInSubject).toFixed(4) : '0';
    const linesFinishOutsideRel = totalLinesCountInSubject > 0 ? (linesFinishOutside / totalLinesCountInSubject).toFixed(4) : '0';

    // Lines by number of points connected (excluding 'прочая')
    let lines3Points = 0;
    let lines2Points = 0;
    let lines1Point = 0;

    subjectTrials.forEach(t => {
      const isOverridden = manualOverrides.has(`${t.subjectId}-${t.trialId}`);
      t.lines.forEach((l, idx) => {
        if (excludedLines.has(`${t.subjectId}-${t.trialId}-${idx}`)) return;
        const actualType = isOverridden ? 'прочая' : l.type;
        if (actualType !== 'прочая') {
          const uniqueNodes = new Set(l.nodesVisited).size;
          if (uniqueNodes === 3) lines3Points++;
          else if (uniqueNodes === 2) lines2Points++;
          else if (uniqueNodes === 1) lines1Point++;
        }
      });
    });

    const lines3PointsRel = totalLinesCountInSubject > 0 ? (lines3Points / totalLinesCountInSubject).toFixed(4) : '0';
    const lines2PointsRel = totalLinesCountInSubject > 0 ? (lines2Points / totalLinesCountInSubject).toFixed(4) : '0';
    const lines1PointRel = totalLinesCountInSubject > 0 ? (lines1Point / totalLinesCountInSubject).toFixed(4) : '0';

    let subjectLinesBothEndsInNodes = 0;
    let subjectLinesAnyEndOutside = 0;
    let subjectTotalLinesLength = 0;
    let subjectTotalOutsideLinesLength = 0;
    let subjectTotalOutsideLinesCount = 0;

    subjectTrials.forEach(t => {
      t.lines.forEach((l, idx) => {
        if (excludedLines.has(`${t.subjectId}-${t.trialId}-${idx}`)) return;

        let lineLen = 0;
        for (let m = 0; m < l.points.length - 1; m++) {
          lineLen += calculateDistance(l.points[m], l.points[m + 1]);
        }
        subjectTotalLinesLength += lineLen;

        const startAtNode = isPointInAnyNodeLocal(l.points[0]);
        const endAtNode = isPointInAnyNodeLocal(l.points[l.points.length - 1]);
        if (startAtNode && endAtNode) subjectLinesBothEndsInNodes++;
        if (!startAtNode || !endAtNode) {
          subjectLinesAnyEndOutside++;
          subjectTotalOutsideLinesLength += lineLen;
          subjectTotalOutsideLinesCount++;
        }
      });
    });

    const linesBothEndsInNodesRel = totalLinesCountInSubject > 0 ? (subjectLinesBothEndsInNodes / totalLinesCountInSubject).toFixed(4) : '0';
    const linesAnyEndOutsideRel = totalLinesCountInSubject > 0 ? (subjectLinesAnyEndOutside / totalLinesCountInSubject).toFixed(4) : '0';
    const avgAllLinesLengthInSubject = totalLinesCountInSubject > 0 ? (subjectTotalLinesLength / totalLinesCountInSubject).toFixed(2) : '0';
    const avgOutsideLinesLengthInSubject = subjectTotalOutsideLinesCount > 0 ? (subjectTotalOutsideLinesLength / subjectTotalOutsideLinesCount).toFixed(2) : '0';

    // Solution Trial Info
    let solutionStartNode = 'none';
    let solutionFinishNode = 'none';
    let solutionStartLine = '';

    if (lastTrial && s.isSolved) {
      const allNodes = lastTrial.lines.flatMap(l => l.nodesVisited);
      if (allNodes.length > 0) {
        solutionStartNode = allNodes[0].toString();
        solutionFinishNode = allNodes[allNodes.length - 1].toString();
      }
      const isOverridden = manualOverrides.has(`${lastTrial.subjectId}-${lastTrial.trialId}`);
      solutionStartLine = isOverridden ? 'прочая' : (lastTrial.lines[0]?.type || '');
    }

    const subjectLines = subjectTrials.flatMap(t => {
      const isOverridden = manualOverrides.has(`${t.subjectId}-${t.trialId}`);
      return t.lines
        .map((l, idx) => ({ l, idx }))
        .filter(({ idx }) => !excludedLines.has(`${t.subjectId}-${t.trialId}-${idx}`))
        .map(({ l }) => isOverridden ? 'прочая' : l.type);
    });

    const subject_total_solution_time_ms = subjectTrials.reduce((sum, t) => sum + (t.trial_time_ms || 0), 0);
    const subject_mean_trial_time_ms = subjectTrials.length > 0 ? subject_total_solution_time_ms / subjectTrials.length : 0;

    const lineCounts = lineTypes.map(lt => subjectLines.filter(type => type === lt).length);
    const startCounts = nodeIds.map(nodeId => subjectTrials.filter(t => t.lines[0]?.nodesVisited[0] === nodeId).length);
    const finishCounts = nodeIds.map(nodeId => subjectTrials.filter(t => {
      const lastLine = t.lines[t.lines.length - 1];
      return lastLine?.nodesVisited[lastLine.nodesVisited.length - 1] === nodeId;
    }).length);

    // Aggregate stats for first, second, third, and fourth lines across all trials
    const positionCounts = [1, 2, 3, 4].flatMap(pos => {
      return lineTypes.map(type => {
        return subjectTrials.filter(t => {
          const line = t.lines[pos - 1];
          if (!line) return false;
          const isOverridden = manualOverrides.has(`${t.subjectId}-${t.trialId}`);
          const actualType = isOverridden ? 'прочая' : line.type;
          return actualType === type;
        }).length;
      });
    });

    // Probing Corridor Metrics calculation (fully synchronized with Convergence Graph & Apex Configs)
    const subApexConfig = subjectApexConfigs[s.id] || s.apexConfig || {
      idealOvershoot: 116.0,
      toleranceMargin: 65.0,
      solveOverride: false,
      capMaxError: false
    };

    const idealStep = subApexConfig.idealOvershoot ?? 116.0;
    const toleranceMargin = subApexConfig.toleranceMargin ?? 65.0;
    const solveOverride = !!subApexConfig.solveOverride;
    const capMaxError = !!subApexConfig.capMaxError;

    let probingSumOvershoot = 0;
    let probingSumAbsError = 0;
    let probingInCorridorCount = 0;
    const probingTrialErrors: { x: number; y: number }[] = [];

    subjectTrials.forEach((t, tIdx) => {
      const isSolution = (tIdx === subjectTrials.length - 1) && !!s.isSolved;
      const trialKey = `${s.id}-${t.trialId}`;
      const manualOverrideZone = manualZoneOverrides[trialKey] || null;

      const apexRes = extractTrialApexOvershoot(t, s.nodes, {
        idealStep,
        tolerance: toleranceMargin,
        boxPadding: globalBoxPadding,
        isSolvedTrial: isSolution,
        solveOverride,
        capMaxError,
        overrideZoneId: manualOverrideZone
      });

      probingSumOvershoot += apexRes.overshootPx;
      probingSumAbsError += apexRes.absDeltaL;
      if (apexRes.status === 'hit') {
        probingInCorridorCount++;
      }
      probingTrialErrors.push({ x: tIdx + 1, y: apexRes.absDeltaL });

      // Build trial-level long format row for LMM / GLMM / Survival
      const phaseSizeForTrial = Math.floor(subjectTrials.length / 3);
      const phaseNumForTrial = tIdx < phaseSizeForTrial ? 1 : (tIdx < phaseSizeForTrial * 2 ? 2 : 3);
      const phaseNameForTrial = phaseNumForTrial === 1 ? 'Early' : (phaseNumForTrial === 2 ? 'Mid' : 'Late');

      const kMetrics = t.kinematics?.metrics;
      const mTimeMs = kMetrics?.movementTimeMs !== undefined ? Math.round(kMetrics.movementTimeMs) : '';
      const pTimeMs = kMetrics?.pauseTimeMs !== undefined ? Math.round(kMetrics.pauseTimeMs) : '';
      const totalPath = kMetrics?.totalPathPx !== undefined ? Number(kMetrics.totalPathPx.toFixed(1)) : '';
      const peakVel = kMetrics?.peakVelocityPxMs !== undefined ? Number(kMetrics.peakVelocityPxMs.toFixed(3)) : '';
      const avgVel = kMetrics?.avgVelocityPxMs !== undefined ? Number(kMetrics.avgVelocityPxMs.toFixed(3)) : '';

      const effectiveIdealFromBox = apexRes.effectiveIdealFromBox ?? Math.max(0, idealStep - globalBoxPadding);
      const overshootFromCenter = apexRes.overshootFromCenterPx ?? (apexRes.overshootPx + globalBoxPadding);

      const longRow = [
        s.id,
        subjectGroups[s.id] || s.group || 'None',
        s.isOnline ? 1 : 0,
        s.lastName || '',
        s.firstName || '',
        s.age || '',
        s.gender || '',
        s.solvedBefore || '',
        s.insight || '',
        s.isSolved ? 1 : 0,
        subjectTrials.length,
        tIdx + 1,
        subjectTrials.length > 0 ? Number(((tIdx + 1) / subjectTrials.length).toFixed(4)) : 0,
        t.trialId,
        Math.round(t.trial_time_ms || 0),
        mTimeMs,
        pTimeMs,
        phaseNumForTrial,
        phaseNameForTrial,
        isSolution ? 1 : 0,
        apexRes.hasExit ? 1 : 0,
        apexRes.activeZoneId || 'None',
        apexRes.activeZoneName || 'Нет вылета',
        manualOverrideZone ? 1 : 0,
        Number(apexRes.overshootPx.toFixed(1)),
        Number(effectiveIdealFromBox.toFixed(1)),
        Number(apexRes.absDeltaL.toFixed(1)),
        Number(apexRes.deltaL.toFixed(1)),
        Number(overshootFromCenter.toFixed(1)),
        Number(idealStep.toFixed(1)),
        Number(toleranceMargin.toFixed(1)),
        apexRes.status === 'hit' ? 1 : 0,
        apexRes.status,
        totalPath,
        peakVel,
        avgVel,
        t.lines.length,
        t.breakPoints.length
      ];

      probingLongRowsRaw.push(longRow.map(toNumericOrOriginal));
      probingLongRowsCSV.push(longRow.map(escapeCSV));
    });

    const probingMeanOvershoot = subjectTrials.length > 0 ? (probingSumOvershoot / subjectTrials.length).toFixed(1) : '0';
    const probingMeanAbsError = subjectTrials.length > 0 ? (probingSumAbsError / subjectTrials.length).toFixed(1) : '0';
    const probingInCorridorRatio = subjectTrials.length > 0 ? ((probingInCorridorCount / subjectTrials.length) * 100).toFixed(1) : '0';

    const ols = calculateOLS(probingTrialErrors);
    const probingSlope = probingTrialErrors.length > 1 ? ols.slope.toFixed(3) : '0';

    // Phase Stats logic
    const phaseSize = Math.floor(subjectTrials.length / 3);
    const subjectPhases = [
      subjectTrials.slice(0, phaseSize),
      subjectTrials.slice(phaseSize, phaseSize * 2),
      subjectTrials.slice(phaseSize * 2)
    ];

    const phaseStatsFlat: any[] = [];

    subjectPhases.forEach((phaseTrials, pIdx) => {
      const pTotal_solution_time_ms = phaseTrials.reduce((sum, t) => sum + (t.trial_time_ms || 0), 0);
      const pMean_trial_time_ms = phaseTrials.length > 0 ? pTotal_solution_time_ms / phaseTrials.length : 0;

      // Kinematic Phase Stats
      let pKinTrialsCount = 0;
      let pTotalMovementTimeMs = 0;
      let pTotalPauseTimeMs = 0;
      let pTotalPauseCount = 0;
      let pSumAvgVel = 0;
      let pMaxPeakVel = 0;
      let pOutsideBoxTrials = 0;

      phaseTrials.forEach(t => {
        const k = t.kinematics;
        if (!k) return;
        pKinTrialsCount++;
        pTotalMovementTimeMs += k.metrics.movementTimeMs;
        pTotalPauseTimeMs += k.metrics.pauseTimeMs;
        pTotalPauseCount += k.metrics.pauseCount;
        pSumAvgVel += k.metrics.avgVelocityPxMs;
        if (k.metrics.peakVelocityPxMs > pMaxPeakVel) pMaxPeakVel = k.metrics.peakVelocityPxMs;
        if (k.metrics.isOutsideBox) pOutsideBoxTrials++;
      });

      const pMeanMovementTimeS = pKinTrialsCount > 0 ? (pTotalMovementTimeMs / pKinTrialsCount / 1000).toFixed(2) : '0';
      const pMeanPauseTimeS = pKinTrialsCount > 0 ? (pTotalPauseTimeMs / pKinTrialsCount / 1000).toFixed(2) : '0';
      const pTotalDur = pTotalMovementTimeMs + pTotalPauseTimeMs;
      const pPauseTimeRatio = pTotalDur > 0 ? ((pTotalPauseTimeMs / pTotalDur) * 100).toFixed(1) : '0';
      const pMeanVelPxS = pKinTrialsCount > 0 ? ((pSumAvgVel / pKinTrialsCount) * 1000).toFixed(1) : '0';
      const pMaxPeakVelPxS = (pMaxPeakVel * 1000).toFixed(1);
      const pOutsideBoxRatio = pKinTrialsCount > 0 ? ((pOutsideBoxTrials / pKinTrialsCount) * 100).toFixed(1) : '0';

      let pTotalTurns = 0;
      let pNonDotTurns = 0;
      let pLinesStartOutside = 0;
      let pLinesFinishOutside = 0;
      let pLines3Points = 0;
      let pLines2Points = 0;
      let pLines1Point = 0;
      let pTotalLinesCount = 0;
      let pLinesBothEndsInNodes = 0;
      let pLinesAnyEndOutside = 0;
      let pTotalLinesLength = 0;
      let pTotalOutsideLinesLength = 0;
      let pTotalOutsideLinesCount = 0;

      phaseTrials.forEach(t => {
        pTotalTurns += t.breakPoints.length;
        t.breakPoints.forEach(pt => {
          if (!isPointInAnyNodeLocal(pt)) pNonDotTurns++;
        });

        const isOverridden = manualOverrides.has(`${t.subjectId}-${t.trialId}`);
        t.lines.forEach((l, idx) => {
          if (excludedLines.has(`${t.subjectId}-${t.trialId}-${idx}`)) return;
          pTotalLinesCount++;

          let lineLen = 0;
          for (let m = 0; m < l.points.length - 1; m++) {
            lineLen += calculateDistance(l.points[m], l.points[m + 1]);
          }
          pTotalLinesLength += lineLen;

          if (!isPointInAnyNodeLocal(l.points[0])) pLinesStartOutside++;
          if (!isPointInAnyNodeLocal(l.points[l.points.length - 1])) pLinesFinishOutside++;

          const startAtNode = isPointInAnyNodeLocal(l.points[0]);
          const endAtNode = isPointInAnyNodeLocal(l.points[l.points.length - 1]);
          if (startAtNode && endAtNode) pLinesBothEndsInNodes++;
          if (!startAtNode || !endAtNode) {
            pLinesAnyEndOutside++;
            pTotalOutsideLinesLength += lineLen;
            pTotalOutsideLinesCount++;
          }

          const actualType = isOverridden ? 'прочая' : l.type;
          if (actualType !== 'прочая') {
            const uniqueNodes = new Set(l.nodesVisited).size;
            if (uniqueNodes === 3) pLines3Points++;
            else if (uniqueNodes === 2) pLines2Points++;
            else if (uniqueNodes === 1) pLines1Point++;
          }
        });
      });

      const pNonDotTurnsRatio = pTotalTurns > 0 ? (pNonDotTurns / pTotalTurns).toFixed(4) : '0';
      const pLinesStartOutsideRel = pTotalLinesCount > 0 ? (pLinesStartOutside / pTotalLinesCount).toFixed(4) : '0';
      const pLinesFinishOutsideRel = pTotalLinesCount > 0 ? (pLinesFinishOutside / pTotalLinesCount).toFixed(4) : '0';
      const pLines3PointsRel = pTotalLinesCount > 0 ? (pLines3Points / pTotalLinesCount).toFixed(4) : '0';
      const pLines2PointsRel = pTotalLinesCount > 0 ? (pLines2Points / pTotalLinesCount).toFixed(4) : '0';
      const pLines1PointRel = pTotalLinesCount > 0 ? (pLines1Point / pTotalLinesCount).toFixed(4) : '0';
      const pLinesBothEndsInNodesRel = pTotalLinesCount > 0 ? (pLinesBothEndsInNodes / pTotalLinesCount).toFixed(4) : '0';
      const pLinesAnyEndOutsideRel = pTotalLinesCount > 0 ? (pLinesAnyEndOutside / pTotalLinesCount).toFixed(4) : '0';
      const pAvgAllLinesLength = pTotalLinesCount > 0 ? (pTotalLinesLength / pTotalLinesCount).toFixed(2) : '0';
      const pAvgOutsideLinesLength = pTotalOutsideLinesCount > 0 ? (pTotalOutsideLinesLength / pTotalOutsideLinesCount).toFixed(2) : '0';

      const pLines = phaseTrials.flatMap(t => {
        const isOverridden = manualOverrides.has(`${t.subjectId}-${t.trialId}`);
        return t.lines
          .map((l, idx) => ({ l, idx }))
          .filter(({ idx }) => !excludedLines.has(`${t.subjectId}-${t.trialId}-${idx}`))
          .map(({ l }) => isOverridden ? 'прочая' : l.type);
      });
      const pLineCounts = lineTypes.map(lt => pLines.filter(type => type === lt).length);
      const pStartCounts = nodeIds.map(nodeId => phaseTrials.filter(t => t.lines[0]?.nodesVisited[0] === nodeId).length);
      const pFinishCounts = nodeIds.map(nodeId => phaseTrials.filter(t => {
        const lastLine = t.lines[t.lines.length - 1];
        return lastLine?.nodesVisited[lastLine.nodesVisited.length - 1] === nodeId;
      }).length);

      const pMetrics = [
        phaseTrials.length,
        pTotalLinesCount,
        pMean_trial_time_ms.toFixed(2),
        pTotal_solution_time_ms.toFixed(0),
        pMeanVelPxS,
        pMaxPeakVelPxS,
        pMeanMovementTimeS,
        pMeanPauseTimeS,
        pPauseTimeRatio,
        pTotalPauseCount,
        pOutsideBoxTrials,
        pOutsideBoxRatio,
        pTotalTurns,
        pNonDotTurns,
        pNonDotTurnsRatio,
        pLinesStartOutside,
        pLinesStartOutsideRel,
        pLinesFinishOutside,
        pLinesFinishOutsideRel,
        pLines3Points,
        pLines3PointsRel,
        pLines2Points,
        pLines2PointsRel,
        pLines1Point,
        pLines1PointRel,
        pLinesBothEndsInNodes,
        pLinesBothEndsInNodesRel,
        pLinesAnyEndOutside,
        pLinesAnyEndOutsideRel,
        pAvgAllLinesLength,
        pAvgOutsideLinesLength,
        ...pLineCounts,
        ...pStartCounts,
        ...pFinishCounts
      ];

      phaseStatsFlat.push(...pMetrics);

      // Add to Sheet 2 (Tidy Long Format for Repeated Measures ANOVA / LMM)
      const pRow = [
        s.id,
        subjectGroups[s.id] || s.group || 'None',
        s.isOnline ? 1 : 0,
        s.lastName,
        s.firstName,
        s.age,
        s.gender,
        s.solvedBefore || '',
        s.insight || '',
        s.isSolved ? 1 : 0,
        pIdx + 1,
        phases[pIdx],
        ...pMetrics.map(toNumericOrOriginal)
      ];
      sheet2RowsRaw.push(pRow);
    });

    const values = [
      s.id,
      subjectGroups[s.id] || s.group || 'None',
      s.isOnline ? 1 : 0,
      s.lastName,
      s.firstName,
      s.age,
      s.gender,
      s.solvedBefore || '',
      s.insight || '',
      s.totalTaskTime !== undefined ? s.totalTaskTime.toString() : '',
      s.isSolved ? '1' : '0',
      subjectTrials.length,
      subjectLines.length,
      subject_mean_trial_time_ms.toFixed(2),
      subject_total_solution_time_ms.toFixed(0),
      ...allScaleNames.map(name => s.surveyScales?.[name] !== undefined ? s.surveyScales[name].toString() : ''),
      ...subjectKinematicsValues,
      solutionStartNode,
      solutionFinishNode,
      solutionStartLine,
      firstTrialStartNode,
      firstTrialFinishNode,
      firstTrialFirstLineType,
      totalTurns,
      nonDotTurns,
      nonDotTurnsRatio,
      linesStartOutside,
      linesStartOutsideRel,
      linesFinishOutside,
      linesFinishOutsideRel,
      lines3Points,
      lines3PointsRel,
      lines2Points,
      lines2PointsRel,
      lines1Point,
      lines1PointRel,
      subjectLinesBothEndsInNodes,
      linesBothEndsInNodesRel,
      subjectLinesAnyEndOutside,
      linesAnyEndOutsideRel,
      avgAllLinesLengthInSubject,
      avgOutsideLinesLengthInSubject,
      probingSlope,
      probingMeanOvershoot,
      probingMeanAbsError,
      probingInCorridorCount.toString(),
      probingInCorridorRatio,
      ...lineCounts,
      ...startCounts,
      ...finishCounts,
      ...positionCounts,
      ...phaseStatsFlat
    ];

    sheet1RowsRaw.push(values.map(toNumericOrOriginal));
    sheet1RowsCSV.push(values.map(escapeCSV));
  });

  return {
    headers,
    categoryHeaders,
    sheet1RowsRaw,
    sheet1RowsCSV,
    phaseSheetHeaders,
    phaseSheetCategory,
    sheet2RowsRaw,
    probingLongHeaders,
    probingLongCategory,
    probingLongRowsRaw,
    probingLongRowsCSV
  };
};

export const generateStatsCSV = (
  subjects: SubjectData[],
  processedData: ProcessedTrial[],
  manualOverrides: Set<string>,
  excludedLines: Set<string>,
  subjectGroups: Record<string, string>,
  excludedSubjects: Set<string> = new Set(),
  excludedTrials: Set<string> = new Set(),
  subjectApexConfigs: Record<string, ApexTargetConfig> = {},
  globalBoxPadding: number = 15.0,
  manualZoneOverrides: Record<string, TargetZoneId> = {}
): string => {
  const dataset = computeSummaryDataset(
    subjects,
    processedData,
    manualOverrides,
    excludedLines,
    subjectGroups,
    excludedSubjects,
    excludedTrials,
    subjectApexConfigs,
    globalBoxPadding,
    manualZoneOverrides
  );
  return [dataset.headers.join(','), ...dataset.sheet1RowsCSV.map(r => r.join(','))].join('\n');
};

export const generateProbingLongCSV = (
  subjects: SubjectData[],
  processedData: ProcessedTrial[],
  manualOverrides: Set<string>,
  excludedLines: Set<string>,
  subjectGroups: Record<string, string>,
  excludedSubjects: Set<string> = new Set(),
  excludedTrials: Set<string> = new Set(),
  subjectApexConfigs: Record<string, ApexTargetConfig> = {},
  globalBoxPadding: number = 15.0,
  manualZoneOverrides: Record<string, TargetZoneId> = {}
): string => {
  const dataset = computeSummaryDataset(
    subjects,
    processedData,
    manualOverrides,
    excludedLines,
    subjectGroups,
    excludedSubjects,
    excludedTrials,
    subjectApexConfigs,
    globalBoxPadding,
    manualZoneOverrides
  );
  return [dataset.probingLongHeaders.join(','), ...dataset.probingLongRowsCSV.map(r => r.join(','))].join('\n');
};

export const buildExcelWorkbookBlob = (
  subjects: SubjectData[] | any,
  processedData: ProcessedTrial[] | any,
  manualOverrides: Set<string> | any = new Set(),
  excludedLines: Set<string> | any = new Set(),
  subjectGroups: Record<string, string> | any = {},
  excludedSubjects: Set<string> | any = new Set(),
  excludedTrials: Set<string> | any = new Set(),
  subjectApexConfigs: Record<string, ApexTargetConfig> = {},
  globalBoxPadding: number = 15.0,
  manualZoneOverrides: Record<string, TargetZoneId> = {}
): Blob => {
  const dataset = computeSummaryDataset(
    subjects,
    processedData,
    manualOverrides,
    excludedLines,
    subjectGroups,
    excludedSubjects,
    excludedTrials,
    subjectApexConfigs,
    globalBoxPadding,
    manualZoneOverrides
  );

  const wb = XLSX.utils.book_new();

  // Sheet 1: Общая статистика (2-row header: Categories + English column names)
  const ws1Data = [
    dataset.categoryHeaders,
    dataset.headers,
    ...dataset.sheet1RowsRaw
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(ws1Data);

  // Sheet 2: По этапам (2-row header: Category description + Column names)
  const ws2Data = [
    dataset.phaseSheetCategory,
    dataset.phaseSheetHeaders,
    ...dataset.sheet2RowsRaw
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(ws2Data);

  // Sheet 3: Попробная динамика (LMM Long Format)
  const ws3Data = [
    dataset.probingLongCategory,
    dataset.probingLongHeaders,
    ...dataset.probingLongRowsRaw
  ];
  const ws3 = XLSX.utils.aoa_to_sheet(ws3Data);

  XLSX.utils.book_append_sheet(wb, ws1, 'Общая статистика');
  XLSX.utils.book_append_sheet(wb, ws2, 'По этапам');
  XLSX.utils.book_append_sheet(wb, ws3, 'Попробная динамика (LMM)');

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};

export const exportExcelWorkbook = (
  subjects: SubjectData[] | any,
  processedData: ProcessedTrial[] | any,
  manualOverrides: Set<string> | any = new Set(),
  excludedLines: Set<string> | any = new Set(),
  subjectGroups: Record<string, string> | any = {},
  excludedSubjects: Set<string> | any = new Set(),
  excludedTrials: Set<string> | any = new Set(),
  subjectApexConfigs: Record<string, ApexTargetConfig> = {},
  globalBoxPadding: number = 15.0,
  manualZoneOverrides: Record<string, TargetZoneId> = {}
): void => {
  const blob = buildExcelWorkbookBlob(
    subjects,
    processedData,
    manualOverrides,
    excludedLines,
    subjectGroups,
    excludedSubjects,
    excludedTrials,
    subjectApexConfigs,
    globalBoxPadding,
    manualZoneOverrides
  );
  const dateStr = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `sigma_summary_statistics_${dateStr}.xlsx`);
};

export const generateKinematicsCSV = (
  trials: ProcessedTrial[],
  subjects: SubjectData[],
  subjectGroups?: Record<string, string>,
  excludedSubjects: Set<string> = new Set(),
  excludedTrials: Set<string> = new Set()
): string => {
  subjects = subjects.filter(s => !excludedSubjects.has(s.id));
  trials = trials.filter(t => !excludedSubjects.has(t.subjectId) && !excludedTrials.has(`${t.subjectId}-${t.trialId}`));
  const headers = [
    'LastName', 'FirstName', 'Age', 'Gender', 'Group', 'SubjectId', 'IsSolved', 'IsOnline', 'TrialId',
    'DurationS', 'DurationMs', 'MovementTimeS', 'MovementTimeMs',
    'PauseTimeS', 'PauseTimeMs', 'PauseCount', 'MaxPauseS', 'MaxPauseMs',
    'PeakVelocityPxMs', 'PeakVelocityMmS', 'AvgVelocityPxMs',
    'TotalPathPx', 'TotalPathMm', 'IsOutsideBox', 'SegmentsCount',
    'CalibrationOffsetX', 'CalibrationOffsetY', 'CalibrationScale'
  ];

  const subjectsMap = new Map<string, SubjectData>();
  subjects.forEach(s => subjectsMap.set(s.id, s));

  const rows = trials.map(t => {
    const s = subjectsMap.get(t.subjectId);
    const k = t.kinematics?.metrics;
    const cal = s?.calibration || { offsetX: 0, offsetY: 0, scale: 1, hitPadding: 15 };
    const group = (subjectGroups && subjectGroups[t.subjectId]) || s?.group || '';

    return [
      `"${s?.lastName || ''}"`,
      `"${s?.firstName || ''}"`,
      s?.age || '',
      `"${s?.gender || ''}"`,
      `"${group}"`,
      `"${t.subjectId}"`,
      s?.isSolved ? '1' : '0',
      s?.isOnline ? '1' : '0',
      t.trialId,
      k?.durationS ?? ((t.trial_time_ms || 0) / 1000).toFixed(2),
      k?.durationMs ?? (t.trial_time_ms || 0),
      k?.movementTimeS ?? '',
      k?.movementTimeMs ?? '',
      k?.pauseTimeS ?? '',
      k?.pauseTimeMs ?? '',
      k?.pauseCount ?? '',
      k?.maxPauseS ?? '',
      k?.maxPauseMs ?? '',
      k?.peakVelocityPxMs ?? '',
      k?.peakVelocityMmS ?? '',
      k?.avgVelocityPxMs ?? '',
      k?.totalPathPx ?? '',
      k?.totalPathMm ?? '',
      k?.isOutsideBox ? '1' : '0',
      k?.segmentsCount ?? t.lines.length,
      cal.offsetX,
      cal.offsetY,
      cal.scale
    ].join(';');
  });

  return [headers.join(';'), ...rows].join('\n');
};

export const generateDuplexFullCSV = (
  filteredTrials: ProcessedTrial[],
  subjects: SubjectData[],
  manualOverrides: Set<string>,
  subjectGroups?: Record<string, string>,
  excludedSubjects: Set<string> = new Set(),
  excludedTrials: Set<string> = new Set()
): string => {
  subjects = subjects.filter(s => !excludedSubjects.has(s.id));
  filteredTrials = filteredTrials.filter(t => !excludedSubjects.has(t.subjectId) && !excludedTrials.has(`${t.subjectId}-${t.trialId}`));
  const headers = [
    'LastName', 'FirstName', 'Age', 'Gender', 'Group', 'SubjectId', 'IsSolved', 'IsOnline', 'TrialId',
    'LineIdx', 'OriginalType', 'ActualType', 'IsManualOverride', 'Nodes',
    'TrialDurationS', 'MovementTimeS', 'PauseTimeS', 'PauseCount', 'MaxPauseS',
    'PeakVelocityMmS', 'AvgVelocityPxMs', 'LineDurationS', 'LineLengthMm', 'LineAngleDeg',
    'IsOutsideBox', 'TrialFinishNode',
    'CalibrationOffsetX', 'CalibrationOffsetY', 'CalibrationScale'
  ];

  const subjectsMap = new Map<string, SubjectData>();
  subjects.forEach(s => subjectsMap.set(s.id, s));

  const rows = filteredTrials.flatMap(t => {
    const s = subjectsMap.get(t.subjectId);
    const k = t.kinematics;
    const km = k?.metrics;
    const cal = s?.calibration || { offsetX: 0, offsetY: 0, scale: 1, hitPadding: 15 };
    const group = (subjectGroups && subjectGroups[t.subjectId]) || s?.group || '';
    const overrideKey = `${t.subjectId}-${t.trialId}`;
    const isOverridden = manualOverrides.has(overrideKey);
    const lastLineOfTrial = t.lines[t.lines.length - 1];
    const trialFinishNode = lastLineOfTrial?.nodesVisited[lastLineOfTrial.nodesVisited.length - 1] || 'none';

    return t.lines.map((l, idx) => {
      const kSeg = k?.segments[idx];
      return [
        `"${s?.lastName || ''}"`,
        `"${s?.firstName || ''}"`,
        s?.age || '',
        `"${s?.gender || ''}"`,
        `"${group}"`,
        `"${t.subjectId}"`,
        s?.isSolved ? '1' : '0',
        s?.isOnline ? '1' : '0',
        t.trialId,
        idx + 1,
        `"${l.type}"`,
        `"${l.type}"`,
        isOverridden ? '1' : '0',
        `"${l.nodesVisited.join('-')}"`,
        km?.durationS ?? ((t.trial_time_ms || 0) / 1000).toFixed(2),
        km?.movementTimeS ?? '',
        km?.pauseTimeS ?? '',
        km?.pauseCount ?? '',
        km?.maxPauseS ?? '',
        km?.peakVelocityMmS ?? '',
        km?.avgVelocityPxMs ?? '',
        kSeg ? (kSeg.durationMs / 1000).toFixed(2) : '',
        kSeg?.lengthMm ?? '',
        kSeg?.angleDeg ?? '',
        (kSeg?.isOutsideBox || km?.isOutsideBox) ? '1' : '0',
        trialFinishNode,
        cal.offsetX,
        cal.offsetY,
        cal.scale
      ].join(';');
    });
  });

  return [headers.join(';'), ...rows].join('\n');
};
