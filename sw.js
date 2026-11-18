/* service worker del corso tablet: decifra i file e li conserva offline */
var VER='20261118115308', CACHE='corso-'+VER, CFG=null, KEY=null, MAP=null, RECENTI=[], PESO=0;
self.addEventListener('install',function(){self.skipWaiting();});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k.indexOf('corso-')===0&&k!==CACHE;}).map(function(k){return caches.delete(k);}));}).then(function(){return self.clients.claim();}));});
function rel(p){return new URL(p,self.registration.scope).href;}
function reteOCache(url){return caches.open(CACHE).then(function(cache){return fetch(url,{cache:'no-store'}).then(function(r){if(r.ok)cache.put(url,r.clone()).catch(function(){});return r;}).catch(function(){return cache.match(url,{ignoreSearch:true}).then(function(r){if(r)return r;throw new Error('rete');});});});}
function cfg(){return CFG?Promise.resolve(CFG):reteOCache(rel('config.json')).then(function(r){return r.json();}).then(function(c){CFG=c;return c;});}
function db(){return new Promise(function(ok,ko){var r=indexedDB.open('corso-tablet',1);r.onupgradeneeded=function(){r.result.createObjectStore('k');};r.onsuccess=function(){ok(r.result);};r.onerror=function(){ko(r.error);};});}
function chiave(){if(KEY)return Promise.resolve(KEY);return cfg().then(function(c){return db().then(function(d){return new Promise(function(ok,ko){var r=d.transaction('k').objectStore('k').get(c.salt);r.onsuccess=function(){KEY=r.result||null;ok(KEY);};r.onerror=function(){ko(r.error);};});});});}
function cifrato(id){var url=rel('c/'+id);return caches.open(CACHE).then(function(cache){return cache.match(url).then(function(r){if(r)return r.arrayBuffer();
  return fetch(url,{cache:'no-store'}).then(function(r2){if(!r2.ok)throw new Error('rete '+r2.status);return cache.put(url,r2.clone()).catch(function(){}).then(function(){return r2.arrayBuffer();});});});});}
function decifra(id){return chiave().then(function(k){if(!k)throw 'senza-chiave';return cifrato(id).then(function(b){var u=new Uint8Array(b);return crypto.subtle.decrypt({name:'AES-GCM',iv:u.slice(0,12)},k,u.slice(12));});});}
function mappa(){if(MAP)return Promise.resolve(MAP);return cfg().then(function(c){return decifra(c.mappa);}).then(function(b){MAP=JSON.parse(new TextDecoder().decode(b));return MAP;});}
function ricorda(p,buf){RECENTI=RECENTI.filter(function(x){return x[0]!==p;});RECENTI.unshift([p,buf]);PESO=0;RECENTI=RECENTI.filter(function(x,i){PESO+=x[1].byteLength;return i<4&&PESO<80*1048576;});}
function recente(p){for(var i=0;i<RECENTI.length;i++)if(RECENTI[i][0]===p)return RECENTI[i][1];return null;}
self.addEventListener('message',function(e){var d=e.data||{};
  if(d.tipo==='chiave'){KEY=null;MAP=null;RECENTI=[];}
  if(d.tipo==='scarica'){var fonte=e.source;e.waitUntil(mappa().then(function(m){var ids=Object.keys(m).map(function(k){return m[k][0];});var fatti=0,i=0;
    function avanti(){if(i>=ids.length)return Promise.resolve();var id=ids[i++];return cifrato(id).then(function(){fatti++;if(fonte)fonte.postMessage({tipo:'progresso',fatti:fatti,totale:ids.length});return avanti();});}
    return Promise.all([avanti(),avanti(),avanti()]).then(function(){if(fonte)fonte.postMessage({tipo:'pronto'});});
  }).catch(function(err){if(fonte)fonte.postMessage({tipo:'errore',msg:String(err&&err.message||err)});}));}
});
self.addEventListener('fetch',function(e){var u=e.request.url,scope=self.registration.scope,base=rel('app/');
  if(e.request.method!=='GET'||u.indexOf(scope)!==0)return;
  if(u.indexOf(base)===0){e.respondWith(servi(e.request,base));return;}
  var p=u.slice(scope.length).split('?')[0];
  if(p.indexOf('c/')===0){e.respondWith(cifrato(p.slice(2)).then(function(b){return new Response(b,{headers:{'Content-Type':'application/octet-stream'}});}).catch(function(){return new Response('',{status:503});}));return;}
  if(p==='sw.js')return;
  e.respondWith(reteOCache(p===''?scope:u.split('?')[0]).catch(function(){return new Response('Offline',{status:503});}));
});
function servi(req,base){
  var u=new URL(req.url);var p=decodeURIComponent(u.href.slice(base.length).split('#')[0].split('?')[0]);if(p===''||p.slice(-1)==='/')p+='index.html';
  return mappa().then(function(m){var v=m[p];if(!v)return new Response('Non trovato',{status:404});
    var buf=recente(p);var pronto=buf?Promise.resolve(buf):decifra(v[0]).then(function(b){ricorda(p,b);return b;});
    return pronto.then(function(b){var tot=b.byteLength,h={'Content-Type':v[1],'Accept-Ranges':'bytes','Cache-Control':'no-store'};
      var rg=req.headers.get('range');
      if(rg){var m2=/bytes=(\d*)-(\d*)/.exec(rg)||[];var s,f;
        if(m2[1]===''&&m2[2]){s=Math.max(0,tot-Number(m2[2]));f=tot-1;}else{s=m2[1]?Number(m2[1]):0;f=m2[2]?Math.min(Number(m2[2]),tot-1):tot-1;}
        if(s>f||s>=tot)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+tot}});
        h['Content-Range']='bytes '+s+'-'+f+'/'+tot;h['Content-Length']=String(f-s+1);
        return new Response(b.slice(s,f+1),{status:206,headers:h});}
      h['Content-Length']=String(tot);return new Response(b,{status:200,headers:h});});
  }).catch(function(err){
    if(req.mode==='navigate')return Response.redirect(self.registration.scope+'?errore='+(err==='senza-chiave'?'chiave':'rete'),302);
    return new Response('Corso non disponibile',{status:err==='senza-chiave'?403:503});
  });
}
