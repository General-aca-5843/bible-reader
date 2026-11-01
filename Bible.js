// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: book-open;
// Bible.js — Scriptable Bible reader + Daily Verse widget.
// Scripture comes from bible.helloao.org and is shown exactly as returned. Nothing else is added.
//
// DAILY VERSE: the widget walks the whole Bible in order, one verse per day, from Genesis 1:1 to
//   Revelation 22:21 and then starts over. It is never random. Tomorrow is always the next verse.
//   If you skip a few days, the plan catches up by the number of days that passed.
// READER: Today, Read and Books tabs. Tap a verse to copy it or to start your daily plan there.
// WIDGET: small, medium, large and Lock Screen sizes. The "Open app" button opens the verse in context.
// Settings, your reading place and the daily plan are saved in separate files, so one never moves another.

const TRANSLATION = "BSB"; // any HelloAO translation ID works here
const API = "https://bible.helloao.org/api/";

// ── storage ──
const fm = FileManager.local();
const DIR = fm.joinPath(fm.documentsDirectory(), "Bible"), CACHE = fm.joinPath(DIR, "cache");
[DIR, CACHE].forEach(d => { if (!fm.fileExists(d)) fm.createDirectory(d, true); });
const rd = (p, d) => { try { return JSON.parse(fm.readString(p)); } catch (e) { return d; } };
const wr = (p, o) => { try { fm.writeString(p, JSON.stringify(o)); } catch (e) {} };
const F = { set: fm.joinPath(DIR, "settings.json"), pos: fm.joinPath(DIR, "position.json"), plan: fm.joinPath(DIR, "plan.json") };
const S = Object.assign({ size: 20, theme: "auto", font: "serif" }, rd(F.set, {}));
S.size = Math.min(36, Math.max(14, Math.round(+S.size) || 20));
if (!["auto", "light", "dark"].includes(S.theme)) S.theme = "auto";
if (!["serif", "sans"].includes(S.font)) S.font = "serif";
let pos = rd(F.pos, null) || { b: "MRK", c: 1, v: 1 }; // reading place; first launch opens Mark 1

// ── API + cache (network-first in the reader, cache-first for the plan and widgets) ──
async function get(path, file, norm, cacheFirst, timeout) {
  const cf = fm.joinPath(CACHE, file);
  let c = rd(cf, null); if (c && c.v !== 1) c = null;
  if (c && cacheFirst) return { d: c };
  try {
    const r = new Request(API + path); r.timeoutInterval = timeout || 6;
    const txt = await r.loadString();
    if (r.response.statusCode !== 200) throw new Error("Server status " + r.response.statusCode);
    const d = norm(JSON.parse(txt)); wr(cf, d); return { d };
  } catch (e) { if (c) return { d: c, off: true }; throw e; }
}
function normBooks(j) {
  const a = j && Array.isArray(j.books) ? j.books.filter(x => x && !x.isApocryphal && /^[A-Z0-9]{2,5}$/.test(x.id) && x.numberOfChapters > 0) : [];
  if (!a.length) throw new Error("The list of books was unavailable or malformed");
  return { v: 1, books: a.sort((x, y) => x.order - y.order).map(x => ({ id: x.id, n: x.commonName || x.name, c: x.numberOfChapters })) };
}
function normChap(j, c) {
  const a = j && j.chapter && j.chapter.content;
  if (!Array.isArray(a) || j.chapter.number !== c) throw new Error("The chapter came back in an unexpected format");
  const verses = [], t = j.translation || {}; let sub = null;
  for (const x of a) {
    if (!x) continue;
    if (x.type === "verse") {
      if (!Number.isInteger(x.number) || x.number < 1 || typeof x.text !== "string") throw new Error("A verse was malformed");
      verses.push({ n: x.number, t: x.text });
    } else if (x.type === "hebrew_subtitle" && !verses.length && x.text) sub = x.text;
  }
  if (!verses.length) throw new Error("This chapter has no verses");
  return { v: 1, verses, sub, tn: t.shortName || TRANSLATION, tl: t.englishName || t.name || TRANSLATION };
}
let BS = null;
const getBooks = async () => BS || (BS = (await get(TRANSLATION + "/books.json", "books_" + TRANSLATION + ".json", normBooks, true, 8)).d.books);
const chap = (b, c, cacheFirst, t) => get(TRANSLATION + "/" + b + "/" + c + ".simple.json", TRANSLATION + "_" + b + "_" + c + ".json", j => normChap(j, c), cacheFirst, t);
const oneLine = t => String(t).replace(/\s*\n\s*/g, " ").trim();
const okLoc = (bs, b, c) => { const k = bs.find(x => x.id === b); return !!k && Number.isInteger(+c) && +c >= 1 && +c <= k.c; };

function fixPos(bs) { // validates the saved reading place
  let b = bs.find(x => x.id === pos.b);
  if (!b) { b = bs.find(x => x.id === "MRK") || bs[0]; pos = { b: b.id, c: 1, v: 1 }; }
  if (!Number.isInteger(pos.c) || pos.c < 1 || pos.c > b.c) pos = { b: b.id, c: 1, v: 1 };
  if (!Number.isInteger(pos.v) || pos.v < 1) pos.v = 1;
}

// ══════════════ DAILY PLAN: one verse per day, in order, Genesis 1:1 to Revelation 22:21 ══════════════
const dayNum = (d) => { d = d || new Date(); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5); }; // local calendar day
function nextChapter(bs, b, c) { // the chapter after this one; wraps from Revelation back to Genesis
  const i = bs.findIndex(x => x.id === b);
  if (c < bs[i].c) return { b, c: c + 1 };
  return bs[i + 1] ? { b: bs[i + 1].id, c: 1 } : { b: bs[0].id, c: 1 };
}
async function advance(bs, loc, k) { // moves k verses forward from loc
  let { b, c, v } = loc;
  while (k > 0) {
    const vs = (await chap(b, c, true, 8)).d.verses;
    let i = vs.findIndex(x => x.n >= v); if (i < 0) i = vs.length - 1;
    const left = vs.length - 1 - i;
    if (k <= left) { v = vs[i + k].n; k = 0; }
    else { k -= left + 1; const n = nextChapter(bs, b, c); b = n.b; c = n.c; v = 1; }
  }
  return { b, c, v };
}
async function planToday(bs) { // returns today's verse, moving the saved plan forward by the days that passed
  const T = dayNum(); let p = rd(F.plan, null), stale = false;
  if (!p || p.ver !== 1 || !okLoc(bs, p.b, p.c) || !Number.isInteger(p.v) || p.v < 1 || !Number.isInteger(p.d) || !Number.isInteger(p.s)) {
    p = { ver: 1, s: T, d: T, b: bs[0].id, c: 1, v: 1 }; wr(F.plan, p);
  }
  let cand = p;
  if (T > p.d) {
    try { cand = Object.assign({}, p, await advance(bs, p, Math.min(T - p.d, 36500)), { d: T }); }
    catch (e) { stale = true; } // offline: keep showing the last verse and try again next time
  }
  let r;
  try { r = await chap(cand.b, cand.c, true, 8); }
  catch (e) { if (cand === p) throw e; cand = p; stale = true; r = await chap(p.b, p.c, true, 8); }
  if (cand !== p) { p = cand; wr(F.plan, p); }
  const ch = r.d;
  let i = ch.verses.findIndex(x => x.n >= p.v); if (i < 0) i = ch.verses.length - 1;
  const bk = bs.find(x => x.id === p.b), vs = ch.verses;
  let nb = p.b, nc = p.c, nv = vs[i + 1] ? vs[i + 1].n : 1;
  if (!vs[i + 1]) { const n = nextChapter(bs, p.b, p.c); nb = n.b; nc = n.c; }
  const nk = bs.find(x => x.id === nb);
  return {
    b: p.b, c: p.c, v: vs[i].n, bn: bk.n, text: vs[i].t, tn: ch.tn, tl: ch.tl, day: Math.max(1, p.d - p.s + 1),
    next: { b: nb, c: nc, v: nv, ref: nk.n + " " + nc + ":" + nv }, stale, off: !!r.off
  };
}
const planRef = t => t.bn + " " + t.c + ":" + t.v;

