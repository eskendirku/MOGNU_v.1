// --- High-Precision Kinematics Module (MATLAB Parity) for M.O.G.N.U. ---
import { Point, TrialKinematics, KinematicPeak, KinematicPause, KinematicSegment, KinematicMetrics } from './types';

/**
 * Computes exact digital 2nd-order Butterworth low-pass filter coefficients
 * via bilinear transform with frequency prewarping.
 * Matches SciPy / MATLAB butter(2, cutoff / srHz, 'low') to 15 decimal places.
 */
export function computeButterworth2(cutoffHz: number, srHz = 1000.0): { b: number[]; a: number[]; zi: number[] } {
  // Wn normalized to Nyquist: cutoffHz / (srHz / 2)
  const Wn = cutoffHz / srHz;
  const K = Math.tan((Math.PI * Wn) / 2.0);
  const K2 = K * K;
  const sqrt2 = Math.SQRT2;
  const norm = 1.0 + sqrt2 * K + K2;

  const b0 = K2 / norm;
  const b1 = 2.0 * b0;
  const b2 = b0;

  const a0 = 1.0;
  const a1 = (2.0 * (K2 - 1.0)) / norm;
  const a2 = (1.0 - sqrt2 * K + K2) / norm;

  // Steady-state initial condition vector for order 2
  const det = 1.0 + a1 + a2;
  const B0 = b1 - a1 * b0;
  const B1 = b2 - a2 * b0;
  const zi0 = (B0 + B1) / det;
  const zi1 = (-a2 * B0 + (1.0 + a1) * B1) / det;

  return {
    b: [b0, b1, b2],
    a: [a0, a1, a2],
    zi: [zi0, zi1]
  };
}

/**
 * Direct Form II Transposed digital filter with initial conditions.
 */
function lfilter(b: number[], a: number[], x: number[], zi: number[]): number[] {
  const n = x.length;
  const y = new Array<number>(n);
  let z0 = zi[0];
  let z1 = zi[1];

  for (let i = 0; i < n; i++) {
    const xi = x[i];
    const yi = b[0] * xi + z0;
    z0 = b[1] * xi - a[1] * yi + z1;
    z1 = b[2] * xi - a[2] * yi;
    y[i] = yi;
  }
  return y;
}

/**
 * Zero-phase digital filtering (forward and reverse) with boundary reflection.
 * Exact equivalent of MATLAB filtfilt and scipy.signal.filtfilt.
 */
export function filtfilt(b: number[], a: number[], zi: number[], x: number[]): number[] {
  const n = x.length;
  if (n < 9) return x.slice();

  const padlen = Math.min(9, n - 1);

  // Boundary reflection padding
  const xExt: number[] = new Array(n + 2 * padlen);

  // Left reflected pad: 2 * x[0] - x[padlen..1]
  for (let i = 0; i < padlen; i++) {
    xExt[i] = 2.0 * x[0] - x[padlen - i];
  }
  // Center
  for (let i = 0; i < n; i++) {
    xExt[padlen + i] = x[i];
  }
  // Right reflected pad: 2 * x[end] - x[end-1..end-padlen]
  const xEnd = x[n - 1];
  for (let i = 0; i < padlen; i++) {
    xExt[padlen + n + i] = 2.0 * xEnd - x[n - 2 - i];
  }

  // Forward pass with scaled zi
  const firstVal = xExt[0];
  const ziFwd = [zi[0] * firstVal, zi[1] * firstVal];
  const yFwd = lfilter(b, a, xExt, ziFwd);

  // Reverse pass with scaled zi
  yFwd.reverse();
  const lastVal = yFwd[0];
  const ziBwd = [zi[0] * lastVal, zi[1] * lastVal];
  const yBwd = lfilter(b, a, yFwd, ziBwd);
  yBwd.reverse();

  // Extract core signal (unpadded)
  return yBwd.slice(padlen, padlen + n);
}

/**
 * Skips the first nSkip samples to eliminate touch onset artifacts.
 * Corresponds to MATLAB fko_SkipN.m
 */
