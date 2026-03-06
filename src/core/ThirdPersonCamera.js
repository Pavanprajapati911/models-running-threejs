import * as THREE from "three";

export class ThirdPersonCamera {
  constructor(camera) {
    this.camera = camera;

    this.target = null;

    // Camera offsets
    this.offset = new THREE.Vector3(0, 2.5, -5);
    this.lookOffset = new THREE.Vector3(0, 1.5, 0);

    // Smoothing
    this.positionLerp = 0.08;
    this.lookLerp = 0.15;

    this._desiredPosition = new THREE.Vector3();
    this._desiredLook = new THREE.Vector3();
  }

  setTarget(player) {
    this.target = player;
  }

  update(dt) {
    if (!this.target || !this.target.model) return;

    const player = this.target.model;

    // Rotate offset with player direction
    const offset = this.offset.clone();
    offset.applyQuaternion(player.quaternion);

    // Desired camera position
    this._desiredPosition.copy(player.position).add(offset);

    // Desired look-at point
    this._desiredLook.copy(player.position).add(this.lookOffset);

    // Smooth movement
    this.camera.position.lerp(this._desiredPosition, this.positionLerp);
    this.camera.lookAt(
      this.camera.position.clone().lerp(this._desiredLook, this.lookLerp)
    );
  }
}
