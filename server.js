const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HOST = '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DB_PATH = path.join(ROOT, 'yt_users_db.json');

const sessions = new Map();

function sendJson(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 5 * 1024 * 1024) reject(new Error('Body too large'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (_) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function readDb() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const db = JSON.parse(raw);
    return {
      users: Array.isArray(db.users) ? db.users : []
    };
  } catch (_) {
    return { users: [] };
  }
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

function hashPwd(pwd) {
  return crypto.createHash('sha256').update(String(pwd || '')).digest('hex');
}

function getAuthUser(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1].trim();
  return sessions.get(token) || null;
}

function toModelsUrl(baseUrl, provider) {
  const clean = String(baseUrl || '').trim().replace(/\/$/, '');
  if (provider === 'anthropic') {
    return [clean.replace(/\/messages(?:\?.*)?$/i, '/models'), `${clean}/models`];
  }
  if (provider === 'gemini') {
    const root = clean.replace(/\/models(?:\?.*)?$/i, '');
    return [`${root}/models`];
  }
  const urls = new Set();
  urls.add(clean.replace(/\/chat\/completions(?:\?.*)?$/i, '/models'));
  urls.add(clean.replace(/\/responses(?:\?.*)?$/i, '/models'));
  urls.add(clean.replace(/\/completions(?:\?.*)?$/i, '/models'));
  urls.add(`${clean}/models`);
  urls.add(`${clean}/v1/models`);
  if (/\/v\d+/i.test(clean)) urls.add(clean.replace(/(\/v\d+).*/, '$1/models'));
  try {
    const u = new URL(clean);
    urls.add(`${u.origin}/v1/models`);
    urls.add(`${u.origin}/models`);
  } catch (_) {}
  return [...urls];
}

async function detectModels({ provider, baseUrl, apiKey }) {
  if (provider === 'gemini') {
    const [url] = toModelsUrl(baseUrl, provider);
    const res = await fetch(`${url}?key=${encodeURIComponent(apiKey)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Gemini models error ${res.status}`);
    return (data.models || []).map((x) => (x.name || '').replace(/^models\//, '')).filter(Boolean);
  }

  if (provider === 'anthropic') {
    const urls = toModelsUrl(baseUrl, provider);
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
        });
        const data = await res.json();
        if (res.ok) {
          const models = (data.data || []).map((x) => x.id).filter(Boolean);
          if (models.length) return models;
        }
      } catch (_) {}
    }
    return [
      'claude-3-5-sonnet-latest',
      'claude-3-7-sonnet-latest',
      'claude-3-5-haiku-latest',
      'claude-3-opus-latest'
    ];
  }

  const urls = toModelsUrl(baseUrl, provider);
  let lastErr = '';
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
      const data = await res.json();
      if (!res.ok) {
        lastErr = data.error?.message || `HTTP ${res.status}`;
        continue;
      }
      const models = (data.data || []).map((x) => x.id || x.name).filter(Boolean);
      if (models.length) return models;
    } catch (e) {
      lastErr = e.message || String(e);
    }
  }
  throw new Error(`No models detected. ${lastErr}`);
}

function buildOpenAIChatUrls(baseUrl) {
  const clean = String(baseUrl || '').trim().replace(/\/$/, '');
  const urls = new Set();
  urls.add(clean);
  urls.add(`${clean}/chat/completions`);
  urls.add(`${clean}/v1/chat/completions`);
  if (clean.endsWith('/models')) {
    urls.add(clean.replace(/\/models$/, '/chat/completions'));
    urls.add(clean.replace(/\/models$/, '/v1/chat/completions'));
  }
  if (clean.endsWith('/v1')) urls.add(`${clean}/chat/completions`);
  return [...urls];
}

function buildAnthropicMessagesUrl(baseUrl) {
  const clean = String(baseUrl || '').trim().replace(/\/$/, '');
  if (/\/v1\/messages$/i.test(clean)) return clean;
  if (/\/v1$/i.test(clean)) return `${clean}/messages`;
  if (/\/o2a$/i.test(clean)) return `${clean}/v1/messages`;
  return `${clean}/v1/messages`;
}

function withTimeout(options, timeoutMs = 45000) {
  return { ...(options || {}), signal: AbortSignal.timeout(timeoutMs) };
}

function parseJsonLoose(raw) {
  const txt = String(raw || '').trim();
  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch (_) {
    return null;
  }
}

