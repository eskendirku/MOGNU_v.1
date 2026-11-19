import React, { useMemo, useState } from 'react';
import { ProcessedTrial, GridNode, Calibration, SubjectData, ApexTargetConfig, TargetZoneId } from '../types';
import { 
  TrendingDown, TrendingUp, Target, Users, User, Award, Info, 
  CheckCircle2, AlertCircle, Sparkles, RotateCcw, SlidersHorizontal, ShieldCheck, Check
} from 'lucide-react';
import { extractTrialApexOvershoot } from '../geometry';

interface ProbingConvergenceGraphProps {
  trials: ProcessedTrial[];
  nodes: GridNode[];
  calibration?: Calibration;
  selectedTrialId: string | number | null;
  onSelectTrial?: (trialId: string | number) => void;
  excludedTrials?: Set<string>;
  subjectId: string;
  allSubjects?: SubjectData[];
  allProcessedData?: ProcessedTrial[];
  subjectGroups?: Record<string, string>;
  excludedSubjects?: Set<string>;
  apexConfig?: ApexTargetConfig;
  onUpdateApexConfig?: (updates: Partial<ApexTargetConfig>) => void;
  onResetApexConfig?: () => void;
  onAutoAlignApex?: () => void;
  onBatchAutoAlignAllSolvers?: () => void;
  isCurrentSubjectSolved?: boolean;
  subjectApexConfigs?: Record<string, ApexTargetConfig>;
  globalBoxPadding?: number;
  onUpdateGlobalBoxPadding?: (pad: number) => void;
  manualZoneOverrides?: Record<string, TargetZoneId>;
}

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

