#!/usr/bin/env node
/**
 * Capture deterministic journey frames with only Node and an installed Chrome.
 * Usage: node visual-checkpoints.mjs [URL]
 * Output: .visual-checkpoints/{desktop,mobile}-*.jpg
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { platform } from 'node:os';

const url = process.argv[2] || 'http://localhost:3457';
const chrome = process.env.CHROME_PATH || (platform() === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : 'google-chrome');
const port = 9337;
const output = new URL('./.visual-checkpoints/', import.meta.url);
await mkdir(output, { recursive: true });

const browser = spawn(chrome, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${port}`, '--user-data-dir=/tmp/brazil-fresh-visuals', 'about:blank'
], { stdio: 'ignore' });

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function targets() {
  for (let i = 0; i < 40; i++) {
    try { return await (await fetch(`http://127.0.0.1:${port}/json`)).json(); }
    catch { await delay(100); }
  }
  throw new Error('Chrome debugging endpoint did not start');
}

const [{ webSocketDebuggerUrl }] = await targets();
const ws = new WebSocket(webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0;
const pending = new Map();
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
};
const call = (method, params = {}) => new Promise(resolve => {
  const id = ++sequence;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});

await call('Page.enable');
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 }
];

for (const viewport of viewports) {
  await call('Emulation.setDeviceMetricsOverride', {
    width: viewport.width, height: viewport.height,
    screenWidth: viewport.width, screenHeight: viewport.height,
    deviceScaleFactor: 1, mobile: viewport.name === 'mobile'
  });
  await call('Page.navigate', { url });
  await delay(1800);
  const result = await call('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('.hero,.scene')].map(el=>({
      id:el.id||'hero',top:el.offsetTop,height:el.offsetHeight
    }))`, returnByValue: true
  });
  const scenes = result.result.result.value;
  let current = 0;
  for (const scene of scenes) {
    for (const [label, fraction] of [['action', .5], ['handoff', .92]]) {
      const target = Math.round(scene.top + scene.height * fraction - viewport.height / 2);
      for (; current < target; current += 240) {
        await call('Runtime.evaluate', { expression: `scrollTo(0,${Math.min(current + 240, target)})` });
        await delay(5);
      }
      await delay(160);
      const shot = await call('Page.captureScreenshot', { format: 'jpeg', quality: 82, captureBeyondViewport: false });
      await writeFile(new URL(`${viewport.name}-${scene.id}-${label}.jpg`, output), Buffer.from(shot.result.data, 'base64'));
    }
  }
}

ws.close();
browser.kill('SIGTERM');
console.log(`Visual checkpoints written to ${output.pathname}`);
