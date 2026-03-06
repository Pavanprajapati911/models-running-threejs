// import * as THREE from "three";

// export class InvisibleMesh {
//   constructor(
//     scene,
//     width = 1,
//     height = 1,
//     depth = 1,
//     position = new THREE.Vector3(),
//     rotation = new THREE.Euler(),
//   ) {
//     this.scene = scene;

//     const geometry = new THREE.BoxGeometry(width, height, depth);

//     // const material = new THREE.MeshBasicMaterial({
//     //   visible: false, // completely invisible
//     // });
//     const material = new THREE.MeshBasicMaterial({
//       color: 0xff0000,
//       wireframe: true,
//       transparent: true,
//       opacity: 0.2,
//     });

//     this.mesh = new THREE.Mesh(geometry, material);

//     this.mesh.position.copy(position);
//     this.mesh.rotation.copy(rotation);

//     scene.add(this.mesh);
//   }
// }

import * as THREE from "three";
import Rapier from "@dimforge/rapier3d-compat";

export class InvisibleMesh {
  constructor(
    scene,
    world,
    width = 1,
    height = 1,
    depth = 1,
    position = new THREE.Vector3(),
    rotation = new THREE.Euler()
  ) {
    this.scene = scene;
    this.world = world;

    // -------- THREE MESH --------
    const geometry = new THREE.BoxGeometry(width, height, depth);

    const material = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      wireframe: true,
      transparent: true,
      opacity: 0.2
    });

    this.mesh = new THREE.Mesh(geometry, material);

    this.mesh.position.copy(position);
    this.mesh.rotation.copy(rotation);

    scene.add(this.mesh);

    // -------- PHYSICS --------
    const bodyDesc = Rapier.RigidBodyDesc.fixed()
      .setTranslation(position.x, position.y, position.z)
      .setRotation({
        x: 0,
        y: Math.sin(rotation.y / 2),
        z: 0,
        w: Math.cos(rotation.y / 2)
      });

    this.body = world.createRigidBody(bodyDesc);

    // Rapier cuboid uses HALF sizes
    const colliderDesc = Rapier.ColliderDesc.cuboid(
      width / 2,
      height / 2,
      depth / 2
    ).setFriction(1);

    world.createCollider(colliderDesc, this.body);
  }
}