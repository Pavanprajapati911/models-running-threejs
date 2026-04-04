// src/editor/PlacedObjectManager.js
export class PlacedObjectManager {
  /**
   * @param {THREE.Scene} scene
   * @param {object} chunkManager
   */
  constructor(scene, chunkManager) {
    this.scene = scene;
    this.chunkManager = chunkManager;
    this.placedObjects = new Map(); // key: "x,z", value: array of objects
    this.placedGrass = new Map();   // key: "x,z", value: array of grass objects
    this.splatMaps = new Map();     // key: "x,z", value: base64 string
  }

  addObject(type, modelIndex, pos, rot, scale) {
    const chunkSize = this.chunkManager.chunkSize;
    const chunkX = Math.floor(pos.x / chunkSize);
    const chunkZ = Math.floor(pos.z / chunkSize);
    const key = `${chunkX},${chunkZ}`;

    if (!this.placedObjects.has(key)) {
      this.placedObjects.set(key, []);
    }

    const obj = {
      type,
      modelIndex: modelIndex ?? 0,
      chunk: [chunkX, chunkZ],
      position: [pos.x, pos.y, pos.z],
      rotation: [rot.x, rot.y, rot.z],
      scale: [scale.x, scale.y, scale.z]
    };

    this.placedObjects.get(key).push(obj);

    const chunk = this.chunkManager.chunks.get(key);
    if (chunk && chunk.spawnPlacedObject) {
      chunk.spawnPlacedObject(obj);
    }

    return obj;
  }

  addGrass(variation, pos, rot, scale, params) {
    const chunkSize = this.chunkManager.chunkSize;
    const chunkX = Math.floor(pos.x / chunkSize);
    const chunkZ = Math.floor(pos.z / chunkSize);
    const key = `${chunkX},${chunkZ}`;

    if (!this.placedGrass.has(key)) {
      this.placedGrass.set(key, []);
    }

    // Default params from variation or direct
    const grassObj = {
      type: "grass_animated",
      variation: variation,
      chunk: [chunkX, chunkZ],
      position: [pos.x, pos.y, pos.z],
      rotation: [rot.x, rot.y, rot.z],
      scale: [scale.x, scale.y, scale.z],
      params: { ...params }
    };

    this.placedGrass.get(key).push(grassObj);

    const chunk = this.chunkManager.chunks.get(key);
    if (chunk && chunk.spawnGrassPatch) {
      chunk.spawnGrassPatch(grassObj);
    }

    return grassObj;
  }

  addGrassSelection(variation, points, params) {
    const chunkSize = this.chunkManager.chunkSize;
    const chunkBuckets = new Map(); // key: "x,z", value: array of points

    // Group points by chunk
    points.forEach(p => {
      const cx = Math.floor(p.x / chunkSize);
      const cz = Math.floor(p.z / chunkSize);
      const key = `${cx},${cz}`;
      if (!chunkBuckets.has(key)) chunkBuckets.set(key, []);
      chunkBuckets.get(key).push(p);
    });

    const results = [];

    // Create selection-based grass patch for each chunk touched
    chunkBuckets.forEach((bucketPoints, key) => {
      if (!this.placedGrass.has(key)) this.placedGrass.set(key, []);

      const [cx, cz] = key.split(',').map(Number);
      
      const grassObj = {
        type: "grass_selection",
        variation: variation,
        chunk: [cx, cz],
        // position: used for basic sorting/culling, we'll use the average
        position: [bucketPoints[0].x, bucketPoints[0].y, bucketPoints[0].z],
        points: bucketPoints, // THE KEY CHANGE: array of points instead of single pos
        params: { ...params }
      };

      this.placedGrass.get(key).push(grassObj);
      results.push(grassObj);

      const chunk = this.chunkManager.chunks.get(key);
      if (chunk && chunk.spawnGrassPatch) {
        chunk.spawnGrassPatch(grassObj);
      }
    });

    return results;
  }

  removeObject(pos, radius = 2) {
    const chunkSize = this.chunkManager.chunkSize;
    const chunkX = Math.floor(pos.x / chunkSize);
    const chunkZ = Math.floor(pos.z / chunkSize);
    const key = `${chunkX},${chunkZ}`;

    let removed = false;

    // Remove from placedObjects
    if (this.placedObjects.has(key)) {
      const objects = this.placedObjects.get(key);
      for (let i = objects.length - 1; i >= 0; i--) {
        const o = objects[i];
        const dist = Math.sqrt(Math.pow(o.position[0] - pos.x, 2) + Math.pow(o.position[1] - pos.y, 2) + Math.pow(o.position[2] - pos.z, 2));
        if (dist < radius) {
          objects.splice(i, 1);
          removed = true;
          const chunk = this.chunkManager.chunks.get(key);
          if (chunk && chunk.removePlacedObject) chunk.removePlacedObject(o);
        }
      }
    }

    // Remove from placedGrass
    if (this.placedGrass.has(key)) {
      const grass = this.placedGrass.get(key);
      for (let i = grass.length - 1; i >= 0; i--) {
        const g = grass[i];
        const dist = Math.sqrt(Math.pow(g.position[0] - pos.x, 2) + Math.pow(g.position[1] - pos.y, 2) + Math.pow(g.position[2] - pos.z, 2));
        if (dist < radius) {
          grass.splice(i, 1);
          removed = true;
          const chunk = this.chunkManager.chunks.get(key);
          if (chunk && chunk.removeGrassPatch) chunk.removeGrassPatch(g);
        }
      }
    }

    return removed;
  }

