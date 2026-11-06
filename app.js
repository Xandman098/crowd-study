// Experiment flow.  Two parts:
//   A  match-to-sample: top = full simulation (seed a); bottom = two simulations started from the
//      same different seed b.  "Which of the two lower clips behaves more like the upper one?"
//      Pair types: ours vs baseline (preference), full vs method (detection), full vs none (catch).
//   B  plausibility: one clip, rating 1–7.
import { CONFIG } from "./config.js";
import { Stage, Player } from "./render.js";

const $ = sel => document.querySelector(sel);
const params = new URLSearchParams(location.search);
const pid = params.get("PROLIFIC_PID") || params.get("pid") || ("P" + Math.random().toString(36).slice(2, 10));
const rng = mulberry32(hashStr(pid));
const data = { pid, version: CONFIG.version, study: params.get("STUDY_ID") || "", session: params.get("SESSION_ID") || "",
               started: new Date().toISOString(), ua: navigator.userAgent,
               screen: [screen.width, screen.height, devicePixelRatio], trials: [], demographics: {} };

function hashStr(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function pick2(pool) { const p = shuffle([...pool]); return [p[0], p[1]]; }

let manifest, player;
const stages = {}, cache = new Map();

async function clip(scen, cond, seed) {
  const key = `${scen}/${cond}_s${seed}`;
  if (!cache.has(key)) cache.set(key, fetch(`stimuli/${key}.json`).then(r => { if (!r.ok) throw new Error(key); return r.json(); }));
  return cache.get(key);
}

function buildTrials() {
  const A = [], D = CONFIG.detection, P = CONFIG.preference;
  for (const s of CONFIG.scenarios) {
    for (let rep = 0; rep < D.repetitions; rep++)
      for (const m of D.methods) for (const k of D.budgets)
        A.push({ part: "A", type: "detection", scen: s, beta: 1 / k, pair: ["full", `${m}_b${k}`] });
    for (let rep = 0; rep < P.repetitions; rep++)
      for (const [m, ks] of P.pairs) for (const k of ks)
        A.push({ part: "A", type: "preference", scen: s, beta: 1 / k, pair: [`${CONFIG.ours}_b${k}`, `${m}_b${k}`] });
    for (let rep = 0; rep < CONFIG.catchPerScenario; rep++)
      A.push({ part: "A", type: "catch", scen: s, beta: 0, pair: ["full", "none"] });
  }
  for (const t of A) {
    [t.seedTop, t.seedBottom] = pick2(manifest.seeds);
    if (rng() < 0.5) t.pair.reverse();                        // left/right
  }
  const B = [];
  for (const s of CONFIG.scenarios) for (const c of CONFIG.ratingConditions)
    B.push({ part: "B", scen: s, cond: c, seed: manifest.seeds[Math.floor(rng() * manifest.seeds.length)] });
  return { A: shuffle(A), B: shuffle(B) };
}

function show(id) { for (const el of document.querySelectorAll(".page")) el.hidden = el.id !== id; }
// ?autotest=1 walks through the whole experiment without a person: pages are clicked, every clip is
// loaded and drawn once, answers are random, and the saved data end up in <pre id="autotest-out">
const AUTOTEST = params.has("autotest");
function waitClick(sel) {
  if (AUTOTEST) return new Promise(res => setTimeout(res, 0));
  return new Promise(res => $(sel).addEventListener("click", res, { once: true }));
}

const TRIAL_RECTS = [{ x: 0.25, y: 0.0, w: 0.5, h: 0.49 },       // reference
                     { x: 0.0, y: 0.51, w: 0.495, h: 0.49 },      // A
                     { x: 0.505, y: 0.51, w: 0.495, h: 0.49 }];   // B

async function runA(t, idx, total, practice = false) {
  show("trial");
  $("#trial-progress").textContent = practice ? "练习" : `第一部分 — ${idx + 1} / ${total}`;
  $("#labels").className = "three";
  $("#question").textContent = "下方哪一段的人群表现得更像上方的参照？";
  const [top, left, right] = await Promise.all([clip(t.scen, "full", t.seedTop), clip(t.scen, t.pair[0], t.seedBottom),
                                                 clip(t.scen, t.pair[1], t.seedBottom)]);
  const st = stages[t.scen];
  player.load([top, left, right].map((c, k) => ({ stage: st, clip: c, dt: manifest.dt, rect: TRIAL_RECTS[k] })));
  const choice = await playAndAsk(["#btn-left", "#btn-right"], "#answer-ab");
  const correct = t.type === "preference" ? null : (t.pair[choice.idx] === "full" ? 1 : 0);
  if (practice) {
    $("#feedback").textContent = correct ? "回答正确。" : "不对：另一段才是和上方参照一致的。";
    await new Promise(r => setTimeout(r, AUTOTEST ? 0 : 1800)); $("#feedback").textContent = "";
    return;
  }
  data.trials.push({ ...t, pair: [...t.pair], left: t.pair[0], right: t.pair[1], chosen: t.pair[choice.idx],
                     correct, rt: choice.rt, replays: choice.replays, idx });
  prefetch(idx + 1);
}

async function runB(t, idx, total) {
  show("trial");
  $("#trial-progress").textContent = `第二部分 — ${idx + 1} / ${total}`;
  $("#labels").className = "one";
  $("#question").textContent = "这段动画中人群的行为有多真实？";
  const c = await clip(t.scen, t.cond, t.seed);
  player.load([{ stage: stages[t.scen], clip: c, dt: manifest.dt, rect: { x: 0.1, y: 0.0, w: 0.8, h: 1.0 } }]);
  const btns = [...document.querySelectorAll("#answer-rating button")].map(b => "#" + b.id);
  const choice = await playAndAsk(btns, "#answer-rating");
  data.trials.push({ ...t, rating: choice.idx + 1, rt: choice.rt, replays: choice.replays, idx });
}

function playAndAsk(buttons, panel) {
  if (AUTOTEST) {
    player.drawAt(8, 8);
    return Promise.resolve({ idx: Math.floor(rng() * buttons.length), rt: 0, replays: 0 });
  }
  return new Promise(resolve => {
    let replays = 0, tShown = 0;
    const answer = $(panel), replay = $("#btn-replay");
    answer.hidden = true; replay.hidden = true;
    const ended = () => {
      answer.hidden = false; tShown = performance.now();
      replay.hidden = replays >= CONFIG.maxReplays;
    };
    replay.onclick = () => { replays++; answer.hidden = true; replay.hidden = true; player.play(ended); };
    buttons.forEach((sel, i) => {
      $(sel).onclick = () => {
        answer.hidden = true; replay.hidden = true;
        resolve({ idx: i, rt: Math.round(performance.now() - tShown), replays });
      };
    });
    player.play(ended);
  });
}

function prefetch(i) {
  const t = plan.A[i];
  if (t) for (const c of t.pair) clip(t.scen, c, t.seedBottom).catch(() => {});
}

async function save() {
  data.finished = new Date().toISOString();
  const body = JSON.stringify(data);
  const name = `${pid}_${Date.now()}.json`;
  let ok = false;
  if (CONFIG.datapipeId) {
    try {
      const r = await fetch("https://pipe.jspsych.org/api/data/", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "*/*" },
        body: JSON.stringify({ experimentID: CONFIG.datapipeId, filename: name, data: body }) });
      ok = r.ok;
    } catch (e) { ok = false; }
  }
  if (!ok) download(body, name);
  return ok;
}

