import * as THREE from "three";
import GUI from "lil-gui";
import { GRASS_VARIATIONS } from "../environment/GrassManager.js";
import { SelectionManager } from "./SelectionManager.js";

// ─────────────────────────────────────────────────────────────────────────────
//  EditorController  –  Object editor with UNDO (Ctrl+Z)
//
//  Undo stack records a closure for every reversible action.
//  Ctrl+Z pops and calls the last closure.
// ─────────────────────────────────────────────────────────────────────────────

const UNDO_MAX = 60;

export class EditorController {
  constructor(scene, camera, raycaster, chunkManager, placedObjectManager, terrainSplineManager, gui) {
    this.scene = scene;
    this.camera = camera;
    this.raycaster = raycaster;
    this.chunkManager = chunkManager;
    this.chunkSize = chunkManager.chunkSize;
    this.placedObjectManager = placedObjectManager;
    this.terrainSplineManager = terrainSplineManager;
    this.gui = gui;
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
    this.isSelectingGrass = false;
    this.grassSelectionPoints = [];
    this.grassPreviewMesh = null;
    this.currentStroke = []; // For undoing a whole brush selection
    this.brushParams = {
      radius: 5,
      density: 15,
      falloff: 1.0
    };

    // ── Terrain mode state ──────────────────────────────────────────────────
    this.isDrawingSpline = false;
    this.tempSplinePoints = [];
    this.selectedSplineId = null;

    this.selectionManager = new SelectionManager(scene, camera, raycaster, gui, chunkManager, terrainSplineManager, this);

    this.splinePointsGroup = new THREE.Group();
    this.scene.add(this.splinePointsGroup);
    this.splineLinesGroup = new THREE.Group();
    this.scene.add(this.splineLinesGroup);

    this.terrainSplineType = "ridge";
    this.terrainSplineWidth = 2.0;
    this.terrainSplineStrength = 5;

    // ── Undo stack ───────────────────────────────────────────────────────────
    /** @type {Array<() => void>} */
    this._undoStack = [];

    this.initPreview();
    this.bindEvents();
    this._initTerrainButtons();
    this._setupHelpGui();
    this.renderSplines();

    // Debounced update for smooth editing
    this.debouncedFlush = this.debounce(() => {
      this.terrainSplineManager.flushUpdates();
      this.chunkManager.isEditing = false; // Reset editing state to trigger high-res
      this.chunkManager.update(this.camera.position); // Force refresh
    }, 150);
  }

