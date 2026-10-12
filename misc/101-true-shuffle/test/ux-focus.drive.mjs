export default async function ({newPage,baseUrl,assert,outDir}) {
 for (const theme of ['dark','light']) for (const width of [1280,390]) {
  const page=await newPage({width,height:width===390?844:860,mobile:width===390,theme});
  const route=async (hash,title)=>{await page.eval(hash=>{location.hash=hash;},hash);await page.waitFor(title=>document.querySelector('#view h1')?.textContent===title,{args:[title]});await page.eval(()=>new Promise(r=>setTimeout(r,160)));};
  const button=async text=>{await page.eval(text=>{const b=[...document.querySelectorAll('#view button')].find(b=>b.textContent.trim()===text);if(!b)throw Error('Missing button '+text);b.id='audit-focus-button';},text);await page.click('#audit-focus-button');};
  const menu=async text=>{await page.eval(text=>{const b=[...document.querySelectorAll('.ts-menu-item')].find(b=>b.querySelector('.ts-menu-label')?.textContent.trim()===text);if(!b)throw Error('Missing menu item '+text);b.id='audit-focus-item';},text);await page.click('#audit-focus-item');};
  const suggestion=async (name,keyboard=false)=>{await route('#/lists','Playlists');await page.eval(name=>{const a=[...document.querySelectorAll('#view a.ts-tile')].find(a=>a.querySelector('.ts-tile-title')?.textContent===name);if(!a)throw Error('Missing suggestion '+name);a.id='audit-suggestion';a.scrollIntoView({block:'center',behavior:'instant'});},name);await page.eval(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));if(keyboard) { await page.eval(()=>document.querySelector('#audit-suggestion').focus());await page.key('Enter'); } else await page.click('#audit-suggestion');try { await page.waitFor(name=>document.querySelector('#view h1')?.textContent===name,{args:[name]}); } catch(e) { await page.screenshot(outDir+'/shuffle-focus-failure.png');throw Error('Expected '+name+' '+JSON.stringify(await page.eval(()=>({hash:location.hash,title:document.querySelector('#view h1')?.textContent,modal:document.querySelector('.ts-modal')?.textContent,hit:(()=>{const a=document.querySelector('#audit-suggestion'),r=a.getBoundingClientRect();return {rect:{x:r.x,y:r.y,w:r.width,h:r.height},element:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML};})(),lists:window.__ts.lists()})))); }};
  await page.goto(baseUrl+'misc/101-true-shuffle/?demo=1#/lists');await page.waitFor('#view h1');
  const suggested=await page.eval(()=>document.querySelectorAll('#view .ts-tile').length);
  await suggestion('Anime');
  const id=await page.eval(()=>window.__ts.lists()[0].id);
  assert.ok(await page.eval(()=>document.querySelector('#view .ts-kicker').textContent.includes('not saved')));
  assert.equal(await page.eval(()=>document.querySelectorAll('#stations a.ts-station').length),0);
  await button('Leave focus');await route('#/lists','Playlists');
  assert.equal(await page.eval(()=>document.querySelectorAll('#view .ts-tile').length),suggested);
  assert.ok(!(await page.eval(()=>[...document.querySelectorAll('#view h2')].some(h=>h.textContent==='Yours'))));
  await page.click('#focus-btn');assert.ok(await page.eval(()=>document.querySelector('[role="menu"]').textContent.includes('Recent focuses')));
  await menu('Anime');assert.equal(await page.eval(()=>window.__ts.lists()[0].id),id);await page.key('Escape');
  await route('#/c/scene/anime','Anime');await button('Leave focus');await page.click('.ts-actions [data-label="More actions"]');
  assert.ok(await page.eval(()=>[...document.querySelectorAll('.ts-menu-item')].some(b=>b.textContent.trim()==='Save as playlist')));await page.key('Escape');
  await page.key('Control+k');await page.waitFor('.ts-palette');await page._send('Input.insertText',{text:'Anime'});await page.eval(()=>new Promise(r=>setTimeout(r,180)));
  assert.ok(!(await page.eval(()=>[...document.querySelectorAll('.ts-pal-kind')].some(k=>k.textContent==='Playlist'))));await page.key('Escape');
  await suggestion('Anime');await page.click('.ts-actions [data-label="More actions"]');await menu('Save as playlist\u2026');
  await page.waitFor('.ts-modal');await page.key('Escape');assert.equal(await page.eval(()=>window.__ts.lists()[0].auto),true);
  await page.click('.ts-actions [data-label="More actions"]');await menu('Save as playlist\u2026');
  await page.click('.ts-modal button[type="submit"]');await page.waitFor(()=>!document.querySelector('.ts-modal'));
  assert.deepEqual(await page.eval(()=>window.__ts.lists().map(l=>({id:l.id,auto:!!l.auto}))),[{id,auto:false}]);
  assert.equal(await page.eval(()=>document.querySelectorAll('#stations a.ts-station').length),1);
  await page.screenshot(outDir+`/shuffle-focus-${theme}-${width}.png`);
  await route('#/lists','Playlists');assert.ok(await page.eval(()=>[...document.querySelectorAll('#view h2')].some(h=>h.textContent==='Yours')));
  const names=await page.eval(()=>[...document.querySelectorAll('#view .ts-tile-title')].slice(0,7).map(a=>a.textContent));
  assert.ok(names.length>=6);
  for(const name of names) { await suggestion(name,true);assert.ok(await page.eval(()=>window.__ts.lists().filter(l=>l.auto).length<=5)); }
  assert.ok(await page.eval(id=>window.__ts.lists().some(l=>l.id===id&&!l.auto),id));
  const newest=await page.eval(()=>window.__ts.lists().filter(l=>l.auto).sort((a,b)=>b.used-a.used)[0].id);
  await button('Leave focus');await suggestion(names.at(-1),true);
  assert.ok(await page.eval(id=>window.__ts.lists().some(l=>l.id===id),newest));
  await page.click('#focus-btn');assert.equal(await page.eval(()=>[...document.querySelectorAll('.ts-menu-item')].filter(b=>b.querySelector('.ts-menu-label')?.textContent!=='Anime'&&b.querySelector('.ts-menu-label')?.textContent!=='Everything')[0].querySelector('.ts-menu-label').textContent),names.at(-1));await page.key('Escape');
  const fixture=await page.eval(()=>Object.values(window.__ts.lib.tracks).slice(0,30));
  await page.goto(baseUrl+'misc/101-true-shuffle/?player=mock#/settings');await page.waitFor(()=>!!window.__ts?.store);
  const old=Array.from({length:8},(_,i)=>({id:'recent-'+i,name:'Recent '+i,kind:'smart',auto:true,used:i+1,patch:{text:'recent '+i}}));
  const saved={id:'saved',name:'Saved fixture',kind:'manual',ids:[]};
  await page.eval(async ({fixture,old,saved})=>{const s=window.__ts.store;await s.putTracks(fixture);await s.set('lists',[saved,...old]);await s.set('focus',old[0].id);await s.set('sync:inbox',{format:'true-shuffle-sync',version:1,stations:[{id:'remote-auto',name:'Remote recent',kind:'smart',auto:true,patch:{}},{id:'remote-saved',name:'Remote saved',kind:'manual',ids:[]}]});},{fixture,old,saved});
  await page.reload();await page.waitFor(()=>window.__ts?.lists().some(l=>l.id==='remote-saved'));
  assert.deepEqual(await page.eval(()=>window.__ts.lists().filter(l=>l.auto).map(l=>l.id)),['recent-0','recent-3','recent-4','recent-5','recent-6','recent-7']);
  assert.ok(!(await page.eval(()=>window.__ts.lists().some(l=>l.id==='remote-auto'))));
  await page.waitFor(async ()=>!!(await window.__ts.store.get('sync:outbox',null)));
  assert.deepEqual(await page.eval(async ()=>(await window.__ts.store.get('sync:outbox')).stations.map(l=>l.id)),['saved','remote-saved']);
  await page.click('#focus-btn');await menu('Everything');
  assert.equal(await page.eval(()=>window.__ts.lists().filter(l=>l.auto).length),5);
  await page.reload();await page.waitFor(()=>window.__ts?.lists().length===7);
  assert.equal(await page.eval(()=>window.__ts.lists().filter(l=>l.auto).length),5);
  await page.eval(async ()=>{const s=window.__ts.store;const li=JSON.parse(JSON.stringify(window.__ts.lists().find(l=>l.id==='recent-7')));delete li.auto;li.name='Saved on another device';await s.set('sync:inbox',{format:'true-shuffle-sync',version:1,stations:[li]});});
  await page.reload();await page.waitFor(()=>window.__ts?.lists().some(l=>l.id==='recent-7'&&!l.auto));
  assert.equal(await page.eval(()=>window.__ts.lists().find(l=>l.id==='recent-7').name),'Saved on another device');
  assert.equal(await page.eval(()=>window.__ts.lists().filter(l=>l.auto).length),4);
  assert.deepEqual(page.errors,[]);assert.deepEqual(page.externalHosts,[]);await page.close();
 }
}
