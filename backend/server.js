const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 4000);
const WS_PORT = Number(process.env.WS_PORT || 4001);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const STATE_PATH = path.join(DATA_DIR, "state.json");
const ARTIFACTS_DIR = path.join(DATA_DIR, "artifacts");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

const ensureDir = (target) => fs.mkdirSync(target, { recursive: true });
ensureDir(DATA_DIR);
ensureDir(ARTIFACTS_DIR);
ensureDir(UPLOADS_DIR);

const EMPTY_ZIP_BUFFER = Buffer.from(
  "504b0506000000000000000000000000000000000000",
  "hex"
);

const defaultState = {
  user: {
    id: "selfhost-user",
    username: "selfhost",
    email: null,
    displayName: "Self Hosted User",
    profileImageUrl: null,
    backgroundImageUrl: null,
    profileVisibility: "PUBLIC",
    bio: "Hydra self-host starter backend",
    workwondersJwt: "selfhost",
    karma: 0,
    quirks: { backupsPerGameLimit: 50 },
    subscription: {
      id: "selfhost-subscription",
      status: "ACTIVE",
      plan: { id: "selfhost-plan", name: "Self Hosted" },
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
  },
  games: [],
  artifacts: [],
  downloadSources: [],
  collections: [],
  friendRequests: [],
  blockedUserIds: [],
  notifications: [],
  reviews: [],
  catalogueGames: [],
  badges: [
    {
      name: "self_hosted",
      title: "Self Hosted",
      description: "Using Hydra in self-host mode",
      badge: {
        url: "https://raw.githubusercontent.com/hydralauncher/hydra/refs/heads/main/resources/icon.png",
      },
    },
  ],
};

const ensureStateShape = (rawState = {}) => {
  const safe = rawState && typeof rawState === "object" ? rawState : {};
  const ensureArray = (value, fallback = []) =>
    Array.isArray(value) ? value : fallback;

  return {
    ...defaultState,
    ...safe,
    user: {
      ...defaultState.user,
      ...(safe.user && typeof safe.user === "object" ? safe.user : {}),
    },
    games: ensureArray(safe.games),
    artifacts: ensureArray(safe.artifacts),
    downloadSources: ensureArray(safe.downloadSources),
    collections: ensureArray(safe.collections),
    friendRequests: ensureArray(safe.friendRequests),
    blockedUserIds: ensureArray(safe.blockedUserIds),
    notifications: ensureArray(safe.notifications),
    reviews: ensureArray(safe.reviews),
    catalogueGames: ensureArray(safe.catalogueGames),
    badges: ensureArray(safe.badges, defaultState.badges),
  };
};

const loadState = () => {
  try {
    if (!fs.existsSync(STATE_PATH)) return ensureStateShape();
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    return ensureStateShape(JSON.parse(raw));
  } catch {
    return ensureStateShape();
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
  const contentType = req.headers["content-type"] || "";

  if (!buffer.length) return undefined;
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(buffer.toString("utf8"));
    } catch {
      return {};
    }
  }

  return buffer;
};

const sendJson = (res, status, payload) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Hydra-If-Modified-Since",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  });
  res.end(JSON.stringify(payload));
};

const sendText = (
  res,
  status,
  payload,
  contentType = "text/plain; charset=utf-8"
) => {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
  });
  res.end(payload);
};

const routeMatch = (pathname, pattern) => {
  const pathParts = pathname.split("/").filter(Boolean);
  const patParts = pattern.split("/").filter(Boolean);
  if (pathParts.length !== patParts.length) return null;

  const params = {};
  for (let i = 0; i < patParts.length; i += 1) {
    const pat = patParts[i];
    const value = pathParts[i];
    if (pat.startsWith(":")) {
      params[pat.slice(1)] = decodeURIComponent(value);
    } else if (pat !== value) {
      return null;
    }
  }

  return params;
};

const getRequestData = (body) => {
  if (
    body &&
    typeof body === "object" &&
    body.data &&
    typeof body.data === "object"
  ) {
    return body.data;
  }

  return body && typeof body === "object" ? body : {};
};

const buildUserGame = (game) => {
  const unlockedAchievementCount = Array.isArray(game.achievements)
    ? game.achievements.length
    : 0;

  return {
    objectId: game.objectId,
    shop: game.shop,
    title: game.title || `${game.shop}:${game.objectId}`,
    playTimeInSeconds: Math.floor((game.playTimeInMilliseconds || 0) / 1000),
    lastTimePlayed: game.lastTimePlayed ?? null,
    unlockedAchievementCount,
    achievementCount: unlockedAchievementCount,
    achievementsPointsEarnedSum: 0,
    hasManuallyUpdatedPlaytime: false,
    isFavorite: !!game.isFavorite,
    isPinned: !!game.isPinned,
    pinnedDate: null,
    iconUrl: null,
    libraryHeroImageUrl: null,
    libraryImageUrl: null,
    logoImageUrl: null,
    logoPosition: null,
    coverImageUrl: null,
    downloadSources: [],
  };
};

const findOrCreateGame = (shop, objectId) => {
  let game = state.games.find(
    (g) => g.shop === shop && g.objectId === objectId
  );
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

const createDownloadSource = (url) => {
  let name = "Download Source";
  try {
    const parsedUrl = new URL(url);
    name = parsedUrl.hostname.replace(/^www\./, "") || name;
  } catch {
    // keep fallback name
  }

  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    name,
    url,
    status: "MATCHED",
    downloadCount: 0,
    fingerprint: crypto.createHash("sha1").update(url).digest("hex"),
    createdAt: now,
    updatedAt: now,
  };
};

const upsertDownloadSourceByUrl = (sourceUrl) => {
  const url = typeof sourceUrl === "string" ? sourceUrl.trim() : "";
  if (!url) return null;

  const existing = state.downloadSources.find((source) => source.url === url);
  if (existing) return existing;

  const created = createDownloadSource(url);
  state.downloadSources.push(created);
  return created;
};

