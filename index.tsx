import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import './src/index.css';
import { 
  Upload, FileDown, RefreshCcw, FileText, Activity, Map as MapIcon, ChevronRight, BarChart3, 
  AlertCircle, Maximize2, Info, Target, Filter, X, LayoutGrid, Scissors, Zap, Flag, Trash2, 
  RotateCcw, Eye, ChevronLeft, Play, Users, User, Move, Settings2, Settings, Plus, Minus, 
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Timer, Ruler, Hash, Ban, CheckSquare, Square, 
  Flame, FileSpreadsheet, Trophy, Search, ZoomIn, ZoomOut, Maximize, MousePointer2, Download, 
  GraduationCap, Layers, Star, Briefcase, Clock, Globe,
  Sparkles, SlidersHorizontal 
} from 'lucide-react';

import {
  Point, LineSegment, ProcessedTrial, GridNode, Calibration, SubjectData, HeatPoint, HeatLine, AnalysisMode, ApexTargetConfig, TargetZoneId
} from './src/types';
import {
  CANVAS_SIZE, DOT_RADIUS, ANGLE_THRESHOLD_SPLIT, MIN_LINE_LENGTH, LOOKAHEAD_MIN_LENGTH,
  SMOOTHING_WINDOW, smoothPoints, getAngle, calculateDistance, distToSegment, classifyLine,
  performSegmentation, recalculateLineNodes, calibrateTrial, extractTrialApexOvershoot,
  isPointInAnyNode, computeRigidDotAlignment
} from './src/geometry';
import {
  parseNum, detectDelimiter, decodeBuffer, processCSV
} from './src/parser';
import {
  generateFilteredCSV, generateAllDataCSV, generateStatsCSV, generateKinematicsCSV, generateDuplexFullCSV, generateProbingLongCSV, exportExcelWorkbook
} from './src/stats';
import { KinematicsVelocityGraph } from './src/components/KinematicsVelocityGraph';
import { ProbingConvergenceGraph } from './src/components/ProbingConvergenceGraph';
import { TrialCanvasStage } from './src/components/TrialCanvasStage';
import { AutoPreprocessingModal } from './src/components/AutoPreprocessingModal';
import { 
  PreprocessingConfig, 
  DEFAULT_PREPROCESSING_CONFIG, 
  PreprocessingResult, 
  runDatasetPreprocessing 
} from './src/autoPreprocessor';
import { autoAlignSolverApex, batchAutoAlignAllSolvers, batchResetAllSolvers } from './src/probing';
import { serializeSession, deserializeSession } from './src/session';
import { downloadText } from './src/utils/download';


const GlobalHeatMap: React.FC<{ 
  title: string; 
  icon: React.ReactNode; 
  points: HeatPoint[]; 
  normalizedNodes: { id: number, x: number, y: number }[];
  badge?: string;
  color?: 'blue' | 'emerald' | 'amber';
}> = ({ title, icon, points, normalizedNodes, badge, color = 'blue' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoveredPoint, setHoveredPoint] = useState<HeatPoint | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  
  const size = 400;

  const colorConfig = {
    blue: { primary: 'rgba(37, 99, 235, 0.25)', marker: 'rgba(239, 68, 68, 0.6)', text: 'text-blue-500' },
    emerald: { primary: 'rgba(16, 185, 129, 0.25)', marker: 'rgba(239, 68, 68, 0.6)', text: 'text-emerald-500' },
    amber: { primary: 'rgba(245, 158, 11, 0.35)', marker: 'rgba(59, 130, 246, 0.6)', text: 'text-amber-500' }
  };

  const currentTheme = colorConfig[color];

  const drawHeatmap = (ctx: CanvasRenderingContext2D, width: number, height: number, z: number, off: {x: number, y: number}, isExport: boolean = false) => {
    const scaleFactor = isExport ? width / size : 1;
    const center = width / 2;
    
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, width, height);

    const dotR = 5 * scaleFactor;
    
    // Draw Presented Grid Nodes on Background
    ctx.fillStyle = '#e2e8f0';
    normalizedNodes.forEach(node => {
      ctx.beginPath();
      const posX = center + off.x * scaleFactor + (node.x * z * scaleFactor);
      const posY = center + off.y * scaleFactor + (node.y * z * scaleFactor);
      ctx.arc(posX, posY, dotR, 0, Math.PI * 2);
      ctx.fill();
      
      // Numbering
      ctx.fillStyle = '#94a3b8';
      ctx.font = `bold ${9 * scaleFactor}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(node.id.toString(), posX, posY - (12 * scaleFactor));
      ctx.fillStyle = '#e2e8f0';
    });

    ctx.globalCompositeOperation = 'multiply';
    points.forEach(p => {
      const radius = 25 * z * scaleFactor;
      const posX = center + off.x * scaleFactor + p.x * z * scaleFactor;
      const posY = center + off.y * scaleFactor + p.y * z * scaleFactor;
      
      const grad = ctx.createRadialGradient(posX, posY, 0, posX, posY, radius);
      grad.addColorStop(0, currentTheme.primary);
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(posX, posY, radius, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalCompositeOperation = 'source-over';

    points.forEach(p => {
      const posX = center + off.x * scaleFactor + p.x * z * scaleFactor;
      const posY = center + off.y * scaleFactor + p.y * z * scaleFactor;
      ctx.beginPath();
      ctx.arc(posX, posY, 2.5 * scaleFactor, 0, Math.PI * 2);
      ctx.fillStyle = currentTheme.marker;
      ctx.fill();
    });
  };

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    drawHeatmap(ctx, size, size, zoom, offset);
    
    if (hoveredPoint) {
      const center = size / 2;
      const posX = center + offset.x + hoveredPoint.x * zoom;
      const posY = center + offset.y + hoveredPoint.y * zoom;
      ctx.beginPath();
      ctx.arc(posX, posY, 8, 0, Math.PI * 2);
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [points, normalizedNodes, zoom, offset, hoveredPoint, color]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setMousePos({ x, y });

    if (isDragging) {
      setOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }

    const center = size / 2;
    const localX = (x - center - offset.x) / zoom;
    const localY = (y - center - offset.y) / zoom;
    
    let closest: HeatPoint | null = null;
    let minDist = 20 / zoom; 

    points.forEach(p => {
      const d = Math.sqrt(Math.pow(p.x - localX, 2) + Math.pow(p.y - localY, 2));
      if (d < minDist) {
        minDist = d;
        closest = p;
      }
    });
    setHoveredPoint(closest);
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.max(0.2, Math.min(10, z * delta)));
  };

  const resetView = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const exportHighRes = () => {
    const exportSize = 2400; // 600 DPI for 4x4 inch
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = exportSize;
    offscreenCanvas.height = exportSize;
    const ctx = offscreenCanvas.getContext('2d');
    if (!ctx) return;

    drawHeatmap(ctx, exportSize, exportSize, zoom, offset, true);

    const link = document.createElement('a');
    link.download = `${title.replace(/\s+/g, '_')}_${badge ? badge.replace(/\s+/g, '_') : ''}_600dpi.png`;
    link.href = offscreenCanvas.toDataURL('image/png', 1.0);
    link.click();
  };

  return (
    <div className="bg-white p-6 rounded-[32px] shadow-xl border border-slate-100 flex flex-col items-center relative group select-none transition-all hover:shadow-2xl hover:border-slate-200">
      <div className="flex justify-between items-center mb-4 w-full">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className={`p-2 bg-slate-50 rounded-xl shrink-0 ${currentTheme.text}`}>{icon}</div>
          <div className="flex flex-col min-w-0">
             <h3 className="text-sm font-bold text-slate-700 truncate">{title}</h3>
             {badge && <span className="text-[9px] font-black uppercase text-indigo-500 tracking-tighter truncate opacity-70">{badge}</span>}
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={exportHighRes} className="p-1.5 bg-slate-50 rounded-lg text-slate-400 hover:text-emerald-500 hover:bg-white border border-transparent hover:border-slate-100 transition-all" title="Скачать PNG (600 DPI)"><Download size={14} /></button>
          <button onClick={() => setZoom(z => Math.max(0.2, z * 0.8))} className="p-1.5 bg-slate-50 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-white border border-transparent hover:border-slate-100 transition-all"><ZoomOut size={14} /></button>
          <button onClick={resetView} className="p-1.5 bg-slate-50 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-white border border-transparent hover:border-slate-100 transition-all"><Maximize size={14} /></button>
          <button onClick={() => setZoom(z => Math.min(10, z * 1.2))} className="p-1.5 bg-slate-50 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-white border border-transparent hover:border-slate-100 transition-all"><ZoomIn size={14} /></button>
        </div>
      </div>
      
      <div className="relative w-full aspect-square overflow-hidden rounded-2xl border border-slate-100 shadow-inner cursor-grab active:cursor-grabbing">
        <canvas 
          ref={canvasRef} 
          width={size} 
          height={size} 
          className="w-full h-full bg-slate-50"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        />
        
        {hoveredPoint && (
          <div 
            className="absolute z-50 bg-slate-900/90 backdrop-blur-sm text-white px-3 py-2 rounded-xl text-[10px] font-bold shadow-2xl pointer-events-none animate-in fade-in zoom-in duration-100"
            style={{ 
                left: mousePos.x + 10, 
                top: mousePos.y + 10,
                transform: mousePos.x > size * 0.7 ? 'translateX(-100%)' : ''
            }}
          >
            <div className="text-blue-400 mb-1 flex items-center gap-1"><User size={10}/> {hoveredPoint.subjectId}</div>
            <div className="text-slate-300">Проба: #{hoveredPoint.trialId}</div>
            <div className="text-slate-500 font-mono mt-1 border-t border-slate-700 pt-1">
              REL X: {hoveredPoint.x.toFixed(1)} <br/>
              REL Y: {hoveredPoint.y.toFixed(1)}
            </div>
          </div>
        )}

        <div className="absolute top-4 right-4 bg-white/60 backdrop-blur-md px-2 py-1 rounded-lg text-[9px] font-black uppercase text-slate-400 border border-white/40">
           Zoom: {zoom.toFixed(1)}x
        </div>
      </div>
      
      <div className="mt-4 flex justify-between w-full px-1">
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1"><Activity size={10}/> Проб: {points.length}</div>
        <div className="text-[10px] font-bold text-blue-500/50 uppercase tracking-widest flex items-center gap-1"><Move size={10}/> Drag to Pan</div>
      </div>
    </div>
  );
};

const GlobalLineMap: React.FC<{ 
  title: string; 
  icon: React.ReactNode; 
  lines: HeatLine[]; 
  normalizedNodes: { id: number, x: number, y: number }[];
  badge?: string;
  color?: 'blue' | 'emerald' | 'amber';
}> = ({ title, icon, lines, normalizedNodes, badge, color = 'blue' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  const size = 400;

  const colorConfig = {
    blue: { line: 'rgba(14, 165, 233, 0.15)', text: 'text-sky-500' },
    emerald: { line: 'rgba(52, 211, 153, 0.15)', text: 'text-emerald-500' },
    amber: { line: 'rgba(251, 191, 36, 0.15)', text: 'text-amber-500' }
  };

  const currentTheme = colorConfig[color];

  const drawLineMap = (ctx: CanvasRenderingContext2D, width: number, height: number, z: number, off: {x: number, y: number}, isExport: boolean = false) => {
    const scaleFactor = isExport ? width / size : 1;
    const center = width / 2;
    
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, width, height);

    const dotR = 5 * scaleFactor;
    
    // Draw Presented Grid Nodes on Background
    ctx.fillStyle = '#e2e8f0';
    normalizedNodes.forEach(node => {
      ctx.beginPath();
      const posX = center + off.x * scaleFactor + (node.x * z * scaleFactor);
      const posY = center + off.y * scaleFactor + (node.y * z * scaleFactor);
      ctx.arc(posX, posY, dotR, 0, Math.PI * 2);
      ctx.fill();
      
      // Numbering
      ctx.fillStyle = '#94a3b8';
      ctx.font = `bold ${9 * scaleFactor}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(node.id.toString(), posX, posY - (12 * scaleFactor));
      ctx.fillStyle = '#e2e8f0';
    });

    // Draw lines
    ctx.lineWidth = 2 * scaleFactor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = currentTheme.line;

    lines.forEach(line => {
      if (line.points.length < 2) return;
      ctx.beginPath();
      line.points.forEach((p, i) => {
        const posX = center + off.x * scaleFactor + p.x * z * scaleFactor;
        const posY = center + off.y * scaleFactor + p.y * z * scaleFactor;
        if (i === 0) ctx.moveTo(posX, posY);
        else ctx.lineTo(posX, posY);
      });
      ctx.stroke();
    });
  };

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    drawLineMap(ctx, size, size, zoom, offset);
  }, [lines, normalizedNodes, zoom, offset, color]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.max(0.2, Math.min(10, z * delta)));
  };

  const resetView = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const exportHighRes = () => {
    const exportSize = 2400; // 600 DPI for 4x4 inch
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = exportSize;
    offscreenCanvas.height = exportSize;
    const ctx = offscreenCanvas.getContext('2d');
    if (!ctx) return;

    drawLineMap(ctx, exportSize, exportSize, zoom, offset, true);

    const link = document.createElement('a');
    link.download = `${title.replace(/\s+/g, '_')}_${badge ? badge.replace(/\s+/g, '_') : ''}_600dpi.png`;
    link.href = offscreenCanvas.toDataURL('image/png', 1.0);
    link.click();
  };

  return (
    <div className="bg-white p-6 rounded-[32px] shadow-xl border border-slate-100 flex flex-col items-center relative group select-none transition-all hover:shadow-2xl hover:border-slate-200">
      <div className="flex justify-between items-center mb-4 w-full">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className={`p-2 bg-slate-50 rounded-xl shrink-0 ${currentTheme.text}`}>{icon}</div>
          <div className="flex flex-col min-w-0">
             <h3 className="text-sm font-bold text-slate-700 truncate">{title}</h3>
             {badge && <span className="text-[9px] font-black uppercase text-indigo-500 tracking-tighter truncate opacity-70">{badge}</span>}
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={exportHighRes} className="p-1.5 bg-slate-50 rounded-lg text-slate-400 hover:text-emerald-500 hover:bg-white border border-transparent hover:border-slate-100 transition-all" title="Скачать PNG (600 DPI)"><Download size={14} /></button>
          <button onClick={() => setZoom(z => Math.max(0.2, z * 0.8))} className="p-1.5 bg-slate-50 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-white border border-transparent hover:border-slate-100 transition-all"><ZoomOut size={14} /></button>
          <button onClick={resetView} className="p-1.5 bg-slate-50 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-white border border-transparent hover:border-slate-100 transition-all"><Maximize size={14} /></button>
          <button onClick={() => setZoom(z => Math.min(10, z * 1.2))} className="p-1.5 bg-slate-50 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-white border border-transparent hover:border-slate-100 transition-all"><ZoomIn size={14} /></button>
        </div>
      </div>
      
      <div className="relative w-full aspect-square overflow-hidden rounded-2xl border border-slate-100 shadow-inner cursor-grab active:cursor-grabbing">
        <canvas 
          ref={canvasRef} 
          width={size} 
          height={size} 
          className="w-full h-full bg-slate-50"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        />
        
        <div className="absolute top-4 right-4 bg-white/60 backdrop-blur-md px-2 py-1 rounded-lg text-[9px] font-black uppercase text-slate-400 border border-white/40">
           Zoom: {zoom.toFixed(1)}x
        </div>
      </div>
      
      <div className="mt-4 flex justify-between w-full px-1">
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1"><Activity size={10}/> Линий: {lines.length}</div>
        <div className="text-[10px] font-bold text-blue-500/50 uppercase tracking-widest flex items-center gap-1"><Move size={10}/> Drag to Pan</div>
      </div>
    </div>
  );
};



