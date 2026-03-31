import * as THREE from 'three';

const skyVertexShader = `
varying vec3 vLocalPosition;
varying vec3 vViewDir;

void main() {
    vLocalPosition = position;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vViewDir = normalize(worldPosition.xyz - cameraPosition);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const skyFragmentShader = `
uniform vec3 topColor;
uniform vec3 horizonColor;
uniform vec3 sunDirection;
uniform float sunIntensity;

varying vec3 vLocalPosition;
varying vec3 vViewDir;

void main() {
    vec3 viewDir = normalize(vViewDir);
    float h = normalize(vLocalPosition).y;
    
    // Gradient sky
    vec3 skyColor = mix(horizonColor, topColor, max(h, 0.0));
    
    // Simple sun disk
    float sunDot = dot(viewDir, sunDirection);
    float sunDisk = smoothstep(0.9995, 0.9998, sunDot);
    float sunGlow = pow(max(sunDot, 0.0), 32.0) * 0.5;
    
    vec3 finalColor = skyColor + (vec3(1.0, 0.9, 0.7) * sunDisk * sunIntensity * 10.0) + (vec3(1.0, 0.8, 0.5) * sunGlow * sunIntensity);
    
    gl_FragColor = vec4(finalColor, 1.0);
}
`;

export class SkySystem {
    constructor(scene) {
        this.scene = scene;
        const geo = new THREE.SphereGeometry(10000, 32, 32);
        this.mat = new THREE.ShaderMaterial({
            uniforms: {
                topColor: { value: new THREE.Color(0x0055ff) },
                horizonColor: { value: new THREE.Color(0x87ceeb) },
                sunDirection: { value: new THREE.Vector3(0, 1, 0) },
                sunIntensity: { value: 1.0 },
            },
            vertexShader: skyVertexShader,
            fragmentShader: skyFragmentShader,
            side: THREE.BackSide,
            depthWrite: false, // Sky is always at the back
        });

        this.mesh = new THREE.Mesh(geo, this.mat);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = -1000;
        this.mat.depthTest = false;
        this.scene.add(this.mesh);
    }

    updateParams(params, sunDirection) {
        this.mat.uniforms.topColor.value.set(params.skyColorTop);
        this.mat.uniforms.horizonColor.value.set(params.skyColorHorizon);
        this.mat.uniforms.sunIntensity.value = params.sunIntensity;
        this.mat.uniforms.sunDirection.value.copy(sunDirection);
    }

    update(camera) {
        this.mesh.position.copy(camera.position);
    }
}
