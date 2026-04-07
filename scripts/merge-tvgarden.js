const fs = require('fs/promises');
const { createHash } = require('crypto');

const GH_RAW = 'https://raw.githubusercontent.com/famelack/famelack-data/main';
const GH_API = 'https://api.github.com/repos/famelack/famelack-data/contents';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const headers = token => token
  ? { Authorization: `Bearer ${token}`, 'User-Agent': 'gh-actions' }
  : { 'User-Agent': 'gh-actions' };

const ZEE_EXACT_NAMES = new Set([
  'wion',
  'big magic',
  'bigmagic',
  'zing',
  'living entertainment',
  'india.com',
  'now tv',
  'intv australia'
].map(s => s.toLowerCase()));

const ZEE_NAME_PARTS = [
  'zee',
  'zee tv',
  'zee anmol',
  'zee cinema',
  'zee bollywood',
  'zee action',
  'zee classic',
  'zee cafe',
  'zee café',
  'zee bangla',
  'zee ganga',
  'zee bisskop',
  'zee kannada',
  'zee picchar',
  'zee keralam',
  'zee marathi',
  'zee yuva',
  'zee talkies',
  'zee chitramandir',
  'zee punjabi',
  'zee tamil',
  'zee thirai',
  'zee telugu',
  'zee cinemalu',
  'zee news',
  'zee business',
  'zee 24 taas',
  'zee24 taas',
  'zee zest',
  'zee aflam',
  'zee alwan',
  'zee one',
  'zee world',
  'zee bollynova',
  'zee magic',
  'zee bioskop',
  'zee mundo',
  'zee nung',
  'zee phim'
].map(s => s.toLowerCase());

const ZEE_URL_PARTS = [
  'zee5.com',
  'zeenews',
  'wionews'
].map(s => s.toLowerCase());

function slugify(s) {
  return (s || '').toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function normalizeName(s) {
  return (s || '').toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\btv\b/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function normalizeText(s) {
  return (s || '').toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function isZeeChannelName(name) {
  const n = normalizeText(name);
  if (!n) return false;
  if (n.startsWith('&')) return true;
  if (ZEE_EXACT_NAMES.has(n)) return true;
  return ZEE_NAME_PARTS.some(x => n.includes(x));
}

function isZeeUrl(url) {
  const u = normalizeText(url);
  if (!u) return false;
  return ZEE_URL_PARTS.some(x => u.includes(x));
}

function isYouTubeUrl(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    return h.includes('youtube.com') || h.includes('youtu.be') || h.includes('youtube-nocookie.com');
  } catch (_) {
    return false;
  }
}

function normalizeYouTubeUrl(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();

    if (h.includes('youtube-nocookie.com')) return url;

    if (h.includes('youtu.be')) {
      const id = u.pathname.replace(/^\//, '');
      if (id) return `https://www.youtube.com/watch?v=${id}`;
    }

    if (h.includes('youtube.com')) {
      if (u.pathname.startsWith('/embed/')) {
        const id = u.pathname.split('/').pop();
        if (id) return `https://www.youtube.com/watch?v=${id}`;
      }
      if (u.pathname === '/watch' && u.searchParams.get('v')) {
        return `https://www.youtube.com/watch?v=${u.searchParams.get('v')}`;
      }
      if (u.pathname.startsWith('/live/')) {
        const id = u.pathname.split('/').pop();
        if (id) return `https://www.youtube.com/watch?v=${id}`;
      }
    }

    return url;
  } catch (_) {
    return url;
  }
}

function generateStableId(name, country) {
  const uniqueString = `${name}|${country}`;
  const hash = createHash('sha256')
    .update(uniqueString, 'utf8')
    .digest('hex')
    .substring(0, 16);

  const baseSlug = slugify(name);
  if (baseSlug && baseSlug !== '' && baseSlug !== '-' && /[a-z]/.test(baseSlug)) {
    return `${baseSlug}.${country.toLowerCase()}`;
  }

  return `${hash}.${country.toLowerCase()}`;
}

async function fetchJson(url, token) {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, { headers: headers(token) });
    if (res.status === 404) return null;
    if (res.ok) return await res.json();
    await sleep(500 * (i + 1));
  }
  throw new Error(`Fetch failed: ${url}`);
}

