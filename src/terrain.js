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

    this.init();
  }

  init() {
    const geometry = this.manager.getGeometry(this.segments).clone();

    this.mesh = new THREE.Mesh(geometry, this.manager.sharedMaterial);
    this.mesh.position.set(this.x, 0, this.z);

    this.manager.scene.add(this.mesh);

    this.generateHeightCPU(geometry);

    // --- DEBUG VISUALS ---
    /*
    this.debugGroup = new THREE.Group();
    this.debugGroup.position.set(this.x, 0, this.z);
    
    // Center circle
    const circleGeo = new THREE.CircleGeometry(2, 16);
    circleGeo.rotateX(-Math.PI / 2);
    const circleMat = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide });
    const circleMesh = new THREE.Mesh(circleGeo, circleMat);
    const centerH = this.manager.getHeight(this.x, this.z);
    circleMesh.position.y = centerH + 0.5;
    this.debugGroup.add(circleMesh);

    // Border
    const s = this.manager.chunkSize;
    const borderGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-s/2, 0, -s/2),
        new THREE.Vector3(s/2, 0, -s/2),
        new THREE.Vector3(s/2, 0, s/2),
        new THREE.Vector3(-s/2, 0, s/2),
        new THREE.Vector3(-s/2, 0, -s/2)
    ]);
    const pts = borderGeo.attributes.position;
    for(let i=0; i<pts.count; i++) {
        const h = this.manager.getHeight(this.x + pts.getX(i), this.z + pts.getZ(i));
        pts.setY(i, h + 0.5);
    }
    const borderMat = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2 });
    const borderLine = new THREE.Line(borderGeo, borderMat);
    this.debugGroup.add(borderLine);
    
    this.manager.scene.add(this.debugGroup);
    */
    // ---------------------

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

    // --- WORLD-SPACE NORMALS (seamless across chunk borders) ---
    // Instead of computeVertexNormals() which only samples within the chunk mesh,
    // we use the same getHeight() as the mesh itself. Adjacent chunks share the
    // same height function, so normals at shared edges are byte-identical.
    const eps = 0.5;

    // Ensure normal attribute exists and has correct item size
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

      // Central difference gives a normal pointing out of the surface
      const dx = (hR - hL) / (2 * eps);
      const dz = (hU - hD) / (2 * eps);
      // Normal: cross product of tangent vectors — simplified to (-dx, 1, -dz) normalised
      const len = Math.sqrt(dx * dx + 1.0 + dz * dz);
      normals.setXYZ(i, -dx / len, 1.0 / len, -dz / len);
    }

    normals.needsUpdate = true;
    pos.needsUpdate = true;
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
    const dist = this.manager.camera.position.distanceTo(this.mesh.position);
    if (dist > 200) return; // only near chunks

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

    // 1. Procedural Mode
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

    // 2. Editor / Runtime Mode (jungle.json)
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
        mesh.frustumCulled = false; // Prevent accidental culling
        group.add(mesh);
      });
    } else {
      console.warn(`[TerrainChunk] Model data for "${obj.type}" has no meshes!`, modelData);
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
    
    // Create lightweight proxy for selection
    const proxyMesh = this.manager.grassLODManager.createProxy(data);
    
    // Add to chunk data
    this.placedGrass.push({ data: data, mesh: proxyMesh });
    this.manager.scene.add(proxyMesh);

    // Rebuild proper batched LODs
    this.manager.grassLODManager.rebuildChunkLODs(this);
  }

  removeGrassPatch(data) {
    const idx = this.placedGrass.findIndex(pg => pg.data === data);
    if (idx !== -1) {
      this.manager.scene.remove(this.placedGrass[idx].mesh);
      this.placedGrass.splice(idx, 1);
      
      // Rebuild proper batched LODs
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

    // Grass LOD update
    if (this.grassLODs && this.mesh.visible) {
        this.grassLODs.high.visible = false;
        this.grassLODs.mid.visible = false;
        this.grassLODs.low.visible = false;

        if (window.DEBUG_GRASS_LOD) {
           console.log(`Chunk [${this.x},${this.z}] dist: ${Math.round(dist)}`);
        }

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
}

export class ChunkManager {
  /**
   * @param {THREE.Scene} scene
   * @param {*} world  Rapier physics world
   * @param {THREE.Camera} camera
   * @param {Function} noise2D  simplex noise function (unused — kept for API compat)
   * @param {Object} envUniforms
   * @param {Object} envParams
   * @param {import('./editor/PlacedObjectManager.js').PlacedObjectManager} placedObjectManager
   * @param {import('./editor/TerrainSplineManager.js').TerrainSplineManager} terrainSplineManager
   */
  constructor(scene, world, camera, noise2D, envUniforms, envParams, placedObjectManager, terrainSplineManager) {
    this.scene = scene;
    this.world = world;
    this.camera = camera;

    this.envUniforms = envUniforms;
    this.envParams = envParams;
    this.placedObjectManager = placedObjectManager;
    this.terrainSplineManager = terrainSplineManager;

    this.chunkSize = envParams.terrain.chunkSize;
    this.chunks = new Map();

    this.tempVec = new THREE.Vector3();
    this.geometryCache = {};

    // Seeded noise
    this.rng = alea(envParams.random.seed);
    this.noise2D = createNoise2D(this.rng);

    // --- GLOBAL HEIGHTFIELD (Baking System) ---
    this.worldSize = 1024;
    this.resolution = 1.0; // 1 unit per pixel
    this.gridWidth = Math.floor(this.worldSize / this.resolution);
    this.gridDepth = Math.floor(this.worldSize / this.resolution);
    this.heightmap = new Float32Array(this.gridWidth * this.gridDepth);

    this.isEditing = false; // Flag for multi-res editing

    this.prefillHeightmap();

    // Merge envUniforms with terrain-specific uniforms
    this.envUniforms = {
      ...this.envUniforms,
      uLightDir: { value: new THREE.Vector3() },
      uLightColor: { value: new THREE.Color(1, 1, 1) },
      uCameraPos: { value: new THREE.Vector3() },
      uDirtIntensity: { value: this.envParams.terrain.dirtTextureStrength },
      uColorVariation: { value: this.envParams.terrain.grassTextureStrength },
      uGlobalSeed: { value: this.envParams.random.seed },
      uPlayerPos: { value: new THREE.Vector3() },
      uInteractionRadius: { value: 1.5 },
      uInteractionStrength: { value: 0.8 }
    };

    // ✅ SHARED MATERIAL (BIG WIN)
    this.sharedMaterial = new THREE.ShaderMaterial({
      uniforms: this.envUniforms,
      vertexShader,
      fragmentShader,
    });

    // Vegetation
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

  /** Returns the raw noise height (no splines) at world (x, z). */
  calculateHeight(x, z) {
    const p = this.envParams.terrain;
    const l = this.envParams.lowland;

    const n1 = this.noise2D(x * l.baseFreq, z * l.baseFreq);
    const n2 = this.noise2D(x * l.hillFreq, z * l.hillFreq);
    const n3 = this.noise2D(x * l.detailFreq, z * l.detailFreq);

    // 🔥 Reduce noise influence heavily
    const flatness = this.envParams.terrain.flatness ?? 0.02;

    return (n1 * l.baseAmp + n2 * l.hillAmp + n3 * l.detailAmp) * p.heightMult * flatness;
  }

  /**
   * Full height (used by character physics, etc.).
   * @param {number} x
   * @param {number} z
   */
  prefillHeightmap() {
    console.log(`🏔️ Initializing Global Heightmap: ${this.gridWidth}x${this.gridDepth}`);
    const half = this.worldSize / 2;
    for (let z = 0; z < this.gridDepth; z++) {
      for (let x = 0; x < this.gridWidth; x++) {
        const worldX = x * this.resolution - half;
        const worldZ = z * this.resolution - half;
        // Prefill including analytic contributions
        this.heightmap[z * this.gridWidth + x] = this.getHeight(worldX, worldZ);
      }
    }
  }
  /**
   * Returns true if the chunk at (chunkX, chunkZ) overlaps the influence
   * bounds of any active spline. Used to pin those chunks to maximum LOD
   * so camera distance never causes a resolution change \u2014 preventing
   * the spline deformation from visually shifting as the camera moves.
   */
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
      // AABB overlap test
      if (cMaxX >= b.minX && cMinX <= b.maxX &&
          cMaxZ >= b.minZ && cMinZ <= b.maxZ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Samples terrain height. Reads spline contribution from the pre-baked cache
   * (populated by TerrainSplineManager via Web Worker) for O(1) bilinear lookup.
   * Falls back to analytic getSplineEffect() only if cache is unavailable.
   */
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
    // ✅ GLOBAL uniform updates (ONCE)
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

    // Fast sync GUI params
    this.envUniforms.uColorVariation.value = this.envParams.terrain.grassTextureStrength;
    this.envUniforms.uDirtIntensity.value = this.envParams.terrain.dirtTextureStrength;
    this.envUniforms.uGlobalSeed.value = this.envParams.random.seed;

    // Interaction sync
    this.envUniforms.uInteractionRadius.value = this.envParams.interaction.radius;
    this.envUniforms.uInteractionStrength.value = this.envParams.interaction.strength;

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

        // --- MULTI-RESOLUTION EDIT MODE ---
        if (this.isEditing) lod = Math.min(lod, 32);

        // --- SPLINE LOCK: chunks intersecting splines keep high resolution ---
        // Prevents visual popping when camera moves (different vertex density
        // causes spline deformation to sample at different positions → visual shift).
        if (this._chunkHasSplineInfluence(chunkX, chunkZ)) {
          lod = 64; // pin to maximum resolution
        }

        const existing = this.chunks.get(key);

        if (!existing) {
          this.chunks.set(key, new TerrainChunk(this, chunkX, chunkZ, lod));
        } else if (existing.segments !== lod) {
          // Don't recreate chunks that are spline-pinned; they're already at max res
          if (!this._chunkHasSplineInfluence(chunkX, chunkZ)) {
            existing.dispose();
            this.chunks.set(key, new TerrainChunk(this, chunkX, chunkZ, lod));
          }
        }
      }
    }

    // Remove old chunks
    for (const [key, chunk] of this.chunks) {
      if (!active.has(key)) {
        chunk.dispose();
        this.chunks.delete(key);
      } else {
        // Frustum & Density Culling
        chunk.updateLOD(playerPosition, frustum);
      }
    }
  }

}


