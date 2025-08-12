import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js";

const logEl = document.getElementById("log");
const aiBadge = document.getElementById("aiBadge");
const micBtn = document.getElementById("micBtn");
const ttsBtn = document.getElementById("ttsBtn");

function log(s){ logEl.textContent = s; }
function ls(k,d){ try{ const v=localStorage.getItem(k); return v===null?d:v }catch{ return d } }
function parseJSON(t){ try{return JSON.parse(t)}catch{return null} }

let scene, camera, renderer, controls;
let skinned=null, morphMap={}, jaw=null;
let analyser=null, dataArray=null;
let ttsUtter=null;

init();
animate();

async function init(){
  scene = new THREE.Scene();
  scene.background = new THREE.Color("#0b0b0c");

  camera = new THREE.PerspectiveCamera(35, innerWidth/innerHeight, 0.01, 100);
  camera.position.set(0, 1.2, 2.1);

  renderer = new THREE.WebGLRenderer({antialias:true,alpha:false});
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0,1.2,0);
  controls.enableDamping = true;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x0b0b0c, 0.6);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(1.5, 2.8, 1.6);
  key.castShadow = false;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88bbff, 0.6);
  rim.position.set(-2.0, 1.8, -1.5);
  scene.add(rim);

  // try load humanoid.glb from assets/
  const url = new URL("../assets/humanoid.glb", import.meta.url).href;
  try {
    await loadGLB(url);
  } catch {
    fallbackHead();
  }

  window.addEventListener("resize", onResize);
  micBtn.addEventListener("click", enableMic);
  ttsBtn.addEventListener("click", sayHello);

  // show AI badge if profile says synthetic
  const prof = parseJSON(ls("bff_profile_json",""));
  const p = prof?.personas?.[0] || null;
  const isAI = !!(p?.synthetic_media || /(_|-)ai\./i.test(p?.avatar||""));
  aiBadge.style.display = isAI ? "inline-block" : "none";
}

function onResize(){
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

async function loadGLB(src){
  return new Promise((resolve,reject)=>{
    new GLTFLoader().load(src,(g)=>{
      const root = g.scene || g.scenes[0];
      root.traverse(o=>{
        if (o.isMesh){ o.frustumCulled = false; o.castShadow=false; o.receiveShadow=true; }
        if (o.isSkinnedMesh){
          skinned = o;
          // map a few common viseme names (ARKit/OVR variants)
          if (o.morphTargetDictionary){
            const dict = o.morphTargetDictionary;
            const mapNames = ["jawOpen","MouthOpen","viseme_aa","vowels_Open","A","aa"];
            for (const n of mapNames){ if (n in dict){ morphMap.open = dict[n]; break; } }
          }
        }
        if (/jaw/i.test(o.name)) jaw = o; // optional jaw bone
      });
      // frame
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3()).length();
      const center = box.getCenter(new THREE.Vector3());
      controls.target.copy(center);
      const dist = size*0.9;
      camera.position.set(center.x, center.y+size*0.2, center.z + dist);
      scene.add(root);
      resolve();
    },undefined,(e)=>reject(e));
  });
}

function fallbackHead(){
  const head = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.25,3),
    new THREE.MeshStandardMaterial({color:0x8891ff, roughness:0.35, metalness:0.05})
  );
  head.position.set(0,1.6,0);
  scene.add(head);
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
    log("Mic enabled. Speak to see lip movement.");
  }catch(e){
    log("Mic permission denied.");
  }
}

function amplitude(){
  if(!analyser||!dataArray) return 0;
  analyser.getByteTimeDomainData(dataArray);
  // simple RMS
  let sum=0;
  for(let i=0;i<dataArray.length;i++){
    const v=(dataArray[i]-128)/128;
    sum+=v*v;
  }
  return Math.sqrt(sum/dataArray.length);
}

function driveLipFlap(dt){
  const amp = amplitude(); // 0..~0.5
  const open = Math.min(1, amp*6); // scale
  if (skinned && morphMap.open !== undefined){
    skinned.morphTargetInfluences[morphMap.open] = open;
  }
  if (jaw){
    jaw.rotation.x = THREE.MathUtils.lerp(jaw.rotation.x, open*0.25, 0.35);
  }
}

function sayHello(){
  const u = new SpeechSynthesisUtterance("Hey, I'm ready. Once visemes are wired, lip sync will match speech.");
  u.rate = 0.95; u.pitch = 1.0;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}

let prev=performance.now();
function animate(now=performance.now()){
  requestAnimationFrame(animate);
  const dt = (now-prev)/1000; prev=now;
  controls.update();
  driveLipFlap(dt);
  renderer.render(scene,camera);
}
