import * as THREE from 'three';

export class TerrainNoiseBrushManager {
  constructor() {
    this.regions = [];
    this.selectedRegionId = null;
    this.chunkManager = null;
    this.dirtyBounds = null;

    // We will use standard settings per region.
    this.brushParams = {
      size: 5.0,
      strength: 0.5,
      falloff: 0.5,
      mode: 'add' // support 'add', 'remove', 'smooth'
    };
  }

  setChunkManager(chunkManager) {
    this.chunkManager = chunkManager;
  }

  getBlendedMicroParams(x, z, globalParams) {
    let tp = { ...globalParams };
    
    for (const region of this.regions) {
      if (!region.bounds || !region.microParams) continue;
      
      if (x < region.bounds.minX || x > region.bounds.maxX || 
          z < region.bounds.minZ || z > region.bounds.maxZ) {
        continue;
      }

      const influence = this._getRegionInfluence(region, x, z);
      if (influence <= 0) continue;
      
      // Blend using influence. Painter's algorithm style.
      for (const key in region.microParams) {
        if (tp[key] !== undefined) {
           tp[key] = tp[key] * (1 - influence) + region.microParams[key] * influence;
        }
      }
    }
    
    return tp;
  }

  // --- Logic for evaluating masks ---
  getMaskAt(x, z) {
    let mask = 1.0;
    
    // We only process regions overlapping this point
    for (const region of this.regions) {
      if (!region.bounds) continue;
      
      // Fast AABB check
      if (x < region.bounds.minX || x > region.bounds.maxX || 
          z < region.bounds.minZ || z > region.bounds.maxZ) {
        continue;
      }

      const influence = this._getRegionInfluence(region, x, z);
      if (influence <= 0) continue;

      const strength = region.settings.strength || 0.5;
      const mode = region.settings.mode || 'add';

      // Example influence mapping:
      // strength: 1.0 means full effect
      if (mode === 'add') {
         mask += influence * strength * 2.0;
      } else if (mode === 'remove') {
         mask -= influence * strength * 2.0;
      } else if (mode === 'smooth') {
         // approach 1.0 based on influence
         mask = mask + (1.0 - mask) * (influence * strength);
      }
    }
    
    // clamp mask to not go negative
    return Math.max(0.0, mask);
  }

  /**
   * Calculates the combined influence (0.0 to 1.0) of a region's stamps at world (x, z).
   */
  _getRegionInfluence(region, x, z) {
    let maxInf = 0;
    const falloffPow = Math.max(0.01, 1.0 / (region.settings.falloff + 0.01) - 0.5); 

    for (const p of region.points) {
      const dx = x - p.x;
      const dz = z - p.z;
      const dSq = dx * dx + dz * dz;
      const radius = p.radius || region.settings.size || 5.0;
      const rSq = radius * radius;

      if (dSq > rSq) continue;

      const d = Math.sqrt(dSq);
      const t = Math.max(0, 1.0 - (d / radius));

      // falloff shaping
      const pointInf = Math.pow(t, falloffPow);
      if (pointInf > maxInf) maxInf = pointInf;
    }
    return Math.min(1.0, maxInf);
  }

  // --- Drawing logic ---

  startStroke(x, z) {
    const id = THREE.MathUtils.generateUUID();
    const newRegion = {
      id: id,
      points: [],
      bounds: {
        minX: Infinity,
        maxX: -Infinity,
        minZ: Infinity,
        maxZ: -Infinity
      },
      settings: {
        size: this.brushParams.size,
        strength: this.brushParams.strength,
        falloff: this.brushParams.falloff,
        mode: this.brushParams.mode
      },
      microParams: this._getDefaultMicroParams()
    };
    
    this.regions.push(newRegion);
    this.addStampToRegion(newRegion, x, z);
    return id;
  }

  addStamp(x, z) {
    if (this.regions.length === 0) return;
    const region = this.regions[this.regions.length - 1]; // active stroke
    this.addStampToRegion(region, x, z);
  }

  addStampToRegion(region, x, z) {
    region.points.push({
      x: x, 
      z: z,
      radius: region.settings.size
    });

    const padding = region.settings.size;
    region.bounds.minX = Math.min(region.bounds.minX, x - padding);
    region.bounds.maxX = Math.max(region.bounds.maxX, x + padding);
    region.bounds.minZ = Math.min(region.bounds.minZ, z - padding);
    region.bounds.maxZ = Math.max(region.bounds.maxZ, z + padding);

    this.markDirty(region.bounds);
  }
  
  _getDefaultMicroParams() {
    const src = this.chunkManager && this.chunkManager.envParams ? this.chunkManager.envParams.terrain : {};
    return {
        baseAmp: src.baseAmp || 0.05,
        erosionAmp: src.erosionAmp || 0.02,
        midAmp: src.midAmp || 0.02,
        detailAmp: src.detailAmp || 0.015,
        baseFreq: src.baseFreq || 0.005,
        erosionFreq: src.erosionFreq || 1.1,
        midFreq: src.midFreq || 2.5,
        detailFreq: src.detailFreq || 10.0,
        warpFreq: src.warpFreq || 0.05,
        warpStrength: src.warpStrength || 0.5,
        microHeight: src.microHeight !== undefined ? src.microHeight : 1.0,
        heightMult: src.heightMult || 1.0
    };
  }

  // --- Selected Region edits ---
  
  getRegionById(id) {
    return this.regions.find(r => r.id === id);
  }
  
  updateRegion(id, newSettings, newMicroParams) {
    const r = this.getRegionById(id);
    if (!r) return;
    
    if (newSettings) {
        Object.assign(r.settings, newSettings);
        // if size changed we should recalculate bounds
        if (newSettings.size !== undefined) {
          r.bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
          for (const p of r.points) {
            p.radius = newSettings.size;
            r.bounds.minX = Math.min(r.bounds.minX, p.x - p.radius);
            r.bounds.maxX = Math.max(r.bounds.maxX, p.x + p.radius);
            r.bounds.minZ = Math.min(r.bounds.minZ, p.z - p.radius);
            r.bounds.maxZ = Math.max(r.bounds.maxZ, p.z + p.radius);
          }
        }
    }
    
    if (newMicroParams) {
        if (!r.microParams) r.microParams = {};
        Object.assign(r.microParams, newMicroParams);
    }
    
    this.markDirty(r.bounds);
  }
  
  removeRegion(id) {
    const idx = this.regions.findIndex(r => r.id === id);
    if (idx > -1) {
      const r = this.regions[idx];
      this.markDirty(r.bounds);
      this.regions.splice(idx, 1);
    }
  }

  // --- Rendering Sync ---

  markDirty(bounds) {
    if (!bounds) return;
    if (!this.dirtyBounds) {
      this.dirtyBounds = { 
        minX: bounds.minX, 
        maxX: bounds.maxX, 
        minZ: bounds.minZ, 
        maxZ: bounds.maxZ 
      };
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

    // The spline manager already rebuilds CPU heightmap -> Chunk Mesh cleanly.
    // We can rely on chunkManager.updateChunksInBounds(bounds).
    this.chunkManager.updateChunksInBounds(bounds);
  }
  
  exportJSON() {
    return { regions: this.regions };
  }
  
  loadJSON(data) {
    if (data && data.regions) {
        this.regions = data.regions;
    } else {
        this.regions = [];
    }
    this.markDirty({ minX: -9999, maxX: 9999, minZ: -9999, maxZ: 9999 });
    this.flushUpdates();
  }
}
