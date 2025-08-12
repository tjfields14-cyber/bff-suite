import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js";

const logEl = document.getElementById("log");
const aiBadge = document.getElementById("aiBadge");
const micBtn = document.getElementById("micBtn");
const ttsBtn = document.getElementById("ttsBtn");
const debugBtn = document.getElementById("debugBtn");
const testBtn  = document.getElementById("testBtn");

function log(s){ logEl.textContent = s; }
function ls(k,d){ try{ const v=localStorage.getItem(k); return v===null?d:v }catch{ return d } }
function parseJSON(t){ try{return JSON.parse(t)}catch{return null} }

let scene, camera, renderer, controls;
let skinned=null, morphMap={}, jaw=null;
let analyser=null, dataArray=null;
let testOpen=0; // manual tester (0..1)

init().then(()=>animate());

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

  const hemi = new THREE.HemisphereLight(0xffffff, 0x0b0b0c, 0.6); scene.add(hemi);
  const key  = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(1.5, 2.8, 1.6); scene.add(key);
  const rim  = new THREE.DirectionalLight(0x88bbff, 0.6); rim.position.set(-2.0, 1.8, -1.5); scene.add(rim);

  const url = new URL("../assets/humanoid.glb", import.meta.url).href;
  try {
    await loadGLB(url);
    log("Model loaded. 🎤 Mic drives mouth; 🔎 shows morphs; 🧪 tests mouth-open.");
  } catch {
    fallbackHead();
    log("No model found. Using fallback head. Buttons still work (debug shows none).");
  }

  window.addEventListener("resize", onResize);
  micBtn.addEventListener("click", enableMic);
  ttsBtn.addEventListener("click", sayHello);
  debugBtn.addEventListener("click", showMorphDebug);
  testBtn.addEventListener("click", ()=>{ testOpen = 1; setTimeout(()=>testOpen=0, 900); });

  const prof = parseJSON(ls("bff_profile_json",""));
  const p = prof?.personas?.[0] || null;
  const isAI = !!(p?.synthetic_media || /(_|-)ai\\./i.test(p?.avatar||""));
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
        if (o.isMesh){ o.frustumCulled=false; o.castShadow=false; o.receiveShadow=true; }
        if (o.isSkinnedMesh){
          skinned = o;
          if (o.morphTargetDictionary){
            const dict = o.morphTargetDictionary;
            // prefer common mouth-open morph names
            const preferred = ["jawOpen","MouthOpen","viseme_aa","A","aa","vowels_Open","mouthOpen"];
            for (const n of preferred){ if (n in dict){ morphMap.open = dict[n]; break; } }
            // if still not set, try fuzzy match
            if (morphMap.open === undefined){
              const keys = Object.keys(dict);
              const cand = keys.find(k=>/jaw|open|aa|mouth/i.test(k));
              if (cand) morphMap.open = dict[cand];
            }
          }
        }
        if (!jaw && /jaw/i.test(o.name)) jaw = o; // optional bone
      });

      // frame model
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
    log("Mic enabled. Speak to see mouth movement (or click 🧪 to test).");
  }catch(e){
    log("Mic permission denied.");
  }
}

function amplitude(){
  if(!analyser||!dataArray) return 0;
  analyser.getByteTimeDomainData(dataArray);
  let sum=0; for(let i=0;i<dataArray.length;i++){ const v=(dataArray[i]-128)/128; sum += v*v; }
  return Math.sqrt(sum/dataArray.length); // 0..~0.5
}

function driveLipFlap(){
  const amp = amplitude();                // 0..~0.5
  const micOpen = Math.min(1, amp*6);     // scale
  const open = Math.max(testOpen, micOpen);
  if (skinned && morphMap.open !== undefined){
    skinned.morphTargetInfluences[morphMap.open] = open;
  }
  if (jaw){
    jaw.rotation.x = THREE.MathUtils.lerp(jaw.rotation.x, open*0.25, 0.35);
  }
}

function sayHello(){
  const u = new SpeechSynthesisUtterance("Debug is live. We will map visemes next.");
  u.rate=0.95; u.pitch=1.0; speechSynthesis.cancel(); speechSynthesis.speak(u);
}

function collectMorphs(){
  const skins=[]; const jaws=[];
  scene.traverse(o=>{
    if (o.isSkinnedMesh && o.morphTargetDictionary){
      skins.push({ name:o.name, dict:o.morphTargetDictionary });
    }
    if (/jaw/i.test(o.name)) jaws.push(o.name);
  });
  return { skins, jaws, chosenOpen: morphMap.open };
}

function showMorphDebug(){
  const c = collectMorphs();
  let out = "Morph Debug\n===========\n";
  if (c.skins.length===0) out += "- No SkinnedMesh with morph targets found.\n";
  for (const s of c.skins){
    out += `Mesh: ${s.name}\n`;
    const keys = Object.keys(s.dict).sort((a,b)=>a.localeCompare(b));
    for (const k of keys){
      const mark = (s.dict[k]===c.chosenOpen) ? "  (chosen: open)" : "";
      out += `  - ${k}${mark}\n`;
    }
  }
  out += `Jaw bones: ${c.jaws.length?c.jaws.join(", "):"none"}\n`;
  if (c.chosenOpen===undefined) out += "Note: No 'open' morph chosen; jaw bone will be used if present.\n";
  log(out);
  try{ console.clear(); console.log("MorphDebug:", c); }catch{}
}

let prev=performance.now();
function animate(now=performance.now()){
  requestAnimationFrame(animate);
  const dt = (now-prev)/1000; prev=now;
  controls.update();
  driveLipFlap();
  renderer.render(scene,camera);
}
