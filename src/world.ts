// 物理ワールド: 猫同士・猫と容器の衝突をPBD（Position Based Dynamics）で解く。

import { BODY_N, Cat, HEAD_N, N, TAIL_N } from './cat';
import type { ContainerShape } from './container';
import { PARAMS } from './params';

export class World {
  cats: Cat[] = [];
  container: ContainerShape;
  /** 今フレームで接触した猫ペア（デバッグ・同色判定用） */
  contactPairs: [Cat, Cat][] = [];
  /** 今フレームで「つながっている」同色の猫ペア（輪郭どうしが matchMargin 以内） */
  matchPairs: [Cat, Cat][] = [];
  /** 一定時間以上つながり続けている同色の猫ペア（同色判定に使う。一瞬の接触で誤判定しないため） */
  stablePairs: [Cat, Cat][] = [];
  private pairAge = new Map<string, number>();
  private sideBuf: number[] = [];
  private prevNear = new Set<string>();
  floorY: number;

  /** 手につままれている猫（他の猫・容器とは衝突せず、首の後ろの1点だけ手に固定してぶら下がる） */
  held: Cat | null = null;
  pinX = 0;
  pinY = 0;
  private lastPinX = 0;
  private lastPinY = 0;

  width: number;

  constructor(container: ContainerShape, floorY: number, width: number) {
    this.container = container;
    this.floorY = floorY;
    this.width = width;
  }

  /** ワールドの経過時間（秒） */
  time = 0;
  /** 安全装置で形を戻した回数（デバッグ表示用） */
  recoveredCount = 0;

  /** 眠っている猫を全員起こす（Debug でパラメータを変えたときなど） */
  wakeAll() {
    for (const c of this.cats) c.wake();
  }

  /**
   * 出ていく猫の上と両脇にいる、眠っている猫だけを起こす（隙間に落ちたり、横から流れ込んだりする猫）。
   * 全員を起こすと計算が一気に増えて重くなるため。起きた猫が動けば、その周りの猫も順に起きる。
   */
  wakeAround(leaving: Cat[]) {
    const side = 30;
    for (const L of leaving) {
      for (const c of this.cats) {
        if (!c.sleeping) continue;
        if (c.maxX < L.minX - side || c.minX > L.maxX + side) continue;
        if (c.minY > L.maxY + 10) continue; // 出ていく猫より下にいる猫は起こさない
        c.wake();
      }
    }
  }

  /** 眠っている猫の数（デバッグ表示用） */
  get sleepingCount() {
    let n = 0;
    for (const c of this.cats) if (c.sleeping) n++;
    return n;
  }

  add(cat: Cat) {
    cat.releasedAt = this.time;
    this.cats.push(cat);
  }

  /** 猫を手に持たせる（首の後ろを pin 位置へ） */
  hold(cat: Cat, x: number, y: number) {
    this.held = cat;
    cat.held = true;
    this.pinX = this.lastPinX = x;
    this.pinY = this.lastPinY = y;
  }

  /** 手を離す。ぶら下がっていたときの速度（揺れ）を持ったままワールドに加わる */
  release(): Cat | null {
    const cat = this.held;
    if (!cat) return null;
    cat.held = false;
    cat.releasedAt = this.time;
    this.held = null;
    // 振り子の勢いで容器の外へ飛んでいかないよう、横方向の勢いは少しだけ残す
    let mvx = 0;
    for (let i = 0; i < N; i++) mvx += cat.vx[i];
    mvx /= N;
    const cut = mvx * (1 - PARAMS.releaseSwing);
    for (let i = 0; i < N; i++) cat.vx[i] -= cut;
    this.cats.push(cat);
    return cat;
  }

