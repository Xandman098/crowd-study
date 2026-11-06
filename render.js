// Renders exported simulation clips (scripts/make_stimuli.py) as small 3D scenes.
// One WebGL canvas, several viewports (scissor), all clips advanced by the same clock.
// Simulation coordinates (x, y) in metres map to three.js (x, 0, y); y is up in three.js.

import * as THREE from "./vendor/three.module.min.js";

const PALETTE = [0x4e79a7, 0xf28e2b, 0xe15759, 0x76b7b2, 0x59a14f, 0xedc948, 0xb07aa1, 0xff9da7,
                 0x9c755f, 0xbab0ac, 0x86bcb6, 0x8cd17d, 0xd4a6c8, 0x79706e, 0xa0cbe8, 0xffbe7d];
const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];

function hash(i) { let h = (i + 1) * 2654435761; h ^= h >>> 16; return h >>> 0; }

export class Stage {
  // geometry: manifest.scenarios[s].geometry; camera options from config
  constructor(geometry, opts = {}) {
    this.geo = geometry;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xcfd8e3);
    this.scene.fog = new THREE.Fog(0xcfd8e3, 60, 160);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8a7a, 1.6);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(30, 60, -20);
    this.scene.add(sun);

    const W = geometry.width, H = geometry.height;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W + 40, H + 40),
                                  new THREE.MeshLambertMaterial({ color: 0xb9b4a5 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(W / 2, 0, H / 2);
    this.scene.add(ground);
    const plaza = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshLambertMaterial({ color: 0xd9d3c3 }));
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(W / 2, 0.01, H / 2);
    this.scene.add(plaza);

    const wallMat = new THREE.MeshLambertMaterial({ color: 0x8f8f96 });
    const addWall = (a, b, h = 3.0, t = 0.35) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      const m = new THREE.Mesh(new THREE.BoxGeometry(L, h, t), wallMat);
      m.position.set((a[0] + b[0]) / 2, h / 2, (a[1] + b[1]) / 2);
      m.rotation.y = -Math.atan2(dy, dx);
      this.scene.add(m);
    };
    for (const [a, b] of geometry.walls) addWall(a, b);
    // perimeter: low walls with gaps at the exits
    const gaps = geometry.exits.map(e => ({ x: e[0], y: e[1] }));
    const edge = (a, b) => {
      const pts = [a];
      const along = b[0] !== a[0] ? 0 : 1, fixed = 1 - along;
      const lo = Math.min(a[along], b[along]), hi = Math.max(a[along], b[along]);
      const cuts = gaps.filter(g => Math.abs((fixed === 0 ? g.x : g.y) - a[fixed]) < 0.5)
                       .map(g => (along === 0 ? g.x : g.y)).sort((p, q) => p - q);
      let cur = lo;
      for (const c of cuts) {
        const g0 = c - geometry.exit_radius, g1 = c + geometry.exit_radius;
        if (g0 > cur) addWall(along === 0 ? [cur, a[1]] : [a[0], cur], along === 0 ? [g0, a[1]] : [a[0], g0], 1.2);
        cur = Math.max(cur, g1);
      }
      if (cur < hi) addWall(along === 0 ? [cur, a[1]] : [a[0], cur], along === 0 ? [hi, a[1]] : [a[0], hi], 1.2);
    };
    edge([0, 0], [W, 0]); edge([0, H], [W, H]); edge([0, 0], [0, H]); edge([W, 0], [W, H]);

    const exitMat = new THREE.MeshLambertMaterial({ color: 0x2e9b4f });
    for (const e of geometry.exits) {
      const sign = e[0] <= 0.5 ? 1 : (e[0] >= W - 0.5 ? -1 : 0);
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.2, 0.5), exitMat);
        post.position.set(e[0], 1.6, e[1] + s * geometry.exit_radius);
        this.scene.add(post);
      }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 2 * geometry.exit_radius + 0.5), exitMat);
      lintel.position.set(e[0], 3.2, e[1]);
      this.scene.add(lintel);
      void sign;
    }
    const stallMat = new THREE.MeshLambertMaterial({ color: 0x9a6b43 });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0xc94c4c });
    for (const p of geometry.pois) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.0, 1.2), stallMat);
      s.position.set(p[0], 0.5, p[1] - 1.6);
      this.scene.add(s);
      const r = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 1.6), roofMat);
      r.position.set(p[0], 2.2, p[1] - 1.6);
      this.scene.add(r);
    }

    // hazards: burning disc + flames + smoke puffs
    this.hazards = geometry.hazards.map(h => {
      const g = new THREE.Group();
      g.position.set(h.pos[0], 0, h.pos[1]);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 48),
                                  new THREE.MeshBasicMaterial({ color: 0x3a2a20 }));
      disc.rotation.x = -Math.PI / 2; disc.position.y = 0.03;
      g.add(disc);
      const flames = [];
      const fMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.85 });
      for (let k = 0; k < 24; k++) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.6, 2.4, 6), fMat);
        f.userData = { a: (k / 24) * Math.PI * 2, r: 0.3 + 0.7 * ((hash(k) % 100) / 100), ph: k * 1.7 };
        g.add(f); flames.push(f);
      }
      const smoke = [];
      const sMat = new THREE.MeshLambertMaterial({ color: 0x555555, transparent: true, opacity: 0.35 });
      for (let k = 0; k < 14; k++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), sMat);
        s.userData = { ph: k / 14 };
        g.add(s); smoke.push(s);
      }
      this.scene.add(g);
      return { group: g, disc, flames, smoke, radius: h.radius };
    });

    this.cameraOpts = Object.assign({ elevationDeg: 52, vfovDeg: 42, fill: 1.08 }, opts);
    this.clipTicks = null;
  }

  makeCamera(aspect) {
    const [[x0, y0], [x1, y1]] = this.geo.view;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    let ux = this.geo.camera[0] - cx, uy = this.geo.camera[1] - cy;
    const n = Math.hypot(ux, uy) || 1; ux /= n; uy /= n;
    // extent of the view rectangle across and along the viewing direction
    const across = Math.abs(ux) > Math.abs(uy) ? (y1 - y0) : (x1 - x0);
    const along = Math.abs(ux) > Math.abs(uy) ? (x1 - x0) : (y1 - y0);
    const o = this.cameraOpts;
    const vf = THREE.MathUtils.degToRad(o.vfovDeg);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
    const el = THREE.MathUtils.degToRad(o.elevationDeg);
    const dAcross = (across / 2) / Math.tan(hf / 2);
    const dAlong = (along / 2) * Math.sin(el) / Math.tan(vf / 2) + (along / 2) * Math.cos(el);
    const D = o.fill * Math.max(dAcross, dAlong);
    const cam = new THREE.PerspectiveCamera(o.vfovDeg, aspect, 0.5, 400);
    cam.position.set(cx + ux * D * Math.cos(el), D * Math.sin(el), cy + uy * D * Math.cos(el));
    cam.lookAt(cx, 0, cy);
    return cam;
  }
}

