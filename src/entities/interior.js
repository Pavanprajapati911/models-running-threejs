import * as THREE from "three";
import Rapier from "@dimforge/rapier3d-compat";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export class Interior {
  constructor(
    scene,
    world,
    modelPath,
    position = new THREE.Vector3(),
    scale = 1,
  ) {
    this.scene = scene;
    // this.world = world;

    const loader = new GLTFLoader();

    loader.load(modelPath, (gltf) => {
      this.model = gltf.scene;

      this.model.position.copy(position);
      this.model.scale.setScalar(scale);
      this.scene.add(this.model);

      // this.model.updateWorldMatrix(true, true);

      // this.createColliders(this.model);
    });
  }

  createColliders(object) {
    object.updateMatrixWorld(true);

    object.traverse((child) => {
      if (!child.isMesh) return;

      const geometry = child.geometry;

      // compute local bounding box
      geometry.computeBoundingBox();

      const bbox = geometry.boundingBox;
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();

      bbox.getSize(size);
      bbox.getCenter(center);

      // world transform
      const worldPos = new THREE.Vector3();
      const worldQuat = new THREE.Quaternion();

      child.getWorldPosition(worldPos);
      child.getWorldQuaternion(worldQuat);

      // adjust center relative to mesh
      const worldCenter = center
        .clone()
        .applyQuaternion(worldQuat)
        .add(worldPos);

      // create rigid body
      const bodyDesc = Rapier.RigidBodyDesc.fixed().setTranslation(
        worldCenter.x,
        worldCenter.y,
        worldCenter.z,
      );

      const body = this.world.createRigidBody(bodyDesc);

      const colliderDesc = Rapier.ColliderDesc.cuboid(
        size.x / 2,
        size.y / 2,
        size.z / 2,
      ).setRotation({
        x: worldQuat.x,
        y: worldQuat.y,
        z: worldQuat.z,
        w: worldQuat.w,
      });

      this.world.createCollider(colliderDesc, body);
    });
  }
}
