export default async function({newPage,baseUrl,assert,outDir}) {
 for (const theme of ['dark','light']) for (const mobile of [false,true]) {
  const width=mobile?390:1280,page=await newPage({width,height:mobile?844:860,mobile,theme});
  await page.goto(baseUrl+'misc/101-true-shuffle/?demo=1#/songs');
  await page.waitFor('.ts-row');
  await page.eval(()=>document.querySelector('.ts-row').focus());
  await page.key(' ');await page.key('Shift+ArrowDown');
  await page.waitFor('.ts-selbar');
  const ids=await page.eval(()=>[...document.querySelectorAll('.ts-row.is-sel')].map(r=>r.dataset.id));assert.equal(ids.length,2);
  const before=await page.eval(ids=>ids.map(id=>JSON.parse(JSON.stringify(window.__ts.lib.tracks[id].userEdits))),ids);
  await page.eval(()=>{[...document.querySelectorAll('.ts-selbar button')].find(b=>b.textContent==='Edit').id='audit-edit';});
  await page.click('#audit-edit');
  await page.eval(()=>{[...document.querySelectorAll('.ts-modal label')].find(l=>l.querySelector('span')?.textContent==='Artist').querySelector('input').id='audit-artist';});
  await page.type('#audit-artist','Wrong Artist');
  // Dirty editor ignores backdrop presses. Escape remains explicit cancellation.
  await page.eval(()=>document.querySelector('.ts-modal-back').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})));
  assert.ok(await page.eval(()=>!!document.querySelector('.ts-modal')));
  await page.screenshot(outDir+`/shuffle-editor-${theme}-${width}.png`);
  await page.click('.ts-edit-btns button[type="submit"]');
  await page.waitFor(()=>document.querySelectorAll('.ts-row.is-sel').length===2&&!!document.querySelector('.ts-selbar'));
  assert.ok((await page.eval(ids=>ids.map(id=>window.__ts.lib.tracks[id].artist),ids)).every(x=>x==='Wrong Artist'));
  await page.eval(()=>{[...document.querySelectorAll('.ts-toast button')].find(b=>b.textContent==='Undo').id='audit-undo';});
  await page.click('#audit-undo');
  assert.deepEqual(await page.eval(ids=>ids.map(id=>window.__ts.lib.tracks[id].userEdits),ids),before);
  // Removing corrections on several songs asks first and restores all fields on Undo.
  await page.eval(()=>window.__ts.pageCtx.edit([...document.querySelectorAll('.ts-row.is-sel')].map(r=>r.dataset.id),{work:'Prior correction'}));
  await page.waitFor('.ts-selbar');
  await page.eval(()=>{[...document.querySelectorAll('.ts-selbar button')].find(b=>b.textContent==='Edit').id='audit-edit';});await page.click('#audit-edit');
  await page.eval(()=>{[...document.querySelectorAll('.ts-edit-btns button')].find(b=>b.textContent.startsWith('Remove my corrections')).id='audit-reset';});await page.click('#audit-reset');
  assert.equal(await page.eval(()=>document.activeElement.textContent),'Keep them');
  await page.key('Escape');assert.equal(await page.eval(()=>document.querySelectorAll('.ts-modal').length),1);
  await page.click('#audit-reset');await page.eval(()=>{[...document.querySelectorAll('.ts-modal button')].find(b=>b.textContent==='Remove them').id='audit-confirm-reset';});await page.click('#audit-confirm-reset');
  assert.ok((await page.eval(ids=>ids.map(id=>window.__ts.lib.tracks[id].userEdits.work),ids)).every(v=>v==null));
  await page.eval(()=>{document.querySelector('.ts-toast button').id='audit-undo';});await page.click('#audit-undo');
  assert.ok((await page.eval(ids=>ids.map(id=>window.__ts.lib.tracks[id].work),ids)).every(v=>v==='Prior correction'));
  // Shared bulk values are visible; Save without changes adds no corrections.
  await page.waitFor('.ts-selbar');await page.eval(()=>{[...document.querySelectorAll('.ts-selbar button')].find(b=>b.textContent==='Edit').id='audit-edit';});await page.click('#audit-edit');
  assert.equal(await page.eval(()=>[...document.querySelectorAll('.ts-modal label')].find(l=>l.querySelector('span')?.textContent==='From (anime, game, film, musical)').querySelector('input').value),'Prior correction');
  const beforeSave=await page.eval(ids=>ids.map(id=>window.__ts.lib.tracks[id].userEdits),ids);await page.click('.ts-edit-btns button[type="submit"]');assert.deepEqual(await page.eval(ids=>ids.map(id=>window.__ts.lib.tracks[id].userEdits),ids),beforeSave);
  // Sorting retains selection, then filtering prunes hidden targets.
  await page.eval(()=>{const sort=document.querySelector('select.ts-sort');if(!sort)throw Error('No sort');sort.value='title';sort.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.waitFor('.ts-selbar');
  assert.equal(await page.eval(()=>document.querySelector('.ts-selbar-n').textContent),'2 tracks selected');
  await page.type('.ts-filter','zzzznotinthistoyzzzz');
  await page.waitFor(()=>window.__ts.pageCtx.route().query.get('f')==='zzzznotinthistoyzzzz'&&!document.querySelector('.ts-row')).catch(async e=>{throw Error(e.message+' '+JSON.stringify(await page.eval(()=>({hash:location.hash,value:document.querySelector('.ts-filter')?.value,active:document.activeElement.outerHTML,rows:document.querySelectorAll('.ts-row').length}))));});
  assert.equal(await page.eval(()=>document.querySelector('.ts-selbar')),null);
  await page.click('.ts-filter');await page.key('Control+a');await page.key('Backspace');await page.waitFor('.ts-row');assert.equal(await page.eval(()=>document.querySelectorAll('.ts-row.is-sel').length),0);
  if(mobile) {
   await page.eval(()=>{location.hash='#/songs';});
   await page.goto(baseUrl+'misc/101-true-shuffle/?demo=1#/songs');
   await page.click('.ts-row .ts-c-more button:last-child');
   await page.eval(()=>{[...document.querySelectorAll('.ts-menu button')].find(b=>b.textContent==='Select').id='audit-select';});
   await page.click('#audit-select');
   await page.waitFor('.ts-tracks.is-selecting');
   const second=await page.eval(()=>{const r=document.querySelectorAll('.ts-row')[1].querySelector('.ts-r-tt').getBoundingClientRect();return{x:r.left+10,y:r.top+8};});
   await page.eval(()=>new Promise(resolve=>setTimeout(resolve,250)));
   await page.tapAt(second.x,second.y);
   await page.waitFor(()=>document.querySelectorAll('.ts-row.is-sel').length===2);
   await page.screenshot(outDir+`/shuffle-selection-${theme}-${width}.png`);
   await page.eval(()=>{[...document.querySelectorAll('.ts-selbar button')].find(b=>b.textContent==='Done').id='audit-done';});await page.click('#audit-done');
   await page.eval(()=>document.activeElement.blur());
   assert.ok(await page.eval(point=>!!document.elementFromPoint(point.x,point.y)?.closest('.ts-row'),second));
   const state=await page.eval(()=>window.__ts.ctl.state());
   await page._send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[second]});await page._send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:second.x+20,y:second.y}]});await page._send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   assert.deepEqual(await page.eval(()=>window.__ts.ctl.state()),state);
   await page._send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[second]});await page.eval(()=>new Promise(resolve=>setTimeout(resolve,600)));await page._send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   assert.deepEqual(await page.eval(()=>window.__ts.ctl.state()),state);
   await page.key('Escape');
   await page.eval(()=>{window.auditRealNow=Date.now;const fixed=Date.now();Date.now=()=>fixed;document.getElementById('main').dispatchEvent(new Event('scroll'));});await page.tapAt(second.x,second.y);await page.eval(()=>{Date.now=window.auditRealNow;});assert.deepEqual(await page.eval(()=>window.__ts.ctl.state()),state);
   await page.eval(()=>new Promise(resolve=>setTimeout(resolve,250)));const tappedId=await page.eval(point=>document.elementFromPoint(point.x,point.y).closest('.ts-row').dataset.id,second);await page.tapAt(second.x,second.y);assert.equal(await page.eval(()=>window.__ts.ctl.current()),tappedId);
  }
  const labelId=await page.eval(()=>Object.keys(window.__ts.lib.tracks)[0]);await page.eval(id=>window.__ts.pageCtx.edit([id],{artist:'Corrected Artist',mood:'',kind:'',work:'',role:''}),labelId);await page.eval(()=>{location.hash='#/fix?tab=unlabelled';});await page.waitFor('.ts-row');assert.ok(await page.eval(id=>!!document.querySelector('.ts-row[data-id="'+id+'"]'),labelId));
  assert.deepEqual(page.errors,[]);assert.deepEqual(page.externalHosts,[]);await page.close();
 }
}