// One clip shown in one viewport.  Agents are instanced meshes; identities (colours) are the
// agent index, so the same person looks the same in every condition of a seed.
export class ClipView {
  constructor(stage, clip, dt) {
    this.stage = stage; this.clip = clip; this.dt = dt;
    this.group = new THREE.Group();
    const n = clip.agents.length;
    const torso = new THREE.BoxGeometry(0.46, 0.72, 0.26);
    const head = new THREE.SphereGeometry(0.13, 12, 10);
    const legs = new THREE.BoxGeometry(0.34, 0.8, 0.2);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.torso = new THREE.InstancedMesh(torso, mat, n);
    this.head = new THREE.InstancedMesh(head, mat, n);
    this.legs = new THREE.InstancedMesh(legs, mat, n);
    const c = new THREE.Color();
    clip.agents.forEach((id, k) => {
      const h = hash(id);
      this.torso.setColorAt(k, c.setHex(PALETTE[h % PALETTE.length]));
      this.head.setColorAt(k, c.setHex(SKIN[(h >>> 8) % SKIN.length]));
      this.legs.setColorAt(k, c.setHex([0x2d3142, 0x4f5d75, 0x3d405b, 0x5c4033][(h >>> 12) % 4]));
    });
    for (const m of [this.torso, this.head, this.legs]) { m.frustumCulled = false; this.group.add(m); }
    this.heading = new Float32Array(n);
    this.phase = new Float32Array(n);
    clip.agents.forEach((id, k) => { this.phase[k] = (hash(id) % 1000) / 1000 * Math.PI * 2; });
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler();
    this.v = new THREE.Vector3(); this.s = new THREE.Vector3();
  }

