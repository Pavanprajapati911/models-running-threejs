import * as THREE from "three";
import { Character } from "./entities/character.js";

import Rapier from "@dimforge/rapier3d-compat";
import { Interior } from "./entities/interior.js";
import { InvisibleMesh } from "./entities/invisible_mesh.js";
import { ThreePerf } from "three-perf";
import { FogSystem } from "./environment/fog-system.js";
import { StealthMap } from "./environment/stealth-map.js";
import GUI from "lil-gui";
import { ChunkManager } from "./terrain.js";
import { createNoise2D } from "simplex-noise";
import { PlacedObjectManager } from "./editor/PlacedObjectManager.js";
import { TerrainSplineManager } from "./editor/TerrainSplineManager.js";
import { EditorController } from "./editor/EditorController.js";
import { ModeController } from "./core/ModeController.js";
import { SkySystem } from "./environment/SkySystem.js";
import { CloudSystem } from "./environment/CloudSystem.js";
import { WeatherController } from "./environment/WeatherController.js";


const gui = new GUI();
const envParams = {
  terrain: {
    intensity: 1.0,
    specular: 0.5,
    chunkSize: 50.0,
    renderDist: 3, // 3x3 or 5x5 chunks
    lodDistNear: 20.0,
    lodDistMid: 120.0,
    heightMult: 8.0,
    colorVariation: 1.0, // Used for Grass variation
    dirtIntensity: 1.0,  // Used for Dirt patches
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

  performance: {
    enableLOD: true,
    lodFar: 50,
    maxInstances: 50000,
  },
  random: {
    seed: 12345,
    strength: 1.0,
  },
  spectator: {
    active: false,
    speed: 20,
  },
  mode: {
    type: "runtime", // "editor" | "runtime" | "procedural"
    biomeFile: "/biome-coordinates/map_full.json"
  },
  interaction: {
    radius: 1.5,
    strength: 0.8
  }
};


// ✅ REUSABLE VECTORS (NO GC)
const tempVec1 = new THREE.Vector3();
const tempVec2 = new THREE.Vector3();
const tempVec3 = new THREE.Vector3();

const envUniforms = {
  uTime: { value: 0 },
  uSunPos: { value: new THREE.Vector3(50, 100, 50) },
  uFogNear: { value: 1.0 },
  uFogFar: { value: 500.0 },
  uFogColor: { value: new THREE.Color(0xaaccff) },
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

// Basic lighting
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(50, 100, 50);
scene.add(sun);
scene.add(sun.target);
scene.background = new THREE.Color(0xaaccff);


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
  15000
);

/* =========================
   RENDERER
========================= */

const canvas = document.querySelector(".webgl");

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});

renderer.setSize(window.innerWidth, window.innerHeight);

// ✅ CAP pixel ratio (HUGE)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

// renderer.shadowMap.enabled = true;
// renderer.shadowMap.type = THREE.PCFSoftShadowMap;

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

/* =========================
//    WORLD
// ========================= */

const placedObjectManager = new PlacedObjectManager(scene, { chunkSize: envParams.terrain.chunkSize, chunks: new Map() }); // Temp placeholder
const terrainSplineManager = new TerrainSplineManager(scene);

const chunkManager = new ChunkManager(
  scene, world, camera,
  createNoise2D(),
  envUniforms, envParams,
  placedObjectManager,
  terrainSplineManager
);
placedObjectManager.chunkManager = chunkManager; // Fix circular ref
placedObjectManager.terrainSplineManager = terrainSplineManager;
const terrain = chunkManager; // alias for compatibility if needed

const raycaster = new THREE.Raycaster();
const editorController = new EditorController(
  scene, camera, raycaster,
  chunkManager, placedObjectManager, terrainSplineManager
);
const modeController = new ModeController({ envParams, character: null, editorController });

// No sky or weather systems initialized
const weather = new WeatherController(scene, gui);
const sky = new SkySystem(scene);
const clouds = new CloudSystem(scene);
weather.setSystems(sky, clouds);



const terrainProceduralFolder = gui.addFolder("🌿 Procedural Ground");
terrainProceduralFolder.add(envParams.terrain, "colorVariation", 0, 2).name("Color Variation");
terrainProceduralFolder.add(envParams.terrain, "dirtIntensity", 0, 2).name("Dirt Intensity");
terrainProceduralFolder.add(envParams.terrain, "intensity", 0, 5, 0.1).name("Light Intensity");