  private stepHeld(dt: number, n: number) {
    const cat = this.held;
    if (!cat) return;
    const h = dt / n;
    const k = cat.scruff;
    cat.setPose(cat.pose + dt / 0.25); // つままれると脱力してだらんと伸びる
    for (let s = 1; s <= n; s++) {
      // フレーム内でピン位置を補間（手の動きを滑らかに伝える）
      const t = s / n;
      const tx = this.lastPinX + (this.pinX - this.lastPinX) * t;
      const ty = this.lastPinY + (this.pinY - this.lastPinY) * t;
      cat.predict(h, PARAMS.gravity);
      cat.solveInternal(n);
      cat.x[k] = tx;
      cat.y[k] = ty;
      cat.updateVelocity(h);
    }
    this.lastPinX = this.pinX;
    this.lastPinY = this.pinY;
    cat.updateTail(dt, PARAMS.gravity);
    cat.updateAABB();
  }

  step(dt: number) {
    this.time += dt;
    const n = Math.max(1, Math.round(PARAMS.substeps));
    const h = dt / n;
    const cats = this.cats;
    for (const c of cats) {
      // 眠っている猫は接触情報もそのまま（止まっているので変わらない）
      if (c.sleeping) continue;
      c.contacts.clear();
      c.updateMass();
      // 離された猫は、ぶら下がりポーズから香箱座りへ戻っていく
      if (c.pose > 0) c.setPose(c.pose - dt / 0.6);
    }
    // 起きている猫だけを計算する
    const awake = cats.filter((c) => !c.sleeping);
    const pairSet = new Map<string, [Cat, Cat]>();
    this.stepHeld(dt, n);

    for (let s = 0; s < n; s++) {
      for (const c of awake) c.predict(h, PARAMS.gravity);
      for (const c of awake) c.solveInternal(n);
      for (const c of awake) c.updateAABB();
      // 猫同士（眠っている猫どうしは計算しない）
      for (let i = 0; i < cats.length; i++) {
        const A = cats[i];
        if (A.ghost) continue;
        for (let j = i + 1; j < cats.length; j++) {
          const B = cats[j];
          if (B.ghost || (A.sleeping && B.sleeping)) continue;
          if (A.maxX < B.minX || B.maxX < A.minX || A.maxY < B.minY || B.maxY < A.minY) continue;
          collide.maxDepth = 0;
          const hit1 = collideCatPoints(A, B);
          const hit2 = collideCatPoints(B, A);
          // 眠っている猫に、起きている猫が強く押し込んできたら起こす
          if (collide.maxDepth > PARAMS.wakeDepth) {
            if (A.sleeping) A.wake();
            if (B.sleeping) B.wake();
          } else if ((hit1 || hit2) && (A.sleeping || B.sleeping)) {
            // 上に乗った猫が動いている（着地・ずれ落ち）ときは、下の眠っている猫も起こす。
            // 重みで下の猫が「むにっ」と潰れ、山が詰まっていく（眠ったままだと山が固まって詰まらない）
            const top = A.cy < B.cy ? A : B;
            const bottom = top === A ? B : A;
            if (bottom.sleeping && !top.sleeping && top.cy < bottom.cy - 5 && comSpeed(top) > PARAMS.wakeLoadSpeed) bottom.wake();
          }
          if (hit1 || hit2) {
            A.contacts.add(B.id);
            B.contacts.add(A.id);
            const key = A.id < B.id ? `${A.id}-${B.id}` : `${B.id}-${A.id}`;
            if (!pairSet.has(key)) pairSet.set(key, [A, B]);
          }
        }
      }
      // 容器
      for (const c of awake) if (!c.ghost && !c.sleeping) this.collideContainer(c);
      for (const c of awake) if (!c.sleeping) c.updateVelocity(h);
    }
    // 途中で起きた猫は、次のフレームから計算に加わる
    // 安全装置: 形が壊れた猫（裏返り・数値の破綻）はその場で元の形に戻す
    for (const c of awake) {
      if (c.isBroken()) {
        c.recoverShape();
        this.recoveredCount++;
      }
    }
    for (const c of awake) {
      c.updateTail(dt, PARAMS.gravity);
      if (!c.ghost) this.collideTail(c);
    }
    this.contactPairs = [...pairSet.values()];
    // 同色判定用の「つながり」: 衝突とは別に、輪郭どうしの距離で判定する。
    // 見た目（ほっぺのふわ毛・足先・輪郭線）は当たり判定より数px大きいので、その分の余裕を持たせる。
    // 耳と尻尾は当たり判定を持たないが、見た目では触れて見えるので、つながりの判定には含める。
    this.matchPairs = [];
    const nearSet = new Map<string, [Cat, Cat]>();
    const m = PARAMS.matchMargin;
    const extras = new Map<number, Float64Array>();
    const boxes = new Map<number, [number, number, number, number]>();
    for (const c of cats) {
      if (c.ghost) continue;
      const pts = extraMatchPoints(c);
      extras.set(c.id, pts);
      let x0 = c.minX;
      let y0 = c.minY;
      let x1 = c.maxX;
      let y1 = c.maxY;
      for (let k = 0; k < pts.length; k += 2) {
        x0 = Math.min(x0, pts[k]);
        x1 = Math.max(x1, pts[k]);
        y0 = Math.min(y0, pts[k + 1]);
        y1 = Math.max(y1, pts[k + 1]);
      }
      boxes.set(c.id, [x0, y0, x1, y1]);
    }
    for (let i = 0; i < cats.length; i++) {
      const A = cats[i];
      if (A.ghost) continue;
      const ba = boxes.get(A.id)!;
      for (let j = i + 1; j < cats.length; j++) {
        const B = cats[j];
        if (B.ghost || A.color.id !== B.color.id) continue;
        const key = A.id < B.id ? `${A.id}-${B.id}` : `${B.id}-${A.id}`;
        // 2匹とも眠っていれば形は変わっていないので、前のフレームの結果を使い回す
        if (A.sleeping && B.sleeping) {
          if (this.prevNear.has(key)) {
            nearSet.set(key, [A, B]);
            this.matchPairs.push([A, B]);
          }
          continue;
        }
        const bb = boxes.get(B.id)!;
        if (ba[2] + m < bb[0] || bb[2] + m < ba[0] || ba[3] + m < bb[1] || bb[3] + m < ba[1]) continue;
        if (catsWithin(A, B, m, extras.get(A.id)!) || catsWithin(B, A, m, extras.get(B.id)!)) {
          nearSet.set(key, [A, B]);
          this.matchPairs.push([A, B]);
        }
      }
    }
    this.prevNear = new Set(nearSet.keys());
    // つながりの継続時間
    const ages = new Map<string, number>();
    this.stablePairs = [];
    for (const [key, pair] of nearSet) {
      const age = Math.min((this.pairAge.get(key) ?? 0) + dt, PARAMS.matchContactTime + 0.2);
      ages.set(key, age);
      if (age >= PARAMS.matchContactTime) this.stablePairs.push(pair);
    }
    // 一瞬離れただけなら継続時間をすぐには消さない（少しずつ減らす）
    for (const [key, age] of this.pairAge) {
      if (ages.has(key)) continue;
      const left = age - dt * 2;
      if (left > 0) ages.set(key, left);
    }
    this.pairAge = ages;
    // 動いている猫のまわりで眠っている猫を起こす
    // （下の猫が転がって支えがなくなったのに、上の猫が眠ったまま宙に浮く、を防ぐ。着地の「むにっ」も保つ）
    const wm = 6;
    for (const A of awake) {
      if (A.ghost || A.sleeping) continue;
      // 体全体（重心）の速さで見る。その場でぷるぷる揺れているだけの猫では、まわりを起こさない
      let mvx = 0;
      let mvy = 0;
      for (let i = 0; i < N; i++) {
        mvx += A.vx[i];
        mvy += A.vy[i];
      }
      if (Math.hypot(mvx, mvy) / N < PARAMS.wakeSpeed) continue;
      for (const B of cats) {
        if (!B.sleeping) continue;
        if (A.maxX + wm < B.minX || B.maxX + wm < A.minX || A.maxY + wm < B.minY || B.maxY + wm < A.minY) continue;
        B.wake();
      }
    }
    for (const c of cats) {
      if (c.sleeping) {
        // 眠っている猫は止まったまま（何かの上に乗っている）
        c.restTime += dt;
        continue;
      }
      const target = Math.min(c.contacts.size / 4, 1);
      c.pressure += (target - c.pressure) * 0.05;
      c.updateAirState(dt);
      if (c.sleepBlock > 0) c.sleepBlock -= dt;
      // 止まって十分たったら眠らせる
      if (c.canSleep()) c.sleep();
    }

    // 画面外に出た猫は削除（容器から出ていった猫も）
    this.cats = cats.filter((c) => (c.ghost ? c.minY < this.floorY + 40 && c.maxX > -80 && c.minX < this.width + 80 : c.cy < this.floorY + 400));
  }

