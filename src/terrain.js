// src/terrain.js
import * as THREE from "three";
import Rapier from "@dimforge/rapier3d-compat";
import vertexShader from "./shaders/terrain_vert.glsl?raw";
import fragmentShader from "./shaders/terrain_frag.glsl?raw";
import { VegetationManager } from "./environment/vegetation-manager.js";
import { GrassManager, GRASS_VARIATIONS } from "./environment/GrassManager.js";
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

    this.init();
  }

  init() {
    const geometry = this.manager.getGeometry(this.segments).clone();

    this.mesh = new THREE.Mesh(geometry, this.manager.sharedMaterial);
    this.mesh.position.set(this.x, 0, this.z);

    // Shadows removed

    this.manager.scene.add(this.mesh);

    this.generateHeightCPU(geometry);

    this.tryCreatePhysics();
    this.spawnVegetation();
  }

  generateHeightCPU(geometry) {
    const pos = geometry.attributes.position;
    const size = this.manager.chunkSize;
    const half = size / 2;

    // --- 1. Generate terrain height (same as before)
    for (let i = 0; i < pos.count; i++) {
      const localX = pos.getX(i);
      const localZ = pos.getZ(i);
      const worldX = this.x + localX;
      const worldZ = this.z + localZ;

      pos.setY(i, this.manager.getHeight(worldX, worldZ));
    }

    // --- 2. Add SKIRTS (THIS FIXES THE CRACKS)
    const skirtDepth = 10; // increase if gaps still visible
    const vertices = [];

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);

      // Detect edge vertices
      const isEdge =
        Math.abs(x + half) < 0.001 ||
        Math.abs(x - half) < 0.001 ||
        Math.abs(z + half) < 0.001 ||
        Math.abs(z - half) < 0.001;

      if (isEdge) {
        // duplicate vertex but pushed down
        vertices.push(x, y - skirtDepth, z);
      }
    }

    // Append skirt vertices
    if (vertices.length > 0) {
      const newArray = new Float32Array(pos.array.length + vertices.length);
      newArray.set(pos.array);
      newArray.set(vertices, pos.array.length);

      geometry.setAttribute("position", new THREE.BufferAttribute(newArray, 3));
    }

    // --- 3. Recompute normals
    geometry.computeVertexNormals();
    geometry.attributes.position.needsUpdate = true;
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
    if (!models || models.length === 0) return;

    const idx = Math.min(obj.modelIndex ?? 0, models.length - 1);
    const modelData = models[idx];
    if (!modelData) return;

    const group = new THREE.Group();

    if (modelData.meshes) {
      modelData.meshes.forEach(sub => {
        const mesh = new THREE.Mesh(sub.geometry, sub.material);
        // Shadows removed
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
    if (!this.manager.grassManager) return;

    // Get params from variation if not already set
    const varParams = GRASS_VARIATIONS[data.variation] || GRASS_VARIATIONS['light_wind'];
    const mergedParams = { ...varParams, ...data.params };

    const mesh = this.manager.grassManager.createGrassPatch(mergedParams);
    mesh.position.set(data.position[0], data.position[1], data.position[2]);
    mesh.rotation.set(data.rotation[0], data.rotation[1], data.rotation[2]);
    mesh.scale.set(data.scale[0], data.scale[1], data.scale[2]);

    mesh.userData.isGrassPatch = true;
    mesh.userData.placedObjectData = data;

    this.manager.scene.add(mesh);
    this.placedGrass.push({ data: data, mesh: mesh });
  }

  removeGrassPatch(data) {
    const idx = this.placedGrass.findIndex(pg => pg.data === data);
    if (idx !== -1) {
      this.manager.scene.remove(this.placedGrass[idx].mesh);
      this.placedGrass.splice(idx, 1);
    }
  }

  dispose() {
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
        return;
      }
    }

    this.mesh.visible = true;
    this.placedObjects.forEach(po => po.mesh.visible = true);

    const p = this.manager.envParams;
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

    this.noise2D = createNoise2D(this.rng);

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

    return (n1 * l.baseAmp + n2 * l.hillAmp + n3 * l.detailAmp) * p.heightMult;
  }

  /**
   * Full height (used by character physics, etc.).
   * @param {number} x
   * @param {number} z
   */
  getHeight(x, z) {
    if (this.terrainSplineManager) {
      return this.terrainSplineManager.evaluateHeight(x, z);
    }
    return this.calculateHeight(x, z);
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
        if (dist < this.envParams.terrain.lodDistNear) lod = 128;
        else if (dist < this.envParams.performance.lodFar) lod = 64;

        const existing = this.chunks.get(key);

        if (!existing) {
          this.chunks.set(key, new TerrainChunk(this, chunkX, chunkZ, lod));
        } else if (existing.segments !== lod) {
          existing.dispose();
          this.chunks.set(key, new TerrainChunk(this, chunkX, chunkZ, lod));
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

