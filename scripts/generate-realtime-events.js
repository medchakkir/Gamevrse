// Generates docs/REALTIME_EVENTS.md by statically scanning the game servers and the
// browser clients. Run: `npm run docs:events`. tests/realtime-events.test.js fails if the
// committed doc is out of date, so the inventory cannot silently drift from the code.
//
// This is a static, regex/paren-balancing scan, not an execution trace: payloads are
// the top-level keys of an object literal at the call site, and "Sent to" is the literal
// target expression. Dynamic event names would not be seen (the script fails loudly if
// it finds an emit() whose first argument is not a string literal).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GAMES = ['blackjack', 'colorrush', 'rankly'];
const OUT = path.join(ROOT, 'docs', 'REALTIME_EVENTS.md');

const read = (p) => fs.readFileSync(p, 'utf8');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
}
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

// Index of the matching close bracket for the opener at `open`, skipping strings/comments.
function matchClose(text, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      i = text.indexOf('\n', i);
      if (i < 0) return -1;
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i) + 1;
    } else if (c === '"' || c === "'" || c === '`') {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++;
    } else if (pairs[c]) stack.push(pairs[c]);
    else if (c === ')' || c === ']' || c === '}') {
      if (stack.pop() !== c) return -1;
      if (!stack.length) return i;
    }
  }
  return -1;
}

