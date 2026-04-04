// src/workers/terrainWorker.js
// Runs OFF the main thread to compute spline height contributions.
import { createNoise2D } from 'simplex-noise';
import alea from 'alea';

let noise2D = null;
let _envParams = null;

function ensureNoise(seed, params) {
  if (!noise2D) {
    noise2D = createNoise2D(alea(seed));
    _envParams = params;
  }
}

function calculateHeight(x, z) {
  const p = _envParams.terrain;
  const l = _envParams.lowland;
  const flatness = p.flatness ?? 0.02;
  return (
    noise2D(x * l.baseFreq, z * l.baseFreq) * l.baseAmp +
    noise2D(x * l.hillFreq, z * l.hillFreq) * l.hillAmp +
    noise2D(x * l.detailFreq, z * l.detailFreq) * l.detailAmp
  ) * p.heightMult * flatness;
}

function fpow(base, exp) {
  if (exp === 2) return base * base;
  if (exp === 3) return base * base * base;
  return Math.pow(base, exp);
}

function getMinDistSq(px, pz, segments, padding) {
  let minDistSq = Infinity;
  for (const s of segments) {
    if (px < s.minX - padding || px > s.maxX + padding ||
        pz < s.minZ - padding || pz > s.maxZ + padding) continue;
    const dx = s.p1x - s.p0x, dz = s.p1z - s.p0z;
    const l2 = dx * dx + dz * dz;
    let t = 0;
    if (l2 > 0) { t = ((px - s.p0x) * dx + (pz - s.p0z) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t; }
    const projX = s.p0x + t * dx, projZ = s.p0z + t * dz;
    const dSq = (px - projX) * (px - projX) + (pz - projZ) * (pz - projZ);
    if (dSq < minDistSq) minDistSq = dSq;
  }
  return minDistSq;
}

function computeSplineEffect(wx, wz, splines, precisionMode, curveWeight, pointWeight) {
  let effect = 0;
  for (const sp of splines) {
    if (wx < sp.bounds.minX || wx > sp.bounds.maxX ||
        wz < sp.bounds.minZ || wz > sp.bounds.maxZ) continue;

    let pointEffect = 0;
    if (sp.points) {
      for (const p of sp.points) {
        const pData = p[2];
        if (!pData || typeof pData !== 'object') continue;
        const dx = wx - p[0], dz = wz - p[1];
        const distSq = dx * dx + dz * dz;
        const r = pData.radius;
        if (distSq >= r * r) continue;
        const t = Math.sqrt(distSq) / r;
        const falloffVal = fpow(Math.max(0, 1.0 - t), pData.falloff ?? sp.falloff ?? 2.0);
        const str = pData.strength ?? sp.strength;
        const hgt = pData.height ?? 0;
        if (sp.type === 'ridge' || sp.type === 'plateau' || sp.type === 'road') pointEffect += falloffVal * (str + hgt);
        else if (sp.type === 'valley') pointEffect -= falloffVal * (str + hgt);
      }
    }

    let splineContrib = 0;
    if (precisionMode) {
      splineContrib = pointEffect;
    } else {
      let curveEffect = 0;
      if (sp.segments && sp.segments.length > 0) {
        const dist = Math.sqrt(getMinDistSq(wx, wz, sp.segments, sp.width || 0));
        if (dist < sp.width) {
          const ct = dist / sp.width;
          const cFalloff = fpow(1.0 - ct, sp.falloff || 2.0);
          if (sp.type === 'ridge' || sp.type === 'valley') {
            const h = fpow(1.0 - ct, sp.peakSharpness ?? 2.0) * sp.strength;
            curveEffect = sp.type === 'ridge' ? h : -h;
          } else if (sp.type === 'plateau') {
            curveEffect = (sp.baseHeight + (sp.plateauHeightOffset || 0) - calculateHeight(wx, wz)) * cFalloff;
          } else if (sp.type === 'road') {
            const baseN = calculateHeight(wx, wz);
            const roadWidth = sp.width * (sp.roadWidthFactor || 0.5);
            if (dist < roadWidth) {
              curveEffect = (sp.baseHeight - baseN) * (sp.flattenStrength || 0.9);
            } else {
              const edgeT = (dist - roadWidth) / (sp.width - roadWidth);
              curveEffect = (sp.baseHeight - baseN) * fpow(1.0 - edgeT, sp.edgeSmoothness || 1.0) * (sp.flattenStrength || 0.9);
            }
          }
        }
      }
      splineContrib = (sp.type === 'ridge' || sp.type === 'valley')
        ? curveEffect * curveWeight + pointEffect * pointWeight
        : curveEffect + pointEffect * pointWeight;
    }
    effect += splineContrib;
  }
  return effect;
}

self.onmessage = function(e) {
  const { splines, dirtyBounds, cacheWorldSize, cacheResolution, cacheWidth, cacheDepth,
          precisionMode, curveWeight, pointWeight, seed, envParams, jobId } = e.data;

  ensureNoise(seed, envParams);
  const half = cacheWorldSize / 2;
  const startX = Math.max(0, Math.floor((dirtyBounds.minX + half) / cacheResolution));
  const endX   = Math.min(cacheWidth - 1, Math.ceil((dirtyBounds.maxX + half) / cacheResolution));
  const startZ = Math.max(0, Math.floor((dirtyBounds.minZ + half) / cacheResolution));
  const endZ   = Math.min(cacheDepth - 1, Math.ceil((dirtyBounds.maxZ + half) / cacheResolution));

  const count = (endX - startX + 1) * (endZ - startZ + 1);
  const values  = new Float32Array(count);
  const indices = new Int32Array(count);

  let i = 0;
  for (let z = startZ; z <= endZ; z++) {
    for (let x = startX; x <= endX; x++) {
      values[i]  = computeSplineEffect(x * cacheResolution - half, z * cacheResolution - half, splines, precisionMode, curveWeight, pointWeight);
      indices[i] = z * cacheWidth + x;
      i++;
    }
  }

  self.postMessage({ values, indices, dirtyBounds, jobId }, [values.buffer, indices.buffer]);
};