  get duration() { return (this.clip.pos.length - 1) * this.dt; }

  // tau: seconds since clip start
  update(tau, wallclock) {
    const P = this.clip.pos, S = this.clip.state, T = P.length;
    const ft = Math.min(Math.max(tau / this.dt, 0), T - 1.0001);
    const i = Math.floor(ft), f = ft - i;
    const n = this.clip.agents.length;
    for (let k = 0; k < n; k++) {
      const a = P[i][k], b = P[i + 1][k];
      const x = (a[0] + (b[0] - a[0]) * f) / 100, y = (a[1] + (b[1] - a[1]) * f) / 100;
      const st = S[f < 0.5 ? i : i + 1][k];
      const gone = (st & 1) === 1, down = (st & 2) === 2;
      const vx = (b[0] - a[0]) / 100 / this.dt, vy = (b[1] - a[1]) / 100 / this.dt;
      const sp = Math.hypot(vx, vy);
      if (sp > 0.15) {
        const target = Math.atan2(vy, vx);
        let d = target - this.heading[k];
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.heading[k] += d * 0.25;
      }
      const yaw = -this.heading[k];
      const scale = gone ? 0 : 1;
      if (down) {
        // lying on the ground
        this.e.set(0, yaw, Math.PI / 2, "YXZ");
        this.q.setFromEuler(this.e);
        this.s.set(scale, scale, scale);
        this.m.compose(this.v.set(x, 0.15, y), this.q, this.s); this.torso.setMatrixAt(k, this.m);
        this.m.compose(this.v.set(x + 0.55 * Math.cos(this.heading[k]), 0.13, y + 0.55 * Math.sin(this.heading[k])), this.q, this.s);
        this.head.setMatrixAt(k, this.m);
        this.m.compose(this.v.set(x - 0.6 * Math.cos(this.heading[k]), 0.12, y - 0.6 * Math.sin(this.heading[k])), this.q, this.s);
        this.legs.setMatrixAt(k, this.m);
        continue;
      }
      const step = Math.min(sp, 3.0);
      const bob = step > 0.15 ? 0.04 * Math.abs(Math.sin(wallclock * (3 + 1.8 * step) + this.phase[k])) * Math.min(step, 1.5) : 0;
      const lean = Math.min(step, 3) * 0.06;
      this.e.set(0, yaw, -lean, "YXZ");
      this.q.setFromEuler(this.e);
      this.s.set(scale, scale, scale);
      this.m.compose(this.v.set(x, 0.4 + bob, y), this.q, this.s); this.legs.setMatrixAt(k, this.m);
      this.m.compose(this.v.set(x + lean * 0.9 * Math.cos(this.heading[k]), 1.16 + bob, y + lean * 0.9 * Math.sin(this.heading[k])), this.q, this.s);
      this.torso.setMatrixAt(k, this.m);
      this.m.compose(this.v.set(x + lean * 1.6 * Math.cos(this.heading[k]), 1.66 + bob, y + lean * 1.6 * Math.sin(this.heading[k])), this.q, this.s);
      this.head.setMatrixAt(k, this.m);
    }
    for (const m of [this.torso, this.head, this.legs]) m.instanceMatrix.needsUpdate = true;
    // hazards (shared geometry with the stage; radius follows the clip clock)
    for (const h of this.stage.hazards) {
      const R = h.radius, j = Math.min(Math.floor(ft), R.length - 1), j1 = Math.min(j + 1, R.length - 1);
      const r = R[j] + (R[j1] - R[j]) * (ft - Math.floor(ft));
      h.group.visible = r > 0;
      h.disc.scale.set(Math.max(r, 0.01), Math.max(r, 0.01), 1);
      for (const fl of h.flames) {
        const u = fl.userData, rr = r * u.r;
        const flick = 0.75 + 0.35 * Math.sin(wallclock * 9 + u.ph);
        fl.position.set(rr * Math.cos(u.a), 1.0 * flick, rr * Math.sin(u.a));
        fl.scale.set(1 + r * 0.05, flick * (1 + r * 0.08), 1 + r * 0.05);
      }
      for (const s of h.smoke) {
        const p = (wallclock * 0.08 + s.userData.ph) % 1;
        s.position.set(Math.sin(s.userData.ph * 20) * r * 0.3 + p * 4, 3 + p * (8 + r), Math.cos(s.userData.ph * 13) * r * 0.3);
        const sc = (0.8 + r * 0.25) * (0.5 + p);
        s.scale.set(sc, sc, sc);
      }
    }
  }
}

