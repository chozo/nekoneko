// 描画: 猫・容器・デバッグ表示（Canvas 2D）
// 胴体は物理点を滑らかな閉曲線で結んで描く（=変形する）。
// 頭・耳・顔は頭リングの剛体変換で描く（=形が崩れない）。

import { BODY_N, Cat, HEAD_N, N, TAIL_N } from './cat';
import type { CatColor } from './colors';
import type { ContainerShape } from './container';
import { PARAMS } from './params';
import type { World } from './world';

export function drawContainer(ctx: CanvasRenderingContext2D, c: ContainerShape) {
  const o = c.outline;
  ctx.save();
  // ガラスの面
  ctx.beginPath();
  ctx.moveTo(o[0].x, o[0].y);
  for (let i = 1; i < o.length; i++) ctx.lineTo(o[i].x, o[i].y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(200, 230, 255, 0.18)';
  ctx.fill();
  // 縁
  ctx.beginPath();
  ctx.moveTo(o[0].x, o[0].y);
  for (let i = 1; i < o.length; i++) ctx.lineTo(o[i].x, o[i].y);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(120, 160, 200, 0.85)';
  ctx.lineWidth = 10;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

// ---- 猫（かわいいイラスト調） ----
// 光は画面の上から当たる想定。毛並みは「上=明るい / 下=影」のグラデーションで表現する。

/** 胴体の輪郭を滑らかな閉曲線としてパスに追加 */
function bodyPath(ctx: CanvasRenderingContext2D, cat: Cat) {
  const xs = cat.x;
  const ys = cat.y;
  ctx.beginPath();
  const n = BODY_N;
  let mx = (xs[n - 1] + xs[0]) / 2;
  let my = (ys[n - 1] + ys[0]) / 2;
  ctx.moveTo(mx, my);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    mx = (xs[i] + xs[j]) / 2;
    my = (ys[i] + ys[j]) / 2;
    ctx.quadraticCurveTo(xs[i], ys[i], mx, my);
  }
  ctx.closePath();
}

function outwardOf(cat: Cat, i: number): [number, number] {
  // 輪郭点 i の外向き法線
  const p = (i + BODY_N - 1) % BODY_N;
  const n = (i + 1) % BODY_N;
  const ex = cat.x[n] - cat.x[p];
  const ey = cat.y[n] - cat.y[p];
  const l = Math.hypot(ex, ey) || 1;
  return [(ey / l) * cat.bodySign, (-ex / l) * cat.bodySign];
}

/** 輪郭点 i が静止形状（香箱座り）でどの角度にあるか。0=胸 0.5π=お腹 π=お尻 1.5π=背中 */
function restAngle(i: number) {
  return (i / BODY_N) * Math.PI * 2;
}

/** 上から光が当たる毛のグラデーション */
function furGradient(ctx: CanvasRenderingContext2D, col: CatColor, top: number, bottom: number) {
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, col.highlight);
  g.addColorStop(0.38, col.body);
  g.addColorStop(1, col.shade);
  return g;
}

/** 根元が太く先が細い縞（輪郭点 P から内側へ） */
function stripe(ctx: CanvasRenderingContext2D, px: number, py: number, qx: number, qy: number, w: number, bend: number) {
  const dx = qx - px;
  const dy = qy - py;
  const l = Math.hypot(dx, dy) || 1;
  const tx = -dy / l;
  const ty = dx / l;
  ctx.beginPath();
  ctx.moveTo(px + tx * w, py + ty * w);
  ctx.quadraticCurveTo((px + qx) / 2 + tx * (w * 0.6 + bend), (py + qy) / 2 + ty * (w * 0.6 + bend), qx + tx * bend * 0.3, qy + ty * bend * 0.3);
  ctx.quadraticCurveTo((px + qx) / 2 - tx * (w * 0.6 - bend), (py + qy) / 2 - ty * (w * 0.6 - bend), px - tx * w, py - ty * w);
  ctx.closePath();
  ctx.fill();
}

/** still: まとめて描いて使い回す（眠っている猫）。まばたきなど時間で変わる表情をしない */
export function drawCat(ctx: CanvasRenderingContext2D, cat: Cat, time: number, still = false) {
  // 描画の設定（線の継ぎ目・端・透明度など）は、直前に描いたものの設定が残っている。
  // 眠っている猫の画像（新しいキャンバス）と画面で見た目が変わらないよう、毎回同じ状態から描く
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.setLineDash([]);
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  ctx.lineWidth = 1;
  ctx.miterLimit = 10;
  drawCatInner(ctx, cat, time, still);
  ctx.restore();
}

