// 音（Web Audio で合成。音声ファイル不要）
//   master ─┬─ bgmGain（BGM）
//           └─ sfxGain（効果音）
// ブラウザの自動再生制限があるため、最初のタップ/クリックで unlockAudio() を呼んでから鳴らす。

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let bgmGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

const MUTE_KEY = 'nekoneko-game:muted';
let muted = loadMuted();

const VOL = {
  master: 0.8,
  bgm: 0.22,
  sfx: 0.7,
};

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isMuted() {
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  } catch {
    // 保存できなくても動作は続ける
  }
  if (ac && master) master.gain.setTargetAtTime(m ? 0 : VOL.master, ac.currentTime, 0.03);
}

export function unlockAudio() {
  try {
    if (!ac) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ac = new Ctor();
      master = ac.createGain();
      master.gain.value = muted ? 0 : VOL.master;
      master.connect(ac.destination);
      bgmGain = ac.createGain();
      bgmGain.gain.value = 0;
      bgmGain.connect(master);
      sfxGain = ac.createGain();
      sfxGain.gain.value = VOL.sfx;
      sfxGain.connect(master);
      // 効果音用のホワイトノイズ
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') void ac.resume();
  } catch {
    ac = null;
  }
}

// タブが裏に回ったら音を止める
document.addEventListener('visibilitychange', () => {
  if (!ac) return;
  if (document.hidden) void ac.suspend();
  else void ac.resume();
});

function ready(): boolean {
  return !!ac && (ac.state === 'running' || offline) && !!sfxGain;
}

// ---- 告知動画用: 鳴らした音の記録と、あとからまとめて書き出す（OfflineAudioContext） ----
/** on のあいだは音を鳴らさず、{名前, 引数, 時刻 t} を記録するだけにする */
export const audioRec = { on: false, t: 0, events: [] as { name: string; args: unknown[]; t: number }[] };
function rec(name: string, args: IArguments): boolean {
  if (!audioRec.on) return false;
  audioRec.events.push({ name, args: Array.from(args), t: audioRec.t });
  return true;
}
/** 書き出し中か（OfflineAudioContext は running にならないので ready 判定を緩める） */
let offline = false;
/** 書き出し中、各音を鳴らす基準の時刻（記録した時刻） */
let timeBase = 0;
function now(): number {
  return (ac?.currentTime ?? 0) + timeBase;
}

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** 単音（エンベロープ付き） */
function tone(opts: {
  freq: number;
  to?: number; // 終わりの周波数（ピッチベンド）
  type?: OscillatorType;
  t?: number; // 開始（相対秒）
  dur: number;
  gain: number;
  attack?: number;
  dest?: AudioNode;
}) {
  if (!ac || !sfxGain) return;
  const t0 = now() + (opts.t ?? 0);
  const osc = ac.createOscillator();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.freq, t0);
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + opts.dur);
  const env = ac.createGain();
  const a = opts.attack ?? 0.005;
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(opts.gain, t0 + a);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  osc.connect(env).connect(opts.dest ?? sfxGain);
  osc.start(t0);
  osc.stop(t0 + opts.dur + 0.05);
}

/** ノイズのバースト（フィルタ付き） */
function noise(opts: { t?: number; dur: number; gain: number; freq: number; q?: number; type?: BiquadFilterType }) {
  if (!ac || !sfxGain || !noiseBuf) return;
  const t0 = now() + (opts.t ?? 0);
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  const f = ac.createBiquadFilter();
  f.type = opts.type ?? 'lowpass';
  f.frequency.value = opts.freq;
  f.Q.value = opts.q ?? 0.7;
  const env = ac.createGain();
  env.gain.setValueAtTime(opts.gain, t0);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  src.connect(f).connect(env).connect(sfxGain);
  src.start(t0);
  src.stop(t0 + opts.dur + 0.02);
}

// ================= 効果音 =================

/**
 * 「にゃー」: のこぎり波の声帯音を、母音の移り変わり（ニ→ャ→ー）に合わせて動くフォルマントで整形する。
 * pitch は 1 が標準。delay 秒後に鳴る。
 */