const perfFolder = gui.addFolder("🎮 Performance");
perfFolder.add(envParams.performance, "enableLOD").name("Enable LOD");
perfFolder.add(envParams.terrain, "lodDistNear", 20, 200, 10).name("LOD Near");
perfFolder.add(envParams.performance, "lodFar", 50, 500, 10).name("LOD Far");
perfFolder.add(envParams.performance, "maxInstances", 1000, 100000, 1000).name("Max Instances");

const randomFolder = gui.addFolder("🎲 Randomness");
randomFolder.add(envParams.random, "seed", 0, 100000, 1).name("Global Seed");
randomFolder.add(envParams.random, "strength", 0, 1).name("Rand Strength");



gui.add({ regenerate: () => chunkManager.refreshChunks() }, "regenerate").name("🔄 Regenerate World");

const spectatorFolder = gui.addFolder("🎥 Spectator Mode");
spectatorFolder.add(envParams.spectator, "active").name("Active").listen().onChange((v) => {
  if (v) {
    // When activating, sync camera pitch/yaw to current state
  }
});
spectatorFolder.add(envParams.spectator, "speed", 1, 100, 1).name("Speed");

const interactionFolder = gui.addFolder("🏃 Player Interaction");
interactionFolder.add(envParams.interaction, "radius", 0.5, 5, 0.1).name("Radius");
interactionFolder.add(envParams.interaction, "strength", 0, 2, 0.1).name("Strength");

// Toggle with E for Mode Switch
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyP") {
    modeController.toggleMode();
  }

  if (e.ctrlKey && e.code === "KeyM") {
    envParams.spectator.active = !envParams.spectator.active;
    e.preventDefault();
  }
});


/* =========================
   CHARACTER
========================= */

const modelPath = "/models/soldier.glb";

const startPos = new THREE.Vector3(339, 4, 21.3);

const gameCharacters = [];

const localChar = new Character(
  scene,
  terrain,
  world,
  modelPath,
  true,
  startPos,
  loadingManager
);
gameCharacters.push(localChar);

// Spawn Enemy
const enemyStart = startPos.clone().add(new THREE.Vector3(0, 0, -2));
const enemyChar = new Character(
  scene,
  terrain,
  world,
  modelPath,
  false,
  enemyStart,
  loadingManager
);
gameCharacters.push(enemyChar);

// Link references
localChar.gameCharacters = gameCharacters;
enemyChar.gameCharacters = gameCharacters;
modeController.character = localChar;
const vegManager = chunkManager.vegManager;

// Build collapsible folder-tree model list in the Editor UI
vegManager.onLoad(() => {
  const list = document.getElementById("model-list");
  if (!list) return;
  list.innerHTML = ""; // clear any stale entries

  let activeItem = null; // track the currently highlighted item

  for (const [category, models] of vegManager.models) {
    // ── Folder header ──────────────────────────────────────────
    const folder = document.createElement("div");
    folder.className = "tree-folder";

    const arrow = document.createElement("span");
    arrow.className = "tree-arrow";
    arrow.innerText = "▶";

    const label = document.createElement("span");
    label.innerText = ` ${category}`;

    const count = document.createElement("small");
    count.innerText = ` (${models.length})`;
    count.style.opacity = "0.5";

    folder.appendChild(arrow);
    folder.appendChild(label);
    folder.appendChild(count);
    list.appendChild(folder);

    // ── Items container (collapsed by default) ──────────────────
    const itemsContainer = document.createElement("div");
    itemsContainer.className = "tree-items";
    itemsContainer.style.display = "none";

    models.forEach((model, idx) => {
      const item = document.createElement("div");
      item.className = "tree-item";
      // Clean up the raw filename into a readable label
      item.innerText = model.name
        ? model.name.replace(/_/g, " ")
        : `Model ${idx + 1}`;
      item.dataset.category = category;
      item.dataset.index = idx;

      item.addEventListener("click", (e) => {
        e.stopPropagation();
        // Deselect previous
        if (activeItem) activeItem.classList.remove("tree-item--active");
        activeItem = item;
        item.classList.add("tree-item--active");
        editorController.setSelection(category, idx);
      });

      itemsContainer.appendChild(item);
    });

    list.appendChild(itemsContainer);

    // ── Toggle folder open/close ────────────────────────────────
    folder.addEventListener("click", () => {
      const isOpen = itemsContainer.style.display !== "none";
      itemsContainer.style.display = isOpen ? "none" : "block";
      arrow.innerText = isOpen ? "▶" : "▼";
      folder.classList.toggle("tree-folder--open", !isOpen);
    });
  }

  // Auto-open the first folder and select its first model
  const firstFolder = list.querySelector(".tree-folder");
  const firstItems = list.querySelector(".tree-items");
  const firstItem = list.querySelector(".tree-item");
  if (firstFolder) {
    firstItems.style.display = "block";
    firstFolder.querySelector(".tree-arrow").innerText = "▼";
    firstFolder.classList.add("tree-folder--open");
  }
  if (firstItem) {
    firstItem.classList.add("tree-item--active");
    activeItem = firstItem;
    editorController.setSelection(
      firstItem.dataset.category,
      parseInt(firstItem.dataset.index, 10)
    );
  }
});




