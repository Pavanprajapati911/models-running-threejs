precision mediump float;

varying float vRandom;
varying float vElevation;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPos;

uniform sampler2D mossyGrassTex;
uniform sampler2D wildGrassTex;
uniform sampler2D forestFloorTex;
uniform sampler2D soilGroundTex;
uniform sampler2D dirtGroundTex;
uniform sampler2D forestPathTex;
uniform sampler2D rockTex;

uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uCameraPos;

uniform float uTextureScale;
uniform float uLightingIntensity;
uniform float uSpecularStrength;
uniform float uTime;

uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uFogColor;

uniform float uGrassStrength;
uniform float uDirtStrength;
uniform float uPathStrength;

// Simple noise function
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0);
    for (int i = 0; i < 4; ++i) {
        v += a * noise(p);
        p = p * 2.0 + shift;
        a *= 0.5;
    }
    return v;
}

void main() {
  vec3 normal = normalize(vNormal);
  vec2 uvScaled = vUv * uTextureScale;

  // ---------------- NOISE FACTORS ----------------
  
  // Large scale biome noise (Jungle vs Open)
  float biomeNoise = fbm(vWorldPos.xz * 0.01);
  float jungleFactor = smoothstep(0.4, 0.6, biomeNoise);
  
  // Path noise (Worn paths)
  float pathNoise = fbm(vWorldPos.xz * 0.05 + 50.0);
  float pathFactor = smoothstep(0.65, 0.75, pathNoise);
  
  // Local variation noise
  float varNoise = fbm(vWorldPos.xz * 0.1 + 100.0);

  // ---------------- TEXTURES ----------------
  
  vec3 mossyGrass = texture2D(mossyGrassTex, uvScaled).rgb;
  vec3 wildGrass = texture2D(wildGrassTex, uvScaled).rgb;
  vec3 forestFloor = texture2D(forestFloorTex, uvScaled).rgb;
  vec3 soilGround = texture2D(soilGroundTex, uvScaled).rgb;
  vec3 dirtGround = texture2D(dirtGroundTex, uvScaled).rgb;
  vec3 forestPath = texture2D(forestPathTex, uvScaled).rgb;
  vec3 rock = texture2D(rockTex, uvScaled).rgb;

  // ---------------- BLENDING LOGIC ----------------
  
  // 1. Base Layer: Blend mossy and wild grass
  vec3 grassLayer = mix(mossyGrass, wildGrass, varNoise) * uGrassStrength;
  
  // 2. Jungle Layer: Use forest floor under dense vegetation
  vec3 vegetationLayer = mix(grassLayer, forestFloor * uGrassStrength, jungleFactor * 0.8);
  
  // 3. Path Layer: Blend soil and dirt
  vec3 pathLayer = mix(soilGround, dirtGround, varNoise) * uDirtStrength;
  // Add some forest_path texture to paths
  pathLayer = mix(pathLayer, forestPath * uPathStrength, smoothstep(0.4, 0.6, varNoise));
  
  // 4. Combine vegetation and paths
  vec3 terrainColor = mix(vegetationLayer, pathLayer, pathFactor);
  
  // 5. Slope Layer: Rock on steep slopes
  float slope = 1.0 - normal.y;
  float rockSlopeFactor = smoothstep(0.4, 0.7, slope);
  terrainColor = mix(terrainColor, rock, rockSlopeFactor);

  // Darken under jungle
  terrainColor *= mix(1.0, 0.7, jungleFactor * 0.5);

  // ---------------- LIGHTING ----------------
  vec3 lightDir = normalize(uLightDir);
  float diff = max(dot(normal, lightDir), 0.0);
  
  vec3 viewDir = normalize(uCameraPos - vWorldPos);
  vec3 halfDir = normalize(lightDir + viewDir);
  float spec = pow(max(dot(normal, halfDir), 0.0), 32.0);

  // ---------------- FINAL COLOR ----------------
  vec3 ambient = terrainColor * 0.3;
  vec3 diffuse = terrainColor * diff * uLightColor * uLightingIntensity;
  vec3 specular = spec * vec3(1.0) * uSpecularStrength;

  vec3 finalColor = diffuse + ambient + specular;

  // ---------------- FOG ----------------
  float dist = length(uCameraPos - vWorldPos);
  float fogFactor = smoothstep(uFogNear, uFogFar, dist);
  gl_FragColor = vec4(mix(finalColor, uFogColor, fogFactor), 1.0);
}
 