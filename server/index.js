import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRuntime} from './core.js';
export {uid,template} from './core.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function createServer({dataDir = process.env.DATA_DIR || '/tmp/flowbase-mvp-data',seed=true}={}) {
 const db = new PGlite(dataDir);
 const runtime = await createRuntime({db,express,schema:await fs.readFile(path.join(root,'server/schema.sql'),'utf8'),seed});
 runtime.app.use(express.static(path.join(root,'dist')));
 runtime.app.get('/{*splat}',(req,res)=>{if(req.path.startsWith('/api/'))return res.status(404).json({message:'Endpoint tidak ditemukan.'});res.sendFile(path.join(root,'dist/index.html'));});
 return runtime;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){if(process.env.DEMO_MODE==='false')throw Error('Mode produksi belum tersedia: implementasikan autentikasi OIDC sebelum menonaktifkan demo.');const server=await createServer();const http=server.app.listen(3000,'0.0.0.0',()=>console.log('Flowbase DEMO ready on port 3000'));let stopping=false;const shutdown=()=>{if(stopping)return;stopping=true;http.close(async()=>{await server.close();process.exit(0);});};process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);}
