import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";

let frame = 0;


// ✅ Reusable canvas (NO recreation)
function createCubeTextureWithTopOnly(image) {
    const faceWidth = Math.floor(image.width / 3);
    const faceHeight = Math.floor(image.height / 2);

    const createTileCanvas = (tx, ty) => {
        const canvas = document.createElement("canvas");
        canvas.width = faceWidth;
        canvas.height = faceHeight;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(
            image,
            tx * faceWidth,
            ty * faceHeight,
            faceWidth,
            faceHeight,
            0,
            0,
            faceWidth,
            faceHeight
        );

        return canvas;
    };

    // 🎯 Tiles
    const tile1 = createTileCanvas(0, 0); // bottom
    const tile2 = createTileCanvas(1, 0); // top
    const tile3 = createTileCanvas(2, 0); // left
    const tile4 = createTileCanvas(0, 1); // front
    const tile5 = createTileCanvas(1, 1); // right 🆕
    const tile6 = createTileCanvas(2, 1); // back  🆕

    // (optional animation texture for top)
    const topTexture = new THREE.CanvasTexture(tile2);
    topTexture.wrapS = THREE.RepeatWrapping;
    topTexture.wrapT = THREE.RepeatWrapping;

    const cubeTexture = new THREE.CubeTexture([
        tile6, // +X (right)
        tile4,                // +Z (front) ✅ 4th tile       
        tile2,                     // +Y (top)   ✅ 2nd tile
        tile1,                     // -Y (bottom)✅ 1st tile
       tile5,
        tile3,    // -X (left)  ✅ 3rd tile
    ]);

    cubeTexture.colorSpace = THREE.SRGBColorSpace;
    cubeTexture.needsUpdate = true;

    return { cubeTexture, topTexture };
}

// --- Scene ---
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
    75, window.innerWidth / window.innerHeight, 0.1, 2000
);
camera.position.set(0, 2, 5);

// 🔥 LIMIT pixel ratio (HUGE win)
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Load
const loader = new THREE.TextureLoader();

let cubeTexture, cloudTexture;

loader.load("/textures/clouds/cloud.png", (texture) => {
    const result = createCubeTextureWithTopOnly(texture.image);
    cubeTexture = result.cubeTexture;
    cloudTexture = result.texture;

    scene.background = cubeTexture;
});

// Light
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.5));

// Cube
scene.add(
    new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0x00ff00 })
    )
);

// 🔥 Reduce grid load
scene.add(new THREE.GridHelper(200, 50));

// Controls
const controls = new PointerLockControls(camera, document.body);
document.addEventListener("click", () => controls.lock());

const keys = { w: false, a: false, s: false, d: false, space: false, shift: false };

document.addEventListener("keydown", (e) => {
    const key = e.code.replace("Key", "").toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = true;
    if (e.code === "Space") keys.space = true;
    if (e.code === "ShiftLeft") keys.shift = true;
});

document.addEventListener("keyup", (e) => {
    const key = e.code.replace("Key", "").toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = false;
    if (e.code === "Space") keys.space = false;
    if (e.code === "ShiftLeft") keys.shift = false;
});

const speed = 0.2;

// 🚀 Animate
function animate() {
    requestAnimationFrame(animate);

    if (controls.isLocked) {
        if (keys.w) controls.moveForward(speed);
        if (keys.s) controls.moveForward(-speed);
        if (keys.a) controls.moveRight(-speed);
        if (keys.d) controls.moveRight(speed);
        if (keys.space) camera.position.y += speed;
        if (keys.shift) camera.position.y -= speed;
    }

    // 🔥 SUPER CHEAP animation (GPU handled)
    if (cloudTexture) {
        cloudTexture.offset.x += 0.0005;
    }

    renderer.render(scene, camera);
}

animate();

// Resize
window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});