function download(body, name) {
  if (AUTOTEST) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type: "application/json" }));
  a.download = name; a.click();
  const again = $("#btn-redownload");
  again.hidden = false; again.onclick = () => a.click();
}

let plan;
async function main() {
  manifest = await (await fetch("stimuli/manifest.json")).json();
  for (const s of CONFIG.scenarios) stages[s] = new Stage(manifest.scenarios[s].geometry, CONFIG.camera);
  player = new Player($("#canvas"));
  window.addEventListener("resize", () => player.resize());
  plan = buildTrials();
  data.plan_seed = hashStr(pid);
  $("#version").textContent = "v" + CONFIG.version;

  show("consent");
  $("#mobile-warn").hidden = !(/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || Math.min(screen.width, screen.height) < 600);
  await waitClick("#btn-consent");
  show("instructions"); await waitClick("#btn-start-practice");
  const pr = [{ part: "A", type: "catch", scen: CONFIG.scenarios[0], pair: ["full", "none"], seedTop: manifest.seeds[0], seedBottom: manifest.seeds[1] },
              { part: "A", type: "catch", scen: CONFIG.scenarios[1], pair: ["none", "full"], seedTop: manifest.seeds[2], seedBottom: manifest.seeds[3] }];
  for (const t of pr) await runA(t, 0, 0, true);
  show("start-a"); await waitClick("#btn-start-a");
  for (let i = 0; i < plan.A.length; i++) {
    if (i > 0 && i % CONFIG.breakEvery === 0) { show("pause"); await waitClick("#btn-continue"); }
    await runA(plan.A[i], i, plan.A.length);
  }
  show("start-b"); await waitClick("#btn-start-b");
  for (let i = 0; i < plan.B.length; i++) await runB(plan.B[i], i, plan.B.length);
  show("demographics"); await waitClick("#btn-demo");
  for (const el of document.querySelectorAll("#demographics [name]")) data.demographics[el.name] = el.value;
  show("saving");
  const uploaded = await save();
  show("done");
  $("#done-msg").textContent = uploaded ? "你的回答已经保存，可以关闭页面了。"
    : `你的结果文件（${pid}_….json）已下载到浏览器的下载文件夹，请把这个文件发给实验人员。若没有看到下载，请点击下面的按钮。`;
  if (AUTOTEST) {
    const pre = document.createElement("pre"); pre.id = "autotest-out"; pre.textContent = JSON.stringify(data);
    document.body.append(pre); document.title = "autotest-done";
    return;
  }
  if (CONFIG.completionUrl) setTimeout(() => { location.href = CONFIG.completionUrl; }, 2500);
}

