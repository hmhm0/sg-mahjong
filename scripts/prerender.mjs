import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const baseHtmlPath = path.join(distDir, 'index.html');
const siteUrl = 'https://sgmahjong.app';
async function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const text = await readFile(filePath, 'utf8');
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const idx = line.indexOf('=');
        return [line.slice(0, idx), line.slice(idx + 1)];
      }),
  );
}

const env = {
  ...(await loadEnvFile(path.join(rootDir, '.env'))),
  ...(await loadEnvFile(path.join(rootDir, '.env.local'))),
};

const googleVerification = process.env.VITE_GOOGLE_SITE_VERIFICATION || env.VITE_GOOGLE_SITE_VERIFICATION || '';

const publicAssets = {
  css: [],
  scripts: [],
  icons: [],
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pageShell({
  title,
  description,
  keywords,
  canonical,
  robots,
  body,
  pathName,
}) {
  const ogImage = `${siteUrl}/og-image.svg`;
  const currentUrl = `${siteUrl}${canonical}`;
  const meta = `
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="keywords" content="${escapeHtml(keywords)}" />
    <meta name="author" content="Singapore Mahjong" />
    <meta name="robots" content="${escapeHtml(robots)}" />
    <meta name="googlebot" content="${escapeHtml(robots)}" />
    <meta name="theme-color" content="#0f3d2e" />
    <link rel="canonical" href="${currentUrl}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Singapore Mahjong" />
    <meta property="og:url" content="${currentUrl}" />
    <meta property="og:image" content="${ogImage}" />
    <meta property="og:image:alt" content="Singapore Mahjong game table and title card" />
    <meta property="og:locale" content="en_SG" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${ogImage}" />
    ${googleVerification ? `<meta name="google-site-verification" content="${escapeHtml(googleVerification)}" />` : ''}
  `.trim();

  const jsonLd = `
    <script type="application/ld+json">
    ${JSON.stringify([
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'Singapore Mahjong',
        url: siteUrl,
        description: 'Play Singapore Mahjong online with Fei jokers, tai scoring, single-player bots, and multiplayer rooms.',
        inLanguage: 'en-SG',
      },
      {
        '@context': 'https://schema.org',
        '@type': 'VideoGame',
        name: 'Singapore Mahjong',
        url: currentUrl,
        description,
        applicationCategory: 'Game',
        genre: ['Mahjong', 'Strategy', 'Board Game'],
        operatingSystem: 'Web browser',
        playMode: ['SinglePlayer', 'MultiPlayer'],
        image: ogImage,
      },
    ])}
    </script>
  `.trim();

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${meta}
    ${publicAssets.icons.join('\n    ')}
    ${publicAssets.css.join('\n    ')}
  </head>
  <body>
    <div id="root">${body}</div>
    ${jsonLd}
    ${publicAssets.scripts.join('\n    ')}
  </body>
</html>
`;
}

function homeBody() {
  return `
    <main>
      <section>
        <h1>Singapore Mahjong</h1>
        <p>Play Singapore Mahjong online with Fei jokers, tai scoring, single-player bots, and multiplayer rooms.</p>
        <p>Practice against 3 AI opponents or host a room for friends on the same ruleset.</p>
        <p>Keywords: Singapore Mahjong, SG Mahjong, Fei joker, tai scoring, multiplayer mahjong, mahjong tutorial.</p>
      </section>
      <section>
        <h2>Game Modes</h2>
        <ul>
          <li>Single-player against 3 AI opponents</li>
          <li>Host a multiplayer room and share a room code</li>
          <li>Join an existing room with a custom player name</li>
        </ul>
      </section>
    </main>
  `;
}

function rulesBody() {
  return `
    <main>
      <h1>Rules Reference - Singapore Mahjong</h1>
      <p>Reference the Singapore Mahjong rules, special hands, call priority, Fei rules, and tai scoring patterns.</p>
      <h2>Highlights</h2>
      <ul>
        <li>Fei jokers for hand completion</li>
        <li>Tai scoring with limit hands</li>
        <li>Dealer rotation and call priority</li>
        <li>Ping Hu, Pong Pong Hu, Big Three Dragons, Da Xi Si, and more</li>
      </ul>
    </main>
  `;
}

function tutorialBody() {
  return `
    <main>
      <h1>How to Play - Singapore Mahjong</h1>
      <p>Learn how to play Singapore Mahjong online with Fei jokers, tai scoring, winds, melds, and winning hands.</p>
      <h2>What you learn</h2>
      <ul>
        <li>Tiles, winds, dragons, flowers, seasons, and Fei</li>
        <li>Drawing, discarding, calling, and self-draw wins</li>
        <li>How tai scoring works in the local ruleset</li>
      </ul>
    </main>
  `;
}

function tempBody(title, description) {
  return `
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(description)}</p>
      <p>This page is part of the Singapore Mahjong multiplayer flow and is marked noindex so it does not compete in search results.</p>
    </main>
  `;
}

async function readAssetTags() {
  const html = await readFile(baseHtmlPath, 'utf8');
  publicAssets.css = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*>/g)].map((m) => m[0]);
  publicAssets.icons = [...html.matchAll(/<link[^>]*rel="icon"[^>]*>/g)].map((m) => m[0]);
  publicAssets.scripts = [...html.matchAll(/<script[^>]*type="module"[^>]*><\/script>/g)].map((m) => m[0]);
}

async function writePage(relPath, html) {
  const fullPath = path.join(distDir, relPath, 'index.html');
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, html, 'utf8');
}

await readAssetTags();

await writePage(
  'rules',
  pageShell({
    title: 'Rules Reference - Singapore Mahjong',
    description: 'Reference the Singapore Mahjong rules, special hands, call priority, Fei rules, and tai scoring patterns.',
    keywords: 'Singapore Mahjong, SG Mahjong, mahjong singapore, Singapore mahjong rules, special hands, call priority, tai scoring, Fei joker',
    canonical: '/rules/',
    robots: 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1',
    body: rulesBody(),
    pathName: '/rules/',
  }),
);

await writePage(
  'tutorial',
  pageShell({
    title: 'How to Play - Singapore Mahjong',
    description: 'Learn how to play Singapore Mahjong online with Fei jokers, tai scoring, winds, melds, and winning hands.',
    keywords: 'Singapore Mahjong, SG Mahjong, mahjong tutorial, Fei joker, tai scoring, winning hands, winds, melds',
    canonical: '/tutorial/',
    robots: 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1',
    body: tutorialBody(),
    pathName: '/tutorial/',
  }),
);

await writePage(
  'host',
  pageShell({
    title: 'Host Multiplayer Room - Singapore Mahjong',
    description: 'Host a Singapore Mahjong multiplayer room, share the room code, and start a match with friends.',
    keywords: 'Singapore Mahjong, host mahjong room, multiplayer mahjong room, room code, Singapore mahjong multiplayer',
    canonical: '/host/',
    robots: 'noindex,nofollow,noarchive',
    body: tempBody('Host Multiplayer Room - Singapore Mahjong', 'Create a Singapore Mahjong multiplayer room, share the room code, and start a match with friends.'),
    pathName: '/host/',
  }),
);

await writePage(
  'join',
  pageShell({
    title: 'Join Multiplayer Room - Singapore Mahjong',
    description: 'Join an existing Singapore Mahjong multiplayer room using the room code and custom player name.',
    keywords: 'Singapore Mahjong, join mahjong room, Singapore mahjong multiplayer, room code, custom player name',
    canonical: '/join/',
    robots: 'noindex,nofollow,noarchive',
    body: tempBody('Join Multiplayer Room - Singapore Mahjong', 'Join an existing Singapore Mahjong multiplayer room using the room code and custom player name.'),
    pathName: '/join/',
  }),
);

console.log('Prerendered route pages written to dist/.');
