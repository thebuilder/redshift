import './style.css';
import { Game } from './game/Game';
import { loadCarAsset } from './render/CarAsset';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const boot = document.getElementById('boot')!;

function start() {
  const game = new Game(canvas);
  let last = performance.now();
  const loop = (now: number) => {
    const dt = (now - last) / 1000;
    last = now;
    game.tick(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  setTimeout(() => boot.classList.add('out'), 150);
}

// give the fonts a moment so canvas labels use them
const fontsReady = (document as any).fonts?.ready ?? Promise.resolve();
Promise.all([Promise.race([fontsReady, new Promise((r) => setTimeout(r, 1500))]), loadCarAsset()]).then(() => requestAnimationFrame(start));