function extractDataUrlFromValue(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const m = value.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=\n\r]+/);
    if (m) return m[0].replace(/\s+/g, '');
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractDataUrlFromValue(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    if (typeof value.image_url === 'string' && value.image_url.startsWith('data:image/')) return value.image_url;
    if (typeof value.url === 'string' && value.url.startsWith('data:image/')) return value.url;
    for (const key of Object.keys(value)) {
      const found = extractDataUrlFromValue(value[key]);
      if (found) return found;
    }
  }
  return null;
}

async function runImage(payload) {
  const { baseUrl, apiKey, model, prompt } = payload;
  const cleanPrompt = String(prompt || '').trim();
  if (!baseUrl || !apiKey || !model || !cleanPrompt) throw new Error('[L2_PROXY_INVALID_INPUT] image 参数不完整');

  const body = {
    model,
    modalities: ['text', 'image'],
    messages: [{ role: 'user', content: cleanPrompt }]
  };

  let res;
  try {
    res = await fetch(baseUrl, withTimeout({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body)
    }, 70000));
  } catch (e) {
    throw new Error(`[L3_UPSTREAM_NETWORK] ${e.message || String(e)}`);
  }

  const rawText = await res.text();
  const contentType = res.headers.get('content-type') || '-';
  console.log(`[proxy/image upstream] status=${res.status} ct=${contentType} bytes=${rawText.length}`);

  if (!rawText || !rawText.trim()) {
    throw new Error(`[L3_UPSTREAM_EMPTY] image 接口返回空响应 (${res.status})`);
  }

  const data = parseJsonLoose(rawText);
  if (!data) {
    throw new Error(`[L3_UPSTREAM_NON_JSON] image 接口返回非JSON (${res.status}) ct=${contentType} body=${rawText.slice(0, 160)}`);
  }

  if (!res.ok) {
    throw new Error(`[L3_UPSTREAM_HTTP_${res.status}] ${data.error?.message || data.error || 'upstream error'}`);
  }

  const content = data.choices?.[0]?.message?.content;
  const dataUrl = extractDataUrlFromValue(content) || extractDataUrlFromValue(data);
  if (!dataUrl) {
    return { dataUrl: null, text: typeof content === 'string' ? content : JSON.stringify(content || '') };
  }
  return { dataUrl, text: typeof content === 'string' ? content : '' };
}