export function playMeow(pitch = 1, delay = 0, volume = 1) {
  if (rec('playMeow', arguments)) return;
  if (!ready() || !ac || !sfxGain) return;
  const t0 = now() + delay;
  const dur = 0.55;
  const f0 = 520 * pitch;

  const osc = ac.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(f0 * 0.85, t0);
  osc.frequency.linearRampToValueAtTime(f0 * 1.25, t0 + 0.12);
  osc.frequency.linearRampToValueAtTime(f0 * 1.1, t0 + 0.3);
  osc.frequency.exponentialRampToValueAtTime(f0 * 0.7, t0 + dur);
  const lfo = ac.createOscillator();
  lfo.frequency.value = 7;
  const lfoGain = ac.createGain();
  lfoGain.gain.value = f0 * 0.02;
  lfo.connect(lfoGain).connect(osc.frequency);

  const f1 = ac.createBiquadFilter();
  f1.type = 'bandpass';
  f1.Q.value = 6;
  f1.frequency.setValueAtTime(900, t0);
  f1.frequency.linearRampToValueAtTime(1300, t0 + 0.15);
  f1.frequency.linearRampToValueAtTime(700, t0 + dur);
  const f2 = ac.createBiquadFilter();
  f2.type = 'bandpass';
  f2.Q.value = 8;
  f2.frequency.setValueAtTime(2600, t0);
  f2.frequency.linearRampToValueAtTime(1800, t0 + 0.2);
  f2.frequency.linearRampToValueAtTime(1100, t0 + dur);

  const env = ac.createGain();
  const peak = 0.5 * volume;
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(peak, t0 + 0.04);
  env.gain.setValueAtTime(peak, t0 + 0.25);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  const mix = ac.createGain();
  osc.connect(f1).connect(mix);
  osc.connect(f2).connect(mix);
  mix.connect(env).connect(sfxGain);

  osc.start(t0);
  lfo.start(t0);
  osc.stop(t0 + dur + 0.05);
  lfo.stop(t0 + dur + 0.05);
}

/** ジャンプの「ぴょん」 */
export function playHop(delay = 0) {
  if (rec('playHop', arguments)) return;
  if (!ready()) return;
  tone({ freq: 380, to: 1100, t: delay, dur: 0.16, gain: 0.22, attack: 0.01 });
}

/** 手が猫を運んできた「ぽっ」 */
export function playPick() {
  if (rec('playPick', arguments)) return;
  if (!ready()) return;
  tone({ freq: 520, to: 820, dur: 0.09, gain: 0.12 });
}

/** 離した「ぴゅっ」 */
export function playDrop() {
  if (rec('playDrop', arguments)) return;
  if (!ready()) return;
  tone({ freq: 980, to: 520, dur: 0.14, gain: 0.13, type: 'triangle' });
}

let lastLand = 0;
/** 着地の「ぽふっ」。strength 0..1 */
export function playLand(strength: number) {
  if (rec('playLand', arguments)) return;
  if (!ready() || !ac) return;
  // 一度にたくさん鳴りすぎないように
  if (now() - lastLand < 0.06) return;
  lastLand = now();
  const s = Math.min(1, Math.max(0.15, strength));
  tone({ freq: 170, to: 70, dur: 0.16, gain: 0.32 * s });
  noise({ dur: 0.12, gain: 0.12 * s, freq: 900 });
}

/** 4匹揃った「ぴこん！」 */
export function playMatch() {
  if (rec('playMatch', arguments)) return;
  if (!ready()) return;
  tone({ freq: mtof(88), dur: 0.12, gain: 0.13, type: 'triangle' });
  tone({ freq: mtof(95), t: 0.08, dur: 0.3, gain: 0.13, type: 'triangle' });
  tone({ freq: mtof(100), t: 0.08, dur: 0.3, gain: 0.05 });
}

/** 連鎖のアルペジオ（連鎖が進むほど高い） */
export function playChain(chain: number) {
  if (rec('playChain', arguments)) return;
  if (!ready()) return;
  const base = 72 + Math.min(chain - 2, 6) * 2;
  [0, 4, 7, 12, 16].forEach((d, i) => tone({ freq: mtof(base + d), t: i * 0.055, dur: 0.35, gain: 0.12, type: 'triangle' }));
}

/** 得点の「ちりん」 */
export function playScore() {
  if (rec('playScore', arguments)) return;
  if (!ready()) return;
  tone({ freq: mtof(91), dur: 0.35, gain: 0.08 });
  tone({ freq: mtof(96), t: 0.06, dur: 0.4, gain: 0.07 });
}

/** 危険の「ピッ」 */
export function playWarn() {
  if (rec('playWarn', arguments)) return;
  if (!ready()) return;
  tone({ freq: 880, dur: 0.08, gain: 0.07, type: 'square' });
}

/** ボタンの「ぽん」 */
export function playButton() {
  if (rec('playButton', arguments)) return;
  if (!ready()) return;
  tone({ freq: 660, to: 990, dur: 0.08, gain: 0.14, type: 'triangle' });
}

