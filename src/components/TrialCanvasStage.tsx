import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import {
  ProcessedTrial,
  GridNode,
  SubjectData,
  Calibration,
  TargetZoneId,
  ApexTargetConfig,
  AnalysisMode
} from '../types';
import {
  CANVAS_SIZE,
  DOT_RADIUS,
  getTargetZones,
  extractTrialApexOvershoot
} from '../geometry';
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  Ban
} from 'lucide-react';

interface TrialCanvasStageProps {
  activeSubject: SubjectData | null;
  activeNodes: GridNode[];
  activeCellSize: { w: number; h: number };
  trialsToDraw: ProcessedTrial[];
  filteredTrials: ProcessedTrial[];
  selectedTrial: ProcessedTrial | null;
  selectedTrialId: string | number | null;
  hoveredTrialId: string | number | null;
  isCalibrating: boolean;
  animationTick: number;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  autoFit: boolean;
  setAutoFit: React.Dispatch<React.SetStateAction<boolean>>;
  panOffset: { x: number; y: number };
  setPanOffset: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  showHeatmap: boolean;
  showFinishHeatmap: boolean;
  showBreaks: boolean;
  filterStartNode: number | null;
  filterFinishNode: number | null;
  filterTypes: Set<string>;
  filterOverridesOnly: boolean;
  manualOverrides: Set<string>;
  manualZoneOverrides: Record<string, TargetZoneId>;
  onToggleManualZoneOverride: (trialKey: string, zoneId: TargetZoneId, zoneName: string) => void;
  onCalibrationChange: (changes: Partial<Calibration> | ((prev: Calibration) => Partial<Calibration>)) => void;
  getApexConfig: (subId: string) => ApexTargetConfig;
  globalBoxPadding: number;
  excludedTrials: Set<string>;
  activeSubjectId: string | null;
  activeSubjectTrials: ProcessedTrial[];
  analysisMode: AnalysisMode;
}

