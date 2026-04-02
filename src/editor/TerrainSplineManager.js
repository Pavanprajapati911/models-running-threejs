// src/editor/TerrainSplineManager.js
import * as THREE from 'three';

export class TerrainSplineManager {
  constructor(scene) {
    this.scene = scene;
    this.splines = [];
    this.curves = new Map(); // splineId -> { curve, samples, segments }
    this.dirtyBounds = null;
    this.chunkManager = null;

    /**
     * precisionMode: when TRUE, disables curve-distance influence entirely.
     * Each control point acts as an independent sculpting brush.
     * Enables sub-foot precision editing.
     */
    this.precisionMode = false;

    // Configurable blend weights (used only when precisionMode = false)
    this.curveWeight = 0.6;
    this.pointWeight = 0.4;
  }

  setChunkManager(chunkManager) {
    this.chunkManager = chunkManager;
  }

  markDirty(bounds) {
    if (!bounds) return;
    if (!this.dirtyBounds) {
      this.dirtyBounds = { minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minZ, maxZ: bounds.maxZ };
    } else {
      this.dirtyBounds.minX = Math.min(this.dirtyBounds.minX, bounds.minX);
      this.dirtyBounds.maxX = Math.max(this.dirtyBounds.maxX, bounds.maxX);
      this.dirtyBounds.minZ = Math.min(this.dirtyBounds.minZ, bounds.minZ);
      this.dirtyBounds.maxZ = Math.max(this.dirtyBounds.maxZ, bounds.maxZ);
    }
  }

  flushUpdates() {
    if (!this.dirtyBounds || !this.chunkManager) return;

    // 1. Bake affected heightmap region (Cache update)
    this.bakeToHeightmap(this.dirtyBounds);

    // 2. Regenerate intersecting chunks
    this.chunkManager.updateChunksInBounds(this.dirtyBounds);

    this.dirtyBounds = null;
  }

