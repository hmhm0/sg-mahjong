type EnvMap = {
  VITE_POSTHOG_KEY?: string;
  VITE_POSTHOG_HOST?: string;
};

const runtimeEnv = ((globalThis as any).__SGMAHJONG_ENV__ || {}) as EnvMap;
const nodeEnv = ((globalThis as any).process?.env || {}) as EnvMap;
const POSTHOG_KEY = runtimeEnv.VITE_POSTHOG_KEY || nodeEnv.VITE_POSTHOG_KEY;
const POSTHOG_HOST = runtimeEnv.VITE_POSTHOG_HOST || nodeEnv.VITE_POSTHOG_HOST || 'https://us.i.posthog.com';

let initialized = false;
let posthogModule: any = null;

async function loadPosthog() {
  if (posthogModule) return posthogModule;
  const mod = await import('posthog-js/dist/module.slim');
  posthogModule = mod.default;
  return posthogModule;
}

export function initAnalytics() {
  if (initialized || !POSTHOG_KEY) return;
  void loadPosthog().then((posthog) => {
    if (!posthog || initialized) return;
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      defaults: '2026-05-30',
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
    });
    initialized = true;
  });
}

export function track(event: string, properties?: Record<string, unknown>) {
  if (!POSTHOG_KEY || !initialized) return;
  posthogModule?.capture(event, properties);
}

export function trackPageView(path: string, title: string) {
  if (!POSTHOG_KEY || !initialized) return;
  posthogModule?.capture('$pageview', {
    $current_url: window.location.href,
    path,
    title,
  });
}
