// src/editor/TerrainSplineManager.js
import * as THREE from 'three';

export class TerrainSplineManager {
  constructor(scene) {
    this.scene = scene;
    this.splines = [];
    this.curves = new Map(); // id -> { curve, samples }
  }

  addSpline(spline) {
    if (!spline.id) spline.id = THREE.MathUtils.generateUUID();
    this.splines.push(spline);
    this._rebuildCurve(spline);
    return spline;
  }

  removeSpline(id) {
    this.splines = this.splines.filter(s => s.id !== id);
    this.curves.delete(id);
  }

  updateSpline(id, data) {
    const s = this.splines.find(s => s.id === id);
    if (s) {
      Object.assign(s, data);
      this._rebuildCurve(s);
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

  evaluateHeight(x, z, baseHeight) {
    let h = baseHeight;
    
    for (const spline of this.splines) {
        const curveData = this.curves.get(spline.id);
        if (!curveData) continue;
        
        const dist = this._distanceToPolyline(x, z, curveData.samples);
        
        if (dist < spline.width) {
            const t = 1 - (dist / spline.width);
            const influence = Math.pow(t, spline.falloff);
            
            if (spline.type === 'ridge') {
                h += influence * spline.strength;
            } else if (spline.type === 'valley') {
                h -= influence * spline.strength;
            } else if (spline.type === 'plateau') {
                h = THREE.MathUtils.lerp(h, spline.strength, influence);
            } else if (spline.type === 'road') {
                h = THREE.MathUtils.lerp(h, 0, influence);
            }
        }
    }
    
    return h;
  }

  exportJSON() {
    return this.splines;
  }

  loadJSON(data) {
    this.splines = [];
    this.curves.clear();
    
    if (Array.isArray(data)) {
        data.forEach(s => this.addSpline(s));
    }
  }
}
