import {
  WebGLRenderer, Scene, PerspectiveCamera, AmbientLight, DirectionalLight,
  Color, IcosahedronGeometry, MeshStandardMaterial, Mesh, Box3, Vector3, MathUtils
} from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { GLTFLoader }   from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls }from "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js";

const logEl = document.getElementById("log");
function log(s){ logEl.textContent = (logEl.textContent?logEl.textContent+"\n":"") + s; }
log("🚀 app.mjs start");

const urlGLB = new URL("../assets/humanoid.glb", import.meta.url).href;

let renderer, scene, camera, controls;
let fallback=null, skinned=null, morphMap={}, jaw=null;
let analyser=null, dataArray=null, testOpen=0;

init();
function init(){
  const canvas = document.getElementById("c");
  renderer = new WebGLRenderer({canvas, antialias:true});
  scene    = new Scene(); scene.background = new Color("#0b0b0c");
  camera   = new PerspectiveCamera(35, innerWidth/innerHeight, 0.01, 100);
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

  // Load GLB (if present)
  tryLoadGLB();

  // Wire buttons
  const micBtn   = document.getElementById("micBtn");
  const ttsBtn   = document.getElementById("ttsBtn");
  const debugBtn = document.getElementById("debugBtn");
  const testBtn  = document.getElementById("testBtn");
  micBtn.onclick   = enableMic;
  ttsBtn.onclick   = function(){ const u=new SpeechSynthesisUtterance("Model page ready."); speechSynthesis.cancel(); speechSynthesis.speak(u); };
  debugBtn.onclick = showMorphDebug;
  testBtn.onclick  = function(){ testOpen=1; setTimeout(function(){ testOpen=0; }, 800); };

  // Start loop
  requestAnimationFrame(loop);
  log("✅ render loop running");
}

function tryLoadGLB(){
  log("… loading GLB: "+urlGLB);
  const loader = new GLTFLoader();
  loader.load(urlGLB, function(g){
    const root = g.scene || (g.scenes && g.scenes[0]);
    if (!root){ log("❌ GLB has no scene"); return; }

    // Inspect model
    root.traverse(function(o){
      if (o.isMesh){ o.frustumCulled=false; o.castShadow=false; o.receiveShadow=true; }
      if (o.isSkinnedMesh){
        skinned = o;
        const dict = o.morphTargetDictionary || {};
        const preferred = ["jawOpen","MouthOpen","viseme_aa","A","aa","vowels_Open","mouthOpen"];
        for (var i=0; i<preferred.length; i++){
          var n = preferred[i]; if (dict.hasOwnProperty(n)){ morphMap.open = dict[n]; break; }
        }
        if (morphMap.open === undefined){
          var keys = Object.keys(dict);
          for (var k=0; k<keys.length; k++){ if (/jaw|open|aa|mouth/i.test(keys[k])){ morphMap.open = dict[keys[k]]; break; } }
        }
      }
      if (!jaw && /jaw/i.test(o.name)) jaw = o; // pick a jaw bone if there is one
    });

    // Frame model nicely
    const box = new Box3().setFromObject(root);
    const size = box.getSize(new Vector3()).length();
    const center = box.getCenter(new Vector3());
    controls.target.copy(center);
    const dist = size*0.9;
    camera.position.set(center.x, center.y + size*0.2, center.z + dist);

    // Swap fallback → model
    scene.add(root);
    if (fallback){ scene.remove(fallback); fallback=null; }
    log("✓ Model loaded. Chosen open morph index: " + (morphMap.open===undefined ? "none" : morphMap.open));
  }, undefined, function(err){
    log("ℹ GLB missing or failed to load; staying on fallback.");
    // keep fallback
  });
}

function enableMic(){
  log("… requesting mic");
  navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){
    const ac = new (window.AudioContext||window.webkitAudioContext)();
    const src = ac.createMediaStreamSource(stream);
    analyser = ac.createAnalyser();
    analyser.fftSize = 2048;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    src.connect(analyser);
    log("✓ Mic on. Speak (or press 🧪).");
  }).catch(function(){
    log("❌ Mic permission denied.");
  });
}

function amplitude(){
  if(!analyser||!dataArray) return 0;
  analyser.getByteTimeDomainData(dataArray);
  var sum=0; for(var i=0;i<dataArray.length;i++){ var v=(dataArray[i]-128)/128; sum+=v*v; }
  return Math.sqrt(sum/dataArray.length); // 0..~0.5
}

function driveMouth(){
  var micOpen = Math.min(1, amplitude()*6);
  var open = Math.max(testOpen, micOpen);
  if (skinned && morphMap.open !== undefined && skinned.morphTargetInfluences){
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
  var out = "Morph Debug\\n===========\\n";
  var found = 0;
  scene.traverse(function(o){
    if (o.isSkinnedMesh && o.morphTargetDictionary){
      found++;
      out += "Mesh: "+o.name+"\\n";
      var dict=o.morphTargetDictionary;
      var keys = Object.keys(dict).sort(function(a,b){ return a.localeCompare(b); });
      for (var i=0;i<keys.length;i++){
        var k = keys[i];
        var mark = (morphMap.open!==undefined && dict[k]===morphMap.open) ? "  (chosen: open)" : "";
        out += "  - "+k+mark+"\\n";
      }
    }
  });
  if (!found) out += "- No skinned meshes with morph targets found.\\n";
  out += "Jaw: "+(jaw?jaw.name:"none")+"\\n";
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
