// src/editor/SelectionManager.js
import * as THREE from 'three';

/**
 * SelectionManager – Handles professional selection, dragging, and editing of spline control points.
 * Features: Mouse-based point movement (dragging) + GUI editing via lil-gui.
 */
export class SelectionManager {
  constructor(scene, camera, raycaster, gui, terrain, splineManager, editor) {
    this.scene = scene;
    this.camera = camera;
    this.raycaster = raycaster;
    this.gui = gui;
    this.terrain = terrain; // ChunkManager
    this.splineManager = splineManager;
    this.editor = editor; // To trigger renderSplines()

    this.selectedPointData = null; // { splineId, pointIndex }
    this.pointFolder = null;
    this.mouse = new THREE.Vector2();

    // Dragging state
    this.isDragging = false;
    this.dragPlane = new THREE.Plane();
    this.dragIntersection = new THREE.Vector3();
    this.dragOffset = new THREE.Vector3();

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);

    this.enable();
  }

  enable() {
    window.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('keydown', this._onKeyDown);
  }

  disable() {
    window.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('keydown', this._onKeyDown);
    this.clearSelection();
  }

  /**
   * Selection and Drag-start
   */
  _onPointerDown(e) {
    // Avoid selecting when clicking UI
    if (e.target.closest('.lil-gui, button, input, select, textarea, [data-ui]')) return;
    if (document.pointerLockElement) return;
    if (!this.editor.active || this.editor.editorMode !== "terrain") return;

    this.updateMouse(e);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Check for spline points
    const pointsGroup = this.editor.splinePointsGroup;
    if (!pointsGroup) return;

    const hits = this.raycaster.intersectObjects(pointsGroup.children);
    const pointHit = hits.find(h => h.object.userData.isSplinePoint);

    if (pointHit) {
      this.selectPoint(pointHit.object.userData.splineId, pointHit.object.userData.pointIndex);
      this.isDragging = true;
      this.dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), pointHit.point);
      this.dragOffset.copy(pointHit.object.position).sub(pointHit.point);

      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    } else {
      // 3. We didn't hit a dot. But did we hit a spline line?
      const linesGroup = this.editor.splineLinesGroup;
      const lineHits = this.raycaster.intersectObjects(linesGroup.children, true);

      if (lineHits.length > 0) {
        const hitLine = lineHits[0].object;

        // Traverse up if needed (in case of LineSegments / grouped meshes)
        let obj = hitLine;
        while (obj && !obj.userData?.splineId) {
          obj = obj.parent;
        }

        if (obj && obj.userData.splineId !== undefined) {
          const splineId = obj.userData.splineId;

          // ✅ Set selected spline
          this.editor.selectedSplineId = splineId;

          // ❌ Clear point selection 
          this.selectedPointData = null;

          if (this.pointFolder) { this.pointFolder.destroy(); this.pointFolder = null; }

          // 🔥 Re-render → now dots will appear
          this.editor.renderSplines();
        }

        return;
      } else {
        // We really clicked away. Clear everything.
        this.clearSelection();
      }
    }
  }

  /**
   * Drag Behavior and Hover
   */
  _onPointerMove(e) {
    if (!this.editor.active || this.editor.editorMode !== "terrain") return;

    this.updateMouse(e);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    if (this.isDragging && this.selectedPointData) {
      // Find where mouse intersects the drag plane
      if (this.raycaster.ray.intersectPlane(this.dragPlane, this.dragIntersection)) {
        const newPos = this.dragIntersection.clone().add(this.dragOffset);

        // Find current terrain height for smooth visual snapping
        const h = this.terrain.getHeight(newPos.x, newPos.z);
        newPos.y = h + 0.5;

        this.syncPoint(newPos.x, newPos.z);
      }
    } else {
      // Optional: Hover effects
      this.checkHover();
    }
  }

  _onPointerUp() {
    this.isDragging = false;
    document.body.style.cursor = 'auto';
  }

  _onKeyDown(e) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.selectedPointData) {
        this.deletePoint();
      }
    }
  }

  updateMouse(e) {
    this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  }

  checkHover() {
    const pointsGroup = this.editor.splinePointsGroup;
    if (!pointsGroup) return;

    const hits = this.raycaster.intersectObjects(pointsGroup.children);
    const hit = hits.find(h => h.object.userData.isSplinePoint);

    if (hit) {
      document.body.style.cursor = 'pointer';
    } else {
      document.body.style.cursor = 'auto';
    }
  }

  selectPoint(splineId, pointIndex) {
    if (this.selectedPointData &&
      this.selectedPointData.splineId === splineId &&
      this.selectedPointData.pointIndex === pointIndex) return;

    this.selectedPointData = { splineId, pointIndex };
    this.editor.selectedSplineId = splineId;

    this.editor.renderSplines();
    this.createGuiPanel();
  }

  clearSelection() {
    this.selectedPointData = null;
    this.editor.selectedSplineId = null;

    if (this.pointFolder) { this.pointFolder.destroy(); this.pointFolder = null; }

    this.editor.renderSplines();
  }

  /**
   * Apply selection highlight color ONLY.
   * Scale is handled separately in renderSplines().
   */
  applyVisuals(mesh) {
    const data = mesh.userData;
    if (this.selectedPointData &&
      data.splineId === this.selectedPointData.splineId &&
      data.pointIndex === this.selectedPointData.pointIndex) {
      mesh.material.color.set(0xffff00); // Yellow = selected
      mesh.scale.multiplyScalar(1.25);   // Slight boost on top of visualSize
    }
  }

  syncPoint(x, z, overrides = {}) {
    if (!this.selectedPointData) return;
    const { splineId, pointIndex } = this.selectedPointData;
    const spline = this.splineManager.getSplines().find(s => s.id === splineId);
    if (!spline) return;

    const currentPoint = spline.points[pointIndex];
    let pData = currentPoint[2];

    // Ensure we have an object for the new format
    if (!pData || typeof pData !== 'object') {
      pData = {
        radius: spline.width * (typeof pData === 'number' ? pData : 1),
        strength: spline.strength,
        falloff: 2.0
      };
    }

    // Update with overrides while preventing shared references
    const newPData = {
      ...pData,
      ...overrides
    };

    // Update Data: [x, z, { radius, strength, falloff, ... }]
    spline.points[pointIndex] = [x, z, newPData];
    this.splineManager.updateSpline(splineId, spline);

    // Real-time Terrain Rebuild
    this.splineManager.flushUpdates();

    // Update visualization
    this.editor.renderSplines();

    // Sync GUI panel if open
    if (this.pointFolder) {
      this.updateGuiValues();
    }
  }

  /**
   * Visual-only update — does NOT trigger terrain rebuild.
   * Use this for properties like visualSize that only affect the editor dots.
   */
  syncVisualOnly(overrides = {}) {
    if (!this.selectedPointData) return;
    const { splineId, pointIndex } = this.selectedPointData;
    const spline = this.splineManager.getSplines().find(s => s.id === splineId);
    if (!spline) return;

    const currentPoint = spline.points[pointIndex];
    let pData = currentPoint[2];
    if (!pData || typeof pData !== 'object') {
      pData = { radius: spline.width, strength: spline.strength, falloff: 2.0, visualSize: 2.0 };
    }

    // Merge overrides in-place — no terrain rebuild, no flushUpdates
    spline.points[pointIndex] = [currentPoint[0], currentPoint[1], { ...pData, ...overrides }];

    // Immediately re-render the dots only
    this.editor.renderSplines();
  }

  createGuiPanel() {
    if (this.pointFolder) this.pointFolder.destroy();
    if (!this.selectedPointData) return;

    const { splineId, pointIndex } = this.selectedPointData;
    const spline = this.splineManager.getSplines().find(s => s.id === splineId);
    if (!spline || !spline.points[pointIndex]) return;

    // Create a main parent folder for the entire spline editing session
    this.pointFolder = this.gui.addFolder(`🛣️ Spline Editor`).open();
    this.pointFolder.domElement.style.borderLeft = "4px solid #ffff00";

    const point = spline.points[pointIndex];
    const pData = point[2];

    // --- 📍 CONTROL POINT SECTION ---
    const dotFolder = this.pointFolder.addFolder(`📍 Point: ${pointIndex}`).open();
    this.guiConfig = {
      x: point[0],
      y: (pData && pData.height !== undefined) ? pData.height : 0,
      z: point[1],
      
      // Point Settings - Use explicit undefined checks to allow 0 or other falsy values
      radius: (pData && pData.radius !== undefined) ? pData.radius : spline.width,
      pointStrength: (pData && pData.strength !== undefined) ? pData.strength : spline.strength,
      pointFalloff: (pData && pData.falloff !== undefined) ? pData.falloff : 2.0,
      visualSize: (pData && pData.visualSize !== undefined) ? pData.visualSize : 2.0,

      // Spline wide params
      type: spline.type,
      width: spline.width,
      strength: spline.strength,
      falloff: spline.falloff,
      peakSharpness: spline.peakSharpness,
      plateauHeightOffset: spline.plateauHeightOffset,
      noiseStrength: spline.noiseStrength,
      noiseScale: spline.noiseScale,
      roadWidthFactor: spline.roadWidthFactor,
      edgeSmoothness: spline.edgeSmoothness,
      flattenStrength: spline.flattenStrength
    };

    dotFolder.add(this.guiConfig, 'x', -1000, 1000, 0.1).name('X').onChange(() => this.syncPoint(this.guiConfig.x, this.guiConfig.z)).listen();
    dotFolder.add(this.guiConfig, 'y', -50, 50, 0.1).name('Y (Height)').onChange(() => this.syncPoint(this.guiConfig.x, this.guiConfig.z, { height: this.guiConfig.y })).listen();
    dotFolder.add(this.guiConfig, 'z', -1000, 1000, 0.1).name('Z').onChange(() => this.syncPoint(this.guiConfig.x, this.guiConfig.z)).listen();
    
    // Point Influence sub-folder with precision-grade ranges
    const pSettings = dotFolder.addFolder("Point Influence").open();
    // Radius: 0.1 for micro-detail up to 50 for wide sculpting
    pSettings.add(this.guiConfig, 'radius', 0.1, 50, 0.1).name('Radius').onChange(() =>
      this.syncPoint(this.guiConfig.x, this.guiConfig.z, { radius: this.guiConfig.radius }));
    // Strength: negative = valley, positive = ridge
    pSettings.add(this.guiConfig, 'pointStrength', -20, 20, 0.1).name('Strength').onChange(() =>
      this.syncPoint(this.guiConfig.x, this.guiConfig.z, { strength: this.guiConfig.pointStrength }));
    // Falloff: 0.5 smooth, 10 = very sharp cutoff
    pSettings.add(this.guiConfig, 'pointFalloff', 0.5, 10, 0.1).name('Falloff').onChange(() =>
      this.syncPoint(this.guiConfig.x, this.guiConfig.z, { falloff: this.guiConfig.pointFalloff }));
    // Visual Size: dot size in editor only, range 0.1–20 world units. Does NOT affect terrain.
    pSettings.add(this.guiConfig, 'visualSize', 0.1, 20.0, 0.1).name('Visual Size').onChange(() =>
      this.syncVisualOnly({ visualSize: this.guiConfig.visualSize }));

    // Precision Mode toggle – disables curve influence, pure point sculpting
    const precisionConfig = { precisionMode: this.splineManager.precisionMode };
    this.pointFolder.add(precisionConfig, 'precisionMode').name('🎯 Precision Mode').onChange(v => {
      this.splineManager.precisionMode = v;
      this.splineManager.markDirty(spline.bounds);
      this.splineManager.flushUpdates();
      this.editor.renderSplines();
    });

    this.pointFolder.add({ delete: () => this.deletePoint() }, 'delete').name('🗑️ Remove Point');

    // --- ⚙️ SPLINE SETTINGS SECTION ---
    const settingsFolder = this.pointFolder.addFolder("⚙️ Spline Settings").open();

    const onSplineChange = () => {
      this.splineManager.updateSpline(spline.id, {
        type: this.guiConfig.type,
        width: this.guiConfig.width,
        strength: this.guiConfig.strength,
        falloff: this.guiConfig.falloff,
        peakSharpness: this.guiConfig.peakSharpness,
        plateauHeightOffset: this.guiConfig.plateauHeightOffset,
        noiseStrength: this.guiConfig.noiseStrength,
        noiseScale: this.guiConfig.noiseScale,
        roadWidthFactor: this.guiConfig.roadWidthFactor,
        edgeSmoothness: this.guiConfig.edgeSmoothness,
        flattenStrength: this.guiConfig.flattenStrength
      });
      this.splineManager.flushUpdates();
      this.editor.renderSplines();
    };

    // 1. Type
    settingsFolder.add(this.guiConfig, 'type', ['ridge', 'valley', 'plateau', 'road']).name('Type').onChange((val) => {
      onSplineChange();
      this.refreshDynamicFolders(settingsFolder, onSplineChange);
    });

    this.refreshDynamicFolders(settingsFolder, onSplineChange);
  }

  /**
   * Dynamically rebuild folders based on Spline Type
   */
  refreshDynamicFolders(parent, onChange) {
    // Remove existing sub-folders
    const toRemove = [];
    parent.children.forEach(c => {
      if (c.children !== undefined && c._title !== undefined) toRemove.push(c);
    });
    toRemove.forEach(f => f.destroy());

    // 2. Shape Folder
    const shapeFolder = parent.addFolder("Shape").open();
    shapeFolder.add(this.guiConfig, 'width', 1, 150, 1).name('Width').onChange(onChange);
    shapeFolder.add(this.guiConfig, 'falloff', 0.1, 8, 0.1).name('Falloff').onChange(onChange);

    if (this.guiConfig.type === 'ridge' || this.guiConfig.type === 'valley') {
      shapeFolder.add(this.guiConfig, 'peakSharpness', 0.5, 5.0, 0.1).name('Peak Sharpness').onChange(onChange);
    }

    // 3. Height Folder
    const heightFolder = parent.addFolder("Height").open();
    heightFolder.add(this.guiConfig, 'strength', -50, 50, 0.5).name('Strength').onChange(onChange);

    if (this.guiConfig.type === 'plateau') {
      heightFolder.add(this.guiConfig, 'plateauHeightOffset', -20, 20, 0.1).name('Height Offset').onChange(onChange);
    }

    // 4. Noise Folder
    const noiseFolder = parent.addFolder("Noise").open();
    noiseFolder.add(this.guiConfig, 'noiseStrength', 0, 2, 0.01).name('Noise Strength').onChange(onChange);
    noiseFolder.add(this.guiConfig, 'noiseScale', 0.01, 1, 0.01).name('Noise Scale').onChange(onChange);

    // 5. Road Folder (Conditional)
    if (this.guiConfig.type === 'road') {
      const roadFolder = parent.addFolder("Road Controls").open();
      roadFolder.add(this.guiConfig, 'roadWidthFactor', 0.1, 1.0, 0.05).name('Center Width').onChange(onChange);
      roadFolder.add(this.guiConfig, 'edgeSmoothness', 0.1, 5.0, 0.1).name('Edge Smoothing').onChange(onChange);
      roadFolder.add(this.guiConfig, 'flattenStrength', 0.0, 1.0, 0.05).name('Flatten Power').onChange(onChange);
    }
  }

  updateGuiValues() {
    const { splineId, pointIndex } = this.selectedPointData;
    const spline = this.splineManager.getSplines().find(s => s.id === splineId);
    if (spline && spline.points[pointIndex]) {
      const p = spline.points[pointIndex];
      const pData = p[2];
      
      this.guiConfig.x = p[0];
      this.guiConfig.z = p[1];
      // this.guiConfig.y = this.terrain.getHeight(p[0], p[1]) + 0.5; // Old visual value
      
      // Sync influence parameters too
      if (pData && typeof pData === 'object') {
        if (pData.radius !== undefined) this.guiConfig.radius = pData.radius;
        if (pData.strength !== undefined) this.guiConfig.pointStrength = pData.strength;
        if (pData.falloff !== undefined) this.guiConfig.pointFalloff = pData.falloff;
        if (pData.height !== undefined) this.guiConfig.y = pData.height;
        if (pData.visualSize !== undefined) this.guiConfig.visualSize = pData.visualSize;
      }
    }
  }

  deletePoint() {
    if (this.selectedPointData) {
      this.splineManager.removePoint(this.selectedPointData.splineId, this.selectedPointData.pointIndex);
      this.clearSelection();
    }
  }
}