async function loadTVGData(token) {
  let allChannels = await fetchJson(`${GH_RAW}/tv/raw/categories/all.json`, token);

  if (!Array.isArray(allChannels)) {
    console.log('Loading TVGarden channels by countries (fallback)');
    const countriesMeta = await fetchJson(`${GH_RAW}/tv/raw/countries_metadata.json`, token) || {};
    const codes = Object.keys(countriesMeta).map(k => k.toLowerCase());

    allChannels = [];
    for (const code of codes) {
      const u = `${GH_RAW}/tv/raw/countries/${code}.json`;
      const arr = await fetchJson(u, token);
      if (Array.isArray(arr)) allChannels.push(...arr);
      await sleep(60);
    }
  }

  const catFiles = ['all'];

  try {
    const arr = await fetchJson(`${GH_API}/tv/raw/categories`, token);
    if (Array.isArray(arr)) {
      arr
        .filter(e => e.type === 'file' && e.name.endsWith('.json') && e.name !== 'all.json')
        .forEach(e => catFiles.push(e.name.replace(/\.json$/, '')));
    }
  } catch (e) {
    console.log('Could not load category files:', e.message);
  }

  const categoriesByKey = new Map();
  for (const cat of catFiles) {
    const url = `${GH_RAW}/tv/raw/categories/${cat}.json`;
    const arr = await fetchJson(url, token);
    if (!Array.isArray(arr)) continue;

    for (const it of arr) {
      const key = `${normalizeName(it.name)}|${(it.country || '').toUpperCase()}`;
      if (!categoriesByKey.has(key)) categoriesByKey.set(key, new Set());
      if (cat !== 'all') categoriesByKey.get(key).add(cat);
    }

    await sleep(60);
  }

  return { channels: allChannels, categoriesByKey };
}

function dedupePush(set, v) {
  if (v != null) set.add(v);
}

