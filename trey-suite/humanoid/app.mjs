import {
  WebGLRenderer, Scene, PerspectiveCamera, AmbientLight, DirectionalLight,
  Color, BoxGeometry, MeshStandardMaterial, Mesh
} from "https://unpkg.com/three@0.160.0/build/three.module.js";

const logEl = document.getElementById("log");
function log(s){ logEl.textContent = (logEl.textContent?logEl.textContent+"\n":"")+s; }
log("🚀 app.mjs start");

const canvas = document.getElementById("c");
const renderer = new WebGLRenderer({canvas, antialias:true});
const scene = new Scene(); scene.background = new Color("#0b0b0c");
const camera = new PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 100);
camera.position.set(0,0.8,2.2);
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setSize(innerWidth, innerHeight);
addEventListener("resize", ()=>{ camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

scene.add(new AmbientLight(0xffffff,0.7));
const dir = new DirectionalLight(0xffffff,1.0); dir.position.set(1,2,1); scene.add(dir);

const mat  = new MeshStandardMaterial({color:0x8bb3ff, roughness:0.35, metalness:0.05});
const cube = new Mesh(new BoxGeometry(0.6,0.6,0.6), mat); scene.add(cube);

document.getElementById("micBtn").onclick   = ()=> log("🎤 Mic (stub) — will wire after render ok");
document.getElementById("ttsBtn").onclick   = ()=> { const u=new SpeechSynthesisUtterance("App is live."); speechSynthesis.cancel(); speechSynthesis.speak(u); };
document.getElementById("debugBtn").onclick = ()=> log("🔎 Debug (stub)");
document.getElementById("testBtn").onclick  = ()=> { mat.color.offsetHSL(0.2,0,0); log("🧪 Color toggled"); };

let t=0; requestAnimationFrame(function loop(now){
  requestAnimationFrame(loop);
  const dt=(now-(t||now))/1000; t=now;
  cube.rotation.y += dt*0.8; cube.rotation.x += dt*0.35;
  renderer.render(scene,camera);
});
log("✅ render loop running");
