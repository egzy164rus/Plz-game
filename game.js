/* ============================================================
   ПВЗ: С НУЛЯ — симулятор сотрудника пункта выдачи
   Three.js r128 · чистый JS · без внешних ассетов
   v0.3 «Премиум»: руки у персонажей, клик-механика, QR-выдача,
   снег и новогодний декор, магазин мебели с установкой,
   покупка помещений, экран загрузки, свой ПВЗ (имя + лого)
   ============================================================ */
'use strict';

const HIT_MAT = new THREE.MeshBasicMaterial({ visible: false });
const HIT_BOX = new THREE.BoxGeometry(0.55, 0.55, 0.55);

// Локальное окружение для отражений (PMREM), без пересвета всей сцены
let sharedEnvMap = null;
function getEnvMap() {
  if (sharedEnvMap) return sharedEnvMap;
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#fff3d6');
  grad.addColorStop(0.40, '#c0aed3');
  grad.addColorStop(0.62, '#6f5f8a');
  grad.addColorStop(1, '#241d33');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 128);
  const sun = g.createRadialGradient(196, 30, 2, 196, 30, 46);
  sun.addColorStop(0, 'rgba(255,250,224,1)'); sun.addColorStop(1, 'rgba(255,250,224,0)');
  g.fillStyle = sun; g.fillRect(0, 0, 256, 128);
  const glowV = g.createRadialGradient(40, 44, 2, 40, 44, 52);
  glowV.addColorStop(0, 'rgba(123,47,247,0.9)'); glowV.addColorStop(1, 'rgba(123,47,247,0)');
  g.fillStyle = glowV; g.fillRect(0, 0, 256, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  sharedEnvMap = pmrem.fromEquirectangular(tex).texture;
  tex.dispose(); pmrem.dispose();
  return sharedEnvMap;
}

// Контактная тень-«блин»: дёшево вместо SSAO, сильно заземляет объекты
let blobMat = null;
const blobGeo = new THREE.PlaneGeometry(1, 1);
function getBlobMat() {
  if (!blobMat) {
    const tex = makeCanvas(128, 128, (g, w, h) => {
      const grad = g.createRadialGradient(w / 2, h / 2, 6, w / 2, h / 2, w / 2);
      grad.addColorStop(0, 'rgba(0,0,0,0.48)');
      grad.addColorStop(0.55, 'rgba(0,0,0,0.26)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
    });
    blobMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  }
  return blobMat;
}
function addBlobShadow(mesh, w = 1.02, d = 0.8) {
  const m = new THREE.Mesh(blobGeo, getBlobMat());
  m.rotation.x = -Math.PI / 2;
  m.scale.set(w, d, 1);
  m.position.y = 0.017;
  m.renderOrder = 1;
  m.name = 'blobShadow';
  mesh.add(m);
  return m;
}
function setBlobVisible(mesh, v) {
  const b = mesh.getObjectByName('blobShadow');
  if (b) b.visible = v;
}

// ---------- PBR-материалы: Lambert/Phong трактуем как Standard (иначе всё выглядит плоско) ----------
(function upgradeLegacyMaterials() {
  const mk = (defRough, defMetal) => function (params) {
    params = Object.assign({}, params);
    delete params.shininess;
    delete params.specular;
    return new THREE.MeshStandardMaterial(Object.assign({ roughness: defRough, metalness: defMetal }, params));
  };
  THREE.MeshLambertMaterial = mk(0.85, 0.02);
  THREE.MeshPhongMaterial = mk(0.35, 0.10);
})();

// ---------- Текстуры (CC0, ambientCG) ----------
const textureLoader = new THREE.TextureLoader();
function loadTex(url, { repeat = [1, 1], srgb = false } = {}) {
  const t = textureLoader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (srgb) t.encoding = THREE.sRGBEncoding;
  return t;
}
function makeTexturedMat({ map, normal, rough, repeat = [1, 1], roughness = 0.8, metalness = 0.02, tint = 0xffffff, normalScale = 0.85 }) {
  const params = { color: tint, roughness, metalness };
  if (map) params.map = loadTex(map, { repeat, srgb: true });
  if (normal) { params.normalMap = loadTex(normal, { repeat }); params.normalScale = new THREE.Vector2(normalScale, normalScale); }
  if (rough) params.roughnessMap = loadTex(rough, { repeat });
  return new THREE.MeshStandardMaterial(params);
}

// ---------- Баланс ----------
const BALANCE = {
  dayLength: 230,
  eatCost: 15, eatHunger: 45, wcEnergy: 30,
  bulkyChance: 0.16, bulkyPayMul: 1.8, bulkySlots: 3,
  startMoney: 400,
  startRep: 4.2,
  parcelsPerBox: 3,
  deliveryEvery: 40,
  deliveryFirst: 3,
  maxBigBoxes: 3,
  customerEvery: d => Math.max(9, 22 - (d - 1) * 1.6),
  customerPatience: 55,
  sofaPatience: 1.35,
  coffeePatience: 1.20,
  basePay: 140,
  payRandom: 120,
  tipChance: 0.30,
  tipAmount: 40,
  fastIssueSec: 12, tipComboBase: 25, tipComboMax: 4,
  expressChance: 0.12, expressPayMul: 1.5, expressPatienceMul: 0.65,
  vipChance: 0.10, vipPayMul: 2.2, vipPatienceMul: 0.6,
  repGain: 0.04,
  repLoss: 0.18,
  scanTime: 1.2,
  scanTimeFast: 0.5,
  unpackTime: 2.0,
  unpackTimeFast: 0.9,
  ttnTime: 0.7,
  ttnBonus: 30,
  qrTime: 0.9,
  returnTime: 0.8,
  returnFee: 10,
  returnChance: 0.22,
  defectChance: 0.14,
  fragileChance: 0.15,
  thermalChance: 0.13,
  fragilePayMul: 1.6,
  thermalPayMul: 1.3,
  thermalSpoil: 60,
  repackageCost: 15,
  binBonus: 15,
  rent: 350,
  utilities: 60,
  loaderPrice: 3000,
  loaderSpeed: 2.7,
  loaderCooldown: 2.5,
  moveSpeed: 3.4,
  playerRadius: 0.34,
};

const RANKS = [
  { at: 0,     name: 'Стажировка' },
  { at: 1500,  name: 'Ларёк у метро' },
  { at: 4000,  name: 'Маленький ПВЗ' },
  { at: 8000,  name: 'Любимый ПВЗ района' },
  { at: 14000, name: 'Флагманский ПВЗ' },
];

const EVENTS = [
  { id: 'rain',       name: '🌧 Ливень',                    desc: 'Терпение клиентов −25%',            mods: { patience: 0.75 } },
  { id: 'lights',     name: '💡 Моргающие лампы',           desc: 'Сканирование в 1.8 раза медленнее', mods: { scan: 1.8 } },
  { id: 'sale',       name: '🔥 Распродажа на маркетплейсе', desc: 'Клиентов на 35% больше',           mods: { customers: 0.65 } },
  { id: 'influencer', name: '📸 Инфлюенсер отметил ваш ПВЗ', desc: 'Репутация за выдачу ×2',           mods: { repGain: 2 } },
  { id: 'audit',      name: '📋 Внеплановая проверка',       desc: 'Штраф за ушедшего клиента ×2',     mods: { repLoss: 2 } },
  { id: 'rush',       name: '🎄 Предновогодний наплыв',      desc: '+1 короб в поставке, +20% клиентов', mods: { extraBox: 1, customers: 0.8 }, minDay: 2 },
];

const LOCATIONS = [
  { id: 'metro',   name: 'Комнатка у метро',        area: '32 м²', plan: 0, price: 0,     rent: 350, customers: 1.0,  pay: 1.0,  patience: 1.0,  repGain: 1.0,  blurb: 'Аренда каждый день, зато ноль вложений на старте.' },
  { id: 'sleep',   name: 'Лавка в спальнике',       area: '45 м²', plan: 1, price: 15000, rent: 0,   customers: 1.3,  pay: 1.05, patience: 1.1,  repGain: 1.0,  blurb: 'Свой угол: жители ходят пешком, аренды больше нет.' },
  { id: 'bcenter', name: 'Премиум у бизнес-центра', area: '60 м²', plan: 2, price: 35000, rent: 0,   customers: 1.15, pay: 1.25, patience: 1.15, repGain: 1.0,  blurb: 'Корпоративные заказы: чеки выше на 25%.' },
  { id: 'mall',    name: 'Флагман у ТЦ',            area: '80 м²', plan: 3, price: 60000, rent: 0,   customers: 1.45, pay: 1.4,  patience: 1.0,  repGain: 1.25, blurb: 'Трафик ТЦ: выручка +40%, репутация растёт на 25% быстрее.' },
];

// ---------- Глобальное состояние ----------
const G = {
  screen: 'menu',          // menu | play | dayEnd | pause | shop | locations | gameover | victory
  day: 1,
  money: BALANCE.startMoney,
  rep: BALANCE.startRep,
  timeLeft: BALANCE.dayLength,
  lifetimeEarned: 0,
  dayEarned: 0,
  issuedToday: 0,
  tipsToday: 0, tipCombo: 0,
  angryToday: 0,
  totalIssued: 0,
  carried: null,
  action: null,
  deliveryTimer: BALANCE.deliveryFirst,
  customerTimer: 6,
  victoryShown: false,
  warned10s: false,
  debtWarning: false,
  lightsOut: false,
  event: null,
  mods: { patience: 1, scan: 1, customers: 1, repGain: 1, repLoss: 1, extraBox: 0 },
  upgrades: { shelf: 1, scanner: false, table: false, sofa: false, armchair: false, palm: false, plant: false, coatrack: false, greenwall: false, rug: false, neon: false, coffee: false, sign: false, poster: false, loader: false },
  inventory: [],          // неразмещённая мебель
  placing: null,          // { id, rot, ghost, ring }
  autoMove: null,         // { dest:Vector3, arrive, run }
  activeOrder: null,      // { customer, parcel }
  beacon: null,
  ownedLocations: ['metro'],
  location: 'metro',
  pvzName: 'У Дома',
  pvzLogo: '📦',
  qrLaser: null,
  unpackAnim: null,       // { t, dur, mesh, spawned }
  tapWorldHit: false,
  layout: 0,              // применённая планировка зала
  layoutsByLoc: {},       // выбранная планировка для каждой локации
  hunger: 100,
  energy: 100,
  breakOn: false,
  breakOpenAtMin: null,   // игровые минуты, когда дверь откроется сама
  hungerWarned: false,
  energyWarned: false,
  saveSlot: 1,            // активный слот сохранения (1..3)
  lastPhaseId: 'start',
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const choice = arr => arr[Math.floor(Math.random() * arr.length)];
const rankName = total => {
  let r = RANKS[0].name;
  for (const k of RANKS) if (total >= k.at) r = k.name;
  return r;
};
const genOrderId = () => {
  for (let i = 0; i < 60; i++) {
    const id = 'WB-' + randInt(1000, 99999);
    if (!parcels.some(p => p.id === id)) return id;
  }
  return 'WB-' + Date.now().toString().slice(-6);
};
const locBonus = () => LOCATIONS.find(l => l.id === G.location) || LOCATIONS[0];
const layoutStats = () => (LAYOUTS[G.layout] && LAYOUTS[G.layout].stats) || { check: 1, patience: 1, stream: 1, rep: 1 };
const cellLoc = cell => cell ? `Стеллаж ${cell.shelf + 1} · ячейка ${cell.row === 0 ? 'A' : 'B'}${cell.col + 1}` : '—';
const TABLE_POS = { x: -4.4, z: -0.9 };
const BIN_POS = { x: -6.6, z: 3.7 };
const COUNTER_POS = { x: 4.0, z: 2.4 };
const COUNTER_APPROACH = { x: 4.0, z: 3.6 };
const PALLET_POS = { x: -7.0, z: -1.0 };
// Стойка «Габарит» у входа слева, бытовая зона у правой стены
const BULKY_RACK = { x: -7.8, z: 2.3 };
const BULKY_SLOT_Y = [0.44, 1.24, 2.04];
const FRIDGE_POS = { x: 7.8, z: 4.05 };
const WC_POS = { x: 7.75, z: 1.35 };
// Планировки зала — те же 0-3, что и схемы в каталоге помещений
//  each plan: своя форма/мебель/свет + игровой эффект (fx) и множители (stats)
const LAYOUTS = [
  { name: 'Классика',   table: { x: -4.4, z: -0.9 }, bin: { x: -6.6, z: 3.7 },  counter: { x: 4.0, z: 2.4 }, pallet: { x: -7.0, z: -1.0 }, queueDir: 1, rug: { x: 4.0, z: 3.6 }, bench: null,
    fx: 'Ровный зал без бонусов — тёплый старт', stats: { check: 1, patience: 1, stream: 1, rep: 1 } },
  { name: 'Витрина',    table: { x: 4.3, z: -0.9 },  bin: { x: 6.3, z: 3.7 },   counter: { x: -4.0, z: 2.4 }, pallet: { x: 6.6, z: -1.3 }, queueDir: -1, rug: { x: -4.0, z: 3.6 }, bench: { x: 2.6, z: 4.55 },
    fx: 'Витрина с сопуткой: средний чек +15% · поток +5%', stats: { check: 1.15, patience: 1, stream: 1.05, rep: 1 } },
  { name: 'Open space', table: { x: 0, z: -0.9 },    bin: { x: -7.35, z: -3.6 }, counter: { x: 4.0, z: 1.6 },  pallet: { x: -7.0, z: 0.3 },  queueDir: 1, rug: { x: 0, z: 1.7 },  bench: { x: -3.1, z: 3.4 },
    fx: 'Простор и тишина: терпение клиентов +20%', stats: { check: 1, patience: 1.2, stream: 1, rep: 1 } },
  { name: 'Флагман',    table: { x: -3.6, z: -0.9 }, bin: { x: 6.7, z: -3.5 },   counter: { x: 1.6, z: 2.5 },  pallet: { x: 7.2, z: -0.7 },  queueDir: 1, rug: null, bench: { x: -6.6, z: 2.5 },
    fx: 'Флагман: поток +25% · репутация +30% · чек +10%', stats: { check: 1.1, patience: 1, stream: 1.25, rep: 1.3 } },
];
const ROOM_TINTS = [
  { floor: 0xcfc4b6, wall: 0xf2eee6, glow: 0xffd9a0, glowI: 0.45 },
  { floor: 0xd8c9bd, wall: 0xe9d8cd, glow: 0xffe2b0, glowI: 0.6 },
  { floor: 0xc9cec0, wall: 0xd6e3d6, glow: 0xfff0dd, glowI: 0.4 },
  { floor: 0xd2c8dd, wall: 0xd6cbe9, glow: 0xffd9a0, glowI: 0.65 },
];
const roomRefs = { floorMat: null, wallMat: null };
const layoutRefs = {};
let counterGlowLight = null;
let coffeeMachineRef = null;
let benchRef = null;

// ============================================================
//  Сохранения — 3 слота, выбор в меню, автосейв на итогах дня
// ============================================================
const SAVE_KEY = n => 'pvz_save_v1_' + n;
const ACTIVE_SLOT_KEY = 'pvz_active_slot';
function loadSlotData(n) {
  try { const raw = localStorage.getItem(SAVE_KEY(n)); return raw ? JSON.parse(raw) : null; }
  catch (e) { return null; }
}
function saveToSlot(n, silent) {
  try {
    const data = collectSave();
    data.slot = n;
    localStorage.setItem(SAVE_KEY(n), JSON.stringify(data));
    localStorage.setItem(ACTIVE_SLOT_KEY, String(n));
    if (!silent) toast(`💾 Смена сохранена · Слот ${n}`, 'good');
    return true;
  } catch (e) {
    if (!silent) toast('Не удалось сохранить — хранилище недоступно', 'bad');
    return false;
  }
}
function eraseSlot(n) {
  try { localStorage.removeItem(SAVE_KEY(n)); } catch (e) {}
  renderSlots();
}
function collectSave() {
  const pdata = [];
  for (const p of parcels) {
    if (G.carried && G.carried.parcel === p) { pdata.push({ id: p.id, type: p.type, carried: true }); continue; }
    if (p.cell) { pdata.push({ id: p.id, type: p.type, cell: { s: p.cell.shelf, r: p.cell.row, c: p.cell.col } }); continue; }
    if (p.bulkySlot != null) { pdata.push({ id: p.id, type: p.type, bulkySlot: p.bulkySlot }); continue; }
    const m = p.mesh.position;
    pdata.push({ id: p.id, type: p.type, x: +m.x.toFixed(2), y: +m.y.toFixed(2), z: +m.z.toFixed(2) });
  }
  let carried = null;
  if (G.carried) {
    if (G.carried.kind === 'big') carried = { kind: 'big', docScanned: !!G.carried.docScanned };
    else if (G.carried.parcel) carried = { kind: 'parcel', id: G.carried.parcel.id, type: G.carried.parcel.type };
  }
  return {
    v: 1, ts: Date.now(), slot: G.saveSlot,
    name: G.pvzName, logo: G.pvzLogo,
    day: G.day, money: Math.round(G.money), rep: +G.rep.toFixed(3),
    lifetimeEarned: Math.round(G.lifetimeEarned), totalIssued: G.totalIssued,
    hunger: Math.round(G.hunger), energy: Math.round(G.energy),
    upgrades: { ...G.upgrades },
    ownedLocations: [...G.ownedLocations], location: G.location,
    inventory: [...G.inventory], layoutsByLoc: { ...G.layoutsByLoc },
    boughtCounts: { ...boughtCounts },
    furniture: placedFurniture.map(f => ({ id: f.id, x: +f.x.toFixed(2), z: +f.z.toFixed(2), rot: f.rot })),
    shelves: shelves.length,
    parcels: pdata,
    bigBoxes: bigBoxes.map(b => { const fi = floorItems.find(i => i.mesh === b); return { docScanned: !!(fi && fi.docScanned) }; }),
    carried,
  };
}
function applySave(sp) {
  G.pvzName = sp.name || 'У Дома';
  G.pvzLogo = sp.logo || '📦';
  G.day = Math.max(1, sp.day | 0);
  G.money = +sp.money || 0;
  G.rep = clamp(+sp.rep || BALANCE.startRep, 0, 5);
  G.lifetimeEarned = +sp.lifetimeEarned || 0;
  G.totalIssued = sp.totalIssued | 0;
  G.hunger = clamp(sp.hunger == null ? 100 : sp.hunger, 0, 100);
  G.energy = clamp(sp.energy == null ? 100 : sp.energy, 0, 100);
  Object.assign(G.upgrades, sp.upgrades || {});
  G.ownedLocations = [...(sp.ownedLocations || ['metro'])];
  G.location = sp.location || 'metro';
  G.inventory = [...(sp.inventory || [])];
  G.layoutsByLoc = { ...(sp.layoutsByLoc || {}) };
  for (const k of Object.keys(boughtCounts)) delete boughtCounts[k];
  Object.assign(boughtCounts, sp.boughtCounts || {});
  // стеллажи: 0-й построен при загрузке мира — достраиваем остальные
  for (let i = shelves.length; i < (sp.shelves || 1); i++) addShelf(i);
  // размещённая мебель
  for (const f of sp.furniture || []) spawnFurnitureAt(f.id, f.x, f.z, f.rot || 0);
  // посылки
  for (const pd of sp.parcels || []) {
    if (pd.carried) { const p = spawnParcel(0, 0.5, 0.96, pd.type || 'normal', pd.id); removeFromFloorItems(p); continue; }
    if (pd.cell) {
      const shelf = shelves[pd.cell.s];
      const cell = shelf && shelf.cells.find(c => c.row === pd.cell.r && c.col === pd.cell.c);
      if (cell && !cell.parcel) {
        const p = spawnParcel(cell.x, cell.z, cell.y, pd.type || 'normal', pd.id);
        p.cell = cell; cell.parcel = p;
        removeFromFloorItems(p);
      }
      continue;
    }
    if (pd.bulkySlot != null) {
      const p = spawnParcel(BULKY_RACK.x + 0.18, BULKY_RACK.z, BULKY_SLOT_Y[pd.bulkySlot] == null ? 0.44 : BULKY_SLOT_Y[pd.bulkySlot], pd.type || 'normal', pd.id);
      p.bulkySlot = pd.bulkySlot;
      p.mesh.rotation.y = Math.PI / 2;
      setBlobVisible(p.mesh, false);
      removeFromFloorItems(p);
      continue;
    }
    spawnParcel(pd.x == null ? 0 : pd.x, pd.z == null ? 0.5 : pd.z, pd.y == null ? 0.96 : pd.y, pd.type || 'normal', pd.id);
  }
  // короба поставки у паллеты
  for (const b of sp.bigBoxes || []) {
    const item = spawnBigBox();
    if (item && b.docScanned) item.docScanned = true;
  }
  // посылка в руках
  if (sp.carried) {
    if (sp.carried.kind === 'parcel') {
      const p = parcels.find(q => q.id === sp.carried.id);
      if (p) { G.carried = { kind: 'parcel', id: p.id, mesh: p.mesh, parcel: p }; attachCarried(p.mesh); }
    } else if (sp.carried.kind === 'big') {
      const item = spawnBigBox();
      if (item) {
        item.docScanned = !!sp.carried.docScanned;
        removeFromArray(floorItems, item);
        removeFromArray(bigBoxes, item.mesh);
        G.carried = item;
        attachCarried(item.mesh);
      }
    }
  }
  // планировка зала локации
  const layout = (G.layoutsByLoc[G.location] != null) ? G.layoutsByLoc[G.location] : 0;
  applyLayout(layout);
  updateInventoryHUD();
  parcelsDirty = true;
}
function slotSummary(sp) {
  return `День ${sp.day} · ${Math.round(sp.money)} ₽ · ${(sp.rep || 0).toFixed(1)} ★`;
}

// ---------- Выбор слота сохранения в меню ----------
let selectedSlot = 1;
try { selectedSlot = Math.min(3, Math.max(1, +localStorage.getItem(ACTIVE_SLOT_KEY) || 1)); } catch (e) {}
const slotRowEl = document.getElementById('slot-row');
const slotInfoEl = document.getElementById('slot-info');
const eraseSlotBtn = document.getElementById('btn-erase-slot');
const newGameBtn = document.getElementById('btn-newgame');
function selectedSlotData() { return loadSlotData(selectedSlot); }
function renderSlots() {
  if (!slotRowEl) return;
  slotRowEl.innerHTML = '';
  for (let n = 1; n <= 3; n++) {
    const sp = loadSlotData(n);
    const b = document.createElement('button');
    b.className = 'slot-chip ' + (sp ? 'filled' : 'empty') + (n === selectedSlot ? ' active' : '');
    b.innerHTML = `<span class="slot-n">Слот ${n}</span><span class="slot-d">${sp ? slotSummary(sp) : 'Пусто'}</span>`;
    b.addEventListener('click', () => { selectedSlot = n; try { localStorage.setItem(ACTIVE_SLOT_KEY, String(n)); } catch (e) {} AudioSys.place(); renderSlots(); });
    slotRowEl.appendChild(b);
  }
  const sp = selectedSlotData();
  if (sp) {
    slotInfoEl.textContent = `«${sp.name || 'ПВЗ'}» · День ${sp.day} · ранг «${rankName(sp.lifetimeEarned || 0)}»`;
    eraseSlotBtn.classList.remove('hidden');
    newGameBtn.classList.remove('hidden');
    document.getElementById('btn-start').textContent = `Продолжить · День ${sp.day} →`;
  } else {
    slotInfoEl.textContent = 'Слот пуст — начнёте чистую смену';
    eraseSlotBtn.classList.add('hidden');
    newGameBtn.classList.add('hidden');
    document.getElementById('btn-start').textContent = 'Открыть смену →';
  }
}
if (eraseSlotBtn) eraseSlotBtn.addEventListener('click', () => {
  const sp = selectedSlotData();
  if (!sp) return;
  if (confirm(`Стереть сохранение («${sp.name || 'ПВЗ'}», День ${sp.day})?`)) { eraseSlot(selectedSlot); AudioSys.denied(); }
});
if (newGameBtn) newGameBtn.addEventListener('click', () => {
  const sp = selectedSlotData();
  if (sp && !confirm(`Начать новую смену? Сохранение «${sp.name || 'ПВЗ'}» (День ${sp.day}) будет стёрто.`)) return;
  try { localStorage.removeItem(SAVE_KEY(selectedSlot)); } catch (e) {}
  startNewGame(selectedSlot);
});

// ============================================================
//  Рекорды (localStorage)
// ============================================================
function loadRecords() {
  try {
    return {
      earned: +localStorage.getItem('pvz_best_earned') || 0,
      day: +localStorage.getItem('pvz_best_day') || 0,
    };
  } catch (e) { return { earned: 0, day: 0 }; }
}
function saveRecords() {
  try {
    const p = loadRecords();
    const e = Math.round(G.lifetimeEarned);
    if (e > p.earned) localStorage.setItem('pvz_best_earned', String(e));
    if (G.day > p.day) localStorage.setItem('pvz_best_day', String(G.day));
  } catch (e) {}
}
function loadLayouts() {
  try { return JSON.parse(localStorage.getItem('pvz_layouts') || '{}') || {}; } catch (e) { return {}; }
}
function saveLayouts() {
  try { localStorage.setItem('pvz_layouts', JSON.stringify(G.layoutsByLoc)); } catch (e) {}
}
function loadBrand() {
  try {
    const n = localStorage.getItem('pvz_name'); if (n) G.pvzName = n;
    const l = localStorage.getItem('pvz_logo'); if (l) G.pvzLogo = l;
  } catch (e) {}
}
function saveBrand() {
  try {
    localStorage.setItem('pvz_name', G.pvzName);
    localStorage.setItem('pvz_logo', G.pvzLogo);
  } catch (e) {}
}
function renderRecords() {
  const p = loadRecords();
  const el = document.getElementById('menu-records');
  if (el) el.textContent = (p.earned > 0 || p.day > 1)
    ? `🏆 Рекорд: ${p.earned} ₽ за всё время · день ${p.day}`
    : 'Рекорд ещё не установлен — станьте первым!';
}

// ============================================================
//  Аудио (Web Audio API)
// ============================================================
const AudioSys = {
  ctx: null,
  init() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } },
  tone(freq, dur = 0.12, type = 'sine', vol = 0.16, when = 0, slideTo = null) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.ctx.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  },
  pickup()  { this.tone(440, 0.07, 'square', 0.12); },
  place()   { this.tone(520, 0.08, 'square', 0.12); this.tone(660, 0.06, 'square', 0.09, 0.07); },
  unpack()  { this.tone(600, 0.06, 'triangle', 0.14); this.tone(750, 0.06, 'triangle', 0.14, 0.09); this.tone(900, 0.09, 'triangle', 0.14, 0.18); },
  scan()    { this.tone(880, 0.09, 'sine', 0.18); this.tone(1320, 0.14, 'sine', 0.18, 0.12); },
  qr()      { this.tone(1200, 0.05, 'square', 0.14); this.tone(1600, 0.05, 'square', 0.14, 0.07); this.tone(2000, 0.1, 'square', 0.14, 0.14); },
  cash()    { this.tone(1568, 0.10, 'triangle', 0.2); this.tone(2093, 0.22, 'triangle', 0.2, 0.1); },
  door()    { this.tone(990, 0.16, 'sine', 0.15); this.tone(1320, 0.22, 'sine', 0.13, 0.12); },
  angry()   { this.tone(220, 0.28, 'sawtooth', 0.14, 0, 130); },
  crack()   { this.tone(1400, 0.05, 'square', 0.16); this.tone(180, 0.3, 'sawtooth', 0.16, 0.05, 90); },
  buy()     { this.tone(700, 0.08, 'square', 0.12); this.tone(1050, 0.12, 'square', 0.12, 0.08); },
  denied()  { this.tone(180, 0.18, 'square', 0.12); },
  build()   { this.tone(392, 0.09, 'triangle', 0.16); this.tone(523, 0.09, 'triangle', 0.16, 0.09); this.tone(659, 0.14, 'triangle', 0.16, 0.18); },
  move()    { [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.17, i * 0.13)); },
  dayEnd()  { [523, 659, 784].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.16, i * 0.16)); },
  victory() { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.18, i * 0.17)); },
  gameover(){ [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.3, 'sawtooth', 0.12, i * 0.22)); },
};

