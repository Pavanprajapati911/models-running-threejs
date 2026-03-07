// src/terrain.js
import * as THREE from "three";
import Rapier from "@dimforge/rapier3d-compat";
import { createNoise2D } from "simplex-noise";

export class InfiniteTerrain {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.noise2D = createNoise2D();

    const size = 80;
    const segments = 80;

    /* ---------------- TERRAIN GEOMETRY ---------------- */

    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const pos = geometry.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);

      const dist = Math.sqrt(x * x + z * z) / (size * 0.5);
      const falloff = 1 - Math.min(dist, 1);

      const n1 = this.noise2D(x * 0.04, z * 0.04);
      const n2 = this.noise2D(x * 0.08, z * 0.08) * 0.5;
      const n3 = this.noise2D(x * 0.2, z * 0.2) * 0.25;

      const noise = n1 + n2 + n3;
      const height = noise * falloff * 6;

      pos.setY(i, height);
    }

    geometry.computeVertexNormals();

    const loader = new THREE.TextureLoader();

    const grassTex = loader.load("/textures/four_k/coast_sand_rocks.jpg");
    const dirtTex = loader.load("/textures/four_k/dirt.jpg");
    const rockTex = loader.load("/textures/four_k/rock.jpg");

    grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
    dirtTex.wrapS = dirtTex.wrapT = THREE.RepeatWrapping;
    rockTex.wrapS = rockTex.wrapT = THREE.RepeatWrapping;

    /* ---------------- TERRAIN MATERIAL ---------------- */

    // const material = new THREE.MeshStandardMaterial({
    //   color: 0x4f7f3f,
    //   roughness: 1,
    // });
    const material = new THREE.ShaderMaterial({
      uniforms: {
        grassTex: { value: grassTex },
        dirtTex: { value: dirtTex },
        rockTex: { value: rockTex },
      },

      vertexShader: `
    varying float vHeight;
    varying vec3 vNormal;
    varying vec2 vUv;

    void main() {

      vHeight = position.y;
      vNormal = normal;
      vUv = uv;

      gl_Position = projectionMatrix *
                    modelViewMatrix *
                    vec4(position,1.0);
    }
  `,

      fragmentShader: `
    uniform sampler2D grassTex;
    uniform sampler2D dirtTex;
    uniform sampler2D rockTex;

    varying float vHeight;
    varying vec3 vNormal;
    varying vec2 vUv;

    void main(){

      // tile textures
      vec2 uv = vUv * 10.0;

      vec3 grass = texture2D(grassTex, uv).rgb;
      vec3 dirt  = texture2D(dirtTex, uv).rgb;
      vec3 rock  = texture2D(rockTex, uv).rgb;

      float slope = 1.0 - vNormal.y;

      vec3 color;

      if(vHeight < 0.5){
        color = grass;
      }
      else if(vHeight < 2.0){
        color = mix(grass, dirt, (vHeight - 0.5) / 1.5);
      }
      else{
        color = mix(dirt, rock, (vHeight - 2.0) / 1.5);
      }

      // steep slopes become rock
      if(slope > 0.5){
        color = mix(color, rock, slope);
      }

      gl_FragColor = vec4(color, 1.0);
    }
  `,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    /* ---------------- SIMPLE WATER ---------------- */

    const waterGeo = new THREE.PlaneGeometry(size * 8, size * 8);

    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x0066ff,
      transparent: true,
      opacity: 0.8,
      roughness: 0.3,
      metalness: 0.2,
    });

    // const waterMat = new THREE.MeshPhysicalMaterial({
    //   color: 0x3aa7ff,
    //   transparent: true,
    //   opacity: 0.85,
    //   roughness: 0.04,
    //   metalness: 0.1,
    //   transmission: 0.4,
    //   thickness: 0.3,
    // });

    this.water = new THREE.Mesh(waterGeo, waterMat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = -2; // water level

    scene.add(this.water);

    /* ---------------- TRIMESH COLLIDER ---------------- */

    const vertices = geometry.attributes.position.array;
    const indices = geometry.index.array;

    const bodyDesc = Rapier.RigidBodyDesc.fixed();
    const body = world.createRigidBody(bodyDesc);

    const colliderDesc = Rapier.ColliderDesc.trimesh(
      new Float32Array(vertices),
      new Uint32Array(indices),
    ).setFriction(1);

    world.createCollider(colliderDesc, body);
  }

  getHeight(x, z) {
    const size = 80;

    const dist = Math.sqrt(x * x + z * z) / (size * 0.5);
    const falloff = 1 - Math.min(dist, 1);

    const n1 = this.noise2D(x * 0.04, z * 0.04);
    const n2 = this.noise2D(x * 0.08, z * 0.08) * 0.5;
    const n3 = this.noise2D(x * 0.2, z * 0.2) * 0.25;

    const noise = n1 + n2 + n3;

    return noise * falloff * 6;
  }
}