// ── theme ──
const PAL = {
  light: { bg: "#FBF6EA", bg2: "#F3EAD2", ink: "#1F2328", ac: "#3B5B85", mu: "#59626E", ln: "#DDD3BC", bt: "#EFE7D2", hl: "#F1E8CB", card: "#FFFDF6" },
  dark:  { bg: "#0E1A2B", bg2: "#0A1422", ink: "#F4EDD9", ac: "#93B4DC", mu: "#A9B3C2", ln: "#26364D", bt: "#182A42", hl: "#1C3050", card: "#14243A" }
};
function wcolors() {
  const m = k => { const l = new Color(PAL.light[k]), d = new Color(PAL.dark[k]);
    return S.theme === "light" ? l : S.theme === "dark" ? d : (Color.dynamic ? Color.dynamic(l, d) : (Device.isUsingDarkAppearance() ? d : l)); };
  return { bg: m("bg"), bg2: m("bg2"), ink: m("ink"), ac: m("ac"), mu: m("mu") };
}

// ══════════════ WIDGET ══════════════
const WCFG = { // verse font sizes are tried largest-first; res = space used by everything except the verse
  small:  { p: 12, f: [17, 16, 15, 14, 13, 12], res: 72, ref: 12 },
  medium: { p: 14, f: [24, 22, 20, 19, 18, 17, 16, 15, 14, 13], res: 76, ref: 13 },
  large:  { p: 18, f: [34, 32, 30, 28, 26, 24, 22, 20, 18, 16, 14], res: 108, ref: 15 }
};
function wsize(fam) { // approximate iPhone widget sizes (pt) by screen width
  const s = Device.screenSize(), w = Math.min(s.width, s.height), h = Math.max(s.width, s.height);
  const d = w >= 428 ? [170, 364, 382] : w >= 414 ? [169, 360, 379] : w >= 390 ? [158, 338, 354] : w >= 375 && h >= 812 ? [155, 329, 345] : w >= 375 ? [148, 321, 324] : [141, 292, 311];
  return fam === "small" ? { w: d[0], h: d[0] } : fam === "medium" ? { w: d[1], h: d[0] } : { w: d[1], h: d[2] };
}
// Real wrapped-text measurement in an off-screen WebView (same font as the widget), per candidate font.
async function fit(p) {
  try {
    const wv = new WebView();
    await wv.loadHTML('<html><body style="margin:0"><div id="c"></div></body></html>');
    const r = await wv.evaluateJavaScript("const D=" + JSON.stringify(p) + ";const c=document.getElementById('c');" +
      "function add(t){const d=document.createElement('div');d.textContent=t;c.appendChild(d);return d;}" +
      "function run(f){c.innerHTML='';c.style.cssText='width:'+D.w+'px;font:'+f+'px/'+(f*D.lr)+'px '+D.fam+';overflow-wrap:break-word;hyphens:none;';" +
      "const d=add(D.text);const h=d.getBoundingClientRect().height;let n=h<=D.h?1:0,w=0;" +
      "if(!n){const ws=D.text.split(/\\s+/);let lo=0,hi=ws.length-1;while(lo<hi){const m=Math.ceil((lo+hi)/2);c.innerHTML='';" +
      "if(add(ws.slice(0,m).join(' ')+'\\u2026').getBoundingClientRect().height<=D.h)lo=m;else hi=m-1;}w=lo;}return{f:f,n:n,w:w};}" +
      "completion(D.fonts.map(run));", true);
    if (!Array.isArray(r) || r.length !== p.fonts.length || !r.every(x => x && Number.isInteger(x.n) && Number.isInteger(x.w))) throw new Error("bad measurement");
    return r;
  } catch (e) { // pessimistic estimate, only if measuring is unavailable
    return p.fonts.map(f => {
      const cpl = Math.max(6, Math.floor(p.w / (f * 0.56))), lh = f * p.lr, L = t => Math.ceil(t.length / (cpl * 0.85));
      if (L(p.text) * lh <= p.h) return { f, n: 1, w: 0 };
      const ws = p.text.split(/\s+/); let w = 0;
      for (let m = ws.length - 1; m > 0; m--) if (L(ws.slice(0, m).join(" ") + "…") * lh <= p.h) { w = m; break; }
      return { f, n: 0, w };
    });
  }
}
const scriptURL = q => URLScheme.forRunningScript() + "?" + Object.keys(q).map(k => k + "=" + encodeURIComponent(q[k])).join("&");
const widgetFamilies = ["small", "medium", "large", "extraLarge", "accessoryRectangular", "accessoryInline", "accessoryCircular"];