/** ゲームオーバーのジングル（下がっていく） */
export function playGameOver() {
  if (rec('playGameOver', arguments)) return;
  if (!ready()) return;
  [72, 67, 64, 60, 55].forEach((m, i) => tone({ freq: mtof(m), t: i * 0.18, dur: 0.5, gain: 0.14, type: 'triangle' }));
  playMeow(0.62, 1.0, 0.8);
}

/** 新記録のファンファーレ */
export function playRecord() {
  if (rec('playRecord', arguments)) return;
  if (!ready()) return;
  [72, 76, 79, 84].forEach((m, i) => tone({ freq: mtof(m), t: 1.6 + i * 0.1, dur: i === 3 ? 0.8 : 0.25, gain: 0.13, type: 'triangle' }));
  tone({ freq: mtof(88), t: 1.9, dur: 0.8, gain: 0.06 });
}

// ================= BGM =================
// オルゴール風のメロディ + ぽこぽこしたベース + 裏拍の小さなハイハット。
// C - Am - F - G の4小節 × 2パターン（8分音符単位）をループする。
// tempo は危険度に応じて少し速くなる（setBgmIntensity）。

const CHORDS: { bass: number; chord: number[] }[] = [
  { bass: 48, chord: [60, 64, 67] }, // C
  { bass: 45, chord: [57, 60, 64] }, // Am
  { bass: 41, chord: [53, 57, 60] }, // F
  { bass: 43, chord: [55, 59, 62] }, // G
];
const _ = null;
const MELODY: (number | null)[][] = [
  // パターンA
  [76, _, 79, _, 76, 74, 72, _],
  [69, _, 72, _, 76, _, 74, _],
  [77, _, 76, 74, 72, _, 69, _],
  [71, _, 74, _, 79, _, _, _],
  // パターンB
  [72, 74, 76, _, 79, _, 76, _],
  [81, _, 79, 76, 74, _, 72, _],
  [74, _, 77, _, 76, 74, 72, _],
  [74, _, 71, _, 72, _, _, _],
];

let bgmTimer: number | null = null;
let bgmStep = 0;
let bgmNext = 0;
let bgmIntensity = 0;
const BASE_BPM = 104;

/** 0..1。危ないほど BGM のテンポが上がる */
export function setBgmIntensity(v: number) {
  if (rec('setBgmIntensity', arguments)) return;
  bgmIntensity = Math.min(1, Math.max(0, v));
}

