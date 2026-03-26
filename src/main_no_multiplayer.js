import * as THREE from "three";
import { Character } from "./entities/character.js";

import Rapier from "@dimforge/rapier3d-compat";
import { Interior } from "./entities/interior.js";
import { InvisibleMesh } from "./entities/invisible_mesh.js";
import { ThreePerf } from "three-perf";
import { FogSystem } from "./environment/fog-system.js";
import { StealthMap } from "./environment/stealth-map.js";
import GUI from "lil-gui";
import skyVert from "./shaders/sky_vert.glsl?raw";
import skyFrag from "./shaders/sky_frag.glsl?raw";
import { ChunkManager } from "./terrain.js";
import { createNoise2D } from "simplex-noise";

const gui = new GUI();
const envParams = {
  sun: {
    intensity: 2.0,
    color: 0xffffff,
    pos: new THREE.Vector3(50, 100, 50),
    glowIntensity: 1.8,
    glowSize: 20
  },
  sky: {
    zenith: 0x0055ff,
    horizon: 0x88ccff
  },

  fog: {
    near: 1,
    far: 200,
    color: 0xaaccff
  },
  terrain: {
    texScale: 10.0,
    intensity: 1.0,
    specular: 0.5,
    chunkSize: 50.0,
    renderDist: 3, // 3x3 or 5x5 chunks
    lodDistNear: 60.0,
    lodDistMid: 120.0,
    heightMult: 8.0,
    grassTextureStrength: 1.0,
    dirtTextureStrength: 1.0,
    pathStrength: 1.0,
  },
  lowland: {
    baseFreq: 0.003,
    hillFreq: 0.015,
    detailFreq: 0.04,
    baseAmp: 1.0,
    hillAmp: 0.3,
    detailAmp: 0.05
  },
  biome: {
    density: 0.7,
    scale: 0.01,
    contrast: 1.0,
    dryThreshold: 0.3,
    grassThreshold: 0.55,
    forestThreshold: 0.75,
    influence: 1.0,
    blend: 0.5,
  },
  biomes: {
    jungle: {
      treeDensity: 80,
      grassDensity: 1500,
      bushDensity: 120,
      rockDensity: 5,
      clusterStrength: 1.0
    },
    forest: {
      treeDensity: 50,
      grassDensity: 900,
      bushDensity: 80,
      rockDensity: 8,
      clusterStrength: 0.7
    },
    grassland: {
      treeDensity: 20,
      grassDensity: 600,
      bushDensity: 40,
      rockDensity: 10,
      clusterStrength: 0.4
    },
    dry: {
      treeDensity: 5,
      grassDensity: 100,
      bushDensity: 5,
      rockDensity: 20,
      clusterStrength: 0.2
    }
  },
  path: {
    strength: 1.0,
    width: 0.1,
    influence: 1.0
  },
  debug: {
    showBiome: false
  },
  grass: {
    scaleMin: 0.8,
    scaleMax: 1.3,
    patchiness: 0.5,
    fadeDistance: 150,
  },
  bush: {
    noiseScale: 0.05,
    scaleMin: 0.5,
    scaleMax: 1.5,
  },
  tree: {
    noiseScale: 0.01,
    scaleMin: 2.0,
    scaleMax: 5.0,
  },
  rock: {
    scaleMin: 0.5,
    scaleMax: 3.0,
  },
  performance: {
    enableLOD: true,
    lodFar: 200,
    maxInstances: 50000,
  },
  random: {
    seed: 12345,
    strength: 1.0,
  },
  spectator: {
    active: false,
    speed: 20,
  }
};



