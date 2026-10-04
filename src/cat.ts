// 猫1匹の擬似Soft Body。
//
// 構造:
//   - 胴体の輪郭リング（BODY_N点） … 変形の主役。面積保存＋辺長レンジ拘束で「体積を保ったまま潰れる」
//   - 頭のリング（HEAD_N点）       … 頭だけ強い剛体Shape Matchingで形を保つ（顔・耳が崩れない）
//   - 全身のShape Matching         … 回転＋面積保存の伸縮(上限付き)へ戻す。猫のシルエットを保つ「骨格」役
//   - 尻尾（TAIL_N点）             … 衝突なしの見た目用の紐。自由に揺れる
//
// 位置はすべて論理座標(px)。y軸は下向き。

import type { CatColor } from './colors';
import { PARAMS, perSubstep } from './params';

export const BODY_N = 20;
export const HEAD_N = 10;
export const TAIL_N = 7;
export const N = BODY_N + HEAD_N;

let nextId = 1;

/** 眠っている猫の集合が変わるたびに増える番号（描画のキャッシュを作り直す合図） */
export const SLEEP = { version: 0 };

export interface Mat2 {
  a: number; // [a b]
  b: number; // [c d]
  c: number;
  d: number;
}

export class Cat {
  id = nextId++;
  color: CatColor;
  dir: 1 | -1; // 顔の向き（1=右）
  scale: number;

  // 物理点（胴体リング → 頭リング）
  x = new Float64Array(N);
  y = new Float64Array(N);
  px = new Float64Array(N); // 前サブステップの位置
  py = new Float64Array(N);
  vx = new Float64Array(N);
  vy = new Float64Array(N);
  w = new Float64Array(N); // 逆質量

  // 静止形状（重心原点）
  qx = new Float64Array(N);
  qy = new Float64Array(N);
  restArea = 0;
  restEdge = new Float64Array(BODY_N);
  bodySign = 1; // 胴体ポリゴンの向き（外向き法線の計算用）
  headSign = 1;
  headQx = new Float64Array(HEAD_N); // 頭の重心からの静止形状
  headQy = new Float64Array(HEAD_N);
  headRestCx = 0;
  headRestCy = 0;
  headR = 0;
  neck: [number, number, number][] = []; // [頭点, 胴点, 静止長]
  /** 外側に露出している辺か（頭と胴の重なりの内側にある辺は押し出し先にしない） */
  exposed = new Uint8Array(N);
  aqqInv: Mat2 = { a: 1, b: 0, c: 0, d: 1 };

  // 見た目用の状態（Shape Matchingの結果）
  cx = 0;
  cy = 0;
  rot = 0; // 全身の回転
  stretch = 1; // 最大伸縮率（むぎゅ顔判定）
  squashAxis = 0;
  headX = 0;
  headY = 0;
  headRot = 0;
  areaRatio = 1;
  /** 周囲から押されている度合い 0..1（接触数を平滑化したもの） */
  pressure = 0;

  // 尻尾
  tx = new Float64Array(TAIL_N);
  ty = new Float64Array(TAIL_N);
  tpx = new Float64Array(TAIL_N);
  tpy = new Float64Array(TAIL_N);
  tqx = new Float64Array(TAIL_N); // 静止形状（全身ローカル）
  tqy = new Float64Array(TAIL_N);
  tailSeg = 0;
  tailAnchor = 0;

  /** 手につままれている */
  held = false;
  /**
   * 眠っている（計算を省略中）。山の中でじっと止まった猫は、物理の計算を止めて動かない壁として扱う。
   * 強く押されたり、近くの猫が抜けたりすると起きる。
   */
  sleeping = false;
  /** いまの表情と、その表情にした時刻（表情がパタパタ変わらないように少し保つ） */
  face = 'normal';
  faceSince = 0;
  /** 眠っている間の見た目を描いておく画像（起きたら捨てる）と、その貼り付け位置（画面のピクセル） */
  sprite: HTMLCanvasElement | null = null;
  spriteScale = 0;
  spritePx = 0;
  spritePy = 0;
  /** 起きてからこの秒数のあいだは眠らない（起こした直後に、同じフレームでまた眠ってしまわないように） */
  sleepBlock = 0;
  /** 何にも触れずに空中にいる時間 / 着地してからの時間 */
  airTime = 0;
  groundTime = 0;
  /** 着地に向けて足を伸ばしている度合い 0..1 */
  reach = 0;
  /** プレイヤーが離した（ワールドに加わった）時刻。連鎖の判定に使う */
  releasedAt = -1;
  /** 空中での最大の落下速度 / 着地した瞬間だけ入る落下速度（読んだら 0 に戻す） */
  fallSpeed = 0;
  landImpact = 0;
  /** ゲームオーバーラインを越えたまま止まっている時間（秒） */
  overTime = 0;
  /** 何かの上で止まっている時間（秒）。転がっている・落ちている間は 0 */
  restTime = 0;