// ============================================================
//  Процедурные текстуры (canvas)
// ============================================================
function makeCanvas(w, h, fn) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  fn(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}
const TEX = {
  floor() {
    return makeCanvas(512, 512, (g, w, h) => {
      g.fillStyle = '#b69167'; g.fillRect(0, 0, w, h);
      const tones = ['#a9835b', '#c4a274', '#ad875c', '#bb9770', '#b08d63'];
      const rows = 8, ph = h / rows;
      for (let r = 0; r < rows; r++) {
        const y = r * ph;
        g.fillStyle = tones[r % tones.length];
        g.fillRect(0, y, w, ph);
        g.fillStyle = '#5f452b'; g.fillRect(0, y, w, 3);
        for (let j = 0; j < 2; j++) g.fillRect((r * 173 + j * 264 + 96) % w, y, 3, ph);
        g.fillStyle = 'rgba(0,0,0,0.08)';
        for (let i = 0; i < 14; i++) g.fillRect(Math.random() * w, y + Math.random() * (ph - 4) + 2, 26 + Math.random() * 70, 2);
        g.fillStyle = 'rgba(255,255,255,0.05)';
        for (let i = 0; i < 6; i++) g.fillRect(Math.random() * w, y + Math.random() * (ph - 4) + 2, 20 + Math.random() * 50, 1);
      }
    });
  },
  wall() {
    return makeCanvas(512, 256, (g, w, h) => {
      g.fillStyle = '#e9dcc8'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#d9cbb2';
      for (let i = 0; i < 400; i++) g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
      g.fillStyle = '#7b2ff7'; g.fillRect(0, h - 34, w, 10);
      g.fillStyle = '#ffd60a'; g.fillRect(0, h - 24, w, 6);
    });
  },
  rug() {
    return makeCanvas(512, 320, (g, w, h) => {
      // база — плотное жёлтое полотно
      g.fillStyle = '#f7c948'; g.fillRect(0, 0, w, h);
      // шум волокон
      for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(120,80,0,${Math.random() * 0.14})`; g.fillRect(Math.random() * w, Math.random() * h, 3, 1.5); }
      // внешняя фиолетовая кайма
      g.strokeStyle = '#7b2ff7'; g.lineWidth = 34; g.strokeRect(20, 20, w - 40, h - 40);
      // прошивка пунктиром поверх каймы
      g.strokeStyle = '#ffd60a'; g.lineWidth = 3; g.setLineDash([14, 10]); g.strokeRect(38, 38, w - 76, h - 76); g.setLineDash([]);
      // тонкая внутренняя линия
      g.strokeStyle = '#5a1fd0'; g.lineWidth = 5; g.strokeRect(64, 64, w - 128, h - 128);
      // угловые медальоны
      const medallion = (x, y) => {
        g.save(); g.translate(x, y); g.rotate(Math.PI / 4);
        g.fillStyle = '#7b2ff7'; g.fillRect(-26, -26, 52, 52);
        g.fillStyle = '#ffd60a'; g.fillRect(-16, -16, 32, 32);
        g.fillStyle = '#7b2ff7'; g.fillRect(-6, -6, 12, 12);
        g.restore();
      };
      medallion(104, 100); medallion(w - 104, 100); medallion(104, h - 100); medallion(w - 104, h - 100);
      // центральный ромб с монограммой
      g.save(); g.translate(w / 2, h / 2);
      g.rotate(Math.PI / 4);
      g.fillStyle = '#7b2ff7'; g.fillRect(-64, -64, 128, 128);
      g.fillStyle = '#ffd60a'; g.fillRect(-44, -44, 88, 88);
      g.fillStyle = '#7b2ff7'; g.fillRect(-24, -24, 48, 48);
      g.rotate(-Math.PI / 4);
      g.fillStyle = '#ffd60a'; g.font = '900 34px Arial Black, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('WB', 0, 2);
      g.restore();
      // бахрома слева и справа
      g.strokeStyle = '#7b2ff7'; g.lineWidth = 4;
      for (let y = 26; y < h - 20; y += 12) { g.beginPath(); g.moveTo(6, y); g.lineTo(18, y); g.stroke(); g.beginPath(); g.moveTo(w - 18, y); g.lineTo(w - 6, y); g.stroke(); }
    });
  },
  rugB() { // ковёр премиум: глубокий красный + золото
    return makeCanvas(256, 256, (g, w, h) => {
      g.fillStyle = '#8f1f2e'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#ffd60a'; g.lineWidth = 16; g.strokeRect(10, 10, w - 20, h - 20);
      g.lineWidth = 4; g.strokeRect(30, 30, w - 60, h - 60);
      g.fillStyle = '#ffd60a';
      g.save(); g.translate(w / 2, h / 2); g.rotate(Math.PI / 4);
      g.fillRect(-46, -46, 92, 92); g.fillStyle = '#8f1f2e'; g.fillRect(-26, -26, 52, 52);
      g.fillStyle = '#ffd60a'; g.fillRect(-10, -10, 20, 20); g.restore();
    });
  },
  poster() {
    return makeCanvas(256, 320, (g, w, h) => {
      g.fillStyle = '#241640'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffd60a'; g.beginPath(); g.arc(w / 2, 110, 58, 0, 7); g.fill();
      g.fillStyle = '#241640'; g.font = '900 44px Arial'; g.textAlign = 'center'; g.fillText('★5', w / 2, 126);
      g.fillStyle = '#fff'; g.font = '900 34px Arial'; g.fillText('ПВЗ', w / 2, 215);
      g.fillStyle = '#b07bff'; g.font = '700 17px Arial'; g.fillText('У ДОМА', w / 2, 245);
      g.fillStyle = '#8a7fb0'; g.font = '12px Arial'; g.fillText('выдаём с улыбкой', w / 2, 285);
    });
  },
  sign() {
    return makeCanvas(512, 128, (g, w, h) => {
      g.fillStyle = '#ffd60a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#17121f'; g.font = '900 64px Arial Black, Arial'; g.textAlign = 'center';
      g.fillText('ОТКРЫТО', w / 2, 88);
    });
  },
  pallet() {
    return makeCanvas(128, 128, (g, w, h) => {
      g.fillStyle = '#a87b4f'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#8a6136';
      for (let y = 8; y < h; y += 32) g.fillRect(0, y, w, 10);
    });
  },
  bin() {
    return makeCanvas(128, 64, (g, w, h) => {
      g.fillStyle = '#17121f'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffd60a'; g.font = '900 34px Arial Black, Arial'; g.textAlign = 'center';
      g.fillText('БРАК', w / 2, 45);
    });
  },
  nameBoard(name, logo) {
    return makeCanvas(512, 128, (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, '#4a1d9e'); grad.addColorStop(0.5, '#7b2ff7'); grad.addColorStop(1, '#4a1d9e');
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffd60a'; g.fillRect(0, h - 12, w, 8);
      g.font = '64px Arial'; g.textBaseline = 'middle';
      g.fillText(logo, 18, h / 2 - 4);
      g.fillStyle = '#ffffff'; g.font = '900 44px Arial Black, Arial'; g.textAlign = 'left';
      const label = 'ПВЗ «' + String(name).toUpperCase().slice(0, 12) + '»';
      g.fillText(label, 100, h / 2 - 4, w - 110);
    });
  },
  neon() {
    return makeCanvas(512, 256, (g, w, h) => {
      g.fillStyle = '#150a26'; g.fillRect(0, 0, w, h);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '900 92px Arial Black, Arial';
      g.shadowBlur = 34; g.shadowColor = '#ff4fd8';
      g.strokeStyle = '#ff4fd8'; g.lineWidth = 3; g.strokeText('П В З', w / 2, h / 2 - 18);
      g.shadowBlur = 24; g.shadowColor = '#35f0ff';
      g.font = '700 40px Arial'; g.fillStyle = '#8ff4ff'; g.fillText('· 24 / 7 ·', w / 2, h / 2 + 64);
      g.shadowBlur = 0;
    });
  },
};

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function labelSprite(text, opts = {}) {
  const c = document.createElement('canvas'); c.width = 176; c.height = 80;
  const g = c.getContext('2d');
  const wanted = !!opts.wanted, red = !!opts.red;
  g.fillStyle = red ? '#e0455a' : wanted ? '#ffd60a' : 'rgba(23,18,31,0.92)';
  roundRect(g, 4, 4, 168, 64, 14); g.fill();
  g.strokeStyle = red ? '#8f1f30' : wanted ? '#7b2ff7' : '#554a73'; g.lineWidth = 3;
  roundRect(g, 4, 4, 168, 64, 14); g.stroke();
  const fg = red ? '#ffffff' : wanted ? '#17121f' : '#ffe95c';
  g.fillStyle = fg; g.textAlign = 'center';
  if (opts.sub) {
    g.font = '800 21px "Courier New", monospace'; g.fillText(text, 88, 35);
    g.font = '800 14px Arial'; g.fillText(opts.sub, 88, 57);
  } else {
    g.font = '800 25px "Courier New", monospace'; g.fillText(text, 88, 45);
  }
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(1.0, 0.46, 1);
  sp.renderOrder = 999;
  return sp;
}

// ============================================================
//  Сцена
// ============================================================
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1426);
scene.fog = new THREE.Fog(0x1a1426, 22, 44);

const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.1, 100);
let cameraDist = 10.5;

const hemi = new THREE.HemisphereLight(0xfff4e0, 0x3a2f52, 0.72);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe8c4, 0.7);
sun.position.set(6, 12, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -12; sun.shadow.camera.right = 12;
sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
sun.shadow.camera.far = 30;
sun.shadow.bias = -0.00035;
sun.shadow.normalBias = 0.025;
scene.add(sun);
const lamp = new THREE.PointLight(0xffd9a0, 0.5, 16);
lamp.position.set(0, 3.0, 0.5);
scene.add(lamp);

const colliders = [];
const addCollider = (minX, maxX, minZ, maxZ, owner) => colliders.push({ minX, maxX, minZ, maxZ, owner });
function removeLayoutColliders() { for (let i = colliders.length - 1; i >= 0; i--) if (colliders[i].owner === 'layout') colliders.splice(i, 1); }

function boxMesh(w, h, d, color, opts = {}) {
  const { castShadow = true, ...matOpts } = opts;
  const minSide = Math.min(w, h, d);
  const radius = Math.min(minSide * 0.24, 0.055);
  const geo = THREE.RoundedBoxGeometry
    ? new THREE.RoundedBoxGeometry(w, h, d, 2, Math.max(0.004, Math.min(radius, minSide / 2 - 0.001)))
    : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, ...matOpts }));
  m.castShadow = castShadow;
  m.receiveShadow = true;
  return m;
}
function cylMesh(rt, rb, h, color, seg = 16, opts = {}) {
  const { castShadow = true, ...matOpts } = opts;
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(rt, rb, h, seg),
    new THREE.MeshLambertMaterial({ color, ...matOpts })
  );
  m.castShadow = castShadow; m.receiveShadow = true;
  return m;
}

const ROOM = { x: 8.5, z: 5.5, wallH: 3.3 };
const world = new THREE.Group();
scene.add(world);

// ---------- Кликабельные корни ----------
const clickables = [];
function tagInteract(root, tag, data) {
  root.userData.interactTag = tag;
  Object.assign(root.userData, data || {});
  root.traverse(o => { o.userData.hitRoot = root; });
  if (!clickables.includes(root)) clickables.push(root);
}
function untagInteract(root) {
  const i = clickables.indexOf(root);
  if (i >= 0) clickables.splice(i, 1);
}

function buildRoom() {
  roomRefs.floorMat = makeTexturedMat({
    map: 'assets/textures/floor_color.jpg', normal: 'assets/textures/floor_normal.png',
    rough: 'assets/textures/floor_rough.jpg', repeat: [6, 4], roughness: 0.72, normalScale: 0.7, tint: 0xcfc4b6,
  });
  roomRefs.floorMat.envMap = getEnvMap();
  roomRefs.floorMat.envMapIntensity = 0.3;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.x * 2, ROOM.z * 2),
    roomRefs.floorMat
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  world.add(floor);

  // Снежное покрытие снаружи витрины
  const snowGround = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 30),
    new THREE.MeshLambertMaterial({ color: 0xd9e2ef })
  );
  snowGround.rotation.x = -Math.PI / 2;
  snowGround.position.set(0, -0.02, ROOM.z + 15);
  snowGround.receiveShadow = true;
  world.add(snowGround);

  const wallMat = makeTexturedMat({
    map: 'assets/textures/wall_color.jpg', normal: 'assets/textures/wall_normal.png',
    rough: 'assets/textures/wall_rough.jpg', repeat: [4.5, 1.3], roughness: 0.94, normalScale: 0.85,
  });
  roomRefs.wallMat = wallMat;
  const mkWall = (w, h, d, x, y, z, rotY = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, y, z); m.rotation.y = rotY; m.receiveShadow = true; m.castShadow = true;
    world.add(m); return m;
  };
  mkWall(ROOM.x * 2 + 0.6, ROOM.wallH, 0.3, 0, ROOM.wallH / 2, -ROOM.z - 0.15);
  mkWall(0.3, ROOM.wallH, ROOM.z * 2 + 0.6, -ROOM.x - 0.15, ROOM.wallH / 2, 0);
  mkWall(0.3, ROOM.wallH, ROOM.z * 2 + 0.6, ROOM.x + 0.15, ROOM.wallH / 2, 0);
  // плинтусы: фиолетовый + жёлтый, вдоль стен
  const baseMatV = new THREE.MeshStandardMaterial({ color: 0x7b2ff7, roughness: 0.5, emissive: 0x1c0530 });
  const baseMatY = new THREE.MeshStandardMaterial({ color: 0xffd60a, roughness: 0.5, emissive: 0x332200 });
  const mkBaseboard = (w, d, x, y, z) => {
    const v = new THREE.Mesh(new THREE.BoxGeometry(w, 0.10, d), baseMatV); v.position.set(x, y, z); world.add(v);
    const yv = new THREE.Mesh(new THREE.BoxGeometry(w * 0.995, 0.055, d * 0.9), baseMatY); yv.position.set(x, y - 0.082, z); world.add(yv);
  };
  mkBaseboard(ROOM.x * 2, 0.06, 0, 0.32, -ROOM.z + 0.03);
  mkBaseboard(0.06, ROOM.z * 2, -ROOM.x + 0.03, 0.32, 0);
  mkBaseboard(0.06, ROOM.z * 2, ROOM.x - 0.03, 0.32, 0);
  addCollider(-9, 9, -6.0, -5.35);
  addCollider(-9, -8.35, -6, 6);
  addCollider(8.35, 9, -6, 6);

  const southZ = ROOM.z;
  const lowH = 0.95, glassH = 2.1, topH = ROOM.wallH - lowH - glassH;
  const segW = (ROOM.x * 2 - 2.6) / 2;
  for (const sgn of [-1, 1]) {
    const cx = sgn * (1.3 + segW / 2);
    mkWall(segW, lowH, 0.22, cx, lowH / 2, southZ);
    mkWall(segW, topH, 0.22, cx, lowH + glassH + topH / 2, southZ);
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(segW - 0.2, glassH),
      new THREE.MeshPhongMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.22, shininess: 90, side: THREE.DoubleSide, depthWrite: false })
    );
    glass.position.set(cx, lowH + glassH / 2, southZ);
    world.add(glass);
    const frameMat = new THREE.MeshLambertMaterial({ color: 0x3f3a4d });
    for (const fx of [-segW / 2 + 0.06, 0, segW / 2 - 0.06]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.09, glassH, 0.26), frameMat);
      f.position.set(cx + fx, lowH + glassH / 2, southZ); world.add(f);
    }
  }
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x3f3a4d });
  for (const dx of [-1.35, 1.35]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, ROOM.wallH, 0.28), frameMat);
    post.position.set(dx, ROOM.wallH / 2, southZ); world.add(post);
  }
  mkWall(2.9, 0.5, 0.3, 0, ROOM.wallH - 0.25, southZ);
  addCollider(-9, -1.25, southZ - 0.2, southZ + 0.6);
  addCollider(1.25, 9, southZ - 0.2, southZ + 0.6);
  addCollider(-1.35, 1.35, southZ - 0.2, southZ + 0.6);

  // Тёплая лампа над стойкой
  counterGlowLight = new THREE.PointLight(0xffd9a0, 0.4, 6);
  counterGlowLight.position.set(COUNTER_POS.x, 2.4, COUNTER_POS.z);
  world.add(counterGlowLight);
}

function buildSeasonDecor() {
  // Гирлянда вдоль северной стены
  const wire = boxMesh(15.4, 0.02, 0.02, 0x17121f, { castShadow: false });
  wire.position.set(0, 3.02, -5.3); world.add(wire);
  const colors = [0xff4d4d, 0xffd60a, 0x2ee6a8, 0x4cc9f0, 0xff8ad4];
  for (let i = 0; i <= 30; i++) {
    const x = -7.6 + (i / 30) * 15.2;
    const y = 2.99 - Math.abs(Math.sin(i * 1.35)) * 0.18;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6),
      new THREE.MeshBasicMaterial({ color: colors[i % colors.length] }));
    bulb.position.set(x, y, -5.3);
    world.add(bulb);
  }
  // Ёлка справа от двери + подарки
  const g = new THREE.Group();
  const trunk = cylMesh(0.09, 0.09, 0.3, 0x6b4a2f, 8); trunk.position.y = 0.15; g.add(trunk);
  const cone1 = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.95, 10),
    new THREE.MeshLambertMaterial({ color: 0x1f7a45, flatShading: true }));
  cone1.position.y = 0.78; cone1.castShadow = true; g.add(cone1);
  const cone2 = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.8, 10),
    new THREE.MeshLambertMaterial({ color: 0x269954, flatShading: true }));
  cone2.position.y = 1.28; cone2.castShadow = true; g.add(cone2);
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.13),
    new THREE.MeshBasicMaterial({ color: 0xffd60a }));
  star.position.y = 1.8; g.add(star);
  g.position.set(2.15, 0, 4.72);
  world.add(g);
  addCollider(1.7, 2.6, 4.35, 5.1);
  const giftCols = [0xff5c7a, 0xffd60a, 0x4cc9f0];
  [[2.9, 4.6], [1.45, 4.68], [2.3, 4.15]].forEach(([gx, gz], i) => {
    const gift = new THREE.Group();
    const body = boxMesh(0.24, 0.2, 0.24, giftCols[i]); body.position.y = 0.1; gift.add(body);
    const ribbonV = boxMesh(0.055, 0.21, 0.25, 0xffffff); ribbonV.position.y = 0.1; gift.add(ribbonV);
    const ribbonH = boxMesh(0.25, 0.21, 0.055, 0xffffff); ribbonH.position.y = 0.1; gift.add(ribbonH);
    gift.position.set(gx, 0, gz); gift.rotation.y = rand(-0.4, 0.4);
    world.add(gift);
  });
}

// Солнечный луч и пылинки — «киношный» воздух в зале
let dust = null, dustSeed = null;
const shaftMats = [];
function buildLightShaft() {
  const gradTex = makeCanvas(64, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(255, 236, 190, 0.85)');
    grad.addColorStop(0.65, 'rgba(255, 236, 190, 0.18)');
    grad.addColorStop(1, 'rgba(255, 236, 190, 0)');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  });
  for (const [x, rotZ, op] of [[-3.4, 0.16, 0.085], [2.6, -0.14, 0.065]]) {
    const shaft = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 6.2),
      new THREE.MeshBasicMaterial({ map: gradTex, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })
    );
    shaft.position.set(x, 1.85, 3.15);
    shaft.rotation.set(-0.72, 0, rotZ);
    shaft.renderOrder = 2;
    world.add(shaft);
    shaftMats.push(shaft.material);
  }
  // пылинки
  const N = 80;
  const pos = new Float32Array(N * 3);
  dustSeed = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = rand(-7.5, 7.5);
    pos[i * 3 + 1] = rand(0.3, 2.9);
    pos[i * 3 + 2] = rand(-4.8, 4.5);
    dustSeed[i * 2] = rand(0.1, 0.5);
    dustSeed[i * 2 + 1] = rand(0, Math.PI * 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dotTex = makeCanvas(32, 32, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,240,205,1)');
    grad.addColorStop(1, 'rgba(255,240,205,0)');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  });
  dust = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.055, map: dotTex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
  dust.renderOrder = 2;
  world.add(dust);
}
function updateDust(dt, t) {
  if (!dust) return;
  const pos = dust.geometry.attributes.position.array;
  for (let i = 0; i < dustSeed.length / 2; i++) {
    const sp = dustSeed[i * 2], ph = dustSeed[i * 2 + 1];
    pos[i * 3] += Math.sin(t * 0.35 + ph) * 0.03 * dt + 0.008 * dt;
    pos[i * 3 + 1] += Math.cos(t * 0.28 + ph * 1.7) * 0.02 * dt;
    pos[i * 3 + 2] += Math.cos(t * 0.3 + ph) * 0.025 * dt;
    if (pos[i * 3] > 8) pos[i * 3] = -8;
    if (pos[i * 3 + 1] > 3.1) pos[i * 3 + 1] = 0.3;
    if (pos[i * 3 + 1] < 0.2) pos[i * 3 + 1] = 2.9;
  }
  dust.geometry.attributes.position.needsUpdate = true;
}

// История ПВЗ в деталях: правила у входа + полка с растениями
function buildStoryProps() {
  // стойка с правилами пункта выдачи
  const rack = new THREE.Group(); rack.name = 'story-rack';
  const foot = cylMesh(0.23, 0.27, 0.06, 0x2b233c, 12); foot.position.y = 0.03; rack.add(foot);
  const pole = cylMesh(0.05, 0.07, 1.05, 0x2b233c, 10); pole.position.y = 0.58; rack.add(pole);
  const plate = boxMesh(0.46, 0.1, 0.05, 0xffd60a); plate.position.y = 1.43; rack.add(plate);
  const plateText = boxMesh(0.36, 0.05, 0.052, 0x17121f, { castShadow: false }); plateText.position.y = 1.43; rack.add(plateText);
  const holder = boxMesh(0.44, 0.52, 0.05, 0x3a2a55); holder.position.y = 1.12; rack.add(holder);
  const flyerCols = [0xffd60a, 0x7b2ff7, 0xf6f2ea];
  flyerCols.forEach((c, i) => {
    const flyer = new THREE.Mesh(new THREE.PlaneGeometry(0.105, 0.15), new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, side: THREE.DoubleSide }));
    flyer.position.set(-0.13 + i * 0.13, 1.12, 0.028); rack.add(flyer);
  });
  rack.position.set(-2.3, 0, 4.5);
  world.add(rack);
  addCollider(-2.55, -2.05, 4.3, 4.68, 'story');
  // настенная полка с растениями на задней стене
  const shelf = new THREE.Group(); shelf.name = 'story-shelf';
  const board = boxMesh(1.5, 0.055, 0.26, 0xa8783f); board.position.y = 0; shelf.add(board);
  const potCols = [0xc46b3f, 0x7b2ff7, 0xf6f2ea];
  [-0.48, 0, 0.48].forEach((dx, i) => {
    const pot = cylMesh(0.065, 0.052, 0.11, potCols[i], 10); pot.position.set(dx, 0.082, 0); shelf.add(pot);
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.088, 0), new THREE.MeshLambertMaterial({ color: i === 1 ? 0x3fa860 : 0x2e8b4f, flatShading: true }));
    leaf.position.set(dx, 0.2, 0); leaf.castShadow = true; shelf.add(leaf);
  });
  shelf.position.set(0, 2.02, -5.26);
  world.add(shelf);
}

// Падающий снег снаружи витрины
let snow = null, snowSpeeds = null;
function buildSnow() {
  const COUNT = 260;
  const positions = new Float32Array(COUNT * 3);
  snowSpeeds = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3] = rand(-11, 11);
    positions[i * 3 + 1] = rand(0.2, 7.5);
    positions[i * 3 + 2] = rand(ROOM.z + 0.3, ROOM.z + 9);
    snowSpeeds[i] = rand(0.55, 1.25);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.1, transparent: true, opacity: 0.9, depthWrite: false });
  snow = new THREE.Points(geo, mat);
  scene.add(snow);
}
function updateSnow(dt, t) {
  if (!snow) return;
  const pos = snow.geometry.attributes.position.array;
  for (let i = 0; i < snowSpeeds.length; i++) {
    pos[i * 3 + 1] -= snowSpeeds[i] * dt;
    pos[i * 3] += Math.sin(t * 1.8 + i * 1.7) * 0.12 * dt;
    if (pos[i * 3 + 1] < 0.03) {
      pos[i * 3 + 1] = rand(6.2, 7.5);
      pos[i * 3] = rand(-11, 11);
      pos[i * 3 + 2] = rand(ROOM.z + 0.3, ROOM.z + 9);
    }
  }
  snow.geometry.attributes.position.needsUpdate = true;
}

// ---------- Мебель ----------
const furniture = {};
function buildPallet() {
  const g = new THREE.Group();
  const tex = TEX.pallet();
  const p = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.16, 1.6), new THREE.MeshLambertMaterial({ map: tex }));
  p.position.y = 0.08; p.castShadow = true; p.receiveShadow = true; g.add(p);
  for (let i = -0.7; i <= 0.7; i += 0.7) {
    const block = boxMesh(0.25, 0.1, 1.5, 0x8a6136); block.position.set(i, 0.03, 0); g.add(block);
  }
  g.position.set(PALLET_POS.x, 0, PALLET_POS.z);
  world.add(g);
  addCollider(PALLET_POS.x - 1.15, PALLET_POS.x + 1.15, PALLET_POS.z - 0.85, PALLET_POS.z + 0.85, 'layout');
  layoutRefs.pallet = g;
}
function buildCounter() {
  const g = new THREE.Group();
  const base = boxMesh(2.8, 1.0, 0.95, 0x4a3b66); base.position.y = 0.5; g.add(base);
  const panel = boxMesh(2.6, 0.7, 0.04, 0x5b4a80); panel.position.set(0, 0.55, 0.49); g.add(panel);
  const top = new THREE.Mesh(new THREE.RoundedBoxGeometry(3.0, 0.09, 1.1, 2, 0.035),
    new THREE.MeshStandardMaterial({ color: 0xffd60a, roughness: 0.22, metalness: 0.85, emissive: 0x2e1c00, envMap: getEnvMap(), envMapIntensity: 1.1 }));
  top.position.y = 1.05; top.castShadow = true; top.receiveShadow = true; g.add(top);
  const stripe = boxMesh(2.8, 0.16, 0.02, 0x7b2ff7); stripe.position.set(0, 0.72, 0.52); g.add(stripe);
  const term = boxMesh(0.42, 0.3, 0.06, 0x17121f); term.position.set(-1.0, 1.37, 0.2); term.rotation.x = -0.25; g.add(term);
  if (!window.__qrScreenTex) {
    window.__qrScreenTex = makeCanvas(128, 96, (g, w, h) => {
      g.fillStyle = '#06180e'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(70,255,150,0.25)';
      for (let y = 8; y < h - 10; y += 6) { g.beginPath(); g.moveTo(8, y); g.lineTo(w - 8, y); g.stroke(); }
      // QR-подобная матрица
      g.fillStyle = '#46ff96';
      const cell = 6, ox = 14, oy = 10;
      const rng = (i) => ((i * 2654435761) >>> 0) % 100 < 46;
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (rng(r * 31 + c * 7 + 13)) g.fillRect(ox + c * cell, oy + r * cell, cell - 1.5, cell - 1.5);
      // уголки-«поисковики» QR
      const finder = (x, y) => { g.fillStyle = '#46ff96'; g.fillRect(x, y, 15, 15); g.fillStyle = '#06180e'; g.fillRect(x + 3, y + 3, 9, 9); g.fillStyle = '#46ff96'; g.fillRect(x + 5.5, y + 5.5, 4, 4); };
      finder(w - 26, 8); finder(10, h - 22);
      g.fillStyle = 'rgba(70,255,150,0.9)'; g.font = 'bold 11px monospace';
      g.fillText('WB·QR', 44, h - 8);
    });
  }
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.26), new THREE.MeshBasicMaterial({ map: window.__qrScreenTex }));
  screen.position.set(0, 0, 0.032); term.add(screen);
  const termStand = cylMesh(0.03, 0.05, 0.28, 0x2b233c); termStand.position.set(-1.0, 1.22, 0.2); g.add(termStand);
  g.position.set(COUNTER_POS.x, 0, COUNTER_POS.z);
  world.add(g);
  addCollider(COUNTER_POS.x - 1.5, COUNTER_POS.x + 1.5, COUNTER_POS.z - 0.5, COUNTER_POS.z + 0.5, 'layout');
  tagInteract(g, 'counter');
  tagInteract(term, 'qr');
  furniture.counter = g;
  layoutRefs.counter = g;
  layoutRefs.counterTerm = term;
}
// Фирменная вывеска с названием ПВЗ (пересобирается под имя игрока)
let nameBoard = null;
function buildNameBoard(name, logo) {
  if (nameBoard) { scene.remove(nameBoard); }
  const tex = TEX.nameBoard(name, logo);
  const board = new THREE.Group();
  const back = boxMesh(2.6, 0.62, 0.1, 0x241640); board.add(back);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2.45, 0.5), new THREE.MeshBasicMaterial({ map: tex }));
  face.position.z = 0.055; board.add(face);
  board.position.set(COUNTER_POS.x, 2.35, COUNTER_POS.z);
  board.rotation.y = 0;
  scene.add(board);
  nameBoard = board;
}
function buildUnpackTable() {
  const g = new THREE.Group();
  const top = boxMesh(2.3, 0.09, 1.3, 0xc8ccd6); top.position.y = 0.92; g.add(top);
  for (const [lx, lz] of [[-1.0, -0.5], [1.0, -0.5], [-1.0, 0.5], [1.0, 0.5]]) {
    const leg = boxMesh(0.09, 0.9, 0.09, 0x6b6f7c); leg.position.set(lx, 0.45, lz); g.add(leg);
  }
  const tape = cylMesh(0.09, 0.09, 0.07, 0xff8a00); tape.rotation.z = Math.PI / 2; tape.position.set(0.6, 1.0, 0.2); g.add(tape);
  const knife = boxMesh(0.3, 0.04, 0.09, 0xd43d3d); knife.position.set(-0.5, 0.985, 0.25); g.add(knife);
  g.position.set(TABLE_POS.x, 0, TABLE_POS.z);
  world.add(g);
  addCollider(TABLE_POS.x - 1.25, TABLE_POS.x + 1.25, TABLE_POS.z - 0.75, TABLE_POS.z + 0.7, 'layout');
  tagInteract(g, 'table');
  furniture.table = g;
  layoutRefs.table = g;
}
function buildBin() {
  const g = new THREE.Group();
  const body = cylMesh(0.4, 0.34, 0.95, 0xffd60a, 16); body.position.y = 0.48; g.add(body);
  const lid = cylMesh(0.43, 0.43, 0.12, 0x241f2e, 16); lid.position.y = 1.0; g.add(lid);
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.31), new THREE.MeshBasicMaterial({ map: TEX.bin() }));
  label.position.set(0, 0.55, 0.41); g.add(label);
  g.position.set(BIN_POS.x, 0, BIN_POS.z);
  world.add(g);
  addCollider(BIN_POS.x - 0.5, BIN_POS.x + 0.5, BIN_POS.z - 0.45, BIN_POS.z + 0.45, 'layout');
  tagInteract(g, 'bin');
  layoutRefs.bin = g;
}
function buildShelf(slotIndex) {
  const slotX = [-5.85, -1.95, 1.95, 5.85][slotIndex];
  const g = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x6d35d6, roughness: 0.38, metalness: 0.6 });
  const boardMat = new THREE.MeshStandardMaterial({ color: 0xd8d4e2, roughness: 0.55, metalness: 0.25 });
  const W = 3.3, H = 2.15, D = 0.72;
  for (const sx of [-W / 2, W / 2]) for (const sz of [-D / 2, D / 2]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, H, 0.1), frameMat);
    post.position.set(sx, H / 2, sz); post.castShadow = true; g.add(post);
  }
  for (const y of [0.42, 1.32, H]) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(W, 0.07, D), boardMat);
    board.position.set(0, y, 0); board.receiveShadow = true; board.castShadow = true; g.add(board);
  }
  for (const dx of [-0.88, 0.88]) {
    const div = new THREE.Mesh(new THREE.BoxGeometry(0.05, H - 0.3, D - 0.06), frameMat);
    div.position.set(dx, H / 2 + 0.05, 0); g.add(div);
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.05), new THREE.MeshLambertMaterial({ color: 0x8a83a0 }));
  back.position.set(0, H / 2, -D / 2); g.add(back);
  const plate = boxMesh(1.4, 0.24, 0.04, 0xffd60a); plate.position.set(0, H + 0.14, 0); g.add(plate);
  g.position.set(slotX, 0, -4.95);
  world.add(g);
  addCollider(slotX - W / 2 - 0.05, slotX + W / 2 + 0.05, -5.35, -4.5);

  const cells = [];
  const cellOffsets = [-1.32, -0.44, 0.44, 1.32];
  // невидимые хитбоксы ячеек — чтобы кликать даже по пустой ячейке
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      const x = slotX + cellOffsets[col];
      const y = row === 0 ? 0.46 : 1.36;
      const cell = { shelf: slotIndex, row, col, x, y, z: -4.88, parcel: null };
      const hit = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.62, 0.6), hitMat);
      hit.position.set(x, y + 0.16, -4.85);
      world.add(hit);
      tagInteract(hit, 'cell', { cell });
      cells.push(cell);
    }
  }
  return { slotIndex, x: slotX, group: g, cells };
}
const shelves = [];
function addShelf(index) {
  const s = buildShelf(index);
  shelves.push(s);
  return s;
}
function buildCoffeeMachine() {
  const g = new THREE.Group();
  const body = boxMesh(0.42, 0.42, 0.36, 0x241f2e); body.position.y = 0.21; g.add(body);
  const spout = boxMesh(0.1, 0.1, 0.12, 0x8a8f9e); spout.position.set(0, 0.14, 0.24); g.add(spout);
  const cup = cylMesh(0.05, 0.04, 0.08, 0xffffff, 10); cup.position.set(0, 0.04, 0.26); g.add(cup);
  const lampDot = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), new THREE.MeshBasicMaterial({ color: 0x2ee6a8 }));
  lampDot.position.set(0.12, 0.36, 0.19); g.add(lampDot);
  g.position.set(COUNTER_POS.x - 1.05, 1.1, COUNTER_POS.z - 0.05);
  world.add(g);
  coffeeMachineRef = g;
}
function buildPoster() {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.45), new THREE.MeshLambertMaterial({ map: TEX.poster() }));
  p.position.set(0, 1.75, -ROOM.z + 0.17);
  world.add(p);
}
function buildSign() {
  const s = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.55), new THREE.MeshBasicMaterial({ map: TEX.sign() }));
  s.position.set(0, 2.62, ROOM.z + 0.2);
  world.add(s);
}

// ============================================================
//  Мебель как РАЗМЕЩАЕМЫЕ предметы
// ============================================================
function makeRug() {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.1), new THREE.MeshLambertMaterial({ map: TEX.rugB() }));
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  const g = new THREE.Group(); g.add(m); m.position.y = 0.012;
  return { group: g, footprint: 0, collider: null };
}
function makeSofa() {
  const g = new THREE.Group();
  const base = boxMesh(2.3, 0.45, 1.0, 0xe2626b); base.position.y = 0.32; g.add(base);
  const back = boxMesh(2.3, 0.62, 0.24, 0xc94f58); back.position.set(0, 0.75, -0.38); g.add(back);
  for (const sx of [-1.05, 1.05]) { const arm = boxMesh(0.24, 0.35, 1.0, 0xc94f58); arm.position.set(sx, 0.62, 0); g.add(arm); }
  for (const sx of [-0.58, 0.58]) { const cushion = boxMesh(1.02, 0.16, 0.78, 0xf27f87); cushion.position.set(sx, 0.6, 0.06); g.add(cushion); }
  const pillow1 = boxMesh(0.42, 0.42, 0.14, 0xffe14d); pillow1.position.set(-0.7, 0.85, -0.28); pillow1.rotation.z = 0.2; g.add(pillow1);
  const pillow2 = boxMesh(0.42, 0.42, 0.14, 0x4cc9f0); pillow2.position.set(0.7, 0.85, -0.28); pillow2.rotation.z = -0.2; g.add(pillow2);
  return { group: g, footprint: 1.25, collider: { dx: 1.2, dz: 0.55 } };
}
function makeArmchair() {
  const g = new THREE.Group();
  const base = boxMesh(0.95, 0.4, 0.85, 0x3fa7a0); base.position.y = 0.3; g.add(base);
  const back = boxMesh(0.95, 0.6, 0.2, 0x2f8a84); back.position.set(0, 0.72, -0.32); g.add(back);
  for (const sx of [-0.42, 0.42]) { const arm = boxMesh(0.14, 0.3, 0.85, 0x2f8a84); arm.position.set(sx, 0.56, 0); g.add(arm); }
  const cushion = boxMesh(0.62, 0.13, 0.6, 0x5cc4bd); cushion.position.set(0, 0.55, 0.05); g.add(cushion);
  return { group: g, footprint: 0.72, collider: { dx: 0.52, dz: 0.48 } };
}
function makePlant() {
  const g = new THREE.Group();
  const pot = cylMesh(0.24, 0.18, 0.4, 0xd47b3a, 12); pot.position.y = 0.2; g.add(pot);
  const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), new THREE.MeshLambertMaterial({ color: 0x2f9e63, flatShading: true }));
  bush.position.y = 0.78; bush.castShadow = true; g.add(bush);
  const bush2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), new THREE.MeshLambertMaterial({ color: 0x3fbf77, flatShading: true }));
  bush2.position.set(0.18, 1.1, 0.1); bush2.castShadow = true; g.add(bush2);
  return { group: g, footprint: 0.45, collider: { dx: 0.3, dz: 0.3 } };
}
function makePalm() {
  const g = new THREE.Group();
  const pot = cylMesh(0.3, 0.24, 0.42, 0xe8e2d4, 14); pot.position.y = 0.21; g.add(pot);
  const trunk = cylMesh(0.09, 0.14, 1.5, 0x8a6136, 10); trunk.position.y = 1.1; g.add(trunk);
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.15, 4),
      new THREE.MeshLambertMaterial({ color: i % 2 ? 0x2f9e63 : 0x3fbf77, flatShading: true }));
    const angle = (i / 6) * Math.PI * 2;
    leaf.position.set(Math.cos(angle) * 0.42, 1.92, Math.sin(angle) * 0.42);
    leaf.rotation.z = Math.cos(angle) * 1.05;
    leaf.rotation.x = Math.sin(angle) * 1.05;
    leaf.castShadow = true;
    g.add(leaf);
  }
  const nut = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), new THREE.MeshLambertMaterial({ color: 0x6b4a2f }));
  nut.position.y = 1.92; g.add(nut);
  return { group: g, footprint: 0.55, collider: { dx: 0.35, dz: 0.35 } };
}
function makeCoatRack() {
  const g = new THREE.Group();
  const base = cylMesh(0.3, 0.34, 0.06, 0x241f2e, 14); base.position.y = 0.03; g.add(base);
  const pole = cylMesh(0.045, 0.045, 1.8, 0x3f3a4d, 8); pole.position.y = 0.95; g.add(pole);
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + 0.4;
    const hook = cylMesh(0.03, 0.03, 0.34, 0xffd60a, 6);
    hook.position.set(Math.cos(angle) * 0.16, 1.62 - (i % 2) * 0.28, Math.sin(angle) * 0.16);
    hook.rotation.z = Math.PI / 2.4;
    hook.rotation.y = -angle;
    g.add(hook);
  }
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshLambertMaterial({ color: 0xffd60a }));
  cap.position.y = 1.9; g.add(cap);
  return { group: g, footprint: 0.36, collider: { dx: 0.24, dz: 0.24 } };
}
function makeGreenWall() {
  const g = new THREE.Group();
  for (const sx of [-0.8, 0.8]) { const leg = boxMesh(0.08, 0.5, 0.3, 0x3f3a4d); leg.position.set(sx, 0.25, 0); g.add(leg); }
  const panel = boxMesh(1.9, 1.55, 0.16, 0x1d3a2a); panel.position.y = 1.3; g.add(panel);
  const leafCols = [0x2f9e63, 0x3fbf77, 0x53d183, 0x1f7a45];
  for (let i = 0; i < 14; i++) {
    const r = rand(0.11, 0.17);
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0),
      new THREE.MeshLambertMaterial({ color: choice(leafCols), flatShading: true }));
    ball.position.set(rand(-0.78, 0.78), rand(0.7, 1.95), 0.12);
    ball.castShadow = true;
    g.add(ball);
  }
  for (let i = 0; i < 4; i++) {
    const flower = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6),
      new THREE.MeshBasicMaterial({ color: choice([0xff8ad4, 0xffe14d, 0xff5c7a]) }));
    flower.position.set(rand(-0.7, 0.7), rand(0.8, 1.9), 0.185);
    g.add(flower);
  }
  return { group: g, footprint: 0.75, collider: { dx: 0.98, dz: 0.24 } };
}
function makeNeon() {
  const g = new THREE.Group();
  for (const sx of [-0.62, 0.62]) { const post = boxMesh(0.08, 1.75, 0.08, 0x241f2e); post.position.set(sx, 0.875, 0); g.add(post); }
  const base = boxMesh(1.5, 0.08, 0.5, 0x241f2e); base.position.y = 0.04; g.add(base);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 0.85), new THREE.MeshBasicMaterial({ map: TEX.neon() }));
  panel.position.set(0, 1.25, 0); g.add(panel);
  const frame = boxMesh(1.45, 0.95, 0.06, 0x150a26); frame.position.set(0, 1.25, -0.045); g.add(frame);
  return { group: g, footprint: 0.55, collider: { dx: 0.72, dz: 0.28 } };
}
const FURNITURE_FACTORY = {
  sofa: makeSofa, armchair: makeArmchair, plant: makePlant, palm: makePalm,
  coatrack: makeCoatRack, greenwall: makeGreenWall, rug: makeRug, neon: makeNeon,
};
const FURNITURE_NAMES = {
  sofa: 'Диван «Комфорт»', armchair: 'Кресло «Тишина»', plant: 'Растение в кашпо',
  palm: 'Пальма «Марракеш»', coatrack: 'Вешалка «Зима»', greenwall: 'Фитостена «Дыши»',
  rug: 'Ковёр «Тюльпаны»', neon: 'Неоновое панно «24/7»',
};

// ============================================================
//  Предметы: короба и посылки
// ============================================================
const PARCEL_COLORS = [0xffd60a, 0xff8a00, 0x4cc9f0, 0xf72585, 0xb388ff, 0x90be6d];
const TYPE_INFO = {
  normal:  { sub: null,         color: null },
  fragile: { sub: '⚠ ХРУПКОЕ',  color: 0xff6b3d },
  thermal: { sub: '❄ ТЕРМО',    color: 0x2ee6a8 },
  defect:  { sub: '✖ БРАК',     color: 0xe0455a },
  bulky:   { sub: '📦 ГАБАРИТ', color: 0xffc21c },
  express: { sub: '⚡ ЭКСПРЕСС', color: 0xffa200 },
};
const TYPE_SHORT = { fragile: ' · ⚠ ХРУПКОЕ', thermal: ' · ❄ ТЕРМО', defect: ' · ✖ БРАК', bulky: ' · 📦 ГАБАРИТ', express: ' · ⚡ ЭКСПРЕСС' };
const floorItems = [];
const bigBoxes = [];
const parcels = [];

function makeBigBoxMesh() {
  const g = new THREE.Group();
  const body = boxMesh(0.95, 0.68, 0.72, 0xc8a06a); body.position.y = 0.34; g.add(body);
  const tape = boxMesh(0.97, 0.69, 0.16, 0x8a6136); tape.position.y = 0.34; g.add(tape);
  const fragile = boxMesh(0.3, 0.2, 0.02, 0xffffff); fragile.position.set(0, 0.4, 0.37); g.add(fragile);
  // Крышки — отдельные пивоты, чтобы играть «вскрытие коробки»
  const flapMat = new THREE.MeshLambertMaterial({ color: 0xb98a5a });
  const mkFlap = (w, h, d, px, pz, childX, childZ) => {
    const pivot = new THREE.Group();
    pivot.position.set(px, 0.68, pz);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), flapMat);
    m.position.set(childX, 0.026, childZ);
    m.castShadow = true;
    pivot.add(m); g.add(pivot);
    return pivot;
  };
  const hit = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.0, 0.95), HIT_MAT); hit.position.y = 0.42; g.add(hit);
  addBlobShadow(g, 1.35, 1.1);
  const front = mkFlap(0.93, 0.05, 0.35, 0, 0.36, 0, -0.175);
  const back = mkFlap(0.93, 0.05, 0.35, 0, -0.36, 0, 0.175);
  const left = mkFlap(0.35, 0.05, 0.62, -0.475, 0, 0.175, 0);
  const right = mkFlap(0.35, 0.05, 0.62, 0.475, 0, -0.175, 0);
  left.position.y = right.position.y = 0.735;
  g.userData.flaps = { front, back, left, right };
  return g;
}
const BIGBOX_OFFSETS = [[-0.15, -0.5], [0.85, 0.2], [-0.4, 0.62]];
function spawnBigBox() {
  // ищем свободный слот у паллеты — короба не должны наползать друг на друга
  let spot = null;
  for (const [ox, oz] of BIGBOX_OFFSETS) {
    const px = PALLET_POS.x + ox, pz = PALLET_POS.z + oz;
    const busy = bigBoxes.some(b => Math.hypot(b.position.x - px, b.position.z - pz) < 1.0);
    if (!busy) { spot = [px, pz]; break; }
  }
  if (!spot) return null; // у паллеты места нет — поставка подождёт
  const mesh = makeBigBoxMesh();
  mesh.position.set(spot[0] + rand(-0.05, 0.05), 0.16, spot[1] + rand(-0.05, 0.05));
  mesh.rotation.y = rand(-0.12, 0.12);
  world.add(mesh);
  const item = { kind: 'big', mesh, docScanned: false };
  floorItems.push(item);
  bigBoxes.push(mesh);
  tagInteract(mesh, 'bigbox');
  return item;
}
let wbTapeMat = null;
function getWBTapeMat() {
  if (!wbTapeMat) {
    const tex = makeCanvas(256, 64, (g, w, h) => {
      g.fillStyle = '#ffd60a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#7b2ff7';
      for (let x = 0; x < w; x += 86) { g.font = '900 34px Arial Black, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('WB', x + 43, h / 2 + 1); }
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 0, w, 4); g.fillRect(0, h - 4, w, 4);
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    wbTapeMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.05 });
  }
  return wbTapeMat;
}
function makeParcelMesh(color) {
  const g = new THREE.Group();
  const body = boxMesh(0.36, 0.25, 0.29, color, { roughness: 0.55 }); body.position.y = 0.125; g.add(body);
  const tape = boxMesh(0.375, 0.255, 0.095, shade(color, -0.35), { roughness: 0.4 });
  if (Math.random() < 0.45) tape.material = getWBTapeMat();
  tape.position.y = 0.125; g.add(tape);
  const hit = new THREE.Mesh(HIT_BOX, HIT_MAT); hit.position.y = 0.16; g.add(hit);
  addBlobShadow(g, 0.48, 0.38);
  return g;
}
function shade(hex, amt) {
  const c = new THREE.Color(hex);
  if (amt < 0) c.multiplyScalar(1 + amt); else c.lerp(new THREE.Color(0xffffff), amt);
  return c.getHex();
}
function rollParcelType() {
  const r = Math.random();
  if (r < BALANCE.defectChance) return 'defect';
  if (r < BALANCE.defectChance + BALANCE.fragileChance) return 'fragile';
  if (r < BALANCE.defectChance + BALANCE.fragileChance + BALANCE.thermalChance) return 'thermal';
  if (r < BALANCE.defectChance + BALANCE.fragileChance + BALANCE.thermalChance + BALANCE.expressChance) return 'express';
  return 'normal';
}
function spawnParcel(x, z, y = 0, forceType = null, forceId = null) {
  const id = forceId || genOrderId();
  const type = forceType || rollParcelType();
  const color = TYPE_INFO[type].color || choice(PARCEL_COLORS);
  const mesh = type === 'bulky' ? makeBulkyMesh() : makeParcelMesh(color);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rand(-0.4, 0.4);
  world.add(mesh);
  const parcel = {
    id, color, mesh, type,
    label: null, cell: null, reservedBy: null,
    spoil: type === 'thermal' ? BALANCE.thermalSpoil : null,
  };
  parcels.push(parcel);
  floorItems.push({ kind: 'parcel', id, mesh, parcel });
  tagInteract(mesh, 'parcel');
  return parcel;
}
function removeParcelWorld(parcel) {
  if (parcel.cell) { parcel.cell.parcel = null; parcel.cell = null; }
  for (let i = floorItems.length - 1; i >= 0; i--) {
    if (floorItems[i].parcel === parcel) floorItems.splice(i, 1);
  }
  if (parcel.label && parcel.label.parent) parcel.label.parent.remove(parcel.label);
  parcel.label = null;
  untagInteract(parcel.mesh);
  if (parcel.mesh && parcel.mesh.parent) parcel.mesh.parent.remove(parcel.mesh);
  const pi = parcels.indexOf(parcel);
  if (pi >= 0) parcels.splice(pi, 1);
  if (G.carried && G.carried.parcel === parcel) { G.carried = null; updateHUD(); }
  if (G.activeOrder && G.activeOrder.parcel === parcel) clearOrderCard();
  const cust = parcel.reservedBy;
  if (cust && cust !== 'pending' && customers.includes(cust)) customerLeave(cust, 'angry', 0.5);
  parcelsDirty = true;
}

// ============================================================
//  Люди (с руками и лицами)
// ============================================================
// ---------- Стойка «Габарит»: сюда ставят крупные заказы ----------
let bulkyTapeTex = null;
let bulkyTapeMat = null;
function getBulkyTapeTexture() {
  if (bulkyTapeTex) return bulkyTapeTex;
  bulkyTapeTex = makeCanvas(256, 64, (g, w, h) => {
    g.fillStyle = '#ffd60a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#17121f';
    for (let x = -h; x < w + h; x += 32) {
      g.beginPath();
      g.moveTo(x, h); g.lineTo(x + h, 0); g.lineTo(x + h + 12, 0); g.lineTo(x + 12, h);
      g.closePath(); g.fill();
    }
  });
  bulkyTapeTex.wrapS = bulkyTapeTex.wrapT = THREE.RepeatWrapping;
  return bulkyTapeTex;
}
function getBulkyTapeMat() {
  if (!bulkyTapeMat) bulkyTapeMat = new THREE.MeshStandardMaterial({ map: getBulkyTapeTexture(), roughness: 0.5 });
  return bulkyTapeMat;
}
function makeBulkyMesh() {
  const g = new THREE.Group();
  const body = boxMesh(0.74, 0.5, 0.58, 0xffc21c, { roughness: 0.5 }); body.position.y = 0.25; g.add(body);
  const tape = boxMesh(0.76, 0.505, 0.2, 0xffffff, { roughness: 0.45 }); tape.material = getBulkyTapeMat(); tape.position.y = 0.25; g.add(tape);
  const stencil = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.16), new THREE.MeshBasicMaterial({
    map: makeCanvas(256, 80, (ctx, w, h2) => {
      ctx.fillStyle = '#ffc21c'; ctx.fillRect(0, 0, w, h2);
      ctx.fillStyle = '#17121f'; ctx.font = '900 44px Manrope, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('ГАБАРИТ', w / 2, h2 / 2 + 2);
    }), transparent: false }));
  stencil.position.set(0, 0.28, 0.295); g.add(stencil);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.7, 0.8), HIT_MAT); hit.position.y = 0.28; hit.visible = false; g.add(hit);
  addBlobShadow(g, 0.95, 0.75);
  return g;
}
function buildBulkyRack() {
  const g = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a3152, roughness: 0.4, metalness: 0.55 });
  const boardMat = new THREE.MeshStandardMaterial({ color: 0x554a73, roughness: 0.55, metalness: 0.25 });
  const W = 1.55, D = 0.85, H = 2.32;
  for (const sx of [-W / 2, W / 2]) for (const sz of [-D / 2, D / 2]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, H, 0.09), frameMat);
    post.position.set(sx, H / 2, sz); post.castShadow = true; g.add(post);
  }
  const boardsY = [0.34, 1.14, 1.94];
  for (const y of boardsY) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(W, 0.07, D), boardMat);
    board.position.set(0, y - 0.035, 0); board.receiveShadow = true; board.castShadow = true; g.add(board);
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.05), new THREE.MeshLambertMaterial({ color: 0x2a2438 }));
  back.position.set(0, H / 2, -D / 2 + 0.02); g.add(back);
  // табличка ГАБАРИТ
  const plateTex = makeCanvas(512, 128, (ctx, w, h2) => {
    ctx.fillStyle = '#17121f'; ctx.fillRect(0, 0, w, h2);
    ctx.fillStyle = '#ffd60a'; ctx.font = '900 62px Manrope, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('ГАБАРИТ', w / 2, h2 / 2 + 2);
  });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.32), new THREE.MeshBasicMaterial({ map: plateTex }));
  plate.position.set(0, 2.62, 0.02); g.add(plate);
  // полоса-предупреждение у основания
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(W + 0.06, 0.16, 0.02), new THREE.MeshStandardMaterial({ map: getBulkyTapeTexture(), roughness: 0.6 }));
  stripe.position.set(0, 0.08, D / 2 + 0.012); g.add(stripe);
  g.position.set(BULKY_RACK.x, 0, BULKY_RACK.z);
  g.rotation.y = Math.PI / 2; // лицом в зал
  world.add(g);
  addCollider(BULKY_RACK.x - 0.5, BULKY_RACK.x + 0.5, BULKY_RACK.z - 0.9, BULKY_RACK.z + 0.9);
  return g;
}
function buildFridge() {
  const g = new THREE.Group();
  const body = boxMesh(0.98, 1.9, 0.78, 0xdfe3ea, { roughness: 0.32, metalness: 0.6 }); body.position.y = 0.95; g.add(body);
  const split = boxMesh(0.99, 0.025, 0.79, 0x9aa0ad, { roughness: 0.4, metalness: 0.5 }); split.position.y = 1.12; g.add(split);
  for (const hy of [1.32, 0.78]) {
    const handle = boxMesh(0.05, 0.34, 0.05, 0x8a8f9e, { roughness: 0.35, metalness: 0.7 });
    handle.position.set(0.36, hy, 0.42); g.add(handle);
  }
  const sticker = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.16), new THREE.MeshBasicMaterial({
    map: makeCanvas(256, 120, (ctx, w, h2) => {
      ctx.fillStyle = '#7b2ff7'; ctx.fillRect(0, 0, w, h2);
      ctx.fillStyle = '#ffe95c'; ctx.font = '900 44px Manrope, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('ЛАНЧ', w / 2, h2 / 2 + 2);
    }) }));
  sticker.position.set(-0.12, 0.62, 0.398); g.add(sticker);
  g.position.set(FRIDGE_POS.x, 0, FRIDGE_POS.z);
  g.rotation.y = -Math.PI / 2; // дверцей в зал
  world.add(g);
  addCollider(FRIDGE_POS.x - 0.5, FRIDGE_POS.x + 0.5, FRIDGE_POS.z - 0.62, FRIDGE_POS.z + 0.62);
}
function buildWC() {
  const g = new THREE.Group();
  const cabin = boxMesh(1.4, 2.28, 1.2, 0x6a35cf, { roughness: 0.55 }); cabin.position.y = 1.14; g.add(cabin);
  const roof = boxMesh(1.5, 0.09, 1.3, 0x4a12a5, { roughness: 0.5 }); roof.position.y = 2.32; g.add(roof);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 1.7), new THREE.MeshStandardMaterial({ color: 0xf3eefc, roughness: 0.6 }));
  door.position.set(0, 1.02, 0.605); g.add(door);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffd60a, roughness: 0.35, metalness: 0.6 }));
  knob.position.set(0.28, 1.02, 0.66); g.add(knob);
  const signTex = makeCanvas(256, 160, (ctx, w, h2) => {
    ctx.fillStyle = '#241a33'; ctx.fillRect(0, 0, w, h2);
    ctx.fillStyle = '#ffe95c'; ctx.font = '900 88px Manrope, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('WC', w / 2, h2 / 2 + 2);
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.4), new THREE.MeshBasicMaterial({ map: signTex }));
  sign.position.set(0, 2.02, 0.612); g.add(sign);
  g.position.set(WC_POS.x, 0, WC_POS.z);
  g.rotation.y = -Math.PI / 2; // дверью в зал
  world.add(g);
  addCollider(WC_POS.x - 0.65, WC_POS.x + 0.65, WC_POS.z - 0.75, WC_POS.z + 0.75);
}

function makePerson({ body = 0x7b2ff7, skin = 0xf2c9a0, pants = 0x2b233c, hat = null, scale = 1, hair = null }) {
  const g = new THREE.Group();
  const limbMat = (c, rough = 0.8, emissive = 0x000000) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0.02, emissive });
  const skinMat = (c, rough = 0.6) => limbMat(c, rough, 0x1a0d07);
  // ---- ноги: группы в тазобедренных суставах, качание естественнее ----
  const hipY = 0.86;
  const mkLeg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(0.135 * side, hipY, 0);
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.075, 0.40, 14), limbMat(pants, 0.8));
    thigh.position.y = -0.20; thigh.castShadow = true; hip.add(thigh);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.058, 0.35, 14), limbMat(pants, 0.8));
    shin.position.y = -0.555; shin.castShadow = true; hip.add(shin);
    const shoe = boxMesh(0.17, 0.085, 0.30, 0x241f2e, { roughness: 0.45 }); shoe.position.set(0, -0.795, 0.055); hip.add(shoe);
    g.add(hip);
    return hip;
  };
  const legL = mkLeg(-1), legR = mkLeg(1);
  // ---- торс: мягкий силуэт, белый воротник как в форме WB ----
  const torso = boxMesh(0.47, 0.60, 0.27, body, { roughness: 0.75 }); torso.position.y = 1.17; g.add(torso);
  const stripe = boxMesh(0.34, 0.075, 0.275, 0xffd60a, { roughness: 0.55 }); stripe.position.y = 1.26; g.add(stripe);
  const collar = boxMesh(0.24, 0.05, 0.275, 0xf6f2ea, { roughness: 0.6 }); collar.position.y = 1.455; g.add(collar);
  const belt = boxMesh(0.435, 0.06, 0.255, 0x241640, { roughness: 0.6 }); belt.position.y = 0.92; g.add(belt);
  // ---- шея и голова ----
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.1, 10), skinMat(skin, 0.72));
  neck.position.y = 1.49; neck.castShadow = true; g.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.158, 20, 16), skinMat(skin, 0.58));
  head.position.y = 1.60; head.castShadow = true; g.add(head);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.017, 8, 6), limbMat(shade(skin, -0.18), 0.6));
  nose.position.set(0, 1.583, 0.152); g.add(nose);
  // глаза: белок + зрачок, спокойное дружеское лицо
  const white = new THREE.MeshBasicMaterial({ color: 0xfdfbf7 });
  const pupil = new THREE.MeshBasicMaterial({ color: 0x241f2e });
  for (const ex of [-0.058, 0.058]) {
    const wme = new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 8), white);
    wme.position.set(ex, 1.615, 0.138); wme.scale.z = 0.6; g.add(wme);
    const pm = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), pupil);
    pm.position.set(ex, 1.615, 0.157); pm.scale.z = 0.6; g.add(pm);
  }
  // лёгкий румянец — уютише
  const blush = new THREE.MeshBasicMaterial({ color: 0xff9d9d, transparent: true, opacity: 0.32 });
  for (const ex of [-0.096, 0.096]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), blush);
    b.position.set(ex, 1.565, 0.138); b.scale.z = 0.4; g.add(b);
  }
  // волосы / кепка
  // брови (анимируются эмоцией)
  const browL = boxMesh(0.052, 0.013, 0.012, 0x2b233c, { castShadow: false });
  browL.position.set(-0.058, 1.683, 0.143); g.add(browL);
  const browR = boxMesh(0.052, 0.013, 0.012, 0x2b233c, { castShadow: false });
  browR.position.set(0.058, 1.683, 0.143); g.add(browR);
  // рот — дуга (улыбка/нейтраль/хмурый)
  const mouth = new THREE.Mesh(
    new THREE.TorusGeometry(0.05, 0.0095, 6, 12, 1.15),
    new THREE.MeshStandardMaterial({ color: 0x6a4030, roughness: 0.65 })
  );
  mouth.position.set(0, 1.546, 0.152);
  mouth.rotation.z = MOUTH_SMILE;
  g.add(mouth);
  if (hair !== null && hat === null) {
    const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(0.166, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2.05),
      limbMat(hair, 0.7));
    hairMesh.position.y = 1.603; hairMesh.scale.y = 0.94; hairMesh.castShadow = true; g.add(hairMesh);
    const back = boxMesh(0.2, 0.09, 0.06, hair, { roughness: 0.7 }); back.position.set(0, 1.545, -0.115); g.add(back);
  }
  if (hat !== null) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.163, 0.169, 0.115, 16), limbMat(hat, 0.7));
    cap.position.y = 1.715; cap.castShadow = true; g.add(cap);
    const brim = boxMesh(0.27, 0.028, 0.17, hat, { roughness: 0.7 }); brim.position.set(0, 1.66, 0.16); g.add(brim);
  }
  // ---- руки: плечо → предплечье → кисть, группы в плечевых суставах ----
  const mkArm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.272 * side, 1.385, 0);
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.082, 12, 10), limbMat(body, 0.75));
    pad.position.y = 0.012; pad.castShadow = true; shoulder.add(pad);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.052, 0.28, 12), limbMat(body, 0.78));
    upper.position.y = -0.165; upper.castShadow = true; shoulder.add(upper);
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.049, 0.045, 0.25, 12), skinMat(skin, 0.66));
    fore.position.y = -0.42; fore.castShadow = true; shoulder.add(fore);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.063, 12, 10), skinMat(skin, 0.55));
    hand.position.y = -0.565; hand.castShadow = true; shoulder.add(hand);
    shoulder.rotation.z = side * 0.17;
    g.add(shoulder);
    return shoulder;
  };
  const armL = mkArm(-1), armR = mkArm(1);
  g.scale.setScalar(scale);
  addBlobShadow(g, 1.04, 0.8);
  g.userData.legs = [legL, legR];
  g.userData.arms = [armL, armR];
  g.userData.brows = [browL, browR];
  g.userData.mouth = mouth;
  g.userData.faceMood = 'neutral';
  return g;
}

// ---------- эмоции на лице ----------
const MOUTH_SMILE = Math.PI * 1.5 - 0.575;
function setFaceMood(g, mood) {
  const { brows, mouth } = g.userData;
  if (!brows || !mouth) return;
  if (mood === 'happy' || mood === 'served') {
    brows[0].rotation.z = 0.13; brows[1].rotation.z = -0.13;
    mouth.rotation.z = MOUTH_SMILE; mouth.scale.y = 1.45;
  } else if (mood === 'angry') {
    brows[0].rotation.z = -0.27; brows[1].rotation.z = 0.27;
    mouth.rotation.z = MOUTH_SMILE + Math.PI; mouth.scale.y = 1.0;
  } else {
    brows[0].rotation.z = 0; brows[1].rotation.z = 0;
    mouth.rotation.z = MOUTH_SMILE; mouth.scale.y = 0.22;
  }
}
function updateFaces() {
  for (const c of customers) {
    if (c.mood === 'served' || c.mood === 'angry') continue;
    const f = c.patienceMax > 0 ? clamp(c.patience / c.patienceMax, 0, 1) : 1;
    const mood = f > 0.62 ? 'happy' : f > 0.3 ? 'neutral' : 'angry';
    if (c.faceMood !== mood) { c.faceMood = mood; setFaceMood(c.mesh, mood); }
  }
}
function animateWalk(mesh, phase, carrying) {
  const { legs, arms } = mesh.userData;
  if (legs) {
    legs[0].rotation.x = Math.sin(phase) * 0.7;
    legs[1].rotation.x = -Math.sin(phase) * 0.7;
  }
  if (arms) {
    if (carrying) {
      arms[0].rotation.x = -1.02 + Math.sin(phase * 2) * 0.05;
      arms[1].rotation.x = -1.02 - Math.sin(phase * 2) * 0.05;
      arms[0].rotation.z = -0.34; arms[1].rotation.z = 0.34;
    } else {
      arms[0].rotation.x = -Math.sin(phase) * 0.55;
      arms[1].rotation.x = Math.sin(phase) * 0.55;
      arms[0].rotation.z = -0.17; arms[1].rotation.z = 0.17;
    }
  }
}
const player = makePerson({ body: 0x7b2ff7, skin: 0xf0c39a, pants: 0x241f2e, hat: 0xffd60a });
player.position.set(0, 0, 2.6);
scene.add(player);

// ============================================================
//  Клиенты
// ============================================================
const SKIN = [0xf2c9a0, 0xe0ac82, 0xc98a5b, 0x8a5a3b, 0xffd9b8];
const BODY = [0x4cc9f0, 0xf72585, 0x2ee6a8, 0xff8a00, 0xb388ff, 0x90be6d, 0xe2626b];
const HAIR = [0x2b233c, 0x4a3b2f, 0x8a6136, 0xd8d4e2, 0xa83232];
const customers = [];
const QUEUE_SLOTS = [new THREE.Vector3(4.0, 0, 3.75), new THREE.Vector3(5.25, 0, 4.15), new THREE.Vector3(6.5, 0, 4.35)];
const bubblesEl = document.getElementById('bubbles');
let parcelsDirty = true;

function activeQueueCount() {
  return customers.filter(c => c.state !== 'leaving').length;
}
function makeBubble(html, cls) {
  const div = document.createElement('div');
  div.className = 'bubble' + (cls ? ' ' + cls : '');
  div.innerHTML = `<div class="b-title">${html}</div><div class="patience"><i style="width:100%"></i></div>`;
  bubblesEl.appendChild(div);
  return { div, bar: div.querySelector('.patience i'), title: div.querySelector('.b-title') };
}
function spawnCustomer() {
  const stored = parcels.filter(p => p.cell && !p.reservedBy && p.type !== 'defect');
  if (stored.length === 0) return null;
  const queueIndex = activeQueueCount();
  if (queueIndex >= QUEUE_SLOTS.length) return null;
  const parcel = choice(stored);
  parcel.reservedBy = 'pending';
  const isVip = Math.random() < BALANCE.vipChance;

  const mesh = makePerson({ body: choice(BODY), skin: choice(SKIN), pants: choice([0x2b233c, 0x3a4a63, 0x4a3b2f]), scale: rand(0.92, 1.08), hair: choice(HAIR) });
  const sx = rand(-0.9, 0.9);
  mesh.position.set(sx, 0, ROOM.z + 1.6);
  scene.add(mesh);

  const patienceMax = BALANCE.customerPatience
    * (G.upgrades.sofa ? BALANCE.sofaPatience : 1)
    * (G.upgrades.coffee ? BALANCE.coffeePatience : 1)
    * G.mods.patience
    * locBonus().patience
    * layoutStats().patience
    * (isVip ? BALANCE.vipPatienceMul : 1)
    * (parcel.type === 'express' ? BALANCE.expressPatienceMul : 1);

  const b = makeBubble(isVip ? '👑 VIP · Покажите QR' : '📱 Покажите QR', isVip ? 'vip' : null);

  const customer = {
    mesh, parcel, isReturn: false, slot: queueIndex, isVip,
    state: 'entering', qrScanned: false,
    patience: patienceMax, patienceMax,
    bubble: b.div, bubbleBar: b.bar, bubbleTitle: b.title,
    walkPhase: rand(0, 6),
    waypoints: [new THREE.Vector3(sx * 0.4, 0, ROOM.z - 0.4), QUEUE_SLOTS[queueIndex].clone()],
    wpIndex: 0,
  };
  parcel.reservedBy = customer;
  customers.push(customer);
  tagInteract(mesh, 'customer', { customer });
  relayoutQueue();
  AudioSys.door();
  return customer;
}
function spawnReturner() {
  const queueIndex = activeQueueCount();
  if (queueIndex >= QUEUE_SLOTS.length) return null;
  const mesh = makePerson({ body: choice(BODY), skin: choice(SKIN), pants: choice([0x2b233c, 0x3a4a63]), scale: rand(0.92, 1.06), hair: choice(HAIR) });
  const sx = rand(-0.9, 0.9);
  mesh.position.set(sx, 0, ROOM.z + 1.6);
  scene.add(mesh);
  const retId = genOrderId();
  const patienceMax = 40 * G.mods.patience * layoutStats().patience;
  const b = makeBubble('↩️ Возврат ' + retId);

  const customer = {
    mesh, parcel: null, isReturn: true, retId, slot: queueIndex,
    state: 'entering', qrScanned: true,
    patience: patienceMax, patienceMax,
    bubble: b.div, bubbleBar: b.bar, bubbleTitle: b.title,
    walkPhase: rand(0, 6),
    waypoints: [new THREE.Vector3(sx * 0.4, 0, ROOM.z - 0.4), QUEUE_SLOTS[queueIndex].clone()],
    wpIndex: 0,
  };
  customers.push(customer);
  tagInteract(mesh, 'customer', { customer });
  relayoutQueue();
  AudioSys.door();
  return customer;
}
function relayoutQueue() {
  let i = 0;
  for (const c of customers) {
    if (c.state === 'waiting' || c.state === 'entering') {
      c.slot = i++;
      c.waypoints = [new THREE.Vector3(c.mesh.position.x, 0, c.mesh.position.z), QUEUE_SLOTS[c.slot].clone()];
      c.wpIndex = 0;
    }
  }
}
function customerLeave(c, mood, penaltyMul = 1) {
  c.state = 'leaving';
  c.mood = mood;
  setFaceMood(c.mesh, mood === 'served' ? 'served' : 'angry');
  if (c.bubble) { c.bubble.remove(); c.bubble = null; }
  untagInteract(c.mesh);
  if (G.activeOrder && G.activeOrder.customer === c) clearOrderCard();
  c.waypoints = [new THREE.Vector3(c.mesh.position.x, 0, c.mesh.position.z), new THREE.Vector3(0, 0, ROOM.z + 1.8)];
  c.wpIndex = 0;
  if (mood === 'angry') {
    G.tipCombo = 0; updateComboChip();
    const loss = BALANCE.repLoss * (G.upgrades.plant ? 0.5 : 1) * (G.upgrades.greenwall ? 0.6 : 1) * G.mods.repLoss * penaltyMul;
    addRep(-loss);
    G.angryToday++;
    toast('Клиент ушёл недовольным… −репутация', 'bad');
    AudioSys.angry();
    if (c.parcel && c.parcel.reservedBy === c) c.parcel.reservedBy = null;
  }
}
function updateCustomers(dt) {
  for (const c of [...customers]) {
    if (c.state === 'entering' || c.state === 'leaving') {
      const target = c.waypoints[c.wpIndex];
      if (target) {
        const dir = new THREE.Vector3().subVectors(target, c.mesh.position); dir.y = 0;
        const dist = dir.length();
        if (dist < 0.12) {
          c.wpIndex++;
          if (c.wpIndex >= c.waypoints.length) {
            if (c.state === 'entering') c.state = 'waiting';
            else { removeCustomer(c); continue; }
          }
        } else {
          dir.normalize();
          c.mesh.position.addScaledVector(dir, Math.min(dist, 1.7 * dt));
          c.mesh.rotation.y = Math.atan2(dir.x, dir.z);
          c.walkPhase += dt * 9;
          animateWalk(c.mesh, c.walkPhase, false);
        }
      }
    } else if (c.state === 'waiting') {
      c.patience -= dt;
      const frac = clamp(c.patience / c.patienceMax, 0, 1);
      if (c.bubbleBar) c.bubbleBar.style.width = (frac * 100) + '%';
      if (c.bubble) {
        c.bubble.classList.toggle('soon', frac < 0.5 && frac >= 0.25);
        c.bubble.classList.toggle('critical', frac < 0.25);
      }
      c.mesh.rotation.y = Math.sin(performance.now() / 900 + c.walkPhase) * 0.25 + Math.PI;
      animateWalk(c.mesh, 0, false);
      if (c.patience <= 0) customerLeave(c, 'angry', c.isReturn ? 0.6 : 1);
    }
  }
}
function removeCustomer(c) {
  untagInteract(c.mesh);
  scene.remove(c.mesh);
  const i = customers.indexOf(c); if (i >= 0) customers.splice(i, 1);
  relayoutQueue();
}
function servedCustomerAtCounter(parcelId) {
  return customers.find(c => c.state !== 'leaving' && !c.isReturn && c.parcel && c.parcel.id === parcelId);
}
function waitingReturner() {
  return customers.find(c => c.state === 'waiting' && c.isReturn);
}
function unscannedWaiting() {
  return customers.find(c => c.state === 'waiting' && !c.isReturn && !c.qrScanned);
}

// ============================================================
//  Порядок выдачи: QR → заказ → выдача
// ============================================================
function beamBetween(a, b, color) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(0.025, 0.025, len, 6, 1, true);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}
function startQr(customer) {
  G.action = { type: 'qr', t: 0, dur: BALANCE.qrTime, customer };
  document.getElementById('scan-progress').classList.remove('hidden');
  document.getElementById('scan-fill').style.width = '0%';
  document.getElementById('scan-label').textContent = 'Сканируем QR клиента…';
  const from = new THREE.Vector3(COUNTER_POS.x - 1.0, 1.4, COUNTER_POS.z + 0.2);
  const to = customer.mesh.position.clone(); to.y = 1.0;
  G.qrLaser = beamBetween(from, to, 0xff2d55);
  scene.add(G.qrLaser);
  AudioSys.qr();
}
function finishQr() {
  const customer = G.action.customer;
  if (G.qrLaser) { scene.remove(G.qrLaser); G.qrLaser = null; }
  G.action = null;
  document.getElementById('scan-progress').classList.add('hidden');
  if (!customer || !customers.includes(customer) || customer.state === 'leaving') { updateHUD(); return; }
  customer.qrScanned = true;
  const parcel = customer.parcel;
  if (customer.bubbleTitle) customer.bubbleTitle.textContent = (customer.isVip ? '👑 ' : '') + '📦 ' + parcel.id;
  // Карточка заказа + маяк над нужной ячейкой
  G.activeOrder = { customer, parcel, qrAt: performance.now() };
  const oc = document.getElementById('order-card');
  oc.classList.remove('hidden');
  document.getElementById('oc-id').textContent = parcel.id;
  document.getElementById('oc-cell').innerHTML = cellLoc(parcel.cell);
  if (parcel.cell) setBeacon(parcel.cell);
  toast(`QR ✓ Заказ ${parcel.id} — ${cellLoc(parcel.cell)}`, 'good');
  AudioSys.qr();
  updateHUD();
}
const orderCard = document.getElementById('order-card');
const ocFill = document.getElementById('oc-fill');
const ocCell = document.getElementById('oc-cell');
function setBeaconAt(x, y, z) {
  clearBeacon();
  const geo = new THREE.CylinderGeometry(0.3, 0.42, 1.35, 12, 1, true);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd60a, transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  scene.add(m);
  G.beacon = m;
}
function setBeacon(cell) { setBeaconAt(cell.x, 1.75, cell.z); }
function clearOrderCard() {
  G.activeOrder = null;
  orderCard.classList.add('hidden');
  orderCard.classList.remove('critical');
  clearBeacon();
}
function clearBeacon() {
  if (G.beacon) { scene.remove(G.beacon); G.beacon = null; }
}
function updateOrderCard() {
  const o = G.activeOrder;
  if (!o) return;
  const c = o.customer;
  if (!customers.includes(c) || c.state === 'leaving') { clearOrderCard(); return; }
  const frac = clamp(c.patience / c.patienceMax, 0, 1);
  ocFill.style.width = (frac * 100) + '%';
  orderCard.classList.toggle('critical', frac < 0.25);
  if (G.carried && G.carried.parcel === o.parcel) {
    ocCell.innerHTML = 'Посылка у вас — <b>несите на стойку</b>';
    clearBeacon();
  } else if (o.parcel.cell) {
    ocCell.innerHTML = cellLoc(o.parcel.cell);
    if (!G.beacon) setBeacon(o.parcel.cell);
  } else if (o.parcel.bulkySlot != null) {
    ocCell.innerHTML = '<b>Габарит · Стойка у входа</b>';
    if (!G.beacon) setBeaconAt(BULKY_RACK.x, 1.5, BULKY_RACK.z);
  } else if (o.parcel.type === 'bulky') {
    ocCell.innerHTML = '<b>Габарит · несите на стойку</b>';
    clearBeacon();
  } else {
    ocCell.innerHTML = 'Посылка не на месте…';
    clearBeacon();
  }
}

const _compassV = new THREE.Vector3();
function updateCompass() {
  const el = document.getElementById('compass');
  if (!el) return;
  const o = G.activeOrder;
  const parcel = o && o.parcel;
  if (!parcel || (G.carried && G.carried.parcel === parcel)) { el.classList.add('hidden'); return; }
  let target = null;
  if (parcel.cell) target = _compassV.set(parcel.cell.x, 1.0, parcel.cell.z);
  else if (parcel.bulkySlot != null) target = _compassV.set(BULKY_RACK.x + 0.2, 1.6, BULKY_RACK.z);
  else if (parcel.mesh) target = _compassV.copy(parcel.mesh.position);
  if (!target) { el.classList.add('hidden'); return; }
  const p = target.clone().project(camera);
  let x = p.x, y = p.y;
  if (p.z > 1) { x = -x; y = -1; } // за спиной — стрелка вниз
  const ang = Math.atan2(x, y);
  const arrow = document.getElementById('compass-arrow');
  if (arrow) arrow.style.transform = `rotate(${ang}rad)`;
  const idEl = document.getElementById('compass-id'); if (idEl) idEl.textContent = parcel.id;
  const distEl = document.getElementById('compass-dist');
  if (distEl) distEl.textContent = Math.hypot(target.x - player.position.x, target.z - player.position.z).toFixed(0) + ' м';
  el.classList.remove('hidden');
}

// ============================================================
//  Размещение мебели (режим «Установка»)
// ============================================================
const buildHint = document.getElementById('build-hint');
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2(0, 0);
const mouseClient = { x: 0, y: 0 };

function footprintCircleRect(fp, px, pz, r) {
  // пересечение круга (fp) с прямоугольником r
  const nx = clamp(px, r.minX, r.maxX), nz = clamp(pz, r.minZ, r.maxZ);
  const dx = px - nx, dz = pz - nz;
  return dx * dx + dz * dz < fp * fp;
}
function placementValid(fp, pos) {
  if (fp > 0) {
    if (pos.x < -ROOM.x + fp * 0.6 || pos.x > ROOM.x - fp * 0.6 || pos.z < -ROOM.z + fp * 0.6 || pos.z > ROOM.z - fp * 0.6) return false;
    if (Math.abs(pos.x) < 2.0 && pos.z > 3.8) return false; // зона двери
    for (const c of colliders) if (footprintCircleRect(fp * 0.82, pos.x, pos.z, c)) return false;
  } else {
    if (pos.x < -ROOM.x + 0.4 || pos.x > ROOM.x - 0.4 || pos.z < -ROOM.z + 0.4 || pos.z > ROOM.z - 0.4) return false;
  }
  return true;
}
const ghostMatOk = new THREE.MeshBasicMaterial({ color: 0x2ee6a8, transparent: true, opacity: 0.5, depthWrite: false });
const ghostMatBad = new THREE.MeshBasicMaterial({ color: 0xff5c7a, transparent: true, opacity: 0.5, depthWrite: false });
const ringMatOk = new THREE.MeshBasicMaterial({ color: 0x2ee6a8, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false });
const ringMatBad = new THREE.MeshBasicMaterial({ color: 0xff5c7a, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false });

function enterPlacement(id) {
  if (G.placing) cancelPlacement();
  const idx = G.inventory.indexOf(id);
  if (idx < 0) return;
  const built = FURNITURE_FACTORY[id]();
  const ghost = built.group;
  ghost.traverse(o => { if (o.isMesh) o.material = ghostMatOk; });
  ghost.position.set(0, 0, 0);
  scene.add(ghost);
  const fp = built.footprint;
  let ring = null;
  if (fp > 0) {
    ring = new THREE.Mesh(new THREE.RingGeometry(fp * 0.75, fp, 28), ringMatOk);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    scene.add(ring);
  }
  G.placing = { id, rot: 0, ghost, ring, fp, valid: false };
  buildHint.classList.remove('hidden');
  promptEl.classList.add('hidden');
}
function cancelPlacement() {
  if (!G.placing) return;
  scene.remove(G.placing.ghost);
  if (G.placing.ring) scene.remove(G.placing.ring);
  G.placing = null;
  buildHint.classList.add('hidden');
}
function commitPlacement() {
  const pl = G.placing;
  if (!pl || !pl.valid) { AudioSys.denied(); return; }
  spawnFurnitureAt(pl.id, pl.ghost.position.x, pl.ghost.position.z, pl.rot);
  placedFurniture.push({ id: pl.id, x: pl.ghost.position.x, z: pl.ghost.position.z, rot: pl.rot });
  const i = G.inventory.indexOf(pl.id);
  if (i >= 0) G.inventory.splice(i, 1);
  cancelPlacement();
  updateInventoryHUD();
  toast(`Установлено: ${FURNITURE_NAMES[pl.id]} ✨`, 'good');
  AudioSys.build();
  parcelsDirty = true;
}
function rotatePlacement() {
  if (!G.placing) return;
  G.placing.rot += Math.PI / 4;
  G.placing.ghost.rotation.y = G.placing.rot;
}
function updatePlacement() {
  const pl = G.placing;
  if (!pl) return;
  raycaster.setFromCamera(mouseNDC, camera);
  const hit = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(groundPlane, hit)) {
    hit.x = clamp(hit.x, -ROOM.x + 0.4, ROOM.x - 0.4);
    hit.z = clamp(hit.z, -ROOM.z + 0.4, ROOM.z - 0.4);
    pl.ghost.position.set(hit.x, 0, hit.z);
    if (pl.ring) pl.ring.position.set(hit.x, 0.02, hit.z);
    pl.valid = placementValid(pl.fp, hit);
    const mat = pl.valid ? ghostMatOk : ghostMatBad;
    pl.ghost.traverse(o => { if (o.isMesh) o.material = mat; });
    if (pl.ring) pl.ring.material = pl.valid ? ringMatOk : ringMatBad;
  }
}
function updateInventoryHUD() {
  const btn = document.getElementById('btn-inventory');
  const count = G.inventory.length;
  btn.classList.toggle('hidden', count === 0);
  document.getElementById('inv-count').textContent = count;
}

// ============================================================
//  Фирменный облик каждого плана: свои формы, мебель, свет
// ============================================================
function trackExtra(obj) {
  if (!layoutRefs.extras) layoutRefs.extras = [];
  layoutRefs.extras.push(obj);
}
function buildClassicExtras() {
  // Настенные часы между стеллажами
  const clock = new THREE.Group(); clock.name = 'decor-clock';
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.06, 20), new THREE.MeshLambertMaterial({ color: 0x3a2a55 }));
  rim.rotation.x = Math.PI / 2; clock.add(rim);
  rim.scale.setScalar(1.3);
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.065, 20), new THREE.MeshLambertMaterial({ color: 0xf6f2ea }));
  face.rotation.x = Math.PI / 2; clock.add(face);
  const hour = boxMesh(0.03, 0.1, 0.02, 0x241640, { castShadow: false }); hour.position.set(0, 0.045, 0.045); clock.add(hour);
  const minute = boxMesh(0.02, 0.15, 0.02, 0x7b2ff7, { castShadow: false }); minute.position.set(0.035, 0.035, 0.045); minute.rotation.z = -0.6; clock.add(minute);
  clock.position.set(0, 2.62, -5.18);
  world.add(clock); trackExtra(clock);
  // Тёплая напольная лампа у входа
  const lamp = new THREE.Group(); lamp.name = 'decor-lamp';
  const base = cylMesh(0.2, 0.24, 0.07, 0x3a2a55, 14); base.position.y = 0.035; lamp.add(base);
  const pole = cylMesh(0.045, 0.045, 1.45, 0x241640, 8); pole.position.y = 0.76; lamp.add(pole);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.33, 0.32, 14, 1, true),
    new THREE.MeshLambertMaterial({ color: 0xffd98a, emissive: 0xa86b1e, side: THREE.DoubleSide }));
  shade.position.y = 1.5; lamp.add(shade);
  const bulbLight = new THREE.PointLight(0xffd9a0, 0.35, 4.2);
  bulbLight.position.set(0, 1.42, 0); lamp.add(bulbLight);
  lamp.position.set(-7.3, 0, 0.6);
  world.add(lamp); trackExtra(lamp);
  addCollider(-7.55, -7.05, 0.35, 0.85, 'layout');
}
function buildVitrineUnit(x, z) {
  const g = new THREE.Group(); g.name = 'decor-vitrine';
  const frame = boxMesh(1.15, 1.5, 0.55, 0x5c4633); frame.position.y = 0.75; g.add(frame);
  const backGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.15), new THREE.MeshBasicMaterial({ color: 0xffedc2 }));
  backGlow.position.set(0, 0.85, -0.24); g.add(backGlow);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.25),
    new THREE.MeshStandardMaterial({ color: 0xcfeaff, transparent: true, opacity: 0.34, roughness: 0.08, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false, envMap: getEnvMap(), envMapIntensity: 0.8 }));
  glass.position.set(0, 0.82, 0.285); g.add(glass);
  const goldTop = boxMesh(1.2, 0.07, 0.6, 0xffd60a); goldTop.position.y = 1.53; g.add(goldTop);
  const productCols = [0xff5c7a, 0x4cc9f0, 0x2ee6a8, 0xffd60a, 0xff8ad4, 0x7b2ff7];
  for (const sy of [0.55, 0.95]) {
    const shelf = boxMesh(1.0, 0.045, 0.42, 0xf6f2ea); shelf.position.set(0, sy, 0); g.add(shelf);
    for (let i = 0; i < 3; i++) {
      const prod = boxMesh(0.16, 0.2, 0.16, productCols[Math.floor(rand(0, productCols.length))]);
      prod.position.set(-0.34 + i * 0.34, sy + 0.12, 0.02); g.add(prod);
    }
  }
  const light = new THREE.PointLight(0xffe2b0, 0.4, 4.0);
  light.position.set(0, 1.75, 0.35); g.add(light);
  g.position.set(x, 0, z);
  world.add(g); trackExtra(g);
  addCollider(x - 0.65, x + 0.65, z - 0.35, z + 0.35, 'layout');
}
function buildVitrineExtras(L) {
  buildVitrineUnit(L.counter.x - 2.35, L.counter.z);
  buildVitrineUnit(L.counter.x + 2.35, L.counter.z);
}
function buildScreen(x, z) {
  const g = new THREE.Group(); g.name = 'decor-screen';
  const wood = 0xa8783f, woodDark = 0x8a6136;
  const bottom = boxMesh(2.3, 0.09, 0.14, woodDark); bottom.position.y = 0.12; g.add(bottom);
  const top = boxMesh(2.3, 0.09, 0.14, woodDark); top.position.y = 1.52; g.add(top);
  for (let i = 0; i < 9; i++) {
    const x0 = -1.04 + i * 0.26;
    const slat = boxMesh(0.075, 1.34, 0.075, wood); slat.position.set(x0, 0.82, 0); g.add(slat);
  }
  for (const sx of [-1.08, 1.08]) { const leg = boxMesh(0.14, 1.6, 0.2, woodDark); leg.position.set(sx, 0.8, 0); g.add(leg); }
  g.position.set(x, 0, z);
  world.add(g); trackExtra(g);
  addCollider(x - 1.15, x + 1.15, z - 0.12, z + 0.12, 'layout');
}
function buildPlant(x, z) {
  const g = new THREE.Group(); g.name = 'decor-plant';
  const pot = cylMesh(0.17, 0.13, 0.3, 0xc46b3f, 10); pot.position.y = 0.15; g.add(pot);
  const f1 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.23, 0), new THREE.MeshLambertMaterial({ color: 0x2e8b4f, flatShading: true }));
  f1.position.y = 0.48; f1.castShadow = true; g.add(f1);
  const f2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), new THREE.MeshLambertMaterial({ color: 0x3fa860, flatShading: true }));
  f2.position.y = 0.7; f2.castShadow = true; g.add(f2);
  g.position.set(x, 0, z);
  world.add(g); trackExtra(g);
  addCollider(x - 0.22, x + 0.22, z - 0.22, z + 0.22, 'layout');
}
function buildOpenSpaceExtras() {
  buildScreen(-2.5, 1.0);
  buildScreen(2.5, 1.0);
  buildPlant(-1.45, 1.0);
  buildPlant(1.45, 1.0);
}
function buildColumn(x, z) {
  const g = new THREE.Group(); g.name = 'decor-column';
  const shaft = cylMesh(0.34, 0.38, 3.3, 0xf4f1ea, 16); shaft.position.y = 1.65; g.add(shaft);
  const base = cylMesh(0.46, 0.5, 0.1, 0xffd60a, 16); base.position.y = 0.05; g.add(base);
  for (const ry of [0.42, 2.62]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.045, 8, 20), new THREE.MeshLambertMaterial({ color: 0xd4af37, emissive: 0x4a3200 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = ry; g.add(ring);
  }
  g.position.set(x, 0, z);
  world.add(g); trackExtra(g);
  addCollider(x - 0.44, x + 0.44, z - 0.44, z + 0.44, 'layout');
}
function buildRunner(x) {
  const g = new THREE.Group(); g.name = 'decor-runner';
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 3.2), new THREE.MeshLambertMaterial({ color: 0x6d1fd6, emissive: 0x1e0530 }));
  carpet.rotation.x = -Math.PI / 2; carpet.position.set(0, 0.02, 0); g.add(carpet);
  for (const sx of [-0.66, 0.66]) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 3.2), new THREE.MeshLambertMaterial({ color: 0xffd60a }));
    stripe.rotation.x = -Math.PI / 2; stripe.position.set(sx, 0.025, 0); g.add(stripe);
  }
  g.position.set(x, 0, 3.9);
  world.add(g); trackExtra(g);
}
function buildPendant(x, z) {
  const g = new THREE.Group(); g.name = 'decor-pendant';
  const cord = cylMesh(0.015, 0.015, 0.95, 0x17121f, 6); cord.position.y = 2.82; g.add(cord);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.3, 12, 1, true),
    new THREE.MeshLambertMaterial({ color: 0x2a2040, emissive: 0x2a1800, side: THREE.DoubleSide }));
  shade.position.y = 2.32; g.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe9b0 }));
  bulb.position.y = 2.24; g.add(bulb);
  g.position.set(x, 0, z);
  world.add(g); trackExtra(g);
}
function buildFlagshipExtras(L) {
  buildRunner(L.counter.x);
  buildColumn(L.counter.x - 2.6, 0.4);
  buildColumn(L.counter.x + 2.6, 0.4);
  for (const pz of [3.0, 4.0, 5.0]) buildPendant(L.counter.x, pz);
  const light = new THREE.PointLight(0xffd9a0, 0.5, 6.5);
  light.position.set(L.counter.x, 2.15, 3.7);
  world.add(light); trackExtra(light);
}
function buildLayoutExtras() {
  const L = LAYOUTS[G.layout];
  if (G.layout === 0) buildClassicExtras();
  else if (G.layout === 1) buildVitrineExtras(L);
  else if (G.layout === 2) buildOpenSpaceExtras();
  else if (G.layout === 3) buildFlagshipExtras(L);
}
function removeLayoutExtras() {
  const list = layoutRefs.extras || [];
  for (const obj of list) {
    if (obj && obj.parent) obj.parent.remove(obj);
  }
  layoutRefs.extras = [];
}
function applyRoomTint(idx) {
  const t = ROOM_TINTS[idx] || ROOM_TINTS[0];
  if (roomRefs.floorMat) roomRefs.floorMat.color.setHex(t.floor);
  if (roomRefs.wallMat) roomRefs.wallMat.color.setHex(t.wall);
  if (counterGlowLight) { counterGlowLight.color.setHex(t.glow); counterGlowLight.intensity = t.glowI; }
}

// ============================================================
//  Планировки зала (3D): разные расстановки, выбираются игроком
// ============================================================
function buildRugBase(L) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.2), new THREE.MeshLambertMaterial({ map: TEX.rug() }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(L.rug.x, 0.015, L.rug.z);
  m.receiveShadow = true;
  world.add(m);
  layoutRefs.rugBase = m;
}
function buildBench(L) {
  const g = new THREE.Group();
  const seat = boxMesh(1.7, 0.1, 0.55, 0xa8783f); seat.position.y = 0.46; g.add(seat);
  const back = boxMesh(1.7, 0.45, 0.09, 0x8a6136); back.position.set(0, 0.8, -0.235); g.add(back);
  for (const sx of [-0.68, 0.68]) { const leg = boxMesh(0.12, 0.46, 0.5, 0x6b4a2f); leg.position.set(sx, 0.23, 0); g.add(leg); }
  for (const sx of [-0.68, 0.68]) { const post = boxMesh(0.09, 0.36, 0.09, 0x6b4a2f); post.position.set(sx, 0.68, -0.235); g.add(post); }
  g.position.set(L.bench.x, 0, L.bench.z);
  world.add(g);
  addCollider(L.bench.x - 0.9, L.bench.x + 0.9, L.bench.z - 0.3, L.bench.z + 0.3, 'layout');
  layoutRefs.bench = g;
}
function buildLayoutObjects() {
  const L = LAYOUTS[G.layout];
  buildPallet();
  buildUnpackTable();
  buildBin();
  buildCounter();
  if (L.rug) buildRugBase(L);
  if (L.bench) buildBench(L);
  buildLayoutExtras();
}
function clearLayoutObjects() {
  removeLayoutColliders();
  removeLayoutExtras();
  if (layoutRefs.counterTerm) { untagInteract(layoutRefs.counterTerm); layoutRefs.counterTerm = null; }
  for (const key of ['counter', 'table', 'bin', 'pallet', 'rugBase', 'bench']) {
    const obj = layoutRefs[key];
    if (obj) untagInteract(obj);
    if (obj && obj.parent) obj.parent.remove(obj);
    layoutRefs[key] = null;
  }
}
function applyLayout(idx) {
  const L = LAYOUTS[idx];
  if (!L) return;
  G.layout = idx;
  const oldTable = { x: TABLE_POS.x, z: TABLE_POS.z };
  TABLE_POS.x = L.table.x; TABLE_POS.z = L.table.z;
  BIN_POS.x = L.bin.x; BIN_POS.z = L.bin.z;
  COUNTER_POS.x = L.counter.x; COUNTER_POS.z = L.counter.z;
  COUNTER_APPROACH.x = L.counter.x; COUNTER_APPROACH.z = L.counter.z + 1.2;
  PALLET_POS.x = L.pallet.x; PALLET_POS.z = L.pallet.z;
  clearLayoutObjects();
  buildLayoutObjects();
  if (nameBoard) nameBoard.position.set(COUNTER_POS.x, 2.35, COUNTER_POS.z);
  if (counterGlowLight) counterGlowLight.position.set(COUNTER_POS.x, 2.4, COUNTER_POS.z);
  if (coffeeMachineRef) coffeeMachineRef.position.set(COUNTER_POS.x - 1.05, 1.1, COUNTER_POS.z - 0.05);
  applyRoomTint(idx);
  const ax = COUNTER_APPROACH.x, az = COUNTER_APPROACH.z, qd = L.queueDir;
  QUEUE_SLOTS[0].set(ax, 0, az + 0.15);
  QUEUE_SLOTS[1].set(ax + 1.25 * qd, 0, az + 0.55);
  QUEUE_SLOTS[2].set(ax + 2.5 * qd, 0, az + 0.75);
  if (typeof relayoutQueue === 'function') relayoutQueue();
  // посылки на столе переезжают по сетке 3×2, напольные — вместе со столом
  const onTable = parcels.filter(p => isTableParcel(p, oldTable.x, oldTable.z));
  onTable.sort((a, b) => (a.mesh.position.z - b.mesh.position.z) || (a.mesh.position.x - b.mesh.position.x));
  onTable.forEach((p, i) => {
    const slot = TABLE_SLOTS[i % TABLE_SLOTS.length];
    p.mesh.position.set(TABLE_POS.x + slot.dx, 0.96, TABLE_POS.z + slot.dz);
  });
  G.layoutsByLoc[G.location] = idx;
  saveLayouts();
}

// ============================================================
//  Помещения
// ============================================================
const PLANS = [
  // Метро — тесная комната
  `<svg viewBox="0 0 200 130" width="100%" height="110"><rect x="20" y="14" width="160" height="102" rx="6" fill="#241d33" stroke="#ffd60a" stroke-width="2"/><rect x="20" y="116" width="52" height="8" fill="#241d33"/><rect x="115" y="116" width="65" height="8" fill="#241d33"/><rect x="34" y="26" width="48" height="12" rx="2" fill="#6d35d6"/><rect x="96" y="26" width="48" height="12" rx="2" fill="#6d35d6" opacity="0.45"/><rect x="118" y="72" width="44" height="16" rx="2" fill="#ffd60a"/><rect x="30" y="86" width="34" height="10" rx="2" fill="#c8a06a"/><text x="100" y="66" fill="#a99ecb" font-size="10" text-anchor="middle" font-family="Arial">32 м²</text></svg>`,
  // Спальник — просторнее
  `<svg viewBox="0 0 200 130" width="100%" height="110"><rect x="10" y="12" width="180" height="106" rx="6" fill="#241d33" stroke="#ffd60a" stroke-width="2"/><rect x="10" y="118" width="60" height="8" fill="#241d33"/><rect x="122" y="118" width="68" height="8" fill="#241d33"/><rect x="24" y="22" width="46" height="12" rx="2" fill="#6d35d6"/><rect x="78" y="22" width="46" height="12" rx="2" fill="#6d35d6"/><rect x="132" y="22" width="46" height="12" rx="2" fill="#6d35d6" opacity="0.45"/><rect x="128" y="66" width="50" height="16" rx="2" fill="#ffd60a"/><rect x="22" y="80" width="30" height="18" rx="3" fill="#e2626b"/><rect x="150" y="90" width="22" height="12" rx="2" fill="#c8a06a"/><text x="96" y="63" fill="#a99ecb" font-size="10" text-anchor="middle" font-family="Arial">45 м²</text></svg>`,
  // Бизнес-центр — премиум
  `<svg viewBox="0 0 200 130" width="100%" height="110"><rect x="6" y="10" width="188" height="110" rx="6" fill="#241d33" stroke="#ffd60a" stroke-width="2"/><rect x="6" y="120" width="66" height="8" fill="#241d33"/><rect x="126" y="120" width="68" height="8" fill="#241d33"/><rect x="18" y="20" width="42" height="12" rx="2" fill="#6d35d6"/><rect x="66" y="20" width="42" height="12" rx="2" fill="#6d35d6"/><rect x="114" y="20" width="42" height="12" rx="2" fill="#6d35d6"/><rect x="124" y="62" width="56" height="17" rx="2" fill="#ffd60a"/><rect x="16" y="74" width="30" height="19" rx="3" fill="#e2626b"/><rect x="54" y="74" width="16" height="16" rx="8" fill="#3fbf77"/><rect x="152" y="88" width="30" height="10" rx="2" fill="#c8a06a"/><text x="98" y="57" fill="#a99ecb" font-size="10" text-anchor="middle" font-family="Arial">60 м²</text></svg>`,
  // Флагман у ТЦ — большой
  `<svg viewBox="0 0 200 130" width="100%" height="110"><rect x="3" y="8" width="194" height="112" rx="6" fill="#241d33" stroke="#ffd60a" stroke-width="2"/><rect x="3" y="120" width="70" height="8" fill="#241d33"/><rect x="128" y="120" width="69" height="8" fill="#241d33"/><rect x="14" y="16" width="40" height="12" rx="2" fill="#6d35d6"/><rect x="58" y="16" width="40" height="12" rx="2" fill="#6d35d6"/><rect x="102" y="16" width="40" height="12" rx="2" fill="#6d35d6"/><rect x="146" y="16" width="40" height="12" rx="2" fill="#6d35d6"/><rect x="130" y="58" width="62" height="17" rx="2" fill="#ffd60a"/><rect x="12" y="70" width="32" height="20" rx="3" fill="#e2626b"/><rect x="50" y="70" width="18" height="18" rx="9" fill="#3fbf77"/><rect x="12" y="98" width="180" height="6" rx="3" fill="#ff4fd8" opacity="0.8"/><text x="98" y="52" fill="#a99ecb" font-size="10" text-anchor="middle" font-family="Arial">80 м²</text></svg>`,
];
function renderLocations() {
  document.getElementById('loc-money').textContent = Math.floor(G.money) + ' ₽';
  const grid = document.getElementById('loc-grid');
  grid.innerHTML = '';
  for (const loc of LOCATIONS) {
    const owned = G.ownedLocations.includes(loc.id);
    const current = G.location === loc.id;
    const curPlan = (G.layoutsByLoc[loc.id] != null ? G.layoutsByLoc[loc.id] : loc.plan);
    const card = document.createElement('div');
    card.className = 'loc-card' + (current ? ' current' : '');
    card.dataset.loc = loc.id;
    const planChips = owned
      ? `<div class="loc-layouts"><span>3D-планировка</span><div class="loc-fx">⚡ ${LAYOUTS[curPlan].fx}</div><div class="layout-chips">${LAYOUTS.map((l, i) => `<button class="layout-chip${i === curPlan ? ' active' : ''}" data-loc="${loc.id}" data-plan="${i}">${l.name}</button>`).join('')}</div></div>`
      : '';
    const stats = `
      <div class="loc-stats">
        <div>Поток клиентов: <b>×${loc.customers.toFixed(2)}</b></div>
        <div>Средний чек: <b>×${loc.pay.toFixed(2)}</b></div>
        <div>Терпение: <b>×${loc.patience.toFixed(2)}</b></div>
        <div>Репутация: <b>×${loc.repGain.toFixed(2)}</b></div>
        <div>${loc.rent > 0 ? `Аренда: <b>${loc.rent} ₽/день</b>` : 'Аренды нет · ЖКХ 60 ₽'}</div>
      </div>`;
    let action = '';
    if (current) action = `<button class="loc-btn" disabled>Вы здесь</button>`;
    else if (owned) action = `<button class="loc-btn move">Въехать сюда</button>`;
    else action = `<button class="loc-btn" ${G.money < loc.price ? 'disabled' : ''}>Купить · ${loc.price} ₽</button>`;
    card.innerHTML = `
      ${current ? '<div class="loc-tag">ВЫ ЗДЕСЬ</div>' : ''}
      <h3>${loc.name}</h3>
      <div class="loc-area">${loc.area}${owned ? ' · ваша собственность' : ''}</div>
      <div class="loc-plan">${PLANS[loc.plan]}</div>
      ${stats}
      <div class="loc-note" style="margin:2px 0 0;font-size:10.5px">${loc.blurb}</div>
      ${planChips}
      <div class="loc-price">${loc.rent > 0 ? `Аренда ${loc.rent} ₽ + ЖКХ` : 'Только ЖКХ 60 ₽'}</div>
      ${action}`;
    card.querySelectorAll('.layout-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const idx = +chip.dataset.plan;
        G.layoutsByLoc[loc.id] = idx;
        saveLayouts();
        if (loc.id === G.location) {
          applyLayout(idx);
          toast(`Планировка «${LAYOUTS[idx].name}» применена`, 'good');
        } else {
          toast(`Планировка «${LAYOUTS[idx].name}» будет ждать вас в «${loc.name}»`, 'good');
        }
        renderLocations();
      });
    });
    const btn = card.querySelector('.loc-btn');
    btn.addEventListener('click', () => {
      if (current) return;
      if (owned) {
        G.location = loc.id;
        applyLayout(G.layoutsByLoc[loc.id] != null ? G.layoutsByLoc[loc.id] : loc.plan);
        toast(`Вы переехали: ${loc.name} 🏠`, 'good');
        AudioSys.move();
      } else {
        if (G.money < loc.price) { AudioSys.denied(); return; }
        G.money -= loc.price;
        G.ownedLocations.push(loc.id);
        G.location = loc.id;
        applyLayout(G.layoutsByLoc[loc.id] != null ? G.layoutsByLoc[loc.id] : loc.plan);
        toast(`Помещение выкуплено: ${loc.name}! 🎉`, 'good');
        AudioSys.move();
      }
      saveRecords();
      updateHUD();
      renderLocations();
    });
    grid.appendChild(card);
  }
}
function openLocations() {
  G.locReturn = G.screen;
  G.screen = 'locations';
  renderLocations();
  document.getElementById('locations').classList.remove('hidden');
}
function closeLocations() {
  document.getElementById('locations').classList.add('hidden');
  G.screen = (G.locReturn === 'dayEnd') ? 'dayEnd' : 'play';
}

// ============================================================
//  Магазин (с категориями)
// ============================================================
const SHOP_ITEMS = [
  // Мебель (размещается игроком)
  { id: 'shelf', sec: 'Мебель', ico: '🗄️', name: 'Стеллаж «Классик»', desc: '+8 ячеек для заказов. Ставится вдоль стены автоматически. До 4 шт.',
    price: () => 700, once: false, canBuy: () => G.upgrades.shelf < 4, ownedLabel: () => G.upgrades.shelf + '/4',
    buy() { addShelf(G.upgrades.shelf); G.upgrades.shelf++; } },
  { id: 'sofa', sec: 'Мебель', ico: '🛋️', name: 'Диван «Комфорт»', desc: 'Терпение клиентов +35%. Устанавливается вами.',
    price: () => 800, once: true, placeable: true },
  { id: 'armchair', sec: 'Мебель', ico: '💺', name: 'Кресло «Тишина»', desc: 'Терпение +12%. Полностью ваше. (Лимит: 3 шт.)',
    price: () => 450, once: false, canBuy: () => countBought('armchair') < 3, ownedLabel: () => countBought('armchair') + '/3', placeable: true },
  { id: 'plant', sec: 'Мебель', ico: '🪴', name: 'Растение в кашпо', desc: 'Штраф репутации за ушедшего клиента −50%.',
    price: () => 450, once: true, placeable: true },
  { id: 'palm', sec: 'Мебель', ico: '🌴', name: 'Пальма «Марракеш»', desc: 'Премиум-декор: репутация за выдачу +10%.',
    price: () => 650, once: true, placeable: true },
  { id: 'coatrack', sec: 'Мебель', ico: '🧥', name: 'Вешалка «Зима»', desc: 'В пальто легче ждать: терпение +12%.',
    price: () => 380, once: true, placeable: true },
  { id: 'greenwall', sec: 'Мебель', ico: '🌿', name: 'Фитостена «Дыши»', desc: 'Живая стена: штраф репутации ещё −40%.',
    price: () => 1600, once: true, placeable: true },
  { id: 'rug', sec: 'Мебель', ico: '🧶', name: 'Ковёр «Тюльпаны»', desc: 'Уютно: репутация за выдачу +15%.',
    price: () => 900, once: true, placeable: true },
  { id: 'neon', sec: 'Мебель', ico: '🦩', name: 'Неоновое панно «24/7»', desc: 'Неон с улицы: клиентов на 15% больше.',
    price: () => 1100, once: true, placeable: true },
  // Оборудование
  { id: 'scanner', sec: 'Оборудование', ico: '🔫', name: 'Сканер «Зебра-3000»', desc: 'Выдача заказа 1.2 с → 0.5 с.', price: () => 900, once: true },
  { id: 'table', sec: 'Оборудование', ico: '🧰', name: 'Стол распаковки Pro', desc: 'Вскрытие короба 2.0 с → 0.9 с.', price: () => 1000, once: true },
  { id: 'coffee', sec: 'Оборудование', ico: '☕', name: 'Кофемашина «Арома»', desc: '30% шанс чаевых +40 ₽ и терпение +20%.',
    price: () => 1500, once: true, onBuy() { buildCoffeeMachine(); } },
  // Персонал
  { id: 'loader', sec: 'Персонал', ico: '👷', name: 'Грузчик «Денис»', desc: 'Сам вскрывает короба с паллеты и приносит посылки на стол.', price: () => BALANCE.loaderPrice, once: true, onBuy() { hireLoader(); } },
  // Продвижение
  { id: 'sign', sec: 'Продвижение', ico: '🪧', name: 'Вывеска «ОТКРЫТО»', desc: 'Клиенты заходят на 25% чаще.', price: () => 1200, once: true, onBuy() { buildSign(); } },
  { id: 'poster', sec: 'Продвижение', ico: '🖼️', name: 'Постер «Стильный ПВЗ»', desc: 'Прирост репутации за выдачу ×1.5.', price: () => 600, once: true, onBuy() { buildPoster(); } },
];
const shopGrid = document.getElementById('shop-grid');
const shopMoney = document.getElementById('shop-money');
const placedFurniture = [];
function spawnFurnitureAt(id, x, z, rot) {
  const built = FURNITURE_FACTORY[id]();
  built.group.position.set(x, 0, z);
  built.group.rotation.y = rot;
  world.add(built.group);
  if (built.collider) {
    const c = built.collider;
    const cos = Math.abs(Math.cos(rot)), sin = Math.abs(Math.sin(rot));
    const ex = c.dx * cos + c.dz * sin, ez = c.dx * sin + c.dz * cos;
    addCollider(x - ex, x + ex, z - ez, z + ez);
  }
  return built;
}
const boughtCounts = {};
function countBought(id) { return boughtCounts[id] || 0; }
const SHOP_SUB = {
  shelf: 'Хранение', sofa: 'Комфорт', armchair: 'Комфорт', coatrack: 'Комфорт',
  plant: 'Декор', palm: 'Декор', greenwall: 'Декор', rug: 'Декор', neon: 'Декор',
  scanner: 'Сканирование', table: 'Распаковка', coffee: 'Напитки',
  loader: 'Смена',
  sign: 'Маркетинг', poster: 'Маркетинг',
};
const SECTION_DEFS = [
  { id: 'Мебель', ico: '🪑', subs: ['Все', 'Хранение', 'Комфорт', 'Декор'] },
  { id: 'Оборудование', ico: '🛠️', subs: ['Все', 'Сканирование', 'Распаковка', 'Напитки'] },
  { id: 'Персонал', ico: '👷', subs: ['Все', 'Смена'] },
  { id: 'Продвижение', ico: '📣', subs: ['Все', 'Маркетинг'] },
];
const shopTabsEl = document.getElementById('shop-tabs');
const shopSubsEl = document.getElementById('shop-subs');
let shopSection = 'Мебель';
let shopSub = 'Все';
function renderShop() {
  shopMoney.textContent = Math.floor(G.money) + ' ₽';
  // вкладки разделов со счётчиками
  shopTabsEl.innerHTML = '';
  for (const s of SECTION_DEFS) {
    const count = SHOP_ITEMS.filter(i => i.sec === s.id).length;
    const b = document.createElement('button');
    b.className = 'shop-tab' + (s.id === shopSection ? ' active' : '');
    b.innerHTML = `<span>${s.ico}</span>${s.id}<small>${count}</small>`;
    b.addEventListener('click', () => { shopSection = s.id; shopSub = 'Все'; renderShop(); AudioSys.place(); });
    shopTabsEl.appendChild(b);
  }
  // подкатегории текущего раздела
  const cur = SECTION_DEFS.find(s => s.id === shopSection);
  shopSubsEl.innerHTML = '';
  for (const sub of cur.subs) {
    const b = document.createElement('button');
    b.className = 'shop-sub' + (sub === shopSub ? ' active' : '');
    b.textContent = sub;
    b.addEventListener('click', () => { shopSub = sub; renderShop(); AudioSys.place(); });
    shopSubsEl.appendChild(b);
  }
  // карточки
  shopGrid.innerHTML = '';
  const items = SHOP_ITEMS.filter(i => i.sec === shopSection && (shopSub === 'Все' || SHOP_SUB[i.id] === shopSub));
  for (const item of items) {
    const price = item.price();
    const owned = item.once ? G.upgrades[item.id] : false;
    const maxed = item.canBuy ? !item.canBuy() : false;
    const div = document.createElement('div');
    div.className = 'shop-item';
    const foot = owned
      ? `<span class="si-owned">✓ ${item.ownedLabel ? item.ownedLabel() : 'Куплено'}</span>`
      : `<span class="si-price">${price} ₽</span>`;
    div.innerHTML = `
      <div class="si-top"><div class="si-ico">${item.ico}</div>
        <div><div class="si-name">${item.name}</div><div class="si-sec">${item.sec} · ${SHOP_SUB[item.id] || ''}</div></div></div>
      <div class="si-desc">${item.desc}</div>
      <div class="si-foot">${foot}
        <button class="si-buy" ${owned || maxed || G.money < price ? 'disabled' : ''}>
          ${owned ? 'В наличии' : maxed ? 'Макс.' : 'Купить'}
        </button>
      </div>`;
    div.querySelector('.si-buy').addEventListener('click', () => {
      if (G.money < price) { AudioSys.denied(); return; }
      G.money -= price;
      if (item.id === 'shelf') {
        item.buy();
      } else if (item.placeable) {
        if (item.once) G.upgrades[item.id] = true;
        boughtCounts[item.id] = (boughtCounts[item.id] || 0) + 1;
        G.inventory.push(item.id);
      } else {
        G.upgrades[item.id] = true;
        if (item.onBuy) item.onBuy();
      }
      AudioSys.buy();
      updateInventoryHUD();
      updateHUD();
      renderShop();
      if (item.placeable) {
        toast(`«${FURNITURE_NAMES[item.id]}» на складе — выберите место`, 'good');
        document.getElementById('shop').classList.add('hidden');
        G.screen = 'play';
        enterPlacement(item.id);
      } else {
        toast(`Куплено: ${item.name}`, 'good');
      }
    });
    shopGrid.appendChild(div);
  }
}
function openShop() {
  G.shopReturn = G.screen;
  G.screen = 'shop';
  renderShop();
  document.getElementById('shop').classList.remove('hidden');
}
function closeShop() {
  document.getElementById('shop').classList.add('hidden');
  G.screen = (G.shopReturn === 'dayEnd') ? 'dayEnd' : 'play';
  updateHUD();
}

// ============================================================
//  HUD и взаимодействие
// ============================================================
const promptEl = document.getElementById('interact-prompt');
const promptText = document.getElementById('interact-text');
const hudMoney = document.getElementById('hud-money');
const hudRep = document.getElementById('hud-rep');
const repFill = document.getElementById('rep-fill');
const hudRank = document.getElementById('hud-rank');
const hudDay = document.getElementById('hud-day');
const dayTimerFill = document.getElementById('day-timer-fill');
const hudIssued = document.getElementById('hud-issued');
const hudEvent = document.getElementById('hud-event');
const hudName = document.getElementById('hud-name');
const hudLogo = document.getElementById('hud-logo');
const carriedEl = document.getElementById('carried');
const carriedText = document.getElementById('carried-text');
const carriedIco = document.getElementById('carried-ico');
const toastsEl = document.getElementById('toasts');

function updateHUD() {
  hudMoney.textContent = Math.floor(G.money) + ' ₽';
  hudRep.textContent = G.rep.toFixed(1) + ' ★';
  repFill.style.width = (G.rep / 5 * 100) + '%';
  hudRank.textContent = rankName(G.lifetimeEarned);
  hudDay.textContent = 'День ' + G.day;
  hudIssued.textContent = 'Выдано: ' + G.issuedToday;
  hudName.innerHTML = 'ПВЗ «' + G.pvzName + '»<small>пункт выдачи</small>';
  hudLogo.textContent = G.pvzLogo;
  if (G.carried) {
    carriedEl.classList.remove('hidden');
    if (G.carried.kind === 'big') {
      carriedIco.textContent = '📦';
      carriedText.textContent = 'Короб с поставкой' + (G.carried.docScanned ? ' · ТТН ✓' : '');
    } else {
      carriedIco.textContent = '📮';
      carriedText.textContent = G.carried.id + (TYPE_SHORT[G.carried.parcel.type] || '');
    }
  } else carriedEl.classList.add('hidden');
}
function toast(text, kind = '') {
  const div = document.createElement('div');
  div.className = 'toast' + (kind ? ' ' + kind : '');
  div.textContent = text;
  toastsEl.appendChild(div);
  setTimeout(() => div.remove(), 3100);
}

function nearestCellWithParcel() {
  let best = null, bestD = Infinity;
  for (const s of shelves) for (const cell of s.cells) {
    if (!cell.parcel) continue;
    const d = Math.hypot(player.position.x - cell.x, player.position.z - cell.z);
    if (d < bestD) { bestD = d; best = cell; }
  }
  return { cell: best, dist: bestD };
}
function nearestFreeCell() {
  let best = null, bestD = Infinity;
  for (const s of shelves) for (const cell of s.cells) {
    if (cell.parcel) continue;
    const d = Math.hypot(player.position.x - cell.x, player.position.z - cell.z);
    if (d < bestD) { bestD = d; best = cell; }
  }
  return { cell: best, dist: bestD };
}
function nearestFloorItem(kind) {
  let best = null, bestD = Infinity;
  for (const it of floorItems) {
    if (it.kind !== kind) continue;
    const d = Math.hypot(player.position.x - it.mesh.position.x, player.position.z - it.mesh.position.z);
    if (d < bestD) { bestD = d; best = it; }
  }
  return { item: best, dist: bestD };
}
const nearCounterDist = () => Math.hypot(player.position.x - COUNTER_POS.x, player.position.z - COUNTER_POS.z);

function pickupFloorItem(item) {
  removeFromArray(floorItems, item);
  if (item.kind === 'big') removeFromArray(bigBoxes, item.mesh);
  untagInteract(item.mesh);
  G.carried = item;
  attachCarried(item.mesh);
  AudioSys.pickup();
  updateHUD();
}
function attachCarried(mesh) {
  setBlobVisible(mesh, false);
  if (mesh.parent) mesh.parent.remove(mesh);
  mesh.position.set(0, 0.92, 0.34);
  mesh.rotation.set(0, 0, 0);
  player.add(mesh);
}
function detachCarried() {
  const item = G.carried;
  setBlobVisible(item.mesh, true);
  player.remove(item.mesh);
  world.add(item.mesh);
  tagInteract(item.mesh, item.kind === 'big' ? 'bigbox' : 'parcel');
  G.carried = null;
  updateHUD();
  return item;
}
function takeFromCell(cell) {
  const parcel = cell.parcel;
  cell.parcel = null;
  parcel.cell = null;
  if (parcel.label && parcel.label.parent) parcel.label.parent.remove(parcel.label);
  parcel.label = null;
  removeFromFloorItems(parcel);
  untagInteract(parcel.mesh);
  G.carried = { kind: 'parcel', id: parcel.id, mesh: parcel.mesh, parcel };
  attachCarried(parcel.mesh);
  AudioSys.pickup();
  updateHUD();
  updateOrderCard();
}
function placeInCell(cell) {
  if (G.carried && G.carried.parcel && G.carried.parcel.type === 'bulky') {
    toast('Габарит в ячейку не влезет — стойка «Габарит» у входа слева', 'warn');
    AudioSys.denied();
    return;
  }
  const item = detachCarried();
  const parcel = item.parcel;
  removeFromFloorItems(parcel);
  untagInteract(parcel.mesh);
  setBlobVisible(parcel.mesh, true);
  parcel.mesh.position.set(cell.x, cell.y, cell.z);
  parcel.mesh.rotation.y = rand(-0.15, 0.15);
  parcel.cell = cell;
  cell.parcel = parcel;
  tagInteract(parcel.mesh, 'parcel');
  const info = TYPE_INFO[parcel.type];
  const label = labelSprite(parcel.id, { wanted: !!parcel.reservedBy, sub: info.sub, red: parcel.type === 'defect' });
  label.position.set(cell.x, cell.y + 0.5, cell.z + 0.05);
  scene.add(label);
  parcel.label = label;
  parcelsDirty = true;
  AudioSys.place();
}
function binDefect() {
  const parcel = G.carried.parcel;
  G.money += BALANCE.binBonus;
  G.dayEarned += BALANCE.binBonus;
  G.lifetimeEarned += BALANCE.binBonus;
  removeParcelWorld(parcel);
  toast(`Брак утилизирован по акту · +${BALANCE.binBonus} ₽`, 'good');
  AudioSys.place();
  updateHUD();
}
function repackageCarried() {
  if (G.money < BALANCE.repackageCost) {
    toast(`Не хватает ${BALANCE.repackageCost} ₽ на новую коробку`, 'bad');
    AudioSys.denied();
    return;
  }
  G.money -= BALANCE.repackageCost;
  const parcel = G.carried.parcel;
  parcel.type = 'normal';
  const newColor = choice(PARCEL_COLORS);
  parcel.color = newColor;
  parcel.mesh.children[0].material.color.setHex(newColor);
  parcel.mesh.children[1].material.color.setHex(shade(newColor, -0.35));
  toast('Посылка пересажена в новую коробку — можно выдавать', 'good');
  AudioSys.buy();
  updateHUD();
}
function breakFragileParcel() {
  const parcel = G.carried.parcel;
  toast(`Хрупкая посылка ${parcel.id} разбилась!`, 'bad');
  AudioSys.crack();
  removeParcelWorld(parcel);
  addRep(-0.12 * G.mods.repLoss);
}
function removeFromFloorItems(parcel) {
  for (let i = floorItems.length - 1; i >= 0; i--) {
    if (floorItems[i].parcel === parcel) floorItems.splice(i, 1);
  }
}
function removeFromArray(arr, item) {
  const i = arr.indexOf(item);
  if (i >= 0) { arr.splice(i, 1); return true; }
  return false;
}

// ---------- Действия со сканированием ----------
function beginTimed(type, dur, label, customer) {
  G.action = { type, t: 0, dur, ...(customer ? { customer } : {}) };
  document.getElementById('scan-progress').classList.remove('hidden');
  document.getElementById('scan-fill').style.width = '0%';
  document.getElementById('scan-label').textContent = label;
}
function startUnpack() { beginTimed('unpack', G.upgrades.table ? BALANCE.unpackTimeFast : BALANCE.unpackTime, 'Вскрываем короб…'); }
function startTtn()    { beginTimed('ttn', BALANCE.ttnTime, 'Сканируем ТТН…'); }
function startScan(customer) {
  const base = G.upgrades.scanner ? BALANCE.scanTimeFast : BALANCE.scanTime;
  beginTimed('scan', base * G.mods.scan, 'Сканируем заказ…', customer);
}
function startReturn(customer) { beginTimed('return', BALANCE.returnTime, 'Оформляем возврат…', customer); }

function finishTtn() {
  G.money += BALANCE.ttnBonus;
  G.dayEarned += BALANCE.ttnBonus;
  G.lifetimeEarned += BALANCE.ttnBonus;
  if (G.carried) G.carried.docScanned = true;
  G.action = null;
  document.getElementById('scan-progress').classList.add('hidden');
  toast(`ТТН отсканирована · +${BALANCE.ttnBonus} ₽`, 'good');
  AudioSys.scan();
  updateHUD();
}
const PARCEL_ROW = [-0.62, 0, 0.62]; // legacy, оставлено для совместимости
// Сетка мест на столе (2 ряда × 3 колонки) и полосы на полу — куда класть посылки,
// чтобы они не сливались в одну точку при повторной приёмке
const TABLE_SLOTS = [];
for (const dz of [-0.28, 0.28]) for (const dx of [-0.93, -0.31, 0.31, 0.93]) TABLE_SLOTS.push({ dx, dz });
function isTableParcel(p, tx, tz) {
  if (p.cell || p.bulkySlot != null) return false;
  const m = p.mesh.position;
  return Math.hypot(m.x - (tx == null ? TABLE_POS.x : tx), m.z - (tz == null ? TABLE_POS.z : tz)) < 1.35 && m.y > 0.4;
}
function nearestSlotIndex(x, z, base, slots, maxDist) {
  let best = -1, bd = maxDist;
  for (let i = 0; i < slots.length; i++) {
    const d = Math.hypot(x - (base.x + slots[i].dx), z - (base.z + slots[i].dz));
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
function claimTableSlots(list) {
  const used = new Set();
  for (const p of list) {
    const i = nearestSlotIndex(p.mesh.position.x, p.mesh.position.z, TABLE_POS, TABLE_SLOTS, 0.4);
    if (i >= 0) used.add(i);
  }
  return TABLE_SLOTS.map((_, i) => i).filter(i => !used.has(i));
}

function finishUnpack() {
  const item = detachCarried();      // снять с рук
  item.mesh.position.set(TABLE_POS.x, 0.98, TABLE_POS.z);  // и на стол
  item.mesh.rotation.set(0, rand(-0.18, 0.18), 0);
  item.mesh.scale.setScalar(1);
  G.unpackAnim = { t: 0, dur: 1.2, mesh: item.mesh, spawned: false };
  G.action = null;
  document.getElementById('scan-progress').classList.add('hidden');
  AudioSys.unpack();
}
function spawnUnpackedParcels() {
  const spawned = [];
  const freeTable = claimTableSlots(parcels.filter(p => isTableParcel(p)));
  for (let i = 0; i < BALANCE.parcelsPerBox; i++) {
    // габарит: не чаще одного в коробе
    const forceT = (i === 0 && Math.random() < BALANCE.bulkyChance) ? 'bulky' : null;
    let x, z, y;
    if (freeTable.length) {
      const slot = TABLE_SLOTS[freeTable.shift()];
      x = TABLE_POS.x + slot.dx; z = TABLE_POS.z + slot.dz; y = 0.96;
    } else {
      // стол забит — складываем аккуратной стопкой на столе (на пол не падаем!)
      const pile = parcels.filter(p => isTableParcel(p)).length;
      x = TABLE_POS.x + rand(-0.16, 0.16); z = TABLE_POS.z + rand(-0.16, 0.16);
      y = 0.96 + 0.22 * Math.floor(Math.min(pile, 12) / 4);
    }
    const p = spawnParcel(x, z, y, forceT);
    p.mesh.rotation.y = rand(-0.12, 0.12);
    spawned.push(p);
  }
  const defects = spawned.filter(p => p.type === 'defect').length;
  const thermal = spawned.filter(p => p.type === 'thermal').length;
  const bulky = spawned.filter(p => p.type === 'bulky').length;
  let msg = 'Короб вскрыт: +3 посылки на столе';
  if (bulky) msg = 'Короб вскрыт: внутри ГАБАРИТ — на стойку у входа';
  else if (defects) msg = `Короб вскрыт · обнаружен брак: ${defects}!`;
  else if (thermal) msg = 'Короб вскрыт · есть ТЕРМО-посылки (60 с)';
  toast(msg, defects ? 'warn' : 'good');
  parcelsDirty = true;
}
function updateUnpackAnim(dt) {
  const a = G.unpackAnim;
  if (!a) return;
  a.t += dt;
  const k = Math.min(1, a.t / a.dur);
  const ease = k * k * (3 - 2 * k); // smoothstep
  const f = a.mesh.userData.flaps;
  if (f) {
    f.front.rotation.x = 2.0 * ease;
    f.back.rotation.x = -2.0 * ease;
    f.left.rotation.z = 2.0 * ease;
    f.right.rotation.z = -2.0 * ease;
  }
  a.mesh.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.09);
  if (k >= 0.55 && !a.spawned) { a.spawned = true; spawnUnpackedParcels(); }
  if (k >= 1) { world.remove(a.mesh); G.unpackAnim = null; }
}
function finishScan() {
  const customer = G.action.customer;
  const item = detachCarried();
  world.remove(item.mesh);
  const parcel = item.parcel;
  removeFromFloorItems(parcel);
  removeFromArray(parcels, parcel);

  const loc = locBonus();
  const typeMul = parcel.type === 'fragile' ? BALANCE.fragilePayMul : parcel.type === 'thermal' ? BALANCE.thermalPayMul : parcel.type === 'bulky' ? BALANCE.bulkyPayMul : parcel.type === 'express' ? BALANCE.expressPayMul : 1;
  const vipMul = customer && customer.isVip ? BALANCE.vipPayMul : 1;
  const payout = Math.round((BALANCE.basePay + Math.random() * BALANCE.payRandom + (G.upgrades.coffee && Math.random() < BALANCE.tipChance ? BALANCE.tipAmount : 0)) * typeMul * vipMul * loc.pay * layoutStats().check);
  // чаевые за скорость выдачи + комбо-серия
  const dtIssue = G.activeOrder && G.activeOrder.qrAt ? (performance.now() - G.activeOrder.qrAt) / 1000 : 999;
  let tip = 0;
  if (dtIssue <= BALANCE.fastIssueSec) {
    G.tipCombo = (G.tipCombo || 0) + 1;
    tip = BALANCE.tipComboBase * Math.min(Math.max(G.tipCombo, 1), BALANCE.tipComboMax);
  } else {
    G.tipCombo = 0;
  }
  if (tip > 0) {
    G.tipsToday = (G.tipsToday || 0) + tip;
    G.money += tip; G.dayEarned += tip; G.lifetimeEarned += tip;
  }
  G.money += payout;
  G.dayEarned += payout;
  G.lifetimeEarned += payout;
  G.issuedToday++;
  G.totalIssued++;
  const repGain = BALANCE.repGain
    * (G.upgrades.poster ? 1.5 : 1)
    * (G.upgrades.palm ? 1.1 : 1)
    * (G.upgrades.rug ? 1.15 : 1)
    * G.mods.repGain * loc.repGain * layoutStats().rep;
  addRep(repGain);
  toast(`${customer && customer.isVip ? '👑 ' : ''}Выдано ${parcel.id} · +${payout} ₽`, 'good');
  if (tip > 0) toast(`⚡ Чаевые +${tip} ₽${G.tipCombo >= 2 ? ` · комбо ×${Math.min(G.tipCombo, BALANCE.tipComboMax)}` : ''}`, 'good');
  updateComboChip();
  AudioSys.scan();
  setTimeout(() => AudioSys.cash(), 180);

  clearOrderCard();
  if (customer && customer.state !== 'leaving') customerLeave(customer, 'served');
  G.action = null;
  document.getElementById('scan-progress').classList.add('hidden');
  parcelsDirty = true;
  updateHUD();
}
function finishReturn() {
  const customer = G.action.customer;
  G.money += BALANCE.returnFee;
  G.dayEarned += BALANCE.returnFee;
  G.lifetimeEarned += BALANCE.returnFee;
  addRep(0.02 * G.mods.repGain * layoutStats().rep);
  toast(`Возврат оформлен · +${BALANCE.returnFee} ₽`, 'good');
  AudioSys.cash();
  if (customer && customer.state !== 'leaving') customerLeave(customer, 'served');
  G.action = null;
  document.getElementById('scan-progress').classList.add('hidden');
  updateHUD();
}
function addRep(delta) {
  G.rep = clamp(G.rep + delta, 0, 5);
  updateHUD();
  checkEndConditions();
}
function checkEndConditions() {
  if (G.rep <= 1.0 && G.screen === 'play') {
    saveRecords();
    G.screen = 'gameover';
    clearOrderCard();
    document.getElementById('go-earned').textContent = Math.round(G.lifetimeEarned) + ' ₽';
    document.getElementById('go-rank').textContent = rankName(G.lifetimeEarned);
    document.getElementById('gameover').classList.remove('hidden');
    AudioSys.gameover();
  } else if (G.rep >= 5.0 && !G.victoryShown && G.screen === 'play') {
    saveRecords();
    G.victoryShown = true;
    G.screen = 'victory';
    document.getElementById('vic-earned').textContent = Math.round(G.lifetimeEarned) + ' ₽';
    document.getElementById('vic-rank').textContent = rankName(G.lifetimeEarned);
    document.getElementById('victory').classList.remove('hidden');
    AudioSys.victory();
  }
}

// ---------- Автоподход + клик по миру ----------
function smartAct(dest, arrive, fn) {
  const d = Math.hypot(player.position.x - dest.x, player.position.z - dest.z);
  if (d <= arrive) fn();
  else G.autoMove = { dest: new THREE.Vector3(dest.x, 0, dest.z), arrive, run: fn };
}
function handleCounterClick() {
  const act = () => {
    if (G.carried && G.carried.kind === 'parcel') {
      const match = servedCustomerAtCounter(G.carried.id);
      if (match) {
        if (!match.qrScanned) { toast('Сначала отсканируйте QR клиента у стойки', 'warn'); return; }
        startScan(match); return;
      }
      toast('Этот заказ никто не ждёт', 'warn'); return;
    }
    if (G.carried) { toast('На стойку несут посылки 🙂', 'warn'); return; }
    const ret = waitingReturner();
    if (ret) { startReturn(ret); return; }
    const uq = unscannedWaiting();
    if (uq) { startQr(uq); return; }
    const scanned = customers.find(c => c.state === 'waiting' && !c.isReturn && c.qrScanned && c.parcel);
    if (scanned) toast(`${scanned.parcel.id} — место: ${cellLoc(scanned.parcel.cell)}`, 'warn');
    else toast('Никто не ждёт обслуживания', 'warn');
  };
  if (nearCounterDist() < 2.15) act();
  else G.autoMove = { dest: new THREE.Vector3(COUNTER_APPROACH.x, 0, COUNTER_APPROACH.z), arrive: 0.45, run: act };
}
function handleWorldClick(root) {
  const tag = root.userData.interactTag;
  if (!tag) return;
  switch (tag) {
    case 'bigbox': {
      const item = floorItems.find(i => i.mesh === root);
      if (!item) return;
      if (G.carried) { toast('Руки заняты — освободите их', 'warn'); return; }
      smartAct(root.position, 1.7, () => pickupFloorItem(item));
      break;
    }
    case 'parcel': {
      const parcel = parcels.find(p => p.mesh === root);
      if (!parcel) return;
      if (G.carried) { toast('Руки заняты — освободите их', 'warn'); return; }
      if (parcel.cell) {
        smartAct(new THREE.Vector3(parcel.cell.x, 0, parcel.cell.z), 1.75, () => takeFromCell(parcel.cell));
      } else if (parcel.bulkySlot != null) {
        smartAct(new THREE.Vector3(BULKY_RACK.x, 0, BULKY_RACK.z), 2.1, () => takeBulky(parcel));
      } else {
        const item = floorItems.find(i => i.parcel === parcel);
        if (item) smartAct(root.position, 1.45, () => pickupFloorItem(item));
      }
      break;
    }
    case 'cell': {
      const cell = root.userData.cell;
      if (G.carried && G.carried.kind === 'parcel') {
        if (cell.parcel) { toast('Ячейка занята', 'warn'); return; }
        smartAct(new THREE.Vector3(cell.x, 0, cell.z), 1.75, () => placeInCell(cell));
      } else if (!G.carried) {
        if (cell.parcel) smartAct(new THREE.Vector3(cell.x, 0, cell.z), 1.75, () => takeFromCell(cell));
        else toast('Ячейка пуста', 'warn');
      } else toast('Большие короба — на стол', 'warn');
      break;
    }
    case 'table':
      if (G.carried && G.carried.kind === 'big') smartAct(new THREE.Vector3(TABLE_POS.x, 0, TABLE_POS.z), 1.85, () => G.carried.docScanned ? startUnpack() : startTtn());
      else if (G.carried && G.carried.parcel && G.carried.parcel.type === 'defect') smartAct(new THREE.Vector3(TABLE_POS.x, 0, TABLE_POS.z), 1.85, repackageCarried);
      else toast('Сюда — короба с поставкой и брак', 'warn');
      break;
    case 'bin':
      if (G.carried && G.carried.parcel && G.carried.parcel.type === 'defect') smartAct(new THREE.Vector3(BIN_POS.x, 0, BIN_POS.z), 1.75, binDefect);
      else toast('Сюда сдают только брак', 'warn');
      break;
    case 'counter':
    case 'qr':
      handleCounterClick();
      break;
    case 'customer': {
      const c = root.userData.customer;
      if (c && c.state === 'waiting' && !c.isReturn && !c.qrScanned) {
        if (nearCounterDist() < 2.15) startQr(c);
        else G.autoMove = { dest: new THREE.Vector3(COUNTER_APPROACH.x, 0, COUNTER_APPROACH.z), arrive: 0.45, run: () => startQr(c) };
      } else if (c && c.state === 'waiting' && c.isReturn) {
        G.autoMove = { dest: new THREE.Vector3(COUNTER_APPROACH.x, 0, COUNTER_APPROACH.z), arrive: 0.45, run: () => startReturn(c) };
      }
      break;
    }
  }
}

// ---------- Контекстная подсказка (E) ----------
// ---------- Габариты: стойка у входа ----------
function bulkyStored() { return parcels.filter(p => p.type === 'bulky' && p.bulkySlot != null); }
function bulkyFreeSlot() {
  const used = new Set(bulkyStored().map(p => p.bulkySlot));
  for (let i = 0; i < BALANCE.bulkySlots; i++) if (!used.has(i)) return i;
  return -1;
}
function storeBulkyCarried() {
  const parcel = G.carried.parcel;
  const slot = bulkyFreeSlot();
  if (slot < 0) { toast('Стойка «Габарит» заполнена — место только под 3 посылки', 'warn'); AudioSys.denied(); return; }
  const item = detachCarried();
  parcel.bulkySlot = slot;
  parcel.cell = null;
  item.mesh.position.set(BULKY_RACK.x + 0.18, BULKY_SLOT_Y[slot], BULKY_RACK.z + rand(-0.08, 0.08));
  item.mesh.rotation.set(0, Math.PI / 2 + rand(-0.06, 0.06), 0);
  setBlobVisible(item.mesh, false);
  // больше не «свободная посылка на полу» — живёт на стойке
  for (let i = floorItems.length - 1; i >= 0; i--) if (floorItems[i].parcel === parcel) floorItems.splice(i, 1);
  tagInteract(item.mesh, 'parcel');
  toast(`Габарит ${parcel.id} на стойке ✓`, 'good');
  AudioSys.place();
  parcelsDirty = true;
  updateHUD();
  updateOrderCard();
}
function takeBulky(parcel) {
  parcel.bulkySlot = null;
  for (let i = floorItems.length - 1; i >= 0; i--) if (floorItems[i].parcel === parcel) floorItems.splice(i, 1);
  untagInteract(parcel.mesh);
  G.carried = { kind: 'parcel', id: parcel.id, mesh: parcel.mesh, parcel };
  attachCarried(parcel.mesh);
  AudioSys.pickup();
  updateHUD();
  updateOrderCard();
}
function nearBulkyRack() {
  return Math.hypot(player.position.x - BULKY_RACK.x, player.position.z - BULKY_RACK.z) < 2.15;
}

function getInteraction() {
  if (G.action || G.placing) return null;
  const px = player.position.x, pz = player.position.z;
  const nearCounter = nearCounterDist() < 2.15;
  const nearTable = Math.hypot(px - TABLE_POS.x, pz - TABLE_POS.z) < 2.2;
  const nearBin = Math.hypot(px - BIN_POS.x, pz - BIN_POS.z) < 1.9;

  const nearFridge = Math.hypot(px - FRIDGE_POS.x, pz - FRIDGE_POS.z) < 1.9;
  const nearWC = Math.hypot(px - WC_POS.x, pz - WC_POS.z) < 1.9;

  if (!G.carried) {
    if (nearFridge) {
      if (G.hunger > 92) return { label: 'Вы не голодны', soft: true, action: () => toast('Сытость на максимуме', 'good') };
      return { label: `Перекусить · ${BALANCE.eatCost} ₽ (+${BALANCE.eatHunger})`, action: useFridge };
    }
    if (nearWC) {
      if (G.energy > 92) return { label: 'Вы бодры!', soft: true, action: () => toast('Бодрость на максимуме', 'good') };
      return { label: `В туалет (+${BALANCE.wcEnergy} бодрости)`, action: useWC };
    }
    if (nearBulkyRack()) {
      const wanted = G.activeOrder && G.activeOrder.parcel && G.activeOrder.parcel.type === 'bulky' ? G.activeOrder.parcel : null;
      const stored = bulkyStored();
      if (wanted && wanted.bulkySlot != null) return { label: `Взять габарит ${wanted.id}`, action: () => takeBulky(wanted) };
      if (stored.length) return { label: `Взять габарит ${stored[0].id} со стойки`, action: () => takeBulky(stored[0]) };
      return { label: 'Стойка «Габарит»', soft: true, action: () => toast('Сюда кладут крупные заказы — ячейки им не подходят', 'warn') };
    }
    if (nearCounter) {
      const ret = waitingReturner();
      if (ret) return { label: `Оформить возврат ${ret.retId} (+${BALANCE.returnFee} ₽)`, action: () => startReturn(ret) };
      const uq = unscannedWaiting();
      if (uq) return { label: 'Сканировать QR клиента', action: () => startQr(uq) };
      const scanned = customers.find(c => c.state === 'waiting' && !c.isReturn && c.qrScanned && c.parcel);
      if (scanned) return { label: `Клиент ждёт ${scanned.parcel.id} · ${cellLoc(scanned.parcel.cell)}`, soft: true, action: () => toast('Несите посылку на стойку', 'warn') };
    }
    const big = nearestFloorItem('big');
    if (big.item && big.dist < 1.7) return { label: 'Поднять короб (внутри 3 посылки)', action: () => pickupFloorItem(big.item) };
    const par = nearestFloorItem('parcel');
    if (par.item && par.dist < 1.5) return { label: `Поднять ${par.item.id}${TYPE_SHORT[par.item.parcel.type] || ''}`, action: () => pickupFloorItem(par.item) };
    const { cell, dist } = nearestCellWithParcel();
    if (cell && dist < 1.75) {
      const wanted = cell.parcel.reservedBy ? ' · нужно клиенту' : '';
      return { label: `Взять ${cell.parcel.id}${wanted}`, action: () => takeFromCell(cell) };
    }
    return null;
  }

  if (G.carried.kind === 'big') {
    if (nearTable) {
      if (!G.carried.docScanned) return { label: `Сканировать ТТН (+${BALANCE.ttnBonus} ₽)`, action: startTtn };
      return { label: 'Распаковать короб (скотч, нож, 3 посылки)', action: startUnpack };
    }
    return { label: 'Короб нужно вскрыть на столе (слева)', soft: true, action: () => toast('Отнесите короб на распаковочный стол', 'warn') };
  }

  const cp = G.carried.parcel;
  if (nearFridge || nearWC) {
    return { label: 'Сначала положите посылку', soft: true, action: () => toast('Руки заняты — сначала посылка', 'warn') };
  }
  if (nearBulkyRack()) {
    if (cp.type === 'bulky') return { label: 'Положить габарит на стойку', action: storeBulkyCarried };
    return { label: 'На стойку — только габариты', soft: true, action: () => toast('Обычные посылки — по ячейкам стеллажа', 'warn') };
  }
  if (nearBin) {
    if (cp.type === 'defect') return { label: `Сдать брак в контейнер (+${BALANCE.binBonus} ₽)`, action: binDefect };
    return { label: 'Контейнер только для брака', soft: true, action: () => toast('Сюда сдают только бракованные посылки', 'warn') };
  }
  if (nearTable && cp.type === 'defect') {
    return { label: `Пересадить брак в новую коробку (−${BALANCE.repackageCost} ₽)`, action: repackageCarried };
  }
  if (nearCounter) {
    const match = servedCustomerAtCounter(G.carried.id);
    if (match) {
      if (!match.qrScanned) return { label: 'Сначала отсканируйте QR клиента', soft: true, action: () => toast('Нажмите E — отсканируем QR', 'warn') };
      return { label: `Выдать заказ ${G.carried.id} клиенту`, action: () => startScan(match) };
    }
    return { label: `Заказ ${G.carried.id} никто у стойки не ждёт`, soft: true, action: () => toast('Ни один клиент не ждёт этот заказ', 'warn') };
  }
  if (cp.type === 'bulky') return { label: 'Габарит — на стойку у входа слева', soft: true, action: () => toast('Крупные заказы хранятся на стойке «Габарит»', 'warn') };
  const { cell, dist } = nearestFreeCell();
  if (cell && dist < 1.75) return { label: `Положить ${G.carried.id} в ячейку`, action: () => placeInCell(cell) };
  return { label: 'Ищите свободную ячейку на стеллаже', soft: true, action: () => toast('Поднесите посылку к свободной ячейке', 'warn') };
}

// ============================================================
//  Часы смены 09:00 → 21:00, часы пик и затишья, состояние сотрудника
// ============================================================
const DAY_START_MIN = 9 * 60, DAY_END_MIN = 21 * 60;
function gameMinutesNow() {
  const frac = clamp(G.timeLeft / BALANCE.dayLength, 0, 1);
  return DAY_END_MIN - frac * (DAY_END_MIN - DAY_START_MIN);
}
function fmtClock(mins) {
  const h = Math.floor(mins / 60), m = Math.floor(mins % 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
function dayPhase(mins) {
  if (mins < 10.5 * 60)  return { id: 'lull',   label: '☕ Утро · затишье',    mul: 0.75 };
  if (mins < 12 * 60)    return { id: 'normal', label: '🌤️ Рабочее утро',      mul: 1.0 };
  if (mins < 14 * 60)    return { id: 'rush',   label: '🔥 Обеденный час пик', mul: 1.65 };
  if (mins < 15.5 * 60)  return { id: 'lull',   label: '☕ Тихий час',         mul: 0.6 };
  if (mins < 17 * 60)    return { id: 'normal', label: '🌤️ Ровный поток',      mul: 1.1 };
  if (mins < 20 * 60)    return { id: 'rush',   label: '🔥 Вечерний час пик',  mul: 1.8 };
  return { id: 'close',  label: '🌙 До закрытия',       mul: 0.8 };
}
const phaseChipEl = () => document.getElementById('phase-chip');
function currentPhase() { return dayPhase(gameMinutesNow()); }

// --- состояние сотрудника: сытость и бодрость
function vitalsActionMul() {
  let m = 1;
  if (G.hunger < 35) m *= 0.88;
  if (G.energy < 35) m *= 0.88;
  if (G.hunger < 15 || G.energy < 15) m = Math.min(m, 0.72);
  return m;
}
function vitalsMoveMul() {
  let m = 1;
  if (G.hunger < 15) m *= 0.9;
  if (G.energy < 15) m *= 0.85;
  return m;
}
function updateVitals(dt) {
  if (G.screen !== 'play') return;
  const rush = currentPhase().id === 'rush';
  const dH = 100 / BALANCE.dayLength;
  const dE = 100 / (BALANCE.dayLength * 1.35);
  G.hunger = clamp(G.hunger - dH * (rush ? 1.35 : 1) * dt, 0, 100);
  G.energy = clamp(G.energy - dE * (rush ? 2.1 : 0.8) * dt, 0, 100);
  if (G.hunger < 35 && !G.hungerWarned) { G.hungerWarned = true; toast('🍖 Голодно — перекусите у холодильника', 'warn'); }
  if (G.energy < 35 && !G.energyWarned) { G.energyWarned = true; toast('⚡ Вы устали — туалет освежает, кофе бодрит', 'warn'); }
}
function updateVitalsHUD() {
  const h = document.getElementById('hunger-fill'); if (h) h.style.width = G.hunger + '%';
  const e = document.getElementById('energy-fill'); if (e) e.style.width = G.energy + '%';
  if (h && h.parentElement) h.parentElement.classList.toggle('low', G.hunger < 15);
  if (e && e.parentElement) e.parentElement.classList.toggle('low', G.energy < 15);
}

function updateComboChip() {
  const chip = document.getElementById('combo-chip');
  if (!chip) return;
  const mul = Math.min(Math.max(G.tipCombo || 0, 1), BALANCE.tipComboMax);
  if ((G.tipCombo || 0) >= 2) { chip.textContent = `🔥 Комбо ×${mul}`; chip.classList.remove('hidden'); }
  else chip.classList.add('hidden');
}

// --- Перерыв: дверь закрыта, клиентов не будет (уборка/поставка/туалет)
let breakBanner = null;
function ensureBreakBanner() {
  if (breakBanner) return breakBanner;
  const g = new THREE.Group();
  const board = boxMesh(2.6, 0.62, 0.08, 0xd94f30, { roughness: 0.6 }); board.position.y = 0; g.add(board);
  const txt = makeCanvas(512, 128, (ctx, w, h2) => {
    ctx.fillStyle = '#d94f30'; ctx.fillRect(0, 0, w, h2);
    ctx.fillStyle = '#ffe9d6'; ctx.font = '900 64px Manrope, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('ЗАКРЫТО', w / 2, h2 / 2 + 2);
  });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.5), new THREE.MeshBasicMaterial({ map: txt }));
  face.position.z = 0.045; g.add(face);
  const face2 = face.clone(); face2.rotation.y = Math.PI; face2.position.z = -0.045; g.add(face2);
  g.position.set(0, 2.05, ROOM.z - 0.55);
  g.visible = false;
  scene.add(g);
  breakBanner = g;
  return g;
}
function setBreak(on, silent) {
  if (G.screen !== 'play' && on) return;
  G.breakOn = on;
  if (on) {
    G.breakOpenAtMin = gameMinutesNow() + 120; // дверь откроется сама через 2 игровых часа
    toast('🚪 Перерыв — дверь закрыта. Новых клиентов не будет', 'warn');
  } else {
    G.breakOpenAtMin = null;
    if (!silent) toast('🔔 Дверь открыта — работаем!', 'good');
  }
  ensureBreakBanner().visible = on;
  const btn = document.getElementById('btn-break');
  if (btn) btn.classList.toggle('break-on', on);
  const chip = document.getElementById('break-chip');
  if (chip) chip.classList.toggle('hidden', !on);
}
function toggleBreak() { setBreak(!G.breakOn); }

function useFridge() {
  if (G.money < BALANCE.eatCost) { toast(`Не хватает ${BALANCE.eatCost} ₽ на перекус`, 'warn'); AudioSys.denied(); return; }
  G.money -= BALANCE.eatCost;
  G.hunger = clamp(G.hunger + BALANCE.eatHunger, 0, 100);
  G.energy = clamp(G.energy + 5, 0, 100);
  toast(`🥪 Перекусили из холодильника (+${BALANCE.eatHunger} сытости, −${BALANCE.eatCost} ₽)`, 'good');
  AudioSys.buy();
  updateVitalsHUD();
  updateHUD();
}
function useWC() {
  G.energy = clamp(G.energy + BALANCE.wcEnergy, 0, 100);
  G.hunger = clamp(G.hunger - 2, 0, 100);
  toast(`🚿 Освежились и восстановились (+${BALANCE.wcEnergy} бодрости)`, 'good');
  AudioSys.place();
  updateVitalsHUD();
}

// ============================================================
//  День / события / расходы
// ============================================================
function applyDayEvent() {
  G.mods = { patience: 1, scan: 1, customers: 1, repGain: 1, repLoss: 1, extraBox: 0 };
  G.event = null;
  G.lightsOut = false;
  if (G.day === 1) { hudEvent.textContent = ''; return; }
  const pool = EVENTS.filter(e => !e.minDay || G.day >= e.minDay);
  const ev = choice(pool);
  G.event = ev;
  Object.assign(G.mods, ev.mods);
  G.lightsOut = ev.id === 'lights';
  hudEvent.textContent = 'Событие дня: ' + ev.name;
  setTimeout(() => toast(`Событие дня: ${ev.name} — ${ev.desc}`, 'warn'), 700);
}
function startDay(n) {
  G.day = n;
  G.timeLeft = BALANCE.dayLength;
  G.issuedToday = 0; G.dayEarned = 0; G.angryToday = 0; G.tipsToday = 0; G.tipCombo = 0; updateComboChip();
  G.deliveryTimer = BALANCE.deliveryFirst;
  G.customerTimer = 5;
  G.warned10s = false;
  G.debtWarning = false;
  G.hunger = 100; G.energy = 100;
  G.hungerWarned = false; G.energyWarned = false;
  G.breakOn = false; G.breakOpenAtMin = null;
  G.lastPhaseId = 'start';
  if (breakBanner) breakBanner.visible = false;
  const breakBtn = document.getElementById('btn-break'); if (breakBtn) breakBtn.classList.remove('break-on');
  const breakChip = document.getElementById('break-chip'); if (breakChip) breakChip.classList.add('hidden');
  G.screen = 'play';
  document.getElementById('day-end').classList.add('hidden');
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  dayTimerFill.classList.remove('low');
  applyDayEvent();
  updateHUD();
  if (!G.event) toast(`День ${n}. 09:00 — Открываемся! 🔔`, 'good');
}
function endDay() {
  G.screen = 'dayEnd';
  cancelPlacement();
  clearOrderCard();
  for (const c of [...customers]) {
    if (c.bubble) { c.bubble.remove(); c.bubble = null; }
    if (c.parcel && c.parcel.reservedBy === c) c.parcel.reservedBy = null;
    untagInteract(c.mesh);
    scene.remove(c.mesh);
    removeFromArray(customers, c);
  }
  if (G.qrLaser) { scene.remove(G.qrLaser); G.qrLaser = null; }
  G.action = null;
  document.getElementById('scan-progress').classList.add('hidden');

  const loc = locBonus();
  const rentDed = BALANCE.utilities + loc.rent;
  G.money -= rentDed;
  if (G.money < 0) { G.money = 0; G.debtWarning = true; addRep(-0.25); }
  const net = Math.round(G.dayEarned - rentDed);

  saveRecords();
  renderRecords();
  const autoOk = saveToSlot(G.saveSlot, true);
  const autoEl = document.getElementById('de-autosave');
  if (autoEl) autoEl.textContent = autoOk ? `💾 Автосохранение · слот ${G.saveSlot} ✓` : '💾 Автосейв не удался';
  document.getElementById('de-day').textContent = G.day;
  document.getElementById('de-issued').textContent = G.issuedToday;
  const tipsEl = document.getElementById('de-tips'); if (tipsEl) tipsEl.textContent = Math.round(G.tipsToday || 0) + ' ₽';
  document.getElementById('de-earned').textContent = Math.round(G.dayEarned) + ' ₽';
  document.getElementById('de-angry').textContent = G.angryToday;
  document.getElementById('de-rep').textContent = G.rep.toFixed(1) + ' ★';
  document.getElementById('de-rank').textContent = rankName(G.lifetimeEarned);
  document.getElementById('de-next').textContent = G.day + 1;
  document.getElementById('de-costs').textContent = `−${rentDed} ₽ (${loc.id === 'metro' ? 'аренда + ЖКХ' : 'ЖКХ'})`;
  const netEl = document.getElementById('de-net');
  netEl.textContent = (net >= 0 ? '+' : '−') + Math.abs(net) + ' ₽';
  netEl.classList.toggle('net-pos', net >= 0);
  document.getElementById('day-end').classList.remove('hidden');
  if (G.debtWarning) toast('Арендатор намекнул на задолженность… −0.25 ★', 'bad');
  AudioSys.dayEnd();
}

// ============================================================
//  Грузчик «Денис»
// ============================================================
let loader = null;
function hireLoader() {
  if (loader) return;
  const mesh = makePerson({ body: 0xff8a00, skin: 0xe0ac82, pants: 0x2b3a4a, hat: 0xffffff });
  mesh.position.set(-5.4, 0, 2.2);
  scene.add(mesh);
  const tag = labelSprite('Денис', {});
  tag.position.set(0, 1.98, 0);
  tag.scale.set(0.72, 0.33, 1);
  mesh.add(tag);
  loader = { mesh, state: 'idle', timer: 1.5, target: null, walkPhase: 0 };
  toast('Денис вышел на смену 👷', 'good');
}
function updateLoader(dt) {
  if (!loader || G.screen !== 'play') return;
  const L = loader;
  const moveTo = (target, arriveDist) => {
    const dir = new THREE.Vector3(target.x - L.mesh.position.x, 0, target.z - L.mesh.position.z);
    const dist = dir.length();
    if (dist < arriveDist) return true;
    dir.normalize();
    L.mesh.position.addScaledVector(dir, Math.min(dist, BALANCE.loaderSpeed * dt));
    L.mesh.rotation.y = Math.atan2(dir.x, dir.z);
    L.walkPhase += dt * 9;
    animateWalk(L.mesh, L.walkPhase, !!L.carrying || !!L.carryingDefect);
    return false;
  };
  if (L.state === 'idle') {
    L.timer -= dt;
    if (L.timer <= 0) {
      // Сначала: убрать брак с пола/стола в контейнер
      const defect = parcels.find(p => p.type === 'defect' && !p.cell && !p.reservedBy);
      if (defect) { L.target = defect; L.state = 'toDefect'; return; }
      const box = floorItems.find(i => i.kind === 'big');
      if (box && box.mesh.visible) { L.target = box; L.state = 'toBox'; }
      else L.timer = 1.5;
    }
  } else if (L.state === 'toDefect') {
    const d = L.target;
    if (!d || !parcels.includes(d)) { L.state = 'idle'; L.timer = 1; L.target = null; return; }
    if (moveTo(d.mesh.position, 0.75)) {
      for (let i = floorItems.length - 1; i >= 0; i--) if (floorItems[i].parcel === d) floorItems.splice(i, 1);
      const pi = parcels.indexOf(d); if (pi >= 0) parcels.splice(pi, 1);
      if (d.label && d.label.parent) d.label.parent.remove(d.label);
      d.label = null;
      untagInteract(d.mesh);
      attachCarriedTo(loader, d.mesh);
      L.carryingDefect = d;
      L.target = null;
      L.state = 'toBin';
      parcelsDirty = true;
    }
  } else if (L.state === 'toBin') {
    if (moveTo(BIN_POS, 1.05)) {
      const m = L.carryingDefect && L.carryingDefect.mesh;
      if (m && m.parent) m.parent.remove(m);
      L.carryingDefect = null;
      parcelsDirty = true;
      L.state = 'idle';
      L.timer = BALANCE.loaderCooldown;
      AudioSys.crack();
      toast('Денис утилизировал брак 🗑', 'good');
    }
  } else if (L.state === 'toBox') {
    if (!floorItems.includes(L.target)) { L.state = 'idle'; L.timer = 1; L.target = null; return; }
    if (moveTo(L.target.mesh.position, 0.75)) {
      L.target.mesh.visible = false;
      untagInteract(L.target.mesh);
      removeFromArray(floorItems, L.target);
      removeFromArray(bigBoxes, L.target.mesh);
      L.carrying = L.target;
      attachCarriedTo(loader, L.carrying.mesh);
      L.state = 'toTable';
    }
  } else if (L.state === 'toTable') {
    if (moveTo(TABLE_POS, 1.1)) {
      if (L.carrying) {
        const box = L.carrying.mesh;
        if (box.parent) box.parent.remove(box);
        world.add(box);
        box.position.set(TABLE_POS.x, 0.98, TABLE_POS.z);
        box.rotation.set(0, rand(-0.15, 0.15), 0);
        box.scale.setScalar(1);
        G.unpackAnim = { t: 0, dur: 1.2, mesh: box, spawned: false };
        L.carrying = null;
      }
      L.state = 'idle';
      L.timer = BALANCE.loaderCooldown;
      AudioSys.unpack();
      toast('Денис вскрыл короб 📦');
    }
  }
}
function attachCarriedTo(L, mesh) {
  mesh.visible = true;
  setBlobVisible(mesh, false);
  if (mesh.parent) mesh.parent.remove(mesh);
  mesh.position.set(0, 0.92, 0.34);
  mesh.rotation.set(0, 0, 0);
  L.mesh.add(mesh);
}
function loaderCarryRemove(mesh) {
  if (mesh.parent) mesh.parent.remove(mesh);
  world.remove(mesh);
}
function attachCarriedToPlayerCheck() {} // (оставлено для совместимости)

// ============================================================
//  Ввод: клавиатура (e.code) + сенсор
// ============================================================
const keys = {};
function doInteract() {
  if (G.screen !== 'play' || G.placing) return;
  const it = getInteraction();
  if (it) it.action();
}
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyE') doInteract();
  if (e.code === 'KeyR' && G.placing) rotatePlacement();
  if (e.code === 'KeyB') {
    if (G.placing) return;
    if (G.screen === 'play' || G.screen === 'dayEnd') openShop();
    else if (G.screen === 'shop') closeShop();
  }
  if (e.code === 'KeyN') toggleBreak();
  if (e.code === 'Escape') {
    if (G.placing) { cancelPlacement(); return; }
    if (G.screen === 'shop') closeShop();
    else if (G.screen === 'locations') closeLocations();
    else if (G.screen === 'play') { G.screen = 'pause'; document.getElementById('pause').classList.remove('hidden'); }
    else if (G.screen === 'pause') { G.screen = 'play'; document.getElementById('pause').classList.add('hidden'); }
  }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  cameraDist = clamp(cameraDist + Math.sign(e.deltaY) * 0.8, 8, 13.5);
}, { passive: false });
canvas.addEventListener('pointermove', e => {
  const rect = canvas.getBoundingClientRect();
  mouseNDC.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
});
canvas.addEventListener('pointerdown', e => {
  if (G.screen !== 'play') return;
  if (G.placing) {
    if (e.button === 2) { cancelPlacement(); return; }
    if (e.pointerType === 'touch' || e.button === 0) commitPlacement();
    return;
  }
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  if (e.pointerType === 'touch' && e.clientX < window.innerWidth * 0.45) return; // левая половина — движение
  const rect = canvas.getBoundingClientRect();
  mouseNDC.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(mouseNDC, camera);
  const hits = raycaster.intersectObjects(clickables, true);
  if (e.pointerType === 'touch') G.tapWorldHit = hits.length > 0;
  if (!hits.length) return;
  const root = hits[0].object.userData.hitRoot;
  if (root) handleWorldClick(root);
});

// ---- Сенсор: управление в любом месте экрана ----
const isTouchMode = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const touchUi = document.getElementById('touch-ui');
const joystickEl = document.getElementById('joystick');
const joyNub = document.getElementById('joy-nub');
const btnTouchE = document.getElementById('btn-touch-e');
const joyVec = { x: 0, y: 0 };
const JOY_MAX = 44;
const joyState = { active: false, id: -1, ox: 0, oy: 0 };
let tapStart = null;
const uiHit = (t) => !!(t && t.closest && t.closest('button,input,#hud,#order-card,#build-hint,#scan-progress,#shop,#locations,#day-end,#pause,#menu,#loading,#gameover,#victory,#toasts,#touch-ui'));
if (isTouchMode) touchUi.classList.remove('hidden');
function joyShow(x, y) {
  joystickEl.style.left = x + 'px';
  joystickEl.style.top = y + 'px';
  joystickEl.classList.add('show');
  joyNub.style.transform = 'translate(-50%,-50%)';
}
function joyHide() {
  joyState.active = false; joyState.id = -1;
  joyVec.x = 0; joyVec.y = 0;
  joystickEl.classList.remove('show');
}
function joyMove(x, y) {
  let dx = x - joyState.ox, dy = y - joyState.oy;
  const len = Math.hypot(dx, dy);
  if (len > JOY_MAX) { dx = dx / len * JOY_MAX; dy = dy / len * JOY_MAX; }
  joyVec.x = dx / JOY_MAX; joyVec.y = dy / JOY_MAX;
  joyNub.style.transform = `translate(-50%,-50%) translate(${dx}px,${dy}px)`;
}
document.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'touch') return;
  if (uiHit(e.target)) return;
  if (e.clientX < window.innerWidth * 0.45) {
    if (G.screen !== 'play') return;
    joyState.active = true; joyState.id = e.pointerId;
    joyState.ox = e.clientX; joyState.oy = e.clientY;
    joyShow(e.clientX, e.clientY);
  } else {
    tapStart = { x: e.clientX, y: e.clientY, t: performance.now() };
  }
}, { passive: true });
document.addEventListener('pointermove', e => {
  if (e.pointerType !== 'touch') return;
  if (joyState.active && e.pointerId === joyState.id) { joyMove(e.clientX, e.clientY); e.preventDefault(); }
}, { passive: false });
function touchEnd(e) {
  if (e.pointerType !== 'touch') return;
  if (joyState.active && e.pointerId === joyState.id) { joyHide(); return; }
  if (tapStart) {
    const dx = e.clientX - tapStart.x, dy = e.clientY - tapStart.y;
    const quick = performance.now() - tapStart.t < 350 && Math.hypot(dx, dy) < 14;
    const hitWorld = G.tapWorldHit === true;
    tapStart = null;
    G.tapWorldHit = false;
    if (quick && !hitWorld && G.screen === 'play' && !G.placing) doInteract();
  }
}
document.addEventListener('pointerup', touchEnd);
document.addEventListener('pointercancel', touchEnd);
btnTouchE.addEventListener('pointerdown', e => { e.preventDefault(); doInteract(); });

// Кнопки UI
document.getElementById('btn-shop').addEventListener('click', () => { if (G.screen === 'play') openShop(); });
document.getElementById('btn-break').addEventListener('click', toggleBreak);
document.getElementById('btn-loc').addEventListener('click', () => { if (G.screen === 'play') openLocations(); });
document.getElementById('btn-pause').addEventListener('click', () => { if (G.screen === 'play') { G.screen = 'pause'; document.getElementById('pause').classList.remove('hidden'); } });
document.getElementById('btn-inventory').addEventListener('click', () => {
  if (G.screen === 'play' && G.inventory.length && !G.placing) enterPlacement(G.inventory[0]);
});
document.getElementById('btn-shop-close').addEventListener('click', closeShop);
document.getElementById('btn-loc-close').addEventListener('click', closeLocations);
document.getElementById('btn-de-shop').addEventListener('click', openShop);
document.getElementById('btn-de-loc').addEventListener('click', openLocations);
document.getElementById('btn-next-day').addEventListener('click', () => {
  if (G.debtWarning) toast('Долги копились — аренда впереди!', 'warn');
  startDay(G.day + 1);
});
document.getElementById('btn-resume').addEventListener('click', () => { G.screen = 'play'; document.getElementById('pause').classList.add('hidden'); });
document.getElementById('btn-pause-shop').addEventListener('click', () => { document.getElementById('pause').classList.add('hidden'); openShop(); });
document.getElementById('btn-pause-save').addEventListener('click', () => { if (G.screen === 'pause') saveToSlot(G.saveSlot); });
document.getElementById('btn-restart').addEventListener('click', () => window.location.reload());
document.getElementById('btn-go-restart').addEventListener('click', () => window.location.reload());
document.getElementById('btn-vic-restart').addEventListener('click', () => window.location.reload());
document.getElementById('btn-vic-continue').addEventListener('click', () => {
  document.getElementById('victory').classList.add('hidden');
  G.screen = 'play';
});

// ============================================================
//  Игровой цикл
// ============================================================
const clock = new THREE.Clock();
let lastFragileBreak = 0;
const FIXED_STEP = 1 / 60;
const MAX_STEPS = 30;
let stepAcc = 0;

function resolveCollisions(pos) {
  const r = BALANCE.playerRadius;
  pos.x = clamp(pos.x, -ROOM.x + r, ROOM.x - r);
  pos.z = clamp(pos.z, -ROOM.z + r, ROOM.z - r);
  for (const c of colliders) {
    const nx = clamp(pos.x, c.minX, c.maxX);
    const nz = clamp(pos.z, c.minZ, c.maxZ);
    const dx = pos.x - nx, dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 === 0) { pos.z = c.maxZ + r; continue; }
      const d = Math.sqrt(d2);
      pos.x = nx + (dx / d) * r;
      pos.z = nz + (dz / d) * r;
    }
  }
}

function updatePlayer(dt) {
  if (G.action) { animateWalk(player, 0, false); return; }
  let mx = 0, mz = 0;
  const jx = joyVec.x, jy = joyVec.y;
  const manual = Math.abs(jx) > 0.12 || Math.abs(jy) > 0.12
    || keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD']
    || keys['ArrowUp'] || keys['ArrowDown'] || keys['ArrowLeft'] || keys['ArrowRight'];
  if (manual) {
    G.autoMove = null;
    if (isTouchMode && (Math.abs(jx) > 0.12 || Math.abs(jy) > 0.12)) {
      mx = jx; mz = jy;
      const l = Math.hypot(mx, mz);
      if (l > 1) { mx /= l; mz /= l; }
    } else {
      if (keys['KeyW'] || keys['ArrowUp']) mz -= 1;
      if (keys['KeyS'] || keys['ArrowDown']) mz += 1;
      if (keys['KeyA'] || keys['ArrowLeft']) mx -= 1;
      if (keys['KeyD'] || keys['ArrowRight']) mx += 1;
      const len = Math.hypot(mx, mz);
      if (len > 0) { mx /= len; mz /= len; }
    }
  } else if (G.autoMove) {
    const dx = G.autoMove.dest.x - player.position.x;
    const dz = G.autoMove.dest.z - player.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= G.autoMove.arrive) {
      const run = G.autoMove.run;
      G.autoMove = null;
      run();
      return;
    }
    mx = dx / dist; mz = dz / dist;
  }
  const moving = Math.abs(mx) > 0.01 || Math.abs(mz) > 0.01;
  if (moving) {
    const moveMul = vitalsMoveMul();
    const ix = player.position.x + mx * BALANCE.moveSpeed * moveMul * dt;
    const iz = player.position.z + mz * BALANCE.moveSpeed * moveMul * dt;
    player.position.x = ix;
    player.position.z = iz;
    resolveCollisions(player.position);
    const push = Math.hypot(ix - player.position.x, iz - player.position.z);
    if (push > 0.03 && G.carried && G.carried.kind === 'parcel' && G.carried.parcel.type === 'fragile') {
      const now = performance.now();
      if (now - lastFragileBreak > 900) {
        lastFragileBreak = now;
        if (Math.random() < 0.45) breakFragileParcel();
      }
    }
    player.rotation.y = Math.atan2(mx, mz);
    player.userData.walkPhase = (player.userData.walkPhase || 0) + dt * 10;
    animateWalk(player, player.userData.walkPhase, !!G.carried);
    player.position.y = Math.abs(Math.sin(player.userData.walkPhase)) * 0.05;
  } else {
    animateWalk(player, 0, !!G.carried);
    player.position.y = 0;
  }
}

function updateThermal(dt) {
  for (const p of [...parcels]) {
    if (p.spoil == null) continue;
    p.spoil -= dt;
    if (p.spoil <= 0) {
      toast(`Термо-посылка ${p.id} испортилась 🥶`, 'bad');
      AudioSys.denied();
      addRep(-0.06 * G.mods.repLoss);
      removeParcelWorld(p);
    }
  }
}
function updateCamera(dt) {
  const target = new THREE.Vector3(player.position.x, 0, player.position.z);
  const desired = new THREE.Vector3(
    player.position.x,
    cameraDist * 0.92,
    player.position.z + cameraDist * 0.78
  );
  camera.position.lerp(desired, 1 - Math.pow(0.001, dt));
  camera.lookAt(target.x, 0.4, target.z);
}
function updateAction(dt) {
  if (!G.action) return;
  G.action.t += dt * vitalsActionMul();
  const frac = clamp(G.action.t / G.action.dur, 0, 1);
  document.getElementById('scan-fill').style.width = (frac * 100) + '%';
  if (frac >= 1) {
    if (G.action.type === 'unpack') finishUnpack();
    else if (G.action.type === 'scan') finishScan();
    else if (G.action.type === 'ttn') finishTtn();
    else if (G.action.type === 'return') finishReturn();
    else if (G.action.type === 'qr') finishQr();
  }
}
function updateDeliveries(dt) {
  G.deliveryTimer -= dt;
  if (G.deliveryTimer <= 0) {
    G.deliveryTimer = BALANCE.deliveryEvery * rand(0.8, 1.2);
    const inFlight = floorItems.filter(i => i.kind === 'big').length;
    const want = Math.min(1 + Math.floor((G.day - 1) / 2) + (G.mods.extraBox || 0), BALANCE.maxBigBoxes + 1);
    let spawned = 0;
    for (let i = 0; i < want && inFlight + spawned < BALANCE.maxBigBoxes + 1; i++) { if (spawnBigBox()) spawned++; }
    if (spawned > 0) { toast('🚚 Поставка прибыла! Короба у паллеты (слева)', 'good'); AudioSys.door(); }
  }
}
function updateCustomersSpawn(dt) {
  if (G.breakOn) { G.customerTimer = Math.max(G.customerTimer, 2); return; } // дверь закрыта — клиенты ждут снаружи
  G.customerTimer -= dt;
  if (G.customerTimer <= 0) {
    const interval = BALANCE.customerEvery(G.day) / currentPhase().mul * (G.upgrades.sign ? 0.75 : 1) * G.mods.customers / (locBonus().customers * layoutStats().stream);
    G.customerTimer = interval * rand(0.75, 1.3);
    if (G.day >= 2 && Math.random() < BALANCE.returnChance) spawnReturner();
    else spawnCustomer();
  }
}
function updateDayTimer(dt) {
  G.timeLeft -= dt;
  const frac = clamp(G.timeLeft / BALANCE.dayLength, 0, 1);
  dayTimerFill.style.width = (frac * 100) + '%';
  dayTimerFill.classList.toggle('low', G.timeLeft < 20);
  const mins = gameMinutesNow();
  const dayEl = document.getElementById('hud-day');
  if (dayEl) dayEl.innerHTML = `День ${G.day} · <b>${fmtClock(mins)}</b>`;
  // фаза дня: чип + уведомления о входе в час пик / тишину
  const phase = dayPhase(mins);
  if (G.lastPhaseId !== phase.id) {
    if (phase.id === 'rush') toast(phase.label + ' — держитесь!', 'warn');
    else if (phase.id === 'lull' && G.lastPhaseId !== 'start') toast(phase.label + ' — можно сверить поставку', 'good');
    G.lastPhaseId = phase.id;
  }
  const chipEl = phaseChipEl();
  if (chipEl) {
    chipEl.textContent = phase.label;
    chipEl.classList.toggle('rush', phase.id === 'rush');
    chipEl.classList.toggle('lull', phase.id === 'lull');
  }
  // автооткрытие двери после перерыва
  if (G.breakOn && G.breakOpenAtMin != null && mins >= G.breakOpenAtMin) { setBreak(false, true); toast('🔔 2 часа перерыва прошли — дверь открыта', 'good'); }
  if (G.timeLeft <= 30 && !G.warned10s) { G.warned10s = true; toast('Через полминуты закрываемся!', 'warn'); }
  if (G.timeLeft <= 0) endDay();
}
const tmpV = new THREE.Vector3();
function updateBubbles() {
  for (const c of customers) {
    if (!c.bubble) continue;
    tmpV.copy(c.mesh.position); tmpV.y = 2.05 * c.mesh.scale.y;
    tmpV.project(camera);
    const behind = tmpV.z > 1;
    const x = (tmpV.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-tmpV.y * 0.5 + 0.5) * window.innerHeight;
    c.bubble.style.display = behind ? 'none' : 'block';
    c.bubble.style.left = x + 'px';
    c.bubble.style.top = y + 'px';
  }
}
function highlightWantedCells() {
  for (const s of shelves) for (const cell of s.cells) {
    if (cell.parcel && cell.parcel.label) {
      const wanted = !!cell.parcel.reservedBy;
      cell.parcel.label.material.color.setHex(wanted ? 0xffe14d : 0xffffff);
    }
  }
}
function updateGameplay(dt) {
  updatePlayer(dt);
  updateUnpackAnim(dt);
  updateDeliveries(dt);
  updateCustomersSpawn(dt);
  updateCustomers(dt);
  updateDayTimer(dt);
  updateVitals(dt);
  updateVitalsHUD();
  updateCompass();
  updateAction(dt);
  updateThermal(dt);
  updateLoader(dt);
  updatePlacement();
  const it = getInteraction();
  if (it && !G.action && !G.placing) {
    promptEl.classList.remove('hidden');
    promptText.textContent = it.label;
  } else {
    promptEl.classList.add('hidden');
  }
}

function tick() {
  requestAnimationFrame(tick);
  const frame = Math.min(clock.getDelta(), 0.5);
  const t = clock.elapsedTime;
  updateSnow(frame, t);
  updateDust(frame, t);
  stepAcc += frame;
  let steps = 0;
  while (stepAcc >= FIXED_STEP && steps < MAX_STEPS) {
    if (G.screen === 'play') updateGameplay(FIXED_STEP);
    stepAcc -= FIXED_STEP;
    steps++;
  }
  if (steps >= MAX_STEPS) stepAcc = 0;

  if (G.screen === 'play' || G.screen === 'shop' || G.screen === 'pause') {
    updateBubbles();
    updateFaces();
    highlightWantedCells();
    updateOrderCard();
  }
  if (G.beacon) {
    G.beacon.rotation.y += frame * 1.4;
    G.beacon.material.opacity = 0.4 + 0.25 * (1 + Math.sin(t * 4));
  }

  // Свет: штатно или «моргающие лампы»
  if (G.lightsOut && G.screen === 'play') {
    sun.intensity = 0.45 + Math.random() * 0.1;
    lamp.intensity = 0.18 + Math.random() * 0.22;
  } else {
    sun.intensity = 0.85;
    lamp.intensity = 0.5 + Math.sin(t * 2) * 0.08;
  }

  if (G.screen === 'menu') {
    const a = t * 0.14;
    camera.position.set(Math.sin(a) * 12, 7.6, Math.cos(a) * 9.2);
    camera.lookAt(0, 0.4, 0);
  } else {
    updateCamera(frame);
  }
  renderer.render(scene, camera);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

// ============================================================
//  Построение мира и запуск
// ============================================================
G.layoutsByLoc = loadLayouts();
buildRoom();
buildSeasonDecor();
buildSnow();
buildLightShaft();
buildStoryProps();
buildBulkyRack();
buildFridge();
buildWC();
applyLayout(G.layoutsByLoc['metro'] != null ? G.layoutsByLoc['metro'] : 0);
addShelf(0);

// Загрузочный экран: честно отрабатываем шаги и держим минимум 1.2 с
const bootFill = document.getElementById('boot-fill');
const bootStatus = document.getElementById('boot-status');
const bootTip = document.getElementById('boot-tip');
setInterval(() => {
  const loadingEl = document.getElementById('loading');
  if (!bootTip || !loadingEl || loadingEl.classList.contains('done')) return;
  bootTipIdx = (bootTipIdx + 1) % BOOT_TIPS.length;
  bootTip.style.opacity = '0';
  setTimeout(() => { bootTip.textContent = BOOT_TIPS[bootTipIdx]; bootTip.style.opacity = '1'; }, 160);
}, 2100);
const bootSteps = ['Зажигаем лампы', 'Раскладываем стеллажи', 'Заносим коробки', 'Проверяем сканер', 'Вешаем гирлянду', 'Зовём Дениса', 'Открываем витрину'];
const BOOT_TIPS = [
  'Совет: час пик — в обед и вечером, держитесь 🔥',
  'Совет: габариты не влезают в ячейки — стойка «Габарит» у входа 📦',
  'Совет: проголодались — холодильник у входа справа 🍖',
  'Совет: устали — в WC или за кофе, скорость важна ⚡',
  'Совет: N — закрыть дверь и спокойно разобрать поставку 🚪',
  'Совет: сохранение слева в меню — 3 слота, автосейв в конце дня 💾',
];
let bootTipIdx = 0;
let bootProgress = 0, bootDone = false;
function bootTick(startedAt) {
  bootProgress = Math.min(100, bootProgress + rand(6, 16));
  bootFill.style.width = bootProgress + '%';
  bootStatus.textContent = bootSteps[Math.min(bootSteps.length - 1, Math.floor(bootProgress / 100 * bootSteps.length))];
  if (bootProgress < 100) setTimeout(() => bootTick(startedAt), 130);
  else {
    const wait = Math.max(0, 1200 - (performance.now() - startedAt));
    setTimeout(() => {
      bootDone = true;
      document.getElementById('loading').classList.add('done');
      document.getElementById('menu').classList.remove('hidden');
    }, wait);
  }
}

// Меню: имя и логотип ПВЗ
loadBrand();
const nameInput = document.getElementById('pvz-name');
nameInput.value = G.pvzName;
const logoPicker = document.getElementById('logo-picker');
let selectedLogo = G.pvzLogo;
for (const btn of logoPicker.querySelectorAll('.logo-opt')) {
  btn.classList.toggle('selected', btn.dataset.mark === selectedLogo);
  btn.addEventListener('click', () => {
    selectedLogo = btn.dataset.mark;
    for (const b of logoPicker.querySelectorAll('.logo-opt')) b.classList.toggle('selected', b === btn);
  });
}
nameInput.addEventListener('input', () => { G.pvzName = nameInput.value.trim() || 'У Дома'; });

buildNameBoard(G.pvzName, G.pvzLogo);
function startNewGame(slot) {
  G.saveSlot = slot;
  G.pvzName = (nameInput.value || 'У Дома').trim().slice(0, 14) || 'У Дома';
  G.pvzLogo = selectedLogo;
  saveBrand();
  buildNameBoard(G.pvzName, G.pvzLogo);
  startDay(1);
  toast(`ПВЗ «${G.pvzName}» открывается! 🔔`, 'good');
}
document.getElementById('btn-start').addEventListener('click', () => {
  AudioSys.init();
  const sp = selectedSlotData();
  if (sp) {
    G.saveSlot = selectedSlot;
    applySave(sp);
    saveBrand();
    buildNameBoard(G.pvzName, G.pvzLogo);
    startDay(G.day);
    toast(`С возвращением, «${G.pvzName}»! День ${G.day} 🔔`, 'good');
  } else {
    startNewGame(selectedSlot);
  }
});

window.PVZ = { G, player, camera, renderer, scene, parcels, customers, shelves, floorItems, spawnCustomer, spawnReturner, getInteraction, enterPlacement, LOCATIONS, LAYOUTS, ROOM_TINTS, TABLE_POS, BIN_POS, COUNTER_POS, PALLET_POS, QUEUE_SLOTS, TABLE_SLOTS, applyLayout };
window.PVZ.debugClearParcels = function () {
  for (let i = parcels.length - 1; i >= 0; i--) removeParcelWorld(parcels[i]);
  return parcels.length;
};
window.PVZ.debugFillTable = function (n) {
  for (let i = 0; i < n; i++) {
    const slot = TABLE_SLOTS[i % TABLE_SLOTS.length];
    const p = spawnParcel(TABLE_POS.x + slot.dx, TABLE_POS.z + slot.dz, 0.96);
    p.mesh.position.set(TABLE_POS.x + slot.dx, 0.96, TABLE_POS.z + slot.dz);
  }
  return parcels.length;
};
window.PVZ.debugSpawnUnpacked = function () { spawnUnpackedParcels(); return parcels.length; };
window.PVZ.debugSetCameraDist = function (v) { cameraDist = v; };
window.PVZ.debugSpawnParcel = function (type, x, z) {
  const p = spawnParcel(x == null ? TABLE_POS.x : x, z == null ? TABLE_POS.z : z, 0, type || null);
  p.mesh.position.y = type === 'defect' ? 0 : 0;
  return p.id;
};
window.PVZ.debugStockParcel = function (type) {
  const s = shelves.find(s => s.cells.some(c => !c.parcel));
  const cell = s && s.cells.find(c => !c.parcel);
  if (!cell) return 'no-cell';
  const p = spawnParcel(cell.x, cell.z, cell.y, type || 'normal');
  p.cell = cell; cell.parcel = p;
  removeFromFloorItems(p);
  return p.id;
};
window.PVZ.hireLoader = hireLoader;
window.PVZ.debugForceCustomer = function () {
  const s = shelves.find(s => s.cells.some(c => !c.parcel));
  const cell = s && s.cells.find(c => !c.parcel);
  if (!cell) return 'no-cell';
  const p = spawnParcel(cell.x, cell.z, cell.y, 'normal');
  p.cell = cell; cell.parcel = p;
  const c = spawnCustomer();
  if (c) { c.patience = 0.5; }
  return c ? c.state : 'no-customer';
};
renderRecords();
renderSlots();
updateHUD();
camera.position.set(0, 7.6, 10);
camera.lookAt(0, 0.4, 0);
tick();
setTimeout(() => bootTick(performance.now()), 120);
