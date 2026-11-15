'use strict';
const {checkAvailability} = require('../src/monitor.cjs');
const workerUrl=(process.env.WORKER_URL||'').replace(/\/$/,'');
const token=process.env.MONITOR_TOKEN;
if(!/^https:\/\//.test(workerUrl) || !token){
  console.error('Set GitHub Actions Secrets WORKER_URL and MONITOR_TOKEN');process.exit(1);
}
async function request(path, method='GET', body=undefined){
  const res=await fetch(workerUrl+path,{
    method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)
  });
  if(!res.ok)throw Error(`${path}: ${res.status} ${(await res.text()).slice(0,100)}`);
  return res.json();
}
(async()=>{
  const config=await request('/api/config');
  if(!config.enabled){console.log('Monitoring paused. Skipped official website.');return;}
  let outcome;
  try{outcome=await checkAvailability();}
  catch(error){outcome={status:'error',dates:[],reason:String(error.message||error).slice(0,160)};}
  if(!['available','no_slots','unknown','blocked','error'].includes(outcome.status))throw Error('Unexpected status');
  outcome.checkedAt=new Date().toISOString();
  const response=await request('/api/ingest','POST',outcome);
  console.log('Result:',outcome.status, 'dates:',outcome.dates.join(', '));
  console.log('Status saved; push attempts:',response.pushSent||0);
})().catch(err=>{console.error(err);process.exitCode=1;});
