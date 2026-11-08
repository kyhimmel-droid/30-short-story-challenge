"use strict";

const TOPICS = [
  "むかし読んで忘れられない短篇", "繰り返し読む・読みたい短篇", "もっと評価されるべき短篇",
  "発想がすごい短篇", "技巧がすごい短篇", "構造がすごい短篇", "笑える短篇", "こわい短篇",
  "切ない短篇", "ときめく短篇", "美しい短篇", "泣いた短篇", "むずかしい短篇", "謎を残す短篇",
  "変な短篇", "怒りを書いた短篇", "掌篇", "中篇", "英米以外の翻訳小説", "巨視的", "微視的",
  "古典", "準古典", "現代", "人物が印象的", "文章が印象的", "幕切れが印象的",
  "好きな作家の一作", "好きなシリーズ・連作からひとつ", "人には薦められないけど好き",
];
const STORE_KEY = "30ssc:v1";
const $ = (s) => document.querySelector(s);

/* ---------- 状態 ---------- */
let state = blank();
let mine = null;          // 共有URLを見ている間、自分の一覧を退避
let readonly = false;

function blank() {
  return { name: "", items: TOPICS.map(() => ({ t: "", a: "", s: "", u: "" })) };
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return blank();
    const d = JSON.parse(raw);
    const b = blank();
    b.name = String(d.name || "");
    (d.items || []).slice(0, 30).forEach((x, i) => Object.assign(b.items[i], {
      t: String(x.t || ""), a: String(x.a || ""), s: String(x.s || ""), u: String(x.u || ""),
    }));
    return b;
  } catch { return blank(); }
}
let saveTimer = 0;
function save() {
  if (readonly) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
  }, 250);
}

/* ---------- 正規化と検索 ---------- */
function norm(s) {
  return (s || "").normalize("NFKC").toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s・･:：,，.。、'’‘"“”!！?？\-‐–—―ー「」『』()（）［］\[\]〈〉《》&＆]/g, "");
}
const isJa = (s) => /[぀-ヿ㐀-鿿]/.test(s);

const SRC = {
  aozora: { label: "青空文庫" },
  isfdb: { label: "ISFDB（SF・幻想・ホラー）" },
  wikidata: { label: "Wikidata" },
};

let aozora = null, isfdb = null, isfdbLoading = null;
async function loadAozora() {
  if (aozora) return aozora;
  const rows = await (await fetch("data/aozora.json")).json();
  aozora = rows.map((r) => ({
    t: r[0], r: r[1], sub: r[2], a: r[3], tr: r[4], book: r[5], id: r[6], pid: r[7],
    k: norm(r[0] + r[2]), kr: norm(r[1]), ka: norm(r[3]),
  }));
  return aozora;
}
function loadIsfdb() {
  if (isfdb) return Promise.resolve(isfdb);
  if (!isfdbLoading) {
    isfdbLoading = fetch("data/isfdb.json").then((r) => r.json()).then((rows) => {
      isfdb = rows.map((r) => ({
        t: r[0], ja: r[1], a: r[2], y: r[3], len: r[4], id: r[5], n: r[6],
        k: norm(r[0]), kj: norm(r[1]), ka: norm(r[2]),
      }));
      return isfdb;
    }).catch(() => (isfdb = []));
  }
  return isfdbLoading;
}

function termScore(term, keys, authorKey) {
  let best = 0;
  for (const k of keys) {
    if (!k) continue;
    if (k === term) best = Math.max(best, 100);
    else if (k.startsWith(term)) best = Math.max(best, 60);
    else if (k.includes(term)) best = Math.max(best, 30);
  }
  if (authorKey && authorKey.includes(term)) best = Math.max(best, authorKey.startsWith(term) ? 25 : 18);
  return best;
}
function searchLocal(list, q, keysOf, bonus, limit) {
  const terms = q.split(/\s+/).map(norm).filter(Boolean);
  if (!terms.length) return [];
  const hits = [];
  for (const x of list) {
    let s = 0;
    for (const t of terms) {
      const v = termScore(t, keysOf(x), x.ka);
      if (!v) { s = 0; break; }
      s += v;
    }
    if (s) hits.push([s + bonus(x), x]);
  }
  hits.sort((p, q2) => q2[0] - p[0]);
  return hits.slice(0, limit).map((h) => h[1]);
}

