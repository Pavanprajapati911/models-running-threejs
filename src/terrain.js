// src/terrain.js
import * as THREE from "three";
import Rapier from "@dimforge/rapier3d-compat";
import vertexShader from "./shaders/terrain_vert.glsl?raw";
import fragmentShader from "./shaders/terrain_frag.glsl?raw";
import { VegetationManager } from "./environment/vegetation-manager.js";
import { GrassManager, GRASS_VARIATIONS } from "./environment/GrassManager.js";
import { GrassLODManager } from "./environment/GrassLODManager.js";
import alea from "alea";
import { createNoise2D } from "simplex-noise";

export class TerrainChunk {
  constructor(manager, x, z, segments) {
    this.manager = manager;
    this.x = x;
    this.z = z;
    this.segments = segments;

    this.mesh = null;
    this.collider = null;
    this.body = null;

    this.vegetation = [];
    this.placedObjects = [];
    this.placedGrass = [];
    this.grassLODs = null;
    this.initialized = false;
    this.isSplatModified = false;

    this.splatRes = 128;
    this.splatData = new Uint8Array(this.splatRes * this.splatRes * 4);
    this.splatTexture = new THREE.DataTexture(this.splatData, this.splatRes, this.splatRes, THREE.RGBAFormat);
    this.splatTexture.minFilter = THREE.LinearFilter;
    this.splatTexture.magFilter = THREE.LinearFilter;

    this.generateInitialSplat();
  }

  generateInitialSplat() {
    const res = this.splatRes;
    const chunkSize = this.manager.chunkSize;
    const halfSize = chunkSize / 2;

    const cx = Math.floor(this.x / chunkSize);
    const cz = Math.floor(this.z / chunkSize);

    // Check for saved splat data
    const savedBase64 = this.manager.placedObjectManager ? this.manager.placedObjectManager.getSplatForChunk(cx, cz) : null;
    if (savedBase64) {
      const bytes = this.manager.placedObjectManager.base64ToUint8(savedBase64);
      this.splatData.set(bytes);
      this.isSplatModified = true;
      this.splatTexture.needsUpdate = true;
      return;
    }

    for (let i = 0; i < res * res; i++) {
      const i4 = i * 4;
      this.splatData[i4 + 0] = 255; // Default to Layer 0 (Forest)
      this.splatData[i4 + 1] = 0;
      this.splatData[i4 + 2] = 0;
      this.splatData[i4 + 3] = 0;
    }
    this.splatTexture.needsUpdate = true;
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    const geometry = this.manager.getGeometry(this.segments).clone();

    // Each chunk needs its own material instance for unique splat map uniform
    this.material = this.manager.sharedMaterial.clone();
    this.material.uniforms.uSplatMap = { value: this.splatTexture };

    // Explicitly pass other layer textures (discovery)
    const layers = this.manager.terrainLayers;
    this.material.uniforms.uLayer0 = { value: layers[0]?.tex || this.manager.forestTex };
    this.material.uniforms.uLayer1 = { value: layers[1]?.tex || this.manager.mudTex };
    this.material.uniforms.uLayer2 = { value: layers[2]?.tex || this.manager.forestTex };
    this.material.uniforms.uLayer3 = { value: layers[3]?.tex || this.manager.mudTex };

    this.material.uniforms.uLayer0Scale = { value: this.manager.envParams.terrain.forestTexScale };
    this.material.uniforms.uLayer1Scale = { value: this.manager.envParams.terrain.mudTexScale };
    this.material.uniforms.uLayer2Scale = { value: 0.05 };
    this.material.uniforms.uLayer3Scale = { value: 0.05 };

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.set(this.x, 0, this.z);

    this.manager.scene.add(this.mesh);

    this.generateHeightCPU(geometry);

    this.tryCreatePhysics();
    this.spawnVegetation();
  }