export function skipNPoints(points: Point[], nSkip = 3): Point[] {
  if (points.length <= nSkip) return points.slice();
  return points.slice(nSkip);
}

/**
 * Interpolates trajectory onto uniform 1 ms time grid (1000 Hz).
 * Corresponds to MATLAB fko_Interpolate.m
 */
export function interpolateUniformGrid(points: Point[]): { t: number[]; x: number[]; y: number[] } {
  const n = points.length;
  if (n < 2) {
    return {
      t: points.map(p => p.t ?? 0),
      x: points.map(p => p.x),
      y: points.map(p => p.y)
    };
  }

  const rawT = points.map(p => p.t ?? 0);
  const rawX = points.map(p => p.x);
  const rawY = points.map(p => p.y);

  const tStart = Math.floor(rawT[0]);
  const tEnd = Math.ceil(rawT[rawT.length - 1]);
  const totalMs = Math.max(1, tEnd - tStart);

  const tGrid: number[] = new Array(totalMs + 1);
  const xGrid: number[] = new Array(totalMs + 1);
  const yGrid: number[] = new Array(totalMs + 1);

  let rawIdx = 0;
  for (let i = 0; i <= totalMs; i++) {
    const curT = tStart + i;
    tGrid[i] = curT;

    while (rawIdx < n - 2 && rawT[rawIdx + 1] < curT) {
      rawIdx++;
    }

    const t0 = rawT[rawIdx];
    const t1 = rawT[rawIdx + 1];
    const dt = t1 - t0;

    if (dt <= 0.0001) {
      xGrid[i] = rawX[rawIdx];
      yGrid[i] = rawY[rawIdx];
    } else {
      const alpha = Math.max(0, Math.min(1, (curT - t0) / dt));
      xGrid[i] = rawX[rawIdx] + alpha * (rawX[rawIdx + 1] - rawX[rawIdx]);
      yGrid[i] = rawY[rawIdx] + alpha * (rawY[rawIdx + 1] - rawY[rawIdx]);
    }
  }

  return { t: tGrid, x: xGrid, y: yGrid };
}

/**
 * Computes instantaneous tangential velocity along 2D trajectory.
 * Corresponds to MATLAB mov_TanjV.m
 */
export function computeTangentialVelocity(t: number[], x: number[], y: number[]): number[] {
  const n = t.length;
  if (n < 2) return new Array(n).fill(0);

  const dt = (t[n - 1] - t[0]) / (n - 1);
  const effDt = dt <= 0 ? 1.0 : dt;

  const vt = new Array<number>(n);
  vt[0] = 0;
  for (let i = 1; i < n; i++) {
    const dx = x[i] - x[i - 1];
    const dy = y[i] - y[i - 1];
    vt[i] = Math.hypot(dx, dy) / effDt;
  }
  return vt;
}

/**
 * Finds local extrema indices within window W.
 * Corresponds to MATLAB mov_FindLocalMinMax.m
 */
export function findLocalMinMax(x: number[], W = 1): { minIndices: number[]; maxIndices: number[] } {
  const n = x.length;
  const maxIndices: number[] = [];
  const minIndices: number[] = [];

  for (let k = W; k < n - W; k++) {
    const center = x[k];
    let isMax = true;
    let isMin = true;

    for (let j = k - W; j <= k + W; j++) {
      if (j === k) continue;
      if (x[j] > center) isMax = false;
      if (x[j] < center) isMin = false;
    }

    if (isMax) maxIndices.push(k);
    if (isMin) minIndices.push(k);
  }

  return { minIndices, maxIndices };
}

/**
 * Full Kinematic Pipeline: filters, computes velocity, detects peaks, pauses,
 * and performs segmentation according to MATLAB fko_FindMov.m.
 */
