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

uniform bool uShowBiomeDebug;
uniform float uDryThreshold;
uniform float uGrassThreshold;
uniform float uForestThreshold;
uniform float uBiomeScale;
uniform float uGlobalSeed;

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
    for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 lightDir = normalize(uLightDir);
  
  float diff = max(dot(normal, lightDir), 0.0);
  vec3 viewDir = normalize(uCameraPos - vWorldPos);
  vec3 reflectDir = reflect(-lightDir, normal);
  float spec = pow(max(dot(viewDir, reflectDir), 0.0), 32.0) * uSpecularStrength;

  // 1. Calculate Biome Factor
  vec2 biomeUV = (vWorldPos.xz + vec2(uGlobalSeed)) * uBiomeScale;
  float biomeVal = fbm(biomeUV);
  
  // 2. Sample Textures (normalized per texScale)
  vec2 uv = vWorldPos.xz * uTextureScale * 0.01;
  vec3 mossyGrass = texture2D(mossyGrassTex, uv).rgb;
  vec3 wildGrass = texture2D(wildGrassTex, uv).rgb;
  vec3 forestFloor = texture2D(forestFloorTex, uv).rgb;
  vec3 soilGround = texture2D(soilGroundTex, uv).rgb;
  vec3 dirtGround = texture2D(dirtGroundTex, uv).rgb;
  vec3 forestPath = texture2D(forestPathTex, uv).rgb;
  vec3 rockTexSample = texture2D(rockTex, uv).rgb;

  // 3. Path Factor
  float pathVal = fbm((vWorldPos.xz + vec2(uGlobalSeed * 2.0)) * 0.05);
  float pathFactor = smoothstep(0.45, 0.55, pathVal);
  
  // 4. Variation Noise
  float varNoise = fbm(vWorldPos.xz * 0.1);

  // ---------------- BIOME-DRIVEN BLENDING ----------------
  vec3 terrainColor;
  vec3 debugColor;

  if (biomeVal < uDryThreshold) {
      // DRY BIOME
      terrainColor = mix(soilGround, dirtGround, varNoise) * uDirtStrength;
      debugColor = vec3(0.5, 0.35, 0.1); // Brownish
  } else if (biomeVal < uGrassThreshold) {
      // GRASSLAND BIOME
      terrainColor = wildGrass * uGrassStrength;
      debugColor = vec3(0.4, 0.8, 0.2); // Light Green
  } else if (biomeVal < uForestThreshold) {
      // FOREST BIOME
      terrainColor = mix(forestFloor, dirtGround, varNoise) * uGrassStrength;
      debugColor = vec3(0.1, 0.3, 0.1); // Dark Green
  } else {
      // JUNGLE BIOME
      terrainColor = mix(mossyGrass, forestFloor, varNoise) * uGrassStrength;
      debugColor = vec3(0.0, 0.6, 0.0); // Jungle Green
  }

  // Apply paths globally
  terrainColor = mix(terrainColor, mix(soilGround, forestPath, varNoise) * uPathStrength, pathFactor);

  // Rock on steep slopes
  float slope = 1.0 - normal.y;
  float rockFactor = smoothstep(0.4, 0.7, slope);
  terrainColor = mix(terrainColor, rockTexSample, rockFactor);

  // 5. Final Shadowing/Lighting
  vec3 finalColor = terrainColor * (diff * uLightingIntensity + 0.3) + spec;
  
  // Apply debug mode
  if (uShowBiomeDebug) {
      finalColor = mix(finalColor, debugColor, 0.7);
  }

  // Fog
  float dist = distance(uCameraPos, vWorldPos);
  float fogFactor = smoothstep(uFogNear, uFogFar, dist);
  finalColor = mix(finalColor, uFogColor, fogFactor);

  gl_FragColor = vec4(finalColor, 1.0);
}
 