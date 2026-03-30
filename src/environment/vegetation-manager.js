import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createNoise2D } from "simplex-noise";

export class VegetationManager {
  constructor(scene, calculateHeight, envParams) {
    this.scene = scene;
    this.calculateHeight = calculateHeight;
    this.envParams = envParams;

    this.loader = new GLTFLoader();
    this.models = new Map();

    this.noise2D = createNoise2D();
    this.biomeNoise = createNoise2D();
    this.pathNoise = createNoise2D();
    this.clusterNoise = createNoise2D();

    this.isLoaded = false;
    this.onLoadCallbacks = [];
  }

  async loadModels() {
    const assetList = {
      grass: [
        "/models/environment/grass/grass_one.glb",
        "/models/environment/grass/grass_two.glb",
        "/models/environment/grass/grass_three.glb",
        "/models/environment/grass/grass_four.glb",
        "/models/environment/grass/grass_vegetation.glb"
      ],
      foliage: [
        "/models/environment/grass/grass_foliage_one.glb",
        "/models/environment/grass/grass_foliage_two.glb",
        "/models/environment/grass/grass_foliage_three.glb",
        "/models/environment/grass/grass_foliage_four.glb",
        "/models/environment/grass/foliage_flower_one.glb",
        "/models/environment/grass/foliage_flower_two.glb"
      ],
      bushes: [
        "/models/environment/bushes/bush_one.glb",
        "/models/environment/bushes/bush_two.glb",
        "/models/environment/bushes/bush_three.glb"
      ],
      palms: [
        "/models/environment/palm_trees/coconut_tree.glb",
        "/models/environment/palm_trees/palm_tree_big.glb",
        "/models/environment/palm_trees/palm_tree_medium.glb",
        "/models/environment/palm_trees/palm_tree_small.glb"
      ],
      jungleTrees: [
        "/models/environment/low_poly_trees/low_poly_tree_one.glb",
        "/models/environment/low_poly_trees/low_poly_tree_two.glb",
        "/models/environment/low_poly_trees/low_poly_tree_three.glb",
        "/models/environment/low_poly_trees/test_tree.glb",
        "/models/environment/low_poly_trees_more/low_poly_more_tree_one.glb",
        "/models/environment/low_poly_trees_more/low_poly_more_tree_two.glb",
        "/models/environment/low_poly_trees_more/low_poly_more_tree_three.glb"
      ],
      deadTrees: [
        "/models/environment/no_leave_tree/no_leaves_tree_one.glb",
        "/models/environment/no_leave_tree/no_leaves_tree_two.glb",
        "/models/environment/no_leave_tree/no_leaves_tree_three.glb"
      ],
      rocks: [
        "/models/environment/rocks/giant_rocks_big_one.glb",
        "/models/environment/rocks/giant_rocks_big_two.glb",
        "/models/environment/rocks/giant_rocks_big_three.glb",
        "/models/environment/rocks/giant_rocks_medium_one.glb",
        "/models/environment/rocks/giant_rocks_medium_two.glb",
        "/models/environment/rocks/giant_rocks_medium_three.glb"
      ]
    };

    const loadPromises = [];

    for (const [category, paths] of Object.entries(assetList)) {
      this.models.set(category, new Array(paths.length));
      paths.forEach((path, index) => {
        loadPromises.push(this.loadModel(category, path, index));
      });
    }

    await Promise.all(loadPromises);
    
    // Add Grass Variations for Editor
    const { GRASS_VARIATIONS } = await import('./GrassManager.js');
    const staticGrass = [];
    const animatedGrass = [];
    
    Object.entries(GRASS_VARIATIONS).forEach(([name, params]) => {
        const item = { name, isGrassVariation: true, params };
        if (params.animated) animatedGrass.push(item);
        else staticGrass.push(item);
    });
    
    this.models.set("grass_static", staticGrass);
    this.models.set("grass_animated", animatedGrass);

    // Clean invalid entries
    for (const [category, arr] of this.models.entries()) {
      this.models.set(category, arr.filter(Boolean));
    }

    this.isLoaded = true;
    this.onLoadCallbacks.forEach(cb => cb());
  }

  loadModel(category, path, index) {
    return new Promise((resolve) => {
      this.loader.load(path, (gltf) => {
        const model = gltf.scene;
        model.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(model);
        if (box.isEmpty()) return resolve();

        const size = new THREE.Vector3();
        box.getSize(size);
        const scaleFactor = 1 / Math.max(size.x, size.y, size.z);

        const meshes = [];

        model.traverse(child => {
          if (!child.isMesh) return;

          // 🔥 IMPORTANT: CLONE MATERIAL (fix instancing bug)
          const mat = child.material.clone();

          mat.transparent = false; // 🔥 huge perf win
          mat.alphaTest = 0.5;
          mat.side = THREE.DoubleSide;
          mat.depthWrite = true;

          const geom = child.geometry.clone();

          geom.applyMatrix4(child.matrixWorld);
          geom.scale(scaleFactor, scaleFactor, scaleFactor);
          geom.translate(0, -box.min.y * scaleFactor, 0);

          meshes.push({ geometry: geom, material: mat });
        });

        if (!meshes.length) return resolve();

        const modelName = path.split("/").pop().replace(".glb", "");

        this.models.get(category)[index] = {
          meshes,
          name: modelName
        };

        resolve();
      }, undefined, () => resolve());
    });
  }

