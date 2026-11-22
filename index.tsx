import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import './src/index.css';
import { 
  Upload, FileDown, RefreshCcw, FileText, Activity, Map as MapIcon, ChevronRight, BarChart3, 
  AlertCircle, Maximize2, Info, Target, Filter, X, LayoutGrid, Scissors, Zap, Flag, Trash2, 
  RotateCcw, Eye, ChevronLeft, Play, Users, User, Move, Settings2, Settings, Plus, Minus, 
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Timer, Ruler, Hash, Ban, CheckSquare, Square, 
  Flame, FileSpreadsheet, Trophy, Search, ZoomIn, ZoomOut, Maximize, MousePointer2, Download, 
  GraduationCap, Layers, Star, Briefcase, Clock 
} from 'lucide-react';

import {
  Point, LineSegment, ProcessedTrial, GridNode, Calibration, SubjectData, HeatPoint, HeatLine, AnalysisMode, ApexTargetConfig
} from './src/types';
import {
  CANVAS_SIZE, DOT_RADIUS, ANGLE_THRESHOLD_SPLIT, MIN_LINE_LENGTH, LOOKAHEAD_MIN_LENGTH,
  SMOOTHING_WINDOW, smoothPoints, getAngle, calculateDistance, distToSegment, classifyLine,
  performSegmentation, recalculateLineNodes, calibrateTrial, extractTrialApexOvershoot
} from './src/geometry';
import {
  parseNum, detectDelimiter, decodeBuffer, processCSV
} from './src/parser';
import {
  generateFilteredCSV, generateAllDataCSV, generateStatsCSV, generateKinematicsCSV, generateDuplexFullCSV, generateProbingLongCSV, exportExcelWorkbook
} from './src/stats';
import { KinematicsVelocityGraph } from './src/components/KinematicsVelocityGraph';
import { ProbingConvergenceGraph } from './src/components/ProbingConvergenceGraph';


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
          solveOverride: false,
          capMaxError: false
        }),
        ...updates
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
        alignedTrialId: undefined,
        solveOverride: false,
        capMaxError: false
      }
    }));
    showToast('Параметры целевой зоны сброшены к базовым (116 px / ±65 px)', 'info');
  }, []);

  const handleAutoAlignApex = useCallback((subId: string) => {
    const sub = subjects.find(s => s.id === subId);
    if (!sub || !sub.isSolved) {
      showToast('Автокоррекция доступна только для успешных решателей. Сначала отметьте испытуемого как решившего задачу (трофей 🏆)', 'error');
      return;
    }
    const subTrials = processedData.filter(t => t.subjectId === subId && !excludedTrials.has(`${subId}-${t.trialId}`));
    if (subTrials.length === 0) return;

    // Last trial of successful solver is the solution trial
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
      // Find candidate trial with maximum exit
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

    updateApexConfig(subId, {
      idealOvershoot: solutionOvershoot,
      isAutoAligned: true,
      alignedTrialId
    });
    showToast(`Целевая зона выровнена по финальному решению: ${solutionOvershoot} px`, 'success');
  }, [subjects, processedData, excludedTrials, updateApexConfig, globalBoxPadding]);

  const handleBatchAutoAlignAllSolvers = useCallback(() => {
    const solvedSubs = subjects.filter(s => s.isSolved);
    if (solvedSubs.length === 0) {
      showToast('Нет участников со статусом "Решено" (трофей 🏆) для автокоррекции', 'info');
      return;
    }

    const newConfigs: Record<string, ApexTargetConfig> = {};
    let alignedCount = 0;

    solvedSubs.forEach(sub => {
      const subTrials = processedData.filter(t => t.subjectId === sub.id && !excludedTrials.has(`${sub.id}-${t.trialId}`));
      if (subTrials.length === 0) return;

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

      const existingCfg = subjectApexConfigs[sub.id] || sub.apexConfig;
      newConfigs[sub.id] = {
        idealOvershoot: solutionOvershoot,
        toleranceMargin: existingCfg?.toleranceMargin ?? 65.0,
        boxPadding: globalBoxPadding,
        isAutoAligned: true,
        alignedTrialId,
        solveOverride: existingCfg?.solveOverride ?? false,
        capMaxError: existingCfg?.capMaxError ?? false
      };
      alignedCount++;
    });

    setSubjectApexConfigs(prev => ({ ...prev, ...newConfigs }));
    showToast(`⚡ Автокоррекция целевых зон выполнена для всех ${alignedCount} решивших!`, 'success');
    addLog(`Автокоррекция целевых зон выполнена для ${alignedCount} решивших участников.`);
  }, [subjects, processedData, excludedTrials, globalBoxPadding, subjectApexConfigs]);
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
  const [isDraggingGrid, setIsDraggingGrid] = useState(false);
  const [dragStartMouse, setDragStartMouse] = useState({ x: 0, y: 0 });
  const [dragStartCalibration, setDragStartCalibration] = useState({ offsetX: 0, offsetY: 0 });
  const [isHoveringAnyNode, setIsHoveringAnyNode] = useState(false);
  const [animationTick, setAnimationTick] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(null);

  const activeSubject = useMemo(() => subjects.find(s => s.id === activeSubjectId), [subjects, activeSubjectId]);

  const activeSubjectTrials = useMemo(() => {
    if (!activeSubjectId) return [];
    return processedData.filter(t => t.subjectId === activeSubjectId);
  }, [processedData, activeSubjectId]);

  // Wheel zoom with native event listener to strictly prevent page scroll
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1.15 : 0.85;
      setAutoFit(false);
      setZoom(z => Math.max(0.15, Math.min(5, +(z * delta).toFixed(2))));
    };
    canvas.addEventListener('wheel', handleWheelNative, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', handleWheelNative);
    };
  }, [activeTab, activeSubjectId]);
  
  const activeNodes = useMemo(() => {
    if (!activeSubject) return [];
    return activeSubject.nodes;
  }, [activeSubject]);

  const activeCellSize = useMemo(() => {
    if (!activeSubject) return { w: 116, h: 116 };
    return activeSubject.cellSize;
  }, [activeSubject]);

  const addLog = (msg: string) => setLog(prev => [...prev.slice(-10), msg]);

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

  const recalculateNodesVisited = (trials: ProcessedTrial[], nodes: GridNode[], hitPadding: number) => {
    return trials.map(trial => {
      const updatedLines = trial.lines.map(line => {
        const visited: number[] = [];
        for (let i = 0; i < line.points.length - 1; i++) {
          const p1 = line.points[i];
          const p2 = line.points[i + 1];
          nodes.forEach(node => {
            const rx = (node.w / 2) + hitPadding;
            const ry = (node.h / 2) + hitPadding;
            
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
      return { ...trial, lines: updatedLines };
    });
  };

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
    const subTrials = processedData.filter(t => t.subjectId === activeSubject.id);
    if (subTrials.length === 0) return;

    let totalX = 0;
    let totalY = 0;
    let count = 0;

    const trialsToScan = selectedTrial ? [selectedTrial] : subTrials;
    trialsToScan.forEach(t => {
      const pts = t.basePoints || t.points;
      pts.forEach(p => {
        totalX += p.x;
        totalY += p.y;
        count++;
      });
    });

    if (count === 0) return;
    const meanX = totalX / count;
    const meanY = totalY / count;
    const scale = activeSubject.calibration.scale || 1.0;

    const autoOffsetX = Math.round((CANVAS_SIZE / 2 - meanX) * scale);
    const autoOffsetY = Math.round((CANVAS_SIZE / 2 - meanY) * scale);

    handleCalibrationChange({ offsetX: autoOffsetX, offsetY: autoOffsetY });
    addLog(`🎯 Авто-подгонка к 9 точкам: смещение X=${autoOffsetX > 0 ? '+' : ''}${autoOffsetX}px, Y=${autoOffsetY > 0 ? '+' : ''}${autoOffsetY}px`);
  }, [activeSubject, processedData, selectedTrial, handleCalibrationChange]);

  const trialsToDraw = useMemo(() => {
    return selectedTrialId !== null 
      ? (selectedTrial ? [selectedTrial] : [])
      : filteredTrials;
  }, [selectedTrialId, selectedTrial, filteredTrials]);

  const fitScale = useMemo(() => {
    if (!autoFit || trialsToDraw.length === 0) return 1;

    let minX = 250, maxX = 550, minY = 250, maxY = 550;
    trialsToDraw.forEach(t => {
      t.points.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      });
    });

    const maxDistX = Math.max(CANVAS_SIZE / 2 - minX, maxX - CANVAS_SIZE / 2);
    const maxDistY = Math.max(CANVAS_SIZE / 2 - minY, maxY - CANVAS_SIZE / 2);
    const maxDist = Math.max(maxDistX, maxDistY);

    if (maxDist > 360) {
      return Math.max(0.15, +(360 / maxDist).toFixed(3));
    }
    return 1;
  }, [autoFit, trialsToDraw]);

  const currentScale = +(zoom * fitScale).toFixed(3);

  const getCanvasCoords = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const cx = (e.clientX - rect.left) * (CANVAS_SIZE / rect.width);
    const cy = (e.clientY - rect.top) * (CANVAS_SIZE / rect.height);
    const x = (cx - CANVAS_SIZE / 2) / currentScale + CANVAS_SIZE / 2 - panOffset.x;
    const y = (cy - CANVAS_SIZE / 2) / currentScale + CANVAS_SIZE / 2 - panOffset.y;
    return { x, y };
  };

  const handleMainCanvasMouseDown = (e: React.MouseEvent) => {
    if (!activeSubject) return;
    const { x, y } = getCanvasCoords(e);

    if (isCalibrating) {
      setIsDraggingGrid(true);
      setDragStartMouse({ x, y });
      setDragStartCalibration({ 
        offsetX: activeSubject.calibration.offsetX, 
        offsetY: activeSubject.calibration.offsetY 
      });
      return;
    }

    // Check hit-testing on the 8 target zone circles for manual researcher override
    if (activeNodes.length >= 9) {
      const xs = activeNodes.map(n => n.x);
      const ys = activeNodes.map(n => n.y);
      const rawMinX = Math.min(...xs);
      const rawMaxX = Math.max(...xs);
      const rawMinY = Math.min(...ys);
      const rawMaxY = Math.max(...ys);

      const currentApexCfg = getApexConfig(activeSubject.id);
      const step = currentApexCfg ? currentApexCfg.idealOvershoot : (activeCellSize.w || 116);
      const tolRadius = currentApexCfg ? currentApexCfg.toleranceMargin : 65;
      const boxPad = globalBoxPadding;

      const minX = rawMinX - boxPad;
      const maxX = rawMaxX + boxPad;
      const minY = rawMinY - boxPad;
      const maxY = rawMaxY + boxPad;

      const targetZones = [
        { id: 'TR_H' as TargetZoneId, name: 'Справа-сверху (гор.)', x: maxX + step, y: rawMinY },
        { id: 'TR_V' as TargetZoneId, name: 'Сверху-справа (верт.)', x: rawMaxX, y: minY - step },
        { id: 'BR_H' as TargetZoneId, name: 'Справа-снизу (гор.)', x: maxX + step, y: rawMaxY },
        { id: 'BR_V' as TargetZoneId, name: 'Снизу-справа (верт.)', x: rawMaxX, y: maxY + step },
        { id: 'BL_H' as TargetZoneId, name: 'Слева-снизу (гор.)', x: minX - step, y: rawMaxY },
        { id: 'BL_V' as TargetZoneId, name: 'Снизу-слева (верт.)', x: rawMinX, y: maxY + step },
        { id: 'TL_H' as TargetZoneId, name: 'Слева-сверху (гор.)', x: minX - step, y: rawMinY },
        { id: 'TL_V' as TargetZoneId, name: 'Сверху-слева (верт.)', x: rawMinX, y: minY - step }
      ];

      const clickedZone = targetZones.find(z => Math.hypot(x - z.x, y - z.y) <= (tolRadius + 10));

      if (clickedZone) {
        const effectiveTrialId = selectedTrialId !== null ? selectedTrialId : activeSubjectTrials[activeSubjectTrials.length - 1]?.trialId;
        if (effectiveTrialId !== undefined) {
          const trialKey = `${activeSubject.id}-${effectiveTrialId}`;
          const isAlreadyOverridden = manualZoneOverrides[trialKey] === clickedZone.id;

          setManualZoneOverrides(prev => {
            const next = { ...prev };
            if (isAlreadyOverridden) {
              delete next[trialKey];
              showToast(`Сброшен ручной выбор: включено автоопределение для пробы #${effectiveTrialId}`, 'info');
              addLog(`Сброшен ручной выбор зоны для пробы #${effectiveTrialId}.`);
            } else {
              next[trialKey] = clickedZone.id;
              showToast(`🎯 Зона для пробы #${effectiveTrialId} зафиксирована вручную: ${clickedZone.name}`, 'success');
              addLog(`Целевая зона для пробы #${effectiveTrialId} зафиксирована вручную: ${clickedZone.name}.`);
            }
            return next;
          });
          return; // Consumed click as manual zone override, do not start canvas pan
        }
      }
    }

    setIsPanning(true);
    setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
  };

  const handleMainCanvasMouseMove = (e: React.MouseEvent) => {
    if (isCalibrating && isDraggingGrid && activeSubject) {
      const { x, y } = getCanvasCoords(e);
      const dx = x - dragStartMouse.x;
      const dy = y - dragStartMouse.y;

      handleCalibrationChange({
        offsetX: Math.round(dragStartCalibration.offsetX + dx),
        offsetY: Math.round(dragStartCalibration.offsetY + dy)
      });
    } else if (isPanning) {
      setPanOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
    }
  };

  const handleMainCanvasMouseUp = () => {
    setIsDraggingGrid(false);
    setIsPanning(false);
  };

  const handleMainCanvasWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setAutoFit(false);
    const factor = e.deltaY < 0 ? 1.15 : 0.85;
    setZoom(z => Math.max(0.15, Math.min(5, +(z * factor).toFixed(2))));
  };

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

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    // Fill soft light-grey background (gentle on eyes, high contrast)
    ctx.fillStyle = '#eef2f6';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    if (activeNodes.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Загрузите CSV файлы для отображения решения «9 точек»', CANVAS_SIZE / 2, CANVAS_SIZE / 2);
      return;
    }

    ctx.save();
    
    const viewScale = currentScale;
    ctx.translate(CANVAS_SIZE / 2, CANVAS_SIZE / 2);
    ctx.scale(currentScale, currentScale);
    ctx.translate(-CANVAS_SIZE / 2 + panOffset.x, -CANVAS_SIZE / 2 + panOffset.y);

    const pulse = isCalibrating ? Math.sin(animationTick / 300) * 0.5 + 0.5 : 0;

    if (showHeatmap && filteredTrials.length > 0) {
      ctx.globalCompositeOperation = 'multiply';
      filteredTrials.forEach(t => {
        const radius = (activeCellSize.w * 0.6) / viewScale;
        const grad = ctx.createRadialGradient(t.startPoint.x, t.startPoint.y, 0, t.startPoint.x, t.startPoint.y, radius);
        grad.addColorStop(0, 'rgba(239, 68, 68, 0.15)');
        grad.addColorStop(1, 'rgba(239, 68, 68, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(t.startPoint.x, t.startPoint.y, radius, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalCompositeOperation = 'source-over';
    }

    if (showFinishHeatmap && filteredTrials.length > 0) {
      ctx.globalCompositeOperation = 'multiply';
      filteredTrials.forEach(t => {
        const lastPoint = t.points[t.points.length - 1];
        const radius = (activeCellSize.w * 0.6) / viewScale;
        const grad = ctx.createRadialGradient(lastPoint.x, lastPoint.y, 0, lastPoint.x, lastPoint.y, radius);
        grad.addColorStop(0, 'rgba(16, 185, 129, 0.15)');
        grad.addColorStop(1, 'rgba(16, 185, 129, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(lastPoint.x, lastPoint.y, radius, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalCompositeOperation = 'source-over';
    }

    // 8 Canonical 4-corner turn zones (116px step outside 9 dots)
    if (activeNodes.length >= 9) {
      const xs = activeNodes.map(n => n.x);
      const ys = activeNodes.map(n => n.y);
      const rawMinX = Math.min(...xs);
      const rawMaxX = Math.max(...xs);
      const rawMinY = Math.min(...ys);
      const rawMaxY = Math.max(...ys);

      const currentApexCfg = activeSubject ? getApexConfig(activeSubject.id) : null;
      const step = currentApexCfg ? currentApexCfg.idealOvershoot : (activeCellSize.w || 116);
      const tolRadius = currentApexCfg ? currentApexCfg.toleranceMargin : 45;
      const boxPad = globalBoxPadding;

      const minX = rawMinX - boxPad;
      const maxX = rawMaxX + boxPad;
      const minY = rawMinY - boxPad;
      const maxY = rawMaxY + boxPad;

      const targetZones = [
        { id: 'TR_H', name: 'Справа-сверху (гор.)', x: maxX + step, y: rawMinY },
        { id: 'TR_V', name: 'Сверху-справа (верт.)', x: rawMaxX, y: minY - step },
        { id: 'BR_H', name: 'Справа-снизу (гор.)', x: maxX + step, y: rawMaxY },
        { id: 'BR_V', name: 'Снизу-справа (верт.)', x: rawMaxX, y: maxY + step },
        { id: 'BL_H', name: 'Слева-снизу (гор.)', x: minX - step, y: rawMaxY },
        { id: 'BL_V', name: 'Снизу-слева (верт.)', x: rawMinX, y: maxY + step },
        { id: 'TL_H', name: 'Слева-сверху (гор.)', x: minX - step, y: rawMinY },
        { id: 'TL_V', name: 'Сверху-слева (верт.)', x: rawMinX, y: minY - step }
      ];

      // Draw bounding perceptual box
      ctx.save();
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.6)';
      ctx.lineWidth = 2 / viewScale;
      ctx.setLineDash([6 / viewScale, 4 / viewScale]);
      ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);

      // Determine active zone for selected trial (supports manual researcher override)
      const isSolutionTrial = selectedTrial && activeSubject && activeSubject.isSolved && 
        (selectedTrial.trialId === activeSubjectTrials[activeSubjectTrials.length - 1]?.trialId);

      const trialKey = selectedTrial && activeSubject ? `${activeSubject.id}-${selectedTrial.trialId}` : '';
      const manualOverrideZone = trialKey ? manualZoneOverrides[trialKey] : null;

      const apexRes = selectedTrial ? extractTrialApexOvershoot(selectedTrial, activeNodes, {
        idealStep: step,
        tolerance: tolRadius,
        boxPadding: boxPad,
        isSolvedTrial: isSolutionTrial,
        solveOverride: !!currentApexCfg?.solveOverride,
        capMaxError: !!currentApexCfg?.capMaxError,
        overrideZoneId: manualOverrideZone || null
      }) : null;

      const activeZoneId = apexRes && apexRes.hasExit ? apexRes.activeZoneId : null;
      const isManualZone = !!manualOverrideZone;

      // Draw all 8 zones
      targetZones.forEach(z => {
        const isActive = z.id === activeZoneId;
        ctx.beginPath();
        ctx.arc(z.x, z.y, tolRadius / viewScale, 0, Math.PI * 2);

        if (isActive) {
          if (isManualZone) {
            ctx.fillStyle = 'rgba(234, 179, 8, 0.25)'; // Amber highlight for manual override
            ctx.fill();
            ctx.strokeStyle = '#eab308'; // amber-500
            ctx.lineWidth = 3 / viewScale;
            ctx.setLineDash([]);
            ctx.stroke();

            ctx.fillStyle = '#ca8a04';
            ctx.font = `bold ${9 / viewScale}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(`🎯 ВРУЧНУЮ: ${z.name.toUpperCase()} (кликните для сброса)`, z.x, z.y - ((tolRadius + 5) / viewScale));
            if (apexRes) {
              ctx.fillStyle = '#a16207';
              ctx.font = `bold ${8 / viewScale}px monospace`;
              ctx.fillText(`L_вылет: ${apexRes.overshootPx} px (ΔL: ${apexRes.deltaL > 0 ? '+' : ''}${apexRes.deltaL} px)`, z.x, z.y + ((tolRadius + 13) / viewScale));
            }
          } else {
            ctx.fillStyle = 'rgba(16, 185, 129, 0.22)';
            ctx.fill();
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 2.5 / viewScale;
            ctx.setLineDash([]);
            ctx.stroke();

            ctx.fillStyle = '#059669';
            ctx.font = `bold ${9 / viewScale}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(`🎯 ЦЕЛЕВАЯ ЗОНА: ${z.name.toUpperCase()} (${Math.round(step)}px, ±${Math.round(tolRadius)}px)`, z.x, z.y - ((tolRadius + 5) / viewScale));
            if (apexRes) {
              ctx.fillStyle = '#047857';
              ctx.font = `bold ${8 / viewScale}px monospace`;
              ctx.fillText(`L_вылет: ${apexRes.overshootPx} px (ΔL: ${apexRes.deltaL > 0 ? '+' : ''}${apexRes.deltaL} px)`, z.x, z.y + ((tolRadius + 13) / viewScale));
            }
          }

          // Draw guide line from apex turn point to target zone
          if (apexRes && apexRes.turnPoint) {
            ctx.beginPath();
            ctx.moveTo(apexRes.turnPoint.x, apexRes.turnPoint.y);
            ctx.lineTo(z.x, z.y);
            ctx.strokeStyle = isManualZone ? 'rgba(234, 179, 8, 0.7)' : 'rgba(16, 185, 129, 0.6)';
            ctx.lineWidth = 1.5 / viewScale;
            ctx.setLineDash([4 / viewScale, 3 / viewScale]);
            ctx.stroke();
          }
        } else {
          ctx.fillStyle = 'rgba(16, 185, 129, 0.04)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(16, 185, 129, 0.35)';
          ctx.lineWidth = 1 / viewScale;
          ctx.setLineDash([4 / viewScale, 3 / viewScale]);
          ctx.stroke();
        }
      });
      ctx.restore();
    }

    activeNodes.forEach(node => {
      const hitPadding = activeSubject?.calibration.hitPadding || 0;
      const hitW = node.w + hitPadding * 2;
      const hitH = node.h + hitPadding * 2;

      if (isCalibrating) {
        ctx.beginPath();
        ctx.ellipse(node.x, node.y, hitW / 2, hitH / 2, 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(249, 115, 22, ${0.05 + pulse * 0.1})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(249, 115, 22, ${0.3 + pulse * 0.4})`;
        ctx.lineWidth = 2 / viewScale;
        ctx.setLineDash([5 / viewScale, 3 / viewScale]);
        ctx.stroke();
        ctx.setLineDash([]);
        
        const glowRadius = (Math.max(node.w, node.h) / 2 + 4 + pulse * 4) / viewScale;
        const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glowRadius);
        gradient.addColorStop(0, `rgba(249, 115, 22, ${0.8 * pulse})`);
        gradient.addColorStop(1, 'rgba(249, 115, 22, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
        ctx.fill();
      }
      
      const isStartNode = filterStartNode === node.id;
      const isFinishNode = filterFinishNode === node.id;
      
      if (!isCalibrating) {
        ctx.beginPath();
        ctx.ellipse(node.x, node.y, hitW / 2, hitH / 2, 0, 0, Math.PI * 2);
        if (isStartNode) {
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
          ctx.lineWidth = 2 / viewScale;
        } else if (isFinishNode) {
          ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
          ctx.lineWidth = 2 / viewScale;
        } else {
          ctx.strokeStyle = 'rgba(203, 213, 225, 0.15)';
          ctx.lineWidth = 1 / viewScale;
        }
        ctx.stroke();
      }
      
      ctx.beginPath();
      const nodeW = (node.w || DOT_RADIUS * 2) / viewScale;
      const nodeH = (node.h || DOT_RADIUS * 2) / viewScale;
      ctx.ellipse(node.x, node.y, nodeW / 2, nodeH / 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = isCalibrating ? '#f97316' : '#0f172a';
      ctx.shadowBlur = isCalibrating ? 15 * pulse : 0;
      ctx.shadowColor = '#f97316';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = isCalibrating ? '#ea580c' : '#334155';
      ctx.lineWidth = 1.5 / viewScale;
      ctx.stroke();
      
      if (isCalibrating) {
        ctx.fillStyle = 'white';
        ctx.font = `bold ${8 / viewScale}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.id.toString(), node.x, node.y);
      }
    });

    // Draw 9-dots bounding box in Kinematics or Duplex mode
    if ((analysisMode === 'kinematics' || analysisMode === 'duplex') && activeNodes.length >= 9) {
      const xs = activeNodes.map(n => n.x);
      const ys = activeNodes.map(n => n.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      
      ctx.save();
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
      ctx.lineWidth = 1.5 / viewScale;
      ctx.setLineDash([6 / viewScale, 4 / viewScale]);
      ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
      
      ctx.fillStyle = 'rgba(245, 158, 11, 0.75)';
      ctx.font = `bold ${8 / viewScale}px sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText('РАМКА 9 ТОЧЕК', maxX, minY - (4 / viewScale));
      ctx.restore();
    }

    const trialsToDraw = selectedTrialId !== null 
      ? (selectedTrial ? [selectedTrial] : [])
      : filteredTrials;

    trialsToDraw.forEach(trial => {
      const isSelected = selectedTrialId === trial.trialId;
      const isHovered = hoveredTrialId === trial.trialId;
      const overrideKey = `${trial.subjectId}-${trial.trialId}`;
      const isOverridden = manualOverrides.has(overrideKey);
      
      trial.lines.forEach((line, lIdx) => {
        const type = isOverridden ? 'прочая' : line.type;
        const isTargetType = filterTypes.size === 0 || filterTypes.has(type);
        
        ctx.beginPath();
        ctx.moveTo(line.points[0].x, line.points[0].y);
        line.points.forEach(p => ctx.lineTo(p.x, p.y));
        
        if (isHovered && !isSelected) {
            ctx.shadowBlur = 10 / viewScale;
            ctx.shadowColor = 'rgba(59, 130, 246, 0.8)';
            ctx.lineWidth = 6 / viewScale;
            ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        ctx.lineWidth = (isSelected ? 5 : (isTargetType ? 3 : 0.5)) / viewScale;
        ctx.strokeStyle = isSelected 
          ? 'rgba(37, 99, 235, 1)' 
          : (isTargetType ? (isOverridden ? 'rgba(148, 163, 184, 0.6)' : 'rgba(59, 130, 246, 0.6)') : 'rgba(203, 213, 225, 0.2)');
        
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();

        if (isSelected && line.points.length > 5) {
          const midIdx = Math.floor(line.points.length / 2);
          const p1 = line.points[midIdx - 2];
          const p2 = line.points[midIdx + 2];
          if (p1 && p2) {
            const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
            ctx.beginPath();
            ctx.save();
            ctx.translate(p2.x, p2.y);
            ctx.rotate(angle);
            ctx.moveTo(0, 0);
            ctx.lineTo(-10 / viewScale, -5 / viewScale);
            ctx.lineTo(-10 / viewScale, 5 / viewScale);
            ctx.closePath();
            ctx.fillStyle = 'rgba(37, 99, 235, 1)';
            ctx.fill();
            ctx.restore();
          }
        }
      });

      if (showBreaks || isSelected || isHovered) {
        trial.breakPoints.forEach(bp => {
          ctx.beginPath();
          ctx.arc(bp.x, bp.y, (isSelected || isHovered ? 4 : 3) / viewScale, 0, Math.PI * 2);
          ctx.fillStyle = isOverridden ? 'rgba(148, 163, 184, 0.5)' : '#fbbf24';
          ctx.fill();
        });
      }

      ctx.beginPath();
      ctx.arc(trial.startPoint.x, trial.startPoint.y, (isSelected || isHovered ? 6 : 4) / viewScale, 0, Math.PI * 2);
      ctx.fillStyle = isOverridden ? 'rgba(148, 163, 184, 0.4)' : 'rgba(239, 68, 68, 0.7)';
      ctx.fill();

      if (isSelected) {
        trial.lines.forEach((line, lIdx) => {
          if (line.nodesVisited.length > 0) {
            const lastNodeId = line.nodesVisited[line.nodesVisited.length - 1];
            const lastNode = activeNodes.find(n => n.id === lastNodeId);
            if (lastNode) {
              ctx.shadowBlur = 4 / viewScale;
              ctx.shadowColor = 'white';
              ctx.fillStyle = '#2563eb';
              ctx.font = `bold ${14 / viewScale}px sans-serif`;
              ctx.textAlign = 'center';
              const nodeY = lastNode.y as number;
              ctx.fillText(String(lIdx + 1), lastNode.x, nodeY + (20 / viewScale));
              ctx.shadowBlur = 0;
            }
          }
        });
      }
    });

    ctx.restore();
  }, [activeNodes, activeCellSize, filteredTrials, currentScale, panOffset, filterStartNode, filterFinishNode, filterTypes, filterOverridesOnly, showBreaks, showHeatmap, showFinishHeatmap, manualOverrides, selectedTrialId, hoveredTrialId, processedData, activeSubjectId, isCalibrating, animationTick, selectedTrial]);

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

        const isAtNode = (p: Point) => subNodes.some(node => {
          const rx = (node.w / 2) + hitPadding;
          const ry = (node.h / 2) + hitPadding;
          const dx = (p.x - node.x) / rx;
          const dy = (p.y - node.y) / ry;
          return (dx * dx + dy * dy) <= 1.0;
        });

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
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `filtered_export_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  const exportAllDataCSV = () => {
    if (processedData.length === 0) return;
    const csvContent = generateAllDataCSV(subjects, processedData, manualOverrides, subjectGroups);
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `MOGNU_geometry_SIGMA_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    addLog("Экспортированы геометрические данные (SIGMA).");
  };

  const exportStatsCSV = () => {
    const csvContent = generateStatsCSV(subjects, processedData, manualOverrides, excludedLines, subjectGroups, excludedSubjects, excludedTrials, subjectApexConfigs, globalBoxPadding, manualZoneOverrides);
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `summary_statistics_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
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
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `probing_lmm_long_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    addLog("Экспортирована попробная динамика (Long Format для LMM / GLMM / Survival).");
    showToast("Попробный Long CSV успешно выгружен!", "success");
  };

  const exportSession = () => {
    if (subjects.length === 0) {
      showToast('Нет данных для сохранения в сессию', 'error');
      return;
    }
    try {
      // Clean large 1ms high-frequency interpolation arrays from kinematics
      // to keep session JSON lightweight (< 2MB) and prevent browser string allocation overflow
      const cleanProcessedData = processedData.map(t => {
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

      const sessionData = {
        subjects,
        processedData: cleanProcessedData,
        manualOverrides: Array.from(manualOverrides),
        excludedLines: Array.from(excludedLines),
        excludedSubjects: Array.from(excludedSubjects),
        excludedTrials: Array.from(excludedTrials),
        activeSubjectId,
        analysisMode,
        subjectGroups,
        angleThreshold,
        minLineLength,
        usePhasedMode,
        subjectApexConfigs,
        globalBoxPadding,
        manualZoneOverrides
      };

      const jsonStr = JSON.stringify(sessionData);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `session_backup_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
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
      // Try parsing as JSON first (Session Backup)
      if (file.name.toLowerCase().endsWith('.json')) {
        const data = JSON.parse(text);
        const importedSubjects: SubjectData[] = data.subjects || [];
        const importedAngle = data.angleThreshold || ANGLE_THRESHOLD_SPLIT;
        const importedMinLen = data.minLineLength || MIN_LINE_LENGTH;

        if (data.subjects) setSubjects(importedSubjects);

        if (data.processedData) {
          // Rehydrate trials with calibration and high-resolution kinematics
          const rehydrated = (data.processedData as ProcessedTrial[]).map(t => {
            const sub = importedSubjects.find(s => s.id === t.subjectId);
            if (!sub) return t;
            return calibrateTrial(t, sub.calibration, sub.nodes, importedAngle, importedMinLen);
          });
          setProcessedData(rehydrated);
        }

        if (data.manualOverrides) setManualOverrides(new Set(data.manualOverrides));
        if (data.excludedLines) setExcludedLines(new Set(data.excludedLines));
        if (data.subjectGroups) setSubjectGroups(data.subjectGroups);
        if (data.angleThreshold) setAngleThreshold(importedAngle);
        if (data.minLineLength) setMinLineLength(importedMinLen);
        if (data.usePhasedMode !== undefined) setUsePhasedMode(data.usePhasedMode);
        if (data.excludedSubjects) setExcludedSubjects(new Set(data.excludedSubjects));
        if (data.excludedTrials) setExcludedTrials(new Set(data.excludedTrials));
        if (data.activeSubjectId) setActiveSubjectId(data.activeSubjectId);
        if (data.analysisMode) setAnalysisMode(data.analysisMode);
        if (data.subjectApexConfigs) setSubjectApexConfigs(data.subjectApexConfigs);
        if (data.globalBoxPadding !== undefined) setGlobalBoxPadding(data.globalBoxPadding);
        if (data.manualZoneOverrides) setManualZoneOverrides(data.manualZoneOverrides);
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
      (s.group && s.group.toLowerCase().includes(q))
    );
  }, [subjects, subjectSearch, subjectGroups, selectedGroupFilter, solverFilter]);

  const solvedCount = useMemo(() => {
    return subjects.filter(s => s.isSolved).length;
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
                title="Автоматически центрировать координаты рисунка относительно 9 точек"
              >
                <Target size={13} /> <span className="hidden md:inline">Авто-подгонка к 9 точкам</span>
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

                  {/* Canvas View Controls (Zoom, Reset, 1:1) */}
                  <div className="flex items-center gap-1 text-xs text-slate-400">
                    <button
                      onClick={() => { setAutoFit(false); setZoom(z => Math.max(0.15, +(z * 0.85).toFixed(2))); }}
                      title="Уменьшить масштаб (-)"
                      className="p-1 hover:bg-slate-800 text-slate-400 hover:text-white rounded"
                    >
                      <ZoomOut size={14} />
                    </button>
                    <span className="text-[11px] font-mono font-bold text-slate-300 px-1 min-w-[36px] text-center select-none">
                      {Math.round(currentScale * 100)}%
                    </span>
                    <button
                      onClick={() => { setAutoFit(false); setZoom(z => Math.min(5, +(z * 1.15).toFixed(2))); }}
                      title="Увеличить масштаб (+)"
                      className="p-1 hover:bg-slate-800 text-slate-400 hover:text-white rounded"
                    >
                      <ZoomIn size={14} />
                    </button>
                    <div className="h-3 w-px bg-slate-700 mx-1" />
                    <button
                      onClick={() => { setAutoFit(true); setZoom(1); setPanOffset({ x: 0, y: 0 }); }}
                      title="Вписать пробу в холст"
                      className={`px-1.5 py-0.5 rounded text-[11px] font-bold transition-colors ${
                        autoFit ? 'bg-indigo-600/30 text-indigo-300' : 'hover:bg-slate-800 text-slate-400'
                      }`}
                    >
                      Авто
                    </button>
                    <button
                      onClick={() => { setAutoFit(false); setZoom(1); setPanOffset({ x: 0, y: 0 }); }}
                      title="Сброс масштаба 100%"
                      className="px-1.5 py-0.5 rounded text-[11px] font-bold hover:bg-slate-800 text-slate-400 hover:text-white"
                    >
                      1:1
                    </button>
                  </div>
                </div>

                {/* Canvas Container */}
                <div
                  className="flex-1 relative flex items-center justify-center bg-[#eef2f6] overflow-hidden cursor-crosshair min-h-[300px]"
                  id="canvasContainer"
                >
                  <canvas
                    ref={canvasRef}
                    width={CANVAS_SIZE}
                    height={CANVAS_SIZE}
                    className={`w-full h-full object-contain bg-[#eef2f6] ${
                      isCalibrating
                        ? (isDraggingGrid ? 'cursor-grabbing' : 'cursor-grab')
                        : (isPanning ? 'cursor-grabbing' : (currentScale > 1 || !autoFit ? 'cursor-grab' : 'cursor-default'))
                    }`}
                    onMouseDown={handleMainCanvasMouseDown}
                    onMouseMove={handleMainCanvasMouseMove}
                    onMouseUp={handleMainCanvasMouseUp}
                    onMouseLeave={handleMainCanvasMouseUp}
                  />

                  {/* Watermark if current trial is excluded */}
                  {selectedTrialId !== null && activeSubjectId && excludedTrials.has(`${activeSubjectId}-${selectedTrialId}`) && (
                    <div className="absolute top-4 left-4 bg-rose-600 text-white border border-rose-700 px-3 py-1 rounded-xl text-xs font-bold uppercase tracking-wider backdrop-blur-md flex items-center gap-1.5 shadow-lg">
                      <Ban size={14} />
                      <span>Проба исключена из анализа</span>
                    </div>
                  )}
                </div>

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
