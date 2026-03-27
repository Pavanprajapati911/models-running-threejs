// src/terrain.js
import * as THREE from "three";
import Rapier from "@dimforge/rapier3d-compat";
import vertexShader from "./shaders/terrain_vert.glsl?raw";
import fragmentShader from "./shaders/terrain_frag.glsl?raw";
import { VegetationManager } from "./environment/vegetation-manager.js";
import alea from "alea";
import { createNoise2D } from "simplex-noise";





export class TerrainChunk {
  constructor(x, z, size, segments, scene, world, envUniforms, envParams, calculateHeight, vegManager, placedObjectManager) {
    this.x = x;
    this.z = z;
    this.size = size;
    this.segments = segments;
    this.scene = scene;
    this.world = world;
    this.envUniforms = envUniforms;
    this.envParams = envParams;
    this.calculateHeight = calculateHeight;
    this.vegManager = vegManager;
    this.placedObjectManager = placedObjectManager;
    this.vegetation = [];
    this.placedObjects = [];

    this.mesh = null;
    this.collider = null;
    this.body = null;

    this.init();
  }

  init() {
    // 1. Geometry with Skirts
    const geometry = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
    geometry.rotateX(-Math.PI / 2);
    
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const localX = pos.getX(i);
        const localZ = pos.getZ(i);
        const worldX = this.x + localX;
        const worldZ = this.z + localZ;
        
        let y = this.calculateHeight(worldX, worldZ);
        
        pos.setY(i, y);
    }

    
    geometry.computeVertexNormals();

