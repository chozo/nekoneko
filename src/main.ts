import './style.css';
import { Cat, N, TAIL_N } from './cat';
import { CAT_COLORS, ColorPicker, randomColor, type CatColor } from './colors';
import { createBox } from './container';
import { DEFAULT_PARAMS, PARAMS, PARAM_SLIDERS } from './params';
import { drawCat, drawContainer, drawDebug, drawExitMarks, drawScruffFold } from './render';
import { MatchSystem } from './rules';
import { updateGameOver } from './gameover';
import {
  isMuted,
  playButton,
  playChain,
  playDrop,
  playGameOver,
  playHop,
  playLand,
  playMatch,
  playMeow,
  playPick,
  playRecord,
  playScore,
  playWarn,
  setBgmIntensity,
  setMuted,
  audioDebug,
  audioRec,
  audioBufferToWavBase64,
  renderRecordedAudio,
  startBgm,
  stopBgm,
  unlockAudio,
} from './audio';
import { World } from './world';
import { HAND, Hand, drawHandBack, drawHandFront } from './hand';

// 論理解像度（9:16）。描画時にキャンバス実サイズへスケールする
const W = 360;
const H = 640;
const FIXED_DT = 1 / 60;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const stage = document.getElementById('stage')!;

const container = createBox(W / 2, 600, 270, 390);
let world = new World(container, H + 20, W);
/** world を作り直すたびに増える番号（眠っている猫の描画キャッシュを作り直す合図） */
let worldSerial = 0;

// ---- 次の猫・手でつまんでいる猫 ----
const HAND_Y = 92; // つまんでいる点の高さ
// 同じ柄は maxSameInRow 回連続まで
const picker = new ColorPicker(() => PARAMS.maxSameInRow);
/** 開発用（告知動画の撮影など）: 次に出す猫の色を予約する（CAT_COLORS の番号） */
const forcedColors: number[] = [];
function pickColor(): CatColor {
  const i = forcedColors.shift();
  return i === undefined ? picker.next() : CAT_COLORS[i];
}
let nextColor: CatColor = pickColor();
const hand = new Hand(W / 2, HAND_Y);
let rainLeft = 0;

// ---- 消去ルール・スコア ----
let match = new MatchSystem();
let score = 0;
const scoreEl = document.getElementById('score')!;
function addScore(n: number) {
  score += n;
  scoreEl.textContent = String(score);
}

// ---- 連鎖の表示 ----
const chainEl = document.getElementById('chain')!;
let shownChain = -1;
function updateChainHud() {
  const c = match.chain;
  if (c === shownChain) return;
  shownChain = c;
  chainEl.textContent = c > 0 ? String(c) : '-';
  chainEl.classList.remove('pop');
  if (c >= 2) {
    // ぽんっと弾む
    void chainEl.offsetWidth;
    chainEl.classList.add('pop');
  }
}

// ---- 浮かび上がる文字（N CHAIN! / +得点） ----
interface Popup {
  text: string;
  x: number;
  y: number;
  t: number;
  kind: 'chain' | 'score';
}
let popups: Popup[] = [];
function addPopup(text: string, x: number, y: number, kind: Popup['kind']) {
  popups.push({ text, x: Math.min(Math.max(x, 70), W - 70), y, t: 0, kind });
}
function groupCenter(cats: Cat[]): [number, number] {
  let x = 0;
  let y = 0;
  for (const c of cats) {
    x += c.cx;
    y += c.cy;
  }
  return [x / cats.length, y / cats.length];
}
function updatePopups(dt: number) {
  for (const p of popups) p.t += dt;
  popups = popups.filter((p) => p.t < (p.kind === 'chain' ? 1.4 : 1.0));
}
function drawPopups() {
  for (const p of popups) {
    const life = p.kind === 'chain' ? 1.4 : 1.0;
    const k = Math.min(p.t / 0.18, 1);
    const pop = 1 + 1.70158 * 1.3 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2); // easeOutBack
    const alpha = Math.min(1, Math.max(0, (life - p.t) / 0.3));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y - p.t * (p.kind === 'chain' ? 18 : 30));
    ctx.scale(pop, pop);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    if (p.kind === 'chain') {
      ctx.font = '900 26px system-ui, sans-serif';
      ctx.lineWidth = 7;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeText(p.text, 0, 0);
      const g = ctx.createLinearGradient(0, -14, 0, 14);
      g.addColorStop(0, '#ffb347');
      g.addColorStop(1, '#ff5f6d');
      ctx.fillStyle = g;
      ctx.fillText(p.text, 0, 0);
    } else {
      ctx.font = '800 16px system-ui, sans-serif';
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeText(p.text, 0, 0);
      ctx.fillStyle = '#5a4636';
      ctx.fillText(p.text, 0, 0);
    }
    ctx.restore();
  }
}
let rainTimer = 0;