  generateHeightCPU(geometry) {
    const pos = geometry.attributes.position;
    const segs = this.segments;
    const chunkSize = this.manager.chunkSize;

    for (let i = 0; i < pos.count; i++) {
      const ix = i % (segs + 1);
      const iz = Math.floor(i / (segs + 1));
      const u = ix / segs;
      const v = iz / segs;

      const worldX = this.x + (u - 0.5) * chunkSize;
      const worldZ = this.z + (v - 0.5) * chunkSize;

      pos.setY(i, this.manager.getHeight(worldX, worldZ));
    }

    const eps = 0.5;

    if (!geometry.attributes.normal || geometry.attributes.normal.count !== pos.count) {
      geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
    }
    const normals = geometry.attributes.normal;

    for (let i = 0; i < pos.count; i++) {
      const ix = i % (segs + 1);
      const iz = Math.floor(i / (segs + 1));
      const u = ix / segs;
      const v = iz / segs;

      const worldX = this.x + (u - 0.5) * chunkSize;
      const worldZ = this.z + (v - 0.5) * chunkSize;

      const hL = this.manager.getHeight(worldX - eps, worldZ);
      const hR = this.manager.getHeight(worldX + eps, worldZ);
      const hD = this.manager.getHeight(worldX, worldZ - eps);
      const hU = this.manager.getHeight(worldX, worldZ + eps);

      const dx = (hR - hL) / (2 * eps);
      const dz = (hU - hD) / (2 * eps);
      const len = Math.sqrt(dx * dx + 1.0 + dz * dz);
      normals.setXYZ(i, -dx / len, 1.0 / len, -dz / len);
    }

    normals.needsUpdate = true;
    pos.needsUpdate = true;

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }

  regenerateFromSplines() {
    if (!this.mesh || !this.mesh.geometry) return;
    this.generateHeightCPU(this.mesh.geometry);

    if (this.collider) {
      this.manager.world.removeCollider(this.collider, true);
      this.collider = null;
    }
    if (this.body) {
      this.manager.world.removeRigidBody(this.body);
      this.body = null;
    }
    this.tryCreatePhysics();
  }


  tryCreatePhysics() {
    const dist = this.manager.camera.position.distanceTo(new THREE.Vector3(this.x, 0, this.z));
    const physicsDist = this.manager.envParams.performance.physicsDist || 120;

    if (dist > physicsDist) {
      if (this.collider) {
        this.manager.world.removeCollider(this.collider, true);
        this.collider = null;
      }
      if (this.body) {
        this.manager.world.removeRigidBody(this.body);
        this.body = null;
      }
      return;
    }

    if (this.collider) return; // Already has physics

    const geometry = this.mesh.geometry;
    const vertices = geometry.attributes.position.array;
    const indices = geometry.index.array;

    const bodyDesc = Rapier.RigidBodyDesc.fixed().setTranslation(this.x, 0, this.z);
    this.body = this.manager.world.createRigidBody(bodyDesc);

    const colliderDesc = Rapier.ColliderDesc.trimesh(
      new Float32Array(vertices),
      new Uint32Array(indices)
    ).setFriction(1);

    this.collider = this.manager.world.createCollider(colliderDesc, this.body);
  }

  spawnVegetation() {
    const p = this.manager.envParams;

    if (p.mode && p.mode.type === "procedural" && this.manager.vegManager) {
      const instances = this.manager.vegManager.getVegetationForChunk(
        this.x,
        this.z,
        this.manager.chunkSize
      );

      instances.forEach(mesh => {
        mesh.position.set(this.x, 0, this.z);
        this.manager.scene.add(mesh);
        this.vegetation.push(mesh);
      });
    }

    if (this.manager.placedObjectManager) {
      const cx = Math.floor(this.x / this.manager.chunkSize);
      const cz = Math.floor(this.z / this.manager.chunkSize);

      this.manager.placedObjectManager.getObjectsForChunk(cx, cz).forEach(obj => this.spawnPlacedObject(obj));
      this.manager.placedObjectManager.getGrassForChunk(cx, cz).forEach(g => this.spawnGrassPatch(g));
    }
  }