// Splits `text` at top-level commas.
function splitTop(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++;
    } else if (c === '/' && text[i + 1] === '/') i = text.indexOf('\n', i);
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
    if (i < 0) break;
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function objectKeys(expr) {
  const e = expr.trim();
  if (!e.startsWith('{')) return null;
  return splitTop(e.slice(1, -1))
    .map((p) => (p.startsWith('...') ? `...${p.slice(3).trim()}` : /^[\w$'"]+/.exec(p)?.[0].replace(/['"]/g, '')))
    .filter(Boolean);
}
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();
const mdEscape = (s) => s.replace(/\|/g, '\\|');
const code = (s) => '`' + mdEscape(s) + '`';

function payloadSummary(args) {
  if (!args.length) return '_none_';
  return args
    .map((a) => {
      const keys = objectKeys(a);
      if (keys) return keys.length ? `{ ${keys.join(', ')} }` : '{}';
      return oneLine(a).length > 40 ? oneLine(a).slice(0, 37) + '...' : oneLine(a);
    })
    .join(', ');
}

// Walks back from `.emit` to the start of the receiver expression (e.g. ctx.io.to(roomCode)).
function receiverOf(text, dotIdx) {
  let i = dotIdx;
  while (i > 0) {
    const c = text[i - 1];
    if (c === ')' || c === ']') {
      const close = c;
      const open = close === ')' ? '(' : '[';
      let depth = 0;
      let j = i - 1;
      for (; j >= 0; j--) {
        if (text[j] === close) depth++;
        else if (text[j] === open && --depth === 0) break;
      }
      i = j;
    } else if (c === '\n') {
      // A receiver continues across lines only for a method chain written as "\n  .to(x)".
      if (!/^\s*\./.test(text.slice(i, dotIdx))) break;
      i--;
    } else if (/[\w$.]/.test(c) || /\s/.test(c)) i--;
    else break;
  }
  return oneLine(text.slice(i, dotIdx)).replace(/^ctx\./, '');
}

function scanServerEmits(game) {
  const events = new Map(); // name -> Map(signature -> {payload, sentTo:Set, locs:[]})
  for (const file of walk(path.join(ROOT, 'src/games', game))) {
    const text = read(file);
    const re = /\.emit\(/g;
    let m;
    while ((m = re.exec(text))) {
      const open = m.index + '.emit'.length;
      const close = matchClose(text, open);
      if (close < 0) throw new Error(`unbalanced emit in ${rel(file)}:${lineOf(text, m.index)}`);
      const args = splitTop(text.slice(open + 1, close));
      const nameMatch = /^(['"`])([\w:-]+)\1$/.exec(args[0] || '');
      if (!nameMatch) throw new Error(`emit() with a non-literal event name at ${rel(file)}:${lineOf(text, m.index)}: ${args[0]}`);
      const name = nameMatch[2];
      const sig = payloadSummary(args.slice(1));
      const byName = events.get(name) || new Map();
      const entry = byName.get(sig) || { payload: sig, sentTo: new Set(), locs: [] };
      entry.sentTo.add(receiverOf(text, m.index));
      entry.locs.push(`${rel(file).replace(`src/games/${game}/`, '')}:${lineOf(text, m.index)}`);
      byName.set(sig, entry);
      events.set(name, byName);
    }
  }
  return events;
}

function scanHandlers(game) {
  const handlers = new Map(); // name -> {params, keys, locs}
  for (const file of walk(path.join(ROOT, 'src/games', game))) {
    const text = read(file);
    const re = /\bsocket\.on\(\s*(['"`])([\w:-]+)\1\s*,\s*/g;
    let m;
    while ((m = re.exec(text))) {
      const name = m[2];
      if (name === 'connection') continue;
      const after = text.slice(re.lastIndex, re.lastIndex + 400);
      const sig = /^(?:async\s*)?(?:function\s*\w*\s*)?\(([^)]*)\)|^(?:async\s*)?([\w$]+)\s*=>/.exec(after);
      const params = sig ? (sig[1] !== undefined ? sig[1] : sig[2]).split(',').map((p) => p.trim()).filter(Boolean) : [];
      const callClose = matchClose(text, m.index + m[0].indexOf('('));
      const body = callClose > 0 ? text.slice(re.lastIndex, callClose) : text.slice(re.lastIndex, re.lastIndex + 1500);
      const first = params[0];
      let keys = null;
      if (first) {
        const id = first.replace('$', '\\$');
        const found = new Set();
        for (const d of body.matchAll(new RegExp(`const\\s*\\{([^}]*)\\}\\s*=\\s*${id}\\b`, 'g')))
          for (const k of d[1].split(',')) {
            const key = k.trim().split(':')[0].split('=')[0].trim();
            if (key) found.add(key);
          }
        for (const d of body.matchAll(new RegExp(`\\b${id}\\s*\\??\\.\\s*([A-Za-z_$][\\w$]*)(?!\\s*\\(|[\\w$])`, 'g'))) found.add(d[1]);
        keys = [...found];
        if (!keys.length) keys = null;
      }
      const entry = handlers.get(name) || { params, keys, locs: [] };
      entry.locs.push(`${rel(file).replace(`src/games/${game}/`, '')}:${lineOf(text, m.index)}`);
      handlers.set(name, entry);
    }
  }
  return handlers;
}

function scanClient(game) {
  const listens = new Set();
  const emits = new Set();
  for (const file of walk(path.join(ROOT, 'public/games', game))) {
    const text = read(file);
    for (const m of text.matchAll(/\b(?:socket|sock)\.(?:on|once)\(\s*(['"`])([\w:-]+)\1/g)) listens.add(m[2]);
    for (const m of text.matchAll(/\b(?:socket\.emit|emitSafe)\(\s*(['"`])([\w:-]+)\1/g)) emits.add(m[2]);
  }
  return { listens, emits };
}

const BUILTIN = new Set(['connect', 'disconnect', 'connect_error', 'reconnect', 'reconnect_attempt', 'reconnect_failed', 'error']);
const diff = (a, b) => [...a].filter((x) => !b.has(x)).sort();

function render() {
  const out = [];
  out.push('# Realtime events (Socket.IO)', '');
  out.push('> **Generated file - do not edit by hand.** Regenerate with `npm run docs:events`.');
  out.push('> `tests/realtime-events.test.js` fails when this file is out of date.', '');
  out.push(
    'Each game owns one namespace (`/colorrush`, `/blackjack`, `/rankly`). This inventory comes from a static scan of',
    '`src/games/<game>` (handlers and `emit` calls) and `public/games/<game>` (browser clients). Limits of that scan:',
    '',
    '- Payloads are the top-level keys of an object literal at the call site; non-literal payloads show as the expression.',
    '- "Sent to" is the literal receiver expression (for example `io.to(roomCode)` is the room, `socket` is the caller),',
    '  not a resolved audience. Judge ambiguous variables such as `r.id` from the source.',
    '- It does not execute code, so it says nothing about *when* an event fires or about field types.',
    '- Naming differs per game today (ColorRush and Blackjack use camelCase events; Rankly uses snake_case and acknowledgement',
    '  callbacks). Standardising names is a planned, compatibility-sensitive change, not something this file prescribes.',
    ''
  );

  for (const game of GAMES) {
    const server = scanServerEmits(game);
    const handlers = scanHandlers(game);
    const client = scanClient(game);

    out.push(`## ${game}`, '', `Namespace: \`/${game}\``, '');
    out.push('### Client to server', '');
    out.push('| Event | Handler params | Payload keys read | Acknowledgement | Source |', '|---|---|---|---|---|');
    for (const [name, h] of [...handlers].sort(([a], [b]) => a.localeCompare(b))) {
      const params = h.params.length ? h.params.map((p) => code(p)).join(', ') : '_none_';
      const keys = h.keys ? h.keys.map((k) => code(k)).join(', ') : h.params.length ? '_used as a whole_' : '_none_';
      const ack = h.params.length > 1 && /^(cb|callback|ack|fn)$/.test(h.params[h.params.length - 1]) ? 'yes (callback)' : 'no';
      out.push(`| ${code(name)} | ${params} | ${keys} | ${ack} | ${h.locs.map(code).join(', ')} |`);
    }
    out.push('', '### Server to client', '');
    out.push('| Event | Payload | Sent to | Source |', '|---|---|---|---|');
    for (const [name, bySig] of [...server].sort(([a], [b]) => a.localeCompare(b))) {
      const entries = [...bySig.values()].sort((x, y) => x.payload.localeCompare(y.payload));
      entries.forEach((e, i) => {
        const locs = e.locs.slice(0, 3).map(code).join(', ') + (e.locs.length > 3 ? ` (+${e.locs.length - 3})` : '');
        const sentTo = [...e.sentTo].sort().map(code).join(', ');
        out.push(`| ${i === 0 ? code(name) : ''} | ${code(e.payload)} | ${sentTo} | ${locs} |`);
      });
    }

    const serverNames = new Set(server.keys());
    const handled = new Set(handlers.keys());
    const noListener = diff(serverNames, client.listens);
    const neverEmitted = diff(client.listens, serverNames).filter((n) => !BUILTIN.has(n));
    const unhandled = diff(client.emits, handled);
    const unused = diff(handled, client.emits).filter((n) => n !== 'disconnect');
    const list = (xs) => (xs.length ? xs.map(code).join(', ') : '_none_');
    out.push('', '### Cross-check against the browser client', '');
    out.push(`- Server emits, but the client has no listener: ${list(noListener)}`);
    out.push(`- Client listens, but the server never emits: ${list(neverEmitted)}`);
    out.push(`- Client emits, but the server has no handler: ${list(unhandled)}`);
    out.push(`- Server handles, but no client emit was found: ${list(unused)}`);
    out.push('', '_A "no client emit found" entry means the scan found no literal `emit("name")` call in the client source; the event may still be sent some other way._', '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

if (require.main === module) {
  fs.writeFileSync(OUT, render());
  console.log(`wrote ${rel(OUT)}`);
}

module.exports = { render, OUT };
