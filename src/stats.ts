import { Point, ProcessedTrial, SubjectData } from './types';
import { calculateDistance } from './geometry';

export const generateFilteredCSV = (
  filteredTrials: ProcessedTrial[],
  subjects: SubjectData[],
  manualOverrides: Set<string>,
  subjectGroups: Record<string, string>
): string => {
  const headers = [
    'LastName', 'FirstName', 'Age', 'Gender', 'SolvedBefore', 'Insight', 'totalTaskTime',
    'Experience', 'SubjectId', 'Group', 'IsSolved', 'TrialId', 'trial_time_ms',
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

    const isAtNode = (p: Point) => subNodes.some(node => {
      const rx = (node.w / 2) + hitPadding;
      const ry = (node.h / 2) + hitPadding;
      const dx = (p.x - node.x) / rx;
      const dy = (p.y - node.y) / ry;
      return (dx * dx + dy * dy) <= 1.0;
    });

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
        subject?.experience || '',
        t.subjectId,
        subjectGroups[t.subjectId] || 'None',
        isSolved ? '1' : '0',
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
  subjectGroups: Record<string, string>
): string => {
  const headers = [
    'LastName', 'FirstName', 'Age', 'Gender', 'SolvedBefore', 'Insight', 'totalTaskTime',
    'Experience', 'SubjectId', 'Group', 'IsSolved', 'TrialId', 'trial_time_ms',
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

    const isAtNode = (p: Point) => subNodes.some(node => {
      const rx = (node.w / 2) + hitPadding;
      const ry = (node.h / 2) + hitPadding;
      const dx = (p.x - node.x) / rx;
      const dy = (p.y - node.y) / ry;
      return (dx * dx + dy * dy) <= 1.0;
    });

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
          subject.experience || '',
          t.subjectId,
          subjectGroups[subject.id] || 'None',
          isSolved ? '1' : '0',
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

export const generateStatsCSV = (
  subjects: SubjectData[],
  processedData: ProcessedTrial[],
  manualOverrides: Set<string>,
  excludedLines: Set<string>,
  subjectGroups: Record<string, string>
): string => {
  const lineTypes = ['боковая', 'центральная', 'диагональная', 'хордовая', 'хорды_длинные', 'внешняя', 'касательная', 'прочая'];
  const nodeIds = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  // Build headers for the 4 positions
  const posHeaders = [1, 2, 3, 4].flatMap(pos =>
    lineTypes.map(type => `Pos${pos}_Type_${type}`)
  );

  const phases = ['Beg', 'Mid', 'End'];

  const phaseHeaders = phases.flatMap(p => [
    `${p}_TrialsCount`, `${p}_LinesCount`, `${p}_mean_trial_time_ms`, `${p}_total_solution_time_ms`,
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

  const headers = [
    'LastName', 'FirstName', 'Age', 'Gender', 'SolvedBefore', 'Insight', 'totalTaskTime',
    ...allScaleNames.map(sc => `Scale_${sc}`),
    'Experience', 'SubjectId', 'Group', 'IsSolved', 'TrialsCount', 'LinesCount', 'mean_trial_time_ms', 'total_solution_time_ms',
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
  processedData.forEach(t => {
    if (!trialsBySubject.has(t.subjectId)) trialsBySubject.set(t.subjectId, []);
    trialsBySubject.get(t.subjectId)!.push(t);
  });

  const subjectRows = subjects.map(s => {
    const hitPadding = s.calibration.hitPadding ?? 15;
    const subNodes = s.nodes;
    const subjectTrials = trialsBySubject.get(s.id) || [];

    const isPointInAnyNodeLocal = (p: Point) => {
      return subNodes.some(node => {
        const rx = (node.w / 2) + hitPadding;
        const ry = (node.h / 2) + hitPadding;
        const dx = (p.x - node.x) / rx;
        const dy = (p.y - node.y) / ry;
        return (dx * dx + dy * dy) <= 1.0;
      });
    };

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
    const lastTrial = subjectTrials.length > 0 ? subjectTrials[subjectTrials.length - 1] : null;
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

    // Phase Stats logic
    const phaseSize = Math.floor(subjectTrials.length / 3);
    const subjectPhases = [
      subjectTrials.slice(0, phaseSize),
      subjectTrials.slice(phaseSize, phaseSize * 2),
      subjectTrials.slice(phaseSize * 2)
    ];

    const phaseStats = subjectPhases.flatMap(phaseTrials => {
      const pTotal_solution_time_ms = phaseTrials.reduce((sum, t) => sum + (t.trial_time_ms || 0), 0);
      const pMean_trial_time_ms = phaseTrials.length > 0 ? pTotal_solution_time_ms / phaseTrials.length : 0;

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

      return [
        phaseTrials.length,
        pTotalLinesCount,
        pMean_trial_time_ms.toFixed(2),
        pTotal_solution_time_ms.toFixed(0),
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
    });

    return [
      s.lastName,
      s.firstName,
      s.age,
      s.gender,
      s.solvedBefore || '',
      s.insight || '',
      s.totalTaskTime !== undefined ? s.totalTaskTime.toString() : '',
      ...allScaleNames.map(name => s.surveyScales?.[name] !== undefined ? s.surveyScales[name].toString() : ''),
      s.experience,
      s.id,
      subjectGroups[s.id] || 'None',
      s.isSolved ? '1' : '0',
      subjectTrials.length,
      subjectLines.length,
      subject_mean_trial_time_ms.toFixed(2),
      subject_total_solution_time_ms.toFixed(0),
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
      ...lineCounts,
      ...startCounts,
      ...finishCounts,
      ...positionCounts,
      ...phaseStats
    ];
  });

  return [headers.join(','), ...subjectRows.map(r => r.join(','))].join('\n');
};
