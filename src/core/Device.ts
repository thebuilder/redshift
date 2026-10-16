/** What kind of device we are on, and how hard we can push it. */

const mq = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;

/** a touch-first device (phone, tablet): primary pointer is coarse and cannot hover */
export const IS_TOUCH =
  typeof navigator !== 'undefined' && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window) && (mq('(pointer: coarse)') || mq('(hover: none)'));

/** small, battery-powered GPU: phones and small tablets */
export const IS_MOBILE =
  IS_TOUCH && typeof screen !== 'undefined' && Math.min(screen.width, screen.height) < 820;

export const QUALITY = IS_MOBILE
  ? { pixelRatio: 1.25, msaa: 2, shadowMap: 1024, smoke: 2600 }
  : IS_TOUCH
    ? { pixelRatio: 1.5, msaa: 4, shadowMap: 2048, smoke: 3400 }
    : { pixelRatio: 1.75, msaa: 4, shadowMap: 2048, smoke: 4200 };