  debounce(fn, delay) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), delay);
    };
  }
  _createGrassPreview() {
    if (this.grassPreviewMesh) this.scene.remove(this.grassPreviewMesh);

    // Use a Sphere for 3D look like other points
    const geo = new THREE.SphereGeometry(1, 16, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
      wireframe: true // Add wireframe for that "3D editor" feel
    });

    const mesh = new THREE.Mesh(geo, mat);
    
    // Add a solid core
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.1,
      depthWrite: false
    });
    mesh.add(new THREE.Mesh(geo, coreMat));

    this.grassPreviewMesh = mesh;
    this.scene.add(this.grassPreviewMesh);
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
    this.renderSplines();
  }

  disable() {
    this.active = false;
    this.clearPreview();
    if (this.selectionBox) this.selectionBox.visible = false;
    this.selectedObject = null;
    this.closeGrassGui();
    this.renderSplines();
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
    if (this.grassPreviewMesh) this.grassPreviewMesh.visible = false;
  }

  setSelection(category, modelIndex = 0) {
    this.selection = { category, modelIndex };
    const colors = {
      grass: 0x44ff44, foliage: 0x00cc88, bushes: 0x228833,
      palms: 0xffcc00, jungleTrees: 0x00aa44, deadTrees: 0x996633, rocks: 0x888888,
      grass_static: 0x44ff44, grass_animated: 0x44ff44
    };
    if (this.previewMesh) this.previewMesh.material.color.set(colors[category] ?? 0x00ff88);

    // Auto-open brush folder if grass
    if (category === "grass_static" || category === "grass_animated") {
      if (this.brushFolder) this.brushFolder.open();
    } else {
      if (this.brushFolder) this.brushFolder.close();
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EDITOR MODE SWITCHING
  // ══════════════════════════════════════════════════════════════════════════

  setEditorMode(mode) {
    if (mode === this.editorMode) return;
    const oldMode = this.editorMode;
    this.editorMode = mode;

    if (oldMode === "object") {
      this.clearPreview();
      this.selectedObject = null;
      if (this.selectionBox) this.selectionBox.visible = false;
      if (this.grassPreviewMesh) this.grassPreviewMesh.visible = false;
      this.closeGrassGui();
    } else if (oldMode === "terrain") {
      this.isDrawingSpline = false;
      this.tempSplinePoints = [];
      this.selectedSplineId = null;
    }

    this._broadcastModeChange();
    this.renderSplines();
  }

  _initTerrainButtons() {
    const types = {
      "btn-ridge": "ridge",
      "btn-valley": "valley",
      "btn-plateau": "plateau",
      "btn-road": "road"
    };

    for (const [id, type] of Object.entries(types)) {
      const btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener("click", () => {
          this.terrainSplineType = type;

          // If a spline is selected, update it immediately
          if (this.selectedSplineId) {
            const spline = this.terrainSplineManager.getSplines().find(s => s.id === this.selectedSplineId);
            if (spline) {
              const oldType = spline.type;
              spline.type = type;
              this.terrainSplineManager.updateSpline(spline.id, spline);
              this.terrainSplineManager.flushUpdates();

              this._pushUndo(() => {
                spline.type = oldType;
                this.terrainSplineManager.updateSpline(spline.id, spline);
                this.terrainSplineManager.flushUpdates();
                this._updateTerrainUI();
                this.renderSplines();
              });
            }
          }
          this._updateTerrainUI();
          this.renderSplines();
        });
      }
    }

    // Hook up Width/Strength kbd clicks
    const widthCtrls = document.querySelectorAll("#terrain-mode-panel .param-row:nth-child(1) kbd");
    if (widthCtrls.length === 2) {
      widthCtrls[0].style.cursor = "pointer";
      widthCtrls[0].addEventListener("click", () => {
        const spline = this.selectedSplineId ? this.terrainSplineManager.getSplines().find(s => s.id === this.selectedSplineId) : null;
        if (spline) spline.width = Math.max(1, spline.width - 1);
        else this.terrainSplineWidth = Math.max(1, this.terrainSplineWidth - 1);
        this.terrainSplineManager.flushUpdates();
        this._updateTerrainUI();
        this.renderSplines();
      });
      widthCtrls[1].style.cursor = "pointer";
      widthCtrls[1].addEventListener("click", () => {
        const spline = this.selectedSplineId ? this.terrainSplineManager.getSplines().find(s => s.id === this.selectedSplineId) : null;
        if (spline) spline.width = Math.min(100, spline.width + 1);
        else this.terrainSplineWidth = Math.min(100, this.terrainSplineWidth + 1);
        this.terrainSplineManager.flushUpdates();
        this._updateTerrainUI();
        this.renderSplines();
      });
    }

    const strengthCtrls = document.querySelectorAll("#terrain-mode-panel .param-row:nth-child(2) kbd");
    if (strengthCtrls.length === 2) {
      strengthCtrls[0].style.cursor = "pointer";
      strengthCtrls[0].addEventListener("click", () => {
        const spline = this.selectedSplineId ? this.terrainSplineManager.getSplines().find(s => s.id === this.selectedSplineId) : null;
        if (spline) spline.strength = Math.max(0, spline.strength - 0.5);
        else this.terrainSplineStrength = Math.max(0, this.terrainSplineStrength - 0.5);
        this.terrainSplineManager.flushUpdates();
        this._updateTerrainUI();
        this.renderSplines();
      });
      strengthCtrls[1].style.cursor = "pointer";
      strengthCtrls[1].addEventListener("click", () => {
        const spline = this.selectedSplineId ? this.terrainSplineManager.getSplines().find(s => s.id === this.selectedSplineId) : null;
        if (spline) spline.strength = Math.min(100, spline.strength + 0.5);
        else this.terrainSplineStrength = Math.min(100, this.terrainSplineStrength + 0.5);
        this.terrainSplineManager.flushUpdates();
        this._updateTerrainUI();
        this.renderSplines();
      });
    }

    // Hook up Export Terrain
    const exportTerrainBtn = document.getElementById("export-terrain");
    if (exportTerrainBtn) {
      exportTerrainBtn.addEventListener("click", () => {
        const data = this.terrainSplineManager.exportJSON();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "terrain_splines.json";
        a.click();
        URL.revokeObjectURL(url);
      });
    }
  }

  _updateTerrainUI() {
    // Update spline type buttons active class
    const typeIds = ["btn-ridge", "btn-valley", "btn-plateau", "btn-road"];
    const currentType = this.selectedSplineId
      ? (this.terrainSplineManager.getSplines().find(s => s.id === this.selectedSplineId)?.type || this.terrainSplineType)
      : this.terrainSplineType;

    typeIds.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        const btnType = id.replace("btn-", "");
        btn.classList.toggle("active", btnType === currentType);
      }
    });

    // Update Width/Strength labels
    const currentWidth = this.selectedSplineId
      ? (this.terrainSplineManager.getSplines().find(s => s.id === this.selectedSplineId)?.width || this.terrainSplineWidth)
      : this.terrainSplineWidth;

    const currentStrength = this.selectedSplineId
      ? (this.terrainSplineManager.getSplines().find(s => s.id === this.selectedSplineId)?.strength || this.terrainSplineStrength)
      : this.terrainSplineStrength;

    const widthVal = document.getElementById("terrain-width-val");
    if (widthVal) widthVal.textContent = currentWidth.toFixed(1);

    const strengthVal = document.getElementById("terrain-strength-val");
    if (strengthVal) strengthVal.textContent = currentStrength.toFixed(1);

    // Update status
    const status = document.getElementById("terrain-status");
    if (status) {
      if (this.isDrawingSpline) {
        status.textContent = `Drawing Spline: ${this.tempSplinePoints.length} points. Enter to finish, Esc cancel.`;
      } else if (this.selectedSplineId) {
        status.textContent = `Selected Spline: ${currentType.toUpperCase()}. Use R,V,F,O or Buttons to change type.`;
      } else {
        status.textContent = "Click spline / C to draw / 1-2 switch mode";
      }
    }
  }

  _setupHelpGui() {
    if (!this.gui) return;
    const folder = this.gui.addFolder("⌨️ Editor Controls").close();

    const brushFolder = this.gui.addFolder("🌿 Grass Brush").close();
    brushFolder.add(this.brushParams, "radius", 1, 50).name("Radius");
    brushFolder.add(this.brushParams, "density", 1, 100, 1).name("Density");
    brushFolder.add(this.brushParams, "falloff", 0.1, 5).name("Falloff");
    this.brushFolder = brushFolder; // Store ref to open/close

    const controls = {
      "Switch Mode": "1 (Terrain) | 2 (Object)",
      "Navigation": "WASD + Mouse (Right Click Drag)",
      "Toggle Editor": "P key",
      "--- Object Mode ---": "",
      "Place/Delete": "L-Click | Shift+L-Click",
      "Copy/Paste": "Ctrl+C | Ctrl+V",
      "Rotate Selected": "R key",
      "Scale Selected": "T (+) | G (-)",
      "--- Terrain Mode ---": "",
      "Draw Spline": "C (Start) | L-Click (Points) | Enter (Finish)",
      "Spline Types": "R (Ridge) | V (Valley) | F (Plateau) | O (Road)",
      "Spline Params": "[ ] (Width) | - = (Strength)"
    };

    for (const [name, value] of Object.entries(controls)) {
      if (value === "") {
        folder.add({ label: name }, "label").name(name).disable();
      } else {
        folder.add({ val: value }, "val").name(name).disable();
      }
    }
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

      let hit = null;
      if (this.editorMode === "terrain") {
        hit = this._raycastTerrain();
      }

      if (this.editorMode === "object") {
        if (!this.selectedObject) {
          const terrainHit = this._raycastTerrain();
          if (terrainHit) {
            this.previewMesh.position.copy(terrainHit);
            this.previewMesh.visible = !this.isSelectingGrass; // Hide sphere during grass selection

            // --- GRASS PREVIEW CIRCLE ---
            const isGrass = this.selection.category === "grass_static" || this.selection.category === "grass_animated";
            
            if (isGrass) {
              if (!this.grassPreviewMesh) this._createGrassPreview();
              
              const radius = this.brushParams.radius;
              this.grassPreviewMesh.position.copy(terrainHit);
              // Shift up so it sits "on" the ground rather than being half-buried
              this.grassPreviewMesh.position.y += radius * 0.1; 
              this.grassPreviewMesh.scale.setScalar(radius);

              // 3D Spheres look best when upright
              this.grassPreviewMesh.rotation.set(0, 0, 0); 
              
              this.grassPreviewMesh.visible = true;
              this.previewMesh.visible = false; // Hide sphere when grass brush is active

              if (this.isSelectingGrass) {
                this.grassSelectionPoints.push(terrainHit.clone());
              }
            } else {
              if (this.grassPreviewMesh) this.grassPreviewMesh.visible = false;
              this.previewMesh.visible = true;
            }
          } else {
            this.previewMesh.visible = false;
            if (this.grassPreviewMesh) this.grassPreviewMesh.visible = false;
          }
        } else {
          this.previewMesh.visible = false;
          if (this.grassPreviewMesh) this.grassPreviewMesh.visible = false;
        }
      } else if (this.editorMode === "terrain") {
        this._onTerrainMouseMove(e, hit);
      }
    });

    // ── MOUSE UP ────────────────────────────────────────────────────────────
    window.addEventListener("mouseup", () => {
      this.isSelectingGrass = false;
    });

    // ── WHEEL ───────────────────────────────────────────────────────────────
    window.addEventListener("wheel", (e) => {
      if (!this.active) return;

      if (this.editorMode === "object") {
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
      } else if (this.editorMode === "terrain" && this.isDrawingSpline && this.tempSplinePoints.length > 0) {
        // Control radius of the last green dot with the scroll wheel.
        // Adaptive step: 10% of current radius for smooth control at any scale.
        // NO Math.max() clamp — allows sub-foot precision (radius can go to 0.01).
        const lastIdx = this.tempSplinePoints.length - 1;
        const lastPoint = this.tempSplinePoints[lastIdx];
        const currentRadius = lastPoint[2].radius || 1.0;
        const scrollStep = Math.max(0.01, currentRadius * 0.1) * (e.deltaY > 0 ? -1 : 1);
        lastPoint[2].radius = Math.max(0.01, currentRadius + scrollStep);

        this.renderSplines();
        e.preventDefault();
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
        // --- GRASS SELECTION CONTROLS ---
        if (e.code === "Enter" && this.grassSelectionPoints.length > 0) {
          this._applyGrassSelection();
          return;
        }
        if (e.code === "Escape") {
          this._cancelGrassSelection();
          return;
        }
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

    const terrainHit = this._raycastTerrain();
    if (terrainHit) {
      this.previewMesh.position.copy(terrainHit);
      this.previewMesh.visible = true;
    } else {
      this.previewMesh.visible = false;
    }

    if (this.selectedObject) {
      this.selectedObject = null;
      this.selectionBox.visible = false;
      this.closeGrassGui();
      return;
    }

    if (!this.previewMesh.visible) return;

    const pos = this.previewMesh.position.clone();
    const rot = this.rotation.clone();
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
        this.isSelectingGrass = true;
        this.grassSelectionPoints = [];

        this._createGrassPreview();
      } else {
        const obj = this.placedObjectManager.addObject(
          this.selection.category, this.selection.modelIndex, pos, rot, scale
        );
        if (obj) this._pushUndo(() => this.placedObjectManager.removeObjectExact(obj));
      }
    }
  }

  _captureNearbyObjects(pos, radius) {
    const cs = this.chunkManager.chunkSize;
    const cx = Math.floor(pos.x / cs);
    const cz = Math.floor(pos.z / cs);
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
        const pos = this.previewMesh.position.clone();
        const rot = new THREE.Euler(...this.copiedData.rotation);
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
    this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
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

  getTerrainNormal(x, z) {
    const eps = 0.5;
    const hL = this.chunkManager.getHeight(x - eps, z);
    const hR = this.chunkManager.getHeight(x + eps, z);
    const hD = this.chunkManager.getHeight(x, z - eps);
    const hU = this.chunkManager.getHeight(x, z + eps);
    const dx = hR - hL;
    const dz = hU - hD;
    return new THREE.Vector3(-dx, 2.0, -dz).normalize();
  }

  paintGrass(center) {
    const samples = 20; // blades per tick
    const variation = this.getVariationName();
    const vParams = GRASS_VARIATIONS[variation] || {};

    for (let i = 0; i < samples; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * this.brushParams.radius;

      const offsetX = Math.cos(angle) * r;
      const offsetZ = Math.sin(angle) * r;
      const x = center.x + offsetX;
      const z = center.z + offsetZ;

      // Density check with radial falloff
      const distRatio = r / this.brushParams.radius;
      const falloff = Math.pow(1.0 - distRatio, this.brushParams.falloff);
      if (Math.random() > this.brushParams.density * falloff) continue;

      const y = this.chunkManager.getHeight(x, z);
      const pos = new THREE.Vector3(x, y, z);
      const normal = this.getTerrainNormal(x, z);

      // Rotation align to slope + random spin
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      const rot = new THREE.Euler().setFromQuaternion(quat);
      rot.y += Math.random() * Math.PI * 2;
      rot.x += (Math.random() - 0.5) * 0.2; // slight extra randomness
      rot.z += (Math.random() - 0.5) * 0.2;

      const scale = new THREE.Vector3(1, 1, 1);
      const obj = this.placedObjectManager.addGrass(variation, pos, rot, scale, vParams);
      if (obj) this.currentStroke.push(obj);
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
    this.grassGui.domElement.style.top = "10px";
    this.grassGui.domElement.style.right = "340px";

    const params = data.params;
    const updateRef = () => {
      const key = `${data.chunk[0]},${data.chunk[1]}`;
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

    this.grassGui.add(params, "height", 0.1, 5, 0.1).onFinishChange(updateRef);
    this.grassGui.add(params, "width", 0.01, 0.2, 0.005).onFinishChange(updateRef);
    this.grassGui.add(params, "density", 100, 10000, 100).onFinishChange(updateRef);
    this.grassGui.add(params, "radius", 1, 30, 1).onFinishChange(updateRef);
    this.grassGui.add(params, "windStrength", 0, 2, 0.01).onChange(v => {
      if (mesh.material.uniforms?.uWindStrength) mesh.material.uniforms.uWindStrength.value = v;
    });
    this.grassGui.add(params, "windSpeed", 0, 10, 0.1).onChange(v => {
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
      // Add point with current default settings
      this.tempSplinePoints.push([
        hit.x,
        hit.z,
        {
          radius: this.terrainSplineWidth,
          strength: this.terrainSplineStrength,
          falloff: 2.0,
          visualSize: 2.0
        }
      ]);
      this.renderSplines();
      return;
    }

    // Check if selecting a spline (polyline click)
    const selected = this._selectClosestSpline(hit.x, hit.z);
    if (selected) {
      this.selectedSplineId = selected.id;
    } else {
      this.selectedSplineId = null;
    }
    this.renderSplines();
  }

  _onTerrainMouseMove(e, hit) {
    // No-op for now
  }

  _onTerrainKeyDown(e) {

    if (e.code === "KeyC") {
      this.terrainSubMode = "spline";
      this.isDrawingSpline = true;
      this.tempSplinePoints = [];
      this.renderSplines();
      return;
    }

    if (e.code === "Enter" && this.isDrawingSpline) {
      this.isDrawingSpline = false;
      if (this.tempSplinePoints.length >= 2) {
        const added = this.terrainSplineManager.addSpline({
          type: this.terrainSplineType,
          points: [...this.tempSplinePoints],
          width: this.terrainSplineWidth,
          strength: this.terrainSplineStrength,
          falloff: 2
        });
        this.selectedSplineId = added.id;
        this.terrainSplineManager.flushUpdates();

        // Undo
        this._pushUndo(() => {
          this.terrainSplineManager.removeSpline(added.id);
          this.terrainSplineManager.flushUpdates();
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

    if (e.code === "KeyR") { this.terrainSplineType = "ridge"; if (spline) spline.type = "ridge"; changed = true; }
    if (e.code === "KeyV") { this.terrainSplineType = "valley"; if (spline) spline.type = "valley"; changed = true; }
    if (e.code === "KeyF") { this.terrainSplineType = "plateau"; if (spline) spline.type = "plateau"; changed = true; }
    if (e.code === "KeyO") { this.terrainSplineType = "road"; if (spline) spline.type = "road"; changed = true; }

    // Width [ ]
    if (e.code === "BracketLeft") {
      if (spline) spline.width = Math.max(1, spline.width - 1);
      else this.terrainSplineWidth = Math.max(1, this.terrainSplineWidth - 1);
      changed = true;
    }
    if (e.code === "BracketRight") {
      if (spline) spline.width = Math.min(100, spline.width + 1);
      else this.terrainSplineWidth = Math.min(100, this.terrainSplineWidth + 1);
      changed = true;
    }

    // Strength - +
    if (e.code === "Minus") {
      if (spline) spline.strength = Math.max(0, spline.strength - 0.5);
      else this.terrainSplineStrength = Math.max(0, this.terrainSplineStrength - 0.5);
      changed = true;
    }
    if (e.code === "Equal") { // Plus is shift+equal, usually we check Equal
      if (spline) spline.strength = Math.min(100, spline.strength + 0.5);
      else this.terrainSplineStrength = Math.min(100, this.terrainSplineStrength + 0.5);
      changed = true;
    }

    if (e.code === "Delete" || e.code === "Backspace") {
      this.terrainSplineManager.removeSpline(this.selectedSplineId);

      this._pushUndo(() => {
        this.terrainSplineManager.addSpline(oldState);
        this.terrainSplineManager.flushUpdates();
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
            this.terrainSplineManager.flushUpdates();
            this.renderSplines();
          }
        });
      }
      this.terrainSplineManager.flushUpdates();
      this._updateTerrainUI();
      this.renderSplines();
    }
  }

  _selectClosestSpline(x, z) {
    let closest = null;
    let minDist = 10; // Threshold
    for (const spline of this.terrainSplineManager.getSplines()) {
      const curveData = this.terrainSplineManager.curves.get(spline.id);
      if (!curveData) continue;

      const dist = this.terrainSplineManager._getMinDistanceToCurve(x, z, spline.id);
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

    if (!this.active || this.editorMode !== "terrain") return;

    this._updateTerrainUI();

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
          const pData = p[2] || {};
          // Visual size is fully decoupled from radius. Default 2.0 world units.
          const vSize = Math.max(0.1, Math.min(pData.visualSize !== undefined ? pData.visualSize : 2.0, 20.0));

          const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
          mesh.position.set(p[0], y, p[1]);
          mesh.scale.setScalar(vSize);

          mesh.userData = {
            isSplinePoint: true,
            splineId: spline.id,
            pointIndex: idx,
            pData: pData
          };

          // Apply selection visuals (Yellow, Scale)
          this.selectionManager.applyVisuals(mesh);

          this.splinePointsGroup.add(mesh);
        });
      }
    }

    // Render temp drawing spline
    if (this.isDrawingSpline && this.tempSplinePoints.length > 0) {
      this.tempSplinePoints.forEach(p => {
        const y = this.chunkManager.getHeight(p[0], p[1]) + 0.5;
        // 1:1 visual scale — dot size exactly matches influence radius in world space — DISABLED
        // Now using decoupled visualSize (defaulting to 0.5 for clean drawing)
        const pData = p[2] || {};
        const vSize = Math.max(0.1, Math.min(pData.visualSize !== undefined ? pData.visualSize : 2.0, 20.0));

        const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 8), new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
        mesh.position.set(p[0], y, p[1]);
        mesh.scale.setScalar(vSize);

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

  _applyGrassSelection() {
    if (this.grassSelectionPoints.length === 0) return;

    const variation = this.getVariationName();
    const vParams = GRASS_VARIATIONS[variation] || {};
    
    // Merge brush parameters
    const strokeParams = {
      ...vParams,
      radius: this.brushParams.radius,
      density: this.brushParams.density,
      falloff: this.brushParams.falloff
    };

    // NEW: Batch process the entire selection as one stroke
    const grassObjs = this.placedObjectManager.addGrassSelection(
      variation, 
      this.grassSelectionPoints, 
      strokeParams
    );

    if (grassObjs.length > 0) {
      this._pushUndo(() => {
        grassObjs.forEach(obj => this.placedObjectManager.removeObjectExact(obj));
      });
      console.log(`🌿 Applied grass stroke: ${grassObjs.length} chunks affected.`);
    }

    this._cancelGrassSelection();
  }

  _cancelGrassSelection() {
    this.isSelectingGrass = false;
    this.grassSelectionPoints = [];
    if (this.grassPreviewMesh) {
      this.grassPreviewMesh.visible = false;
    }
    console.log("🌿 Grass selection cleared.");
  }
}