async function widget(fam) {
  fam = widgetFamilies.includes(fam) ? fam : "medium";
  const c = wcolors(), w = new ListWidget();
  const mid = new Date(); mid.setHours(24, 5, 0, 0); w.refreshAfterDate = mid; // a request for just after midnight; iOS decides
  const lock = fam.startsWith("accessory");
  if (!lock) { w.backgroundColor = c.bg; try { const g = new LinearGradient(); g.colors = [c.bg, c.bg2]; g.locations = [0, 1]; w.backgroundGradient = g; } catch (e) {} }
  let t;
  try { t = await planToday(await getBooks()); }
  catch (e) {
    if (lock) { const m = w.addText("Bible: open to retry"); m.font = Font.systemFont(12); w.url = scriptURL({}); return w; }
    w.setPadding(14, 14, 14, 14);
    const a = w.addText("Couldn’t load today’s verse."); a.font = Font.semiboldSystemFont(14); a.textColor = c.ink;
    const m = w.addText("No saved verse and no connection. Tap to open and retry."); m.font = Font.systemFont(12); m.textColor = c.mu;
    w.url = scriptURL({}); return w;
  }
  const url = scriptURL({ b: t.b, c: t.c, v: t.v }), ref = planRef(t), text = oneLine(t.text);
  w.url = url;
  if (fam === "accessoryInline") { const m = w.addText(ref); return w; }
  if (fam === "accessoryCircular") {
    const a = w.addText("DAY"); a.font = Font.boldSystemFont(9); a.centerAlignText();
    const n = w.addText(String(t.day)); n.font = Font.boldSystemFont(t.day > 999 ? 14 : 20); n.centerAlignText(); n.minimumScaleFactor = 0.5; return w;
  }
  if (fam === "accessoryRectangular") {
    const a = w.addText(ref); a.font = Font.semiboldSystemFont(12); a.lineLimit = 1;
    const m = w.addText(text); m.font = Font.systemFont(11); m.lineLimit = 3; m.minimumScaleFactor = 0.8; return w;
  }
  const size = fam === "extraLarge" ? "large" : fam, L = WCFG[size], z = wsize(size);
  const res = await fit({ text, w: z.w - 2 * L.p, h: z.h - 2 * L.p - L.res - 4, fonts: L.f, lr: 1.18, fam: "Georgia,'Times New Roman',serif" });
  const pick = res.find(r => r.n >= 1) || res[res.length - 1];
  let shown = text, excerpt = false;
  if (pick.n < 1) { const ws = text.split(/\s+/); shown = (pick.w ? ws.slice(0, pick.w).join(" ") : "") + "…"; excerpt = true; }

  w.setPadding(L.p, L.p, L.p, L.p);
  const top = w.addText(("Today · Day " + t.day).toUpperCase()); top.font = Font.semiboldSystemFont(9.5); top.textColor = c.mu; top.lineLimit = 1;
  w.addSpacer(2);
  const h = w.addText(ref + (excerpt ? " · Excerpt" : "")); h.font = Font.boldSystemFont(L.ref); h.textColor = c.ac; h.lineLimit = 1;
  w.addSpacer(size === "large" ? 10 : 6);
  const tt = w.addText(shown); tt.font = new Font("Georgia", pick.f); tt.textColor = c.ink; tt.leftAlignText();
  w.addSpacer();
  if (size === "large") {
    const nx = w.addText("Up next · " + t.next.ref); nx.font = Font.mediumSystemFont(11); nx.textColor = c.mu; nx.lineLimit = 1; w.addSpacer(8);
  }
  const foot = w.addStack(); foot.centerAlignContent();
  const pill = (stack) => { const b = stack.addStack(); b.backgroundColor = c.ac; b.cornerRadius = 11; b.setPadding(5, 12, 5, 12); b.url = url;
    const bt = b.addText(excerpt ? "Read full verse ›" : "Open app ›"); bt.font = Font.semiboldSystemFont(11); bt.textColor = c.bg; bt.lineLimit = 1; };
  if (size === "small") { foot.addSpacer(); pill(foot); foot.addSpacer(); }
  else {
    const tr = foot.addText(t.tn + (t.stale ? " · waiting for connection" : "")); tr.font = Font.mediumSystemFont(10); tr.textColor = c.mu; tr.lineLimit = 1;
    foot.addSpacer(); pill(foot);
  }
  return w;
}