  spawnPlacedObject(obj) {
    if (!this.manager.vegManager) return;
    const models = this.manager.vegManager.models.get(obj.type) || this.manager.vegManager.models.get("jungleTrees");
    if (!models || models.length === 0) {
      console.error(`[TerrainChunk] No models found for category: ${obj.type}`);
      return;
    }

    const idx = Math.min(obj.modelIndex ?? 0, models.length - 1);
    const modelData = models[idx];
    if (!modelData) return;

    const group = new THREE.Group();

    if (modelData.meshes) {
      modelData.meshes.forEach(sub => {
        const mesh = new THREE.Mesh(sub.geometry, sub.material);
        mesh.frustumCulled = false;
        group.add(mesh);
      });
    }

    group.position.set(obj.position[0], obj.position[1], obj.position[2]);
    group.rotation.set(obj.rotation[0], obj.rotation[1], obj.rotation[2]);
    group.scale.set(obj.scale[0], obj.scale[1], obj.scale[2]);

    group.userData.isPlacedObject = true;
    group.userData.placedObjectData = obj;

    group.updateMatrix();
    group.matrixAutoUpdate = false;

    this.manager.scene.add(group);
    this.placedObjects.push({ data: obj, mesh: group });
  }

  removePlacedObject(obj) {
    const idx = this.placedObjects.findIndex(po => po.data === obj);
    if (idx !== -1) {
      this.manager.scene.remove(this.placedObjects[idx].mesh);
      this.placedObjects.splice(idx, 1);
    }
  }

  spawnGrassPatch(data) {
    if (!this.manager.grassLODManager) return;

    const proxyMesh = this.manager.grassLODManager.createProxy(data);

    this.placedGrass.push({ data: data, mesh: proxyMesh });
    this.manager.scene.add(proxyMesh);

    this.manager.grassLODManager.rebuildChunkLODs(this);
  }

  removeGrassPatch(data) {
    const idx = this.placedGrass.findIndex(pg => pg.data === data);
    if (idx !== -1) {
      this.manager.scene.remove(this.placedGrass[idx].mesh);
      this.placedGrass.splice(idx, 1);

      if (this.manager.grassLODManager) {
        this.manager.grassLODManager.rebuildChunkLODs(this);
      }
    }
  }

  dispose() {
    if (this.debugGroup) {
      this.debugGroup.children.forEach(child => {
        if (child.geometry) child.geometry.dispose();
      });
      this.manager.scene.remove(this.debugGroup);
    }

    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.manager.scene.remove(this.mesh);
    }

    this.vegetation.forEach(mesh => {
      this.manager.scene.remove(mesh);
    });

    this.placedObjects.forEach(po => {
      this.manager.scene.remove(po.mesh);
    });

    this.placedGrass.forEach(pg => {
      this.manager.scene.remove(pg.mesh);
    });

    if (this.manager.grassLODManager) {
      this.manager.grassLODManager._disposeLODGroup(this.grassLODs?.high, this);
      this.manager.grassLODManager._disposeLODGroup(this.grassLODs?.mid, this);
      this.manager.grassLODManager._disposeLODGroup(this.grassLODs?.low, this);
    }

    if (this.material) {
      this.material.dispose();
    }

    if (this.splatTexture) {
      this.splatTexture.dispose();
    }

    // Remove from init queue if present
    const qIdx = this.manager.initQueue.indexOf(this);
    if (qIdx !== -1) this.manager.initQueue.splice(qIdx, 1);

    this.vegetation = [];
    this.placedObjects = [];
    this.placedGrass = [];

    if (this.collider) {
      this.manager.world.removeCollider(this.collider, true);
    }

