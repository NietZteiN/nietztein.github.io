// Local owner tool. Git credentials stay with Git; no credentials reach the site.
import http from 'node:http';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const additionsPath = 'assets/data/library-additions.json';
const token = randomBytes(24).toString('hex');

export function parseCSV(text) {
  const rows = []; let row = [], field = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else if (quoted || !field) quoted = !quoted;
      else throw new Error('Unexpected quote in CSV.');
    } else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (quoted) throw new Error('Unclosed CSV quote.');
  row.push(field); if (row.some(Boolean)) rows.push(row);
  const headers = (rows.shift() || []).map(h => h.trim().toLowerCase());
  if (!headers.includes('title') && !headers.includes('t')) throw new Error('CSV needs a Title column.');
  return rows.map((r, i) => {
    if (r.length !== headers.length) throw new Error('Wrong number of columns on CSV row ' + (i + 2));
    return Object.fromEntries(headers.map((h, j) => [h, r[j]]));
  });
}

export function normalizeBooks(rows, existing) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 2000) throw new Error('Provide between 1 and 2,000 books.');
  const occupied = new Set(existing.map(b => b.id));
  const all = existing.slice();
  return rows.map((raw, i) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid book on row ' + (i + 1));
    const r = Object.fromEntries(Object.entries(raw).map(([k,v]) => [k.toLowerCase(), v]));
    const value = (...keys) => {
      const v = keys.map(k => r[k]).find(v => v != null);
      if (v != null && !['string', 'number'].includes(typeof v)) throw new Error('Invalid field on row ' + (i + 1));
      const s = String(v ?? '').trim();
      if (s.length > 10000) throw new Error('Field too long on row ' + (i + 1));
      return s;
    };
    const t = value('t','title');
    if (!t) throw new Error('Title is required on row ' + (i + 1));
    const u = value('u','unit') || 'My', s = value('s','shelf') || 'New books';
    if (u.includes('|') || s.includes('|')) throw new Error('Unit and shelf cannot contain |.');
    if (u !== 'My' && !existing.some(b => b.u === u && b.s === s)) throw new Error('Unknown shelf on row ' + (i + 1) + '. Choose an existing location or use unit My.');
    const id = value('id') || 'added-' + randomUUID();
    if (occupied.has(id) || ['__proto__','constructor','prototype'].includes(id)) throw new Error('Duplicate or reserved ID: ' + id);
    occupied.add(id);
    const year = value('y','year'), position = value('p','position','pos (l to r)');
    if (year && (!/^-?\d{1,4}$/.test(year))) throw new Error('Year must be a whole number on row ' + (i + 1));
    if (position && (!/^\d+$/.test(position) || Number(position) < 1 || Number(position) > 100000)) throw new Error('Position must be a positive whole number.');
    const b = { id, u, s, p: position ? Number(position) : Math.max(0,...all.filter(b => b.u === u && b.s === s).map(b => b.p)) + 1,
      t, a: value('a','author','author / editor'), pub: value('pub','publisher','publisher / series'),
      l: value('l','language') || 'EN', ty: value('ty','type') || 'Book', g: value('g','genre') || 'Unidentified',
      st: 'OK', y: year ? Number(year) : null, yr: value('yr') || year, d: value('d','description') };
    all.push(b); return b;
  });
}

export async function startManager({ port = 0, directory = root } = {}) {
  const root = directory;
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 120000, windowsHide: true, stdio: ['ignore','pipe','pipe'] }).trim();
  let busy = false;
  const catalog = async () => {
    const base = JSON.parse(await readFile(path.join(root,'assets/data/library.json'),'utf8'));
    const extra = JSON.parse(await readFile(path.join(root,additionsPath),'utf8'));
    return { base, extra, books: base.books.concat(extra.books) };
  };
  const server = http.createServer(async (req,res) => {
    const origin = 'http://127.0.0.1:' + server.address().port;
    const send = (code, value, type = 'application/json') => {
      res.writeHead(code, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "frame-ancestors 'none'" });
      res.end(type === 'application/json' ? JSON.stringify(value) : value);
    };
    try {
      if (req.headers.host !== new URL(origin).host) return send(403,{error:'Invalid host.'});
      if (req.method === 'GET' && req.url === '/') return send(200,(await readFile(path.join(root,'scripts/library-admin.html'),'utf8')).replace('__TOKEN__',token),'text/html');
      if (req.headers['x-library-token'] !== token || (req.headers.origin && req.headers.origin !== origin)) return send(403,{error:'Open the manager from its local address.'});
      if (req.method === 'GET' && req.url === '/catalog') return send(200,{books:(await catalog()).books});
      if (req.method !== 'POST' || !['/preview','/publish'].includes(req.url)) return send(404,{error:'Not found.'});
      let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 3000000) return send(413,{error:'Upload is too large (3 MB maximum).'}); }
      const input = JSON.parse(body);
      const rows = input.format === 'csv' ? parseCSV(input.text) : (input.books || JSON.parse(input.text));
      const list = Array.isArray(rows) ? rows : rows.books;
      const {extra,books} = await catalog();
      const normalized = normalizeBooks(list,books);
      if (req.url === '/preview') return send(200,{books:normalized});
      if (busy) return send(409,{error:'Publishing is already in progress.'});
      busy = true;
      try {
        if (git('branch','--show-current') !== 'main') throw new Error('Switch to main before publishing.');
        if (git('diff','--cached','--name-only')) throw new Error('Commit or unstage your staged changes first.');
        if (git('status','--porcelain','--',additionsPath)) throw new Error('Commit existing catalog changes first.');
        const destination = path.join(root,additionsPath), temp = destination + '.tmp';
        const previous = await readFile(destination,'utf8');
        await writeFile(temp,JSON.stringify({books:extra.books.concat(normalized)},null,2)+'\n');
        await rename(temp,destination);
        try {
          git('add','--',additionsPath);
          git('commit','-m','Add ' + normalized.length + ' library book' + (normalized.length === 1 ? '' : 's'));
        } catch (error) {
          git('reset','--',additionsPath);
          await writeFile(destination,previous);
          throw new Error('Could not commit books; the catalog was restored. ' + error.message);
        }
        try { git('push'); }
        catch { return send(502,{error:'Books were saved and committed locally, but push failed. Run git push from this repository to retry. Do not add these books again.',saved:true}); }
        send(200,{message:'Published ' + normalized.length + ' books. GitHub Pages may take a few minutes to update.'});
      } finally { busy = false; }
    } catch (e) { send(400,{error:e.message}); }
  });
  await new Promise(resolve => server.listen(port,'127.0.0.1',resolve));
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await startManager();
  const url = 'http://127.0.0.1:' + server.address().port;
  console.log('Library manager: ' + url + '\nKeep this window open while managing books. Ctrl+C to stop.');
  if (process.argv.includes('--open')) spawn('explorer.exe',[url],{windowsHide:true});
}