export function analyzeKinematics(
  rawPoints: Point[],
  bbox: { xl: number; xr: number; yu: number; yd: number },
  dpi = 96.0,
  params = { aThr: 30.0, sdRatio: 1.3, muThr: 0.1, lThr: 20.0, nSkip: 3 }
): TrialKinematics {
  const mmPerPx = dpi > 0 ? 25.4 / dpi : 0.264583;

  // 1. Skip onset points
  const skipped = skipNPoints(rawPoints, params.nSkip);

  // 2. Resample to uniform 1 ms grid
  const { t, x: xRaw, y: yRaw } = interpolateUniformGrid(skipped);
  const npnt = t.length;

  if (npnt < 15) {
    const emptyMetrics: KinematicMetrics = {
      durationMs: 0,
      durationS: 0,
      movementTimeMs: 0,
      movementTimeS: 0,
      pauseTimeMs: 0,
      pauseTimeS: 0,
      pauseCount: 0,
      maxPauseMs: 0,
      maxPauseS: 0,
      peakVelocityPxMs: 0,
      peakVelocityMmS: 0,
      avgVelocityPxMs: 0,
      totalPathPx: 0,
      totalPathMm: 0,
      isOutsideBox: false,
      segmentsCount: 0
    };
    return {
      t,
      x: xRaw,
      y: yRaw,
      vt: new Array(npnt).fill(0),
      peaks: [],
      pauses: [],
      segments: [],
      metrics: emptyMetrics
    };
  }

  // 3. Digital Butterworth filters (15 Hz trajectory, 5 Hz velocity)
  const butter15 = computeButterworth2(15.0, 1000.0);
  const butter5 = computeButterworth2(5.0, 1000.0);

  const xFilt = filtfilt(butter15.b, butter15.a, butter15.zi, xRaw);
  const yFilt = filtfilt(butter15.b, butter15.a, butter15.zi, yRaw);

  const xSmo = filtfilt(butter5.b, butter5.a, butter5.zi, xFilt);
  const ySmo = filtfilt(butter5.b, butter5.a, butter5.zi, yFilt);

  // 4. Smoothed tangential velocity
  const vtSmo = computeTangentialVelocity(t, xSmo, ySmo);

  // 5. Local peaks & valleys
  const { maxIndices } = findLocalMinMax(vtSmo, 1);
  const rawPeaks: { dn: number; peak: number; up: number }[] = [];

  for (let k = 0; k < maxIndices.length; k++) {
    const idx = maxIndices[k];

    let iUp = idx;
    while (iUp < npnt - 2 && vtSmo[iUp] >= vtSmo[iUp + 1]) {
      iUp++;
    }

    let iDn = idx;
    while (iDn > 1 && vtSmo[iDn] >= vtSmo[iDn - 1]) {
      iDn--;
    }

    rawPeaks.push({ dn: iDn, peak: idx, up: iUp });
  }

  let vtMaxPeak = 0;
  for (const p of rawPeaks) {
    if (vtSmo[p.peak] > vtMaxPeak) vtMaxPeak = vtSmo[p.peak];
  }

  const thr = params.muThr * vtMaxPeak;
  const peaksOk = rawPeaks.filter(p => vtSmo[p.peak] > thr);
  const nPeaks = peaksOk.length;

  // 6. Movement Segmentation
  const isegB: { k: number; startIdx: number; fi: number }[] = [];
  const isegE: number[] = [];

  if (nPeaks > 0) {
    isegB.push({ k: 0, startIdx: peaksOk[0].dn, fi: 90.0 });

    for (let k = 1; k < nPeaks; k++) {
      const iB = peaksOk[k].dn;
      const iE = peaksOk[k].up;

      const i1B = isegB[isegB.length - 1].startIdx;
      const i1E = iB - 1;

      const i2B = iB;
      const i2E = iE;

      const dx1 = xFilt[i1E] - xFilt[i1B];
      const dy1 = yFilt[i1E] - yFilt[i1B];
      const dx2 = xFilt[i2E] - xFilt[i2B];
      const dy2 = yFilt[i2E] - yFilt[i2B];

      const c12 = dx1 * dx2 + dy1 * dy2;
      const c11 = Math.hypot(dx1, dy1);
      const c22 = Math.hypot(dx2, dy2);

      if (c11 < params.lThr || c22 < params.lThr) continue;

      const cosFi = Math.max(-1.0, Math.min(1.0, c12 / (c11 * c22)));
      let fi = (180.0 * Math.acos(cosFi)) / Math.PI;
      fi = Math.min(fi, 180.0 - fi);

      // Arc length via cumulative velocity
      let sLen = 0;
      for (let m = i1B; m <= i2E; m++) {
        sLen += vtSmo[m];
      }
      const dist = Math.hypot(xFilt[i2E] - xFilt[i1B], yFilt[i2E] - yFilt[i1B]);
      const sdRatio = dist > 0 ? sLen / dist : 0;

      const isNew = fi > params.aThr || sdRatio > params.sdRatio;
      if (isNew) {
        isegB.push({ k, startIdx: i2B, fi });
        let prevEnd = i1E;
        for (let j = peaksOk.length - 1; j >= 0; j--) {
          if (peaksOk[j].up <= i2B) {
            prevEnd = peaksOk[j].up;
            break;
          }
        }
        isegE.push(prevEnd);
      }
    }
    isegE.push(peaksOk[nPeaks - 1].up);
  }

  // 7. Pauses detection via unsmoothed velocity (15 Hz)
  const vtNosmoo = computeTangentialVelocity(t, xFilt, yFilt);
  if (vtNosmoo.length > 1) vtNosmoo[0] = vtNosmoo[1];

  const { maxIndices: maxIndicesNosmoo } = findLocalMinMax(vtNosmoo, 1);
  let vtMaxNosmoo = 0;
  for (const idx of maxIndicesNosmoo) {
    if (vtNosmoo[idx] > vtMaxNosmoo) vtMaxNosmoo = vtNosmoo[idx];
  }
  if (vtMaxNosmoo <= 0) vtMaxNosmoo = Math.max(...vtNosmoo);

  const thrPause = params.muThr * vtMaxNosmoo;
  const pauseIndices: number[] = [];
  for (let i = 0; i < npnt; i++) {
    if (vtNosmoo[i] < thrPause) pauseIndices.push(i);
  }

  const pauses: KinematicPause[] = [];
  if (pauseIndices.length >= 2) {
    let pStart = pauseIndices[0];
    for (let k = 1; k < pauseIndices.length; k++) {
      if (pauseIndices[k] - pauseIndices[k - 1] > 1) {
        const pEnd = pauseIndices[k - 1];
        pauses.push({
          startIdx: pStart,
          endIdx: pEnd,
          tStart: t[pStart],
          tEnd: t[pEnd],
          durationMs: t[pEnd] - t[pStart]
        });
        pStart = pauseIndices[k];
      }
    }
    const pLast = pauseIndices[pauseIndices.length - 1];
    pauses.push({
      startIdx: pStart,
      endIdx: pLast,
      tStart: t[pStart],
      tEnd: t[pLast],
      durationMs: t[pLast] - t[pStart]
    });
  }

  // 8. Segments breakdown & metrics
  const segments: KinematicSegment[] = [];
  let totalPathPx = 0;
  let movementTimeMs = 0;
  let hasOutsideGlobal = false;

  for (let i = 0; i < isegB.length; i++) {
    const sb = isegB[i].startIdx;
    const se = isegE[i];
    if (se >= npnt || sb >= npnt) continue;

    const dur = t[se] - t[sb];
    let lenPx = 0;
    let isOutside = false;

    for (let m = sb + 1; m <= se; m++) {
      lenPx += Math.hypot(xFilt[m] - xFilt[m - 1], yFilt[m] - yFilt[m - 1]);
      if (xFilt[m] < bbox.xl || xFilt[m] > bbox.xr || yFilt[m] < bbox.yu || yFilt[m] > bbox.yd) {
        isOutside = true;
      }
    }

    if (isOutside) hasOutsideGlobal = true;
    totalPathPx += lenPx;
    movementTimeMs += dur;

    let segPeakVel = 0;
    for (let k = sb; k <= se; k++) {
      if (vtNosmoo[k] > segPeakVel) segPeakVel = vtNosmoo[k];
    }
    const segMeanVel = dur > 0 ? (lenPx / dur) * 1000 : 0;

    segments.push({
      startIdx: sb,
      endIdx: se,
      tStart: t[sb],
      tEnd: t[se],
      durationMs: dur,
      lengthPx: Math.round(lenPx * 10) / 10,
      lengthMm: Math.round(lenPx * mmPerPx * 10) / 10,
      angleDeg: Math.round(isegB[i].fi * 10) / 10,
      isOutsideBox: isOutside,
      peakVelocityPxS: Math.round(segPeakVel * 1000 * 10) / 10,
      meanVelocityPxS: Math.round(segMeanVel * 10) / 10
    });
  }

  // Outside box duration calculation
  let outsideBoxTimeMs = 0;
  for (let i = 0; i < npnt; i++) {
    if (xFilt[i] < bbox.xl || xFilt[i] > bbox.xr || yFilt[i] < bbox.yu || yFilt[i] > bbox.yd) {
      outsideBoxTimeMs += 1;
    }
  }

  // Total trial metrics
  const totalDurationMs = t[npnt - 1] - t[0];
  let totalPauseMs = 0;
  let maxPauseMs = 0;

  for (const p of pauses) {
    totalPauseMs += p.durationMs;
    if (p.durationMs > maxPauseMs) maxPauseMs = p.durationMs;
  }

  const peakVelPxMs = Math.max(...vtNosmoo);
  const avgVelPxMs = movementTimeMs > 0 ? totalPathPx / movementTimeMs : 0;

  const peaksResult: KinematicPeak[] = peaksOk.map(p => ({
    dnIdx: p.dn,
    peakIdx: p.peak,
    upIdx: p.up,
    t: t[p.peak],
    v: vtSmo[p.peak]
  }));

  const metrics: KinematicMetrics = {
    durationMs: Math.round(totalDurationMs),
    durationS: Math.round((totalDurationMs / 1000) * 100) / 100,
    movementTimeMs: Math.round(movementTimeMs),
    movementTimeS: Math.round((movementTimeMs / 1000) * 100) / 100,
    movementTimeRatio: totalDurationMs > 0 ? Math.round((movementTimeMs / totalDurationMs) * 100) : 0,
    pauseTimeMs: Math.round(totalPauseMs),
    pauseTimeS: Math.round((totalPauseMs / 1000) * 100) / 100,
    pauseCount: pauses.length,
    maxPauseMs: Math.round(maxPauseMs),
    maxPauseS: Math.round((maxPauseMs / 1000) * 100) / 100,
    peakVelocityPxMs: Math.round(peakVelPxMs * 1000) / 1000,
    peakVelocityMmS: Math.round(peakVelPxMs * mmPerPx * 1000 * 10) / 10,
    peakVelocityPxS: Math.round(peakVelPxMs * 1000 * 10) / 10,
    avgVelocityPxMs: Math.round(avgVelPxMs * 1000) / 1000,
    meanVelocityPxS: Math.round(avgVelPxMs * 1000 * 10) / 10,
    totalPathPx: Math.round(totalPathPx * 10) / 10,
    totalPathMm: Math.round(totalPathPx * mmPerPx * 10) / 10,
    isOutsideBox: hasOutsideGlobal,
    outsideBoxTimeMs: Math.round(outsideBoxTimeMs),
    outsideBoxTimeS: Math.round((outsideBoxTimeMs / 1000) * 100) / 100,
    segmentsCount: segments.length,
    segmentCount: segments.length
  };

  return {
    t,
    x: xFilt,
    y: yFilt,
    vt: vtNosmoo,
    peaks: peaksResult,
    pauses,
    segments,
    metrics
  };
}