  /**
   * Compute terrain height contribution from all splines at world position (wx, wz).
   *
   * Two modes:
   *  - precisionMode=false (default): curve-based (60%) + point-based (40%) blend
   *  - precisionMode=true           : ONLY per-point influence, no curve distance used
   *    → enables sub-foot surgical editing, like Unreal's sculpt brush
   */
  getSplineEffect(wx, wz, activeSplines = null) {
    let effect = 0;
    const targetSplines = activeSplines || this.splines;

    for (const spline of targetSplines) {
      // ── Fast AABB reject ────────────────────────────────────────────────────
      if (wx < spline.bounds.minX || wx > spline.bounds.maxX ||
          wz < spline.bounds.minZ || wz > spline.bounds.maxZ) continue;

      let splineContribution = 0;

      // ── A. POINT-BASED INFLUENCE ─────────────────────────────────────────────
      // Each point is an independent circular brush.
      // Uses pow-based falloff — fully predictable, no smoothstep hidden scaling.
      let pointEffect = 0;
      if (spline.points) {
        for (const p of spline.points) {
          const pData = p[2];
          if (!pData || typeof pData !== 'object') continue;

          const dx = wx - p[0];
          const dz = wz - p[1];
          const distSq = dx * dx + dz * dz;
          const r = pData.radius;

          // Early reject with squared distance (no sqrt yet)
          if (distSq >= r * r) continue;

          const dist = Math.sqrt(distSq);
          // t=0 at center, t=1 at edge — power falloff, no implicit scaling
          const t = dist / r;
          const falloffPow = pData.falloff !== undefined ? pData.falloff : (spline.falloff || 2.0);
          const falloffVal = Math.pow(1.0 - t, falloffPow);
          const strength = pData.strength !== undefined ? pData.strength : spline.strength;
          const height = pData.height !== undefined ? pData.height : 0;

          if (spline.type === 'ridge' || spline.type === 'plateau' || spline.type === 'road') {
            pointEffect += falloffVal * (strength + height);
          } else if (spline.type === 'valley') {
            pointEffect -= falloffVal * (strength + height);
          }
          // plateau / road handle via curve path only
        }
      }

      if (this.precisionMode) {
        // ── PRECISION MODE: only point-based influence ──────────────────────
        splineContribution = pointEffect;

      } else {
        // ── HYBRID MODE: blend curve (curveWeight) + point (pointWeight) ───
        const curveData = this.curves.get(spline.id);
        let curveEffect = 0;

        if (curveData) {
          const distToCurve = this._getMinDistanceToCurve(wx, wz, spline.id);

          if (distToCurve < spline.width) {
            // pow() falloff — replaced smoothstep for consistency
            const ct = distToCurve / spline.width;
            const cFalloff = Math.pow(1.0 - ct, spline.falloff || 2.0);
            const noise = this.chunkManager.noise2D(
              wx * (spline.noiseScale || 0.1),
              wz * (spline.noiseScale || 0.1)
            ) * (spline.noiseStrength || 0.15) * cFalloff;

            if (spline.type === 'ridge' || spline.type === 'valley') {
              const peak = spline.peakSharpness !== undefined ? spline.peakSharpness : 2.0;
              const h = Math.pow(1.0 - ct, peak) * spline.strength;
              curveEffect = (spline.type === 'ridge' ? h : -h) + noise;

            } else if (spline.type === 'plateau') {
              const offset = spline.plateauHeightOffset || 0;
              curveEffect = (spline.baseHeight + offset - this.chunkManager.calculateHeight(wx, wz)) * cFalloff;

            } else if (spline.type === 'road') {
              const wf = spline.roadWidthFactor || 0.5;
              const roadWidth = spline.width * wf;
              if (distToCurve < roadWidth) {
                curveEffect = (spline.baseHeight - this.chunkManager.calculateHeight(wx, wz)) * (spline.flattenStrength || 0.9);
              } else {
                const edgeT = (distToCurve - roadWidth) / (spline.width - roadWidth);
                const edgeFalloff = Math.pow(1.0 - edgeT, spline.edgeSmoothness || 1.0);
                curveEffect = (spline.baseHeight - this.chunkManager.calculateHeight(wx, wz)) * edgeFalloff * (spline.flattenStrength || 0.9);
              }
            }
          }
        }

        // For ridge/valley, pointEffect is additive height.
        // For plateau/road, pointEffect acts as a local additive offset to the flattened surface.
        if (spline.type === 'ridge' || spline.type === 'valley') {
          splineContribution = curveEffect * this.curveWeight + pointEffect * this.pointWeight;
        } else {
          // plateau/road: curveEffect provides the base flattening, pointEffect adds local variations
          splineContribution = curveEffect + (pointEffect * this.pointWeight);
        }
      }

      effect += splineContribution;
    }

    return effect;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  //  CORE ANALYTICS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Sample the base terrain (procedural + splines) at a coordinate.
   */

  bakeToHeightmap(bounds = null) {
    if (!this.chunkManager) return;
    const { heightmap, gridWidth, gridDepth, worldSize, resolution } = this.chunkManager;
    const half = worldSize / 2;

    let startX = 0, endX = gridWidth - 1;
    let startZ = 0, endZ = gridDepth - 1;

    if (bounds) {
      startX = Math.max(0, Math.floor((bounds.minX + half) / resolution));
      endX = Math.min(gridWidth - 1, Math.ceil((bounds.maxX + half) / resolution));
      startZ = Math.max(0, Math.floor((bounds.minZ + half) / resolution));
      endZ = Math.min(gridDepth - 1, Math.ceil((bounds.maxZ + half) / resolution));
    }

    // Update the heightmap cache using the analytic pipeline
    for (let z = startZ; z <= endZ; z++) {
      for (let x = startX; x <= endX; x++) {
        const wx = x * resolution - half;
        const wz = z * resolution - half;
        const idx = z * gridWidth + x;
        heightmap[idx] = this.chunkManager.getHeight(wx, wz);
      }
    }
  }

  sampleHeightAtSplineCenter(spline) {
    if (!spline.points || spline.points.length === 0) return 0;
    const midIdx = Math.floor(spline.points.length / 2);
    return this.chunkManager.calculateHeight(spline.points[midIdx][0], spline.points[midIdx][1]);
  }

  computeSplineBounds(spline) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const curveData = this.curves.get(spline.id);

    if (curveData && curveData.samples) {
      for (const p of curveData.samples) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
      }
    } else if (spline.points && spline.points.length > 0) {
      for (const p of spline.points) {
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minZ) minZ = p[1]; if (p[1] > maxZ) maxZ = p[1];
      }
    } else return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };

    // --- PRECISION FIX ---
    // Use the ACTUAL maximum per-point radius (no spline.width floor, no artificial minimum).
    // If ALL points have tiny radii (e.g. 0.1), the AABB is tiny — preventing any vertex
    // outside that tiny circle from ever entering the inner loop.
    let maxRadius = 0;
    if (spline.points) {
      for (const p of spline.points) {
        if (p[2] && typeof p[2] === 'object' && p[2].radius !== undefined) {
          if (p[2].radius > maxRadius) maxRadius = p[2].radius;
        }
      }
    }
    // For hybrid mode, the curve-width region also participates — take the larger.
    if (!this.precisionMode) {
      maxRadius = Math.max(maxRadius, spline.width || 0);
    }

    // 1 world-unit safety buffer (no artificial minimum).
    const padding = maxRadius + 1;
    return { minX: minX - padding, maxX: maxX + padding, minZ: minZ - padding, maxZ: maxZ + padding };
  }

  addSpline(spline) {
    if (!spline.id) spline.id = THREE.MathUtils.generateUUID();
    spline.type = spline.type || 'ridge';
    // width still kept for curve-based fallback, but never forced onto points
    if (spline.width === undefined) spline.width = 10;
    if (spline.strength === undefined) spline.strength = 5;
    if (spline.falloff === undefined) spline.falloff = 2.0;

    // --- Data Migration: Ensure points have the new object structure ---
    if (spline.points) {
      spline.points = spline.points.map(p => {
        // New format already
        if (p[2] && typeof p[2] === 'object') return p;

        // Old [x, z, scale] or [x, z] → convert.
        // Scale was a visual multiplier; map it directly to radius.
        // No hidden multipliers: radius = width * scale (or just width).
        const oldScale = (p[2] !== undefined && typeof p[2] === 'number') ? p[2] : 1.0;
        return [
          p[0],
          p[1],
          {
            radius: spline.width * oldScale, // preserves old intent 1:1
            strength: spline.strength,
            falloff: 2.0,
            height: 0,
            visualSize: 2.0
          }
        ];
      });
    }

    if (spline.noiseStrength === undefined) spline.noiseStrength = 0.15;
    if (spline.noiseScale === undefined) spline.noiseScale = 0.1;
    if (spline.peakSharpness === undefined) spline.peakSharpness = 2.0;
    if (spline.plateauHeightOffset === undefined) spline.plateauHeightOffset = 0;
    if (spline.roadWidthFactor === undefined) spline.roadWidthFactor = 0.5;
    if (spline.edgeSmoothness === undefined) spline.edgeSmoothness = 1.0;
    if (spline.flattenStrength === undefined) spline.flattenStrength = 0.9;

    this._rebuildCurve(spline); // Need curve for bounds padding
    spline.bounds = this.computeSplineBounds(spline);
    spline.baseHeight = this.sampleHeightAtSplineCenter(spline);

    this.splines.push(spline);
    this.markDirty(spline.bounds);
    return spline;
  }

  removeSpline(id) {
    const idx = this.splines.findIndex(s => s.id === id);
    if (idx !== -1) {
      const s = this.splines[idx];
      this.markDirty(s.bounds);
      this.splines.splice(idx, 1);
      this.curves.delete(id);
    }
  }

  updateSpline(id, data) {
    const s = this.splines.find(s => s.id === id);
    if (s) {
      this.markDirty(s.bounds);
      Object.assign(s, data);
      s.bounds = this.computeSplineBounds(s);
      s.baseHeight = this.sampleHeightAtSplineCenter(s);
      this._rebuildCurve(s);
      this.markDirty(s.bounds);
    }
  }

  getSplines() { return this.splines; }

  _rebuildCurve(spline) {
    if (!spline.points || spline.points.length < 2) { this.curves.delete(spline.id); return; }
    const vecs = spline.points.map(p => new THREE.Vector3(p[0], 0, p[1]));
    const curve = new THREE.CatmullRomCurve3(vecs);
    curve.curveType = 'catmullrom';
    const len = curve.getLength();
    const divisions = Math.max(20, Math.floor(len * 1.5));
    const samples = curve.getPoints(divisions);
    const segments = [];
    for (let i = 0; i < samples.length - 1; i++) {
      const p0 = samples[i], p1 = samples[i + 1];
      const t0 = i / divisions, t1 = (i + 1) / divisions;
      segments.push({ p0, p1, t0, t1, minX: Math.min(p0.x, p1.x), maxX: Math.max(p0.x, p1.x), minZ: Math.min(p0.z, p1.z), maxZ: Math.max(p0.z, p1.z) });
    }
    this.curves.set(spline.id, { curve, samples, segments });
    spline.bounds = this.computeSplineBounds(spline);
  }

  _getMinDistanceToCurve(px, pz, splineId) {
    const curveData = this.curves.get(splineId);
    if (!curveData) return Infinity;
    const { curve, segments } = curveData;
    let minDistSq = Infinity, bestSegment = null;
    // Use actual spline width for segment AABB padding — no hardcoded value
    const splineObj = this.splines.find(s => s.id === splineId);
    const padding = splineObj ? (splineObj.width || 0) : 0;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      if (px < s.minX - padding || px > s.maxX + padding || pz < s.minZ - padding || pz > s.maxZ + padding) continue;
      const dx = s.p1.x - s.p0.x, dz = s.p1.z - s.p0.z, l2 = dx * dx + dz * dz;
      let t = 0; if (l2 > 0) { t = ((px - s.p0.x) * dx + (pz - s.p0.z) * dz) / l2; t = Math.max(0, Math.min(1, t)); }
      const projX = s.p0.x + t * dx, projZ = s.p0.z + t * dz, dSq = (px - projX) ** 2 + (pz - projZ) ** 2;
      if (dSq < minDistSq) { minDistSq = dSq; bestSegment = s; }
    }
    if (!bestSegment) return Infinity;
    let low = bestSegment.t0, high = bestSegment.t1;
    const tempPoint = new THREE.Vector3();
    for (let iteration = 0; iteration < 4; iteration++) {
      const mid1 = low + (high - low) * 0.33, mid2 = low + (high - low) * 0.66;
      curve.getPoint(mid1, tempPoint); const d1Sq = (px - tempPoint.x) ** 2 + (pz - tempPoint.z) ** 2;
      curve.getPoint(mid2, tempPoint); const d2Sq = (px - tempPoint.x) ** 2 + (pz - tempPoint.z) ** 2;
      if (d1Sq < d2Sq) { high = mid2; minDistSq = d1Sq; } else { low = mid1; minDistSq = d2Sq; }
    }
    return Math.sqrt(minDistSq);
  }

  clearAll() {
    this.splines = [];
    this.curves.clear();
  }

  exportJSON() {
    return {
      splines: this.splines
    };
  }

  loadJSON(data) {
    if (!data) return;
    this.clearAll();

    const isFullMap = data && data.splines;
    const splineData = isFullMap ? data.splines : (Array.isArray(data) ? data : []);
    splineData.forEach(s => this.addSpline(s));

    if (this.chunkManager) { this.bakeToHeightmap(); this.chunkManager.regenerateFromSplines(); }
  }
}
