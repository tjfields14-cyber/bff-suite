import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js";

const micBtn   = document.getElementById("micBtn");
const ttsBtn   = document.getElementById("ttsBtn");
const debugBtn = document.getElementById("debugBtn");
const testBtn  = document.getElementById("testBtn");
const errBtn   = document.getElementById("errBtn");
const logEl    = document.getElementById("log");

let lastError = null;
function log(msg){ logEl.textContent = (logEl.textContent ? logEl.textContent + "\n" : "") + msg; }
function trap(fn){ return (...a)=>{ try{ return fn(...a);} catch(e){ lastError=e; log("❌ "+e.message); console.error(e);} } }

let scene, camera, renderer, controls;
let skinned=null, morphMap={}, jaw=null, fallback=null;
let analyser=null, dataArray=null, testOpen=0;

const urlGLB = new URL("../assets/humanoid.glb", import.meta.url).href;

init().then(()=>animate()).catch(e=>{ lastError=e; log("❌ init failed: "+e.message); });

async function init(){
  log("✓ Three.js starting");
  scene = new THREE.Scene();
  scene.background = new THREE.Color("#0b0b0c");

  camera = new THREE.PerspectiveCamera(35, innerWidth/innerHeight, 0.01, 100);
  camera.position.set(0, 1.2, 2.1);

  renderer = new THREE.WebGLRenderer({antialias:true});
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0,1.2,0); controls.enableDamping=true;

  // lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x0b0b0c, 0.6); scene.add(hemi);
  const key  = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(1.5,2.8,1.6); scene.add(key);
  const rim  = new THREE.DirectionalLight(0x88bbff, 0.6); rim.position.set(-2.0,1.8,-1.5); scene.add(rim);

  // ALWAYS add fallback first so you see something
  fallback = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.25,3),
    new THREE.MeshStandardMaterial({color:0x8891ff, roughness:0.35, metalness:0.05})
  );
  fallback.position.set(0,1.6,0);
  scene.add(fallback);
  log("✓ Fallback head visible");

  // try to load model in the background
  try{
    await loadGLB(urlGLB);
    scene.remove(fallback);
    log("✓ Model loaded, fallback removed. Click 🎤 and speak or 🧪 to test.");
  }catch(e){
    lastError=e; log("ℹ No GLB model found (or load failed). Staying on fallback.");
    console.warn(e);
  }

  micBtn .addEventListener("click", trap(enableMic));
  ttsBtn .addEventListener("click", ()=>{ const u=new SpeechSynthesisUtterance("Hi, debug build ready."); speechSynthesis.cancel(); speechSynthesis.speak(u); });
  debugBtn.addEventListener("click", trap(showMorphDebug));
  testBtn .addEventListener("click", ()=>{ testOpen=1; setTimeout(()=>testOpen=0, 800); });
  errBtn .addEventListener("click", ()=> alert(lastError ? (lastError.stack||lastError.message) : "No errors recorded"));

  window.addEventListener("resize", trap(onResize));
}

function onResize(){
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

async function loadGLB(src){
  log("… loading GLB: "+src);
  return new Promise((resolve,reject)=>{
    new GLTFLoader().load(src,(g)=>{
      const root = g.scene || g.scenes[0];
      root.traverse(o=>{
        if (o.isMesh){ o.frustumCulled=false; o.castShadow=false; o.receiveShadow=true; }
        if (o.isSkinnedMesh){
          skinned = o;
          const dict = o.morphTargetDictionary || {};
          const prefer = ["jawOpen","MouthOpen","viseme_aa","A","aa","vowels_Open","mouthOpen"];
          for (const n of prefer){ if (n in dict){ morphMap.open = dict[n]; break; } }
          if (morphMap.open===undefined){
            const keys = Object.keys(dict);
            const cand = keys.find(k=>/jaw|open|aa|mouth/i.test(k));
            if (cand) morphMap.open = dict[cand];
          }
        }
        if (!jaw && /jaw/i.test(o.name)) jaw = o;
      });

      // frame
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3()).length();
      const center = box.getCenter(new THREE.Vector3());
      controls.target.copy(center);
      const dist = size*0.9;
      camera.position.set(center.x, center.y+size*0.2, center.z+dist);

      scene.add(root);
      resolve();
    }, undefined, (e)=>reject(e));
  });
}

async function enableMic(){
  log("… requesting mic");
  const stream = await navigator.mediaDevices.getUserMedia({audio:true});
  const ac = new (window.AudioContext||window.webkitAudioContext)();
  const src = ac.createMediaStreamSource(stream);
  analyser = ac.createAnalyser();
  analyser.fftSize = 2048;
  dataArray = new Uint8Array(analyser.frequencyBinCount);
  src.connect(analyser);
  log("✓ Mic enabled. Speak (or press 🧪).");
}

function amplitude(){
  if(!analyser||!dataArray) return 0;
  analyser.getByteTimeDomainData(dataArray);
  let sum=0; for(let i=0;i<dataArray.length;i++){ const v=(dataArray[i]-128)/128; sum+=v*v; }
  return Math.sqrt(sum/dataArray.length);
}

function driveMouth(){
  const micOpen = Math.min(1, amplitude()*6);
  const open = Math.max(testOpen, micOpen);
  if (skinned && morphMap.open !== undefined){
    skinned.morphTargetInfluences[morphMap.open] = open;
  }
  if (jaw){
    jaw.rotation.x = THREE.MathUtils.lerp(jaw.rotation.x, open*0.25, 0.35);
  }
  // tiny idle motion so we see life even without mic/model
  if (fallback){
    fallback.rotation.y += 0.01;
    fallback.scale.setScalar(1 + open*0.2);
  }
}

let prev=performance.now();
function animate(now=performance.now()){
  requestAnimationFrame(animate);
  const dt=(now-prev)/1000; prev=now;
  try{
    controls.update();
    driveMouth();
    renderer.render(scene,camera);
  }catch(e){
    lastError=e; log("❌ render failed: "+e.message);
  }
}
