import { defineConfig } from 'vite';

export default defineConfig({
  // 상대 경로로 빌드해 dist/index.html 을 서버 없이 그냥 열어도 돌아가게 한다.
  base: './',
  server: {
    port: 5173,
    open: false,
    // 원격 서버에서 개발하므로 0.0.0.0 에 바인딩한다.
    // 기본값(127.0.0.1)이면 SSH 포트포워딩 없이는 다른 PC에서 접속할 수 없다.
    host: true,
  },
});