  /** 尻尾は見た目用だが、容器の壁は突き抜けないようにする（猫の胴体と同じ側へ押し戻す） */
  private collideTail(cat: Cat) {
    for (const wall of this.container.walls) {
      const ax = wall.a.x;
      const ay = wall.a.y;
      const ex = wall.b.x - ax;
      const ey = wall.b.y - ay;
      const len = Math.hypot(ex, ey);
      const nx = ey / len;
      const ny = -ex / len;
      const side = Math.sign((cat.cx - ax) * nx + (cat.cy - ay) * ny) || 1;
      const minD = wall.thickness + 3;
      for (let i = 1; i < cat.tx.length; i++) {
        const t = ((cat.tx[i] - ax) * ex + (cat.ty[i] - ay) * ey) / (len * len);
        if (t < 0 || t > 1) continue;
        const d = ((cat.tx[i] - ax) * nx + (cat.ty[i] - ay) * ny) * side;
        if (d < minD) {
          cat.tx[i] += nx * side * (minD - d);
          cat.ty[i] += ny * side * (minD - d);
        }
      }
    }
  }

  private collideContainer(cat: Cat) {
    const r = PARAMS.collisionRadius;
    // 壁ごとに「猫の重心がどちら側にいるか」を先に決める。
    // 点ごとに判定すると、縁に乗った猫が壁をまたいだまま（串刺し状態で）止まってしまうため。
    const walls = this.container.walls;
    const catSide = this.sideBuf;
    for (let w = 0; w < walls.length; w++) {
      const wall = walls[w];
      const ex = wall.b.x - wall.a.x;
      const ey = wall.b.y - wall.a.y;
      const len2 = ex * ex + ey * ey;
      const t = ((cat.cx - wall.a.x) * ex + (cat.cy - wall.a.y) * ey) / len2;
      catSide[w] = t > 0 && t < 1 ? Math.sign((cat.cx - wall.a.x) * ey - (cat.cy - wall.a.y) * ex) || 1 : 0;
    }
    for (let i = 0; i < N; i++) {
      for (let w = 0; w < walls.length; w++) {
        const wall = walls[w];
        const ax = wall.a.x;
        const ay = wall.a.y;
        const ex = wall.b.x - ax;
        const ey = wall.b.y - ay;
        const len2 = ex * ex + ey * ey;
        const tRaw = ((cat.x[i] - ax) * ex + (cat.y[i] - ay) * ey) / len2;
        const t = tRaw < 0 ? 0 : tRaw > 1 ? 1 : tRaw;
        const qx = ax + ex * t;
        const qy = ay + ey * t;
        const minD = wall.thickness + r;
        let dx = cat.x[i] - qx;
        let dy = cat.y[i] - qy;
        let d = Math.hypot(dx, dy);
        const nl = Math.sqrt(len2);
        const nlx = ey / nl;
        const nly = -ex / nl;
        const side = catSide[w];
        if (side !== 0 && tRaw > 0 && tRaw < 1) {
          // 壁の帯の中: 重心と同じ側へ押し出す（壁の向こう側に入り込んだ点も引き戻す）
          const sd = ((cat.x[i] - ax) * nlx + (cat.y[i] - ay) * nly) * side;
          if (sd >= minD || sd < -60) continue;
          dx = nlx * side;
          dy = nly * side;
          d = sd;
        } else {
          if (d >= minD) continue;
          // すり抜け防止: 前サブステップでいた側へ押し戻す
          const sidePrev = (cat.px[i] - ax) * nlx + (cat.py[i] - ay) * nly;
          const sideNow = (cat.x[i] - ax) * nlx + (cat.y[i] - ay) * nly;
          if (t > 0 && t < 1 && Math.sign(sidePrev) !== Math.sign(sideNow) && sidePrev !== 0) {
            dx = nlx * Math.sign(sidePrev);
            dy = nly * Math.sign(sidePrev);
            d = 0;
          } else if (d < 1e-6) {
            continue;
          } else {
            dx /= d;
            dy /= d;
          }
        }
        const push = minD - d;
        cat.x[i] += dx * push;
        cat.y[i] += dy * push;
        if (push > FREE_DEPTH * 3) {
          // 壁の向こうから引き戻すような大きな補正は速度にしない
          const ex2 = push - FREE_DEPTH * 3;
          cat.px[i] += dx * ex2;
          cat.py[i] += dy * ex2;
        }
        cat.cnx[i] += dx;
        cat.cny[i] += dy;
        // 位置ベースの摩擦（クーロン摩擦）: 押し付けられている量に比例した分だけ、接線方向の移動を打ち消す
        const mx = cat.x[i] - cat.px[i];
        const my = cat.y[i] - cat.py[i];
        const mn = mx * dx + my * dy;
        const tx = mx - mn * dx;
        const ty = my - mn * dy;
        const tl = Math.hypot(tx, ty);
        if (tl > 1e-9) {
          const corr = Math.min(1, (PARAMS.friction * FRICTION_SCALE * push) / tl);
          cat.x[i] -= tx * corr;
          cat.y[i] -= ty * corr;
        }
      }
      // 安全用の床
      if (cat.y[i] > this.floorY - r) {
        cat.y[i] = this.floorY - r;
        cat.cny[i] -= 1;
      }
    }
  }
}

