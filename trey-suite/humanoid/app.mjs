import {
  WebGLRenderer, Scene, PerspectiveCamera, AmbientLight, DirectionalLight,
  Color, IcosahedronGeometry, MeshStandardMaterial, Mesh, Box3, Vector3, MathUtils,
  TorusGeometry, Box3Helper, GridHelper, AxesHelper
} from "https://esm.sh/three@0.160.0";
import { GLTFLoader }    from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js";

const logEl = document.getElementById("log");
function log(s){ logEl.textContent = (logEl.textContent?logEl.textContent+"\n":"") + s; }
log("🔧 app.mjs start (multi-mesh morph driving)");

const localGLB = new URL("../assets/humanoid.glb", import.meta.url).href + "?v=" + Date.now();

let renderer, scene, camera, controls;
let fallback=null, jaw=null, headBone=null;
let analyser=null, dataArray=null, testOpen=0;
let mouthMarker=null;

// NEW: drive morphs on ALL meshes that expose an open-like target
let morphTargets = []; // [{ mesh, index, name, origEmissive?:number, origIntensity?:number }]
let morphNameOpen = null;

init();
function init(){
  const canvas = document.getElementById("c");
  renderer = new WebGLRenderer({canvas, antialias:true});
  scene    = new Scene(); scene.background = new Color("#0b0b0c");
  camera   = new PerspectiveCamera(35, innerWidth/innerHeight, 0.01, 100);
  camera.position.set(0.0, 1.5, 3.2);

  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setSize(innerWidth, innerHeight);
  addEventListener("resize", ()=>{
    camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0,1.2,0);
  controls.enableDamping = true;

  // Lights
  scene.add(new AmbientLight(0xffffff, 0.95));
  const key = new DirectionalLight(0xffffff, 1.7); key.position.set(3.0,3.0,2.0); scene.add(key);
  const rim = new DirectionalLight(0x88bbff, 1.0); rim.position.set(-3.0,2.0,-2.0); scene.add(rim);

  // Ground & axes
  scene.add(new GridHelper(20, 20, 0x335577, 0x223344));
  const axes = new AxesHelper(0.5); axes.position.set(0,1.0,0); scene.add(axes);

  // Fallback head (kept visible)
  fallback = new Mesh(new IcosahedronGeometry(0.25,3), new MeshStandardMaterial({color:0x8891ff, roughness:0.35, metalness:0.05}));
  fallback.position.set(-0.6,1.6,0);
  scene.add(fallback);
  log("✓ Fallback visible (left)");

  loadGLB(localGLB);

  // UI
  document.getElementById("micBtn").onclick   = enableMic;
  document.getElementById("ttsBtn").onclick   = ()=>{ const u=new SpeechSynthesisUtterance("Model page ready."); speechSynthesis.cancel(); speechSynthesis.speak(u); };
  document.getElementById("debugBtn").onclick = showDebug;
  document.getElementById("testBtn").onclick  = ()=>{ testOpen=1; setTimeout(()=>testOpen=0, 900); };

  requestAnimationFrame(loop);
  log("✅ render loop running");
}

function pickOpen(dict){
  const entries = Object.entries(dict); // [name, index]
  const prefer = [/^surprised$/i, /jawopen/i, /mouthopen/i, /^open$/i, /viseme_aa/i, /^aa$/i, /open/i, /o$/i];
  let hit = entries.find(([n])=> prefer.some(rx=>rx.test(n)));
  if (!hit && entries.length) hit = entries[0];
  if (!hit) return null;
  return { name: hit[0], index: hit[1] };
}

function loadGLB(url){
  log("… loading GLB: " + url);
  new GLTFLoader().load(url,(g)=>{
    const root = g.scene || (g.scenes && g.scenes[0]);
    if (!root){ log("❌ GLB has no scene"); return; }

    // Collect morph targets across ALL meshes
    morphTargets = [];
    root.traverse((o)=>{
      if (o.isMesh){ o.frustumCulled=false; o.castShadow=false; o.receiveShadow=true; }
      if (o.morphTargetDictionary){
        const pick = pickOpen(o.morphTargetDictionary);
        if (pick && o.morphTargetInfluences){
          morphTargets.push({ mesh:o, index:pick.index, name:pick.name, origEmissive:(o.material?.emissive?.getHex?.() ?? null), origIntensity:(o.material?.emissiveIntensity ?? null) });
          if (!morphNameOpen) morphNameOpen = pick.name;
        }
      }
    });

    // Bones to anchor ring
    root.traverse((o)=>{ if (!jaw && o.isBone && /(jaw|mouth|lowerlip|lower_lip|lowerjaw|lower_jaw)/i.test(o.name)) jaw = o; });
    root.traverse((o)=>{ if (!headBone && o.isBone && /head/i.test(o.name)) headBone = o; });
    if (!headBone){ root.traverse((o)=>{ if (!headBone && o.isBone && /neck/i.test(o.name)) headBone = o; }); }

    // Add model
    scene.add(root);

    // Fit camera + helper box
    const box = new Box3().setFromObject(root);
    const size = Math.max(0.001, box.getSize(new Vector3()).length());
    const center = box.getCenter(new Vector3());
    controls.target.copy(center);
    camera.position.set(center.x, center.y + size*0.15, center.z + size*1.4);
    scene.add(new Box3Helper(box, 0x33ff88));

    // Mouth ring near head
    if (!mouthMarker){
      mouthMarker = new Mesh(
        new TorusGeometry(0.10, 0.022, 16, 32),
        new MeshStandardMaterial({color:0x33ff88, emissive:0x112211, roughness:0.35})
      );
      mouthMarker.visible = true;
    }
    (jaw || headBone || root).add(mouthMarker);
    mouthMarker.position.set(0, -0.10, 0.22);

    log(`✓ Model loaded. Morph picks: ${morphTargets.length}`);
    if (morphTargets.length){
      log(`• Chosen morph name: '${morphNameOpen}' on ${morphTargets.length} mesh(es)`);
      for (const t of morphTargets){ log(`  - ${t.mesh.name} → ${t.name} [${t.index}]`); }
    }
    log("• Jaw bone: " + (jaw ? jaw.name : "none") + " • Head/Neck anchor: " + (headBone ? headBone.name : "none"));
  }, undefined, (err)=>{
    log("ℹ Failed to load GLB ("+ (err?.message || "network/error") +")");
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

  // Drive ALL picked morphs
  for (const t of morphTargets){
    if (t.mesh.morphTargetInfluences){
      t.mesh.morphTargetInfluences[t.index] = open;
    }
    // Visualize morph power on the mesh material
    const m = t.mesh.material;
    if (m && m.emissive){
      try{
        m.emissive.setHex(0x33ff88);
        m.emissiveIntensity = 0.25 + open*1.5; // brightens as mouth "opens"
      }catch{}
    }
  }

  // Optional bone jaw
  if (jaw){ jaw.rotation.x = MathUtils.lerp(jaw.rotation.x, open*0.25, 0.35); }

  // Ring
  if (mouthMarker){
    const s = 1 + open*0.9;
    mouthMarker.scale.set(s, s*1.2, s);
    mouthMarker.material.emissiveIntensity = 0.25 + open*1.25;
  }

  // Fallback head keeps spinning so you always see activity
  if (fallback){
    fallback.rotation.y += 0.01;
    fallback.scale.setScalar(1 + open*0.2);
  }
}
    // Visualize morph power on the mesh material
    const m = t.mesh.material;
    if (m && m.emissive){
      try{
        m.emissive.setHex(0x33ff88);
        m.emissiveIntensity = 0.25 + open*1.5; // brightens as mouth "opens"
      }catch{}
    }
  }

  // Optional bone jaw
  if (jaw){ jaw.rotation.x = MathUtils.lerp(jaw.rotation.x, open*0.25, 0.35); }

  // Ring
  if (mouthMarker){
    const s = 1 + open*0.9;
    mouthMarker.scale.set(s, s*1.2, s);
    mouthMarker.material.emissiveIntensity = 0.25 + open*1.25;
  }

  // Fallback head keeps spinning so you always see activity
  if (fallback){
    fallback.rotation.y += 0.01;
    fallback.scale.setScalar(1 + open*0.2);
  }
}
  }
  // Optional bone jaw
  if (jaw){ jaw.rotation.x = MathUtils.lerp(jaw.rotation.x, open*0.25, 0.35); }
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

function showDebug(){
  let out = "Debug\n=====\n";
  // Morphs
  let foundMorph = 0;
  scene.traverse((o)=>{
    if (o.morphTargetDictionary){
      foundMorph++;
      out += `Mesh: ${o.name}\n`;
      const dict=o.morphTargetDictionary;
      const keys = Object.keys(dict).sort((a,b)=>a.localeCompare(b));
      for (const k of keys){
        const chosen = morphTargets.some(t => t.mesh===o && dict[k]===t.index);
        const mark = chosen ? "  (chosen: open)" : "";
        out += `  - ${k}${mark}\n`;
      }
    }
  });
  if (!foundMorph) out += "- No morph targets found.\n";
  // Bones
  scene.traverse((o)=>{
    if (o.isBone){
      const mark = (jaw && o===jaw) ? "  (chosen: jaw)" : (headBone && o===headBone ? "  (anchor)" : "");
      out += `Bone: ${o.name}${mark}\n`;
    }
  });
  out += `\nChosen morph name: ${morphNameOpen??"none"}\nMeshes driven: ${morphTargets.length}\n`;
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


