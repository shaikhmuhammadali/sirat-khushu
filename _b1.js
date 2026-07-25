
'use strict';
(function(){
  // deep-link scroll for manifest shortcuts (reuses existing #pgrid / #events ids)
  window.addEventListener('load', function(){
    if (location.hash){
      var el = null; try{ el = document.querySelector(location.hash); }catch(e){}
      if (el) setTimeout(function(){ el.scrollIntoView({behavior:'smooth', block:'start'}); }, 350);
    }
  });

  if (!('serviceWorker' in navigator)) return;   // feature-detected — no errors on unsupported browsers

  function showUpdateToast(worker){
    if (document.getElementById('pwaToast')) return;
    var t = document.createElement('div'); t.id = 'pwaToast';
    var s = document.createElement('span'); s.textContent = 'A new version is ready.';
    var b = document.createElement('button'); b.type = 'button'; b.textContent = 'Reload';
    b.addEventListener('click', function(){ if (worker) worker.postMessage({type:'SKIP_WAITING'}); });
    t.appendChild(s); t.appendChild(b); document.body.appendChild(t);
    requestAnimationFrame(function(){ t.classList.add('show'); });
  }

  window.addEventListener('load', function(){
    navigator.serviceWorker.register('service-worker.js').then(function(reg){
      function apply(worker){ if (worker) try{ worker.postMessage({type:'SKIP_WAITING'}); }catch(e){} }
      function track(worker){
        if (!worker) return;
        worker.addEventListener('statechange', function(){
          if (worker.state === 'installed' && navigator.serviceWorker.controller) apply(worker);
        });
      }
      if (reg.waiting && navigator.serviceWorker.controller) apply(reg.waiting);
      reg.addEventListener('updatefound', function(){ track(reg.installing); });
      try{ reg.update(); }catch(e){}
      setInterval(function(){ try{ reg.update(); }catch(e){} }, 1800000);
      document.addEventListener('visibilitychange', function(){ if (document.visibilityState === 'visible'){ try{ reg.update(); }catch(e){} } });
    }).catch(function(){ /* SW blocked/unsupported — the app still works fully */ });

    // Guard the classic first-install reload: clients.claim() fires a controllerchange
    // on the very first visit (no prior controller). Only reload when an EXISTING
    // controller is replaced (a genuine update), never on first control acquisition.
    var hadController = !!navigator.serviceWorker.controller;
    var reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function(){
      if (reloaded || !hadController){ hadController = true; return; }
      reloaded = true; window.location.reload();
    });
  });
})();
