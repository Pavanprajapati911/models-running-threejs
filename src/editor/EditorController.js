// src/editor/EditorController.js
import * as THREE from "three";
import GUI from "lil-gui";
import { GRASS_VARIATIONS } from "../environment/GrassManager.js";

// ─────────────────────────────────────────────────────────────────────────────
//  EditorController  –  Object editor with UNDO (Ctrl+Z)
//
//  Undo stack records a closure for every reversible action.
//  Ctrl+Z pops and calls the last closure.
// ─────────────────────────────────────────────────────────────────────────────

const UNDO_MAX = 60;

export class EditorController {
  constructor(scene, camera, raycaster, chunkManager, placedObjectManager, terrainSplineManager) {
    this.scene = scene;
    this.camera = camera;
    this.raycaster = raycaster;
    this.chunkManager = chunkManager;
    this.placedObjectManager = placedObjectManager;
    this.terrainSplineManager = terrainSplineManager;

    this.active = false;
    this.mouse = new THREE.Vector2();

    this.editorMode = "object";

    // ── Object mode state ────────────────────────────────────────────────────
    this.selection = { category: "jungleTrees", modelIndex: 0 };
    this.previewMesh = null;
    this.rotation = new THREE.Euler(0, 0, 0);
    this.scale = new THREE.Vector3(1, 1, 1);
    this.copiedData = null;
    this.selectedObject = null;
    this.selectionBox = null;
    this.grassGui = null;

    // ── Terrain mode state ──────────────────────────────────────────────────
    this.isDrawingSpline = false;
    this.tempSplinePoints = [];
    this.selectedSplineId = null;
    this.draggedPointIndex = -1;

    this.splinePointsGroup = new THREE.Group();
    this.scene.add(this.splinePointsGroup);
    this.splineLinesGroup = new THREE.Group();
    this.scene.add(this.splineLinesGroup);

    // ── Undo stack ───────────────────────────────────────────────────────────
    /** @type {Array<() => void>} */
    this._undoStack = [];

    this.initPreview();
    this.bindEvents();
    this.renderSplines();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // UNDO SYSTEM
  // ══════════════════════════════════════════════════════════════════════════

  _pushUndo(undoFn) {
    this._undoStack.push(undoFn);
    if (this._undoStack.length > UNDO_MAX) this._undoStack.shift();
  }

  _undo() {
    const fn = this._undoStack.pop();
    if (fn) {
      fn();
      console.log(`↩️  Undo (${this._undoStack.length} left)`);
    } else {
      console.log("↩️  Nothing to undo");
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ══════════════════════════════════════════════════════════════════════════

  enable() {
    this.active = true;
    if (this.previewMesh) this.previewMesh.visible = true;
  }

  disable() {
    this.active = false;
    this.clearPreview();
    if (this.selectionBox) this.selectionBox.visible = false;
    this.selectedObject = null;
    this.closeGrassGui();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // OBJECT MODE INIT
  // ══════════════════════════════════════════════════════════════════════════

  initPreview() {
    const geo = new THREE.SphereGeometry(0.5, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.45 });
    this.previewMesh = new THREE.Mesh(geo, mat);
    this.previewMesh.visible = false;
    this.scene.add(this.previewMesh);

    this.selectionBox = new THREE.BoxHelper(this.previewMesh, 0xffff00);
    this.selectionBox.visible = false;
    this.scene.add(this.selectionBox);
  }

  clearPreview() {
    if (this.previewMesh) this.previewMesh.visible = false;
  }

  setSelection(category, modelIndex = 0) {
    this.selection = { category, modelIndex };
    const colors = {
      grass: 0x44ff44, foliage: 0x00cc88, bushes: 0x228833,
      palms: 0xffcc00, jungleTrees: 0x00aa44, deadTrees: 0x996633, rocks: 0x888888
    };
    if (this.previewMesh) this.previewMesh.material.color.set(colors[category] ?? 0x00ff88);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EDITOR MODE SWITCHING
  // ══════════════════════════════════════════════════════════════════════════

  setEditorMode(mode) {
    if (mode === this.editorMode) return;
    if (this.editorMode === "object") {
      this.clearPreview();
      this.selectedObject = null;
      if (this.selectionBox) this.selectionBox.visible = false;
      this.closeGrassGui();
    } else if (this.editorMode === "terrain") {
      this.isDrawingSpline = false;
      this.tempSplinePoints = [];
      this.selectedSplineId = null;
      this.renderSplines();
    }
    this.editorMode = mode;
    this._broadcastModeChange();
  }

  _broadcastModeChange() {
    const indicator = document.getElementById("terrain-mode-indicator");
    if (indicator) {
      indicator.textContent = this.editorMode === "object" ? "🪵 OBJECT MODE" : "⛰️ TERRAIN MODE";
      indicator.style.color = this.editorMode === "object" ? "#7fffc4" : "#ffcc77";
    }
    const objPanel = document.getElementById("object-mode-panel");
    const terPanel = document.getElementById("terrain-mode-panel");
    if (objPanel) objPanel.style.display = this.editorMode === "object" ? "" : "none";
    if (terPanel) terPanel.style.display = this.editorMode === "terrain" ? "" : "none";
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EVENT BINDING
  // ══════════════════════════════════════════════════════════════════════════

  bindEvents() {
    // ── MOUSE DOWN ──────────────────────────────────────────────────────────
    window.addEventListener("mousedown", (e) => {
      if (!this.active) return;
      if (document.pointerLockElement) return;
      if (e.target.closest(".lil-gui, button, input, select, textarea, [data-ui]")) return;

      this.updateMouse(e);
      if (this.editorMode === "object") {
        this._onObjectMouseDown(e);
      } else if (this.editorMode === "terrain") {
        this._onTerrainMouseDown(e);
      }
    });

    // ── MOUSE MOVE ──────────────────────────────────────────────────────────
    window.addEventListener("mousemove", (e) => {
      if (!this.active) return;
      this.updateMouse(e);
      if (this.editorMode === "object") {
        if (!this.selectedObject) this.raycast();
        else this.previewMesh.visible = false;
      } else if (this.editorMode === "terrain") {
        this._onTerrainMouseMove(e);
      }
    });

    // ── MOUSE UP ────────────────────────────────────────────────────────────
    window.addEventListener("mouseup", (e) => {
      if (!this.active) return;
      if (this.editorMode === "terrain") {
        this.draggedPointIndex = -1;
      }
    });

    // ── WHEEL ───────────────────────────────────────────────────────────────
    window.addEventListener("wheel", (e) => {
      if (!this.active || this.editorMode !== "object") return;
      if (e.shiftKey) {
        const amt = (e.deltaY > 0 ? -1 : 1) * 0.1;
        this.scale.addScalar(amt);
        this.scale.x = Math.max(0.1, this.scale.x);
        this.scale.y = Math.max(0.1, this.scale.y);
        this.scale.z = Math.max(0.1, this.scale.z);
        if (this.previewMesh) this.previewMesh.scale.copy(this.scale);
      } else {
        this.rotation.y += (e.deltaY > 0 ? 1 : -1) * 0.15;
        if (this.previewMesh) this.previewMesh.rotation.copy(this.rotation);
      }
    });

    // ── KEY DOWN ────────────────────────────────────────────────────────────
    window.addEventListener("keydown", (e) => {
      if (!this.active) return;
      if (e.target.closest("[data-ui], .lil-gui")) return;

      if (e.code === "Digit1") this.setEditorMode("terrain");
      if (e.code === "Digit2") this.setEditorMode("object");

      if (e.ctrlKey && e.code === "KeyZ") {
        e.preventDefault();
        this._undo();
        return;
      }

      if (this.editorMode === "object") {
        this._onObjectKeyDown(e);
      } else if (this.editorMode === "terrain") {
        this._onTerrainKeyDown(e);
      }
    });
  }

  // OBJECT MODE – INPUT HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  _onObjectMouseDown(e) {
    if (e.button !== 0) return;

    const placedMeshes = this.placedObjectManager.getAllRenderedMeshes();
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const objHits = this.raycaster.intersectObjects(placedMeshes, true);

    if (objHits.length > 0) {
      let node = objHits[0].object;
      while (node && !node.userData?.isPlacedObject && !node.userData?.isGrassPatch) {
        node = node.parent;
      }
      if (node) {
        this.selectedObject = node;
        this.selectionBox.setFromObject(node);
        this.selectionBox.visible = true;
        this.previewMesh.visible = false;
        if (node.userData.isGrassPatch) this.openGrassGui(node.userData.placedObjectData, node);
        else this.closeGrassGui();
        return;
      }
    }

    this.raycast();

    if (this.selectedObject) {
      this.selectedObject = null;
      this.selectionBox.visible = false;
      this.closeGrassGui();
      return;
    }

    if (!this.previewMesh.visible) return;

    const pos   = this.previewMesh.position.clone();
    const rot   = this.rotation.clone();
    const scale = this.scale.clone();

    if (e.shiftKey) {
      const removed = this._captureNearbyObjects(pos, 2);
      this.placedObjectManager.removeObject(pos);
      if (removed.length > 0) {
        this._pushUndo(() => {
          removed.forEach(o => {
            if (o.variation) {
              this.placedObjectManager.addGrass(
                o.variation,
                new THREE.Vector3(o.position[0], o.position[1], o.position[2]),
                new THREE.Euler(o.rotation[0], o.rotation[1], o.rotation[2]),
                new THREE.Vector3(o.scale[0], o.scale[1], o.scale[2]),
                o.params
              );
            } else {
              this.placedObjectManager.addObject(
                o.type, o.modelIndex,
                new THREE.Vector3(o.position[0], o.position[1], o.position[2]),
                new THREE.Euler(o.rotation[0], o.rotation[1], o.rotation[2]),
                new THREE.Vector3(o.scale[0], o.scale[1], o.scale[2])
              );
            }
          });
        });
      }
    } else {
      if (this.selection.category === "grass_static" || this.selection.category === "grass_animated") {
        const vParams = GRASS_VARIATIONS[this.getVariationName()] || {};
        const obj = this.placedObjectManager.addGrass(this.getVariationName(), pos, rot, scale, vParams);
        if (obj) this._pushUndo(() => this.placedObjectManager.removeObjectExact(obj));
      } else {
        const obj = this.placedObjectManager.addObject(
          this.selection.category, this.selection.modelIndex, pos, rot, scale
        );
        if (obj) this._pushUndo(() => this.placedObjectManager.removeObjectExact(obj));
      }
    }
  }

  _captureNearbyObjects(pos, radius) {
    const cs  = this.chunkManager.chunkSize;
    const cx  = Math.floor(pos.x / cs);
    const cz  = Math.floor(pos.z / cs);
    const key = `${cx},${cz}`;
    const captured = [];
    const r2 = radius * radius;

    const check = (list) => {
      if (!list) return;
      for (const o of list) {
        const dx = o.position[0] - pos.x;
        const dy = o.position[1] - pos.y;
        const dz = o.position[2] - pos.z;
        if (dx * dx + dy * dy + dz * dz < r2) captured.push(JSON.parse(JSON.stringify(o)));
      }
    };

    check(this.placedObjectManager.placedObjects.get(key));
    check(this.placedObjectManager.placedGrass.get(key));
    return captured;
  }

  _onObjectKeyDown(e) {
    if (e.ctrlKey && e.code === "KeyC") {
      if (this.selectedObject) {
        const data = this.selectedObject.userData.placedObjectData;
        if (data) {
          this.copiedData = JSON.parse(JSON.stringify(data));
          delete this.copiedData.position;
          delete this.copiedData.chunk;
          console.log("📋 Copied", this.copiedData);
        }
      }
      return;
    }

    if (e.ctrlKey && e.code === "KeyV") {
      if (this.copiedData && this.previewMesh.visible) {
        const pos   = this.previewMesh.position.clone();
        const rot   = new THREE.Euler(...this.copiedData.rotation);
        const scale = new THREE.Vector3(...this.copiedData.scale);
        let obj;
        if (this.copiedData.variation) {
          obj = this.placedObjectManager.addGrass(this.copiedData.variation, pos, rot, scale, this.copiedData.params);
        } else {
          obj = this.placedObjectManager.addObject(this.copiedData.type, this.copiedData.modelIndex, pos, rot, scale);
        }
        if (obj) this._pushUndo(() => this.placedObjectManager.removeObjectExact(obj));
        console.log("📌 Pasted");
      }
      return;
    }

    if (!this.selectedObject) return;
    const objData = this.selectedObject.userData.placedObjectData;
    if (!objData) return;

    let changed = false;

    switch (e.code) {
      case "KeyR": {
        const oldY = this.selectedObject.rotation.y;
        this.selectedObject.rotation.y += Math.PI / 8;
        objData.rotation[1] = this.selectedObject.rotation.y;
        this._pushUndo(() => {
          this.selectedObject && (this.selectedObject.rotation.y = oldY);
          objData.rotation[1] = oldY;
          this.selectedObject?.updateMatrix();
          this.selectionBox?.update();
        });
        changed = true;
        break;
      }
      case "KeyT": {
        const oldScale = this.selectedObject.scale.clone();
        this.selectedObject.scale.addScalar(0.1);
        objData.scale = [this.selectedObject.scale.x, this.selectedObject.scale.y, this.selectedObject.scale.z];
        this._pushUndo(() => {
          this.selectedObject?.scale.copy(oldScale);
          objData.scale = [oldScale.x, oldScale.y, oldScale.z];
          this.selectedObject?.updateMatrix();
          this.selectionBox?.update();
        });
        changed = true;
        break;
      }
      case "KeyG": {
        const oldScale = this.selectedObject.scale.clone();
        this.selectedObject.scale.addScalar(-0.1);
        this.selectedObject.scale.clampScalar(0.1, 100);
        objData.scale = [this.selectedObject.scale.x, this.selectedObject.scale.y, this.selectedObject.scale.z];
        this._pushUndo(() => {
          this.selectedObject?.scale.copy(oldScale);
          objData.scale = [oldScale.x, oldScale.y, oldScale.z];
          this.selectedObject?.updateMatrix();
          this.selectionBox?.update();
        });
        changed = true;
        break;
      }
      case "Delete":
      case "Backspace": {
        const snapshot = JSON.parse(JSON.stringify(objData));
        this.placedObjectManager.removeObjectExact(objData);
        this.selectedObject = null;
        this.selectionBox.visible = false;
        this.closeGrassGui();
        this._pushUndo(() => {
          if (snapshot.variation) {
            this.placedObjectManager.addGrass(
              snapshot.variation,
              new THREE.Vector3(snapshot.position[0], snapshot.position[1], snapshot.position[2]),
              new THREE.Euler(snapshot.rotation[0], snapshot.rotation[1], snapshot.rotation[2]),
              new THREE.Vector3(snapshot.scale[0], snapshot.scale[1], snapshot.scale[2]),
              snapshot.params
            );
          } else {
            this.placedObjectManager.addObject(
              snapshot.type, snapshot.modelIndex,
              new THREE.Vector3(snapshot.position[0], snapshot.position[1], snapshot.position[2]),
              new THREE.Euler(snapshot.rotation[0], snapshot.rotation[1], snapshot.rotation[2]),
              new THREE.Vector3(snapshot.scale[0], snapshot.scale[1], snapshot.scale[2])
            );
          }
        });
        break;
      }
    }

    if (changed) {
      this.selectedObject?.updateMatrix();
      this.selectionBox?.update();
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SHARED UTILITIES
  // ══════════════════════════════════════════════════════════════════════════

  updateMouse(e) {
    this.mouse.x =  (e.clientX / window.innerWidth)  * 2 - 1;
    this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  }

  _raycastTerrain() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const meshes = [];
    for (const chunk of this.chunkManager.chunks.values()) {
      if (chunk.mesh) meshes.push(chunk.mesh);
    }
    const hits = this.raycaster.intersectObjects(meshes);
    return hits.length > 0 ? hits[0].point : null;
  }

  raycast() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const meshes = [];
    for (const chunk of this.chunkManager.chunks.values()) {
      if (chunk.mesh) meshes.push(chunk.mesh);
    }
    const hits = this.raycaster.intersectObjects(meshes);
    if (hits.length > 0) {
      this.previewMesh.position.copy(hits[0].point);
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

  // ══════════════════════════════════════════════════════════════════════════
  // GRASS GUI
  // ══════════════════════════════════════════════════════════════════════════

  openGrassGui(data, mesh) {
    this.closeGrassGui();
    this.grassGui = new GUI({ title: `🌿 Edit Patch: ${data.variation}` });
    this.grassGui.domElement.style.top   = "10px";
    this.grassGui.domElement.style.right = "340px";

    const params    = data.params;
    const updateRef = () => {
      const key   = `${data.chunk[0]},${data.chunk[1]}`;
      const chunk = this.chunkManager.chunks.get(key);
      if (chunk) {
        chunk.removeGrassPatch(data);
        chunk.spawnGrassPatch(data);
        const newPair = chunk.placedGrass.find(pg => pg.data === data);
        if (newPair) {
          this.selectedObject = newPair.mesh;
          this.selectionBox.setFromObject(this.selectedObject);
        }
      }
    };

    this.grassGui.add(params, "height",      0.1,  5,     0.1).onFinishChange(updateRef);
    this.grassGui.add(params, "width",        0.01, 0.2,   0.005).onFinishChange(updateRef);
    this.grassGui.add(params, "density",      100,  10000, 100).onFinishChange(updateRef);
    this.grassGui.add(params, "radius",       1,    30,    1).onFinishChange(updateRef);
    this.grassGui.add(params, "windStrength", 0,    2,     0.01).onChange(v => {
      if (mesh.material.uniforms?.uWindStrength) mesh.material.uniforms.uWindStrength.value = v;
    });
    this.grassGui.add(params, "windSpeed",    0,    10,    0.1).onChange(v => {
      if (mesh.material.uniforms?.uWindSpeed) mesh.material.uniforms.uWindSpeed.value = v;
    });
    this.grassGui.addColor(params, "baseColor").onChange(v => {
      if (mesh.material.uniforms?.uBaseColor) mesh.material.uniforms.uBaseColor.value.set(v);
    });
    this.grassGui.addColor(params, "tipColor").onChange(v => {
      if (mesh.material.uniforms?.uTipColor) mesh.material.uniforms.uTipColor.value.set(v);
    });
  }

  closeGrassGui() {
    if (this.grassGui) { this.grassGui.destroy(); this.grassGui = null; }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TERRAIN MODE – INPUT HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  _onTerrainMouseDown(e) {
    if (e.button !== 0) return;
    
    const hit = this._raycastTerrain();
    if (!hit) return;

    if (this.isDrawingSpline) {
        this.tempSplinePoints.push([hit.x, hit.z]);
        this.renderSplines();
        return;
    }

    // Check if dragging a point
    const pointHit = this._raycastSplinePoints();
    if (pointHit) {
        const { splineId, pointIndex } = pointHit.object.userData;
        this.selectedSplineId = splineId;
        this.draggedPointIndex = pointIndex;
        this.renderSplines();
        return;
    }

    // Check if selecting a spline
    const selected = this._selectClosestSpline(hit.x, hit.z);
    if (selected) {
        this.selectedSplineId = selected.id;
    } else {
        this.selectedSplineId = null;
    }
    this.renderSplines();
  }

  _onTerrainMouseMove(e) {
    if (this.draggedPointIndex !== -1 && this.selectedSplineId) {
        const hit = this._raycastTerrain();
        if (hit) {
            const spline = this.terrainSplineManager.getSplines().find(s => s.id === this.selectedSplineId);
            if (spline && spline.points[this.draggedPointIndex]) {
                spline.points[this.draggedPointIndex] = [hit.x, hit.z];
                this.terrainSplineManager.updateSpline(spline.id, spline);
                this.chunkManager.regenerateFromSplines();
                this.renderSplines();
            }
        }
    }
  }

  _onTerrainKeyDown(e) {
    if (e.code === "KeyC") {
        this.isDrawingSpline = true;
        this.tempSplinePoints = [];
        this.renderSplines();
        return;
    }

    if (e.code === "Enter" && this.isDrawingSpline) {
        this.isDrawingSpline = false;
        if (this.tempSplinePoints.length >= 2) {
            const added = this.terrainSplineManager.addSpline({
                type: "ridge",
                points: [...this.tempSplinePoints],
                width: 10,
                strength: 5,
                falloff: 2
            });
            this.selectedSplineId = added.id;
            this.chunkManager.regenerateFromSplines();
            
            // Undo
            this._pushUndo(() => {
                this.terrainSplineManager.removeSpline(added.id);
                this.chunkManager.regenerateFromSplines();
                if (this.selectedSplineId === added.id) this.selectedSplineId = null;
                this.renderSplines();
            });
        }
        this.tempSplinePoints = [];
        this.renderSplines();
        return;
    }

    if (!this.selectedSplineId) return;

    const spline = this.terrainSplineManager.getSplines().find(s => s.id === this.selectedSplineId);
    if (!spline) return;

    let changed = false;
    const oldState = JSON.parse(JSON.stringify(spline));

    if (e.code === "KeyR") { spline.type = "ridge"; changed = true; }
    if (e.code === "KeyV") { spline.type = "valley"; changed = true; }
    if (e.code === "KeyF") { spline.type = "plateau"; changed = true; }
    if (e.code === "KeyO") { spline.type = "road"; changed = true; }

    if (e.code === "Delete" || e.code === "Backspace") {
        this.terrainSplineManager.removeSpline(this.selectedSplineId);
        
        this._pushUndo(() => {
            this.terrainSplineManager.addSpline(oldState);
            this.chunkManager.regenerateFromSplines();
            this.selectedSplineId = oldState.id;
            this.renderSplines();
        });
        
        this.selectedSplineId = null;
        changed = true;
    }

    if (changed) {
        if (this.selectedSplineId) {
            this.terrainSplineManager.updateSpline(spline.id, spline);
            this._pushUndo(() => {
                const s = this.terrainSplineManager.getSplines().find(sx => sx.id === oldState.id);
                if (s) {
                    Object.assign(s, oldState);
                    this.terrainSplineManager.updateSpline(s.id, s);
                    this.chunkManager.regenerateFromSplines();
                    this.renderSplines();
                }
            });
        }
        this.chunkManager.regenerateFromSplines();
        this.renderSplines();
    }
  }

  _raycastSplinePoints() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.splinePointsGroup.children);
    return hits.length > 0 ? hits[0] : null;
  }

  _selectClosestSpline(x, z) {
    let closest = null;
    let minDist = 10; // Threshold
    for (const spline of this.terrainSplineManager.getSplines()) {
        const curveData = this.terrainSplineManager.curves.get(spline.id);
        if (!curveData) continue;
        const dist = this.terrainSplineManager._distanceToPolyline(x, z, curveData.samples);
        if (dist < minDist) {
            minDist = dist;
            closest = spline;
        }
    }
    return closest;
  }

  renderSplines() {
    this.splinePointsGroup.clear();
    this.splineLinesGroup.clear();

    if (this.editorMode !== "terrain") return;

    const splines = this.terrainSplineManager ? this.terrainSplineManager.getSplines() : [];
    
    // Render existing splines
    for (const spline of splines) {
        const isSelected = spline.id === this.selectedSplineId;
        const color = isSelected ? 0xffcc00 : 0xaa55ff;

        // Line
        const curveData = this.terrainSplineManager.curves.get(spline.id);
        if (curveData) {
            const pts = curveData.samples.map(p => new THREE.Vector3(p.x, this.chunkManager.getHeight(p.x, p.z) + 0.5, p.z));
            const geo = new THREE.BufferGeometry().setFromPoints(pts);
            const mat = new THREE.LineBasicMaterial({ color, linewidth: 3 });
            this.splineLinesGroup.add(new THREE.Line(geo, mat));
        }

        // Points
        if (isSelected) {
            spline.points.forEach((p, idx) => {
                const y = this.chunkManager.getHeight(p[0], p[1]) + 0.5;
                const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
                mesh.position.set(p[0], y, p[1]);
                mesh.userData = { splineId: spline.id, pointIndex: idx };
                this.splinePointsGroup.add(mesh);
            });
        }
    }

    // Render temp drawing spline
    if (this.isDrawingSpline && this.tempSplinePoints.length > 0) {
        this.tempSplinePoints.forEach(p => {
            const y = this.chunkManager.getHeight(p[0], p[1]) + 0.5;
            const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 8), new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
            mesh.position.set(p[0], y, p[1]);
            this.splinePointsGroup.add(mesh);
        });

        if (this.tempSplinePoints.length >= 2) {
            const vecs = this.tempSplinePoints.map(p => new THREE.Vector3(p[0], 0, p[1]));
            const curve = new THREE.CatmullRomCurve3(vecs);
            const samples = curve.getSpacedPoints(this.tempSplinePoints.length * 10);
            const pts = samples.map(p => new THREE.Vector3(p.x, this.chunkManager.getHeight(p.x, p.z) + 0.5, p.z));
            const geo = new THREE.BufferGeometry().setFromPoints(pts);
            const mat = new THREE.LineBasicMaterial({ color: 0x00ff00 });
            this.splineLinesGroup.add(new THREE.Line(geo, mat));
        }
    }
  }
}
