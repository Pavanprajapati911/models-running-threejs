import * as THREE from "three";
import { Character } from "./entities/character.js";
import { InfiniteTerrain } from "./terrain.js";
import { Network } from "./network.js";
import Rapier from "@dimforge/rapier3d-compat";
import { Interior } from "./entities/interior.js";
import { InvisibleMesh } from "./entities/invisible_mesh.js";
await Rapier.init({});

const gravity = { x: 0, y: -20, z: 0 };
const world = new Rapier.World(gravity);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  500,
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 0.4));
const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
scene.add(dirLight);

const terrain = new InfiniteTerrain(scene, world);

const network = new Network("ws://192.168.1.7:3000");

// Choose character
let modelChoice = null;
while (!modelChoice) {
  const choice = prompt("Choose your character: 'soldier' or 'enemy'");
  if (choice === "soldier" || choice === "enemy") modelChoice = choice;
}
const modelPath =
  modelChoice === "soldier" ? "/models/soldier2.glb" : "/models/soldier2.glb";
const startPos = new THREE.Vector3(Math.random() * 5, 2, Math.random() * 5);

const localChar = new Character(
  scene,
  terrain,
  world,
  modelPath,
  true,
  startPos,
);
const remoteChars = new Map();

const interior = new Interior(
  scene,
  world,
  "/models/room.glb",
  new THREE.Vector3(10, 0, 10),
  2,
);

const wall = new InvisibleMesh(
  scene,
  world,
  10.9, // width
  3, // height
  0.7, // depth
  new THREE.Vector3(5.1, 2, 9.1),
  new THREE.Euler(0, Math.PI / 2, 0),
);

const wall2 = new InvisibleMesh(
  scene,
  world,
  10.9, // width
  3, // height
  0.7, // depth
  new THREE.Vector3(10.8, 2, 14.5),
  new THREE.Euler(0, Math.PI, 0),
);


// Join network once connection opens
network.ws.onopen = () => {
  network.join(
    modelPath,
    localChar.position.toArray(),
    localChar.model?.rotation.toArray() || [0, 0, 0],
  );
};

// Handle updates from server
network.onUpdate = (chars) => {
  chars.forEach((c) => {
    if (c.id === network.id) return;

    let char = remoteChars.get(c.id);
    if (!char) {
      char = new Character(
        scene,
        terrain,
        world,
        c.model,
        false,
        new THREE.Vector3().fromArray(c.position),
      );
      remoteChars.set(c.id, char);
    }
    char.setRemoteState(c.position, c.rotation, c.anim);
  });
};

// Remove characters on leave
network.onLeave = (id) => {
  const char = remoteChars.get(id);
  if (char && char.model) scene.remove(char.model);
  remoteChars.delete(id);
};

network.onDamage = ({ targetId, health }) => {
  if (targetId === network.id) {
    localChar.health = health;
    localChar.updateHealthBar();
    localChar.spawnBloodEffect();
    return;
  }

  const target = remoteChars.get(targetId);
  if (target) {
    target.health = health;
    target.updateHealthBar();
    target.spawnBloodEffect();
  }
};

// Camera
let yaw = 0,
  pitch = 0;
const mouseSensitivity = 0.002;
document.body.addEventListener("click", () =>
  document.body.requestPointerLock(),
);
document.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement !== document.body) return;
  yaw -= e.movementX * mouseSensitivity;
  pitch -= e.movementY * mouseSensitivity;
  pitch = Math.max(-Math.PI / 6, Math.min(Math.PI / 4, pitch));
});

// Animate
let lastTime = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.033);
  lastTime = now;
  world.step();
  localChar.update(dt);
  remoteChars.forEach((c) => c.update(dt));

  if (localChar.model && network.ws.readyState === WebSocket.OPEN) {
    network.sendState(
      localChar.model.position.toArray(),
      localChar.model.rotation.toArray(),
      localChar.currentAnim,
    );
  }

  // Camera follow
  if (localChar.model) {
    const camDist = 5;
    const camHeight = 3;
    const camDir = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch),
    );
    camera.position
      .copy(localChar.model.position)
      .addScaledVector(camDir, camDist);
    camera.position.y += camHeight;
    camera.lookAt(
      localChar.model.position.x,
      localChar.model.position.y + 1.5,
      localChar.model.position.z,
    );
  }

  renderer.render(scene, camera);
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
