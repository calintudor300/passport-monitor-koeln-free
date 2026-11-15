'use strict';
const $=id=>document.getElementById(id);
let authenticated=false;
let lastStatus=null;
let deferredInstall=null;
let currentlyLoading=false;
let toastTimer=null;
const queueUrl='https://cologne.pasport.org.ua/solutions/e-queue';
const timeFmt=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Berlin',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
const statuses={
  available:{title:'Свободные даты найдены!',description:'Откройте официальный сайт прямо сейчас, пока запись доступна.',badge:'МЕСТА ЕСТЬ',kind:'available'},
  no_slots:{title:'Свободных мест пока нет',description:'Новые даты появляются в случайное время. Продолжаем проверять.',badge:'МЕСТ НЕТ',kind:'no-slots'},
  blocked:{title:'Сайт ограничил проверку',description:'Защита сайта или временная блокировка. Проверка повторится позже.',badge:'НУЖНО ВНИМАНИЕ',kind:'error'},
  unknown:{title:'Не удалось определить наличие мест',description:'Страница не вернула достоверный результат. Это не означает, что мест нет.',badge:'НЕИЗВЕСТНО',kind:'error'},
  error:{title:'Ошибка при проверке',description:'Не удалось связаться с сайтом. Попробуем ещё раз автоматически.',badge:'ОШИБКА',kind:'error'}
};
function showToast(msg,bad=false){const t=$('toast');t.textContent=msg;t.classList.toggle('bad',bad);t.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.add('hidden'),4200)}
async function api(url,options={}){
  const r=await fetch(url,{credentials:'same-origin',headers:{'Content-Type':'application/json'},cache:'no-store',...options});
  let data;try{data=await r.json()}catch{data={error:'Ошибка ответа сервера'};}
  if(r.status===401 && url!=='/api/login'){setAuth(false);throw Error('Сессия закончилась. Войдите заново.');}
  if(!r.ok)throw Error(data.error||`Ошибка ${r.status}`);
  return data;
}
function send(url,body={}){return api(url,{method:'POST',body:JSON.stringify(body)});}
function setAuth(ok){authenticated=ok;$('login').classList.toggle('hidden',ok);$('dashboard').classList.toggle('hidden',!ok);$('logoutBtn').classList.toggle('hidden',!ok);if(!ok)$('password').value='';}
function formatDate(s){try{return timeFmt.format(new Date(s))}catch{return '—'}}
function uiStatus(data){
 const info=statuses[data.monitor?.status]||statuses.unknown;
 $('statusBadge').textContent=info.badge;
 $('statusBadge').className='small-badge'+(info.kind==='available'?'':info.kind==='no-slots'?' negative':' error');
 $('statusTitle').textContent=info.title;
 $('statusDescription').textContent=data.monitor?.reason || info.description;
 $('radar').className='radar '+(info.kind==='available'?'available':info.kind==='no-slots'?'no-slots':info.kind==='error'?'error':'radar-loading');
 $('lastChecked').textContent=data.monitor?.checkedAt?'Последняя проверка: '+formatDate(data.monitor.checkedAt)+' (Кёльн)':'Ожидаем первую проверку';
 $('intervalText').textContent=`Автопроверка примерно каждые ${Math.round(data.intervalSeconds/60*10)/10} мин (может задерживаться).`;
 $('checkBtn').disabled=false;
 $('checkBtn').textContent='Обновить статус ↗';
 const dates=info.kind==='available'?data.monitor.dates||[]:[];
 $('datesBox').classList.toggle('hidden',!dates.length);
 $('datesList').replaceChildren();
 dates.forEach(d=>{const item=document.createElement('span');item.className='date-chip';item.textContent=d;$('datesList').append(item);});
 document.querySelector('.pill').lastChild.textContent=data.enabled?' LIVE MONITOR':' ПАУЗА';
 $('monitorToggle').setAttribute('aria-checked',String(data.enabled));
 $('monitorToggleSubtitle').textContent=data.enabled?'Проверка продолжается на сервере, даже когда телефон заблокирован.':'Мониторинг приостановлен. Новые места не отслеживаются.';
 const history=$('historyList');history.replaceChildren();
 if(!data.history?.length){const empty=document.createElement('div');empty.className='history-empty';empty.textContent='История появится после первой проверки.';history.append(empty);}
 else data.history.forEach(h=>{
  const item=document.createElement('div');item.className='history-item';
  const dot=document.createElement('span');dot.className='history-dot '+h.status;
  const content=document.createElement('div');content.className='history-content';
  const strong=document.createElement('strong');strong.textContent=statuses[h.status]?.title || 'Результат проверки';
  const small=document.createElement('small');small.textContent=h.dates?.length?h.dates.slice(0,5).join(', '):h.reason||'';
  const time=document.createElement('span');time.className='history-time';time.textContent=formatDate(h.at);
  content.append(strong,small);item.append(dot,content,time);history.append(item);
 });
}
async function refresh(){if(!authenticated||currentlyLoading)return;currentlyLoading=true;try{const status=await api('/api/status');lastStatus=status;uiStatus(status);}catch(e){showToast(e.message,true);}finally{currentlyLoading=false;}}
function b64ToUint8(b64){const pad='='.repeat((4-b64.length%4)%4);const binary=atob((b64+pad).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(binary,c=>c.charCodeAt(0));}
async function serviceWorker(){if(!('serviceWorker' in navigator))throw Error('Этот браузер не поддерживает PWA');await navigator.serviceWorker.register('/sw.js');return navigator.serviceWorker.ready;}
async function existingSubscription(){if(!('serviceWorker' in navigator)||!('PushManager' in window))return null;const reg=await serviceWorker();return reg.pushManager.getSubscription();}
async function syncPushUI(){
 try{const sub=await existingSubscription();const on=Boolean(sub)&&Notification.permission==='granted';$('notifyDot').classList.toggle('on',on);$('notifyText').textContent=on?'Уведомления включены':'Уведомления выключены';$('enablePushBtn').textContent=on?'Отключить уведомления ↗':'Включить уведомления →';$('testPushBtn').classList.toggle('hidden',!on);if(on&&authenticated)await send('/api/subscribe',{subscription:sub});}
 catch(e){$('notifyText').textContent='Push недоступен в этом браузере';}
}
async function togglePush(){
 const btn=$('enablePushBtn');btn.disabled=true;
 try{
  if(!('Notification' in window)||!('PushManager' in window))throw Error('Push не поддерживается. На iPhone сначала добавьте сайт на главный экран.');
  const reg=await serviceWorker();
  const old=await reg.pushManager.getSubscription();
  if(old){await send('/api/unsubscribe',{endpoint:old.endpoint});await old.unsubscribe();showToast('Уведомления выключены');}
  else{
   const p=await Notification.requestPermission();
   if(p!=='granted')throw Error('Разрешите уведомления в настройках браузера или приложения.');
   const {publicKey}=await api('/api/vapid');
   const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToUint8(publicKey)});
   await send('/api/subscribe',{subscription:sub});showToast('Готово! Push-уведомления включены.');
  }
  await syncPushUI();
 }catch(e){showToast(e.message,true);}finally{btn.disabled=false;}
}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();const btn=e.currentTarget.querySelector('button');btn.disabled=true;$('loginError').classList.add('hidden');try{await send('/api/login',{password:$('password').value});setAuth(true);await refresh();await syncPushUI();}catch(err){$('loginError').textContent=err.message;$('loginError').classList.remove('hidden');}finally{btn.disabled=false;}});
$('logoutBtn').addEventListener('click',async()=>{try{await send('/api/logout');}finally{setAuth(false);}});
$('enablePushBtn').addEventListener('click',togglePush);
$('testPushBtn').addEventListener('click',async()=>{try{await send('/api/push-test');showToast('Тестовое уведомление отправлено.');}catch(e){showToast(e.message,true);}});
$('checkBtn').addEventListener('click',async()=>{await refresh();showToast('Статус обновлён. Проверки сайта запускаются по расписанию GitHub.');});
$('monitorToggle').addEventListener('click',async()=>{const enabled=!lastStatus?.enabled;try{await send('/api/settings',{enabled});showToast(enabled?'Мониторинг включён':'Мониторинг приостановлен');await refresh();}catch(e){showToast(e.message,true);}});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('installBtn').classList.remove('hidden');});
$('installBtn').addEventListener('click',async()=>{if(deferredInstall){deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('installBtn').classList.add('hidden');}});
window.addEventListener('appinstalled',()=>{$('installBtn').classList.add('hidden');});
(async()=>{try{await serviceWorker();}catch(e){console.warn(e);}try{const me=await api('/api/me');setAuth(me.authenticated);if(me.authenticated){await refresh();await syncPushUI();}}catch(e){setAuth(false);}setInterval(()=>{if(authenticated)refresh();},10000);})();
