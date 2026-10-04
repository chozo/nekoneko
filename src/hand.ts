// 猫の首根っこをつまんで運んでくる手。
//
// 状態:
//   enter   … 画面上から猫をぶら下げて降りてくる
//   hold    … 指の位置へ追従（少し遅れて動くので、猫がぶらんと揺れる）
//   release … 指を開く（この瞬間に猫を離す）
//   leave   … 手だけ上へ戻っていく → 次の猫を持って enter

export type HandState = 'enter' | 'hold' | 'release' | 'leave' | 'idle';

export const HAND = {
  enterFromY: -70, // 登場開始のy（画面外）
  enterTime: 0.5, // 降りてくる時間
  releaseTime: 0.1, // 指を開く時間
  leaveTime: 0.35, // 上へ戻る時間
  followRate: 10, // 左右追従の速さ（大きいほど遅れが少ない＝揺れが小さい）
  dropTolerance: 6, // 目標位置からこの距離以内に来たら離す（タップでもその位置に落ちる）
  // 色（かわいいイラスト調。猫と同じく上から光が当たる想定）
  skin: '#ffe0cc',
  skinLight: '#fff1e6',
  skinShade: '#f3bea0',
  skinOutline: '#b9775a',
  blush: '#ff9f9f',
  nail: '#ffeef0',
  sleeve: '#9cc3ec', // ニットの袖
  sleeveLight: '#c4dcf6',
  sleeveShade: '#7aa3d3',
  sleeveOutline: '#5b80b0',
  cuff: '#fdf6ea', // 袖口のリブ
  cuffShade: '#e7dccb',
};

export class Hand {
  state: HandState = 'idle';
  x: number;
  y: number;
  targetX: number;
  restY: number;
  t = 0;
  /** 指の開き具合 0..1 */
  open = 0;
  /** 手の向き。1 なら指先が右（=猫の背中側）へ回り込む。つまんだ猫の向きで決める */
  flip: 1 | -1 = 1;
  /** 離す予約（タップ直後で手がまだ目標位置に着いていないとき） */
  releaseQueued = false;

  constructor(x: number, restY: number) {
    this.x = this.targetX = x;
    this.restY = restY;
    this.y = HAND.enterFromY;
  }

  startEnter() {
    this.state = 'enter';
    this.t = 0;
    this.open = 0;
    this.y = HAND.enterFromY;
    this.x = this.targetX;
    this.releaseQueued = false;
  }

  /** 戻り値: 'drop' のとき猫を離す / 'next' のとき次の猫を持たせる */
  update(dt: number): 'drop' | 'next' | null {
    // 左右は常に目標へ追従
    this.x += (this.targetX - this.x) * (1 - Math.exp(-HAND.followRate * dt));
    this.t += dt;
    switch (this.state) {
      case 'enter': {
        const k = Math.min(this.t / HAND.enterTime, 1);
        const e = 1 - Math.pow(1 - k, 3);
        this.y = HAND.enterFromY + (this.restY - HAND.enterFromY) * e;
        if (k >= 1) {
          this.state = 'hold';
          this.t = 0;
        }
        return null;
      }
      case 'hold':
        this.y = this.restY;
        if (this.releaseQueued && Math.abs(this.targetX - this.x) < HAND.dropTolerance) {
          this.state = 'release';
          this.t = 0;
          this.releaseQueued = false;
          return 'drop';
        }
        return null;
      case 'release':
        this.open = Math.min(this.t / HAND.releaseTime, 1);
        if (this.t >= HAND.releaseTime + 0.08) {
          this.state = 'leave';
          this.t = 0;
        }
        return null;
      case 'leave': {
        const k = Math.min(this.t / HAND.leaveTime, 1);
        this.y = this.restY + (HAND.enterFromY - this.restY) * k * k;
        if (k >= 1) {
          this.state = 'idle';
          return 'next';
        }
        return null;
      }
      default:
        return null;
    }
  }

  requestRelease() {
    if (this.state === 'enter' || this.state === 'hold') this.releaseQueued = true;
  }
}