  onLoad(cb) {
    if (this.isLoaded) cb();
    else this.onLoadCallbacks.push(cb);
  }

  getVegetationForChunk(chunkX, chunkZ, chunkSize) {
    if (!this.isLoaded) return [];

    const p = this.envParams;
    const instancedMeshes = [];

    const getBiomeType = (x, z) => {
      const n = this.biomeNoise(x * p.biome.scale, z * p.biome.scale);
      const v = (n * 0.5 + 0.5);

      if (v < p.biome.dryThreshold) return "dry";
      if (v < p.biome.grassThreshold) return "grassland";
      if (v < p.biome.forestThreshold) return "forest";
      return "jungle";
    };

    const layers = [
      { name: "grass", models: [...(this.models.get("grass") || []), ...(this.models.get("foliage") || [])], densityKey: "grassDensity" },
      { name: "bush", models: this.models.get("bushes") || [], densityKey: "bushDensity" },
      { name: "rock", models: this.models.get("rocks") || [], densityKey: "rockDensity" },
      { name: "tree", models: [], densityKey: "treeDensity", isTree: true }
    ];

    layers.forEach(layer => {
      const meshes = this.createBiomeInstances(
        layer.name,
        layer.models,
        chunkX,
        chunkZ,
        chunkSize,
        getBiomeType,
        layer.densityKey,
        layer.isTree
      );
      instancedMeshes.push(...meshes);
    });

    return instancedMeshes;
  }

  createBiomeInstances(name, modelDataList, chunkX, chunkZ, chunkSize, getBiomeType, densityKey, isTree = false) {
    const p = this.envParams;
    const groups = new Map();

    const maxDensity = Math.max(...Object.values(p.biomes).map(b => b[densityKey]));
    const count = Math.ceil(maxDensity * (chunkSize * chunkSize / 2500));

    for (let i = 0; i < count; i++) {
      const rx = Math.random() * chunkSize - chunkSize / 2;
      const rz = Math.random() * chunkSize - chunkSize / 2;

      const x = chunkX + rx;
      const z = chunkZ + rz;

      const biome = getBiomeType(x, z);
      const biomeParams = p.biomes[biome];

      if (Math.random() > (biomeParams[densityKey] / maxDensity)) continue;

      const y = this.calculateHeight(x, z);

      let modelData;

      if (isTree) {
        const jungle = this.models.get("jungleTrees") || [];
        const palms = this.models.get("palms") || [];
        const dead = this.models.get("deadTrees") || [];

        if (!jungle.length && !palms.length && !dead.length) continue;

        if (biome === "dry") {
          modelData = dead[Math.floor(Math.random() * dead.length)];
        } else if (biome === "jungle") {
          const pool = Math.random() < 0.4 ? palms : jungle;
          modelData = pool[Math.floor(Math.random() * pool.length)];
        } else {
          modelData = jungle[Math.floor(Math.random() * jungle.length)];
        }
      } else {
        if (!modelDataList.length) continue;
        modelData = modelDataList[Math.floor(Math.random() * modelDataList.length)];
      }

      if (!modelData) continue;

      if (!groups.has(modelData)) groups.set(modelData, []);

      const matrix = new THREE.Matrix4();

      const sMin = p[name]?.scaleMin || 1;
      const sMax = p[name]?.scaleMax || 1;

      const scaleVal = sMin + Math.random() * (sMax - sMin);

      matrix.compose(
        new THREE.Vector3(rx, y, rz),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.random() * Math.PI * 2, 0)),
        new THREE.Vector3(scaleVal, scaleVal, scaleVal)
      );

      groups.get(modelData).push(matrix);
    }

    const result = [];

    for (const [modelData, matrices] of groups) {
      if (!matrices.length) continue;

      modelData.meshes.forEach(sub => {
        const imesh = new THREE.InstancedMesh(
          sub.geometry,
          sub.material,
          matrices.length
        );

        // Shadows removed per request


        // Metadata required for ChunkManager LOD distance counting
        imesh.userData.maxCount = matrices.length;
        imesh.userData.isTree = isTree;
        
        // 🔥 IMPORTANT: disable broken frustum culling for instancing
        imesh.frustumCulled = false;

        for (let i = 0; i < matrices.length; i++) {
          imesh.setMatrixAt(i, matrices[i]);
        }

        result.push(imesh);
      });
    }

    return result;
  }
}
