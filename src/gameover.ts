// ゲームオーバー判定。
// 物理挙動で一瞬はみ出すのは許す。猫の体の一定割合以上がラインより上にある状態で、
// 止まったまま一定時間たったらゲームオーバー。

import { BODY_N, type Cat } from './cat';
import type { ContainerShape } from './container';
import { PARAMS } from './params';

export interface GameOverState {
  /** 危険度 0..1（一番危ない猫の overTime / gameOverTime）。予告演出に使う */
  danger: number;
  /** ゲームオーバーになった */
  over: boolean;
}

/** 猫の胴体の物理点のうち、ラインより上にある割合 */
function aboveRatio(cat: Cat, lineY: number): number {
  let n = 0;
  for (let i = 0; i < BODY_N; i++) if (cat.y[i] < lineY) n++;
  return n / BODY_N;
}

function avgSpeed(cat: Cat): number {
  let s = 0;
  for (let i = 0; i < BODY_N; i++) s += Math.hypot(cat.vx[i], cat.vy[i]);
  return s / BODY_N;
}

/**
 * paused: 揃った猫が出ていく演出中など。カウントを止める（減らしもしない）。
 * 空きができて下がれば助かるので、その間に負けにしない。
 */
export function updateGameOver(cats: Cat[], container: ContainerShape, dt: number, paused: boolean): GameOverState {
  let worst = 0;
  for (const c of cats) {
    if (c.ghost || c.held || c.exitPhase !== 'none') {
      c.overTime = 0;
      continue;
    }
    const over = aboveRatio(c, container.gameOverY) >= PARAMS.gameOverRatio;
    if (!over) {
      c.overTime = 0;
      continue;
    }
    if (paused) {
      // 何もしない（カウントを止める）
    } else if (c.airTime === 0 && avgSpeed(c) < PARAMS.gameOverSpeed) {
      // ラインを越えたまま、何かの上に乗って止まっている（新しい猫に押されて少し揺れる程度は「止まっている」とみなす）
      c.overTime += dt;
    } else {
      // 飛んでいる・跳ねている最中は、ゆっくり戻す（一瞬の飛び出しでは負けない）
      c.overTime = Math.max(0, c.overTime - dt * 0.5);
    }
    worst = Math.max(worst, c.overTime);
  }
  return { danger: Math.min(1, worst / PARAMS.gameOverTime), over: worst >= PARAMS.gameOverTime };
}