/** 直前の collideCatPoints で一番深かっためり込み（眠っている猫を起こす判定に使う） */
const collide = { maxDepth: 0 };

/** 摩擦係数 → 位置ベース摩擦の換算倍率（friction 0.35 で静止摩擦係数 ≒ 0.5 相当） */
const FRICTION_SCALE = 1.4;
/** 猫どうしの押し出し量の上限（px / サブステップ） */
const MAX_PUSH = 2.5;
/** これを超えるめり込みの解消は速度に変換しない（px） */
const FREE_DEPTH = 0.6;
/** 押し出しはしないが「触れている」とみなす距離（px）。静止した猫どうしの接触判定がちらつかないように */
const TOUCH_MARGIN = 2.5;

// ---- 猫どうしの衝突（点 vs ポリゴン） ----

const polyStarts = [0, BODY_N];

/**
 * 当たり判定には含まれないが見た目に出ている部分の点: 耳（先端と中ほど）と、matchUseTail のとき尻尾。
 * 耳の位置は render.ts の drawHead と同じ式で求める。
 */
function extraMatchPoints(cat: Cat): Float64Array {
  const useTail = PARAMS.matchUseTail;
  const out = new Float64Array((4 + (useTail ? TAIL_N - 1 : 0)) * 2);
  const r = cat.headR;
  const cs = Math.cos(cat.headRot);
  const sn = Math.sin(cat.headRot);
  let k = 0;
  for (const side of [-1, 1]) {
    // 頭ローカル（右向き）での耳の先端と中ほど
    for (const [lx, ly] of [
      [side * 0.82 * r + 0.05 * r, -1.2 * r],
      [side * 0.68 * r + 0.05 * r, -0.85 * r],
    ]) {
      const x = lx * cat.dir;
      out[k++] = cat.headX + x * cs - ly * sn;
      out[k++] = cat.headY + x * sn + ly * cs;
    }
  }
  if (useTail) {
    for (let i = 1; i < TAIL_N; i++) {
      out[k++] = cat.tx[i];
      out[k++] = cat.ty[i];
    }
  }
  return out;
}