    if (this.body) {
      this.manager.world.removeRigidBody(this.body);
    }
  }

  updateLOD(playerPosition, frustum) {
    if (!this.mesh) return;

    this.manager.tempVec.set(this.x, 0, this.z);
    const dist = playerPosition.distanceTo(this.manager.tempVec);

    if (frustum) {
      const sphereRadius = (this.manager.chunkSize * 0.5) * 1.414 + 15;
      const sphere = new THREE.Sphere(this.manager.tempVec, sphereRadius);
      if (!frustum.intersectsSphere(sphere)) {
        this.mesh.visible = false;
        this.vegetation.forEach(v => v.visible = false);
        this.placedObjects.forEach(po => po.mesh.visible = false);
        if (this.grassLODs) {
          this.grassLODs.high.visible = false;
          this.grassLODs.mid.visible = false;
          this.grassLODs.low.visible = false;
        }
        return;
      }
    }

    this.mesh.visible = true;
    this.placedObjects.forEach(po => po.mesh.visible = true);

    const p = this.manager.envParams;

    if (this.grassLODs && this.mesh.visible) {
      this.grassLODs.high.visible = false;
      this.grassLODs.mid.visible = false;
      this.grassLODs.low.visible = false;

      const gNear = 60;
      const gMid = 110;
      const gFar = 150;

      if (dist <= gNear) {
        this.grassLODs.high.visible = true;
      } else if (dist <= gMid) {
        this.grassLODs.mid.visible = true;
      } else if (dist <= gFar) {
        this.grassLODs.low.visible = true;
      }
    }

    // Dynamic physics based on distance
    if (this.initialized) {
      this.tryCreatePhysics();
    }

    if (!p.performance.enableLOD) {
      this.vegetation.forEach(v => { v.visible = true; if (v.isInstancedMesh && v.userData.maxCount) v.count = v.userData.maxCount; });
      return;
    }

    const lodNear = p.terrain.lodDistNear || 50;
    const lodMid = p.terrain.lodDistMid || 120;
    const densityMult = p.performance.globalDensityMultiplier !== undefined ? p.performance.globalDensityMultiplier : 1.0;

    this.vegetation.forEach(mesh => {
      if (!mesh.isInstancedMesh) return;
      const maxCount = mesh.userData.maxCount;
      if (!maxCount) return;

      const isTree = mesh.userData.isTree;

      let targetRatio = 1.0;
      if (dist > lodMid) {
        targetRatio = isTree ? 0.0 : 0.1;
      } else if (dist > lodNear) {
        targetRatio = 0.5;
      }

      let count = Math.floor(maxCount * targetRatio * densityMult);

      if (count <= 0) {
        mesh.visible = false;
      } else {
        mesh.visible = true;
        mesh.count = Math.min(count, maxCount);
      }
    });
  }

  quickFrustumCheck(frustum) {
    if (!this.mesh) return;

    if (frustum) {
      const sphereRadius = (this.manager.chunkSize * 0.5) * 1.414 + 15;
      const sphere = new THREE.Sphere(this.manager.tempVec.set(this.x, 0, this.z), sphereRadius);
      if (!frustum.intersectsSphere(sphere)) {
        this.mesh.visible = false;
        this.vegetation.forEach(v => v.visible = false);
        this.placedObjects.forEach(po => po.mesh.visible = false);
        if (this.grassLODs) {
          this.grassLODs.high.visible = false;
          this.grassLODs.mid.visible = false;
          this.grassLODs.low.visible = false;
        }
      } else {
        this.mesh.visible = true;
        this.placedObjects.forEach(po => po.mesh.visible = true);
      }
    }
  }
}

