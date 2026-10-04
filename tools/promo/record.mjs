// 告知動画（縦 1080x1920 / 30fps / H.264 + AAC）を作る。
//   1. インストール済みの Chrome をヘッドレスで開き、ゲームを1コマずつ進めてスクリーンショットを撮る
//   2. ゲーム中に鳴った音を OfflineAudioContext で WAV に書き出す
//   3. ffmpeg で MP4 にまとめる
//
// 使い方: 開発サーバ（npm run dev）を起動した状態で
//   node tools/promo/record.mjs [URL]
// 出力: promo/nekoneko-promo.mp4（と表紙画像 promo/nekoneko-promo-cover.jpg）
//   別の場所に出すとき: PROMO_OUT_DIR=/path/to/dir node tools/promo/record.mjs

import { chromium } from 'playwright-core';
import ffmpegPath from 'ffmpeg-static';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const url = process.argv[2] ?? 'http://localhost:5179/';
// 出力先は環境変数 PROMO_OUT_DIR で変えられる（動画はリポジトリとは別に管理するため）
const outDir = process.env.PROMO_OUT_DIR ?? join(root, 'promo');
const frameDir = join(outDir, 'frames');
const FPS = 30;
const MAX_SECONDS = 60;

// 撮影用の見た目（ゲーム画面を少し小さく上寄りに置き、字幕を重ねる）。
// ショート動画アプリは画面の下と右にボタンや説明文が重なるので、大事なものは中央に置く。
const css = `
*, *::before, *::after { animation: none !important; transition: none !important; }
html, body { background-color: #ffe4cf !important; }
body {
  background-image:
    radial-gradient(rgba(255,255,255,.65) 6px, transparent 7px),
    radial-gradient(rgba(255,255,255,.65) 6px, transparent 7px);
  background-size: 60px 60px;
  background-position: 0 0, 30px 30px;
}
#stage {
  position: fixed !important; left: 67px !important; top: 112px !important;
  width: 406px !important; height: 722px !important; aspect-ratio: auto !important;
  border-radius: 24px; box-shadow: 0 10px 34px rgba(120,70,40,.28);
}
#tools, #btn-sound { display: none !important; }
body.endcard #title { display: none !important; }
#promo { position: fixed; inset: 0; pointer-events: none; z-index: 1000;
  font-family: 'M PLUS Rounded 1c', 'Hiragino Maru Gothic ProN', sans-serif; }
#promo .cap { position: absolute; text-align: center; font-weight: 900; font-size: 44px; line-height: 1.15;
  color: #fff; -webkit-text-stroke: 9px #5a3a24; paint-order: stroke fill; white-space: nowrap;
  filter: drop-shadow(0 4px 0 rgba(90,58,36,.35)); display: none; }
#promo .cap .hl { color: #ffd04a; }
#promo .sfx { font-size: 52px; color: #ff7a59; -webkit-text-stroke: 9px #fff;
  filter: drop-shadow(0 3px 0 rgba(160,60,30,.45)); }
#promo .sfx.big { font-size: 64px; }
#promo .toplogo { position: absolute; top: 62px; left: 0; right: 0; text-align: center; font-weight: 900;
  font-size: 26px; color: #fff; -webkit-text-stroke: 6px #7a5236; paint-order: stroke fill; letter-spacing: .06em; }
#promo .ff { position: absolute; top: 128px; right: 84px; font-weight: 900; font-size: 17px; color: #fff;
  background: rgba(90,58,36,.78); padding: 4px 11px; border-radius: 999px; }
#promo .flash { position: absolute; inset: 0; background: #fff; opacity: 0; }
#promo .endlogo { line-height: 1; }
#promo .endlogo .logo1 { display: block; font-size: 86px; -webkit-text-stroke: 14px #7a5236; }
#promo .endlogo .logo2 { display: block; font-size: 38px; color: #8a6448; -webkit-text-stroke: 0; letter-spacing: .3em;
  padding-left: .3em; margin-top: 10px; }
#promo .endsub { font-size: 31px; -webkit-text-stroke: 8px #5a3a24; }
#promo .endurl { font-size: 25px; color: #fff; -webkit-text-stroke: 0; background: linear-gradient(#ffa95e, #ff7a59);
  padding: 10px 24px; border-radius: 999px; box-shadow: 0 5px 0 #d9603f; filter: none; }
#promo .endtag { font-size: 25px; color: #8a6448; -webkit-text-stroke: 7px #fff; filter: none; }
#promo .sfx.soft { font-size: 38px; color: #8a6448; -webkit-text-stroke: 8px #fff; }
`;

rmSync(frameDir, { recursive: true, force: true });
mkdirSync(frameDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('pageerror', (e) => console.error('[page error]', e.message));
await page.goto(url, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: css });
await page.addScriptTag({ content: readFileSync(join(here, 'scenario.js'), 'utf8') });
await page.evaluate(() => window.promo.prepare());

let n = 0;
const t0 = Date.now();
for (; n < MAX_SECONDS * FPS; n++) {
  const cont = await page.evaluate((i) => window.promo.frame(i), n);
  await page.screenshot({ path: join(frameDir, `f${String(n).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
  if (n % 30 === 0) process.stdout.write(`\r撮影中 ${(n / FPS).toFixed(0)}秒`);
  if (!cont) {
    n++;
    break;
  }
}
const duration = n / FPS;
console.log(`\r撮影完了: ${n}コマ（${duration.toFixed(1)}秒） ${((Date.now() - t0) / 1000).toFixed(0)}秒かかった`);

// 音
const wavB64 = await page.evaluate((d) => window.__game.renderAudioWav(d), duration);
const wavPath = join(outDir, 'audio.wav');
writeFileSync(wavPath, Buffer.from(wavB64, 'base64'));
await browser.close();

// MP4（スマホのショート動画向け: H.264 / yuv420p / AAC / faststart）
const mp4 = join(outDir, 'nekoneko-promo.mp4');
execFileSync(
  ffmpegPath,
  [
    '-y', '-loglevel', 'error',
    '-framerate', String(FPS), '-i', join(frameDir, 'f%05d.jpg'),
    '-i', wavPath,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1',
    // 音量をショート動画の一般的な大きさ（-14 LUFS）にそろえる
    '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '44100',
    '-shortest', '-movflags', '+faststart',
    mp4,
  ],
  { stdio: 'inherit' },
);
// 表紙（最後の場面＝ロゴとURL）
const cover = join(outDir, 'nekoneko-promo-cover.jpg');
execFileSync(ffmpegPath, ['-y', '-loglevel', 'error', '-sseof', '-1.2', '-i', mp4, '-frames:v', '1', '-q:v', '2', cover], { stdio: 'inherit' });
console.log('出力:', mp4);
console.log('表紙:', cover);
