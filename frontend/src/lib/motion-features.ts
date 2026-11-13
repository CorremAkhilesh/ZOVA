/**
 * Motion's animation features, loaded after the app starts (see App.tsx's LazyMotion): the `m`
 * components render at once and start animating when these arrive. Keeps ~30 KB gzip out of the
 * main bundle. `domAnimation` covers animate/exit/variants/gestures; layout animations would need
 * `domMax`.
 */
export { domAnimation as default } from 'motion/react';
