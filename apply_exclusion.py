
file_path = r"c:\Users\user\Desktop\GEM_phd\новый обработчик\src\stats.ts"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# Replace generateStatsCSV with the updated version with excludedSubjects
new_func_start = """export const generateStatsCSV = (
  subjects: SubjectData[],
  processedData: ProcessedTrial[],
  manualOverrides: Set<string>,
  excludedLines: Set<string>,
  subjectGroups: Record<string, string>,
  excludedSubjects: Set<string>
): string => {
  const filteredSubjects = subjects.filter(s => !excludedSubjects.has(s.id));
  const filteredProcessedData = processedData.filter(t => !excludedSubjects.has(t.subjectId));

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
    new Set(filteredSubjects.flatMap(s => Object.keys(s.surveyScales || {})))
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
    'LastName', 'FirstName', 'Age', 'Gender', 'SolvedBefore', 'Insight', 'totalTaskTime',
    ...allScaleNames.map(sc => `Scale_${sc}`),
    'Experience', 'SubjectId', 'Group', 'IsSolved', 'TrialsCount', 'LinesCount', 'mean_trial_time_ms', 'total_solution_time_ms',
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
    ...lineTypes.map(t => `LineType_${t}`),
    ...nodeIds.map(n => `StartNode_${n}`),
    ...nodeIds.map(n => `FinishNode_${n}`),
    ...posHeaders,
    ...phaseHeaders
  ];

  // Pre-group trials by subject for O(1) lookup
  const trialsBySubject = new Map<string, ProcessedTrial[]>();
  filteredProcessedData.forEach(t => {
    if (!trialsBySubject.has(t.subjectId)) trialsBySubject.set(t.subjectId, []);
    trialsBySubject.get(t.subjectId)!.push(t);
  });

  const escapeCSV = (val: any): string => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const subjectRows = filteredSubjects.map(s => {"""

import re
# Regex to find the function, assuming it starts with 'export const generateStatsCSV = (' and ends before 'export const generateKinematicsCSV = ('
pattern = r"export const generateStatsCSV = \([\s\S]*?\)\s*=>\s*\{"

# Just find the start point and replace up to a reasonable point or find the end
start_match = re.search(pattern, content)
if start_match:
    # Need to find the closing brace for the function... This is tricky with regex.
    # The function ends at '};' before 'export const generateKinematicsCSV'
    
    end_of_func_pattern = r"\n};\n\nexport const generateKinematicsCSV"
    end_match = re.search(end_of_func_pattern, content)
    
    if end_match:
        new_content = content[:start_match.start()] + new_func_start + content[content.find("    const hitPadding = s.calibration.hitPadding ?? 15;", start_match.end()):]
        # This is getting too complex. Let's do it by lines.
        pass

# Easier approach: replace lines 169 to wherever the end of function is.
lines = content.split('\n')
new_lines = []
in_func = False
for line in lines:
    if line.startswith("export const generateStatsCSV = ("):
        in_func = True
        new_lines.append(new_func_start)
        # Skip original lines
        continue
    if in_func and line.startswith("export const generateKinematicsCSV = ("):
        in_func = False
        new_lines.append(line)
        continue
    if not in_func:
        new_lines.append(line)

with open(file_path, "w", encoding="utf-8") as f:
    f.write('\n'.join(new_lines))
