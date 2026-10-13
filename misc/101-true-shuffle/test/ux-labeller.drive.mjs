export default async function ({newPage,baseUrl,assert,outDir}) {
 for (const theme of ['dark','light']) for (const width of [1280,390]) {
  const page=await newPage({width,height:width===390?844:860,mobile:width===390,theme});
  const settle=()=>page.eval(()=>new Promise(r=>setTimeout(r,180)));
  const seed=async (plain=false)=>{
   await page.goto(baseUrl+'misc/101-true-shuffle/?demo=1#/songs');await page.reload();await page.waitFor('.ts-row');
   await page.eval(plain=>{const c=window.__ts.pageCtx,L=c.L,lib=c.lib();Object.keys(lib.tracks).forEach(id=>delete lib.tracks[id]);lib.channelRules={};lib.aliases={};lib.profiles={};
    L.upsert(lib,['Hollow Compass - Distant Kindling (1976)','Hollow Compass - Paper Weather','Bonus Singer - Last tape'].map((title,i)=>({id:'lab-'+i,title,channel:'cassette drawer',channelId:'lab-channel',durationSec:180,embeddable:true})));
    if(plain){L.upsert(lib,[{id:'lab-known',title:'Example','channel':'cassette drawer',channelId:'lab-channel',durationSec:120,embeddable:true}]);L.edit(lib,'lab-known',{artist:'Other Reading',title:'Example',kind:'song'});}
    c.changed(Object.keys(lib.tracks));},plain);await settle();
   await page.eval(()=>{location.hash='#/label';});await page.waitFor('.ts-labelcard');await settle();
   await fields();
  };
  const fields=async ()=>page.eval(()=>{for(const key of ['Artist','Title']){const l=[...document.querySelectorAll('.ts-labelcard label')].find(l=>l.querySelector('span')?.textContent===key);if(!l)throw Error('Missing '+key);l.querySelector('input').id='audit-lab-'+key.toLowerCase();}});
  const chip=async name=>{
   await page.eval(name=>{document.getElementById('audit-lab-chip')?.removeAttribute('id');const l=document.getElementById('audit-lab-artist').closest('label'),b=[...l.querySelectorAll('button')].find(b=>b.textContent===name);if(!b)throw Error('Missing artist chip '+name);b.id='audit-lab-chip';b.scrollIntoView({block:'center',behavior:'instant'});},name);
   await page.eval(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const point=await page.eval(()=>{const r=document.getElementById('audit-lab-chip').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
   if(width===390) await page.tapAt(point.x,point.y);else await page.clickAt(point.x,point.y);
   assert.equal(await page.eval(()=>document.getElementById('audit-lab-artist').value),name);
  };
  const next=async (wait=true)=>{await page.eval(()=>{const h=document.querySelector('#view h1');h.tabIndex=-1;h.focus();});await page.key('Enter');if(wait)await settle();};
  await seed();await chip('Hollow Compass');
  assert.equal(await page.eval(()=>document.getElementById('audit-lab-title').value),'Distant Kindling');
  await next(false);
  assert.deepEqual(await page.eval(()=>{const t=window.__ts.lib.tracks['lab-0'];return [t.artist,t.title,t.userEdits.title];}),['Hollow Compass','Distant Kindling','Distant Kindling']);
  assert.deepEqual(await page.eval(()=>{const t=window.__ts.lib.tracks['lab-1'];return [t.artist,t.title];}),['Hollow Compass','Paper Weather']);
  await page.waitFor('[data-id="lab-teach"]');assert.ok(!(await page.eval(()=>!!document.querySelector('.ts-modal'))));
  assert.equal(await page.eval(()=>document.activeElement.tagName),'H1');
  await page.key('1');await page.key('Enter');await settle();
  assert.equal(await page.eval(()=>window.__ts.lib.tracks['lab-1'].mood),'bright');
  assert.deepEqual(await page.eval(()=>window.__ts.lib.channelRules),{});
  await page.waitFor('[data-id="lab-teach-yes"]');await page.click('[data-id="lab-teach-yes"]');await settle();
  assert.ok(await page.eval(()=>!!window.__ts.lib.channelRules['lab-channel']));
  assert.equal(await page.eval(()=>window.__ts.lib.tracks['lab-2'].artist),'Bonus Singer');
  assert.ok(!(await page.eval(()=>!!document.querySelector('[data-id="lab-teach"]'))));
  await page.key('ArrowLeft');await settle();assert.ok(await page.eval(()=>document.querySelector('#view').textContent.includes('2 of 3')));
  await page.key('ArrowRight');await settle();assert.ok(await page.eval(()=>document.querySelector('#view').textContent.includes('3 of 3')));
  await seed();await chip('Distant Kindling');assert.equal(await page.eval(()=>document.getElementById('audit-lab-title').value),'Hollow Compass');await next();
  assert.deepEqual(await page.eval(()=>{const t=window.__ts.lib.tracks['lab-0'];return [t.artist,t.title];}),['Distant Kindling','Hollow Compass']);
  await page.click('[data-id="lab-teach-no"]');await settle();assert.deepEqual(await page.eval(()=>window.__ts.lib.channelRules),{});
  await seed();await page.type('#audit-lab-artist','Hollow Compass');await page.key('Enter');await settle();
  assert.equal(await page.eval(()=>window.__ts.lib.tracks['lab-0'].title),'Distant Kindling');
  await seed();await page.click('#audit-lab-title');await page.key('Control+a');await page.type('#audit-lab-title','My title');await chip('Hollow Compass');await chip('Distant Kindling');
  assert.equal(await page.eval(()=>document.getElementById('audit-lab-title').value),'My title');await next();assert.equal(await page.eval(()=>window.__ts.lib.tracks['lab-0'].title),'My title');
  await seed(true);await chip('Hollow Compass');await chip('Other Reading');
  assert.equal(await page.eval(()=>document.getElementById('audit-lab-title').value),'Hollow Compass - Distant Kindling');
  await chip('Distant Kindling');await next();await page.waitFor('[data-id="lab-teach"]');
  assert.ok(await page.eval(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot(outDir+`/shuffle-labeller-${theme}-${width}.png`);
  await seed();await page.eval(()=>{location.hash='#/track/lab-0';});await page.waitFor('.ts-guessbox');
  await page.eval(()=>{[...document.querySelectorAll('#view .ts-guessbox button')].find(b=>b.textContent==='By Hollow Compass?').id='audit-guess';});await page.click('#audit-guess');await page.waitFor('.ts-modal');
  assert.deepEqual(await page.eval(()=>{const t=window.__ts.lib.tracks['lab-0'];return [t.artist,t.title];}),['Hollow Compass','Distant Kindling']);
  assert.equal(await page.eval(()=>window.__ts.lib.tracks['lab-1'].artist),'Hollow Compass');await page.key('Escape');
  if(theme==='dark'&&width===1280) {
   const fixture=await page.eval(()=>{const L=window.TrueShuffle.library,lib=L.create();L.upsert(lib,['Hollow Compass - Distant Kindling (1976)','Hollow Compass - Paper Weather','Bonus Singer - Last tape'].map((title,i)=>({id:'lab-'+i,title,channel:'cassette drawer',channelId:'lab-channel',durationSec:180,embeddable:true})));return L.list(lib);});
   await page.goto(baseUrl+'misc/101-true-shuffle/?player=mock#/settings');await page.waitFor(()=>!!window.__ts?.store);
   await page.eval(async tracks=>{await window.__ts.store.putTracks(tracks);},fixture);
   await page.eval(()=>{location.hash='#/label';});await page.reload();await page.waitFor('.ts-labelcard');await settle();await fields();
   await chip('Hollow Compass');await next();
   await page.waitFor(async ()=>{const b=await window.__ts.store.get('sync:outbox',null);return b?.labels?.tracks?.['lab-0']?.title==='Distant Kindling';});
   assert.equal(await page.eval(async ()=>(await window.__ts.store.getTracks()).find(t=>t.id==='lab-1').artist),'Hollow Compass');
   await page.reload();await page.waitFor(()=>window.__ts?.lib.tracks['lab-0']?.title==='Distant Kindling');
   assert.deepEqual(await page.eval(()=>{const t=window.__ts.lib.tracks['lab-0'];return [t.artist,t.title,t.userEdits.title];}),['Hollow Compass','Distant Kindling','Distant Kindling']);
  }
  assert.deepEqual(page.errors,[]);assert.deepEqual(page.externalHosts,[]);await page.close();
 }
}
