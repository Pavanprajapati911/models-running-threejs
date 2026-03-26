attribute float aRandom;

varying float vRandom;
varying float vElevation;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPos;

uniform vec2 uFrequency;
uniform float uTime;

void main() {
  vUv = uv;

  vec4 modelPosition = modelMatrix * vec4(position, 1.0);

  float elevation = sin(position.x * uFrequency.x + uTime) * 0.2;
  elevation += sin(position.z * uFrequency.y + uTime) * 0.2;


  vElevation = elevation;
  vRandom = aRandom;

  vWorldPos = modelPosition.xyz;
  vNormal = normalize(normalMatrix * normal);

  vec4 viewPosition = viewMatrix * modelPosition;
  gl_Position = projectionMatrix * viewPosition;
}