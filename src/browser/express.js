export default function express() {
 const layers=[];
 const app={disable(){return app;},use(prefix,handler){if(typeof prefix==='function'){handler=prefix;prefix='';}layers.push({prefix,handler});return app;}};
 for(const method of ['get','post','put','patch','delete'])app[method]=(route,handler)=>{layers.push({method:method.toUpperCase(),route,handler});return app;};
 app.request=({url,method='GET',body,headers={}})=>new Promise(resolve=>{
  const parsed=new URL(url,'https://demo.invalid');
  const req={method,body:body===undefined?{}:typeof body==='string'?JSON.parse(body):body,headers:Object.fromEntries(Object.entries(headers).map(([k,v])=>[k.toLowerCase(),v])),path:parsed.pathname,params:{},query:Object.fromEntries(parsed.searchParams),ip:'local-browser'};
  req.get=name=>req.headers[name.toLowerCase()];
  let index=0,status=200;
  const responseHeaders={};
  const res={headersSent:false,status(value){status=value;return res;},set(key,value){responseHeaders[key.toLowerCase()]=value;return res;},cookie(key,value){responseHeaders['set-cookie']=`${key}=${value}`;return res;},json(data){if(res.headersSent)return res;res.headersSent=true;resolve({status,headers:responseHeaders,data:JSON.parse(JSON.stringify(data))});return res;}};
  function dispatch(error){
   if(res.headersSent)return;
   const layer=layers[index++];
   if(!layer){res.status(error?500:404).json({message:error?'Permintaan demo gagal.':'Endpoint tidak ditemukan.'});return;}
   if(Boolean(error)!==(layer.handler.length===4)){dispatch(error);return;}
   const originalPath=req.path;
   if(layer.prefix){if(originalPath!==layer.prefix&&!originalPath.startsWith(layer.prefix+'/')){dispatch(error);return;}req.path=originalPath.slice(layer.prefix.length)||'/';}
   if(layer.route){
    const keys=[];
    const pattern=layer.route.split('/').map(part=>part.startsWith(':')?(keys.push(part.slice(1)),'([^/]+)'):part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('/');
    const match=originalPath.match(new RegExp('^'+pattern+'$'));
    if(method!==layer.method||!match){dispatch(error);return;}
    req.params=Object.fromEntries(keys.map((key,i)=>[key,match[i+1]]));
   }
   const next=e=>{req.path=originalPath;dispatch(e);};
   try{const pending=error?layer.handler(error,req,res,next):layer.handler(req,res,next);if(pending?.catch)pending.catch(next);}catch(e){next(e);}
  }
  dispatch();
 });
 return app;
}
express.json=()=>((_req,_res,next)=>next());
