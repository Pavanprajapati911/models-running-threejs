// src/editor/TerrainSplineManager.js
import * as THREE from 'three';

export class TerrainSplineManager {
  constructor(scene) {
    this.scene = scene;
    this.splines = [];
    this.curves = new Map();
    this.dirtyBounds = null;
    this.chunkManager = null;
    this.precisionMode = false;
    this.curveWeight = 0.6;
    this.pointWeight = 0.4;

    // ── Spline Height Cache ─────────────────────────────────────────────────
    // Stores ONLY spline height contributions (not procedural noise).
    // Chunk vertex generation reads from here via bilinear lookup → no per-vertex spline math.
    this.splineHeightCache = null;
    this.cacheWorldSize = 1024;
    this.cacheResolution = 1.0;
    this.cacheWidth = 0;
    this.cacheDepth = 0;

    // ── Web Worker ──────────────────────────────────────────────────────────
    this._worker = null;
    this._workerReady = false;
    this._currentJobId = 0;
    this._pendingBounds = null; // coalesced dirty region waiting for current worker job
    this._workerBusy = false;
    this._initWorker();
  }

  _initWorker() {
    try {
      this._worker = new Worker(
        new URL('../workers/terrainWorker.js', import.meta.url),
        { type: 'module' }
      );
      this._worker.onmessage = (e) => this._onWorkerResponse(e);
      this._worker.onerror = (err) => {
        console.warn('[TerrainSplineManager] Worker error, falling back to sync mode:', err.message);
        this._workerReady = false;
      };
      this._workerReady = true;
    } catch (e) {
      console.warn('[TerrainSplineManager] Web Worker unavailable, using synchronous fallback.');
      this._workerReady = false;
    }
  }

  _onWorkerResponse({ data }) {
    const { values, indices, dirtyBounds, jobId } = data;
    this._workerBusy = false;

    // Discard results from old/superseded jobs
    if (jobId < this._currentJobId) {
      // But still dispatch any pending bounds that accumulated
      if (this._pendingBounds) this._dispatchToWorker(this._pendingBounds);
      return;
    }

    // Apply patch to splineHeightCache
    for (let i = 0; i < indices.length; i++) {
      this.splineHeightCache[indices[i]] = values[i];
    }

    // Rebuild only the affected chunks
    if (this.chunkManager) {
      this.chunkManager.isEditing = false;
      this.chunkManager.updateChunksInBounds(dirtyBounds);
    }

    // If more dirty regions accumulated while worker was busy, dispatch them now
    if (this._pendingBounds) {
      const b = this._pendingBounds;
      this._pendingBounds = null;
      this._dispatchToWorker(b);
    }
  }

