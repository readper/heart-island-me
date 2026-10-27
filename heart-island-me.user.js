/*
 * HEART 政策島：我的角色
 * v0.8.0
 */

import { track } from "./analytics.js?v=20261022-4";

(() => {
  'use strict';

  const LOG = (...a) => console.log('[heart-me]', ...a);
  const STORE_KEY = 'heart-me:v1';
  const CORAL = 0xdb6a41; // 站方 --coral
  const POSE_UP = 2.62; // 舉手（S.pose 的 l／r 是角色自己的左右手）：手臂往身體外側（z 軸）抬到水平以上 60°（從垂下算 150°），像在介紹東西，不是往前舉

  const cap = {}; // 從站方渲染流程攔到的 scene / camera / controls
  let T = null;   // 與站方同一份 three 實例
  let RoundedBox = null;
  let mergeGeometries = null; // 2026-10-23 官網優化：角色零件合併成少數幾個網格（共用一個材質），減少每幀繪製次數
  let FIG_MAT = null;          // 所有角色共用的頂點色材質；換裝時不再建立／編譯新材質
  let G = null;   // 共用幾何（同 people.js 的 G）

  const undo = []; // 清理函式，後進先出
  // 角色的合併網格自己擁有幾何；共用材質 FIG_MAT 不可釋放
  const disposeFigure = (root) => root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.hmOwned) o.geometry.dispose();
    if (o.material && o.material !== FIG_MAT && !o.userData.hmShared && !Array.isArray(o.material)) o.material.dispose();
  });
  let dead = false;
  function shutdown(reason) {
    if (dead) return;
    dead = true;
    while (undo.length) {
      try { undo.pop()(); } catch (e) { console.warn('[heart-me] 清理時發生錯誤：', e); }
    }
    LOG('已停用：' + reason);
  }

  // ───────────────────────── 外觀資料 ─────────────────────────

  // 身分與標籤取自站方 people.js 的 ROLE_LABEL（略過 puma 彩蛋角色）
  const ROLES = [
    ['citizen', '市民'], ['youth', '年輕人'], ['officeworker', '上班族'], ['cyclist', '通勤族'],
    ['parent', '家長'], ['child', '學童'], ['elder', '長者'], ['civil-servant', '公務員'],
    ['researcher', '研究員'], ['worker', '工地人員'], ['farmer', '小農'], ['hiker', '登山客'],
    ['traveller', '交流旅客'],
  ];
  const ROLE_LABEL = Object.fromEntries(ROLES);
  // ── 外觀選項。配件與身分脫鉤：身分只提供一組「預設配件」，切換身分時套用，之後每一項都能自己改
  const HAIR_STYLES = [['short', '短髮'], ['long', '長髮'], ['bob', '鮑伯頭'], ['side', '側分'], ['curly', '捲髮'], ['bun', '丸子頭'], ['pony', '馬尾'], ['puff', '三顆丸子'], ['bald', '光頭']];
  const OUTFITS = [['plain', '一般'], ['vest', '公務員背心'], ['hivis', '反光背心'], ['cardigan', '針織外套'], ['coat', '研究袍']];
  const HATS = [['none', '無'], ['kid', '小黃帽'], ['hardhat', '工地帽'], ['helmet', '安全帽'], ['hike', '登山帽'], ['straw', '斗笠'], ['beanie', '毛帽']];
  const BACKS = [['none', '無'], ['schoolbag', '書包'], ['hikepack', '登山背包']];
  const HANDS = [['none', '無'], ['coffee', '咖啡'], ['basket', '菜籃'], ['cane', '拐杖'], ['pole', '登山杖'], ['tube', '試管'], ['umbrella', '雨傘'], ['flower', '花'], ['balloon', '氣球']];
  const SIDES = [['none', '無'], ['luggage', '行李箱'], ['stroller', '嬰兒車']];
  const FACES = [['none', '無'], ['glasses', '眼鏡'], ['sunglasses', '墨鏡'], ['mask', '口罩']];
  const EYES = [['dot', '點點'], ['happy', '笑眼'], ['wide', '大眼'], ['sleepy', '瞇眼']];
  const MOUTHS = [['none', '無'], ['smile', '微笑'], ['o', '驚訝'], ['flat', '平靜']];

  const ACC_KEYS = ['outfit', 'hat', 'hatColor', 'back', 'hand', 'side', 'face'];
  const NO_ACC = { outfit: 'plain', hat: 'none', back: 'none', hand: 'none', side: 'none', face: 'none' };
  // 各身分的預設造型（顏色與配件取自站方 people.js 該身分的定義）
  const ROLE_PRESET = {
    citizen: {}, youth: {},
    officeworker: { hand: 'coffee' },
    cyclist: { hat: 'helmet', hatColor: 0xe8c547 },
    parent: { side: 'stroller' },
    child: { hat: 'kid', hatColor: 0xf1c232, back: 'schoolbag' },
    elder: { hair: 0xd9d4cc, outfit: 'cardigan', hand: 'cane' },
    'civil-servant': { shirt: 0xf4efe6, outfit: 'vest' },
    researcher: { shirt: 0x9fc3d6, outfit: 'coat', face: 'glasses', hand: 'tube' },
    worker: { shirt: 0x4a5a78, outfit: 'hivis', hat: 'hardhat', hatColor: 0xf1c232 },
    farmer: { shirt: 0x8fb37a, hat: 'straw', hand: 'basket' },
    hiker: { hat: 'hike', hatColor: 0x58a6a6, back: 'hikepack', hand: 'pole' },
    traveller: { side: 'luggage' },
  };
  const rolePreset = (role) => ({ ...NO_ACC, ...ROLE_PRESET[role] });

  // 前四色取自站方 people.js 的調色盤，其餘為補充；每一列最後另有「自訂色」
  const PALETTE = {
    skin: [0xf3cfae, 0xe6b48f, 0xcf9670, 0xf0c4a0, 0xb98560, 0x8a5a3c],
    hair: [0x4a3426, 0x1f1d22, 0x6b4a33, 0xb5472f, 0xc9a35a, 0xd9d4cc],
    shirt: [0x6f7fb5, 0x58a6a6, 0xe8c547, 0xf2a1a1, 0x8fb37a, 0xb58fd0, CORAL, 0xfbfbf7, 0x4a5a78],
    pants: [0x3b3a42, 0x4a5a78, 0x6b5a4a, 0x2f3a4a, 0x8a8f99, 0xd8c9a8],
    hatColor: [0xf1c232, 0xe8c547, 0xdb6a41, 0x58a6a6, 0x6f7fb5, 0xf2a1a1, 0xfbfbf7, 0x3b3a42],
  };
  const PART_LABEL = { skin: '膚色', hair: '髮色', shirt: '上衣', pants: '褲子', hatColor: '帽子色' };
  const SHAPE_RANGE = { height: [0.8, 1.25], width: [0.8, 1.3] };

  const DEFAULT_LOOK = {
    name: '我', role: 'citizen', hairStyle: 'short', eyes: 'dot', mouth: 'none', height: 1, width: 1,
    ...NO_ACC,
    skin: PALETTE.skin[1], hair: 0x1f1d22, shirt: PALETTE.shirt[1], pants: PALETTE.pants[1], hatColor: PALETTE.hatColor[0],
  };

  // 複製出來拍照的 Puma：外觀照站方 people.js 的 puma 定義（捲髮、眼鏡、白襯衫＋橘色背心＋小浪花別針、海軍藍長褲、白球鞋、身形 1.16）
  const PUMA_LOOK = {
    name: 'Puma', role: 'puma', hairStyle: 'curly', eyes: 'dot', mouth: 'none', height: 1, width: 1,
    outfit: 'puma', hat: 'none', hatColor: 0xf1c232, back: 'none', hand: 'none', side: 'none', face: 'glasses',
    skin: 0xe6b48f, hair: 0x241c1a, shirt: 0xfbfbf7, pants: 0x2f3a4a,
  };

  const loadLook = () => {
    try {
      const o = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!o || typeof o !== 'object') return { ...DEFAULT_LOOK };
      const pick = (list, v, d) => (list.some(([k]) => k === v) ? v : d);
      const look = { ...DEFAULT_LOOK };
      if (typeof o.name === 'string') look.name = o.name.slice(0, 10);
      if (ROLE_LABEL[o.role]) look.role = o.role;
      // v0.2 以前的存檔沒有配件欄位：依它原本的身分補上預設配件，舊的「毛帽髮型」改成毛帽配件
      const legacy = !('hat' in o);
      if (legacy) {
        const p = rolePreset(look.role);
        for (const k of ACC_KEYS) if (k in p) look[k] = p[k];
        // 舊版戴帽身分會忽略髮型，所以只有該身分預設沒帽子時，才把「毛帽髮型」轉成毛帽配件
        if (o.hairStyle === 'beanie') { if (look.hat === 'none') look.hat = 'beanie'; o.hairStyle = 'short'; }
      } else {
        look.outfit = pick(OUTFITS, o.outfit, look.outfit);
        look.hat = pick(HATS, o.hat, look.hat);
        look.back = pick(BACKS, o.back, look.back);
        look.hand = pick(HANDS, o.hand, look.hand);
        look.side = pick(SIDES, o.side, look.side);
        look.face = pick(FACES, o.face, look.face);
      }
      look.hairStyle = pick(HAIR_STYLES, o.hairStyle, look.hairStyle);
      look.eyes = pick(EYES, o.eyes, look.eyes);
      look.mouth = pick(MOUTHS, o.mouth, look.mouth);
      for (const k of Object.keys(PALETTE)) if (Number.isInteger(o[k]) && o[k] >= 0 && o[k] <= 0xffffff) look[k] = o[k];
      for (const [k, [lo, hi]] of Object.entries(SHAPE_RANGE)) if (Number.isFinite(o[k])) look[k] = Math.min(hi, Math.max(lo, o[k]));
      return look;
    } catch (e) { return { ...DEFAULT_LOOK }; }
  };
  const saveLook = (look) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(look)); } catch (e) { /* 無痕模式等情況略過 */ } };

  // ───────────────────────── three 取得與攔截 ─────────────────────────

  const whenReady = (test, ms = 100, max = 300) =>
    new Promise((res, rej) => {
      let n = 0;
      const t = setInterval(() => {
        const v = test();
        if (v) { clearInterval(t); res(v); }
        else if (++n > max) { clearInterval(t); rej(new Error('timeout')); }
      }, ms);
    });

  async function loadThree() {
    try {
      T = await import('three'); // 官網靠 importmap 解析；單檔分享頁已打包進來，不需要 importmap
    } catch (e) {
      const map = await whenReady(() => document.querySelector('script[type=importmap]'));
      const url = new URL(JSON.parse(map.textContent).imports.three, document.baseURI).href;
      T = await import(url);
    }
    try {
      RoundedBox = (await import('three/addons/geometries/RoundedBoxGeometry.js')).RoundedBoxGeometry;
    } catch (e) { LOG('RoundedBoxGeometry 載入失敗，改用普通方塊'); }
    try {
      mergeGeometries = (await import('three/addons/utils/BufferGeometryUtils.js')).mergeGeometries;
    } catch (e) { LOG('BufferGeometryUtils 載入失敗，角色改用逐件繪製'); }
    const rb = (r) => (RoundedBox ? new RoundedBox(1, 1, 1, 2, r) : new T.BoxGeometry(1, 1, 1));
    G = {
      leg: rb(0.3),
      body: new T.CapsuleGeometry(0.5, 0.6, 4, 10),
      arm: rb(0.35),
      head: new T.SphereGeometry(0.5, 16, 12),
      cap: new T.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
      eye: new T.SphereGeometry(0.5, 8, 6),
      box: rb(0.2),
      cyl: new T.CylinderGeometry(0.5, 0.5, 1, 10),
      cone: new T.ConeGeometry(0.5, 1, 14),
      torus: new T.TorusGeometry(0.5, 0.09, 6, 18, Math.PI), // 半圈：笑眼、微笑
      rim: new T.TorusGeometry(0.5, 0.09, 6, 18),            // 整圈：眼鏡框
      pin: new T.ConeGeometry(0.5, 1, 14),
      ring: new T.RingGeometry(0.2, 0.25, 32).rotateX(-Math.PI / 2),
    };
  }

  // three r160 的 render / OrbitControls.update 都綁在實例上，改攔 prototype 上每幀、每次互動必經的方法
  function hook() {
    // 包一層方法，並登記精確的還原：原本是自有屬性就還原描述，原本是繼承來的就刪掉我們加的自有屬性
    const wrap = (proto, name, make) => {
      const own = Object.getOwnPropertyDescriptor(proto, name);
      const orig = proto[name];
      proto[name] = make(orig);
      undo.push(() => { if (own) Object.defineProperty(proto, name, own); else delete proto[name]; });
    };
    wrap(T.Scene.prototype, 'updateMatrixWorld', (orig) => function (f) {
      if (this.children.length > 50) cap.scene = this;
      return orig.call(this, f);
    });
    wrap(T.Camera.prototype, 'updateMatrixWorld', (orig) => function (f) {
      if (this.isPerspectiveCamera) cap.camera = this;
      return orig.call(this, f);
    });
    wrap(T.EventDispatcher.prototype, 'dispatchEvent', (orig) => function (e) {
      if (!cap.controls && this.target && this.target.isVector3 && this.object && this.object.isCamera) cap.controls = this;
      return orig.call(this, e);
    });
  }

  // OrbitControls 的滾輪處理一定會發 start/end 事件；deltaY 為 0 時不會動到鏡頭
  function ensureControls() {
    if (cap.controls) return true;
    const canvas = document.querySelector('canvas');
    if (canvas) canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 0, bubbles: true, cancelable: true }));
    return !!cap.controls;
  }

  // ───────────────────────── 站方資料與路網 ─────────────────────────

  const shortName = (zh) => String(zh || '').replace(/（.*?）/g, '').trim();

  // policies.json 是站方的資料來源：島、建築（含政策重點 facts）、協作流
  async function loadData() {
    let d = window.__HEART_POLICIES__; // 單檔分享頁：政策資料已內嵌在頁面裡
    if (!d) {
      const appSrc = [...document.scripts].map((s) => s.src).find((s) => s.includes('heart-island-assets'));
      const base = appSrc.split('?')[0].replace(/[^/]*$/, '');
      d = await (await fetch(base + 'policies.json')).json();
    }
    const fp = new Map(window.heartCity.footprints.map((f) => [f.owner, f]));
    const islands = d.islands.map((is) => {
      const buildings = (is.buildings || []).map((b) => {
        const f = fp.get(b.id);
        return f ? { id: b.id, name: b.name.zh, facts: (b.facts || []).map((x) => x.zh).filter(Boolean), cx: (f.minX + f.maxX) / 2, cz: (f.minZ + f.maxZ) / 2 } : null;
      }).filter(Boolean);
      const cx = buildings.reduce((s, b) => s + b.cx, 0) / (buildings.length || 1);
      const cz = buildings.reduce((s, b) => s + b.cz, 0) / (buildings.length || 1);
      return { id: is.id, name: shortName(is.name.zh), summary: is.summary && is.summary.zh, buildings, cx, cz };
    });
    const flows = new Map(d.flows.map((f) => [f.id, (f.text && f.text.zh) || f.id]));
    return { islands, islandById: new Map(islands.map((i) => [i.id, i])), flows };
  }

  // 站方沒有公開路網，但 89 條行人路線都沿著步道走，合併相近的點就是一張路網
  function buildNet(routes) {
    const eps = 0.06, map = new Map(), nodes = [];
    const get = (p) => {
      const k = Math.round(p.x / eps) + ',' + Math.round(p.z / eps);
      let n = map.get(k);
      if (!n) { n = { id: nodes.length, x: p.x, z: p.z, y: p.footY, adj: new Map(), main: false }; map.set(k, n); nodes.push(n); }
      return n;
    };
    for (const r of routes) {
      let prev = null;
      for (const p of r) {
        const n = get(p);
        if (prev && prev !== n && !prev.adj.has(n.id)) {
          const d = Math.hypot(n.x - prev.x, n.z - prev.z);
          prev.adj.set(n.id, d);
          n.adj.set(prev.id, d);
        }
        prev = n;
      }
    }
    // 只保留最大的連通塊，避免目的地落在走不到的小島
    const comp = new Array(nodes.length).fill(-1), sizes = [];
    nodes.forEach((n) => {
      if (comp[n.id] >= 0) return;
      const c = sizes.length, st = [n.id];
      comp[n.id] = c;
      let s = 0;
      while (st.length) {
        const i = st.pop();
        s++;
        for (const j of nodes[i].adj.keys()) if (comp[j] < 0) { comp[j] = c; st.push(j); }
      }
      sizes.push(s);
    });
    const best = sizes.indexOf(Math.max(...sizes));
    nodes.forEach((n) => { n.main = comp[n.id] === best; });
    const main = nodes.filter((n) => n.main);
    const ys = main.map((n) => n.y).sort((a, b) => a - b);

    const nearest = (x, z) => {
      let b = null, bd = Infinity;
      for (const n of main) {
        const d = (n.x - x) ** 2 + (n.z - z) ** 2;
        if (d < bd) { bd = d; b = n; }
      }
      return { node: b, dist: Math.sqrt(bd) };
    };

    // A*：open 用二元堆
    const path = (a, b) => {
      const h = (n) => Math.hypot(n.x - b.x, n.z - b.z);
      const heap = [[h(a), a]], g = new Map([[a.id, 0]]), prev = new Map(), done = new Set();
      const push = (it) => {
        heap.push(it);
        let i = heap.length - 1;
        while (i > 0) {
          const p = (i - 1) >> 1;
          if (heap[p][0] <= heap[i][0]) break;
          [heap[p], heap[i]] = [heap[i], heap[p]];
          i = p;
        }
      };
      const pop = () => {
        const top = heap[0], last = heap.pop();
        if (heap.length) {
          heap[0] = last;
          let i = 0;
          for (;;) {
            const l = 2 * i + 1, r = l + 1;
            let m = i;
            if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
            if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
            if (m === i) break;
            [heap[m], heap[i]] = [heap[i], heap[m]];
            i = m;
          }
        }
        return top[1];
      };
      while (heap.length) {
        const cur = pop();
        if (done.has(cur.id)) continue;
        if (cur === b) {
          const out = [b];
          let c = b;
          while (prev.has(c.id)) { c = prev.get(c.id); out.push(c); }
          return out.reverse();
        }
        done.add(cur.id);
        for (const [j, w] of cur.adj) {
          const nb = nodes[j];
          const ng = g.get(cur.id) + w;
          if (ng < (g.has(j) ? g.get(j) : Infinity)) { g.set(j, ng); prev.set(j, cur); push([ng + h(nb), nb]); }
        }
      }
      return null;
    };

    return { nodes, main, nearest, path, groundY: ys[Math.floor(ys.length / 2)], yMin: ys[0], yMax: ys[ys.length - 1] };
  }

  // ───────────────────────── 角色模型 ─────────────────────────

  // 尺寸、位置、色塊照 people.js 的成人（scale 1）定義；各項配件的座標取自該檔，少數新增款式沿用同一套幾何與比例
  function buildFigure(look) {
    const hatted = look.hat !== 'none';
    const g = new T.Group();
    // 零件先記在各自的父節點（身體、兩腿、兩手）底下，最後每個父節點合併成一個網格
    const parts = new Map();
    const tmp = new T.Object3D();
    // 身高、體型直接做進零件：身高拉長腿與軀幹、體型加寬肩與身體，頭（臉、眼鏡、帽子、頭髮）維持原比例並整顆往上移，
    // 不再整個角色非等比縮放（頭會被拉成橢圓）
    const W = look.width || 1, H = look.height || 1, NECK = 0.27;
    const bodyS = new T.Matrix4().makeScale(W, H, W), headT = new T.Matrix4().makeTranslation(0, NECK * (H - 1), 0);
    const add = (parent, key, c, off, s, rot) => {
      tmp.position.set(...off);
      tmp.scale.set(...s);
      tmp.rotation.set(...(rot || [0, 0, 0]));
      tmp.updateMatrix();
      const m = tmp.matrix.clone();
      if (parent !== g) m.premultiply(bodyS);          // 腿、手臂（含手持物）跟著拉長／加寬
      else if (off[1] < NECK) m.premultiply(bodyS);    // 軀幹、衣款、背包
      else m.premultiply(headT);                       // 頭部整組只平移
      if (!parts.has(parent)) parts.set(parent, []);
      parts.get(parent).push({ geo: G[key], color: c, matrix: m });
    };
    // 需要獨立材質的零件（例如墨鏡的反光鏡片）：不合併，單獨一個網格；幾何仍共用 G
    const addSolo = (parent, key, c, off, s, rot, mat = {}) => {
      tmp.position.set(...off);
      tmp.scale.set(...s);
      tmp.rotation.set(...(rot || [0, 0, 0]));
      tmp.updateMatrix();
      const m = tmp.matrix.clone();
      if (parent !== g || off[1] < NECK) m.premultiply(bodyS); else m.premultiply(headT);
      const mesh = new T.Mesh(G[key], new T.MeshStandardMaterial({ color: c, roughness: 0.7, ...mat }));
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(m);
      mesh.castShadow = false;
      parent.add(mesh);
      return mesh;
    };
    const pivot = (x, y) => {
      const p = new T.Group();
      p.position.set(x * W, y * H, 0);
      g.add(p);
      return p;
    };
    const DARK = 0x221c1c;

    // 腿（髖軸 y=0.13）+ 鞋
    const legs = [-0.032, 0.032].map((x) => {
      const p = pivot(x, 0.13);
      add(p, 'leg', look.pants, [0, -0.065, 0], [0.05, 0.13, 0.058]);
      add(p, 'box', look.role === 'puma' ? 0xf6f4ef : 0x2a2524, [0, -0.118, 0.012], [0.055, 0.025, 0.085]); // Puma 穿白球鞋
      return p;
    });

    // 身體與衣款
    const o = look.outfit;
    const COAT = 0xf6f6f1, COAT_SH = 0xdedfd8, KNIT = 0xa38c66, KNIT_RIB = 0x84714f;
    if (o === 'coat') { // 研究袍：白色長袍蓋過大腿、前襟敞開露出內搭、V 領翻領、口袋與胸前插筆
      add(g, 'body', COAT, [0, 0.2, 0], [0.138, 0.112, 0.118]);
      add(g, 'box', COAT, [0, 0.1, 0], [0.142, 0.1, 0.116]);                      // 袍身下襬，蓋到大腿
      add(g, 'box', look.shirt, [0, 0.24, 0.056], [0.036, 0.05, 0.006]);          // V 領露出的內搭
      add(g, 'box', look.shirt, [0, 0.212, 0.057], [0.018, 0.03, 0.006]);
      for (const sx of [-1, 1]) add(g, 'box', COAT_SH, [0.021 * sx, 0.232, 0.06], [0.014, 0.066, 0.006], [0, 0, 0.42 * sx]); // 翻領
      add(g, 'box', COAT_SH, [0, 0.135, 0.0595], [0.004, 0.13, 0.004]);           // 前襟開口
      for (const sx of [-1, 1]) add(g, 'box', COAT_SH, [0.04 * sx, 0.105, 0.059], [0.032, 0.026, 0.004]); // 下口袋
      add(g, 'box', COAT_SH, [0.042, 0.205, 0.0595], [0.026, 0.02, 0.004]);       // 胸前口袋
      add(g, 'box', 0x3e7c8c, [0.048, 0.219, 0.061], [0.004, 0.02, 0.004]);       // 插筆
    } else if (o === 'cardigan') { // 針織外套：開襟 V 領露出內搭、中間一排扣子、下襬與袖口羅紋、兩個口袋
      add(g, 'body', KNIT, [0, 0.2, 0], [0.139, 0.112, 0.118]);
      add(g, 'box', look.shirt, [0, 0.25, 0.055], [0.05, 0.026, 0.006]);         // V 領：上寬下窄的內搭
      add(g, 'box', look.shirt, [0, 0.226, 0.057], [0.026, 0.024, 0.006]);
      add(g, 'box', look.shirt, [0, 0.208, 0.058], [0.012, 0.018, 0.006]);
      for (const y of [0.188, 0.163, 0.138]) add(g, 'eye', 0x5a4a38, [0, y, 0.0605], [0.011, 0.011, 0.006]); // 扣子
      add(g, 'box', KNIT_RIB, [0, 0.127, 0], [0.126, 0.02, 0.106]);               // 下襬羅紋
      for (const sx of [-1, 1]) add(g, 'box', KNIT_RIB, [0.038 * sx, 0.158, 0.057], [0.028, 0.024, 0.005]); // 口袋
    } else add(g, 'body', look.shirt, [0, 0.2, 0], [0.135, 0.11, 0.115]);
    if (o === 'vest') { // 公務員背心：無袖橘色背心套在襯衫外，V 領露出襯衫領口，胸前掛識別證
      const VEST_SH = 0xc45a35;
      add(g, 'body', CORAL, [0, 0.196, 0], [0.141, 0.104, 0.12]);                 // 背心身（比身體大一圈，袖子露出襯衫）
      add(g, 'box', look.shirt, [0, 0.256, 0.054], [0.046, 0.026, 0.006]);        // V 領內的襯衫
      add(g, 'box', look.shirt, [0, 0.238, 0.056], [0.026, 0.02, 0.006]);
      for (const sx of [-1, 1]) add(g, 'box', 0xffffff, [0.016 * sx, 0.268, 0.05], [0.026, 0.012, 0.012], [0, 0, -0.5 * sx]); // 白襯衫領尖
      add(g, 'box', VEST_SH, [0, 0.16, 0.0605], [0.004, 0.08, 0.004]);            // 前襟拉鍊
      add(g, 'box', 0x3e7c8c, [-0.014, 0.225, 0.062], [0.005, 0.05, 0.004], [0, 0, 0.35]); // 掛繩
      add(g, 'box', 0x3e7c8c, [0.014, 0.225, 0.062], [0.005, 0.05, 0.004], [0, 0, -0.35]);
      add(g, 'box', 0xffffff, [0, 0.183, 0.064], [0.032, 0.042, 0.006]);          // 識別證
      add(g, 'box', 0x58a6a6, [0, 0.195, 0.068], [0.024, 0.01, 0.002]);           // 識別證色條
    }
    if (o === 'hivis') { // 反光背心：螢光橘、兩道環繞腰身的銀色反光條、肩上兩道直條、前襟拉鍊
      const HIVIS = 0xff8a1f, REFL = 0xe4e8ec;
      add(g, 'body', HIVIS, [0, 0.196, 0], [0.141, 0.104, 0.12]);
      add(g, 'box', look.shirt, [0, 0.258, 0.054], [0.044, 0.024, 0.006]);        // V 領內的上衣
      for (const y of [0.172, 0.214]) add(g, 'cyl', REFL, [0, y, 0], [0.146, 0.014, 0.125]); // 環繞反光條
      for (const sx of [-1, 1]) {
        add(g, 'box', REFL, [0.036 * sx, 0.25, 0.058], [0.014, 0.05, 0.004]);     // 肩上直條（前）
        add(g, 'box', REFL, [0.036 * sx, 0.25, -0.058], [0.014, 0.05, 0.004]);    // （後）
      }
      add(g, 'box', 0x8a4a12, [0, 0.16, 0.0615], [0.004, 0.09, 0.004]);           // 前襟拉鍊
    }
    if (o === 'puma') { // 站方 Puma：橘色背心、敞開的白領口、小浪花別針（沒有識別證）
      add(g, 'box', CORAL, [0, 0.205, 0.004], [0.13, 0.112, 0.106]);
      add(g, 'box', 0xfbfbf7, [0, 0.235, 0.058], [0.03, 0.05, 0.004]);
      add(g, 'eye', 0x58a6a6, [0.035, 0.225, 0.06], [0.026, 0.026, 0.01]);
    }

    // 手臂（肩軸 y=0.255）+ 手；公務員背心的袖子是背心色
    const sleeve = o === 'coat' ? COAT : o === 'cardigan' ? KNIT : look.shirt; // 背心類無袖：袖子露出裡面的上衣
    const arms = [-0.077, 0.077].map((x) => {
      const p = pivot(x, 0.255);
      add(p, 'arm', sleeve, [0, -0.05, 0], [0.034, 0.1, 0.038]);
      if (o === 'cardigan') add(p, 'box', KNIT_RIB, [0, -0.09, 0], [0.038, 0.016, 0.042]); // 袖口羅紋
      if (o === 'coat') add(p, 'box', COAT_SH, [0, -0.09, 0], [0.037, 0.012, 0.041]);
      add(p, 'eye', look.skin, [0, -0.105, 0], [0.034, 0.034, 0.034]);
      return p;
    });

    // 頭與臉：眼睛、腮紅、嘴巴
    add(g, 'head', look.skin, [0, 0.345, 0], [0.19, 0.178, 0.172]);
    for (const s of [-1, 1]) {
      const x = 0.036 * s;
      if (look.eyes === 'happy') add(g, 'torus', DARK, [x, 0.344, 0.083], [0.032, 0.032, 0.02]);              // ^ ^
      else if (look.eyes === 'wide') add(g, 'eye', DARK, [x, 0.348, 0.081], [0.03, 0.039, 0.014]);
      else if (look.eyes === 'sleepy') add(g, 'box', DARK, [x, 0.346, 0.082], [0.03, 0.006, 0.012]);
      else add(g, 'eye', DARK, [x, 0.348, 0.081], [0.021, 0.027, 0.012]);
      add(g, 'eye', 0xf2a1a1, [0.056 * s, 0.324, 0.074], [0.024, 0.013, 0.008]);
    }
    if (look.face !== 'mask') {
      if (look.mouth === 'smile') add(g, 'torus', DARK, [0, 0.322, 0.082], [0.046, 0.046, 0.02], [0, 0, Math.PI]); // 下半圈
      else if (look.mouth === 'o') add(g, 'eye', DARK, [0, 0.31, 0.081], [0.014, 0.019, 0.01]);
      else if (look.mouth === 'flat') add(g, 'box', DARK, [0, 0.31, 0.082], [0.03, 0.005, 0.008]);
    }
    if (look.face === 'glasses') { // 站方 Puma 角色的眼鏡：兩個細框、鼻樑、向後的鏡腳
      for (const dx of [-0.038, 0.038]) add(g, 'rim', 0x211d1d, [dx, 0.35, 0.09], [0.05, 0.044, 0.05]);
      add(g, 'box', 0x211d1d, [0, 0.352, 0.091], [0.026, 0.006, 0.006]);
      for (const dx of [-0.093, 0.093]) add(g, 'box', 0x211d1d, [dx, 0.352, 0.045], [0.006, 0.006, 0.09]);
    }
    if (look.face === 'sunglasses') { // 墨鏡：兩片蓋住眼睛的深色鏡片（較亮的反光材質），鼻樑與鏡腳沿用眼鏡的尺寸（官網 10/23 新增，併入）
      for (const dx of [-0.038, 0.038]) addSolo(g, 'eye', 0x161314, [dx, 0.349, 0.092], [0.058, 0.046, 0.012], null, { roughness: 0.25, metalness: 0.2 });
      add(g, 'box', 0x211d1d, [0, 0.356, 0.092], [0.03, 0.007, 0.006]);
      for (const dx of [-0.093, 0.093]) add(g, 'box', 0x211d1d, [dx, 0.352, 0.045], [0.006, 0.006, 0.09]);
    }
    if (look.face === 'mask') {
      add(g, 'box', 0xf2f2ee, [0, 0.308, 0.078], [0.1, 0.06, 0.045]);
      for (const dx of [-0.092, 0.092]) add(g, 'box', 0xf2f2ee, [dx, 0.325, 0.03], [0.004, 0.004, 0.1]);
    }

    // 頭髮：比頭大一圈的殼 + 髮型（戴帽子時頭髮殼壓低、髮型被蓋住；光頭沒有頭髮殼）
    if (look.hairStyle !== 'bald') add(g, 'cap', look.hair, [0, 0.352, -0.006], [0.206, hatted ? 0.17 : 0.19, 0.204], [-0.32, 0, 0]);
    if (!hatted) {
      const st = look.hairStyle, c = look.hair;
      if (st === 'long') add(g, 'box', c, [0, 0.31, -0.07], [0.19, 0.13, 0.05], [0.12, 0, 0]);
      if (st === 'bun') add(g, 'eye', c, [0, 0.44, -0.07], [0.075, 0.07, 0.07]);
      if (st === 'pony') add(g, 'eye', c, [0, 0.33, -0.115], [0.055, 0.1, 0.05], [0.35, 0, 0]);
      if (st === 'puff') for (const [dx, dy] of [[-0.07, 0.4], [0.07, 0.4], [0, 0.435]]) add(g, 'eye', c, [dx, dy, -0.02], [0.09, 0.08, 0.09]);
      if (st === 'curly') { // 站方 Puma 的捲髮：頭頂幾顆小球，再補兩側
        for (const [dx, dz] of [[-0.035, -0.02], [0.035, -0.02], [0, 0.03], [0, -0.06]]) add(g, 'eye', c, [dx, 0.43, dz], [0.066, 0.056, 0.066]);
        for (const dx of [-0.085, 0.085]) add(g, 'eye', c, [dx, 0.395, -0.02], [0.06, 0.06, 0.06]);
      }
      if (st === 'bob') {
        add(g, 'box', c, [0, 0.315, -0.065], [0.2, 0.12, 0.07], [0.1, 0, 0]);
        for (const sx of [-1, 1]) add(g, 'box', c, [sx * 0.098, 0.318, -0.015], [0.03, 0.11, 0.13]);
      }
      if (st === 'side') add(g, 'box', c, [0.04, 0.405, 0.075], [0.13, 0.035, 0.06], [0.15, 0, -0.25]); // 斜瀏海
    }

    // 帽子
    const hc = look.hatColor;
    switch (look.hat) {
      case 'kid':
        add(g, 'cap', hc, [0, 0.39, 0], [0.205, 0.13, 0.195]);
        add(g, 'cyl', hc, [0, 0.39, 0.02], [0.24, 0.008, 0.22]);
        break;
      case 'hardhat':
        add(g, 'cap', hc, [0, 0.395, 0], [0.21, 0.13, 0.2]);
        add(g, 'cyl', hc, [0, 0.39, 0.02], [0.22, 0.01, 0.22]);
        break;
      case 'helmet': add(g, 'cap', hc, [0, 0.385, 0], [0.205, 0.12, 0.195]); break;
      case 'hike': add(g, 'cap', hc, [0, 0.39, 0], [0.214, 0.1, 0.206]); break;
      case 'straw': add(g, 'cone', 0xd8b878, [0, 0.415, 0], [0.34, 0.07, 0.34]); break; // 斗笠固定色
      case 'beanie':
        add(g, 'cap', hc, [0, 0.376, -0.008], [0.222, 0.17, 0.218], [-0.2, 0, 0]);
        add(g, 'eye', 0xfff8f0, [0, 0.465, -0.02], [0.045, 0.045, 0.045]);
        break;
      default:
    }

    // 背部
    if (look.back === 'schoolbag') add(g, 'box', 0x4a6fa5, [0, 0.2, -0.07], [0.1, 0.11, 0.05]);
    if (look.back === 'hikepack') add(g, 'box', 0xc06a3a, [0, 0.21, -0.075], [0.11, 0.14, 0.07]);

    // 手持物（掛在手臂軸上，座標已換算成相對肩軸；會跟著手臂擺動）
    switch (look.hand) {
      case 'coffee': add(arms[1], 'cyl', 0xf6efe3, [0.023, -0.095, 0.03], [0.03, 0.05, 0.03]); break;
      case 'basket':
        add(arms[1], 'cyl', 0x9c7a4e, [0.033, -0.105, 0.02], [0.08, 0.06, 0.08]);
        add(arms[1], 'eye', 0x7fa35e, [0.033, -0.065, 0.02], [0.06, 0.04, 0.06]);
        break;
      case 'cane': add(arms[1], 'cyl', 0x7a5a3e, [0.028, -0.165, 0.03], [0.012, 0.18, 0.012]); break;
      case 'pole': add(arms[1], 'cyl', 0x4a4a52, [0.023, -0.135, 0.03], [0.01, 0.24, 0.01]); break;
      case 'tube': add(arms[0], 'cyl', 0x7fa8d8, [-0.023, -0.065, 0.02], [0.03, 0.12, 0.03]); break;
      case 'umbrella':
        add(arms[1], 'cyl', CORAL, [0.028, -0.15, 0.03], [0.02, 0.19, 0.02]);
        add(arms[1], 'eye', 0x2a2524, [0.028, -0.255, 0.03], [0.026, 0.026, 0.026]);
        break;
      case 'flower':
        add(arms[1], 'cyl', 0x6f9a52, [0.03, -0.12, 0.03], [0.01, 0.12, 0.01]);
        add(arms[1], 'eye', 0xf2a1a1, [0.03, -0.055, 0.03], [0.045, 0.045, 0.045]);
        break;
      case 'balloon':
        add(arms[1], 'cyl', 0xdddddd, [0.03, 0.05, 0.03], [0.004, 0.3, 0.004]);
        add(arms[1], 'eye', 0xe8575a, [0.03, 0.27, 0.03], [0.09, 0.1, 0.09]);
        break;
      default:
    }

    // 同行物
    if (look.side === 'luggage') {
      add(g, 'box', CORAL, [0.11, 0.08, 0.0], [0.05, 0.13, 0.1]);
      add(g, 'cyl', 0x2a2524, [0.11, 0.17, 0.0], [0.008, 0.06, 0.008]);
    }
    if (look.side === 'stroller') { // 前方的嬰兒推車（簡化版）
      add(g, 'box', 0x6f7fb5, [0, 0.1, 0.25], [0.1, 0.08, 0.14]);
      add(g, 'cap', 0x58a6a6, [0, 0.14, 0.21], [0.11, 0.09, 0.11]);
      add(g, 'box', 0x2a2524, [0, 0.16, 0.13], [0.08, 0.012, 0.18]);
      for (const [x, z] of [[-0.055, 0.2], [0.055, 0.2], [-0.055, 0.3], [0.055, 0.3]]) add(g, 'eye', 0x2a2524, [x, 0.035, z], [0.05, 0.05, 0.05]);
    }

    // 合併：每個父節點一個網格、共用頂點色材質
    if (!FIG_MAT) FIG_MAT = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    const col = new T.Color();
    for (const [parent, list] of parts) {
      const geos = list.map(({ geo, color, matrix }) => {
        let gg = geo.clone().applyMatrix4(matrix);
        if (gg.index) gg = gg.toNonIndexed(); // 圓角方塊沒有索引、球體有：統一成無索引才能合併
        col.setHex(color);
        const n = gg.attributes.position.count, arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
        gg.setAttribute('color', new T.BufferAttribute(arr, 3));
        return gg;
      });
      const merged = mergeGeometries && geos.length > 1 ? mergeGeometries(geos, false) : null;
      if (merged) {
        geos.forEach((x) => x.dispose());
        const m = new T.Mesh(merged, FIG_MAT);
        m.castShadow = false; // 站方陰影圖改為靜態（只含建築），角色用下面的軟陰影
        m.userData.hmOwned = true;
        parent.add(m);
      } else for (const gg of geos) { // 合併工具不可用時退回逐件（仍共用材質）
        const m = new T.Mesh(gg, FIG_MAT);
        m.castShadow = false; // 站方陰影圖改為靜態（只含建築），角色用下面的軟陰影
        m.userData.hmOwned = true;
        parent.add(m);
      }
    }

    // 頭頂標記，方便在大場景裡找到自己
    const pin = new T.Mesh(G.pin, new T.MeshStandardMaterial({ color: 0xff5a36, roughness: 0.7, emissive: 0xff5a36, emissiveIntensity: 0.5 }));
    pin.position.set(0, 0.62 + NECK * (H - 1), 0);
    pin.scale.set(0.06, 0.1, 0.06);
    pin.rotation.set(Math.PI, 0, 0);
    g.add(pin);

    // 腳下的軟陰影（同站方居民）：站方的陰影圖只含靜態建築，會動的角色都用這種圓形陰影
    if (!G.blob) G.blob = new T.CircleGeometry(0.5, 20).rotateX(-Math.PI / 2);
    if (!G.blobMat) G.blobMat = new T.MeshBasicMaterial({ color: 0x2a2018, transparent: true, opacity: 0.22, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    const blob = new T.Mesh(G.blob, G.blobMat);
    blob.position.y = 0.006;
    blob.scale.setScalar(0.2 * W);
    blob.renderOrder = 1;
    blob.userData.hmShared = true;
    g.add(blob);

    // 追隨中顯示的底圈
    const ring = new T.Mesh(G.ring, new T.MeshBasicMaterial({ color: 0xff5a36, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }));
    ring.position.y = 0.012;
    ring.renderOrder = 3; // 地上的底圈：固定繪製順序並往前偏移深度，走在高低不平的路面時不會被地面吃掉而閃爍
    ring.visible = false;
    g.add(ring);

    // base：學童身形較小（站方 scale 0.78）；shape：使用者設定的身高與體型
    // shape 已做進零件，群組只做等比縮放；pinY 給頭頂標記的上下浮動用
    return { group: g, legs, arms, pin, ring, pinY: pin.position.y, base: look.role === 'child' ? 0.78 : look.role === 'puma' ? 1.16 : 1, shape: { w: 1, h: 1 } };
  }

  // 站方 zoomFactor：鏡頭拉遠時小人放大到最多 1.45 倍
  function camDist() {
    const cam = cap.camera;
    if (cap.controls) return cam.position.distanceTo(cap.controls.target);
    const dir = cam.getWorldDirection(new T.Vector3());
    return dir.y < -0.01 ? (0.4 - cam.position.y) / dir.y : 20;
  }
  const zoomFactor = () => Math.min(1.45, Math.max(1, camDist() / 20));
  // 站方的縮放 × 身分身形 × 鏡頭距離；再套用使用者的身高與體型。重建後立刻套用，不會有一幀以 1 倍大小出現
  const applyFigScale = (fig) => {
    const sc = fig.base * 0.8 * zoomFactor();
    fig.group.scale.set(sc * fig.shape.w, sc * fig.shape.h, sc * fig.shape.w);
  };

  // ───────────────────────── 介面 ─────────────────────────

  const CSS = `
.hm-open{font:inherit}
#hm-open[aria-pressed=true]{background:#211d1d!important;color:#fff8f4!important;border-color:#211d1d!important}
.hm-panel{position:absolute;right:0;top:0;bottom:0;width:318px;overflow:auto;box-sizing:border-box;
  background:#fff8f4e8;color:#211d1d;border:0;border-left:1px solid #211d1d26;border-radius:0;box-shadow:none;-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);
  font:14px/1.5 "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;z-index:7;padding:29px 22px 22px;display:none;overscroll-behavior:contain}
.hm-panel.loose{position:fixed}
body.hm-docked #sidebar{display:none!important}
@media (min-width:801px){
  body.hm-docked .sidebar-hidden .toolbar{right:338px}
  body.hm-docked .sidebar-hidden .controls{right:348px}
}
.hm-panel.open{display:block}
.hm-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px}
.hm-eyebrow{font-size:11px;letter-spacing:.14em;color:#db6a41;font-weight:700;margin-bottom:10px}
.hm-title{font-size:24px;font-weight:900;margin:0;line-height:1.25}
.hm-x{border:0;background:transparent;font-size:22px;line-height:1;cursor:pointer;color:#78685e;padding:2px 6px}
.hm-tabs{display:flex;gap:4px;margin:14px 0 2px}
.hm-tab{flex:1;border:0;background:transparent;font:inherit;font-weight:600;color:#78685e;padding:6px 0;cursor:pointer;border-radius:9px}
.hm-tab:hover{background:#db6a4114}
.hm-tab[aria-selected=true],.hm-tab[aria-selected=true]:hover{background:#db6a41;color:#fff}
.hm-row{margin-top:12px}
.hm-lab{font-size:12px;color:#78685e;margin-bottom:6px;letter-spacing:.04em}
.hm-note{font-size:12px;color:#78685e;margin-top:4px}
.hm-status{margin-top:12px;padding:8px 10px;border-radius:10px;background:#fcea8b66;font-size:13px}
.hm-name{width:100%;box-sizing:border-box;border:1px solid #211d1d26;border-radius:9px;padding:7px 10px;font:inherit;background:#fff;color:#211d1d}
.hm-chips,.hm-sw{display:flex;flex-wrap:wrap;gap:6px}
.hm-sw{gap:8px}
.hm-sec{border-top:1px solid #211d1d14;margin-top:12px;padding-top:2px}
.hm-sec>summary{cursor:pointer;font-weight:700;font-size:13px;padding:8px 0;list-style:none;display:flex;justify-content:space-between;align-items:center}
.hm-sec>summary::-webkit-details-marker{display:none}
.hm-sec>summary::after{content:"＋";color:#db6a41;font-weight:400}
.hm-sec[open]>summary::after{content:"－"}
.hm-sec>.hm-row:first-of-type{margin-top:2px}
.hm-custom{position:relative;display:inline-block;overflow:hidden;background:conic-gradient(#e8575a,#e8c547,#8fb37a,#58a6a6,#6f7fb5,#b58fd0,#e8575a)}
.hm-custom input{position:absolute;inset:-6px;width:calc(100% + 12px);height:calc(100% + 12px);opacity:0;cursor:pointer;padding:0;border:0}
.hm-range{width:100%;accent-color:#db6a41;margin:2px 0}
.hm-rangeval{float:right;color:#211d1d;font-size:12px}
.hm-chip{border:1px solid #211d1d26;background:#fff;color:#211d1d;border-radius:999px;padding:4px 11px;font:inherit;font-size:13px;cursor:pointer;text-align:left}
.hm-chip[aria-pressed=true],.hm-chip[aria-pressed=true]:hover{background:#db6a41;border-color:#db6a41;color:#fff}
.hm-chip:hover,.hm-ghost:hover{background:#fdf0ea;border-color:#db6a4166}
@media (hover:none){.hm-chip:hover,.hm-ghost:hover{background:#fff;border-color:#211d1d26}}
.hm-ghost[aria-pressed=true]:hover{background:#db6a41;border-color:#db6a41}
/* 前往某處：島名兩欄等寬；選定的島，地點一列一個，收在淺底框裡 */
.hm-chips.grid2{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.hm-chips.grid2 .hm-chip{text-align:center;border-radius:9px;padding:7px 6px;line-height:1.35}
.hm-places{margin-top:10px;padding:10px;border-radius:12px;background:#211d1d0a}
.hm-places .hm-lab{color:#211d1d;font-weight:700}
.hm-chips.list{display:flex;flex-direction:column;gap:6px}
.hm-chips.list .hm-chip{border-radius:9px;padding:7px 11px;width:100%;box-sizing:border-box;line-height:1.35}
.hm-chips.off{opacity:.4;pointer-events:none}
.hm-swb{width:30px;height:30px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px #211d1d33;cursor:pointer;padding:0;flex:none;box-sizing:border-box;min-width:0!important;min-height:0!important;aspect-ratio:1/1}
.hm-swb[aria-pressed=true]{box-shadow:0 0 0 2px #db6a41}
.hm-foot{display:flex;gap:8px;margin-top:16px}
.hm-primary{flex:1;background:#db6a41;color:#fff;border:0;border-radius:9px;padding:9px;font:inherit;font-weight:600;cursor:pointer}
.hm-ghost{background:#fff;color:#211d1d;border:1px solid #211d1d26;border-radius:9px;padding:9px 12px;font:inherit;cursor:pointer}
.hm-ghost[aria-pressed=true]{background:#db6a41;border-color:#db6a41;color:#fff}
.hm-two{display:flex;gap:8px}.hm-two>*{flex:1;padding:8px 6px}
.hm-foot.sticky{position:sticky;bottom:-22px;margin:10px -22px -22px;padding:10px 22px 22px;background:linear-gradient(to bottom,rgba(255,248,244,0),#fff8f4 22%);z-index:2}
.hm-aim{display:flex;gap:14px;align-items:center;justify-content:center;margin-top:10px;flex-wrap:wrap}
.hm-dial{position:relative;width:132px;height:132px;border-radius:50%;border:2px solid #211d1d26;background:#fff;touch-action:none;cursor:pointer;flex:none}
.hm-dial-needle{position:absolute;left:50%;top:50%;width:6px;height:54px;margin:-54px 0 0 -3px;background:#db6a41;border-radius:3px;transform-origin:50% 100%;pointer-events:none}
.hm-dial-needle::after{content:"";position:absolute;left:50%;top:-9px;margin-left:-8px;border:8px solid transparent;border-bottom:12px solid #db6a41;border-top:0}
.hm-dial::before{content:"";position:absolute;left:50%;top:50%;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:#211d1d;z-index:1}
.hm-dl{position:absolute;font-size:11px;color:#78685e;pointer-events:none}
.hm-dl.t{left:50%;top:3px;transform:translateX(-50%)}.hm-dl.b{left:50%;bottom:3px;transform:translateX(-50%)}
.hm-dl.l{left:6px;top:50%;transform:translateY(-50%)}.hm-dl.r{right:6px;top:50%;transform:translateY(-50%)}
.hm-spot{display:flex;align-items:center;justify-content:center;font-weight:600;color:#db6a41;border:1px dashed #db6a4180;border-radius:9px;background:#fff}
.hm-flow{border-top:1px solid #211d1d14;padding:4px 0}
.hm-flow summary{cursor:pointer;font-size:13px;padding:3px 0}
.hm-flow summary b{color:#db6a41;margin-right:6px}
.hm-flow .hm-chips{margin:4px 0 6px}
.hm-tag,.hm-say{position:fixed;left:0;top:0;background:rgba(255,248,244,.94);border:1px solid #211d1d26;border-radius:999px;padding:1px 9px;
  font:600 12px/1.6 "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;color:#211d1d;pointer-events:none;white-space:nowrap;z-index:20;display:none}
.hm-tag b{color:#db6a41;margin-left:6px;font-weight:600}
.hm-say{border-radius:12px;border-color:#db6a41;white-space:normal;width:max-content;max-width:230px;padding:5px 11px;font-weight:500;z-index:21}
.hm-say b{display:block;color:#db6a41}
.hm-headbtns{display:flex;align-items:center}
.hm-min{display:none}
.hm-sub{display:none;font-size:12px;color:#78685e;margin-top:2px;max-width:230px}
.hm-panel.min .hm-tabs,.hm-panel.min .hm-body{display:none}
.hm-panel.min{padding:8px 12px;max-height:none;overflow:visible}
.hm-panel.min .hm-head{margin-bottom:0}
.hm-panel.min .hm-sub{display:block}
/* 手機：底部抽屜。站方在手機上也用底部抽屜（側邊欄 z17、政策卡 z16），所以一次只開一個，由腳本互斥 */
@media (max-width:800px){
  .hm-panel{left:0;right:0;top:auto;bottom:0;width:auto;height:52%;border-left:0;border-radius:18px 18px 0 0;box-shadow:0 -10px 50px #211d1d22;z-index:17;
    padding:20px 20px calc(20px + env(safe-area-inset-bottom,0px))}
  .hm-panel.loose{height:52vh;height:52dvh}
  .hm-panel.min{height:auto}
  .hm-eyebrow{margin-bottom:4px}
  .hm-title{font-size:20px}
  .hm-foot.sticky{bottom:calc(-20px - env(safe-area-inset-bottom,0px));margin:10px -20px calc(-20px - env(safe-area-inset-bottom,0px));padding:10px 20px calc(20px + env(safe-area-inset-bottom,0px))}
  .hm-min{display:inline-block}
}
/* 觸控：放大點擊範圍；輸入框 16px 以上，iOS 才不會在聚焦時自動放大頁面 */
@media (max-width:800px),(pointer:coarse){
  .hm-chip{padding:9px 14px;font-size:14px}
  .hm-swb{width:38px;height:38px}
  .hm-ghost,.hm-primary{padding:11px 12px;min-height:44px}
  .hm-tab{padding:11px 0}
  .hm-x{min-width:44px;min-height:44px}
  .hm-name{font-size:16px;padding:10px 12px}
  .hm-flow summary{padding:9px 0}
  .hm-sw{gap:10px}
  .hm-range{height:32px}
}
/* 矮視窗（手機橫放只有約 440px 高）；必須寫在觸控樣式之後，同優先級後寫的才會贏：面板只剩 340px，選項縮緊湊一點，不然要捲將近 5 屏；點擊範圍仍維持約 34px 以上 */
@media (max-height:520px){
  .hm-panel{padding:10px 12px}
  .hm-title{font-size:16px}
  .hm-row{margin-top:7px}
  .hm-lab{margin-bottom:3px}
  .hm-chips{gap:5px}
  /* 站方在觸控裝置有一條全域 button{min-height:44px}，要明確歸零才縮得動 */
  .hm-chip,.hm-swb,.hm-tab,.hm-ghost,.hm-primary,.hm-sec>summary{min-height:0}
  .hm-chip{padding:5px 11px;font-size:13px}
  .hm-swb{width:30px;height:30px;min-width:0}
  .hm-sw{gap:7px}
  .hm-ghost,.hm-primary{padding:6px 10px;min-height:34px}
  .hm-tab{padding:6px 0}
  .hm-name{padding:6px 10px}
  .hm-sec>summary{padding:6px 0}
  .hm-note{margin-top:2px}
  /* 定點站立的羅盤縮小；黏底按鈕的位移對應緊湊的內距 */
  .hm-aim{gap:10px;margin-top:6px}
  .hm-dial{width:108px;height:108px}
  .hm-dial-needle{height:44px;margin-top:-44px}
  .hm-foot.sticky{bottom:-10px;margin:8px -12px -10px;padding:8px 12px 10px}
}
`;

  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  const h = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const kid of kids) el.append(kid);
    return el;
  };

  function buildUI(api, S) {
    const style = h('style');
    style.textContent = CSS;
    document.head.append(style);

    const tag = h('div', { class: 'hm-tag' });
    const say = h('div', { class: 'hm-say' });
    document.body.append(tag, say);

    const dyn = h('div', { class: 'hm-body' });
    const nameInput = h('input', {
      class: 'hm-name', maxlength: '10', placeholder: '替角色取個名字',
      oninput: (e) => api.update({ name: e.target.value.trim() || DEFAULT_LOOK.name }, false),
    });
    const tabs = h('div', { class: 'hm-tabs', role: 'tablist' },
      ...[['look', '外觀'], ['trip', '行程'], ['photo', '拍照']].map(([k, label]) =>
        h('button', { class: 'hm-tab', type: 'button', role: 'tab', 'data-tab': k, onclick: () => { api.setTab(k); track("heart_island_avatar_tab", { tab: k }); } }, label)));
    const closeBtn = h('button', { class: 'hm-x', type: 'button', 'aria-label': '關閉', onclick: () => api.close() }, '×');
    const minBtn = h('button', { class: 'hm-x hm-min', type: 'button', 'aria-label': '收合或展開', onclick: () => api.toggleMin() }, '▾');
    const sub = h('div', { class: 'hm-sub' });
    const panel = h('div', { class: 'hm-panel', role: 'dialog', 'aria-label': '角色' },
      h('div', { class: 'hm-head' },
        h('div', {}, h('div', { class: 'hm-eyebrow' }, 'MY CHARACTER'), h('h2', { class: 'hm-title' }, '角色'), sub),
        h('div', { class: 'hm-headbtns' }, minBtn, closeBtn)),
      tabs, dyn);
    // 放在站方側邊欄同一層（#app），位置、大小與清單完全一樣；開啟時取代清單
    const host = document.querySelector('#sidebar') && document.querySelector('#sidebar').parentElement;
    if (host) host.append(panel); else { panel.classList.add('loose'); document.body.append(panel); }

    // 開啟按鈕：優先放進站方工具列，沿用它的按鈕樣式
    const openBtn = h('button', { id: 'hm-open', class: 'hm-open', type: 'button', onclick: () => {
      api.toggle();
      if (panel.classList.contains('open')) track("heart_island_avatar_open");
    } }, '☺ 角色');
    const toolbar = document.querySelector('nav.toolbar');
    if (toolbar) toolbar.insertBefore(openBtn, toolbar.querySelector('#sidebar-toggle') || toolbar.firstChild);
    else {
      Object.assign(openBtn.style, { position: 'fixed', left: '16px', top: '16px', zIndex: 60, padding: '8px 12px', borderRadius: '9px', border: '1px solid #211d1d26', background: '#fff8f4' });
      document.body.append(openBtn);
    }

    const chips = (items, current, onPick, extraClass = '') =>
      h('div', { class: 'hm-chips ' + extraClass }, ...items.map(([k, label]) =>
        h('button', { class: 'hm-chip', type: 'button', 'aria-pressed': String(k === current), onclick: () => onPick(k) }, label)));
    // 色票 + 最後一顆「自訂色」：拖動色盤時只重建角色、不重繪面板（否則色盤會被關掉），放開後才重繪
    const swatches = (part, current) => {
      const inPalette = PALETTE[part].includes(current);
      return h('div', { class: 'hm-sw' },
        ...PALETTE[part].map((c) =>
          h('button', { class: 'hm-swb', type: 'button', style: `background:${hex(c)}`, 'aria-label': PART_LABEL[part], 'aria-pressed': String(c === current), onclick: () => api.update({ [part]: c }) })),
        h('label', { class: 'hm-swb hm-custom', title: '自訂顏色', 'aria-pressed': String(!inPalette), ...(inPalette ? {} : { style: `background:${hex(current)}` }) },
          h('input', {
            type: 'color', value: hex(current), 'aria-label': PART_LABEL[part] + '自訂顏色',
            oninput: (e) => api.update({ [part]: parseInt(e.target.value.slice(1), 16) }, false),
            onchange: () => render(),
          })));
    };
    const slider = (key, label) => {
      const [lo, hi] = SHAPE_RANGE[key];
      const val = h('span', { class: 'hm-rangeval' }, Math.round(S.look[key] * 100) + '%');
      return row(label, val, h('input', {
        class: 'hm-range', type: 'range', min: String(lo), max: String(hi), step: '0.01', value: String(S.look[key]), 'aria-label': label,
        oninput: (e) => { const v = parseFloat(e.target.value); val.textContent = Math.round(v * 100) + '%'; api.update({ [key]: v }, false); },
      }));
    };
    const toggle = (label, on, fn) => h('button', { class: 'hm-ghost', type: 'button', 'aria-pressed': String(!!on), onclick: fn }, label);
    const row = (label, ...kids) => h('div', { class: 'hm-row' }, h('div', { class: 'hm-lab' }, label), ...kids);
    // 可收合的區塊；開合狀態記在 S.ui.sections，面板重繪後才不會全部縮回去
    const section = (key, title, ...kids) => {
      const el = h('details', { class: 'hm-sec', ...(S.ui.sections[key] ? { open: '' } : {}) }, h('summary', {}, title), ...kids);
      el.addEventListener('toggle', () => { S.ui.sections[key] = el.open; });
      return el;
    };

    // 面向羅盤：點或拖曳設定方向。完全在面板內，不碰場景手勢（免得跟鏡頭旋轉、站方的點選搶）
    const dialWidget = () => {
      const needle = h('div', { class: 'hm-dial-needle' });
      const dial = h('div', { class: 'hm-dial', 'aria-label': '面向羅盤：點或拖曳設定方向' }, needle,
        h('span', { class: 'hm-dl t' }, '遠'), h('span', { class: 'hm-dl b' }, '近'), h('span', { class: 'hm-dl l' }, '左'), h('span', { class: 'hm-dl r' }, '右'));
      const set = (e) => {
        const r = dial.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        if (Math.hypot(dx, dy) > 6) api.aimDial(Math.atan2(dx, -dy)); // 0 = 上
      };
      let drag = false;
      dial.addEventListener('pointerdown', (e) => { drag = true; try { dial.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件沒有可捕捉的指標 */ } set(e); });
      dial.addEventListener('pointermove', (e) => { if (drag) set(e); });
      const end = () => { drag = false; };
      dial.addEventListener('pointerup', end);
      dial.addEventListener('pointercancel', end);
      return dial;
    };
    const whoName = (actor) => (actor === 'puma' ? 'Puma 分身' : '角色');
    const placingUI = () => [
      h('div', { class: 'hm-status' }, `放置：${whoName(S.actor)}`),
      h('div', { class: 'hm-note' }, '在場景裡點一個位置：步道旁、建築前、教室黑板前都可以；小島請點島上。可以先拖曳轉好鏡頭再點。'),
      h('div', { class: 'hm-foot' }, h('button', { class: 'hm-ghost', type: 'button', style: 'flex:1', onclick: () => api.cancelPlace() }, '取消')),
    ];
    const poseRow = () => {
      const po = S.pose[S.aim.actor];
      return row('姿勢', h('div', { class: 'hm-two' },
        toggle('左手舉高', po.l, () => api.togglePose('l')),
        toggle('右手舉高', po.r, () => api.togglePose('r'))));
    };
    const aimUI = () => [
      h('div', { class: 'hm-status' }, `${whoName(S.aim.actor)} · ${S.aim.name}：調整面向`),
      h('div', { class: 'hm-aim' }, dialWidget()),
      h('div', { class: 'hm-note' }, '羅盤：點或拖曳設定面向（上＝畫面遠方，會跟著目前鏡頭）；也可以直接點場景上的任一處，角色會面向那裡。'),
      row('面向', h('div', { class: 'hm-chips' },
        ...[['camera', '面向鏡頭'], ['back', '背對鏡頭'], ['building', '面向最近建築']].map(([k, label]) =>
          h('button', { class: 'hm-chip', type: 'button', onclick: () => api.aimFace(k) }, label)),
        h('button', { class: 'hm-chip', type: 'button', onclick: () => api.aimTurn(-15) }, '⟲ 左轉 15°'),
        h('button', { class: 'hm-chip', type: 'button', onclick: () => api.aimTurn(15) }, '右轉 15° ⟳'))),
      poseRow(),
      h('div', { class: 'hm-row' }, toggle('拍照模式（隱藏名牌與標記）', S.clean, () => api.toggleClean())),
      h('div', { class: 'hm-foot sticky' }, // 黏在面板底部：內容比面板高時，確認鈕也一直看得到
        h('button', { class: 'hm-ghost', type: 'button', onclick: () => api.cancelAim() }, '取消'),
        h('button', { class: 'hm-primary', type: 'button', onclick: () => api.commitAim() }, '站在這裡')),
    ];

    function renderLook() {
      const look = S.look, set = (k) => (v) => api.update({ [k]: v });
      if (document.activeElement !== nameInput) nameInput.value = look.name === DEFAULT_LOOK.name ? '' : look.name;
      const hatted = look.hat !== 'none';
      dyn.replaceChildren(
        row('名字', nameInput),
        row('身分', chips(ROLES, look.role, (k) => api.setRole(k)),
          h('div', { class: 'hm-note' }, '切換身分會套用該身分的預設衣著與配件，之後每一項都能自己改')),
        row('預覽方向', h('div', { class: 'hm-two' },
          h('button', { class: 'hm-ghost', type: 'button', onclick: () => api.facing(false) }, '面向鏡頭'),
          h('button', { class: 'hm-ghost', type: 'button', onclick: () => api.facing(true) }, '背面'))),
        ...(S.fitSpots && S.fitSpots.length ? [row('試衣地點', h('div', { class: 'hm-two' },
          h('div', { class: 'hm-spot' }, (S.fitSpots[S.fitIdx] || S.fitSpots[0]).name),
          ...(S.fitSpots.length > 1 ? [h('button', { class: 'hm-ghost', type: 'button', onclick: () => api.nextSpot() }, '換一個')] : [])))] : []),
        ...(S.fitSpots && S.fitSpots.length ? [row('合照', h('div', { class: 'hm-two' },
          toggle('與 Puma 合照', S.pair, () => api.togglePair()),
          ...(S.pair ? [h('button', { class: 'hm-ghost', type: 'button', onclick: () => api.swapPair() }, '左右換邊')] : [])))] : []),
        section('face', '臉與髮',
          row('髮型', chips(HAIR_STYLES, look.hairStyle, set('hairStyle'), hatted ? 'off' : ''),
            hatted ? h('div', { class: 'hm-note' }, '戴著帽子，髮型被蓋住了') : ''),
          row('髮色', swatches('hair', look.hair)),
          row('膚色', swatches('skin', look.skin)),
          row('眼睛', chips(EYES, look.eyes, set('eyes'), look.face === 'sunglasses' ? 'off' : ''),
            look.face === 'sunglasses' ? h('div', { class: 'hm-note' }, '戴著墨鏡，眼睛被蓋住了') : ''),
          row('嘴巴', chips(MOUTHS, look.mouth, set('mouth'), look.face === 'mask' ? 'off' : ''),
            look.face === 'mask' ? h('div', { class: 'hm-note' }, '戴著口罩，嘴巴被蓋住了') : ''),
          row('臉部配件', chips(FACES, look.face, set('face')))),
        section('outfit', '衣著',
          row('衣款', chips(OUTFITS, look.outfit, set('outfit'))),
          row('上衣顏色', swatches('shirt', look.shirt)),
          row('褲子顏色', swatches('pants', look.pants))),
        section('acc', '配件',
          row('帽子', chips(HATS, look.hat, set('hat'))),
          ...(hatted && look.hat !== 'straw' ? [row('帽子顏色', swatches('hatColor', look.hatColor))] : []),
          row('背部', chips(BACKS, look.back, set('back'))),
          row('手持物', chips(HANDS, look.hand, set('hand'))),
          row('同行物', chips(SIDES, look.side, set('side')))),
        section('shape', '體型',
          slider('height', '身高'),
          slider('width', '體型（寬窄）')),
        h('div', { class: 'hm-foot' },
          h('button', { class: 'hm-ghost', type: 'button', onclick: () => api.randomize() }, '🎲 隨機'),
          h('button', { class: 'hm-ghost', type: 'button', onclick: () => api.reset() }, '重設'),
          h('button', { class: 'hm-primary', type: 'button', onclick: () => api.close() }, '完成')));
    }

    function renderTrip() {
      const D = S.data, M = S.mission;
      const kids = M.label ? [h('div', { class: 'hm-status' }, M.label)] : []; // 沒有行程（例如剛停止自動逛逛）就不顯示狀態框
      if (S.arrived && S.arrived.building) {
        kids.push(h('div', { class: 'hm-row' },
          h('button', { class: 'hm-ghost', type: 'button', style: 'width:100%', onclick: () => api.openCard() }, `查看「${S.arrived.building.name}」的政策卡`)));
      }
      kids.push(h('div', { class: 'hm-row hm-two' },
        toggle('🎲 自動逛逛', M.type === 'wander', () => api.toggleWander()),
        toggle('📍 點地圖指定', S.pickMode, () => api.togglePick())));
      if (S.pickMode) kids.push(h('div', { class: 'hm-note' }, '在場景裡點一個地方，角色會走過去。按 Esc 取消。'));
      if (D) {
        const sel = D.islandById.get(S.ui.island);
        const islandRow = row('前往某處',
          chips(D.islands.map((i) => [i.id, i.name]), S.ui.island, (k) => api.pickIsland(k), 'grid2'));
        if (sel) {
          islandRow.append(h('div', { class: 'hm-places' },
            h('div', { class: 'hm-lab' }, `${sel.name}：選一個地點`),
            chips([['__island', '→ 島的中心'], ...sel.buildings.map((b) => [b.id, b.name])],
              S.mission.targetId,
              (k) => (k === '__island' ? api.goIsland(sel.id) : api.goBuilding(k)), 'list')));
        }
        kids.push(islandRow);
      } else {
        kids.push(h('div', { class: 'hm-note' }, '政策資料載入失敗，目前只能用「點地圖指定」。'));
      }
      dyn.replaceChildren(...kids);
    }

    function renderPhoto() {
      if (S.placing) { dyn.replaceChildren(...placingUI()); return; }
      if (S.aim) { dyn.replaceChildren(...aimUI()); return; }
      const kids = [];
      kids.push(row('拍照站位', h('div', { class: 'hm-two' },
        h('button', { class: 'hm-ghost', type: 'button', onclick: () => api.startPlace('me') }, '📌 角色'),
        h('button', { class: 'hm-ghost', type: 'button', onclick: () => api.startPlace('puma') }, '📌 Puma 分身'))));
      const tools = [];
      if (S.stand) tools.push(h('button', { class: 'hm-chip', type: 'button', onclick: () => api.leaveStand() }, '解除定點，繼續漫步'));
      if (S.puma && S.puma.fig.group.visible) tools.push(h('button', { class: 'hm-chip', type: 'button', onclick: () => api.removePuma() }, '收回 Puma'));
      tools.push(toggle('拍照模式（隱藏名牌與標記）', S.clean, () => api.toggleClean()));
      kids.push(h('div', { class: 'hm-row' }, h('div', { class: 'hm-chips' }, ...tools)));
      dyn.replaceChildren(...kids);
    }

    function render() {
      for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === S.tab));
      (S.tab === 'trip' ? renderTrip : S.tab === 'photo' ? renderPhoto : renderLook)();
    }

    // 面板跟清單在同一個位置（CSS 定位），不需要逐幀計算
    function layout() {}

    return {
      panel, tag, say, openBtn, render, layout,
      destroy() { style.remove(); tag.remove(); say.remove(); panel.remove(); openBtn.remove(); },
      setOpen(on) {
        panel.classList.toggle('open', on);
        openBtn.setAttribute('aria-pressed', String(on));
        if (on) { panel.classList.remove('min'); minBtn.textContent = '▾'; layout(); }
      },
      isOpen: () => panel.classList.contains('open'),
      // 收合：只留一條標題列，並在標題下顯示目前行程（手機上讓出畫面看角色走路）
      setMin(on) { panel.classList.toggle('min', on); minBtn.textContent = on ? '▴' : '▾'; },
      isMin: () => panel.classList.contains('min'),
      setSub(text) { if (sub.textContent !== text) sub.textContent = text; },
    };
  }

  // ───────────────────────── 組裝 ─────────────────────────

  function spawn(data) {
    const hc = window.heartCity;
    const routes = hc.pedestrianRoutes;
    const canvas = document.querySelector('canvas');
    const net = buildNet(routes);

    const S = {
      look: loadLook(), fig: null, follow: null, data,
      tab: 'look', pickMode: false, ui: { island: null, sections: { face: true } },
      routeInfo: hc.routeIslands(),           // 與 pedestrianRoutes 同序：{ flow, islands }
      mission: { type: 'route', label: '', routeIdx: -1, flow: null, targetId: null },
      walk: null, idle: null, pause: null, arrived: null, say: null, lastBuilding: null,
      fitting: false, fitSaved: null, baseLimits: null, pose: { me: { l: false, r: false }, puma: { l: false, r: false } }, fitSpots: null, fitIdx: 0, fitGen: null,
      stand: null, aim: null, placing: false, defaultRoute: 0, actor: 'me', puma: null, clean: false, pair: false, pairSwap: false, fitPumaSaved: null,
    };
    const buildings = data ? data.islands.flatMap((i) => i.buildings.map((b) => ({ ...b, island: i }))) : [];

    const SPEED = 0.3;        // 沿路線閒逛的速度（與站方居民相近）
    const FOLLOW_OFFSET = new T.Vector3(0.9, 2.5, 2.3); // 同站方 selectWalker 的視角
    // 試衣時的視角：鏡頭瞄準胸口（FIT_LIFT）、接近平視（約 8° 俯角），臉才不會被帽簷和頭髮遮住
    const FIT_OFFSET = new T.Vector3(0.2, 0.3, 2.0);
    const FIT_LIFT = new T.Vector3(0, 0.16, 0);
    let followOffset = FOLLOW_OFFSET;
    let followLift = new T.Vector3(); // 追隨瞄準點相對腳底的抬高量
    let last = performance.now();

    // ── 角色重建（保留位置與朝向）
    function rebuild() {
      const old = S.fig;
      const next = buildFigure(S.look);
      if (old) {
        next.group.position.copy(old.group.position);
        next.group.rotation.copy(old.group.rotation);
        cap.scene.remove(old.group);
        disposeFigure(old.group);
      }
      next.ring.visible = !!S.follow;
      applyFigScale(next);
      cap.scene.add(next.group);
      S.fig = next;
      refreshTag();
    }
    const refreshTag = () => { ui.tag.replaceChildren(S.look.name, h('b', {}, ROLE_LABEL[S.look.role])); ui.tag._sz = null; };

    // ── 目的地標記
    const destMark = new T.Group();
    const destRing = new T.Mesh(G.ring, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }));
    destRing.scale.setScalar(1.8);
    const destPin = new T.Mesh(G.pin, new T.MeshStandardMaterial({ color: CORAL, emissive: CORAL, emissiveIntensity: 0.6 }));
    destPin.rotation.x = Math.PI;
    destPin.scale.set(0.08, 0.14, 0.08);
    destMark.add(destRing, destPin);
    destMark.visible = false;
    cap.scene.add(destMark);
    // 調整面向時，角色前方的小箭頭（貼地，指向面向的方向）
    const aimArrow = new T.Group();
    const arrowMesh = new T.Mesh(G.cone, new T.MeshBasicMaterial({ color: CORAL, transparent: true, opacity: 0.9, depthTest: false }));
    arrowMesh.rotation.x = Math.PI / 2; // 錐尖朝 +z（角色面向的方向）
    arrowMesh.scale.set(0.1, 0.18, 0.1);
    arrowMesh.position.set(0, 0.03, 0.3);
    arrowMesh.renderOrder = 997;
    aimArrow.add(arrowMesh);
    aimArrow.visible = false;
    cap.scene.add(aimArrow);

    // ── 行走：沿一串點走，kind 'loop' 來回、'once' 走到終點觸發 after
    function startWalk(pts, kind, after, speed = SPEED) {
      const seg = [];
      let total = 0;
      for (let i = 1; i < pts.length; i++) {
        const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
        seg.push(d);
        total += d;
      }
      S.walk = { pts, seg, total, dist: 0, dir: 1, kind, after, speed, stride: 8 }; // 前往目的地也用同樣的步速，不再加速
      S.idle = null;
    }
    const posOf = () => S.fig.group.position;
    const subjectGroup = () => (S.aim && S.aim.actor === 'puma' && S.puma ? S.puma.fig.group : S.fig.group); // 鏡頭追隨的對象
    const subjectPos = () => { // 合照時鏡頭對準兩人中點
      if (S.fitting && S.pair && S.puma && S.puma.fig.group.visible) {
        const mid = S.fig.group.position.clone().add(S.puma.fig.group.position).multiplyScalar(0.5);
        const rg = new T.Vector3(); // 右側有站方的按鈕列：中心往畫面右邊偏，兩人就稍微靠左，Puma 才不被按鈕擋住
        rg.setFromMatrixColumn(cap.camera.matrixWorld, 0); rg.y = 0;
        return mid.addScaledVector(rg.normalize(), 0.14);
      }
      return subjectGroup().position;
    };
    const here = () => ({ x: posOf().x, z: posOf().z, y: posOf().y });

    function setMission(m) {
      S.mission = { type: 'idle', label: '', routeIdx: -1, flow: null, targetId: null, ...m };
      S.arrived = null;
      S.stand = null; // 任何新行程都會結束定點站立
      if (ui.isOpen() && S.tab !== 'look') ui.render();
    }
    const showSay = (title, text, ms = 5000) => { S.say = { title, text, until: performance.now() + ms }; };

    // 走到 (x, z) 附近的路網節點；找不到路就說一聲
    function goTo(x, z, opts) {
      const { node: end, dist: gap } = net.nearest(x, z);
      const { node: start, dist: off } = net.nearest(posOf().x, posOf().z);
      if (!end || gap > 3.5) { showSay('走不到那裡', '那附近沒有步道。', 2500); return false; }
      const nodes = net.path(start, end);
      if (!nodes) { showSay('走不到那裡', '找不到可以走的路。', 2500); return false; }
      // 站在外島（拍照定點）時離步道很遠：直接回到最近的步道點，不要在海上慢慢走
      if (off > 2) posOf().set(start.x, start.y, start.z);
      const pts = [here(), ...nodes.map((n) => ({ x: n.x, z: n.z, y: n.y }))];
      destMark.position.set(end.x, end.y + 0.02, end.z);
      destMark.visible = true;
      startWalk(pts, 'once', opts.after);
      if (opts.follow !== false && !S.follow) startFollow();
      return true;
    }

    const arrive = (b) => {
      destMark.visible = false;
      S.arrived = { building: b || null };
      S.idle = { since: performance.now() };
      if (b) {
        S.lastBuilding = b;
        showSay(`抵達：${b.name}`, b.facts[0] || (b.island && b.island.summary) || '');
      } else showSay('到了！', '');
      if (S.mission.type === 'wander') S.pause = { until: performance.now() + 5500, then: wanderNext };
      if (ui.isOpen() && S.tab !== 'look') ui.render();
    };

    // ── 手機：站方的側邊欄抽屜與政策卡都是底部圖層，一次只開一個
    const isMobile = () => innerWidth <= 800;
    const siteLayerOpen = () => document.body.classList.contains('card-open') || !!document.querySelector('#sidebar.mobile-open');
    const closeSiteLayers = () => {
      const card = document.querySelector('#card-close');
      if (document.body.classList.contains('card-open') && card) card.click();
      const side = document.querySelector('#sidebar.mobile-open #mobile-close');
      if (side) side.click();
    };
    // 選好行程後收合面板，讓出畫面看角色走路
    const autoMin = () => { if (isMobile() && ui.isOpen()) ui.setMin(true); };

    const isVis = (e) => !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 8;
    const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

    // 角色面板開啟時取代清單：桌面版藏起清單、面板佔用清單的欄位；清單原本是收起的，就先把欄位讓出來，關閉時再還原。
    // 面板開著時按「清單」：關掉角色面板、回到清單
    const appEl = document.querySelector('#app') || document.body;
    function ensureDock() {
      if (!ui.isOpen() || !ui.panel.parentElement || ui.panel.classList.contains('loose')) return;
      if (document.body.classList.contains('hm-docked')) return;
      // 清單原本是收起的：不把欄位讓回來（畫布會變窄、鏡頭看起來像突然縮放），面板直接疊在畫面右側；工具列由 CSS 移到面板左邊
      document.body.classList.add('hm-docked');
      remeasure();
    }
    function restoreSidebar(showList) {
      if (!document.body.classList.contains('hm-docked')) return;
      document.body.classList.remove('hm-docked');
      if (showList && !isMobile()) appEl.classList.remove('sidebar-hidden');
      remeasure();
    }
    const listBtn = document.querySelector('#sidebar-toggle');
    const onListBtn = (e) => {
      if (!ui.isOpen() || isMobile()) return; // 手機：站方打開清單抽屜，tick 會把角色面板收掉
      e.stopImmediatePropagation();
      e.preventDefault();
      ui.setOpen(false); cancelPlace(); cancelAim(); leaveFitting(); syncLimits();
      restoreSidebar(true);
    };
    if (listBtn) listBtn.addEventListener('click', onListBtn, true);
    undo.push(() => { if (listBtn) listBtn.removeEventListener('click', onListBtn, true); });

    // 角色（與頭上的名牌）可以待的區域，視窗座標：扣掉面板、政策卡、以及擋在角色上方的 LOGO 與時間軸。
    // 手機橫放時站方左上角的 LOGO＋時間軸會佔到 y 176，剛好蓋住角色的頭
    const TAG_ROOM = 28;
    function freeRegion() {
      const r = canvas.getBoundingClientRect();
      const reg = { top: Math.max(r.top, 0), bottom: Math.min(r.bottom, innerHeight), left: Math.max(r.left, 0), right: Math.min(r.right, innerWidth) };
      const panelOpen = ui.isOpen() && !ui.isMin();
      const card = !isMobile() && document.body.classList.contains('card-open') && document.querySelector('#card');
      if (panelOpen) {
        const pr = ui.panel.getBoundingClientRect();
        if (isMobile()) reg.bottom = Math.min(reg.bottom, pr.top);
        else reg.right = Math.min(reg.right, pr.left);
      }
      if (card && isVis(card)) reg.left = Math.max(reg.left, card.getBoundingClientRect().right);
      const cx = (reg.left + reg.right) / 2;
      for (const sel of ['.brand', '.hud']) {
        const e = document.querySelector(sel);
        if (!isVis(e)) continue;
        const b = e.getBoundingClientRect();
        if (b.left < cx + 70 && b.right > cx - 70) reg.top = Math.max(reg.top, b.bottom + 6);
      }
      return reg;
    }
    // 可用區域不夠高時，試衣鏡頭自動拉遠，讓角色（200px 等級）縮到放得進去；桌面大螢幕永遠是 1
    function autoCamScale() {
      const reg = freeRegion(), c = canvas.getBoundingClientRect();
      const H = Math.max(80, reg.bottom - (reg.top + TAG_ROOM));
      const px1 = 0.352 / (2 * FIT_OFFSET.length() * Math.tan(cap.camera.fov * Math.PI / 360)) * c.height; // 縮放 1 時，腳到頭頂的像素高
      return Math.max(1, px1 / (0.8 * H));
    }

    // 名牌與泡泡可以出現的區域（相對 canvas）：手機避開右側直排工具列與底部圖層，桌面避開左側政策卡與右側面板
    function freeBounds(r) {
      const fb = { L: 8, R: Math.min(r.width, innerWidth - r.left) - 8, T: isMobile() ? 100 : 124, B: Math.min(r.height, innerHeight - r.top) - 8 }; // 畫布可能比視窗大
      for (const sel of ['.brand', '.hud']) { // LOGO 與時間軸在窄螢幕會疊成兩列，名牌要在它們下面
        const e = document.querySelector(sel);
        if (isVis(e)) fb.T = Math.max(fb.T, e.getBoundingClientRect().bottom - r.top + 8);
      }
      const card = document.body.classList.contains('card-open') && document.querySelector('#card');
      if (isMobile()) {
        fb.R = Math.min(r.width, innerWidth - r.left) - 92;
        const tops = [];
        if (ui.isOpen()) tops.push(ui.panel.getBoundingClientRect().top);
        const sheet = document.querySelector('#sidebar.mobile-open');
        if (sheet) tops.push(sheet.getBoundingClientRect().top);
        if (card) tops.push(card.getBoundingClientRect().top);
        if (tops.length) fb.B = Math.min(...tops) - 4;
      } else {
        if (ui.isOpen()) fb.R = Math.min(fb.R, ui.panel.getBoundingClientRect().left - r.left - 8);
        if (card) fb.L = Math.max(fb.L, card.getBoundingClientRect().right - r.left + 8);
      }
      return fb;
    }

    // ── 各種行程
    function beginLoop(i) {
      const pts = routes[i].map((p) => ({ x: p.x, z: p.z, y: p.footY }));
      startWalk(pts, 'loop', null);
      S.arrived = null;
      destMark.visible = false;
    }
    function setRoute(i) {
      autoMin();
      const info = S.routeInfo[i], flow = info.flow;
      const names = info.islands.map((id) => (data && data.islandById.get(id) ? data.islandById.get(id).name : id));
      setMission({ type: 'route', routeIdx: i, flow, label: `沿 ${flow} 路線來回走：${names.join(' → ')}` });
      const p0 = routes[i][0];
      if (Math.hypot(p0.x - posOf().x, p0.z - posOf().z) < 0.2) beginLoop(i);
      else if (!goTo(p0.x, p0.z, { after: () => beginLoop(i) })) beginLoop(i);
    }
    function goBuilding(id) {
      const b = buildings.find((x) => x.id === id);
      if (!b) return;
      autoMin();
      setMission({ type: 'goto', targetId: id, label: `前往：${b.island.name} ·${b.name}` });
      S.ui.island = b.island.id;
      goTo(b.cx, b.cz, { after: () => arrive(b) });
    }
    function goIsland(id) {
      const is = data.islandById.get(id);
      autoMin();
      setMission({ type: 'goto', targetId: '__island', label: `前往：${is.name}` });
      goTo(is.cx, is.cz, { after: () => arrive(null) });
    }
    function wanderNext() {
      if (S.mission.type !== 'wander' || !buildings.length) return;
      let b;
      do { b = buildings[Math.floor(Math.random() * buildings.length)]; } while (buildings.length > 1 && S.lastBuilding && b.id === S.lastBuilding.id);
      S.mission.label = `自動逛逛中：前往 ${b.island.name} ·${b.name}`;
      S.mission.targetId = b.id;
      if (!goTo(b.cx, b.cz, { after: () => arrive(b) })) S.pause = { until: performance.now() + 1500, then: wanderNext };
      if (ui.isOpen() && S.tab !== 'look') ui.render();
    }
    function groundPoint(cx, cy, planeY = net.groundY) {
      const r = canvas.getBoundingClientRect();
      const ray = new T.Raycaster();
      ray.setFromCamera(new T.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), cap.camera);
      const p = new T.Vector3();
      return ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -planeY), p) ? p : null;
    }
    function pickGround(cx, cy) {
      const p = groundPoint(cx, cy);
      if (!p) return;
      setMission({ type: 'goto', label: '前往：你在地圖上指定的地方' });
      goTo(p.x, p.z, { after: () => arrive(null) });
    }

    // ── 追隨
    const startFollow = () => {
      if (!ensureControls()) { LOG('尚未取得 OrbitControls'); return; }
      if (hc.releaseCamera) hc.releaseCamera(); // 站方若正在飛行或追隨居民，先停掉，免得兩邊同時拉鏡頭
      S.follow = { anchor: null, sm: null, flyStart: performance.now(), from: { target: cap.controls.target.clone(), pos: cap.camera.position.clone() } };
      S.fig.ring.visible = subjectGroup() === S.fig.group;
    };
    const stopFollow = () => { S.follow = null; S.fig.ring.visible = false; applyPendingLimits(true); };
    // 試衣時放寬的鏡頭限制（最近距離、最低俯角），要等鏡頭飛離試衣近景後才還原；
    // 立刻還原的話，OrbitControls 會在同一幀把鏡頭硬拉到限制內，看起來像突然縮放
    // onlyIfInside：鏡頭已經在限制範圍內才還原（沒有在追隨時，等使用者自己拉遠後再還原），否則留到之後
    const applyPendingLimits = (onlyIfInside) => {
      const L = S.pendingLimits, c = cap.controls;
      if (!L || !c) return;
      if (onlyIfInside) {
        const off = cap.camera.position.clone().sub(c.target);
        const polar = Math.acos(Math.max(-1, Math.min(1, off.y / (off.length() || 1))));
        if (off.length() < L.minDistance - 1e-3 || polar > L.maxPolarAngle + 1e-3) return;
      }
      Object.assign(c, L);
      S.pendingLimits = null;
    };
    // 試衣與拍照要近一點、平視：站方限制了最近距離與最低俯角（約 3 單位、20°），這兩個分頁暫時放寬，離開時還原。
    // 原本的限制存在 baseLimits；還原時交給 pendingLimits，等鏡頭飛離（或使用者自己拉出）近景後才套回，免得突然縮放
    const relaxLimits = () => {
      const c = cap.controls;
      if (!c) return;
      if (!S.baseLimits) S.baseLimits = S.pendingLimits || { minDistance: c.minDistance, maxPolarAngle: c.maxPolarAngle };
      S.pendingLimits = null;
      c.minDistance = Math.min(c.minDistance, 1.6);
      c.maxPolarAngle = Math.max(c.maxPolarAngle, Math.PI / 2 - 0.05);
    };
    const syncLimits = () => {
      if (ui.isOpen() && (S.tab === 'look' || S.tab === 'photo')) relaxLimits();
      else if (S.baseLimits) { S.pendingLimits = S.baseLimits; S.baseLimits = null; }
    };

    // ── 試衣模式：面板開在「外觀」分頁時，把角色移到地圖上人最少、視野不被擋住的地方，停下來面向鏡頭。
    // 離開（切到「行程」或關閉面板）時回到原本的位置，繼續原本的路線或目的地。
    // 搜尋要發很多條射線（每條約 4 毫秒），改成 generator 分段執行：每幀只花約 6 毫秒，背景慢慢算，不會讓頁面卡住
    function* computeFitSpot() {
      let slice = performance.now();
      const pause = function* () { if (performance.now() - slice > 6) { yield; slice = performance.now(); } };
      // 實體網格（略過半透明的光暈與陰影）與所有可見網格（偵測地面用）
      const blockers = [], allMeshes = [];
      cap.scene.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        if (S.fig.group.getObjectById(o.id) || destMark.getObjectById(o.id)) return;
        allMeshes.push(o);
        if (!(o.material && (o.material.transparent || o.material.opacity < 1))) blockers.push(o);
      });
      const ray = new T.Raycaster();
      // 從試衣視角看過去，頭與身體之間不能有東西擋住
      const visible = (c, heights = [0.34, 0.12]) => heights.every((h) => {
        const to = new T.Vector3(c.x, c.y + h, c.z);
        const from = new T.Vector3(c.x, c.y, c.z).add(FIT_LIFT).add(FIT_OFFSET);
        const d = to.clone().sub(from), dist = d.length();
        ray.set(from, d.normalize());
        ray.far = dist - 0.06;
        return ray.intersectObjects(blockers, false).length === 0;
      });

      // A) 站方露出的兩個小島端點：走不到的圓形小島，周圍沒有任何路線，最不會有人經過。
      //    在端點附近細掃，找陸地（高度 0~0.6，比主島矮）上離邊緣最遠的平坦點
      const exposedEnds = () => {
        try { const r = hc.debug && hc.debug.routes; const v = typeof r === 'function' ? r() : r; return (v && v.ends) || []; } catch (e) { return []; } // 站方介面改了就略過
      };
      // 地點清單。兩座有特色的小島，頂面（草地、屋頂）有部分射線打不到，位置是用「在場景擺座標標記、對照畫面」量出來的：
      //  · 房屋島：一排五棟紅房子、旗子，站方露出的端點 B 就是它；用端點推算，佈局微調時才不會跑掉
      //  · 燈塔島：站方沒露出座標，驗證燈塔本體還在才使用
      const spots = [];
      const down = (x, z) => {
        if (typeof hc.groundAt === 'function') return hc.groundAt(x, z, 4, 9);
        ray.set(new T.Vector3(x, 4, z), new T.Vector3(0, -1, 0));
        ray.far = 9;
        const h = ray.intersectObjects(allMeshes, false)[0];
        return h ? h.point.y : null;
      };
      const endB = exposedEnds()[1];
      const hx = endB ? endB[0] + 0.05 : 9.45, hz = endB ? endB[1] + 0.6 : -9.0;
      const hy = down(hx, hz);
      if (hy !== null && hy >= 0.15 && hy <= 0.65) spots.push({ id: 'houses', name: '房屋小島', x: hx, y: hy, z: hz }); // 高度以站方 groundAt 為準（實測 0.15~0.20）
      const lhBase = down(12.3, 4.3); // 燈塔本體與草頂都打不到射線，但底座的岩石、沙洲圓盤打得到（水面是 -0.18）
      if (lhBase !== null && lhBase > -0.1) spots.push({ id: 'lighthouse', name: '燈塔小島', x: 11.85, y: 0.16, z: 4.25 }); // 正上方量過：島緣南端 z≈4.85，燈塔在 (11.8, 3.8)
      // 沙灘傘島的頂面同樣打不到射線，位置是用座標標記對照畫面量出來的；驗證附近有任何不是水面的東西（傘、毛巾、岩石）才使用
      // （風車小島試過：風力發電機太高，近看只剩兩根白柱，拉遠又太小，效果不好，已捨棄）
      const landNear = (x, z, r) => {
        for (let dx = -r; dx <= r; dx += 0.5) for (let dz = -r; dz <= r; dz += 0.5) { const y = down(x + dx, z + dz); if (y !== null && y > -0.1) return true; }
        return false;
      };
      if (landNear(9.4, 10.7, 0.8)) spots.push({ id: 'beach', name: '沙灘傘小島', x: 9.4, y: 0.08, z: 10.85 });                 // 兩把傘與彩色毛巾；沙洲很小（約 x 8.7~10.0、z 9.95~11.3）。用正上方視角量過：先前用低角度量成 z 11.6，其實在沙洲南緣外的海上
      if (landNear(-6.6, -10.7, 0.8)) spots.push({ id: 'cottages', name: '雙屋小島', x: -6.6, y: 0.08, z: -10.45, camScale: 1.25 }); // 正上方量過：草地 z -10.5~-10.0，島緣南端 z≈-9.8；兩間小屋之間 x≈-6.6 // 兩間小屋（青綠與橘色屋頂）、中間一塊草地、東側木棧橋
      // 洋流號（卡車小島）：圓形平台，中間一輛橘色小卡車、北側紅色看板。站在卡車南側空地（正上方量過：平台中心 (-11.2,-1.7)、半徑約 1.5，卡車南緣 z≈-1.3），平台面 0.34
      if (landNear(-11.2, -1.2, 0.8)) spots.push({ id: 'truck', name: '洋流號', x: -11.2, y: 0.34, z: -0.95 });
      // 拍照時的可站範圍：以站位為原點的長方形 [x 最小, x 最大, z 最小, z 最大]（正上方畫圈量過，避開房子、卡車、樹與島緣）。
      // 在範圍內點哪就站哪，微調也限制在範圍內。一座島可以有好幾塊；第五個數字是這一塊的站立高度（站在車上這類高處才需要，沒寫就用地面）。
      // 洋流號：車前地面一長條（車頭那側到島緣前為止）＋後面咖啡色車斗（欄杆內；橘色車廂與引擎蓋不能站）
      const RECTS = {
        houses: [[-0.6, 0.6, -0.5, 0.05]], lighthouse: [[-0.55, 0.15, -0.45, 0.15]], beach: [[-0.45, 0.45, -0.15, 0.12]], cottages: [[-0.4, 0.35, -0.12, 0.15]],
        truck: [[-0.4, 0.8, -0.15, 0.17], [-0.36, -0.07, -0.75, -0.35, 0.89]],
      };
      for (const sp of spots) {
        const rs = RECTS[sp.id];
        if (rs) { sp.rects = rs.map((r) => ({ x0: sp.x + r[0], x1: sp.x + r[1], z0: sp.z + r[2], z1: sp.z + r[3], y: r[4] === undefined ? sp.y : r[4] })); }
      }
      if (spots.length) return spots;

      // B) 找不到小島：退回大島上離路線最遠的空地
      // 1) 候選點：每個步道點旁 1.6／2.4／3.2 單位處的 8 個方向；只留下「離所有路線點都 ≥ 1.3 單位」的空地
      //    （路網本身就是由路線合併而成，每個步道點都有路線經過，所以必須離開步道才不會有人走過；
      //     步道幾乎鋪滿整座島，要求 ≥ 2 單位時一個合格的點都找不到）
      const cell = 1.0, grid = new Map(), co = (v) => Math.floor(v / cell);
      for (const r of routes) for (const p of r) {
        const k = co(p.x) + ',' + co(p.z);
        (grid.get(k) || grid.set(k, []).get(k)).push(p);
      }
      const CAP = 3;
      const clearance = (x, z) => {
        let best = CAP;
        const cx = co(x), cz = co(z);
        for (let i = -CAP; i <= CAP; i++) for (let j = -CAP; j <= CAP; j++) {
          const arr = grid.get((cx + i) + ',' + (cz + j));
          if (arr) for (const p of arr) { const d = Math.hypot(p.x - x, p.z - z); if (d < best) best = d; }
        }
        return best;
      };
      const seen = new Set(), cands = [];
      for (const n of net.main) {
        yield* pause();
        for (const rad of [1.6, 2.4, 3.2]) for (let a = 0; a < 8; a++) {
          const x = n.x + Math.cos(a * Math.PI / 4) * rad, z = n.z + Math.sin(a * Math.PI / 4) * rad;
          const key = Math.round(x / 0.6) + ',' + Math.round(z / 0.6);
          if (seen.has(key)) continue;
          seen.add(key);
          const c = clearance(x, z);
          if (c >= 1.3) cands.push({ x, y: n.y, z, c });
        }
      }
      cands.sort((a, b) => b.c - a.c);
      // 2) 腳下要是和步道同高的地面（不是屋頂、樹頂、石頭，也不是水面）
      const onGround = (c) => {
        ray.set(new T.Vector3(c.x, c.y + 2.5, c.z), new T.Vector3(0, -1, 0));
        ray.far = 6;
        const hit = ray.intersectObjects(blockers, false)[0];
        return !!hit && Math.abs(hit.point.y - c.y) < 0.05;
      };
      let tried = 0;
      for (const c of cands) {
        yield* pause();
        if (++tried > 400) break;
        if (onGround(c) && visible(c)) return [{ id: 'open', name: '大島空地', x: c.x, y: c.y, z: c.z }];
      }
      // 找不到「地面＋視線」都合格的空地：退而求其次，只要求腳下有地面，再不行就用最低人流的步道點
      const grounded = cands.find(onGround); // 備援，數量有限，不分段
      if (grounded) return [{ id: 'open', name: '大島空地', x: grounded.x, y: grounded.y, z: grounded.z }];
      const n0 = net.main[0];
      return n0 ? [{ id: 'node', name: '步道', x: n0.x, y: n0.y, z: n0.z }] : [];
    }
    const fitOffsetFor = (spot) => {
      const k = Math.max(spot.camScale || 1, autoCamScale()) * (S.pair ? 1.3 : 1); // 合照時拉遠，兩個人才都入鏡
      return k > 1.02 ? FIT_OFFSET.clone().multiplyScalar(k) : FIT_OFFSET;
    };
    // 試衣中「與 Puma 合照」：我和複製的 Puma 在地點上左右並排、一起面向試衣鏡頭。預設我在左、Puma 在右，可左右換邊
    const PAIR_D = 0.15; // 兩人各偏離地點中心 0.15（肩並肩靠近一點）
    function restorePumaFromFit() {
      const sv = S.fitPumaSaved;
      S.fitPumaSaved = null;
      if (!sv || !S.puma) return;
      S.puma.fig.group.visible = sv.vis;
      S.puma.fig.group.position.copy(sv.pos);
      S.puma.fig.group.rotation.y = sv.rotY;
      S.puma.stand = sv.stand;
    }
    // 試衣點的實際地面高度：小島的草頂是 InstancedMesh，要用各自的 raycast 才打得到；腳下取一圈取樣的最高點，不浮空
    function surfaceY(x, z, fallback) {
      if (typeof hc.groundAt === 'function') { // 官網版：站方提供的地面高度（略過行人、協作線、半透明特效）
        const y = hc.groundAt(x, z, fallback + 0.25, 1.2);
        if (y !== null && y > -0.1) return y;
      }
      const skip = [S.fig.group, S.puma && S.puma.fig.group].filter(Boolean);
      const meshes = [];
      cap.scene.traverse((o) => {
        if (!o.isMesh || o.isSkinnedMesh) return;
        for (let p = o; p; p = p.parent) if (!p.visible || skip.includes(p)) return;
        meshes.push(o);
      });
      const ray = new T.Raycaster(), dir = new T.Vector3(0, -1, 0);
      let best = null;
      for (const [dx, dz] of [[0, 0], [0.08, 0], [-0.08, 0], [0, 0.08], [0, -0.08]]) {
        ray.set(new T.Vector3(x + dx, fallback + 0.2, z + dz), dir); // 起點壓低，免得打到樹冠
        ray.far = 1;
        const hits = [];
        for (const m of meshes) m.raycast(ray, hits);
        for (const h of hits) if (h.point.y > -0.1 && (best === null || h.point.y > best)) best = h.point.y;
      }
      return best === null ? fallback : best;
    }
    function applyPair() {
      const spot = S.fitSpots && (S.fitSpots[S.fitIdx] || S.fitSpots[0]);
      if (!S.fitting || !spot) return;
      const yaw = Math.atan2(FIT_OFFSET.x, FIT_OFFSET.z);
      const me = S.fig.group;
      if (S.pair) {
        const pu = ensurePuma();
        if (!S.fitPumaSaved) S.fitPumaSaved = { vis: pu.fig.group.visible, pos: pu.fig.group.position.clone(), rotY: pu.fig.group.rotation.y, stand: pu.stand };
        const sgn = S.pairSwap ? -1 : 1;
        const mx = spot.x - sgn * PAIR_D, px = spot.x + sgn * PAIR_D;
        me.position.set(mx, surfaceY(mx, spot.z, spot.y), spot.z);
        pu.fig.group.position.set(px, surfaceY(px, spot.z, spot.y), spot.z);
        pu.fig.group.visible = true;
        pu.fig.group.rotation.y = yaw;
        pu.stand = null;
      } else {
        me.position.set(spot.x, surfaceY(spot.x, spot.z, spot.y), spot.z);
        restorePumaFromFit();
      }
      me.rotation.y = yaw;
      followOffset = fitOffsetFor(spot);
      refly();
    }
    const refly = () => { S.follow = null; startFollow(); };
    function enterFitting() {
      if (S.fitting) return;
      if (!S.fitSpots) { // 背景還沒算完：接著同一個搜尋一次跑完
        const it = S.fitGen || computeFitSpot();
        S.fitGen = null;
        let r;
        while (!(r = it.next()).done);
        S.fitSpots = r.value;
      }
      const spot = S.fitSpots[S.fitIdx] || S.fitSpots[0];
      if (!spot) return;
      S.fitting = true;
      S.fitSaved = { walk: S.walk, idle: S.idle, pos: posOf().clone(), rotY: S.fig.group.rotation.y, mark: destMark.visible };
      S.walk = null;
      S.idle = null;
      S.say = null;
      destMark.visible = false;
      posOf().set(spot.x, surfaceY(spot.x, spot.z, spot.y), spot.z);
      S.fig.group.rotation.y = Math.atan2(FIT_OFFSET.x, FIT_OFFSET.z); // 面向試衣視角的鏡頭
      followOffset = fitOffsetFor(spot);
      followLift = FIT_LIFT;
      // 站方限制了最近距離與最低俯角（約 3 單位、20°），試衣要近一點、平視，暫時放寬，離開時還原
      relaxLimits();
      refly();
      if (S.pair) applyPair();
    }
    function leaveFitting() {
      if (!S.fitting) return;
      const sv = S.fitSaved;
      restorePumaFromFit();
      S.fitting = false;
      S.fitSaved = null;
      followOffset = FOLLOW_OFFSET;
      followLift = new T.Vector3();
      S.walk = sv.walk;
      S.idle = sv.idle;
      destMark.visible = sv.mark;
      if (!sv.walk) { posOf().copy(sv.pos); S.fig.group.rotation.y = sv.rotY; } // 原本是停著的：放回原處（行走中的由 tick 依路徑擺位）
      refly(); // 一律平順飛回一般追隨視角，落地後才還原鏡頭限制
    }
    // 試衣中直接切到「拍照」分頁：不回主島，我和複製的 Puma 就站在現在的位置（左右並排、面向鏡頭），之後再用拍照功能調整
    function keepFitHere() {
      const spot = S.fitSpots && (S.fitSpots[S.fitIdx] || S.fitSpots[0]);
      if (!S.fitting || !spot) return;
      const yaw = Math.atan2(FIT_OFFSET.x, FIT_OFFSET.z), sgn = S.pairSwap ? -1 : 1;
      const mx = spot.x - sgn * PAIR_D, px = spot.x + sgn * PAIR_D;
      const my = surfaceY(mx, spot.z, spot.y), py = surfaceY(px, spot.z, spot.y);
      const pu = ensurePuma();
      restorePumaFromFit();
      S.fitting = false;
      S.fitSaved = null;
      followOffset = FOLLOW_OFFSET;
      followLift = new T.Vector3();
      S.walk = null; S.idle = null; S.say = null;
      destMark.visible = false;
      setMission({ type: 'stand', label: `定點站立：${spot.name}（選別的行程就會離開）` }); // 會清掉舊的 S.stand，所以站位在它之後設
      S.fig.group.position.set(mx, my, spot.z);
      S.fig.group.rotation.y = yaw;
      S.stand = { x: mx, y: my, z: spot.z, yaw };
      pu.fig.group.visible = true;
      pu.fig.group.position.set(px, py, spot.z);
      pu.fig.group.rotation.y = yaw;
      pu.stand = { x: px, y: py, z: spot.z, yaw };
      refly();
    }
    const stepFollow = (now) => {
      const c = cap.controls, p = subjectPos().clone().add(followLift), f = S.follow;
      // 站方或使用者把鏡頭帶走了（點政策卡、全景、選居民、右鍵平移）：交還鏡頭，不再硬拉回來
      if (f.tgt && c.target.distanceToSquared(f.tgt) > 0.0025) { stopFollow(); return; }
      const dt = Math.min(0.1, Math.max(0, (now - (f.lastT || now)) / 1000));
      f.lastT = now;
      if (!f.fly) {
        // 飛行參數在起飛時算一次：距離遠就飛久一點。
        // 只有起點與終點都低（近景到近景，例如換試衣地點）、直線會穿過建築時才往上拱；從高處飛下來不另外拱，免得先拉遠再拉近
        const dist = Math.hypot(p.x - f.from.target.x, p.z - f.from.target.z);
        const endY = p.y + followOffset.y, midY = (f.from.pos.y + endY) / 2;
        const clear = Math.max(f.from.target.y, p.y) + Math.min(14, 1.2 + dist * 0.5);
        f.fly = { dur: 900 + Math.min(700, dist * 45), lift: dist > 1.5 ? Math.max(0, clear - midY) : 0 };
      }
      const t = Math.min(1, (now - f.flyStart) / f.fly.dur);
      if (t < 1) {
        const e = t * t * (3 - 2 * t), arc = Math.sin(Math.PI * e) * f.fly.lift;
        c.target.lerpVectors(f.from.target, p, e);
        c.target.y += arc * 0.35;
        cap.camera.position.lerpVectors(f.from.pos, p.clone().add(followOffset), e);
        cap.camera.position.y += arc;
        f.anchor = p.clone();
        f.sm = p.clone();
        f.tgt = c.target.clone();
        return;
      }
      if (!f.landed) { // 飛行結束的第一幀：準確落在終點（掉幀時最後一幀可能還沒到、拱起的高度也還沒歸零）
        f.landed = true;
        c.target.copy(p);
        cap.camera.position.copy(p).add(followOffset);
        f.anchor = p.clone();
        f.sm = p.clone();
        f.bias = null;
        applyPendingLimits();
      }
      // 追隨：鏡頭跟著一個平滑過的瞄準點走。水平方向緊跟；高度變化（橋、階梯、路線節點的高低差）慢慢跟，
      // 鏡頭就不會隨著腳底高度一跳一跳，看起來像在縮放晃動
      if (!f.sm) f.sm = p.clone();
      const kx = 1 - Math.exp(-dt * 12), ky = 1 - Math.exp(-dt * 3);
      f.sm.x += (p.x - f.sm.x) * kx;
      f.sm.z += (p.z - f.sm.z) * kx;
      f.sm.y += (p.y - f.sm.y) * ky;
      const delta = f.sm.clone().sub(f.anchor || f.sm);
      c.target.add(delta);
      cap.camera.position.add(delta);
      f.anchor = f.sm.clone();
      cap.camera.updateMatrixWorld(); // 平移後先更新矩陣，避讓面板的投影才不會用到上一幀的鏡頭（會來回微調而抖動）
      adjustBias(now);
      f.tgt = c.target.clone();
    };

    // 面板展開時，可見區域會被面板切走一塊（手機是下半部、桌面與橫放是右側）。
    // 把鏡頭平移（沿鏡頭的上方與右方），讓角色落在可見區域中央。
    // 鏡頭與 target 一起平移，每個軸用牛頓法逐幀逼近；面板收合或關閉時再平順歸零。
    function adjustBias(now) {
      const c = cap.controls, f = S.follow;
      if (!f.bias) f.bias = new T.Vector3();
      // 沿「鏡頭自己的右方與上方」平移（等同拖曳平移畫面）：角色大小不變，只在畫面上移動。
      // 不能沿地面方向推：俯角很低時那樣只會讓角色往後退變小，幾乎不會上移
      const camRight = new T.Vector3(), camUp = new T.Vector3(), camFwd = new T.Vector3();
      cap.camera.matrixWorld.extractBasis(camRight, camUp, camFwd);
      const r = canvas.getBoundingClientRect();
      // 站方在手機橫放時畫布比視窗高（例如畫布 660、視窗 440），所以「可見區域」要取畫布與視窗的交集，不能用畫布中心（見 freeRegion）
      const cropped = r.bottom > innerHeight + 2 || r.right > innerWidth + 2 || r.top < -2 || r.left < -2;
      const panelOpen = ui.isOpen() && !ui.isMin();
      const want = panelOpen || cropped;
      let shift = new T.Vector3();
      if (want) {
        // 可用區域的中心點（相對 canvas）；名牌要放在角色頭上，所以頂端多留一條名牌的高度
        if (!f.reg || now - f.regAt > 250) { f.reg = freeRegion(); f.regAt = now; } // 版面量測每 250ms 一次就夠
        const reg = f.reg;
        const goalX = (reg.left + reg.right) / 2 - r.left, goalY = (reg.top + TAG_ROOM + reg.bottom) / 2 - r.top;
        const at = (axis, off) => {
          const v = subjectPos().clone();
          v.addScaledVector(axis, -off);
          v.y += 0.2 * subjectGroup().scale.y;
          v.project(cap.camera);
          return { x: (v.x + 1) / 2 * r.width, y: (1 - v.y) / 2 * r.height };
        };
        const step = (axis, key, goal) => {
          const p0 = at(axis, 0)[key], sens = (at(axis, 0.05)[key] - p0) / 0.05;
          if (Math.abs(sens) < 1e-3) return 0;
          return Math.max(-0.3, Math.min(0.3, ((goal - p0) / sens) * 0.2));
        };
        shift.addScaledVector(camUp, step(camUp, 'y', goalY));
        shift.addScaledVector(camRight, step(camRight, 'x', goalX));
      } else if (f.bias.lengthSq() > 1e-8) {
        shift = f.bias.clone().multiplyScalar(-0.15);
      }
      if (shift.lengthSq() > 0) {
        c.target.add(shift);
        cap.camera.position.add(shift);
        f.bias.add(shift);
      }
    }

    // ── 定點站立（拍照用）：把「我的角色」或「Puma（複製）」放到指定位置、指定面向。
    // 流程：點場景選位置 → 調整面向（羅盤、按鈕）與微調位置 → 站在這裡。站定的角色站著不動，直到選別的行程；Puma 是複製的，站方真正的 Puma 照常走他的路。
    const ensurePuma = () => {
      if (!S.puma) {
        const fig = buildFigure(PUMA_LOOK);
        fig.group.visible = false;
        fig.pin.visible = false; // 拍照用，不要頭頂標記
        applyFigScale(fig);
        cap.scene.add(fig.group);
        S.puma = { fig, stand: null };
      }
      return S.puma;
    };
    const boundsDone = new WeakSet();
    const standMeshes = () => {
      const list = [];
      cap.scene.traverse((o) => {
        if (!o.isMesh || !o.visible || (o.material && (o.material.transparent || o.material.opacity < 1))) return;
        // InstancedMesh 的包圍球若在擺放實例之前算好，射線會整批略過（島頂、廣場點不到）；第一次用到時重算
        if (o.isInstancedMesh && !boundsDone.has(o)) { o.computeBoundingSphere(); boundsDone.add(o); }
        if (S.fig.group.getObjectById(o.id) || destMark.getObjectById(o.id) || aimArrow.getObjectById(o.id)) return;
        if (S.puma && S.puma.fig.group.getObjectById(o.id)) return;
        list.push(o);
      });
      return list;
    };
    // 站得住的地面：從 fromY 往下找第一個實體，高度要落在步道網的高度範圍附近（不是屋頂、水面或高處）
    const groundAt = (meshes, x, z, fromY) => {
      let y;
      if (typeof hc.groundAt === 'function') {
        y = hc.groundAt(x, z, fromY, 3);
        if (y === null) return null;
      } else {
        const ray = new T.Raycaster();
        ray.set(new T.Vector3(x, fromY, z), new T.Vector3(0, -1, 0));
        ray.far = 3;
        const hit = ray.intersectObjects(meshes, false)[0];
        if (!hit) return null;
        y = hit.point.y;
      }
      return y >= net.yMin - 0.25 && y <= net.yMax + 0.45 ? y : null;
    };
    // 鏡頭的地面方向：f = 畫面「遠方」、r = 畫面「右方」（羅盤與微調都以目前鏡頭為準）
    const camGround = () => {
      const rg = new T.Vector3(), up = new T.Vector3(), bk = new T.Vector3();
      cap.camera.matrixWorld.extractBasis(rg, up, bk);
      return { f: new T.Vector2(-bk.x, -bk.z).normalize(), r: new T.Vector2(rg.x, rg.z).normalize() };
    };
    const aimGroup = () => (S.aim.actor === 'puma' ? S.puma.fig.group : S.fig.group);
    const aimTheta = () => { // 目前面向在羅盤上的角度（0 = 畫面遠方，順時針為正）
      const { f, r } = camGround();
      const vx = Math.sin(S.aim.yaw), vz = Math.cos(S.aim.yaw);
      return Math.atan2(vx * r.x + vz * r.y, vx * f.x + vz * f.y);
    };

    // 點場景的位置 → 站位：先看是不是已知的小島站位（草頂射線打不到，高度是量好的），否則用射線找任意位置的地面
    function resolveSpot(cx, cy) {
      for (const sp of S.fitSpots || []) {
        if (sp.id === 'open' || sp.id === 'node') continue;
        const p = groundPoint(cx, cy, sp.y);
        if (!p) continue;
        if (sp.rects) { // 離任一塊長方形 1 單位內都算點到這座島：各塊用自己的站立高度投影，挑最近的一塊，落點夾進範圍內
          let best = null;
          for (const rc of sp.rects) {
            const q = groundPoint(cx, cy, rc.y);
            if (!q) continue;
            const x = Math.max(rc.x0, Math.min(rc.x1, q.x)), z = Math.max(rc.z0, Math.min(rc.z1, q.z));
            const d = Math.hypot(q.x - x, q.z - z);
            if (d < 1.0 && (!best || d < best.d - 1e-6 || (Math.abs(d - best.d) <= 1e-6 && rc.y > best.rc.y))) best = { rc, x, z, d };
          }
          if (best) return { x: best.x, y: surfaceY(best.x, best.z, best.rc.y), z: best.z, name: sp.name, rect: best.rc, rects: sp.rects };
        } else if (Math.hypot(p.x - sp.x, p.z - sp.z) < 1.4) return { x: sp.x, y: surfaceY(sp.x, sp.z, sp.y), z: sp.z, name: sp.name };
      }
      const meshes = standMeshes();
      const r = canvas.getBoundingClientRect();
      const ray = new T.Raycaster();
      ray.setFromCamera(new T.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), cap.camera);
      const hit = ray.intersectObjects(meshes, false)[0];
      if (hit) { // 點到牆就站在牆前（往鏡頭退一點，避免卡進牆裡）
        const back = cap.camera.position.clone().sub(hit.point).setY(0).normalize().multiplyScalar(0.14);
        const x = hit.point.x + back.x, z = hit.point.z + back.z;
        const y = groundAt(meshes, x, z, hit.point.y + 0.3);
        if (y !== null) return { x, y, z, name: '指定位置' };
      }
      // 點到屋頂、樹冠這類高處：把視線投影到地面高度，站在它底下
      const p = groundPoint(cx, cy, net.groundY);
      if (p) {
        const y = groundAt(meshes, p.x, p.z, net.yMax + 1.2);
        if (y !== null) return { x: p.x, y, z: p.z, name: '指定位置' };
      }
      return null;
    }

    function startPlace(actor) {
      cancelAim();
      S.actor = actor;
      S.placing = true;
      S.pickMode = false;
      canvas.style.cursor = 'crosshair';
      autoMin();
      ui.render();
    }
    function cancelPlace() {
      if (!S.placing) return;
      S.placing = false;
      canvas.style.cursor = '';
      ui.render();
    }
    // 拍照時兩人的最小間距（貼得很近但不重疊）
    const MIN_GAP = 0.15;
    const otherPose = (actor) => (actor === 'puma' ? S.stand : (S.puma && S.puma.fig.group.visible ? S.puma.stand : null));
    // 這個點能不能站：小島看長方形範圍，其他地方看有沒有和原本差不多高的地面
    function standableAt(x, z, spot, meshes) {
      if (spot.rects) {
        for (const rc of spot.rects) if (x >= rc.x0 - 1e-6 && x <= rc.x1 + 1e-6 && z >= rc.z0 - 1e-6 && z <= rc.z1 + 1e-6) return { y: surfaceY(x, z, rc.y), rect: rc };
        return null;
      }
      const y = groundAt(meshes, x, z, spot.y + 0.6);
      return y !== null && Math.abs(y - spot.y) <= 0.35 ? { y } : null;
    }
    // 以想站的位置為中心，一圈一圈往外找最近的、離另一位至少 MIN_GAP 的可站點
    function findApart(spot, other, meshes) {
      for (let rad = 0.05; rad <= 1.0; rad += 0.05) {
        let best = null;
        for (let k = 0; k < 24; k++) {
          const ang = (k / 24) * Math.PI * 2, x = spot.x + Math.cos(ang) * rad, z = spot.z + Math.sin(ang) * rad;
          if (Math.hypot(other.x - x, other.z - z) < MIN_GAP - 1e-6) continue;
          const ok = standableAt(x, z, spot, meshes);
          if (!ok) continue;
          const d = Math.hypot(other.x - x, other.z - z); // 同一圈裡挑離另一位最遠的，站得更鬆
          if (!best || d > best.d) best = { x, z, y: ok.y, ...(ok.rect ? { rect: ok.rect } : {}), d };
        }
        if (best) { delete best.d; return best; }
      }
      return null;
    }
    function enterAim(spot) {
      const actor = S.actor;
      if (S.fitting) leaveFitting();
      S.placing = false;
      canvas.style.cursor = '';
      const yaw = Math.atan2(cap.camera.position.x - spot.x, cap.camera.position.z - spot.z); // 先面向鏡頭
      const meshes = standMeshes();
      // 另一位（我／Puma 分身）已經站在附近（間距不足 MIN_GAP）：在附近找一個站得住、又夠遠的點，不要疊在一起
      const other = otherPose(actor);
      if (other && Math.hypot(other.x - spot.x, other.z - spot.z) < MIN_GAP) {
        const alt = findApart(spot, other, meshes);
        if (alt) spot = { ...spot, ...alt };
        else showSay('這裡太擠', '附近放不下兩個人，請換個位置。', 2500);
      }
      if (actor === 'puma') {
        const pu = ensurePuma(), g = pu.fig.group;
        S.aim = { actor, x: spot.x, y: spot.y, z: spot.z, name: spot.name, yaw, meshes, rect: spot.rect,
          saved: { vis: g.visible, pos: g.position.clone(), rotY: g.rotation.y, stand: pu.stand } };
        g.visible = true;
        g.position.set(spot.x, spot.y, spot.z);
        g.rotation.y = yaw;
      } else {
        const g = S.fig.group;
        S.aim = { actor, x: spot.x, y: spot.y, z: spot.z, name: spot.name, yaw, meshes, rect: spot.rect,
          saved: { walk: S.walk, idle: S.idle, stand: S.stand, pos: g.position.clone(), rotY: g.rotation.y, mark: destMark.visible } };
        S.walk = null; S.idle = null; S.say = null;
        destMark.visible = false;
        g.position.set(spot.x, spot.y, spot.z);
        g.rotation.y = yaw;
      }
      aimArrow.visible = true;
      followOffset = FOLLOW_OFFSET;
      followLift = new T.Vector3();
      if (isMobile() && ui.isMin()) ui.setMin(false);
      if (S.follow) refly(); else startFollow();
      ui.render();
    }
    function cancelAim() {
      if (!S.aim) return;
      const a = S.aim, sv = a.saved;
      S.aim = null;
      aimArrow.visible = false;
      if (a.actor === 'puma') {
        const pu = S.puma;
        pu.fig.group.visible = sv.vis;
        pu.fig.group.position.copy(sv.pos);
        pu.fig.group.rotation.y = sv.rotY;
        pu.stand = sv.stand;
      } else {
        S.walk = sv.walk; S.idle = sv.idle; S.stand = sv.stand;
        destMark.visible = sv.mark;
        if (!sv.walk) { posOf().copy(sv.pos); S.fig.group.rotation.y = sv.rotY; }
      }
      if (S.follow) refly();
      ui.render();
    }
    function commitAim() {
      if (!S.aim) return;
      const a = S.aim;
      S.aim = null;
      aimArrow.visible = false;
      const pose = { x: a.x, y: a.y, z: a.z, yaw: a.yaw };
      if (a.actor === 'puma') {
        S.puma.stand = pose;
        stopFollow(); // 拍照要固定的畫面：鏡頭停在這裡，不要飛回我們的角色
        showSay('Puma 已就位', a.name, 2500);
      } else {
        setMission({ type: 'stand', label: `定點站立：${a.name}（選別的行程就會離開）` });
        S.stand = pose; S.walk = null; S.idle = null;
        destMark.visible = false;
      }
      ui.render();
    }
    function removePuma() {
      if (!S.puma) return;
      S.puma.fig.group.visible = false;
      S.puma.stand = null;
      ui.render();
    }
    const aimSet = (yaw) => { S.aim.yaw = yaw; };
    function aimNudge(dx, dz) { // 以鏡頭為準的前後左右微調，每次 0.15；牆、島邊、高處會擋住
      if (!S.aim) return;
      const a = S.aim, { f, r } = camGround();
      let nx = a.x + (r.x * dx + f.x * dz) * 0.15, nz = a.z + (r.y * dx + f.y * dz) * 0.15;
      const o = otherPose(a.actor); // 不能越靠越近到小於最小間距（已經太近時，往遠離的方向還是可以走）
      const tooClose = (x, z) => !!o && Math.hypot(o.x - x, o.z - z) < MIN_GAP && Math.hypot(o.x - x, o.z - z) < Math.hypot(o.x - a.x, o.z - a.z);
      if (a.rect) { // 小島：限制在可站的長方形內，高度直接量表面
        const rc = a.rect;
        nx = Math.max(rc.x0, Math.min(rc.x1, nx)); nz = Math.max(rc.z0, Math.min(rc.z1, nz));
        if (Math.hypot(nx - a.x, nz - a.z) < 0.01) { showSay('到邊界了', '這座島只能在範圍內調整站位。', 1200); return; }
        if (tooClose(nx, nz)) { showSay('離另一位太近了', '兩個人要隔開一點。', 1200); return; }
        a.x = nx; a.z = nz; a.y = surfaceY(nx, nz, a.y);
        aimGroup().position.set(nx, a.y, nz);
        return;
      }
      const y = groundAt(a.meshes, nx, nz, a.y + 0.6);
      if (y === null || Math.abs(y - a.y) > 0.35) { showSay('走不到那裡', '前面是牆、島邊，或太高。', 1200); return; }
      if (tooClose(nx, nz)) { showSay('離另一位太近了', '兩個人要隔開一點。', 1200); return; }
      a.x = nx; a.y = y; a.z = nz;
      aimGroup().position.set(nx, y, nz);
    }
    function aimFace(kind) {
      if (!S.aim) return;
      const a = S.aim;
      if (kind === 'camera' || kind === 'back') {
        a.yaw = Math.atan2(cap.camera.position.x - a.x, cap.camera.position.z - a.z) + (kind === 'back' ? Math.PI : 0);
      } else if (kind === 'building' && buildings.length) {
        let best = null, bd = Infinity;
        for (const b of buildings) { const d = Math.hypot(b.cx - a.x, b.cz - a.z); if (d < bd) { bd = d; best = b; } }
        a.yaw = Math.atan2(best.cx - a.x, best.cz - a.z);
        showSay(`面向：${best.name}`, '', 1500);
      }
    }
    function aimToward(cx, cy) { // 點場景上的任一處：角色轉過去面對那裡
      const a = S.aim;
      const p = a && groundPoint(cx, cy, a.y);
      if (p && Math.hypot(p.x - a.x, p.z - a.z) > 0.05) aimSet(Math.atan2(p.x - a.x, p.z - a.z));
    }
    function placeAt(cx, cy) {
      const sp = resolveSpot(cx, cy);
      if (!sp) { showSay('這裡不能站', '請點地面：步道旁、建築前、教室黑板前都可以。', 3000); return; }
      enterAim(sp);
    }

    // ── 面板與 API
    const api = {
      update(patch, rerender = true) {
        Object.assign(S.look, patch);
        saveLook(S.look);
        rebuild();
        if (rerender) ui.render();
      },
      setRole(role) { api.update({ role, ...rolePreset(role) }); },
      randomize() {
        const pick = (a) => a[Math.floor(Math.random() * a.length)];
        api.update({
          skin: pick(PALETTE.skin), hair: pick(PALETTE.hair), shirt: pick(PALETTE.shirt), pants: pick(PALETTE.pants),
          hatColor: pick(PALETTE.hatColor), hairStyle: pick(HAIR_STYLES)[0], eyes: pick(EYES)[0], mouth: pick(MOUTHS)[0],
        });
      },
      reset() { api.update({ ...DEFAULT_LOOK }); },
      setTab(tab) {
        S.tab = tab;
        if (tab !== 'photo') { cancelPlace(); cancelAim(); }
        if (ui.isOpen()) {
          if (tab === 'photo' && S.fitting) keepFitHere();
          else (tab === 'look' ? enterFitting : leaveFitting)();
        }
        syncLimits();
        ui.render();
      },
      // 換一個試衣地點（只在試衣中）：瞬間移過去，鏡頭跟著飛過去
      nextSpot() {
        if (!S.fitting || !S.fitSpots || S.fitSpots.length < 2) return;
        S.fitIdx = (S.fitIdx + 1) % S.fitSpots.length;
        const sp = S.fitSpots[S.fitIdx];
        posOf().set(sp.x, surfaceY(sp.x, sp.z, sp.y), sp.z);
        followOffset = fitOffsetFor(sp);
        refly();
        if (S.pair) applyPair();
        ui.render();
      },
      // 預覽方向：面向目前的鏡頭，或背對鏡頭（看背包、書包、馬尾）
      facing(back) {
        const g = S.fig.group;
        g.rotation.y = Math.atan2(cap.camera.position.x - g.position.x, cap.camera.position.z - g.position.z) + (back ? Math.PI : 0);
      },
      pickIsland(id) { S.ui.island = id; ui.render(); },
      setRoute, goBuilding, goIsland,
      // 定點站立（拍照）
      startPlace, cancelPlace, cancelAim, commitAim, removePuma, aimFace, aimNudge,
      aimDial(theta) { // 羅盤：theta 0 = 畫面遠方，順時針為正；依目前鏡頭換成世界朝向
        if (!S.aim) return;
        const { f, r } = camGround();
        aimSet(Math.atan2(f.x * Math.cos(theta) + r.x * Math.sin(theta), f.y * Math.cos(theta) + r.y * Math.sin(theta)));
      },
      aimTurn(deg) { if (S.aim) aimSet(S.aim.yaw + deg * Math.PI / 180); },
      toggleClean() { S.clean = !S.clean; ui.render(); },
      togglePose(side) { if (!S.aim) return; const po = S.pose[S.aim.actor]; po[side] = !po[side]; ui.render(); },
      togglePair() { S.pair = !S.pair; if (S.fitting) applyPair(); ui.render(); },
      swapPair() { S.pairSwap = !S.pairSwap; if (S.fitting && S.pair) applyPair(); ui.render(); },
      leaveStand() { setRoute(S.defaultRoute); },
      toggleWander() {
        if (S.mission.type === 'wander') { setMission({ type: 'idle', label: '' }); S.pause = null; return; }
        if (!buildings.length) return;
        autoMin();
        setMission({ type: 'wander', label: '自動逛逛中' });
        wanderNext();
      },
      togglePick() {
        S.pickMode = !S.pickMode;
        canvas.style.cursor = S.pickMode ? 'crosshair' : '';
        if (S.pickMode) autoMin();
        ui.render();
      },
      toggleMin() { ui.setMin(!ui.isMin()); },
      openCard() { if (S.arrived && S.arrived.building) hc.selectBuilding(S.arrived.building.id); },
      open() {
        if (isMobile()) closeSiteLayers();
        ui.setOpen(true);
        ui.render();
        ensureDock();
        if (S.tab === 'look') enterFitting();
        syncLimits();
        ui.render(); // 試衣地點的名稱要等 enterFitting 算出來才有
        if (!S.follow) startFollow();
      },
      close() { ui.setOpen(false); cancelPlace(); cancelAim(); leaveFitting(); syncLimits(); restoreSidebar(); },
      toggle() { (ui.isOpen() ? api.close : api.open)(); },
    };
    const ui = buildUI(api, S);

    rebuild();
    ensureControls();

    // 預設行程：沿最長那條站方路線來回走
    const longest = routes.reduce((a, r, i) => (r.length > routes[a].length ? i : a), 0);
    S.defaultRoute = longest;
    setMission({ type: 'route', routeIdx: longest, flow: S.routeInfo[longest].flow, label: '自由漫步中' });
    beginLoop(longest);
    posOf().set(routes[longest][0].x, routes[longest][0].footY, routes[longest][0].z);
    ui.render();

    // ── 點擊小人：按在小人身上時在 capture 階段吃掉這次按放，站方的選取與 OrbitControls 都不會被觸發，避免搶鏡頭
    const hitTest = (cx, cy) => {
      const r = canvas.getBoundingClientRect();
      const v = posOf().clone();
      v.y += 0.2 * S.fig.group.scale.y;
      v.project(cap.camera);
      if (v.z > 1) return false;
      const sx = (v.x + 1) / 2 * r.width + r.left, sy = (1 - v.y) / 2 * r.height + r.top;
      return Math.hypot(cx - sx, cy - sy) < (matchMedia('(pointer:coarse)').matches ? 40 : 26);
    };
    let down = null, grabbed = false;
    const onDown = (e) => {
      down = { x: e.clientX, y: e.clientY };
      grabbed = !!cap.controls && !S.aim && !S.placing && hitTest(e.clientX, e.clientY);
      if (grabbed) e.stopImmediatePropagation();
    };
    const onUp = (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5;
      const wasGrab = grabbed;
      down = null;
      grabbed = false;
      if (S.placing || S.aim) {
        // 放置與調整期間：只吃掉「點一下」（站方收不到，免得選到建築、開政策卡；手機上卡片一開還會把我的面板關掉）。
        // OrbitControls 已在 pointerdown 開始追蹤這個指標，所以補送 pointercancel（它有監聽）讓它正常收尾；拖曳則完全放行，鏡頭照常旋轉
        if (moved) return;
        e.stopImmediatePropagation();
        canvas.dispatchEvent(new PointerEvent('pointercancel', { pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary, bubbles: true }));
        if (S.placing) placeAt(e.clientX, e.clientY);
        else aimToward(e.clientX, e.clientY);
        return;
      }
      if (wasGrab) {
        e.stopImmediatePropagation();
        if (!moved) (S.follow ? stopFollow : startFollow)();
        return;
      }
      if (moved) return;
      if (hitTest(e.clientX, e.clientY)) { (S.follow ? stopFollow : startFollow)(); return; }
      if (S.pickMode) { pickGround(e.clientX, e.clientY); return; }
      if (S.follow) stopFollow();
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (S.placing) { cancelPlace(); return; }
      if (S.aim) { cancelAim(); return; }
      if (S.pickMode) api.togglePick();
      else if (ui.isOpen()) api.close();
      else if (S.follow) stopFollow();
    };
    canvas.addEventListener('pointerdown', onDown, true);
    canvas.addEventListener('pointerup', onUp, true);
    window.addEventListener('keydown', onKey);

    // shutdown 時：把我們放進場景與頁面的東西全部收掉（動畫迴圈由 tick 開頭的 dead 檢查停止）
    undo.push(() => {
      canvas.removeEventListener('pointerdown', onDown, true);
      canvas.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('keydown', onKey);
      canvas.style.cursor = '';
      restoreSidebar();
      applyPendingLimits();
      for (const obj of [S.fig.group, destMark, aimArrow]) {
        cap.scene.remove(obj);
        disposeFigure(obj);
      }
      if (S.puma) {
        cap.scene.remove(S.puma.fig.group);
        disposeFigure(S.puma.fig.group);
      }
      S.follow = null;
      ui.destroy();
      delete window.heartIslandAvatar;
    });

    // ── 每幀：行走、擺手腳、依鏡頭距離縮放、名牌與對話泡泡跟隨
    const proj = new T.Vector3(), projFeet = new T.Vector3();
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    let prevSiteOpen = siteLayerOpen();
    // 版面量測（面板停靠、畫布位置、名牌可用區域）每幀都量會反覆強制重排；改成每 250ms 或視窗改變時才重量
    let measuredAt = -1e9, cachedRect = null, cachedFree = null;
    const remeasure = () => { measuredAt = -1e9; };
    window.addEventListener('resize', remeasure);
    undo.push(() => window.removeEventListener('resize', remeasure));
    const tick = (now) => {
      if (dead) return;
      const fig = S.fig, g = fig.group;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      const w = S.walk;
      let walking = false;
      if (w) {
        w.dist += w.dir * w.speed * dt;
        if (w.kind === 'loop') {
          if (w.dist > w.total) { w.dist = w.total; w.dir = -1; }
          if (w.dist < 0) { w.dist = 0; w.dir = 1; }
        } else if (w.dist >= w.total) w.dist = w.total;
        let i = 0, rest = w.dist;
        while (i < w.seg.length - 1 && rest > w.seg[i]) { rest -= w.seg[i]; i++; }
        const a = w.pts[i], b = w.pts[Math.min(i + 1, w.pts.length - 1)], k = w.seg[i] ? rest / w.seg[i] : 0;
        g.position.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
        if (b.x !== a.x || b.z !== a.z) g.rotation.y = Math.atan2((b.x - a.x) * w.dir, (b.z - a.z) * w.dir);
        walking = true;
        if (w.kind === 'once' && w.dist >= w.total) {
          S.walk = null;
          if (w.after) w.after();
        }
      }
      applyFigScale(fig);
      // 定點站立：面向由我們指定，不再自動轉向鏡頭
      if (S.aim && S.aim.actor === 'me') g.rotation.y = S.aim.yaw;
      else if (S.stand && !S.walk && !S.fitting && !S.aim) g.rotation.y = S.stand.yaw;
      if (S.puma && S.puma.fig.group.visible) { // 複製的 Puma：大小隨鏡頭距離，面向照指定
        const pf = S.puma.fig, pg = pf.group;
        applyFigScale(pf);
        if (S.aim && S.aim.actor === 'puma') pg.rotation.y = S.aim.yaw;
        else if (S.puma.stand) pg.rotation.y = S.puma.stand.yaw;
      }

      if (walking && S.walk) {
        const s = Math.sin(now / 1000 * S.walk.stride) * 0.6;
        fig.legs[0].rotation.x = s;  fig.legs[1].rotation.x = -s;
        fig.arms[0].rotation.x = -s; fig.arms[1].rotation.x = s;
      } else if (S.fitting || (S.aim && S.aim.actor === 'me') || S.stand) {
        // 試衣、調整面向、定點站立：站著不動、雙手自然垂下；不跟著鏡頭轉，才看得到背面
        fig.legs[0].rotation.x = fig.legs[1].rotation.x = 0;
        fig.arms[0].rotation.x = fig.arms[1].rotation.x = 0;
      } else {
        // 抵達後面向鏡頭揮手
        const toCam = Math.atan2(cap.camera.position.x - g.position.x, cap.camera.position.z - g.position.z);
        g.rotation.y += wrap(toCam - g.rotation.y) * Math.min(1, dt * 6);
        fig.legs[0].rotation.x = fig.legs[1].rotation.x = 0;
        fig.arms[0].rotation.x = 0;
        fig.arms[1].rotation.x = -2.5 + Math.sin(now / 160) * 0.35;
      }
      // 舉手姿勢（拍照用）
      // 角色面向 +z 時，自己的左手是 +x 側（arms[1]）、右手是 -x 側（arms[0]）；往外側（z 軸）轉到頭上
      const raise = (f, po, on) => {
        for (const [i, k, sg] of [[0, 'r', -1], [1, 'l', 1]]) {
          const a = f.arms[i];
          if (on && po[k]) { a.rotation.x = 0; a.rotation.z = sg * POSE_UP; } else a.rotation.z = 0;
        }
      };
      raise(fig, S.pose.me, !S.walk && !!(S.stand || (S.aim && S.aim.actor === 'me')));
      if (S.puma) raise(S.puma.fig, S.pose.puma, true);
      fig.pin.position.y = fig.pinY + Math.sin(now / 400) * 0.02;
      // 調整面向：貼地箭頭與羅盤指針；拍照模式：隱藏頭頂標記與底圈
      aimArrow.visible = !!S.aim;
      if (S.aim) {
        const ag = aimGroup();
        aimArrow.position.copy(ag.position);
        aimArrow.rotation.y = S.aim.yaw;
        aimArrow.scale.setScalar(ag.scale.x);
        const nd = document.querySelector('.hm-dial-needle');
        if (nd) nd.style.transform = `rotate(${aimTheta()}rad)`;
      }
      fig.pin.visible = !S.clean;
      fig.ring.visible = !!S.follow && !S.clean && subjectGroup() === g;
      destMark.children[1].position.set(0, 0.2 + Math.sin(now / 300) * 0.03, 0);

      const measure = now - measuredAt > 250;
      if (measure) ui.layout();
      ui.setSub(S.placing ? '點場景選一個位置（步道旁、建築前、黑板前都可以）' : S.aim ? '調整面向與位置，再按「站在這裡」' : S.mission.label);
      // 手機：站方的抽屜或政策卡剛打開時，收起我的面板
      const siteOpen = siteLayerOpen();
      if (siteOpen && !prevSiteOpen && isMobile() && ui.isOpen()) api.close();
      if (siteOpen !== prevSiteOpen) remeasure();
      prevSiteOpen = siteOpen;
      if (S.pause && now >= S.pause.until && !S.fitting && !S.aim) { const f = S.pause.then; S.pause = null; f(); }
      if (S.follow && cap.controls) stepFollow(now);
      else if (S.pendingLimits) applyPendingLimits(true);
      // 鏡頭剛被移動：先照 OrbitControls 的方式對準目標並更新矩陣，名牌的投影才會和這一幀畫出來的畫面一致
      if (S.follow && cap.controls) { cap.camera.lookAt(cap.controls.target); cap.camera.updateMatrixWorld(); }

      // 名牌與對話泡泡是浮在最上層的 DOM，要避開站方 UI 與我自己的面板：
      // 夾在可用區域內，頂端避開 LOGO／工具列，被底部圖層占住時就隱藏
      if (S.say && now > S.say.until) S.say = null;
      if (S.say) {
        const k = `${S.say.title}\n${S.say.text}`;
        if (ui.say.dataset.k !== k) {
          ui.say.dataset.k = k;
          ui.say._sz = null;
          ui.say.replaceChildren(h('b', {}, S.say.title), S.say.text.length > 60 ? S.say.text.slice(0, 58) + '…' : S.say.text);
        }
      }
      if (measure || !cachedRect) {
        cachedRect = canvas.getBoundingClientRect();
        cachedFree = freeBounds(cachedRect);
        measuredAt = now;
      }
      const r = cachedRect, free = cachedFree;
      proj.copy(g.position);
      proj.y += (S.fig.pinY + 0.18) * g.scale.y;
      proj.project(cap.camera);
      // 名牌錨點（腳上方 0.8）在鏡頭拉近時會跑出畫面，但名牌本來就會被夾進可用區域；所以改用「角色本人（腳）在不在畫面內」判斷
      projFeet.copy(g.position).project(cap.camera);
      const inView = projFeet.z < 1 && Math.abs(projFeet.x) < 1.1 && Math.abs(projFeet.y) < 1.1;
      const ax = (proj.x + 1) / 2 * r.width, ay = (1 - proj.y) / 2 * r.height;
      const fit = (el, bottomY) => { // 回傳夾好的 x、bottom y（元素以底邊中點定位）
        if (measure || !el._sz) el._sz = [el.offsetWidth, el.offsetHeight]; // 尺寸只在重量時讀
        const w = el._sz[0] || 90, hh = el._sz[1] || 22;
        const x = free.R - free.L < w ? (free.L + free.R) / 2 : Math.min(Math.max(ax, free.L + w / 2), free.R - w / 2);
        return { x, y: Math.max(bottomY, free.T + hh), hh };
      };
      const showTag = inView && camDist() < 26 && !S.clean;
      const showSay = inView && !!S.say && !S.clean;
      const sz = (el, d) => { if (measure || !el._sz) el._sz = [el.offsetWidth, el.offsetHeight]; return el._sz[1] || d; };
      const sayH = showSay ? sz(ui.say, 40) + 6 : 0;
      const tagFit = fit(ui.tag, Math.max(ay, free.T + sayH + sz(ui.tag, 22)));
      const tagOn = showTag && tagFit.y <= free.B;
      ui.tag.style.display = tagOn ? 'block' : 'none';
      if (tagOn) ui.tag.style.transform = `translate(${r.left + tagFit.x}px, ${r.top + tagFit.y}px) translate(-50%, -100%)`;
      const sayBottom = tagOn ? tagFit.y - tagFit.hh - 6 : ay;
      const sayFit = fit(ui.say, sayBottom);
      const sayOn = showSay && sayFit.y <= free.B;
      ui.say.style.display = sayOn ? 'block' : 'none';
      if (sayOn) ui.say.style.transform = `translate(${r.left + sayFit.x}px, ${r.top + sayFit.y}px) translate(-50%, -100%)`;
      if (!hooked) requestAnimationFrame(tick);
      return true;
    };
    // 站方有提供每幀掛鉤時，排在站方的鏡頭控制與繪製之前執行：角色、鏡頭、名牌都對齊同一幀，移動時不抖不閃。
    // 舊版站方沒有掛鉤才退回自己的 requestAnimationFrame（會比繪製晚一幀）
    const hooked = typeof hc.onFrame === 'function';
    if (hooked) undo.push(hc.onFrame(tick));
    else requestAnimationFrame(tick);

    // 試衣位置要掃小島與整張路網，總共要發上千條射線；載入完成後分段在背景算好，第一次打開面板才不會卡住
    setTimeout(() => {
      if (dead || S.fitSpots || S.fitGen) return;
      const it = S.fitGen = computeFitSpot();
      const step = () => {
        if (dead || S.fitGen !== it) return; // 已被 enterFitting 接手跑完
        try {
          const r = it.next();
          if (r.done) { S.fitSpots = r.value; S.fitGen = null; } else requestAnimationFrame(step);
        } catch (e) { LOG('試衣位置預先計算失敗，打開面板時再算：', e); S.fitGen = null; }
      };
      step();
    }, 3000);

    window.heartIslandAvatar = { S, api, ui, net, buildings, cap, T, startFollow, stopFollow };
    LOG('ready', { nodes: net.main.length, buildings: buildings.length, routes: routes.length });
  }

  // 頁面會設上游 userscript 的站方關閉旗標，讓訪客自己裝的那份讓位。它每 0.5 秒檢查一次旗標，
  // 收掉時會刪除它在 prototype 上加的包裝；我們若比它早包，會被一起刪掉，所以等它收完才安裝。
  const HOOK_DELAY_MS = 1000;
  const HOOK_RETRY_MS = 10000;

  const pageLoaded = () => new Promise((res) => {
    if (document.readyState === 'complete') res();
    else window.addEventListener('load', () => res(), { once: true });
  });

  async function boot() {
    await loadThree();
    await pageLoaded();
    await new Promise((res) => setTimeout(res, HOOK_DELAY_MS));
    if (dead) return;
    hook();
    // 估計的延遲不夠時，userscript 收尾可能已把我們的包裝刪掉：還沒抓到就再裝一次
    setTimeout(() => { if (!dead && (!cap.scene || !cap.camera)) hook(); }, HOOK_RETRY_MS);
    // 站方若是按需重繪，送一個 resize 逼它畫一幀
    setTimeout(() => { if (!dead && !cap.scene) window.dispatchEvent(new Event('resize')); }, 3000);
    await whenReady(() => dead || (cap.scene && cap.camera && window.heartCity && window.heartCity.pedestrianRoutes
      && window.heartCity.pedestrianRoutes.length && document.body && document.querySelector('canvas')));
    if (dead) return;
    let data = null;
    try { data = await loadData(); } catch (e) { console.warn('[heart-me] policies.json 讀取失敗，只提供地圖指定：', e); }
    if (dead) return;
    spawn(data);
  }

  boot().catch((e) => console.warn('[heart-me] boot failed:', e));
})();
