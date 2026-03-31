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
    this.rotation = new THREE.Euler();

    // ---- MOVEMENT ----
    this.walkSpeed = 2;
    this.runSpeed = 4;
    this.speed = this.walkSpeed;
    this.turnSpeed = 3;
    this.targetRotation = 0;

    // ---- STATES ----
    this.isAttacking = false;
    this.isBlocking = false;
    this.isCrouching = false;
    this.isJumping = false;
    this.isHit = false;
    this.attackTimer = 0;
    this.hitRegistered = false;
    this.currentAnim = "idle";

    // ---- JUMP ----
    this.jumpVelocity = 0;
    this.jumpForce = 8;
    this.gravity = -20;
    this.heightOffset = 0;

    // ---- HEALTH ----
    this.maxHealth = 100;
    this.health = 100;

    this.enabled = true;
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

      this.targetRotation = this.model.rotation.y;

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
          this.hitRegistered = false;
          this.attackTimer = 0;
        }
      });
    });

    // ---- DEBUG VISUALIZATION ----
    this.debugSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.2),
      new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false })
    );
    this.debugSphere.renderOrder = 999;
    this.scene.add(this.debugSphere);
  }

  // =====================
  // UPDATE
  // =====================
  update(dt) {
    if (!this.model || !this.anim || !this.enabled) return;

    if (this.isLocal) this.updateLocal(dt);

    // Sync physics → visual model position
    const pos = this.body.translation();
    this.position.set(pos.x, pos.y, pos.z);

    // EXACT Sync of visual model to body (excluding height offset)
    this.model.position.set(pos.x, pos.y - this.heightOffset, pos.z);

    // Sync debug visualization to PHYSICS BODY
    if (this.debugSphere) {
      this.debugSphere.position.set(pos.x, pos.y, pos.z);
    }

    this.anim.update(dt);
  }

  // =====================
  // LOCAL
  // =====================
  updateLocal(dt) {
    const keys = this.input.keys;
    const mouse = this.input.mouse;
    const isShift = keys["ShiftLeft"] || keys["ShiftRight"];

    // Speed calculation
    this.speed = isShift ? this.runSpeed : this.walkSpeed;

    // ---- COMBAT TIMER (Frame-based hit detection) ----
    if (this.isAttacking) {
      this.attackTimer += dt;
      if (this.attackTimer > 0.25 && !this.hitRegistered) {
        this.checkHit();
        this.hitRegistered = true;
      }
    }

    // ---- ROTATION (Target Based) ----
    const turnAmount = this.turnSpeed * dt;
    if (keys["KeyA"]) this.targetRotation += turnAmount;
    if (keys["KeyD"]) this.targetRotation -= turnAmount;

    // Apply Smooth Rotation (LERP)
    this.model.rotation.y = THREE.MathUtils.lerp(
      this.model.rotation.y,
      this.targetRotation,
      0.15
    );

    // Prevent micro-jitter
    if (Math.abs(this.model.rotation.y - this.targetRotation) < 0.001) {
      this.model.rotation.y = this.targetRotation;
    }

    const forward = new THREE.Vector3(
      Math.sin(this.model.rotation.y),
      0,
      Math.cos(this.model.rotation.y)
    );
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), forward);

    let moveDir = new THREE.Vector3();
    let moving = false;
    let animDir = "idle";

    // Priority Check: Movement logic only if not attacking
    if (!this.isAttacking && !this.isBlocking) {
      if (keys["KeyW"]) {
        moveDir.add(forward);
        moving = true;
        animDir = isShift ? "run_fast" : "walk";
      } else if (keys["KeyS"]) {
        moveDir.add(forward.clone().negate());
        moving = true;
        animDir = isShift ? "back run" : "back_walk";
      } else if (keys["KeyQ"]) {
        moveDir.add(right.clone());
        moving = true;
        animDir = isShift ? "left_back_run" : "left_back_walk";
      } else if (keys["KeyE"]) {
        moveDir.add(right.clone().negate());
        moving = true;
        animDir = isShift ? "right_side_run" : "right_side_walk";
      }
    }

    if (moving) {
      moveDir.normalize().multiplyScalar(this.speed);
    }

    // Apply Velocity
    let velocity = this.body.linvel();
    this.body.setLinvel({ x: moveDir.x, y: velocity.y, z: moveDir.z }, true);

    // ---- ATTACK ----
    if (!this.isAttacking) {
      if (mouse.leftPressed) this.startAttack("slash_2");
      if (mouse.rightPressed) this.startAttack("attack");
    }

    // ---- Animation State Determination (Priority System) ----
    let desiredAnim = "idle";

    // Priority order: 1. ATTACK, 2. BLOCK, 3. CROUCH, 4. JUMP, 5. MOVE, 6. TURN, 7. IDLE
    if (this.isAttacking) {
      desiredAnim = this.currentAnim; // Keep current attack animation
    } else if (this.isBlocking) {
      desiredAnim = "block";
    } else if (this.isCrouching) {
      desiredAnim = "crouch";
    } else if (this.isJumping) {
      desiredAnim = "jump";
    } else if (moving) {
      desiredAnim = animDir;
    } else if (keys["KeyA"]) {
      desiredAnim = "walk";
    } else if (keys["KeyD"]) {
      desiredAnim = "walk";
    }

    this.playAnim(desiredAnim);

    this.input.update();
  }

  // =====================
  // HEALTH
  // =====================
  takeDamage(amount) {
    console.log("Took damage: ", amount);
    this.health -= amount;
    this.health = Math.max(0, this.health);

    this.playHitReaction();
    this.spawnBloodEffect();

    this.updateHealthBar();

    if (this.health === 0) {
      this.die();
    }
  }

  playHitReaction() {
    if (this.isAttacking || this.isBlocking) return;

    const hits = ["impact", "impact_2", "impact_3"];
    const anim = hits[Math.floor(Math.random() * hits.length)];

    this.isHit = true;
    this.playAnim(anim, false);

    setTimeout(() => {
      this.isHit = false;
    }, 500);
  }

  spawnBloodEffect() {
    const geometry = new THREE.PlaneGeometry(0.5, 0.5);

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xaa0000) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform vec3 uColor;

        void main() {
          float dist = length(vUv - 0.5);
          float alpha = smoothstep(0.5, 0.2, dist);

          alpha *= 1.0 - uTime;

          gl_FragColor = vec4(uColor, alpha);
        }
      `,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(this.model.position);
    mesh.position.y += 1.5;

    this.scene.add(mesh);

    let time = 0;

    const animate = () => {
      time += 0.02;
      material.uniforms.uTime.value = time;

      mesh.scale.multiplyScalar(1.05);

      if (time > 1) {
        this.scene.remove(mesh);
        geometry.dispose();
        material.dispose();
        return;
      }

      requestAnimationFrame(animate);
    };

    animate();
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
    this.healthBar.position.set(0, 2.0, 0);
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

  playAnim(name, loop = true) {
    if (this.currentAnim === name) return;

    this.currentAnim = name;
    this.anim.play(name, loop);
  }

  startAttack(name) {
    if (this.isAttacking) return;

    this.isAttacking = true;
    this.attackTimer = 0;
    this.hitRegistered = false;
    this.playAnim(name, false);
    
    // Log synchronization state at moment of attack start
    const pos = this.body.translation();
    console.log(`[ATTACK START] PhysBody: [${pos.x.toFixed(2)}, ${pos.z.toFixed(2)}] | VisualModel: [${this.model.position.x.toFixed(2)}, ${this.model.position.z.toFixed(2)}]`);
  }

  checkHit() {
    if (!this.isLocal) return;
    if (!this.gameCharacters) return;

    const attackRange = 2.0;

    // SINGLE SOURCE OF TRUTH: Physics Body (current world position)
    const a = this.body.translation();
    
    // Log internal vs visual positions to expose desync
    console.log(`[HIT CHECK] Attacker Body: [${a.x.toFixed(2)}, ${a.z.toFixed(2)}] | Model: [${this.model.position.x.toFixed(2)}, ${this.model.position.z.toFixed(2)}]`);

    // Get forward orientation from model rotation (Single axis for horizontal dot product)
    const forward = new THREE.Vector3(
      Math.sin(this.model.rotation.y),
      0,
      Math.cos(this.model.rotation.y)
    ).normalize();

    this.gameCharacters.forEach((target) => {
      if (target === this) return;
      if (target.health <= 0) return;

      const b = target.body.translation();
      
      // Horizontal distance ONLY (Ignore Y differences)
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const distance = Math.sqrt(dx * dx + dz * dz);

      // Attack Cone (Dot Product) - must be facing the target
      const toTarget = new THREE.Vector3(dx, 0, dz).normalize();
      const dot = forward.dot(toTarget);

      console.log(`- TARGET Body: [${b.x.toFixed(2)}, ${b.z.toFixed(2)}] | Model: [${target.model.position.x.toFixed(2)}, ${target.model.position.z.toFixed(2)}] | Dist: ${distance.toFixed(2)} | Dot: ${dot.toFixed(2)}`);

      if (distance < attackRange && dot > 0.3) {
        console.log("!!! HIT REGISTERED !!! Target: ", target.health);
        target.takeDamage(20);
      }
    });
  }
}