  setChunkManager(chunkManager) {
    this.chunkManager = chunkManager;
    this.cacheWorldSize = chunkManager.worldSize;
    this.cacheResolution = chunkManager.resolution;
    this.cacheWidth = chunkManager.gridWidth;
    this.cacheDepth = chunkManager.gridDepth;
    this.splineHeightCache = new Float32Array(this.cacheWidth * this.cacheDepth);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Fast O(1) bilinear sample from the baked spline cache.
   * Chunk vertex generation calls this instead of the expensive getSplineEffect().
   */
  getCachedSplineHeight(wx, wz) {
    // Fallback if cache not yet initialized (e.g. during prefillHeightmap before setChunkManager)
    if (!this.splineHeightCache) return this.getSplineEffect(wx, wz);

    const half = this.cacheWorldSize / 2;
    const cx = (wx + half) / this.cacheResolution;
    const cz = (wz + half) / this.cacheResolution;

    if (cx < 0 || cx >= this.cacheWidth - 1 || cz < 0 || cz >= this.cacheDepth - 1) {
      return this.getSplineEffect(wx, wz);
    }

    const x0 = cx | 0, z0 = cz | 0;
    const fx = cx - x0, fz = cz - z0;
    const w = this.cacheWidth;

    return (
      this.splineHeightCache[ z0      * w + x0    ] * (1 - fx) * (1 - fz) +
      this.splineHeightCache[ z0      * w + x0 + 1] *      fx  * (1 - fz) +
      this.splineHeightCache[(z0 + 1) * w + x0    ] * (1 - fx) *      fz  +
      this.splineHeightCache[(z0 + 1) * w + x0 + 1] *      fx  *      fz
    );
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
    const bounds = { ...this.dirtyBounds };
    this.dirtyBounds = null;

    if (this._workerReady && this.splineHeightCache && this.chunkManager.envParams) {
      if (this._workerBusy) {
        // Coalesce: expand the pending region instead of sending a second message
        if (!this._pendingBounds) {
          this._pendingBounds = bounds;
        } else {
          this._pendingBounds.minX = Math.min(this._pendingBounds.minX, bounds.minX);
          this._pendingBounds.maxX = Math.max(this._pendingBounds.maxX, bounds.maxX);
          this._pendingBounds.minZ = Math.min(this._pendingBounds.minZ, bounds.minZ);
          this._pendingBounds.maxZ = Math.max(this._pendingBounds.maxZ, bounds.maxZ);
        }
      } else {
        this._dispatchToWorker(bounds);
      }
    } else {
      // Synchronous fallback (initial load or worker unavailable)
      this._bakeSynchronous(bounds);
      this.chunkManager.updateChunksInBounds(bounds);
    }
  }

  // ── Private: Worker Dispatch ──────────────────────────────────────────────

  _dispatchToWorker(bounds) {
    this._workerBusy = true;
    this._currentJobId++;

    // Serialize curve segments as plain objects (no Three.js types — not transferable)
    const serializedSplines = this.splines.map(sp => {
      const curveData = this.curves.get(sp.id);
      const segs = [];
      if (curveData && curveData.segments) {
        for (const s of curveData.segments) {
          segs.push({ p0x: s.p0.x, p0z: s.p0.z, p1x: s.p1.x, p1z: s.p1.z,
                      minX: s.minX, maxX: s.maxX, minZ: s.minZ, maxZ: s.maxZ });
        }
      }
      return {
        id: sp.id, type: sp.type, width: sp.width, strength: sp.strength,
        falloff: sp.falloff, peakSharpness: sp.peakSharpness,
        plateauHeightOffset: sp.plateauHeightOffset, roadWidthFactor: sp.roadWidthFactor,
        edgeSmoothness: sp.edgeSmoothness, flattenStrength: sp.flattenStrength,
        baseHeight: sp.baseHeight, bounds: sp.bounds,
        points: sp.points, segments: segs
      };
    });

    this._worker.postMessage({
      splines: serializedSplines,
      dirtyBounds: bounds,
      cacheWorldSize: this.cacheWorldSize,
      cacheResolution: this.cacheResolution,
      cacheWidth: this.cacheWidth,
      cacheDepth: this.cacheDepth,
      precisionMode: this.precisionMode,
      curveWeight: this.curveWeight,
      pointWeight: this.pointWeight,
      seed: this.chunkManager.envParams.random.seed,
      envParams: this.chunkManager.envParams,
      jobId: this._currentJobId
    });
  }

  /** Synchronous bake — used for initial load and as worker fallback. */
  _bakeSynchronous(bounds) {
    if (!this.splineHeightCache || !this.chunkManager) return;
    const half = this.cacheWorldSize / 2;
    const startX = Math.max(0, Math.floor((bounds.minX + half) / this.cacheResolution));
    const endX   = Math.min(this.cacheWidth - 1,  Math.ceil((bounds.maxX + half) / this.cacheResolution));
    const startZ = Math.max(0, Math.floor((bounds.minZ + half) / this.cacheResolution));
    const endZ   = Math.min(this.cacheDepth - 1,  Math.ceil((bounds.maxZ + half) / this.cacheResolution));

    for (let z = startZ; z <= endZ; z++) {
      for (let x = startX; x <= endX; x++) {
        this.splineHeightCache[z * this.cacheWidth + x] =
          this.getSplineEffect(x * this.cacheResolution - half, z * this.cacheResolution - half);
      }
    }
  }

  // ── Spline Effect (analytic — kept for sync fallback / outside-cache positions) ──

  getSplineEffect(wx, wz, activeSplines = null) {
    let effect = 0;
    const targetSplines = activeSplines || this.splines;

    for (const spline of targetSplines) {
      if (wx < spline.bounds.minX || wx > spline.bounds.maxX ||
          wz < spline.bounds.minZ || wz > spline.bounds.maxZ) continue;

      let pointEffect = 0;
      if (spline.points) {
        for (const p of spline.points) {
          const pData = p[2];
          if (!pData || typeof pData !== 'object') continue;
          const dx = wx - p[0], dz = wz - p[1];
          const distSq = dx * dx + dz * dz;
          const r = pData.radius;
          if (distSq >= r * r) continue;
          const t = Math.sqrt(distSq) / r;
          const falloffPow = pData.falloff !== undefined ? pData.falloff : (spline.falloff || 2.0);
          const falloffVal = Math.pow(Math.max(0, 1.0 - t), falloffPow);
          const strength = pData.strength !== undefined ? pData.strength : spline.strength;
          const height = pData.height !== undefined ? pData.height : 0;
          if (spline.type === 'ridge' || spline.type === 'plateau' || spline.type === 'road')
            pointEffect += falloffVal * (strength + height);
          else if (spline.type === 'valley')
            pointEffect -= falloffVal * (strength + height);
        }
      }

      let splineContribution = 0;
      if (this.precisionMode) {
        splineContribution = pointEffect;
      } else {
        const curveData = this.curves.get(spline.id);
        let curveEffect = 0;
        if (curveData) {
          const distToCurve = this._getMinDistanceToCurve(wx, wz, spline.id);
          if (distToCurve < spline.width) {
            const ct = distToCurve / spline.width;
            const cFalloff = Math.pow(1.0 - ct, spline.falloff || 2.0);
            const noise = this.chunkManager
              ? this.chunkManager.noise2D(wx * (spline.noiseScale || 0.1), wz * (spline.noiseScale || 0.1))
                  * (spline.noiseStrength || 0.15) * cFalloff
              : 0;
            if (spline.type === 'ridge' || spline.type === 'valley') {
              const h = Math.pow(1.0 - ct, spline.peakSharpness !== undefined ? spline.peakSharpness : 2.0) * spline.strength;
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
                curveEffect = (spline.baseHeight - this.chunkManager.calculateHeight(wx, wz))
                  * Math.pow(1.0 - edgeT, spline.edgeSmoothness || 1.0) * (spline.flattenStrength || 0.9);
              }
            }
          }
        }
        splineContribution = (spline.type === 'ridge' || spline.type === 'valley')
          ? curveEffect * this.curveWeight + pointEffect * this.pointWeight
          : curveEffect + pointEffect * this.pointWeight;
      }
      effect += splineContribution;
    }
    return effect;
  }

