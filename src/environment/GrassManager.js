import * as THREE from 'three';
import vertexShader from '../grassVertex.glsl?raw';
import fragmentShader from '../grassFragment.glsl?raw';

export const GRASS_VARIATIONS = {
    // STATIC VARIATIONS
    'short_grass': { animated: false, height: 0.4, width: 0.1, density: 100, radius: 1, windStrength: 0, windSpeed: 0, baseColor: '#1a3c1a', tipColor: '#4a8c4a' },
    'dry_grass': { animated: false, height: 0.8, width: 0.03, density: 80, radius: 1.5, windStrength: 0, windSpeed: 0, baseColor: '#3c3c1a', tipColor: '#8c8c4a' },
    'dense_patch': { animated: false, height: 0.6, width: 0.08, density: 250, radius: 1.2, windStrength: 0, windSpeed: 0, baseColor: '#0c2e0c', tipColor: '#3d6e1d' },
    'thin_blades': { animated: false, height: 1.2, width: 0.015, density: 150, radius: 2, windStrength: 0, windSpeed: 0, baseColor: '#1a4c1a', tipColor: '#5aac1a' },
    'wide_blades': { animated: false, height: 0.7, width: 0.1, density: 70, radius: 1.8, windStrength: 0, windSpeed: 0, baseColor: '#0a3a0a', tipColor: '#2d7a2d' },
    
    // ANIMATED VARIATIONS
    'light_wind': { animated: true, height: 1.0, width: 0.05, density: 150, radius: 2.5, windStrength: 0.15, windSpeed: 2.0, baseColor: '#0c2e0c', tipColor: '#6da61a' },
    'heavy_wind': { animated: true, height: 1.1, width: 0.07, density: 180, radius: 3, windStrength: 0.4, windSpeed: 4.5, baseColor: '#082808', tipColor: '#5d960a' },
    'tall_bending': { animated: true, height: 1.8, width: 0.08, density: 100, radius: 2, windStrength: 0.6, windSpeed: 1.5, baseColor: '#052505', tipColor: '#8db62a' },
    'clustered': { animated: true, height: 0.9, width: 0.06, density: 250, radius: 1, windStrength: 0.2, windSpeed: 2.5, baseColor: '#103010', tipColor: '#7db61a' },
    'directional': { animated: true, height: 1.3, width: 0.05, density: 120, radius: 3.5, windStrength: 0.8, windSpeed: 1.0, baseColor: '#0c2e0c', tipColor: '#6da61a' },
    'lush_jungle': { animated: true, height: 1.5, width: 0.12, density: 300, radius: 4, windStrength: 0.2, windSpeed: 1.2, baseColor: '#021c02', tipColor: '#217010' },
    'savanna_dry': { animated: true, height: 1.4, width: 0.06, density: 80, radius: 5, windStrength: 0.35, windSpeed: 3.0, baseColor: '#3b3b0a', tipColor: '#c4c43a' },
    'swamp_grass': { animated: true, height: 2.0, width: 0.15, density: 60, radius: 3, windStrength: 0.1, windSpeed: 0.8, baseColor: '#0a1a0a', tipColor: '#3a5a1a' },
    'mountain_tuff': { animated: true, height: 0.5, width: 0.08, density: 200, radius: 1, windStrength: 0.05, windSpeed: 5.0, baseColor: '#1c2e1c', tipColor: '#889977' },
    'alien_blue': { animated: true, height: 1.6, width: 0.08, density: 120, radius: 2, windStrength: 0.3, windSpeed: 2.0, baseColor: '#000c2e', tipColor: '#1a6da6' }
};