function makeCat(color: CatColor, x: number, y: number): Cat {
  const dir = Math.random() < 0.5 ? 1 : -1;
  const scale = PARAMS.catSize * (1 + (Math.random() * 2 - 1) * PARAMS.sizeVariance);
  return new Cat(color, x, y, dir, scale);
}

/** 次の猫を首根っこでつまんで、画面上から運んでくる */
function bringNextCat() {
  hand.startEnter();
  if (gameState === 'play') playPick();
  const cat = makeCat(nextColor, hand.x, hand.y);
  // 首の後ろが手の位置に来るようにずらす
  moveCat(cat, hand.x - (cat.x[cat.scruff] - cat.cx), hand.y - (cat.y[cat.scruff] - cat.cy));
  world.hold(cat, hand.x, hand.y);
  // 指先が猫の背中側から回り込むように、手の向きを猫の向きと逆にする
  hand.flip = cat.dir === 1 ? -1 : 1;
  nextColor = pickColor();
}

function moveCat(cat: Cat, x: number, y: number) {
  const dx = x - cat.cx;
  const dy = y - cat.cy;
  for (let i = 0; i < N; i++) {
    cat.x[i] += dx;
    cat.y[i] += dy;
    cat.px[i] = cat.x[i];
    cat.py[i] = cat.y[i];
  }
  for (let i = 0; i < TAIL_N; i++) {
    cat.tx[i] += dx;
    cat.ty[i] += dy;
    cat.tpx[i] = cat.tx[i];
    cat.tpy[i] = cat.ty[i];
  }
  cat.cx = x;
  cat.cy = y;
  cat.headX += dx;
  cat.headY += dy;
}

function clampDropX(x: number) {
  return Math.min(Math.max(x, container.dropMinX), container.dropMaxX);
}

// ---- 入力（マウス/タッチ共通: Pointer Events） ----
// 押す → 手がその横位置へ移動 / ドラッグ → 追従 / 離す → 手が目標位置に着いたら指を開く
function toLogical(e: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
}
let dragging = false;
canvas.addEventListener('pointerdown', (e) => {
  unlockAudio(); // 音はユーザー操作のあとでないと鳴らせない
  if (gameState !== 'play') return;
  dragging = true;
  canvas.setPointerCapture(e.pointerId);
  hand.targetX = clampDropX(toLogical(e).x);
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  hand.targetX = clampDropX(toLogical(e).x);
});
const release = () => {
  if (!dragging) return;
  dragging = false;
  hand.requestRelease();
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

// ---- ツールボタン ----
// Debug ボタンは、URL に ?debug を付けたときだけ表示する（公開版の通常の画面には出さない）。
// 開いた直後の Debug 表示は OFF。ボタンを押すと ON になる
const devTools = new URLSearchParams(location.search).has('debug');
stage.classList.toggle('devtools', devTools);
let debug = false;
const btnDebug = document.getElementById('btn-debug')!;
const debugPanel = document.getElementById('debug-panel')!;
const debugStats = document.getElementById('debug-stats')!;
function setDebug(on: boolean) {
  debug = on;
  btnDebug.classList.toggle('on', on);
  debugPanel.hidden = !on;
  stage.classList.toggle('debug', on); // +10 / Clear は Debug ON のときだけ出す
}
btnDebug.addEventListener('click', () => setDebug(!debug));
document.getElementById('btn-rain')!.addEventListener('click', () => {
  rainLeft += 10;
});
document.getElementById('btn-clear')!.addEventListener('click', () => resetGame(gameState === 'title' ? 'title' : 'play'));

// ---- ゲームの状態（プレイ中 / ゲームオーバー） ----
let gameState: 'title' | 'play' | 'over' = 'title';
let warnTimer = 0;
let danger = 0; // ゲームオーバーまでの危険度 0..1
const gameoverEl = document.getElementById('gameover')!;
const BEST_KEY = 'nekoneko-game:best';
function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}
function saveBest(v: number) {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    // 保存できない環境（プライベートブラウズ等）では無視
  }
}

