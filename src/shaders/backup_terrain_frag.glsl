uniform sampler2D grassTex;
uniform sampler2D dirtTex;
uniform sampler2D rockTex;

varying float vHeight;
varying vec3 vNormal;
varying vec2 vUv;

void main(){

  vec2 uv = vUv * 10.0;

  vec3 grass = texture2D(grassTex, uv).rgb;
  vec3 dirt  = texture2D(dirtTex, uv).rgb;
  vec3 rock  = texture2D(rockTex, uv).rgb;

  float slope = 1.0 - vNormal.y;

  vec3 color;

  if(vHeight < 0.5){
    color = grass;
  }
  else if(vHeight < 2.0){
    color = mix(grass, dirt, (vHeight - 0.5) / 1.5);
  }
  else{
    color = mix(dirt, rock, (vHeight - 2.0) / 1.5);
  }

  if(slope > 0.5){
    color = mix(color, rock, slope);
  }

  gl_FragColor = vec4(color, 1.0);
}