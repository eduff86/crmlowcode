export const isBrowserDemo=import.meta.env.BROWSER_DEMO;
let start;
function getWorker(){
 if(start)return start;
 start=new Promise((resolve,reject)=>{
  if(!globalThis.Worker||!globalThis.indexedDB||!navigator.locks){reject(Error('Demo memerlukan browser modern dengan IndexedDB dan Web Locks.'));return;}
  navigator.locks.request('flowbase-github-demo-v1',{ifAvailable:true},lock=>{
   if(!lock){reject(Error('Demo sudah terbuka di tab lain. Tutup tab tersebut, lalu muat ulang halaman ini.'));return;}
   const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
   const pending=new Map();let sequence=0;
   worker.onmessage=({data})=>{const task=pending.get(data.id);if(!task)return;pending.delete(data.id);clearTimeout(task.timer);if(data.error)task.reject(Error(data.error));else task.resolve(data.result);};
   worker.onerror=()=>{for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('Mesin demo gagal dimuat. Muat ulang halaman untuk mencoba lagi.'));}pending.clear();};
   resolve((url,options)=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Database lokal belum siap. Tunggu sebentar lalu coba lagi.'));},90000);pending.set(id,{resolve,reject,timer});worker.postMessage({id,url,options});}));
   return new Promise(()=>{});
  }).catch(reject);
 });
 return start;
}
export async function demoRequest(url,options){
 const request=await getWorker();
 const result=await request(url,options);
 return {ok:result.status>=200&&result.status<300,status:result.status,json:async()=>result.data};
}