document.getElementById("export-json").onclick = () => placedObjectManager.exportJSON();
document.getElementById("load-json").onclick   = () => placedObjectManager.loadJSON(envParams.mode.biomeFile);

if (envParams.mode.type === "runtime") {
  placedObjectManager.loadJSON(envParams.mode.biomeFile);
}


// Fog system removed


/* =========================
   CAMERA CONTROL
========================= */



const mouseSensitivity = 0.002;

// In editor mode: rotate camera only while RIGHT mouse button is held (drag-to-orbit)
let editorDragging = false;

document.body.addEventListener("click", () => {
  if (envParams.mode.type === "runtime") {
    document.body.requestPointerLock();
  }
});

document.addEventListener("mousedown", (e) => {
  // Right-click (button 2) or middle-click (button 1) starts editor orbit
  if (envParams.mode.type === "editor" && (e.button === 2 || e.button === 1)) {
    editorDragging = true;
    e.preventDefault();
  }
});

document.addEventListener("mouseup", (e) => {
  if (e.button === 2 || e.button === 1) {
    editorDragging = false;
  }
});

// Prevent context menu on right-click while in editor mode
document.addEventListener("contextmenu", (e) => {
  if (envParams.mode.type === "editor") e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
  // Runtime: require pointer lock
  if (envParams.mode.type === "runtime" && document.pointerLockElement !== document.body) return;

  // Editor: only orbit when dragging with right/middle mouse button
  if (envParams.mode.type === "editor") {
    if (!editorDragging) return;
  }

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

  const elapsedTime = clock.getElapsedTime();
  envUniforms.uTime.value = elapsedTime;

  chunkManager.update(camera.position);

  //   sky.position.copy(camera.position);

  perf.begin();

  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.033);
  lastTime = now;

  if (localChar && localChar.model) {
    const playerPos = localChar.model.position;
    chunkManager.envUniforms.uPlayerPos.value.copy(playerPos);
  }

  let accumulator = 0;
  const fixedStep = 1 / 60;

  accumulator += dt;

  while (accumulator >= fixedStep) {
    world.step();
    accumulator -= fixedStep;
  }

  if (!envParams.spectator.active && envParams.mode.type !== "editor") {
    gameCharacters.forEach(char => char.update(dt));
  } else {
    const keys = localChar.input.keys;
    const speed = envParams.spectator.speed;

    // ✅ reuse vectors
    tempVec1.set(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch)
    );

    tempVec2.crossVectors(new THREE.Vector3(0, 1, 0), tempVec1).normalize();

    if (keys["KeyW"]) camera.position.addScaledVector(tempVec1, -speed * dt);
    if (keys["KeyS"]) camera.position.addScaledVector(tempVec1, speed * dt);
    if (keys["KeyA"]) camera.position.addScaledVector(tempVec2, -speed * dt);
    if (keys["KeyD"]) camera.position.addScaledVector(tempVec2, speed * dt);
    if (keys["Space"]) camera.position.y += speed * dt;
    if (keys["ShiftLeft"]) camera.position.y -= speed * dt;

    camera.lookAt(
      camera.position.x - tempVec1.x,
      camera.position.y - tempVec1.y,
      camera.position.z - tempVec1.z
    );
  }

  // Fog update removed

  if (localChar.model && !envParams.spectator.active && envParams.mode.type !== "editor") {
    const camDist = 1.5;
    const camHeight = 1.6;

    tempVec1.set(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch)
    );

    camera.position
      .copy(localChar.model.position)
      .addScaledVector(tempVec1, camDist);

    camera.position.y += camHeight;

    camera.lookAt(
      localChar.model.position.x,
      localChar.model.position.y + 1.5,
      localChar.model.position.z
    );
  }

  // Update Environment
  sky.update(camera);
  // clouds.update(elapsedTime, camera); 
  clouds.update(elapsedTime, camera, sun.position);
  weather.update(elapsedTime);

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