function triggerGameOver() {
  gameState = 'over';
  rainLeft = 0;
  dragging = false;
  const best = loadBest();
  const isNew = score > best;
  if (isNew) saveBest(score);
  document.getElementById('go-score')!.textContent = String(score);
  document.getElementById('go-best')!.textContent = String(Math.max(best, score));
  document.getElementById('go-newbest')!.hidden = !isNew || score === 0;
  gameoverEl.hidden = false;
  stopBgm(0.8);
  setBgmIntensity(0);
  playGameOver();
  if (isNew && score > 0) playRecord();
}

/** 最初からやり直す（スタート / Restart / Clear） */
function resetGame(next: 'play' | 'title' = 'play') {
  world = new World(container, H + 20, W);
  worldSerial++;
  rainLeft = 0;
  match = new MatchSystem();
  score = 0;
  scoreEl.textContent = '0';
  popups = [];
  shownChain = -1;
  updateChainHud();
  danger = 0;
  gameState = next;
  gameoverEl.hidden = true;
  titleEl.hidden = next !== 'title';
  stage.classList.toggle('is-title', next === 'title');
  demoTimer = 0.4;
  if (next === 'title') document.getElementById('title-best')!.textContent = String(loadBest());
  // 手は上へ戻って、新しい猫を運んでくる（プレイ開始時）
  hand.state = 'idle';
  hand.y = HAND.enterFromY;
  hand.open = 0;
  world.held = null;
  setBgmIntensity(0);
  startBgm();
}
document.getElementById('btn-restart')!.addEventListener('click', () => {
  unlockAudio();
  playButton();
  resetGame('play');
});
document.getElementById('btn-to-title')!.addEventListener('click', () => {
  unlockAudio();
  playButton();
  resetGame('title');
});
document.getElementById('btn-start')!.addEventListener('click', () => {
  unlockAudio();
  playButton();
  resetGame('play');
});

// ---- タイトル画面 ----
// 背景で猫がときどき落ちてきて、容器に詰まっていく（デモ。得点・音・ゲームオーバーなし）
const titleEl = document.getElementById('title')!;
let demoTimer = 0.4;
const DEMO_MAX_CATS = 14;
function updateTitleDemo(dt: number) {
  demoTimer -= dt;
  if (demoTimer > 0) return;
  demoTimer = 0.9 + Math.random() * 0.6;
  if (world.cats.filter((c) => !c.ghost).length >= DEMO_MAX_CATS) return;
  const x = container.dropMinX + Math.random() * (container.dropMaxX - container.dropMinX);
  if (spawnClear(x, container.dropY)) world.add(makeCat(randomColor(), x, container.dropY));
}

/**
 * 猫を出現させる場所が空いているか。
 * 積み上がった猫の中に重ねて出すと、めり込みで猫が裏返ってしまうため。
 */
function spawnClear(x: number, y: number): boolean {
  const hw = 45;
  const hh = 40;
  for (const c of world.cats) {
    if (c.ghost) continue;
    if (c.maxX > x - hw && c.minX < x + hw && c.maxY > y - hh && c.minY < y + hh) return false;
  }
  return true;
}

// 起動時はタイトル画面から
resetGame('title');

