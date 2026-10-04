// 猫の毛色定義。色の追加・変更はここだけで行う。
// id はゲームロジック（同色判定）で使うキー。見た目は他のフィールドで決まる。

export interface CatColor {
  id: string;
  name: string;
  body: string; // 毛のベース色
  highlight: string; // 光が当たる背中側
  shade: string; // 影になるお腹側
  outline: string; // 輪郭線
  stripe: string; // 縞模様（pattern: 'tabby' のとき）
  white: string; // 胸元・口まわり・足先の白い毛
  earInner: string; // 耳の内側
  iris: string; // 目の色
  nose: string; // 鼻
  faceLine: string; // 口・閉じた目などの線
  whisker: string; // ひげ
  pattern: 'solid' | 'tabby' | 'calico';
  /** 三毛のぶち（pattern: 'calico' のとき）: a=茶、b=黒 */
  patchA?: string;
  patchB?: string;
  bib: boolean; // 胸元・口まわりが白いか
  whitePaws: boolean; // 足先が白いか（靴下）
}

export const CAT_COLORS: CatColor[] = [
  {
    id: 'white',
    name: '白',
    body: '#fffaf3',
    highlight: '#ffffff',
    shade: '#ebe1d4',
    outline: '#b5a797',
    stripe: '#e8dccd',
    white: '#ffffff',
    earInner: '#f8b8c2',
    iris: '#7ab6ea',
    nose: '#f39aab',
    faceLine: '#6d5a52',
    whisker: 'rgba(120, 100, 90, 0.45)',
    pattern: 'solid',
    bib: false,
    whitePaws: true,
  },
  {
    id: 'black',
    name: '黒',
    body: '#34313d',
    highlight: '#5a5670',
    shade: '#1f1d25',
    outline: '#16141b',
    stripe: '#2a2832',
    white: '#4a4656',
    earInner: '#6b5262',
    iris: '#f1c94a',
    nose: '#5b4652',
    faceLine: '#0e0d12',
    whisker: 'rgba(235, 235, 245, 0.6)',
    pattern: 'solid',
    bib: false,
    whitePaws: false,
  },
  {
    id: 'orange',
    name: '茶トラ',
    body: '#f6ae62',
    highlight: '#ffd29c',
    shade: '#de8a45',
    outline: '#b26a2e',
    stripe: '#dc7b34',
    white: '#fff7ec',
    earInner: '#f7b4a2',
    iris: '#9ac25a',
    nose: '#ee8f93',
    faceLine: '#7a4a2a',
    whisker: 'rgba(120, 80, 50, 0.45)',
    pattern: 'tabby',
    bib: true,
    whitePaws: true,
  },
  {
    id: 'gray',
    name: 'サバトラ',
    body: '#a9b2bc',
    highlight: '#d2d9e0',
    shade: '#838d98',
    outline: '#5c6570',
    stripe: '#66707b',
    white: '#f6f7f8',
    earInner: '#eab3bb',
    iris: '#78bf86',
    nose: '#e795a3',
    faceLine: '#3f464e',
    whisker: 'rgba(70, 80, 90, 0.45)',
    pattern: 'tabby',
    bib: true,
    whitePaws: true,
  },
  {
    id: 'calico',
    name: '三毛',
    body: '#fffaf2',
    highlight: '#ffffff',
    shade: '#ece0d0',
    outline: '#a68f78',
    stripe: '#e89a4c',
    white: '#ffffff',
    earInner: '#f8b4bd',
    iris: '#d9a63a',
    nose: '#f3a0ad',
    faceLine: '#5e4a40',
    whisker: 'rgba(110, 90, 80, 0.45)',
    pattern: 'calico',
    bib: false,
    whitePaws: true,
    patchA: '#ec9a48',
    patchB: '#3b3540',
  },
];

export function randomColor(): CatColor {
  return CAT_COLORS[Math.floor(Math.random() * CAT_COLORS.length)];
}

/**
 * 手で運ぶ猫の柄を順番に決める。
 * 同じ柄は maxRun 回連続まで。続いたら、次はその柄以外からランダムに選ぶ。
 */
export class ColorPicker {
  private lastId = '';
  private run = 0;

  constructor(private maxRun: () => number) {}

  next(): CatColor {
    const pool = this.run >= this.maxRun() ? CAT_COLORS.filter((c) => c.id !== this.lastId) : CAT_COLORS;
    const c = pool[Math.floor(Math.random() * pool.length)];
    this.run = c.id === this.lastId ? this.run + 1 : 1;
    this.lastId = c.id;
    return c;
  }
}
