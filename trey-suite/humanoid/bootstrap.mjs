const logEl = document.getElementById("log");
function log(s){ logEl.textContent = (logEl.textContent?logEl.textContent+"\n":"")+s; }
log("🔧 bootstrap.mjs start");
import("./app.mjs?v="+Date.now())
  .then(()=>log("✅ app.mjs imported"))
  .catch(e=>log("❌ import failed: "+((e && e.message) ? e.message : String(e))));