// ?preview=<scenario>/<condition>_s<seed>[,<...>] shows clips without the experiment (screenshots, checks);
// three clips are laid out as in a Part 1 trial (reference, A, B), any other number side by side
async function preview(spec) {
  manifest = await (await fetch("stimuli/manifest.json")).json();
  player = new Player($("#canvas"));
  show("trial"); $("#question").textContent = spec;
  const items = spec.split(",");
  const n = items.length, entries = [];
  $("#labels").className = n === 3 ? "three" : "one";
  for (let k = 0; k < n; k++) {
    const [s, rest] = items[k].split("/");
    const m = rest.match(/^(.*)_s(\d+)$/);
    stages[s] = stages[s] || new Stage(manifest.scenarios[s].geometry, CONFIG.camera);
    entries.push({ stage: stages[s], clip: await clip(s, m[1], +m[2]), dt: manifest.dt,
                   rect: n === 3 ? TRIAL_RECTS[k] : { x: k / n, y: 0, w: 1 / n - 0.005, h: 1 } });
  }
  player.load(entries);
  const at = parseFloat(params.get("t") || "-1");
  if (at >= 0) { player.drawAt(at, at); document.title = "ready"; }
  else player.play(() => { document.title = "ready"; });
}

if (params.get("preview")) preview(params.get("preview"));
else main().catch(e => {
  document.body.innerHTML = `<pre>出错了，请把这个页面截图发给实验人员。\nError: ${e.message}</pre><button id="btn-redownload" hidden>下载已有数据</button>`;
  data.error = String(e); save();
});
