// src/terrain.js
import * as THREE from "three";
import Rapier from "@dimforge/rapier3d-compat";
import vertexShader from "./shaders/terrain_vert.glsl?raw";
import fragmentShader from "./shaders/terrain_frag.glsl?raw";



export class TerrainChunk {
  constructor(x, z, size, segments, scene, world, envUniforms, envParams, calculateHeight) {
    this.x = x;
    this.z = z;
    this.size = size;
    this.segments = segments;
    this.scene = scene;
    this.world = world;
    this.envUniforms = envUniforms;
    this.envParams = envParams;
    this.calculateHeight = calculateHeight;

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
        grassTex: this.envParams.textures.grass,
        dirtTex: this.envParams.textures.dirt,
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
      },
      vertexShader,
      fragmentShader,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.receiveShadow = true;
    this.scene.add(this.mesh);

    // 2. Physics (Only for HIGH LOD chunks within small radius if needed, or all)
    if (this.segments >= 64) {
        this.createPhysics(geometry);
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
    if (this.collider) {
      this.world.removeCollider(this.collider, true);
    }
    if (this.body) {
        this.world.removeRigidBody(this.body);
    }
  }
}

export class ChunkManager {
  constructor(scene, world, camera, noise2D, envUniforms, envParams) {
    this.scene = scene;
    this.world = world;
    this.camera = camera;
    this.noise2D = noise2D;
    this.envUniforms = envUniforms;
    this.envParams = envParams;

    this.chunks = new Map();
    this.chunkSize = envParams.terrain.chunkSize;
    
    // Initial textures (need to be loaded in main and passed)
    const loader = new THREE.TextureLoader();
    this.envParams.textures = {
        grass: { value: loader.load("/textures/two_k/coast_sand_rocks.jpg") },
        dirt: { value: loader.load("/textures/two_k/dirt.jpg") },
        rock: { value: loader.load("/textures/two_k/rock.jpg") }
    };
    Object.values(this.envParams.textures).forEach(t => {
        t.value.wrapS = t.value.wrapT = THREE.RepeatWrapping;
    });



    this.update(new THREE.Vector3(0, 0, 0));
  }


  calculateHeight(x, z) {
    const params = this.envParams.terrain;
    const lowland = this.envParams.lowland;
    
    // Layer 1: Large scale smooth elevation changes
    const n1 = this.noise2D(x * lowland.baseFreq, z * lowland.baseFreq);
    const base = n1 * lowland.baseAmp;
    
    // Layer 2: Medium scale gentle rolling hills
    const n2 = this.noise2D(x * lowland.hillFreq, z * lowland.hillFreq);
    const hills = n2 * lowland.hillAmp;
    
    // Layer 3: Small scale surface detail
    const n3 = this.noise2D(x * lowland.detailFreq, z * lowland.detailFreq);
    const detail = n3 * lowland.detailAmp;
    
    // Combine layers
    const finalH = base + hills + detail;

    return finalH * params.heightMult;
  }

  update(playerPosition) {
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
        else if (dist < this.envParams.terrain.lodDistMid) lod = 64;

        if (!this.chunks.has(key)) {
          this.chunks.set(key, new TerrainChunk(chunkX, chunkZ, this.chunkSize, lod, this.scene, this.world, this.envUniforms, this.envParams, this.calculateHeight.bind(this)));
        } else {
            // Check for LOD change
            const chunk = this.chunks.get(key);
            if (chunk.segments !== lod) {
                chunk.dispose();
                this.chunks.set(key, new TerrainChunk(chunkX, chunkZ, this.chunkSize, lod, this.scene, this.world, this.envUniforms, this.envParams, this.calculateHeight.bind(this)));
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

