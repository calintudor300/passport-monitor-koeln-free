const CACHE='passport-monitor-free-v2';
const SHELL=['/','/style.css','/app.js','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 const r=e.request,u=new URL(r.url);
 if(r.method!=='GET'||u.origin!==self.location.origin||u.pathname.startsWith('/api/'))return;
 if(r.mode==='navigate'){e.respondWith(fetch(r).catch(()=>caches.match('/')));return;}
 e.respondWith(caches.match(r).then(hit=>hit||fetch(r)));
});
self.addEventListener('push',e=>{
 e.waitUntil((async()=>{
  let title='🔔 Passport Monitor Köln',body='Проверьте очередь: возможно, появились свободные даты.';
  try{
   const res=await fetch('/api/status',{credentials:'include',cache:'no-store'});
   if(res.ok){const data=await res.json();
    if(data.monitor?.status==='available'){
      title='🟢 Свободные даты — Köln!';
      body='Доступны даты: '+(data.monitor.dates||[]).slice(0,4).join(', ')+'. Откройте официальный сайт.';
    } else if(data.monitor?.status==='no_slots') {body='Тест уведомления: монитор работает.';}
   }
  }catch(_e){}
  await self.registration.showNotification(title,{body,icon:'/icons/icon-192.png',badge:'/icons/badge.png',
    tag:'passport-monitor-availability',renotify:true,requireInteraction:true,
    data:{url:'https://cologne.pasport.org.ua/solutions/e-queue'}});
 })());
});
self.addEventListener('notificationclick',e=>{
 e.notification.close();
 e.waitUntil(self.clients.openWindow(e.notification.data?.url||'https://cologne.pasport.org.ua/solutions/e-queue'));
});
