const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 4000);
const WS_PORT = Number(process.env.WS_PORT || 4001);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const ARTIFACTS_DIR = path.join(DATA_DIR, 'artifacts');

const ensureDir = (target) => fs.mkdirSync(target, { recursive: true });
ensureDir(DATA_DIR);
ensureDir(ARTIFACTS_DIR);

const defaultState = {
  user: {
    id: 'selfhost-user',
    username: 'selfhost',
    email: null,
    displayName: 'Self Hosted User',
    profileImageUrl: null,
    backgroundImageUrl: null,
    profileVisibility: 'PUBLIC',
    bio: 'Hydra self-host starter backend',
    workwondersJwt: 'selfhost',
    karma: 0,
    quirks: { backupsPerGameLimit: 50 },
    subscription: {
      id: 'selfhost-subscription',
      status: 'ACTIVE',
      plan: { id: 'selfhost-plan', name: 'Self Hosted' },
      expiresAt: '2099-01-01T00:00:00.000Z',
    },
  },
  games: [],
  artifacts: [],
  downloadSources: [],
  collections: [],
};

const loadState = () => {
  try {
    if (!fs.existsSync(STATE_PATH)) return { ...defaultState };
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    return { ...defaultState, ...JSON.parse(raw) };
  } catch {
    return { ...defaultState };
  }
};

let state = loadState();

const saveState = () => {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
};

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  const contentType = req.headers['content-type'] || '';

  if (!buffer.length) return undefined;
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(buffer.toString('utf8'));
    } catch {
      return {};
    }
  }

  return buffer;
};

const sendJson = (res, status, payload) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Hydra-If-Modified-Since',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  });
  res.end(JSON.stringify(payload));
};

const sendText = (res, status, payload, contentType = 'text/plain; charset=utf-8') => {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(payload);
};

const routeMatch = (pathname, pattern) => {
  const pathParts = pathname.split('/').filter(Boolean);
  const patParts = pattern.split('/').filter(Boolean);
  if (pathParts.length !== patParts.length) return null;

  const params = {};
  for (let i = 0; i < patParts.length; i += 1) {
    const pat = patParts[i];
    const value = pathParts[i];
    if (pat.startsWith(':')) {
      params[pat.slice(1)] = decodeURIComponent(value);
    } else if (pat !== value) {
      return null;
    }
  }

  return params;
};

const findOrCreateGame = (shop, objectId) => {
  let game = state.games.find((g) => g.shop === shop && g.objectId === objectId);
  if (!game) {
    game = {
      id: crypto.randomUUID(),
      shop,
      objectId,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
      isFavorite: false,
      isPinned: false,
      achievements: [],
      collectionId: null,
    };
    state.games.push(game);
  }
  return game;
};

const authHtml = (pathname) => {
  const payload = Buffer.from(
    JSON.stringify({
      accessToken: crypto.randomBytes(16).toString('hex'),
      refreshToken: crypto.randomBytes(16).toString('hex'),
      expiresIn: 3600,
      workwondersJwt: 'selfhost',
    })
  ).toString('base64');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Hydra Self-Hosted Auth</title>
    <style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}button{font-size:16px;padding:10px 16px;cursor:pointer}</style>
  </head>
  <body>
    <div>
      <h2>Hydra Self-Hosted Auth</h2>
      <p>Path: ${pathname}</p>
      <button onclick="window.location.href='hydralauncher://auth?payload=${encodeURIComponent(payload)}'">Sign in to Hydra</button>
    </div>
  </body>