  // --- 消去演出（rules.ts が管理） ---
  /** none → ready（間）→ meow（にゃー！）→ jump（容器の外へ） */
  exitPhase: 'none' | 'ready' | 'meow' | 'jump' = 'none';
  exitT = 0;
  /** 0..1: 形を「元の猫らしい形」へ強く戻す度合い */
  stiffBoost = 0;
  /** 他の猫・容器と衝突しない（ジャンプして出ていく猫） */
  ghost = false;
  /** ポーズ 0=香箱座り 1=ぶら下がり（静止形状のブレンド率） */
  pose = 0;
  private loafQx = new Float64Array(N);
  private loafQy = new Float64Array(N);
  private hangQx = new Float64Array(N);
  private hangQy = new Float64Array(N);
  private loafTx = new Float64Array(TAIL_N);
  private loafTy = new Float64Array(TAIL_N);
  private hangTx = new Float64Array(TAIL_N);
  private hangTy = new Float64Array(TAIL_N);
  private neckLoaf: number[] = [];
  private neckHang: number[] = [];
  /** つままれる点（首根っこ＝頭リングの後ろ側） */
  scruff = BODY_N;

  // 体の部位に対応する輪郭点インデックス
  frontPaws: number[] = [];
  hindPaw = 0;

  // AABB
  minX = 0;
  minY = 0;
  maxX = 0;
  maxY = 0;

  /** 接触中の猫id（デバッグ表示・後の同色判定で使う） */
  contacts = new Set<number>();
  /** 接触中フラグ（輪郭点ごと、反発・摩擦の計算用） */
  cnx = new Float64Array(N);
  cny = new Float64Array(N);

  constructor(color: CatColor, x: number, y: number, dir: 1 | -1, scale: number) {
    this.color = color;
    this.dir = dir;
    this.scale = scale;
    this.buildRestShape();
    for (let i = 0; i < N; i++) {
      this.x[i] = this.px[i] = x + this.qx[i];
      this.y[i] = this.py[i] = y + this.qy[i];
    }
    for (let i = 0; i < TAIL_N; i++) {
      this.tx[i] = this.tpx[i] = x + this.tqx[i];
      this.ty[i] = this.tpy[i] = y + this.tqy[i];
    }
    this.cx = x;
    this.cy = y;
    this.headX = x + this.headRestCx;
    this.headY = y + this.headRestCy;
    this.updateMass();
    this.updateAABB();
  }

  private buildRestShape() {
    const s = this.scale;
    const d = this.dir;
    // 胴体: 香箱座りの「ローフ」型。下が平らなスーパー楕円
    const rx = 31 * s;
    const ry = 21 * s;
    const angles: number[] = [];
    for (let i = 0; i < BODY_N; i++) {
      const t = (i / BODY_N) * Math.PI * 2;
      angles.push(t);
      const c = Math.cos(t);
      const sn = Math.sin(t);
      const ex = sn > 0 ? 3.2 : 2.3; // 下側ほど四角く（座っている感じ）
      const px = rx * Math.sign(c) * Math.pow(Math.abs(c), 2 / ex);
      const py = ry * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / ex);
      this.qx[i] = px * d;
      this.qy[i] = py;
    }
    // 頭: 胴の前上に乗る円
    const hr = 16.5 * s;
    const hcx = rx * 0.58 * d;
    const hcy = -ry * 0.82;
    for (let i = 0; i < HEAD_N; i++) {
      const t = (i / HEAD_N) * Math.PI * 2;
      const k = BODY_N + i;
      this.qx[k] = hcx + Math.cos(t) * hr * 1.08 * d;
      this.qy[k] = hcy + Math.sin(t) * hr * 0.96;
    }
    this.headR = hr;

    // 全体を重心原点へ
    let mx = 0;
    let my = 0;
    for (let i = 0; i < N; i++) {
      mx += this.qx[i];
      my += this.qy[i];
    }
    mx /= N;
    my /= N;
    for (let i = 0; i < N; i++) {
      this.qx[i] -= mx;
      this.qy[i] -= my;
    }

    // 頭の静止形状
    let hx = 0;
    let hy = 0;
    for (let i = 0; i < HEAD_N; i++) {
      hx += this.qx[BODY_N + i];
      hy += this.qy[BODY_N + i];
    }
    hx /= HEAD_N;
    hy /= HEAD_N;
    this.headRestCx = hx;
    this.headRestCy = hy;
    for (let i = 0; i < HEAD_N; i++) {
      this.headQx[i] = this.qx[BODY_N + i] - hx;
      this.headQy[i] = this.qy[BODY_N + i] - hy;
    }

    // 面積・辺長
    this.restArea = polyArea(this.qx, this.qy, 0, BODY_N);
    this.bodySign = Math.sign(this.restArea);
    this.restArea = Math.abs(this.restArea);
    this.headSign = Math.sign(polyArea(this.qx, this.qy, BODY_N, HEAD_N));
    for (let i = 0; i < BODY_N; i++) {
      const j = (i + 1) % BODY_N;
      this.restEdge[i] = Math.hypot(this.qx[j] - this.qx[i], this.qy[j] - this.qy[i]);
    }

