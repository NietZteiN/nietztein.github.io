import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { normalizeBooks, parseCSV, startManager } from './library-admin.mjs';

const original = [{id:'original',u:'K',s:'A to D',p:2,t:'Existing'}];
test('imports CSV quotes, newlines, Unicode and validates entire batches',()=>{
  const rows=parseCSV('\uFEFFTitle,Author,Description\r\n"日本語, book","A ""B""","Line 1\nLine 2"\r\n');
  const [b]=normalizeBooks(rows,original);
  assert.equal(b.t,'日本語, book'); assert.equal(b.a,'A "B"');assert.equal(b.d,'Line 1\nLine 2');
  assert.equal(b.u,'My');assert.equal(b.s,'New books');assert.equal(b.y,null);
  assert.throws(()=>parseCSV('Title\n"broken'),/Unclosed/);
  assert.throws(()=>normalizeBooks([{title:'Good'},{author:'Missing title'}],original),/Title/);
  assert.throws(()=>normalizeBooks([{title:'Copy',id:'original'}],original),/Duplicate/);
  assert.throws(()=>normalizeBooks([{title:'Bad year',year:'2.5'}],original),/Year/);
  assert.throws(()=>normalizeBooks([{title:'Bad shelf',unit:'K',shelf:'Missing'}],original),/Unknown shelf/);
  const positioned=normalizeBooks([{title:'One',unit:'K',shelf:'A to D'},{title:'Two',unit:'K',shelf:'A to D'}],original);
  assert.deepEqual(positioned.map(b=>b.p),[3,4]);
});

test('local manager previews, rejects unsafe requests, and publishes only additions',async()=>{
  const temporary=await mkdtemp(path.join(os.tmpdir(),'library-manager-test-'));
  const repo=path.join(temporary,'work'), remote=path.join(temporary,'remote.git');
  await mkdir(path.join(repo,'assets/data'),{recursive:true});await mkdir(path.join(repo,'scripts'));
  const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
  let server;
  try{
    await writeFile(path.join(repo,'assets/data/library.json'),JSON.stringify({books:original}));
    await writeFile(path.join(repo,'assets/data/library-additions.json'),'{"books":[]}\n');
    await copyFile(new URL('./library-admin.html',import.meta.url),path.join(repo,'scripts/library-admin.html'));
    git('init','-b','main');git('config','user.name','Library Test');git('config','user.email','test@example.com');
    git('add','.');git('commit','-m','Fixture');
    git('init','--bare',remote);git('remote','add','origin',remote);git('push','-u','origin','main');
    await writeFile(path.join(repo,'unrelated.txt'),'Leave alone');
    server=await startManager({directory:repo});
    const url='http://127.0.0.1:'+server.address().port;
    const html=await (await fetch(url)).text(); const token=html.match(/const token = '([^']+)'/)[1];
    const post=(route,data,headers={})=>fetch(url+route,{method:'POST',headers:{'X-Library-Token':token,'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
    assert.equal((await fetch(url+'/catalog')).status,403);
    assert.equal((await post('/publish',{books:[{title:'No'}]},{Origin:'https://other.example'})).status,403);
    const response=await post('/preview',{books:[{title:'New book',author:'Author'}]});
    assert.equal(response.status,200);const preview=await response.json();
    assert.equal(JSON.parse(await readFile(path.join(repo,'assets/data/library-additions.json'),'utf8')).books.length,0);
    assert.equal((await post('/publish',{books:[{author:'Missing title'}]})).status,400);
    // A staged change blocks publishing without changing the catalog.
    git('add','unrelated.txt');
    assert.equal((await post('/publish',{books:preview.books})).status,400);git('reset','--','unrelated.txt');
    await mkdir(path.join(repo,'hooks'));
    await writeFile(path.join(repo,'hooks/pre-commit'),'#!/bin/sh\nexit 1\n');
    git('config','core.hooksPath','hooks');
    const rejected=await post('/publish',{books:preview.books});
    assert.equal(rejected.status,400);
    assert.match((await rejected.json()).error,/catalog was restored/);
    assert.equal(JSON.parse(await readFile(path.join(repo,'assets/data/library-additions.json'),'utf8')).books.length,0);
    assert.equal(git('diff','--cached','--name-only'),'');
    git('config','--unset','core.hooksPath');
    const published=await post('/publish',{books:preview.books});
    assert.equal(published.status,200,JSON.stringify(await published.json()));
    const additions=JSON.parse(await readFile(path.join(repo,'assets/data/library-additions.json'),'utf8'));
    assert.equal(additions.books[0].t,'New book');assert.equal(additions.books[0].id,preview.books[0].id);
    assert.equal(git('show','--pretty=format:','--name-only','HEAD'),'assets/data/library-additions.json');
    assert.equal(git('rev-parse','HEAD'),git('rev-parse','origin/main'));
    assert.match(git('status','--short'),/\?\? unrelated.txt/);
    assert.equal((await post('/publish',{books:preview.books})).status,400);
    git('remote','set-url','origin',path.join(temporary,'missing-remote.git'));
    const failedPush=await post('/publish',{books:[{title:'Saved despite network failure'}]});
    assert.equal(failedPush.status,502);assert.equal((await failedPush.json()).saved,true);
    assert.equal(JSON.parse(await readFile(path.join(repo,'assets/data/library-additions.json'),'utf8')).books.length,2);
    git('remote','set-url','origin',remote);git('push');
    assert.equal(git('rev-parse','HEAD'),git('rev-parse','origin/main'));
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir())+path.sep));
    await rm(temporary,{recursive:true,force:true});
  }
});
