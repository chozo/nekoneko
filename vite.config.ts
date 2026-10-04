import { defineConfig } from 'vite';

// 公開 URL は game.chozo.net/nekoneko/ 。
// 相対パス (base: './') で出力し、Workers のアセット配信パスに合わせて dist/nekoneko/ に置く
export const PUBLIC_PATH = 'nekoneko';

export default defineConfig({
  base: './',
  server: { host: true },
  build: {
    outDir: `dist/${PUBLIC_PATH}`,
    emptyOutDir: true,
  },
});
