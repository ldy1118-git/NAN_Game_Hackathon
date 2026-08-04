import { App } from './core/App';
import { BootScene } from './scenes/BootScene';
import * as records from './core/records';

const canvas = document.getElementById('stage');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('#stage 캔버스를 찾을 수 없습니다');
}

const app = new App(canvas);
app.setScene(new BootScene());
app.start();

// 개발 중 콘솔에서 판정·박자 상태를 들여다보기 위한 통로. 빌드에는 포함되지 않는다.
if (import.meta.env.DEV) {
  (window as unknown as { __nan: App & { records: typeof records } }).__nan =
    Object.assign(app, { records });
}
