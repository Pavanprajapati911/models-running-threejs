// src/editor/EditorController.js
import * as THREE from "three";

export class EditorController {
  constructor(scene, camera, raycaster, chunkManager, placedObjectManager) {
    this.scene = scene;
    this.camera = camera;
    this.raycaster = raycaster;
    this.chunkManager = chunkManager;
    this.placedObjectManager = placedObjectManager;
    this.active = false;
    this.mouse = new THREE.Vector2();

    // Selection now tracks category + specific model index within that category
    this.selection = { category: "jungleTrees", modelIndex: 0 };

    this.previewMesh = null;
    this.rotation = new THREE.Euler(0, 0, 0);
    this.scale = new THREE.Vector3(1, 1, 1);

    this.initPreview();
    this.bindEvents();
  }

  enable() {
    this.active = true;
    if (this.previewMesh) this.previewMesh.visible = true;
  }

  disable() {
    this.active = false;
    this.clearPreview();
  }

  initPreview() {
    const geo = new THREE.SphereGeometry(0.5, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.45, wireframe: false });
    this.previewMesh = new THREE.Mesh(geo, mat);
    this.previewMesh.visible = false;
    this.scene.add(this.previewMesh);
  }

  clearPreview() {
    if (this.previewMesh) this.previewMesh.visible = false;
  }

  /**
   * Select a specific model by category name and index within that category.
   * @param {string} category  - e.g. "grass", "jungleTrees"
   * @param {number} modelIndex - index into the models array for that category
   */
  setSelection(category, modelIndex = 0) {
    this.selection = { category, modelIndex };

    // Tint preview sphere to give visual feedback per category
    const colors = {
      grass: 0x44ff44,
      foliage: 0x00cc88,
      bushes: 0x228833,
      palms: 0xffcc00,
      jungleTrees: 0x00aa44,
      deadTrees: 0x996633,
      rocks: 0x888888
    };
    const color = colors[category] ?? 0x00ff88;
    if (this.previewMesh) this.previewMesh.material.color.set(color);
  }

  bindEvents() {
    window.addEventListener("mousedown", (e) => {
      if (!this.active) return;
      if (document.pointerLockElement) return;
      // Only left-click for placement (right-click is orbit)
      if (e.button !== 0) return;

      this.updateMouse(e);
      this.raycast();

      if (!this.previewMesh.visible) return; // No valid hit

      if (e.shiftKey) {
        this.placedObjectManager.removeObject(this.previewMesh.position);
      } else {
        this.placedObjectManager.addObject(
          this.selection.category,
          this.selection.modelIndex,
          this.previewMesh.position,
          this.rotation.clone(),
          this.scale.clone()
        );
      }
    });

    window.addEventListener("wheel", (e) => {
      if (!this.active) return;
      this.rotation.y += (e.deltaY > 0 ? 1 : -1) * 0.15;
      if (this.previewMesh) this.previewMesh.rotation.copy(this.rotation);
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.active) return;
      this.updateMouse(e);
      this.raycast();
    });
  }

  updateMouse(e) {
    this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  }

  raycast() {
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const meshes = [];
    for (const chunk of this.chunkManager.chunks.values()) {
      if (chunk.mesh) meshes.push(chunk.mesh);
    }

    const intersects = this.raycaster.intersectObjects(meshes);
    if (intersects.length > 0) {
      this.previewMesh.position.copy(intersects[0].point);
      this.previewMesh.visible = true;
    } else {
      this.previewMesh.visible = false;
    }
  }
}