    // 首の後ろ: 頭の中心から見て「後ろ上」に最も近い頭リングの点
    {
      let best = -Infinity;
      const ux = -0.8 * d;
      const uy = -0.6;
      for (let i = 0; i < HEAD_N; i++) {
        const dot = this.headQx[i] * ux + this.headQy[i] * uy;
        if (dot > best) {
          best = dot;
          this.scruff = BODY_N + i;
        }
      }
    }

    // 露出辺: 静止形状で、辺の中点がもう一方のポリゴンの内側にあるものは除外
    for (let k = 0; k < N; k++) {
      const isHead = k >= BODY_N;
      const start = isHead ? BODY_N : 0;
      const n = isHead ? HEAD_N : BODY_N;
      const j = start + ((k - start + 1) % n);
      const mx = (this.qx[k] + this.qx[j]) / 2;
      const my = (this.qy[k] + this.qy[j]) / 2;
      const inOther = isHead
        ? pointInPoly(this.qx, this.qy, 0, BODY_N, mx, my)
        : pointInPoly(this.qx, this.qy, BODY_N, HEAD_N, mx, my);
      this.exposed[k] = inOther ? 0 : 1;
    }

    // 首: 頭の各点を最寄りの胴体2点とつなぐ
    this.neck = [];
    for (let h = 0; h < HEAD_N; h++) {
      const k = BODY_N + h;
      const ds: [number, number][] = [];
      for (let b = 0; b < BODY_N; b++) {
        ds.push([b, Math.hypot(this.qx[k] - this.qx[b], this.qy[k] - this.qy[b])]);
      }
      ds.sort((p, q) => p[1] - q[1]);
      for (let m = 0; m < 2; m++) this.neck.push([k, ds[m][0], ds[m][1]]);
    }

    this.computeAqq();

    // 部位: 輪郭のどの点に足を付けるか（静止角度で選ぶ）
    const pick = (ang: number) => {
      let best = 0;
      let bd = 1e9;
      for (let i = 0; i < BODY_N; i++) {
        let diff = Math.abs(angles[i] - ang);
        diff = Math.min(diff, Math.PI * 2 - diff);
        if (diff < bd) {
          bd = diff;
          best = i;
        }
      }
      return best;
    };
    // 角度はdir=1（右向き）基準。xを反転してもインデックスは同じ部位を指す
    this.frontPaws = [pick(Math.PI * 0.2), pick(Math.PI * 0.33)];
    this.hindPaw = pick(Math.PI * 0.72);
    this.tailAnchor = pick(Math.PI * 1.02);

    // 尻尾: 背中側から上に立ち上がり、先が丸まる「？」型
    const ax = this.qx[this.tailAnchor];
    const ay = this.qy[this.tailAnchor];
    this.tailSeg = 7.5 * s;
    let ang = Math.PI * 1.08; // 左（背中側）へ
    let cx = ax;
    let cy = ay;
    for (let i = 0; i < TAIL_N; i++) {
      this.tqx[i] = cx;
      this.tqy[i] = cy;
      cx += Math.cos(ang) * this.tailSeg * d;
      cy += Math.sin(ang) * this.tailSeg;
      ang += 0.32; // 上へ巻き上げる
    }

