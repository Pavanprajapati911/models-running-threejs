import * as THREE from "three";
import Rapier from "@dimforge/rapier3d-compat";

export class StealthMap {
  constructor(scene, world, terrain, options = {}) {
    this.scene = scene;
    this.world = world;
    this.terrain = terrain;
    /* =========================
       CONFIG
    ========================= */

    const loader = new THREE.TextureLoader();

    const rockTex = loader.load("/textures/four_k/rock.jpg");

    rockTex.wrapS = THREE.RepeatWrapping;
    rockTex.wrapT = THREE.RepeatWrapping;
    rockTex.anisotropy = 8;

    this.mapSize = options.mapSize ?? 50;
    this.wallHeight = options.wallHeight ?? 5;

    this.rockCount = options.rockCount ?? 25;
    this.rockMin = options.rockMin ?? 0.8;
    this.rockMax = options.rockMax ?? 2.5;

    this.coverWallCount = options.coverWallCount ?? 10;

    this.wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x5a5a5a,
      roughness: 1,
    });

    this.rockMaterial = new THREE.MeshStandardMaterial({
      map: rockTex,
      roughness: 1,
    });

    // this.createBoundaryWalls();
    // this.createCoverWalls();
    this.createRocks();
  }

  /* =========================
     MAP BOUNDARY
  ========================= */

  createBoundaryWalls() {
    const thickness = 1;

    const walls = [
      { x: 0, z: -this.mapSize / 2, w: this.mapSize, d: thickness },
      { x: 0, z: this.mapSize / 2, w: this.mapSize, d: thickness },
      { x: -this.mapSize / 2, z: 0, w: thickness, d: this.mapSize },
      { x: this.mapSize / 2, z: 0, w: thickness, d: this.mapSize },
    ];

    walls.forEach((w) => this.createWall(w.w, this.wallHeight, w.d, w.x, w.z));
  }

  /* =========================
     SMALL COVER WALLS
  ========================= */

  createCoverWalls() {
    for (let i = 0; i < this.coverWallCount; i++) {
      const width = 2 + Math.random() * 3;
      const depth = 0.6;

      const x = (Math.random() - 0.5) * (this.mapSize - 6);
      const z = (Math.random() - 0.5) * (this.mapSize - 6);

      const rot = Math.random() * Math.PI;

      const mesh = this.createWall(width, 2.2, depth, x, z);

      mesh.rotation.y = rot;
    }
  }

  /* =========================
     ROCKS
  ========================= */

  createRocks() {
    const geometries = [
      new THREE.DodecahedronGeometry(1),
      new THREE.IcosahedronGeometry(1),
      new THREE.BoxGeometry(1, 1, 1),
    ];

    for (let i = 0; i < this.rockCount; i++) {
      const geo =
        geometries[Math.floor(Math.random() * geometries.length)].clone();

      const scale =
        this.rockMin + Math.random() * (this.rockMax - this.rockMin);

      const mesh = new THREE.Mesh(geo, this.rockMaterial);

      const x = (Math.random() - 0.5) * (this.mapSize - 6);
      const z = (Math.random() - 0.5) * (this.mapSize - 6);

      mesh.scale.set(scale, scale * 0.7, scale);

      const groundY = this.terrain.getHeight(x, z);

      mesh.position.set(x, groundY + scale * 0.4, z);

      mesh.castShadow = true;
      mesh.receiveShadow = true;

      this.scene.add(mesh);

      /* physics */

      const rot = new THREE.Euler(
        Math.random(),
        Math.random() * Math.PI,
        Math.random(),
      );

      mesh.rotation.copy(rot);

      const quat = new THREE.Quaternion().setFromEuler(rot);

      const rb = this.world.createRigidBody(
        Rapier.RigidBodyDesc.fixed()
          .setTranslation(x, groundY + scale * 0.4, z)
          .setRotation({
            x: quat.x,
            y: quat.y,
            z: quat.z,
            w: quat.w,
          }),
      );

      const vertices = geo.attributes.position.array.slice();

      for (let i = 0; i < vertices.length; i += 3) {
        vertices[i] *= scale;
        vertices[i + 1] *= scale * 0.7;
        vertices[i + 2] *= scale;
      }

      const indices = geo.index
        ? geo.index.array
        : [...Array(vertices.length / 3).keys()];

      const collider = Rapier.ColliderDesc.trimesh(
        new Float32Array(vertices),
        new Uint32Array(indices),
      );

      this.world.createCollider(collider, rb);
    }
  }

  /* =========================
     WALL CREATOR
  ========================= */

  createWall(width, height, depth, x, z) {
    const geo = new THREE.BoxGeometry(width, height, depth);
    const mesh = new THREE.Mesh(geo, this.wallMaterial);

    mesh.position.set(x, height / 2, z);

    mesh.castShadow = true;
    mesh.receiveShadow = true;

    this.scene.add(mesh);

    const rb = this.world.createRigidBody(
      Rapier.RigidBodyDesc.fixed().setTranslation(x, height / 2, z),
    );

    const collider = Rapier.ColliderDesc.cuboid(
      width / 2,
      height / 2,
      depth / 2,
    );

    this.world.createCollider(collider, rb);

    return mesh;
  }
}