const envUniforms = {
  uTime: { value: 0 },
  uSunPos: { value: envParams.sun.pos },
  uZenithColor: { value: new THREE.Color(envParams.sky.zenith) },
  uHorizonColor: { value: new THREE.Color(envParams.sky.horizon) },
  uFogNear: { value: envParams.fog.near },
  uFogFar: { value: envParams.fog.far },
  uFogColor: { value: new THREE.Color(envParams.fog.color) },
  uShowBiomeDebug: { value: envParams.debug.showBiome },
  uDryThreshold: { value: envParams.biome.dryThreshold },
  uGrassThreshold: { value: envParams.biome.grassThreshold },
  uForestThreshold: { value: envParams.biome.forestThreshold },
};

gui.domElement.querySelectorAll(".lil-gui .title").forEach(el => {
  el.style.background = "#2a2a2a";
});

gui.domElement.querySelectorAll(".lil-gui .children").forEach(el => {
  el.style.background = "#1e1e1e";
});
await Rapier.init({});
let lastTime = performance.now();
let yaw = 0;
let pitch = 0;
/* =========================
   LOADING MANAGER
========================= */
const clock = new THREE.Clock();

const loaderDiv = document.getElementById("loader");
const progressText = document.getElementById("progress");

const loadingManager = new THREE.LoadingManager();

loadingManager.onProgress = (url, loaded, total) => {
  const percent = Math.floor((loaded / total) * 100);
  progressText.innerText = `Loading ${percent}%`;
};

loadingManager.onLoad = () => {
  loaderDiv.style.display = "none";
  startGame();
};

/* =========================
   PHYSICS
========================= */

const gravity = { x: 0, y: -20, z: 0 };
const world = new Rapier.World(gravity);
const scene = new THREE.Scene();

const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(50, 100, 50);

sun.castShadow = true;

sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 300;
sun.shadow.camera.left = -100;
sun.shadow.camera.right = 100;
sun.shadow.camera.top = 100;
sun.shadow.camera.bottom = -100;

scene.add(sun);
scene.add(sun.target);

// 🌞 SUN GROUP (core + glow)
const sunGroup = new THREE.Group();
scene.add(sunGroup);

// 🌞 CORE SUN
const sunCore = new THREE.Mesh(
  new THREE.SphereGeometry(10, 32, 32),
  new THREE.MeshBasicMaterial({
    color: envParams.sun.color,
  })
);

sun.intensity = envParams.sun.intensity;
sun.color.set(envParams.sun.color);
sun.position.copy(envParams.sun.pos);


// make it brighter
sunCore.material.color.multiplyScalar(2.5);

sunGroup.add(sunCore);

// 🔥 GLOW HALO (shader)
const glowMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uColor: { value: new THREE.Color(0xffaa33) },
    uIntensity: { value: 1.8 },
  },
  vertexShader: `
    varying vec3 vNormal;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 uColor;
    uniform float uIntensity;
    varying vec3 vNormal;

    void main() {
      float fresnel = pow(1.0 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
      float alpha = fresnel * uIntensity;

      gl_FragColor = vec4(uColor, alpha);
    }
  `,
  blending: THREE.AdditiveBlending,
  transparent: true,
  depthWrite: false,
});

const sunGlow = new THREE.Mesh(
  new THREE.SphereGeometry(envParams.sun.glowSize, 32, 32),
  glowMaterial
);

sunGroup.add(sunGlow);

// 🌌 SKY DOME
const skyGeo = new THREE.SphereGeometry(450, 32, 32);
const skyMat = new THREE.ShaderMaterial({
  vertexShader: skyVert,
  fragmentShader: skyFrag,
  uniforms: {
    uSunPosition: envUniforms.uSunPos,
    uZenithColor: envUniforms.uZenithColor,
    uHorizonColor: envUniforms.uHorizonColor
  },
  side: THREE.BackSide,
  depthWrite: false
});
const sky = new THREE.Mesh(skyGeo, skyMat);
scene.add(sky);


/* =========================
   DEBUG PHYSICS
========================= */

const debugMaterial = new THREE.LineBasicMaterial({
  vertexColors: true,
});

const debugGeometry = new THREE.BufferGeometry();

const debugLines = new THREE.LineSegments(debugGeometry, debugMaterial);
scene.add(debugLines);