  // ── Core Spline Management ────────────────────────────────────────────────

  bakeToHeightmap(bounds = null) {
    if (!this.chunkManager) return;
    const { heightmap, gridWidth, gridDepth, worldSize, resolution } = this.chunkManager;
    const half = worldSize / 2;
    let startX = 0, endX = gridWidth - 1, startZ = 0, endZ = gridDepth - 1;
    if (bounds) {
      startX = Math.max(0, Math.floor((bounds.minX + half) / resolution));
      endX   = Math.min(gridWidth - 1, Math.ceil((bounds.maxX + half) / resolution));
      startZ = Math.max(0, Math.floor((bounds.minZ + half) / resolution));
      endZ   = Math.min(gridDepth - 1, Math.ceil((bounds.maxZ + half) / resolution));
    }
    for (let z = startZ; z <= endZ; z++) {
      for (let x = startX; x <= endX; x++) {
        const wx = x * resolution - half, wz = z * resolution - half;
        const idx = z * gridWidth + x;
        heightmap[idx] = this.chunkManager.getHeight(wx, wz);
      }
    }
  }

  sampleHeightAtSplineCenter(spline) {
    if (!spline.points || spline.points.length === 0) return 0;
    const midIdx = Math.floor(spline.points.length / 2);
    return this.chunkManager ? this.chunkManager.calculateHeight(spline.points[midIdx][0], spline.points[midIdx][1]) : 0;
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

    let maxRadius = 0;
    if (spline.points) {
      for (const p of spline.points) {
        if (p[2] && typeof p[2] === 'object' && p[2].radius !== undefined && p[2].radius > maxRadius)
          maxRadius = p[2].radius;
      }
    }
    if (!this.precisionMode) maxRadius = Math.max(maxRadius, spline.width || 0);
    const padding = maxRadius + 1;
    return { minX: minX - padding, maxX: maxX + padding, minZ: minZ - padding, maxZ: maxZ + padding };
  }

  addSpline(spline) {
    if (!spline.id) spline.id = THREE.MathUtils.generateUUID();
    spline.type = spline.type || 'ridge';
    if (spline.width    === undefined) spline.width    = 10;
    if (spline.strength === undefined) spline.strength = 5;
    if (spline.falloff  === undefined) spline.falloff  = 2.0;

    if (spline.points) {
      spline.points = spline.points.map(p => {
        if (p[2] && typeof p[2] === 'object') return p;
        const oldScale = (p[2] !== undefined && typeof p[2] === 'number') ? p[2] : 1.0;
        return [p[0], p[1], { radius: spline.width * oldScale, strength: spline.strength, falloff: 2.0, height: 0, visualSize: 2.0 }];
      });
    }

    if (spline.noiseStrength      === undefined) spline.noiseStrength      = 0.15;
    if (spline.noiseScale         === undefined) spline.noiseScale         = 0.1;
    if (spline.peakSharpness      === undefined) spline.peakSharpness      = 2.0;
    if (spline.plateauHeightOffset === undefined) spline.plateauHeightOffset = 0;
    if (spline.roadWidthFactor    === undefined) spline.roadWidthFactor    = 0.5;
    if (spline.edgeSmoothness     === undefined) spline.edgeSmoothness     = 1.0;
    if (spline.flattenStrength    === undefined) spline.flattenStrength    = 0.9;

    this._rebuildCurve(spline);
    spline.bounds     = this.computeSplineBounds(spline);
    spline.baseHeight = this.sampleHeightAtSplineCenter(spline);

    this.splines.push(spline);
    this.markDirty(spline.bounds);
    return spline;
  }

