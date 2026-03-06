import * as THREE from "three";
import Rapier from "@dimforge/rapier3d-compat";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export class Interior {
  constructor(scene, world, modelPath, position = new THREE.Vector3(), scale = 1) {
    this.scene = scene;
    this.world = world;

    const loader = new GLTFLoader();

    loader.load(modelPath, (gltf) => {
      this.model = gltf.scene;

      this.model.position.copy(position);
       this.model.scale.setScalar(scale);
      this.scene.add(this.model);

       this.model.updateWorldMatrix(true, true);

      this.createColliders(this.model);
    });
  }

  createColliders(object) {
    object.traverse((child) => {
      if (!child.isMesh) return;

      const geometry = child.geometry;

      // Ensure geometry has vertices
      if (!geometry.attributes.position) return;

      const vertices = geometry.attributes.position.array;
      const indices = geometry.index
        ? geometry.index.array
        : undefined;

      const colliderDesc = Rapier.ColliderDesc.trimesh(
        vertices,
        indices
      );

      const body = this.world.createRigidBody(
        Rapier.RigidBodyDesc.fixed()
      );

      const collider = this.world.createCollider(colliderDesc, body);

      // Apply mesh world transform to collider
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();

      child.getWorldPosition(pos);
      child.getWorldQuaternion(quat);

      body.setTranslation(pos, true);
      body.setRotation(quat, true);
    });
  }
}