function drawCatInner(ctx: CanvasRenderingContext2D, cat: Cat, time: number, still: boolean) {
  const col = cat.color;
  const s = cat.scale;

  drawTail(ctx, cat);

  // 揃った猫は、ふわっと光る（間・にゃー！のあいだ）
  if (cat.exitPhase === 'ready' || cat.exitPhase === 'meow') {
    const pulse = 0.55 + 0.45 * Math.sin(time * 0.02);
    ctx.save();
    bodyPath(ctx, cat);
    ctx.strokeStyle = `rgba(255, 244, 170, ${0.55 + 0.35 * pulse})`;
    ctx.lineWidth = 9;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cat.headX, cat.headY, cat.headR * 1.15 + 3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 244, 170, ${0.55 + 0.35 * pulse})`;
    ctx.fill();
    ctx.restore();
  }

  // --- 後ろ足のもも（香箱座りのとき胴体の下から少し見える） ---
  if (cat.pose < 0.6) {
    const i = cat.hindPaw;
    const [nx, ny] = outwardOf(cat, i);
    ctx.save();
    ctx.globalAlpha = 1 - cat.pose / 0.6;
    ctx.beginPath();
    ctx.ellipse(cat.x[i] + nx * 1.5, cat.y[i] + ny * 1.5, 9 * s, 6 * s, Math.atan2(ny, nx) + Math.PI / 2, 0, Math.PI * 2);
    ctx.fillStyle = col.body;
    ctx.fill();
    ctx.strokeStyle = col.outline;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  // --- 奥側の手足（つままれているとき、だらんと垂れる） ---
  if (legAmount(cat) > 0.02) {
    drawLeg(ctx, cat, (cat.hindPaw + 1) % BODY_N, 19 * s, true, time, 1.3);
    drawLeg(ctx, cat, cat.frontPaws[1], 26 * s, true, time, 2.1);
  }

  // --- 胴体 ---
  let top = Infinity;
  let bottom = -Infinity;
  for (let i = 0; i < BODY_N; i++) {
    if (cat.y[i] < top) top = cat.y[i];
    if (cat.y[i] > bottom) bottom = cat.y[i];
  }
  bodyPath(ctx, cat);
  ctx.fillStyle = furGradient(ctx, col, top, bottom);
  ctx.fill();

  ctx.save();
  bodyPath(ctx, cat);
  ctx.clip();

  // 三毛のぶち: 輪郭点に固定して描く（胴体の変形にそのまま追従する）
  if (col.pattern === 'calico' && col.patchA && col.patchB) {
    const swap = cat.id % 2 === 1;
    const A = swap ? col.patchB : col.patchA;
    const B = swap ? col.patchA : col.patchB;
    const jitter = (((cat.id * 37) % 9) - 4) / 100; // 個体差
    const patches: [number, number, number, string][] = [
      // [輪郭上の位置(0=胸 .25=お腹 .5=お尻 .75=背中), 内側への深さ, 半径, 色]
      [0.64 + jitter, 0.28, 16, A],
      [0.86 - jitter, 0.26, 12, B],
      [0.5 + jitter, 0.22, 11, B],
      [0.4, 0.3, 8, A],
    ];
    for (const [f, depth, rad, color] of patches) {
      const fi = ((f % 1) + 1) % 1;
      const i = Math.round(fi * BODY_N) % BODY_N;
      const px = cat.x[i];
      const py = cat.y[i];
      const cx = px + (cat.cx - px) * depth;
      const cy = py + (cat.cy - py) * depth;
      const ux0 = cat.cx - px;
      const uy0 = cat.cy - py;
      const ul = Math.hypot(ux0, uy0) || 1;
      const ux = ux0 / ul;
      const uy = uy0 / ul;
      const tx = -uy;
      const ty = ux;
      const R = rad * s;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.moveTo(cx + tx * R * 0.7 + R * 0.75, cy + ty * R * 0.7);
      ctx.arc(cx + tx * R * 0.7, cy + ty * R * 0.7, R * 0.75, 0, Math.PI * 2);
      ctx.moveTo(cx - tx * R * 0.55 + ux * R * 0.35 + R * 0.7, cy - ty * R * 0.55 + uy * R * 0.35);
      ctx.arc(cx - tx * R * 0.55 + ux * R * 0.35, cy - ty * R * 0.55 + uy * R * 0.35, R * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    // ぶちにも上からの光と下の影をのせる
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, 'rgba(255,255,255,0.18)');
    g.addColorStop(0.45, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(90,60,40,0.14)');
    ctx.fillStyle = g;
    ctx.fillRect(cat.minX - 10, top - 10, cat.maxX - cat.minX + 20, bottom - top + 20);
  }

  // 背中のツヤ
  {
    const i = Math.round(BODY_N * 0.75); // 背中のてっぺん
    const hx = cat.x[i] + (cat.cx - cat.x[i]) * 0.3;
    const hy = cat.y[i] + (cat.cy - cat.y[i]) * 0.3;
    const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 20 * s);
    g.addColorStop(0, col.highlight);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = col.id === 'black' ? 0.55 : 0.5;
    ctx.fillStyle = g;
    ctx.fillRect(hx - 20 * s, hy - 20 * s, 40 * s, 40 * s);
    ctx.globalAlpha = 1;
  }

  // 縞模様: 背中側の輪郭点から内側へ（胴体の変形にそのまま追従する）
  if (col.pattern === 'tabby') {
    ctx.fillStyle = col.stripe;
    for (let i = 0; i < BODY_N; i++) {
      const t = restAngle(i);
      if (t < Math.PI * 1.08 || t > Math.PI * 1.88 || i % 2 === 1) continue;
      const depth = 0.32 + 0.12 * Math.sin(i * 1.7);
      const qx = cat.x[i] + (cat.cx - cat.x[i]) * depth;
      const qy = cat.y[i] + (cat.cy - cat.y[i]) * depth;
      stripe(ctx, cat.x[i], cat.y[i], qx, qy, 2.6 * s, 2 * s * cat.dir);
    }
    // お尻のあたりの縞
    for (const t of [0.86, 0.95]) {
      const i = Math.round(BODY_N * (t / 2)) % BODY_N;
      const qx = cat.x[i] + (cat.cx - cat.x[i]) * 0.28;
      const qy = cat.y[i] + (cat.cy - cat.y[i]) * 0.28;
      stripe(ctx, cat.x[i], cat.y[i], qx, qy, 2.2 * s, 0);
    }
  }

  // 胸元のふわふわの白い毛
  if (col.bib) {
    const i = 0; // 胸
    const ux0 = cat.cx - cat.x[i];
    const uy0 = cat.cy - cat.y[i];
    const ul = Math.hypot(ux0, uy0) || 1;
    const ux = ux0 / ul;
    const uy = uy0 / ul;
    const vx = -uy;
    const vy = ux;
    ctx.fillStyle = col.white;
    const blobs: [number, number, number][] = [
      [3, 0, 10],
      [9, -7, 7],
      [9, 7, 7],
      [14, 0, 7],
      [4, 11, 6],
      [4, -11, 6],
    ];
    ctx.beginPath();
    for (const [a, b, r] of blobs) {
      const x = cat.x[i] + (ux * a + vx * b) * s;
      const y = cat.y[i] + (uy * a + vy * b) * s;
      ctx.moveTo(x + r * s, y);
      ctx.arc(x, y, r * s, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  // 後ろ足のもものライン
  {
    const i = cat.hindPaw;
    const hx = cat.x[i] + (cat.cx - cat.x[i]) * 0.35;
    const hy = cat.y[i] + (cat.cy - cat.y[i]) * 0.35;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(cat.rot);
    ctx.scale(cat.dir, 1);
    ctx.beginPath();
    ctx.arc(0, 0, 10 * s, -Math.PI * 0.95, -Math.PI * 0.25);
    ctx.restore();
    ctx.strokeStyle = col.outline;
    ctx.globalAlpha = 0.3 * (1 - cat.pose);
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  bodyPath(ctx, cat);
  ctx.strokeStyle = col.outline;
  ctx.lineWidth = 1.7;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // --- 手前の手足 ---
  if (legAmount(cat) > 0.02) {
    drawLeg(ctx, cat, cat.hindPaw, 19 * s, false, time, 0.4);
    drawLeg(ctx, cat, cat.frontPaws[0], 26 * s, false, time, 0);
  } else {
    // 香箱座り: 胸の下にたたんだ前足の先
    for (const i of cat.frontPaws) {
      const [nx, ny] = outwardOf(cat, i);
      drawPaw(ctx, cat, cat.x[i] - nx * 1.5, cat.y[i] - ny * 1.5, Math.atan2(ny, nx) + Math.PI / 2, 1);
    }
  }

  drawHead(ctx, cat, time, still);
}

/** 手足がどれだけ伸びているか: つままれてだらん（pose）か、着地に向けて足を伸ばしている（reach） */
function legAmount(cat: Cat) {
  return Math.max(cat.pose, cat.reach * 0.6);
}

/** 足先（肉球側から見た丸い手） */
function drawPaw(ctx: CanvasRenderingContext2D, cat: Cat, x: number, y: number, rot: number, size: number) {
  const col = cat.color;
  const s = cat.scale * size;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.ellipse(0, 0, 6.3 * s, 4.6 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = col.whitePaws ? col.white : col.body;
  ctx.fill();
  ctx.strokeStyle = col.outline;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // 指の切れ目
  ctx.beginPath();
  ctx.moveTo(-2 * s, 1.2 * s);
  ctx.lineTo(-2 * s, 4.2 * s);
  ctx.moveTo(2 * s, 1.2 * s);
  ctx.lineTo(2 * s, 4.2 * s);
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.55;
  ctx.stroke();
  ctx.restore();
}

/** 根元が太く先が細い尻尾。縞猫は縞模様になる */
function drawTail(ctx: CanvasRenderingContext2D, cat: Cat) {
  const col = cat.color;
  const s = cat.scale;
  // 尻尾の点を滑らかに補間した点列
  const pts: [number, number][] = [];
  for (let i = 0; i < TAIL_N - 1; i++) {
    const x0 = cat.tx[Math.max(i - 1, 0)];
    const y0 = cat.ty[Math.max(i - 1, 0)];
    const x1 = cat.tx[i];
    const y1 = cat.ty[i];
    const x2 = cat.tx[i + 1];
    const y2 = cat.ty[i + 1];
    const x3 = cat.tx[Math.min(i + 2, TAIL_N - 1)];
    const y3 = cat.ty[Math.min(i + 2, TAIL_N - 1)];
    for (let k = 0; k < 3; k++) {
      const t = k / 3;
      const t2 = t * t;
      const t3 = t2 * t;
      pts.push([
        0.5 * (2 * x1 + (-x0 + x2) * t + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 + (-x0 + 3 * x1 - 3 * x2 + x3) * t3),
        0.5 * (2 * y1 + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3),
      ]);
    }
  }
  pts.push([cat.tx[TAIL_N - 1], cat.ty[TAIL_N - 1]]);
  const n = pts.length;
  const width = (k: number) => (7.6 - 3.2 * (k / (n - 1))) * s;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = col.outline;
  for (let k = 0; k < n - 1; k++) {
    ctx.lineWidth = width(k) + 3;
    ctx.beginPath();
    ctx.moveTo(pts[k][0], pts[k][1]);
    ctx.lineTo(pts[k + 1][0], pts[k + 1][1]);
    ctx.stroke();
  }
  for (let k = 0; k < n - 1; k++) {
    const band = col.pattern === 'tabby' && Math.floor(k / 2) % 2 === 1;
    const tip = k >= n - 3;
    if (col.pattern === 'calico' && col.patchA && col.patchB) {
      // 三毛の尻尾: 茶と黒の縞
      ctx.strokeStyle = Math.floor(k / 2) % 2 === 0 ? calicoHead(cat, -1) : calicoHead(cat, 1);
    } else {
      ctx.strokeStyle = band || (tip && col.pattern === 'tabby') ? col.stripe : col.body;
    }
    ctx.lineWidth = width(k);
    ctx.beginPath();
    ctx.moveTo(pts[k][0], pts[k][1]);
    ctx.lineTo(pts[k + 1][0], pts[k + 1][1]);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * だらんと垂れた脚。輪郭点 i から重力方向へ伸び、手の動き（猫の横速度）に少し遅れて揺れる。
 * 長さは pose（ぶら下がり度合い）に比例するので、離すと縮んで香箱座りの足先に戻る。
 */
function drawLeg(ctx: CanvasRenderingContext2D, cat: Cat, i: number, maxLen: number, far: boolean, time: number, phase: number) {
  const col = cat.color;
  const s = cat.scale;
  const [nx, ny] = outwardOf(cat, i);
  // 前足は胸から少し前に出して垂らす（胴体に隠れないように）
  const isFront = i === cat.frontPaws[0] || i === cat.frontPaws[1];
  const inset = isFront ? -1 : 3;
  const rx = cat.x[i] - nx * inset * s;
  const ry = cat.y[i] - ny * inset * s;
  let mvx = 0;
  for (let k = 0; k < BODY_N; k++) mvx += cat.vx[k];
  mvx /= BODY_N;
  // 真下 + 揺れ（動いた方向と逆へ遅れる）+ ぶらぶら
  const sway = Math.max(-0.6, Math.min(0.6, -mvx * 0.0016)) + Math.sin(time * 0.004 + phase + cat.id) * 0.07;
  const ang = Math.PI / 2 + sway - (isFront ? 0.22 : far ? 0.08 : -0.04) * cat.dir;
  const len = maxLen * legAmount(cat);
  const tx = rx + Math.cos(ang) * len;
  const ty = ry + Math.sin(ang) * len;
  ctx.save();
  ctx.lineCap = 'round';
  // 付け根が太く、足首で細くなる
  const steps = 4;
  for (const pass of [0, 1]) {
    for (let k = 0; k < steps; k++) {
      const a = k / steps;
      const b = (k + 1) / steps;
      const w = (8.2 - 2.4 * a) * s;
      ctx.beginPath();
      ctx.moveTo(rx + (tx - rx) * a, ry + (ty - ry) * a);
      ctx.lineTo(rx + (tx - rx) * b, ry + (ty - ry) * b);
      if (pass === 0) {
        ctx.strokeStyle = col.outline;
        ctx.lineWidth = w + 3;
      } else {
        ctx.strokeStyle = far ? col.shade : col.body;
        ctx.lineWidth = w;
      }
      ctx.stroke();
    }
  }
  ctx.restore();
  drawPaw(ctx, cat, tx, ty + 1.5 * s, ang - Math.PI / 2, 0.85);
}

/** つままれて引っぱられた首の皮（指の間に描く） */
export function drawScruffFold(ctx: CanvasRenderingContext2D, cat: Cat, x: number, y: number) {
  const col = cat.color;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x - 6.5, y + 8);
  ctx.bezierCurveTo(x - 7.5, y + 1, x - 5, y - 6, x, y - 6);
  ctx.bezierCurveTo(x + 5, y - 6, x + 7.5, y + 1, x + 6.5, y + 8);
  ctx.closePath();
  ctx.fillStyle = furGradient(ctx, col, y - 7, y + 8);
  ctx.fill();
  ctx.strokeStyle = col.outline;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // しわ
  ctx.beginPath();
  ctx.moveTo(x - 2, y + 5);
  ctx.lineTo(x - 1, y - 1);
  ctx.moveTo(x + 2, y + 5);
  ctx.lineTo(x + 1, y - 1);
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.5;
  ctx.stroke();
  ctx.restore();
}

/** 三毛の頭のぶちの色（side -1 = 奥側、1 = 手前側）。個体ごとに茶と黒が入れ替わる */
function calicoHead(cat: Cat, side: number): string {
  const col = cat.color;
  const swap = cat.id % 2 === 1;
  const far = swap ? col.patchB! : col.patchA!;
  const near = swap ? col.patchA! : col.patchB!;
  return side === -1 ? far : near;
}

/** ほっぺがふくらんだ頭の輪郭（頭ローカル座標、右向き） */
function headPath(ctx: CanvasRenderingContext2D, rx: number, ry: number) {
  ctx.beginPath();
  ctx.moveTo(0, -ry);
  for (const side of [1, -1]) {
    const x = (v: number) => v * side;
    if (side === 1) {
      ctx.bezierCurveTo(x(rx * 0.72), -ry, x(rx * 1.0), -ry * 0.5, x(rx * 0.98), ry * 0.08);
      // ほっぺのふわ毛
      ctx.lineTo(x(rx * 1.13), ry * 0.3);
      ctx.lineTo(x(rx * 0.99), ry * 0.36);
      ctx.lineTo(x(rx * 1.07), ry * 0.54);
      ctx.bezierCurveTo(x(rx * 0.86), ry * 0.92, x(rx * 0.45), ry * 0.98, 0, ry * 0.98);
    } else {
      ctx.bezierCurveTo(x(rx * 0.45), ry * 0.98, x(rx * 0.86), ry * 0.92, x(rx * 1.07), ry * 0.54);
      ctx.lineTo(x(rx * 0.99), ry * 0.36);
      ctx.lineTo(x(rx * 1.13), ry * 0.3);
      ctx.lineTo(x(rx * 0.98), ry * 0.08);
      ctx.bezierCurveTo(x(rx * 1.0), -ry * 0.5, x(rx * 0.72), -ry, 0, -ry);
    }
  }
  ctx.closePath();
}

type Face = 'normal' | 'squish' | 'fall' | 'limp' | 'happy' | 'alert';
const FACE_HOLD = 280;

function drawHead(ctx: CanvasRenderingContext2D, cat: Cat, time: number, still: boolean) {
  const col = cat.color;
  const r = cat.headR;
  ctx.save();
  ctx.translate(cat.headX, cat.headY);
  ctx.rotate(cat.headRot);
  ctx.scale(cat.dir, 1);
  const rx = r * 1.1;
  const ry = r * 0.95;
  const fx = r * 0.16; // 顔のパーツは向いている方へ少し寄せる（ななめ向き）

  // --- 耳（先が少し丸い三角） ---
  for (const side of [-1, 1]) {
    const far = side === -1; // 向いている方と逆の耳は少し小さく
    const k = far ? 0.92 : 1;
    ctx.save();
    ctx.translate(side * rx * 0.52 + fx * 0.3, -ry * 0.58);
    ctx.rotate(side * 0.36);
    ctx.scale(k, k);
    ctx.beginPath();
    ctx.moveTo(-r * 0.46, r * 0.2);
    ctx.quadraticCurveTo(-r * 0.3, -r * 0.3, -r * 0.08, -r * 0.66);
    ctx.quadraticCurveTo(0, -r * 0.76, r * 0.08, -r * 0.66);
    ctx.quadraticCurveTo(r * 0.3, -r * 0.3, r * 0.46, r * 0.2);
    ctx.closePath();
    ctx.fillStyle = col.pattern === 'calico' && col.patchA && col.patchB ? calicoHead(cat, side) : furGradient(ctx, col, -r * 0.7, r * 0.2);
    ctx.fill();
    ctx.strokeStyle = col.outline;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // 内側
    ctx.beginPath();
    ctx.moveTo(-r * 0.26, r * 0.12);
    ctx.quadraticCurveTo(-r * 0.14, -r * 0.22, 0, -r * 0.46);
    ctx.quadraticCurveTo(r * 0.14, -r * 0.22, r * 0.26, r * 0.12);
    ctx.closePath();
    ctx.fillStyle = col.earInner;
    ctx.fill();
    // 耳の中の毛
    ctx.strokeStyle = col.white;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 0.9;
    ctx.lineCap = 'round';
    for (const dx of [-0.08, 0.05]) {
      ctx.beginPath();
      ctx.moveTo(dx * r, r * 0.12);
      ctx.quadraticCurveTo(dx * r * 1.6, -r * 0.05, dx * r * 0.8, -r * 0.24);
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- 顔 ---
  headPath(ctx, rx, ry);
  ctx.fillStyle = furGradient(ctx, col, -ry, ry);
  ctx.fill();
  ctx.save();
  headPath(ctx, rx, ry);
  ctx.clip();
  // おでこのツヤ
  {
    const g = ctx.createRadialGradient(-r * 0.15, -ry * 0.55, 0, -r * 0.15, -ry * 0.55, r * 0.7);
    g.addColorStop(0, col.highlight);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = g;
    ctx.fillRect(-rx, -ry, rx * 2, ry * 2);
    ctx.globalAlpha = 1;
  }
  // 縞: おでこの「M」とほっぺの線
  if (col.pattern === 'tabby') {
    ctx.fillStyle = col.stripe;
    stripe(ctx, fx, -ry * 1.02, fx, -ry * 0.5, 2 * (r / 16), 0);
    stripe(ctx, fx - r * 0.3, -ry * 0.98, fx - r * 0.22, -ry * 0.58, 1.8 * (r / 16), 0.5);
    stripe(ctx, fx + r * 0.3, -ry * 0.98, fx + r * 0.22, -ry * 0.58, 1.8 * (r / 16), -0.5);
    for (const side of [-1, 1]) {
      for (const dy of [0.12, 0.3]) {
        stripe(ctx, side * rx * 1.08, ry * dy, side * rx * 0.68, ry * (dy - 0.04), 1.6 * (r / 16), 0);
      }
    }
  }
  // 三毛: 頭の左右にぶち（顔の真ん中は白）
  if (col.pattern === 'calico' && col.patchA && col.patchB) {
    ctx.fillStyle = calicoHead(cat, -1);
    ctx.beginPath();
    ctx.ellipse(-rx * 0.62, -ry * 0.55, r * 0.62, r * 0.55, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = calicoHead(cat, 1);
    ctx.beginPath();
    ctx.ellipse(rx * 0.72, -ry * 0.72, r * 0.48, r * 0.4, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // 口まわりの白
  if (col.bib) {
    ctx.fillStyle = col.white;
    ctx.beginPath();
    ctx.ellipse(fx - r * 0.2, r * 0.42, r * 0.32, r * 0.27, 0, 0, Math.PI * 2);
    ctx.ellipse(fx + r * 0.2, r * 0.42, r * 0.32, r * 0.27, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(fx, r * 0.7, r * 0.42, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  headPath(ctx, rx, ry);
  ctx.strokeStyle = col.outline;
  ctx.lineWidth = 1.7;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // --- 表情 ---
  const avgVy = (cat.vy[BODY_N] + cat.vy[BODY_N + HEAD_N / 2]) / 2;
  // 表情を決める。むぎゅ顔・驚き顔・ふつうの顔は、一度変えたら FACE_HOLD ミリ秒は保つ
  // （山の中で軽く触れたり離れたりするたびに表情がパタパタ変わって、チラついて見えないように）。
  // 揃った・にゃー・つままれた、の表情はすぐ切り替える
  let want: Face;
  if (cat.held) want = 'limp';
  else if (cat.exitPhase === 'meow' || cat.exitPhase === 'jump') want = 'happy';
  else if (cat.exitPhase === 'ready') want = 'alert';
  else {
    const touching = cat.cnx.some((v, i) => v !== 0 || cat.cny[i] !== 0);
    if (touching && (cat.stretch > PARAMS.squishFace || cat.areaRatio < 0.9)) want = 'squish';
    else if (avgVy > 250 && cat.contacts.size === 0) want = 'fall';
    else want = 'normal';
  }
  if (want !== cat.face) {
    const urgent = want === 'limp' || want === 'happy' || want === 'alert';
    if (urgent || time - cat.faceSince > FACE_HOLD || time < cat.faceSince) {
      cat.face = want;
      cat.faceSince = time;
    }
  }
  const limp = cat.face === 'limp'; // 首根っこをつままれて脱力中
  const happy = cat.face === 'happy'; // にゃー！
  const alert = cat.face === 'alert'; // 揃った！（目をまんまるに）
  const squished = cat.face === 'squish';
  const falling = alert || cat.face === 'fall';
  const blink = !still && Math.sin(time * 0.0013 + cat.id * 7.1) > 0.985;
  const eyeY = r * 0.1;
  const eyeDX = r * 0.43;

  // ほっぺの赤み
  ctx.fillStyle = col.earInner;
  ctx.globalAlpha = squished ? 0.55 : col.id === 'black' ? 0.3 : 0.35;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(fx + side * r * 0.62, r * 0.4, r * 0.17, r * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const side of [-1, 1]) {
    const k = side === -1 ? 0.9 : 1; // 奥の目は少し小さい
    const ex = fx + side * eyeDX * (side === -1 ? 0.92 : 1);
    const ey = eyeY;
    ctx.strokeStyle = col.faceLine;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    if (happy) {
      // にっこり「^ ^」
      ctx.moveTo(ex - r * 0.15 * k, ey + r * 0.05);
      ctx.quadraticCurveTo(ex, ey - r * 0.16, ex + r * 0.15 * k, ey + r * 0.05);
      ctx.lineWidth = 1.9;
      ctx.stroke();
    } else if (limp) {
      // されるがままの「－ －」（少しだけ弧）
      ctx.moveTo(ex - r * 0.15 * k, ey);
      ctx.quadraticCurveTo(ex, ey + r * 0.06, ex + r * 0.15 * k, ey);
      ctx.stroke();
    } else if (squished) {
      // むぎゅ顔 > <
      const d = -side;
      ctx.moveTo(ex - d * r * 0.13, ey - r * 0.13);
      ctx.lineTo(ex + d * r * 0.1, ey);
      ctx.lineTo(ex - d * r * 0.13, ey + r * 0.13);
      ctx.lineWidth = 1.8;
      ctx.stroke();
    } else if (blink) {
      ctx.moveTo(ex - r * 0.15 * k, ey);
      ctx.quadraticCurveTo(ex, ey + r * 0.1, ex + r * 0.15 * k, ey);
      ctx.stroke();
    } else {
      drawEye(ctx, col, ex, ey, r * 0.17 * k, r * (falling ? 0.19 : 0.215) * k, falling);
    }
  }

  // 鼻（丸みのある逆三角）
  {
    const ny = r * 0.3;
    ctx.beginPath();
    ctx.moveTo(fx - r * 0.1, ny - r * 0.04);
    ctx.quadraticCurveTo(fx, ny - r * 0.09, fx + r * 0.1, ny - r * 0.04);
    ctx.quadraticCurveTo(fx + r * 0.05, ny + r * 0.06, fx, ny + r * 0.08);
    ctx.quadraticCurveTo(fx - r * 0.05, ny + r * 0.06, fx - r * 0.1, ny - r * 0.04);
    ctx.fillStyle = col.nose;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(fx - r * 0.03, ny - r * 0.03, r * 0.035, r * 0.02, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fill();
  }
  // 口
  ctx.strokeStyle = col.faceLine;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  if (happy) {
    // 大きく開けた口（にゃー！）
    ctx.moveTo(fx - r * 0.2, r * 0.44);
    ctx.quadraticCurveTo(fx, r * 0.4, fx + r * 0.2, r * 0.44);
    ctx.quadraticCurveTo(fx + r * 0.16, r * 0.78, fx, r * 0.8);
    ctx.quadraticCurveTo(fx - r * 0.16, r * 0.78, fx - r * 0.2, r * 0.44);
    ctx.closePath();
    ctx.fillStyle = '#b5505e';
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(fx, r * 0.68, r * 0.1, r * 0.07, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#f2909c';
    ctx.fill();
  } else if (falling) {
    ctx.ellipse(fx, r * 0.55, r * 0.07, r * 0.09, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#c0626e';
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.moveTo(fx, r * 0.38);
    ctx.lineTo(fx, r * 0.44);
    ctx.moveTo(fx - r * 0.17, r * 0.43);
    ctx.quadraticCurveTo(fx - r * 0.085, r * 0.55, fx, r * 0.44);
    ctx.quadraticCurveTo(fx + r * 0.085, r * 0.55, fx + r * 0.17, r * 0.43);
    ctx.stroke();
  }
  // ひげ（ゆるいカーブ）
  ctx.strokeStyle = col.whisker;
  ctx.lineWidth = 0.8;
  for (const side of [-1, 1]) {
    for (const k of [-1, 0, 1]) {
      const sx = fx + side * r * 0.38;
      const sy = r * 0.42 + k * r * 0.06;
      const exx = fx + side * r * 1.25;
      const eyy = r * 0.36 + k * r * 0.2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo((sx + exx) / 2, sy + k * r * 0.04 - r * 0.06, exx, eyy);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** うるうるの目: 虹彩 → 瞳孔 → 大小のハイライト → 上まぶたの線 */
function drawEye(ctx: CanvasRenderingContext2D, col: CatColor, x: number, y: number, rx: number, ry: number, wide: boolean) {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  const g = ctx.createLinearGradient(0, y - ry, 0, y + ry);
  g.addColorStop(0, shadeHex(col.iris, -0.35));
  g.addColorStop(0.55, col.iris);
  g.addColorStop(1, shadeHex(col.iris, 0.25));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = col.faceLine;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // 瞳孔（驚くと丸く開く）
  ctx.beginPath();
  ctx.ellipse(x, y + ry * 0.05, wide ? rx * 0.72 : rx * 0.5, ry * (wide ? 0.72 : 0.78), 0, 0, Math.PI * 2);
  ctx.fillStyle = '#1b1518';
  ctx.fill();
  // ハイライト
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(x + rx * 0.28, y - ry * 0.36, rx * 0.38, ry * 0.3, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x - rx * 0.32, y + ry * 0.42, rx * 0.16, 0, Math.PI * 2);
  ctx.fill();
  // 上まぶた
  ctx.beginPath();
  ctx.ellipse(x, y, rx * 1.02, ry * 1.02, 0, Math.PI * 1.1, Math.PI * 1.9);
  ctx.strokeStyle = col.faceLine;
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
}

/** #rrggbb を明るく(+)/暗く(-) */
function shadeHex(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const f = (c: number) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt));
  r = f(r);
  g = f(g);
  b = f(b);
  return `rgb(${r},${g},${b})`;
}

// ---- 消去演出の吹き出し ----

function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** 揃った猫の頭上の「！」と「にゃー！」の吹き出し（猫より手前に描く） */
export function drawExitMarks(ctx: CanvasRenderingContext2D, cat: Cat) {
  if (cat.exitPhase === 'none') return;
  const x = cat.headX;
  const y = cat.headY - cat.headR - 14;
  ctx.save();
  ctx.translate(x, y);
  if (cat.exitPhase === 'ready') {
    const k = easeOutBack(Math.min(cat.exitT / 0.18, 1));
    ctx.scale(k, k);
    ctx.font = '900 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText('!', 0, 0);
    ctx.fillStyle = '#ff7a59';
    ctx.fillText('!', 0, 0);
  } else {
    // meow / jump（ジャンプ後もしばらく残す）
    const t = cat.exitPhase === 'meow' ? cat.exitT : 1 + cat.exitT;
    if (cat.exitPhase === 'jump' && cat.exitT > 0.45) {
      ctx.restore();
      return;
    }
    const k = easeOutBack(Math.min(t / 0.16, 1));
    const wob = Math.sin(t * 30) * 0.05 * Math.max(0, 1 - t * 2);
    ctx.rotate(wob);
    ctx.scale(k, k);
    const w = 52;
    const h = 22;
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 10, -h / 2);
    ctx.arcTo(w / 2, -h / 2, w / 2, h / 2, 10);
    ctx.arcTo(w / 2, h / 2, -w / 2, h / 2, 10);
    ctx.lineTo(4, h / 2);
    ctx.lineTo(-1, h / 2 + 7);
    ctx.lineTo(-5, h / 2);
    ctx.arcTo(-w / 2, h / 2, -w / 2, -h / 2, 10);
    ctx.arcTo(-w / 2, -h / 2, w / 2, -h / 2, 10);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = cat.color.outline;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.font = '800 12px "Hiragino Maru Gothic ProN", "Hiragino Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#5a4636';
    ctx.fillText('にゃー！', 0, 0.5);
  }
  ctx.restore();
}

// ---- デバッグ表示 ----

export function drawDebug(ctx: CanvasRenderingContext2D, world: World) {
  ctx.save();
  // ゲームオーバーライン
  ctx.strokeStyle = 'rgba(255,60,60,0.9)';
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const o = world.container.outline;
  ctx.moveTo(o[0].x - 10, world.container.gameOverY);
  ctx.lineTo(o[o.length - 1].x + 10, world.container.gameOverY);
  ctx.stroke();
  ctx.setLineDash([]);
  // 容器の当たり判定
  ctx.strokeStyle = 'rgba(0,160,0,0.5)';
  for (const w of world.container.walls) {
    ctx.lineWidth = w.thickness * 2;
    ctx.beginPath();
    ctx.moveTo(w.a.x, w.a.y);
    ctx.lineTo(w.b.x, w.b.y);
    ctx.stroke();
  }

  for (const cat of world.cats) {
    // Collider（胴体・頭ポリゴン）
    ctx.lineWidth = 1;
    ctx.strokeStyle = cat.sleeping ? 'rgba(140,140,140,0.9)' : 'rgba(0,120,255,0.9)'; // 灰色 = 眠っている（計算を省略中）
    for (const [st, n] of [
      [0, BODY_N],
      [BODY_N, HEAD_N],
    ]) {
      ctx.beginPath();
      for (let k = 0; k <= n; k++) {
        const i = st + (k % n);
        if (k === 0) ctx.moveTo(cat.x[i], cat.y[i]);
        else ctx.lineTo(cat.x[i], cat.y[i]);
      }
      ctx.stroke();
    }
    // 物理ポイント
    for (let i = 0; i < N; i++) {
      const touching = cat.cnx[i] !== 0 || cat.cny[i] !== 0;
      ctx.fillStyle = touching ? '#ff3b6b' : i < BODY_N ? '#0a6cff' : '#00a37a';
      ctx.beginPath();
      ctx.arc(cat.x[i], cat.y[i], 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    // 重心と変形軸
    ctx.strokeStyle = 'rgba(255,140,0,0.9)';
    ctx.beginPath();
    const L = 12 * cat.stretch;
    ctx.moveTo(cat.cx - Math.cos(cat.rot + cat.squashAxis) * L, cat.cy - Math.sin(cat.rot + cat.squashAxis) * L);
    ctx.lineTo(cat.cx + Math.cos(cat.rot + cat.squashAxis) * L, cat.cy + Math.sin(cat.rot + cat.squashAxis) * L);
    ctx.stroke();
  }
  // 接触している猫どうし（衝突）: 細いピンク線
  ctx.strokeStyle = 'rgba(255,0,180,0.6)';
  ctx.lineWidth = 1.2;
  for (const [a, b] of world.contactPairs) {
    ctx.beginPath();
    ctx.moveTo(a.cx, a.cy);
    ctx.lineTo(b.cx, b.cy);
    ctx.stroke();
  }
  // 同色のつながり（消去判定に使う）: 点線=つながり始め / 太い金色=判定に数えられている
  const stable = new Set(world.stablePairs.map(([a, b]) => a.id * 100000 + b.id));
  for (const [a, b] of world.matchPairs) {
    const ok = stable.has(a.id * 100000 + b.id);
    ctx.setLineDash(ok ? [] : [4, 4]);
    ctx.strokeStyle = ok ? 'rgba(255,190,0,0.95)' : 'rgba(255,190,0,0.6)';
    ctx.lineWidth = ok ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(a.cx, a.cy);
    ctx.lineTo(b.cx, b.cy);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}