export class ChunkManager {
  constructor(scene, world, camera, noise2D, envUniforms, envParams, placedObjectManager, terrainSplineManager) {
    this.scene = scene;
    this.world = world;
    this.camera = camera;

    this.envUniforms = envUniforms;
    this.envParams = envParams;
    this.placedObjectManager = placedObjectManager;
    this.terrainSplineManager = terrainSplineManager;
    this.noiseBrushManager = null;

    this.chunkSize = envParams.terrain.chunkSize;
    this.chunks = new Map();
    this.initQueue = [];

    this.tempVec = new THREE.Vector3();
    this.geometryCache = {};

    const textureLoader = new THREE.TextureLoader();
    this.mudTex = textureLoader.load('/textures/brown_mud/brown_mud_03_diff_1k.jpg');
    this.mudTex.wrapS = THREE.RepeatWrapping;
    this.mudTex.wrapT = THREE.RepeatWrapping;
    this.mudTex.colorSpace = THREE.SRGBColorSpace;

    this.forestTex = textureLoader.load('/textures/forest_ground/forrest_ground_01_diff_1k.jpg');
    this.forestTex.wrapS = THREE.RepeatWrapping;
    this.forestTex.wrapT = THREE.RepeatWrapping;
    this.forestTex.colorSpace = THREE.SRGBColorSpace;

    this.rng = alea(envParams.random.seed);
    this.noise2D = createNoise2D(this.rng);

    this.worldSize = 1024;
    this.resolution = 1.0;
    this.gridWidth = Math.floor(this.worldSize / this.resolution);
    this.gridDepth = Math.floor(this.worldSize / this.resolution);
    this.heightmap = new Float32Array(this.gridWidth * this.gridDepth);

    this.isEditing = false;
    this.updateFrameOffset = 0;

    this.prefillHeightmap();

    this.envUniforms = {
      ...this.envUniforms,
      uLightDir: { value: new THREE.Vector3() },
      uLightColor: { value: new THREE.Color(1, 1, 1) },
      uCameraPos: { value: new THREE.Vector3() },
      uDirtIntensity: { value: this.envParams.terrain.dirtIntensity },
      uColorVariation: { value: this.envParams.terrain.colorVariation },
      uGlobalSeed: { value: this.envParams.random.seed },
      uPlayerPos: { value: new THREE.Vector3() },
      uInteractionRadius: { value: 1.5 },
      uInteractionStrength: { value: 0.8 },
      uMudTex: { value: this.mudTex },
      uForestTex: { value: this.forestTex },
      uForestTexScale: { value: this.envParams.terrain.forestTexScale },
      uMudTexScale: { value: this.envParams.terrain.mudTexScale }
    };

    // --- Dynamic Texture Layer Discovery ---
    this.terrainLayers = [
      { name: 'forest_ground', tex: this.forestTex, scale: this.envParams.terrain.forestTexScale },
      { name: 'brown_mud', tex: this.mudTex, scale: this.envParams.terrain.mudTexScale }
    ];

    this.sharedMaterial = new THREE.ShaderMaterial({
      uniforms: this.envUniforms,
      vertexShader,
      fragmentShader,
    });

    this.vegManager = new VegetationManager(
      scene,
      this.calculateHeight.bind(this),
      envParams
    );

    this.vegManager.loadModels().then(() => {
      this.update(new THREE.Vector3());
    });

    this.grassManager = new GrassManager(this.scene);
    this.grassLODManager = new GrassLODManager(this.grassManager);
  }

  getGeometry(segments) {
    if (!this.geometryCache[segments]) {
      const geo = new THREE.PlaneGeometry(
        this.chunkSize,
        this.chunkSize,
        segments,
        segments
      );
      geo.rotateX(-Math.PI / 2);
      this.geometryCache[segments] = geo;
    }
    return this.geometryCache[segments];
  }

  refreshChunks() {
    for (const chunk of this.chunks.values()) {
      chunk.dispose();
    }
    this.chunks.clear();
    this.update(this.camera.position);
  }

  regenerateFromSplines() {
    for (const chunk of this.chunks.values()) {
      chunk.regenerateFromSplines();
    }
  }

  updateChunksInBounds(bounds) {
    for (const chunk of this.chunks.values()) {
      if (this.chunkIntersectsBounds(chunk, bounds)) {
        chunk.regenerateFromSplines();
      }
    }
  }

  chunkIntersectsBounds(chunk, bounds) {
    const halfSize = this.chunkSize / 2;
    const minX = chunk.x - halfSize;
    const maxX = chunk.x + halfSize;
    const minZ = chunk.z - halfSize;
    const maxZ = chunk.z + halfSize;

    if (maxX < bounds.minX || minX > bounds.maxX || maxZ < bounds.minZ || minZ > bounds.maxZ) {
      return false;
    }
    return true;
  }

