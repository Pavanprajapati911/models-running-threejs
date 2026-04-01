// src/editor/TerrainSplineManager.js
import * as THREE from 'three';

export class TerrainSplineManager {
  constructor(scene) {
    this.scene = scene;
    this.splines = [];
    this.curves = new Map(); // id -> { curve, samples }
    this.dirtyBounds = null;
    this.chunkManager = null;
    this.heightOffsets = new Map(); // chunkKey -> Float32Array
  }

  getHeightOffset(chunkKey, vertexIndex) {
    const layer = this.heightOffsets.get(chunkKey);
    return layer ? layer[vertexIndex] : 0;
  }

  setHeightOffset(chunkKey, vertexIndex, value) {
    const layer = this.heightOffsets.get(chunkKey);
    if (layer) layer[vertexIndex] = value;
  }

  getOrCreateLayer(chunkKey) {
    const fixedSegments = 128;
    const vertexCount = (fixedSegments + 1) * (fixedSegments + 1);
    if (!this.heightOffsets.has(chunkKey)) {
        this.heightOffsets.set(chunkKey, new Float32Array(vertexCount));
    }
    return this.heightOffsets.get(chunkKey);
  }

  getManualOffset(x, z) {
    if (!this.chunkManager) return 0;
    const chunkSize = this.chunkManager.chunkSize;
    const cx = Math.floor(x / chunkSize);
    const cz = Math.floor(z / chunkSize);
    const key = `${cx},${cz}`;
    const layer = this.heightOffsets.get(key);
    if (!layer) return 0;

    // Approximate: find nearest vertex index in the grid
    // Chunks are generated with 'segments'
    // This is an approximation since we don't know the exact segment count of the active chunk here easily
    // but we can guess from the typical dist or use a default.
    // However, the best way is to ask the chunk directly if it exists.
    const chunk = this.chunkManager.chunks.get(key);
    if (!chunk) return 0;

    const fixedSegments = 128;
    const halfSize = chunkSize / 2;
    const localX = x - chunk.x + halfSize;
    const localZ = z - chunk.z + halfSize;
    
    const u = THREE.MathUtils.clamp(localX / chunkSize, 0, 1);
    const v = THREE.MathUtils.clamp(localZ / chunkSize, 0, 1);
    
    const gridX = Math.round(u * fixedSegments);
    const gridZ = Math.round(v * fixedSegments);
    const index = gridZ * (fixedSegments + 1) + gridX;
    
    return layer[index] || 0;
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
    this.chunkManager.updateChunksInBounds(this.dirtyBounds);
    this.dirtyBounds = null;
  }

  computeSplineBounds(spline) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    if (spline.points && spline.points.length > 0) {
      for (const p of spline.points) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minZ) minZ = p[1];
        if (p[1] > maxZ) maxZ = p[1];
      }
    } else {
      return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    }
    const width = spline.width || 0;
    minX -= width;
    maxX += width;
    minZ -= width;
    maxZ += width;
    return { minX, maxX, minZ, maxZ };
  }

  baseHeight(x, z) {
    return Math.sin(x * 0.05) * 0.5 + Math.cos(z * 0.05) * 0.5;
  }

  smoothFalloff(t) {
    return t * t * (3.0 - 2.0 * t);
  }

  addSpline(spline) {
    if (!spline.id) spline.id = THREE.MathUtils.generateUUID();
    spline.bounds = this.computeSplineBounds(spline);
    this.splines.push(spline);
    this._rebuildCurve(spline);
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
      this._rebuildCurve(s);
      this.markDirty(s.bounds);
    }
  }

  getSplines() {
    return this.splines;
  }

  _rebuildCurve(spline) {
    if (!spline.points || spline.points.length < 2) {
      this.curves.delete(spline.id);
      return;
    }
    
    const vecs = spline.points.map(p => new THREE.Vector3(p[0], 0, p[1]));
    const curve = new THREE.CatmullRomCurve3(vecs);
    curve.curveType = 'catmullrom';
    
    // Sample points for faster distance evaluation
    // We use a high number of samples to get smooth paths
    const len = curve.getLength();
    const sampleCount = Math.max(10, Math.floor(len * 2)); 
    const samples = curve.getSpacedPoints(sampleCount);
    
    this.curves.set(spline.id, { curve, samples });
  }

  _distanceToPolyline(px, pz, samples) {
    let minDistSq = Infinity;
    
    for (let i = 0; i < samples.length - 1; i++) {
        const p1 = samples[i];
        const p2 = samples[i + 1];
        
        const l2 = (p2.x - p1.x)**2 + (p2.z - p1.z)**2;
        
        let t = 0;
        if (l2 !== 0) {
            t = Math.max(0, Math.min(1, ((px - p1.x) * (p2.x - p1.x) + (pz - p1.z) * (p2.z - p1.z)) / l2));
        }
        
        const projX = p1.x + t * (p2.x - p1.x);
        const projZ = p1.z + t * (p2.z - p1.z);
        
        const distSq = (px - projX)**2 + (pz - projZ)**2;
        if (distSq < minDistSq) minDistSq = distSq;
    }
    
    return Math.sqrt(minDistSq);
  }

  evaluateHeight(x, z) {
    let height = this.baseHeight(x, z);
    
    for (const spline of this.splines) {
        const curveData = this.curves.get(spline.id);
        if (!curveData) continue;
        
        const dist = this._distanceToPolyline(x, z, curveData.samples);
        
        if (dist < spline.width) {
            let t = 1 - (dist / spline.width);
            const influence = this.smoothFalloff(t);
            
            if (spline.type === 'ridge') {
                height += influence * spline.strength;
            } else if (spline.type === 'valley') {
                height -= influence * spline.strength;
            } else if (spline.type === 'plateau') {
                height = THREE.MathUtils.lerp(height, spline.strength, influence);
            } else if (spline.type === 'road') {
                height = THREE.MathUtils.lerp(height, 0, influence);
            }
        }
    }
    
    return height + this.getManualOffset(x, z);
  }

  exportJSON() {
    const offsetsPlain = {};
    for (const [k, v] of this.heightOffsets.entries()) {
        let hasChanges = false;
        for (let i = 0; i < v.length; i++) {
            if (v[i] !== 0) { hasChanges = true; break; }
        }
        if (hasChanges) offsetsPlain[k] = Array.from(v);
    }
    return {
        splines: this.splines,
        heightOffsets: offsetsPlain
    };
  }

  loadJSON(data) {
    this.splines = [];
    this.curves.clear();
    this.heightOffsets.clear();
    
    if (Array.isArray(data)) {
        data.forEach(s => this.addSpline(s));
    } else if (data && typeof data === 'object') {
        if (Array.isArray(data.splines)) {
            data.splines.forEach(s => this.addSpline(s));
        }
        if (data.heightOffsets) {
            for (const key in data.heightOffsets) {
                this.heightOffsets.set(key, new Float32Array(data.heightOffsets[key]));
            }
        }
    }
    this.dirtyBounds = null; // Clear dirty bounds after whole map load
  }
}