// ══════════════ READER: one page that never reloads; Scriptable only supplies data ══════════════
const READER_CSS = `
:root{--bg:#FBF6EA;--bg2:#F3EAD2;--ink:#1F2328;--ac:#3B5B85;--mu:#59626E;--ln:#DDD3BC;--bt:#EFE7D2;--hl:#F1E8CB;--card:#FFFDF6;--sh:0 1px 2px rgba(70,50,10,.08),0 10px 28px rgba(70,50,10,.10);--ok:#fff;--sans:-apple-system,'SF Pro Text',system-ui,sans-serif;--serif:'Iowan Old Style',Palatino,Georgia,serif}
:root[data-t=dark]{--bg:#0E1A2B;--bg2:#0A1422;--ink:#F4EDD9;--ac:#93B4DC;--mu:#A9B3C2;--ln:#26364D;--bt:#182A42;--hl:#1C3050;--card:#14243A;--sh:0 1px 2px rgba(0,0,0,.4),0 10px 28px rgba(0,0,0,.35);--ok:#0E1A2B}
@media(prefers-color-scheme:dark){:root[data-t=auto]{--bg:#0E1A2B;--bg2:#0A1422;--ink:#F4EDD9;--ac:#93B4DC;--mu:#A9B3C2;--ln:#26364D;--bt:#182A42;--hl:#1C3050;--card:#14243A;--sh:0 1px 2px rgba(0,0,0,.4),0 10px 28px rgba(0,0,0,.35);--ok:#0E1A2B}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
[hidden]{display:none!important}
html,body{height:100%;margin:0}
body{background:var(--bg);color:var(--ink);font:16px/1.4 var(--sans);-webkit-text-size-adjust:100%;overscroll-behavior:none;overflow:hidden;overflow-wrap:anywhere}
button{font:inherit;color:inherit;appearance:none;-webkit-appearance:none;border:0;background:none;padding:0;margin:0;touch-action:manipulation;user-select:none;-webkit-user-select:none;cursor:pointer}
#app{position:fixed;inset:0;display:flex;flex-direction:column;background:linear-gradient(var(--bg),var(--bg2))}
.top{flex:none;display:flex;align-items:center;gap:4px;padding:max(8px,env(safe-area-inset-top)) 12px 8px;border-bottom:1px solid var(--ln);background:var(--bg)}
.ico{min-width:44px;height:44px;border-radius:12px;font-size:26px;line-height:1;color:var(--ac);display:grid;place-items:center;transition:background .15s,opacity .15s}
.ico:active{background:var(--bt)}.ico[disabled]{opacity:.3}
.ico.aa{font:700 17px var(--serif);background:var(--bt)}
.ttl{font:700 21px/1.2 var(--sans);padding:6px 8px;border-radius:10px;min-height:44px;max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:-.01em}
.ttl.btn{color:var(--ink)}.ttl.btn:active{background:var(--bt)}.ttl .car{color:var(--ac);font-size:14px;margin-left:4px}
.grow{flex:1}
.views{flex:1;position:relative;overflow:hidden}
.view{position:absolute;inset:0;overflow-y:auto;-webkit-overflow-scrolling:touch;opacity:0;pointer-events:none;transform:translateY(8px);transition:opacity .24s ease,transform .24s ease;visibility:hidden}
.view.on{opacity:1;pointer-events:auto;transform:none;visibility:visible}
.wrap{max-width:42rem;margin:0 auto;padding:18px 20px 120px}
.tabs{flex:none;display:flex;border-top:1px solid var(--ln);background:var(--bg);padding-bottom:env(safe-area-inset-bottom)}
.tabs button{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 0 7px;min-height:52px;color:var(--mu);font:600 11px var(--sans);transition:color .15s}
.tabs button svg{width:24px;height:24px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;transition:transform .2s}
.tabs button.on{color:var(--ac)}.tabs button.on svg{transform:translateY(-1px) scale(1.06)}
.eyebrow{font:700 11.5px var(--sans);letter-spacing:.09em;text-transform:uppercase;color:var(--ac)}
.hero{margin-top:6px;padding:26px 22px 22px;border-radius:22px;background:var(--card);box-shadow:var(--sh);border:1px solid var(--ln)}
.votd{margin:14px 0 14px;font-family:var(--serif);line-height:1.45;white-space:pre-line;text-wrap:pretty}
.vref{font:700 17px var(--sans);color:var(--ac)}.vsub{color:var(--mu);font-size:13px;margin-top:2px}
.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}
.btn{min-height:48px;padding:10px 18px;border-radius:14px;background:var(--bt);color:var(--ac);font:700 16px var(--sans);transition:transform .12s,opacity .12s}
.btn:active{transform:scale(.97);opacity:.8}.btn.pri{background:var(--ac);color:var(--ok)}.btn.full{width:100%}
.card{display:block;width:100%;text-align:left;margin-top:14px;padding:16px 18px;border-radius:16px;background:var(--card);border:1px solid var(--ln);transition:transform .12s}
button.card:active{transform:scale(.985)}
.card h3{margin:0 0 4px;font:700 13px var(--sans);letter-spacing:.06em;text-transform:uppercase;color:var(--mu)}
.card p{margin:0;color:var(--ink)}.card .mu{color:var(--mu);font-size:14px}
.bar{height:8px;border-radius:4px;background:var(--bt);overflow:hidden;margin:10px 0 6px}.bar i{display:block;height:100%;min-width:8px;background:var(--ac);border-radius:4px;transition:width .5s ease}
.sechead{margin:26px 4px 6px;font:700 12px var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--mu)}
.err{margin-top:20px;padding:20px;border-radius:16px;background:var(--card);border:1px solid var(--ln)}.err h2{margin:0 0 6px;font-size:18px}.err p{margin:0 0 12px;color:var(--mu)}
.skel i{display:block;height:16px;border-radius:8px;margin:14px 0;background:linear-gradient(90deg,var(--bt),var(--hl),var(--bt));background-size:200% 100%;animation:sh 1.2s linear infinite}
@keyframes sh{to{background-position:-200% 0}}
.chtitle{margin:2px 0 4px;font:700 30px/1.15 var(--sans);letter-spacing:-.02em}
.meta{color:var(--mu);font-size:13px;margin-bottom:18px}.badge{margin-left:8px;padding:2px 9px;border-radius:10px;background:var(--ac);color:var(--ok);font-weight:700;font-size:11px}
.text{font-family:var(--serif);font-size:var(--fs,20px);line-height:1.68;white-space:pre-line;text-wrap:pretty;hyphens:none}
:root[data-f=sans] .text,:root[data-f=sans] .votd{font-family:var(--sans)}
.sub{display:block;font-style:italic;margin-bottom:10px}
.v{border-radius:5px;-webkit-box-decoration-break:clone;box-decoration-break:clone;padding:1px 0;transition:background .25s}
.v b{font:700 .56em var(--sans);color:var(--ac);vertical-align:super;margin:0 .3em 0 .55em}
.v.sel{background:var(--hl)}
.enterR{animation:inR .28s ease both}.enterL{animation:inL .28s ease both}
@keyframes inR{from{opacity:0;transform:translateX(30px)}to{opacity:1;transform:none}}
@keyframes inL{from{opacity:0;transform:translateX(-30px)}to{opacity:1;transform:none}}
.endnav{display:flex;gap:10px;margin-top:30px}.endnav .btn{flex:1}
.vbar{position:fixed;left:12px;right:12px;bottom:calc(64px + env(safe-area-inset-bottom));z-index:5;display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:18px;background:var(--card);border:1px solid var(--ln);box-shadow:var(--sh);transform:translateY(24px);opacity:0;pointer-events:none;transition:transform .25s ease,opacity .25s ease}
.vbar.on{transform:none;opacity:1;pointer-events:auto}.vbar .r{flex:1;font:700 15px var(--sans);min-width:0}.vbar .btn{min-height:42px;padding:8px 14px;font-size:15px}
.search{width:100%;font:17px var(--sans);padding:13px 14px;border-radius:14px;border:1px solid var(--ln);background:var(--card);color:var(--ink);outline:none;margin-bottom:6px}
.search:focus{border-color:var(--ac)}
.bk{display:flex;width:100%;align-items:center;justify-content:space-between;min-height:50px;padding:10px 12px;border-radius:12px;font:600 17px var(--sans);text-align:left}
.bk:active{background:var(--bt)}.bk i{font:500 13px var(--sans);color:var(--mu)}.bkw.cur>.bk{color:var(--ac)}
.chs{display:grid;grid-template-rows:0fr;transition:grid-template-rows .26s ease}.bkw.open .chs{grid-template-rows:1fr}.chs>div{overflow:hidden}
.cg{display:grid;grid-template-columns:repeat(auto-fill,minmax(56px,1fr));gap:8px;padding:6px 4px 14px}
.cg .btn{min-height:46px;padding:0;text-align:center;font-size:16px}.cg .btn.sel{background:var(--ac);color:var(--ok)}
.searching .sechead{display:none}
.sheet{position:fixed;inset:0;z-index:20;pointer-events:none}.sheet.on{pointer-events:auto}
.scrim{position:absolute;inset:0;background:rgba(5,10,18,.5);opacity:0;transition:opacity .25s}.sheet.on .scrim{opacity:1}
.panel{position:absolute;left:0;right:0;bottom:0;max-width:42rem;margin:0 auto;max-height:88%;overflow-y:auto;background:var(--bg);border-radius:24px 24px 0 0;padding:10px 20px calc(24px + env(safe-area-inset-bottom));transform:translateY(105%);transition:transform .3s cubic-bezier(.2,.8,.2,1);box-shadow:0 -10px 40px rgba(0,0,0,.25)}
.sheet.on .panel{transform:none}
.grab{width:40px;height:5px;border-radius:3px;background:var(--ln);margin:0 auto 12px}
.panel h2{margin:4px 0 14px;font:700 22px var(--sans)}.panel h4{margin:22px 0 8px;font:700 12px var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--mu)}
.seg{display:flex;padding:3px;border-radius:13px;background:var(--bt)}.seg button{flex:1;min-height:42px;border-radius:10px;font:700 15px var(--sans);color:var(--mu);transition:background .2s,color .2s}.seg button.on{background:var(--ac);color:var(--ok)}
.size{display:flex;align-items:center;gap:12px}.size button{min-width:44px;min-height:44px;border-radius:12px;background:var(--bt);color:var(--ac);font:700 18px var(--serif)}
input[type=range]{flex:1;accent-color:var(--ac);height:30px}
.prev{margin-top:10px;padding:14px 16px;border-radius:14px;background:var(--card);border:1px solid var(--ln);font-family:var(--serif);font-size:var(--fs,20px);line-height:1.5}
.foot{margin-top:22px;color:var(--mu);font-size:12px}
.toast{position:fixed;left:50%;top:calc(max(8px,env(safe-area-inset-top)) + 58px);z-index:30;transform:translate(-50%,-14px);opacity:0;padding:10px 18px;border-radius:20px;background:var(--ink);color:var(--bg);font:700 14px var(--sans);transition:transform .25s,opacity .25s;pointer-events:none}
.toast.on{transform:translate(-50%,0);opacity:1}
#splash{position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:var(--bg);color:var(--ac);transition:opacity .35s}
#splash.off{opacity:0;pointer-events:none}#splash svg{width:54px;height:54px;stroke:currentColor;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;animation:pu 1.6s ease-in-out infinite}
#splash p{margin:0;color:var(--mu);font:600 14px var(--sans)}
@keyframes pu{50%{opacity:.45;transform:scale(.95)}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;
const ICON = {
  today: '<path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z"/>',
  read: '<path d="M12 6c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-13C17 4 14 4.5 12 6zM12 6v13"/>',
  books: '<path d="M5 5h3v14H5zM10 5h3v14h-3zM15.5 6.5l2.8-.8 3 12.4-2.8.8z"/>'
};
const READER_BODY = `
<div id="app">
  <header class="top">
    <button class="ico" id="prev" aria-label="Previous chapter" hidden>‹</button>
    <button class="ttl" id="ttl">Today</button>
    <button class="ico" id="next" aria-label="Next chapter" hidden>›</button>
    <span class="grow"></span>
    <button class="ico aa" id="aa" aria-label="Reading settings">Aa</button>
  </header>
  <div class="views">
    <section class="view on" id="v-today" aria-label="Today"></section>
    <section class="view" id="v-read" aria-label="Read"></section>
    <section class="view" id="v-books" aria-label="Books"></section>
  </div>
  <div class="vbar" id="vbar"></div>
  <nav class="tabs" id="tabs">
    <button data-tab="today" class="on"><svg viewBox="0 0 24 24">${ICON.today}</svg>Today</button>
    <button data-tab="read"><svg viewBox="0 0 24 24">${ICON.read}</svg>Read</button>
    <button data-tab="books"><svg viewBox="0 0 24 24">${ICON.books}</svg>Books</button>
  </nav>
  <div class="sheet" id="sheet"><div class="scrim" id="scrim"></div><div class="panel" id="panel"></div></div>
  <div class="toast" id="toast" role="status"></div>
  <div id="splash"><svg viewBox="0 0 24 24">${ICON.read}</svg><p>Opening your Bible…</p></div>
