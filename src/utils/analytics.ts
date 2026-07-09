import posthog from 'posthog-js/dist/module.slim';

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://us.i.posthog.com';

let initialized = false;

export function initAnalytics() {
  if (initialized || !POSTHOG_KEY) return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    defaults: '2026-05-30',
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
  });
  initialized = true;
}

export function track(event: string, properties?: Record<string, unknown>) {
  if (!POSTHOG_KEY || !initialized) return;
  posthog.capture(event, properties);
}

export function trackPageView(path: string, title: string) {
  if (!POSTHOG_KEY || !initialized) return;
  posthog.capture('$pageview', {
    $current_url: window.location.href,
    path,
    title,
  });
}