/** 体全体（重心）の速さ */
function comSpeed(c: Cat): number {
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < N; i++) {
    vx += c.vx[i];
    vy += c.vy[i];
  }
  return Math.hypot(vx, vy) / N;
}

/** A のどれかの点（物理点＋耳・尻尾）が、B の胴体/頭ポリゴンの内側か、輪郭から margin 以内にあるか */
function catsWithin(A: Cat, B: Cat, margin: number, extra: Float64Array): boolean {
  const m2 = margin * margin;
  const total = N + extra.length / 2;
  for (let i = 0; i < total; i++) {
    const x = i < N ? A.x[i] : extra[(i - N) * 2];
    const y = i < N ? A.y[i] : extra[(i - N) * 2 + 1];
    if (x < B.minX - margin || x > B.maxX + margin || y < B.minY - margin || y > B.maxY + margin) continue;
    for (let p = 0; p < 2; p++) {
      const start = polyStarts[p];
      const n = p === 0 ? BODY_N : HEAD_N;
      let inside = false;
      for (let k = 0; k < n; k++) {
        const a = start + k;
        const b = start + ((k + 1) % n);
        const ax = B.x[a];
        const ay = B.y[a];
        const bx = B.x[b];
        const by = B.y[b];
        if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
        const ex = bx - ax;
        const ey = by - ay;
        const l2 = ex * ex + ey * ey || 1e-9;
        let t = ((x - ax) * ex + (y - ay) * ey) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + ex * t - x;
        const qy = ay + ey * t - y;
        if (qx * qx + qy * qy < m2) return true;
      }
      if (inside) return true;
    }
  }
  return false;
}
const polyLens = [BODY_N, HEAD_N];