    this.buildHangPose();
  }

  /** Aqq^-1（線形Shape Matching用）を現在の静止形状 q から計算 */
  private computeAqq() {
    let a = 0;
    let b = 0;
    let dd = 0;
    for (let i = 0; i < N; i++) {
      a += this.qx[i] * this.qx[i];
      b += this.qx[i] * this.qy[i];
      dd += this.qy[i] * this.qy[i];
    }
    const det = a * dd - b * b;
    this.aqqInv = { a: dd / det, b: -b / det, c: -b / det, d: a / det };
  }

  /**
   * 「首根っこをつままれてぶら下がる」ポーズを作る。
   * 胴体は首根っこの真下に縦長に垂れ下がる（面積は香箱座りと同じ）。頭リングの形は変えない。
   * 輪郭点の対応は「香箱座りの胸→首元 / お腹→前 / お尻→下 / 背中→後ろ」になるよう90°回して作るので、
   * 前足は胸のあたり、後ろ足はお腹の下、尻尾はお尻から垂れる。
   */
  private buildHangPose() {
    const d = this.dir;
    const s = this.scale;
    this.loafQx.set(this.qx);
    this.loafQy.set(this.qy);
    this.loafTx.set(this.tqx);
    this.loafTy.set(this.tqy);

    // 縦長の胴体（香箱座りと同じ面積にそろえる）
    let rxh = 15 * s;
    let ryh = 40 * s;
    const ex = 2.4;
    const unit = (t: number): [number, number] => {
      const c = Math.cos(t);
      const sn = Math.sin(t);
      return [Math.sign(c) * Math.pow(Math.abs(c), 2 / ex), Math.sign(sn) * Math.pow(Math.abs(sn), 2 / ex)];
    };
    const tmpX = new Float64Array(BODY_N);
    const tmpY = new Float64Array(BODY_N);
    for (let i = 0; i < BODY_N; i++) {
      const [c, sn] = unit((i / BODY_N) * Math.PI * 2);
      // 香箱座りの (c, sn) を (sn, -c) へ（-90°回転）
      tmpX[i] = sn;
      tmpY[i] = -c;
    }
    const unitArea = Math.abs(polyArea(tmpX, tmpY, 0, BODY_N));
    const k = Math.sqrt(this.restArea / (unitArea * rxh * ryh));
    rxh *= k;
    ryh *= k;
    for (let i = 0; i < BODY_N; i++) {
      this.hangQx[i] = tmpX[i] * rxh * d;
      this.hangQy[i] = tmpY[i] * ryh;
    }
    // 頭: 胴の上端に少し重ねて、やや前へ
    const hcx = 3 * s * d;
    const hcy = -ryh - 3 * s;
    for (let i = 0; i < HEAD_N; i++) {
      this.hangQx[BODY_N + i] = hcx + this.headQx[i];
      this.hangQy[BODY_N + i] = hcy + this.headQy[i];
    }
    // 重心が首根っこの真下に来るよう、胴体だけ前後にずらす（吊ったときに傾かない）
    let mx = 0;
    for (let i = 0; i < N; i++) mx += this.hangQx[i];
    mx /= N;
    const shift = (this.hangQx[this.scruff] - mx) * (N / BODY_N);
    for (let i = 0; i < BODY_N; i++) this.hangQx[i] += shift;

    // 尻尾: お尻から真下へだらんと（先だけ少し巻く）
    const ax = this.hangQx[this.tailAnchor];
    const ay = this.hangQy[this.tailAnchor];
    for (let i = 0; i < TAIL_N; i++) {
      const bend = Math.max(0, i - 3) * 0.35;
      this.hangTx[i] = ax - d * (Math.sin(bend) * this.tailSeg * 1.2 + i * 0.6);
      this.hangTy[i] = ay + i * this.tailSeg * 0.9;
    }

    // 重心を原点へ
    mx = 0;
    let my = 0;
    for (let i = 0; i < N; i++) {
      mx += this.hangQx[i];
      my += this.hangQy[i];
    }
    mx /= N;
    my /= N;
    for (let i = 0; i < N; i++) {
      this.hangQx[i] -= mx;
      this.hangQy[i] -= my;
    }
    for (let i = 0; i < TAIL_N; i++) {
      this.hangTx[i] -= mx;
      this.hangTy[i] -= my;
    }
    // 首の静止長（ポーズごと）
    this.neckLoaf = this.neck.map((n) => n[2]);
    this.neckHang = this.neck.map(([h, b]) => Math.hypot(this.hangQx[h] - this.hangQx[b], this.hangQy[h] - this.hangQy[b]));
  }

  /** ポーズを 0=香箱座り 〜 1=ぶら下がり でブレンドして静止形状に反映 */
  setPose(p: number) {
    p = Math.min(Math.max(p, 0), 1);
    if (p === this.pose) return;
    this.pose = p;
    const k = 1 - p;
    for (let i = 0; i < N; i++) {
      this.qx[i] = this.loafQx[i] * k + this.hangQx[i] * p;
      this.qy[i] = this.loafQy[i] * k + this.hangQy[i] * p;
    }
    for (let i = 0; i < TAIL_N; i++) {
      this.tqx[i] = this.loafTx[i] * k + this.hangTx[i] * p;
      this.tqy[i] = this.loafTy[i] * k + this.hangTy[i] * p;
    }
    for (let j = 0; j < this.neck.length; j++) this.neck[j][2] = this.neckLoaf[j] * k + this.neckHang[j] * p;
    this.computeAqq();
  }

  /** 眠らせる: 速度を 0 にして、動かない（質量無限大＝逆質量 0）壁にする */
  sleep() {
    if (this.sleeping) return;
    this.sleeping = true;
    for (let i = 0; i < N; i++) {
      this.vx[i] = 0;
      this.vy[i] = 0;
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
      this.w[i] = 0;
    }
    SLEEP.version++;
  }

  /** 起こす */
  wake() {
    if (!this.sleeping) return;
    this.sleeping = false;
    this.sleepBlock = 0.4;
    this.sprite = null;
    this.updateMass();
    for (let i = 0; i < N; i++) {
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
    }
    SLEEP.version++;
  }

  /** 眠ってよいか（止まって十分たった、演出中でない） */
  canSleep(): boolean {
    if (this.sleeping || this.held || this.ghost || this.exitPhase !== 'none' || this.pose > 0) return false;
    if (this.sleepBlock > 0) return false;
    if (this.restTime < PARAMS.sleepAfter) return false;
    let sp = 0;
    for (let i = 0; i < N; i++) sp += Math.hypot(this.vx[i], this.vy[i]);
    return sp / N < PARAMS.sleepSpeed;
  }

  updateMass() {
    const wBody = N / Math.max(PARAMS.mass, 0.01);
    for (let i = 0; i < N; i++) this.w[i] = wBody;
  }

  updateAABB() {
    let a = Infinity;
    let b = Infinity;
    let c = -Infinity;
    let e = -Infinity;
    for (let i = 0; i < N; i++) {
      const x = this.x[i];
      const y = this.y[i];
      if (x < a) a = x;
      if (y < b) b = y;
      if (x > c) c = x;
      if (y > e) e = y;
    }
    const r = PARAMS.collisionRadius;
    this.minX = a - r;
    this.minY = b - r;
    this.maxX = c + r;
    this.maxY = e + r;
  }

  /** 位置予測（Verlet/PBD） */
  predict(dt: number, gravity: number) {
    // 立ち直り反射: 空中では体をひねって足を下へ向ける
    const rs = this.held ? 0 : this.airTime > 0 ? 1 : this.groundTime < PARAMS.landRollTime ? PARAMS.landRollStrength : 0;
    if (rs > 0) this.applyRighting(dt, rs);
    const damp = Math.exp(-PARAMS.damping * dt);
    // 周りに押し込まれているほど強く減衰（単独の猫は着地でぷるんと揺れ、山の中では落ち着く）
    const idamp = Math.exp(-(PARAMS.internalDamping + PARAMS.packedDamping * this.pressure) * dt);
    const vmax = PARAMS.maxSpeed;
    // 重心速度（内部振動だけを減衰させるため）
    let mvx = 0;
    let mvy = 0;
    for (let i = 0; i < N; i++) {
      mvx += this.vx[i];
      mvy += this.vy[i];
    }
    mvx /= N;
    mvy /= N;
    for (let i = 0; i < N; i++) {
      let vx = (mvx + (this.vx[i] - mvx) * idamp) * damp;
      let vy = (mvy + (this.vy[i] - mvy) * idamp) * damp + gravity * dt;
      const sp = Math.hypot(vx, vy);
      if (sp > vmax) {
        vx *= vmax / sp;
        vy *= vmax / sp;
      }
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
      this.x[i] += vx * dt;
      this.y[i] += vy * dt;
      this.cnx[i] = 0;
      this.cny[i] = 0;
    }
  }

  /**
   * 猫の立ち直り反射。重心まわりの回転速度を「直立（rot=0）へ戻る回転速度」へ近づける。
   * 重心の移動（落下）には影響しない。形は内部拘束が保つので、体をひねって回るように見える。
   */
  private applyRighting(dt: number, strength: number) {
    let cx = 0;
    let cy = 0;
    let mvx = 0;
    let mvy = 0;
    for (let i = 0; i < N; i++) {
      cx += this.x[i];
      cy += this.y[i];
      mvx += this.vx[i];
      mvy += this.vy[i];
    }
    cx /= N;
    cy /= N;
    mvx /= N;
    mvy /= N;
    let L = 0;
    let I = 0;
    for (let i = 0; i < N; i++) {
      const rx = this.x[i] - cx;
      const ry = this.y[i] - cy;
      L += rx * (this.vy[i] - mvy) - ry * (this.vx[i] - mvx);
      I += rx * rx + ry * ry;
    }
    if (I < 1e-6) return;
    const w = L / I; // 現在の角速度
    const maxSpin = PARAMS.rightingMaxSpin;
    const target = Math.max(-maxSpin, Math.min(maxSpin, -this.rot * PARAMS.rightingGain));
    const dw = (target - w) * (1 - Math.exp(-PARAMS.rightingRate * strength * dt));
    for (let i = 0; i < N; i++) {
      const rx = this.x[i] - cx;
      const ry = this.y[i] - cy;
      this.vx[i] -= dw * ry;
      this.vy[i] += dw * rx;
    }
  }

  /** 形が壊れていないか（裏返り・潰れすぎ・数値の破綻） */
  isBroken(): boolean {
    if (!Number.isFinite(this.cx) || !Number.isFinite(this.cy)) return true;
    for (let i = 0; i < N; i++) if (!Number.isFinite(this.x[i]) || !Number.isFinite(this.y[i])) return true;
    const area = polyArea(this.x, this.y, 0, BODY_N) * this.bodySign;
    return area < this.restArea * 0.25 || this.maxX - this.minX > 200 || this.maxY - this.minY > 200;
  }

  /**
   * 安全装置: 形が壊れた猫を、その場で元の形に戻す。
   * 重心と向き（rot）はそのままで、静止形状を置き直す。速度は全体の平均だけ残す。
   */
  recoverShape() {
    let cx = 0;
    let cy = 0;
    let vx = 0;
    let vy = 0;
    let ok = 0;
    for (let i = 0; i < N; i++) {
      if (!Number.isFinite(this.x[i]) || !Number.isFinite(this.y[i])) continue;
      cx += this.x[i];
      cy += this.y[i];
      if (Number.isFinite(this.vx[i]) && Number.isFinite(this.vy[i])) {
        vx += this.vx[i];
        vy += this.vy[i];
      }
      ok++;
    }
    if (ok > 0) {
      cx /= ok;
      cy /= ok;
      vx /= ok;
      vy /= ok;
    } else {
      cx = Number.isFinite(this.cx) ? this.cx : 180;
      cy = Number.isFinite(this.cy) ? this.cy : 300;
    }
    const sp = Math.hypot(vx, vy);
    if (sp > 300) {
      vx *= 300 / sp;
      vy *= 300 / sp;
    }
    const rot = Number.isFinite(this.rot) ? this.rot : 0;
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    for (let i = 0; i < N; i++) {
      this.x[i] = this.px[i] = cx + cs * this.qx[i] - sn * this.qy[i];
      this.y[i] = this.py[i] = cy + sn * this.qx[i] + cs * this.qy[i];
      this.vx[i] = vx;
      this.vy[i] = vy;
    }
    for (let i = 0; i < TAIL_N; i++) {
      this.tx[i] = this.tpx[i] = cx + cs * this.tqx[i] - sn * this.tqy[i];
      this.ty[i] = this.tpy[i] = cy + sn * this.tqx[i] + cs * this.tqy[i];
    }
    this.cx = cx;
    this.cy = cy;
    this.headX = cx + cs * this.headRestCx - sn * this.headRestCy;
    this.headY = cy + sn * this.headRestCx + cs * this.headRestCy;
    this.headRot = rot;
    this.areaRatio = 1;
    this.updateAABB();
  }

  /** 空中・着地の状態を1フレームごとに更新（World.step の最後に呼ぶ） */
  updateAirState(dt: number) {
    let touching = this.contacts.size > 0;
    if (!touching) {
      for (let i = 0; i < N; i++) {
        if (this.cnx[i] !== 0 || this.cny[i] !== 0) {
          touching = true;
          break;
        }
      }
    }
    let mvy = 0;
    for (let i = 0; i < N; i++) mvy += this.vy[i];
    mvy /= N;
    if (this.held) {
      this.airTime = 0;
      this.groundTime = 0;
      this.fallSpeed = 0;
    } else if (touching) {
      // 空中から着地した瞬間（着地音に使う）
      if (this.airTime > 0.12 && this.fallSpeed > 150) this.landImpact = this.fallSpeed;
      this.fallSpeed = 0;
      this.airTime = 0;
      this.groundTime += dt;
    } else {
      this.airTime += dt;
      this.groundTime = 0;
      this.fallSpeed = Math.max(this.fallSpeed, mvy);
    }
    // 落下中は足を下へ伸ばして着地の準備
    const reaching = this.airTime > 0.05 && mvy > 120;
    // 止まっている時間（転がり終わったか）: 全身の点の平均の速さで見る
    let sp = 0;
    for (let i = 0; i < N; i++) sp += Math.hypot(this.vx[i], this.vy[i]);
    sp /= N;
    if (!this.held && touching && sp < PARAMS.settleSpeed) this.restTime += dt;
    else this.restTime = 0;
    this.reach = Math.min(1, Math.max(0, this.reach + (reaching ? dt / 0.18 : -dt / 0.15)));
  }

  /** 内部拘束（形状を保つ力）を1回解く */
  solveInternal(substeps: number) {
    this.solveShapeMatching(substeps);
    this.solveHead(substeps);
    this.solveEdges(substeps);
    this.solveNeck(substeps);
    this.solveArea(substeps);
  }

  /** 全身Shape Matching: 回転＋（面積保存・上限付きの）伸縮した静止形状へ引き戻す */
  private solveShapeMatching(substeps: number) {
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < N; i++) {
      cx += this.x[i];
      cy += this.y[i];
    }
    cx /= N;
    cy /= N;
    // Apq
    let a = 0;
    let b = 0;
    let c = 0;
    let d = 0;
    for (let i = 0; i < N; i++) {
      const px = this.x[i] - cx;
      const py = this.y[i] - cy;
      a += px * this.qx[i];
      b += px * this.qy[i];
      c += py * this.qx[i];
      d += py * this.qy[i];
    }
    // 線形変換 A = Apq * Aqq^-1
    const q = this.aqqInv;
    let la = a * q.a + b * q.c;
    let lb = a * q.b + b * q.d;
    let lc = c * q.a + d * q.c;
    let ld = c * q.b + d * q.d;
    // 回転: A の極分解 A = R S から取る（Apq から取ると伸縮時に余計なトルクが出る）
    const th = Math.atan2(lc - lb, la + ld);
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    // S = R^T A（対称化）
    let s11 = cs * la + sn * lc;
    let s12 = cs * lb + sn * ld;
    let s21 = -sn * la + cs * lc;
    let s22 = -sn * lb + cs * ld;
    const sOff = (s12 + s21) / 2;
    s12 = s21 = sOff;
    // 固有分解して伸縮率をクランプ・面積1に正規化
    const tr = (s11 + s22) / 2;
    const disc = Math.sqrt(Math.max(((s11 - s22) / 2) ** 2 + sOff * sOff, 0));
    let l1 = tr + disc;
    let l2 = tr - disc;
    const ang = 0.5 * Math.atan2(2 * sOff, s11 - s22); // 固有ベクトル1の角度
    if (l1 <= 1e-4 || l2 <= 1e-4) {
      l1 = l2 = 1;
    }
    const g = Math.sqrt(l1 * l2);
    l1 /= g;
    l2 /= g;
    const ms = Math.max(PARAMS.maxStretch, 1);
    if (l1 > ms) {
      l1 = ms;
      l2 = 1 / ms;
    }
    if (l2 < 1 / ms) {
      l2 = 1 / ms;
      l1 = ms;
    }
    // 変形度合い deformation で回転のみ(I)と伸縮(S)をブレンド
    const beta = PARAMS.deformation * (1 - 0.85 * this.stiffBoost);
    l1 = 1 + (l1 - 1) * beta;
    l2 = 1 + (l2 - 1) * beta;
    const ec = Math.cos(ang);
    const es = Math.sin(ang);
    // S' = E diag(l1,l2) E^T
    s11 = l1 * ec * ec + l2 * es * es;
    s22 = l1 * es * es + l2 * ec * ec;
    s12 = (l1 - l2) * ec * es;
    // T = R S'
    const ta = cs * s11 - sn * s12;
    const tb = cs * s12 - sn * s22;
    const tc = sn * s11 + cs * s12;
    const td = sn * s12 + cs * s22;
    la = ta;
    lb = tb;
    lc = tc;
    ld = td;

    const k = perSubstep(PARAMS.stiffness + (0.75 - PARAMS.stiffness) * this.stiffBoost, substeps);
    for (let i = 0; i < N; i++) {
      const gx = la * this.qx[i] + lb * this.qy[i] + cx;
      const gy = lc * this.qx[i] + ld * this.qy[i] + cy;
      this.x[i] += (gx - this.x[i]) * k;
      this.y[i] += (gy - this.y[i]) * k;
    }

    this.cx = cx;
    this.cy = cy;
    this.rot = th;
    this.stretch = Math.max(l1, l2) / Math.min(l1, l2);
    this.squashAxis = ang;
  }

  /** 頭は剛体Shape Matchingで強く形を保つ */
  private solveHead(substeps: number) {
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < HEAD_N; i++) {
      cx += this.x[BODY_N + i];
      cy += this.y[BODY_N + i];
    }
    cx /= HEAD_N;
    cy /= HEAD_N;
    let a = 0;
    let b = 0;
    let c = 0;
    let d = 0;
    for (let i = 0; i < HEAD_N; i++) {
      const px = this.x[BODY_N + i] - cx;
      const py = this.y[BODY_N + i] - cy;
      a += px * this.headQx[i];
      b += px * this.headQy[i];
      c += py * this.headQx[i];
      d += py * this.headQy[i];
    }
    const th = Math.atan2(c - b, a + d);
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    const k = perSubstep(PARAMS.headStiffness, substeps);
    for (let i = 0; i < HEAD_N; i++) {
      const j = BODY_N + i;
      const gx = cs * this.headQx[i] - sn * this.headQy[i] + cx;
      const gy = sn * this.headQx[i] + cs * this.headQy[i] + cy;
      this.x[j] += (gx - this.x[j]) * k;
      this.y[j] += (gy - this.y[j]) * k;
    }
    this.headX = cx;
    this.headY = cy;
    this.headRot = th;
  }

  /** 輪郭の辺長を [edgeMin, edgeMax] の範囲に保つ（伸びるが千切れない） */
  private solveEdges(substeps: number) {
    const k = perSubstep(PARAMS.edgeStiffness, substeps);
    for (let i = 0; i < BODY_N; i++) {
      const j = (i + 1) % BODY_N;
      const dx = this.x[j] - this.x[i];
      const dy = this.y[j] - this.y[i];
      const len = Math.hypot(dx, dy) || 1e-6;
      const r = this.restEdge[i];
      let target = len;
      if (len < r * PARAMS.edgeMin) target = r * PARAMS.edgeMin;
      else if (len > r * PARAMS.edgeMax) target = r * PARAMS.edgeMax;
      else {
        // 範囲内でも弱く静止長へ（輪郭の点の偏りを防ぐ）
        target = len + (r - len) * 0.15;
      }
      const diff = ((len - target) / len) * 0.5 * k;
      this.x[i] += dx * diff;
      this.y[i] += dy * diff;
      this.x[j] -= dx * diff;
      this.y[j] -= dy * diff;
    }
  }

  private solveNeck(substeps: number) {
    const k = perSubstep(PARAMS.neckStiffness, substeps);
    for (const [h, b, rest] of this.neck) {
      const dx = this.x[b] - this.x[h];
      const dy = this.y[b] - this.y[h];
      const len = Math.hypot(dx, dy) || 1e-6;
      const lo = rest * 0.7;
      const hi = rest * 1.3 + 2;
      let target = len;
      if (len < lo) target = lo;
      else if (len > hi) target = hi;
      else continue;
      const diff = ((len - target) / len) * 0.5 * k;
      this.x[h] += dx * diff;
      this.y[h] += dy * diff;
      this.x[b] -= dx * diff;
      this.y[b] -= dy * diff;
    }
  }

  /** 胴体の面積（2Dの体積）保存。潰れたら横に広がる */
  private solveArea(substeps: number) {
    const area = polyArea(this.x, this.y, 0, BODY_N) * this.bodySign;
    // 押されていると少しだけ縮める（ぎゅっ）
    const pressure = this.pressure;
    const target = this.restArea * (1 - PARAMS.compressibility * pressure);
    this.areaRatio = area / this.restArea;
    // 裏返っている（面積が負）ときは面積保存を掛けない。掛けると裏返ったまま膨らんでしまう
    if (area <= 0) return;
    const C = area - target;
    if (Math.abs(C) < 1e-3) return;
    // 勾配: dA/dx_i = 0.5 * (y_{i+1} - y_{i-1}), dA/dy_i = 0.5 * (x_{i-1} - x_{i+1})
    let sum = 0;
    const gx = gradX;
    const gy = gradY;
    for (let i = 0; i < BODY_N; i++) {
      const n = (i + 1) % BODY_N;
      const p = (i + BODY_N - 1) % BODY_N;
      gx[i] = 0.5 * (this.y[n] - this.y[p]) * this.bodySign;
      gy[i] = 0.5 * (this.x[p] - this.x[n]) * this.bodySign;
      sum += gx[i] * gx[i] + gy[i] * gy[i];
    }
    if (sum < 1e-9) return;
    const k = perSubstep(PARAMS.volume, substeps);
    const lambda = (-C / sum) * k;
    for (let i = 0; i < BODY_N; i++) {
      this.x[i] += lambda * gx[i];
      this.y[i] += lambda * gy[i];
    }
  }

  /** 速度更新＋反発・摩擦 */
  updateVelocity(dt: number) {
    const e = PARAMS.restitution;
    for (let i = 0; i < N; i++) {
      const vpx = this.vx[i];
      const vpy = this.vy[i];
      let vx = (this.x[i] - this.px[i]) / dt;
      let vy = (this.y[i] - this.py[i]) / dt;
      const nx = this.cnx[i];
      const ny = this.cny[i];
      const nl = Math.hypot(nx, ny);
      if (nl > 1e-6) {
        const ux = nx / nl;
        const uy = ny / nl;
        // 反発: 衝突前の法線速度を反転
        const vpn = vpx * ux + vpy * uy;
        if (vpn < -60) {
          const target = -e * vpn;
          const cur = vx * ux + vy * uy;
          if (cur < target) {
            vx += (target - cur) * ux;
            vy += (target - cur) * uy;
          }
        }
      }
      this.vx[i] = vx;
      this.vy[i] = vy;
    }
  }

  /** 尻尾（見た目用の紐）。全身の回転に追従しつつ揺れる */
  updateTail(dt: number, gravity: number) {
    const cs = Math.cos(this.rot);
    const sn = Math.sin(this.rot);
    // 根元は胴体の輪郭点に固定
    const ax = this.x[this.tailAnchor];
    const ay = this.y[this.tailAnchor];
    const ox = ax - (cs * this.tqx[0] - sn * this.tqy[0]);
    const oy = ay - (sn * this.tqx[0] + cs * this.tqy[0]);
    const damp = Math.exp(-2.5 * dt);
    for (let i = 1; i < TAIL_N; i++) {
      const vx = (this.tx[i] - this.tpx[i]) * damp;
      const vy = (this.ty[i] - this.tpy[i]) * damp;
      this.tpx[i] = this.tx[i];
      this.tpy[i] = this.ty[i];
      this.tx[i] += vx;
      this.ty[i] += vy + gravity * 0.15 * dt * dt;
      // 静止形へ弱く戻す（先ほど自由）
      const gx = ox + cs * this.tqx[i] - sn * this.tqy[i];
      const gy = oy + sn * this.tqx[i] + cs * this.tqy[i];
      const k = 0.12 * (1 - (i / TAIL_N) * 0.5);
      this.tx[i] += (gx - this.tx[i]) * k;
      this.ty[i] += (gy - this.ty[i]) * k;
    }
    this.tx[0] = this.tpx[0] = ax;
    this.ty[0] = this.tpy[0] = ay;
    for (let it = 0; it < 2; it++) {
      for (let i = 1; i < TAIL_N; i++) {
        const dx = this.tx[i] - this.tx[i - 1];
        const dy = this.ty[i] - this.ty[i - 1];
        const len = Math.hypot(dx, dy) || 1e-6;
        const diff = (len - this.tailSeg) / len;
        if (i === 1) {
          this.tx[i] -= dx * diff;
          this.ty[i] -= dy * diff;
        } else {
          this.tx[i] -= dx * diff * 0.5;
          this.ty[i] -= dy * diff * 0.5;
          this.tx[i - 1] += dx * diff * 0.5;
          this.ty[i - 1] += dy * diff * 0.5;
        }
      }
    }
  }
}

const gradX = new Float64Array(BODY_N);
const gradY = new Float64Array(BODY_N);

/** 符号付き面積（y下向き座標で時計回りが正） */
export function polyArea(xs: Float64Array, ys: Float64Array, start: number, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = start + i;
    const b = start + ((i + 1) % n);
    s += xs[a] * ys[b] - xs[b] * ys[a];
  }
  return s / 2;
}

export function pointInPoly(xs: Float64Array, ys: Float64Array, start: number, n: number, x: number, y: number): boolean {
  let inside = false;
  for (let k = 0; k < n; k++) {
    const a = start + k;
    const b = start + ((k + 1) % n);
    if (ys[a] > y !== ys[b] > y && x < ((xs[b] - xs[a]) * (y - ys[a])) / (ys[b] - ys[a]) + xs[a]) inside = !inside;
  }
  return inside;
}
