export default async function ({newPage,baseUrl,assert}) {
 for (const theme of ['dark','light']) for (const width of [1280,390]) {
  const page=await newPage({width,height:width===390?844:860,mobile:width===390,theme});
  await page.goto(baseUrl+'misc/101-true-shuffle/?demo=1#/songs');await page.waitFor('.ts-row');
  assert.equal(await page.eval(()=>document.getElementById('btn-repeat').title),'Repeat the queue (Shift+R)');
  assert.equal(await page.eval(()=>window.TrueShuffle.actions.item('repeat',null).hint),'Shift+R');
  for(const mode of ['list','true']) {
   await page.eval(mode=>{const ts=window.__ts;const ids=Object.values(ts.lib.tracks).filter(t=>!t.blocked&&window.TrueShuffle.library.playable(t)&&t.kind!=='clip').slice(0,5).map(t=>t.id);if(mode==='list'){ts.playFrom(ids.slice(0,4),0,{label:'Audit queue',href:'#/songs'});ts.pageCtx.play.next([ids[4]]);}else return ts.applyPlan({play:true});},mode);
   await page.eval(()=>new Promise(resolve=>setTimeout(resolve,180)));
   assert.equal(await page.eval(()=>window.__ts.queueMode()),mode);
   const before=await page.eval(()=>({up:window.TrueShuffle.shuffle.upcoming(window.__ts.ctl.state()),current:window.__ts.ctl.current(),context:window.__ts.context}));
   assert.ok(before.up.length>0);
   await page.eval(()=>document.activeElement.blur());await page.key('r');
   await page.waitFor(()=>window.__ts.queueMode()==='feeder'&&[...document.querySelectorAll('button')].some(b=>b.textContent==='Undo'));
   assert.ok(await page.eval(()=>document.getElementById('status').textContent.includes('replaced')));
   assert.equal(await page.eval(()=>window.__ts.ctl.current()),before.current);
   await page.eval(()=>{[...document.querySelectorAll('button')].find(b=>b.textContent==='Undo').id='audit-radio-undo';});await page.click('#audit-radio-undo');
   assert.equal(await page.eval(()=>window.__ts.queueMode()),mode);
   assert.deepEqual(await page.eval(()=>window.TrueShuffle.shuffle.upcoming(window.__ts.ctl.state())),before.up);
   assert.deepEqual(await page.eval(()=>window.__ts.context),before.context);
   assert.equal(await page.eval(()=>window.__ts.engine.feeder()),null);
   await page.eval(()=>document.activeElement.blur());const repeat=await page.eval(()=>window.__ts.ctl.state().repeat);await page.key('Shift+r');
   assert.equal(await page.eval(()=>window.__ts.ctl.state().repeat),!repeat);
   assert.deepEqual(await page.eval(()=>window.TrueShuffle.shuffle.upcoming(window.__ts.ctl.state())),before.up);
  }
  assert.deepEqual(page.errors,[]);assert.deepEqual(page.externalHosts,[]);await page.close();
 }
}
