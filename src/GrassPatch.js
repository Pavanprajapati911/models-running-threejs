import * as THREE from 'three';
import vertexShader from './grassVertex.glsl?raw';
import fragmentShader from './grassFragment.glsl?raw';
import GUI from 'lil-gui';

/**
 * 🌿 GrassPatch (V3) - Enhanced Realistic Grass with Color Customization.
 * Fully interactive shader-driven instanced grass patch.
 */
export class GrassPatch {
    /**
     * @param {THREE.Scene} scene - The renderer scene.
     * @param {Object} player - Object with a position (usually character model).
     */
    constructor(scene, player) {
        this.scene = scene;
        this.player = player;
        
        // 1. Core Params
        this.params = {
            count: 4000,
            radius: 12.0,
            width: 0.035,
            height: 1.1,
            windSpeed: 2.2,
            windStrength: 0.12,
            randomScale: 0.4,
            baseColor: '#0c2e0c', // Dark forest green
            tipColor: '#6da61a'    // Bright grass green
        };

        // 2. Setup Material with Color Uniforms
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uWindSpeed: { value: this.params.windSpeed },
                uWindStrength: { value: this.params.windStrength },
                uBaseColor: { value: new THREE.Color(this.params.baseColor) },
                uTipColor: { value: new THREE.Color(this.params.tipColor) }
            },
            vertexShader: vertexShader,
            fragmentShader: fragmentShader,
            side: THREE.DoubleSide
        });

        // 3. Initialize Mesh
        this.initMesh();

        // 4. Debug GUI
        this.initGUI();
    }

    /**
     * Re-creates the InstancedMesh when geometry params changing.
     */
    initMesh() {
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.geometry.dispose();
        }

        const count = this.params.count;
        const radius = this.params.radius;

        // 3a. Geometry
        const geometry = new THREE.PlaneGeometry(
            this.params.width, 
            this.params.height, 
            1, 6
        );
        geometry.translate(0, this.params.height * 0.5, 0);

        // 3b. Instanced Mesh
        this.mesh = new THREE.InstancedMesh(geometry, this.material, count);
        this.mesh.frustumCulled = false;

        // 3c. Attributes
        const aInstanceData = new Float32Array(count * 4);
        const dummy = new THREE.Object3D();
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * radius;
            const x = Math.cos(angle) * r;
            const z = Math.sin(angle) * r;

            dummy.position.set(x, 0, z);
            dummy.rotation.y = Math.random() * Math.PI;
            
            const baseScale = 0.8 + Math.random() * this.params.randomScale;
            dummy.scale.set(1, baseScale, 1);
            
            dummy.updateMatrix();
            this.mesh.setMatrixAt(i, dummy.matrix);

            const i4 = i * 4;
            aInstanceData[i4 + 0] = Math.random() * 100; // time offset
            aInstanceData[i4 + 1] = Math.random();        // color variation index
            aInstanceData[i4 + 2] = (Math.random() - 0.5) * 0.4; // lean
            aInstanceData[i4 + 3] = (Math.random() - 0.5) * 0.4; // tilt
        }

        this.mesh.geometry.setAttribute(
            'aInstanceData', 
            new THREE.InstancedBufferAttribute(aInstanceData, 4)
        );

        this.scene.add(this.mesh);
    }

    initGUI() {
        const gui = new GUI({ title: '🌿 High-Res Grass (V3)' });
        gui.domElement.id = 'grass-gui';
        gui.domElement.style.top = '10px';
        gui.domElement.style.right = '330px';

        const design = gui.addFolder('🎨 Colors');
        design.addColor(this.params, 'baseColor').name('Root Color').onChange(v => {
            this.material.uniforms.uBaseColor.value.set(v);
        });
        design.addColor(this.params, 'tipColor').name('Tip Color').onChange(v => {
            this.material.uniforms.uTipColor.value.set(v);
        });

        const shape = gui.addFolder('📐 Geometry');
        shape.add(this.params, 'count', 500, 10000, 500).name('Density').onFinishChange(() => this.initMesh());
        shape.add(this.params, 'radius', 2, 30, 1).name('Patch Radius').onFinishChange(() => this.initMesh());
        shape.add(this.params, 'width', 0.01, 0.1, 0.005).name('Blade Width').onFinishChange(() => this.initMesh());
        shape.add(this.params, 'height', 0.1, 3.0, 0.1).name('Base Height').onFinishChange(() => this.initMesh());

        const anime = gui.addFolder('💨 Wind & Waves');
        anime.add(this.params, 'windSpeed', 0, 10, 0.1).name('Speed').onChange(v => {
            this.material.uniforms.uWindSpeed.value = v;
        });
        anime.add(this.params, 'windStrength', 0, 1, 0.01).name('Strength').onChange(v => {
            this.material.uniforms.uWindStrength.value = v;
        });
        anime.add(this.params, 'randomScale', 0, 1, 0.1).name('Height Var').onFinishChange(() => this.initMesh());
    }

    /**
     * @param {number} deltaTime - Time since last frame.
     */
    update(deltaTime) {
        if (!this.mesh) return;

        const p = this.player;
        const pos = p.model ? p.model.position : p.position;
        if (pos) {
            this.mesh.position.set(pos.x, pos.y, pos.z);
        }

        this.material.uniforms.uTime.value += deltaTime;
    }

    destroy() {
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}