/** A の物理点が B の胴体/頭ポリゴンにめり込んでいたら押し出す。B の辺も逆向きに押す。 */
function collideCatPoints(A: Cat, B: Cat): boolean {
  const r = PARAMS.collisionRadius;
  let hit = false;
  for (let i = 0; i < N; i++) {
    const x = A.x[i];
    const y = A.y[i];
    if (x < B.minX || x > B.maxX || y < B.minY || y > B.maxY) continue;
    for (let p = 0; p < 2; p++) {
      const start = polyStarts[p];
      const n = polyLens[p];
      const sign = p === 0 ? B.bodySign : B.headSign;
      // 内外判定＋最近傍辺
      let inside = false;
      let best = Infinity;
      let bi = -1;
      let bt = 0;
      for (let k = 0; k < n; k++) {
        const a = start + k;
        const b = start + ((k + 1) % n);
        const ax = B.x[a];
        const ay = B.y[a];
        const bx = B.x[b];
        const by = B.y[b];
        if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
        if (!B.exposed[a]) continue;
        const ex = bx - ax;
        const ey = by - ay;
        const l2 = ex * ex + ey * ey || 1e-9;
        let t = ((x - ax) * ex + (y - ay) * ey) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + ex * t - x;
        const qy = ay + ey * t - y;
        const d2 = qx * qx + qy * qy;
        if (d2 < best) {
          best = d2;
          bi = k;
          bt = t;
        }
      }
      if (bi < 0) continue;
      const dist = Math.sqrt(best);
      if (!inside && dist >= r) {
        // 押し出すほどではないが、ほぼ触れている（同色判定のための「接触」には数える）
        if (dist < r + TOUCH_MARGIN) hit = true;
        continue;
      }
      const a = start + bi;
      const b = start + ((bi + 1) % n);
      // 外向き法線（辺の向き＋ポリゴンの回転方向から）
      const ex = B.x[b] - B.x[a];
      const ey = B.y[b] - B.y[a];
      const el = Math.hypot(ex, ey) || 1e-9;
      let nx = (ey / el) * sign;
      let ny = (-ex / el) * sign;
      let depth: number;
      if (inside) {
        depth = dist + r;
      } else {
        // 外側だが近すぎる: 最近点からの方向で押す
        const qx = B.x[a] + ex * bt;
        const qy = B.y[a] + ey * bt;
        const dx = x - qx;
        const dy = y - qy;
        const dl = Math.hypot(dx, dy);
        if (dl > 1e-6) {
          nx = dx / dl;
          ny = dy / dl;
        }
        depth = r - dist;
      }
      if (depth > collide.maxDepth) collide.maxDepth = depth;
      // 深くめり込んでいても1サブステップで押し返す量は制限する（重なって出現したときに弾け飛ばないように）
      if (depth > MAX_PUSH) depth = MAX_PUSH;
      const wp = A.w[i];
      const wa = B.w[a] * (1 - bt);
      const wb = B.w[b] * bt;
      const denom = wp + wa * (1 - bt) + wb * bt;
      if (denom < 1e-9) continue;
      const lam = depth / denom;
      A.x[i] += nx * wp * lam;
      A.y[i] += ny * wp * lam;
      B.x[a] -= nx * wa * lam;
      B.y[a] -= ny * wa * lam;
      B.x[b] -= nx * wb * lam;
      B.y[b] -= ny * wb * lam;
      // 深いめり込みの解消分は速度にしない（前位置も同じだけ動かす）。弾け飛び防止
      if (depth > FREE_DEPTH) {
        const e = (depth - FREE_DEPTH) / depth;
        A.px[i] += nx * wp * lam * e;
        A.py[i] += ny * wp * lam * e;
        B.px[a] -= nx * wa * lam * e;
        B.py[a] -= ny * wa * lam * e;
        B.px[b] -= nx * wb * lam * e;
        B.py[b] -= ny * wb * lam * e;
      }
      // 位置ベースの摩擦: 点と辺の相対的な接線移動を減らす
      {
        const ebx = (B.x[a] - B.px[a]) * (1 - bt) + (B.x[b] - B.px[b]) * bt;
        const eby = (B.y[a] - B.py[a]) * (1 - bt) + (B.y[b] - B.py[b]) * bt;
        const rx = A.x[i] - A.px[i] - ebx;
        const ry = A.y[i] - A.py[i] - eby;
        const rn = rx * nx + ry * ny;
        const tx0 = rx - rn * nx;
        const ty0 = ry - rn * ny;
        const tl = Math.hypot(tx0, ty0);
        // クーロン摩擦: めり込み（押し付け）の深さに比例した分だけ止める
        const corr = tl > 1e-9 ? Math.min(1, (PARAMS.friction * FRICTION_SCALE * depth) / tl) : 0;
        const tx = tx0 * corr;
        const ty = ty0 * corr;
        const sw = wp + B.w[a] * (1 - bt) + B.w[b] * bt;
        const fp = wp / sw;
        const fe = 1 - fp;
        A.x[i] -= tx * fp;
        A.y[i] -= ty * fp;
        B.x[a] += tx * fe * (1 - bt);
        B.y[a] += ty * fe * (1 - bt);
        B.x[b] += tx * fe * bt;
        B.y[b] += ty * fe * bt;
      }
      A.cnx[i] += nx;
      A.cny[i] += ny;
      B.cnx[a] -= nx;
      B.cny[a] -= ny;
      B.cnx[b] -= nx;
      B.cny[b] -= ny;
      hit = true;
    }
  }
  return hit;
}
