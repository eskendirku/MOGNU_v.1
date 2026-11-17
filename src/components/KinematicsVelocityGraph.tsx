import React, { useRef, useEffect, useState } from 'react';
import { TrialKinematics } from '../types';

interface KinematicsVelocityGraphProps {
  kinematics?: TrialKinematics;
  width?: number;
  height?: number;
}

export const KinematicsVelocityGraph: React.FC<KinematicsVelocityGraphProps> = ({
  kinematics,
  width = 720,
  height = 240
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    y: number;
    timeMs: number;
    velocity: number;
    pauseText?: string;
    segmentText?: string;
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !kinematics || kinematics.t.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const padLeft = 55;
    const padRight = 20;
    const padTop = 25;
    const padBottom = 35;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    const t = kinematics.t;
    const vt = kinematics.vt;
    const n = t.length;

    const tMin = t[0];
    const tMax = t[n - 1] > tMin ? t[n - 1] : tMin + 1;
    let maxV = Math.max(...vt);
    if (maxV <= 0) maxV = 1.0;
    maxV *= 1.15; // 15% headroom

    const getX = (timeVal: number) => padLeft + ((timeVal - tMin) / (tMax - tMin)) * plotW;
    const getY = (vVal: number) => padTop + plotH - (vVal / maxV) * plotH;

    // 1. Grid lines
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = 1;
    const yTicks = 4;
    for (let i = 0; i <= yTicks; i++) {
      const vVal = (maxV / yTicks) * i;
      const yPos = getY(vVal);
      ctx.beginPath();
      ctx.moveTo(padLeft, yPos);
      ctx.lineTo(width - padRight, yPos);
      ctx.stroke();

      // Y tick label
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(vVal.toFixed(2), padLeft - 6, yPos + 3);
    }

    const xTicks = 5;
    for (let i = 0; i <= xTicks; i++) {
      const timeVal = tMin + ((tMax - tMin) / xTicks) * i;
      const xPos = getX(timeVal);
      ctx.beginPath();
      ctx.moveTo(xPos, padTop);
      ctx.lineTo(xPos, padTop + plotH);
      ctx.stroke();

      // X tick label (seconds or ms)
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${(timeVal / 1000).toFixed(1)}s`, xPos, height - padBottom + 16);
    }

    // 2. Draw Pauses (Shaded Soft Yellow Vertical Bands)
    if (kinematics.pauses && kinematics.pauses.length > 0) {
      kinematics.pauses.forEach(p => {
        const x1 = Math.max(padLeft, getX(p.tStart));
        const x2 = Math.min(width - padRight, getX(p.tEnd));
        const bandW = Math.max(2, x2 - x1);

        ctx.fillStyle = 'rgba(254, 240, 138, 0.45)'; // soft yellow
        ctx.fillRect(x1, padTop, bandW, plotH);

        // Top pause label if wide enough
        if (bandW > 35) {
          ctx.fillStyle = '#b45309';
          ctx.font = '9px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`⏸ ${(p.durationMs / 1000).toFixed(1)}s`, x1 + bandW / 2, padTop + 12);
        }
      });
    }

    // 3. Segment Boundary Markers (Green dashed = start, Red dashed = finish)
    if (kinematics.segments && kinematics.segments.length > 0) {
      kinematics.segments.forEach((seg, sIdx) => {
        const xStart = getX(seg.tStart);
        const xEnd = getX(seg.tEnd);

        // Green dashed start line
        ctx.strokeStyle = '#16a34a';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(xStart, padTop + plotH / 2);
        ctx.lineTo(xStart, padTop + plotH);
        ctx.stroke();

        // Red dashed end line
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(xEnd, padTop);
        ctx.lineTo(xEnd, padTop + plotH);
        ctx.stroke();

        ctx.setLineDash([]); // reset dash

        // Segment badge on top
        const midX = (xStart + xEnd) / 2;
        if (xEnd - xStart > 20) {
          ctx.fillStyle = '#475569';
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`Л${sIdx + 1}`, midX, padTop + 10);
        }
      });
    }

    // 4. Main Velocity Curve V(t)
    ctx.strokeStyle = '#0f172a'; // Slate-900
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(getX(t[0]), getY(vt[0]));
    for (let i = 1; i < n; i++) {
      ctx.lineTo(getX(t[i]), getY(vt[i]));
    }
    ctx.stroke();

    // 5. Red Circles on Velocity Peaks
    if (kinematics.peaks && kinematics.peaks.length > 0) {
      kinematics.peaks.forEach(p => {
        const px = getX(p.t);
        const py = getY(p.v);

        ctx.strokeStyle = '#dc2626';
        ctx.fillStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    }

    // 6. Axis labels & Title
    ctx.fillStyle = '#475569';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('⚡ Профиль скорости V(t) [px/ms] (×1000 px/s) и паузы размышления', padLeft, padTop - 8);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Время t (сек)', width - padRight, height - padBottom + 30);
  }, [kinematics, width, height]);

  // Mouse hover listener for interactive tooltip
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !kinematics || kinematics.t.length < 2) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const padLeft = 55;
    const padRight = 20;
    const plotW = width - padLeft - padRight;

    if (mouseX < padLeft || mouseX > width - padRight) {
      setHoverInfo(null);
      return;
    }

    const t = kinematics.t;
    const tMin = t[0];
    const tMax = t[t.length - 1];
    const hoverTime = tMin + ((mouseX - padLeft) / plotW) * (tMax - tMin);

    // Find nearest point
    let nearIdx = 0;
    let minDt = Infinity;
    for (let i = 0; i < t.length; i++) {
      const dt = Math.abs(t[i] - hoverTime);
      if (dt < minDt) {
        minDt = dt;
        nearIdx = i;
      }
    }

    // Check pause
    let pauseText: string | undefined;
    for (const p of kinematics.pauses) {
      if (t[nearIdx] >= p.tStart && t[nearIdx] <= p.tEnd) {
        pauseText = `Пауза размышления: ${(p.durationMs / 1000).toFixed(2)} с`;
        break;
      }
    }

    // Check segment
    let segmentText: string | undefined;
    for (let sIdx = 0; sIdx < kinematics.segments.length; sIdx++) {
      const s = kinematics.segments[sIdx];
      if (t[nearIdx] >= s.tStart && t[nearIdx] <= s.tEnd) {
        segmentText = `Линия #${sIdx + 1} (${(s.durationMs / 1000).toFixed(2)} с, ${s.lengthMm} мм)`;
        break;
      }
    }

    setHoverInfo({
      x: mouseX,
      y: mouseY,
      timeMs: Math.round(t[nearIdx]),
      velocity: kinematics.vt[nearIdx],
      pauseText,
      segmentText
    });
  };

  const handleMouseLeave = () => {
    setHoverInfo(null);
  };

  if (!kinematics || kinematics.t.length < 2) {
    return (
      <div className="w-full h-44 flex items-center justify-center bg-slate-50 border border-dashed border-slate-200 rounded-lg text-slate-400 text-sm">
        Нет кинематических замеров для этой пробы
      </div>
    );
  }

  return (
    <div className="relative w-full overflow-hidden bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="w-full h-auto cursor-crosshair block"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {hoverInfo && (
        <div
          className="pointer-events-none absolute z-20 bg-slate-900/90 text-white text-xs px-2.5 py-1.5 rounded-md shadow-lg backdrop-blur-sm"
          style={{
            left: Math.min(width - 180, Math.max(10, hoverInfo.x + 12)),
            top: Math.max(10, hoverInfo.y - 45)
          }}
        >
          <div className="font-mono text-amber-300 font-semibold">
            t: {(hoverInfo.timeMs / 1000).toFixed(2)} с ({hoverInfo.timeMs} мс)
          </div>
          <div className="text-slate-200">
            Скорость V: <b>{(hoverInfo.velocity * 1000).toFixed(0)} px/s</b> <span className="text-[10px] text-slate-400">({hoverInfo.velocity.toFixed(3)} px/ms)</span>
          </div>
          {hoverInfo.pauseText && (
            <div className="text-amber-400 font-medium mt-0.5">⏸ {hoverInfo.pauseText}</div>
          )}
          {hoverInfo.segmentText && (
            <div className="text-emerald-400 font-medium mt-0.5">✏️ {hoverInfo.segmentText}</div>
          )}
        </div>
      )}
    </div>
  );
};