export const ProbingConvergenceGraph: React.FC<ProbingConvergenceGraphProps> = ({
  trials,
  nodes,
  calibration,
  selectedTrialId,
  onSelectTrial,
  excludedTrials = new Set(),
  subjectId,
  allSubjects = [],
  allProcessedData = [],
  subjectGroups = {},
  excludedSubjects = new Set(),
  apexConfig,
  onUpdateApexConfig,
  onResetApexConfig,
  onAutoAlignApex,
  onBatchAutoAlignAllSolvers,
  isCurrentSubjectSolved = false,
  subjectApexConfigs = {},
  globalBoxPadding = 15.0,
  onUpdateGlobalBoxPadding,
  manualZoneOverrides = {}
}) => {
  const [viewMode, setViewMode] = useState<'single' | 'all_solvers' | 'groups'>('single');
  const [showConfigPanel, setShowConfigPanel] = useState<boolean>(true);
  const [hoveredPoint, setHoveredPoint] = useState<ProbingPoint | null>(null);
  const [hoveredAllPoint, setHoveredAllPoint] = useState<{
    trialNum: number;
    avgError: number;
    count: number;
  } | null>(null);
  const [hoveredGroupPoint, setHoveredGroupPoint] = useState<{
    group: string;
    trialNum: number;
    error: number;
    count: number;
    color: string;
  } | null>(null);

  // Per-subject or default baseline parameters (Variant 1: Baseline tolerance 65 px)
  const currentIdealOvershoot = apexConfig?.idealOvershoot ?? 116.0;
  const currentToleranceMargin = apexConfig?.toleranceMargin ?? 65.0;
  const solveOverride = !!apexConfig?.solveOverride;
  const capMaxError = !!apexConfig?.capMaxError;

  // Single Subject Metrics calculation
  const { points, slope, rSquared, avgErrorFirstThird, avgErrorLastThird } = useMemo(() => {
    if (!trials || trials.length === 0 || !nodes || nodes.length < 9) {
      return { points: [], slope: 0, rSquared: 0, avgErrorFirstThird: 0, avgErrorLastThird: 0 };
    }

    const pts: ProbingPoint[] = [];

    trials.forEach((t, idx) => {
      const isExcluded = excludedTrials.has(`${subjectId}-${t.trialId}`);
      const isSolutionTrial = (idx === trials.length - 1) && !!isCurrentSubjectSolved;
      const trialKey = `${subjectId}-${t.trialId}`;
      const manualOverrideZone = manualZoneOverrides[trialKey] || null;

      const apexRes = extractTrialApexOvershoot(t, nodes, {
        idealStep: currentIdealOvershoot,
        tolerance: currentToleranceMargin,
        boxPadding: globalBoxPadding ?? 15.0,
        isSolvedTrial: isSolutionTrial,
        solveOverride,
        capMaxError,
        overrideZoneId: manualOverrideZone
      });

      const hasChord = t.lines.some(l => l.type === 'хордовая');

      pts.push({
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

    // Linear regression on non-excluded points
    const validPts = pts.filter(p => !p.isExcluded);
    let regSlope = 0;
    let r2 = 0;

    if (validPts.length > 1) {
      const n = validPts.length;
      let sumX = 0;
      let sumY = 0;
      let sumXY = 0;
      let sumXX = 0;
      let sumYY = 0;

      validPts.forEach(p => {
        sumX += p.trialNum;
        sumY += p.absDeltaL;
        sumXY += p.trialNum * p.absDeltaL;
        sumXX += p.trialNum * p.trialNum;
        sumYY += p.absDeltaL * p.absDeltaL;
      });

      const denom = (n * sumXX - sumX * sumX);
      if (denom !== 0) {
        regSlope = (n * sumXY - sumX * sumY) / denom;
        const numR = (n * sumXY - sumX * sumY);
        const denR = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
        if (denR !== 0) {
          r2 = Math.pow(numR / denR, 2);
        }
      }
    }

    // Comparison: first third vs last third
    const thirdSize = Math.max(1, Math.floor(validPts.length / 3));
    const firstThird = validPts.slice(0, thirdSize);
    const lastThird = validPts.slice(validPts.length - thirdSize);

    const avgFirst = firstThird.length > 0 
      ? firstThird.reduce((s, p) => s + p.absDeltaL, 0) / firstThird.length 
      : 0;
    const avgLast = lastThird.length > 0 
      ? lastThird.reduce((s, p) => s + p.absDeltaL, 0) / lastThird.length 
      : 0;

    return {
      points: pts,
      slope: regSlope,
      rSquared: r2,
      avgErrorFirstThird: Math.round(avgFirst),
      avgErrorLastThird: Math.round(avgLast)
    };
  }, [trials, nodes, excludedTrials, subjectId, currentIdealOvershoot, currentToleranceMargin, solveOverride, capMaxError, isCurrentSubjectSolved]);

  // Population metrics for ALL successful solvers across ALL groups combined
  const allSolversSeries = useMemo(() => {
    if (!allSubjects || allSubjects.length === 0 || !allProcessedData || allProcessedData.length === 0) {
      return {
        solversCount: 0,
        points: [] as { trialNum: number; avgError: number; count: number }[],
        slope: 0,
        rSquared: 0,
        avgFirstThird: 0,
        avgLastThird: 0
      };
    }

    const solvers = allSubjects.filter(s => s.isSolved && !excludedSubjects.has(s.id));
    if (solvers.length === 0) {
      return {
        solversCount: 0,
        points: [] as { trialNum: number; avgError: number; count: number }[],
        slope: 0,
        rSquared: 0,
        avgFirstThird: 0,
        avgLastThird: 0
      };
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
          boxPadding: globalBoxPadding ?? 15.0,
          isSolvedTrial: isSolution,
          solveOverride: !!subApexConfig.solveOverride,
          capMaxError: !!subApexConfig.capMaxError,
          overrideZoneId: manualOverrideZone
        });
        errorMap.set(idx + 1, apexRes.absDeltaL);
      });

      solverTrialsList.push({ errorByTrial: errorMap });
    });

    const pts: { trialNum: number; avgError: number; count: number }[] = [];
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
        pts.push({ trialNum: tNum, avgError: Math.round(sum / count), count });
      }
    }

    let slopeVal = 0;
    let r2Val = 0;
    if (pts.length > 1) {
      const n = pts.length;
      let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;
      pts.forEach(p => {
        sumX += p.trialNum;
        sumY += p.avgError;
        sumXY += p.trialNum * p.avgError;
        sumXX += p.trialNum * p.trialNum;
        sumYY += p.avgError * p.avgError;
      });
      const denom = (n * sumXX - sumX * sumX);
      if (denom !== 0) {
        slopeVal = (n * sumXY - sumX * sumY) / denom;
        const numR = (n * sumXY - sumX * sumY);
        const denR = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
        if (denR !== 0) r2Val = Math.pow(numR / denR, 2);
      }
    }

    const thirdSize = Math.max(1, Math.floor(pts.length / 3));
    const firstThird = pts.slice(0, thirdSize);
    const lastThird = pts.slice(pts.length - thirdSize);
    const avgFirst = firstThird.length > 0 ? firstThird.reduce((s, p) => s + p.avgError, 0) / firstThird.length : 0;
    const avgLast = lastThird.length > 0 ? lastThird.reduce((s, p) => s + p.avgError, 0) / lastThird.length : 0;

    return {
      solversCount: solvers.length,
      points: pts,
      slope: +slopeVal.toFixed(2),
      rSquared: +r2Val.toFixed(2),
      avgFirstThird: Math.round(avgFirst),
      avgLastThird: Math.round(avgLast)
    };
  }, [allSubjects, allProcessedData, excludedSubjects, excludedTrials, subjectApexConfigs]);

  // Group Comparison calculation (for solvers grouped by experimental condition)
  const groupSeries = useMemo(() => {
    if (!allSubjects || allSubjects.length === 0 || !allProcessedData || allProcessedData.length === 0) {
      return [];
    }

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

    const results: {
      groupName: string;
      color: { stroke: string; fill: string };
      solversCount: number;
      points: { trialNum: number; avgError: number; count: number }[];
      slope: number;
      rSquared: number;
    }[] = [];

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
            boxPadding: globalBoxPadding ?? 15.0,
            isSolvedTrial: isSolution,
            solveOverride: !!subApexConfig.solveOverride,
            capMaxError: !!subApexConfig.capMaxError,
            overrideZoneId: manualOverrideZone
          });
          errorMap.set(idx + 1, apexRes.absDeltaL);
        });

        solverTrialsList.push({ errorByTrial: errorMap });
      });

      const pts: { trialNum: number; avgError: number; count: number }[] = [];
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
          pts.push({ trialNum: tNum, avgError: Math.round(sum / count), count });
        }
      }

      let slopeVal = 0;
      let r2Val = 0;
      if (pts.length > 1) {
        const n = pts.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;
        pts.forEach(p => {
          sumX += p.trialNum;
          sumY += p.avgError;
          sumXY += p.trialNum * p.avgError;
          sumXX += p.trialNum * p.trialNum;
          sumYY += p.avgError * p.avgError;
        });
        const denom = (n * sumXX - sumX * sumX);
        if (denom !== 0) {
          slopeVal = (n * sumXY - sumX * sumY) / denom;
          const numR = (n * sumXY - sumX * sumY);
          const denR = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
          if (denR !== 0) r2Val = Math.pow(numR / denR, 2);
        }
      }

      results.push({
        groupName: gName,
        color: colors[colorIdx % colors.length],
        solversCount: gSolvers.length,
        points: pts,
        slope: +slopeVal.toFixed(2),
        rSquared: +r2Val.toFixed(2)
      });
      colorIdx++;
    });

    return results;
  }, [allSubjects, allProcessedData, subjectGroups, excludedSubjects, excludedTrials, subjectApexConfigs]);

  // Dimensions for SVG rendering
  const width = 420;
  const height = 150;
  const padLeft = 40;
  const padRight = 20;
  const padTop = 15;
  const padBottom = 25;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  // Maximum scale calculations
  const maxErrorSingle = Math.max(180, ...points.map(p => p.absDeltaL));
  const maxAllTrials = Math.max(1, ...allSolversSeries.points.map(p => p.trialNum));
  const maxAllError = Math.max(160, ...allSolversSeries.points.map(p => p.avgError));
  const maxGroupTrials = Math.max(1, ...groupSeries.flatMap(g => g.points.map(p => p.trialNum)));
  const maxGroupError = Math.max(160, ...groupSeries.flatMap(g => g.points.map(p => p.avgError)));

  const maxError = viewMode === 'single' ? maxErrorSingle : (viewMode === 'all_solvers' ? maxAllError : maxGroupError);
  const maxTrials = viewMode === 'single' ? Math.max(1, points.length) : (viewMode === 'all_solvers' ? maxAllTrials : maxGroupTrials);

  const getX = (trialNum: number) => {
    if (maxTrials <= 1) return padLeft + plotW / 2;
    return padLeft + ((trialNum - 1) / (maxTrials - 1)) * plotW;
  };

  const getY = (err: number) => {
    return padTop + (1 - Math.min(maxError, err) / maxError) * plotH;
  };

  const isConverging = slope < -0.5;
  const isAllConverging = allSolversSeries.slope < -0.3;

  return (
    <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 shadow-xl flex flex-col select-none">
      {/* Header with Title and Mode Switcher */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg ${
            (viewMode === 'single' ? isConverging : isAllConverging)
              ? 'bg-emerald-500/20 text-emerald-400' 
              : 'bg-slate-800 text-slate-400'
          }`}>
            {(viewMode === 'single' ? isConverging : isAllConverging) ? <TrendingDown size={16} /> : <TrendingUp size={16} />}
          </div>
          <div>
            <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
              <span>
                {viewMode === 'single' && 'Динамика нащупывания апекса'}
                {viewMode === 'all_solvers' && 'Все успешные решатели (общий тренд)'}
                {viewMode === 'groups' && 'Сравнение групп успешных решателей'}
              </span>
              {viewMode === 'single' && isConverging && (
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-black uppercase">
                  Сходимость
                </span>
              )}
              {viewMode === 'all_solvers' && isAllConverging && (
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-300 font-black uppercase">
                  Сходимость популяции
                </span>
              )}
            </h4>
            <div className="text-[10px] text-slate-400">
              Ошибка вылета: <span className="font-mono text-slate-300">|L_вылет - {Math.round(currentIdealOvershoot)} px|</span>
            </div>
          </div>
        </div>

        {/* View Mode Toggle Switcher (3 Tabs) */}
        <div className="flex items-center gap-2">
          {allSubjects.length > 0 && (
            <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800">
              <button
                onClick={() => setViewMode('single')}
                className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 transition-all ${
                  viewMode === 'single'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Анализ текущего испытуемого"
              >
                <User size={11} /> Испытуемый
              </button>
              <button
                onClick={() => setViewMode('all_solvers')}
                className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 transition-all ${
                  viewMode === 'all_solvers'
                    ? 'bg-sky-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Общий график сходимости всех успешных испытуемых из всех групп"
              >
                <Award size={11} /> Все успешные
              </button>
              <button
                onClick={() => setViewMode('groups')}
                className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 transition-all ${
                  viewMode === 'groups'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Сравнение трендов ошибки по группам (только успешные решатели)"
              >
                <Users size={11} /> По группам
              </button>
            </div>
          )}

          {viewMode === 'single' && (
            <div className="flex flex-col items-end">
              <div className="flex items-center gap-1 text-[11px] font-mono font-bold">
                <span className="text-slate-400">Тренд:</span>
                <span className={slope < 0 ? 'text-emerald-400' : 'text-slate-300'}>
                  {slope > 0 ? `+${slope.toFixed(2)}` : slope.toFixed(2)} px/пр
                </span>
              </div>
              <span className="text-[9px] text-slate-500 font-mono">
                R² = {rSquared.toFixed(2)}
              </span>
            </div>
          )}

          {viewMode === 'all_solvers' && (
            <div className="flex flex-col items-end">
              <div className="flex items-center gap-1 text-[11px] font-mono font-bold">
                <span className="text-slate-400">Популяция:</span>
                <span className={allSolversSeries.slope < 0 ? 'text-sky-400' : 'text-slate-300'}>
                  {allSolversSeries.slope > 0 ? `+${allSolversSeries.slope}` : allSolversSeries.slope} px/пр
                </span>
              </div>
              <span className="text-[9px] text-slate-500 font-mono">
                R² = {allSolversSeries.rSquared.toFixed(2)} · N = {allSolversSeries.solversCount}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Interactive SVG Canvas */}
      <div className="w-full relative bg-slate-950 rounded-xl border border-slate-800/80 p-1">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
          {/* Target Green Tolerance Window: 0 to currentToleranceMargin px error */}
          <rect
            x={padLeft}
            y={getY(currentToleranceMargin)}
            width={plotW}
            height={getY(0) - getY(currentToleranceMargin)}
            fill="rgba(16, 185, 129, 0.12)"
          />
          <line
            x1={padLeft}
            y1={getY(currentToleranceMargin)}
            x2={padLeft + plotW}
            y2={getY(currentToleranceMargin)}
            stroke="#10b981"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.6"
          />
          <text
            x={padLeft + 5}
            y={getY(currentToleranceMargin) + 10}
            fill="#10b981"
            fontSize="8"
            fontWeight="bold"
            opacity="0.8"
          >
            Целевое окно (вылет {Math.round(currentIdealOvershoot - currentToleranceMargin)}–{Math.round(currentIdealOvershoot + currentToleranceMargin)} px)
          </text>

          {/* Grid lines and Y-axis marks */}
          <line x1={padLeft} y1={getY(0)} x2={padLeft + plotW} y2={getY(0)} stroke="#334155" strokeWidth="1" />
          <line x1={padLeft} y1={getY(currentIdealOvershoot)} x2={padLeft + plotW} y2={getY(currentIdealOvershoot)} stroke="#1e293b" strokeWidth="1" strokeDasharray="2 2" />
          <line x1={padLeft} y1={padTop} x2={padLeft} y2={padTop + plotH} stroke="#334155" strokeWidth="1" />

          <text x={padLeft - 6} y={getY(0) + 3} fill="#64748b" fontSize="8" textAnchor="end">0</text>
          <text x={padLeft - 6} y={getY(currentToleranceMargin) + 3} fill="#10b981" fontSize="8" textAnchor="end">{Math.round(currentToleranceMargin)}</text>
          <text x={padLeft - 6} y={getY(currentIdealOvershoot) + 3} fill="#64748b" fontSize="8" textAnchor="end">{Math.round(currentIdealOvershoot)}</text>
          <text x={padLeft - 6} y={padTop + 6} fill="#64748b" fontSize="8" textAnchor="end">{Math.round(maxError)}</text>

          {/* MODE 1: SINGLE SUBJECT VIEW */}
          {viewMode === 'single' && (
            <>
              {/* Regression Trend Line */}
              {points.length > 1 && (
                <line
                  x1={getX(1)}
                  y1={getY(Math.max(0, points[0].absDeltaL + slope * (1 - 1)))}
                  x2={getX(points.length)}
                  y2={getY(Math.max(0, points[0].absDeltaL + slope * (points.length - 1)))}
                  stroke="#f43f5e"
                  strokeWidth="2"
                  strokeDasharray="4 3"
                  opacity="0.75"
                />
              )}

              {/* Connecting Line between points */}
              {points.length > 1 && (
                <polyline
                  fill="none"
                  stroke="rgba(148, 163, 184, 0.35)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  points={points.map(p => `${getX(p.trialNum)},${getY(p.absDeltaL)}`).join(' ')}
                />
              )}

              {/* Data Points with fixed stable hit area */}
              {points.map((p) => {
                const cx = getX(p.trialNum);
                const cy = getY(p.absDeltaL);
                const isSelected = selectedTrialId === p.trialId;
                const isHovered = hoveredPoint?.trialId === p.trialId;

                let fillColor = '#64748b';
                if (p.status === 'hit') fillColor = '#10b981';
                else if (p.status === 'overshoot') fillColor = '#f43f5e';
                else if (p.status === 'undershoot') fillColor = '#38bdf8';
                else if (p.status === 'inside') fillColor = '#475569';

                return (
                  <g
                    key={p.trialId}
                    className="cursor-pointer"
                    onClick={() => onSelectTrial && onSelectTrial(p.trialId)}
                    onMouseEnter={() => setHoveredPoint(p)}
                    onMouseLeave={() => setHoveredPoint(null)}
                  >
                    {/* Transparent stable hit circle */}
                    <circle cx={cx} cy={cy} r="12" fill="transparent" />

                    {isSelected && (
                      <circle cx={cx} cy={cy} r="7" fill="none" stroke="#6366f1" strokeWidth="2.5" />
                    )}
                    {p.hasChordLine && (
                      <circle cx={cx} cy={cy} r="5.5" fill="none" stroke="#fbbf24" strokeWidth="1.5" />
                    )}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={isSelected || isHovered ? 4.5 : 3}
                      fill={fillColor}
                      stroke={p.isExcluded ? '#f43f5e' : (p.status === 'hit' ? '#ffffff' : '#0f172a')}
                      strokeWidth={p.isExcluded ? 2 : 1}
                      strokeDasharray={p.isExcluded ? '2 1' : 'none'}
                      opacity={p.isExcluded ? 0.4 : 1}
                    />
                  </g>
                );
              })}
            </>
          )}

          {/* MODE 2: ALL SOLVERS POOLED VIEW */}
          {viewMode === 'all_solvers' && allSolversSeries.points.length > 0 && (
            <>
              {/* Regression Trend Line */}
              {allSolversSeries.points.length > 1 && (
                <line
                  x1={getX(1)}
                  y1={getY(Math.max(0, allSolversSeries.points[0].avgError + allSolversSeries.slope * (1 - 1)))}
                  x2={getX(allSolversSeries.points.length)}
                  y2={getY(Math.max(0, allSolversSeries.points[0].avgError + allSolversSeries.slope * (allSolversSeries.points.length - 1)))}
                  stroke="#f43f5e"
                  strokeWidth="2"
                  strokeDasharray="4 3"
                  opacity="0.8"
                />
              )}

              {/* Area fill under curve */}
              {allSolversSeries.points.length > 1 && (
                <polygon
                  fill="rgba(56, 189, 248, 0.12)"
                  points={`${getX(1)},${getY(0)} ${allSolversSeries.points.map(p => `${getX(p.trialNum)},${getY(p.avgError)}`).join(' ')} ${getX(allSolversSeries.points[allSolversSeries.points.length - 1].trialNum)},${getY(0)}`}
                />
              )}

              {/* Connecting Line */}
              <polyline
                fill="none"
                stroke="#38bdf8"
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={allSolversSeries.points.map(p => `${getX(p.trialNum)},${getY(p.avgError)}`).join(' ')}
              />

              {/* Points */}
              {allSolversSeries.points.map((p) => {
                const cx = getX(p.trialNum);
                const cy = getY(p.avgError);
                const isHovered = hoveredAllPoint?.trialNum === p.trialNum;

                return (
                  <g
                    key={`all-${p.trialNum}`}
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredAllPoint(p)}
                    onMouseLeave={() => setHoveredAllPoint(null)}
                  >
                    <circle cx={cx} cy={cy} r="10" fill="transparent" />
                    <circle
                      cx={cx}
                      cy={cy}
                      r={isHovered ? 5.5 : 3.5}
                      fill="#38bdf8"
                      stroke="#0f172a"
                      strokeWidth="1.5"
                    />
                  </g>
                );
              })}
            </>
          )}

          {/* MODE 3: GROUP COMPARISON VIEW */}
          {viewMode === 'groups' && (
            <>
              {groupSeries.map((group) => {
                if (group.points.length === 0) return null;
                const polyPoints = group.points.map(p => `${getX(p.trialNum)},${getY(p.avgError)}`).join(' ');

                // Regression line for group
                const firstPt = group.points[0];
                const lastPt = group.points[group.points.length - 1];

                return (
                  <g key={group.groupName}>
                    {/* Trendline */}
                    {group.points.length > 1 && (
                      <line
                        x1={getX(firstPt.trialNum)}
                        y1={getY(Math.max(0, firstPt.avgError + group.slope * (firstPt.trialNum - 1)))}
                        x2={getX(lastPt.trialNum)}
                        y2={getY(Math.max(0, firstPt.avgError + group.slope * (lastPt.trialNum - 1)))}
                        stroke={group.color.stroke}
                        strokeWidth="1.5"
                        strokeDasharray="3 3"
                        opacity="0.5"
                      />
                    )}

                    {/* Connecting line */}
                    <polyline
                      fill="none"
                      stroke={group.color.stroke}
                      strokeWidth="2"
                      strokeLinejoin="round"
                      points={polyPoints}
                      opacity="0.85"
                    />

                    {/* Points with stable hit area */}
                    {group.points.map(p => {
                      const cx = getX(p.trialNum);
                      const cy = getY(p.avgError);
                      const isHovered = hoveredGroupPoint?.group === group.groupName && hoveredGroupPoint.trialNum === p.trialNum;

                      return (
                        <g
                          key={`${group.groupName}-${p.trialNum}`}
                          className="cursor-pointer"
                          onMouseEnter={() => setHoveredGroupPoint({
                            group: group.groupName,
                            trialNum: p.trialNum,
                            error: p.avgError,
                            count: p.count,
                            color: group.color.stroke
                          })}
                          onMouseLeave={() => setHoveredGroupPoint(null)}
                        >
                          <circle cx={cx} cy={cy} r="10" fill="transparent" />
                          <circle
                            cx={cx}
                            cy={cy}
                            r={isHovered ? 4.5 : 2.5}
                            fill={group.color.fill}
                            stroke="#0f172a"
                            strokeWidth="1"
                          />
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </>
          )}
        </svg>

        {/* Hover Tooltip for Single Subject Point */}
        {viewMode === 'single' && hoveredPoint && (
          <div className="absolute top-2 right-2 bg-slate-900/95 backdrop-blur-md p-2.5 rounded-xl border border-slate-700/80 shadow-2xl text-[10px] text-white pointer-events-none z-20 space-y-1">
            <div className="font-bold flex items-center justify-between gap-3">
              <span>Проба #{hoveredPoint.trialId}</span>
              <span className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase ${
                hoveredPoint.status === 'hit' ? 'bg-emerald-500/20 text-emerald-300' :
                hoveredPoint.status === 'overshoot' ? 'bg-rose-500/20 text-rose-300' :
                hoveredPoint.status === 'undershoot' ? 'bg-sky-500/20 text-sky-300' : 'bg-slate-800 text-slate-400'
              }`}>
                {hoveredPoint.status === 'hit' ? 'Попадание в цель' :
                 hoveredPoint.status === 'overshoot' ? 'Перевод' :
                 hoveredPoint.status === 'undershoot' ? 'Недовод' : 'Внутри квадрата'}
              </span>
            </div>
            {hoveredPoint.activeZoneName && (
              <div className="flex justify-between gap-3 text-slate-400">
                <span>Целевая зона:</span>
                <span className="font-mono text-emerald-400 font-bold">{hoveredPoint.activeZoneName}</span>
              </div>
            )}
            <div className="flex justify-between gap-3 text-slate-400">
              <span>Реальный вылет:</span>
              <span className="font-mono text-white font-bold">{hoveredPoint.overshootPx} px</span>
            </div>
            <div className="flex justify-between gap-3 text-slate-400">
              <span>Ошибка |ΔL|:</span>
              <span className="font-mono text-white font-bold">{hoveredPoint.absDeltaL} px</span>
            </div>
            {hoveredPoint.hasChordLine && (
              <div className="text-amber-400 font-bold flex items-center gap-1 pt-0.5 border-t border-slate-800">
                ⭐ Построена хордовая линия
              </div>
            )}
            {hoveredPoint.isExcluded && (
              <div className="text-rose-400 font-bold pt-0.5 border-t border-slate-800">
                🚫 Проба исключена из анализа
              </div>
            )}
          </div>
        )}

        {/* Hover Tooltip for All Solvers Point */}
        {viewMode === 'all_solvers' && hoveredAllPoint && (
          <div className="absolute top-2 right-2 bg-slate-900/95 backdrop-blur-md p-2.5 rounded-xl border border-sky-500/40 shadow-2xl text-[10px] text-white pointer-events-none z-20 space-y-1">
            <div className="font-bold flex items-center justify-between gap-3 text-sky-400">
              <span>Проба #{hoveredAllPoint.trialNum} (Все группы)</span>
              <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase bg-sky-500/20 text-sky-300">
                N = {hoveredAllPoint.count}
              </span>
            </div>
            <div className="flex justify-between gap-3 text-slate-400">
              <span>Ср. ошибка |ΔL|:</span>
              <span className="font-mono text-white font-bold">{hoveredAllPoint.avgError} px</span>
            </div>
            <div className="flex justify-between gap-3 text-slate-400">
              <span>Отклонение от идеала:</span>
              <span className="font-mono text-white font-bold">{Math.round(currentIdealOvershoot)} ± {hoveredAllPoint.avgError} px</span>
            </div>
          </div>
        )}

        {/* Hover Tooltip for Group Point */}
        {viewMode === 'groups' && hoveredGroupPoint && (
          <div className="absolute top-2 right-2 bg-slate-900/95 backdrop-blur-md p-2.5 rounded-xl border border-slate-700/80 shadow-2xl text-[10px] text-white pointer-events-none z-20 space-y-1">
            <div className="font-bold flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: hoveredGroupPoint.color }}></span>
              <span>{hoveredGroupPoint.group}</span>
            </div>
            <div className="flex justify-between gap-3 text-slate-400">
              <span>Проба:</span>
              <span className="font-mono text-white font-bold">#{hoveredGroupPoint.trialNum}</span>
            </div>
            <div className="flex justify-between gap-3 text-slate-400">
              <span>Ср. ошибка |ΔL|:</span>
              <span className="font-mono text-white font-bold">{hoveredGroupPoint.error} px</span>
            </div>
            <div className="flex justify-between gap-3 text-slate-400">
              <span>Решателей в пробе:</span>
              <span className="font-mono text-white font-bold">{hoveredGroupPoint.count}</span>
            </div>
          </div>
        )}
      </div>

      {/* Legend & Stats Footer */}
      {viewMode === 'single' && (
        <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400 px-1">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
              Точно в апекс (|ΔL| ≤ {Math.round(currentToleranceMargin)})
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-sky-400 inline-block"></span>
              Недовод
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-rose-500 inline-block"></span>
              Перевод
            </span>
          </div>
          <div className="flex items-center gap-1 text-[9px] text-amber-400 font-medium">
            <span className="w-2 h-2 rounded-full border border-amber-400 inline-block"></span>
            Хорда
          </div>
        </div>
      )}

      {viewMode === 'all_solvers' && (
        <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400 px-1">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 font-bold text-sky-400">
              <span className="w-2.5 h-1 bg-sky-400 rounded-sm inline-block"></span>
              Популяция ({allSolversSeries.solversCount} успешных)
            </span>
            <span className="flex items-center gap-1 text-slate-400">
              Начало: <strong className="text-white font-mono">{allSolversSeries.avgFirstThird} px</strong> → Конец: <strong className="text-emerald-400 font-mono">{allSolversSeries.avgLastThird} px</strong>
            </span>
            {allSolversSeries.avgFirstThird > allSolversSeries.avgLastThird && (
              <span className="text-emerald-400 font-bold">
                (Снижение на {allSolversSeries.avgFirstThird - allSolversSeries.avgLastThird} px)
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 font-mono text-[9px]">
            <span className="text-slate-400">
              b = <strong className={allSolversSeries.slope < 0 ? 'text-emerald-400' : 'text-slate-300'}>
                {allSolversSeries.slope > 0 ? `+${allSolversSeries.slope}` : allSolversSeries.slope} px/пр
              </strong>
            </span>
            <span className="text-slate-500">R² = {allSolversSeries.rSquared}</span>
          </div>
        </div>
      )}

      {viewMode === 'groups' && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] px-1">
          {groupSeries.map(g => (
            <div
              key={g.groupName}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-slate-950 border border-slate-800"
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: g.color.stroke }}></span>
              <span className="font-bold text-white">{g.groupName}</span>
              <span className="text-slate-500">N={g.solversCount}</span>
              <span className="font-mono text-slate-400 font-bold">
                b={g.slope > 0 ? `+${g.slope}` : g.slope}
              </span>
            </div>
          ))}
          {groupSeries.length === 0 && (
            <span className="text-slate-500 italic text-[10px]">Нет успешных решателей в загруженных данных</span>
          )}
        </div>
      )}

      {/* APEX TARGET CONFIGURATION & TEST MODES CONTROLLER */}
      <div className="mt-3 pt-2.5 border-t border-slate-800/80">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
              <Target size={13} className="text-emerald-400" />
              Параметры зоны поворота испытуемого:
            </span>
            {apexConfig?.isAutoAligned ? (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 font-bold border border-sky-500/30">
                🎯 Авто-апекс по решению ({Math.round(currentIdealOvershoot)} px)
              </span>
            ) : (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-medium">
                {currentIdealOvershoot === 116 && currentToleranceMargin === 65 ? 'Базовые (116 px, ±65 px)' : `Индивидуальные (${Math.round(currentIdealOvershoot)} px, ±${Math.round(currentToleranceMargin)} px)`}
              </span>
            )}
          </div>

          {/* Quick Action Buttons */}
          <div className="flex items-center gap-1.5">
            {/* Batch Auto-Align All Solvers */}
            {onBatchAutoAlignAllSolvers && (
              <button
                onClick={() => onBatchAutoAlignAllSolvers()}
                className="px-2 py-1 rounded text-[10px] font-bold flex items-center gap-1 bg-amber-600 hover:bg-amber-500 text-white shadow-sm transition-all cursor-pointer"
                title="Автоматически выровнять целевые зоны по финалу ДЛЯ ВСЕХ решивших участников выборки (в 1 клик)"
              >
                <Sparkles size={11} /> ⚡ Авто для всех решивших
              </button>
            )}

            {/* Auto-Align Button */}
            <button
              onClick={() => onAutoAlignApex && onAutoAlignApex()}
              disabled={!isCurrentSubjectSolved}
              className={`px-2 py-1 rounded text-[10px] font-bold flex items-center gap-1 transition-all ${
                isCurrentSubjectSolved
                  ? 'bg-sky-600 hover:bg-sky-500 text-white shadow-sm cursor-pointer'
                  : 'bg-slate-800/60 text-slate-600 cursor-not-allowed border border-slate-800'
              }`}
              title={
                isCurrentSubjectSolved
                  ? "Автоматически выровнять центральную точку целевой зоны по координатам финального поворота на успешной попытке решения"
                  : "Автокоррекция доступна только для успешных решателей. Сначала отметьте испытуемого как решившего задачу (трофей 🏆 в списке участников)"
              }
            >
              <Sparkles size={11} /> Автокоррекция по финалу
            </button>

            {/* Reset Button */}
            <button
              onClick={() => onResetApexConfig && onResetApexConfig()}
              className="px-2 py-1 rounded text-[10px] font-bold flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
              title="Сбросить параметры целевой зоны к базовым (вылет 116 px, допуск 65 px)"
            >
              <RotateCcw size={11} /> Сброс
            </button>
          </div>
        </div>

        {/* Sliders & Numeric Inputs (3 Columns) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 bg-slate-950 p-2.5 rounded-xl border border-slate-800/60 text-[10px]">
          {/* 1. Global Box Padding (Applies to ALL subjects) */}
          <div className="flex flex-col gap-1 bg-slate-900/60 p-2 rounded-lg border border-amber-500/30">
            <div className="flex items-center justify-between text-slate-300">
              <span className="flex items-center gap-1 font-bold text-amber-300">
                <span>📐 Пунктирный квадрат:</span>
              </span>
              <span className="font-mono text-amber-400 font-bold">+{Math.round(globalBoxPadding ?? 15)} px</span>
            </div>
            <input
              type="range"
              min="0"
              max="50"
              step="1"
              value={Math.round(globalBoxPadding ?? 15)}
              onChange={(e) => onUpdateGlobalBoxPadding && onUpdateGlobalBoxPadding(Number(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
              title="Глобальный отступ перцептивного пунктирного квадрата от крайних точек для ВСЕХ испытуемых (базовый 15 px)"
            />
            <div className="text-[8px] text-slate-500 flex justify-between font-medium">
              <span>0 px (по центрам)</span>
              <span className="text-amber-400 font-bold">Все испытуемые</span>
              <span>50 px</span>
            </div>
          </div>

          {/* 2. Ideal Overshoot Distance */}
          <div className="flex flex-col gap-1 p-2 bg-slate-900/40 rounded-lg border border-slate-800">
            <div className="flex items-center justify-between text-slate-400">
              <span>Центр зоны (вылет L):</span>
              <span className="font-mono text-emerald-400 font-bold">{Math.round(currentIdealOvershoot)} px</span>
            </div>
            <input
              type="range"
              min="40"
              max="280"
              step="2"
              value={Math.round(currentIdealOvershoot)}
              onChange={(e) => onUpdateApexConfig && onUpdateApexConfig({ idealOvershoot: Number(e.target.value), isAutoAligned: false })}
              className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
            />
            <div className="text-[8px] text-slate-500 flex justify-between">
              <span>40 px</span>
              <span className="text-slate-400">Базовый: 116 px</span>
              <span>280 px</span>
            </div>
          </div>

          {/* 3. Tolerance Margin Radius */}
          <div className="flex flex-col gap-1 p-2 bg-slate-900/40 rounded-lg border border-slate-800">
            <div className="flex items-center justify-between text-slate-400">
              <span>Область допуска (± радиус):</span>
              <span className="font-mono text-emerald-400 font-bold">±{Math.round(currentToleranceMargin)} px</span>
            </div>
            <input
              type="range"
              min="15"
              max="100"
              step="1"
              value={Math.round(currentToleranceMargin)}
              onChange={(e) => onUpdateApexConfig && onUpdateApexConfig({ toleranceMargin: Number(e.target.value) })}
              className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
            />
            <div className="text-[8px] text-slate-500 flex justify-between">
              <span>±15 px</span>
              <span className="text-slate-400">Базовый: ±65 px</span>
              <span>±100 px</span>
            </div>
          </div>
        </div>

        {/* Methodological Test Modes (Options 1 & 3) */}
        <div className="mt-2.5 flex items-center justify-between gap-3 px-1 text-[10px]">
          <div className="flex items-center gap-4">
            {/* Option 1: Solve Override */}
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white select-none">
              <input
                type="checkbox"
                checked={solveOverride}
                onChange={(e) => onUpdateApexConfig && onUpdateApexConfig({ solveOverride: e.target.checked })}
                className="rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-0 focus:ring-offset-0 cursor-pointer w-3.5 h-3.5"
              />
              <span title="Тестовый режим 1: при успешном решении задачи ошибка апекса приравнивается к 0 px, исключая ложный всплеск ошибки">
                ⭐ <strong className="text-slate-200">Solve Override</strong> (Решение = 0 px)
              </span>
            </label>

            {/* Option 3: Cap Max Error */}
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white select-none">
              <input
                type="checkbox"
                checked={capMaxError}
                onChange={(e) => onUpdateApexConfig && onUpdateApexConfig({ capMaxError: e.target.checked })}
                className="rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-0 focus:ring-offset-0 cursor-pointer w-3.5 h-3.5"
              />
              <span title="Тестовый режим 3: ошибка вылета наружу не может превышать ошибку полного невыхода из квадрата (116 px)">
                🛡️ <strong className="text-slate-200">Error Cap</strong> (Ограничение ошибки {Math.round(currentIdealOvershoot)} px)
              </span>
            </label>
          </div>

          <span className="text-[9px] text-slate-500 font-mono">
            Окно: [{Math.round(currentIdealOvershoot - currentToleranceMargin)} – {Math.round(currentIdealOvershoot + currentToleranceMargin)} px]
          </span>
        </div>
      </div>
    </div>
  );
};