// 手は横から見た「つまみ」の形で描く。ローカル座標は つまんでいる点 = (0,0)、+x = 猫の背中側。
//   人差し指: 手の甲の背中側から下へ伸び、第2関節で曲がって指先が首の皮を背中側から押さえる
//   親指    : 手の甲の顔側から下へ伸び、指先が反対側から首の皮を押さえる
//   中指〜小指: 握って人差し指の奥にしまう
const INDEX = { base: [11, -15], joint: [13, -5.5], tip: [6.6, 0.2], w: 7.2, nail: [0.55, 0.85] } as const;
const THUMB = { base: [-3, -17], joint: [-7.5, -7.5], tip: [-6.6, 0.2], w: 8.6, nail: [-0.55, 0.85] } as const;

/** 円柱っぽく見える横方向のグラデーション（中央が明るい） */
function cylinder(ctx: CanvasRenderingContext2D, x: number, w: number, light: string, base: string, shade: string) {
  const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  g.addColorStop(0, shade);
  g.addColorStop(0.38, light);
  g.addColorStop(0.62, base);
  g.addColorStop(1, shade);
  return g;
}

/** 腕・手の甲・握った指（猫より奥に描く） */
export function drawHandBack(ctx: CanvasRenderingContext2D, hand: Hand) {
  ctx.save();
  ctx.translate(hand.x, hand.y);
  ctx.scale(hand.flip, 1);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const ax = 5; // 腕の中心

  // --- ニットの袖 ---
  const wristY = -33;
  const sleeveTop = Math.min(-40 - hand.y, wristY - 40);
  const sw = 28;
  ctx.beginPath();
  roundRect(ctx, ax - sw / 2, sleeveTop, sw, wristY - sleeveTop, 10);
  ctx.fillStyle = cylinder(ctx, ax, sw, HAND.sleeveLight, HAND.sleeve, HAND.sleeveShade);
  ctx.fill();
  ctx.strokeStyle = HAND.sleeveOutline;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(70, 110, 170, 0.22)';
  ctx.lineWidth = 1;
  for (const dx of [-8, -2.7, 2.7, 8]) {
    ctx.beginPath();
    ctx.moveTo(ax + dx, sleeveTop);
    ctx.lineTo(ax + dx, wristY);
    ctx.stroke();
  }
  ctx.restore();

  // --- 袖口のリブ ---
  const cw = 32;
  ctx.beginPath();
  roundRect(ctx, ax - cw / 2, wristY - 6, cw, 11, 5.5);
  ctx.fillStyle = cylinder(ctx, ax, cw, '#ffffff', HAND.cuff, HAND.cuffShade);
  ctx.fill();
  ctx.strokeStyle = '#c9b9a3';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(170, 150, 125, 0.45)';
  ctx.lineWidth = 1;
  for (let dx = -12; dx <= 12; dx += 4) {
    ctx.beginPath();
    ctx.moveTo(ax + dx, wristY - 3.5);
    ctx.lineTo(ax + dx, wristY + 2.5);
    ctx.stroke();
  }

  // --- 握った指（中指・薬指・小指）: 人差し指の奥にころんと並ぶ ---
  const o = hand.open;
  for (const [fx, fy] of [
    [16.5, -22],
    [17.5, -16],
    [16, -10.5],
  ] as const) {
    const ux = fx + o * 2;
    const uy = fy + o * 1.5;
    ctx.beginPath();
    ctx.ellipse(ux, uy, 4.8, 3.9, 0.25, 0, Math.PI * 2);
    ctx.fillStyle = HAND.skinShade;
    ctx.fill();
    ctx.strokeStyle = HAND.skinOutline;
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }

  // --- 手の甲 ---
  ctx.beginPath();
  ctx.ellipse(ax + 1, -22, 12.5, 12, -0.15, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(ax - 3, -27, 1, ax + 1, -22, 14);
  g.addColorStop(0, HAND.skinLight);
  g.addColorStop(0.55, HAND.skin);
  g.addColorStop(1, HAND.skinShade);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = HAND.skinOutline;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // 指の付け根の関節（ぽこっと）
  ctx.strokeStyle = 'rgba(185, 119, 90, 0.5)';
  ctx.lineWidth = 1;
  for (const [kx, ky] of [
    [10.5, -27],
    [12, -21],
  ] as const) {
    ctx.beginPath();
    ctx.arc(kx, ky, 2.2, -0.6, 1.2);
    ctx.stroke();
  }
  ctx.restore();
}

/** 指1本: 付け根 → 関節 → 指先。爪は指先の外側に見せる */
function drawFinger(
  ctx: CanvasRenderingContext2D,
  f: { base: readonly number[]; joint: readonly number[]; tip: readonly number[]; w: number; nail: readonly number[] },
  angle: number,
  open: number,
) {
  const [bx, by] = f.base;
  const rot = (p: readonly number[]): [number, number] => {
    const dx = p[0] - bx;
    const dy = p[1] - by;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [bx + dx * c - dy * s, by + dx * s + dy * c];
  };
  const [jx, jy] = rot(f.joint);
  const [tx, ty] = rot(f.tip);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(jx, jy, tx, ty);
  };
  // 輪郭 → 肌 → ツヤ
  path();
  ctx.strokeStyle = HAND.skinOutline;
  ctx.lineWidth = f.w + 3;
  ctx.stroke();
  path();
  ctx.strokeStyle = HAND.skin;
  ctx.lineWidth = f.w;
  ctx.stroke();
  ctx.save();
  ctx.translate(-1, -1);
  path();
  ctx.strokeStyle = HAND.skinLight;
  ctx.lineWidth = f.w * 0.35;
  ctx.stroke();
  ctx.restore();

  // 指先の向き（爪の向き）
  const dx = tx - jx;
  const dy = ty - jy;
  const dl = Math.hypot(dx, dy) || 1;
  const ux = dx / dl;
  const uy = dy / dl;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const nx = f.nail[0] * c - f.nail[1] * s;
  const ny = f.nail[0] * s + f.nail[1] * c;
  // 指先の赤み（ぎゅっ）
  ctx.beginPath();
  ctx.arc(tx - nx * 1.2, ty - ny * 1.2, f.w * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = HAND.blush;
  ctx.globalAlpha = 0.4 * (1 - open);
  ctx.fill();
  ctx.globalAlpha = 1;
  // 爪
  const nxp = tx - ux * 2.4 + nx * f.w * 0.3;
  const nyp = ty - uy * 2.4 + ny * f.w * 0.3;
  ctx.beginPath();
  ctx.ellipse(nxp, nyp, 2.9, 2.1, Math.atan2(uy, ux), 0, Math.PI * 2);
  ctx.fillStyle = HAND.nail;
  ctx.fill();
  ctx.strokeStyle = 'rgba(185, 119, 90, 0.7)';
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(nxp - 0.7, nyp - 0.6, 0.8, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  // 関節のしわ
  ctx.beginPath();
  const kx = jx * 0.75 + bx * 0.25;
  const ky = jy * 0.75 + by * 0.25;
  ctx.moveTo(kx - ny * f.w * 0.35 + ux, ky + nx * f.w * 0.35 + uy);
  ctx.lineTo(kx + ny * f.w * 0.35 + ux, ky - nx * f.w * 0.35 + uy);
  ctx.strokeStyle = 'rgba(185, 119, 90, 0.55)';
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.restore();
}

/** つまんでいる人差し指と親指（猫の首の手前に描く） */
export function drawHandFront(ctx: CanvasRenderingContext2D, hand: Hand) {
  const o = hand.open;
  ctx.save();
  ctx.translate(hand.x, hand.y);
  ctx.scale(hand.flip, 1);
  // 開くと、人差し指は背中側へ・親指は顔側へ、付け根を軸に回って離れる
  drawFinger(ctx, THUMB, o * 0.85, o);
  drawFinger(ctx, INDEX, -o * 0.85, o);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (w <= 0 || h <= 0) return;
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
