import * as THREE from "three";
import Rapier from "@dimforge/rapier3d-compat";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { AnimationController } from "../core/AnimationController.js";
import { Input } from "../core/Input.js";

export class Character {
  constructor(
    scene,
    terrain,
    world,
    modelPath,
    isLocal = false,
    startPos = new THREE.Vector3(),
    loadingManager
  ) {
    this.scene = scene;
    this.terrain = terrain;
    this.world = world;
    this.isLocal = isLocal;

    // ---- TRANSFORMS ----
    this.position = startPos.clone();
    this.netPosition = startPos.clone();
    this.rotation = new THREE.Euler();
    this.netRotation = new THREE.Euler();

    // ---- MOVEMENT ----
    this.speed = 4;
    this.turnSpeed = 3;

    // ---- STATES ----
    this.isAttacking = false;
    this.isJumping = false;
    this.currentAnim = "idle";

    // ---- JUMP ----
    this.jumpVelocity = 0;
    this.jumpForce = 8;
    this.gravity = -20;
    this.heightOffset = 0;

    // ---- HEALTH ----
    this.maxHealth = 100;
    this.health = 100;

    if (this.isLocal) this.input = new Input();

    this.model = null;
    this.mixer = null;
    this.anim = null;

    // ======================
    // PHYSICS SETUP
    // ======================
    const bodyDesc = Rapier.RigidBodyDesc.dynamic()
      .setTranslation(startPos.x, startPos.y, startPos.z)
      .setLinearDamping(8)
      .lockRotations();

    this.body = world.createRigidBody(bodyDesc);

    const colliderDesc = Rapier.ColliderDesc.capsule(0.8, 0.4)
      .setFriction(1)
      .setMass(1);

    world.createCollider(colliderDesc, this.body);

    // ======================
    // LOAD MODEL
    // ======================
    const loader = new GLTFLoader(loadingManager);
    loader.load(modelPath, (gltf) => {
      this.model = gltf.scene;
      this.scene.add(this.model);

      const box = new THREE.Box3().setFromObject(this.model);
      const center = new THREE.Vector3();
      box.getCenter(center);

      this.heightOffset = center.y;

      this.createHealthBar();

      this.mixer = new THREE.AnimationMixer(this.model);
      const actions = {};
      gltf.animations.forEach((clip) => {
        actions[clip.name] = this.mixer.clipAction(clip);
      });

      this.anim = new AnimationController(this.mixer, actions);
      this.anim.play("idle");

      this.mixer.addEventListener("finished", (e) => {
        const name = e.action?._clip?.name;
        if (name === "attack" || name === "slash" || name === "slash_2") {
          this.isAttacking = false;
        }
      });
    });
  }

  // =====================
  // UPDATE
  // =====================
  update(dt) {
    if (!this.model || !this.anim) return;

    if (this.isLocal) this.updateLocal(dt);
    else this.updateRemote(dt);

    // Sync physics → visual
    const pos = this.body.translation();
    this.position.set(pos.x, pos.y, pos.z);

    this.model.position.set(pos.x, pos.y - this.heightOffset, pos.z);

    this.anim.update(dt);
  }

  // =====================
  // LOCAL
  // =====================
  updateLocal(dt) {
    if (this.isJumping && velocity.y <= 0) {
      const isGrounded = Math.abs(this.position.y - groundY) < 0.25;
      if (isGrounded) {
        this.isJumping = false;
      }
    }

    const keys = this.input.keys;
    const mouse = this.input.mouse;

    let moving = false;
    let desiredAnim = "idle";

    const moveAmount = this.speed;

    if (keys["KeyA"]) this.model.rotation.y += this.turnSpeed * dt;
    if (keys["KeyD"]) this.model.rotation.y -= this.turnSpeed * dt;

    const forward = new THREE.Vector3(
      Math.sin(this.model.rotation.y),
      0,
      Math.cos(this.model.rotation.y),
    );

    let velocity = this.body.linvel();

    let moveDir = new THREE.Vector3();

    if (!this.isAttacking) {
      if (keys["KeyW"]) {
        moveDir.add(forward);
        moving = true;
        desiredAnim = "run";
      }

      if (keys["KeyS"]) {
        moveDir.add(forward.clone().multiplyScalar(-0.6));
        moving = true;
        desiredAnim = "back run";
      }
    }

    moveDir.normalize().multiplyScalar(moveAmount);

    this.body.setLinvel({ x: moveDir.x, y: velocity.y, z: moveDir.z }, true);

    // ---- JUMP ----
    // const velocity = this.body.linvel();
    // const pos = this.body.translation();

    // const isGrounded = Math.abs(velocity.y) < 0.05;

    // if (keys["Space"] && isGrounded && !this.isJumping) {
    //   this.isJumping = true;

    //   this.body.setLinvel(
    //     { x: velocity.x, y: this.jumpForce, z: velocity.z },
    //     true
    //   );

    //   this.playAnim("jump", false);
    // }

    // if (this.isJumping && isGrounded && velocity.y <= 0) {
    //   this.isJumping = false;
    // }

    // ---- ATTACK ----
    if (!this.isAttacking) {
      if (mouse.leftPressed) this.startAttack("slash_2");
      if (mouse.rightPressed) this.startAttack("attack");
    }

    // if (!this.isAttacking) {
    //   this.playAnim(moving ? desiredAnim : "idle");
    // }

    if (!this.isAttacking && !this.isJumping) {
      this.playAnim(moving ? desiredAnim : "idle");
    }

    this.input.update();
  }