export class GrassManager {
    constructor(scene) {
        this.scene = scene;
        this.sharedUniforms = {
            uTime: { value: 0 },
            uPlayerPos: { value: new THREE.Vector3() },
            uInteractionRadius: { value: 1.5 },
            uInteractionStrength: { value: 0.8 }
        };
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.sharedUniforms.uTime,
                uPlayerPos: this.sharedUniforms.uPlayerPos,
                uInteractionRadius: this.sharedUniforms.uInteractionRadius,
                uInteractionStrength: this.sharedUniforms.uInteractionStrength,
                uWindSpeed: { value: 2.0 },
                uWindStrength: { value: 0.15 },
                uBaseColor: { value: new THREE.Color() },
                uTipColor: { value: new THREE.Color() }
            },
            vertexShader,
            fragmentShader,
            side: THREE.DoubleSide,
            transparent: false,
            alphaTest: 0.5
        });
    }

    createGrassPatch(params) {
        const count = params.density || 1000;
        const radius = params.radius || 5;
        const height = params.height || 1.0;
        const width = params.width || 0.03;

        const mat = this.material.clone();
        // Ensure shared uniforms are kept
        mat.uniforms.uTime = this.sharedUniforms.uTime;
        mat.uniforms.uPlayerPos = this.sharedUniforms.uPlayerPos;
        mat.uniforms.uInteractionRadius = this.sharedUniforms.uInteractionRadius;
        mat.uniforms.uInteractionStrength = this.sharedUniforms.uInteractionStrength;
        
        mat.uniforms.uWindSpeed.value = params.windSpeed;
        mat.uniforms.uWindStrength.value = params.windStrength;
        mat.uniforms.uBaseColor.value.set(params.baseColor);
        mat.uniforms.uTipColor.value.set(params.tipColor);

        // --- NEW ORGANIC CLUMP GEOMETRY ---
        const geometry = this._createClumpGeometry(width, height);

        const mesh = new THREE.InstancedMesh(geometry, mat, count);
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = false;

        const aInstanceData = new Float32Array(count * 4);
        const dummy = new THREE.Object3D();
        
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * radius;
            const x = Math.cos(angle) * r;
            const z = Math.sin(angle) * r;

            dummy.position.set(x, 0, z);
            dummy.rotation.y = Math.random() * Math.PI;
            dummy.scale.set(1, 0.8 + Math.random() * 0.4, 1);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);

            const i4 = i * 4;
            aInstanceData[i4 + 0] = Math.random() * 100; // time offset
            aInstanceData[i4 + 1] = Math.random();        // color variation
            aInstanceData[i4 + 2] = (Math.random() - 0.5) * 0.4; // lean
            aInstanceData[i4 + 3] = (Math.random() - 0.5) * 0.4; // tilt
        }

        mesh.geometry.setAttribute('aInstanceData', new THREE.InstancedBufferAttribute(aInstanceData, 4));
        
        // 🔥 CRITICAL for Raycasting
        mesh.computeBoundingSphere();
        mesh.computeBoundingBox();

        return mesh;
    }

    _createClumpGeometry(width, height) {
        const bladeCount = 3;
        const geometries = [];

        for (let i = 0; i < bladeCount; i++) {
            const plane = new THREE.PlaneGeometry(width, height, 1, 4); // 4 vertical segments
            plane.translate(0, height * 0.5, 0);
            
            const angle = (i / bladeCount) * Math.PI;
            const offsetX = (Math.random() - 0.5) * width * 0.3;
            const offsetZ = (Math.random() - 0.5) * width * 0.3;

            plane.rotateY(angle);
            plane.translate(offsetX, 0, offsetZ);
            geometries.push(plane);
        }

        // Manually merge geometries (since we don't have BufferGeometryUtils)
        // This is safe because they all have the same attributes and structure
        const combined = new THREE.BufferGeometry();
        let totalVertices = 0;
        let totalIndices = 0;

        geometries.forEach(g => {
            totalVertices += g.attributes.position.count;
            totalIndices += g.index.count;
        });

        const positions = new Float32Array(totalVertices * 3);
        const normals = new Float32Array(totalVertices * 3);
        const uvs = new Float32Array(totalVertices * 2);
        const indices = new Uint16Array(totalIndices);

        let vOffset = 0;
        let iOffset = 0;

        geometries.forEach(g => {
            positions.set(g.attributes.position.array, vOffset * 3);
            normals.set(g.attributes.normal.array, vOffset * 3);
            uvs.set(g.attributes.uv.array, vOffset * 2);

            const gIndices = g.index.array;
            for (let j = 0; j < gIndices.length; j++) {
                indices[iOffset + j] = gIndices[j] + vOffset;
            }

            vOffset += g.attributes.position.count;
            iOffset += g.index.count;
            g.dispose();
        });

        combined.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        combined.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        combined.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        combined.setIndex(new THREE.BufferAttribute(indices, 1));

        return combined;
    }

    createGrassFromPoints(points, params, getTerrainData) {
        if (!points || points.length === 0) return null;

        const pointsCount = points.length;
        const densityPerPoint = params.density || 10;
        const totalCount = pointsCount * densityPerPoint;
        const radius = params.radius || 2;
        const height = params.height || 1.0;
        const width = params.width || 0.03;

        const mat = this.material.clone();
        mat.uniforms.uTime = this.sharedUniforms.uTime;
        mat.uniforms.uPlayerPos = this.sharedUniforms.uPlayerPos;
        mat.uniforms.uInteractionRadius = this.sharedUniforms.uInteractionRadius;
        mat.uniforms.uInteractionStrength = this.sharedUniforms.uInteractionStrength;
        
        mat.uniforms.uWindSpeed.value = params.windSpeed !== undefined ? params.windSpeed : 2.0;
        mat.uniforms.uWindStrength.value = params.windStrength !== undefined ? params.windStrength : 0.15;
        mat.uniforms.uBaseColor.value.set(params.baseColor || '#0c2e0c');
        mat.uniforms.uTipColor.value.set(params.tipColor || '#6da61a');

        const mesh = new THREE.InstancedMesh(geometry, mat, totalCount);
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = false;

        const aInstanceData = new Float32Array(totalCount * 4);
        const dummy = new THREE.Object3D();
        
        let instanceIdx = 0;
        const falloffExp = params.falloff !== undefined ? params.falloff : 1.0;

        for (let pIdx = 0; pIdx < pointsCount; pIdx++) {
            const center = points[pIdx];
            
            for (let d = 0; d < densityPerPoint; d++) {
                const angle = Math.random() * Math.PI * 2;
                const r = Math.sqrt(Math.random()) * radius;
                
                // Falloff check
                const distRatio = r / radius;
                const falloffChance = Math.pow(1.0 - distRatio, falloffExp);
                const isVisible = Math.random() < falloffChance;

                const x = center.x + Math.cos(angle) * r;
                const z = center.z + Math.sin(angle) * r;

                const terrain = getTerrainData(x, z);
                const y = terrain.height;
                const normal = terrain.normal;

                dummy.position.set(x, y, z);
                
                // Align to normal
                const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
                dummy.rotation.setFromQuaternion(quat);
                dummy.rotation.y += Math.random() * Math.PI * 2; // Random spin
                
                // Random scale
                const s = isVisible ? (0.8 + Math.random() * 0.4) : 0.0001; // Hide if falloff fails
                dummy.scale.set(s, s, s);
                dummy.updateMatrix();
                mesh.setMatrixAt(instanceIdx, dummy.matrix);

                const i4 = instanceIdx * 4;
                aInstanceData[i4 + 0] = Math.random() * 100; // time offset
                aInstanceData[i4 + 1] = Math.random();        // color variation
                aInstanceData[i4 + 2] = (Math.random() - 0.5) * 0.4; // lean
                aInstanceData[i4 + 3] = (Math.random() - 0.5) * 0.4; // tilt
                
                instanceIdx++;
            }
        }

        mesh.geometry.setAttribute('aInstanceData', new THREE.InstancedBufferAttribute(aInstanceData, 4));
        mesh.computeBoundingSphere();
        mesh.computeBoundingBox();

        return mesh;
    }

    update(dt) {
        // Shared time is updated in main loop usually
    }
}
