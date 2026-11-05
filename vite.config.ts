import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages 배포 시 저장소 이름이 경로가 되므로 BASE_PATH 환경변수로 조정한다.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  server: { proxy: { '/api': 'http://127.0.0.1:3001' } },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: '복불복 - 내기 게임 모음',
        short_name: '복불복',
        description: '사다리, 룰렛, 구슬 레이스 등 10가지 내기 게임',
        lang: 'ko',
        theme_color: '#14162b',
        background_color: '#14162b',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//, /^\/health/],
        // 글꼴은 수십 개 조각으로 나뉘어 있어 미리 받지 않고, 쓰는 글자 조각만 받아 저장한다
        globPatterns: ['**/*.{js,css,html,svg}'],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'font',
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 200 } },
          },
        ],
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 120000,
  },
});