</div>`;

function readerMain() { // runs inside the WebView; talks to Scriptable only through send() and App.next()
  const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const one = t => String(t).replace(/\s*\n\s*/g, " ").trim();
  const st = { set: { size: 20, theme: "auto", font: "serif" }, books: [], plan: null, cur: null, sel: null, view: "today", loading: false, tag: 0, want: null, off: false, cache: {}, booted: false };
  const root = document.documentElement;

  // ── bridge: a queue, delivered whenever Scriptable has an open callback ──
  let Q = [], cb = null;
  const flush = () => { if (cb && Q.length) { const f = cb; cb = null; f(Q.shift()); } };
  const send = m => { Q.push(m); flush(); };
  window.App = { next(events, completion) { (events || []).forEach(handle); cb = completion; flush(); } };

  const book = id => st.books.find(b => b.id === id);
  const key = (b, c) => b + ":" + c;
  const toast = (m) => { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("on"), 1800); };
  const applySettings = () => { root.dataset.t = st.set.theme; root.dataset.f = st.set.font; root.style.setProperty("--fs", st.set.size + "px"); };
  const saveSettings = () => send({ a: "settings", size: st.set.size, theme: st.set.theme, font: st.set.font });
  const nbr = (b, c, d) => { // neighbouring chapter or null at the ends of the Bible
    const i = st.books.findIndex(x => x.id === b); if (i < 0) return null;
    if (d > 0) return c < st.books[i].c ? { b, c: c + 1 } : st.books[i + 1] ? { b: st.books[i + 1].id, c: 1 } : null;
    return c > 1 ? { b, c: c - 1 } : st.books[i - 1] ? { b: st.books[i - 1].id, c: st.books[i - 1].c } : null;
  };

  // ── navigation between tabs ──
  function setView(v) {
    st.view = v;
    $$(".view").forEach(el => el.classList.toggle("on", el.id === "v-" + v));
    $$("#tabs button").forEach(el => el.classList.toggle("on", el.dataset.tab === v));
    const ttl = $("#ttl"), read = v === "read" && st.cur;
    $("#prev").hidden = $("#next").hidden = !read;
    ttl.classList.toggle("btn", !!read);
    if (read) { const b = book(st.cur.b); ttl.innerHTML = esc(b ? b.n : st.cur.b) + " " + st.cur.c + '<span class="car">▾</span>'; }
    else ttl.textContent = v === "today" ? "Today" : v === "books" ? "Books" : "Read";
    if (read) { $("#prev").disabled = !nbr(st.cur.b, st.cur.c, -1); $("#next").disabled = !nbr(st.cur.b, st.cur.c, 1); }
    if (v !== "read") hideBar();
    if (v === "books") openCurrentBook();
  }

  // ── Today ──
  function renderToday() {
    const el = $("#v-today"), p = st.plan;
    if (!st.booted) { el.innerHTML = '<div class="wrap skel"><i></i><i></i><i style="width:70%"></i></div>'; return; }
    if (!p || p.err) {
      el.innerHTML = '<div class="wrap"><div class="err"><h2>Couldn’t load today’s verse</h2><p>' + esc(p && p.err ? p.err : "Check your connection.") + '</p><button class="btn pri" id="retry">Try Again</button></div></div>';
      return;
    }
    const L = p.text.length, fs = L < 110 ? 30 : L < 220 ? 26 : L < 380 ? 22 : 19;
    const total = st.books.reduce((a, b) => a + b.c, 0); let before = 0;
    for (const b of st.books) { if (b.id === p.b) break; before += b.c; }
    const idx = before + p.c, pct = Math.max(1, Math.round(idx / total * 100));
    const cb_ = st.cur && book(st.cur.b);
    el.innerHTML = '<div class="wrap"><div class="hero"><div class="eyebrow">Today’s verse · Day ' + p.day + '</div>' +
      '<div class="votd" style="font-size:' + fs + 'px">“' + esc(one(p.text)) + '”</div>' +
      '<div class="vref">' + esc(p.bn + " " + p.c + ":" + p.v) + '</div><div class="vsub">' + esc(p.tn) + (p.stale ? " · waiting for connection" : "") + '</div>' +
      '<div class="row"><button class="btn pri" id="ctx">Read in context</button><button class="btn" id="cpy">Copy</button></div></div>' +
      '<div class="card"><h3>Your daily plan</h3><p class="mu">One verse a day, in order, from Genesis 1:1 to Revelation 22:21. Tomorrow: <b>' + esc(p.next.ref) + '</b>.</p>' +
      '<div class="bar" aria-label="Progress through the Bible"><i style="width:' + pct + '%"></i></div><div class="mu">Chapter ' + idx.toLocaleString() + ' of ' + total.toLocaleString() + '</div></div>' +
      (cb_ ? '<button class="card" id="cont"><h3>Continue reading</h3><p><b>' + esc(cb_.n + " " + st.cur.c) + '</b> <span class="mu">›</span></p></button>' : "") + '</div>';
  }

  // ── Read ──
  function renderRead() {
    const el = $("#v-read");
    if (!st.cur) { el.innerHTML = '<div class="wrap"><div class="card"><p class="mu">Pick a book to start reading.</p></div></div>'; return; }
    const k = key(st.cur.b, st.cur.c), ch = st.cache[k], b = book(st.cur.b);
    if (!ch) {
      el.innerHTML = '<div class="wrap">' + (st.cur.err ? '<div class="err"><h2>Couldn’t load ' + esc(b.n + " " + st.cur.c) + '</h2><p>' + esc(st.cur.err) + '</p><button class="btn pri" id="retry">Try Again</button></div>'
        : '<h1 class="chtitle">' + esc(b.n + " " + st.cur.c) + '</h1><div class="skel"><i></i><i></i><i style="width:80%"></i><i></i><i style="width:60%"></i><i></i></div>') + '</div>';
      return;
    }
    const n = nbr(st.cur.b, st.cur.c, 1), p = nbr(st.cur.b, st.cur.c, -1);
    el.innerHTML = '<div class="wrap"><div id="chap" class="' + (st.anim || "") + '"><h1 class="chtitle">' + esc(b.n + " " + st.cur.c) + '</h1><div class="meta">' + esc(ch.tl) + " (" + esc(ch.tn) + ")" +
      (st.off ? '<span class="badge">Offline</span>' : "") + ' · tap a verse</div><div class="text">' +
      (ch.sub ? '<span class="sub">' + esc(ch.sub) + "</span>" : "") +
      ch.verses.map(v => '<span class="v' + (st.sel === v.n ? " sel" : "") + '" data-n="' + v.n + '"><b>' + v.n + "</b>" + esc(v.t) + "</span>").join(" ") + "</div>" +
      '<div class="endnav">' + (p ? '<button class="btn" id="eprev">‹ ' + esc(book(p.b).n + " " + p.c) + "</button>" : "") +
      (n ? '<button class="btn pri" id="enext">' + esc(book(n.b).n + " " + n.c) + " ›</button>" : "") + "</div></div></div>";
    st.anim = "";
    const sv = $(".v.sel"); if (sv && st.scrollSel) { st.scrollSel = false; sv.scrollIntoView({ block: "center", behavior: "smooth" }); }
    updateBar();
  }
  function openChapter(b, c, v, dir) {
    st.cur = { b, c }; st.sel = v || null; st.scrollSel = !!v; st.anim = dir > 0 ? "enterR" : dir < 0 ? "enterL" : "";
    if (!st.cache[key(b, c)]) { st.want = ++st.tag; send({ a: "chapter", b, c, v: v || 0, dir: dir || 0, tag: st.want }); }
    else { send({ a: "place", b, c, v: v || 1 }); }
    renderRead(); setView("read");
    if (!v) $("#v-read").scrollTop = 0;
    renderToday();
  }
  const verseText = n => { const ch = st.cache[key(st.cur.b, st.cur.c)], v = ch && ch.verses.find(x => x.n === n); return v ? one(v.t) : ""; };
  function updateBar() {
    const bar = $("#vbar");
    if (st.view !== "read" || !st.sel || !st.cur) { bar.classList.remove("on"); return; }
    const b = book(st.cur.b);
    bar.innerHTML = '<span class="r">' + esc(b.n + " " + st.cur.c + ":" + st.sel) + '</span><button class="btn" id="vcopy">Copy</button><button class="btn pri" id="vplan">Start plan here</button>';
    bar.classList.add("on");
  }
  const hideBar = () => $("#vbar").classList.remove("on");

  // ── Books ──
  function buildBooks() {
    const el = $("#v-books"), mat = st.books.findIndex(b => b.id === "MAT");
    let html = '<div class="wrap"><input class="search" id="q" type="search" placeholder="Find a book" autocapitalize="off" autocorrect="off" aria-label="Find a book"><div id="bl">';
    st.books.forEach((b, i) => {
      if (i === 0 && mat > 0) html += '<div class="sechead">Old Testament</div>';
      if (i === mat && mat > 0) html += '<div class="sechead">New Testament</div>';
      html += '<div class="bkw" data-b="' + b.id + '" data-t="' + esc(b.n.toLowerCase()) + '"><button class="bk" aria-expanded="false"><span>' + esc(b.n) + "</span><i>" + b.c + (b.c === 1 ? " chapter" : " chapters") + '</i></button><div class="chs"><div><div class="cg"></div></div></div></div>';
    });
    el.innerHTML = html + "</div></div>";
  }
  function toggleBook(w, force) {
    const open = force !== undefined ? force : !w.classList.contains("open");
    $$(".bkw.open").forEach(o => { if (o !== w) { o.classList.remove("open"); $(".bk", o).setAttribute("aria-expanded", "false"); } });
    if (open && !$(".cg", w).children.length) {
      const b = book(w.dataset.b); let h = "";
      for (let i = 1; i <= b.c; i++) h += '<button class="btn' + (st.cur && st.cur.b === b.id && st.cur.c === i ? " sel" : "") + '" data-c="' + i + '">' + i + "</button>";
      $(".cg", w).innerHTML = h;
    }
    w.classList.toggle("open", open); $(".bk", w).setAttribute("aria-expanded", String(open));
    if (open) setTimeout(() => w.scrollIntoView({ block: "nearest", behavior: "smooth" }), 60);
  }
  function openCurrentBook() {
    if (!st.cur) return;
    $$(".bkw").forEach(w => { w.classList.toggle("cur", w.dataset.b === st.cur.b); $$(".cg .btn", w).forEach(x => x.classList.toggle("sel", w.dataset.b === st.cur.b && +x.dataset.c === st.cur.c)); });
    const w = $('.bkw[data-b="' + st.cur.b + '"]'); if (w && !w.classList.contains("open")) { toggleBook(w, true); setTimeout(() => w.scrollIntoView({ block: "center" }), 80); }
  }

  // ── sheets ──
  function sheet(html) { $("#panel").innerHTML = '<div class="grab"></div>' + html; $("#sheet").classList.add("on"); }
  const closeSheet = () => $("#sheet").classList.remove("on");
  function settingsSheet() {
    const p = st.plan && !st.plan.err ? st.plan : null;
    const seg = (name, items, cur) => '<div class="seg" data-s="' + name + '">' + items.map(i => '<button data-v="' + i[0] + '" class="' + (cur === i[0] ? "on" : "") + '">' + i[1] + "</button>").join("") + "</div>";
    sheet('<h2>Reading</h2><h4>Text size</h4><div class="size"><button data-sz="-2" aria-label="Smaller">A</button><input type="range" id="rng" min="14" max="36" step="1" value="' + st.set.size + '" aria-label="Text size"><button data-sz="2" aria-label="Larger" style="font-size:24px">A</button></div>' +
      '<div class="prev" id="prevtxt">In the beginning God created the heavens and the earth.</div>' +
      "<h4>Typeface</h4>" + seg("font", [["serif", "Serif"], ["sans", "Sans"]], st.set.font) +
      "<h4>Appearance</h4>" + seg("theme", [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]], st.set.theme) +
      "<h4>Daily plan</h4>" + (p ? '<p style="margin:0 0 10px">Day ' + p.day + " · " + esc(p.bn + " " + p.c + ":" + p.v) + "</p>" : "") +
      '<button class="btn full" id="restart">Restart at Genesis 1:1</button>' +
      '<div class="foot">Scripture: ' + (p ? esc(p.tl) : "Berean Standard Bible") + " via bible.helloao.org</div>");
  }
  function confirmSheet(title, body, yesId, yesLabel) {
    sheet("<h2>" + esc(title) + '</h2><p style="margin:0 0 18px;color:var(--mu)">' + esc(body) + '</p><div class="row" style="margin-top:0"><button class="btn pri" id="' + yesId + '">' + esc(yesLabel) + '</button><button class="btn" id="no">Cancel</button></div>');
  }

  // ── events from Scriptable ──
  function handle(ev) {
    if (ev.t === "boot") {
      if (ev.err) { st.booted = true; st.plan = { err: ev.err }; renderToday(); $("#splash").classList.add("off"); return; }
      st.set = ev.settings; st.books = ev.books; st.plan = ev.plan; st.booted = true; applySettings(); buildBooks();
      if (ev.chapter && !ev.chapter.err) { st.cache[key(ev.place.b, ev.place.c)] = ev.chapter.d; st.off = !!ev.chapter.off; }
      st.cur = { b: ev.place.b, c: ev.place.c, err: ev.chapter && ev.chapter.err };
      renderToday();
      if (ev.open) { st.sel = ev.place.v; st.scrollSel = true; renderRead(); setView("read"); } else { st.sel = null; renderRead(); setView("today"); }
      setTimeout(() => $("#splash").classList.add("off"), 60);
    } else if (ev.t === "chapter") {
      st.cache[key(ev.b, ev.c)] = ev.ch; if (st.want === ev.tag) { st.off = !!ev.off; if (st.cur) st.cur.err = null; renderRead(); setView(st.view); }
    } else if (ev.t === "chapterError") {
      if (st.want === ev.tag && st.cur) { st.cur.err = ev.m; renderRead(); }
    } else if (ev.t === "plan") { st.plan = ev.plan; renderToday(); }
    else if (ev.t === "toast") toast(ev.m);
  }

  // ── input ──
  document.addEventListener("click", e => {
    const t = e.target, q = s => t.closest(s);
    if (q("#tabs button")) { setView(q("#tabs button").dataset.tab); return; }
    if (q("#ttl.btn")) { setView("books"); return; }
    if (q("#prev")) { const n = nbr(st.cur.b, st.cur.c, -1); if (n) openChapter(n.b, n.c, 0, -1); return; }
    if (q("#next") || q("#enext")) { const n = nbr(st.cur.b, st.cur.c, 1); if (n) openChapter(n.b, n.c, 0, 1); return; }
    if (q("#eprev")) { const n = nbr(st.cur.b, st.cur.c, -1); if (n) openChapter(n.b, n.c, 0, -1); return; }
    if (q("#aa")) { settingsSheet(); return; }
    if (q("#scrim") || q("#no")) { closeSheet(); return; }
    if (q("#retry")) { if (st.view === "read" && st.cur && st.cur.err) openChapter(st.cur.b, st.cur.c, st.sel, 0); else send({ a: "boot" }); return; }
    if (q("#ctx")) { const p = st.plan; openChapter(p.b, p.c, p.v, 0); return; }
    if (q("#cpy")) { const p = st.plan; send({ a: "copy", t: "“" + one(p.text) + "” — " + p.bn + " " + p.c + ":" + p.v + " (" + p.tn + ")" }); return; }
    if (q("#cont")) { openChapter(st.cur.b, st.cur.c, 0, 0); return; }
    const v = q(".v");
    if (v) { const n = +v.dataset.n; st.sel = st.sel === n ? null : n; $$(".v.sel").forEach(x => x.classList.remove("sel")); if (st.sel) v.classList.add("sel"); updateBar(); send({ a: "place", b: st.cur.b, c: st.cur.c, v: st.sel || 1 }); return; }
    if (q("#vcopy")) { const b = book(st.cur.b), ch = st.cache[key(st.cur.b, st.cur.c)]; send({ a: "copy", t: "“" + verseText(st.sel) + "” — " + b.n + " " + st.cur.c + ":" + st.sel + " (" + ch.tn + ")" }); return; }
    if (q("#vplan")) { const b = book(st.cur.b); confirmSheet("Start your plan here?", "Your daily verse will begin at " + b.n + " " + st.cur.c + ":" + st.sel + " today, then move forward one verse each day.", "yesplan", "Start here"); return; }
    if (q("#yesplan")) { send({ a: "plan", mode: "here", b: st.cur.b, c: st.cur.c, v: st.sel }); closeSheet(); hideBar(); return; }
    if (q("#restart")) { confirmSheet("Restart at Genesis 1:1?", "Day 1 begins today, and the plan moves forward one verse each day.", "yesstart", "Restart"); return; }
    if (q("#yesstart")) { send({ a: "plan", mode: "start" }); closeSheet(); return; }
    const sg = q("[data-s] button");
    if (sg) { const k = sg.parentNode.dataset.s; st.set[k] = sg.dataset.v; $$("button", sg.parentNode).forEach(x => x.classList.toggle("on", x === sg)); applySettings(); saveSettings(); return; }
    const sz = q("[data-sz]"); if (sz) { st.set.size = Math.min(36, Math.max(14, st.set.size + +sz.dataset.sz)); $("#rng").value = st.set.size; applySettings(); saveSettings(); return; }
    const bk = q(".bk"); if (bk) { toggleBook(bk.parentNode); return; }
    const cg = q(".cg .btn"); if (cg) { openChapter(cg.closest(".bkw").dataset.b, +cg.dataset.c, 0, 1); return; }
  });
  document.addEventListener("input", e => {
    if (e.target.id === "rng") { st.set.size = +e.target.value; applySettings(); }
    if (e.target.id === "q") { const s = e.target.value.trim().toLowerCase(); $("#v-books .wrap").classList.toggle("searching", !!s); $$(".bkw").forEach(w => { w.hidden = !!s && w.dataset.t.indexOf(s) < 0; }); }
  });
  document.addEventListener("change", e => { if (e.target.id === "rng") saveSettings(); });
  let sx = 0, sy = 0;
  document.addEventListener("touchstart", e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  document.addEventListener("touchend", e => {
    if (st.view !== "read" || !st.cur || $("#sheet").classList.contains("on")) return;
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 80 && Math.abs(dy) < 40) { const n = nbr(st.cur.b, st.cur.c, dx < 0 ? 1 : -1); if (n) openChapter(n.b, n.c, 0, dx < 0 ? 1 : -1); }
  }, { passive: true });
  renderToday();
}

const readerHTML = () => '<!DOCTYPE html><html data-t="' + S.theme + '" data-f="' + S.font + '"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>' + READER_CSS + "</style></head><body>" + READER_BODY +
  "<script>(" + readerMain.toString() + ")();</script></body></html>";

async function bootEvent(q) {
  try {
    const bs = await getBooks(); fixPos(bs);
    let open = false, place = { b: pos.b, c: pos.c, v: pos.v };
    if (q && q.b && okLoc(bs, q.b, q.c)) { place = { b: q.b, c: +q.c, v: Math.max(1, +q.v || 1) }; open = true; }
    const [plan, chapter] = await Promise.all([
      planToday(bs).catch(e => ({ err: e.message })),
      chap(place.b, place.c, false, 7).then(r => ({ d: r.d, off: !!r.off })).catch(e => ({ err: e.message }))
    ]);
    return { t: "boot", settings: { size: S.size, theme: S.theme, font: S.font }, books: bs, plan, chapter, place, open };
  } catch (e) { return { t: "boot", err: e.message }; }
}
async function prefetch(bs, b, c) { // warms the offline cache for the chapters on either side
  const i = bs.findIndex(x => x.id === b), k = bs[i]; if (!k) return;
  const n = c < k.c ? { b, c: c + 1 } : bs[i + 1] && { b: bs[i + 1].id, c: 1 }, p = c > 1 ? { b, c: c - 1 } : bs[i - 1] && { b: bs[i - 1].id, c: bs[i - 1].c };
  for (const x of [n, p]) if (x) try { await chap(x.b, x.c, true, 6); } catch (e) {}
}
async function handle(m) {
  const bs = await getBooks();
  switch (m.a) {
    case "boot": return [await bootEvent({})];
    case "chapter":
      if (!okLoc(bs, m.b, m.c)) return [{ t: "chapterError", tag: m.tag, m: "That chapter does not exist." }];
      try { const r = await chap(m.b, +m.c, false, 7); pos = { b: m.b, c: +m.c, v: m.v > 0 ? m.v : 1 }; wr(F.pos, pos); prefetch(bs, m.b, +m.c);
        return [{ t: "chapter", tag: m.tag, b: m.b, c: +m.c, ch: r.d, off: !!r.off }]; }
      catch (e) { return [{ t: "chapterError", tag: m.tag, m: e.message }]; }
    case "place": if (okLoc(bs, m.b, m.c)) { pos = { b: m.b, c: +m.c, v: Math.max(1, +m.v || 1) }; wr(F.pos, pos); } return [];
    case "settings": S.size = Math.min(36, Math.max(14, Math.round(+m.size) || 20)); if (["auto", "light", "dark"].includes(m.theme)) S.theme = m.theme; if (["serif", "sans"].includes(m.font)) S.font = m.font; wr(F.set, S); return [];
    case "copy": Pasteboard.copy(String(m.t)); return [{ t: "toast", m: "Copied" }];
    case "plan": {
      const T = dayNum(); let np;
      if (m.mode === "here" && okLoc(bs, m.b, m.c) && Number.isInteger(+m.v) && +m.v >= 1) np = { ver: 1, s: T, d: T, b: m.b, c: +m.c, v: +m.v };
      else if (m.mode === "start") np = { ver: 1, s: T, d: T, b: bs[0].id, c: 1, v: 1 };
      else return [];
      wr(F.plan, np);
      try { const t = await planToday(bs); return [{ t: "plan", plan: t }, { t: "toast", m: "Plan starts at " + planRef(t) }]; }
      catch (e) { return [{ t: "toast", m: "Couldn’t update the plan: " + e.message }]; }
    }
  }
  return [];
}
async function reader(q) {
  const wv = new WebView();
  await wv.loadHTML(readerHTML());
  const closed = wv.present(true).then(() => ({ a: "close" }));
  let out = [await bootEvent(q)];
  for (;;) {
    const m = await Promise.race([closed, wv.evaluateJavaScript("App.next(" + JSON.stringify(out) + ",completion)", true).catch(() => new Promise(() => {}))]);
    if (!m || m.a === "close") return;
    try { out = await handle(m); } catch (e) { out = [{ t: "toast", m: "Something went wrong: " + e.message }]; }
  }
}

async function main() {
  const q = args.queryParameters || {};
  if (config.runsInWidget || q.preview) {
    const fam = config.widgetFamily || q.preview || "medium", w = await widget(fam);
    if (config.runsInWidget) Script.setWidget(w);
    else await w["present" + ({ small: "Small", large: "Large", extraLarge: "ExtraLarge", accessoryRectangular: "AccessoryRectangular", accessoryInline: "AccessoryInline", accessoryCircular: "AccessoryCircular" }[fam] || "Medium")]();
  } else await reader(q);
  Script.complete();
}
main().catch(async e => { const a = new Alert(); a.title = "Bible script error"; a.message = String(e && e.message || e); a.addAction("OK"); await a.present(); Script.complete(); });
