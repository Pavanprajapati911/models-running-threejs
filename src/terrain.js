

// src/terrain.js
import * as THREE from "three";
import Rapier from "@dimforge/rapier3d-compat";

export class InfiniteTerrain {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;

    const size = 400; // total ground size

    /* -------------------- THREE MESH -------------------- */

    const geometry = new THREE.PlaneGeometry(size, size);
    geometry.rotateX(-Math.PI / 2); // make horizontal

    const material = new THREE.MeshStandardMaterial({
      color: 0x4a7c59,
      roughness: 0.9,
      metalness: 0.0,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    /* -------------------- RAPIER COLLIDER -------------------- */

    // Create fixed rigid body
    const groundBody = world.createRigidBody(
      Rapier.RigidBodyDesc.fixed()
    );

    // Create flat cuboid collider
    // IMPORTANT: cuboid uses HALF sizes
    const groundCollider = Rapier.ColliderDesc.cuboid(
      size / 2,  // half width
      0.1,       // half height (thin floor)
      size / 2   // half depth
    ).setFriction(1);

    world.createCollider(groundCollider, groundBody);
  }
}
