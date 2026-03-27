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

    // Noise for biomes and clusters
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
        "/models/environment/no_leave_tree/no_leaves_tree_three.glb",
        "/models/environment/no_leave_tree/no_leaves_tree_four.glb",
        "/models/environment/no_leave_tree/no_leaves_tree_five.glb",
        "/models/environment/no_leave_tree/no_leaves_tree_six.glb",
        "/models/environment/no_leave_tree/no_leaves_tree_seven.glb",
        "/models/environment/no_leave_tree/no_leaves_tree_eight.glb",
        "/models/environment/no_leave_tree/no_leaves_tree_nine.glb",
        "/models/environment/no_leave_tree/no_leaves_tree_ten.glb"
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

    // Clean up any undefined entries in case some models failed to load
    for (const [category, modelsArray] of this.models.entries()) {
      const validModels = modelsArray.filter(m => m !== undefined);
      this.models.set(category, validModels);
    }

    this.isLoaded = true;
    this.onLoadCallbacks.forEach(cb => cb());
  }

  loadModel(category, path, index) {
    return new Promise((resolve) => {
      this.loader.load(path, (gltf) => {
        const model = gltf.scene;
        model.traverse(child => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        const meshes = [];

        model.traverse(child => {
          if (child.isMesh) {
            // Fix materials (VERY IMPORTANT for leaves)
            const mat = child.material;

            if (mat) {
              mat.transparent = true;
              mat.alphaTest = 0.4;
              mat.side = THREE.DoubleSide;
              mat.depthWrite = false;
            }

            // Normalize geometry (scale + center)
            child.geometry.computeBoundingBox();
            const bbox = child.geometry.boundingBox;
            const size = new THREE.Vector3();
            bbox.getSize(size);

            const maxSide = Math.max(size.x, size.y, size.z);
            const scaleFactor = 1.0 / maxSide;

            child.geometry.scale(scaleFactor, scaleFactor, scaleFactor);

            child.geometry.computeBoundingBox();
            const newBBox = child.geometry.boundingBox;
            child.geometry.translate(0, -newBBox.min.y, 0);

            meshes.push({
              geometry: child.geometry,
              material: mat
            });
          }
        });

        if (meshes.length === 0) {
          console.warn(`No meshes found in model ${path}`);
          resolve();
          return;
        }

        // --- NORMALIZE MODEL SCALING ---
        mesh.geometry.computeBoundingBox();
        const bbox = mesh.geometry.boundingBox;
        const size = new THREE.Vector3();
        bbox.getSize(size);
        const maxSide = Math.max(size.x, size.y, size.z);
        const scaleFactor = 1.0 / maxSide;

        mesh.geometry.scale(scaleFactor, scaleFactor, scaleFactor);

        // Re-center around base (optional, depends on model export)
        mesh.geometry.computeBoundingBox();
        const newBBox = mesh.geometry.boundingBox;
        mesh.geometry.translate(0, -newBBox.min.y, 0); // Keep base at 0

        if (!this.models.has(category)) {
          this.models.set(category, []);
        }
        // Extract human-readable name from path e.g. "grass_one" from ".../grass_one.glb"
        const modelName = path.split("/").pop().replace(".glb", "");

        this.models.get(category)[index] = {
          meshes: meshes,
          name: modelName
        };

        resolve();
      }, undefined, (err) => {
        console.error(`Error loading model ${path}:`, err);
        resolve(); // Resolve anyway to not block
      });
    });
  }

  onLoad(cb) {
    if (this.isLoaded) cb();
    else this.onLoadCallbacks.push(cb);
  }

  // Populate a chunk with vegetation
  getVegetationForChunk(chunkX, chunkZ, chunkSize) {
    if (!this.isLoaded) return [];

    const instancedMeshes = [];
    const p = this.envParams;

    // Helper to get biome at position
    const getBiomeType = (x, z) => {
      const offset = p.random.seed;
      const n = this.biomeNoise((x + offset) * p.biome.scale, (z + offset) * p.biome.scale);
      const biomeVal = (n * 0.5 + 0.5) * p.biome.influence; // 0 to 1 weighted

      if (biomeVal < p.biome.dryThreshold) return "dry";
      if (biomeVal < p.biome.grassThreshold) return "grassland";
      if (biomeVal < p.biome.forestThreshold) return "forest";
      return "jungle";
    };

    const getPathPos = (x, z) => {
      const offset = p.random.seed * 2.0;
      const n = this.pathNoise((x + offset) * 0.05, (z + offset) * 0.05);
      return (n * 0.5 + 0.5); // 0 to 1
    };

    // 1. Spawning Layers
    const layers = [
      { name: "grass", models: (this.models.get("grass") || []).concat(this.models.get("foliage") || []), densityKey: "grassDensity" },
      { name: "bush", models: this.models.get("bushes") || [], densityKey: "bushDensity" },
      { name: "rock", models: this.models.get("rocks") || [], densityKey: "rockDensity" },
      { name: "tree", models: [], densityKey: "treeDensity", isTree: true }
    ];

    layers.forEach(layer => {
      const categoryMeshes = this.createBiomeInstances(
        layer.name,
        layer.models,
        chunkX,
        chunkZ,
        chunkSize,
        getBiomeType,
        getPathPos,
        layer.densityKey,
        layer.isTree
      );
      instancedMeshes.push(...categoryMeshes);
    });

    return instancedMeshes;
  }

  createBiomeInstances(name, modelDataList, chunkX, chunkZ, chunkSize, getBiomeType, getPathPos, densityKey, isTree = false) {
    const p = this.envParams;
    const groups = new Map();

    // Sample density - we use max density across biomes as base count then filter
    const maxDensity = Math.max(...Object.values(p.biomes).map(b => b[densityKey]));
    const count = Math.ceil(maxDensity * (chunkSize * chunkSize / 2500)); // Normalize per 50x50 chunk

    for (let i = 0; i < count; i++) {
      const rx = Math.random() * chunkSize - chunkSize / 2;
      const rz = Math.random() * chunkSize - chunkSize / 2;
      const x = chunkX + rx;
      const z = chunkZ + rz;

      const biomeType = getBiomeType(x, z);
      const biomeParams = p.biomes[biomeType];

      // Probabilistic density check
      const targetDensity = biomeParams[densityKey];
      if (Math.random() > (targetDensity / maxDensity)) continue;

      // Path suppression
      const pathVal = getPathPos(x, z);
      const pathSuppression = Math.max(0, 1.0 - (pathVal - 0.5) * 5.0 * p.path.influence);
      if (biomeType !== "jungle" && pathVal > 0.45) continue; // Full clear for non-jungle
      if (biomeType === "jungle" && pathVal > 0.6) continue; // Partial clear for jungle

      // Clustering
      const cluster = (this.clusterNoise(x * 0.05, z * 0.05) * 0.5 + 0.5);
      if (cluster < (1.0 - biomeParams.clusterStrength)) continue;

      const y = this.calculateHeight(x, z);

      // Pick a model based on biome and type
      let modelData;
      if (isTree) {
        const jungleTrees = this.models.get("jungleTrees");
        const palmTrees = this.models.get("palms");
        const deadTrees = this.models.get("deadTrees");

        if (biomeType === "dry") {
          modelData = deadTrees[Math.floor(Math.random() * deadTrees.length)];
        } else if (biomeType === "jungle") {
          modelData = Math.random() < 0.4 ? palmTrees[Math.floor(Math.random() * palmTrees.length)] : jungleTrees[Math.floor(Math.random() * jungleTrees.length)];
        } else if (biomeType === "forest") {
          modelData = jungleTrees[Math.floor(Math.random() * jungleTrees.length)];
        } else if (biomeType === "grassland") {
          if (Math.random() > 0.3) continue; // Sparsely distributed trees in grassland
          modelData = palmTrees[Math.floor(Math.random() * palmTrees.length)];
        }
      } else {
        modelData = modelDataList[Math.floor(Math.random() * modelDataList.length)];
      }

      if (!modelData) continue;

      if (!groups.has(modelData)) groups.set(modelData, []);

      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3(rx, y + (name === "rock" ? -0.2 : 0), rz);
      const rotation = new THREE.Euler(0, Math.random() * Math.PI * 2, 0);

      // Get scale config based on category mapping
      const catKey = name === "bush" ? "bush" : (name === "rock" ? "rock" : (name === "tree" ? "tree" : "grass"));
      const sMin = p[catKey].scaleMin;
      const sMax = p[catKey].scaleMax;

      const sVal = sMin + Math.random() * (sMax - sMin);
      const scale = new THREE.Vector3(sVal, sVal, sVal);

      matrix.compose(position, new THREE.Quaternion().setFromEuler(rotation), scale);
      groups.get(modelData).push(matrix);
    }

    const imeshes = [];
    for (const [modelData, matrices] of groups) {
      modelData.meshes.forEach(sub => {
        const imesh = new THREE.InstancedMesh(
          sub.geometry,
          sub.material,
          matrices.length
        );

        imesh.castShadow = true;
        imesh.receiveShadow = true;

        for (let i = 0; i < matrices.length; i++) {
          imesh.setMatrixAt(i, matrices[i]);
        }

        imeshes.push(imesh);
      });
    }
    return imeshes;
  }

  createInstances(name, modelDataList, count, chunkX, chunkZ, chunkSize, densityFunc, minScale, maxScale, isTree = false, yOffset = 0) {
    const meshes = [];

    // Group by unique geometry/material to create InstancedMeshes
    const groups = new Map();

    for (let i = 0; i < count; i++) {
      const rx = Math.random() * chunkSize - chunkSize / 2;
      const rz = Math.random() * chunkSize - chunkSize / 2;
      const x = chunkX + rx;
      const z = chunkZ + rz;

      const density = densityFunc(x, z);
      if (Math.random() > density) continue;

      const y = this.calculateHeight(x, z);

      // Pick a model
      let modelData;
      const p = this.envParams;
      if (isTree) {
        const biome = THREE.MathUtils.smoothstep(this.biomeNoise(x * p.biome.scale, z * p.biome.scale), -1, 1);
        const rand = Math.random();
        const deadTrees = this.models.get("deadTrees");
        const jungleTrees = this.models.get("jungleTrees");
        const palmTrees = this.models.get("palms");

        if (rand < p.tree.deadRatio) {
          modelData = deadTrees[Math.floor(Math.random() * deadTrees.length)];
        } else {
          const isPalm = Math.random() < p.tree.palmRatio;
          if (isPalm) {
            modelData = palmTrees[Math.floor(Math.random() * palmTrees.length)];
          } else {
            modelData = jungleTrees[Math.floor(Math.random() * jungleTrees.length)];
          }
        }
      } else {
        modelData = modelDataList[Math.floor(Math.random() * modelDataList.length)];
      }

      if (!modelData) continue;

      if (!groups.has(modelData)) {
        groups.set(modelData, []);
      }

      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3(rx, y + yOffset, rz);
      const rotation = new THREE.Euler(0, Math.random() * Math.PI * 2, 0);
      const scaleVal = minScale + Math.random() * (maxScale - minScale);
      const scale = new THREE.Vector3(scaleVal, scaleVal, scaleVal);

      matrix.compose(position, new THREE.Quaternion().setFromEuler(rotation), scale);
      groups.get(modelData).push(matrix);
    }

    for (const [modelData, matrices] of groups) {
      modelData.meshes.forEach(sub => {
        const imesh = new THREE.InstancedMesh(
          sub.geometry,
          sub.material,
          matrices.length
        );

        imesh.castShadow = true;
        imesh.receiveShadow = true;

        for (let i = 0; i < matrices.length; i++) {
          imesh.setMatrixAt(i, matrices[i]);
        }

        imeshes.push(imesh);
      });
    }

    return meshes;
  }
}