// パラメータスライダー
const sliderBox = document.getElementById('debug-sliders')!;
const sliderInputs: { key: keyof typeof PARAMS; input: HTMLInputElement; out: HTMLElement }[] = [];
for (const [key, min, max, step] of PARAM_SLIDERS) {
  const label = document.createElement('label');
  const name = document.createElement('span');
  name.textContent = key;
  const out = document.createElement('span');
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(PARAMS[key]);
  out.textContent = String(PARAMS[key]);
  input.addEventListener('input', () => {
    (PARAMS[key] as number) = Number(input.value);
    out.textContent = input.value;
    world.wakeAll(); // パラメータの変化が見えるように、眠っている猫も起こす
  });
  label.append(name, out, input);
  sliderBox.append(label);
  sliderInputs.push({ key, input, out });
}
document.getElementById('btn-reset-params')!.addEventListener('click', () => {
  Object.assign(PARAMS, DEFAULT_PARAMS);
  for (const s of sliderInputs) {
    s.input.value = String(PARAMS[s.key]);
    s.out.textContent = String(PARAMS[s.key]);
  }
});
setDebug(debug);

// ---- キャンバスサイズ ----
let scale = 1;
let maxDpr = 2;

function resize() {
  const r = stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const w = Math.round(r.width * dpr);
  const h = Math.round(r.height * dpr);
  // サイズが変わっていなければ何もしない（キャンバスの大きさを設定し直すと中身が消えて、ちらつく）。
  // iPhone ではアドレスバーの出入りのたびに resize イベントが来る。
  if (w === canvas.width && h === canvas.height) return;
  canvas.width = w;
  canvas.height = h;
  scale = canvas.width / W;
}
window.addEventListener('resize', resize);
resize();

// ---- ループ ----
let last = performance.now();
let acc = 0;
let fps = 60;
let physMs = 0;

function update(dt: number) {
  if (gameState === 'title') updateTitleDemo(dt);
  if (gameState === 'play') {
    const ev = hand.update(dt);
    if (ev === 'drop') {
      world.release();
      playDrop();
    }
    else if (ev === 'next' || hand.state === 'idle') bringNextCat();
  }
  world.pinX = hand.x;
  world.pinY = hand.y;
  if (rainLeft > 0) {
    rainTimer -= dt;
    if (rainTimer <= 0) {
      const x = container.dropMinX + Math.random() * (container.dropMaxX - container.dropMinX);
      if (spawnClear(x, container.dropY)) {
        rainTimer = 0.28;
        rainLeft--;
        world.add(makeCat(randomColor(), x, container.dropY));
      } else {
        rainTimer = 0.1; // 出てくる場所に猫がいるので、少し待つ
      }
    }
  }
  const t0 = performance.now();
  world.step(dt);
  const mev = match.update(world.cats, world.stablePairs, container, dt, world.time);
  const playing = gameState === 'play';
  // 着地の「ぽふっ」
  for (const c of world.cats) {
    if (c.landImpact > 0) {
      if (playing) playLand(c.landImpact / 1100);
      c.landImpact = 0;
    }
  }
  if (playing && mev.matched.length > 0) {
    playMatch();
    const ch = mev.matched[0].chain;
    if (ch >= 2) playChain(ch);
  }
  // 揃った猫は起こす（形を戻す・ジャンプするので計算が必要）。猫が出ていったら、その上と両脇の猫を起こす（隙間に落ちるため）
  for (const g of mev.matched) for (const c of g.cats) c.wake();
  for (const g of mev.jumped) world.wakeAround(g.cats);
  for (const g of mev.matched) {
    if (playing && g.chain >= 2) {
      const [x, y] = groupCenter(g.cats);
      addPopup(`${g.chain} CHAIN!`, x, y - 30, 'chain');
    }
  }
  for (const g of mev.meowed) {
    if (!playing) continue;
    // 全員で「にゃー！」（少しずつずらして、高さもばらばらに）。連鎖が進むほど少し高い声に
    const up = 1 + 0.08 * (g.chain - 1);
    g.cats.slice(0, 6).forEach((_, i) => playMeow((0.85 + Math.random() * 0.4) * up, i * 0.07));
  }
  for (const g of mev.jumped) {
    if (!playing) continue;
    playHop(0.02);
    playScore();
    const pts = g.cats.length * 100 * g.chain;
    addScore(pts);
    const [x, y] = groupCenter(g.cats);
    addPopup(`+${pts}`, x, y, 'score');
  }
  updateChainHud();
  updatePopups(dt);
  if (gameState === 'play') {
    const go = updateGameOver(world.cats, container, dt, match.busy);
    danger = go.danger;
    setBgmIntensity(danger);
    // 危険の「ピッ」（危ないほど間隔が短く）
    if (danger > 0.15) {
      warnTimer -= dt;
      if (warnTimer <= 0) {
        playWarn();
        warnTimer = 0.65 - 0.4 * danger;
      }
    } else {
      warnTimer = 0;
    }
    if (go.over) triggerGameOver();
  }
  physMs = physMs * 0.9 + (performance.now() - t0) * 0.1;
}

