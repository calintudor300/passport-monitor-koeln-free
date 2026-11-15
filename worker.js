// Cloudflare Worker: static PWA + personal status + Web Push (empty-payload VAPID).
const textEncoder=new TextEncoder();
const apiTarget='https://cologne.pasport.org.ua/solutions/e-queue';
const service='Закордонний паспорт та (або) ID-картка';
const cookieName='__Host-PassportAuth';
const stateKey='passport-state-v1';
const subsKey='passport-subscriptions-v1';
const intervalSeconds=900;
const allowedStatuses=new Set(['available','no_slots','unknown','blocked','error']);
const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{
 status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...extra}
});
const err=(message,status)=>json({error:message},status);
function defaultState(){return {enabled:true,monitor:{status:'unknown',dates:[],reason:'Ожидание первой проверки',checkedAt:null},history:[],lastAlertFingerprint:'',lastAlertTime:null};}
function b64url(bytes){let s='';for(const b of new Uint8Array(bytes))s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function unb64(s){let t=s.replace(/-/g,'+').replace(/_/g,'/');t+='='.repeat((4-t.length%4)%4);return Uint8Array.from(atob(t),x=>x.charCodeAt(0));}
function equal(a,b){a=String(a||'');b=String(b||'');if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
async function hmac(secret,data){const key=await crypto.subtle.importKey('raw',textEncoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64url(await crypto.subtle.sign('HMAC',key,textEncoder.encode(data)));}
function getCookie(request){const all=request.headers.get('Cookie')||'';return all.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';}
async function authorized(request,env){if(!env.SESSION_SECRET)return false;const pair=getCookie(request).split('.');if(pair.length!==2)return false;const expiry=Number(pair[0]);if(!Number.isSafeInteger(expiry)||expiry<Date.now())return false;return equal(pair[1],await hmac(env.SESSION_SECRET,pair[0]));}
function internal(request,env){const h=request.headers.get('Authorization')||'';return !!env.MONITOR_TOKEN && h.startsWith('Bearer ') && equal(h.slice(7),env.MONITOR_TOKEN);}
async function getState(env){const state=await env.DATA.get(stateKey,'json');return state && typeof state==='object'?{...defaultState(),...state}:defaultState();}
async function putState(env,state){await env.DATA.put(stateKey,JSON.stringify(state));}
async function getSubs(env){const val=await env.DATA.get(subsKey,'json');return Array.isArray(val)?val:[];}
async function putSubs(env,subs){await env.DATA.put(subsKey,JSON.stringify(subs.slice(-6)));}
function safeSub(value){if(!value || typeof value.endpoint!=='string'||value.endpoint.length>2048)return false;
 let u;try{u=new URL(value.endpoint);}catch{return false;}
 return u.protocol==='https:' && ['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com','push.services.mozilla.com'].includes(u.hostname);
}
async function vapidAuth(endpoint,env){
 if(!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_D || !env.VAPID_SUBJECT)throw new Error('VAPID configuration missing');
 const pub=unb64(env.VAPID_PUBLIC_KEY);
 if(pub.length!==65||pub[0]!==4)throw new Error('Invalid VAPID public key');
 const jwk={kty:'EC',crv:'P-256',x:b64url(pub.slice(1,33)),y:b64url(pub.slice(33,65)),d:env.VAPID_PRIVATE_D,key_ops:['sign'],ext:true};
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const target=new URL(endpoint),aud=target.origin;
 const header=b64url(textEncoder.encode(JSON.stringify({typ:'JWT',alg:'ES256'})));
 const payload=b64url(textEncoder.encode(JSON.stringify({aud,exp:Math.floor(Date.now()/1000)+12*3600,sub:env.VAPID_SUBJECT})));
 const input=header+'.'+payload;
 const signature=b64url(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,textEncoder.encode(input)));
 return `vapid t=${input}.${signature}, k=${env.VAPID_PUBLIC_KEY}`;
}
async function pushAll(env){
 const subs=await getSubs(env);if(!subs.length)return {sent:0,failed:0};
 let sent=0,failed=0;const stale=[];
 for(const sub of subs){
  try{
   const auth=await vapidAuth(sub.endpoint,env);
   const response=await fetch(sub.endpoint,{method:'POST',headers:{Authorization:auth,TTL:'180',Urgency:'high'},signal:AbortSignal.timeout(12000)});
   if(response.ok || response.status===201 || response.status===202){sent++;}
   else{failed++;if(response.status===404||response.status===410)stale.push(sub.endpoint);}
  }catch(e){failed++;console.warn('WebPush failure:',String(e));}
 }
 if(stale.length)await putSubs(env,subs.filter(s=>!stale.includes(s.endpoint)));
 return {sent,failed};
}
async function readJson(request){const len=Number(request.headers.get('Content-Length')||'0');if(len>10000)throw Error('Request too large');return request.json();}
function sameOrigin(request){const origin=request.headers.get('Origin');return !origin || origin===new URL(request.url).origin;}
export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(!path.startsWith('/api/'))return env.ASSETS.fetch(request);
  try{
   if(!env.DATA || !env.APP_PASSWORD || !env.SESSION_SECRET || !env.MONITOR_TOKEN) return err('Cloudflare secrets/KV not configured',503);
   if(method==='POST' && !sameOrigin(request) && path!=='/api/ingest')return err('Invalid origin',403);
   if(path==='/api/health' && method==='GET')return json({ok:true});
   if(path==='/api/config' && method==='GET'){
    if(!internal(request,env))return err('Unauthorized',401);
    const state=await getState(env);return json({enabled:state.enabled});
   }
   if(path==='/api/ingest' && method==='POST'){
    if(!internal(request,env))return err('Unauthorized',401);
    const data=await readJson(request),status=String(data?.status||'');
    if(!allowedStatuses.has(status))return err('Invalid status',400);
    const dates=Array.isArray(data.dates)?data.dates.filter(x=>typeof x==='string'&&x.length<=100).slice(0,45):[];
    const outcome={status,dates,reason:String(data.reason||'').slice(0,240),checkedAt:new Date().toISOString()};
    const state=await getState(env),prior=state.monitor;
    if(!state.enabled)return json({ok:true,skipped:true});
    state.monitor=outcome;
    if(prior.status!==status || JSON.stringify(prior.dates)!==JSON.stringify(dates)){
      state.history=[{status,dates,reason:outcome.reason,at:outcome.checkedAt},...(state.history||[])].slice(0,25);
    }
    if(status==='no_slots')state.lastAlertFingerprint='';
    const fingerprint=dates.join('|');
    const shouldAlert=status==='available' && dates.length>0 && (
      fingerprint!==state.lastAlertFingerprint || prior.status==='no_slots');
    await putState(env,state);
    let result={sent:0};
    if(shouldAlert){
      result=await pushAll(env);
      // Retry if no subscriber received a push, rather than silently losing a rare opening.
      if(result.sent>0){state.lastAlertFingerprint=fingerprint;state.lastAlertTime=outcome.checkedAt;await putState(env,state);}
    }
    return json({ok:true,pushSent:result.sent,pushFailed:result.failed||0});
   }
   if(path==='/api/login' && method==='POST'){
    const body=await readJson(request);
    if(!equal(body?.password,env.APP_PASSWORD))return err('Неверный пароль',401);
    const exp=String(Date.now()+30*24*60*60*1000),token=exp+'.'+await hmac(env.SESSION_SECRET,exp);
    return json({ok:true},200,{'Set-Cookie':`${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`});
   }
   if(path==='/api/me' && method==='GET')return json({authenticated:await authorized(request,env)});
   if(!(await authorized(request,env)))return err('Нужно войти в приложение',401);
   if(path==='/api/logout' && method==='POST')return json({ok:true},200,{'Set-Cookie':`${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`});
   if(path==='/api/vapid' && method==='GET')return json({publicKey:env.VAPID_PUBLIC_KEY||''});
   if(path==='/api/status' && method==='GET'){
    const state=await getState(env);const subs=await getSubs(env);
    return json({enabled:state.enabled,monitor:state.monitor,history:state.history,
      intervalSeconds,busy:false,subscriptionCount:subs.length,targetUrl:apiTarget,targetService:service,
      serverTime:new Date().toISOString()});
   }
   if(path==='/api/subscribe' && method==='POST'){
    const body=await readJson(request),sub=body?.subscription;
    if(!safeSub(sub))return err('Push-подписка не поддерживается или некорректна',400);
    const list=(await getSubs(env)).filter(s=>s.endpoint!==sub.endpoint);
    list.push({endpoint:sub.endpoint});await putSubs(env,list);
    return json({ok:true});
   }
   if(path==='/api/unsubscribe' && method==='POST'){
    const body=await readJson(request),endpoint=String(body?.endpoint||'');
    const list=(await getSubs(env)).filter(s=>s.endpoint!==endpoint);
    await putSubs(env,list);return json({ok:true});
   }
   if(path==='/api/push-test' && method==='POST'){
    const subs=await getSubs(env);if(!subs.length)return err('Сначала включите уведомления',400);
    const result=await pushAll(env);
    if(!result.sent)return err('Push не доставлен. Проверьте ключи VAPID и включённые уведомления.',502);
    return json({ok:true,...result});
   }
   if(path==='/api/settings' && method==='POST'){
    const body=await readJson(request);
    if(typeof body?.enabled!=='boolean')return err('Нужен enabled',400);
    const state=await getState(env);state.enabled=body.enabled;await putState(env,state);
    return json({ok:true,enabled:state.enabled});
   }
   return err('Not found',404);
  }catch(error){console.error('Worker error:',String(error));return err('Ошибка обработки запроса',500);}
 }
};
