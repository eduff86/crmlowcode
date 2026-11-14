import {randomUUID} from 'node:crypto';
import {validateGraph,evaluateCondition,nextNode,valueError} from '../src/shared/workflow.js';
export function createWorkflowEngine({endpoint,qrow,appData,loadRecord,can,member,notify,audit,fail}){
 async function assignees(t,s,w,definition,record){
  for(const n of w.nodes){if(n.type==='approval'){const m=await member(t,s,n.assigneeId);if(record&&!can({userId:m.user_id,role:m.role},definition,record,'read'))fail('Assignee '+n.label+' tidak memiliki akses baca record.');}if(n.type==='notify'&&n.recipient==='member')await member(t,s,n.recipientId);}
 }
 async function start(t,s,{a,v,r},w,trigger,requestId){
  const issues=validateGraph(w,v.definition);if(issues.length)fail(issues[0].message);await assignees(t,s,w,v.definition,r);
  const existing=await qrow(t,'SELECT * FROM workflow_runs WHERE app_id=$1 AND trigger_key=$2',[a.id,trigger]);if(existing){if(existing.record_id!==r.id||existing.workflow_key!==w.key)fail('Idempotency key sudah dipakai proses lain.',409);return {id:existing.id};}
  if(await qrow(t,"SELECT 1 FROM workflow_runs WHERE record_id=$1 AND workflow_key=$2 AND status IN ('queued','running','waiting_approval')",[r.id,w.key]))fail('Proses ini masih berjalan untuk record tersebut.',409);
  const id=randomUUID(),startKey=w.nodes.find(n=>n.type==='start').key;
  const context={engine:'graph-v1',snapshot:r.data,expectedRevision:r.revision,workflow:w,history:[],variables:{},wait:null};
  await t.query('INSERT INTO workflow_runs(tenant_id,id,app_id,record_id,app_version_id,workflow_key,trigger_key,started_by,cursor,context) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[s.tenantId,id,a.id,r.id,v.id,w.key,trigger,s.userId,startKey,JSON.stringify(context)]);
  await enqueue(t,s,id,'0');await audit(t,s,'workflow.submitted','record',r.id,{workflowKey:w.key},requestId);return {id};
 }
 async function enqueue(t,s,id,key,delay=0){await t.query("INSERT INTO outbox_events(tenant_id,event_key,type,payload,available_at) VALUES ($1,$2,'workflow.graph',$3,now()+($4*interval '1 second'))",[s.tenantId,'graph:'+id+':'+key,JSON.stringify({runId:id}),delay]);}
 async function execute(t,s,run,r){
  if(!r)fail('Record proses tidak ditemukan.');const c=structuredClone(run.context),w=c.workflow,n=w.nodes.find(n=>n.key===run.cursor);if(!n)fail('Cursor node tidak ditemukan.');
  const pinned=await qrow(t,'SELECT definition FROM app_versions WHERE id=$1',[run.app_version_id]);
  if(r.revision!==c.expectedRevision){await t.query("UPDATE workflow_runs SET status='conflict',error_code='REVISION_CONFLICT',updated_at=now() WHERE id=$1",[run.id]);await notify(t,s,r.owner_id,'conflict',{title:r.data.name||w.label,recordId:r.id,runId:run.id},'conflict:'+run.id);await audit(t,s,'workflow.conflict','record',r.id,{nodeKey:n.key});return;}
  let branch,result,status='running',delay=0;
  if(n.type==='approval'){
   if(c.wait!==n.key){const m=await member(t,s,n.assigneeId);const {v}=await appData(t,s,r.app_id);if(!can({userId:m.user_id,role:m.role},v.definition,r,'read'))fail('Assignee kehilangan izin baca.');
    await t.query('INSERT INTO approval_tasks(tenant_id,run_id,node_key,assignee_id) VALUES ($1,$2,$3,$4) ON CONFLICT(tenant_id,run_id,node_key) DO NOTHING',[s.tenantId,run.id,n.key,n.assigneeId]);
    c.wait=n.key;c.history.push({nodeKey:n.key,type:n.type,label:n.label,status:'waiting',at:new Date().toISOString(),assigneeId:n.assigneeId});
    await t.query("UPDATE workflow_runs SET status='waiting_approval',context=$1,updated_at=now() WHERE id=$2",[JSON.stringify(c),run.id]);
    await notify(t,s,n.assigneeId,'approval',{title:r.data.name||w.label,recordId:r.id,runId:run.id,nodeKey:n.key},'approval:'+run.id+':'+n.key);await audit(t,s,'approval.requested','record',r.id,{nodeKey:n.key});return;
   }
   const task=await qrow(t,'SELECT * FROM approval_tasks WHERE run_id=$1 AND node_key=$2',[run.id,n.key]);if(!task||task.status==='pending')return;
   branch=task.status;if(!['approved','rejected'].includes(branch))fail('Tugas dibatalkan.');result=branch;c.variables[n.key]=branch;c.wait=null;delete c.decision;
  }
  if(n.type==='condition'){branch=evaluateCondition(n,r.data)?'true':'false';result=branch;}
  if(n.type==='set_field'){
   const f=pinned.definition.entities.find(e=>e.key===r.entity_key)?.fields.find(f=>f.key===n.field);const {v}=await appData(t,s,r.app_id);const activeField=v?.definition.entities.find(e=>e.key===r.entity_key)?.fields.find(f=>f.key===n.field);const err=valueError(f,n.value)||valueError(activeField,n.value);if(err)fail(err);
   const next={...r.data,[n.field]:f.type==='integer'?Number(n.value):n.value};await t.query('UPDATE records SET data=$1,revision=revision+1,updated_at=now(),updated_by=$2 WHERE id=$3',[JSON.stringify(next),s.userId,r.id]);c.expectedRevision=r.revision+1;result=n.field+' = '+String(n.value);await audit(t,s,'workflow.data_updated','record',r.id,{nodeKey:n.key,field:n.field});
  }
  if(n.type==='notify'){const recipient=n.recipient==='record_owner'?r.owner_id:n.recipient==='initiator'?run.started_by:n.recipientId;await member(t,s,recipient);const m=await qrow(t,'SELECT * FROM memberships WHERE user_id=$1',[recipient]);const {v}=await appData(t,s,r.app_id);if(!can({role:m.role,userId:recipient},v.definition,r,'read'))fail('Penerima notifikasi tidak memiliki akses baca record.');await notify(t,s,recipient,'workflow_message',{title:r.data.name||w.label,message:n.message,recordId:r.id,runId:run.id},'node:'+run.id+':'+n.key);result=n.message;}
  if(n.type==='timer'){
   if(c.wait!==n.key){c.wait=n.key;c.dueAt=new Date(Date.now()+Number(n.seconds)*1000).toISOString();c.history.push({nodeKey:n.key,type:n.type,label:n.label,status:'waiting',at:new Date().toISOString(),result:c.dueAt});await t.query("UPDATE workflow_runs SET status='running',context=$1,updated_at=now() WHERE id=$2",[JSON.stringify(c),run.id]);await enqueue(t,s,run.id,'timer:'+n.key,Number(n.seconds));return;}
   c.wait=null;delete c.dueAt;result='Timer elapsed';
  }
  c.history.push({nodeKey:n.key,type:n.type,label:n.label,status:'completed',at:new Date().toISOString(),result});
  const next=n.type==='end'?null:nextNode(w,n,branch);if(!next&&n.type!=='end')fail('Node tidak memiliki jalur berikutnya.');if(!next)status='completed';
  await t.query('UPDATE workflow_runs SET status=$1,cursor=$2,context=$3,updated_at=now() WHERE id=$4',[status,next||n.key,JSON.stringify(c),run.id]);
  if(next)await enqueue(t,s,run.id,String(c.history.length));else{await notify(t,s,r.owner_id,'result',{title:r.data.name||w.label,recordId:r.id,runId:run.id,result:'completed'},'complete:'+run.id);await audit(t,s,'workflow.completed','record',r.id,{workflowKey:w.key});}
 }
 endpoint('post','/api/records/:id/start',async(t,req,s)=>{const data=await loadRecord(t,s,req.params.id,'update');const w=data.v.definition.workflows?.find(w=>w.key===req.body.workflowKey&&w.enabled&&w.entity===data.r.entity_key&&w.nodes&&w.trigger==='manual_submit');if(!w)fail('Workflow published aktif tidak ditemukan.',404);const trigger=req.get('idempotency-key');if(!trigger||trigger.length>100)fail('Idempotency-Key wajib.');const replay=await qrow(t,'SELECT id FROM workflow_runs WHERE app_id=$1 AND trigger_key=$2',[data.a.id,trigger]);if(!replay&&data.r.revision!==req.body.revision)fail('Record berubah. Muat ulang.',409);return start(t,s,data,w,trigger,req.requestId);});
 endpoint('post','/api/runs/:id/cancel',async(t,req,s)=>{if(s.role==='member')fail('Hanya admin dapat membatalkan proses.',403);const run=await qrow(t,'SELECT * FROM workflow_runs WHERE id=$1 FOR UPDATE',[req.params.id]);if(!run)fail('Proses tidak ditemukan.',404);if(!['queued','running','waiting_approval'].includes(run.status))fail('Proses sudah berakhir.',409);
  await t.query("UPDATE workflow_runs SET status='canceled',updated_at=now() WHERE id=$1",[run.id]);await t.query("UPDATE approval_tasks SET status='canceled',decided_by=$1,decided_at=now(),decision_note='Proses dibatalkan admin' WHERE run_id=$2 AND status='pending'",[s.userId,run.id]);await t.query("UPDATE outbox_events SET status='done' WHERE payload->>'runId'=$1 AND status='pending'",[run.id]);await audit(t,s,'workflow.canceled','workflow',run.id,{},req.requestId);return {ok:true};});
 endpoint('post','/api/runs/:id/retry',async(t,req,s)=>{if(s.role==='member')fail('Hanya admin dapat retry.',403);const run=await qrow(t,'SELECT * FROM workflow_runs WHERE id=$1 FOR UPDATE',[req.params.id]);if(!run||run.context.engine!=='graph-v1')fail('Instance graph tidak ditemukan.',404);if(run.status!=='failed')fail('Retry hanya untuk failed. Conflict harus diajukan ulang.',409);const {r}=await loadRecord(t,s,run.record_id);if(r.revision!==run.context.expectedRevision)fail('Record sudah berubah. Ajukan proses baru setelah meninjau data.',409);
  await t.query("UPDATE outbox_events SET status='done' WHERE payload->>'runId'=$1 AND status IN ('pending','dead')",[run.id]);await t.query("UPDATE workflow_runs SET status='queued',error_code=NULL,updated_at=now() WHERE id=$1",[run.id]);await enqueue(t,s,run.id,'retry:'+randomUUID());await audit(t,s,'workflow.retried','workflow',run.id,{},req.requestId);return {ok:true};});
 endpoint('get','/api/apps/:id/versions',async(t,req,s)=>{if(s.role==='member')fail('Hanya admin dapat melihat versi.',403);await appData(t,s,req.params.id);return {versions:(await t.query('SELECT id,version_no,status,revision,created_at,published_at,definition FROM app_versions WHERE app_id=$1 ORDER BY version_no DESC',[req.params.id])).rows};});
 endpoint('post','/api/apps/:id/restore-draft',async(t,req,s)=>{if(s.role==='member')fail('Hanya admin dapat memulihkan draft.',403);const {draft}=await appData(t,s,req.params.id);if(req.body.revision!==draft.revision)fail('Draft berubah. Muat ulang.',409);const version=await qrow(t,"SELECT definition FROM app_versions WHERE app_id=$1 AND id=$2 AND status='published'",[req.params.id,req.body.versionId]);if(!version)fail('Versi terbit tidak ditemukan.',404);await t.query('UPDATE app_versions SET definition=$1,revision=revision+1 WHERE id=$2',[JSON.stringify(version.definition),draft.id]);await audit(t,s,'draft.restored','app',req.params.id,{versionId:req.body.versionId},req.requestId);return {ok:true};});
 return {start,execute,assignees};
}