  getObjectsForChunk(x, z) {
    return this.placedObjects.get(`${x},${z}`) || [];
  }

  getGrassForChunk(x, z) {
    return this.placedGrass.get(`${x},${z}`) || [];
  }

  getAllRenderedMeshes() {
    const meshes = [];
    if (!this.chunkManager || !this.chunkManager.chunks) return meshes;
    for (const chunk of this.chunkManager.chunks.values()) {
      if (chunk.placedObjects) {
        chunk.placedObjects.forEach(po => meshes.push(po.mesh));
      }
      if (chunk.placedGrass) {
        chunk.placedGrass.forEach(pg => meshes.push(pg.mesh));
      }
    }
    return meshes;
  }
  exportJSON() {
    const allObjects = [];
    for (const objs of this.placedObjects.values()) {
      allObjects.push(...objs);
    }

    const allGrass = [];
    for (const grassTable of this.placedGrass.values()) {
      allGrass.push(...grassTable);
    }

    // Save splat maps from active chunks that were modified
    for (const chunk of this.chunkManager.chunks.values()) {
        if (chunk.isSplatModified) {
            const key = `${Math.floor(chunk.x / this.chunkManager.chunkSize)},${Math.floor(chunk.z / this.chunkManager.chunkSize)}`;
            this.splatMaps.set(key, this._uint8ToBase64(chunk.splatData));
        }
    }

    const splatExport = {};
    this.splatMaps.forEach((val, key) => splatExport[key] = val);

    const data = {
      objects: allObjects,
      grass: allGrass,
      splats: splatExport,
      // Pass splines directly (TerrainSplineManager.exportJSON now handles the wrapping)
      terrain: this.terrainSplineManager ? this.terrainSplineManager.exportJSON() : null
    };

    console.log(`🌿 Exporting ${allObjects.length} objects`);
    console.log(`🌾 Exporting ${allGrass.length} grass patches`);
    if (data.terrain) {
        console.log(`🛣️ Exporting ${data.terrain.splines.length} splines and manual sculpting data`);
    }

    this._download(data, "map_full.json");

    console.log("💾 Map & Grass Exported (single file)");
  }

  _download(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.style.display = "none";
    document.body.appendChild(a);
    a.href = url;
    a.download = filename;
    a.click();

    // Slight cleanup delay
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  async loadJSON(url) {
    try {
      const response = await fetch(url);
      const data = await response.json();

      this.placedObjects.clear();
      this.placedGrass.clear();

      // Load static objects
      if (data.objects) {
        data.objects.forEach(o => {
          if (o.position) {
            o.chunk[0] = Math.floor(o.position[0] / this.chunkManager.chunkSize);
            o.chunk[1] = Math.floor(o.position[2] / this.chunkManager.chunkSize);
          }
          const key = `${o.chunk[0]},${o.chunk[1]}`;
          if (!this.placedObjects.has(key)) this.placedObjects.set(key, []);
          this.placedObjects.get(key).push(o);
        });
      }

      // Load grass patches
      if (data.grass) {
        data.grass.forEach(g => {
          if (g.position) {
            g.chunk[0] = Math.floor(g.position[0] / this.chunkManager.chunkSize);
            g.chunk[1] = Math.floor(g.position[2] / this.chunkManager.chunkSize);
          }
          const key = `${g.chunk[0]},${g.chunk[1]}`;
          if (!this.placedGrass.has(key)) this.placedGrass.set(key, []);
          this.placedGrass.get(key).push(g);
        });
      }

      // Load terrain (splines + sculpting)
      const terrainData = data.terrain || data.splines; // support both legacy and new naming
      if (terrainData && this.terrainSplineManager) {
        this.terrainSplineManager.loadJSON(terrainData);
      }

      // Load splat maps
      this.splatMaps.clear();
      if (data.splats) {
          for (const key in data.splats) {
              this.splatMaps.set(key, data.splats[key]);
          }
      }

      console.log(`📥 Loaded: ${data.objects?.length || 0} objects, ${data.grass?.length || 0} grass patches, ${data.splines?.length || 0} splines`);

      // Refresh chunks
      this.chunkManager.refreshChunks();
    } catch (e) {
      console.warn("Failed to load combined map file:", e.message);
    }
  }

  removeObjectExact(objData) {
    const key = `${objData.chunk[0]},${objData.chunk[1]}`;

    // check objects
    if (this.placedObjects.has(key)) {
      const list = this.placedObjects.get(key);
      const idx = list.indexOf(objData);
      if (idx !== -1) {
        list.splice(idx, 1);
        const chunk = this.chunkManager.chunks.get(key);
        if (chunk) chunk.removePlacedObject(objData);
        return true;
      }
    }

    // check grass
    if (this.placedGrass.has(key)) {
      const list = this.placedGrass.get(key);
      const idx = list.indexOf(objData);
      if (idx !== -1) {
        list.splice(idx, 1);
        const chunk = this.chunkManager.chunks.get(key);
        if (chunk) {
          if (objData.type === "grass_selection" && chunk.removeGrassSelection) {
             chunk.removeGrassSelection(objData);
          } else if (chunk.removeGrassPatch) {
             chunk.removeGrassPatch(objData);
          }
        }
        return true;
      }
    }

    return false;
  }

  _uint8ToBase64(uint8) {
    let binary = "";
    const len = uint8.byteLength;
    for (let i = 0; i < len; i++) binary += String.fromCharCode(uint8[i]);
    return window.btoa(binary);
  }

  base64ToUint8(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
    return bytes;
  }

  getSplatForChunk(x, z) {
    return this.splatMaps.get(`${x},${z}`);
  }
}
