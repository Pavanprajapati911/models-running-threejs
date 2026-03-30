import * as THREE from 'three';

export class WeatherSystem {
    constructor(envParams) {
        this.envParams = envParams;
        
        // Initialize weather parameters if missing
        if (!this.envParams.weather) {
            this.envParams.weather = {
                coverage: 0.45,
                density: 0.5,
                windSpeed: 0.05,
                cloudScale: 1.0,
                brightness: 1.0
            };
        }

        this.presets = {
            clear: { coverage: 0.2, density: 0.3, windSpeed: 0.02, cloudScale: 0.8 },
            cloudy: { coverage: 0.5, density: 0.6, windSpeed: 0.05, cloudScale: 1.0 },
            overcast: { coverage: 0.85, density: 0.8, windSpeed: 0.08, cloudScale: 1.2 },
            stormy: { coverage: 0.95, density: 1.0, windSpeed: 0.15, cloudScale: 1.5 }
        };

        this.currentPreset = 'cloudy';
    }

    setPreset(name) {
        if (!this.presets[name]) return;
        const target = this.presets[name];
        this.currentPreset = name;
        
        // In a more advanced version, we would interpolate these
        this.envParams.weather.coverage = target.coverage;
        this.envParams.weather.density = target.density;
        this.envParams.weather.windSpeed = target.windSpeed;
        this.envParams.weather.cloudScale = target.cloudScale;
    }

    update(dt) {
        // Handle smooth transitions here if needed
    }

    addToGui(gui) {
        const folder = gui.addFolder('🌦 Weather Controller');
        const w = this.envParams.weather;

        folder.add(this, 'currentPreset', Object.keys(this.presets)).name('Preset').onChange(v => this.setPreset(v));
        
        folder.add(w, 'coverage', 0, 1).name('Cloud Coverage').listen();
        folder.add(w, 'density', 0, 1).name('Cloud Density').listen();
        folder.add(w, 'windSpeed', 0, 0.5).name('Wind Speed').listen();
        folder.add(w, 'cloudScale', 0.1, 5).name('Cloud Scale').listen();
        
        return folder;
    }
}
