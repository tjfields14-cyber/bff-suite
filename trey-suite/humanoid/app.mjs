import {
  WebGLRenderer, Scene, PerspectiveCamera, AmbientLight, DirectionalLight,
  Color, IcosahedronGeometry, MeshStandardMaterial, Mesh, Box3, Vector3, MathUtils,
  TorusGeometry, Box3Helper, GridHelper, AxesHelper, Sphere
} from "https://esm.sh/three@0.160.0";
import { GLTFLoader }    from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js";

const logEl = document.getElementById("log");
function log(s){ logEl.textContent = (logEl.textContent?logEl.textContent+"\n":"") + s; }
log("🚀 app.mjs loaded (material hardening + wireframe toggle)");

const localGLB = new URL("../assets/humanoid.glb", import.meta.url).href + "?v=" + Date.now();

let renderer, scene, camera, controls;
let fallback=null, jaw=null, headBone=null;
let analyser=null, dataArray=null, testOpen=0;
let mouthMarker=null;

let morphTargets = []; // [{ mesh, index, name, origEmissive?:number, origIntensity?:number }]
let morphNameOpen = null;

let modelRoot = null;
let sceneSphere = null;
let boxHelper = null;

let wire = false; // wireframe toggle

init();

function init(){
  const canvas = document.getElementById("c");
  renderer = new WebGLRenderer({canvas, antialias:true});
  scene    = new Scene(); scene.background = new Color("#0b0b0c");
  camera   = new PerspectiveCamera(35, innerWidth/innerHeight, 0.001, 1000);
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

  // Fallback “head”
  fallback = new Mesh(new IcosahedronGeometry(0.25,3), new MeshStandardMaterial({color:0x8891ff, roughness:0.35, metalness:0.05}));
  fallback.position.set(-0.6,1.6,0);
  scene.add(fallback);
  log("✓ Fallback visible (left)");

  loadGLB(localGLB);

  // UI
  const micBtn   = document.getElementById("micBtn");
  const ttsBtn   = document.getElementById("ttsBtn");
  const debugBtn = document.getElementById("debugBtn");
  const testBtn  = document.getElementById("testBtn");

  if (micBtn)   micBtn.onclick   = enableMic;
  if (ttsBtn)   ttsBtn.onclick   = ()=>{ const u=new SpeechSynthesisUtterance("Model page ready."); speechSynthesis.cancel(); speechSynthesis.speak(u); };
  if (debugBtn) debugBtn.onclick = showDebug;
  if (testBtn)  testBtn.onclick  = ()=>{ testOpen=1; setTimeout(()=>testOpen=0, 900); };

  // Keyboard: W toggles wireframe for ALL model meshes
  addEventListener("keydown", (e)=>{
    if (e.key.toLowerCase() === "w"){
      wire = !wire;
      applyWireframe(wire);
      log(`Wireframe: ${wire ? "ON" : "OFF"} (press W to toggle)`);
    }
  });

  requestAnimationFrame(loop);
  log("✅ render loop running — press W for wireframe");
}

function pickOpen(dict){
  const entries = Object.entries(dict); // [name, index]
  const prefer = [/^surprised$/i, /jawopen/i, /mouthopen/i, /^open$/i, /viseme_aa/i, /^aa$/i, /open/i, /o$/i];
  let hit = entries.find(([n])=> prefer.some(rx=>rx.test(n)));
  if (!hit && entries.length) hit = entries[0];
  if (!hit) return null;
  return { name: hit[0], index: hit[1] };
}

function hardenMaterial(mat){
  const list = Array.isArray(mat) ? mat : [mat];
  for (const m of list){
    if (!m) continue;
    try{
      m.transparent = false;
      m.opacity = 1;
      m.depthWrite = true;
      m.depthTest  = true;
      m.side = 2; // DoubleSide
      if (m.emissive){
        // leave emissive to mouth driver; ensure sane baseline
        if (typeof m.emissiveIntensity !== "number") m.emissiveIntensity = 0.0;
      }
      if (m.color && m.color.setHex) {
        // keep albedo if present; do not force white to avoid washing textures
      }
      // If the material type doesn’t support emissive, that’s fine.
    }catch{}
  }
}

function applyWireframe(w){
  if (!modelRoot) return;
  modelRoot.traverse(o=>{
    if (o.isMesh){
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats){ if (m) try{ m.wireframe = w; }catch{} }
    }
  });
}

