// import * as THREE from "three";
// import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// import { AnimationController } from "../core/AnimationController.js";

// export class Enemy {
//   constructor(scene, terrain, player, position = new THREE.Vector3(), isRemote = false) {
//     this.scene = scene;
//     this.terrain = terrain;
//     this.player = player;
//     this.isRemote = isRemote;

//     this.position = position.clone();
//     this.targetPosition = position.clone();

//     this.speed = 2.5;
//     this.turnSpeed = 4;

//     this.attackRange = 1.5;
//     this.attackCooldown = 1.2;
//     this.attackTimer = 0;

//     this.isAttacking = false;

//     const loader = new GLTFLoader();
//     loader.load("/models/soldier2.glb", (gltf) => {
//       this.model = gltf.scene;
//       this.scene.add(this.model);
//       this.model.position.copy(this.position);

//       this.model.updateWorldMatrix(true, true);

//       const box = new THREE.Box3().setFromObject(this.model);
//       const size = new THREE.Vector3();
//       box.getSize(size);
//       this.heightOffset = size.y * 0.1;

//       this.mixer = new THREE.AnimationMixer(this.model);

//       const actions = {};
//       gltf.animations.forEach((clip) => {
//         actions[clip.name] = this.mixer.clipAction(clip);
//       });

//       this.anim = new AnimationController(this.mixer, actions);
//       this.anim.play("idle");
//     });
//   }

//   update(dt) {
//     if (!this.model || !this.anim) return;

//     if (this.isRemote) {
//       // Remote enemy updated by network only
//       return;
//     }

//     if (!this.player || !this.player.model) return;

//     // ---------- AI logic ----------
//     this.attackTimer -= dt;

//     const toPlayer = new THREE.Vector3().subVectors(this.player.model.position, this.model.position);
//     const distance = toPlayer.length();

//     const targetAngle = Math.atan2(toPlayer.x, toPlayer.z);
//     this.model.rotation.y = lerpAngle(this.model.rotation.y, targetAngle, this.turnSpeed * dt);

//     if (distance > this.attackRange) {
//       const dir = toPlayer.normalize();
//       this.targetPosition.addScaledVector(dir, this.speed * dt);
//       this.anim.play("run");
//     } else if (!this.isAttacking && this.attackTimer <= 0) {
//       this.startAttack();
//     }

//     const groundY = this.terrain.getHeightAt(this.targetPosition.x, this.targetPosition.z);

//     this.model.position.x = THREE.MathUtils.lerp(this.model.position.x, this.targetPosition.x, 0.15);
//     this.model.position.z = THREE.MathUtils.lerp(this.model.position.z, this.targetPosition.z, 0.15);
//     this.targetPosition.y = THREE.MathUtils.lerp(this.model.position.y, groundY + this.heightOffset, 0.2);
//     this.model.position.lerp(this.targetPosition, 0.15);

//     this.anim.update(dt);
//   }

//   startAttack() {
//     if (!this.anim.actions["attack"]) return;

//     this.isAttacking = true;
//     this.attackTimer = this.attackCooldown;

//     this.anim.play("attack", false);

//     const onFinished = () => {
//       this.isAttacking = false;
//       this.mixer.removeEventListener("finished", onFinished);
//     };

//     this.mixer.addEventListener("finished", onFinished);
//   }
// }

// function lerpAngle(a, b, t) {
//   const diff = THREE.MathUtils.euclideanModulo(b - a + Math.PI, Math.PI * 2) - Math.PI;
//   return a + diff * t;
// }
