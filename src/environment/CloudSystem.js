import * as THREE from 'three';

export class CloudSystem {
    constructor(scene, envParams) {
        this.scene = scene;
        this.envParams = envParams;

        // Initialize cloud parameters if missing
        if (!this.envParams.clouds) {
            this.envParams.clouds = {
                density: 0.5,
                coverage: 0.45,
                cloudScale: 1.0,
                speed: 0.05,
                skyColor: '#4a90e2',
                cloudColor: '#ffffff',
                sunGlowColor: '#ffcc88',
                ambientColor: '#88aacc'
            };
        }

        const cloudParams = this.envParams.clouds;

        // Create a procedural tileable cloud texture for structural detail
        this.cloudTexture = this.generateCloudTexture();

        this.uniforms = {
            uTime: { value: 0 },
            uCloudMap: { value: this.cloudTexture },
            uCoverage: { value: cloudParams.coverage },
            uDensity: { value: cloudParams.density },
            uCloudScale: { value: cloudParams.cloudScale },
            uCloudSpeed: { value: cloudParams.speed },
            uSunDir: { value: new THREE.Vector3(1, 1, 1).normalize() },
            uSkyColor: { value: new THREE.Color(cloudParams.skyColor) },
            uCloudColor: { value: new THREE.Color(cloudParams.cloudColor) },
            uSunGlowColor: { value: new THREE.Color(cloudParams.sunGlowColor) },
            uAmbientColor: { value: new THREE.Color(cloudParams.ambientColor) }
        };

        const vertexShader = `
            varying vec2 vUv;
            varying vec3 vWorldPosition;
            varying vec3 vViewDir;
            
            void main() {
                vUv = uv;
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPosition.xyz;
                
                // View direction in world space
                vViewDir = normalize(worldPosition.xyz - cameraPosition);
                
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;

        const fragmentShader = `
            uniform float uTime;
            uniform sampler2D uCloudMap;
            uniform float uCoverage;
            uniform float uDensity;
            uniform float uCloudScale;
            uniform float uCloudSpeed;
            uniform vec3 uSunDir;
            uniform vec3 uSkyColor;
            uniform vec3 uCloudColor;
            uniform vec3 uSunGlowColor;
            uniform vec3 uAmbientColor;

            varying vec2 vUv;
            varying vec3 vWorldPosition;
            varying vec3 vViewDir;

            // Simplified 3D pseudo-noise for FBM layers
            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
            }

            float noise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                return mix(mix(hash(i + vec2(0, 0)), hash(i + vec2(1, 0)), f.x),
                           mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
            }

            float fbm(vec2 p) {
                float v = 0.0;
                float a = 0.5;
                for (int i = 0; i < 4; i++) {
                    v += a * noise(p);
                    p *= 2.0;
                    a *= 0.5;
                }
                return v;
            }

            void main() {
                // Determine noise based on horizontal position (XZ) for "ceiling" look
                vec2 baseUV = vWorldPosition.xz * 0.0005 * uCloudScale;
                
                // --- Layer 1: Base (Slow, Large Scale) ---
                vec2 uv1 = baseUV + uTime * uCloudSpeed * 0.1;
                float layer1 = texture2D(uCloudMap, uv1).r;
                
                // --- Layer 2: Mid (FBM Structural Detail) ---
                vec2 uv2 = baseUV * 2.5 + uTime * uCloudSpeed * 0.3;
                float layer2 = fbm(uv2 + layer1 * 0.5);
                
                // --- Layer 3: High (Fast, Wispy) ---
                vec2 uv3 = baseUV * 8.0 + uTime * uCloudSpeed * 1.5;
                float layer3 = noise(uv3) * 0.3;

                // Combine layers
                float finalNoise = (layer1 * 0.5 + layer2 * 0.4 + layer3 * 0.1);
                
                // Apply Coverage (threshold) and Density (softness)
                float cloudAlpha = smoothstep(1.0 - uCoverage, 1.0 - uCoverage + (1.0 - uDensity), finalNoise);
                
                // --- LIGHTING (Fake scattering) ---
                float sunDot = dot(vViewDir, uSunDir);
                
                // Mie scattering approximation (bright halo around sun)
                float mie = pow(max(0.0, sunDot), 8.0) * 2.0;
                
                // Diffuse lighting based on sun position
                float diffuse = clamp(uSunDir.y * 0.8 + 0.2, 0.4, 1.0);
                
                // Darken cloud bottom/shadows
                vec3 lightingColor = mix(uAmbientColor, uCloudColor * diffuse, cloudAlpha);
                lightingColor = mix(lightingColor, uSunGlowColor, mie * cloudAlpha);
                
                // Color blending
                vec3 finalColor = mix(uSkyColor, lightingColor, cloudAlpha);

                // Add vertical gradient for atmosphere depth (darker near horizon)
                float skyVertical = clamp(vViewDir.y * 2.0, 0.0, 1.0);
                finalColor *= mix(0.8, 1.2, skyVertical);

                // Horizon fade (fade clouds out as they approach the flat horizon)
                float horizonFade = smoothstep(-0.05, 0.15, vViewDir.y);
                
                gl_FragColor = vec4(finalColor, horizonFade);
            }
        `;

        this.geometry = new THREE.SphereGeometry(490, 32, 32); 

        this.material = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader,
            fragmentShader,
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false
        });

        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = -1;
        this.scene.add(this.mesh);
    }

    generateCloudTexture() {
        const size = 512;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Fill background
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, size, size);

        // Draw many soft white blobs to create a structural 'cloud map'
        for (let i = 0; i < 60; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const radius = 20 + Math.random() * 60;
            
            const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
            grad.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            
            ctx.fillStyle = grad;
            // Draw with wrapping to ensure tileability
            const draw = (ox, oy) => ctx.fillRect(x - radius + ox, y - radius + oy, radius * 2, radius * 2);
            draw(0, 0);
            draw(size, 0); draw(-size, 0);
            draw(0, size); draw(0, -size);
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.minFilter = THREE.LinearMipMapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        return tex;
    }

    update(time, playerPos, sunPos) {
        this.uniforms.uTime.value = time;
        if (playerPos) {
            this.mesh.position.set(playerPos.x, playerPos.y, playerPos.z);
        }
        if (sunPos) {
            this.uniforms.uSunDir.value.copy(sunPos).normalize();
        }

        // Sync with weather params from envParams
        if (this.envParams.weather) {
            this.uniforms.uCoverage.value = this.envParams.weather.coverage;
            this.uniforms.uDensity.value = this.envParams.weather.density;
            this.uniforms.uCloudScale.value = this.envParams.weather.cloudScale;
            this.uniforms.uCloudSpeed.value = this.envParams.weather.windSpeed;
        }
    }

    addToGui(gui) {
        const folder = gui.addFolder('☁️ AAA Clouds');
        const p = this.envParams.clouds;

        folder.addColor(p, 'skyColor').onChange(v => this.uniforms.uSkyColor.value.set(v));
        folder.addColor(p, 'cloudColor').onChange(v => this.uniforms.uCloudColor.value.set(v));
        folder.addColor(p, 'sunGlowColor').onChange(v => this.uniforms.uSunGlowColor.value.set(v));
        folder.addColor(p, 'ambientColor').onChange(v => this.uniforms.uAmbientColor.value.set(v));
    }
}