    const material = new THREE.ShaderMaterial({
      uniforms: {
        mossyGrassTex: this.envParams.textures.mossyGrass,
        wildGrassTex: this.envParams.textures.wildGrass,
        forestFloorTex: this.envParams.textures.forestFloor,
        soilGroundTex: this.envParams.textures.soilGround,
        dirtGroundTex: this.envParams.textures.dirtGround,
        forestPathTex: this.envParams.textures.forestPath,
        rockTex: this.envParams.textures.rock,
        uTextureScale: { value: this.envParams.terrain.texScale },
        uLightingIntensity: { value: this.envParams.terrain.intensity },
        uSpecularStrength: { value: this.envParams.terrain.specular },
        uLightDir: { value: new THREE.Vector3() },
        uLightColor: { value: new THREE.Color(1, 1, 1) },
        uCameraPos: { value: new THREE.Vector3() },
        uFogNear: this.envUniforms.uFogNear,
        uFogFar: this.envUniforms.uFogFar,
        uFogColor: this.envUniforms.uFogColor,
        uTime: this.envUniforms.uTime,
        uGrassStrength: { value: this.envParams.terrain.grassTextureStrength },
        uDirtStrength: { value: this.envParams.terrain.dirtTextureStrength },
        uPathStrength: { value: this.envParams.terrain.pathStrength },
        uShowBiomeDebug: this.envUniforms.uShowBiomeDebug,
        uDryThreshold: this.envUniforms.uDryThreshold,
        uGrassThreshold: this.envUniforms.uGrassThreshold,
        uForestThreshold: this.envUniforms.uForestThreshold,
        uBiomeScale: { value: this.envParams.biome.scale },
        uGlobalSeed: { value: this.envParams.random.seed },
      },
      vertexShader,
      fragmentShader,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.receiveShadow = true;
    this.scene.add(this.mesh);

    // 2. Physics (Only for HIGH LOD chunks within small radius if needed, or all)
    // Use GUI LOD distance if enabled
    const lodThreshold = this.envParams.performance.enableLOD ? 64 : 16;
    if (this.segments >= lodThreshold) {
        this.createPhysics(geometry);
        this.spawnVegetation();
    }
  }

  spawnVegetation() {
      if (!this.vegManager) return;
      
      // Procedural Mode
      if (this.envParams.mode && this.envParams.mode.type === "procedural") {
          const instances = this.vegManager.getVegetationForChunk(this.x, this.z, this.size);
          instances.forEach(mesh => {
              mesh.position.set(this.x, 0, this.z);
              this.scene.add(mesh);
              this.vegetation.push(mesh);
          });
      }

      // Static Objects (Runtime/Editor)
      if (this.placedObjectManager) {
          const cx = Math.floor(this.x / this.size);
          const cz = Math.floor(this.z / this.size);
          const objects = this.placedObjectManager.getObjectsForChunk(cx, cz);
          objects.forEach(obj => this.spawnPlacedObject(obj));
      }

  }

  spawnPlacedObject(obj) {
      const models = this.vegManager.models.get(obj.type) || this.vegManager.models.get("jungleTrees");
      if (!models || models.length === 0) return;

      // Use the stored modelIndex, clamp to array bounds gracefully
      const idx = Math.min(obj.modelIndex ?? 0, models.length - 1);
      const modelData = models[idx];

      if (!modelData) return; // Prevent crashes if model failed to load or index is invalid

      const group = new THREE.Group();

      if (modelData.meshes) {
        modelData.meshes.forEach(sub => {
          const mesh = new THREE.Mesh(sub.geometry, sub.material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          group.add(mesh);
        });
      }

      group.position.set(obj.position[0], obj.position[1], obj.position[2]);
      group.rotation.set(obj.rotation[0], obj.rotation[1], obj.rotation[2]);
      group.scale.set(obj.scale[0], obj.scale[1], obj.scale[2]);

      group.userData.isPlacedObject = true;
      group.userData.placedObjectData = obj;

      this.scene.add(group);
      this.placedObjects.push({ data: obj, mesh: group });
  }


  removePlacedObject(obj) {
      const idx = this.placedObjects.findIndex(po => po.data === obj);
      if (idx !== -1) {
          this.scene.remove(this.placedObjects[idx].mesh);
          this.placedObjects.splice(idx, 1);
      }
  }

  createPhysics(geometry) {
    const vertices = geometry.attributes.position.array;
    const indices = geometry.index.array;
    const bodyDesc = Rapier.RigidBodyDesc.fixed().setTranslation(this.x, 0, this.z);
    this.body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = Rapier.ColliderDesc.trimesh(
      new Float32Array(vertices),
      new Uint32Array(indices)
    ).setFriction(1);
    this.collider = this.world.createCollider(colliderDesc, this.body);
  }

  dispose() {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.scene.remove(this.mesh);
    }
    this.vegetation.forEach(mesh => {
        mesh.geometry.dispose();
        mesh.material.dispose();
        this.scene.remove(mesh);
    });
    this.vegetation = [];
    this.placedObjects.forEach(po => {
        this.scene.remove(po.mesh);
    });
    this.placedObjects = [];

    if (this.collider) {
      this.world.removeCollider(this.collider, true);
    }
    if (this.body) {
        this.world.removeRigidBody(this.body);
    }
  }
}

export class ChunkManager {
  constructor(scene, world, camera, noise2D, envUniforms, envParams, placedObjectManager) {
    this.scene = scene;
    this.world = world;
    this.camera = camera;
    this.noise2D = noise2D; // Initial one, will be replaced by seeded
    this.rng = alea(envParams.random.seed);
    this.noise2D_seeded = createNoise2D(this.rng);
    this.envUniforms = envUniforms;
    this.envParams = envParams;
    this.placedObjectManager = placedObjectManager;

    this.vegManager = new VegetationManager(scene, this.calculateHeight.bind(this), envParams);
    this.vegManager.loadModels().then(() => {
        this.refreshChunks();
    });

    this.chunks = new Map();
    this.chunkSize = envParams.terrain.chunkSize;
    this.needsRefresh = false;
    
    // Initial textures (need to be loaded in main and passed)
    const loader = new THREE.TextureLoader();
    this.envParams.textures = {
        mossyGrass: { value: loader.load("/textures/mossy_grass/Mossy_Grass_vcjmej0s_2K_BaseColor.jpg") },
        wildGrass: { value: loader.load("/textures/wild_grass/Wild_Grass_sfknaeoa_2K_BaseColor.jpg") },
        forestFloor: { value: loader.load("/textures/forest_floor/Forest_Floor_vktfeilaw_2K_BaseColor.jpg") },
        soilGround: { value: loader.load("/textures/soil_ground/Soil_Ground_xdhhdhl_2K_BaseColor.jpg") },
        dirtGround: { value: loader.load("/textures/dirt_ground/Dirt_Ground_xdhhdgq_2K_BaseColor.jpg") },
        forestPath: { value: loader.load("/textures/forest_path/Forest_Path_ugsnfawlw_2K_BaseColor.jpg") },
        rock: { value: loader.load("/textures/two_k/rock.jpg") }
    };
    Object.values(this.envParams.textures).forEach(t => {
        t.value.wrapS = t.value.wrapT = THREE.RepeatWrapping;
        t.value.anisotropy = 16;
    });



    this.update(new THREE.Vector3(0, 0, 0));
  }

