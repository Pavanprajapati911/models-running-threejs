import * as THREE from "three";
import { Character } from "./entities/character.js";
import { InfiniteTerrain } from "./terrain.js";
import Rapier from "@dimforge/rapier3d-compat";
import { Interior } from "./entities/interior.js";
import { InvisibleMesh } from "./entities/invisible_mesh.js";
import { ThreePerf } from "three-perf";
import { FogSystem } from "./environment/fog-system.js";
import { StealthMap } from "./environment/stealth-map.js";

await Rapier.init({});
let lastTime = performance.now();
let yaw = 0;
let pitch = 0;
/* =========================
   LOADING MANAGER
========================= */

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

/* =========================
   SCENE
========================= */

const scene = new THREE.Scene();

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

const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 1;
dirLight.shadow.camera.far = 200;
dirLight.shadow.camera.left = -50;
dirLight.shadow.camera.right = 50;
dirLight.shadow.camera.top = 50;
dirLight.shadow.camera.bottom = -50;
scene.add(dirLight);

/* =========================
   WORLD
========================= */

const terrain = new InfiniteTerrain(scene, world);
const stealthMap = new StealthMap(scene, world, terrain,{
  mapSize: 45,
  wallHeight: 6,

  rockCount: 35,
  rockMin: 0.7,
  rockMax: 2.2,

  coverWallCount: 12,
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

const startPos = new THREE.Vector3(19, 2, 21.3);

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

  pitch = Math.max(-Math.PI / 6, Math.min(Math.PI / 4, pitch));
});

/* =========================
   GAME LOOP
========================= */


function animate() {
  requestAnimationFrame(animate);

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

  localChar.update(dt);
  fogSystem.update(dt);

  if (localChar.model) {
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