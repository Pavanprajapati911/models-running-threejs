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
    if (this.selectionBox) this.selectionBox.visible = false;
    this.selectedObject = null;
  }

  initPreview() {
    const geo = new THREE.SphereGeometry(0.5, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.45, wireframe: false });
    this.previewMesh = new THREE.Mesh(geo, mat);
    this.previewMesh.visible = false;
    this.scene.add(this.previewMesh);

    this.selectedObject = null;
    this.selectionBox = new THREE.BoxHelper(this.previewMesh, 0xffff00);
    this.selectionBox.visible = false;
    this.scene.add(this.selectionBox);
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

      // --- 1) Object Raycast for Selection ---
      const placedMeshes = this.placedObjectManager.getAllRenderedMeshes();
      this.raycaster.setFromCamera(this.mouse, this.camera);
      // Ensure recursive intersection so it can hit child meshes of GLTF groups
      const objIntersects = this.raycaster.intersectObjects(placedMeshes, true);

      if (objIntersects.length > 0) {
        // Find the root group which has userData.isPlacedObject
        let selectedNode = objIntersects[0].object;
        while (selectedNode && !selectedNode.userData?.isPlacedObject) {
          selectedNode = selectedNode.parent;
        }

        if (selectedNode) {
          this.selectedObject = selectedNode;
          this.selectionBox.setFromObject(this.selectedObject);
          this.selectionBox.visible = true;
          this.previewMesh.visible = false; // Hide placement preview
          return; // Stop right here, don't place anything
        }
      }

      // --- 2) Terrain Raycast for Placement ---
      this.raycast();

      // If we clicked empty terrain but already had an object selected, just deselect it
      if (this.selectedObject) {
        this.selectedObject = null;
        this.selectionBox.visible = false;
        return; // Prevent placing a new object implicitly while deselecting
      }

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
      if (e.shiftKey) {
        // Shift+Wheel to scale
        const scaleAmount = (e.deltaY > 0 ? -1 : 1) * 0.1;
        this.scale.addScalar(scaleAmount);
        this.scale.x = Math.max(0.1, this.scale.x);
        this.scale.y = Math.max(0.1, this.scale.y);
        this.scale.z = Math.max(0.1, this.scale.z);
        if (this.previewMesh) this.previewMesh.scale.copy(this.scale);
      } else {
        // Normal Wheel to rotate
        this.rotation.y += (e.deltaY > 0 ? 1 : -1) * 0.15;
        if (this.previewMesh) this.previewMesh.rotation.copy(this.rotation);
      }
    });

    window.addEventListener("keydown", (e) => {
      if (!this.active || !this.selectedObject) return;
      
      const objData = this.selectedObject.userData.placedObjectData;
      if (!objData) return;
      
      let changed = false;

      switch(e.code) {
        case "KeyR": // Rotate on Y
          this.selectedObject.rotation.y += Math.PI / 8; // Rotate 22.5 deg
          objData.rotation[1] = this.selectedObject.rotation.y;
          changed = true;
          break;
        case "KeyT": // Scale Up
          this.selectedObject.scale.addScalar(0.1);
          objData.scale = [this.selectedObject.scale.x, this.selectedObject.scale.y, this.selectedObject.scale.z];
          changed = true;
          break;
        case "KeyG": // Scale Down
          this.selectedObject.scale.addScalar(-0.1);
          this.selectedObject.scale.clampScalar(0.1, 100);
          objData.scale = [this.selectedObject.scale.x, this.selectedObject.scale.y, this.selectedObject.scale.z];
          changed = true;
          break;
        case "Delete":
        case "Backspace": // Delete object
          this.placedObjectManager.removeObjectExact(objData);
          this.selectedObject = null;
          this.selectionBox.visible = false;
          break;
      }

      if (changed) {
        this.selectionBox.update();
      }
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.active) return;
      this.updateMouse(e);
      // We only want to show placement preview if nothing is selected
      if (!this.selectedObject) {
        this.raycast();
      } else {
        this.previewMesh.visible = false;
      }
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