/**
 * 眠っている猫は、1匹ずつ小さな画像（スプライト）に描いておき、毎フレームはそれを貼るだけにする。
 * - 描く順番は、眠っていても起きていても同じ（world.cats の順）。眠る/起きるで前後が入れ替わってチラつかないように
 * - 画像は画面のピクセルにぴったり合わせて作る（貼ったときにぼやけたり、生で描いたときとずれたりしないように）
 * - 起きたら捨てる（Cat.wake）。画面の拡大率が変わったら作り直す
 */
function catBounds(c: Cat): [number, number, number, number] {
  // 耳・尻尾・ひげ・輪郭線・足先のはみ出しを含めた見た目の範囲
  let x0 = c.minX;
  let y0 = c.minY;
  let x1 = c.maxX;
  let y1 = c.maxY;
  for (let i = 0; i < TAIL_N; i++) {
    x0 = Math.min(x0, c.tx[i]);
    x1 = Math.max(x1, c.tx[i]);
    y0 = Math.min(y0, c.ty[i]);
    y1 = Math.max(y1, c.ty[i]);
  }
  const m = 18;
  return [x0 - m, y0 - m - c.headR * 0.5, x1 + m, y1 + m];
}
function drawSleepingCat(c: Cat, time: number) {
  if (!c.sprite || c.spriteScale !== scale) {
    const [bx0, by0, bx1, by1] = catBounds(c);
    // 左上を画面のピクセル境界にそろえる
    const px0 = Math.floor(bx0 * scale);
    const py0 = Math.floor(by0 * scale);
    const pw = Math.max(1, Math.ceil(bx1 * scale) - px0);
    const ph = Math.max(1, Math.ceil(by1 * scale) - py0);
    const cv = c.sprite ?? document.createElement('canvas');
    cv.width = pw;
    cv.height = ph;
    const sc = cv.getContext('2d')!;
    sc.setTransform(scale, 0, 0, scale, -px0, -py0);
    drawCat(sc, c, time, true);
    c.sprite = cv;
    c.spriteScale = scale;
    c.spritePx = px0;
    c.spritePy = py0;
  }
  // ピクセル単位でそのまま貼る（拡大縮小しない）
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(c.sprite, c.spritePx, c.spritePy);
  ctx.restore();
}

/** ゲームオーバーライン: ふだんは薄い点線、危なくなると赤く点滅して「あぶない！」 */
function drawDangerLine(time: number) {
  const o = container.outline;
  const x0 = Math.min(o[0].x, o[o.length - 1].x) + 6;
  const x1 = Math.max(o[0].x, o[o.length - 1].x) - 6;
  const y = container.gameOverY;
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 2;
  if (danger > 0) {
    const speed = 0.006 + danger * 0.02; // 危ないほど速く点滅
    const blink = 0.5 + 0.5 * Math.sin(time * speed);
    ctx.strokeStyle = `rgba(255, 80, 70, ${0.35 + 0.6 * blink})`;
    ctx.lineWidth = 2 + danger * 2;
  } else {
    ctx.strokeStyle = 'rgba(200, 120, 100, 0.28)';
  }
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  if (danger > 0.15) {
    ctx.setLineDash([]);
    ctx.font = '900 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText('あぶない！', (x0 + x1) / 2, y - 6);
    ctx.fillStyle = '#ff5a4e';
    ctx.fillText('あぶない！', (x0 + x1) / 2, y - 6);
  }
  ctx.restore();
}

