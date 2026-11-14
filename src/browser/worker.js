import {PGlite} from '@electric-sql/pglite';
import wasmUrl from '../../node_modules/@electric-sql/pglite/dist/pglite.wasm?url';
import dataUrl from '../../node_modules/@electric-sql/pglite/dist/pglite.data?url';
import schema from '../../server/schema.sql?raw';
import {createRuntime} from '../../server/core.js';
import express from './express';
let sessionCookie='';
const ready=(async()=>{
 const [wasm,fsBundle]=await Promise.all([fetch(wasmUrl).then(r=>{if(!r.ok)throw Error('Database download failed');return r.arrayBuffer();}).then(WebAssembly.compile),fetch(dataUrl).then(r=>{if(!r.ok)throw Error('Database download failed');return r.blob();})]);
 const db=new PGlite('idb://flowbase-github-demo-v1',{wasmModule:wasm,fsBundle});
 return createRuntime({db,express,schema});
})();
ready.catch(()=>{});
self.onmessage=async({data})=>{
 const {id,url,options={}}=data;
 try{
  const runtime=await ready;
  const result=await runtime.app.request({url,...options,headers:{...options.headers,cookie:sessionCookie}});
  if(result.headers['set-cookie'])sessionCookie=result.headers['set-cookie'];
  self.postMessage({id,result});
 }catch{
  self.postMessage({id,error:'Database lokal tidak dapat dibuka. Gunakan browser modern, izinkan penyimpanan situs, dan tutup tab demo lain sebelum memuat ulang.'});
 }
};
