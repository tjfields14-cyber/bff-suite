import {
  WebGLRenderer, Scene, PerspectiveCamera, AmbientLight, DirectionalLight,
  Color, IcosahedronGeometry, MeshStandardMaterial, Mesh, Box3, Vector3, MathUtils
} from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { GLTFLoader }   from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls }from "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js";

const logEl   = document.getElementById("log");
const micBtn  = document.getElementById("micBtn");
const ttsBtn  = document.getElementById("ttsBtn");
const debugBtn= document.getElementById("debugBtn");
const testBtn = document.getElementById("testBtn");

function log(s){ logEl.textContent = (logEl.textContent ? logEl.textContent + "\n" : "") + s; }

const urlGLB = new URL("../assets/humanoid.glb", import.meta.url).href;

let scene, camera, renderer, controls;
let skinned=null, morphMap={}, jaw=null, fallback=null;
let analyser=null, dataArray=null, testOpen=0;

init().then(()=>animate()).catch(e=>log("❌ init failed: "+e.message));

async function init(){
  log("✓ Three.js starting");

  const canvas = document.getElementById("c");
  renderer = new WebGLRenderer({canvas, antialias:true});
  scene = new Scene(); scene.background = new Color("#0b0b0c");
  camera = new PerspectiveCamera(35, innerWidth/innerHeight, 0.01, 100);
  camera.position.set(0, 1.2, 2.1);
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setSize(innerWidth, innerHeight);

  window.addEventListener("resize", ()=>{
    camera.aspect = innerWidth/innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0,1.2,0);
  controls.enableDamping = true;

  scene.add(new AmbientLight(0xffffff,0.7));
  const key = new DirectionalLight(0xffffff,1.1); key.position.set(1.5,2.8,1.6); scene.add(key);
  const rim = new DirectionalLight(0x88bbff,0.6); rim.position.set(-2.0,1.8,-1.5); scene.add(rim);

  // Always show fallback first
  fallback = new Mesh(
    new IcosahedronGeometry(0.25,3),
    new MeshStandardMaterial({color:0x8891ff, roughness:0.35, metalness:0.05})
  );
  fallback.position.set(0,1.6,0);
  scene.add(fallback);
  log("✓ Fallback visible");

  try {
    await loadGLB(urlGLB);
    scene.remove(fallback);
    log("✓ Model loaded. Click 🎤 or 🧪 to test mouth.");
  } catch (e) {
    log("ℹ GLB missing (or failed). Staying on fallback.");
    console.warn(e);
  }

  micBtn .addEventListener("click", enableMic);
  ttsBtn .addEventListener("click", ()=>{ const u=new SpeechSynthesisUtterance("Model page ready."); speechSynthesis.cancel(); speechSynthesis.speak(u); });
  debugBtn.addEventListener("click", showMorphDebug);
  testBtn.addEventListener("click", ()=>{ testOpen=1; setTimeout(()=>testOpen=0, 800); });
}

function loadGLB(src){
  log("… loading GLB: "+src);
  return new Promise((resolve,reject)=>{
    new GLTFLoader().load(src,(g)=>{
      const root = g.scene || g.scenes[0];
      root.traverse(o=>{
        if (o.isMesh){ o.frustumCulled=false; o.castShadow=false; o.receiveShadow=true; }
        if (o.isSkinnedMesh){
          skinned = o;
          const dict = o.morphTargetDictionary || {};
          const preferred = ["jawOpen","MouthOpen","viseme_aa","A","aa","vowels_Open","mouthOpen"];
          for (const n of preferred){ if (n in dict){ morphMap.open = dict[n]; break; } }
          if (morphMap.open===undefined){
            const keys = Object.keys(dict);
            const cand = keys.find(k=>/jaw|open|aa|mouth/i.test(k));
            if (cand) morphMap.open = dict[cand];
          }
        }
        if (!jaw && /jaw/i.test(o.name)) jaw = o;
      });

      // frame model
      const box = new Box3().setFromObject(root);
      const size = box.getSize(new Vector3()).length();
      const center = box.getCenter(new Vector3());
      controls.target.copy(center);
      const dist = size*0.9;
      camera.position.set(center.x, center.y+size*0.2, center.z + dist);

      scene.add(root);
      resolve();
    }, undefined, (e)=>reject(e));
  });
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
    log("✓ Mic on. Speak (or press 🧪).");
  }catch(e){
    log("❌ Mic permission denied.");
  }
}

function amplitude(){
  if(!analyser||!dataArray) return 0;
  analyser.getByteTimeDomainData(dataArray);
  let sum=0; for(let i=0;i<dataArray.length;i++){ const v=(dataArray[i]-128)/128; sum+=v*v; }
  return Math.sqrt(sum/dataArray.length); // 0..~0.5
}

function driveMouth(){
  const micOpen = Math.min(1, amplitude()*6);
  const open = Math.max(testOpen, micOpen);
  if (skinned && morphMap.open !== undefined){
    skinned.morphTargetInfluences[morphMap.open] = open;
  }
  if (jaw){
    jaw.rotation.x = MathUtils.lerp(jaw.rotation.x, open*0.25, 0.35);
  }
  if (fallback){
    fallback.rotation.y += 0.01;
    fallback.scale.setScalar(1 + open*0.2);
  }
}

function showMorphDebug(){
  let out = "Morph Debug\n===========\n";
  let found = 0;
  scene.traverse(o=>{
    if (o.isSkinnedMesh && o.morphTargetDictionary){
      found++;
      out += `Mesh: ${o.name}\n`;
      const dict=o.morphTargetDictionary;
      const keys = Object.keys(dict).sort((a,b)=>a.localeCompare(b));
      for (const k of keys){
        const mark = (morphMap.open!==undefined && dict[k]===morphMap.open) ? "  (chosen: open)" : "";
        out += `  - ${k}${mark}\n`;
      }
    }
  });
  if (!found) out += "- No skinned meshes with morph targets found.\n";
  out += `Jaw: ${jaw?jaw.name:"none"}\n`;
  log(out);
  try{ console.clear(); console.log(out); }catch{}
}

let t=0;
function animate(now){
  requestAnimationFrame(animate);
  const dt = (now-(t||now))/1000; t=now;
  controls.update();
  driveMouth();
  renderer.render(scene,camera);
}
