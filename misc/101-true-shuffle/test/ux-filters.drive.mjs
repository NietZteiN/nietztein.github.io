export default async function ({newPage, baseUrl, assert, outDir}) {
 for (const theme of ['dark','light']) for (const width of [1280,390]) {
  const page=await newPage({width,height:width===390?844:860,mobile:width===390,theme});
  const route=async (hash,title)=>{await page.eval(hash=>{location.hash=hash;},hash);await page.waitFor(title=>document.querySelector('#view h1')?.textContent===title,{args:[title]});};
  const settle=()=>page.eval(()=>new Promise(resolve=>setTimeout(resolve,160)));
  const select=async value=>{await page.eval(value=>{const s=document.querySelector('select.ts-sort');s.value=value;s.dispatchEvent(new Event('change',{bubbles:true}));},value);await page.waitFor('.ts-row');};
  const menu=async label=>{await page.eval(label=>{const buttons=[...document.querySelectorAll('[role="menuitem"]')],b=buttons.find(b=>b.textContent.trim()===label);if(!b)throw Error('Missing '+label+': '+buttons.map(b=>b.textContent.trim()).join('|'));b.id='audit-action';},label);await page.click('#audit-action');};
  await page.goto(baseUrl+'misc/101-true-shuffle/?demo=1#/songs');await page.waitFor('.ts-row');
  const ids=await page.eval(()=>Object.values(window.__ts.lib.tracks).filter(t=>t.kind!=='clip'&&!t.blocked&&window.TrueShuffle.library.playable(t)).slice(0,3).map(t=>t.id));
  await page.eval(ids=>{const c=window.__ts.pageCtx;ids.forEach((id,i)=>{c.L.edit(c.lib(),id,{rating:0,at:1});c.L.edit(c.lib(),id,{rating:5,at:1000+i});});c.changed(ids);},ids);await settle();
  await route('#/liked','Liked songs');await page.waitFor('.ts-row');
  assert.equal(await page.eval(()=>document.querySelector('select.ts-sort').value),'liked');
  assert.deepEqual(await page.eval(()=>[...document.querySelectorAll('.ts-row')].slice(0,3).map(r=>r.dataset.id)),ids.slice().reverse());
  const joined=await page.eval(id=>window.__ts.lib.tracks[id].likedAt,ids[2]);
  await page.eval(id=>document.querySelector('.ts-row[data-id="'+id+'"] .ts-like').scrollIntoView({block:'center',behavior:'instant'}),ids[2]);
  await page.eval(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.click('.ts-row[data-id="'+ids[2]+'"] .ts-like');
  await page.waitFor(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Undo'));
  await page.eval(()=>{[...document.querySelectorAll('button')].find(b=>b.textContent==='Undo').id='audit-undo';});await page.click('#audit-undo');await settle();
  assert.equal(await page.eval(id=>window.__ts.lib.tracks[id].likedAt,ids[2]),joined);
  await page.click('.ts-actions [data-label="More actions"]');await menu('Open in mix builder');await page.waitFor('[data-id="mix-rating-4"]');
  assert.equal(await page.eval(()=>document.querySelector('[data-id="mix-rating-4"]').getAttribute('aria-pressed')),'true');
  await page.eval(()=>document.querySelector('[data-id="mix-rating-4"]').focus());await page.key('Enter');
  assert.equal(await page.eval(()=>document.activeElement.dataset.id),'mix-rating-4');
  assert.equal(await page.eval(()=>document.querySelector('[data-id="mix-rating-4"]').getAttribute('aria-pressed')),'false');
  await page.click('[data-id="mix-rating-3"]');
  await page.click('[aria-label="Words in the title, artist or anime"]');await page._send('Input.insertText',{text:'Paper Lanterns'});
  assert.ok(await page.eval(()=>document.querySelector('.ts-mixsum').textContent.includes('Paper Lanterns')));
  await page.click('[aria-label="Words in the title, artist or anime"]');await page.key('Control+a');await page.key('Backspace');
  assert.ok(!(await page.eval(()=>document.querySelector('.ts-mixsum').textContent.includes('matching'))));
  await page.screenshot(outDir+`/shuffle-mix-filters-${theme}-${width}.png`);
  await page.eval(ids=>{const c=window.__ts.pageCtx;ids.forEach((id,i)=>{c.L.edit(c.lib(),id,{artist:'Sort Audit',year:2000+i});c.lib().tracks[id].plays=i*7;});c.changed(ids);},ids);await settle();
  await route('#/songs?sort=plays','Songs');await page.waitFor('.ts-row');
  await page.click('.ts-filter');await page._send('Input.insertText',{text:'Sort Audit'});
  await page.waitFor(()=>window.__ts.pageCtx.route().query.get('f')==='Sort Audit'&&document.querySelectorAll('.ts-row').length===3);
  assert.deepEqual(await page.eval(()=>[...document.querySelectorAll('.ts-row')].map(r=>r.dataset.id)),ids.slice().reverse());
  assert.ok(await page.eval(()=>document.querySelector('.ts-row').textContent.includes('14 plays')));
  assert.ok(await page.eval(()=>document.querySelector('.ts-row').getAttribute('aria-label').includes('14 plays')));
  await page.click('[data-id="sort-reverse"]');
  await page.waitFor('.ts-row');
  assert.deepEqual(await page.eval(()=>[...document.querySelectorAll('.ts-row')].map(r=>r.dataset.id)),ids);
  assert.equal(await page.eval(()=>document.activeElement.dataset.id),'sort-reverse');
  await select('year');assert.equal(await page.eval(()=>window.__ts.pageCtx.route().query.get('dir')),null);
  assert.ok(await page.eval(()=>document.querySelector('.ts-row').textContent.includes('2000')));
  if(width===1280) {
   await page.click('.ts-thead .ts-c-main button');assert.equal(await page.eval(()=>document.querySelector('select.ts-sort').value),'title');
   await page.click('.ts-thead .ts-c-main button');assert.equal(await page.eval(()=>window.__ts.pageCtx.route().query.get('dir')),'rev');
   await page.click('.ts-thead .ts-c-len button');assert.equal(await page.eval(()=>document.querySelector('select.ts-sort').value),'length');
   await page.click('.ts-filter');await page.key('Control+a');await page.key('Backspace');
   await page.waitFor(()=>!window.__ts.pageCtx.route().query.get('f')&&document.querySelectorAll('.ts-row').length>3);
   await page.eval(()=>{document.getElementById('main').scrollTop=700;});await page.waitFor('.ts-sticky.is-on');
   await page.waitFor(()=>Math.abs(document.querySelector('.ts-thead').getBoundingClientRect().top-document.getElementById('main').getBoundingClientRect().top-60)<1);
   await page.eval(()=>document.querySelector('.ts-row[data-index="0"]').focus({preventScroll:true}));await page.key('ArrowDown');
   assert.ok(await page.eval(()=>document.activeElement.getBoundingClientRect().top>=document.querySelector('.ts-thead').getBoundingClientRect().bottom-1));
  }
  assert.ok(await page.eval(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot(outDir+`/shuffle-sort-${theme}-${width}.png`);
  // An inherited words/rating filter exposes excluded songs and survives Save.
  await page.eval(ids=>{const c=window.__ts.pageCtx;c.lib().tracks[ids[0]].blocked=true;c.lib().tracks[ids[1]].embeddable=false;c.changed(ids);},ids);await settle();
  await route('#/liked','Liked songs');await page.click('.ts-actions [data-label="More actions"]');await menu('Open in mix builder');await page.waitFor('[data-id="mix-rating-4"]');
  await page.click('[aria-label="Words in the title, artist or anime"]');await page._send('Input.insertText',{text:'Sort Audit'});
  assert.ok(await page.eval(()=>document.querySelector('.ts-mixsum').textContent.includes('2 songs left out: blocked or cannot play.')));
  await page.eval(()=>{[...document.querySelectorAll('.ts-mixsum button')].find(b=>b.textContent==='Save as playlist').id='audit-save';});await page.click('#audit-save');
  assert.equal(await page.eval(()=>document.querySelector('.ts-modal input[type="text"]').value),'Liked mix');
  assert.ok(await page.eval(()=>document.querySelector('.ts-modal').textContent.includes('3 songs now, 1 of them playable')));
  await page.key('Escape');await page.eval(()=>{[...document.querySelectorAll('.ts-mixsum button')].find(b=>b.textContent==='Start over').id='audit-reset';});await page.click('#audit-reset');
  assert.equal(await page.eval(()=>document.querySelector('[aria-label="Words in the title, artist or anime"]').value),'');
  assert.equal(await page.eval(()=>document.querySelector('[data-id="mix-rating-4"]').getAttribute('aria-pressed')),'false');
  const fixture=await page.eval(ids=>ids.map(id=>{const t=JSON.parse(JSON.stringify(window.__ts.lib.tracks[id]));t.rating=0;t.likedAt=null;t.stateAt=null;t.blocked=false;t.embeddable=true;t.plays=0;t.skips=0;return t;}),ids);
  await page.goto(baseUrl+'misc/101-true-shuffle/?player=mock#/settings');
  await page.eval(async tracks=>{const s=window.__ts.store;await s.putTracks(tracks);await s.set('sync:inbox',{format:'true-shuffle-sync',version:1,state:{[tracks[0].id]:{rating:5,blocked:false,stateAt:'2026-10-12T12:00:00.000Z',likedAt:'2024-01-01T00:00:00.000Z'}}});},fixture);
  await page.reload();await page.waitFor(id=>window.__ts.lib.tracks[id]?.rating===5,{args:[ids[0]]});
  assert.equal(await page.eval(id=>window.__ts.lib.tracks[id].likedAt,ids[0]),'2024-01-01T00:00:00.000Z');
  await page.waitFor(async ()=>!!(await window.__ts.store.get('sync:outbox',null)));
  assert.equal(await page.eval(async id=>(await window.__ts.store.get('sync:outbox')).state[id].likedAt,ids[0]),'2024-01-01T00:00:00.000Z');
  assert.deepEqual(page.errors,[]);assert.deepEqual(page.externalHosts,[]);await page.close();
 }
}