async function runChat(payload) {
  const { provider, baseUrl, apiKey, model, temperature, maxTokens, userPrompt, imageDataUrl } = payload;

  if (provider === 'anthropic') {
    const content = [{ type: 'text', text: userPrompt }];
    if (imageDataUrl) {
      const [meta, base64] = imageDataUrl.split(',');
      const mediaType = (meta.match(/data:(.*?);base64/) || [])[1] || 'image/png';
      content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } });
    }
    const res = await fetch(baseUrl, withTimeout({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature, messages: [{ role: 'user', content }] })
    }));
    const raw = await res.text();
    const data = parseJsonLoose(raw) || {};
    if (!res.ok) throw new Error(data.error?.message || `Anthropic error ${res.status}`);
    return data.content?.find((x) => x.type === 'text')?.text || '';
  }

  if (provider === 'gemini') {
    const root = String(baseUrl || '').trim().replace(/\/$/, '').replace(/\/models(?:\?.*)?$/i, '');
    const endpoint = `${root}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const parts = [{ text: userPrompt }];
    if (imageDataUrl) {
      const [meta, base64] = imageDataUrl.split(',');
      const mimeType = (meta.match(/data:(.*?);base64/) || [])[1] || 'image/png';
      parts.push({ inlineData: { mimeType, data: base64 } });
    }
    const res = await fetch(endpoint, withTimeout({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature, maxOutputTokens: maxTokens } })
    }));
    const raw = await res.text();
    const data = parseJsonLoose(raw) || {};
    if (!res.ok) throw new Error(data.error?.message || `Gemini error ${res.status}`);
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n') || '';
  }

  const content = imageDataUrl
    ? [{ type: 'text', text: userPrompt + '\n\n以下是YouTube后台受众截图。' }, { type: 'image_url', image_url: { url: imageDataUrl } }]
    : [{ type: 'text', text: userPrompt }];

  const payloadOpenAI = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: '你必须输出合法JSON，不要输出其他内容。' },
      { role: 'user', content }
    ]
  };

  let lastErr = '';

  // o2a-style gateways often expose image capability only on Anthropic /v1/messages.
  if (imageDataUrl && /\/o2a(?:\/|$)/i.test(String(baseUrl || ''))) {
    try {
      const anthropicUrl = buildAnthropicMessagesUrl(baseUrl);
      const [meta, base64] = imageDataUrl.split(',');
      const mediaType = (meta.match(/data:(.*?);base64/) || [])[1] || 'image/png';
      const res = await fetch(anthropicUrl, withTimeout({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } }
            ]
          }]
        })
      }, 120000));
      const raw = await res.text();
      const data = parseJsonLoose(raw) || {};
      if (res.ok) {
        const out = data.content?.find((x) => x.type === 'text')?.text || '';
        if (out) return out;
      } else {
        lastErr = data.error?.message || `HTTP ${res.status} from ${anthropicUrl}`;
      }
    } catch (e) {
      lastErr = e.message || String(e);
    }
  }

  const candidates = buildOpenAIChatUrls(baseUrl);
  for (const chatUrl of candidates) {
    try {
      const res = await fetch(chatUrl, withTimeout({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(payloadOpenAI)
      }));
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch (_) {
        lastErr = `非JSON响应(${res.status}) from ${chatUrl}`;
        continue;
      }
      if (!res.ok) {
        lastErr = data.error?.message || `HTTP ${res.status} from ${chatUrl}`;
        continue;
      }
      const out = data.choices?.[0]?.message?.content || data.output_text || '';
      if (out) return out;
      lastErr = `空响应 from ${chatUrl}`;
    } catch (e) {
      lastErr = e.message || String(e);
    }
  }

  // Only try Anthropic-style fallback for known gateway patterns.
  if (/\/o2a(?:\/|$)/i.test(String(baseUrl || ''))) {
    try {
      const anthropicUrl = buildAnthropicMessagesUrl(baseUrl);
      const contentParts = [{ type: 'text', text: userPrompt }];
      if (imageDataUrl) {
        const [meta, base64] = imageDataUrl.split(',');
        const mediaType = (meta.match(/data:(.*?);base64/) || [])[1] || 'image/png';
        contentParts.push({
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64 }
        });
      }

      const body = {
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: 'user', content: contentParts }]
      };
      const res = await fetch(anthropicUrl, withTimeout({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body)
      }, 120000));
      const raw = await res.text();
      const data = parseJsonLoose(raw) || {};
      if (res.ok) {
        const out = data.content?.find((x) => x.type === 'text')?.text || '';
        if (out) return out;
      } else {
        lastErr = data.error?.message || `HTTP ${res.status} from ${anthropicUrl}`;
      }
    } catch (e) {
      lastErr = e.message || String(e);
    }
  }

  const tried = candidates.join(' ; ');
  throw new Error(`OpenAI-compatible 调用失败: ${lastErr || 'unknown error'} | tried=${tried}`);
}

function serveIndex(res) {
  const f = path.join(ROOT, 'youtube_music_ai_planner.html');
  const html = fs.readFileSync(f, 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - startedAt}ms)`);
  });

  try {
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) return serveIndex(res);
    if (req.method === 'GET' && req.url === '/healthz') return sendJson(res, 200, { ok: true });

    if (req.method === 'POST' && req.url === '/auth/register') {
      const body = await parseBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!username || !password) return sendJson(res, 400, { error: 'username/password 不能为空' });
      const db = readDb();
      let user = db.users.find((u) => u.username === username);
      if (!user) {
        user = { username, passwordHash: hashPwd(password), presets: [], draft: null };
        db.users.push(user);
      } else {
        user.passwordHash = hashPwd(password);
      }
      writeDb(db);
      const token = crypto.randomUUID();
      sessions.set(token, username);
      return sendJson(res, 200, { token, username });
    }

    if (req.method === 'POST' && req.url === '/auth/login') {
      const body = await parseBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const db = readDb();
      const user = db.users.find((u) => u.username === username);
      if (!user || user.passwordHash !== hashPwd(password)) {
        return sendJson(res, 401, { error: '账号或密码错误' });
      }
      const token = crypto.randomUUID();
      sessions.set(token, username);
      return sendJson(res, 200, { token, username });
    }

    if (req.method === 'POST' && req.url === '/auth/logout') {
      const auth = req.headers.authorization || '';
      const m = auth.match(/^Bearer\s+(.+)$/i);
      if (m) sessions.delete(m[1].trim());
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && req.url === '/auth/me') {
      const username = getAuthUser(req);
      if (!username) return sendJson(res, 401, { error: '未登录' });
      return sendJson(res, 200, { username });
    }

    if (req.method === 'GET' && req.url === '/configs/list') {
      const username = getAuthUser(req);
      if (!username) return sendJson(res, 401, { error: '未登录' });
      const db = readDb();
      const user = db.users.find((u) => u.username === username);
      return sendJson(res, 200, { presets: user?.presets || [] });
    }

    if (req.method === 'POST' && req.url === '/configs/save') {
      const username = getAuthUser(req);
      if (!username) return sendJson(res, 401, { error: '未登录' });
      const body = await parseBody(req);
      const preset = body.preset;
      if (!preset || !preset.name) return sendJson(res, 400, { error: 'preset.name 不能为空' });
      const db = readDb();
      const user = db.users.find((u) => u.username === username);
      if (!user) return sendJson(res, 404, { error: '用户不存在' });
      user.presets = (user.presets || []).filter((x) => x.name !== preset.name);
      user.presets.unshift({ ...preset, updatedAt: Date.now() });
      user.presets = user.presets.slice(0, 50);
      writeDb(db);
      return sendJson(res, 200, { ok: true });
    }


    if (req.method === 'POST' && req.url === '/configs/rename') {
      const username = getAuthUser(req);
      if (!username) return sendJson(res, 401, { error: '未登录' });
      const body = await parseBody(req);
      const oldName = String(body.oldName || '').trim();
      const newName = String(body.newName || '').trim();
      if (!oldName || !newName) return sendJson(res, 400, { error: 'oldName/newName 不能为空' });
      const db = readDb();
      const user = db.users.find((u) => u.username === username);
      if (!user) return sendJson(res, 404, { error: '用户不存在' });
      const target = (user.presets || []).find((x) => x.name === oldName);
      if (!target) return sendJson(res, 404, { error: '原配置不存在' });
      if ((user.presets || []).some((x) => x.name === newName && x !== target)) {
        return sendJson(res, 409, { error: '新配置名称已存在' });
      }
      target.name = newName;
      target.updatedAt = Date.now();
      writeDb(db);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && req.url === '/draft/get') {
      const username = getAuthUser(req);
      if (!username) return sendJson(res, 401, { error: '未登录' });
      const db = readDb();
      const user = db.users.find((u) => u.username === username);
      return sendJson(res, 200, { draft: user?.draft || null });
    }

    if (req.method === 'POST' && req.url === '/draft/save') {
      const username = getAuthUser(req);
      if (!username) return sendJson(res, 401, { error: '未登录' });
      const body = await parseBody(req);
      const db = readDb();
      const user = db.users.find((u) => u.username === username);
      if (!user) return sendJson(res, 404, { error: '用户不存在' });
      user.draft = { ...(body.draft || {}), updatedAt: Date.now() };
      writeDb(db);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && req.url === '/configs/delete') {
      const username = getAuthUser(req);
      if (!username) return sendJson(res, 401, { error: '未登录' });
      const body = await parseBody(req);
      const name = String(body.name || '').trim();
      if (!name) return sendJson(res, 400, { error: 'name 不能为空' });
      const db = readDb();
      const user = db.users.find((u) => u.username === username);
      if (!user) return sendJson(res, 404, { error: '用户不存在' });
      user.presets = (user.presets || []).filter((x) => x.name !== name);
      writeDb(db);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && req.url === '/proxy/models') {
      const body = await parseBody(req);
      const models = await detectModels(body);
      return sendJson(res, 200, { models });
    }

    if (req.method === 'POST' && req.url === '/proxy/chat') {
      const body = await parseBody(req);
      console.log(`[proxy/chat] provider=${body.provider || '-'} model=${body.model || '-'} baseUrl=${String(body.baseUrl || '').slice(0, 120)}`);
      const text = await runChat(body);
      return sendJson(res, 200, { text });
    }

    if (req.method === 'POST' && req.url === '/proxy/image') {
      const body = await parseBody(req);
      console.log(`[proxy/image] model=${body.model || '-'} baseUrl=${String(body.baseUrl || '').slice(0, 120)} promptChars=${String(body.prompt || '').length}`);
      const result = await runImage(body);
      return sendJson(res, 200, result);
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error('[server-error]', e && e.stack ? e.stack : e);
    sendJson(res, 500, { error: e.message || String(e) });
  }
});

process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err && err.stack ? err.stack : err);
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack ? err.stack : err);
});

server.listen(PORT, HOST, () => {
  console.log(`youtube-ai server running on ${HOST}:${PORT}`);
});