const LEN = { S: "短篇", T: "中短篇", N: "中篇" };
function fromAozora(x) {
  const parts = [x.a + (x.tr ? `（${x.tr} 訳）` : ""), x.book && `底本『${x.book}』`].filter(Boolean);
  return {
    src: "aozora", title: x.t + (x.sub ? `　${x.sub}` : ""), author: x.a, sub: parts.join("　"),
    url: `https://www.aozora.gr.jp/cards/${x.pid}/card${x.id}.html`,
  };
}
function fromIsfdb(x) {
  const parts = [x.ja ? x.t : "", x.a, x.y, LEN[x.len]].filter(Boolean);
  return {
    src: "isfdb", title: x.ja || x.t, author: x.a, sub: parts.join("・"),
    url: `https://www.isfdb.org/cgi-bin/title.cgi?${x.id}`,
  };
}

/* Wikidata：その場で検索し、文学作品だけに絞る */
const WD_API = "https://www.wikidata.org/w/api.php";
const WD_WORK = new Set(["Q49084", "Q7725634", "Q149537", "Q8261", "Q47461344", "Q1279564", "Q25379"]);
const wdCache = new Map();
async function wdGet(params) {
  const u = new URL(WD_API);
  Object.entries({ ...params, format: "json", origin: "*" }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u);
  if (!r.ok) throw new Error("wikidata " + r.status);
  return r.json();
}
async function searchWikidata(q) {
  if (wdCache.has(q)) return wdCache.get(q);
  const lang = isJa(q) ? "ja" : "en";
  const s = await wdGet({ action: "wbsearchentities", search: q, language: lang, uselang: "ja", type: "item", limit: "15" });
  const ids = (s.search || []).map((x) => x.id);
  if (!ids.length) { wdCache.set(q, []); return []; }
  const e = await wdGet({ action: "wbgetentities", ids: ids.join("|"), props: "claims|labels", languages: "ja|en" });
  const works = [];
  const authorIds = new Set();
  for (const id of ids) {
    const ent = e.entities?.[id];
    if (!ent) continue;
    const p31 = (ent.claims?.P31 || []).map((c) => c.mainsnak?.datavalue?.value?.id);
    if (!p31.some((v) => WD_WORK.has(v))) continue;
    const au = (ent.claims?.P50 || []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
    au.forEach((a) => authorIds.add(a));
    const hit = s.search.find((x) => x.id === id);
    works.push({
      id, au, desc: hit?.description || "",
      title: ent.labels?.ja?.value || ent.labels?.en?.value || hit?.label || id,
      orig: ent.labels?.ja && ent.labels?.en ? ent.labels.en.value : "",
    });
    if (works.length >= 6) break;
  }
  const names = {};
  if (authorIds.size) {
    const a = await wdGet({ action: "wbgetentities", ids: [...authorIds].slice(0, 50).join("|"), props: "labels", languages: "ja|en" });
    for (const [k, v] of Object.entries(a.entities || {})) names[k] = v.labels?.ja?.value || v.labels?.en?.value || "";
  }
  const seen = new Set();
  const out = works.map((w) => {
    const author = w.au.map((x) => names[x]).filter(Boolean).join("・");
    return {
      src: "wikidata", title: w.title, author,
      sub: [w.orig, author || w.desc].filter(Boolean).join("・"),
      url: `https://www.wikidata.org/wiki/${w.id}`,
    };
  }).filter((x) => {
    const k = x.title + "|" + x.author;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  wdCache.set(q, out);
  return out;
}

/* ---------- 目次の描画 ---------- */
const toc = $("#toc");
const tpl = $("#row-tpl");
const rows = [];

function buildRows() {
  TOPICS.forEach((topic, i) => {
    const li = tpl.content.firstElementChild.cloneNode(true);
    const no = String(i + 1).padStart(2, "0");
    li.querySelector(".no").textContent = no;
    li.querySelector(".topic").textContent = topic;
    const ti = li.querySelector(".in-title");
    const au = li.querySelector(".in-author");
    ti.id = `t${no}`; au.id = `a${no}`;
    ti.setAttribute("aria-label", `${no} ${topic} の作品名`);
    au.setAttribute("aria-label", `${no} ${topic} の作者`);
    ti.addEventListener("input", () => {
      Object.assign(state.items[i], { t: ti.value, s: "", u: "" });
      refreshRow(i); save(); onQuery(i);
    });
    au.addEventListener("input", () => { state.items[i].a = au.value; refreshRow(i); save(); });
    ti.addEventListener("focus", () => onQuery(i));
    ti.addEventListener("keydown", (ev) => onKey(ev, i));
    ti.addEventListener("blur", () => setTimeout(() => { if (active === i && document.activeElement !== ti) closeSuggest(); }, 150));
    const work = document.createElement("p");
    work.className = "work";
    li.querySelector(".body").insertBefore(work, li.querySelector(".meta"));
    toc.appendChild(li);
    rows.push({ li, ti, au, work, meta: li.querySelector(".meta") });
  });
}

function refreshRow(i) {
  const it = state.items[i];
  const r = rows[i];
  r.li.classList.toggle("filled", !!it.t.trim());
  r.meta.textContent = "";
  if (it.u && it.s && SRC[it.s]) {
    const a = document.createElement("a");
    a.href = it.u; a.target = "_blank"; a.rel = "noopener";
    a.textContent = `${SRC[it.s].label}で見る`;
    r.meta.append(a);
  }
  r.work.textContent = "";
  r.work.classList.toggle("empty", !it.t.trim());
  if (it.t.trim()) {
    r.work.append(`『${it.t.trim()}』`);
    if (it.a.trim()) {
      const s = document.createElement("span");
      s.className = "au"; s.textContent = it.a.trim();
      r.work.append(s);
    }
  } else r.work.textContent = "―";
  updateCount();
}
function updateCount() {
  $("#count").textContent = state.items.filter((x) => x.t.trim()).length;
}
function render() {
  $("#editor").value = state.name;
  rows.forEach((r, i) => {
    r.ti.value = state.items[i].t;
    r.au.value = state.items[i].a;
    refreshRow(i);
  });
  toc.classList.toggle("readonly", readonly);
  rows.forEach((r) => { r.work.hidden = !readonly; });
  $("#editor").readOnly = readonly;
  $("#btn-clear").hidden = readonly;
  $("#btn-url").hidden = readonly;
}

/* ---------- 候補ポップアップ ---------- */
const sg = $("#suggest");
let active = -1, sel = -1, items = [], qSeq = 0, wdTimer = 0;

function place(i) {
  const r = rows[i].ti.getBoundingClientRect();
  const w = Math.min(Math.max(r.width, 320), document.documentElement.clientWidth - 24);
  const left = Math.min(r.left + scrollX, scrollX + document.documentElement.clientWidth - w - 12);
  sg.style.left = Math.max(12 + scrollX, left) + "px";
  sg.style.top = r.bottom + scrollY + 4 + "px";
  sg.style.width = w + "px";
}
function closeSuggest() {
  sg.hidden = true;
  if (active >= 0) rows[active].ti.setAttribute("aria-expanded", "false");
  active = -1; sel = -1; items = [];
}
async function onQuery(i) {
  if (readonly) return;
  const q = rows[i].ti.value.trim();
  const seq = ++qSeq;
  clearTimeout(wdTimer);
  if (norm(q).length < 1) { closeSuggest(); return; }
  active = i;
  const groups = [];
  const az = searchLocal(await loadAozora(), q, (x) => [x.k, x.kr], () => 0, 6).map(fromAozora);
  const isf = await loadIsfdb();
  const sf = searchLocal(isf, q, (x) => [x.k, x.kj], (x) => Math.log2(x.n + 1), 6).map(fromIsfdb);
  if (seq !== qSeq) return;
  if (az.length) groups.push(["aozora", az]);
  if (sf.length) groups.push(["isfdb", sf]);
  draw(i, groups, norm(q).length >= 2 ? "Wikidata を検索中…" : "");
  if (norm(q).length < 2) return;
  wdTimer = setTimeout(async () => {
    let wd = [], note = "";
    try { wd = await searchWikidata(q); } catch { note = "Wikidata に接続できませんでした。"; }
    if (seq !== qSeq) return;
    if (wd.length) groups.push(["wikidata", wd]);
    draw(i, groups, note);
  }, 380);
}
function draw(i, groups, note) {
  sg.textContent = "";
  items = [];
  for (const [src, list] of groups) {
    const h = document.createElement("p");
    h.className = "sg-group"; h.textContent = SRC[src].label;
    sg.append(h);
    for (const x of list) {
      const el = document.createElement("div");
      el.className = "sg-item"; el.setAttribute("role", "option");
      el.id = `sg${items.length}`;
      const t = document.createElement("span"); t.className = "sg-t"; t.textContent = x.title;
      const s = document.createElement("span"); s.className = "sg-sub"; s.textContent = x.sub;
      el.append(t, s);
      const k = items.length;
      el.addEventListener("mousedown", (ev) => { ev.preventDefault(); pick(k); });
      sg.append(el);
      items.push(x);
    }
  }
  const foot = document.createElement("p");
  foot.className = "sg-note";
  if (note) foot.append(note + " ");
  if (!items.length && !note) foot.append("候補はありません。そのまま書き込めます。 ");
  const a = document.createElement("a");
  const au = state.items[i].a.trim() || rows[i].ti.value.trim();
  a.href = "https://www.google.com/search?q=" + encodeURIComponent(`site:ameqlist.com ${au}`);
  a.target = "_blank"; a.rel = "noopener";
  a.textContent = "翻訳作品集成で探す";
  foot.append(a);
  sg.append(foot);
  sel = -1;
  place(i);
  sg.hidden = false;
  rows[i].ti.setAttribute("aria-expanded", "true");
}
function pick(k) {
  const x = items[k];
  if (!x || active < 0) return;
  const i = active;
  Object.assign(state.items[i], { t: x.title, a: x.author || state.items[i].a, s: x.src, u: x.url });
  rows[i].ti.value = state.items[i].t;
  rows[i].au.value = state.items[i].a;
  refreshRow(i); save(); closeSuggest();
  rows[i].au.focus();
}
function onKey(ev, i) {
  if (sg.hidden || active !== i) return;
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    if (!items.length) return;
    sel = (sel + (ev.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    sg.querySelectorAll(".sg-item").forEach((el, k) => el.setAttribute("aria-selected", k === sel ? "true" : "false"));
    const el = $(`#sg${sel}`);
    el?.scrollIntoView({ block: "nearest" });
    rows[i].ti.setAttribute("aria-activedescendant", `sg${sel}`);
  } else if (ev.key === "Enter" && sel >= 0) {
    ev.preventDefault(); pick(sel);
  } else if (ev.key === "Escape") {
    closeSuggest();
  }
}
window.addEventListener("resize", () => { if (active >= 0 && !sg.hidden) place(active); });

/* ---------- 共有URL ---------- */
function b64url(bytes) {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(str) {
  const s = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
async function encodeState(st) {
  const json = JSON.stringify({ n: st.name, i: st.items.map((x) => (x.t || x.a ? [x.t, x.a] : 0)) });
  return b64url(await pipe(new TextEncoder().encode(json), new CompressionStream("deflate-raw")));
}
// 共有URLは他人が作れるので、展開後の大きさに上限を置く（正規の30件は最大でも約30KB）
const SHARE_MAX_CODE = 32768, SHARE_MAX_BYTES = 65536;
async function inflateCapped(bytes) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const out = new Uint8Array(SHARE_MAX_BYTES);
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out.subarray(0, n);
    if (n + value.length > SHARE_MAX_BYTES) { reader.cancel().catch(() => {}); throw new Error("too large"); }
    out.set(value, n); n += value.length;
  }
}
async function decodeState(code) {
  if (code.length > SHARE_MAX_CODE) throw new Error("too long");
  const d = JSON.parse(new TextDecoder().decode(await inflateCapped(unb64url(code))));
  const b = blank();
  b.name = String(d.n || "").slice(0, 30);
  (d.i || []).slice(0, 30).forEach((x, k) => {
    if (Array.isArray(x)) Object.assign(b.items[k], { t: String(x[0] || "").slice(0, 200), a: String(x[1] || "").slice(0, 120) });
  });
  return b;
}

/* ---------- 一覧画像（Canvas に直接描く） ---------- */
const IMG = {
  W: 1080, pad: 76, rowH: 86,
  paper: "#f4f5f1", ink: "#1c2421", muted: "#6a736f", line: "#c3cac5", gilt: "#94742a", cloth: "#23493f",
  mincho: '"Shippori Mincho B1", "Hiragino Mincho ProN", "Yu Mincho", serif',
  gothic: '"Zen Kaku Gothic New", "Hiragino Sans", "Yu Gothic", sans-serif',
};
function fitText(ctx, text, maxW, weight, size, family, minSize) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (ctx.measureText(text).width > maxW && s > minSize) {
    s -= 1;
    ctx.font = `${weight} ${s}px ${family}`;
  }
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}
async function drawList(st) {
  await Promise.all([
    document.fonts.load(`800 80px "Shippori Mincho B1"`, "三十篇"),
    document.fonts.load(`700 30px "Shippori Mincho B1"`, "あ"),
    document.fonts.load(`500 20px "Zen Kaku Gothic New"`, "あ"),
    document.fonts.load(`700 20px "Zen Kaku Gothic New"`, "あ"),
  ]).catch(() => {});
  const { W, pad, rowH } = IMG;
  const head = 300, foot = 110;
  const H = head + rowH * 30 + foot;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = IMG.paper; ctx.fillRect(0, 0, W, H);
  // 外枠（布装の見返し風の細い二重線）
  ctx.strokeStyle = IMG.cloth; ctx.lineWidth = 3;
  ctx.strokeRect(28, 28, W - 56, H - 56);
  ctx.lineWidth = 1;
  ctx.strokeRect(38, 38, W - 76, H - 76);

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = IMG.gilt;
  ctx.font = `700 20px ${IMG.gothic}`;
  ctx.letterSpacing = "6px";
  ctx.fillText("30 SHORT STORY CHALLENGE", pad, 120);
  ctx.letterSpacing = "0px";
  ctx.fillStyle = IMG.ink;
  ctx.font = `800 84px ${IMG.mincho}`;
  ctx.fillText("30の短篇", pad - 4, 214);
  ctx.textAlign = "right";
  ctx.fillStyle = IMG.muted;
  ctx.font = `500 24px ${IMG.gothic}`;
  if (st.name.trim()) ctx.fillText(fitText(ctx, `選　${st.name.trim()}`, 380, 500, 24, IMG.gothic, 16), W - pad, 210);
  ctx.textAlign = "left";
  ctx.strokeStyle = IMG.ink; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(pad, 252); ctx.lineTo(W - pad, 252); ctx.stroke();

  const numW = 74, inner = W - pad * 2 - numW;
  st.items.forEach((it, i) => {
    const y = head + i * rowH;
    ctx.fillStyle = IMG.gilt;
    ctx.font = `700 34px ${IMG.mincho}`;
    ctx.fillText(String(i + 1).padStart(2, "0"), pad, y + 56);
    ctx.fillStyle = IMG.muted;
    ctx.font = `700 18px ${IMG.gothic}`;
    ctx.fillText(fitText(ctx, TOPICS[i], inner, 700, 18, IMG.gothic, 14), pad + numW, y + 26);
    const t = it.t.trim(), a = it.a.trim();
    const x0 = pad + numW;
    if (!t) {
      ctx.fillStyle = IMG.line;
      ctx.font = `500 28px ${IMG.mincho}`;
      ctx.fillText("―", x0, y + 62);
    } else {
      ctx.font = `500 21px ${IMG.gothic}`;
      const au = a ? fitText(ctx, a, inner * 0.42, 500, 21, IMG.gothic, 15) : "";
      const auW = au ? ctx.measureText(au).width : 0;
      const title = fitText(ctx, `『${t}』`, inner - auW - (au ? 40 : 0), 700, 30, IMG.mincho, 20);
      ctx.fillStyle = IMG.ink;
      const tW = ctx.measureText(title).width;
      ctx.fillText(title, x0, y + 62);
      if (au) {
        ctx.font = `500 21px ${IMG.gothic}`;
        ctx.fillStyle = IMG.muted;
        ctx.textAlign = "right";
        ctx.fillText(au, W - pad, y + 61);
        ctx.textAlign = "left";
        // 点線のリーダー
        ctx.fillStyle = IMG.line;
        for (let x = x0 + tW + 14; x < W - pad - auW - 12; x += 10) ctx.fillRect(x, y + 56, 2.5, 2.5);
      }
    }
    if (i < 29) {
      ctx.strokeStyle = IMG.line; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad + numW, y + rowH - 4); ctx.lineTo(W - pad, y + rowH - 4); ctx.stroke();
    }
  });
  ctx.strokeStyle = IMG.ink; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(pad, H - foot + 8); ctx.lineTo(W - pad, H - foot + 8); ctx.stroke();
  ctx.fillStyle = IMG.muted;
  ctx.font = `500 18px ${IMG.gothic}`;
  const n = st.items.filter((x) => x.t.trim()).length;
  ctx.fillText(`${n} / 30 篇`, pad, H - foot + 50);
  ctx.textAlign = "right";
  ctx.fillText("#30ShortStoryChallenge", W - pad, H - foot + 50);
  ctx.textAlign = "left";
  return c;
}

/* ---------- 操作 ---------- */
const toast = (msg) => {
  const t = $("#toast");
  t.textContent = msg;
  clearTimeout(toast.h);
  toast.h = setTimeout(() => (t.textContent = ""), 4000);
};

$("#editor").addEventListener("input", (e) => { state.name = e.target.value; save(); });

let imgUrl = "";
$("#btn-image").addEventListener("click", async () => {
  closeSuggest();
  const c = await drawList(state);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  if (imgUrl) URL.revokeObjectURL(imgUrl);
  imgUrl = URL.createObjectURL(blob);
  $("#dlg-img").src = imgUrl;
  $("#dlg-save").href = imgUrl;
  const file = new File([blob], "30-short-stories.png", { type: "image/png" });
  const share = $("#dlg-share");
  share.hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
  share.onclick = () => navigator.share({ files: [file], text: "#30ShortStoryChallenge" }).catch(() => {});
  $("#dlg").showModal();
});
$("#dlg-close").addEventListener("click", () => $("#dlg").close());

$("#btn-url").addEventListener("click", async () => {
  let url;
  try {
    url = `${location.origin}${location.pathname}#d=${await encodeState(state)}`;
  } catch {
    toast("このブラウザでは共有URLを作れません。");
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("共有URLをコピーしました。");
  } catch {
    window.prompt("共有URL", url);
  }
});

$("#btn-clear").addEventListener("click", () => { $("#confirm-clear").hidden = false; });
$("#btn-clear-no").addEventListener("click", () => { $("#confirm-clear").hidden = true; });
$("#btn-clear-yes").addEventListener("click", () => {
  state = blank(); save(); render();
  $("#confirm-clear").hidden = true;
  toast("すべて消しました。");
});

function enterShared(st) {
  mine = mine || load();
  state = st; readonly = true;
  $("#shared-who").textContent = st.name.trim() ? `${st.name.trim()}さん` : "共有された一覧";
  $("#shared-banner").hidden = false;
  render();
}
function leaveShared(adopt) {
  if (adopt) state = JSON.parse(JSON.stringify(state));
  else state = mine || load();
  if (adopt) state.name = mine?.name || "";
  readonly = false; mine = null;
  $("#shared-banner").hidden = true;
  history.replaceState(null, "", location.pathname);
  render(); save();
}
$("#btn-adopt").addEventListener("click", () => leaveShared(true));
$("#btn-mine").addEventListener("click", () => leaveShared(false));

async function fromHash() {
  const m = location.hash.match(/^#d=([A-Za-z0-9_-]+)$/);
  if (!m) return false;
  try { enterShared(await decodeState(m[1])); return true; } catch { toast("共有URLを読み取れませんでした。"); return false; }
}
window.addEventListener("hashchange", fromHash);

buildRows();
state = load();
render();
fromHash();
loadAozora().catch(() => {});
