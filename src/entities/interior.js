import * as THREE from "three";
import Rapier from "@dimforge/rapier3d-compat";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export class Interior {
  static cache = new Map(); // model cache
  static loader = null;

  constructor(
    scene,
    world,
    modelPath,
    position = new THREE.Vector3(),
    scale = 1,
    loadingManager
  ) {
    this.scene = scene;
    this.world = world;

    if (!Interior.loader) {
      Interior.loader = new GLTFLoader(loadingManager);
    }

    // MODEL ALREADY LOADED
    if (Interior.cache.has(modelPath)) {
      const original = Interior.cache.get(modelPath);
      this.createInstance(original, position, scale);
      return;
    }

    // LOAD MODEL FIRST TIME
    Interior.loader.load(modelPath, (gltf) => {
      const original = gltf.scene;

      Interior.cache.set(modelPath, original);

      this.createInstance(original, position, scale);
    });
  }

  createInstance(original, position, scale) {
    const model = original.clone(true);

    model.position.copy(position);
    model.scale.setScalar(scale);

    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    this.scene.add(model);

    // optional physics
    // this.createColliders(model);
  }

  createColliders(object) {
    object.updateMatrixWorld(true);

    object.traverse((child) => {
      if (!child.isMesh) return;

      const geometry = child.geometry;

      geometry.computeBoundingBox();

      const bbox = geometry.boundingBox;
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();

      bbox.getSize(size);
      bbox.getCenter(center);

      const worldPos = new THREE.Vector3();
      const worldQuat = new THREE.Quaternion();

      child.getWorldPosition(worldPos);
      child.getWorldQuaternion(worldQuat);

      const worldCenter = center
        .clone()
        .applyQuaternion(worldQuat)
        .add(worldPos);

      const bodyDesc = Rapier.RigidBodyDesc.fixed().setTranslation(
        worldCenter.x,
        worldCenter.y,
        worldCenter.z
      );

      const body = this.world.createRigidBody(bodyDesc);

      const colliderDesc = Rapier.ColliderDesc.cuboid(
        size.x / 2,
        size.y / 2,
        size.z / 2
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