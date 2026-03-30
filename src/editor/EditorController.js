// src/editor/EditorController.js
import * as THREE from "three";
import GUI from "lil-gui";
import { GRASS_VARIATIONS } from "../environment/GrassManager.js";

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

    this.copiedData = null;
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

    this.grassGui = null;
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

      // 🔥 FIX: Ignore clicks on GUI elements
      // Block ALL UI clicks (buttons, panels, etc.)
      if (
        e.target.closest('.lil-gui') ||
        e.target.closest('button') ||
        e.target.closest('input') ||
        e.target.closest('select') ||
        e.target.closest('textarea') ||
        e.target.closest('[data-ui]')
      ) {
        return;
      }

      // Only left-click for placement (right-click is orbit)
      if (e.button !== 0) return;

      this.updateMouse(e);

      // --- Selection Raycast ---
      const placedMeshes = this.placedObjectManager.getAllRenderedMeshes();
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const objIntersects = this.raycaster.intersectObjects(placedMeshes, true);

      if (objIntersects.length > 0) {
        let selectedNode = objIntersects[0].object;
        while (selectedNode && !selectedNode.userData?.isPlacedObject && !selectedNode.userData?.isGrassPatch) {
          selectedNode = selectedNode.parent;
        }

        if (selectedNode) {
          this.selectedObject = selectedNode;
          this.selectionBox.setFromObject(this.selectedObject);
          this.selectionBox.visible = true;
          this.previewMesh.visible = false;

          if (this.selectedObject.userData.isGrassPatch) {
            this.openGrassGui(this.selectedObject.userData.placedObjectData, this.selectedObject);
          } else {
            this.closeGrassGui();
          }

          return;
        }
      }

      // --- 2) Terrain Raycast for Placement ---
      this.raycast();

      // If we clicked empty terrain but already had an object selected, just deselect it
      if (this.selectedObject) {
        this.selectedObject = null;
        this.selectionBox.visible = false;
        this.closeGrassGui();
        return;
      }

      if (!this.previewMesh.visible) return; // No valid hit

      if (e.shiftKey) {
        this.placedObjectManager.removeObject(this.previewMesh.position);
      } else {
        if (this.selection.category === "grass_static" || this.selection.category === "grass_animated") {
          const vParams = GRASS_VARIATIONS[this.getVariationName()] || {};
          this.placedObjectManager.addGrass(
            this.getVariationName(),
            this.previewMesh.position,
            this.rotation.clone(),
            this.scale.clone(),
            vParams
          );
        } else {
          this.placedObjectManager.addObject(
            this.selection.category,
            this.selection.modelIndex,
            this.previewMesh.position,
            this.rotation.clone(),
            this.scale.clone()
          );
        }
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
      if (!this.active) return;
      
      // Block UI interaction
      if (e.target.closest('[data-ui], .lil-gui')) return;

      // --- 1) COPY (CTRL+C) ---
      if (e.ctrlKey && e.code === "KeyC") {
        if (this.selectedObject) {
          const data = this.selectedObject.userData.placedObjectData;
          if (data) {
            this.copiedData = JSON.parse(JSON.stringify(data));
            // Strip location specific data
            delete this.copiedData.position;
            delete this.copiedData.chunk;
            console.log("📋 Object copied", this.copiedData);
          }
        }
        return;
      }

      // --- 2) PASTE (CTRL+V) ---
      if (e.ctrlKey && e.code === "KeyV") {
        if (this.copiedData && this.previewMesh.visible) {
          const pos = this.previewMesh.position.clone();
          const rot = new THREE.Euler(this.copiedData.rotation[0], this.copiedData.rotation[1], this.copiedData.rotation[2]);
          const scale = new THREE.Vector3(this.copiedData.scale[0], this.copiedData.scale[1], this.copiedData.scale[2]);

          if (this.copiedData.variation) {
            // Paste Grass
            this.placedObjectManager.addGrass(
              this.copiedData.variation,
              pos,
              rot,
              scale,
              this.copiedData.params
            );
          } else {
            // Paste Object
            this.placedObjectManager.addObject(
              this.copiedData.type,
              this.copiedData.modelIndex,
              pos,
              rot,
              scale
            );
          }
          console.log("📌 Object pasted");
        }
        return;
      }

      if (!this.selectedObject) return;

      const objData = this.selectedObject.userData.placedObjectData;
      if (!objData) return;

      let changed = false;

      switch (e.code) {
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
          this.closeGrassGui();
          break;
      }

      if (changed) {
        this.selectedObject.updateMatrix();
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

  getVariationName() {
    const list = this.chunkManager.vegManager.models.get(this.selection.category);
    if (!list) return "light_wind";
    const item = list[this.selection.modelIndex];
    return item ? item.name : "light_wind";
  }

  openGrassGui(data, mesh) {
    this.closeGrassGui();
    this.grassGui = new GUI({ title: `🌿 Edit Patch: ${data.variation}` });
    this.grassGui.domElement.style.top = "10px";
    this.grassGui.domElement.style.right = "340px";

    const params = data.params;

    const updateRef = () => {
      // Re-spawn the patch locally or update uniforms
      // Re-creating the InstancedMesh for density changes is easiest
      const key = `${data.chunk[0]},${data.chunk[1]}`;
      const chunk = this.chunkManager.chunks.get(key);
      if (chunk) {
        chunk.removeGrassPatch(data);
        chunk.spawnGrassPatch(data);
        // Find the new mesh
        const newPair = chunk.placedGrass.find(pg => pg.data === data);
        if (newPair) {
          this.selectedObject = newPair.mesh;
          this.selectionBox.setFromObject(this.selectedObject);
        }
      }
    };

    this.grassGui.add(params, "height", 0.1, 5, 0.1).onFinishChange(updateRef);
    this.grassGui.add(params, "width", 0.01, 0.2, 0.005).onFinishChange(updateRef);
    this.grassGui.add(params, "density", 100, 10000, 100).onFinishChange(updateRef);
    this.grassGui.add(params, "radius", 1, 30, 1).onFinishChange(updateRef);
    this.grassGui.add(params, "windStrength", 0, 2, 0.01).onChange(v => {
      if (mesh.material.uniforms.uWindStrength) mesh.material.uniforms.uWindStrength.value = v;
    });
    this.grassGui.add(params, "windSpeed", 0, 10, 0.1).onChange(v => {
      if (mesh.material.uniforms.uWindSpeed) mesh.material.uniforms.uWindSpeed.value = v;
    });

    this.grassGui.addColor(params, "baseColor").onChange(v => {
      if (mesh.material.uniforms.uBaseColor) mesh.material.uniforms.uBaseColor.value.set(v);
    });
    this.grassGui.addColor(params, "tipColor").onChange(v => {
      if (mesh.material.uniforms.uTipColor) mesh.material.uniforms.uTipColor.value.set(v);
    });
  }

  closeGrassGui() {
    if (this.grassGui) {
      this.grassGui.destroy();
      this.grassGui = null;
    }
  }
}