/* =========================
   CAMERA
========================= */

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  500
);

/* =========================
   RENDERER
========================= */

const canvas = document.querySelector(".webgl");

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
});

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;

/* =========================
   PERFORMANCE MONITOR
========================= */

const perf = new ThreePerf({
  renderer,
  domElement: document.body,
});

/* =========================
   LIGHTS
========================= */

scene.add(new THREE.AmbientLight(0xffffff, 0.4));



/* =========================
   GUI CONTROLS
 ========================= */

const sunFolder = gui.addFolder("🌞 Sun");
sunFolder.add(envParams.sun, "intensity", 0, 10, 0.1).onChange((v) => {
  sun.intensity = v;
});
sunFolder.addColor(envParams.sun, "color").onChange((v) => {
  sun.color.set(v);
  sunCore.material.color.set(v);
});
sunFolder.add(sun.position, "x", -500, 500, 1);
sunFolder.add(sun.position, "y", -500, 500, 1);
sunFolder.add(sun.position, "z", -500, 500, 1);

const glowFolder = gui.addFolder("✨ Glow");
glowFolder.add(envParams.sun, "glowIntensity", 0, 5, 0.1);
glowFolder.add(envParams.sun, "glowSize", 1, 100, 1).onChange((v) => {
  sunGlow.geometry.dispose();
  sunGlow.geometry = new THREE.SphereGeometry(v, 32, 32);
});


const skyFolder = gui.addFolder("🌌 Sky");
skyFolder.addColor(envParams.sky, "zenith").onChange((v) => {
  envUniforms.uZenithColor.value.set(v);
});
skyFolder.addColor(envParams.sky, "horizon").onChange((v) => {
  envUniforms.uHorizonColor.value.set(v);
});



/* =========================
   WORLD
========================= */

const chunkManager = new ChunkManager(scene, world, camera, createNoise2D(), envUniforms, envParams);
const terrain = chunkManager; // alias for compatibility if needed


const advBiomeFolder = gui.addFolder("🌍 Advanced Biomes");
advBiomeFolder.add(envParams.biome, "dryThreshold", 0, 1).name("Dry Threshold").onChange(() => chunkManager.refreshChunks());
advBiomeFolder.add(envParams.biome, "grassThreshold", 0, 1).name("Grass Threshold").onChange(() => chunkManager.refreshChunks());
advBiomeFolder.add(envParams.biome, "forestThreshold", 0, 1).name("Forest Threshold").onChange(() => chunkManager.refreshChunks());
advBiomeFolder.add(envParams.biome, "influence", 0, 2).name("Biome Influence").onChange(() => chunkManager.refreshChunks());
advBiomeFolder.add(envParams.biome, "blend", 0, 1).name("Biome Blend");

// Biome-specific subfolders
const biomes = ["jungle", "forest", "grassland", "dry"];
biomes.forEach(b => {
  const f = advBiomeFolder.addFolder(b.charAt(0).toUpperCase() + b.slice(1));
  f.add(envParams.biomes[b], "treeDensity", 0, 200).name("Tree Density").onChange(() => chunkManager.refreshChunks());
  f.add(envParams.biomes[b], "grassDensity", 0, 3000).name("Grass Density").onChange(() => chunkManager.refreshChunks());
  f.add(envParams.biomes[b], "bushDensity", 0, 500).name("Bush Density").onChange(() => chunkManager.refreshChunks());
  f.add(envParams.biomes[b], "rockDensity", 0, 100).name("Rock Density").onChange(() => chunkManager.refreshChunks());
  f.add(envParams.biomes[b], "clusterStrength", 0, 1).name("Cluster Strength").onChange(() => chunkManager.refreshChunks());
});

const pathFolder = gui.addFolder("🛤️ Path Settings");
pathFolder.add(envParams.path, "strength", 0, 2).name("Path Strength").onChange(() => chunkManager.refreshChunks());
pathFolder.add(envParams.path, "width", 0, 0.5).name("Path Width").onChange(() => chunkManager.refreshChunks());
pathFolder.add(envParams.path, "influence", 0, 2).name("Path Influence").onChange(() => chunkManager.refreshChunks());