async function merge(baseDir, token) {
  const [channels, streams, countries, categories, logos, blocklist] = await Promise.all([
    fs.readFile(`${baseDir}/channels.json`, 'utf8').then(JSON.parse),
    fs.readFile(`${baseDir}/streams.json`, 'utf8').then(JSON.parse),
    fs.readFile(`${baseDir}/countries.json`, 'utf8').then(JSON.parse),
    fs.readFile(`${baseDir}/categories.json`, 'utf8').then(JSON.parse),
    fs.readFile(`${baseDir}/logos.json`, 'utf8').then(JSON.parse),
    fs.readFile(`${baseDir}/blocklist.json`, 'utf8').then(JSON.parse),
  ]);

  const filteredChannels = channels.filter(c => !isZeeChannelName(c.name));
  const excludedExistingIds = new Set(
    channels
      .filter(c => isZeeChannelName(c.name))
      .map(c => c.id)
      .filter(Boolean)
  );

  const filteredStreams = streams.filter(s => {
    if (excludedExistingIds.has(s.channel)) return false;
    if (isZeeUrl(s.url)) return false;
    return true;
  });

  const channelsById = new Map(filteredChannels.map(c => [c.id, c]));
  const streamsByChannel = new Map();

  for (const s of filteredStreams) {
    const key = s.channel || '__null__';
    if (!streamsByChannel.has(key)) streamsByChannel.set(key, new Set());
    streamsByChannel.get(key).add(s.url);
  }

  const byKey = new Map(
    filteredChannels.map(c => [`${normalizeName(c.name)}|${(c.country || '').toUpperCase()}`, c])
  );

  const blocked = new Set(blocklist.map(b => b.channel));
  const { channels: tvgCh, categoriesByKey } = await loadTVGData(token);

  function resolveExistingByCountry(byKey, name, cc) {
    const norm = normalizeName(name);
    const key = `${norm}|${cc}`;
    if (byKey.has(key)) return byKey.get(key);

    const alt = cc === 'UK' ? 'GB' : (cc === 'GB' ? 'UK' : null);
    if (alt) {
      const key2 = `${norm}|${alt}`;
      if (byKey.has(key2)) {
        console.log(`Matched by country synonym ${cc}→${alt}: ${name}`);
        return byKey.get(key2);
      }
    }
    return null;
  }

  const ensureId = (name, cc) => {
    const baseId = generateStableId(name, cc);
    if (!channelsById.has(baseId)) return baseId;
    let i = 1;
    while (channelsById.has(`${baseId}-${i}`)) i++;
    return `${baseId}-${i}`;
  };

  const upsertCategories = (ch, extraCats) => {
    if (!extraCats || !extraCats.size) return;
    const set = new Set([...(ch.categories || []), ...Array.from(extraCats)]);
    ch.categories = Array.from(set);
  };

  const outStreams = [...filteredStreams];
  let addedChannels = 0, updatedChannels = 0, addedStreams = 0, skippedExcludedChannels = 0;

  const countryCodeMap = {
    'uk': 'UK',
    'en': 'US',
  };

  for (const it of tvgCh) {
    const name = (it.name || '').trim();
    let cc = (it.country || '').toUpperCase();

    if (isZeeChannelName(name)) {
      skippedExcludedChannels++;
      console.log(`Skipped Zee channel from merge: ${name}`);
      continue;
    }

    if (countryCodeMap[cc.toLowerCase()]) {
      cc = countryCodeMap[cc.toLowerCase()];
    }

    if (!name || cc.length !== 2) continue;

    const key = `${normalizeName(name)}|${cc}`;
    const existing = byKey.get(key) || resolveExistingByCountry(byKey, name, cc);
    const catSet = categoriesByKey.get(key) || new Set();
    if (catSet.size === 0) catSet.add('general');

    const urls = new Set();
    for (const u of (it.iptv_urls || [])) dedupePush(urls, u);
    for (const u of (it.youtube_urls || [])) dedupePush(urls, normalizeYouTubeUrl(u));

    const cleanedUrls = new Set([...urls].filter(u => !isZeeUrl(u)));
    if (cleanedUrls.size === 0) continue;

    if (existing) {
      upsertCategories(existing, catSet);
      const known = streamsByChannel.get(existing.id) || new Set();

      for (const url of cleanedUrls) {
        const allowed = !blocked.has(existing.id) || isYouTubeUrl(url);
        if (!known.has(url) && allowed) {
          outStreams.push({
            channel: existing.id,
            feed: null,
            title: name,
            url,
            referrer: null,
            user_agent: null,
            quality: null
          });
          known.add(url);
          addedStreams++;
        }
      }

      streamsByChannel.set(existing.id, known);
      updatedChannels++;
    } else {
      const id = ensureId(name, cc);
      const newCh = {
        id,
        name,
        alt_names: [],
        network: null,
        owners: [],
        country: cc,
        subdivision: null,
        city: null,
        categories: Array.from(catSet),
        is_nsfw: false,
        launched: null,
        closed: null,
        replaced_by: null,
        website: null
      };

      filteredChannels.push(newCh);
      channelsById.set(id, newCh);
      byKey.set(key, newCh);
      addedChannels++;
      console.log(`Added new channel: ${id} - ${name}`);

      if (!streamsByChannel.has(id)) streamsByChannel.set(id, new Set());
      const known = streamsByChannel.get(id);

      for (const url of cleanedUrls) {
        const allowed = !blocked.has(id) || isYouTubeUrl(url);
        if (!known.has(url) && allowed) {
          outStreams.push({
            channel: id,
            feed: null,
            title: name,
            url,
            referrer: null,
            user_agent: null,
            quality: null
          });
          known.add(url);
          addedStreams++;
        }
      }
    }
  }

  await fs.writeFile(`${baseDir}/channels.json`, JSON.stringify(filteredChannels, null, 2));
  await fs.writeFile(`${baseDir}/streams.json`, JSON.stringify(outStreams, null, 2));
  console.log(JSON.stringify({ addedChannels, updatedChannels, addedStreams, skippedExcludedChannels }));
}

(async () => {
  const baseDir = process.argv[2] || 'globetv.app';
  const token = process.env.GITHUB_TOKEN || process.env.TOKEN || '';
  await merge(baseDir, token);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