function render(time: number) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  const inTitle = gameState === 'title';
  // 次の猫（小さく表示）
  if (!inTitle) {
  ctx.save();
  ctx.fillStyle = 'rgba(90,70,54,0.6)';
  ctx.font = '700 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('NEXT', W - 42, 64);
  ctx.translate(W - 42, 88);
  ctx.scale(0.45, 0.45);
  drawPreview(nextColor);
  ctx.restore();
  }

  drawContainer(ctx, container);

  // 落とす位置のガイド
  if (!inTitle && world.held && (hand.state === 'hold' || hand.state === 'enter')) {
    ctx.save();
    ctx.strokeStyle = 'rgba(90,70,54,0.22)';
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hand.targetX, world.held.maxY + 8);
    ctx.lineTo(hand.targetX, container.outline[1].y);
    ctx.stroke();
    ctx.restore();
  }

  // 容器の中の猫 → 出ていく猫（手前）→ 吹き出し
  // 眠っている猫は1匹ずつの画像を貼るだけ（描く順番は起きている猫と同じ）
  for (const c of world.cats) {
    if (c.ghost) continue;
    if (c.sleeping) drawSleepingCat(c, time);
    else drawCat(ctx, c, time);
  }
  for (const c of world.cats) if (c.ghost) drawCat(ctx, c, time);
  for (const c of world.cats) drawExitMarks(ctx, c);
  drawPopups();
  // 危険ラインは容器の中の猫より手前に（埋もれて見えなくならないように）
  if (!inTitle) {
    drawDangerLine(time);
    // 手 → 猫 → 指 の順に重ねて「首根っこをつまんでいる」ように見せる
    drawHandBack(ctx, hand);
    if (world.held) {
      drawCat(ctx, world.held, time);
      drawScruffFold(ctx, world.held, hand.x, hand.y);
    }
    drawHandFront(ctx, hand);
  }

  if (debug) {
    drawDebug(ctx, world);
    debugStats.textContent =
      `FPS  ${fps.toFixed(0)}\n` +
      `cats ${world.cats.length}\n` +
      `phys ${physMs.toFixed(2)} ms\n` +
      `pairs ${world.contactPairs.length}\n` +
      `danger ${(danger * 100).toFixed(0)}%\n` +
      `work ${workMs.toFixed(1)} ms  q${qLevel} sub${PARAMS.substeps}\n` +
      `recovered ${world.recoveredCount}\n` +
      `sleeping ${world.sleepingCount}/${world.cats.length}`;
  }
}

const previewCats = new Map<string, Cat>();
function drawPreview(color: CatColor) {
  let c = previewCats.get(color.id);
  if (!c) {
    c = new Cat(color, 0, 0, 1, 1);
    previewCats.set(color.id, c);
  }
  drawCat(ctx, c, 0);
}

// ---- 自動画質調整 ----
// 1フレームの処理時間（物理+描画）を見て、重ければ物理のサブステップ数と描画解像度を下げる。
// 軽くなれば戻す。Debug でパラメータをいじっている間は止める。
const QUALITY_SUBSTEPS = [8, 7, 6, 5];
let qLevel = 0;
let workMs = 0;
let qTimer = 0;
let slowTime = 0;
let lowRes = false;
function autoQuality(dt: number, work: number) {
  workMs = workMs * 0.95 + work * 0.05;
  if (debug) return;
  qTimer += dt;
  // 一番低い段階でも重い状態が続いたら、描画解像度を一度だけ下げる（戻さない。何度も切り替えるとちらつくため）
  if (qLevel === QUALITY_SUBSTEPS.length - 1 && workMs > 12) slowTime += dt;
  else slowTime = 0;
  if (!lowRes && slowTime > 3) {
    lowRes = true;
    maxDpr = 1.5;
    resize();
  }
  if (qTimer < 1.5) return;
  if (workMs > 11 && qLevel < QUALITY_SUBSTEPS.length - 1) {
    qLevel++;
    qTimer = 0;
  } else if (workMs < 4 && qLevel > 0 && qTimer > 5) {
    // 上げるのは、十分に軽い状態が5秒以上続いたときだけ（上げ下げを繰り返さないように）
    qLevel--;
    qTimer = 0;
  } else {
    return;
  }
  PARAMS.substeps = QUALITY_SUBSTEPS[qLevel];
}

