export default async function({newPage,baseUrl,assert,outDir}) {
 for(const theme of ['dark','light']) for(const width of [1280,390]) {
  const page=await newPage({width,height:width===390?844:860,mobile:width===390,theme});
  const settle=()=>page.eval(()=>new Promise(r=>setTimeout(r,200)));
  const press=async(label,scope='#view')=>{await page.eval(({label,scope})=>{document.getElementById('audit-discovery-button')?.removeAttribute('id');const b=[...document.querySelector(scope).querySelectorAll('button')].find(b=>(b.querySelector('.ts-btn-label')?.textContent||b.textContent)===label);if(!b)throw Error('Missing '+label);b.id='audit-discovery-button';b.focus();},{label,scope});await page.key('Enter');await settle();};
  await page.goto(baseUrl+'misc/101-true-shuffle/?demo=1#/for-you');await page.waitFor('#fy-artists');await settle();
  assert.ok(await page.eval(()=>document.querySelector('#fy-artists').compareDocumentPosition(document.querySelector('#fy-lane-radio'))&Node.DOCUMENT_POSITION_FOLLOWING));
  assert.equal(await page.eval(()=>!!document.querySelector('#fy-lane-season')),false);
  await page.screenshot(outDir+`/artist-discovery-home-${theme}-${width}.png`);
  const artist=await page.eval(()=>document.querySelector('.ts-discovery-picks button').textContent);
  await press(artist,'.ts-discovery-picks');await page.waitFor('.ts-discovery-result .ts-m-row');
  assert.ok(await page.eval(name=>document.querySelector('.ts-discovery-result h3').textContent==='Music by '+name,artist));
  await press('Keep this artist here','.ts-discovery-result');assert.ok(await page.eval(()=>document.querySelector('.ts-discovery-picks').textContent.includes('Artists you chose')));
  const before=await page.eval(()=>document.querySelectorAll('.ts-discovery-result .ts-m-row').length);await press('Only songs I do not have','.ts-discovery-result');
  assert.ok(await page.eval(()=>document.querySelectorAll('.ts-discovery-result .ts-m-row').length)<before);
  await press('Albums & EPs','.ts-discovery-result');const album=await page.eval(()=>[...document.querySelectorAll('.ts-discovery-result button')].find(b=>/\(\d{4}\)$/.test(b.textContent)).textContent);await press(album,'.ts-discovery-result');await page.waitFor('.ts-discovery-result .ts-m-row');
  await page.screenshot(outDir+`/artist-discovery-${theme}-${width}.png`);assert.ok(await page.eval(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.eval(()=>{document.querySelector('.ts-discovery-anime').open=true;});await page.waitFor('#fy-lane-season');
  await page.eval(()=>{location.hash='#/for-you?lane=season';});await page.waitFor('#fy-lane-season');
  assert.deepEqual(page.errors,[]);assert.deepEqual(page.externalHosts,[]);await page.close();
 }
 const page=await newPage({width:390,height:844,mobile:true,theme:'light'});const settle=()=>page.eval(()=>new Promise(r=>setTimeout(r,250)));
 await page.goto(baseUrl+'misc/101-true-shuffle/?player=mock#/settings');await page.waitFor(()=>!!window.__ts?.store);
 await page.eval(async()=>{const c=window.__ts.pageCtx,L=c.L,lib=L.create();L.setPlaylist(lib,{id:'PL_MUSIC',title:'music',count:0});L.setPlaylist(lib,{id:'PL_OTHER',title:'Other',count:500});L.upsert(lib,[{id:'zzMusic0001',title:'First song',channel:'Velvet Lantern - Topic',channelId:'music-test',durationSec:180,embeddable:true}]);await window.__ts.store.putTracks(L.list(lib));await window.__ts.store.putPlaylists(Object.values(lib.playlists));await window.__ts.store.saveLibraryMeta(L.meta(lib));ToyKit.store('addTo','PL_OTHER');});
 await page.eval(()=>ToyKit.store('art',false));await page.reload();await page.waitFor(()=>window.__ts?.lib.tracks.zzMusic0001);await page.eval(()=>{window.TrueShuffle.credits.paint=()=>{};window.TrueShuffle.explore.section=()=>{};window.__ts.auth.signedIn=()=>false;});
 await page.eval(()=>{location.hash='#/track/zzMusic0001';});await page.waitFor('#view .ts-addyt');
 assert.ok(await page.eval(()=>document.querySelector('#view .ts-addyt').textContent.includes('Add to music')));
 await page.eval(()=>document.querySelector('#view .ts-addyt').focus());await page.key('Enter');await page.waitFor('.ts-modal');assert.ok(await page.eval(()=>document.querySelector('.ts-modal').textContent.includes('music')));await page.key('Escape');
 await page.eval(()=>{window.auditWrites=[];window.__ts.auth.signedIn=()=>true;window.__ts.auth.canWrite=()=>true;window.__ts.client.addToPlaylist=async(p,v)=>{window.auditWrites.push(['add',p,v]);return{itemId:'mock-item',playlistId:p,videoId:v,addedAt:new Date().toISOString()};};window.__ts.client.removeFromPlaylist=async id=>{window.auditWrites.push(['remove',id]);return true;};});
 await page.eval(()=>document.querySelector('#view .ts-addyt').focus());await page.key('Enter');await page.waitFor(()=>window.__ts.lib.tracks.zzMusic0001.playlists.includes('PL_MUSIC'));await settle();
 assert.deepEqual(await page.eval(()=>window.auditWrites),[['add','PL_MUSIC','zzMusic0001']]);assert.ok(await page.eval(()=>document.querySelector('#view .ts-addyt').disabled));
 await page.eval(()=>document.querySelector('.ts-toast button').focus());await page.key('Enter');await page.waitFor(()=>!window.__ts.lib.tracks.zzMusic0001.playlists.includes('PL_MUSIC'));await settle();assert.deepEqual(await page.eval(()=>window.auditWrites.at(-1)),['remove','mock-item']);
 await page.eval(()=>{const c=window.__ts.pageCtx;window.TrueShuffle.artists.create=()=>({find:async who=>({sure:true,key:who.key}),discography:async()=>({top:[TrueShuffle.sources.find({title:'Second song',artist:'Velvet Lantern',source:'itunes'})],albums:[],eps:[],singles:[]})});c.canRead=()=>true;c.client=()=>window.__ts.client;window.__ts.client.search=async(q)=>{window.auditSearch=q;window.auditSearches=(window.auditSearches||0)+1;return[{videoId:'zzMusic0002',title:'Velvet Lantern - Second song',channel:'Velvet Lantern - Topic'}];};window.__ts.client.videoBatch=async ids=>({videos:ids.map(id=>({id,title:'Second song',channel:'Velvet Lantern - Topic',channelId:'music-test',durationSec:190,embeddable:true}))});const v=document.querySelector('#view');v.replaceChildren();TrueShuffle.artistDiscovery(v,c,new URLSearchParams('artist=Velvet Lantern'));});
 await page.waitFor('.ts-discovery-result .ts-m-row');assert.equal(await page.eval(()=>window.auditSearch),undefined);
 await page.eval(()=>[...document.querySelectorAll('.ts-discovery-result button')].find(b=>b.textContent==='Keep this artist here').focus());await page.key('Enter');assert.deepEqual(await page.eval(()=>ToyKit.load('discoveryArtists',[])),['Velvet Lantern']);
 await page.type('[aria-label="Song to find on YouTube"]','Second song');await page.eval(()=>[...document.querySelectorAll('.ts-discovery-result button')].find(b=>b.textContent.includes('Search YouTube')).focus());await page.key('Enter');await page.waitFor(()=>window.auditSearch==='Velvet Lantern Second song');
 await page.waitFor(()=>[...document.querySelectorAll('.ts-discovery-result .ts-m-row')].some(r=>r.textContent.includes('Second song')&&r.querySelector('.ts-addyt')));
 await page.eval(()=>document.querySelector('.ts-discovery-result .ts-m-row').scrollIntoView({block:'center',behavior:'instant'}));await settle();await page.screenshot(outDir+'/artist-discovery-youtube-phone.png');assert.ok(await page.eval(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.eval(()=>document.querySelector('.ts-discovery-result .ts-m-row .ts-addyt').focus());await page.key('Enter');await page.waitFor(()=>window.__ts.lib.tracks.zzMusic0002?.playlists.includes('PL_MUSIC'));
 assert.deepEqual(await page.eval(()=>window.auditWrites.at(-1)),['add','PL_MUSIC','zzMusic0002']);assert.equal(await page.eval(()=>window.auditSearches),1);
 await page.waitFor(async()=>{const tracks=await window.__ts.store.getTracks();return tracks.some(t=>t.id==='zzMusic0002'&&t.playlists.includes('PL_MUSIC'));});await settle();
 await page.eval(()=>{const c=window.__ts.pageCtx;window.__ts.auth.signedIn=()=>false;window.__ts.auth.configured=()=>true;window.__ts.auth.signIn=()=>new Promise(()=>{});const b=c.youtube.button({title:'Third song',artist:'Velvet Lantern',id:'zzMusic0003',transient:true});document.querySelector('#view').appendChild(b);b.focus();});await page.key('Enter');await page.waitFor('.ts-modal');await page.eval(()=>[...document.querySelectorAll('.ts-modal button')].find(b=>b.textContent==='Continue to Google').focus());await page.key('Enter');
 assert.equal(await page.eval(()=>JSON.parse(sessionStorage.getItem('toy.101-true-shuffle.pendingAdd')).t._video.videoId),'zzMusic0003');await page.eval(()=>sessionStorage.removeItem('toy.101-true-shuffle.pendingAdd'));
 await page.eval(()=>{location.hash='#/settings';});await page.reload();await page.waitFor(()=>window.__ts?.lib.tracks.zzMusic0002?.playlists.includes('PL_MUSIC'));assert.equal(await page.eval(()=>window.__ts.lib.playlists.PL_MUSIC.count),1);
 assert.deepEqual(page.errors,[]);assert.deepEqual(page.externalHosts,[]);await page.close();
}
