// 猫の柔らかさ・物理挙動の調整パラメータ。
// ここを書き換える（またはDebugパネルのスライダーで動かす）だけで「むにむに感」を調整できる。
// 剛性系の値は「1フレーム(1/60s)あたり」の値。サブステップ数を変えても体感が変わりにくいよう内部で換算する。

export const PARAMS = {
  // --- ワールド ---
  gravity: 1500, // px/s^2（論理解像度 360x640 基準）
  substeps: 8, // 1フレームあたりの物理サブステップ数。多いほど安定・重い
  maxSpeed: 1600, // 爆発防止の速度上限 px/s

  // --- 猫の柔らかさ（要求仕様の主要パラメータ） ---
  stiffness: 0.22, // 形状復元の強さ（全身のShape Matching）。低いほど隙間に流れ込む
  damping: 0.9, // 全体の速度減衰（/秒）。空気抵抗のようなもの
  internalDamping: 5, // 猫内部の揺れの減衰（/秒）。大きいほど「ぷるぷる」が早く収まる。重心の動きには効かない
  packedDamping: 20, // 他の猫に囲まれているときに追加される内部減衰（山の中のジッター対策）
  deformation: 0.85, // 全身の「伸び縮み」許容度 0=回転のみ(固い) 1=面積保存の伸縮を完全許容
  maxStretch: 2.0, // 伸縮の上限倍率（横に2倍・縦に1/2まで）。猫がスライム化しない安全弁
  restitution: 0.08, // 反発係数
  friction: 0.35, // 摩擦（0〜1）
  mass: 1.0, // 猫1匹の質量（相対値）

  // --- 形状維持の内部パラメータ ---
  volume: 0.92, // 体積（面積）保存の強さ。1に近いほど「潰れても体積は減らない」
  compressibility: 0.06, // 押されたときに一時的に縮める体積の割合（ぎゅっ感）
  edgeStiffness: 0.5, // 輪郭の隣接点間の距離拘束
  edgeMin: 0.55, // 輪郭辺の最小長（静止長に対する比）
  edgeMax: 1.7, // 輪郭辺の最大長（伸びる猫）
  headStiffness: 0.85, // 頭の剛性（頭と耳は形を保つ）
  neckStiffness: 0.6, // 頭と胴のつながり
  collisionRadius: 2.2, // 輪郭の厚み（px）

  // --- 立ち直り反射（猫は足から着地する） ---
  rightingGain: 9, // 傾き1radあたりの目標回転速度（/秒）
  rightingMaxSpin: 14, // 最大の回転速度（rad/秒）
  rightingRate: 18, // 目標の回転速度へ近づく速さ（/秒）
  landRollTime: 0.35, // 着地後もしばらく起き上がろうとする時間（秒）。山の中では働かない
  landRollStrength: 0.5, // 着地後の起き上がりの強さ（空中=1）

  // --- 出現ルール ---
  maxSameInRow: 3, // 手で運ぶ猫は、同じ柄がこの回数まで連続できる（超えそうなら別の柄にする）

  // --- 消去ルール ---
  matchCount: 4, // 同色が何匹つながったら消えるか
  matchContactTime: 0.25, // この秒数以上つながり続けている猫どうしだけを数える（一瞬かすっただけでは消えない）
  matchMargin: 3, // 輪郭どうしがこの距離(px)以内なら「つながっている」（見た目でぴったり触れているくらい）
  matchUseTail: false, // 尻尾が触れているだけでもつながりに数えるか
  matchSettleTime: 0.4, // 揃った猫が全員、この秒数以上止まっていたら判定する（着地後に転がり終わるのを待つ）
  settleSpeed: 30, // この速さ(px/s)未満なら「止まっている」
  exitReadyTime: 0.45, // 揃ってから鳴くまでの間（このあいだ元の猫らしい形へ戻る）
  exitMeowTime: 0.5, // 「にゃー！」と鳴いてからジャンプするまで
  chainWindow: 2.5, // 猫が出ていってから、この秒数のうちに新しく揃えば連鎖（上の猫が落ちて転がり終わるまでの猶予）

  // --- 計算の省略（スリープ） ---
  sleepAfter: 0.5, // 止まってからこの秒数たったら眠らせる（計算を止める）
  sleepSpeed: 10, // この速さ(px/s)未満なら眠ってよい
  wakeDepth: 0.6, // 起きている猫がこれ以上(px)めり込んできたら起こす
  wakeSpeed: 60, // 体全体がこの速さ(px/s)以上で動いている猫は、まわりの眠っている猫を起こす
  wakeLoadSpeed: 15, // 上に乗った猫がこの速さ(px/s)以上で動いていたら、下の眠っている猫を起こす（重みで潰れて詰まる）

  // --- ゲームオーバー ---
  gameOverRatio: 0.5, // 猫の体のこの割合以上がラインより上にあったら「はみ出している」
  gameOverTime: 1.5, // はみ出したまま、この秒数止まっていたらゲームオーバー
  gameOverSpeed: 90, // この速さ(px/s)未満なら「止まっている」とみなす（押されて揺れる程度は止まっている扱い）

  // --- 手 ---
  releaseSwing: 0.25, // 離したときに残す横方向の勢い（0=真下に落ちる 1=振り子の勢いのまま飛ぶ）

  // --- 見た目 ---
  catSize: 1.0, // 猫のサイズ倍率
  sizeVariance: 0.12, // 個体差（±）
  squishFace: 1.35, // この伸縮率を超えたら「むぎゅ顔」
};

export type Params = typeof PARAMS;

// Debugパネルに出すスライダー定義 [key, min, max, step]
export const PARAM_SLIDERS: [keyof Params, number, number, number][] = [
  ['stiffness', 0.01, 1, 0.01],
  ['deformation', 0, 1, 0.01],
  ['maxStretch', 1, 3, 0.05],
  ['damping', 0, 5, 0.05],
  ['internalDamping', 0, 30, 0.5],
  ['packedDamping', 0, 60, 1],
  ['volume', 0, 1, 0.01],
  ['compressibility', 0, 0.3, 0.01],
  ['friction', 0, 1, 0.01],
  ['restitution', 0, 0.8, 0.01],
  ['mass', 0.2, 3, 0.05],
  ['edgeStiffness', 0, 1, 0.01],
  ['headStiffness', 0, 1, 0.01],
  ['gravity', 200, 3000, 50],
  ['substeps', 1, 16, 1],
  ['matchMargin', 0, 10, 0.5],
  ['matchSettleTime', 0, 1.5, 0.05],
];

export const DEFAULT_PARAMS: Params = { ...PARAMS };

/** 1フレームあたりの剛性 k を、n サブステップ用に換算 */
export function perSubstep(k: number, n: number): number {
  const c = Math.min(Math.max(k, 0), 0.999);
  return 1 - Math.pow(1 - c, 1 / n);
}