  calculateHeight(x, z) {
    let p = this.envParams.terrain;
    
    if (this.noiseBrushManager) {
        p = this.noiseBrushManager.getBlendedMicroParams(x, z, p);
    }

    const flowX = this.noise2D(x * p.warpFreq, z * p.warpFreq);
    const flowZ = this.noise2D(x * p.warpFreq + 10.0, z * p.warpFreq + 10.0);

    const warpedX = x + flowX * p.warpStrength;
    const warpedZ = z + flowZ * p.warpStrength;

    const base = this.noise2D(x * p.baseFreq, z * p.baseFreq) * p.baseAmp;

    const erosion = this.noise2D(warpedX * p.erosionFreq, warpedZ * p.erosionFreq) * p.erosionAmp;

    const mid = this.noise2D(x * p.midFreq, z * p.midFreq) * p.midAmp;

    const detail = this.noise2D(x * p.detailFreq, z * p.detailFreq) * p.detailAmp;

    let height = (base + erosion + mid + detail) * p.microHeight * p.heightMult;

    if (this.noiseBrushManager) {
        let mask = this.noiseBrushManager.getMaskAt(x, z);
        height *= mask;
    }

    return height;
  }


  calculatePathNoise(x, z) {
    const l = this.envParams.lowland;
    return this.noise2D(x * l.hillFreq, z * l.hillFreq) * 0.5 + 0.5;
  }

  prefillHeightmap() {
    const half = this.worldSize / 2;
    for (let z = 0; z < this.gridDepth; z++) {
      for (let x = 0; x < this.gridWidth; x++) {
        const worldX = x * this.resolution - half;
        const worldZ = z * this.resolution - half;
        this.heightmap[z * this.gridWidth + x] = this.getHeight(worldX, worldZ);
      }
    }
  }

  _chunkHasSplineInfluence(chunkX, chunkZ) {
    if (!this.terrainSplineManager) return false;
    const splines = this.terrainSplineManager.getSplines();
    if (!splines.length) return false;

    const half = this.chunkSize / 2;
    const cMinX = chunkX - half, cMaxX = chunkX + half;
    const cMinZ = chunkZ - half, cMaxZ = chunkZ + half;

    for (const spline of splines) {
      const b = spline.bounds;
      if (!b) continue;
      if (cMaxX >= b.minX && cMinX <= b.maxX &&
        cMaxZ >= b.minZ && cMinZ <= b.maxZ) {
        return true;
      }
    }
    return false;
  }

  getHeight(x, z) {
    let h = this.calculateHeight(x, z);
    if (this.terrainSplineManager) {
      h += this.terrainSplineManager.getCachedSplineHeight(x, z);
    }
    return h;
  }

  getTerrainNormal(x, z) {
    const eps = 0.5;
    const hL = this.getHeight(x - eps, z);
    const hR = this.getHeight(x + eps, z);
    const hD = this.getHeight(x, z - eps);
    const hU = this.getHeight(x, z + eps);
    const dx = hR - hL;
    const dz = hU - hD;
    return new THREE.Vector3(-dx, 2.0, -dz).normalize();
  }

