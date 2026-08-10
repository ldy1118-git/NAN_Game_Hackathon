/**
 * 캡처 수집 서버 — 브라우저가 보낸 PNG 를 파일로 떨군다.
 * 문서 스크린샷을 뽑을 때만 쓰는 도구라 의존성 없이 http 모듈만 쓴다.
 */
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(process.argv[2] ?? 'docs/shots');
const PORT = Number(process.argv[3] ?? 7788);

mkdirSync(OUT, { recursive: true });

let saved = 0;

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(404).end();
    return;
  }

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    try {
      const { name, png } = JSON.parse(Buffer.concat(chunks).toString());
      const data = png.replace(/^data:image\/png;base64,/, '');
      const file = resolve(OUT, `${name}.png`);
      writeFileSync(file, Buffer.from(data, 'base64'));
      saved += 1;
      console.log(`[${saved}] ${name}.png  ${(data.length * 0.75 / 1024).toFixed(0)}KB`);
      res.writeHead(200).end('ok');
    } catch (err) {
      console.error('실패:', err.message);
      res.writeHead(400).end(String(err));
    }
  });
}).listen(PORT, () => console.log(`수집 중 → ${OUT} (포트 ${PORT})`));
