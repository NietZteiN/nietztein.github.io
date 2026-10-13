export default async function ({newPage,baseUrl,assert,outDir}) {
 for(const theme of ['dark','light']) for(const width of [1280,390]) {
  const page=await newPage({width,height:width===390?844:860,mobile:width===390,theme});
  const settle=()=>page.eval(()=>new Promise(r=>setTimeout(r,180)));
  const click=async selector=>{await page.eval(s=>document.querySelector(s).scrollIntoView({block:'center',behavior:'instant'}),selector);await page.eval(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const p=await page.eval(s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};},selector);if(width===390)await page.tapAt(p.x,p.y);else await page.clickAt(p.x,p.y);};
  const route=async (hash,title)=>{await page.eval(hash=>{location.hash=hash;},hash);await page.waitFor(title=>document.querySelector('#view h1')?.textContent===title,{args:[title]});await settle();};
  const menu=async name=>{await page.eval(name=>{document.getElementById('audit-alias-menu')?.removeAttribute('id');const b=[...document.querySelectorAll('.ts-menu-item')].find(b=>b.querySelector('.ts-menu-label')?.textContent===name);if(!b)throw Error('Missing '+name+': '+[...document.querySelectorAll('.ts-menu-label')].map(b=>b.textContent).join('|'));b.id='audit-alias-menu';},name);await click('#audit-alias-menu');};
  const more=async ()=>{await settle();await page.eval(()=>document.querySelector('.ts-actions [data-label="More actions"]').focus());await page.key('Enter');await page.waitFor('.ts-menu');};
  const open=async ()=>{await more();await menu('Same artist as\u2026');await page.waitFor('.ts-alias-dialog');};
  const input=async value=>{await page.eval(()=>document.querySelector('[aria-label="List under artist"]').focus());await page.key('Control+a');await page._send('Input.insertText',{text:value});assert.equal(await page.eval(()=>document.querySelector('[aria-label="List under artist"]').value),value);};
  const undo=async ()=>{await page.eval(()=>{const b=[...document.querySelectorAll('.ts-toast button')].find(b=>b.textContent==='Undo');if(!b)throw Error('Missing Undo');b.id='audit-alias-undo';});await click('#audit-alias-undo');await settle();};
  await page.goto(baseUrl+'misc/101-true-shuffle/?demo=1#/songs');await page.waitFor('.ts-row');
  await page.eval(()=>{const c=window.__ts.pageCtx,L=c.L,lib=c.lib();Object.keys(lib.tracks).forEach(id=>delete lib.tracks[id]);lib.aliases={oldnanao:'NANAOAKARI'};lib.profiles={nanaoakari:{native:'same native'},nanawoakari:{native:'same native'}};
   L.upsert(lib,[['alias-a','NANAOAKARI'],['alias-b','Nanawoakari'],['alias-c','Nanawoakari & Sou'],['alias-d','Old Nanao']].map(([id,artist])=>({id,title:'Song '+id,channel:artist+' - Topic',channelId:artist,durationSec:180,embeddable:true})));c.changed(Object.keys(lib.tracks),true);
  });await settle();
  await route('#/artist/nanaoakari','NANAOAKARI');
  const before=await page.eval(()=>JSON.parse(JSON.stringify(window.__ts.lib.aliases)));
  await open();assert.equal(await page.eval(()=>document.activeElement.getAttribute('aria-label')),'List under artist');
  await page.screenshot(outDir+`/shuffle-alias-dialog-${theme}-${width}.png`);
  assert.ok(await page.eval(()=>[...document.querySelectorAll('.ts-alias-dialog .ts-btn')].every(b=>b.getBoundingClientRect().height>=44)));
  assert.ok(await page.eval(()=>[...document.querySelectorAll('.ts-alias-dialog button')].some(b=>b.textContent.includes('Nanawoakari')&&!b.textContent.includes('Sou'))));
  assert.ok(!(await page.eval(()=>[...document.querySelectorAll('.ts-alias-dialog button')].some(b=>b.textContent.includes('& Sou')))));
  await input('NANAOAKARI');await click('.ts-alias-dialog button[type="submit"]');assert.ok(await page.eval(()=>!!document.querySelector('.ts-alias-dialog')));assert.deepEqual(await page.eval(()=>window.__ts.lib.aliases),before);
  await page.eval(()=>document.querySelector('.ts-alias-dialog button[type="submit"]').focus());await page.key('Escape');assert.ok(!(await page.eval(()=>!!document.querySelector('.ts-alias-dialog'))));assert.deepEqual(await page.eval(()=>window.__ts.lib.aliases),before);
  await more();await menu('Focus');await settle();
  const focusId=await page.eval(()=>window.__ts.lists().find(l=>l.auto).id);
  await open();await input('Nanawoakari');await click('.ts-alias-dialog button[type="submit"]');try{await page.waitFor(()=>document.querySelector('#view h1')?.textContent==='Nanawoakari');}catch(e){await page.screenshot(outDir+'/alias-failure.png');throw Error(theme+' '+width+' '+JSON.stringify(await page.eval(()=>({aliases:window.__ts.lib.aliases,dialog:document.querySelector('.ts-alias-dialog')?.textContent,value:document.querySelector('[aria-label="List under artist"]')?.value,active:document.activeElement.outerHTML})))+' '+e.message);}await settle();
  assert.deepEqual(await page.eval(()=>window.__ts.lib.aliases),{oldnanao:'Nanawoakari',nanaoakari:'Nanawoakari'});
  assert.equal(await page.eval(()=>window.__ts.pageCtx.idx().all.length),3);
  assert.ok(await page.eval(()=>document.querySelector('.ts-toast').textContent.includes('2 songs moved')));
  await more();assert.ok(await page.eval(()=>[...document.querySelectorAll('.ts-menu-label')].some(b=>b.textContent==='Leave focus')));await page.key('Escape');
  assert.equal(await page.eval(()=>window.__ts.lists().find(l=>l.auto).id),focusId);
  await page.eval(()=>{const c=window.__ts.pageCtx;c.L.upsert(c.lib(),[{id:'alias-new',title:'New song',channel:'NANAOAKARI - Topic',channelId:'NANAOAKARI',durationSec:160,embeddable:true}]);c.changed(['alias-new']);});await settle();
  assert.equal(await page.eval(()=>window.__ts.lib.tracks['alias-new'].artistKey),'nanawoakari');
  await undo();await page.waitFor(()=>document.querySelector('#view h1')?.textContent==='NANAOAKARI');assert.deepEqual(await page.eval(()=>window.__ts.lib.aliases),before);
  assert.equal(await page.eval(()=>window.__ts.lib.tracks['alias-new'].artistKey),'nanaoakari');
  await open();await input('Nanawoakari');await click('.ts-alias-dialog button[type="submit"]');await page.waitFor(()=>document.querySelector('#view h1')?.textContent==='Nanawoakari');await settle();assert.ok(!(await page.eval(()=>!!document.querySelector('.ts-alias-dialog'))),JSON.stringify(await page.eval(()=>({dialogs:[...document.querySelectorAll('.ts-alias-dialog')].map(d=>d.textContent),aliases:window.__ts.lib.aliases,toast:document.querySelector('.ts-toast')?.textContent}))));
  const savedId=await page.eval(()=>window.__ts.createSmart('Alias saved',{artists:['nanaoakari']}));await route('#/list/'+savedId,'Alias saved');
  assert.ok(await page.eval(()=>/by Nanawoakari/i.test(document.querySelector('#view').textContent)));assert.equal(await page.eval(()=>document.querySelectorAll('.ts-row').length),4);
  await more();await menu('Edit filter');await page.waitFor(()=>location.hash==='#/mix');await settle();assert.ok(await page.eval(()=>document.querySelector('#view').textContent.includes('Nanawoakari')));assert.ok(!(await page.eval(()=>document.querySelector('#view').textContent.includes('nanaoakari'))));
  await route('#/artist/nanaoakari','Nanawoakari');
  await route('#/settings','Settings');await click('[data-id="artist-aliases"] summary');
  assert.ok(await page.eval(()=>document.querySelector('[data-id="artist-aliases"]').textContent.includes('nanaoakari \u2192 Nanawoakari')));
  assert.ok(await page.eval(()=>[...document.querySelectorAll('#set-labels button')].find(b=>b.textContent.includes('Save the labels')).disabled===false));
  await click('[data-id="alias-remove-nanaoakari"]');await settle();assert.ok(!(await page.eval(()=>window.__ts.lib.aliases.nanaoakari)),JSON.stringify(await page.eval(()=>({aliases:window.__ts.lib.aliases,toast:document.querySelector('.ts-toast')?.textContent,details:document.querySelector('[data-id="artist-aliases"]').open,at:document.activeElement.outerHTML}))));
  assert.equal(await page.eval(()=>window.__ts.lib.tracks['alias-a'].artistKey),'nanaoakari');await undo();assert.equal(await page.eval(()=>window.__ts.lib.aliases.nanaoakari),'Nanawoakari');
  await click('[data-id="artist-aliases"] summary');await page.screenshot(outDir+`/shuffle-aliases-${theme}-${width}.png`);
  assert.deepEqual(page.errors,[]);assert.deepEqual(page.externalHosts,[]);
  if(theme==='dark'&&width===1280) {
   const fixture=await page.eval(()=>{const L=window.TrueShuffle.library,lib=L.create();L.upsert(lib,[{id:'real-alias-a',title:'First song',channel:'Velvet Lantern - Topic',channelId:'alias-real',durationSec:180,embeddable:true},{id:'real-alias-b',title:'Second song',channel:'VelvetLantern - Topic',channelId:'alias-real-b',durationSec:190,embeddable:true}]);return{tracks:L.list(lib),meta:L.meta(lib)};});
   await page.goto(baseUrl+'misc/101-true-shuffle/?player=mock#/settings');await page.waitFor(()=>!!window.__ts?.store);
   await page.eval(async f=>{await window.__ts.store.putTracks(f.tracks);await window.__ts.store.saveLibraryMeta(f.meta);},fixture);
   await page.eval(()=>{location.hash='#/artist/velvetlantern';});await page.reload();await page.waitFor(()=>window.__ts?.lib.tracks['real-alias-a']);await settle();
   await open();await input('Lantern Ensemble');await click('.ts-alias-dialog button[type="submit"]');await page.waitFor(()=>document.querySelector('#view h1')?.textContent==='Lantern Ensemble');await settle();
   await page.waitFor(async ()=>(await window.__ts.store.get('sync:outbox',null))?.labels?.aliases?.velvetlantern==='Lantern Ensemble');
   await page.reload();await page.waitFor(()=>window.__ts?.lib.tracks['real-alias-a']?.artistKey==='lanternensemble');
   assert.equal(await page.eval(()=>window.__ts.lib.aliases.velvetlantern),'Lantern Ensemble');
   await page.eval(async ()=>{const c=window.__ts.pageCtx,labels=c.L.exportLabels(c.lib());labels.aliases.deskspelling='Lantern Ensemble';await window.__ts.store.set('sync:inbox',{format:'true-shuffle-sync',version:1,labels});});
   await page.reload();await page.waitFor(()=>window.__ts?.lib.aliases.deskspelling==='Lantern Ensemble');
   await page.eval(()=>{const c=window.__ts.pageCtx;c.L.upsert(c.lib(),[{id:'real-alias-c',title:'Third song',channel:'Desk Spelling - Topic',channelId:'alias-real-c',durationSec:160,embeddable:true}]);c.changed(['real-alias-c']);});await settle();
   assert.equal(await page.eval(()=>window.__ts.lib.tracks['real-alias-c'].artistKey),'lanternensemble');
   await page.reload();await page.waitFor(()=>window.__ts?.lib.tracks['real-alias-c']?.artistKey==='lanternensemble');
  }
  assert.ok(await page.eval(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(page.errors,[]);if(theme==='dark'&&width===1280)assert.deepEqual([...page.externalHosts].sort(),['api.animethemes.moe','api.deezer.com','itunes.apple.com']);else assert.deepEqual(page.externalHosts,[]);await page.close();
 }
}