  update(playerPosition) {
    this.envUniforms.uCameraPos.value.copy(this.camera.position);
    this.envUniforms.uLightDir.value
      .copy(this.envUniforms.uSunPos.value)
      .normalize();

    if (this.grassManager) {
      this.grassManager.sharedUniforms.uTime.value = this.envUniforms.uTime.value;
      this.grassManager.sharedUniforms.uPlayerPos.value.copy(this.envUniforms.uPlayerPos.value);
      this.grassManager.sharedUniforms.uInteractionRadius.value = this.envUniforms.uInteractionRadius.value;
      this.grassManager.sharedUniforms.uInteractionStrength.value = this.envUniforms.uInteractionStrength.value;
    }

    this.envUniforms.uColorVariation.value = this.envParams.terrain.colorVariation;
    this.envUniforms.uDirtIntensity.value = this.envParams.terrain.dirtIntensity;
    this.envUniforms.uForestTexScale.value = this.envParams.terrain.forestTexScale;
    this.envUniforms.uMudTexScale.value = this.envParams.terrain.mudTexScale;
    this.envUniforms.uGlobalSeed.value = this.envParams.random.seed;

    this.envUniforms.uInteractionRadius.value = this.envParams.interaction.radius;
    this.envUniforms.uInteractionStrength.value = this.envParams.interaction.strength;

    // Propagate all dynamic uniforms to individual chunk materials
    for (const chunk of this.chunks.values()) {
      if (!chunk.material) continue;
      const u = chunk.material.uniforms;

      // Vectors
      if (u.uCameraPos) u.uCameraPos.value.copy(this.camera.position);
      if (u.uLightDir) u.uLightDir.value.copy(this.envUniforms.uLightDir.value);
      if (u.uPlayerPos) u.uPlayerPos.value.copy(this.envUniforms.uPlayerPos.value);
      if (u.uSunPos) u.uSunPos.value.copy(this.envUniforms.uSunPos.value);

      // Floats and Configs
      if (u.uTime) u.uTime.value = this.envUniforms.uTime.value;
      if (u.uColorVariation) u.uColorVariation.value = this.envParams.terrain.colorVariation;
      if (u.uDirtIntensity) u.uDirtIntensity.value = this.envParams.terrain.dirtIntensity;
      if (u.uGlobalSeed) u.uGlobalSeed.value = this.envParams.random.seed;
      if (u.uInteractionRadius) u.uInteractionRadius.value = this.envParams.interaction.radius;
      if (u.uInteractionStrength) u.uInteractionStrength.value = this.envParams.interaction.strength;

      // Texture Scales
      if (u.uLayer0Scale) u.uLayer0Scale.value = this.envParams.terrain.forestTexScale;
      if (u.uLayer1Scale) u.uLayer1Scale.value = this.envParams.terrain.mudTexScale;
    }

    const projScreenMatrix = new THREE.Matrix4();
    projScreenMatrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    const frustum = new THREE.Frustum();
    frustum.setFromProjectionMatrix(projScreenMatrix);

    const currX = Math.floor(playerPosition.x / this.chunkSize);
    const currZ = Math.floor(playerPosition.z / this.chunkSize);
    const radius = this.envParams.terrain.renderDist;

    const active = new Set();

    for (let x = currX - radius; x <= currX + radius; x++) {
      for (let z = currZ - radius; z <= currZ + radius; z++) {
        const key = `${x},${z}`;
        active.add(key);

        const chunkX = x * this.chunkSize;
        const chunkZ = z * this.chunkSize;

        this.tempVec.set(chunkX, 0, chunkZ);
        const dist = playerPosition.distanceTo(this.tempVec);

        let lod = 16;
        if (dist < this.envParams.terrain.lodDistNear) lod = 64;
        else if (dist < this.envParams.performance.lodFar) lod = 32;

        if (this.isEditing) lod = Math.min(lod, 32);

        if (this._chunkHasSplineInfluence(chunkX, chunkZ)) {
          lod = 64;
        }

        const existing = this.chunks.get(key);

        if (!existing) {
          const chunk = new TerrainChunk(this, chunkX, chunkZ, lod);
          this.chunks.set(key, chunk);
          this.initQueue.push(chunk);
        } else if (existing.segments !== lod) {
          if (!this._chunkHasSplineInfluence(chunkX, chunkZ)) {
            existing.dispose();
            const chunk = new TerrainChunk(this, chunkX, chunkZ, lod);
            this.chunks.set(key, chunk);
            this.initQueue.push(chunk);
          }
        }
      }
    }

    // --- Process Initialization Queue (1 chunk per frame to avoid jank) ---
    if (this.initQueue.length > 0) {
      // Prioritize chunks closest to player
      this.initQueue.sort((a, b) => {
        const da = playerPosition.distanceToSquared(this.tempVec.set(a.x, 0, a.z));
        const db = playerPosition.distanceToSquared(this.tempVec.set(b.x, 0, b.z));
        return da - db;
      });

      const chunkToInit = this.initQueue.shift();
      if (chunkToInit) {
        chunkToInit.init();
      }
    }

    this.updateFrameOffset++;
    let chunkIndex = 0;

    for (const [key, chunk] of this.chunks) {
      if (!active.has(key)) {
        chunk.dispose();
        this.chunks.delete(key);
      } else {
        chunkIndex++;
        chunk.quickFrustumCheck(frustum);

        if (chunk.mesh && chunk.mesh.visible && (chunkIndex % 4 === this.updateFrameOffset % 4)) {
          chunk.updateLOD(playerPosition, null);
        }
      }
    }
  }
}