  removeSpline(id) {
    const idx = this.splines.findIndex(s => s.id === id);
    if (idx !== -1) {
      this.markDirty(this.splines[idx].bounds);
      this.splines.splice(idx, 1);
      this.curves.delete(id);
    }
  }

  updateSpline(id, data) {
    const s = this.splines.find(s => s.id === id);
    if (s) {
      this.markDirty(s.bounds);
      Object.assign(s, data);
      s.bounds     = this.computeSplineBounds(s);
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
    // Optimized: cap divisions and avoid over-sampling short splines
    const divisions = Math.min(100, Math.floor(len));
    const samples = curve.getPoints(divisions);
    const segments = [];
    for (let i = 0; i < samples.length - 1; i++) {
      const p0 = samples[i], p1 = samples[i + 1];
      segments.push({
        p0, p1, t0: i / divisions, t1: (i + 1) / divisions,
        minX: Math.min(p0.x, p1.x), maxX: Math.max(p0.x, p1.x),
        minZ: Math.min(p0.z, p1.z), maxZ: Math.max(p0.z, p1.z)
      });
    }
    this.curves.set(spline.id, { curve, samples, segments });
    spline.bounds = this.computeSplineBounds(spline);
  }

  _getMinDistanceToCurve(px, pz, splineId) {
    const curveData = this.curves.get(splineId);
    if (!curveData) return Infinity;
    const { curve, segments } = curveData;
    const splineObj = this.splines.find(s => s.id === splineId);
    const padding = splineObj ? (splineObj.width || 0) : 0;
    let minDistSq = Infinity, bestSegment = null;
    for (const s of segments) {
      if (px < s.minX - padding || px > s.maxX + padding || pz < s.minZ - padding || pz > s.maxZ + padding) continue;
      const dx = s.p1.x - s.p0.x, dz = s.p1.z - s.p0.z, l2 = dx * dx + dz * dz;
      let t = 0;
      if (l2 > 0) { t = ((px - s.p0.x) * dx + (pz - s.p0.z) * dz) / l2; t = Math.max(0, Math.min(1, t)); }
      const projX = s.p0.x + t * dx, projZ = s.p0.z + t * dz;
      const dSq = (px - projX) ** 2 + (pz - projZ) ** 2;
      if (dSq < minDistSq) { minDistSq = dSq; bestSegment = s; }
    }
    if (!bestSegment) return Infinity;
    let low = bestSegment.t0, high = bestSegment.t1;
    const tempPoint = new THREE.Vector3();
    for (let iter = 0; iter < 4; iter++) {
      const mid1 = low + (high - low) * 0.33, mid2 = low + (high - low) * 0.66;
      curve.getPoint(mid1, tempPoint); const d1Sq = (px - tempPoint.x) ** 2 + (pz - tempPoint.z) ** 2;
      curve.getPoint(mid2, tempPoint); const d2Sq = (px - tempPoint.x) ** 2 + (pz - tempPoint.z) ** 2;
      if (d1Sq < d2Sq) { high = mid2; minDistSq = d1Sq; } else { low = mid1; minDistSq = d2Sq; }
    }
    return Math.sqrt(minDistSq);
  }

  clearAll() { this.splines = []; this.curves.clear(); }

  exportJSON() { return { splines: this.splines }; }

  loadJSON(data) {
    if (!data) return;
    this.clearAll();
    const isFullMap = data && data.splines;
    const splineData = isFullMap ? data.splines : (Array.isArray(data) ? data : []);
    splineData.forEach(s => this.addSpline(s));
    if (this.chunkManager) {
      // Initial load: bake synchronously so chunks generate correctly
      this._bakeSynchronous({ minX: -512, maxX: 512, minZ: -512, maxZ: 512 });
      this.chunkManager.regenerateFromSplines();
    }
  }
}