</html>`;
};

const server = http.createServer(async (req, res) => {
  const method = req.method || 'GET';
  const parsed = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const { pathname, searchParams } = parsed;

  if (method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  if (
    method === 'GET' &&
    [
      '/',
      '/update-email',
      '/update-password',
      '/auth',
      '/auth/',
      '/auth/update-email',
      '/auth/update-password',
      '/checkout',
    ].includes(pathname)
  ) {
    return sendText(res, 200, authHtml(pathname), 'text/html; charset=utf-8');
  }

  if (method === 'GET' && pathname === '/health') {
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'POST' && pathname === '/auth/refresh') {
    return sendJson(res, 200, {
      accessToken: crypto.randomBytes(16).toString('hex'),
      expiresIn: 3600,
    });
  }

  if (method === 'POST' && pathname === '/auth/ws') {
    return sendJson(res, 200, {
      token: crypto.randomBytes(16).toString('hex'),
    });
  }

  if (method === 'POST' && pathname === '/auth/payment') {
    return sendJson(res, 200, {
      accessToken: crypto.randomBytes(16).toString('hex'),
    });
  }

  if (method === 'POST' && pathname === '/auth/logout') {
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/profile/me') {
    return sendJson(res, 200, state.user);
  }

  if (method === 'GET' && pathname === '/profile/download-sources') {
    return sendJson(res, 200, state.downloadSources);
  }

  if (method === 'POST' && pathname === '/profile/download-sources') {
    const body = (await readBody(req)) || {};
    const existing = state.downloadSources.find(
      (source) => source.shop === body.shop && source.objectId === body.objectId
    );

    if (existing) {
      Object.assign(existing, body);
    } else {
      state.downloadSources.push(body);
    }

    saveState();
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'DELETE' && pathname === '/profile/download-sources') {
    const shop = searchParams.get('shop');
    const objectId = searchParams.get('objectId');
    state.downloadSources = state.downloadSources.filter(
      (source) => !(source.shop === shop && source.objectId === objectId)
    );
    saveState();
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'POST' && pathname === '/download-sources/changes') {
    return sendJson(res, 200, []);
  }

  if (method === 'GET' && pathname === '/profile/games') {
    return sendJson(res, 200, state.games);
  }

  if (method === 'POST' && pathname === '/profile/games') {
    const body = (await readBody(req)) || {};
    const game = findOrCreateGame(body.shop, body.objectId);
    Object.assign(game, body);
    saveState();
    return sendJson(res, 200, game);
  }

  if (method === 'POST' && pathname === '/profile/games/batch') {
    const body = (await readBody(req)) || [];
    for (const item of body) {
      const game = findOrCreateGame(item.shop, item.objectId);
      Object.assign(game, item);
    }
    saveState();
    return sendJson(res, 200, state.games);
  }

  if (method === 'PUT' && pathname === '/profile/games/achievements') {
    const body = (await readBody(req)) || {};
    const game = state.games.find((candidate) => candidate.id === body.id);
    if (game) {
      game.achievements = body.achievements || [];
      saveState();
      return sendJson(res, 200, {
        id: game.id,
        objectId: game.objectId,
        shop: game.shop,
        achievements: game.achievements,
      });
    }
    return sendJson(res, 404, { error: 'Game not found' });
  }

  const gameByShopAndObjectId = routeMatch(pathname, '/profile/games/:shop/:objectId');
  if (method === 'PUT' && gameByShopAndObjectId) {
    const body = (await readBody(req)) || {};
    const game = findOrCreateGame(gameByShopAndObjectId.shop, gameByShopAndObjectId.objectId);
    Object.assign(game, body);
    saveState();
    return sendJson(res, 200, game);
  }

  const gameActionRoute = routeMatch(pathname, '/profile/games/:shop/:objectId/:action');
  if (method === 'PUT' && gameActionRoute) {
    const game = findOrCreateGame(gameActionRoute.shop, gameActionRoute.objectId);
    const body = (await readBody(req)) || {};
    switch (gameActionRoute.action) {
      case 'pin':
        game.isPinned = true;
        break;
      case 'unpin':
        game.isPinned = false;
        break;
      case 'favorite':
        game.isFavorite = true;
        break;
      case 'unfavorite':
        game.isFavorite = false;
        break;
      case 'playtime':
        game.playTimeInMilliseconds = body.playTimeInMilliseconds ?? game.playTimeInMilliseconds;
        game.lastTimePlayed = body.lastTimePlayed ?? game.lastTimePlayed;
        break;
      case 'collection':
        game.collectionId = body.collectionId ?? null;
        break;
      default:
        break;
    }
    saveState();
    return sendJson(res, 200, game);
  }

  const gameDeleteRoute = routeMatch(pathname, '/profile/games/:id');
  if (method === 'DELETE' && gameDeleteRoute) {
    state.games = state.games.filter((game) => game.id !== gameDeleteRoute.id);
    saveState();
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/profile/games/collections') {
    return sendJson(res, 200, state.collections);
  }

  if (method === 'POST' && pathname === '/profile/games/collections') {
    const body = (await readBody(req)) || {};
    const collection = {
      id: crypto.randomUUID(),
      name: body.name || 'Collection',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.collections.push(collection);
    saveState();
    return sendJson(res, 200, collection);
  }

  const collectionRoute = routeMatch(pathname, '/profile/games/collections/:id');
  if (collectionRoute && method === 'PUT') {
    const body = (await readBody(req)) || {};
    const collection = state.collections.find((c) => c.id === collectionRoute.id);
    if (!collection) return sendJson(res, 404, { error: 'Collection not found' });
    collection.name = body.name ?? collection.name;
    collection.updatedAt = new Date().toISOString();
    saveState();
    return sendJson(res, 200, collection);
  }

  if (collectionRoute && method === 'DELETE') {
    state.collections = state.collections.filter((c) => c.id !== collectionRoute.id);
    state.games = state.games.map((g) =>
      g.collectionId === collectionRoute.id ? { ...g, collectionId: null } : g
    );
    saveState();
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'POST' && pathname === '/profile/games/artifacts') {
    const body = (await readBody(req)) || {};
    const artifact = {
      id: crypto.randomUUID(),
      artifactLengthInBytes: body.artifactLengthInBytes || 0,
      downloadOptionTitle: body.downloadOptionTitle ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      hostname: body.hostname || 'self-host',
      downloadCount: 0,
      label: body.label,
      isFrozen: false,
      shop: body.shop,
      objectId: body.objectId,
    };
    state.artifacts.push(artifact);
    saveState();

    return sendJson(res, 200, {
      id: artifact.id,
      uploadUrl: `${PUBLIC_BASE_URL}/artifacts/${artifact.id}`,
    });
  }

  if (method === 'GET' && pathname === '/profile/games/artifacts') {
    const objectId = searchParams.get('objectId');
    const shop = searchParams.get('shop');

    const artifacts = state.artifacts
      .filter((artifact) => artifact.objectId === objectId && artifact.shop === shop)
      .map(({ shop: _shop, objectId: _objectId, ...publicArtifact }) => publicArtifact);

    return sendJson(res, 200, artifacts);
  }

  const artifactDownloadRoute = routeMatch(pathname, '/profile/games/artifacts/:id/download');
  if (method === 'GET' && artifactDownloadRoute) {
    const artifact = state.artifacts.find((candidate) => candidate.id === artifactDownloadRoute.id);
    if (!artifact) return sendJson(res, 404, { error: 'Artifact not found' });
    artifact.downloadCount += 1;
    artifact.updatedAt = new Date().toISOString();
    saveState();
    return sendJson(res, 200, {
      downloadUrl: `${PUBLIC_BASE_URL}/artifacts/${artifact.id}`,
    });
  }

  const artifactActionRoute = routeMatch(pathname, '/profile/games/artifacts/:id/:action');
  if (method === 'PUT' && artifactActionRoute) {
    const artifact = state.artifacts.find((candidate) => candidate.id === artifactActionRoute.id);
    if (!artifact) return sendJson(res, 404, { error: 'Artifact not found' });

    if (artifactActionRoute.action === 'freeze') artifact.isFrozen = true;
    if (artifactActionRoute.action === 'unfreeze') artifact.isFrozen = false;

    artifact.updatedAt = new Date().toISOString();
    saveState();
    return sendJson(res, 200, artifact);
  }

  const artifactRoute = routeMatch(pathname, '/profile/games/artifacts/:id');
  if (method === 'PUT' && artifactRoute) {
    const body = (await readBody(req)) || {};
    const artifact = state.artifacts.find((candidate) => candidate.id === artifactRoute.id);
    if (!artifact) return sendJson(res, 404, { error: 'Artifact not found' });
    const label = body?.data?.label;
    if (typeof label === 'string') artifact.label = label;
    artifact.updatedAt = new Date().toISOString();
    saveState();
    return sendJson(res, 200, artifact);
  }

  if (method === 'DELETE' && artifactRoute) {
    const artifactFilePath = path.join(ARTIFACTS_DIR, `${artifactRoute.id}.tar`);
    state.artifacts = state.artifacts.filter((candidate) => candidate.id !== artifactRoute.id);
    if (fs.existsSync(artifactFilePath)) fs.unlinkSync(artifactFilePath);
    saveState();
    return sendJson(res, 200, { ok: true });
  }

  const rawArtifactRoute = routeMatch(pathname, '/artifacts/:id');
  if (rawArtifactRoute && method === 'PUT') {
    const payload = await readBody(req);
    if (!Buffer.isBuffer(payload)) return sendJson(res, 400, { error: 'Expected binary body' });

    const targetPath = path.join(ARTIFACTS_DIR, `${rawArtifactRoute.id}.tar`);
    fs.writeFileSync(targetPath, payload);
    return sendJson(res, 200, { ok: true });
  }

  if (rawArtifactRoute && method === 'GET') {
    const targetPath = path.join(ARTIFACTS_DIR, `${rawArtifactRoute.id}.tar`);
    if (!fs.existsSync(targetPath)) return sendJson(res, 404, { error: 'Artifact file not found' });
    const file = fs.readFileSync(targetPath);
    res.writeHead(200, {
      'Content-Type': 'application/tar',
      'Content-Length': file.length,
      'Access-Control-Allow-Origin': '*',
    });
    res.end(file);
    return;
  }

  const userRoute = routeMatch(pathname, '/users/:id');
  if (method === 'GET' && userRoute) {
    return sendJson(res, 200, {
      id: userRoute.id,
      displayName: state.user.displayName,
      profileImageUrl: state.user.profileImageUrl,
      email: state.user.email,
      backgroundImageUrl: state.user.backgroundImageUrl,
      profileVisibility: state.user.profileVisibility,
      libraryGames: [],
      recentGames: [],
      friends: [],
      totalFriends: 0,
      relation: null,
      currentGame: null,
      bio: state.user.bio,
      hasActiveSubscription: true,
      karma: state.user.karma,
      quirks: state.user.quirks,
      badges: [],
      hasCompletedWrapped2025: false,
    });
  }

  if (method === 'POST' && pathname === '/debrid/request-file') {
    return sendJson(res, 200, { downloadUrl: '' });
  }

  if (method === 'PUT' && pathname === '/debrid/friend-request') {
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'POST' && pathname === '/hosters/unlock') {
    return sendJson(res, 200, { url: '' });
  }

  return sendJson(res, 404, { error: `No route for ${method} ${pathname}` });
});

const wss = new WebSocketServer({ host: HOST, port: WS_PORT });

wss.on('connection', (ws) => {
  ws.on('message', (rawMessage) => {
    const message = rawMessage.toString();
    if (message === 'PING') {
      ws.send('PONG');
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Hydra self-host backend API/Auth listening on ${HOST}:${PORT}`);
  console.log(`Hydra self-host backend WS listening on ${HOST}:${WS_PORT}`);
});
