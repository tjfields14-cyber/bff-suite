import {
  WebGLRenderer, Scene, PerspectiveCamera, AmbientLight, DirectionalLight,
  BoxGeometry, MeshStandardMaterial, Mesh, Color
} from "https://unpkg.com/three@0.160.0/build/three.module.js";

const status = document.getElementById("status");
status.style.display = "inline-block"; // prove JS ran

const canvas   = document.getElementById("c");
const renderer = new WebGLRenderer({canvas, antialias:true});
const scene    = new Scene(); scene.background = new Color("#0b0b0c");
const camera   = new PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 100);
camera.position.set(0,0.8,2.2);
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setSize(innerWidth, innerHeight);

addEventListener("resize", ()=>{
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

scene.add(new AmbientLight(0xffffff,0.7));
const dir = new DirectionalLight(0xffffff,1.0); dir.position.set(1,2,1); scene.add(dir);

const mat  = new MeshStandardMaterial({color:0x8bb3ff, roughness:0.35, metalness:0.05});
const cube = new Mesh(new BoxGeometry(0.6,0.6,0.6), mat);
scene.add(cube);

document.getElementById("ping").onclick  = ()=>{ status.textContent="JS click ✓"; };
document.getElementById("color").onclick = ()=>{ mat.color.offsetHSL(0.2,0,0); };

let t=0;
function loop(now){
  requestAnimationFrame(loop);
  const dt = (now-(t||now))/1000; t=now;
  cube.rotation.y += dt*0.8; cube.rotation.x += dt*0.35;
  renderer.render(scene,camera);
}
requestAnimationFrame(loop);
