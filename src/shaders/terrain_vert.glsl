varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying float vElevation;

uniform float uTime;

void main() {
  vUv = uv;
  
  // World space position is crucial for procedural mapping
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPosition.xyz;
  
  // Normals for lighting
  vNormal = normalize(normalMatrix * normal);
  
  vElevation = position.y;

  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}