export const nodeCatalog = {
 start:{label:'Start event',subtitle:'Mulai proses'},end:{label:'End event',subtitle:'Selesaikan proses'},approval:{label:'User task',subtitle:'Keputusan manusia'},condition:{label:'Exclusive gateway',subtitle:'Cabang kondisi'},set_field:{label:'Data task',subtitle:'Ubah nilai field'},notify:{label:'Notification task',subtitle:'Inbox aplikasi'},timer:{label:'Timer event',subtitle:'Tunda secara durable'}
};
export function migrateWorkflow(w){
 if(w.nodes)return structuredClone(w);
 const node=(key,type,label,x,y,config={})=>({key,type,label,position:{x,y},...config});
 return {...w,format:'flowbase-graph-v1',nodes:[
 node('start','start','Pengajuan dimulai',40,60),
 node('threshold','condition','Periksa diskon',330,60,{field:'discount_percent',op:'gt',value:w.threshold||'10'}),
 node('manager','approval','Persetujuan manajer',620,60,{assigneeId:w.assigneeId}),
 node('accept','set_field','Setujui diskon',330,270,{field:'discount_status',value:'approved'}),
 node('decline','set_field','Tolak diskon',620,270,{field:'discount_status',value:'rejected'}),
 node('notice','notify','Beritahu pemilik',330,460,{recipient:'record_owner',message:'Pengajuan diskon selesai diproses.'}),
 node('end','end','Proses selesai',620,460)],edges:[
 {key:'e1',source:'start',target:'threshold'},
 {key:'e2',source:'threshold',target:'manager',branch:'true'},
 {key:'e3',source:'threshold',target:'accept',branch:'false'},
 {key:'e4',source:'manager',target:'accept',branch:'approved'},
 {key:'e5',source:'manager',target:'decline',branch:'rejected'},
 {key:'e6',source:'accept',target:'notice'},
 {key:'e7',source:'decline',target:'notice'},
 {key:'e8',source:'notice',target:'end'}]};
}
export function newWorkflow(entity,key,assigneeId){return {key,label:'Proses '+entity.label,entity:entity.key,format:'flowbase-graph-v1',trigger:'manual_submit',enabled:true,nodes:[{key:'start',type:'start',label:'Mulai',position:{x:80,y:120}},{key:'task',type:'approval',label:'Tinjau pengajuan',assigneeId,position:{x:360,y:120}},{key:'end',type:'end',label:'Selesai',position:{x:680,y:120}}],edges:[{key:'e1',source:'start',target:'task'},{key:'e2',source:'task',target:'end',branch:'approved'},{key:'e3',source:'task',target:'end',branch:'rejected'}]};}
export function valueError(f,value){
 if(!f)return 'Field tidak ditemukan.';
 if(value===null||value===undefined||value==='')return f.required?'Nilai wajib diisi.':null;
 if(f.type==='reference')return 'Data task reference belum didukung.';
 if(f.type==='boolean')return typeof value==='boolean'?null:'Gunakan nilai boolean.';
 if(['decimal','integer'].includes(f.type)){
  if(!/^-?\d+(\.\d{1,2})?$/.test(String(value))||!Number.isFinite(Number(value)))return 'Angka tidak valid (maksimum dua desimal).';
  if(f.type==='integer'&&!Number.isSafeInteger(Number(value)))return 'Bilangan bulat tidak valid.';
  if(String(value).replace(/[-.]/g,'').length>18)return 'Maksimum 18 digit.';
  if((f.min!=null&&Number(value)<Number(f.min))||(f.max!=null&&Number(value)>Number(f.max)))return 'Nilai di luar batas field.';
  return null;
 }
 if(typeof value!=='string')return 'Nilai teks diperlukan.';
 if(value.length>(f.maxLength||1000))return 'Nilai terlalu panjang.';
 if(f.type==='enum'&&!f.options?.includes(value))return 'Nilai tidak ada dalam enum.';
 if(f.type==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))return 'Email tidak valid.';
 if(f.type==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))return 'Tanggal tidak valid.';
 if(f.type==='datetime'&&!Number.isFinite(Date.parse(value)))return 'Datetime tidak valid.';
 return null;
}
export function validateGraph(w,definition){
 const issues=[];const add=(message,nodeKey)=>issues.push({message,nodeKey});
 const entity=definition.entities.find(e=>e.key===w.entity);
 if(!entity)add('Entitas workflow tidak ditemukan.');
 if(!/^[a-z][a-z0-9_]{0,62}$/.test(w.key))add('Key proses harus huruf kecil, unik, tanpa spasi.');
 if(!['manual_submit','record_created'].includes(w.trigger))add('Trigger tidak didukung.');
 if(!Array.isArray(w.nodes)||!Array.isArray(w.edges))return [{message:'Nodes dan edges wajib berupa array.'}];
 if(w.nodes.length>50||w.edges.length>100)add('Maksimum 50 node dan 100 koneksi per proses.');
 const ids=new Set();for(const n of w.nodes){if(!/^[a-z][a-z0-9_]{0,62}$/.test(n.key)||ids.has(n.key))add('Key node tidak valid/duplikat.',n.key);ids.add(n.key);if(!nodeCatalog[n.type])add('Tipe node tidak didukung.',n.key);if(!n.label||n.label.length>120)add('Label node wajib, maksimum 120 karakter.',n.key);
  if(!Number.isFinite(n.position?.x)||!Number.isFinite(n.position?.y))add('Posisi node tidak valid.',n.key);
  if(n.type==='approval'&&!/^[0-9a-f-]{36}$/i.test(n.assigneeId||''))add('Pilih assignee yang aktif.',n.key);
  if(n.type==='condition'){const f=entity?.fields.find(f=>f.key===n.field);if(!f||f.type==='reference')add('Pilih field kondisi yang didukung.',n.key);if(!['eq','ne','gt','gte','lt','lte','contains','is_empty'].includes(n.op))add('Operator kondisi tidak valid.',n.key);if(['gt','gte','lt','lte'].includes(n.op)&&!['integer','decimal'].includes(f?.type))add('Operator perbandingan angka hanya untuk field numerik.',n.key);if(n.op==='contains'&&!['text','long_text','email'].includes(f?.type))add('Contains hanya untuk field teks.',n.key);if(n.op!=='is_empty'&&f){const err=valueError({...f,required:true},n.value);if(err)add('Kondisi: '+err,n.key);}}
  if(n.type==='set_field'){const f=entity?.fields.find(f=>f.key===n.field);const err=valueError(f,n.value);if(err)add('Data task: '+err,n.key);}
  if(n.type==='timer'&&(!Number.isInteger(Number(n.seconds))||Number(n.seconds)<1||Number(n.seconds)>604800))add('Timer harus 1–604800 detik (7 hari).',n.key);
  if(n.type==='notify'){if(!['record_owner','initiator','member'].includes(n.recipient))add('Penerima notifikasi tidak valid.',n.key);if(n.recipient==='member'&&!/^[0-9a-f-]{36}$/i.test(n.recipientId||''))add('Pilih penerima notifikasi.',n.key);if(!n.message||n.message.length>500)add('Pesan wajib, maksimum 500 karakter.',n.key);}
 }
 const edgeIds=new Set();for(const e of w.edges){if(!e.key||edgeIds.has(e.key))add('Key koneksi duplikat.');edgeIds.add(e.key);if(!ids.has(e.source)||!ids.has(e.target))add('Koneksi menunjuk node yang tidak ada.');}
 const starts=w.nodes.filter(n=>n.type==='start');if(starts.length!==1)add('Proses harus memiliki tepat satu start event.');if(!w.nodes.some(n=>n.type==='end'))add('Tambahkan minimal satu end event.');
 for(const n of w.nodes){const outs=w.edges.filter(e=>e.source===n.key);const ins=w.edges.filter(e=>e.target===n.key);
  const branches=n.type==='condition'?['true','false']:n.type==='approval'?['approved','rejected']:[];
  if(branches.length){if(outs.length!==2||branches.some(b=>outs.filter(e=>e.branch===b).length!==1))add('Lengkapi jalur '+branches.join(' dan ')+'.',n.key);}
  else if(n.type==='end'){if(outs.length)add('End event tidak boleh memiliki koneksi keluar.',n.key);}
  else if(outs.length!==1)add('Node memerlukan tepat satu koneksi keluar.',n.key);
  if(n.type==='start'&&ins.length)add('Start event tidak menerima koneksi masuk.',n.key);
 }
 const visited=new Set(),visiting=new Set();function walk(key){if(visiting.has(key)){add('Siklus tidak didukung. Gunakan proses tanpa loop.',key);return;}if(visited.has(key))return;visiting.add(key);for(const e of w.edges.filter(e=>e.source===key))if(ids.has(e.target))walk(e.target);visiting.delete(key);visited.add(key);}
 if(starts.length===1)walk(starts[0].key);for(const n of w.nodes)if(!visited.has(n.key))add('Node tidak terjangkau dari start event.',n.key);
 return issues;
}
export function evaluateCondition(n,data){const a=data[n.field],b=n.value;switch(n.op){case 'is_empty':return a===undefined||a===null||a==='';case 'contains':return String(a??'').includes(String(b));case 'eq':return String(a??'')===String(b??'');case 'ne':return String(a??'')!==String(b??'');case 'gt':return Number(a)>Number(b);case 'gte':return Number(a)>=Number(b);case 'lt':return Number(a)<Number(b);case 'lte':return Number(a)<=Number(b);default:throw Error('Operator tidak didukung.');}}
export function nextNode(w,node,branch){return w.edges.find(e=>e.source===node.key&&(!branch||e.branch===branch))?.target;}
export function simulateWorkflow(w,definition,snapshot,decisions={}){
 const errors=validateGraph(w,definition);if(errors.length)return {errors,trace:[],data:snapshot};const data={...snapshot},trace=[];let key=w.nodes.find(n=>n.type==='start').key;
 for(let i=0;i<100&&key;i++){const n=w.nodes.find(n=>n.key===key);let branch;const entry={nodeKey:n.key,label:n.label,type:n.type};
  if(n.type==='condition'){branch=evaluateCondition(n,data)?'true':'false';entry.result=branch;}
  if(n.type==='approval'){branch=decisions[n.key]||'approved';entry.result=branch;}
  if(n.type==='set_field'){data[n.field]=n.value;entry.result=n.field+' = '+String(n.value);}
  if(n.type==='timer')entry.result='Simulasi melewati '+n.seconds+' detik';
  if(n.type==='notify')entry.result=n.message;
  trace.push(entry);if(n.type==='end')break;key=nextNode(w,n,branch);
 }
 return {errors:[],trace,data};
}
