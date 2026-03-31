import * as THREE from 'three';
import { GUI } from 'lil-gui';

export class WeatherController {
    constructor(scene, gui = null) {
        this.scene = scene;
        
        // Internal State
        this.params = {
            // Clouds
            coverage: 0.55, 
            density: 0.5,
            speed: 0.1, // Overall speed multiplier for wind
            windX: 1.0,  // Wind direction component X
            windY: 0.5,  // Wind direction component Y (usually Z in world space)
            
            // Sky
            skyColorTop: '#0055ff',
            skyColorHorizon: '#87ceeb',
            sunIntensity: 1.0,
            
            // Sun Position
            sunElevation: 45,
            sunAzimuth: 180,
        };

        this.sunDirection = new THREE.Vector3();
        this.updateSunDirection();

        this.gui = gui || new GUI();
        this.setupGUI();
        
        // Systems to notify on change
        this.skySystem = null;
        this.cloudSystem = null;
    }

    setSystems(sky, clouds) {
        this.skySystem = sky;
        this.cloudSystem = clouds;
        this.updateSystems();
    }

    updateSunDirection() {
        const phi = THREE.MathUtils.degToRad(90 - this.params.sunElevation);
        const theta = THREE.MathUtils.degToRad(this.params.sunAzimuth);

        this.sunDirection.setFromSphericalCoords(1, phi, theta);
    }

    setupGUI() {
        const cloudFolder = this.gui.addFolder('☁️ Cloud System');
        cloudFolder.add(this.params, 'coverage', 0, 1).name('☁️ Coverage').onChange(() => this.updateSystems());
        cloudFolder.add(this.params, 'density', 0, 1).name('💨 Density').onChange(() => this.updateSystems());
        cloudFolder.add(this.params, 'speed', 0, 1).name('🌬️ Wind Speed').onChange(() => this.updateSystems());
        
        const windFolder = cloudFolder.addFolder('🌬️ Wind Direction');
        windFolder.add(this.params, 'windX', -1, 1).name('X Dir').onChange(() => this.updateSystems());
        windFolder.add(this.params, 'windY', -1, 1).name('Y Dir').onChange(() => this.updateSystems());

        const skyFolder = this.gui.addFolder('☀ Sky Control');
        skyFolder.addColor(this.params, 'skyColorTop').name('Top Color').onChange(() => this.updateSystems());
        skyFolder.addColor(this.params, 'skyColorHorizon').name('Horizon Color').onChange(() => this.updateSystems());
        skyFolder.add(this.params, 'sunIntensity', 0, 5).name('Sun Intensity').onChange(() => this.updateSystems());
        skyFolder.add(this.params, 'sunElevation', 0, 90).name('Elevation').onChange(() => {
            this.updateSunDirection();
            this.updateSystems();
        });
        skyFolder.add(this.params, 'sunAzimuth', 0, 360).name('Azimuth').onChange(() => {
            this.updateSunDirection();
            this.updateSystems();
        });
    }

    updateSystems() {
        if (this.skySystem) {
            this.skySystem.updateParams(this.params, this.sunDirection);
        }
        if (this.cloudSystem) {
            this.cloudSystem.updateParams(this.params, this.sunDirection);
        }
    }

    update(time) {
        // Any periodic logic if needed
    }
}
