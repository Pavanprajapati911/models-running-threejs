import * as THREE from "three";

export class FogSystem {
  constructor(scene, player) {
    this.scene = scene;
    this.player = player;

    this.createGlobalFog();
    this.createPlayerFog();
  }

  createGlobalFog() {
    const fogColor = 0xbfdfff;

    this.scene.background = new THREE.Color(fogColor);
    this.scene.fog = new THREE.FogExp2(fogColor, 0.006);
  }

  createPlayerFog() {
    const count = 150;

    const geometry = new THREE.BufferGeometry();
    const positions = [];

    for (let i = 0; i < count; i++) {
      positions.push(
        (Math.random() - 0.5) * 6,
        Math.random() * 2,
        (Math.random() - 0.5) * 6
      );
    }

    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );

    const texture = new THREE.TextureLoader().load("/textures/smoke.png");

    const material = new THREE.PointsMaterial({
      map: texture,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      size: 1.2,
    });

    this.playerFog = new THREE.Points(geometry, material);
    this.scene.add(this.playerFog);
  }

  update(dt) {
    if (!this.player?.model) return;

    // follow player
    this.playerFog.position.copy(this.player.model.position);

    // animate fog particles
    const positions = this.playerFog.geometry.attributes.position;

    for (let i = 0; i < positions.count; i++) {
      let y = positions.getY(i);

      y += dt * 0.5;
      if (y > 2) y = 0;

      positions.setY(i, y);
    }

    positions.needsUpdate = true;
  }
}