function scheduleNote(step: number, t: number, stepDur: number) {
  if (!ac || !bgmGain) return;
  const bar = Math.floor(step / 8) % MELODY.length;
  const pos = step % 8;
  const ch = CHORDS[bar % 4];
  const mel = MELODY[bar][pos];
  const play = (freq: number, type: OscillatorType, dur: number, gain: number, at = t) => {
    const osc = ac!.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const env = ac!.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(env).connect(bgmGain!);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  };
  // メロディ（オルゴール: 正弦波 + 2倍音）
  if (mel !== null) {
    play(mtof(mel), 'sine', 0.7, 0.32);
    play(mtof(mel + 12), 'sine', 0.25, 0.07);
  }
  // ベース（1拍目・3拍目）
  if (pos === 0 || pos === 4) play(mtof(ch.bass), 'triangle', stepDur * 1.6, 0.35);
  // 和音（2拍目・4拍目に短く）
  if (pos === 2 || pos === 6) for (const n of ch.chord) play(mtof(n + 12), 'triangle', 0.18, 0.06);
  // 裏拍のハイハット
  if (pos % 2 === 1 && noiseBuf) {
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const env = ac.createGain();
    env.gain.setValueAtTime(0.05, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    src.connect(f).connect(env).connect(bgmGain);
    src.start(t);
    src.stop(t + 0.06);
  }
}

export function startBgm() {
  if (rec('startBgm', arguments)) return;
  if (!ac || !bgmGain) return;
  if (bgmTimer !== null) return;
  bgmGain.gain.cancelScheduledValues(ac.currentTime);
  bgmGain.gain.setTargetAtTime(VOL.bgm, ac.currentTime, 0.3);
  bgmStep = 0;
  bgmNext = ac.currentTime + 0.1;
  bgmTimer = window.setInterval(() => {
    if (!ac || ac.state !== 'running') return;
    const bpm = BASE_BPM * (1 + 0.22 * bgmIntensity);
    const stepDur = 60 / bpm / 2; // 8分音符
    while (bgmNext < ac.currentTime + 0.15) {
      scheduleNote(bgmStep, bgmNext, stepDur);
      bgmNext += stepDur;
      bgmStep = (bgmStep + 1) % (MELODY.length * 8);
    }
  }, 25);
}

export function stopBgm(fade = 0.6) {
  if (rec('stopBgm', arguments)) return;
  if (bgmTimer !== null) {
    window.clearInterval(bgmTimer);
    bgmTimer = null;
  }
  if (ac && bgmGain) {
    bgmGain.gain.cancelScheduledValues(ac.currentTime);
    bgmGain.gain.setTargetAtTime(0, ac.currentTime, fade / 3);
  }
}

export function bgmPlaying() {
  return bgmTimer !== null;
}

/** 開発用: 音の状態 */
export function audioDebug() {
  return { state: ac?.state ?? 'none', bgm: bgmTimer !== null, muted, bgmGain: bgmGain?.gain.value ?? 0 };
}

/**
 * 記録した音（audioRec.events）を、OfflineAudioContext でまとめて書き出す。
 * BGM は startBgm〜stopBgm の区間に、記録した危険度（テンポ）に合わせて音符を並べる。
 */
export async function renderRecordedAudio(duration: number, sampleRate = 44100): Promise<AudioBuffer> {
  const events = audioRec.events.slice().sort((a, b) => a.t - b.t);
  const saved = { ac, master, bgmGain, sfxGain, noiseBuf };
  const off = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  audioRec.on = false;
  offline = true;
  ac = off as unknown as AudioContext;
  master = off.createGain();
  master.gain.value = VOL.master;
  master.connect(off.destination);
  bgmGain = off.createGain();
  bgmGain.gain.value = 0;
  bgmGain.connect(master);
  sfxGain = off.createGain();
  sfxGain.gain.value = VOL.sfx;
  sfxGain.connect(master);
  noiseBuf = off.createBuffer(1, sampleRate * 0.5, sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const fns: Record<string, (...a: never[]) => void> = {
    playMeow,
    playHop,
    playPick,
    playDrop,
    playLand,
    playMatch,
    playChain,
    playScore,
    playWarn,
    playButton,
    playGameOver,
    playRecord,
  };
  // 効果音
  lastLand = -1;
  for (const e of events) {
    const f = fns[e.name];
    if (!f) continue;
    timeBase = e.t;
    (f as (...a: unknown[]) => void)(...e.args);
  }
  timeBase = 0;
  // BGM
  const intensityAt = (t: number) => {
    let v = 0;
    for (const e of events) {
      if (e.t > t) break;
      if (e.name === 'setBgmIntensity') v = Number(e.args[0]) || 0;
    }
    return Math.min(1, Math.max(0, v));
  };
  let playing = false;
  let t = 0;
  let step = 0;
  const marks = events.filter((e) => e.name === 'startBgm' || e.name === 'stopBgm');
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    if (m.name === 'startBgm' && !playing) {
      playing = true;
      t = m.t + 0.1;
      step = 0;
      bgmGain.gain.setTargetAtTime(VOL.bgm, m.t, 0.3);
      const end = marks.slice(i + 1).find((x) => x.name === 'stopBgm')?.t ?? duration;
      while (t < end && t < duration) {
        const stepDur = 60 / (BASE_BPM * (1 + 0.22 * intensityAt(t))) / 2;
        scheduleNote(step, t, stepDur);
        t += stepDur;
        step = (step + 1) % (MELODY.length * 8);
      }
    } else if (m.name === 'stopBgm' && playing) {
      playing = false;
      const fade = Number(m.args[0] ?? 0.6) || 0.6;
      bgmGain.gain.setTargetAtTime(0, m.t, fade / 3);
    }
  }
  const buf = await off.startRendering();
  offline = false;
  ({ ac, master, bgmGain, sfxGain, noiseBuf } = saved);
  return buf;
}

/** AudioBuffer → 16bit PCM の WAV（base64） */
export function audioBufferToWavBase64(buf: AudioBuffer): string {
  const ch = buf.numberOfChannels;
  const len = buf.length;
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o: number, str: string) => {
    for (let i = 0; i < str.length; i++) data.setUint8(o + i, str.charCodeAt(i));
  };
  w(0, 'RIFF');
  data.setUint32(4, 36 + len * ch * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, ch, true);
  data.setUint32(24, buf.sampleRate, true);
  data.setUint32(28, buf.sampleRate * ch * 2, true);
  data.setUint16(32, ch * 2, true);
  data.setUint16(34, 16, true);
  w(36, 'data');
  data.setUint32(40, len * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  const bytes = new Uint8Array(data.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
