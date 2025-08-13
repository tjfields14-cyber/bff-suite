import {
  WebGLRenderer, Scene, PerspectiveCamera, AmbientLight, DirectionalLight,
  Color, IcosahedronGeometry, MeshStandardMaterial, MeshBasicMaterial, Mesh,
  Box3, Vector3, MathUtils, TorusGeometry, Box3Helper, GridHelper, AxesHelper, Sphere
} from "https://esm.sh/three@0.160.0";
import { GLTFLoader }    from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js";

const logEl = document.getElementById("log");
function log(s){ logEl.textContent = (logEl.textContent?logEl.textContent+"\n":"") + s; }

function el(tag, attrs={}, html=""){
  const n = document.createElement(tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (html) n.innerHTML = html;
  return n;
}

function addTuningUI(){
  const wrap = el("div");
  wrap.style.cssText = `
    position:fixed; right:12px; top:60px; z-index:10;
    background:#111; color:#fff; border:1px solid #2a2a2a; border-radius:10px;
    padding:10px 12px; font:12px/1.3 ui-sans-serif,system-ui; width:260px; box-shadow:0 8px 30px rgba(0,0,0,.35);
  `;
  wrap.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <b style="font-size:12px;">Tuning</b>
      <small id="meterLabel">mic: 0.00</small>
    </div>
    <div id="meter" style="height:8px;border-radius:999px;background:#222;overflow:hidden;margin:6px 0 10px;">
      <div id="meterBar" style="height:100%;width:0;background:linear-gradient(90deg,#39ff88,#80ffd5);"></div>
    </div>
    <label>Sensitivity <span id="gLabel">1.6</span>
      <input id="gain" type="range" min="0.5" max="3" step="0.1" value="1.6" style="width:100%">
    </label>
    <label style="display:block;margin-top:6px;">Gate <span id="gateLabel">0.02</span>
      <input id="gate" type="range" min="0" max="0.08" step="0.005" value="0.02" style="width:100%">
    </label>
    <label style="display:block;margin-top:6px;">Smoothing <span id="smLabel">0.75</span>
      <input id="smooth" type="range" min="0" max="0.95" step="0.05" value="0.75" style="width:100%">
    </label>
  `;
  document.body.appendChild(wrap);

  // Speak bar (new)
  const speak = el("div");
  speak.style.cssText = `
    position:fixed; left:12px; top:12px; z-index:10;
    display:flex; gap:6px; align-items:center;
    background:#111; color:#fff; border:1px solid #2a2a2a; border-radius:10px;
    padding:8px 10px; font:12px ui-sans-serif,system-ui; width:560px;
  `;
  speak.innerHTML = `
    <input id="sayText" value="Hey Trey, this is a live test of the lipsync. One, two, three — go!"
      style="flex:1; background:#181818; color:#eee; border:1px solid #333; border-radius:8px; padding:8px 10px; outline:none;">
    <button id="sayBtn" style="background:#0ea5e9;border:0;color:#fff;border-radius:8px;padding:8px 10px;cursor:pointer">Speak</button>
    <button id="stopBtn" style="background:#ef4444;border:0;color:#fff;border-radius:8px;padding:8px 10px;cursor:pointer">Stop</button>
  `;
  document.body.appendChild(speak);

  return {
    get gain(){ return parseFloat(document.getElementById("gain").value); },
    get gate(){ return parseFloat(document.getElementById("gate").value); },
    get smooth(){ return parseFloat(document.getElementById("smooth").value); },
    setLabels(g,gt,sm){
      document.getElementById("gLabel").textContent = g.toFixed(1);
      document.getElementById("gateLabel").textContent = gt.toFixed(3);
      document.getElementById("smLabel").textContent = sm.toFixed(2);
    },
    meter(raw){
      const bar = document.getElementById("meterBar");
      const lab = document.getElementById("meterLabel");
      const w = Math.max(0, Math.min(1, raw)) * 100;
      bar.style.width = w + "%";
      lab.textContent = "mic: " + raw.toFixed(2);
    },
    onSpeak(fn){ document.getElementById("sayBtn").onclick = ()=> fn(document.getElementById("sayText").value); },
    onStop(fn){ document.getElementById("stopBtn").onclick = fn; }
  };
}

// ---------- Globals ----------
log("🚀 app.mjs loaded (wireframe=W, basic=B)");
const localGLB = new URL("../assets/humanoid.glb", import.meta.url).href + "?v=" + Date.now();

let renderer, scene, camera, controls;
let fallback=null, jaw=null, headBone=null;
let analyser=null, dataArray=null, testOpen=0;
let mouthMarker=null;

let morphTargets = []; // [{ mesh, index, name }]
let morphNameOpen = null;

let modelRoot = null;
let sceneSphere = null;
let boxHelper = null;

let wire = false;
let basic = true;

// Tuning UI (+ speak bar)
const ui = addTuningUI();
ui.setLabels(ui.gain, ui.gate, ui.smooth);

// TTS → viseme override (0..1) that decays
let viseme = 0;
let visemeDecay = 0.92;

// ---------- Init ----------
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

  scene.add(new AmbientLight(0xffffff, 0.95));
  const key = new DirectionalLight(0xffffff, 1.7); key.position.set(3.0,3.0,2.0); scene.add(key);
  const rim = new DirectionalLight(0x88bbff, 1.0); rim.position.set(-3.0,2.0,-2.0); scene.add(rim);

  scene.add(new GridHelper(20, 20, 0x335577, 0x223344));
  const axes = new AxesHelper(0.5); axes.position.set(0,1.0,0); scene.add(axes);

  fallback = new Mesh(new IcosahedronGeometry(0.25,3), new MeshStandardMaterial({color:0x8891ff, roughness:0.35, metalness:0.05}));
  fallback.position.set(-0.6,1.6,0); scene.add(fallback);
  log("✓ Fallback visible (left)");

  loadGLB(localGLB);

  // Buttons from page
  document.getElementById("micBtn")   ?.addEventListener("click", enableMic);
  document.getElementById("ttsBtn")   ?.addEventListener("click", ()=>{ const u=new SpeechSynthesisUtterance("Model page ready."); speechSynthesis.cancel(); speechSynthesis.speak(u); });
  document.getElementById("debugBtn") ?.addEventListener("click", showDebug);
  document.getElementById("testBtn")  ?.addEventListener("click", ()=>{ testOpen=1; setTimeout(()=>testOpen=0, 900); });

  // Speak bar hooks
  ui.onSpeak(speakText);
  ui.onStop(()=> speechSynthesis.cancel());

  addEventListener("keydown", (e)=>{
    const k = e.key.toLowerCase();
    if (k === "w"){ wire = !wire; applyWireframe(wire); log(`Wireframe: ${wire?"ON":"OFF"}`); }
    if (k === "b"){ basic = !basic; applyBasic(basic); log(`Basic material: ${basic?"ON":"OFF"}`); }
  });

  requestAnimationFrame(loop);
  log("✅ render loop running — press W (wireframe) / B (basic)");
}

// ---------- Import helpers ----------
function pickOpen(dict){
  const entries = Object.entries(dict);
  const prefer = [/^surprised$/i, /jawopen/i, /mouthopen/i, /^open$/i, /viseme_aa/i, /^aa$/i, /open/i, /o$/i];
  let hit = entries.find(([n])=> prefer.some(rx=>rx.test(n)));
  if (!hit && entries.length) hit = entries[0];
  if (!hit) return null;
  return { name: hit[0], index: hit[1] };
}

function captureOriginalMaterials(root){
  root.traverse(o=>{
    if (o.isMesh){
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      o.userData._origMats = mats.map(m=>m);
    }
  });
}
function applyBasic(on){
  if (!modelRoot) return;
  modelRoot.traverse(o=>{
    if (!o.isMesh) return;
    if (on){
      const m = new MeshBasicMaterial({ color: 0x8fffd5 });
      m.wireframe = wire;
      o.material = m;
    } else {
      if (o.userData._origMats){
        const mats = o.userData._origMats;
        o.material = (mats.length===1) ? mats[0] : mats;
      }
    }
  });
}
function hardenPBR(o){
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  for (const m of mats){
    if (!m) continue;
    try{
      m.transparent=false; m.opacity=1;
      m.depthWrite=true; m.depthTest=true;
      m.side=2;
      if (typeof m.emissiveIntensity !== "number") m.emissiveIntensity = 0.0;
      m.wireframe = wire;
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

    morphTargets = []; morphNameOpen = null; jaw = null; headBone = null;

    root.traverse((o)=>{
      if (o.isMesh){ o.frustumCulled=false; o.castShadow=false; o.receiveShadow=true; hardenPBR(o); }
      if (o.morphTargetDictionary && o.morphTargetInfluences){
        const pick = pickOpen(o.morphTargetDictionary);
        if (pick){
          morphTargets.push({ mesh:o, index:pick.index, name:pick.name });
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

    captureOriginalMaterials(root);
    applyBasic(true);

    // Fit camera
    const box = new Box3().setFromObject(root);
    const center = box.getCenter(new Vector3());
    const sphere = new Sphere(); box.getBoundingSphere(sphere);
    sceneSphere = sphere;
    controls.target.copy(center);
    const dist = sphere.radius * 2.2 + 0.5;
    camera.position.set(center.x, center.y + sphere.radius*0.2, center.z + Math.max(dist, 1.2));

    if (boxHelper) scene.remove(boxHelper);
    boxHelper = new Box3Helper(box, 0x33ff88); scene.add(boxHelper);

    // Mouth ring
    if (!mouthMarker){
      mouthMarker = new Mesh(new TorusGeometry(0.10, 0.022, 16, 32), new MeshStandardMaterial({color:0x33ff88, emissive:0x112211, roughness:0.35}));
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
    log("Tip: type text in the Speak bar and press Speak. Mic + sliders still work.");
  }, undefined, (err)=> log("ℹ Failed to load GLB ("+ (err?.message || "network/error") +")"));
}

// ---------- Audio / mouth drive ----------
function enableMic(){
  log("… requesting mic");
  navigator.mediaDevices.getUserMedia({audio:true}).then((stream)=>{
    const ac = new (window.AudioContext||window.webkitAudioContext)();
    const src = ac.createMediaStreamSource(stream);
    analyser = ac.createAnalyser(); analyser.fftSize = 2048;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    src.connect(analyser);
    log("✓ Mic on. Speak (or use Speak bar).");
  }).catch(()=> log("❌ Mic permission denied."));
}
function amplitude(){
  if(!analyser||!dataArray) return 0;
  analyser.getByteTimeDomainData(dataArray);
  let sum=0; for(let i=0;i<dataArray.length;i++){ const v=(dataArray[i]-128)/128; sum+=v*v; }
  return Math.sqrt(sum/dataArray.length);
}

// TTS → simple viseme mapping
function speakText(text){
  if (!text || !text.trim()) return;
  try{ speechSynthesis.cancel(); }catch{}
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1; u.pitch = 1; u.volume = 1;

  const drive = (ch) => {
    if (!ch) return;
    const c = ch.toLowerCase();
    // very simple class-based shapes → strength
    if ("aeáàâäeéèêë".includes(c)) viseme = 0.85;          // wide-open vowels
    else if ("iouóòôöuúùûü".includes(c)) viseme = 1.00;    // rounder vowels → open max
    else if ("bpmpfvw".includes(c)) viseme = 0.25;          // labials → small pop
    else if ("sztcjx".includes(c)) viseme = 0.35;           // sibilants
    else if ("lnrdyghkq".includes(c)) viseme = 0.55;        // mixed
    else if (c.trim()==="") viseme = Math.max(viseme*0.6, 0.05);
    else viseme = 0.5;
  };

  u.onboundary = (e) => {
    // Some browsers fire "word" boundaries, others charIndex jumps. Use charIndex if present.
    const idx = (typeof e.charIndex === "number") ? e.charIndex : 0;
    drive(text[idx]);
  };
  u.onstart = ()=> { viseme = 0.9; log("▶ Speaking…"); };
  u.onend   = ()=> { viseme = 0;   log("■ Done."); };

  speechSynthesis.speak(u);
}

let openState = 0; // smoothed mic
function driveMouth(dt){
  // mic
  const ampRaw = amplitude();
  ui.meter(ampRaw);
  const gated  = Math.max(0, ampRaw - ui.gate);
  const boosted= Math.min(1, gated * (ui.gain*2));
  const a = 1 - ui.smooth;
  openState = (1-a)*openState + a*boosted;

  // decay viseme override
  viseme = viseme * visemeDecay;

  const open = Math.max(testOpen, openState, viseme);

  for (const t of morphTargets){
    if (t.mesh.morphTargetInfluences){
      t.mesh.morphTargetInfluences[t.index] = open;
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

// ---------- Loop / debug ----------
function clampCamera(){
  if (!sceneSphere) return;
  const minD = Math.max(0.1, sceneSphere.radius * 0.6);
  const maxD = Math.max(minD+0.1, sceneSphere.radius * 6.0);
  const dir = new Vector3().subVectors(camera.position, controls.target);
  let d = dir.length(); if (d === 0){ dir.set(0,0,1); d = 1; }
  if (d < minD){ dir.setLength(minD); camera.position.copy(controls.target).add(dir); }
  if (d > maxD){ dir.setLength(maxD); camera.position.copy(controls.target).add(dir); }
}
function keepModelVisible(){ if (modelRoot) modelRoot.visible = true; }

function showDebug(){
  let out = "Debug\n=====\n";
  let foundMorph = 0;
  scene.traverse((o)=>{
    if (o.morphTargetDictionary){
      foundMorph++; out += `Mesh: ${o.name}\n`;
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
  log(out); try{ console.clear(); console.log(out); }catch(e){}
}

let prev=0;
function loop(now){
  requestAnimationFrame(loop);
  const dt = (now-(prev||now))/1000; prev = now;
  clampCamera(); keepModelVisible(); controls.update(); driveMouth(dt);
  renderer.render(scene,camera);
}