  // =====================
  // REMOTE
  // =====================
  updateRemote() {
    this.body.setTranslation(
      {
        x: THREE.MathUtils.lerp(this.position.x, this.netPosition.x, 0.2),
        y: this.netPosition.y,
        z: THREE.MathUtils.lerp(this.position.z, this.netPosition.z, 0.2),
      },
      true,
    );

    this.model.rotation.y = THREE.MathUtils.lerp(
      this.model.rotation.y,
      this.netRotation.y,
      0.15,
    );
  }

  // =====================
  // HEALTH
  // =====================
  takeDamage(amount) {
    console.log("Took damage: ", amount);
    this.health -= amount;
    this.health = Math.max(0, this.health);

    this.spawnBloodEffect(); // 👈 add here

    this.updateHealthBar();

    if (this.health === 0) {
      this.die();
    }
  }

  spawnBloodEffect() {
    const count = 25;
    const geometry = new THREE.BufferGeometry();
    const positions = [];

    for (let i = 0; i < count; i++) {
      positions.push(
        (Math.random() - 0.5) * 0.5,
        Math.random() * 0.5,
        (Math.random() - 0.5) * 0.5,
      );
    }

    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );

    const material = new THREE.PointsMaterial({
      color: 0xaa0000,
      size: 0.1,
      transparent: true,
    });

    const particles = new THREE.Points(geometry, material);
    particles.position.copy(this.model.position);
    particles.position.y += 1.5;

    this.scene.add(particles);

    setTimeout(() => {
      this.scene.remove(particles);
      geometry.dispose();
      material.dispose();
    }, 300);
  }

  die() {
    this.playAnim("death", false);
  }

  createHealthBar() {
    const geometry = new THREE.PlaneGeometry(1.2, 0.12);
    const material = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      side: THREE.DoubleSide,
    });

    this.healthBar = new THREE.Mesh(geometry, material);
    this.healthBar.position.set(0, 2.5, 0);
    this.model.add(this.healthBar);
  }

  updateHealthBar() {
    const ratio = this.health / this.maxHealth;
    // this.healthBar.scale.x = ratio;
    this.healthBar.scale.x = ratio;
    this.healthBar.position.x = -0.6 * (1 - ratio);

    if (ratio > 0.6) this.healthBar.material.color.set(0x00ff00);
    else if (ratio > 0.3) this.healthBar.material.color.set(0xffff00);
    else this.healthBar.material.color.set(0xff0000);
  }

  // =====================
  // NETWORK
  // =====================
  setRemoteState(posArr, rotArr, anim) {
    this.netPosition.fromArray(posArr);
    this.netRotation.fromArray(rotArr);

    if (anim && anim !== this.currentAnim) {
      const loop =
        anim !== "attack" &&
        anim !== "slash" &&
        anim !== "slash_2" &&
        anim !== "jump";

      this.playAnim(anim, loop);
    }
  }

  playAnim(name, loop = true) {
    if (this.currentAnim === name) return;

    this.currentAnim = name;
    this.anim.play(name, loop);

    if (this.isLocal && this.network) {
      this.network.sendAnim(name);
    }
  }

  startAttack(name) {
    if (this.isAttacking) return;

    this.isAttacking = true;
    this.playAnim(name, false);
    console.log("Started attack: ", name);
    // send attack to server during damage window
    setTimeout(() => {
      if (this.isLocal && this.network) {
        console.log("Sending attack message to server :    ");
        this.network.sendAttack();
      }
    }, 300);
  }

  // checkHit() {
  //   console.log("Checking hit...");
  //   if (!this.isLocal) return;
  //   if (!this.gameCharacters) return;

  //   const attackRange = 2.0;

  //   this.gameCharacters.forEach((target) => {
  //     if (target === this) return;
  //     if (target.health <= 0) return;

  //     const dist = this.position.distanceTo(target.position);

  //     if (dist < attackRange) {
  //       target.takeDamage(20);

  //       if (this.network) {
  //         this.network.sendHit(target.id, 20);
  //       }
  //     }
  //   });
  // }
}