// Several clips in one canvas.  layout: list of {x, y, w, h} in [0,1] canvas fractions
// (y from the top), one per clip.
export class Player {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setScissorTest(true);
    this.views = [];
    this.playing = false;
    this.onEnd = null;
    this._loop = this._loop.bind(this);
  }

  // entries: [{stage, clip, dt, rect}]
  load(entries) {
    this.views = entries.map(en => {
      const cv = new ClipView(en.stage, en.clip, en.dt);
      return { cv, stage: en.stage, rect: en.rect, camera: null };
    });
    this.resize();
    this.drawAt(0);
  }

  resize() {
    const c = this.renderer.domElement;
    const w = c.clientWidth, h = c.clientHeight;
    this.renderer.setSize(w, h, false);
    for (const v of this.views) v.camera = v.stage.makeCamera((v.rect.w * w) / (v.rect.h * h));
  }

  drawAt(tau, wall = tau) {
    const c = this.renderer.domElement;
    const W = c.clientWidth, H = c.clientHeight;
    this.renderer.setScissor(0, 0, W, H); this.renderer.setViewport(0, 0, W, H);
    this.renderer.setClearColor(0xffffff); this.renderer.clear();
    for (const v of this.views) {
      v.stage.scene.add(v.cv.group);
      v.cv.update(tau, wall);
      const x = v.rect.x * W, y = (1 - v.rect.y - v.rect.h) * H, w = v.rect.w * W, h = v.rect.h * H;
      this.renderer.setViewport(x, y, w, h); this.renderer.setScissor(x, y, w, h);
      this.renderer.render(v.stage.scene, v.camera);
      v.stage.scene.remove(v.cv.group);
    }
  }

  play(onEnd) {
    this.onEnd = onEnd; this.t0 = performance.now(); this.playing = true;
    requestAnimationFrame(this._loop);
  }

  stop() { this.playing = false; }

  _loop(now) {
    if (!this.playing) return;
    const tau = (now - this.t0) / 1000;
    const dur = Math.min(...this.views.map(v => v.cv.duration));
    this.drawAt(Math.min(tau, dur), tau);
    if (tau >= dur) { this.playing = false; if (this.onEnd) this.onEnd(); return; }
    requestAnimationFrame(this._loop);
  }
}
