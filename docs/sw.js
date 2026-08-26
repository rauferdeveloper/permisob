const CACHE='aeol-b-v7';
const CORE=['./','index.html','styles.css?v=7','app.js?v=7','manifest.webmanifest','icon.svg'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE).catch(()=>{})))});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET') return;
  const isImage=u.pathname.includes('/images/');
  if(isImage){e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{if(resp.ok)caches.open(CACHE).then(c=>c.put(e.request,resp.clone()));return resp})));return;}
  e.respondWith(fetch(e.request).then(resp=>{if(resp.ok&&u.origin===location.origin)caches.open(CACHE).then(c=>c.put(e.request,resp.clone()));return resp}).catch(()=>caches.match(e.request)));
});