function loadGLB(url){
  log("… loading GLB: " + url);
  new GLTFLoader().load(url,(g)=>{
    const root = g.scene || (g.scenes && g.scenes[0]);
    if (!root){ log("❌ GLB has no scene"); return; }

    // Reset per-load state
    morphTargets = []; morphNameOpen = null; jaw = null; headBone = null;

    root.traverse((o)=>{
      if (o.isMesh){
        o.frustumCulled = false;
        o.castShadow = false; o.receiveShadow = true;
        hardenMaterial(o.material); // <<< IMPORTANT: make materials safe/visible
      }
      if (o.morphTargetDictionary && o.morphTargetInfluences){
        const pick = pickOpen(o.morphTargetDictionary);
        if (pick){
          morphTargets.push({
            mesh:o, index:pick.index, name:pick.name,
            origEmissive:(o.material?.emissive?.getHex?.() ?? null),
            origIntensity:(o.material?.emissiveIntensity ?? null)
          });
          if (!morphNameOpen) morphNameOpen = pick.name;
        }
      }
      if (!jaw && o.isBone && /(jaw|mouth|lowerlip|lower_lip|lowerjaw|lower_jaw)/i.test(o.name)) jaw = o;
      if (!headBone && o.isBone && /head/i.test(o.name)) headBone = o;
    });
    if (!headBone){
      root.traverse((o)=>{ if (!headBone && o.isBone && /neck/i.test(o.name)) headBone = o; });
    }

    modelRoot = root;
    scene.add(root);

    // Fit camera & helpers from bounding sphere
    const box = new Box3().setFromObject(root);
    const center = box.getCenter(new Vector3());
    const sphere = new Sphere(); box.getBoundingSphere(sphere);
    sceneSphere = sphere;

    controls.target.copy(center);
    const dist = sphere.radius * 2.2 + 0.5;
    camera.position.set(center.x, center.y + sphere.radius*0.2, center.z + Math.max(dist, 1.2));

    if (boxHelper) scene.remove(boxHelper);
    boxHelper = new Box3Helper(box, 0x33ff88);
    scene.add(boxHelper);

    // Mouth ring near head/jaw
    if (!mouthMarker){
      mouthMarker = new Mesh(
        new TorusGeometry(0.10, 0.022, 16, 32),
        new MeshStandardMaterial({color:0x33ff88, emissive:0x112211, roughness:0.35})
      );
      mouthMarker.visible = true;
    }
    (jaw || headBone || root).add(mouthMarker);
    mouthMarker.position.set(0, -0.10, 0.22);

    // Apply wireframe state if toggled already
    applyWireframe(wire);

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

  for (const t of morphTargets){
    if (t.mesh.morphTargetInfluences){
      t.mesh.morphTargetInfluences[t.index] = open;
    }
    const m = t.mesh.material;
    if (m && m.emissive){
      try{ m.emissive.setHex(0x33ff88); m.emissiveIntensity = 0.25 + open*1.5; }catch{}
    }
  }

  if (jaw){ jaw.rotation.x = MathUtils.lerp(jaw.rotation.x, open*0.25, 0.35); }
  if (mouthMarker){
    const s = 1 + open*0.9;
    mouthMarker.scale.set(s, s*1.2, s);
    mouthMarker.material.emissiveIntensity = 0.25 + open*1.25;
  }
  if (fallback){
    fallback.rotation.y += 0.01;
    fallback.scale.setScalar(1 + open*0.2);
  }
}

function clampCamera(){
  if (!sceneSphere) return;
  const minD = Math.max(0.1, sceneSphere.radius * 0.6);
  const maxD = Math.max(minD+0.1, sceneSphere.radius * 6.0);

  const dir = new Vector3().subVectors(camera.position, controls.target);
  let d = dir.length();
  if (d === 0){ dir.set(0,0,1); d = 1; }

  if (d < minD){ dir.setLength(minD); camera.position.copy(controls.target).add(dir); }
  if (d > maxD){ dir.setLength(maxD); camera.position.copy(controls.target).add(dir); }
}

function keepModelVisible(){
  if (modelRoot) modelRoot.visible = true;
}

function showDebug(){
  let out = "Debug\n=====\n";
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
  scene.traverse((o)=>{
    if (o.isBone){
      const mark = (jaw && o===jaw) ? "  (chosen: jaw)" : (headBone && o===headBone ? "  (anchor)" : "");
      out += `Bone: ${o.name}${mark}\n`;
    }
  });
  out += `\nSphere r: ${sceneSphere?sceneSphere.radius.toFixed(3):"n/a"}\nCamera: ${camera.position.toArray().map(v=>v.toFixed(3)).join(", ")}\nTarget: ${controls.target.toArray().map(v=>v.toFixed(3)).join(", ")}\n`;
  log(out);
  try{ console.clear(); console.log(out); }catch(e){}
}

let prev=0;
function loop(now){
  requestAnimationFrame(loop);
  const dt = (now-(prev||now))/1000; prev = now;
  clampCamera();
  keepModelVisible();
  controls.update();
  driveMouth();
  renderer.render(scene,camera);
}