const defaultCatalogueGames = [
  {
    id: "730",
    objectId: "730",
    shop: "steam",
    title: "Counter-Strike 2",
    genres: ["Action"],
    tags: [19, 1685],
    publishers: ["Valve"],
    developers: ["Valve"],
    releaseYear: 2023,
    popularity: 1000,
    hydraScore: 4.6,
    reviewScore: 4.6,
    releaseDate: "2023-09-27",
    protondbSupportBadges: ["gold"],
    deckCompatibilities: ["playable", "verified"],
    description: "The next era of Counter-Strike begins.",
  },
  {
    id: "570",
    objectId: "570",
    shop: "steam",
    title: "Dota 2",
    genres: ["Action", "Strategy"],
    tags: [9, 492],
    publishers: ["Valve"],
    developers: ["Valve"],
    releaseYear: 2013,
    popularity: 950,
    hydraScore: 4.4,
    reviewScore: 4.4,
    releaseDate: "2013-07-09",
    protondbSupportBadges: ["gold"],
    deckCompatibilities: ["playable", "verified"],
    description: "Every day, millions enter battle as one of over a hundred heroes.",
  },
  {
    id: "1091500",
    objectId: "1091500",
    shop: "steam",
    title: "Cyberpunk 2077",
    genres: ["RPG", "Action"],
    tags: [122, 492],
    publishers: ["CD PROJEKT RED"],
    developers: ["CD PROJEKT RED"],
    releaseYear: 2020,
    popularity: 900,
    hydraScore: 4.5,
    reviewScore: 4.2,
    releaseDate: "2020-12-10",
    protondbSupportBadges: ["platinum"],
    deckCompatibilities: ["playable", "verified"],
    description: "An open-world, action-adventure RPG set in Night City.",
  },
  {
    id: "1245620",
    objectId: "1245620",
    shop: "steam",
    title: "ELDEN RING",
    genres: ["RPG", "Action"],
    tags: [122, 21],
    publishers: ["Bandai Namco Entertainment"],
    developers: ["FromSoftware, Inc."],
    releaseYear: 2022,
    popularity: 870,
    hydraScore: 4.8,
    reviewScore: 4.8,
    releaseDate: "2022-02-25",
    protondbSupportBadges: ["gold"],
    deckCompatibilities: ["playable", "verified"],
    description: "Rise, Tarnished, and be guided by grace.",
  },
  {
    id: "271590",
    objectId: "271590",
    shop: "steam",
    title: "Grand Theft Auto V",
    genres: ["Action", "Adventure"],
    tags: [19, 492],
    publishers: ["Rockstar Games"],
    developers: ["Rockstar North"],
    releaseYear: 2015,
    popularity: 860,
    hydraScore: 4.7,
    reviewScore: 4.6,
    releaseDate: "2015-04-14",
    protondbSupportBadges: ["gold"],
    deckCompatibilities: ["playable"],
    description: "Explore Los Santos and Blaine County in ultimate detail.",
  },
  {
    id: "1172470",
    objectId: "1172470",
    shop: "steam",
    title: "Apex Legends",
    genres: ["Action"],
    tags: [19, 3859],
    publishers: ["Electronic Arts"],
    developers: ["Respawn Entertainment"],
    releaseYear: 2020,
    popularity: 780,
    hydraScore: 4.2,
    reviewScore: 4.1,
    releaseDate: "2020-11-04",
    protondbSupportBadges: ["silver"],
    deckCompatibilities: ["playable"],
    description: "A free-to-play hero shooter where legendary characters battle.",
  },
  {
    id: "1086940",
    objectId: "1086940",
    shop: "steam",
    title: "Baldur's Gate 3",
    genres: ["RPG", "Strategy"],
    tags: [122, 9],
    publishers: ["Larian Studios"],
    developers: ["Larian Studios"],
    releaseYear: 2023,
    popularity: 760,
    hydraScore: 4.9,
    reviewScore: 4.9,
    releaseDate: "2023-08-03",
    protondbSupportBadges: ["platinum"],
    deckCompatibilities: ["verified", "playable"],
    description: "Gather your party and return to the Forgotten Realms.",
  },
  {
    id: "1462040",
    objectId: "1462040",
    shop: "steam",
    title: "FINAL FANTASY VII REBIRTH",
    genres: ["RPG", "Action"],
    tags: [122, 21],
    publishers: ["Square Enix"],
    developers: ["Square Enix"],
    releaseYear: 2024,
    popularity: 650,
    hydraScore: 4.3,
    reviewScore: 4.3,
    releaseDate: "2024-02-29",
    protondbSupportBadges: ["silver"],
    deckCompatibilities: ["playable"],
    description: "The unknown journey continues beyond Midgar.",
  },
];

const ensureCatalogueGames = () => {
  if (state.catalogueGames.length) return;

  state.catalogueGames = defaultCatalogueGames.map((game) => {
    const objectId = game.objectId;
    const steamCdn = `https://cdn.akamai.steamstatic.com/steam/apps/${objectId}`;

    return {
      ...game,
      iconUrl: `${steamCdn}/header.jpg`,
      libraryHeroImageUrl: `${steamCdn}/library_hero.jpg`,
      libraryImageUrl: `${steamCdn}/library_600x900.jpg`,
      logoImageUrl: `${steamCdn}/logo.png`,
      logoPosition: null,
      coverImageUrl: `${steamCdn}/capsule_616x353.jpg`,
    };
  });

  saveState();
};