  refreshChunks() {
      this.needsRefresh = true;
  }


  calculateHeight(x, z) {
    const params = this.envParams.terrain;
    const lowland = this.envParams.lowland;
    
    // Layer 1: Large scale smooth elevation changes
    const n1 = this.noise2D_seeded(x * lowland.baseFreq, z * lowland.baseFreq);
    const base = n1 * lowland.baseAmp;
    
    // Layer 2: Medium scale gentle rolling hills
    const n2 = this.noise2D_seeded(x * lowland.hillFreq, z * lowland.hillFreq);
    const hills = n2 * lowland.hillAmp;
    
    // Layer 3: Small scale surface detail
    const n3 = this.noise2D_seeded(x * lowland.detailFreq, z * lowland.detailFreq);
    const detail = n3 * lowland.detailAmp;
    
    // Combine layers
    const finalH = base + hills + detail;

    return finalH * params.heightMult;
  }

  update(playerPosition) {
    if (this.needsRefresh) {
        this.needsRefresh = false;
        for (const chunk of this.chunks.values()) {
            chunk.dispose();
        }
        this.chunks.clear();
    }


    const currX = Math.floor(playerPosition.x / this.chunkSize);
    const currZ = Math.floor(playerPosition.z / this.chunkSize);
    const radius = this.envParams.terrain.renderDist;

    const activeKeys = new Set();

    for (let x = currX - radius; x <= currX + radius; x++) {
      for (let z = currZ - radius; z <= currZ + radius; z++) {
        const key = `${x},${z}`;
        activeKeys.add(key);

        const chunkX = x * this.chunkSize;
        const chunkZ = z * this.chunkSize;
        const dist = playerPosition.distanceTo(new THREE.Vector3(chunkX, 0, chunkZ));

        let lod = 16;
        if (dist < this.envParams.terrain.lodDistNear) lod = 128;
        else if (dist < this.envParams.performance.lodFar) lod = 64;

        if (!this.chunks.has(key)) {
          this.chunks.set(key, new TerrainChunk(chunkX, chunkZ, this.chunkSize, lod, this.scene, this.world, this.envUniforms, this.envParams, this.calculateHeight.bind(this), this.vegManager, this.placedObjectManager));
        } else {
            // Check for LOD change
            const chunk = this.chunks.get(key);
            if (chunk.segments !== lod) {
                chunk.dispose();
                this.chunks.set(key, new TerrainChunk(chunkX, chunkZ, this.chunkSize, lod, this.scene, this.world, this.envUniforms, this.envParams, this.calculateHeight.bind(this), this.vegManager, this.placedObjectManager));
            }
        }
      }
    }

    // Unload distant chunks
    for (const [key, chunk] of this.chunks) {
      if (!activeKeys.has(key) ) {
        chunk.dispose();
        this.chunks.delete(key);
      }
    }
    
    // Update uniforms for each chunk
    for (const chunk of this.chunks.values()) {
        chunk.mesh.material.uniforms.uCameraPos.value.copy(this.camera.position);
        chunk.mesh.material.uniforms.uLightDir.value.copy(this.envUniforms.uSunPos.value).normalize();
        chunk.mesh.material.uniforms.uTextureScale.value = this.envParams.terrain.texScale;
        chunk.mesh.material.uniforms.uGrassStrength.value = this.envParams.terrain.grassTextureStrength;
        chunk.mesh.material.uniforms.uDirtStrength.value = this.envParams.terrain.dirtTextureStrength;
        chunk.mesh.material.uniforms.uPathStrength.value = this.envParams.terrain.pathStrength;
        chunk.mesh.material.uniforms.uDryThreshold.value = this.envParams.biome.dryThreshold;
        chunk.mesh.material.uniforms.uGrassThreshold.value = this.envParams.biome.grassThreshold;
        chunk.mesh.material.uniforms.uForestThreshold.value = this.envParams.biome.forestThreshold;
        chunk.mesh.material.uniforms.uBiomeScale.value = this.envParams.biome.scale;
        chunk.mesh.material.uniforms.uGlobalSeed.value = this.envParams.random.seed;
    }
  }

  getHeight(x, z) {
      return this.calculateHeight(x, z);
  }
}

function mix(a, b, t) { return a * (1 - t) + b * t; }
function smoothstep(e0, e1, x) {
    const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
    return t * t * (3 - 2 * t);
}

