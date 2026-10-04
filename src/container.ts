// 容器（ステージ）の定義。
// 容器は「太さのある線分（カプセル）の集合」として表現する。
// 段ボール・ボウル・金魚鉢などは、輪郭を線分列で近似した ContainerShape を追加するだけで差し替えられる。

export interface Vec {
  x: number;
  y: number;
}

export interface Wall {
  a: Vec;
  b: Vec;
  thickness: number; // 壁の太さ（半径として扱う）
}

export interface ContainerShape {
  name: string;
  walls: Wall[];
  /** 描画用の輪郭（開いたポリライン） */
  outline: Vec[];
  /** ゲームオーバーライン（y座標） */
  gameOverY: number;
  /** 猫を落とせるx範囲 */
  dropMinX: number;
  dropMaxX: number;
  /** 猫を持っている高さ */
  dropY: number;
}

/** 開いたポリラインから壁を生成するヘルパー */
export function wallsFromPolyline(points: Vec[], thickness: number): Wall[] {
  const walls: Wall[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    walls.push({ a: points[i], b: points[i + 1], thickness });
  }
  return walls;
}

/** 透明な四角い箱（プロトタイプ用の基本ステージ） */
export function createBox(cx: number, bottom: number, width: number, height: number): ContainerShape {
  const l = cx - width / 2;
  const r = cx + width / 2;
  const top = bottom - height;
  const outline = [
    { x: l, y: top },
    { x: l, y: bottom },
    { x: r, y: bottom },
    { x: r, y: top },
  ];
  return {
    name: 'box',
    walls: wallsFromPolyline(outline, 5),
    outline,
    gameOverY: top + 18,
    dropMinX: l + 42,
    dropMaxX: r - 42,
    dropY: top - 70,
  };
}
