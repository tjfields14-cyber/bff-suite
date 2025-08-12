import {
  WebGLRenderer, Scene, PerspectiveCamera, AmbientLight, DirectionalLight,
  Color, IcosahedronGeometry, MeshStandardMaterial, Mesh, Box3, Vector3, MathUtils,
  TorusGeometry
} from "https://esm.sh/three@0.160.0";
import { GLTFLoader }    from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js";

const logEl = document.getElementById("log");
function log(s){ logEl.textContent = (logEl.textContent?logEl.textContent+"\n":"") + s; }
log("🚀 app.mjs start (morphs on any Mesh)");

const localGLB  = new URL("../assets/humanoid.glb", import.meta.url).href;
const sampleGLB = "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/CesiumMan/glTF-Binary/CesiumMan.glb";

let renderer, scene, camera, controls;
let fallback=null, jaw=null, headBone=null;
let analyser=null, dataArray=null, testOpen=0;
let mouthMarker=null, mouthParent=null;

// NEW: keep reference to the specific mesh that has morphs
let morphMesh=null;
let morphMap = {}; // { open: index }

init();
function init(){
  const canvas = document.getElementById("c");
  renderer = new WebGLRenderer({canvas, antialias:true});
  scene    = new Scene(); scene.background = new Color("#0b0b0c");
  camera   = new PerspectiveCamera(35, innerWidth/innerHeight, 0.01, 100);
  camera.position.set(0, 1.2, 2.1);
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setSize(innerWidth, innerHeight);
  addEventListener("resize", ()=>{ camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0,1.2,0);
  controls.enableDamping = true;

  scene.add(new AmbientLight(0xffffff,0.7));
  const key = new DirectionalLight(0xffffff,1.1); key.position.set(1.5,2.8,1.6); scene.add(key);
  const rim = new DirectionalLight(0x88bbff,0.6); rim.position.set(-2.0,1.8,-1.5); scene.add(rim);

  // Fallback head first
  fallback = new Mesh(new IcosahedronGeometry(0.25,3), new MeshStandardMaterial({color:0x8891ff, roughness:0.35, metalness:0.05}));
  fallback.position.set(0,1.6,0);
  scene.add(fallback);
  log("✓ Fallback visible");

  tryLoadGLB(localGLB).catch(()=> tryLoadGLB(sampleGLB, true));

  // Buttons
  document.getElementById("micBtn").onclick   = enableMic;
  document.getElementById("ttsBtn").onclick   = ()=>{ const u=new SpeechSynthesisUtterance("Model page ready."); speechSynthesis.cancel(); speechSynthesis.speak(u); };
  document.getElementById("debugBtn").onclick = showMorphAndBoneDebug;
  document.getElementById("testBtn").onclick  = ()=>{ testOpen=1; setTimeout(()=>testOpen=0, 800); };

  requestAnimationFrame(loop);
  log("✅ render loop running");
}

function tryLoadGLB(url, isSample=false){
  log((isSample?"… loading SAMPLE GLB: ":"… loading GLB: ") + url);
  return new Promise((resolve, reject)=>{
    new GLTFLoader().load(url,(g)=>{
      const root = g.scene || (g.scenes && g.scenes[0]);
      if (!root){ log("❌ GLB has no scene"); return reject(new Error("no scene")); }

      // Find morphs on ANY Mesh (Skinned or not)
      root.traverse((o)=>{
        if (o.isMesh){ o.frustumCulled=false; o.castShadow=false; o.receiveShadow=true; }
        if (o.morphTargetDictionary && !morphMesh){
          morphMesh = o; // first mesh with morphs
          const dict = o.morphTargetDictionary;
          const preferred = ["jawOpen","MouthOpen","viseme_aa","A","aa","vowels_Open","mouthOpen","open","O","o"];
          for (const n of preferred){ if (n in dict){ morphMap.open = dict[n]; break; } }
          if (morphMap.open===undefined){
            const cand = Object.keys(dict).find(k=>/jaw|open|aa|mouth|viseme/i.test(k));
            if (cand) morphMap.open = dict[cand];
          }
        }
      });

      // Find jaw/head/neck bones to anchor a mouth marker if needed
      root.traverse((o)=>{
        if (!jaw && o.isBone && /(jaw|mouth|lowerlip|lower_lip|lowerjaw|lower_jaw)/i.test(o.name)) jaw = o;
      });
      root.traverse((o)=>{
        if (!headBone && o.isBone && /head/i.test(o.name)) headBone = o;
      });
      if (!headBone){
        root.traverse((o)=>{ if (!headBone && o.isBone && /neck/i.test(o.name)) headBone = o; });
      }

      // Frame model
      const box = new Box3().setFromObject(root);
      const size = box.getSize(new Vector3()).length();
      const center = box.getCenter(new Vector3());
      controls.target.copy(center);
      camera.position.set(center.x, center.y + size*0.2, center.z + size*0.9);

      scene.add(root);
      if (fallback){ scene.remove(fallback); fallback=null; }

      // Create mouth marker (ring) and attach/display for visibility/show
      if (!mouthMarker){
        mouthMarker = new Mesh(
          new TorusGeometry(0.10, 0.022, 16, 32),
          new MeshStandardMaterial({color:0x33ff88, emissive:0x112211, roughness:0.35})
        );
        mouthMarker.visible = true;
      }
      const parent = jaw || headBone || root;
      parent.add(mouthMarker);
      mouthMarker.position.set(0, -0.10, 0.22);

      log((isSample?"✓ SAMPLE ":"✓ ") + "Model loaded. Open morph index: " + (morphMap.open===undefined ? "none" : morphMap.open));
      log("• Jaw bone: " + (jaw ? jaw.name : "none") + " • Head/Neck anchor: " + (headBone ? headBone.name : "none"));
      resolve();
    }, undefined, (err)=>{
      log("ℹ Failed to load "+(isSample?"SAMPLE ":"")+"GLB ("+ (err?.message || "network/error") +")");
      if (!isSample) reject(err); else resolve();
    });
  });
}

function enableMic(){
  log("… requesting mic");
  navigator.mediaDevices.getUserMedia({audio:true}).then((stream)=>{
    const ac = new (window.AudioContext||window.webkitAudioContext)();
    const src = ac.createMediaStreamSource(stream);
    analyser = ac.createAnalyser(); analyser.fftSize = 2048;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    src.connect(analyser);
    log("✓ Mic on. Speak (or press 🧪).");
  }).catch(()=> log("❌ Mic permission denied."));
}

function amplitude(){
  if(!analyser||!dataArray) return 0;
  analyser.getByteTimeDomainData(dataArray);
  let sum=0; for(let i=0;i<dataArray.length;i++){ const v=(dataArray[i]-128)/128; sum+=v*v; }
  return Math.sqrt(sum/dataArray.length);
}

function driveMouth(){
  const micOpen = Math.min(1, amplitude()*12);
  const open = Math.max(testOpen, micOpen);

  // Drive morphs if present (on ANY mesh)
  if (morphMesh && morphMap.open !== undefined && morphMesh.morphTargetInfluences){
    morphMesh.morphTargetInfluences[morphMap.open] = open;
  }
  // Bone route if present
  if (jaw){
    jaw.rotation.x = MathUtils.lerp(jaw.rotation.x, open*0.25, 0.35);
  }
  // Visual ring
  if (mouthMarker){
    const s = 1 + open*0.9;
    mouthMarker.scale.set(s, s*1.2, s);
    mouthMarker.material.emissiveIntensity = 0.25 + open*1.25;
  }
  // Fallback head
  if (fallback){
    fallback.rotation.y += 0.01;
    fallback.scale.setScalar(1 + open*0.2);
  }
}

function showMorphAndBoneDebug(){
  let out = "Debug\n=====\n";
  // Morphs on ANY mesh
  let foundMorph = 0;
  scene.traverse((o)=>{
    if (o.morphTargetDictionary){
      foundMorph++;
      out += `Mesh: ${o.name}\n`;
      const dict=o.morphTargetDictionary;
      const keys = Object.keys(dict).sort((a,b)=>a.localeCompare(b));
      for (const k of keys){
        const mark = (morphMap.open!==undefined && dict[k]===morphMap.open && o===morphMesh) ? "  (chosen: open)" : "";
        out += `  - ${k}${mark}\n`;
      }
    }
  });
  if (!foundMorph) out += "- No morph targets found.\n";

  // Bones
  let foundBone = 0;
  scene.traverse((o)=>{
    if (o.isBone){
      foundBone++;
      const mark = (jaw && o===jaw) ? "  (chosen: jaw)" : (headBone && o===headBone ? "  (anchor)" : "");
      out += `Bone: ${o.name}${mark}\n`;
    }
  });
  if (!foundBone) out += "- No bones found.\n";

  out += `\nChosen jaw: ${jaw?jaw.name:"none"}\nChosen morph index: ${morphMap.open===undefined?"none":morphMap.open}\n`;
  log(out);
  try{ console.clear(); console.log(out); }catch(e){}
}

let prev=0;
function loop(now){
  requestAnimationFrame(loop);
  const dt = (now-(prev||now))/1000; prev = now;
  controls.update();
  driveMouth();
  renderer.render(scene,camera);
}
