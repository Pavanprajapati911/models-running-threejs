import * as THREE from 'three';
import { GRASS_VARIATIONS } from './GrassManager.js';

export class GrassLODManager {
  constructor(grassManager) {
    this.grassManager = grassManager;
  }

  createProxy(data) {
    const proxyMat = new THREE.MeshBasicMaterial({ visible: false, wireframe: true });
    let proxy;

    const v = data.variation || 'light_wind';
    const varParams = GRASS_VARIATIONS[v] || GRASS_VARIATIONS['light_wind'];
    const params = { ...varParams, ...data.params };

    if (data.type === "grass_animated" && data.position) {
        const radius = params.radius || 2;
        const height = params.height || 1.0;
        const proxyGeo = new THREE.CylinderGeometry(radius, radius, height, 8);
        proxy = new THREE.Mesh(proxyGeo, proxyMat);
        proxy.position.set(data.position[0], data.position[1] + height / 2, data.position[2]);
        proxy.updateMatrixWorld();
    } else if (data.points && data.points.length > 0) {
        const proxyGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
        proxy = new THREE.InstancedMesh(proxyGeo, proxyMat, data.points.length);
        const dummy = new THREE.Object3D();
        data.points.forEach((p, idx) => {
            dummy.position.set(p.x, p.y + 0.4, p.z);
            dummy.updateMatrix();
            proxy.setMatrixAt(idx, dummy.matrix);
        });
        proxy.instanceMatrix.needsUpdate = true;
        proxy.computeBoundingSphere();
        proxy.computeBoundingBox();
    } else {
        proxy = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), proxyMat);
    }
    
    proxy.userData.isGrassPatch = true;
    proxy.userData.placedObjectData = data;
    
    return proxy;
  }

  rebuildChunkLODs(chunk) {
    if (chunk.grassLODs) {
      this._disposeLODGroup(chunk.grassLODs.high, chunk);
      this._disposeLODGroup(chunk.grassLODs.mid, chunk);
      this._disposeLODGroup(chunk.grassLODs.low, chunk);
    }

    chunk.grassLODs = {
      high: new THREE.Group(),
      mid: new THREE.Group(),
      low: new THREE.Group()
    };
    
    chunk.manager.scene.add(chunk.grassLODs.high);
    chunk.manager.scene.add(chunk.grassLODs.mid);
    chunk.manager.scene.add(chunk.grassLODs.low);

    // Initial state: hide until camera updates
    chunk.grassLODs.high.visible = false;
    chunk.grassLODs.mid.visible = false;
    chunk.grassLODs.low.visible = false;

    if (!chunk.placedGrass || chunk.placedGrass.length === 0) return;

    const varBuckets = {};
    chunk.placedGrass.forEach(pg => {
      const v = pg.data.variation || 'light_wind';
      if (!varBuckets[v]) varBuckets[v] = [];
      varBuckets[v].push(pg.data);
    });

    for (const variation in varBuckets) {
      const patches = varBuckets[variation];
      const paramsList = patches.map(data => {
        const varParams = GRASS_VARIATIONS[variation] || GRASS_VARIATIONS['light_wind'];
        return { ...varParams, ...data.params };
      });
      
      const highMesh = this._createBatchedLOD(chunk, patches, paramsList, 1.0);
      const midMesh = this._createBatchedLOD(chunk, patches, paramsList, 0.4);
      const lowMesh = this._createBatchedLOD(chunk, patches, paramsList, 0.1);
      
      if (highMesh) chunk.grassLODs.high.add(highMesh);
      if (midMesh) chunk.grassLODs.mid.add(midMesh);
      if (lowMesh) chunk.grassLODs.low.add(lowMesh);
    }
  }

  _disposeLODGroup(group, chunk) {
    if (!group) return;
    group.children.forEach(mesh => {
        if (mesh.geometry) mesh.geometry.dispose();
    });
    chunk.manager.scene.remove(group);
  }

  _createBatchedLOD(chunk, patches, paramsList, densityMult) {
    if (densityMult <= 0) return null;

    let totalInstances = 0;
    const patchCounts = patches.map((data, i) => {
      const params = paramsList[i];
      let tCount = 0;
      if (data.type === "grass_animated") {
        tCount = params.density || 1000;
      } else if (data.type === "grass_selection" && data.points) {
        tCount = data.points.length * (params.density || 10);
      }
      return Math.floor(tCount * densityMult);
    });
    
    totalInstances = patchCounts.reduce((a, b) => a + b, 0);
    if (totalInstances === 0) return null;

    const baseParams = paramsList[0];
    const width = baseParams.width || 0.03;
    const height = baseParams.height || 1.0;
    
    const mat = this.grassManager.material.clone();
    mat.uniforms.uTime = this.grassManager.sharedUniforms.uTime;
    mat.uniforms.uPlayerPos = this.grassManager.sharedUniforms.uPlayerPos;
    mat.uniforms.uInteractionRadius = this.grassManager.sharedUniforms.uInteractionRadius;
    mat.uniforms.uInteractionStrength = this.grassManager.sharedUniforms.uInteractionStrength;
    
    mat.uniforms.uWindSpeed.value = baseParams.windSpeed !== undefined ? baseParams.windSpeed : 2.0;

    let animScale = 1.0;
    if (densityMult === 0.4) animScale = 0.5; // Simplify animation for mid
    if (densityMult === 0.1) animScale = 0.1; // Minimal animation for low

    mat.uniforms.uWindStrength.value = (baseParams.windStrength !== undefined ? baseParams.windStrength : 0.15) * animScale;
    mat.uniforms.uBaseColor.value.set(baseParams.baseColor || '#0c2e0c');
    mat.uniforms.uTipColor.value.set(baseParams.tipColor || '#6da61a');

    let clumpWidth = width;
    let clumpHeight = height;
    let lodLevel = 'high';
    if (densityMult === 0.4) {
        lodLevel = 'mid';
    } else if (densityMult === 0.1) {
        lodLevel = 'low';
        clumpWidth *= 2; 
    }

    const geometry = this.grassManager._createClumpGeometry(clumpWidth, clumpHeight, lodLevel);
    const mesh = new THREE.InstancedMesh(geometry, mat, totalInstances);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    const aInstanceData = new Float32Array(totalInstances * 4);
    const dummy = new THREE.Object3D();

    let offset = 0;

    for (let i = 0; i < patches.length; i++) {
        const data = patches[i];
        const params = paramsList[i];
        const count = patchCounts[i];
        const radius = params.radius || 2;
        const falloffExp = params.falloff !== undefined ? params.falloff : 1.0;

        if (data.type === "grass_animated") {
            const center = new THREE.Vector3(data.position[0], data.position[1], data.position[2]);
            const getTerrain = (x, z) => ({
                height: chunk.manager.getHeight(x, z),
                normal: chunk.manager.getTerrainNormal(x, z)
            });

            for (let c = 0; c < count; c++) {
                const angle = Math.random() * Math.PI * 2;
                const r = Math.sqrt(Math.random()) * radius;
                const x = center.x + Math.cos(angle) * r;
                const z = center.z + Math.sin(angle) * r;

                const terrain = getTerrain(x, z);
                dummy.position.set(x, terrain.height, z);
                
                const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), terrain.normal);
                dummy.rotation.setFromQuaternion(quat);
                dummy.rotation.y += Math.random() * Math.PI * 2;

                const s = 0.8 + Math.random() * 0.4;
                const patchScale = data.scale ? data.scale[0] : 1;
                dummy.scale.set(s * patchScale, s * patchScale, s * patchScale);
                dummy.updateMatrix();
                
                mesh.setMatrixAt(offset, dummy.matrix);

                const i4 = offset * 4;
                aInstanceData[i4 + 0] = Math.random() * 100;
                aInstanceData[i4 + 1] = Math.random();
                aInstanceData[i4 + 2] = (Math.random() - 0.5) * 0.4;
                aInstanceData[i4 + 3] = (Math.random() - 0.5) * 0.4;

                offset++;
            }
        } else if (data.type === "grass_selection" && data.points) {
            const pointsCount = data.points.length;
            const targetDensityPerPoint = params.density || 10;
            const actualDensityPerPoint = targetDensityPerPoint * densityMult;
            
            for (let pIdx = 0; pIdx < pointsCount; pIdx++) {
                const pt = data.points[pIdx];
                let instCount = Math.floor(actualDensityPerPoint);
                if (Math.random() < (actualDensityPerPoint % 1)) instCount++;

                for (let d = 0; d < instCount; d++) {
                    const angle = Math.random() * Math.PI * 2;
                    const r = Math.sqrt(Math.random()) * radius;
                    
                    const distRatio = r / radius;
                    const falloffChance = Math.pow(1.0 - distRatio, falloffExp);
                    const isVisible = Math.random() < falloffChance;

                    const x = pt.x + Math.cos(angle) * r;
                    const z = pt.z + Math.sin(angle) * r;

                    const terrain = {
                        height: chunk.manager.getHeight(x, z),
                        normal: chunk.manager.getTerrainNormal(x, z)
                    };

                    dummy.position.set(x, terrain.height, z);
                    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), terrain.normal);
                    dummy.rotation.setFromQuaternion(quat);
                    dummy.rotation.y += Math.random() * Math.PI * 2;

                    const s = isVisible ? (0.8 + Math.random() * 0.4) : 0.0001;
                    dummy.scale.set(s, s, s);
                    dummy.updateMatrix();

                    if (offset < totalInstances) {
                        mesh.setMatrixAt(offset, dummy.matrix);
                        const i4 = offset * 4;
                        aInstanceData[i4 + 0] = Math.random() * 100;
                        aInstanceData[i4 + 1] = Math.random();
                        aInstanceData[i4 + 2] = (Math.random() - 0.5) * 0.4;
                        aInstanceData[i4 + 3] = (Math.random() - 0.5) * 0.4;
                        offset++;
                    }
                }
            }
        }
    }
    
    if (offset < totalInstances) {
      mesh.count = offset;
    }

    mesh.geometry.setAttribute('aInstanceData', new THREE.InstancedBufferAttribute(aInstanceData, 4));
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();

    return mesh;
  }
}
