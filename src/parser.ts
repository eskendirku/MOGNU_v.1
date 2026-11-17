import { Point, LineSegment, ProcessedTrial, GridNode, CSVParseResult } from './types';
import { CANVAS_SIZE, DOT_RADIUS, ANGLE_THRESHOLD_SPLIT, MIN_LINE_LENGTH, performSegmentation, distToSegment, classifyLine, computeGridBoundingBox } from './geometry';
import { analyzeKinematics } from './kinematics';

export const parseNum = (str: string): number => {
  if (!str) return NaN;
  return parseFloat(str.replace(',', '.').replace(/\s/g, ''));
};

export const detectDelimiter = (line: string): string => {
  const commaCount = (line.match(/,/g) || []).length;
  const semicolonCount = (line.match(/;/g) || []).length;
  return semicolonCount > commaCount ? ';' : ',';
};

export const decodeBuffer = (buffer: ArrayBuffer): string => {
  try {
    const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
    return utf8Decoder.decode(buffer);
  } catch {
    const winDecoder = new TextDecoder('windows-1251');
    return winDecoder.decode(buffer);
  }
};

export const processCSV = (
  csv: string,
  subjectId: string,
  angleThreshold = ANGLE_THRESHOLD_SPLIT,
  minLineLength = MIN_LINE_LENGTH
): CSVParseResult => {
  const rawLines = csv.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (rawLines.length < 10) throw new Error("Файл слишком короткий или поврежден.");

  const delimiter = detectDelimiter(rawLines[0]);

  // Check if first line is a header
  const firstLineLower = rawLines[0].toLowerCase();
  const hasHeader = firstLineLower.includes('iselement') ||
                    firstLineLower.includes('trial') ||
                    firstLineLower.includes('x') ||
                    firstLineLower.includes('y');

  // Column mapping
  const colMap: Record<string, number> = {};
  let isElemIdx = 0;
  let trialIdx = 1;
  let lineLengthIdx = 2;
  let xIdx = 3;
  let yIdx = 4;
  let time2Idx = 6;
  let genderIdx = -1;
  let ageIdx = -1;
  let solvedBeforeIdx = -1;
  let insightIdx = -1;
  let totalTaskTimeIdx = -1;
  let groupIdx = -1;
  let surnameIdx = -1;
  let firstnameIdx = -1;
  let nameIdx = -1;
  const scaleCols: { name: string; idx: number }[] = [];

  if (hasHeader) {
    const headerCols = rawLines[0].split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, ''));
    headerCols.forEach((col, idx) => {
      colMap[col.toLowerCase()] = idx;
    });

    isElemIdx = colMap['iselement'] ?? 0;
    trialIdx = colMap['trialnumber'] ?? colMap['trial'] ?? 1;
    lineLengthIdx = colMap['linelength'] ?? 2;
    xIdx = colMap['x'] ?? 3;
    yIdx = colMap['y'] ?? 4;
    time2Idx = colMap['time2'] ?? colMap['time1'] ?? 6;
    genderIdx = colMap['gender'] ?? -1;
    ageIdx = colMap['age'] ?? -1;
    solvedBeforeIdx = colMap['solvedbefore'] ?? -1;
    insightIdx = colMap['insight'] ?? -1;
    totalTaskTimeIdx = colMap['totaltasktime'] ?? -1;
    groupIdx = colMap['group'] ?? -1;

    for (const k of ['surname', 'lastname', 'last_name', 'фамилия', 'фамилия_испытуемого', 'secondname', 'second_name', 'familyname', 'family_name']) {
      if (colMap[k] !== undefined) { surnameIdx = colMap[k]; break; }
    }
    for (const k of ['firstname', 'first_name', 'имя', 'имя_испытуемого', 'forename', 'givenname', 'given_name']) {
      if (colMap[k] !== undefined) { firstnameIdx = colMap[k]; break; }
    }
    for (const k of ['name', 'фио', 'fio', 'full_name', 'fullname', 'subject_name', 'participant_name']) {
      if (colMap[k] !== undefined) { nameIdx = colMap[k]; break; }
    }

    // Standard columns to exclude from scales
    const knownStandardCols = new Set([
      'iselement', 'trialnumber', 'linelength', 'x', 'y', 'time1', 'time2',
      'group', 'isinverted', 'inertiastep', 'inertiainc', 'inertiasmoothing',
      'mirrorsize', 'mirrorthickness', 'mirrorduration',
      'solvedbefore', 'insight', 'gender', 'age', 'trialduration', 'totaltasktime',
      'surname', 'lastname', 'last_name', 'фамилия', 'фамилия_испытуемого',
      'secondname', 'second_name', 'familyname', 'family_name',
      'firstname', 'first_name', 'имя', 'имя_испытуемого', 'forename', 'givenname', 'given_name',
      'name', 'фио', 'fio', 'full_name', 'fullname', 'subject_name', 'participant_name'
    ]);

    headerCols.forEach((col, idx) => {
      const lower = col.toLowerCase();
      if (!knownStandardCols.has(lower) || lower.startsWith('slider') || ['удовольствие', 'удивление', 'внезапность', 'облегчение', 'уверенность', 'драйв'].includes(lower)) {
        if (!['0', '1', '2', '3', '4', '5', '6', '7'].includes(col)) {
          scaleCols.push({ name: col, idx });
        }
      }
    });
  }

  // Extract 9 dots: Rows where isElement === '1' and dot has valid dimensions
  const rawCoords: { id: number; x: number; y: number; h: number; w: number }[] = [];
  let dotId = 1;

  for (let i = hasHeader ? 1 : 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const cols = line.split(delimiter);
    if (cols[isElemIdx] === '1') {
      const x = parseNum(cols[1]);
      const y = parseNum(cols[2]);
      const w = parseNum(cols[3]);
      const h = parseNum(cols[4]);

      if (!isNaN(x) && !isNaN(y) && (w > 5 || isNaN(w))) {
        rawCoords.push({
          id: dotId++,
          x,
          y,
          h: isNaN(h) || h === 0 ? DOT_RADIUS * 2 : h,
          w: isNaN(w) || w === 0 ? DOT_RADIUS * 2 : w
        });
        if (rawCoords.length === 9) break;
      }
    }
  }

  if (rawCoords.length < 9) {
    throw new Error("Не удалось найти координаты 9 точек в файле (требуется 9 элементов с кодом 1).");
  }

  const uniqueX = Array.from(new Set(rawCoords.map(c => c.x))).sort((a, b) => a - b);
  const uniqueY = Array.from(new Set(rawCoords.map(c => c.y))).sort((a, b) => a - b);
  const dx = uniqueX.length > 1 ? (uniqueX[uniqueX.length - 1] - uniqueX[0]) / (uniqueX.length - 1) : 116;
  const dy = uniqueY.length > 1 ? (uniqueY[uniqueY.length - 1] - uniqueY[0]) / (uniqueY.length - 1) : 116;

  // 9 dots stably centered on canvas:
  const dot5 = rawCoords.find(c => c.id === 5) || rawCoords[4];
  const rawCenterX = dot5.x + dot5.w / 2;
  const rawCenterY = dot5.y + dot5.h / 2;
  const centerCanvas = CANVAS_SIZE / 2; // 400

  const extractedNodes: GridNode[] = rawCoords.map(c => ({
    id: c.id,
    rawX: c.x,
    rawY: c.y,
    x: centerCanvas + (c.x + c.w / 2 - rawCenterX),
    y: centerCanvas + (c.y + c.h / 2 - rawCenterY),
    w: c.w || DOT_RADIUS * 2,
    h: c.h || DOT_RADIUS * 2
  }));

  // Process trial lines and metadata
  const trialsMap = new Map<string | number, Point[]>();
  let lastName = subjectId;
  let firstName = '';
  let age = '---';
  let gender = 'другое';
  let solvedBefore = '';
  let insight = '';
  let totalTaskTime: number | undefined = undefined;
  let group = '';
  const surveyScales: Record<string, number> = {};
  let metadataExtracted = false;

  // For legacy files without header, metadata is at fixed lines 26-29, and trials start at line 30
  if (!hasHeader) {
    if (rawLines.length > 26) {
      const row27 = rawLines[26].split(delimiter);
      if (row27[1]?.trim()) lastName = row27[1].trim().replace(/^["']|["']$/g, '');
      if (row27[2]?.trim()) firstName = row27[2].trim().replace(/^["']|["']$/g, '');
    }
    if (rawLines.length > 27) {
      const row28 = rawLines[27].split(delimiter);
      if (row28[1]?.trim()) age = row28[1].trim();
    }
    if (rawLines.length > 28) {
      const row29 = rawLines[28].split(delimiter);
      const genderRaw = row29[1]?.trim();
      if (genderRaw === '0') gender = 'женский';
      else if (genderRaw === '1') gender = 'мужской';
    }
    if (rawLines.length > 29) {
      const row30 = rawLines[29].split(delimiter);
      if (row30[1]?.trim()) solvedBefore = row30[1].trim();
    }
    metadataExtracted = true;
  }

  const dataStartIdx = hasHeader ? 1 : 30;

  for (let i = dataStartIdx; i < rawLines.length; i++) {
    const line = rawLines[i];
    const cols = line.split(delimiter);
    if (cols[isElemIdx] !== '0') continue;

    const trialIdRaw = cols[trialIdx]?.trim();
    const trialIdNum = parseInt(trialIdRaw, 10);
    const lineLengthVal = cols[lineLengthIdx]?.trim().toLowerCase();

    // Skip screen resolution / setup row where lineLength is "seconds" or trialNumber is non-numeric
    if (isNaN(trialIdNum) || lineLengthVal === 'seconds' || trialIdNum <= 0) continue;

    const x = parseNum(cols[xIdx]);
    const y = parseNum(cols[yIdx]);
    const timestamp = time2Idx !== -1 ? parseNum(cols[time2Idx]) : 0;

    // Skip dummy 0,0 points that can occur before actual mouse movement
    if (x === 0 && y === 0) continue;

    if (!isNaN(x) && !isNaN(y)) {
      if (!trialsMap.has(trialIdNum)) trialsMap.set(trialIdNum, []);
      const baseX = centerCanvas + (x - rawCenterX);
      const baseY = centerCanvas + (y - rawCenterY);
      trialsMap.get(trialIdNum)?.push({ x: baseX, y: baseY, t: isNaN(timestamp) ? 0 : timestamp });
    }

    // Extract metadata ONCE from the first non-empty participant row
    if (!metadataExtracted) {
      if (genderIdx !== -1 && cols[genderIdx]) {
        const rawG = cols[genderIdx].trim();
        const lowerG = rawG.toLowerCase();
        if (rawG === '0' || lowerG === 'женский' || lowerG === 'ж' || lowerG === 'female' || lowerG === 'f') {
          gender = 'женский';
        } else if (rawG === '1' || lowerG === 'мужской' || lowerG === 'м' || lowerG === 'male' || lowerG === 'm') {
          gender = 'мужской';
        } else {
          gender = rawG;
        }
      }
      if (ageIdx !== -1 && cols[ageIdx]) {
        const rawAge = cols[ageIdx].trim();
        if (rawAge) age = rawAge;
      }
      if (solvedBeforeIdx !== -1 && cols[solvedBeforeIdx]) {
        solvedBefore = cols[solvedBeforeIdx].trim();
      }
      if (insightIdx !== -1 && cols[insightIdx]) {
        insight = cols[insightIdx].trim();
      }
      if (totalTaskTimeIdx !== -1 && cols[totalTaskTimeIdx]) {
        const ttt = parseNum(cols[totalTaskTimeIdx]);
        if (!isNaN(ttt)) totalTaskTime = ttt;
      }
      if (groupIdx !== -1 && cols[groupIdx]) {
        group = cols[groupIdx].trim();
      }
      if (surnameIdx !== -1 && cols[surnameIdx]) {
        const rawSur = cols[surnameIdx].trim().replace(/^["']|["']$/g, '');
        if (rawSur) lastName = rawSur;
      }
      if (firstnameIdx !== -1 && cols[firstnameIdx]) {
        const rawFirst = cols[firstnameIdx].trim().replace(/^["']|["']$/g, '');
        if (rawFirst) firstName = rawFirst;
      }
      if (nameIdx !== -1 && cols[nameIdx]) {
        const rawName = cols[nameIdx].trim().replace(/^["']|["']$/g, '');
        if (rawName) {
          if (surnameIdx === -1 && firstnameIdx === -1) {
            const parts = rawName.split(/\s+/);
            if (parts.length >= 2) {
              lastName = parts[0];
              firstName = parts.slice(1).join(' ');
            } else {
              lastName = rawName;
            }
          } else if (surnameIdx !== -1 && firstnameIdx === -1) {
            firstName = rawName;
          } else if (firstnameIdx !== -1 && surnameIdx === -1) {
            lastName = rawName;
          }
        }
      }

      scaleCols.forEach(sc => {
        if (cols[sc.idx]) {
          const val = parseNum(cols[sc.idx]);
          if (!isNaN(val)) surveyScales[sc.name] = val;
        }
      });

      if (gender !== 'другое' || age !== '---' || solvedBefore || totalTaskTime !== undefined || lastName !== subjectId || firstName !== '') {
        metadataExtracted = true;
      }
    }
  }

  const rx = dx / 2;
  const ry = dy / 2;
  const trials: ProcessedTrial[] = [];
  const gridBBox = computeGridBoundingBox(extractedNodes);

  trialsMap.forEach((points, trialId) => {
    if (points.length < 2) return;

    const trial_time_ms = points[points.length - 1].t || 0;
    const { lines, breakPoints, smoothed } = performSegmentation(points, angleThreshold, minLineLength);

    const lineSegments: LineSegment[] = lines.map(line => {
      const visited: number[] = [];
      for (let i = 0; i < line.points.length - 1; i++) {
        const p1 = line.points[i];
        const p2 = line.points[i + 1];
        extractedNodes.forEach(node => {
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
        ...line,
        nodesVisited: visited,
        type: classifyLine(visited)
      };
    });

    const kinematics = analyzeKinematics(points, gridBBox);

    if (lineSegments.length > 0) {
      trials.push({
        subjectId,
        trialId,
        basePoints: points,
        points,
        smoothedPoints: smoothed,
        startPoint: points[0],
        lines: lineSegments,
        breakPoints,
        trial_time_ms,
        kinematics
      });
    }
  });

  return {
    trials,
    nodes: extractedNodes,
    cellSize: { w: dx, h: dy },
    metadata: { lastName, firstName, age, gender, solvedBefore, insight, totalTaskTime, surveyScales, group }
  };
};
