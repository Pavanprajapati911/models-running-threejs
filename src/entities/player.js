// import * as THREE from "three";
// import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// import { AnimationController } from "../core/AnimationController.js";
// import { Input } from "../core/input.js";

// export class Player {
//   constructor(scene, terrain) {
//     this.scene = scene;
//     this.terrain = terrain;
//     this.input = new Input();

//     this.position = new THREE.Vector3();
//     this.targetPosition = new THREE.Vector3();

//     this.speed = 4;
//     this.turnSpeed = 3;

//     // STATES
//     this.isAttacking = false;
//     this.isJumping = false;

//     // JUMP PHYSICS
//     this.jumpVelocity = 0;
//     this.gravity = -20;
//     this.jumpForce = 8;

//     // GROUND
//     this.heightOffset = 0;

//     const loader = new GLTFLoader();

//     loader.load(
//       "/models/soldier2.glb",
//       (gltf) => {
//         this.model = gltf.scene;
//         this.scene.add(this.model);

//         this.model.updateWorldMatrix(true, true);

//         const box = new THREE.Box3().setFromObject(this.model);
//         const size = new THREE.Vector3();
//         box.getSize(size);

//         this.heightOffset = size.y * 0.1;

//         this.targetPosition.set(0, this.heightOffset, 0);
//         this.model.position.copy(this.targetPosition);

//         this.mixer = new THREE.AnimationMixer(this.model);
//         const actions = {};

//         gltf.animations.forEach((clip) => {
//           actions[clip.name] = this.mixer.clipAction(clip);
//         });

//         this.anim = new AnimationController(this.mixer, actions);
//         this.anim.play("idle");
//       },
//       undefined,
//       (err) => console.error("❌ Failed to load player model:", err)
//     );
//   }

//   update(dt) {
//     if (!this.model || !this.anim) return;

//     const keys = this.input.keys;
//     const mouse = this.input.mouse;

//     const forwardKey = keys["KeyW"] || keys["KeyS"];
//     const leftKey = keys["KeyA"];
//     const rightKey = keys["KeyD"];
//     const shiftKey = keys["ShiftLeft"] || keys["ShiftRight"];
//     const jumpKey = keys["Space"];

//     let moving = false;
//     let animState = "idle";

//     const moveAmount = this.speed * dt;

//     // =====================
//     // ROTATION
//     // =====================
//     if (forwardKey) {
//       if (leftKey) this.model.rotation.y += this.turnSpeed * dt;
//       if (rightKey) this.model.rotation.y -= this.turnSpeed * dt;
//     }

//     const forward = new THREE.Vector3(
//       Math.sin(this.model.rotation.y),
//       0,
//       Math.cos(this.model.rotation.y)
//     );

//     const right = new THREE.Vector3(
//       Math.cos(this.model.rotation.y),
//       0,
//       -Math.sin(this.model.rotation.y)
//     );

//     // =====================
//     // MOVEMENT
//     // =====================
//     if (!this.isAttacking) {
//       if (keys["KeyW"]) {
//         this.targetPosition.add(forward.clone().multiplyScalar(moveAmount));
//         moving = true;
//         animState = "run";
//       }

//       if (keys["KeyS"]) {
//         this.targetPosition.add(
//           forward.clone().multiplyScalar(-moveAmount * 0.6)
//         );
//         moving = true;
//         animState = "back run";
//       }

//       if (!forwardKey) {
//         if (leftKey) {
//           this.targetPosition.add(right.clone().multiplyScalar(moveAmount));
//           moving = true;
//           animState = "strafe_right";
//         }

//         if (rightKey) {
//           this.targetPosition.add(right.clone().multiplyScalar(-moveAmount));
//           moving = true;
//           animState = "strafe";
//         }
//       }
//     }

//     // =====================
//     // JUMP
//     // =====================
//     if (jumpKey && !this.isJumping && !this.isAttacking) {
//       this.isJumping = true;
//       this.jumpVelocity = this.jumpForce;
//       this.anim.play("jump", false);
//     }

//     if (this.isJumping) {
//       this.jumpVelocity += this.gravity * dt;
//       this.targetPosition.y += this.jumpVelocity * dt;
//     }

//     // =====================
//     // ATTACKS
//     // =====================
//     if (!this.isAttacking && !this.isJumping && mouse.leftPressed) {
//       this.startAttack(shiftKey ? "slash" : "slash_2");
//     }

//     if (!this.isAttacking && !this.isJumping && mouse.rightPressed) {
//       this.startAttack("attack");
//     }

//     // =====================
//     // TERRAIN HEIGHT (ENEMY STYLE)
//     // =====================
//     const groundY = this.terrain.getHeightAt(
//       this.targetPosition.x,
//       this.targetPosition.z
//     );

//     if (!this.isJumping) {
//       this.targetPosition.y = THREE.MathUtils.lerp(
//         this.targetPosition.y,
//         groundY + this.heightOffset,
//         0.2
//       );
//     } else if (
//       this.targetPosition.y <= groundY + this.heightOffset
//     ) {
//       this.targetPosition.y = groundY + this.heightOffset;
//       this.isJumping = false;
//       this.jumpVelocity = 0;
//     }

//     // =====================
//     // APPLY POSITION
//     // =====================
//     this.model.position.x = THREE.MathUtils.lerp(
//       this.model.position.x,
//       this.targetPosition.x,
//       0.25
//     );

//     this.model.position.z = THREE.MathUtils.lerp(
//       this.model.position.z,
//       this.targetPosition.z,
//       0.25
//     );

//     this.model.position.y = THREE.MathUtils.lerp(
//       this.model.position.y,
//       this.targetPosition.y,
//       0.25
//     );

//     // =====================
//     // ANIMATIONS
//     // =====================
//     if (!this.isAttacking && !this.isJumping) {
//       this.anim.play(moving ? animState : "idle");
//     }

//     this.anim.update(dt);
//     this.model.getWorldPosition(this.position);
//     this.input.update();
//   }

//   startAttack(name) {
//     if (!this.anim.actions[name]) return;

//     this.isAttacking = true;
//     this.anim.play(name, false);

//     const onFinished = () => {
//       this.isAttacking = false;
//       this.mixer.removeEventListener("finished", onFinished);
//     };

//     this.mixer.addEventListener("finished", onFinished);
//   }
// }
