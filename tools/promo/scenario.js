// 告知動画の台本（ブラウザのページ内で実行される）。
// record.mjs から読み込まれ、window.promo.frame() を1コマごとに呼ばれる。
// ゲーム本体の開発用フック（window.__game）を使って、ゲームを1コマずつ進める。
/* eslint-disable */
(() => {
  const FPS = 30;
  const g = window.__game;
  const W = 360;
  const H = 640;
  const COLOR = { white: 0, black: 1, orange: 2, gray: 3, calico: 4 };

  // ---- 乱数を固定（毎回同じ動画になるように） ----
  let seed = 20261003;
  Math.random = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // ---- 字幕などを重ねるレイヤー ----
  const layer = document.createElement('div');
  layer.id = 'promo';
  document.body.appendChild(layer);
  const stage = document.getElementById('stage');

  /** ゲームの論理座標 → 画面(CSS px)座標 */
  function toScreen(x, y) {
    const r = stage.getBoundingClientRect();
    return [r.left + (x / W) * r.width, r.top + (y / H) * r.height];
  }

  // 字幕・効果文字
  const items = [];
  function caption(text, opts = {}) {
    const el = document.createElement('div');
    el.className = 'cap ' + (opts.cls || '');
    el.innerHTML = text;
    layer.appendChild(el);
    const it = { el, start: tNow, end: opts.end ?? Infinity, x: opts.x ?? null, y: opts.y ?? 260, rot: opts.rot ?? 0, size: opts.size ?? 1 };
    items.push(it);
    return it;
  }
  function sfx(text, x, y, opts = {}) {
    return caption(text, { cls: 'sfx ' + (opts.cls || ''), x, y, rot: opts.rot ?? -8, size: opts.size ?? 1, end: tNow + (opts.dur ?? 0.9) });
  }
  function endItem(it, after = 0) {
    if (it) it.end = Math.min(it.end, tNow + after);
  }
  function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }
  function updateItems() {
    for (const it of items) {
      const age = tNow - it.start;
      const left = it.end - tNow;
      if (left <= 0) {
        it.el.style.display = 'none';
        continue;
      }
      it.el.style.display = 'block';
      const k = easeOutBack(Math.min(age / 0.2, 1));
      const out = Math.min(1, left / 0.12);
      const wob = Math.sin(age * 18) * Math.max(0, 1 - age * 3) * 4;
      it.el.style.opacity = String(out);
      if (it.x === null) {
        it.el.style.left = '0px';
        it.el.style.right = '0px';
      } else {
        it.el.style.left = it.x + 'px';
      }
      it.el.style.top = it.y + 'px';
      const tx = it.x === null ? '0' : '-50%';
      it.el.style.transform = `translate(${tx}, -50%) rotate(${it.rot + wob}deg) scale(${k * it.size})`;
    }
  }

  // 画面上部の小さなロゴ（ずっと表示）
  const topLogo = document.createElement('div');
  topLogo.className = 'toplogo';
  topLogo.innerHTML = 'ねこねこゲーム';
  layer.appendChild(topLogo);
  // 早送りの表示
  const ff = document.createElement('div');
  ff.className = 'ff';
  ff.textContent = '▶▶ 3倍速';
  ff.style.display = 'none';
  layer.appendChild(ff);
  // 白フラッシュ（場面転換）
  const flash = document.createElement('div');
  flash.className = 'flash';
  layer.appendChild(flash);
  let flashT = -1;

  // ---- 便利関数 ----
  function place(color, x, y) {
    g.drop(x, color);
    const c = g.world.cats[g.world.cats.length - 1];
    const dx = x - c.cx;
    const dy = y - c.cy;
    for (let i = 0; i < 30; i++) {
      c.x[i] += dx;
      c.y[i] += dy;
      c.px[i] = c.x[i];
      c.py[i] = c.y[i];
      c.vx[i] = 0;
      c.vy[i] = 0;
    }
    for (let i = 0; i < 7; i++) {
      c.tx[i] += dx;
      c.ty[i] += dy;
      c.tpx[i] = c.tx[i];
      c.tpy[i] = c.ty[i];
    }
    c.cx = x;
    c.cy = y;
    c.headX += dx;
    c.headY += dy;
    return c;
  }
  function clearWorld(nextColor) {
    if (nextColor !== undefined) g.nextColorIndex = nextColor;
    document.getElementById('btn-clear').click(); // resetGame（手は新しい猫を運んでくる）
  }
  function setZoom(scale, ox, oy) {
    stage.style.transformOrigin = `${ox}% ${oy}%`;
    stage.style.transform = scale === 1 ? '' : `scale(${scale})`;
  }
  const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
  const smooth = (t) => {
    t = Math.max(0, Math.min(1, t));
    return t * t * (3 - 2 * t);
  };

  // ---- 台本 ----
  let tNow = 0;
  let scene = 'intro';
  let sceneT = 0; // 場面の開始時刻
  const S = {}; // 場面ごとの状態
  let done = false;

  function startScene(name) {
    scene = name;
    sceneT = tNow;
    for (const k of Object.keys(S)) delete S[k];
  }

  /** 撮影前の準備（この間の音は記録しない） */
  async function prepare() {
    g.setExternalControl(true);
    g.audioRec.on = true;
    window.dispatchEvent(new Event('resize'));
    g.setMaxDpr(4);
    await document.fonts.load('900 40px "M PLUS Rounded 1c"');
    await document.fonts.ready;
    // プレイ開始。最初に手が運んでくる猫は茶トラ
    g.nextColorIndex = COLOR.orange;
    document.getElementById('btn-start').click();
    // 容器の底に猫を何匹か置いておく（着地で「むにっ」と潰れるように）
    for (const [c, x] of [
      [COLOR.white, 95],
      [COLOR.gray, 160],
      [COLOR.calico, 225],
      [COLOR.black, 280],
    ]) {
      g.drop(x, c);
      g.step(20, 0);
    }
    g.queueColors([COLOR.gray, COLOR.white, COLOR.calico, COLOR.black, COLOR.gray, COLOR.orange, COLOR.calico, COLOR.white, COLOR.black, COLOR.orange, COLOR.gray, COLOR.calico, COLOR.white, COLOR.black, COLOR.orange]);
    g.hand.targetX = 180;
    g.step(200, 0);
    // 記録し直す（ここから先の音だけを使う）
    g.audioRec.events.length = 0;
    g.audioRec.t = 0;
    g.audioRec.events.push({ name: 'startBgm', args: [], t: 0 });
    startScene('intro');
  }

  /** 1コマ進める。戻り値 false で撮影終了 */
  function frame(i) {
    tNow = i / FPS;
    g.audioRec.t = tNow;
    const st = tNow - sceneT;
    let updates = 2; // 等速（1/60秒 × 2 = 1/30秒）
    const world = g.world;

    if (scene === 'intro') {
      // 0〜3秒: 首根っこをつままれた猫をアップで
      const z = lerp(2.3, 1, smooth((st - 2.4) / 0.7));
      setZoom(z, 50, 17);
      g.hand.targetX = 180 + Math.sin(st * 2.2) * 14; // ゆらゆら
      // 字幕は猫の下の空いているところに（猫の体にかぶらないように）
      if (!S.c1 && st > 0.25) S.c1 = caption('首根っこを', { y: 655, end: tNow + 2.7 });
      if (!S.c2 && st > 1.15) S.c2 = caption('<span class="hl">つまみます。</span>', { y: 730, size: 1.15, end: tNow + 1.8 });
      if (!S.c3 && st > 1.9) {
        // だらんと伸びた体に「だらーん」
        const held = g.world.held;
        const [x, y] = toScreen(held ? held.cx : 180, held ? held.cy + 30 : 180);
        S.c3 = sfx('だら〜ん', x + 120, y, { cls: 'soft', rot: 10, size: 1, dur: 1.1 });
      }
      if (st > 3.0) startScene('drop');
    } else if (scene === 'drop') {
      // 3〜5.6秒: ぽいっ → むにっ
      setZoom(1, 50, 50);
      if (!S.released) {
        g.hand.targetX = 150;
        if (st > 0.45 && g.hand.state === 'hold') {
          S.cat = world.held;
          g.hand.requestRelease();
        }
        if (S.cat && !world.held) {
          S.released = true;
          const [x, y] = toScreen(g.hand.x, g.hand.y + 40);
          sfx('ぽいっ', x + 70, y, { rot: -10, dur: 0.8 });
          S.airSeen = false;
        }
      } else if (!S.landed) {
        if (S.cat.airTime > 0.05) S.airSeen = true;
        if (S.airSeen && S.cat.airTime === 0) {
          S.landed = true;
          const [x, y] = toScreen(S.cat.cx, S.cat.cy);
          sfx('むにっ', x, y - 60, { cls: 'big', rot: 6, size: 1.35, dur: 1.4 });
          S.landT = tNow;
        }
      } else if (tNow - S.landT > 1.3) {
        startScene('montage');
      }
    } else if (scene === 'montage') {
      // 3倍速でどんどん詰め込む
      updates = 6;
      ff.style.display = 'block';
      if (g.hand.state === 'hold' && !S.waiting) {
        S.waiting = true;
        g.hand.targetX = 75 + Math.random() * 210;
        g.hand.requestRelease();
      }
      if (g.hand.state !== 'hold') S.waiting = false;
      if (!S.c1 && st > 0.15) S.c1 = caption('まだ入る。', { y: 300, end: tNow + 1.55, rot: -3 });
      if (!S.c2 && st > 1.75) S.c2 = caption('まだまだ入る。', { y: 300, end: tNow + 1.6, rot: 2, size: 1.12 });
      if (!S.c3 && st > 3.45) S.c3 = caption('<span class="hl">どう見ても入る。</span>', { y: 300, end: tNow + 1.9, rot: -2, size: 1.25 });
      if (st > 5.5) {
        ff.style.display = 'none';
        startScene('matchPrep');
      }
    } else if (scene === 'matchPrep') {
      // 場面転換（白フラッシュの間に、揃う直前の山を作る）
      flashT = tNow;
      clearWorld(COLOR.white);
      g.PARAMS.gameOverTime = 99;
      place(COLOR.orange, 82, 570);
      place(COLOR.orange, 148, 570);
      place(COLOR.orange, 214, 570);
      place(COLOR.white, 280, 570);
      place(COLOR.white, 280, 515);
      place(COLOR.white, 214, 515);
      place(COLOR.orange, 247, 455);
      place(COLOR.gray, 82, 515);
      g.step(150, 0);
      g.queueColors([COLOR.calico, COLOR.black]);
      startScene('match');
      updates = 0;
    } else if (scene === 'match') {
      // 白い猫で4匹そろえる → にゃー！ → 自分で帰る → 連鎖
      if (!S.dropped && g.hand.state === 'hold') {
        g.hand.targetX = 150;
        g.hand.requestRelease();
        S.dropped = true;
      }
      if (!S.c1 && st > 0.3) S.c1 = caption('同じ色が4匹そろうと…', { y: 280, end: Infinity });
      const exiting = world.cats.filter((c) => c.exitPhase !== 'none');
      const meowing = exiting.some((c) => c.exitPhase === 'meow');
      if (!S.c2 && meowing) {
        endItem(S.c1);
        S.c2 = caption('<span class="hl">自分で帰る。</span>', { y: 290, size: 1.3, end: Infinity });
      }
      if (S.c2 && !S.jumpedT && exiting.some((c) => c.exitPhase === 'jump')) S.jumpedT = tNow;
      if (S.jumpedT && !S.c2ended && tNow - S.jumpedT > 1.0) {
        endItem(S.c2);
        S.c2ended = true;
      }
      if (!S.chainT && g.match.chain >= 2) {
        S.chainT = tNow;
        endItem(S.c2);
        S.c3 = caption('連鎖もする。', { y: 290, size: 1.15, end: tNow + 2.4, rot: -3 });
      }
      if (S.chainT && tNow - S.chainT > 2.6) startScene('overPrep');
      if (st > 9) startScene('overPrep'); // 念のため
    } else if (scene === 'overPrep') {
      flashT = tNow;
      g.PARAMS.matchCount = 99; // この場面では消えない（あふれさせる）
      g.PARAMS.gameOverTime = 1.0;
      clearWorld(COLOR.calico);
      g.rain(60);
      startScene('over');
      updates = 0;
    } else if (scene === 'over') {
      updates = 6;
      ff.style.display = g.state === 'play' ? 'block' : 'none';
      if (!S.c1 && st > 0.2) S.c1 = caption('調子に乗って詰めると', { y: 280, end: Infinity });
      if (g.state === 'over') {
        updates = 2;
        if (!S.overT) {
          S.overT = tNow;
          endItem(S.c1);
          S.c2 = caption('<span class="hl">こうなる。</span>', { y: 205, size: 1.3, end: Infinity, rot: -4 });
        }
        if (tNow - S.overT > 2.3) startScene('endPrep');
      }
      if (st > 12) startScene('endPrep');
    } else if (scene === 'endPrep') {
      flashT = tNow;
      for (const it of items) endItem(it);
      g.PARAMS.matchCount = 4;
      g.PARAMS.gameOverTime = 1.5;
      document.getElementById('btn-to-title').click(); // タイトル画面（背景で猫が落ちてくる）
      document.body.classList.add('endcard');
      g.step(240, 0);
      startScene('end');
      updates = 0;
    } else if (scene === 'end') {
      if (!S.a) S.a = caption('<span class="logo1">ねこねこ</span><span class="logo2">ゲーム</span>', { cls: 'endlogo', y: 255, end: Infinity });
      if (!S.b && st > 0.5) S.b = caption('ブラウザで今すぐ遊べる！', { cls: 'endsub', y: 382, end: Infinity });
      if (!S.c && st > 0.9) S.c = caption('game.chozo.net/nekoneko', { cls: 'endurl', x: 270, y: 445, end: Infinity });
      if (!S.d && st > 1.3) S.d = caption('#ねこねこゲーム', { cls: 'endtag', x: 270, y: 505, end: Infinity });
      if (st > 4.2) done = true;
    }

    if (updates > 0) g.step(updates, tNow * 1000);
    else g.step(0, tNow * 1000);
    // 白フラッシュ
    const fa = flashT < 0 ? 0 : Math.max(0, 1 - (tNow - flashT) / 0.25);
    flash.style.opacity = String(fa);
    updateItems();
    return !done;
  }

  window.promo = { prepare, frame, get duration() { return tNow; } };
})();
