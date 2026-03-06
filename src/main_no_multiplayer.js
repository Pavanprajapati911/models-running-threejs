import * as THREE from "three";
import { Character } from "./entities/character.js";
import { InfiniteTerrain } from "./terrain.js";
import Rapier from "@dimforge/rapier3d-compat";
import { Interior } from "./entities/interior.js";
import { InvisibleMesh } from "./entities/invisible_mesh.js";
import { ThreePerf } from "three-perf";

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
scene.background = new THREE.Color(0x87ceeb);

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

scene.add(dirLight);

/* =========================
   WORLD
========================= */

const terrain = new InfiniteTerrain(scene, world);

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

const startPos = new THREE.Vector3(19, 2, 11.3);

const localChar = new Character(
  scene,
  terrain,
  world,
  modelPath,
  true,
  startPos,
  loadingManager
);
/* =========================
   INTERIORS (GRID SPAWN)
========================= */

const ROOM_MODEL = "/models/room.glb";

const gridCols = 5;     // width
const gridRows = 2;     // depth
const spacing = 20;     // distance between rooms

const startX = 10;
const startZ = 10;

const interiors = [];

for (let x = 0; x < gridCols; x++) {
  for (let z = 0; z < gridRows; z++) {

    const posX = startX + x * spacing;
    const posZ = startZ + z * spacing;

    const interior = new Interior(
      scene,
      world,
      ROOM_MODEL,
      new THREE.Vector3(posX, 0, posZ),
      2,
      loadingManager
    );

    interiors.push(interior);
  }
}


/* =========================
   INVISIBLE COLLIDER WALLS
========================= */

new InvisibleMesh(
  scene,
  world,
  10.9,
  3,
  0.7,
  new THREE.Vector3(5.1, 2, 9.1),
  new THREE.Euler(0, Math.PI / 2, 0),
);

new InvisibleMesh(
  scene,
  world,
  10.9,
  3,
  0.7,
  new THREE.Vector3(10.8, 2, 14.5),
  new THREE.Euler(0, Math.PI, 0),
);

new InvisibleMesh(
  scene,
  world,
  4.9,
  3,
  0.7,
  new THREE.Vector3(16, 2, 11.5),
  new THREE.Euler(0, Math.PI / 2, 0),
);

new InvisibleMesh(
  scene,
  world,
  10.9,
  3,
  0.7,
  new THREE.Vector3(10.8, 2, 3.7),
  new THREE.Euler(0, Math.PI, 0),
);

new InvisibleMesh(
  scene,
  world,
  1.7,
  3,
  0.7,
  new THREE.Vector3(16.6, 2, 9.1),
  new THREE.Euler(0, Math.PI, 0),
);

new InvisibleMesh(
  scene,
  world,
  1.7,
  3,
  0.7,
  new THREE.Vector3(16.6, 2, 4.4),
  new THREE.Euler(0, Math.PI, 0),
);

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

  debugLines.geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(vertices, 3)
  );

  debugLines.geometry.setAttribute(
    "color",
    new THREE.BufferAttribute(colors, 4)
  );

  debugLines.geometry.computeBoundingSphere();

  localChar.update(dt);

  if (localChar.model) {
    const camDist = 5;
    const camHeight = 3;

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