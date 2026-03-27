// src/editor/PlacedObjectManager.js
export class PlacedObjectManager {
  constructor(scene, chunkManager) {
    this.scene = scene;
    this.chunkManager = chunkManager;
    this.placedObjects = new Map(); // key: "x,z", value: array of objects
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

    // If chunk is currently loaded, spawn it immediately in the scene
    const chunk = this.chunkManager.chunks.get(key);
    if (chunk && chunk.spawnPlacedObject) {
      chunk.spawnPlacedObject(obj);
    }

    return obj;
  }


  removeObject(pos, radius = 2) {
    const chunkSize = this.chunkManager.chunkSize;
    const chunkX = Math.floor(pos.x / chunkSize);
    const chunkZ = Math.floor(pos.z / chunkSize);
    const key = `${chunkX},${chunkZ}`;

    if (!this.placedObjects.has(key)) return;

    const objects = this.placedObjects.get(key);
    let removed = false;
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i];
      const dist = Math.sqrt(
        Math.pow(o.position[0] - pos.x, 2) +
        Math.pow(o.position[1] - pos.y, 2) +
        Math.pow(o.position[2] - pos.z, 2)
      );

      if (dist < radius) {
        objects.splice(i, 1);
        removed = true;
        
        // Find in chunk and remove from scene
        const chunk = this.chunkManager.chunks.get(key);
        if (chunk && chunk.removePlacedObject) {
          chunk.removePlacedObject(o);
        }
      }
    }
    return removed;
  }

  getObjectsForChunk(x, z) {
    const key = `${x},${z}`;
    return this.placedObjects.get(key) || [];
  }

  exportJSON() {
    const allObjects = [];
    for (const objs of this.placedObjects.values()) {
      allObjects.push(...objs);
    }
    const data = { objects: allObjects };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "jungle.json";
    a.click();
    console.log("💾 Map Exported");
  }

  async loadJSON(url) {
    try {
      const response = await fetch(url);
      const data = await response.json();
      this.placedObjects.clear();
      data.objects.forEach(o => {
        const key = `${o.chunk[0]},${o.chunk[1]}`;
        if (!this.placedObjects.has(key)) this.placedObjects.set(key, []);
        this.placedObjects.get(key).push(o);
      });
      console.log(`📥 Loaded ${data.objects.length} objects from ${url}`);
      this.chunkManager.refreshChunks();
    } catch (e) {
      console.error("Failed to load map:", e);
    }
  }
}
