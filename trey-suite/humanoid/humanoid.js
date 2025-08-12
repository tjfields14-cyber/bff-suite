import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const micBtn = document.getElementById("micBtn");
const logEl  = document.getElementById("log");

function log(s){ logEl.textContent = s; }

let scene, camera, renderer, cube, analyser, dataArray;
let prev = performance.now();

init(); animate();

function init(){
  scene = new THREE.Scene();
  scene.background = new THREE.Color("#0b0b0c");
  camera = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 100);
  camera.position.set(0, 0.8, 2.2);

  renderer = new THREE.WebGLRenderer({ antialias:true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);

  const amb = new THREE.AmbientLight(0xffffff, 0.7); scene.add(amb);
  const dir = new THREE.DirectionalLight(0xffffff, 1.0); dir.position.set(1,2,1); scene.add(dir);

  const geo = new THREE.BoxGeometry(0.6,0.6,0.6);
  const mat = new THREE.MeshStandardMaterial({ color:0x8bb3ff, roughness:0.35, metalness:0.05 });
  cube = new THREE.Mesh(geo, mat); scene.add(cube);

  window.addEventListener("resize", onResize);
  micBtn.addEventListener("click", enableMic);

  log("Ready. You should see a rotating cube. Click 🎤 to visualize mic input.");
}

function onResize(){
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

async function enableMic(){
  try{
    const stream = await navigator.mediaDevices.getUserMedia({audio:true});
    const ac = new (window.AudioContext||window.webkitAudioContext)();
    const src = ac.createMediaStreamSource(stream);
    analyser = ac.createAnalyser();
    analyser.fftSize = 2048;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    src.connect(analyser);
    micBtn.textContent = "🎤 Mic On";
    log("Mic enabled. Talk—cube will pulse with volume.");
  }catch(e){
    log("Mic permission denied.");
  }
}

function amplitude(){
  if(!analyser||!dataArray) return 0;
  analyser.getByteTimeDomainData(dataArray);
  let sum=0;
  for (let i=0;i<dataArray.length;i++){ const v=(dataArray[i]-128)/128; sum += v*v; }
  return Math.sqrt(sum/dataArray.length); // 0..~0.5
}

function animate(now=performance.now()){
  requestAnimationFrame(animate);
  const dt = (now - prev)/1000; prev = now;

  // rotate
  cube.rotation.y += dt * 0.8;
  cube.rotation.x += dt * 0.35;

  // pulse on mic volume
  const a = amplitude();
  const s = 1 + Math.min(0.6, a*3);
  cube.scale.set(s, s, s);

  renderer.render(scene, camera);
}
