// 消去ルール: 同じ色の猫が物理的に4匹以上つながったら、
//   間（元の猫らしい形へ戻る）→「にゃー！」→ ジャンプして容器の外へ出ていく。
// グリッドは使わず、World.stablePairs（一定時間以上触れ続けている猫ペア）の連結成分で判定する。
//
// 連鎖: 猫が出ていった結果（上の猫が落ちてきて）新しく揃ったら連鎖 +1。
//   - 前のグループが揃ったあとにプレイヤーが落とした猫を含むグループは、連鎖ではなく 1 からやり直し
//   - 同じフレームで同時に揃ったグループは同じ連鎖段数
//   - 演出が終わってから chainWindow 秒、新しく揃わなければ連鎖は終わり

import type { Cat } from './cat';
import type { ContainerShape } from './container';
import { PARAMS } from './params';

export interface ExitGroup {
  cats: Cat[];
  t: number;
  phase: 'ready' | 'meow' | 'jump';
  /** 何連鎖目か（1 = 連鎖なし） */
  chain: number;
}

export interface MatchEvents {
  /** 新しく揃ったグループ */
  matched: ExitGroup[];
  /** 鳴いたグループ */
  meowed: ExitGroup[];
  /** ジャンプしたグループ */
  jumped: ExitGroup[];
}

export class MatchSystem {
  groups: ExitGroup[] = [];
  /** 現在の連鎖数（0 = 連鎖中ではない） */
  chain = 0;
  /** 最後に揃った時刻 */
  private lastMatchTime = -Infinity;
  /** 最後に演出が動いた時刻（揃った・跳んだ） */
  private lastActivity = -Infinity;

  /** 同色のつながりを探す（Union-Find） */
  findGroups(cats: Cat[], pairs: [Cat, Cat][]): Cat[][] {
    const parent = new Map<number, number>();
    const byId = new Map<number, Cat>();
    const eligible = (c: Cat) => c.exitPhase === 'none' && !c.ghost && !c.held;
    for (const c of cats) {
      if (!eligible(c)) continue;
      parent.set(c.id, c.id);
      byId.set(c.id, c);
    }
    const find = (a: number): number => {
      let r = a;
      while (parent.get(r) !== r) r = parent.get(r)!;
      // 経路圧縮
      let x = a;
      while (parent.get(x) !== r) {
        const nx = parent.get(x)!;
        parent.set(x, r);
        x = nx;
      }
      return r;
    };
    for (const [a, b] of pairs) {
      if (!parent.has(a.id) || !parent.has(b.id)) continue;
      if (a.color.id !== b.color.id) continue;
      const ra = find(a.id);
      const rb = find(b.id);
      if (ra !== rb) parent.set(ra, rb);
    }
    const comps = new Map<number, Cat[]>();
    for (const id of parent.keys()) {
      const r = find(id);
      if (!comps.has(r)) comps.set(r, []);
      comps.get(r)!.push(byId.get(id)!);
    }
    // 全員が転がり終わって止まっているグループだけ（1匹でもまだ動いていれば待つ）
    return [...comps.values()].filter((g) => g.length >= PARAMS.matchCount && g.every((c) => c.restTime >= PARAMS.matchSettleTime));
  }

  update(cats: Cat[], pairs: [Cat, Cat][], container: ContainerShape, dt: number, now: number): MatchEvents {
    const ev: MatchEvents = { matched: [], meowed: [], jumped: [] };

    // 連鎖の受付が終わったか
    if (this.chain > 0 && !this.busy && now - this.lastActivity > PARAMS.chainWindow) this.chain = 0;

    // 新しいグループ
    const found = this.findGroups(cats, pairs);
    if (found.length > 0) {
      // 連鎖の続きか: 連鎖の受付中で、前に揃ったあとにプレイヤーが落とした猫を含まない
      const inWindow = this.chain > 0 && (this.busy || now - this.lastActivity <= PARAMS.chainWindow);
      const continuing = inWindow && found.some((g) => g.every((c) => c.releasedAt < this.lastMatchTime));
      this.chain = continuing ? this.chain + 1 : 1;
      this.lastMatchTime = now;
      this.lastActivity = now;
      for (const g of found) {
        for (const c of g) {
          c.exitPhase = 'ready';
          c.exitT = 0;
        }
        const group: ExitGroup = { cats: g, t: 0, phase: 'ready', chain: this.chain };
        this.groups.push(group);
        ev.matched.push(group);
      }
    }

    // 進行中のグループ
    for (const g of this.groups) {
      g.t += dt;
      for (const c of g.cats) {
        c.exitT += dt;
        // 間のあいだに、元の猫らしい形へぎゅっと戻る
        c.stiffBoost = Math.min(1, c.stiffBoost + dt / PARAMS.exitReadyTime);
      }
      if (g.phase === 'ready' && g.t >= PARAMS.exitReadyTime) {
        g.phase = 'meow';
        for (const c of g.cats) {
          c.exitPhase = 'meow';
          c.exitT = 0;
        }
        ev.meowed.push(g);
      } else if (g.phase === 'meow' && g.t >= PARAMS.exitReadyTime + PARAMS.exitMeowTime) {
        g.phase = 'jump';
        g.cats.forEach((c, i) => jumpOut(c, container, i));
        this.lastActivity = now;
        ev.jumped.push(g);
      }
    }
    // 全員が画面外に消えたグループは終わり
    const alive = new Set(cats.map((c) => c.id));
    this.groups = this.groups.filter((g) => g.cats.some((c) => alive.has(c.id)));
    return ev;
  }

  /** 演出中の猫がいるか（連鎖の判定などに使う） */
  get busy() {
    return this.groups.length > 0;
  }
}

/** 猫が自分で容器の外へジャンプする。近い方の縁を越えて外側へ着地する放物線 */
function jumpOut(cat: Cat, container: ContainerShape, index: number) {
  const o = container.outline;
  const left = Math.min(o[0].x, o[o.length - 1].x);
  const right = Math.max(o[0].x, o[o.length - 1].x);
  const rimY = Math.min(o[0].y, o[o.length - 1].y);
  const mid = (left + right) / 2;
  const side = cat.cx < mid ? -1 : 1;
  const g = PARAMS.gravity;
  // 縁より少し上を頂点に（並んでいる猫は少しずつ高さを変える）
  const apexY = rimY - 60 - (index % 3) * 18;
  const h = Math.max(cat.cy - apexY, 40);
  const vy = -Math.sqrt(2 * g * h);
  const tApex = -vy / g;
  const targetX = (side < 0 ? left : right) + side * (40 + (index % 2) * 25);
  const vx = (targetX - cat.cx) / tApex;
  for (let i = 0; i < cat.vx.length; i++) {
    cat.vx[i] = vx;
    cat.vy[i] = vy;
  }
  cat.exitPhase = 'jump';
  cat.exitT = 0;
  cat.ghost = true;
}
