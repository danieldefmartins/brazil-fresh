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
const port = 9300 + process.pid % 300;
const output = new URL('./.visual-checkpoints/', import.meta.url);
await mkdir(output, { recursive: true });

const browser = spawn(chrome, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/brazil-fresh-visuals-${process.pid}`, 'about:blank'
], { stdio: 'ignore' });

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function targets() {
  for (let i = 0; i < 40; i++) {
    try { return await (await fetch(`http://127.0.0.1:${port}/json`)).json(); }
    catch { await delay(100); }
  }
  throw new Error('Chrome debugging endpoint did not start');
}

const targetList = await targets();
const { webSocketDebuggerUrl } = targetList.find(target => target.type === 'page' && target.url === 'about:blank')
  || targetList.find(target => target.type === 'page')
  || targetList[0];
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
const allViewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 }
];
const viewports = process.env.VIEWPORT
  ? allViewports.filter(viewport => viewport.name === process.env.VIEWPORT)
  : allViewports;

for (const viewport of viewports) {
  await call('Emulation.setDeviceMetricsOverride', {
    width: viewport.width, height: viewport.height,
    screenWidth: viewport.width, screenHeight: viewport.height,
    deviceScaleFactor: 1, mobile: viewport.name === 'mobile'
  });
  await call('Page.navigate', { url });
  await delay(1800);
  // Some headless Chrome builds report viewport-relative CSS units as 1px
  // under device emulation. Pin the test height explicitly; production CSS
  // continues to use svh for real browsers.
  await call('Runtime.evaluate', {
    expression: `document.querySelector('#journeyFilm').style.height='${viewport.height * (viewport.name === 'mobile' ? 12.5 : 14)}px';ScrollTrigger.refresh()`
  });
  await delay(250);
  const result = await call('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('.hero,#journeyFilm')].map(el=>({
      id:el.id||'hero',top:el.offsetTop,height:el.offsetHeight
    }))`, returnByValue: true
  });
  const scenes = result.result.result.value;
  console.log(`${viewport.name}: ${scenes.map(scene => `${scene.id}@${scene.top}+${scene.height}`).join(', ')}`);
  let current = 0;
  for (const scene of scenes) {
    const checkpoints = scene.id === 'hero'
      ? [['action', .5], ['handoff', .92]]
      : [['loading', .08], ['services', .25], ['rotation', .40], ['road', .53], ['port', .66], ['contact', .70], ['ship', .77], ['clouds', .88], ['plane', .96]];
    for (const [label, fraction] of checkpoints) {
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