/** 開発用（告知動画の撮影）: true のあいだはゲームが自分で進まない（step で1コマずつ進める） */
let externalControl = false;

function frame(now: number) {
  if (externalControl) {
    last = now;
    requestAnimationFrame(frame);
    return;
  }
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  fps = fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
  const t0 = performance.now();
  acc += dt;
  let steps = 0;
  // 処理が追いつかないときは、物理の更新を1フレーム2回までにする（それ以上は追いかけずに少しゆっくりにする）
  while (acc >= FIXED_DT && steps < 2) {
    update(FIXED_DT);
    acc -= FIXED_DT;
    steps++;
  }
  if (steps === 2) acc = 0;
  render(now);
  autoQuality(dt, (performance.now() - t0) / Math.max(steps, 1));
  requestAnimationFrame(frame);
}
// ---- 音のON/OFFボタン ----
const btnSound = document.getElementById('btn-sound')!;
function refreshSoundBtn() {
  btnSound.classList.toggle('off', isMuted());
  btnSound.setAttribute('aria-label', isMuted() ? '音を出す' : '音を消す');
}
btnSound.addEventListener('click', () => {
  unlockAudio();
  setMuted(!isMuted());
  refreshSoundBtn();
  playButton();
});
refreshSoundBtn();

// 最初のタッチ/クリックで音を使えるようにして BGM を始める（ブラウザの自動再生制限）
const firstTouch = () => {
  unlockAudio();
  if (gameState !== 'over') startBgm();
};
window.addEventListener('pointerdown', firstTouch);
window.addEventListener('touchend', firstTouch);

// ---- スマホでの誤操作防止 ----
// 長押しメニュー・ダブルタップ拡大・ピンチ拡大（iOS Safari）を止める
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('dblclick', (e) => e.preventDefault());
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  window.addEventListener(ev, (e) => e.preventDefault());
}

requestAnimationFrame(frame);

// 開発用: コンソールから触れるように
(window as unknown as Record<string, unknown>).__game = {
  get world() {
    return world;
  },
  get match() {
    return match;
  },
  get popups() {
    return popups;
  },
  get state() {
    return gameState;
  },
  audio: audioDebug,
  audioRec,
  /** 告知動画用: 記録した音を WAV（base64）に書き出す */
  async renderAudioWav(duration: number) {
    return audioBufferToWavBase64(await renderRecordedAudio(duration));
  },
  drawCat,
  sfx: { playButton, playChain, playDrop, playGameOver, playHop, playLand, playMatch, playMeow, playPick, playRecord, playScore, playWarn },
  get danger() {
    return danger;
  },
  PARAMS,
  /** 検証用: n フレーム分を同期的に進めて描画（rAFが止まるバックグラウンドタブ用）。time を渡すと描画の時刻（まばたき等）に使う */
  step(n = 60, time?: number) {
    for (let i = 0; i < n; i++) update(FIXED_DT);
    render(time ?? performance.now());
  },
  /** 告知動画の撮影用: 自動のゲームループを止める / 色を予約 / 手 / 描画解像度 */
  setExternalControl(on: boolean) {
    externalControl = on;
  },
  queueColors(list: number[]) {
    forcedColors.push(...list);
  },
  get nextColor() {
    return nextColor;
  },
  set nextColorIndex(i: number) {
    nextColor = CAT_COLORS[i];
  },
  hand,
  setMaxDpr(v: number) {
    maxDpr = v;
    resize();
  },
  rain(n = 10) {
    rainLeft += n;
  },
  drop(x: number, colorIndex?: number) {
    const color = colorIndex === undefined ? randomColor() : CAT_COLORS[colorIndex];
    world.add(makeCat(color, clampDropX(x), container.dropY));
  },
};