export const TrialCanvasStage: React.FC<TrialCanvasStageProps> = ({
  activeSubject,
  activeNodes,
  activeCellSize,
  trialsToDraw,
  filteredTrials,
  selectedTrial,
  selectedTrialId,
  hoveredTrialId,
  isCalibrating,
  animationTick,
  zoom,
  setZoom,
  autoFit,
  setAutoFit,
  panOffset,
  setPanOffset,
  showHeatmap,
  showFinishHeatmap,
  showBreaks,
  filterStartNode,
  filterFinishNode,
  filterTypes,
  filterOverridesOnly,
  manualOverrides,
  manualZoneOverrides,
  onToggleManualZoneOverride,
  onCalibrationChange,
  getApexConfig,
  globalBoxPadding,
  excludedTrials,
  activeSubjectId,
  activeSubjectTrials,
  analysisMode
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [isDraggingGrid, setIsDraggingGrid] = useState(false);
  const [dragStartMouse, setDragStartMouse] = useState({ x: 0, y: 0 });
  const [dragStartCalibration, setDragStartCalibration] = useState({ offsetX: 0, offsetY: 0 });

  // Auto-fit scale computation
  const fitScale = useMemo(() => {
    if (!autoFit) return 1;
    const trials = trialsToDraw;
    if (trials.length === 0) return 1;

    let maxDist = 0;
    const center = CANVAS_SIZE / 2;
    trials.forEach(t => {
      t.points.forEach(p => {
        const d = Math.hypot(p.x - center, p.y - center);
        if (d > maxDist) maxDist = d;
      });
    });

    if (maxDist > 360) {
      return Math.max(0.15, +(360 / maxDist).toFixed(3));
    }
    return 1;
  }, [autoFit, trialsToDraw]);

  const currentScale = +(zoom * fitScale).toFixed(3);

  const getCanvasCoords = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const cx = (e.clientX - rect.left) * (CANVAS_SIZE / rect.width);
    const cy = (e.clientY - rect.top) * (CANVAS_SIZE / rect.height);
    const x = (cx - CANVAS_SIZE / 2) / currentScale + CANVAS_SIZE / 2 - panOffset.x;
    const y = (cy - CANVAS_SIZE / 2) / currentScale + CANVAS_SIZE / 2 - panOffset.y;
    return { x, y };
  }, [currentScale, panOffset]);

  const handleMouseDown = (e: React.MouseEvent) => {
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
      const currentApexCfg = getApexConfig(activeSubject.id);
      const step = currentApexCfg ? currentApexCfg.idealOvershoot : (activeCellSize.w || 116);
      const tolRadius = currentApexCfg ? currentApexCfg.toleranceMargin : 65;
      const targetZones = getTargetZones(activeNodes, step, globalBoxPadding);

      const clickedZone = targetZones.find(z => Math.hypot(x - z.x, y - z.y) <= (tolRadius + 10));

      if (clickedZone) {
        const effectiveTrialId = selectedTrialId !== null ? selectedTrialId : activeSubjectTrials[activeSubjectTrials.length - 1]?.trialId;
        if (effectiveTrialId !== undefined) {
          const trialKey = `${activeSubject.id}-${effectiveTrialId}`;
          onToggleManualZoneOverride(trialKey, clickedZone.id, clickedZone.name);
          return;
        }
      }
    }

    setIsPanning(true);
    setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isCalibrating && isDraggingGrid && activeSubject) {
      const { x, y } = getCanvasCoords(e);
      const dx = x - dragStartMouse.x;
      const dy = y - dragStartMouse.y;

      onCalibrationChange({
        offsetX: Math.round(dragStartCalibration.offsetX + dx),
        offsetY: Math.round(dragStartCalibration.offsetY + dy)
      });
      return;
    }

    if (!isPanning) return;
    setPanOffset({
      x: e.clientX - panStart.x,
      y: e.clientY - panStart.y
    });
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setIsDraggingGrid(false);
  };

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
  }, [setAutoFit, setZoom]);

  // Imperative 2D Canvas Drawing Effect
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

    // Heatmaps
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
        const lastLine = t.lines[t.lines.length - 1];
        if (lastLine && lastLine.points.length > 0) {
          const fp = lastLine.points[lastLine.points.length - 1];
          const radius = (activeCellSize.w * 0.6) / viewScale;
          const grad = ctx.createRadialGradient(fp.x, fp.y, 0, fp.x, fp.y, radius);
          grad.addColorStop(0, 'rgba(16, 185, 129, 0.15)');
          grad.addColorStop(1, 'rgba(16, 185, 129, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(fp.x, fp.y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      ctx.globalCompositeOperation = 'source-over';
    }

    // Apex Target Zones & Perceptual Box
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

      const targetZones = getTargetZones(activeNodes, step, boxPad);

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
            ctx.fillStyle = 'rgba(234, 179, 8, 0.25)';
            ctx.fill();
            ctx.strokeStyle = '#eab308';
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

    // Grid Nodes
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

    // Trial paths and line drawing
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
  }, [
    activeNodes,
    activeCellSize,
    filteredTrials,
    currentScale,
    panOffset,
    filterStartNode,
    filterFinishNode,
    filterTypes,
    filterOverridesOnly,
    showBreaks,
    showHeatmap,
    showFinishHeatmap,
    manualOverrides,
    selectedTrialId,
    hoveredTrialId,
    activeSubjectId,
    isCalibrating,
    animationTick,
    selectedTrial,
    trialsToDraw,
    activeSubject,
    analysisMode,
    getApexConfig,
    globalBoxPadding,
    manualZoneOverrides,
    activeSubjectTrials
  ]);

  return (
    <div className="flex-1 flex flex-col relative overflow-hidden bg-slate-900 border-r border-slate-800">
      {/* Zoom / Scaling Control Pill Toolbar */}
      <div className="absolute top-3 right-4 z-20 flex items-center gap-1 bg-slate-900/90 backdrop-blur-md px-2 py-1 rounded-xl border border-slate-700/70 shadow-lg text-xs select-none">
        <button
          onClick={() => { setAutoFit(false); setZoom(z => Math.max(0.3, +(z - 0.15).toFixed(2))); }}
          title="Уменьшить масштаб"
          className="p-1 rounded hover:bg-slate-800 text-slate-300 hover:text-white"
        >
          <ZoomOut size={13} />
        </button>
        <span className="font-mono text-[11px] text-slate-300 px-1 font-bold">
          {Math.round(currentScale * 100)}%
        </span>
        <button
          onClick={() => { setAutoFit(false); setZoom(z => Math.min(4, +(z + 0.15).toFixed(2))); }}
          title="Увеличить масштаб"
          className="p-1 rounded hover:bg-slate-800 text-slate-300 hover:text-white"
        >
          <ZoomIn size={13} />
        </button>
        <div className="w-[1px] h-3 bg-slate-700 mx-1" />
        <button
          onClick={() => { setAutoFit(true); setZoom(1); setPanOffset({ x: 0, y: 0 }); }}
          title="Авто-подгонка под размер холста"
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold ${
            autoFit ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          <Maximize size={11} />
          <span>Авто</span>
        </button>
        <button
          onClick={() => { setAutoFit(false); setZoom(1); setPanOffset({ x: 0, y: 0 }); }}
          title="Сброс масштаба 100%"
          className="px-1.5 py-0.5 rounded text-[11px] font-bold hover:bg-slate-800 text-slate-400 hover:text-white"
        >
          1:1
        </button>
      </div>

      {/* Canvas Viewport */}
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
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />

        {/* Exclusion Watermark Banner */}
        {selectedTrialId !== null && activeSubjectId && excludedTrials.has(`${activeSubjectId}-${selectedTrialId}`) && (
          <div className="absolute top-4 left-4 bg-rose-600 text-white border border-rose-700 px-3 py-1 rounded-xl text-xs font-bold uppercase tracking-wider backdrop-blur-md flex items-center gap-1.5 shadow-lg">
            <Ban size={14} />
            <span>Проба исключена из анализа</span>
          </div>
        )}
      </div>
    </div>
  );
};