const App: React.FC = () => {
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('duplex');
  const [processedData, setProcessedData] = useState<ProcessedTrial[]>([]);
  const [subjects, setSubjects] = useState<SubjectData[]>([]);
  const [activeSubjectId, setActiveSubjectId] = useState<string | null>(null);
  
  const [angleThreshold, setAngleThreshold] = useState(ANGLE_THRESHOLD_SPLIT);
  const [minLineLength, setMinLineLength] = useState(MIN_LINE_LENGTH);
  const [debouncedAngle, setDebouncedAngle] = useState(ANGLE_THRESHOLD_SPLIT);
  const [debouncedMinLen, setDebouncedMinLen] = useState(MIN_LINE_LENGTH);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedAngle(angleThreshold);
      setDebouncedMinLen(minLineLength);
    }, 400);
    return () => clearTimeout(timer);
  }, [angleThreshold, minLineLength]);

  // performSegmentation is imported from ./src/geometry

  // calibrateTrial is imported from ./src/geometry


  useEffect(() => {
    if (processedData.length === 0) return;
    setProcessedData(prev => {
      return prev.map(trial => {
        const sub = subjects.find(s => s.id === trial.subjectId);
        if (!sub) return trial;
        return calibrateTrial(trial, sub.calibration, sub.nodes, debouncedAngle, debouncedMinLen);
      });
    });
  }, [debouncedAngle, debouncedMinLen, calibrateTrial]);
  const [manualOverrides, setManualOverrides] = useState<Set<string>>(new Set());
  const [excludedLines, setExcludedLines] = useState<Set<string>>(new Set());
  const [excludedSubjects, setExcludedSubjects] = useState<Set<string>>(new Set());
  const [excludedTrials, setExcludedTrials] = useState<Set<string>>(new Set());
  const [globalBoxPadding, setGlobalBoxPadding] = useState<number>(15.0);
  const [subjectApexConfigs, setSubjectApexConfigs] = useState<Record<string, ApexTargetConfig>>({});
  const [manualZoneOverrides, setManualZoneOverrides] = useState<Record<string, TargetZoneId>>({});

  const getApexConfig = useCallback((subId: string): ApexTargetConfig => {
    return subjectApexConfigs[subId] || {
      idealOvershoot: 116.0,
      toleranceMargin: 65.0,
      isAutoAligned: false,
      isCenterAnchored: true,
      solveOverride: false,
      capMaxError: false
    };
  }, [subjectApexConfigs]);

  const updateApexConfig = useCallback((subId: string, updates: Partial<ApexTargetConfig>) => {
    setSubjectApexConfigs(prev => ({
      ...prev,
      [subId]: {
        ...(prev[subId] || {
          idealOvershoot: 116.0,
          toleranceMargin: 65.0,
          isAutoAligned: false,
          isCenterAnchored: true,
          solveOverride: false,
          capMaxError: false
        }),
        ...updates,
        ...(updates.idealOvershoot !== undefined ? { isCenterAnchored: updates.isCenterAnchored ?? true } : {})
      }
    }));
  }, []);

  const handleResetApexConfig = useCallback((subId: string) => {
    setSubjectApexConfigs(prev => ({
      ...prev,
      [subId]: {
        idealOvershoot: 116.0,
        toleranceMargin: 65.0,
        isAutoAligned: false,
        isCenterAnchored: true,
        alignedTrialId: undefined,
        solveOverride: false,
        capMaxError: false
      }
    }));
    showToast('Параметры целевой зоны сброшены к базовым (116 px от т.3 / ±65 px)', 'info');
  }, []);

  const handleAutoAlignApex = useCallback((subId: string) => {
    const sub = subjects.find(s => s.id === subId);
    if (!sub || !sub.isSolved) {
      showToast('Автокоррекция доступна только для успешных решателей. Сначала отметьте испытуемого как решившего задачу (трофей 🏆)', 'error');
      return;
    }
    const subTrials = processedData.filter(t => t.subjectId === subId && !excludedTrials.has(`${subId}-${t.trialId}`));
    if (subTrials.length === 0) return;

    const alignResult = autoAlignSolverApex(sub, subTrials, globalBoxPadding);
    if (alignResult) {
      updateApexConfig(subId, {
        idealOvershoot: alignResult.idealOvershoot,
        isAutoAligned: true,
        isCenterAnchored: true,
        alignedTrialId: alignResult.alignedTrialId
      });
      showToast(`Целевая зона выровнена по финальному решению: ${alignResult.idealOvershoot} px (от ц. т.3)`, 'success');
    }
  }, [subjects, processedData, excludedTrials, updateApexConfig, globalBoxPadding]);

  const handleBatchAutoAlignAllSolvers = useCallback(() => {
    const solvedSubs = subjects.filter(s => s.isSolved);
    if (solvedSubs.length === 0) {
      showToast('Нет участников со статусом "Решено" (трофей 🏆) для автокоррекции', 'info');
      return;
    }

    const newConfigs = batchAutoAlignAllSolvers(solvedSubs, processedData, {
      existingConfigs: subjectApexConfigs,
      excludedTrials,
      globalBoxPadding
    });

    const alignedCount = Object.keys(newConfigs).length;
    setSubjectApexConfigs(prev => ({ ...prev, ...newConfigs }));
    showToast(`⚡ Автокоррекция целевых зон выполнена для всех ${alignedCount} решивших!`, 'success');
    addLog(`Автокоррекция целевых зон выполнена для ${alignedCount} решивших участников.`);
  }, [subjects, processedData, excludedTrials, globalBoxPadding, subjectApexConfigs]);

  const handleBatchResetAllSolvers = useCallback(() => {
    const solvedSubs = subjects.filter(s => s.isSolved);
    const targetSubs = solvedSubs.length > 0 ? solvedSubs : subjects;
    if (targetSubs.length === 0) {
      setSubjectApexConfigs({});
      showToast('Параметры зон сброшены к стандартным (116 px, ±65 px)', 'info');
      return;
    }

    const newConfigs = batchResetAllSolvers(targetSubs, {
      existingConfigs: subjectApexConfigs,
      globalBoxPadding
    });

    setSubjectApexConfigs(newConfigs);
    showToast(`🔄 Параметры целевой зоны сброшены к стандарту (116 px, ±65 px) для всех ${targetSubs.length} участников!`, 'info');
    addLog(`Параметры целевых зон сброшены к стандарту (116 px, ±65 px) для ${targetSubs.length} участников.`);
  }, [subjects, subjectApexConfigs, globalBoxPadding]);
  const [activeTab, setActiveTab] = useState<'analysis' | 'geometry' | 'heatmaps' | 'reports'>('analysis');
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(prev => prev?.text === text ? null : prev);
    }, 3500);
  };

  const toggleTrialExclusion = (subjectId: string, trialId: string | number) => {
    const key = `${subjectId}-${trialId}`;
    setExcludedTrials(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        showToast(`Проба #${trialId} возвращена в анализ`);
      } else {
        next.add(key);
        showToast(`Проба #${trialId} исключена из анализа`, 'info');
      }
      return next;
    });
  };
  const [subjectGroups, setSubjectGroups] = useState<Record<string, string>>({});
  const [selectedTrialId, setSelectedTrialId] = useState<string | number | null>(null);
  const [hoveredTrialId, setHoveredTrialId] = useState<string | number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [autoFit, setAutoFit] = useState(true);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set());
  const [filterStartNode, setFilterStartNode] = useState<number | null>(null);
  const [filterFinishNode, setFilterFinishNode] = useState<number | null>(null);
  const [filterOverridesOnly, setFilterOverridesOnly] = useState(false);
  const [showBreaks, setShowBreaks] = useState(true);
  const [usePhasedMode, setUsePhasedMode] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showFinishHeatmap, setShowFinishHeatmap] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [animationTick, setAnimationTick] = useState(0);
  const requestRef = useRef<number>(null);

  const activeSubject = useMemo(() => subjects.find(s => s.id === activeSubjectId), [subjects, activeSubjectId]);

  const activeSubjectTrials = useMemo(() => {
    if (!activeSubjectId) return [];
    return processedData.filter(t => t.subjectId === activeSubjectId);
  }, [processedData, activeSubjectId]);
  
  const activeNodes = useMemo(() => {
    if (!activeSubject) return [];
    return activeSubject.nodes;
  }, [activeSubject]);

  const activeCellSize = useMemo(() => {
    if (!activeSubject) return { w: 116, h: 116 };
    return activeSubject.cellSize;
  }, [activeSubject]);

  const addLog = (msg: string) => setLog(prev => [...prev.slice(-10), msg]);

  // --- Auto-Preprocessing State & Handler ---
  const [preprocessingConfig, setPreprocessingConfig] = useState<PreprocessingConfig>(DEFAULT_PREPROCESSING_CONFIG);
  const [isPreprocessingModalOpen, setIsPreprocessingModalOpen] = useState(false);
  const [lastPreprocessingResult, setLastPreprocessingResult] = useState<PreprocessingResult | null>(null);

  const handleRunPreprocessing = useCallback((customConfig?: PreprocessingConfig) => {
    if (subjects.length === 0) {
      showToast('Нет загруженных данных для выполнения предобработки', 'error');
      return;
    }

    const cfg = customConfig || preprocessingConfig;
    const result = runDatasetPreprocessing(subjects, processedData, cfg, debouncedAngle, debouncedMinLen);

    // Apply excluded subjects
    setExcludedSubjects(result.excludedSubjects);

    // Apply excluded trials
    setExcludedTrials(result.excludedTrials);

    // Apply isSolved status and rigid trajectory-to-dot calibrations to subjects
    setSubjects(prev => prev.map(s => {
      const isSolved = result.solvedSubjectIds.has(s.id);
      const nextCal = result.alignedSubjectCalibrations[s.id];
      return {
        ...s,
        isSolved,
        calibration: nextCal ? nextCal : s.calibration
      };
    }));

    // Apply recalibrated trials if any subject calibration was adjusted in Step 0
    if (result.stats.trajectoriesAlignedCount > 0) {
      setProcessedData(result.recalibratedTrials);
    }

    // Apply apex configs for solvers
    setSubjectApexConfigs(prev => ({
      ...prev,
      ...result.subjectApexConfigs
    }));

    // If active subject was excluded, switch to first available non-excluded subject
    if (result.excludedSubjects.has(activeSubjectId)) {
      const firstActive = subjects.find(s => !result.excludedSubjects.has(s.id));
      if (firstActive) {
        setActiveSubjectId(firstActive.id);
      }
    }

    setLastPreprocessingResult(result);
    showToast(`⚡ Предобработка: выровнено ${result.stats.trajectoriesAlignedCount} траект., исключено ${result.stats.excludedSubjectsCount} исп., ${result.stats.excludedTrialsCount} проб, ${result.stats.solvedCount} решений`, 'success');
    addLog(`Выполнена автоматическая предобработка (выровнено по 9 т.: ${result.stats.trajectoriesAlignedCount}, отсеяно ${result.stats.excludedSubjectsCount} исп., ${result.stats.excludedTrialsCount} проб, ${result.stats.solvedCount} решений).`);
  }, [subjects, processedData, preprocessingConfig, activeSubjectId, debouncedAngle, debouncedMinLen]);

  const toggleExcludeSubject = (sId: string) => {
    const newExcluded = new Set(excludedSubjects);
    if (newExcluded.has(sId)) {
      newExcluded.delete(sId);
    } else {
      newExcluded.add(sId);
    }
    setExcludedSubjects(newExcluded);
  };

  useEffect(() => {
    if (isCalibrating) {
      const animate = (time: number) => {
        setAnimationTick(time);
        requestRef.current = requestAnimationFrame(animate);
      };
      requestRef.current = requestAnimationFrame(animate);
    } else {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isCalibrating]);



  const handleCalibrationChange = useCallback((changes: Partial<Calibration> | ((prev: Calibration) => Partial<Calibration>)) => {
    if (!activeSubjectId) return;
    setSubjects(prev => prev.map(s => {
      if (s.id === activeSubjectId) {
        const newChanges = typeof changes === 'function' ? changes(s.calibration) : changes;
        const newCalibration = { ...s.calibration, ...newChanges };
        return { ...s, calibration: newCalibration };
      }
      return s;
    }));
  }, [activeSubjectId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isCalibrating || !activeSubject) return;
      
      // If user is typing in an input, don't trigger global shortcuts
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const step = e.shiftKey ? 10 : 1;
      
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleCalibrationChange(prev => ({ offsetX: prev.offsetX - step }));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleCalibrationChange(prev => ({ offsetX: prev.offsetX + step }));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        handleCalibrationChange(prev => ({ offsetY: prev.offsetY - step }));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        handleCalibrationChange(prev => ({ offsetY: prev.offsetY + step }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCalibrating, activeSubject, handleCalibrationChange]);

  const toggleSubjectSolved = (subjectId: string) => {
    setSubjects(prev => prev.map(s => {
        if (s.id === subjectId) {
            return { ...s, isSolved: !s.isSolved };
        }
        return s;
    }));
  };

  useEffect(() => {
    if (activeSubject && activeSubject.nodes.length > 0) {
      setProcessedData(prev => {
        return prev.map(trial => {
          if (trial.subjectId !== activeSubjectId) return trial;
          return calibrateTrial(trial, activeSubject.calibration, activeSubject.nodes, debouncedAngle, debouncedMinLen);
        });
      });
    }
  }, [activeSubject?.calibration, activeSubjectId, calibrateTrial, debouncedAngle, debouncedMinLen]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setError(null);
    setLog([`Выбрано файлов: ${files.length}`]);

    const newTrials: ProcessedTrial[] = [];
    const newSubjects: SubjectData[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const subjectName = file.name.replace(/\.csv$/i, '');
      
      try {
        const buffer = await file.arrayBuffer();
        const content = decodeBuffer(buffer).replace(/^\uFEFF/, '');
        const results = processCSV(content, subjectName);
        
        if (results.trials.length > 0) {
           newTrials.push(...results.trials);
        }
        
        newSubjects.push({
          id: subjectName,
          nodes: results.nodes,
          cellSize: results.cellSize,
          calibration: { offsetX: 0, offsetY: 0, scale: 1.0, hitPadding: 15 },
          isSolved: false,
          isOnline: results.metadata.isOnline ?? false,
          lastName: results.metadata.lastName,
          firstName: results.metadata.firstName,
          age: results.metadata.age,
          gender: results.metadata.gender,
          experience: 'Не загружен',
          solvedBefore: results.metadata.solvedBefore,
          insight: results.metadata.insight,
          totalTaskTime: results.metadata.totalTaskTime,
          surveyScales: results.metadata.surveyScales
        });

        if (results.metadata.group) {
          setSubjectGroups(prev => ({ ...prev, [subjectName]: results.metadata.group }));
        }
      } catch (err) {
        console.error(err);
        addLog(`Ошибка в файле ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (newSubjects.length > 0) {
      setProcessedData(prev => [...prev, ...newTrials]);
      setSubjects(prev => {
        const existingIds = new Set(prev.map(s => s.id));
        const filteredNew = newSubjects.filter(ns => !existingIds.has(ns.id));
        return [...prev, ...filteredNew];
      });
      if (!activeSubjectId && newSubjects.length > 0) setActiveSubjectId(newSubjects[0].id);
      
      addLog(`Загружено участников: ${newSubjects.length}. Валидных проб: ${newTrials.length}.`);
    } else {
      addLog("Ни один файл не был успешно обработан.");
    }
  };

  const handleCalibrationFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    const buffer = await file.arrayBuffer();
    const content = decodeBuffer(buffer).replace(/^\uFEFF/, '');
    
    const rawLines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (rawLines.length < 2) {
      addLog("Файл калибровки пуст или некорректен.");
      return;
    }

    const delimiter = detectDelimiter(rawLines[0]);
    const headers = rawLines[0].split(delimiter).map(h => h.trim().toLowerCase());
    
    const sIdIdx = headers.indexOf("subjectid");
    const oxIdx = headers.indexOf("calibrationoffsetx");
    const oyIdx = headers.indexOf("calibrationoffsety");
    const scaleIdx = headers.indexOf("calibrationscale");
    const aoiIdx = headers.indexOf("aoi");
    const solvedIdx = headers.indexOf("issolved");

    if (sIdIdx === -1 || oxIdx === -1 || oyIdx === -1 || scaleIdx === -1) {
      addLog("Неверный формат заголовков в файле калибровки.");
      return;
    }

    let updatedCount = 0;
    
    setSubjects(prev => {
        const next = [...prev];
        for (let i = 1; i < rawLines.length; i++) {
            const cols = rawLines[i].split(delimiter);
            const subjectId = cols[sIdIdx]?.trim();
            const ox = parseNum(cols[oxIdx]);
            const oy = parseNum(cols[oyIdx]);
            const scale = parseNum(cols[scaleIdx]);
            const aoi = aoiIdx !== -1 ? parseNum(cols[aoiIdx]) : NaN;

            if (subjectId && !isNaN(ox) && !isNaN(oy) && !isNaN(scale)) {
                const idx = next.findIndex(s => s.id === subjectId);
                if (idx !== -1) {
                    const updatedSubject = { ...next[idx] };
                    updatedSubject.calibration = { 
                      offsetX: ox, 
                      offsetY: oy, 
                      scale: scale,
                      hitPadding: !isNaN(aoi) ? aoi : (next[idx].calibration.hitPadding ?? 15)
                    };
                    
                    if (solvedIdx !== -1 && cols[solvedIdx]) {
                        const rawVal = cols[solvedIdx].trim().toLowerCase();
                        updatedSubject.isSolved = (rawVal === 'true' || rawVal === '1' || rawVal === 'yes');
                    }
                    
                    next[idx] = updatedSubject;
                    updatedCount++;
                }
            }
        }
        return next;
    });

    addLog(`Обновлена калибровка и статус решения для ${updatedCount} испытуемых.`);
    e.target.value = "";
  };

  const handleExperienceFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    const buffer = await file.arrayBuffer();
    const content = decodeBuffer(buffer).replace(/^\uFEFF/, '');
    
    const rawLines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (rawLines.length < 2) {
      addLog("Файл опыта пуст.");
      return;
    }

    const delimiter = detectDelimiter(rawLines[0]);

    // Helper function to remove surrounding quotes and unescape doubled quotes
    const clean = (val: string) => {
      if (!val) return "";
      let s = val.trim();
      // Handle values like "filename.csv" or "no"
      if (s.startsWith('"') && s.endsWith('"')) {
        s = s.slice(1, -1);
      }
      return s.replace(/""/g, '"').trim();
    };

    // Correctly parse headers by cleaning them from potential quotes
    const headers = rawLines[0].split(delimiter).map(h => clean(h).toLowerCase());
    
    const fileIdx = headers.indexOf("file");
    const expIdx = headers.indexOf("experience");

    if (fileIdx === -1 || expIdx === -1) {
      addLog("CSV опыта должен содержать столбцы 'File' и 'Experience'.");
      return;
    }

    let updatedCount = 0;
    
    setSubjects(prev => {
        const next = [...prev];
        for (let i = 1; i < rawLines.length; i++) {
            const cols = rawLines[i].split(delimiter);
            const fileName = clean(cols[fileIdx] || '');
            const experience = clean(cols[expIdx] || '');

            if (fileName && experience) {
                // Match by ID which is the filename without extension
                const targetId = fileName.replace(/\.csv$/i, '');
                // Also check with extension just in case Subject ID was stored differently
                const idx = next.findIndex(s => s.id === targetId || s.id === fileName);
                if (idx !== -1) {
                    next[idx] = { ...next[idx], experience };
                    updatedCount++;
                }
            }
        }
        return next;
    });

    addLog(`Обновлен опыт для ${updatedCount} испытуемых.`);
    e.target.value = "";
  };

  useEffect(() => {
    setAutoFit(true);
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  }, [activeSubjectId]);

  // processCSV is imported from ./src/parser

  const filteredTrials = useMemo(() => {
    return processedData.filter(t => {
      if (activeSubjectId && t.subjectId !== activeSubjectId) return false;

      const overrideKey = `${t.subjectId}-${t.trialId}`;
      const isOverridden = manualOverrides.has(overrideKey);
      
      if (filterOverridesOnly && !isOverridden) return false;

      const firstLineNode = t.lines[0]?.nodesVisited[0];
      const lastLine = t.lines[t.lines.length - 1];
      const lastNode = lastLine?.nodesVisited[lastLine.nodesVisited.length - 1];

      if (filterStartNode !== null && firstLineNode !== filterStartNode) return false;
      if (filterFinishNode !== null && lastNode !== filterFinishNode) return false;
      
      if (filterTypes.size > 0) {
        if (isOverridden) {
          if (!filterTypes.has('прочая')) return false;
        } else {
          const hasAnyMatchingLine = t.lines.some(l => filterTypes.has(l.type));
          if (!hasAnyMatchingLine) return false;
        }
      }
      return true;
    });
  }, [processedData, filterTypes, filterStartNode, filterFinishNode, filterOverridesOnly, manualOverrides, activeSubjectId]);

  const selectedTrial = useMemo(() => {
    if (selectedTrialId === null) return null;
    return processedData.find(t => t.trialId === selectedTrialId && t.subjectId === activeSubjectId) || null;
  }, [selectedTrialId, processedData, activeSubjectId]);

  const handleAutoCenter = useCallback(() => {
    if (!activeSubject) return;
    const activeSubTrials = processedData.filter(t => t.subjectId === activeSubject.id && !excludedTrials.has(`${activeSubject.id}-${t.trialId}`));
    const subTrials = activeSubTrials.length > 0 ? activeSubTrials : processedData.filter(t => t.subjectId === activeSubject.id);
    if (subTrials.length === 0) return;

    const align = computeRigidDotAlignment(subTrials, activeSubject.nodes, activeSubject.calibration);
    handleCalibrationChange({ offsetX: align.offsetX, offsetY: align.offsetY });
    showToast(
      `🎯 Подгонка к 9 т.: X=${align.offsetX > 0 ? '+' : ''}${align.offsetX}px, Y=${align.offsetY > 0 ? '+' : ''}${align.offsetY}px (RMSE ${align.rmseBefore} → ${align.rmseAfter} px)`,
      'success'
    );
    addLog(`🎯 Авто-подгонка к 9 точкам (${activeSubject.id}): X=${align.offsetX > 0 ? '+' : ''}${align.offsetX}px, Y=${align.offsetY > 0 ? '+' : ''}${align.offsetY}px, RMSE ${align.rmseBefore}→${align.rmseAfter} px`);
  }, [activeSubject, processedData, excludedTrials, handleCalibrationChange]);

  const handleBatchAlignTrajectories = useCallback(() => {
    if (subjects.length === 0) {
      showToast('Нет загруженных участников для выравнивания', 'error');
      return;
    }

    const nextCalBySub = new Map<string, Calibration>();
    let alignedSubsCount = 0;

    subjects.forEach(sub => {
      if (excludedSubjects.has(sub.id)) return;
      const activeSubTrials = processedData.filter(t => t.subjectId === sub.id && !excludedTrials.has(`${sub.id}-${t.trialId}`));
      const subTrials = activeSubTrials.length > 0 ? activeSubTrials : processedData.filter(t => t.subjectId === sub.id);
      if (subTrials.length === 0) return;

      const align = computeRigidDotAlignment(subTrials, sub.nodes, sub.calibration);
      const dx = Math.abs(align.offsetX - (sub.calibration?.offsetX ?? 0));
      const dy = Math.abs(align.offsetY - (sub.calibration?.offsetY ?? 0));
      if (dx >= 1.0 || dy >= 1.0) {
        alignedSubsCount++;
        nextCalBySub.set(sub.id, {
          ...sub.calibration,
          offsetX: align.offsetX,
          offsetY: align.offsetY
        });
      }
    });

    if (alignedSubsCount === 0) {
      showToast('Все траектории уже выровнены относительно центров 9 точек', 'info');
      return;
    }

    setSubjects(prev => prev.map(s => {
      const nextCal = nextCalBySub.get(s.id);
      return nextCal ? { ...s, calibration: nextCal } : s;
    }));

    setProcessedData(prev => prev.map(t => {
      const nextCal = nextCalBySub.get(t.subjectId);
      if (!nextCal) return t;
      const sub = subjects.find(s => s.id === t.subjectId);
      if (!sub) return t;
      return calibrateTrial(t, nextCal, sub.nodes, debouncedAngle, debouncedMinLen);
    }));

    showToast(`🎯 Выравнивание к 9 точкам выполнено для ${alignedSubsCount} участников`, 'success');
    addLog(`🎯 Пакетное выравнивание к 9 точкам: обновлено ${alignedSubsCount} участников.`);
  }, [subjects, processedData, excludedSubjects, excludedTrials, debouncedAngle, debouncedMinLen]);

  const trialsToDraw = useMemo(() => {
    return selectedTrialId !== null 
      ? (selectedTrial ? [selectedTrial] : [])
      : filteredTrials;
  }, [selectedTrialId, selectedTrial, filteredTrials]);

  const handleToggleManualZoneOverride = useCallback((trialKey: string, zoneId: TargetZoneId, zoneName: string) => {
    setManualZoneOverrides(prev => {
      const isAlreadyOverridden = prev[trialKey] === zoneId;
      const next = { ...prev };
      if (isAlreadyOverridden) {
        delete next[trialKey];
        showToast(`Сброшен ручной выбор: включено автоопределение для целевой зоны`, 'info');
        addLog(`Сброшен ручной выбор зоны для ${trialKey}.`);
      } else {
        next[trialKey] = zoneId;
        showToast(`🎯 Зона зафиксирована вручную: ${zoneName}`, 'success');
        addLog(`Целевая зона зафиксирована вручную: ${zoneName} (${trialKey}).`);
      }
      return next;
    });
  }, []);

  const getNormalizedPoint = useCallback((point: Point, trial: ProcessedTrial, sub: SubjectData) => {
    const centerNode = sub.nodes.find(n => n.id === 5);
    const centerX = centerNode ? centerNode.x : CANVAS_SIZE / 2;
    const centerY = centerNode ? centerNode.y : CANVAS_SIZE / 2;
    
    const rx = point.x - centerX;
    const ry = point.y - centerY;
    
    return { x: rx, y: ry, subjectId: sub.id, trialId: trial.trialId };
  }, []);

  const averageNormalizedNodes = useMemo(() => {
    if (subjects.length === 0) return [];
    
    const nodeSums: Record<number, { x: number, y: number, count: number }> = {};
    
    subjects.forEach(sub => {
      const centerNode = sub.nodes.find(n => n.id === 5);
      const centerX = centerNode ? centerNode.x : CANVAS_SIZE / 2;
      const centerY = centerNode ? centerNode.y : CANVAS_SIZE / 2;
      
      sub.nodes.forEach(node => {
        if (!nodeSums[node.id]) nodeSums[node.id] = { x: 0, y: 0, count: 0 };
        nodeSums[node.id].x += (node.x - centerX);
        nodeSums[node.id].y += (node.y - centerY);
        nodeSums[node.id].count += 1;
      });
    });

    return Object.entries(nodeSums).map(([id, sum]) => ({
      id: parseInt(id),
      x: sum.x / sum.count,
      y: sum.y / sum.count
    })).sort((a, b) => a.id - b.id);
  }, [subjects]);

  const globalHeatmapAll = useMemo(() => {
    const pts: HeatPoint[] = [];
    processedData.forEach(trial => {
      const sub = subjects.find(s => s.id === trial.subjectId);
      if (!sub) return;
      const pt = getNormalizedPoint(trial.startPoint, trial, sub);
      if (pt) pts.push(pt);
    });
    return pts;
  }, [processedData, subjects, getNormalizedPoint]);

  const globalHeatmapFinishAll = useMemo(() => {
    const pts: HeatPoint[] = [];
    processedData.forEach(trial => {
      const sub = subjects.find(s => s.id === trial.subjectId);
      if (!sub) return;
      const lastPoint = trial.points[trial.points.length - 1];
      const pt = getNormalizedPoint(lastPoint, trial, sub);
      if (pt) pts.push(pt);
    });
    return pts;
  }, [processedData, subjects, getNormalizedPoint]);

  const globalHeatmapCorrectLast = useMemo(() => {
    const pts: HeatPoint[] = [];
    subjects.filter(s => s.isSolved).forEach(sub => {
      const subTrials = processedData.filter(t => t.subjectId === sub.id);
      if (subTrials.length === 0) return;
      const lastTrial = subTrials[subTrials.length - 1];
      const pt = getNormalizedPoint(lastTrial.startPoint, lastTrial, sub);
      if (pt) pts.push(pt);
    });
    return pts;
  }, [processedData, subjects, getNormalizedPoint]);

  const globalHeatmapFinishCorrectLast = useMemo(() => {
    const pts: HeatPoint[] = [];
    subjects.filter(s => s.isSolved).forEach(sub => {
      const subTrials = processedData.filter(t => t.subjectId === sub.id);
      if (subTrials.length === 0) return;
      const lastTrial = subTrials[subTrials.length - 1];
      const lastPoint = lastTrial.points[lastTrial.points.length - 1];
      const pt = getNormalizedPoint(lastPoint, lastTrial, sub);
      if (pt) pts.push(pt);
    });
    return pts;
  }, [processedData, subjects, getNormalizedPoint]);

  const experienceGroups = useMemo(() => {
    const groups: Record<string, { start: HeatPoint[], finish: HeatPoint[], solvedFinalStart: HeatPoint[], solvedFinalFinish: HeatPoint[] }> = {};
    const uniqueExps = Array.from(new Set(subjects.map(s => s.experience))) as string[];
    
    uniqueExps.forEach(exp => {
      groups[exp] = { start: [], finish: [], solvedFinalStart: [], solvedFinalFinish: [] };
      const groupSubjectIds = new Set(subjects.filter(s => s.experience === exp).map(s => s.id));
      const solvedGroupSubjectIds = new Set(subjects.filter(s => s.experience === exp && s.isSolved).map(s => s.id));
      
      const groupTrials = processedData.filter(t => groupSubjectIds.has(t.subjectId));
      
      groupTrials.forEach(trial => {
        const sub = subjects.find(s => s.id === trial.subjectId);
        if (!sub) return;
        
        const ptStart = getNormalizedPoint(trial.startPoint, trial, sub);
        if (ptStart) groups[exp].start.push(ptStart);
        
        const lastPoint = trial.points[trial.points.length - 1];
        const ptFinish = getNormalizedPoint(lastPoint, trial, sub);
        if (ptFinish) groups[exp].finish.push(ptFinish);
      });

      solvedGroupSubjectIds.forEach(sId => {
        const sub = subjects.find(s => s.id === sId);
        const subTrials = processedData.filter(t => t.subjectId === sId);
        if (!sub || subTrials.length === 0) return;
        
        const finalTrial = subTrials[subTrials.length - 1];
        
        const ptStartFinal = getNormalizedPoint(finalTrial.startPoint, finalTrial, sub);
        if (ptStartFinal) groups[exp].solvedFinalStart.push(ptStartFinal);

        const finalPoint = finalTrial.points[finalTrial.points.length - 1];
        const ptFinishFinal = getNormalizedPoint(finalPoint, finalTrial, sub);
        if (ptFinishFinal) groups[exp].solvedFinalFinish.push(ptFinishFinal);
      });
    });
    return groups;
  }, [subjects, processedData, getNormalizedPoint]);

  const globalLineMapAll = useMemo(() => {
    const lines: HeatLine[] = [];
    processedData.forEach(trial => {
      const sub = subjects.find(s => s.id === trial.subjectId);
      if (!sub) return;
      const normalizedPoints = trial.points.map(p => getNormalizedPoint(p, trial, sub)).filter(p => p !== null) as {x: number, y: number}[];
      if (normalizedPoints.length > 1) {
        lines.push({ points: normalizedPoints, subjectId: sub.id, trialId: trial.trialId });
      }
    });
    return lines;
  }, [processedData, subjects, getNormalizedPoint]);

  const globalLineMapCorrectLast = useMemo(() => {
    const lines: HeatLine[] = [];
    subjects.filter(s => s.isSolved).forEach(sub => {
      const subTrials = processedData.filter(t => t.subjectId === sub.id);
      if (subTrials.length === 0) return;
      const lastTrial = subTrials[subTrials.length - 1];
      const normalizedPoints = lastTrial.points.map(p => getNormalizedPoint(p, lastTrial, sub)).filter(p => p !== null) as {x: number, y: number}[];
      if (normalizedPoints.length > 1) {
        lines.push({ points: normalizedPoints, subjectId: sub.id, trialId: lastTrial.trialId });
      }
    });
    return lines;
  }, [processedData, subjects, getNormalizedPoint]);

  const experienceLineGroups = useMemo(() => {
    const groups: Record<string, { all: HeatLine[], solvedFinal: HeatLine[] }> = {};
    const uniqueExps = Array.from(new Set(subjects.map(s => s.experience))) as string[];
    
    uniqueExps.forEach(exp => {
      groups[exp] = { all: [], solvedFinal: [] };
      const groupSubjectIds = new Set(subjects.filter(s => s.experience === exp).map(s => s.id));
      const solvedGroupSubjectIds = new Set(subjects.filter(s => s.experience === exp && s.isSolved).map(s => s.id));
      
      const groupTrials = processedData.filter(t => groupSubjectIds.has(t.subjectId));
      
      groupTrials.forEach(trial => {
        const sub = subjects.find(s => s.id === trial.subjectId);
        if (!sub) return;
        const normalizedPoints = trial.points.map(p => getNormalizedPoint(p, trial, sub)).filter(p => p !== null) as {x: number, y: number}[];
        if (normalizedPoints.length > 1) {
          groups[exp].all.push({ points: normalizedPoints, subjectId: sub.id, trialId: trial.trialId });
        }
      });

      solvedGroupSubjectIds.forEach(sId => {
        const sub = subjects.find(s => s.id === sId);
        const subTrials = processedData.filter(t => t.subjectId === sId);
        if (!sub || subTrials.length === 0) return;
        
        const finalTrial = subTrials[subTrials.length - 1];
        const normalizedPoints = finalTrial.points.map(p => getNormalizedPoint(p, finalTrial, sub)).filter(p => p !== null) as {x: number, y: number}[];
        if (normalizedPoints.length > 1) {
          groups[exp].solvedFinal.push({ points: normalizedPoints, subjectId: sub.id, trialId: finalTrial.trialId });
        }
      });
    });
    return groups;
  }, [subjects, processedData, getNormalizedPoint]);









  const toggleLineExclusion = (subjectId: string, trialId: string | number, lineIdx: number) => {
    const key = `${subjectId}-${trialId}-${lineIdx}`;
    setExcludedLines(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const stats = useMemo(() => {
    const currentData = processedData.filter(t => !activeSubjectId || t.subjectId === activeSubjectId);
    
    const calculateForSet = (data: ProcessedTrial[]) => {
      const lineTypeCounts: Record<string, number> = {};
      const startNodeCounts: Record<number, number> = {};
      const finishNodeCounts: Record<number, number> = {};
      let totalOverrides = 0;
      let total_solution_time_ms = 0;
      let linesBothEndsInNodes = 0;
      let linesAnyEndOutside = 0;
      let totalLinesLength = 0;
      let totalLinesCount = 0;
      let totalOutsideLinesLength = 0;
      let totalOutsideLinesCount = 0;

      let totalKinSpeed = 0;
      let maxKinPeak = 0;
      let totalPausesCount = 0;
      let totalPauseTime = 0;
      let trialsWithOutsideBox = 0;
      let totalOutsideBoxTime = 0;
      let validKinTrials = 0;

      data.forEach(t => {
        if (t.kinematics) {
          validKinTrials++;
          totalKinSpeed += t.kinematics.metrics.meanVelocityPxS;
          if (t.kinematics.metrics.peakVelocityPxS > maxKinPeak) {
            maxKinPeak = t.kinematics.metrics.peakVelocityPxS;
          }
          totalPausesCount += t.kinematics.metrics.pauseCount;
          totalPauseTime += t.kinematics.metrics.pauseTimeMs;
          if (t.kinematics.metrics.outsideBoxTimeMs > 0) {
            trialsWithOutsideBox++;
          }
          totalOutsideBoxTime += t.kinematics.metrics.outsideBoxTimeMs;
        }
        const sub = subjects.find(s => s.id === t.subjectId);
        const subNodes = sub ? sub.nodes.map(n => ({
          ...n,
          x: n.x + sub.calibration.offsetX,
          y: n.y + sub.calibration.offsetY
        })) : [];
        const hitPadding = sub?.calibration.hitPadding ?? 15;

        const isAtNode = (p: Point) => isPointInAnyNode(p, subNodes, hitPadding);

        const overrideKey = `${t.subjectId}-${t.trialId}`;
        const isOverridden = manualOverrides.has(overrideKey);
        if (isOverridden) totalOverrides++;

        total_solution_time_ms += t.trial_time_ms;

        t.lines.forEach((l, idx) => {
          if (excludedLines.has(`${t.subjectId}-${t.trialId}-${idx}`)) return;
          const type = isOverridden ? 'прочая' : l.type;
          lineTypeCounts[type] = (lineTypeCounts[type] || 0) + 1;

          let lineLen = 0;
          for (let m = 0; m < l.points.length - 1; m++) {
            lineLen += calculateDistance(l.points[m], l.points[m + 1]);
          }
          totalLinesLength += lineLen;
          totalLinesCount++;

          const startAtNode = isAtNode(l.points[0]);
          const endAtNode = isAtNode(l.points[l.points.length - 1]);
          if (startAtNode && endAtNode) linesBothEndsInNodes++;
          if (!startAtNode || !endAtNode) {
            linesAnyEndOutside++;
            totalOutsideLinesLength += lineLen;
            totalOutsideLinesCount++;
          }
        });
        const firstNode = t.lines[0]?.nodesVisited[0];
        if (typeof firstNode === 'number') {
          startNodeCounts[firstNode] = (startNodeCounts[firstNode] || 0) + 1;
        }
        const lastLine = t.lines[t.lines.length - 1];
        const lastNode = lastLine?.nodesVisited[lastLine.nodesVisited.length - 1];
        if (typeof lastNode === 'number') {
          finishNodeCounts[lastNode] = (finishNodeCounts[lastNode] || 0) + 1;
        }
      });

      const totalLines = Object.values(lineTypeCounts).reduce((a, b) => (a as number) + (b as number), 0);
      const mean_trial_time_ms = data.length > 0 ? total_solution_time_ms / data.length : 0;
      const avgAllLinesLength = totalLinesCount > 0 ? totalLinesLength / totalLinesCount : 0;
      const avgOutsideLinesLength = totalOutsideLinesCount > 0 ? totalOutsideLinesLength / totalOutsideLinesCount : 0;

      return {
        lineTypeCounts, startNodeCounts, finishNodeCounts, totalLines,
        totalTrials: data.length, totalOverrides,
        total_solution_time_ms, mean_trial_time_ms,
        linesBothEndsInNodes, linesAnyEndOutside,
        avgAllLinesLength, avgOutsideLinesLength,
        avgKinSpeed: validKinTrials > 0 ? totalKinSpeed / validKinTrials : 0,
        maxKinPeak,
        totalPausesCount,
        avgPauseTimePerTrial: validKinTrials > 0 ? (totalPauseTime / validKinTrials) / 1000 : 0,
        outsideBoxTrialRatio: validKinTrials > 0 ? (trialsWithOutsideBox / validKinTrials) * 100 : 0,
        totalOutsideBoxTimeMs: totalOutsideBoxTime,
        validKinTrials
      };
    };

    const overall = calculateForSet(currentData);
    
    // First Trial First Line Type
    let firstTrialFirstLineType = 'none';
    const firstTrial = currentData[0];
    if (firstTrial) {
      const isOverridden = manualOverrides.has(`${firstTrial.subjectId}-${firstTrial.trialId}`);
      firstTrialFirstLineType = firstTrial.lines[0] ? (isOverridden ? 'прочая' : firstTrial.lines[0].type) : 'none';
    }

    if (!usePhasedMode || currentData.length < 3) {
      return { ...overall, phases: null, firstTrialFirstLineType };
    }

    const phaseSize = Math.floor(currentData.length / 3);
    const p1 = currentData.slice(0, phaseSize);
    const p2 = currentData.slice(phaseSize, phaseSize * 2);
    const p3 = currentData.slice(phaseSize * 2);

    return {
      ...overall,
      firstTrialFirstLineType,
      phases: {
        beginning: calculateForSet(p1),
        middle: calculateForSet(p2),
        end: calculateForSet(p3)
      }
    };
  }, [processedData, manualOverrides, excludedLines, activeSubjectId, usePhasedMode]);

  const toggleOverride = (trial: ProcessedTrial) => {
    const key = `${trial.subjectId}-${trial.trialId}`;
    setManualOverrides(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleFilterType = (type: string) => {
    setFilterTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const navigateTrial = (direction: 'next' | 'prev') => {
    const currentSubjectTrials = processedData.filter(t => t.subjectId === activeSubjectId);
    if (currentSubjectTrials.length === 0) return;
    
    const ids = currentSubjectTrials.map(t => t.trialId);
    const currIdx = selectedTrialId !== null ? ids.indexOf(selectedTrialId) : -1;
    if (currIdx === -1) return;
    
    let nextIdx: number;
    if (direction === 'next') {
        nextIdx = currIdx + 1;
    } else {
        nextIdx = currIdx - 1;
    }
    
    if (nextIdx < 0) nextIdx = ids.length - 1;
    if (nextIdx >= ids.length) nextIdx = 0;
    
    setSelectedTrialId(ids[nextIdx]);
  };

  const exportKinematicsCSV = () => {
    if (processedData.length === 0) return;
    const csvContent = generateKinematicsCSV(processedData, subjects, subjectGroups);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `MOGNU_kinematics_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    addLog("Экспортированы данные кинематики (MOGNU).");
  };

  const exportDuplexCSV = () => {
    if (processedData.length === 0) return;
    const csvContent = generateDuplexFullCSV(processedData, subjects, manualOverrides, subjectGroups);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `MOGNU_duplex_full_report_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    addLog("Экспортирован полный дуплексный отчет (Геометрия + Кинематика).");
  };

  const handleExportExcel = async () => {
    if (subjects.length === 0) {
      showToast('Нет данных испытуемых для экспорта в Excel', 'error');
      return;
    }
    try {
      exportExcelWorkbook(
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
      showToast('Сводная статистика успешно экспортирована в Excel (.xlsx: 3 листа: Сводная, По этапам, Long LMM)', 'success');
      addLog("Экспортирована сводная статистика в Excel (.xlsx).");
    } catch (err: any) {
      console.error('Excel export error:', err);
      showToast(`Ошибка экспорта Excel: ${err?.message || err}`, 'error');
      addLog(`Ошибка экспорта Excel: ${err?.message || err}`);
    }
  };

  const exportCSV = () => {
    const csvContent = generateFilteredCSV(filteredTrials, subjects, manualOverrides, subjectGroups);
    downloadText(csvContent, `filtered_export_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
  };

  const exportAllDataCSV = () => {
    if (processedData.length === 0) return;
    const csvContent = generateAllDataCSV(subjects, processedData, manualOverrides, subjectGroups);
    downloadText(csvContent, `MOGNU_geometry_SIGMA_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
    addLog("Экспортированы геометрические данные (SIGMA).");
  };

  const exportStatsCSV = () => {
    const csvContent = generateStatsCSV(subjects, processedData, manualOverrides, excludedLines, subjectGroups, excludedSubjects, excludedTrials, subjectApexConfigs, globalBoxPadding, manualZoneOverrides);
    downloadText('\uFEFF' + csvContent, `summary_statistics_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8;');
    addLog("Экспортирована сводная статистика (с геометрией и кинематикой MOGNU).");
  };

  const exportProbingLongCSV = () => {
    if (subjects.length === 0) {
      showToast('Нет данных испытуемых для экспорта', 'error');
      return;
    }
    const csvContent = generateProbingLongCSV(
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
    downloadText('\uFEFF' + csvContent, `probing_lmm_long_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8;');
    addLog("Экспортирована попробная динамика (Long Format для LMM / GLMM / Survival).");
    showToast("Попробный Long CSV успешно выгружен!", "success");
  };

  const exportSession = () => {
    if (subjects.length === 0) {
      showToast('Нет данных для сохранения в сессию', 'error');
      return;
    }
    try {
      const jsonStr = serializeSession({
        subjects,
        processedData,
        manualOverrides,
        excludedLines,
        excludedSubjects,
        excludedTrials,
        activeSubjectId,
        analysisMode,
        subjectGroups,
        angleThreshold,
        minLineLength,
        usePhasedMode,
        subjectApexConfigs,
        globalBoxPadding,
        manualZoneOverrides
      });
      const filename = `session_backup_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
      downloadText(jsonStr, filename, 'application/json');
      showToast('Сессия успешно сохранена в JSON', 'success');
      addLog("Сессия экспортирована в JSON.");
    } catch (err: any) {
      console.error('Session export error:', err);
      showToast(`Ошибка сохранения сессии JSON: ${err?.message || err}`, 'error');
      addLog(`Ошибка экспорта JSON: ${err?.message || err}`);
    }
  };

  const importSession = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      if (file.name.toLowerCase().endsWith('.json')) {
        const { snapshot, importedAngle, importedMinLen } = deserializeSession(text, ANGLE_THRESHOLD_SPLIT, MIN_LINE_LENGTH);

        setSubjects(snapshot.subjects);
        setProcessedData(snapshot.processedData);
        setManualOverrides(snapshot.manualOverrides);
        setExcludedLines(snapshot.excludedLines);
        setSubjectGroups(snapshot.subjectGroups);
        setAngleThreshold(importedAngle);
        setMinLineLength(importedMinLen);
        if (snapshot.usePhasedMode !== undefined) setUsePhasedMode(snapshot.usePhasedMode);
        setExcludedSubjects(snapshot.excludedSubjects);
        setExcludedTrials(snapshot.excludedTrials);
        if (snapshot.activeSubjectId) setActiveSubjectId(snapshot.activeSubjectId);
        if (snapshot.analysisMode) setAnalysisMode(snapshot.analysisMode);
        setSubjectApexConfigs(snapshot.subjectApexConfigs);
        if (snapshot.globalBoxPadding !== undefined) setGlobalBoxPadding(snapshot.globalBoxPadding);
        setManualZoneOverrides(snapshot.manualZoneOverrides);

        showToast('Сессия успешно загружена из JSON', 'success');
        addLog("Сессия успешно восстановлена из JSON.");
      } else {
        addLog("Для восстановления сессии используйте .json файл резервной копии.");
      }
    } catch (err: any) {
      console.error(err);
      setError("Ошибка при импорте сессии.");
      showToast(`Ошибка импорта сессии: ${err?.message || err}`, 'error');
      addLog("Ошибка: Не удалось прочитать файл сессии.");
    }
    e.target.value = "";
  };
  const resetFilters = () => {
    setFilterTypes(new Set());
    setFilterStartNode(null);
    setFilterFinishNode(null);
    setFilterOverridesOnly(false);
  };

  const clearAllData = () => {
    setProcessedData([]);
    setSubjects([]);
    setActiveSubjectId(null);
    resetFilters();
    setManualOverrides(new Set());
    setManualZoneOverrides({});
    setSelectedTrialId(null);
    setHoveredTrialId(null);
    setIsCalibrating(false);
    setShowHeatmap(false);
    setShowFinishHeatmap(false);
  };

  const [subjectSearch, setSubjectSearch] = useState('');

  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string | null>(null);
  const [solverFilter, setSolverFilter] = useState<'all' | 'solved' | 'unsolved'>('all');

  // Dynamic group aggregation across all subjects
  const groupStats = useMemo(() => {
    const map: Record<string, { total: number; solved: number; active: number; excluded: number }> = {};
    subjects.forEach(s => {
      const rawGrp = (subjectGroups[s.id] || s.group || '').trim();
      const grp = rawGrp || 'Без группы';
      if (!map[grp]) {
        map[grp] = { total: 0, solved: 0, active: 0, excluded: 0 };
      }
      map[grp].total++;
      if (s.isSolved) {
        map[grp].solved++;
      }
      if (excludedSubjects.has(s.id)) {
        map[grp].excluded++;
      } else {
        map[grp].active++;
      }
    });
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  }, [subjects, subjectGroups, excludedSubjects]);

  const filteredSubjects = useMemo(() => {
    let list = subjects;
    if (solverFilter === 'solved') {
      list = list.filter(s => !!s.isSolved);
    } else if (solverFilter === 'unsolved') {
      list = list.filter(s => !s.isSolved);
    }
    if (selectedGroupFilter !== null) {
      list = list.filter(s => {
        const grp = (subjectGroups[s.id] || s.group || '').trim() || 'Без группы';
        return grp === selectedGroupFilter;
      });
    }
    if (!subjectSearch.trim()) return list;
    const q = subjectSearch.toLowerCase().trim();
    return list.filter(s =>
      s.id.toLowerCase().includes(q) ||
      `${s.lastName || ''} ${s.firstName || ''}`.toLowerCase().includes(q) ||
      (subjectGroups[s.id] && subjectGroups[s.id].toLowerCase().includes(q)) ||
      (s.group && s.group.toLowerCase().includes(q)) ||
      ((q === 'онлайн' || q === 'online') && s.isOnline) ||
      ((q === 'очно' || q === 'offline') && !s.isOnline)
    );
  }, [subjects, subjectSearch, subjectGroups, selectedGroupFilter, solverFilter]);

  const solvedCount = useMemo(() => {
    return subjects.filter(s => s.isSolved).length;
  }, [subjects]);

  const onlineCount = useMemo(() => {
    return subjects.filter(s => s.isOnline).length;
  }, [subjects]);

  return (
    <div className="h-screen w-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden font-sans select-none">
      {/* ================= TOP COMPACT NAVBAR ================= */}
      <header className="h-14 bg-slate-900 border-b border-slate-800 px-5 flex items-center justify-between shrink-0 text-white z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-violet-500 flex items-center justify-center font-black text-white text-sm shadow-lg shadow-indigo-500/30">
            M
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-black text-sm tracking-tight text-white">M.O.G.N.U.</span>
              <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                2.0 EVO
              </span>
            </div>
            <div className="text-[10px] text-slate-400 font-medium hidden sm:block">
              Анализатор кинематики & геометрии «9 точек»
            </div>
          </div>
        </div>

        {/* 3 Analysis Modes Selector */}
        <div className="flex items-center bg-slate-800/80 p-1 rounded-xl border border-slate-700/60 gap-1">
          <button
            onClick={() => setAnalysisMode('kinematics')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              analysisMode === 'kinematics'
                ? 'bg-amber-500 text-white shadow-md shadow-amber-500/30 font-black'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Режим кинематики: профили скорости V(t), паузы, пики, выходы за рамку"
          >
            <Zap size={14} /> <span>Кинематика</span>
          </button>
          <button
            onClick={() => setAnalysisMode('geometry')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              analysisMode === 'geometry'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/30 font-black'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Классическая СИГМА: 9 узлов, типы линий, фазы решения"
          >
            <Ruler size={14} /> <span>Геометрия</span>
          </button>
          <button
            onClick={() => setAnalysisMode('duplex')}
            className={`px-3 py-1 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 ${
              analysisMode === 'duplex'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Дуплексный режим: одновременно кинематический и геометрический анализ"
          >
            <Layers size={14} /> <span>MOGNУ Дуплекс</span>
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {/* ⚡ One-Click Lazy Preprocessing & Rules Button */}
          <div className="flex items-center bg-indigo-950/70 p-0.5 rounded-xl border border-indigo-500/40 shadow-sm shadow-indigo-900/20">
            <button
              onClick={() => {
                handleRunPreprocessing();
                setIsPreprocessingModalOpen(true);
              }}
              disabled={subjects.length === 0}
              className="px-2.5 py-1.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-40 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm shadow-indigo-600/30 transition-all cursor-pointer"
              title="Ленивая предобработка в 1 клик: отсев бракованных проб, исключение невалидных испытуемых и выявление решений"
            >
              <Sparkles size={13} className="text-amber-300" />
              <span className="hidden sm:inline">⚡ Предобработка</span>
            </button>
            <button
              onClick={() => setIsPreprocessingModalOpen(true)}
              className="p-1.5 text-indigo-300 hover:text-white hover:bg-indigo-800/60 rounded-lg transition-colors cursor-pointer"
              title="Настройки правил и порогов предобработки"
            >
              <SlidersHorizontal size={13} />
            </button>
          </div>

          {/* Excel Export Button */}
          <button
            onClick={handleExportExcel}
            disabled={subjects.length === 0}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm shadow-emerald-600/30 transition-all"
            title="Экспорт сводной статистики в Excel (.xlsx: Лист 1 'Общая статистика' + Лист 2 'По этапам' + Лист 3 'Попробная динамика (LMM)')"
          >
            <FileSpreadsheet size={14} />
            <span className="hidden sm:inline">Excel (.xlsx)</span>
          </button>

          {/* Session Save */}
          <button
            onClick={exportSession}
            disabled={subjects.length === 0}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all"
            title="Сохранить сессию JSON"
          >
            <Download size={14} />
            <span className="hidden md:inline">Сохранить</span>
          </button>

          {/* Session Load */}
          <label
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
            title="Загрузить сессию JSON или калибровку"
          >
            <Upload size={14} />
            <span className="hidden md:inline">Загрузить</span>
            <input
              type="file"
              accept=".json,.csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file?.name.toLowerCase().endsWith('.json')) {
                  importSession(e);
                } else {
                  handleCalibrationFileUpload(e);
                }
              }}
              className="hidden"
            />
          </label>

          <div className="h-5 w-px bg-slate-800 mx-1 hidden sm:block"></div>

          {/* Phases Toggle */}
          <button
            onClick={() => setUsePhasedMode(!usePhasedMode)}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition-all ${
              usePhasedMode
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title="Анализ по этапам (начало, середина, конец)"
          >
            <Layers size={13} />
            <span className="hidden lg:inline">{usePhasedMode ? 'Этапы: ВКЛ' : 'Этапы: ВЫКЛ'}</span>
          </button>

          {/* Clear Button */}
          {subjects.length > 0 && (
            <button
              onClick={clearAllData}
              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-xl transition-colors"
              title="Очистить все загруженные данные"
            >
              <RefreshCcw size={15} />
            </button>
          )}
        </div>
      </header>

      {/* ================= MAIN WORKSPACE CONTAINER ================= */}
      <div className="flex-1 flex overflow-hidden bg-slate-950 w-full">
        {/* ================= 1. LEFT SIDEBAR: SUBJECTS ================= */}
        <aside className="w-72 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0 select-none">
          {/* Search & Filter Header */}
          <div className="p-3 border-b border-slate-800 space-y-2">
            <div className="relative">
              <Search size={14} className="text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={subjectSearch}
                onChange={(e) => setSubjectSearch(e.target.value)}
                placeholder="Поиск испытуемого..."
                className="w-full bg-slate-800/80 text-xs text-white pl-8 pr-7 py-1.5 rounded-xl border border-slate-700/60 focus:outline-none focus:border-indigo-500 placeholder-slate-500"
              />
              {subjectSearch && (
                <button
                  onClick={() => setSubjectSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <div className="flex justify-between items-center text-[11px] text-slate-400 px-1">
              <span>
                Всего: <b className="text-white">{subjects.length}</b> (решили: <b className="text-amber-400">{solvedCount}</b>)
              </span>
              {excludedSubjects.size > 0 && (
                <span className="text-[10px] text-rose-400 font-bold">
                  Искл: {excludedSubjects.size}
                </span>
              )}
            </div>

            {/* Solver Status Toggle (All / Solved / Unsolved) */}
            {subjects.length > 0 && (
              <div className="pt-2 border-t border-slate-800/70">
                <div className="grid grid-cols-3 gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[10px] font-bold">
                  <button
                    onClick={() => setSolverFilter('all')}
                    className={`py-1 px-1 rounded-md transition-all flex items-center justify-center gap-1 ${
                      solverFilter === 'all'
                        ? 'bg-slate-800 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title="Все испытуемые (решившие и не решившие)"
                  >
                    <span>Все</span>
                    <span className="opacity-60 text-[9px]">({subjects.length})</span>
                  </button>
                  <button
                    onClick={() => setSolverFilter('solved')}
                    className={`py-1 px-1 rounded-md transition-all flex items-center justify-center gap-1 ${
                      solverFilter === 'solved'
                        ? 'bg-amber-600 text-white shadow-sm shadow-amber-600/30 font-black'
                        : 'text-amber-400/90 hover:text-amber-300'
                    }`}
                    title="Только успешные решатели (статус РЕШИЛ 🏆)"
                  >
                    <Trophy size={11} className={solverFilter === 'solved' ? 'text-white' : 'text-amber-400'} />
                    <span>Решили</span>
                    <span className="text-[9px] font-mono opacity-80">({solvedCount})</span>
                  </button>
                  <button
                    onClick={() => setSolverFilter('unsolved')}
                    className={`py-1 px-1 rounded-md transition-all flex items-center justify-center gap-1 ${
                      solverFilter === 'unsolved'
                        ? 'bg-rose-700 text-white shadow-sm font-black'
                        : 'text-slate-400 hover:text-rose-300'
                    }`}
                    title="Только неуспешные участники (не решившие)"
                  >
                    <X size={11} className={solverFilter === 'unsolved' ? 'text-white' : 'text-slate-400'} />
                    <span>Не решили</span>
                    <span className="text-[9px] font-mono opacity-80">({subjects.length - solvedCount})</span>
                  </button>
                </div>
              </div>
            )}

            {/* Dynamic Group Filter & Distribution Chips */}
            {groupStats.length > 0 && (
              <div className="pt-1.5 pb-0.5 flex flex-wrap gap-1 px-1 max-h-24 overflow-y-auto custom-scrollbar">
                <button
                  onClick={() => setSelectedGroupFilter(null)}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 border ${
                    selectedGroupFilter === null
                      ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm shadow-indigo-600/30'
                      : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 border-slate-700/60'
                  }`}
                  title="Показать всех испытуемых"
                >
                  <span>Все</span>
                  <span className="text-[9px] opacity-75">({subjects.length})</span>
                </button>
                {groupStats.map(([grpName, gStat]) => {
                  const isSelected = selectedGroupFilter === grpName;
                  return (
                    <button
                      key={grpName}
                      onClick={() => setSelectedGroupFilter(isSelected ? null : grpName)}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1.5 border ${
                        isSelected
                          ? 'bg-amber-600 text-white border-amber-500 shadow-sm shadow-amber-600/30'
                          : 'bg-slate-800/80 text-slate-300 hover:text-white border-slate-700/60 hover:bg-slate-700/60'
                      }`}
                      title={`Группа «${grpName}»: всего ${gStat.total}, решили ${gStat.solved} (${((gStat.solved / Math.max(1, gStat.total)) * 100).toFixed(0)}%), исключено ${gStat.excluded}`}
                    >
                      <span className="truncate max-w-[100px]">{grpName}</span>
                      <span className="px-1 py-0.2 rounded bg-slate-900/80 text-[9px] font-mono text-amber-300">
                        {gStat.total}
                      </span>
                      {gStat.solved > 0 && (
                        <span className="text-[9px] text-emerald-400 font-semibold" title={`Решили: ${gStat.solved}`}>
                          ✓{gStat.solved}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Subject List Scrollable */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1.5">
            {filteredSubjects.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                {subjects.length === 0 ? (
                  <div className="space-y-2">
                    <Users size={28} className="mx-auto text-slate-600" />
                    <p>Нет загруженных данных</p>
                    <p className="text-[10px] text-slate-600">Нажмите кнопку ниже для добавления CSV</p>
                  </div>
                ) : (
                  "Испытуемые не найдены"
                )}
              </div>
            ) : (
              filteredSubjects.map(s => {
                const isSelected = activeSubjectId === s.id;
                const isExcluded = excludedSubjects.has(s.id);
                const subTrials = processedData.filter(t => t.subjectId === s.id);
                const subLinesCount = subTrials.reduce((acc, t) => acc + t.lines.length, 0);
                const groupName = subjectGroups[s.id];

                return (
                  <div
                    key={s.id}
                    onClick={() => { setActiveSubjectId(s.id); setSelectedTrialId(null); }}
                    className={`p-2.5 rounded-xl border flex items-center justify-between group cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-indigo-600 text-white border-indigo-500 shadow-lg shadow-indigo-600/30'
                        : isExcluded
                        ? 'bg-slate-900/60 text-slate-500 border-dashed border-rose-900/50 opacity-50 hover:opacity-100'
                        : 'bg-slate-800/60 hover:bg-slate-800 text-slate-300 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex flex-col min-w-0 pr-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-xs font-bold truncate max-w-[130px] ${isExcluded ? 'line-through' : ''}`}>
                          {s.lastName || s.firstName ? `${s.lastName || ''} ${s.firstName || ''}`.trim() : s.id}
                        </span>
                        {s.isSolved && (
                          <span className={`text-[8px] font-black px-1 py-0.2 rounded uppercase tracking-wider ${
                            isSelected ? 'bg-amber-400/30 text-amber-200' : 'bg-amber-400/15 text-amber-300 border border-amber-400/30'
                          }`}>
                            РЕШИЛ
                          </span>
                        )}
                        {s.isOnline && (
                          <span className={`text-[8px] font-black px-1 py-0.2 rounded uppercase tracking-wider ${
                            isSelected ? 'bg-emerald-400/30 text-emerald-100' : 'bg-emerald-400/15 text-emerald-300 border border-emerald-400/30'
                          }`} title="Участие онлайн">
                            ONLINE
                          </span>
                        )}
                        {isExcluded && (
                          <span className="text-[8px] font-black px-1 py-0.2 rounded uppercase bg-rose-500/20 text-rose-300 border border-rose-500/30">
                            ИСКЛ
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] opacity-70 flex items-center gap-1 mt-0.5">
                        <span>{subTrials.length} проб</span>
                        <span>•</span>
                        <span>{subLinesCount} линий</span>
                        {groupName && (
                          <>
                            <span>•</span>
                            <span className="truncate max-w-[60px] text-indigo-300">{groupName}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => toggleSubjectSolved(s.id)}
                        className={`p-1 rounded-lg transition-colors ${
                          s.isSolved
                            ? 'text-amber-300 hover:bg-amber-400/20'
                            : 'text-slate-500 hover:text-amber-400 hover:bg-slate-700/60'
                        }`}
                        title={s.isSolved ? "Пометить как 'Не решил'" : "Пометить как 'Решил'"}
                      >
                        <Trophy size={13} />
                      </button>
                      <button
                        onClick={() => toggleExcludeSubject(s.id)}
                        className={`p-1 rounded-lg transition-colors ${
                          isExcluded
                            ? 'text-amber-400 hover:bg-amber-500/20'
                            : 'text-slate-500 hover:text-rose-400 hover:bg-slate-700/60'
                        }`}
                        title={isExcluded ? "Вернуть испытуемого в анализ" : "Исключить из анализа"}
                      >
                        {isExcluded ? <RotateCcw size={13} /> : <X size={13} />}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Quick Upload Button at Bottom */}
          <div className="p-3 border-t border-slate-800 bg-slate-900/50">
            <label className="w-full py-2 bg-slate-800 hover:bg-slate-700/80 border border-dashed border-slate-700 text-slate-300 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-all">
              <Plus size={15} className="text-indigo-400" />
              <span>Добавить CSV файлы</span>
              <input type="file" accept=".csv" multiple onChange={handleFileUpload} className="hidden" />
            </label>
          </div>
        </aside>

        {/* ================= 2. MAIN CENTER DASHBOARD ================= */}
        <main className="flex-1 flex flex-col min-w-0 bg-slate-950 overflow-hidden">
          {/* Sub-bar: Workspace Tabs & Quick Calibration Status */}
          <div className="h-11 bg-slate-900/60 border-b border-slate-800/80 px-4 flex items-center justify-between shrink-0 select-none">
            {/* Tabs */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setActiveTab('analysis')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === 'analysis'
                    ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Target size={14} /> <span>Проба & Анализ</span>
              </button>
              <button
                onClick={() => setActiveTab('geometry')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === 'geometry'
                    ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Scissors size={14} /> <span>Линии и сегменты</span>
              </button>
              <button
                onClick={() => setActiveTab('heatmaps')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === 'heatmaps'
                    ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Flame size={14} /> <span>Тепловые карты</span>
              </button>
              <button
                onClick={() => setActiveTab('reports')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === 'reports'
                    ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <FileSpreadsheet size={14} /> <span>Сводный отчет & Экспорт</span>
              </button>
            </div>

            {/* Quick Tools on Right of Sub-bar */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleAutoCenter}
                disabled={!activeSubject}
                className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-40 text-amber-300 border border-amber-500/30 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-all"
                title="Жёстко подогнать траектории текущего испытуемого к центрам 9 точек (без искажения расстояний)"
              >
                <Target size={13} /> <span className="hidden md:inline">Авто-подгонка к 9 точкам</span>
              </button>
              <button
                onClick={handleBatchAlignTrajectories}
                disabled={subjects.length === 0}
                className="px-2 py-1 bg-sky-500/20 hover:bg-sky-500/30 disabled:opacity-40 text-sky-300 border border-sky-500/30 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-all"
                title="Жёстко выровнять траектории относительно центров 9 точек для всех загруженных участников"
              >
                <Zap size={12} /> <span className="hidden xl:inline">Всех (9 т.)</span>
              </button>
              <button
                onClick={() => setIsCalibrating(!isCalibrating)}
                disabled={!activeSubject}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1.5 transition-all ${
                  isCalibrating
                    ? 'bg-orange-600 text-white font-bold shadow-md shadow-orange-600/30'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                }`}
                title="Включить ручную калибровку (сдвиг, масштаб)"
              >
                <Move size={13} className={isCalibrating ? "text-white" : "text-orange-400"} />
                <span className="hidden md:inline">Ручная калибровка</span>
              </button>
              <button
                onClick={() => setShowBreaks(!showBreaks)}
                className={`p-1.5 rounded-lg text-xs transition-colors ${
                  showBreaks ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
                title="Показать точки поворота"
              >
                <Zap size={14} />
              </button>
            </div>
          </div>

          {/* ================= TAB 1: АНАЛИЗ ПРОБЫ ================= */}
          {activeTab === 'analysis' && (
            <div className="flex-1 p-4 grid grid-cols-12 gap-4 overflow-hidden">
              {/* LEFT COLUMN: Canvas Viewer & Controls (7 of 12 cols) */}
              <div className="col-span-12 xl:col-span-7 flex flex-col bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-2xl relative">
                {/* Canvas Toolbar Header */}
                <div className="h-10 px-3 bg-slate-800/60 border-b border-slate-800 flex items-center justify-between shrink-0">
                  {/* Trial Navigation & DIRECT EXCLUDE BUTTON */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white flex items-center gap-1">
                      {selectedTrialId !== null ? (
                        <>Проба <span className="text-indigo-400 font-black">#{selectedTrialId}</span> <span className="text-[10px] text-slate-500">из {activeSubjectTrials.length}</span></>
                      ) : (
                        <>Все пробы <span className="text-indigo-400 font-black">({activeSubjectTrials.length})</span></>
                      )}
                    </span>
                    <div className="flex items-center bg-slate-900 rounded-lg border border-slate-700/60 p-0.5">
                      <button onClick={() => navigateTrial('prev')} className="p-1 hover:bg-slate-800 text-slate-400 hover:text-white rounded" title="Предыдущая проба">
                        <ChevronLeft size={14} />
                      </button>
                      <button onClick={() => navigateTrial('next')} className="p-1 hover:bg-slate-800 text-slate-400 hover:text-white rounded" title="Следующая проба">
                        <ChevronRight size={14} />
                      </button>
                    </div>

                    {/* DIRECT TRIAL EXCLUSION BUTTON */}
                    {selectedTrialId !== null && (() => {
                      const isExcluded = activeSubjectId && excludedTrials.has(`${activeSubjectId}-${selectedTrialId}`);
                      return (
                        <button
                          onClick={() => {
                            if (activeSubjectId) toggleTrialExclusion(activeSubjectId, selectedTrialId);
                          }}
                          className={`ml-1 px-2.5 py-0.5 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-all ${
                            isExcluded
                              ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30'
                              : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 hover:border-rose-500/40'
                          }`}
                          title={isExcluded ? "Вернуть пробу в общий анализ" : "Исключить пробу из выгрузки и анализа"}
                        >
                          {isExcluded ? <RotateCcw size={12} /> : <Ban size={12} />}
                          <span>{isExcluded ? 'Вернуть пробу' : 'Исключить пробу'}</span>
                        </button>
                      );
                    })()}
                  </div>
                </div>

                <TrialCanvasStage
                  activeSubject={activeSubject}
                  activeNodes={activeNodes}
                  activeCellSize={activeCellSize}
                  trialsToDraw={trialsToDraw}
                  filteredTrials={filteredTrials}
                  selectedTrial={selectedTrial}
                  selectedTrialId={selectedTrialId}
                  hoveredTrialId={hoveredTrialId}
                  isCalibrating={isCalibrating}
                  animationTick={animationTick}
                  zoom={zoom}
                  setZoom={setZoom}
                  autoFit={autoFit}
                  setAutoFit={setAutoFit}
                  panOffset={panOffset}
                  setPanOffset={setPanOffset}
                  showHeatmap={showHeatmap}
                  showFinishHeatmap={showFinishHeatmap}
                  showBreaks={showBreaks}
                  filterStartNode={filterStartNode}
                  filterFinishNode={filterFinishNode}
                  filterTypes={filterTypes}
                  filterOverridesOnly={filterOverridesOnly}
                  manualOverrides={manualOverrides}
                  manualZoneOverrides={manualZoneOverrides}
                  onToggleManualZoneOverride={handleToggleManualZoneOverride}
                  onCalibrationChange={handleCalibrationChange}
                  getApexConfig={getApexConfig}
                  globalBoxPadding={globalBoxPadding}
                  excludedTrials={excludedTrials}
                  activeSubjectId={activeSubjectId}
                  activeSubjectTrials={activeSubjectTrials}
                  analysisMode={analysisMode}
                />

                {/* Trial Ribbon Carousel */}
                {activeSubject && activeSubjectTrials.length > 0 && (
                  <div className="shrink-0 border-t border-slate-800 bg-slate-900/90 p-2.5 select-none">
                    <div className="flex items-center justify-between mb-1.5 px-1">
                      <div className="flex items-center gap-1.5">
                        <Layers size={13} className="text-indigo-400" />
                        <span className="text-[11px] font-bold text-white">Лента проб ({activeSubjectTrials.length})</span>
                      </div>
                      <button
                        onClick={() => setSelectedTrialId(null)}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                          selectedTrialId === null
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        Все пробы
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1 pt-0.5">
                      {activeSubjectTrials.map((t, idx) => {
                        const isSelected = selectedTrialId === t.trialId;
                        const isExcluded = excludedTrials.has(`${activeSubjectId}-${t.trialId}`);
                        const hasChord = t.lines.some(l => l.type === 'хордовая');
                        const isLastTrial = idx === activeSubjectTrials.length - 1 && activeSubject.isSolved;

                        return (
                          <button
                            key={t.trialId}
                            onClick={() => setSelectedTrialId(isSelected ? null : t.trialId)}
                            className={`px-2.5 py-1 rounded-xl text-xs font-bold shrink-0 flex items-center gap-1.5 border transition-all ${
                              isSelected
                                ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-600/30 ring-2 ring-indigo-400/50'
                                : isExcluded
                                ? 'bg-slate-900 text-slate-500 border-dashed border-rose-900/60 line-through opacity-60'
                                : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border-slate-700/60 hover:border-slate-600'
                            }`}
                          >
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                isLastTrial ? 'bg-amber-400 ring-2 ring-amber-300/40' :
                                hasChord ? 'bg-amber-400' :
                                isExcluded ? 'bg-rose-500' :
                                isSelected ? 'bg-white' : 'bg-slate-500'
                              }`}
                            />
                            <span>#{t.trialId}</span>
                            <span className="text-[9px] opacity-70 font-mono">
                              {(t.trial_time_ms / 1000).toFixed(1)}с
                            </span>
                            {isLastTrial && <span className="text-[10px]" title="Решение задачи">🏆</span>}
                            {hasChord && !isLastTrial && <span className="text-[10px] text-amber-300" title="Хордовая линия">⭐</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Compact Trial Log Table */}
                {activeSubject && (
                  <div className="shrink-0 border-t border-slate-800 bg-slate-950 p-2.5 max-h-40 overflow-y-auto custom-scrollbar select-none">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead className="text-[9px] uppercase font-bold text-slate-400 sticky top-0 bg-slate-950 z-10 border-b border-slate-800">
                        <tr>
                          <th className="py-1 px-2">Проба</th>
                          <th className="py-1 px-2">Линия</th>
                          <th className="py-1 px-2">Тип</th>
                          <th className="py-1 px-2">Время</th>
                          <th className="py-1 px-2">Узлы</th>
                          <th className="py-1 px-2 text-right">Действия</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-900">
                        {activeSubjectTrials
                          .filter(t => selectedTrialId === null || t.trialId === selectedTrialId)
                          .map(t => (
                            <React.Fragment key={`${t.subjectId}-${t.trialId}`}>
                              {t.lines.map((l, lIdx) => {
                                const overrideKey = `${t.subjectId}-${t.trialId}`;
                                const isOverridden = manualOverrides.has(overrideKey);
                                const isTrialExcluded = excludedTrials.has(`${t.subjectId}-${t.trialId}`);
                                const isLineExcluded = excludedLines.has(`${t.subjectId}-${t.trialId}-${lIdx}`);
                                const isTrialSelected = selectedTrialId === t.trialId;

                                return (
                                  <tr
                                    key={`${t.trialId}-${lIdx}`}
                                    className={`transition-colors ${
                                      isTrialSelected ? 'bg-indigo-950/40' : 'hover:bg-slate-900/60'
                                    } ${isTrialExcluded || isLineExcluded ? 'opacity-40 line-through decoration-rose-500/60' : ''}`}
                                  >
                                    <td className="py-1 px-2 font-mono font-bold text-white text-[11px]">
                                      #{t.trialId}
                                    </td>
                                    <td className="py-1 px-2 text-slate-400 font-mono text-[10px]">
                                      №{lIdx + 1}
                                    </td>
                                    <td className="py-1 px-2">
                                      <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold border ${
                                        l.type === 'хордовая'
                                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                                          : l.type === 'боковая'
                                          ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                                          : 'bg-slate-800 text-slate-300 border-slate-700'
                                      }`}>
                                        {isOverridden ? 'прочая' : l.type}
                                      </span>
                                    </td>
                                    <td className="py-1 px-2 font-mono text-slate-400 text-[10px]">
                                      {lIdx === 0 ? `${t.trial_time_ms.toFixed(0)}мс` : ''}
                                    </td>
                                    <td className="py-1 px-2 font-bold text-indigo-400 font-mono text-[10px]">
                                      {l.nodesVisited.join(' → ') || '---'}
                                    </td>
                                    <td className="py-1 px-2 text-right">
                                      <div className="flex items-center justify-end gap-1">
                                        {lIdx === 0 && (
                                          <button
                                            onClick={() => toggleTrialExclusion(t.subjectId, t.trialId)}
                                            className={`p-1 rounded transition-colors ${
                                              isTrialExcluded
                                                ? 'text-amber-400 hover:bg-amber-500/20'
                                                : 'text-slate-500 hover:text-rose-400'
                                            }`}
                                            title={isTrialExcluded ? "Вернуть пробу в анализ" : "Исключить пробу из анализа"}
                                          >
                                            {isTrialExcluded ? <RotateCcw size={12} /> : <Ban size={12} />}
                                          </button>
                                        )}
                                        {lIdx === 0 && (
                                          <button
                                            onClick={() => toggleOverride(t)}
                                            className="p-1 rounded text-slate-500 hover:text-rose-400 transition-colors"
                                            title={isOverridden ? "Вернуть исходные типы" : "Пометить как прочую"}
                                          >
                                            {isOverridden ? <RotateCcw size={12} /> : <Trash2 size={12} />}
                                          </button>
                                        )}
                                        {lIdx === 0 && (
                                          <button
                                            onClick={() => setSelectedTrialId(isTrialSelected ? null : t.trialId)}
                                            className={`p-1 rounded transition-colors ${
                                              isTrialSelected ? 'text-indigo-300' : 'text-slate-500 hover:text-indigo-400'
                                            }`}
                                            title={isTrialSelected ? "Показать все пробы" : "Изолировать пробу на холсте"}
                                          >
                                            <Eye size={12} />
                                          </button>
                                        )}
                                        <button
                                          onClick={() => toggleLineExclusion(t.subjectId, t.trialId, lIdx)}
                                          className={`p-1 rounded transition-colors ${
                                            isLineExcluded ? 'text-amber-400' : 'text-slate-500 hover:text-amber-400'
                                          }`}
                                          title={isLineExcluded ? "Вернуть линию в статистику" : "Исключить линию из статистики"}
                                        >
                                          {isLineExcluded ? <RotateCcw size={12} /> : <Scissors size={12} />}
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </React.Fragment>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* RIGHT COLUMN: Analytics Stack (5 of 12 cols) */}
              <div className="col-span-12 xl:col-span-5 flex flex-col gap-4 overflow-y-auto custom-scrollbar pr-1 select-none">
                {/* CALIBRATION PANEL IF ACTIVE */}
                {isCalibrating && activeSubject && (
                  <div className="bg-slate-900 p-4 rounded-2xl border border-amber-500/40 shadow-xl space-y-4 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                        <Move size={14} /> Калибровка координат рисунка
                      </h3>
                      <button onClick={() => setIsCalibrating(false)} className="text-[10px] text-slate-400 hover:text-white">
                        Закрыть
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Сдвиг X (px)</span>
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleCalibrationChange(prev => ({ offsetX: prev.offsetX - 1 }))} className="p-1 bg-slate-800 rounded text-slate-300 hover:bg-slate-700"><ArrowLeft size={12} /></button>
                          <input
                            type="number"
                            value={activeSubject.calibration.offsetX}
                            onChange={(e) => {
                              const val = parseInt(e.target.value);
                              handleCalibrationChange({ offsetX: isNaN(val) ? 0 : val });
                            }}
                            className="w-full bg-slate-800 text-white text-center py-1 rounded text-xs font-bold border border-slate-700"
                          />
                          <button onClick={() => handleCalibrationChange(prev => ({ offsetX: prev.offsetX + 1 }))} className="p-1 bg-slate-800 rounded text-slate-300 hover:bg-slate-700"><ArrowRight size={12} /></button>
                        </div>
                      </div>
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Сдвиг Y (px)</span>
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleCalibrationChange(prev => ({ offsetY: prev.offsetY - 1 }))} className="p-1 bg-slate-800 rounded text-slate-300 hover:bg-slate-700"><ArrowUp size={12} /></button>
                          <input
                            type="number"
                            value={activeSubject.calibration.offsetY}
                            onChange={(e) => {
                              const val = parseInt(e.target.value);
                              handleCalibrationChange({ offsetY: isNaN(val) ? 0 : val });
                            }}
                            className="w-full bg-slate-800 text-white text-center py-1 rounded text-xs font-bold border border-slate-700"
                          />
                          <button onClick={() => handleCalibrationChange(prev => ({ offsetY: prev.offsetY + 1 }))} className="p-1 bg-slate-800 rounded text-slate-300 hover:bg-slate-700"><ArrowDown size={12} /></button>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Масштаб</span>
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleCalibrationChange(prev => ({ scale: Math.max(0.1, +(prev.scale - 0.05).toFixed(2)) }))} className="p-1 bg-slate-800 rounded text-slate-300 hover:bg-slate-700"><Minus size={12} /></button>
                          <input
                            type="number"
                            step="0.01"
                            value={activeSubject.calibration.scale}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val)) handleCalibrationChange({ scale: val });
                            }}
                            className="w-full bg-slate-800 text-white text-center py-1 rounded text-xs font-bold border border-slate-700"
                          />
                          <button onClick={() => handleCalibrationChange(prev => ({ scale: +(prev.scale + 0.05).toFixed(2) }))} className="p-1 bg-slate-800 rounded text-slate-300 hover:bg-slate-700"><Plus size={12} /></button>
                        </div>
                      </div>
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Чувств-ть (px)</span>
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleCalibrationChange(prev => ({ hitPadding: Math.max(0, prev.hitPadding - 1) }))} className="p-1 bg-slate-800 rounded text-slate-300 hover:bg-slate-700"><Minus size={12} /></button>
                          <input
                            type="number"
                            value={activeSubject.calibration.hitPadding}
                            onChange={(e) => {
                              const val = parseInt(e.target.value);
                              if (!isNaN(val)) handleCalibrationChange({ hitPadding: val });
                            }}
                            className="w-full bg-slate-800 text-white text-center py-1 rounded text-xs font-bold border border-slate-700"
                          />
                          <button onClick={() => handleCalibrationChange(prev => ({ hitPadding: prev.hitPadding + 1 }))} className="p-1 bg-slate-800 rounded text-slate-300 hover:bg-slate-700"><Plus size={12} /></button>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button onClick={handleAutoCenter} className="flex-1 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-900 font-black rounded-lg text-xs flex items-center justify-center gap-1.5 transition-colors">
                        <Target size={13} /> Авто-подгонка
                      </button>
                      <button onClick={() => handleCalibrationChange({ offsetX: 0, offsetY: 0, scale: 1.0 })} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-lg text-xs transition-colors">
                        Сброс
                      </button>
                    </div>
                  </div>
                )}

                {/* CARD 1: PROBING CONVERGENCE GRAPH */}
                {activeSubject && (
                  <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 shadow-xl">
                    <ProbingConvergenceGraph
                      trials={processedData.filter(t => t.subjectId === activeSubjectId)}
                      nodes={activeSubject.nodes}
                      calibration={activeSubject.calibration}
                      selectedTrialId={selectedTrialId}
                      onSelectTrial={(tId) => setSelectedTrialId(tId)}
                      excludedTrials={excludedTrials}
                      subjectId={activeSubjectId || ''}
                      allSubjects={subjects}
                      allProcessedData={processedData}
                      subjectGroups={subjectGroups}
                      excludedSubjects={excludedSubjects}
                      apexConfig={getApexConfig(activeSubjectId || '')}
                      onUpdateApexConfig={(updates) => activeSubjectId && updateApexConfig(activeSubjectId, updates)}
                      onResetApexConfig={() => activeSubjectId && handleResetApexConfig(activeSubjectId)}
                      onAutoAlignApex={() => activeSubjectId && handleAutoAlignApex(activeSubjectId)}
                      onBatchAutoAlignAllSolvers={handleBatchAutoAlignAllSolvers}
                      onBatchResetAllSolvers={handleBatchResetAllSolvers}
                      isCurrentSubjectSolved={!!activeSubject.isSolved}
                      subjectApexConfigs={subjectApexConfigs}
                      globalBoxPadding={globalBoxPadding}
                      onUpdateGlobalBoxPadding={setGlobalBoxPadding}
                      manualZoneOverrides={manualZoneOverrides}
                    />
                  </div>
                )}

                {/* CARD 2: KINEMATICS VELOCITY PROFILE */}
                {(analysisMode === 'kinematics' || analysisMode === 'duplex') && (
                  <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 shadow-xl">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-indigo-500/20 text-indigo-400 rounded-lg">
                          <Activity size={14} />
                        </div>
                        <div>
                          <h3 className="text-xs font-bold text-white">
                            {selectedTrial ? `Профиль скорости пробы #${selectedTrial.trialId}` : 'Кинематические показатели'}
                          </h3>
                          <div className="text-[10px] text-slate-400">
                            {selectedTrial
                              ? `V peak: ${selectedTrial.kinematics?.metrics.peakVelocityPxS.toFixed(0) || 0} px/s • Пауз: ${selectedTrial.kinematics?.metrics.pauseCount || 0}`
                              : `Ср. скорость: ${stats.avgKinSpeed.toFixed(1)} px/s • Выход: ${stats.outsideBoxTrialRatio.toFixed(0)}%`}
                          </div>
                        </div>
                      </div>
                      {selectedTrial && (
                        <span className="text-[10px] text-slate-400 font-mono">
                          {(selectedTrial.trial_time_ms / 1000).toFixed(1)} сек
                        </span>
                      )}
                    </div>

                    {selectedTrial ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-2 text-[10px]">
                          <div className="p-2 bg-slate-950 rounded-xl border border-slate-800">
                            <span className="text-slate-500 uppercase block">V mean</span>
                            <span className="font-bold text-white text-xs">
                              {selectedTrial.kinematics?.metrics.meanVelocityPxS.toFixed(0) || 0} px/s
                            </span>
                          </div>
                          <div className="p-2 bg-slate-950 rounded-xl border border-slate-800">
                            <span className="text-slate-500 uppercase block">Паузы</span>
                            <span className="font-bold text-amber-400 text-xs">
                              {selectedTrial.kinematics?.metrics.pauseTimeS.toFixed(1) || 0} с
                            </span>
                          </div>
                          <div className="p-2 bg-slate-950 rounded-xl border border-slate-800">
                            <span className="text-slate-500 uppercase block">Вне 9 точек</span>
                            <span className={`font-bold text-xs ${
                              (selectedTrial.kinematics?.metrics.outsideBoxTimeMs || 0) > 0 ? 'text-rose-400' : 'text-emerald-400'
                            }`}>
                              {(selectedTrial.kinematics?.metrics.outsideBoxTimeMs || 0) > 0 ? 'ДА' : 'НЕТ'}
                            </span>
                          </div>
                        </div>
                        <KinematicsVelocityGraph kinematics={selectedTrial.kinematics} />
                      </div>
                    ) : (
                      <div className="p-4 bg-slate-950 rounded-xl border border-dashed border-slate-800 text-center">
                        <p className="text-xs text-slate-400">
                          Кликните по любой пробе в ленте или логе, чтобы увидеть профиль скорости V(t)
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* CARD 3: PARTICIPANT SUMMARY & INFO */}
                {activeSubject && (
                  <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 shadow-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                        <User size={14} className="text-indigo-400" />
                        <span>Данные испытуемого ({activeSubject.id})</span>
                      </h3>
                      <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                        activeSubject.isOnline ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}>
                        {activeSubject.isOnline ? 'Онлайн' : 'Очно'}
                      </span>
                    </div>

                    {/* FORMAT TOGGLE (ONLINE / OFFLINE) */}
                    <div className="flex items-center justify-between p-2.5 bg-slate-950 rounded-xl border border-slate-800">
                      <div className="flex items-center gap-2.5">
                        <div className={`p-1.5 rounded-lg ${activeSubject.isOnline ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
                          <Globe size={14} />
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500 uppercase font-semibold block leading-tight">Формат участия</span>
                          <span className={`text-xs font-bold ${activeSubject.isOnline ? 'text-emerald-400' : 'text-slate-300'}`}>
                            {activeSubject.isOnline ? 'Онлайн (веб-версия)' : 'Очно (в лаборатории)'}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const nextVal = !activeSubject.isOnline;
                          setSubjects(prev => prev.map(s => s.id === activeSubject.id ? { ...s, isOnline: nextVal } : s));
                        }}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ${
                          activeSubject.isOnline ? 'bg-emerald-500' : 'bg-slate-700'
                        }`}
                        title={activeSubject.isOnline ? 'Переключить на "Очно"' : 'Переключить на "Онлайн"'}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                            activeSubject.isOnline ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase block mb-0.5">Фамилия</span>
                        <input
                          type="text"
                          value={activeSubject.lastName || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSubjects(prev => prev.map(s => s.id === activeSubject.id ? { ...s, lastName: val } : s));
                          }}
                          placeholder="Фамилия"
                          className="w-full bg-slate-800 text-white rounded-lg px-2.5 py-1 text-xs font-bold border border-slate-700 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase block mb-0.5">Имя</span>
                        <input
                          type="text"
                          value={activeSubject.firstName || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSubjects(prev => prev.map(s => s.id === activeSubject.id ? { ...s, firstName: val } : s));
                          }}
                          placeholder="Имя"
                          className="w-full bg-slate-800 text-white rounded-lg px-2.5 py-1 text-xs font-bold border border-slate-700 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>

                    <div>
                      <span className="text-[10px] text-slate-500 uppercase block mb-0.5">Экспериментальная группа</span>
                      <input
                        type="text"
                        value={subjectGroups[activeSubject.id] || ""}
                        onChange={(e) => setSubjectGroups(prev => ({...prev, [activeSubject.id]: e.target.value}))}
                        placeholder="Название группы (Контроль, Подсказка, и т.д.)"
                        className="w-full bg-slate-800 text-indigo-300 rounded-lg px-2.5 py-1 text-xs font-bold border border-slate-700 focus:outline-none focus:border-indigo-500 placeholder-slate-600"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-[10px]">
                      <div className="p-2 bg-slate-950 rounded-xl border border-slate-800">
                        <span className="text-slate-500 uppercase block">Время</span>
                        <span className="font-bold text-white text-xs">{(stats.total_solution_time_ms / 1000).toFixed(0)}с</span>
                      </div>
                      <div className="p-2 bg-slate-950 rounded-xl border border-slate-800">
                        <span className="text-slate-500 uppercase block">Ср. проба</span>
                        <span className="font-bold text-white text-xs">{(stats.mean_trial_time_ms / 1000).toFixed(1)}с</span>
                      </div>
                      <div className="p-2 bg-slate-950 rounded-xl border border-slate-800">
                        <span className="text-slate-500 uppercase block">Проб</span>
                        <span className="font-bold text-indigo-400 text-xs">{stats.totalTrials}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <div className="p-2 bg-slate-950 rounded-xl border border-slate-800">
                        <span className="text-slate-500 uppercase block">Возраст / Пол</span>
                        <span className="font-bold text-slate-300 text-xs">{activeSubject.age || '—'} / {activeSubject.gender || '—'}</span>
                      </div>
                      <div className="p-2 bg-slate-950 rounded-xl border border-slate-800">
                        <span className="text-slate-500 uppercase block">Инсайт / Решал</span>
                        <span className="font-bold text-slate-300 text-xs">{activeSubject.insight || '—'} / {activeSubject.solvedBefore || '—'}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* CARD 4: SETTINGS */}
                <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 shadow-xl space-y-3">
                  <h3 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Settings size={14} className="text-indigo-400" />
                    <span>Параметры сегментации линий</span>
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                        <span>Угол поворота</span>
                        <span className="text-indigo-400 font-bold">{angleThreshold}°</span>
                      </div>
                      <input
                        type="range"
                        min="5"
                        max="90"
                        step="1"
                        value={angleThreshold}
                        onChange={(e) => setAngleThreshold(parseInt(e.target.value))}
                        className="w-full accent-indigo-500 cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                        <span>Мин. длина (px)</span>
                        <span className="text-indigo-400 font-bold">{minLineLength}</span>
                      </div>
                      <input
                        type="range"
                        min="10"
                        max="500"
                        step="5"
                        value={minLineLength}
                        onChange={(e) => setMinLineLength(parseInt(e.target.value))}
                        className="w-full accent-indigo-500 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* ================= TAB 2: ГЕОМЕТРИЯ & СЕГМЕНТЫ ================= */}
          {activeTab === 'geometry' && (
            <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-5 bg-slate-950 select-none">
              {/* Phased Analysis if enabled */}
              {usePhasedMode && stats.phases && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {(['beginning', 'middle', 'end'] as const).map(phaseKey => {
                    const phase = stats.phases![phaseKey];
                    const titles = { beginning: 'Начало решения (Этап 1)', middle: 'Середина решения (Этап 2)', end: 'Конец решения (Этап 3)' };
                    const accentColors = { beginning: 'text-blue-400 border-blue-500/30', middle: 'text-emerald-400 border-emerald-500/30', end: 'text-amber-400 border-amber-500/30' };

                    return (
                      <div key={phaseKey} className={`bg-slate-900 p-4 rounded-2xl border shadow-xl space-y-3 ${accentColors[phaseKey]}`}>
                        <h4 className="text-xs font-black uppercase tracking-wider text-white flex items-center justify-between">
                          <span>{titles[phaseKey]}</span>
                          <span className="text-[10px] font-mono text-slate-400">{phase.totalTrials} проб</span>
                        </h4>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="p-2 bg-slate-950 rounded-xl border border-slate-800">
                            <span className="text-[10px] text-slate-500 block">Ср. время</span>
                            <span className="font-bold text-white">{phase.mean_trial_time_ms.toFixed(0)} мс</span>
                          </div>
                          <div className="p-2 bg-slate-950 rounded-xl border border-slate-800">
                            <span className="text-[10px] text-slate-500 block">Точка-точка</span>
                            <span className="font-bold text-emerald-400">{phase.linesBothEndsInNodes}</span>
                          </div>
                          <div className="p-2 bg-slate-950 rounded-xl border border-slate-800">
                            <span className="text-[10px] text-slate-500 block">Вне точек</span>
                            <span className="font-bold text-rose-400">{phase.linesAnyEndOutside}</span>
                          </div>
                          <div className="p-2 bg-slate-950 rounded-xl border border-slate-800">
                            <span className="text-[10px] text-slate-500 block">Ср. длина (все)</span>
                            <span className="font-bold text-indigo-300">{phase.avgAllLinesLength.toFixed(1)} px</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Filtering & Counts Grids */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* 1. Line Types Filter */}
                <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800 shadow-xl space-y-3">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                      <BarChart3 size={14} className="text-indigo-400" />
                      <span>Типы линий</span>
                    </h3>
                    {(filterTypes.size > 0 || filterStartNode !== null || filterFinishNode !== null || filterOverridesOnly) && (
                      <button onClick={resetFilters} className="text-[10px] text-indigo-400 hover:underline">
                        Сбросить фильтры
                      </button>
                    )}
                  </div>
                  <div className="space-y-1.5 max-h-52 overflow-y-auto custom-scrollbar">
                    {Object.entries(stats.lineTypeCounts).sort((a,b) => (b[1] as number) - (a[1] as number)).map(([type, count]) => {
                      const isSelected = filterTypes.has(type);
                      return (
                        <div
                          key={type}
                          onClick={() => toggleFilterType(type)}
                          className={`flex justify-between items-center p-2 rounded-xl cursor-pointer text-xs transition-all border ${
                            isSelected
                              ? 'bg-indigo-600 text-white border-indigo-500 font-bold'
                              : 'bg-slate-800/60 hover:bg-slate-800 text-slate-300 border-slate-800'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {isSelected ? <CheckSquare size={13} /> : <Square size={13} className="text-slate-500" />}
                            <span className="capitalize">{type}</span>
                          </div>
                          <span className="font-mono opacity-80">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Start Nodes */}
                <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800 shadow-xl space-y-3">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Target size={14} className="text-rose-400" />
                      <span>Точки старта (1-9)</span>
                    </h3>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[1,2,3,4,5,6,7,8,9].map(num => (
                      <button
                        key={num}
                        onClick={() => setFilterStartNode(filterStartNode === num ? null : num)}
                        className={`p-2.5 rounded-xl flex flex-col items-center border transition-all ${
                          filterStartNode === num
                            ? 'bg-rose-600 text-white border-rose-500 shadow-md shadow-rose-600/30'
                            : 'bg-slate-800/60 hover:bg-slate-800 text-slate-300 border-slate-800'
                        }`}
                      >
                        <span className="text-[9px] opacity-60">Узел #{num}</span>
                        <span className="text-sm font-black mt-0.5">{stats.startNodeCounts[num] || 0}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 3. Finish Nodes */}
                <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800 shadow-xl space-y-3">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Flag size={14} className="text-emerald-400" />
                      <span>Точки финиша (1-9)</span>
                    </h3>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[1,2,3,4,5,6,7,8,9].map(num => (
                      <button
                        key={num}
                        onClick={() => setFilterFinishNode(filterFinishNode === num ? null : num)}
                        className={`p-2.5 rounded-xl flex flex-col items-center border transition-all ${
                          filterFinishNode === num
                            ? 'bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-600/30'
                            : 'bg-slate-800/60 hover:bg-slate-800 text-slate-300 border-slate-800'
                        }`}
                      >
                        <span className="text-[9px] opacity-60">Узел #{num}</span>
                        <span className="text-sm font-black mt-0.5">{stats.finishNodeCounts[num] || 0}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Full Detailed Log Table */}
              <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xl p-4">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Activity size={14} className="text-indigo-400" />
                    <span>Таблица всех линий и проб {activeSubjectId ? `(${activeSubjectId})` : ''}</span>
                  </h3>
                </div>

                <div className="max-h-96 overflow-y-auto custom-scrollbar rounded-xl border border-slate-800 bg-slate-950">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="text-[10px] uppercase font-bold text-slate-400 sticky top-0 bg-slate-900/90 z-10 border-b border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3">Проба</th>
                        <th className="py-2.5 px-3">Тип линии</th>
                        <th className="py-2.5 px-3">Время (мс)</th>
                        <th className="py-2.5 px-3">Узлы (траектория)</th>
                        <th className="py-2.5 px-3 text-right">Действия</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {processedData.length > 0 ? (
                        processedData
                          .filter(t => t.subjectId === activeSubjectId)
                          .map(t => (
                            <React.Fragment key={`${t.subjectId}-${t.trialId}`}>
                              {t.lines.map((l, idx) => {
                                const isOverridden = manualOverrides.has(`${t.subjectId}-${t.trialId}`);
                                const isSelected = selectedTrialId === t.trialId;
                                const isVisible = filteredTrials.some(ft => ft.trialId === t.trialId);
                                if (!isVisible && !isSelected) return null;

                                return (
                                  <tr
                                    key={`${t.trialId}-${idx}`}
                                    className={`hover:bg-slate-800/40 transition-colors ${isSelected ? 'bg-indigo-950/40' : ''} ${
                                      excludedLines.has(`${t.subjectId}-${t.trialId}-${idx}`) ? 'opacity-40 line-through decoration-rose-500/60' : ''
                                    }`}
                                  >
                                    <td className="py-2 px-3 font-mono font-bold text-white">#{t.trialId}</td>
                                    <td className="py-2 px-3">
                                      <span className="px-2 py-0.5 rounded text-[10px] font-bold border bg-slate-800 border-slate-700 text-slate-300">
                                        {isOverridden ? 'прочая' : l.type}
                                      </span>
                                    </td>
                                    <td className="py-2 px-3 font-mono text-slate-400">{idx === 0 ? t.trial_time_ms.toFixed(0) : ''}</td>
                                    <td className="py-2 px-3 font-bold text-indigo-400 font-mono">{l.nodesVisited.join(' → ') || '---'}</td>
                                    <td className="py-2 px-3 text-right">
                                      <div className="flex items-center justify-end gap-1">
                                        {idx === 0 && (
                                          <button
                                            onClick={() => toggleTrialExclusion(t.subjectId, t.trialId)}
                                            className={`p-1 rounded transition-colors ${
                                              excludedTrials.has(`${t.subjectId}-${t.trialId}`)
                                                ? 'text-amber-400 bg-amber-500/20'
                                                : 'text-slate-500 hover:text-amber-400'
                                            }`}
                                            title={excludedTrials.has(`${t.subjectId}-${t.trialId}`) ? "Вернуть пробу" : "Исключить пробу"}
                                          >
                                            {excludedTrials.has(`${t.subjectId}-${t.trialId}`) ? <RotateCcw size={13} /> : <Ban size={13} />}
                                          </button>
                                        )}
                                        {idx === 0 && (
                                          <button
                                            onClick={() => toggleOverride(t)}
                                            className="p-1 rounded text-slate-500 hover:text-rose-400 transition-colors"
                                            title={isOverridden ? "Вернуть исходные типы" : "Пометить как прочую"}
                                          >
                                            {isOverridden ? <RotateCcw size={13} /> : <Trash2 size={13} />}
                                          </button>
                                        )}
                                        {idx === 0 && (
                                          <button
                                            onClick={() => setSelectedTrialId(isSelected ? null : t.trialId)}
                                            className={`p-1 rounded transition-colors ${
                                              isSelected ? 'text-indigo-300' : 'text-slate-500 hover:text-indigo-400'
                                            }`}
                                            title="Посмотреть на холсте"
                                          >
                                            <Eye size={13} />
                                          </button>
                                        )}
                                        <button
                                          onClick={() => toggleLineExclusion(t.subjectId, t.trialId, idx)}
                                          className={`p-1 rounded transition-colors ${
                                            excludedLines.has(`${t.subjectId}-${t.trialId}-${idx}`) ? 'text-amber-400' : 'text-slate-500 hover:text-amber-400'
                                          }`}
                                          title="Исключить линию"
                                        >
                                          {excludedLines.has(`${t.subjectId}-${t.trialId}-${idx}`) ? <RotateCcw size={13} /> : <Scissors size={13} />}
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </React.Fragment>
                          ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-slate-500">
                            Загрузите данные или выберите участника
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ================= TAB 3: ТЕПЛОВЫЕ КАРТЫ ================= */}
          {activeTab === 'heatmaps' && (
            <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-6 bg-slate-950 select-none">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <GlobalHeatMap
                  title="Стартовые точки: все пробы"
                  icon={<LayoutGrid size={18} />}
                  points={globalHeatmapAll}
                  normalizedNodes={averageNormalizedNodes}
                />
                <GlobalHeatMap
                  title="Финишные точки: все пробы"
                  icon={<Flag size={18} />}
                  points={globalHeatmapFinishAll}
                  normalizedNodes={averageNormalizedNodes}
                />
                <GlobalHeatMap
                  title="Стартовые точки: финалы решений"
                  icon={<Trophy size={18} />}
                  points={globalHeatmapCorrectLast}
                  normalizedNodes={averageNormalizedNodes}
                />
                <GlobalHeatMap
                  title="Финишные точки: финалы решений"
                  icon={<Trophy size={18} className="text-emerald-500" />}
                  points={globalHeatmapFinishCorrectLast}
                  normalizedNodes={averageNormalizedNodes}
                />
              </div>

              <div className="pt-4 border-t border-slate-800">
                <h3 className="text-base font-black text-white mb-4">Глобальные карты траекторий линий</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <GlobalLineMap
                    title="Все линии: все пробы"
                    icon={<Activity size={18} />}
                    lines={globalLineMapAll}
                    normalizedNodes={averageNormalizedNodes}
                  />
                  <GlobalLineMap
                    title="Все линии: финалы решений"
                    icon={<Trophy size={18} className="text-emerald-500" />}
                    lines={globalLineMapCorrectLast}
                    normalizedNodes={averageNormalizedNodes}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ================= TAB 4: СВОДНЫЙ ОТЧЕТ & ЭКСПОРТ ================= */}
          {activeTab === 'reports' && (
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6 bg-slate-950 select-none">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* 1. EXPORT ACTIONS CARD */}
                <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 shadow-xl space-y-4">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-2">
                    <Download size={15} className="text-indigo-400" />
                    <span>Выгрузка данных</span>
                  </h3>

                  <div className="space-y-2">
                    {/* EXCEL 2-SHEET EXPORT BUTTON */}
                    <button
                      onClick={handleExportExcel}
                      disabled={subjects.length === 0}
                      className="w-full flex items-center justify-between p-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl font-bold shadow-md shadow-emerald-600/30 transition-all text-xs"
                    >
                      <span className="flex items-center gap-2">
                        <FileSpreadsheet size={16} />
                        <span>Excel (.xlsx: 3 листа)</span>
                      </span>
                      <span className="text-[10px] bg-emerald-700/60 px-2 py-0.5 rounded-lg">Сводный + LMM</span>
                    </button>

                    {/* PROBING LONG FORMAT CSV (FOR LMM/GLMM) */}
                    <button
                      onClick={exportProbingLongCSV}
                      disabled={subjects.length === 0}
                      className="w-full flex items-center justify-between p-3 bg-teal-600 hover:bg-teal-500 disabled:opacity-40 text-white rounded-xl font-bold shadow-md shadow-teal-600/30 transition-all text-xs"
                      title="Попробный лонг-формат для смешанных моделей (LMM / GLMM / Survival / Piecewise) в R, SPSS, JASP, Python"
                    >
                      <span className="flex items-center gap-2">
                        <Activity size={16} />
                        <span>Попробный Long CSV (LMM / GLMM)</span>
                      </span>
                      <span className="text-[10px] bg-teal-700/60 px-2 py-0.5 rounded-lg">R / JASP / LMM</span>
                    </button>

                    {/* DUPLEX FULL CSV */}
                    <button
                      onClick={exportDuplexCSV}
                      disabled={subjects.length === 0}
                      className="w-full flex items-center justify-between p-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl font-bold shadow-md shadow-indigo-600/30 transition-all text-xs"
                    >
                      <span className="flex items-center gap-2">
                        <Layers size={16} />
                        <span>MOGNU Дуплекс (.csv)</span>
                      </span>
                      <ChevronRight size={14} className="opacity-60" />
                    </button>

                    {/* KINEMATICS CSV */}
                    <button
                      onClick={exportKinematicsCSV}
                      disabled={subjects.length === 0}
                      className="w-full flex items-center justify-between p-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-amber-300 rounded-xl font-bold transition-all text-xs border border-slate-700"
                    >
                      <span className="flex items-center gap-2">
                        <Zap size={16} />
                        <span>Кинематика (.csv)</span>
                      </span>
                      <ChevronRight size={14} className="opacity-60" />
                    </button>

                    {/* GEOMETRY CSV */}
                    <button
                      onClick={exportAllDataCSV}
                      disabled={subjects.length === 0}
                      className="w-full flex items-center justify-between p-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-blue-300 rounded-xl font-bold transition-all text-xs border border-slate-700"
                    >
                      <span className="flex items-center gap-2">
                        <Ruler size={16} />
                        <span>Геометрия СИГМА (.csv)</span>
                      </span>
                      <ChevronRight size={14} className="opacity-60" />
                    </button>
                  </div>

                  <div className="pt-3 border-t border-slate-800 space-y-2">
                    <button
                      onClick={exportSession}
                      disabled={subjects.length === 0}
                      className="w-full flex items-center justify-between p-2.5 bg-slate-800/80 hover:bg-slate-800 disabled:opacity-40 text-slate-200 rounded-xl text-xs font-bold transition-all border border-slate-700/60"
                    >
                      <span className="flex items-center gap-2">
                        <Download size={14} className="text-emerald-400" />
                        <span>Сохранить сессию JSON</span>
                      </span>
                    </button>

                    <label className="w-full flex items-center justify-between p-2.5 bg-slate-800/80 hover:bg-slate-800 text-slate-200 rounded-xl text-xs font-bold transition-all border border-slate-700/60 cursor-pointer">
                      <span className="flex items-center gap-2">
                        <Upload size={14} className="text-indigo-400" />
                        <span>Загрузить сессию JSON</span>
                      </span>
                      <input type="file" accept=".json,.csv" onChange={importSession} className="hidden" />
                    </label>
                  </div>
                </div>

                {/* 2. OVERVIEW STATUS CARD */}
                <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 shadow-xl space-y-4">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-2">
                    <Activity size={15} className="text-emerald-400" />
                    <span>Статус датасета</span>
                  </h3>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-500 block uppercase">Испытуемых</span>
                      <span className="text-lg font-black text-white">{subjects.length}</span>
                    </div>
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-500 block uppercase">Решили задачу</span>
                      <span className="text-lg font-black text-amber-400">{solvedCount}</span>
                    </div>
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-500 block uppercase">Всего проб</span>
                      <span className="text-lg font-black text-indigo-400">{processedData.length}</span>
                    </div>
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-500 block uppercase">Исключено проб</span>
                      <span className="text-lg font-black text-rose-400">{excludedTrials.size}</span>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5 text-xs">
                    <div className="flex justify-between text-slate-400 text-[11px]">
                      <span>Доля решивших:</span>
                      <span className="font-bold text-white">
                        {subjects.length > 0 ? `${((solvedCount / subjects.length) * 100).toFixed(1)}%` : '0%'}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-400 text-[11px]">
                      <span>Формат (Онлайн / Очно):</span>
                      <span className="font-bold text-emerald-400">
                        {onlineCount} <span className="text-slate-500 font-normal">/ {subjects.length - onlineCount}</span>
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-400 text-[11px]">
                      <span>Исключенных испытуемых:</span>
                      <span className="font-bold text-rose-400">{excludedSubjects.size}</span>
                    </div>
                  </div>

                  {/* DYNAMIC GROUPS BREAKDOWN CARD */}
                  <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                        <Users size={14} className="text-indigo-400" />
                        <span>Испытуемые по группам</span>
                      </span>
                      <span className="text-[10px] text-slate-500">
                        Групп: <b className="text-white">{groupStats.length}</b>
                      </span>
                    </div>

                    <div className="space-y-1.5 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                      {groupStats.map(([grpName, gStat]) => {
                        const pctOfTotal = subjects.length > 0 ? ((gStat.total / subjects.length) * 100).toFixed(1) : '0';
                        const solvedPct = gStat.total > 0 ? ((gStat.solved / gStat.total) * 100).toFixed(1) : '0';
                        return (
                          <div key={grpName} className="p-2.5 bg-slate-900/80 rounded-lg border border-slate-800 flex items-center justify-between text-xs">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-slate-200">{grpName}</span>
                                <span className="text-[10px] text-slate-500">({pctOfTotal}% выборки)</span>
                              </div>
                              <div className="text-[10px] text-slate-400">
                                Решили: <b className="text-amber-400">{gStat.solved}</b> <span className="text-slate-500">({solvedPct}%)</span>
                                {gStat.excluded > 0 && (
                                  <span className="ml-2 text-rose-400">Искл: {gStat.excluded}</span>
                                )}
                              </div>
                            </div>
                            <div className="text-right">
                              <span className="text-base font-black text-white">{gStat.total}</span>
                              <span className="text-[10px] text-slate-500 block">исп.</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* 3. LOG TERMINAL */}
                <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 shadow-xl flex flex-col">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
                    <FileText size={15} className="text-slate-400" />
                    <span>Системный журнал</span>
                  </h3>
                  <div className="flex-1 bg-slate-950 rounded-xl border border-slate-800 p-3 font-mono text-[10px] text-slate-300 space-y-1 overflow-y-auto max-h-60 custom-scrollbar">
                    {log.length > 0 ? (
                      log.map((l, i) => (
                        <div key={i} className="whitespace-pre-wrap">
                          <span className="text-indigo-400 font-bold">[{i}]</span> {l}
                        </div>
                      ))
                    ) : (
                      <span className="text-slate-600">Журнал пуст. Загрузите файлы для начала работы.</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div className={`fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2.5 text-xs font-bold text-white transition-all transform animate-in fade-in slide-in-from-bottom-3 ${
          toastMessage.type === 'error' ? 'bg-rose-600 shadow-rose-600/30' :
          toastMessage.type === 'info' ? 'bg-indigo-600 shadow-indigo-600/30' :
          'bg-emerald-600 shadow-emerald-600/30'
        }`}>
          {toastMessage.type === 'error' ? <AlertCircle size={15} /> : <CheckSquare size={15} />}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Auto-Preprocessing Configuration & Results Modal */}
      <AutoPreprocessingModal
        isOpen={isPreprocessingModalOpen}
        onClose={() => setIsPreprocessingModalOpen(false)}
        config={preprocessingConfig}
        onChangeConfig={(updates) => setPreprocessingConfig(prev => ({ ...prev, ...updates }))}
        onResetConfig={() => setPreprocessingConfig(DEFAULT_PREPROCESSING_CONFIG)}
        onApply={(cfg) => handleRunPreprocessing(cfg)}
        lastResult={lastPreprocessingResult}
        totalSubjects={subjects.length}
        totalTrials={processedData.length}
      />
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  // @ts-ignore
  const root = (window as any)._reactRoot || createRoot(container);
  // @ts-ignore
  (window as any)._reactRoot = root;
  root.render(<App />);
}