const parseArrayQueryParam = (searchParams, key) => {
  const values = [
    ...searchParams.getAll(key),
    ...searchParams.getAll(`${key}[]`),
  ].flatMap((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );

  return Array.from(new Set(values));
};

const getCurrentUserId = () => state.user?.id || "selfhost-user";

const toCatalogueDownloadSourceNames = (game, selectedSourceIds) => {
  const availableSources = state.downloadSources.filter((source) => {
    const selected = !selectedSourceIds || selectedSourceIds.has(source.id);
    return selected;
  });

  if (!availableSources.length) return [];
  return availableSources.map((source) => source.name);
};

const toShopAsset = (game, selectedSourceIds) => ({
  objectId: game.objectId,
  shop: game.shop,
  title: game.title,
  iconUrl: game.iconUrl ?? null,
  libraryHeroImageUrl: game.libraryHeroImageUrl ?? null,
  libraryImageUrl: game.libraryImageUrl ?? null,
  logoImageUrl: game.logoImageUrl ?? null,
  logoPosition: game.logoPosition ?? null,
  coverImageUrl: game.coverImageUrl ?? null,
  downloadSources: toCatalogueDownloadSourceNames(game, selectedSourceIds),
});

const intersects = (left, right) => {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  return left.some((item) => right.includes(item));
};

const authHtml = (pathname) => {
  const payload = Buffer.from(
    JSON.stringify({
      accessToken: crypto.randomBytes(16).toString("hex"),
      refreshToken: crypto.randomBytes(16).toString("hex"),
      expiresIn: 3600,
      workwondersJwt: "selfhost",
    })
  ).toString("base64");

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
  const method = req.method || "GET";
  const parsed = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`
  );
  const { pathname, searchParams } = parsed;

  if (method === "OPTIONS") {
    return sendJson(res, 200, { ok: true });
  }

  if (
    method === "GET" &&
    [
      "/",
      "/update-email",
      "/update-password",
      "/auth",
      "/auth/",
      "/auth/update-email",
      "/auth/update-password",
      "/checkout",
    ].includes(pathname)
  ) {
    return sendText(res, 200, authHtml(pathname), "text/html; charset=utf-8");
  }

  if (method === "GET" && pathname === "/health") {
    return sendJson(res, 200, { ok: true });
  }

  if (method === "POST" && pathname === "/auth/refresh") {
    return sendJson(res, 200, {
      accessToken: crypto.randomBytes(16).toString("hex"),
      expiresIn: 3600,
    });
  }

  if (method === "POST" && pathname === "/auth/ws") {
    return sendJson(res, 200, {
      token: crypto.randomBytes(16).toString("hex"),
    });
  }

  if (method === "POST" && pathname === "/auth/payment") {
    return sendJson(res, 200, {
      accessToken: crypto.randomBytes(16).toString("hex"),
    });
  }

  if (method === "POST" && pathname === "/auth/logout") {
    return sendJson(res, 200, { ok: true });
  }

  if (method === "GET" && pathname === "/profile/me") {
    return sendJson(res, 200, state.user);
  }

  if (method === "PATCH" && pathname === "/profile") {
    const body = getRequestData((await readBody(req)) || {});
    state.user = {
      ...state.user,
      ...body,
    };
    saveState();
    return sendJson(res, 200, state.user);
  }

  const presignedUrlRoute = routeMatch(pathname, "/presigned-urls/:type");
  if (method === "POST" && presignedUrlRoute) {
    const body = (await readBody(req)) || {};
    const extension = String(body.imageExt || "bin").replace(/[^a-z0-9]/gi, "");
    const uploadId = `${presignedUrlRoute.type}-${crypto.randomUUID()}.${extension || "bin"}`;
    const uploadUrl = `${PUBLIC_BASE_URL}/uploads/${uploadId}`;
    const payload = { presignedUrl: uploadUrl };
    if (presignedUrlRoute.type === "profile-image") {
      payload.profileImageUrl = uploadUrl;
    }
    if (presignedUrlRoute.type === "background-image") {
      payload.backgroundImageUrl = uploadUrl;
    }
    return sendJson(res, 200, payload);
  }

  const uploadRoute = routeMatch(pathname, "/uploads/:id");
  if (method === "PUT" && uploadRoute) {
    const payload = await readBody(req);
    if (!Buffer.isBuffer(payload)) {
      return sendJson(res, 400, { error: "Expected binary body" });
    }

    fs.writeFileSync(path.join(UPLOADS_DIR, uploadRoute.id), payload);
    return sendJson(res, 200, { ok: true });
  }

  if (method === "GET" && uploadRoute) {
    const filePath = path.join(UPLOADS_DIR, uploadRoute.id);
    if (!fs.existsSync(filePath)) {
      return sendJson(res, 404, { error: "Upload not found" });
    }

    const file = fs.readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": file.length,
      "Access-Control-Allow-Origin": "*",
    });
    res.end(file);
    return;
  }

  if (method === "GET" && pathname === "/profile/download-sources") {
    return sendJson(res, 200, state.downloadSources);
  }

  if (method === "POST" && pathname === "/profile/download-sources") {
    const body = getRequestData((await readBody(req)) || {});
    const urls = Array.isArray(body.urls) ? body.urls : body.url ? [body.url] : [];
    const syncedSources = urls
      .map((sourceUrl) => upsertDownloadSourceByUrl(sourceUrl))
      .filter(Boolean);

    saveState();
    return sendJson(res, 200, syncedSources);
  }

  if (method === "DELETE" && pathname === "/profile/download-sources") {
    const removeAll = searchParams.get("all") === "true";
    const downloadSourceId = searchParams.get("downloadSourceId");
    if (removeAll) {
      state.downloadSources = [];
    } else if (downloadSourceId) {
      state.downloadSources = state.downloadSources.filter(
        (source) => source.id !== downloadSourceId
      );
    }
    saveState();
    return sendJson(res, 200, { ok: true });
  }

  if (method === "POST" && pathname === "/download-sources") {
    const body = getRequestData((await readBody(req)) || {});
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) {
      return sendJson(res, 400, { error: "URL is required" });
    }

    const existing = state.downloadSources.find((source) => source.url === url);
    if (existing) {
      return sendJson(res, 200, existing);
    }

    const created = createDownloadSource(url);
    state.downloadSources.push(created);
    saveState();
    return sendJson(res, 200, created);
  }

  if (method === "POST" && pathname === "/download-sources/sync") {
    const body = getRequestData((await readBody(req)) || {});
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const synced = ids.length
      ? state.downloadSources.filter((source) => ids.includes(source.id))
      : state.downloadSources;
    return sendJson(res, 200, synced);
  }

  if (method === "POST" && pathname === "/download-sources/changes") {
    return sendJson(res, 200, []);
  }

  if (method === "GET" && pathname === "/catalogue/featured") {
    ensureCatalogueGames();
    const featured = state.catalogueGames.slice(0, 5).map((game) => ({
      ...toShopAsset(game),
      description: game.description ?? null,
      uri: `/game/${game.shop}/${game.objectId}?title=${encodeURIComponent(game.title)}`,
    }));
    return sendJson(res, 200, featured);
  }

  if (method === "GET" && pathname === "/catalogue/search/suggestions") {
    ensureCatalogueGames();
    const query = String(searchParams.get("query") || "")
      .trim()
      .toLowerCase();
    const limit = Math.max(1, Number(searchParams.get("limit") || 5));

    if (!query) return sendJson(res, 200, []);

    const suggestions = state.catalogueGames
      .filter((game) => game.title.toLowerCase().includes(query))
      .slice(0, limit)
      .map((game) => ({
        title: game.title,
        objectId: game.objectId,
        shop: game.shop,
        iconUrl: game.iconUrl ?? null,
      }));

    return sendJson(res, 200, suggestions);
  }

  if (method === "POST" && pathname === "/catalogue/search") {
    ensureCatalogueGames();
    const body = getRequestData((await readBody(req)) || {});

    const take = Math.max(1, Number(body.take ?? 30));
    const skip = Math.max(0, Number(body.skip ?? 0));
    const title = String(body.title || "")
      .trim()
      .toLowerCase();

    const sourceIdsFromFingerprint = Array.isArray(body.downloadSourceFingerprints)
      ? state.downloadSources
          .filter((source) =>
            body.downloadSourceFingerprints.includes(source.fingerprint)
          )
          .map((source) => source.id)
      : [];

    const sourceIdsFromBody = Array.isArray(body.downloadSourceIds)
      ? body.downloadSourceIds
      : [];
    const selectedSourceIds = new Set([
      ...sourceIdsFromFingerprint,
      ...sourceIdsFromBody,
    ]);
    const selectedOrAllSourceIds = selectedSourceIds.size
      ? selectedSourceIds
      : new Set(state.downloadSources.map((source) => source.id));

    let results = state.catalogueGames.filter((game) => {
      if (title && !game.title.toLowerCase().includes(title)) return false;

      if (Array.isArray(body.genres) && body.genres.length > 0) {
        if (!intersects(game.genres, body.genres)) return false;
      }

      if (Array.isArray(body.publishers) && body.publishers.length > 0) {
        if (!intersects(game.publishers, body.publishers)) return false;
      }

      if (Array.isArray(body.developers) && body.developers.length > 0) {
        if (!intersects(game.developers, body.developers)) return false;
      }

      if (Array.isArray(body.tags) && body.tags.length > 0) {
        if (!intersects(game.tags, body.tags)) return false;
      }

      if (
        body.releaseYear &&
        typeof body.releaseYear === "object" &&
        game.releaseYear
      ) {
        if (
          typeof body.releaseYear.gte === "number" &&
          game.releaseYear < body.releaseYear.gte
        ) {
          return false;
        }
        if (
          typeof body.releaseYear.lte === "number" &&
          game.releaseYear > body.releaseYear.lte
        ) {
          return false;
        }
      }

      if (
        Array.isArray(body.protondbSupportBadges) &&
        body.protondbSupportBadges.length > 0
      ) {
        if (!intersects(game.protondbSupportBadges, body.protondbSupportBadges)) {
          return false;
        }
      }

      if (Array.isArray(body.deckCompatibility) && body.deckCompatibility.length) {
        if (!intersects(game.deckCompatibilities, body.deckCompatibility)) {
          return false;
        }
      }

      return true;
    });

    const sortBy = body.sortBy || "popularity";
    const sortOrder = body.sortOrder === "asc" ? "asc" : "desc";
    const sortDirection = sortOrder === "asc" ? 1 : -1;

    results = results.toSorted((a, b) => {
      switch (sortBy) {
        case "alphabetical":
          return a.title.localeCompare(b.title) * sortDirection;
        case "releaseDate":
          return (
            (new Date(a.releaseDate).getTime() - new Date(b.releaseDate).getTime()) *
            sortDirection
          );
        case "hydraScore":
          return (a.hydraScore - b.hydraScore) * sortDirection;
        case "reviewScore":
          return (a.reviewScore - b.reviewScore) * sortDirection;
        case "popularity":
        default:
          return (a.popularity - b.popularity) * sortDirection;
      }
    });

    const paged = results.slice(skip, skip + take).map((game) => ({
      id: game.id,
      objectId: game.objectId,
      title: game.title,
      shop: game.shop,
      genres: game.genres,
      releaseYear: game.releaseYear,
      protondbSupportBadges: game.protondbSupportBadges,
      deckCompatibilities: game.deckCompatibilities,
      deckCompatibility: game.deckCompatibilities[0] ?? null,
      libraryImageUrl: game.libraryImageUrl ?? null,
      downloadSources: toCatalogueDownloadSourceNames(game, selectedOrAllSourceIds),
    }));

    return sendJson(res, 200, {
      edges: paged,
      count: results.length,
    });
  }

  const catalogueCategoryRoute = routeMatch(pathname, "/catalogue/:category");
  if (method === "GET" && catalogueCategoryRoute) {
    ensureCatalogueGames();

    const take = Math.max(1, Number(searchParams.get("take") || 12));
    const skip = Math.max(0, Number(searchParams.get("skip") || 0));
    const downloadSourceIds = parseArrayQueryParam(searchParams, "downloadSourceIds");
    const selectedSourceIds = downloadSourceIds.length
      ? new Set(downloadSourceIds)
      : null;

    const categorySortKey = {
      hot: "popularity",
      weekly: "hydraScore",
      achievements: "reviewScore",
    }[catalogueCategoryRoute.category];

    if (!categorySortKey) {
      return sendJson(res, 404, { error: "Unknown catalogue category" });
    }

    const games = state.catalogueGames
      .toSorted((a, b) => b[categorySortKey] - a[categorySortKey])
      .slice(skip, skip + take)
      .map((game) => toShopAsset(game, selectedSourceIds));

    return sendJson(res, 200, games);
  }

  const gameDownloadSourcesRoute = routeMatch(
    pathname,
    "/games/:shop/:objectId/download-sources"
  );
  if (method === "GET" && gameDownloadSourcesRoute) {
    return sendJson(res, 200, []);
  }

  const gameDownloadRoute = routeMatch(
    pathname,
    "/games/:shop/:objectId/download"
  );
  if (method === "POST" && gameDownloadRoute) {
    return sendJson(res, 200, { ok: true });
  }

  const gameAssetsRoute = routeMatch(pathname, "/games/:shop/:objectId/assets");
  if (method === "GET" && gameAssetsRoute) {
    ensureCatalogueGames();
    const game = state.catalogueGames.find(
      (entry) =>
        entry.shop === gameAssetsRoute.shop &&
        entry.objectId === gameAssetsRoute.objectId
    );

    if (!game) return sendJson(res, 200, null);
    return sendJson(res, 200, toShopAsset(game));
  }

  const gameStatsRoute = routeMatch(pathname, "/games/:shop/:objectId/stats");
  if (method === "GET" && gameStatsRoute) {
    const reviews = state.reviews.filter(
      (review) =>
        review.shop === gameStatsRoute.shop &&
        review.objectId === gameStatsRoute.objectId
    );
    const averageScore = reviews.length
      ? reviews.reduce((acc, review) => acc + Number(review.score || 0), 0) /
        reviews.length
      : null;

    const downloadCount = state.artifacts
      .filter(
        (artifact) =>
          artifact.shop === gameStatsRoute.shop &&
          artifact.objectId === gameStatsRoute.objectId
      )
      .reduce((acc, artifact) => acc + Number(artifact.downloadCount || 0), 0);

    return sendJson(res, 200, {
      downloadCount,
      playerCount: 0,
      averageScore,
      reviewCount: reviews.length,
    });
  }

  const gameReviewCheckRoute = routeMatch(
    pathname,
    "/games/:shop/:objectId/reviews/check"
  );
  if (method === "GET" && gameReviewCheckRoute) {
    const currentUserId = getCurrentUserId();
    const hasReviewed = state.reviews.some(
      (review) =>
        review.shop === gameReviewCheckRoute.shop &&
        review.objectId === gameReviewCheckRoute.objectId &&
        review.userId === currentUserId
    );

    return sendJson(res, 200, { hasReviewed });
  }

  const gameReviewsRoute = routeMatch(pathname, "/games/:shop/:objectId/reviews");
  if (gameReviewsRoute && method === "GET") {
    ensureCatalogueGames();
    const take = Math.max(1, Number(searchParams.get("take") || 20));
    const skip = Math.max(0, Number(searchParams.get("skip") || 0));
    const sortBy = searchParams.get("sortBy") || "newest";
    const currentUserId = getCurrentUserId();

    const sorters = {
      newest: (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      oldest: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      score_high: (a, b) => Number(b.score || 0) - Number(a.score || 0),
      score_low: (a, b) => Number(a.score || 0) - Number(b.score || 0),
      most_voted: (a, b) =>
        Number(b.upvotes || 0) +
        Number(b.downvotes || 0) -
        (Number(a.upvotes || 0) + Number(a.downvotes || 0)),
    };

    const reviews = state.reviews
      .filter(
        (review) =>
          review.shop === gameReviewsRoute.shop &&
          review.objectId === gameReviewsRoute.objectId
      )
      .toSorted(sorters[sortBy] || sorters.newest);

    const serialized = reviews.slice(skip, skip + take).map((review) => ({
      id: review.id,
      reviewHtml: review.reviewHtml,
      score: review.score,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
      upvotes: review.upvotes,
      downvotes: review.downvotes,
      isBlocked: false,
      hasUpvoted: review.votes?.[currentUserId] === "upvote",
      hasDownvoted: review.votes?.[currentUserId] === "downvote",
      translations: review.translations || {},
      detectedLanguage: review.detectedLanguage || "en",
      user: {
        id: review.userId,
        displayName: review.userDisplayName || state.user.displayName,
        profileImageUrl: review.userProfileImageUrl || state.user.profileImageUrl,
      },
      playTimeInSeconds: review.playTimeInSeconds || 0,
    }));

    return sendJson(res, 200, {
      reviews: serialized,
      totalCount: reviews.length,
    });
  }

  if (gameReviewsRoute && method === "POST") {
    const currentUserId = getCurrentUserId();
    const body = getRequestData((await readBody(req)) || {});
    const existing = state.reviews.find(
      (review) =>
        review.shop === gameReviewsRoute.shop &&
        review.objectId === gameReviewsRoute.objectId &&
        review.userId === currentUserId
    );

    if (existing) {
      existing.reviewHtml = String(body.reviewHtml || existing.reviewHtml || "");
      existing.score = Number(body.score || existing.score || 0);
      existing.updatedAt = new Date().toISOString();
      saveState();
      return sendJson(res, 200, existing);
    }

    const created = {
      id: crypto.randomUUID(),
      shop: gameReviewsRoute.shop,
      objectId: gameReviewsRoute.objectId,
      userId: currentUserId,
      userDisplayName: state.user.displayName,
      userProfileImageUrl: state.user.profileImageUrl,
      reviewHtml: String(body.reviewHtml || ""),
      score: Number(body.score || 0),
      upvotes: 0,
      downvotes: 0,
      votes: {},
      translations: {},
      detectedLanguage: "en",
      playTimeInSeconds: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.reviews.push(created);
    saveState();
    return sendJson(res, 200, created);
  }

  const gameReviewActionRoute = routeMatch(
    pathname,
    "/games/:shop/:objectId/reviews/:reviewId/:action"
  );
  if (gameReviewActionRoute && method === "PUT") {
    const currentUserId = getCurrentUserId();
    const review = state.reviews.find(
      (candidate) => candidate.id === gameReviewActionRoute.reviewId
    );
    if (!review) return sendJson(res, 404, { error: "Review not found" });

    review.votes = review.votes || {};
    const previousVote = review.votes[currentUserId];
    const nextVote =
      gameReviewActionRoute.action === "upvote"
        ? "upvote"
        : gameReviewActionRoute.action === "downvote"
          ? "downvote"
          : null;

    if (!nextVote) return sendJson(res, 400, { error: "Invalid vote action" });

    if (previousVote === nextVote) {
      delete review.votes[currentUserId];
      if (nextVote === "upvote") review.upvotes = Math.max(0, review.upvotes - 1);
      if (nextVote === "downvote")
        review.downvotes = Math.max(0, review.downvotes - 1);
    } else {
      review.votes[currentUserId] = nextVote;
      if (nextVote === "upvote") {
        review.upvotes += 1;
        if (previousVote === "downvote") {
          review.downvotes = Math.max(0, review.downvotes - 1);
        }
      } else {
        review.downvotes += 1;
        if (previousVote === "upvote") {
          review.upvotes = Math.max(0, review.upvotes - 1);
        }
      }
    }

    review.updatedAt = new Date().toISOString();
    saveState();
    return sendJson(res, 200, { ok: true });
  }

  const gameReviewRoute = routeMatch(
    pathname,
    "/games/:shop/:objectId/reviews/:reviewId"
  );
  if (gameReviewRoute && method === "DELETE") {
    state.reviews = state.reviews.filter(
      (review) => review.id !== gameReviewRoute.reviewId
    );
    saveState();
    return sendJson(res, 200, { ok: true });
  }

  const userReviewsRoute = routeMatch(pathname, "/users/:id/reviews");
  if (userReviewsRoute && method === "GET") {
    ensureCatalogueGames();
    const currentUserId = getCurrentUserId();
    const reviews = state.reviews
      .filter((review) => review.userId === userReviewsRoute.id)
      .toSorted((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((review) => {
        const game =
          state.catalogueGames.find(
            (entry) =>
              entry.shop === review.shop && entry.objectId === review.objectId
          ) ||
          state.games.find(
            (entry) =>
              entry.shop === review.shop && entry.objectId === review.objectId
          );

        return {
          id: review.id,
          reviewHtml: review.reviewHtml,
          score: review.score,
          playTimeInSeconds: review.playTimeInSeconds || 0,
          upvotes: review.upvotes,
          downvotes: review.downvotes,
          hasUpvoted: review.votes?.[currentUserId] === "upvote",
          hasDownvoted: review.votes?.[currentUserId] === "downvote",
          createdAt: review.createdAt,
          updatedAt: review.updatedAt,
          user: { id: review.userId },
          game: {
            title: game?.title || `${review.shop}:${review.objectId}`,
            iconUrl: game?.iconUrl || "",
            objectId: review.objectId,
            shop: review.shop,
          },
          translations: review.translations || {},
          detectedLanguage: review.detectedLanguage || "en",
        };
      });

    return sendJson(res, 200, {
      totalCount: reviews.length,
      reviews,
    });
  }

  if (method === "GET" && pathname === "/profile/games") {
    return sendJson(res, 200, state.games);
  }

  if (method === "POST" && pathname === "/profile/games") {
    const body = (await readBody(req)) || {};
    const game = findOrCreateGame(body.shop, body.objectId);
    Object.assign(game, body);
    saveState();
    return sendJson(res, 200, game);
  }

  if (method === "POST" && pathname === "/profile/games/batch") {
    const body = (await readBody(req)) || [];
    for (const item of body) {
      const game = findOrCreateGame(item.shop, item.objectId);
      Object.assign(game, item);
    }
    saveState();
    return sendJson(res, 200, state.games);
  }

  if (method === "PUT" && pathname === "/profile/games/achievements") {
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
    return sendJson(res, 404, { error: "Game not found" });
  }

  const gameAchievementsRoute = routeMatch(
    pathname,
    "/profile/games/achievements/:id"
  );
  if (method === "DELETE" && gameAchievementsRoute) {
    const game = state.games.find(
      (candidate) => candidate.id === gameAchievementsRoute.id
    );
    if (!game) return sendJson(res, 404, { error: "Game not found" });
    game.achievements = [];
    saveState();
    return sendJson(res, 200, { ok: true });
  }

  const gameByShopAndObjectId = routeMatch(
    pathname,
    "/profile/games/:shop/:objectId"
  );
  if (method === "PUT" && gameByShopAndObjectId) {
    const body = (await readBody(req)) || {};
    const game = findOrCreateGame(
      gameByShopAndObjectId.shop,
      gameByShopAndObjectId.objectId
    );
    Object.assign(game, body);
    saveState();
    return sendJson(res, 200, game);
  }

  const gameActionRoute = routeMatch(
    pathname,
    "/profile/games/:shop/:objectId/:action"
  );
  if (method === "PUT" && gameActionRoute) {
    const game = findOrCreateGame(
      gameActionRoute.shop,
      gameActionRoute.objectId
    );
    const body = (await readBody(req)) || {};
    switch (gameActionRoute.action) {
      case "pin":
        game.isPinned = true;
        break;
      case "unpin":
        game.isPinned = false;
        break;
      case "favorite":
        game.isFavorite = true;
        break;
      case "unfavorite":
        game.isFavorite = false;
        break;
      case "playtime":
        game.playTimeInMilliseconds =
          body.playTimeInMilliseconds ?? game.playTimeInMilliseconds;
        game.lastTimePlayed = body.lastTimePlayed ?? game.lastTimePlayed;
        break;
      case "collection":
        game.collectionId = body.collectionId ?? null;
        break;
      default:
        break;
    }
    saveState();
    return sendJson(res, 200, game);
  }

  const gameDeleteRoute = routeMatch(pathname, "/profile/games/:id");
  if (method === "DELETE" && gameDeleteRoute) {
    state.games = state.games.filter((game) => game.id !== gameDeleteRoute.id);
    saveState();
    return sendJson(res, 200, { ok: true });
  }

  if (method === "GET" && pathname === "/profile/games/collections") {
    return sendJson(res, 200, state.collections);
  }

  if (method === "POST" && pathname === "/profile/games/collections") {
    const body = (await readBody(req)) || {};
    const collection = {
      id: crypto.randomUUID(),
      name: body.name || "Collection",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.collections.push(collection);
    saveState();
    return sendJson(res, 200, collection);
  }

  const collectionRoute = routeMatch(
    pathname,
    "/profile/games/collections/:id"
  );
  if (collectionRoute && method === "PUT") {
    const body = (await readBody(req)) || {};
    const collection = state.collections.find(
      (c) => c.id === collectionRoute.id
    );
    if (!collection)
      return sendJson(res, 404, { error: "Collection not found" });
    collection.name = body.name ?? collection.name;
    collection.updatedAt = new Date().toISOString();
    saveState();
    return sendJson(res, 200, collection);
  }

  if (collectionRoute && method === "DELETE") {
    state.collections = state.collections.filter(
      (c) => c.id !== collectionRoute.id
    );
    state.games = state.games.map((g) =>
      g.collectionId === collectionRoute.id ? { ...g, collectionId: null } : g
    );
    saveState();
    return sendJson(res, 200, { ok: true });
  }

  if (method === "POST" && pathname === "/profile/games/artifacts") {
    const body = (await readBody(req)) || {};
    const artifact = {
      id: crypto.randomUUID(),
      artifactLengthInBytes: body.artifactLengthInBytes || 0,
      downloadOptionTitle: body.downloadOptionTitle ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      hostname: body.hostname || "self-host",
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

  if (method === "GET" && pathname === "/profile/games/artifacts") {
    const objectId = searchParams.get("objectId");
    const shop = searchParams.get("shop");

    const artifacts = state.artifacts
      .filter(
        (artifact) => artifact.objectId === objectId && artifact.shop === shop
      )
      .map(
        ({ shop: _shop, objectId: _objectId, ...publicArtifact }) =>
          publicArtifact
      );

    return sendJson(res, 200, artifacts);
  }

  const artifactDownloadRoute = routeMatch(
    pathname,
    "/profile/games/artifacts/:id/download"
  );
  if (method === "GET" && artifactDownloadRoute) {
    const artifact = state.artifacts.find(
      (candidate) => candidate.id === artifactDownloadRoute.id
    );
    if (!artifact) return sendJson(res, 404, { error: "Artifact not found" });
    artifact.downloadCount += 1;
    artifact.updatedAt = new Date().toISOString();
    saveState();
    return sendJson(res, 200, {
      downloadUrl: `${PUBLIC_BASE_URL}/artifacts/${artifact.id}`,
    });
  }

  const artifactActionRoute = routeMatch(
    pathname,
    "/profile/games/artifacts/:id/:action"
  );
  if (method === "PUT" && artifactActionRoute) {
    const artifact = state.artifacts.find(
      (candidate) => candidate.id === artifactActionRoute.id
    );
    if (!artifact) return sendJson(res, 404, { error: "Artifact not found" });

    if (artifactActionRoute.action === "freeze") artifact.isFrozen = true;
    if (artifactActionRoute.action === "unfreeze") artifact.isFrozen = false;

    artifact.updatedAt = new Date().toISOString();
    saveState();
    return sendJson(res, 200, artifact);
  }

  const artifactRoute = routeMatch(pathname, "/profile/games/artifacts/:id");
  if (method === "PUT" && artifactRoute) {
    const body = (await readBody(req)) || {};
    const artifact = state.artifacts.find(
      (candidate) => candidate.id === artifactRoute.id
    );
    if (!artifact) return sendJson(res, 404, { error: "Artifact not found" });
    const label = body?.data?.label;
    if (typeof label === "string") artifact.label = label;
    artifact.updatedAt = new Date().toISOString();
    saveState();
    return sendJson(res, 200, artifact);
  }

  if (method === "DELETE" && artifactRoute) {
    const artifactFilePath = path.join(
      ARTIFACTS_DIR,
      `${artifactRoute.id}.tar`
    );
    state.artifacts = state.artifacts.filter(
      (candidate) => candidate.id !== artifactRoute.id
    );
    if (fs.existsSync(artifactFilePath)) fs.unlinkSync(artifactFilePath);
    saveState();
    return sendJson(res, 200, { ok: true });
  }

  const rawArtifactRoute = routeMatch(pathname, "/artifacts/:id");
  if (rawArtifactRoute && method === "PUT") {
    const payload = await readBody(req);
    if (!Buffer.isBuffer(payload))
      return sendJson(res, 400, { error: "Expected binary body" });

    const targetPath = path.join(ARTIFACTS_DIR, `${rawArtifactRoute.id}.tar`);
    fs.writeFileSync(targetPath, payload);
    return sendJson(res, 200, { ok: true });
  }

  if (rawArtifactRoute && method === "GET") {
    const targetPath = path.join(ARTIFACTS_DIR, `${rawArtifactRoute.id}.tar`);
    if (!fs.existsSync(targetPath))
      return sendJson(res, 404, { error: "Artifact file not found" });
    const file = fs.readFileSync(targetPath);
    res.writeHead(200, {
      "Content-Type": "application/tar",
      "Content-Length": file.length,
      "Access-Control-Allow-Origin": "*",
    });
    res.end(file);
    return;
  }

  const userRoute = routeMatch(pathname, "/users/:id");

  const userStatsRoute = routeMatch(pathname, "/users/:id/stats");
  if (method === "GET" && userStatsRoute) {
    const totalPlayTimeInSeconds = Math.floor(
      state.games.reduce(
        (acc, game) => acc + Number(game.playTimeInMilliseconds || 0),
        0
      ) / 1000
    );
    const unlockedAchievementSum = state.games.reduce((acc, game) => {
      const count = Array.isArray(game.achievements)
        ? game.achievements.length
        : 0;
      return acc + count;
    }, 0);

    return sendJson(res, 200, {
      libraryCount: state.games.length,
      friendsCount: 0,
      totalPlayTimeInSeconds: {
        value: totalPlayTimeInSeconds,
        topPercentile: 0,
      },
      achievementsPointsEarnedSum: {
        value: 0,
        topPercentile: 0,
      },
      unlockedAchievementSum,
    });
  }

  const userLibraryRoute = routeMatch(pathname, "/users/:id/library");
  if (method === "GET" && userLibraryRoute) {
    const take = Math.max(1, Number(searchParams.get("take") || 12));
    const skip = Math.max(0, Number(searchParams.get("skip") || 0));
    const sortBy = searchParams.get("sortBy") || "lastTimePlayed";

    const games = state.games.map(buildUserGame).toSorted((a, b) => {
      if (sortBy === "playTimeInSeconds") {
        return (b.playTimeInSeconds || 0) - (a.playTimeInSeconds || 0);
      }
      return (
        new Date(b.lastTimePlayed ?? 0).getTime() -
        new Date(a.lastTimePlayed ?? 0).getTime()
      );
    });

    return sendJson(res, 200, {
      library: games.slice(skip, skip + take),
      pinnedGames: games.filter((game) => game.isPinned),
    });
  }

  const compareAchievementsRoute = routeMatch(
    pathname,
    "/users/:id/games/achievements/compare"
  );
  if (method === "GET" && compareAchievementsRoute) {
    return sendJson(res, 200, {
      achievementsPointsTotal: 0,
      owner: {
        totalAchievementCount: 0,
        unlockedAchievementCount: 0,
        achievementsPointsEarnedSum: 0,
      },
      target: {
        displayName: state.user.displayName,
        profileImageUrl: state.user.profileImageUrl || "",
        totalAchievementCount: 0,
        unlockedAchievementCount: 0,
        achievementsPointsEarnedSum: 0,
      },
      achievements: [],
    });
  }

  if (method === "GET" && pathname === "/profile/friend-requests") {
    return sendJson(res, 200, state.friendRequests);
  }

  if (method === "POST" && pathname === "/profile/friend-requests") {
    const body = getRequestData((await readBody(req)) || {});
    const id = String(body.friendCode || body.id || crypto.randomUUID());
    const existing = state.friendRequests.find((request) => request.id === id);

    if (!existing) {
      state.friendRequests.push({
        id,
        displayName: body.displayName || `User ${id}`,
        profileImageUrl: null,
        type: "SENT",
      });
      saveState();
    }

    return sendJson(res, 200, { ok: true });
  }

  const friendRequestRoute = routeMatch(
    pathname,
    "/profile/friend-requests/:id"
  );
  if (friendRequestRoute && (method === "PATCH" || method === "DELETE")) {
    state.friendRequests = state.friendRequests.filter(
      (request) => request.id !== friendRequestRoute.id
    );
    saveState();
    return sendJson(res, 200, { ok: true });
  }

  if (method === "GET" && pathname === "/profile/notifications") {
    const filter = searchParams.get("filter") || "all";
    const take = Math.max(1, Number(searchParams.get("take") || 20));
    const skip = Math.max(0, Number(searchParams.get("skip") || 0));
    const notifications = state.notifications.toSorted(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const filtered =
      filter === "unread"
        ? notifications.filter((notification) => !notification.isRead)
        : notifications;
    const page = filtered.slice(skip, skip + take);

    return sendJson(res, 200, {
      notifications: page,
      pagination: {
        total: filtered.length,
        take,
        skip,
        hasMore: skip + take < filtered.length,
      },
    });
  }

  if (method === "GET" && pathname === "/profile/notifications/count") {
    return sendJson(res, 200, {
      count: state.notifications.filter((notification) => !notification.isRead)
        .length,
    });
  }

  if (method === "PATCH" && pathname === "/profile/notifications/all/read") {
    state.notifications = state.notifications.map((notification) => ({
      ...notification,
      isRead: true,
    }));
    saveState();
    return sendJson(res, 200, { ok: true });
  }

  const profileNotificationReadRoute = routeMatch(
    pathname,
    "/profile/notifications/:id/read"
  );
  if (method === "PATCH" && profileNotificationReadRoute) {
    const notification = state.notifications.find(
      (candidate) => candidate.id === profileNotificationReadRoute.id
    );
    if (notification) notification.isRead = true;
    saveState();
    return sendJson(res, 200, { ok: true });
  }

  const profileNotificationRoute = routeMatch(
    pathname,
    "/profile/notifications/:id"
  );
  if (method === "DELETE" && profileNotificationRoute) {
    state.notifications = state.notifications.filter(
      (candidate) => candidate.id !== profileNotificationRoute.id
    );
    saveState();
    return sendJson(res, 200, { ok: true });
  }

  if (method === "DELETE" && pathname === "/profile/notifications/all") {
    state.notifications = [];
    saveState();
    return sendJson(res, 200, { ok: true });
  }

  const blockUserRoute = routeMatch(pathname, "/users/:id/block");
  if (method === "POST" && blockUserRoute) {
    if (!state.blockedUserIds.includes(blockUserRoute.id)) {
      state.blockedUserIds.push(blockUserRoute.id);
      saveState();
    }
    return sendJson(res, 200, { ok: true });
  }

  const unblockUserRoute = routeMatch(pathname, "/users/:id/unblock");
  if (method === "POST" && unblockUserRoute) {
    state.blockedUserIds = state.blockedUserIds.filter(
      (id) => id !== unblockUserRoute.id
    );
    saveState();
    return sendJson(res, 200, { ok: true });
  }

  if (method === "GET" && pathname === "/badges") {
    return sendJson(res, 200, state.badges);
  }

  if (method === "GET" && userRoute) {
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

  if (method === "POST" && pathname === "/debrid/request-file") {
    return sendJson(res, 200, { downloadUrl: "" });
  }

  if (method === "PUT" && pathname === "/debrid/friend-request") {
    return sendJson(res, 200, { ok: true });
  }

  if (method === "POST" && pathname === "/hosters/unlock") {
    return sendJson(res, 200, { url: "" });
  }

  if (method === "GET" && pathname === "/decky/release") {
    return sendJson(res, 200, {
      version: "0.0.1-selfhost",
      downloadUrl: `${PUBLIC_BASE_URL}/decky/Hydra.zip`,
    });
  }

  if (method === "GET" && pathname === "/decky/Hydra.zip") {
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Length": EMPTY_ZIP_BUFFER.length,
      "Access-Control-Allow-Origin": "*",
    });
    res.end(EMPTY_ZIP_BUFFER);
    return;
  }

  return sendJson(res, 404, { error: `No route for ${method} ${pathname}` });
});

const wss = new WebSocketServer({ host: HOST, port: WS_PORT });

wss.on("connection", (ws) => {
  ws.on("message", (rawMessage) => {
    const message = rawMessage.toString();
    if (message === "PING") {
      ws.send("PONG");
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Hydra self-host backend API/Auth listening on ${HOST}:${PORT}`);
  console.log(`Hydra self-host backend WS listening on ${HOST}:${WS_PORT}`);
});
