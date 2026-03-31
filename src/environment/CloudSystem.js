import * as THREE from 'three';

const vertexShader = `
varying vec3 vWorldPos;

void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
uniform float uTime;
uniform vec3 uSunDir;
uniform float uCoverage;
uniform float uDensity;

uniform float uRotationSpeed;
uniform float uFreqScale;
uniform vec2 uWind;

varying vec3 vWorldPos;

// ---------------- NOISE ----------------
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float a = hash(i);
    float b = hash(i + vec2(1.0,0.0));
    float c = hash(i + vec2(0.0,1.0));
    float d = hash(i + vec2(1.0,1.0));

    return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for(int i=0;i<5;i++){
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}
// ---------------------------------------
void main() {
    // --------------------------------------
    // CAMERA-CENTERED SKY DIRECTION
    // --------------------------------------
    vec3 dir = normalize(vWorldPos - cameraPosition);

    // --------------------------------------
    // SPHERICAL SKY UV (CORRECT PROJECTION)
    // --------------------------------------
    float u = atan(dir.z, dir.x) / (2.0 * 3.1415926) + 0.5;
    float v = asin(dir.y) / 3.1415926 + 0.5;

    vec2 uv = vec2(u, v);

    // Scale cloud size
    uv *= uFreqScale * 50.0;

    // --------------------------------------
    // WIND MOVEMENT (FIXED DIRECTIONAL FLOW)
    // --------------------------------------
    vec2 windDir = normalize(uWind);

    vec2 animatedUV = uv + windDir * uTime * uRotationSpeed;

    // --------------------------------------
    // DISTORTION (BREAKS LINEAR MOTION)
    // --------------------------------------
    float distortionX = noise(uv * 0.2 + uTime * 0.05);
    float distortionY = noise(uv * 0.2 - uTime * 0.05);

    animatedUV += vec2(distortionX, distortionY) * 0.1;

    // --------------------------------------
    // CLOUD SHAPE
    // --------------------------------------
    float macro = noise(animatedUV * 0.5);
    float base = fbm(animatedUV * 2.5);
    float detail = fbm(animatedUV * 6.0);

    float cloudMask = macro * 0.5 + base * 0.5;
    cloudMask = mix(cloudMask, detail, 0.25);

    // --------------------------------------
    // HORIZON FADE (FIXED)
    // --------------------------------------
    float horizonFade = smoothstep(-0.2, 0.3, dir.y);
    cloudMask *= horizonFade;

    // --------------------------------------
    // COVERAGE + DENSITY
    // --------------------------------------
    float threshold = 1.1 - uCoverage;
    float alpha = smoothstep(threshold, threshold + 0.25, cloudMask);

    alpha *= uDensity;

    if(alpha < 0.01) discard;

    // --------------------------------------
    // LIGHTING
    // --------------------------------------
    vec3 lightDir = normalize(uSunDir);
    float sunAmount = max(dot(lightDir, dir), 0.0);

    vec3 bright = vec3(1.0, 0.95, 0.9);
    vec3 shadow = vec3(0.4, 0.5, 0.65);

    vec3 color = mix(shadow, bright, sunAmount);
    color *= mix(0.7, 1.2, cloudMask);

    gl_FragColor = vec4(color, alpha);
}
`;

export class CloudSystem {
    constructor(scene) {
        this.scene = scene;

        this.group = new THREE.Group();
        scene.add(this.group);

        this.layers = [];

        const radius = 15000;

        const layerConfigs = [
            { speed: 0.1, freq: 0.0001, density: 0.8 },
            { speed: 0.15, freq: 0.00015, density: 0.6 },
            { speed: 0.2, freq: 0.0002, density: 0.4 }
        ];

        for (let i = 0; i < layerConfigs.length; i++) {
            const config = layerConfigs[i];

            // SKY DOME (Sphere)
            const geo = new THREE.SphereGeometry(radius, 64, 32);

            const mat = new THREE.ShaderMaterial({
                vertexShader,
                fragmentShader,
                transparent: true,
                depthWrite: false,
                side: THREE.BackSide,
                uniforms: {
                    uTime: { value: 0 },
                    uSunDir: { value: new THREE.Vector3(1, 1, 1) },
                    uCoverage: { value: 0.55 },
                    uDensity: { value: config.density },
                    uRotationSpeed: { value: config.speed },
                    uFreqScale: { value: config.freq },
                    uWind: { value: new THREE.Vector2(1, 0.5) }
                }
            });

            const mesh = new THREE.Mesh(geo, mat);
            mesh.frustumCulled = false;
            mesh.renderOrder = 100 + i;

            this.group.add(mesh);

            this.layers.push({ mesh, mat, config });
        }
    }

    update(time, camera, sunDir = new THREE.Vector3(1, 1, 1)) {
        // Center the dome on the camera
        this.group.position.copy(camera.position);

        this.layers.forEach(layer => {
            layer.mat.uniforms.uTime.value = time;
            layer.mat.uniforms.uSunDir.value.copy(sunDir);
        });
    }

    updateParams(params, sunDir = null) {
        this.layers.forEach(layer => {
            layer.mat.uniforms.uCoverage.value = params.coverage;
            layer.mat.uniforms.uDensity.value = params.density * layer.config.density;
            layer.mat.uniforms.uRotationSpeed.value = params.speed * layer.config.speed * 10.0;

            // Set wind direction if available
            if (params.windX !== undefined && params.windY !== undefined) {
                layer.mat.uniforms.uWind.value.set(params.windX, params.windY);
            }

            if (sunDir) layer.mat.uniforms.uSunDir.value.copy(sunDir);
        });
    }
}