const debugFolder = gui.addFolder("🛠️ Debug");
debugFolder.add(envParams.debug, "showBiome").name("Show Biomes").onChange((v) => {
  envUniforms.uShowBiomeDebug.value = v;
});

const terrainTexFolder = gui.addFolder("🎨 Terrain Textures");
terrainTexFolder.add(envParams.terrain, "texScale", 1, 50, 0.1).name("Texture Scale");
terrainTexFolder.add(envParams.terrain, "grassTextureStrength", 0, 2).name("Grass Strength");
terrainTexFolder.add(envParams.terrain, "dirtTextureStrength", 0, 2).name("Dirt Strength");
terrainTexFolder.add(envParams.terrain, "pathStrength", 0, 2).name("Path Strength");
terrainTexFolder.add(envParams.terrain, "intensity", 0, 5, 0.1).name("Light Intensity");

const perfFolder = gui.addFolder("🎮 Performance");
perfFolder.add(envParams.performance, "enableLOD").name("Enable LOD");
perfFolder.add(envParams.terrain, "lodDistNear", 20, 200, 10).name("LOD Near");
perfFolder.add(envParams.performance, "lodFar", 50, 500, 10).name("LOD Far");
perfFolder.add(envParams.performance, "maxInstances", 1000, 100000, 1000).name("Max Instances");

const randomFolder = gui.addFolder("🎲 Randomness");
randomFolder.add(envParams.random, "seed", 0, 100000, 1).name("Global Seed");
randomFolder.add(envParams.random, "strength", 0, 1).name("Rand Strength");

// Vegetation Scale Folders
const vegFolders = {
  grass: gui.addFolder("🌿 Grass Scale"),
  bush: gui.addFolder("🌳 Bush Scale"),
  tree: gui.addFolder("🌲 Tree Scale"),
  rock: gui.addFolder("🪨 Rock Scale")
};

Object.entries(vegFolders).forEach(([key, folder]) => {
  folder.add(envParams[key], "scaleMin", 0.1, 10, 0.1).name("Scale Min").onChange(() => chunkManager.refreshChunks());
  folder.add(envParams[key], "scaleMax", 0.1, 20, 0.1).name("Scale Max").onChange(() => chunkManager.refreshChunks());
});

gui.add({ regenerate: () => chunkManager.refreshChunks() }, "regenerate").name("🔄 Regenerate World");

const fogFolder = gui.addFolder("🌫️ Fog");
fogFolder.add(envParams.fog, "near", 0, 100, 1).onChange((v) => {
  envUniforms.uFogNear.value = v;
});
fogFolder.add(envParams.fog, "far", 10, 500, 1).onChange((v) => {
  envUniforms.uFogFar.value = v;
});
fogFolder.addColor(envParams.fog, "color").onChange((v) => {
  envUniforms.uFogColor.value.set(v);
  scene.background.set(v);
  if (scene.fog) {
    scene.fog.color.set(v);
  }
});

const spectatorFolder = gui.addFolder("🎥 Spectator Mode");
spectatorFolder.add(envParams.spectator, "active").name("Active").listen().onChange((v) => {
  if (v) {
    // When activating, sync camera pitch/yaw to current state
  }
});
spectatorFolder.add(envParams.spectator, "speed", 1, 100, 1).name("Speed");

// Toggle with Ctrl + M
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.code === "KeyM") {
    envParams.spectator.active = !envParams.spectator.active;
    e.preventDefault();
  }
});

/* =========================
   CHARACTER
========================= */

let modelChoice = null;

while (!modelChoice) {
  const choice = prompt("Choose your character: 'soldier' or 'enemy'");
  if (choice === "soldier" || choice === "enemy") modelChoice = choice;
}

