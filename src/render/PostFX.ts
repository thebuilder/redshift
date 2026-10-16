import * as THREE from 'three';
import { QUALITY } from '../core/Device';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberration: { value: 0.0015 },
    uVignette: { value: 1.0 },
    uFlash: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uSpeed: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uAberration; uniform float uVignette; uniform float uFlash; uniform vec2 uRes; uniform float uSpeed;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c,c);
      vec2 off = c * (uAberration + uSpeed * 0.004) * (0.4 + r2 * 3.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      // radial speed blur
      if (uSpeed > 0.01) {
        vec3 acc = vec3(0.0);
        for (int i = 1; i <= 6; i++) {
          float k = float(i) / 6.0;
          acc += texture2D(tDiffuse, vUv - c * k * 0.035 * uSpeed).rgb;
        }
        col = mix(col, acc / 6.0, clamp(r2 * 3.5, 0.0, 1.0) * uSpeed);
      }
      float vig = smoothstep(0.85, 0.15, r2 * 1.6 * uVignette);
      col *= mix(0.35, 1.0, vig);
      col += uFlash * vec3(1.0, 0.25, 0.25);
      float g = hash(vUv * uRes + fract(uTime) * 100.0) - 0.5;
      col += g * 0.025;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class PostFX {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  grade: ShaderPass;
  scrub!: ShaderPass;
  private renderPass: RenderPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: QUALITY.msaa });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    // scrub NaN/inf and clamp fireflies before bloom
    this.scrub = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2(1 / Math.max(1, size.x * pr), 1 / Math.max(1, size.y * pr)) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uTexel; varying vec2 vUv;
        bool bad(vec4 c){ return any(isnan(c)) || any(isinf(c)) || c.r < -0.001 || c.g < -0.001 || c.b < -0.001; }
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          if (bad(c)) {
            // fill an invalid pixel from its valid neighbours instead of leaving a black dot
            vec4 acc = vec4(0.0); float n = 0.0;
            for (int k = 0; k < 8; k++) {
              vec2 o = k == 0 ? vec2(1,0) : k == 1 ? vec2(-1,0) : k == 2 ? vec2(0,1) : k == 3 ? vec2(0,-1) : k == 4 ? vec2(2,0) : k == 5 ? vec2(-2,0) : k == 6 ? vec2(0,2) : vec2(0,-2);
              vec4 s = texture2D(tDiffuse, vUv + o * uTexel);
              if (!bad(s)) { acc += s; n += 1.0; }
            }
            c = n > 0.0 ? acc / n : vec4(0.0, 0.0, 0.0, 1.0);
          }
          gl_FragColor = vec4(clamp(c.rgb, 0.0, 48.0), clamp(c.a, 0.0, 1.0)); }`,
    });
    this.composer.addPass(this.scrub);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.45, 1.0);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  setCamera(cam: THREE.Camera) {
    this.renderPass.camera = cam;
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    (this.grade.uniforms.uRes.value as THREE.Vector2).set(w, h);
    const pr = (this.composer as any).renderer?.getPixelRatio?.() ?? 1;
    (this.scrub.uniforms.uTexel.value as THREE.Vector2).set(1 / (w * pr), 1 / (h * pr));
  }

  render(t: number) {
    this.grade.uniforms.uTime.value = t;
    this.composer.render();
  }
}