const modelPath =
  modelChoice === "soldier"
    ? "/models/soldier2.glb"
    : "/models/soldier2.glb";

const startPos = new THREE.Vector3(19, 0, 21.3);

const localChar = new Character(
  scene,
  terrain,
  world,
  modelPath,
  true,
  startPos,
  loadingManager
);

const fogSystem = new FogSystem(scene, localChar);


/* =========================
   CAMERA CONTROL
========================= */



const mouseSensitivity = 0.002;

document.body.addEventListener("click", () =>
  document.body.requestPointerLock()
);

document.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement !== document.body) return;

  yaw -= e.movementX * mouseSensitivity;
  pitch -= e.movementY * mouseSensitivity;

  if (!envParams.spectator.active) {
    pitch = Math.max(-Math.PI / 6, Math.min(Math.PI / 4, pitch));
  } else {
    pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
  }
});

/* =========================
   GAME LOOP
========================= */

function animate() {
  requestAnimationFrame(animate);
  const elapsedTime = clock.getElapsedTime()
  envUniforms.uTime.value = elapsedTime;

  const lightDir = new THREE.Vector3()
    .subVectors(sun.position, sun.target.position)
    .normalize();
  sunGroup.position.copy(sun.position);
  envUniforms.uSunPos.value.copy(sun.position);

  // make glow face camera
  sunGlow.lookAt(camera.position);
  sunGlow.material.uniforms.uIntensity.value =
    envParams.sun.glowIntensity + Math.sin(elapsedTime * 2.0) * 0.2;

  chunkManager.update(camera.position);

  sky.position.copy(camera.position); // sky follows camera






  perf.begin();

  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.033);
  lastTime = now;

  world.step();

  const { vertices, colors } = world.debugRender();

  // debugLines.geometry.setAttribute(
  //   "position",
  //   new THREE.BufferAttribute(vertices, 3)
  // );

  // debugLines.geometry.setAttribute(
  //   "color",
  //   new THREE.BufferAttribute(colors, 4)
  // );

  // debugLines.geometry.computeBoundingSphere();

  if (!envParams.spectator.active) {
    localChar.update(dt);
  } else {
    // Update spectator movement
    const keys = localChar.input.keys;
    const speed = envParams.spectator.speed;
    
    const camDir = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch)
    );
    
    const rightDir = new THREE.Vector3()
      .crossVectors(new THREE.Vector3(0, 1, 0), camDir)
      .normalize();

    if (keys["KeyW"]) camera.position.addScaledVector(camDir, -speed * dt);
    if (keys["KeyS"]) camera.position.addScaledVector(camDir, speed * dt);
    if (keys["KeyA"]) camera.position.addScaledVector(rightDir, -speed * dt);
    if (keys["KeyD"]) camera.position.addScaledVector(rightDir, speed * dt);
    if (keys["Space"]) camera.position.y += speed * dt;
    if (keys["ShiftLeft"]) camera.position.y -= speed * dt;

    camera.lookAt(
      camera.position.x - camDir.x,
      camera.position.y - camDir.y,
      camera.position.z - camDir.z
    );
    
    // Smoothly stop character if moving
    localChar.body.setLinvel({ x: 0, y: localChar.body.linvel().y, z: 0 }, true);
    localChar.playAnim("idle");
  }

  fogSystem.update(dt);

  if (localChar.model && !envParams.spectator.active) {
    const camDist = 1.5;
    const camHeight = 1.6;

    const camDir = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch)
    );

    camera.position
      .copy(localChar.model.position)
      .addScaledVector(camDir, camDist);

    camera.position.y += camHeight;

    camera.lookAt(
      localChar.model.position.x,
      localChar.model.position.y + 1.5,
      localChar.model.position.z
    );
  }

  renderer.render(scene, camera);

  perf.end();
}

/* =========================
   START GAME AFTER LOAD
========================= */

function startGame() {
  animate();
}

/* =========================
   RESIZE
========================= */

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;

  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
});