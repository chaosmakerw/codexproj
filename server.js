const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 4173);
const DATA_DIR = path.join(__dirname, "data");
const PEOPLE_FILE = path.join(DATA_DIR, "people.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(PEOPLE_FILE);
  } catch {
    await fs.writeFile(PEOPLE_FILE, "[]\n", "utf8");
  }
}

async function readPeople() {
  await ensureStore();
  const raw = await fs.readFile(PEOPLE_FILE, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writePeople(people) {
  await ensureStore();
  await fs.writeFile(PEOPLE_FILE, `${JSON.stringify(people, null, 2)}\n`, "utf8");
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) {
      throw new Error("请求体太大，单次最多 5MB。");
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function normalizePerson(input) {
  const now = new Date().toISOString();
  return {
    id: input.id || crypto.randomUUID(),
    name: String(input.name || "").trim(),
    era: String(input.era || "").trim(),
    roles: Array.isArray(input.roles)
      ? input.roles.map((role) => String(role).trim()).filter(Boolean)
      : String(input.roles || "")
          .split(/[,，、\n]/)
          .map((role) => role.trim())
          .filter(Boolean),
    location: String(input.location || "").trim(),
    tags: Array.isArray(input.tags)
      ? input.tags.map((tag) => String(tag).trim()).filter(Boolean)
      : String(input.tags || "")
          .split(/[#，,、\s]+/)
          .map((tag) => tag.trim())
          .filter(Boolean),
    summary: String(input.summary || "").trim(),
    biography: String(input.biography || "").trim(),
    source: String(input.source || "").trim(),
    image: String(input.image || "").trim(),
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}

function textOf(person) {
  return [
    person.name,
    person.era,
    person.location,
    ...(person.roles || []),
    ...(person.tags || []),
    person.summary,
    person.biography,
    person.source,
  ]
    .join(" ")
    .toLowerCase();
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{Script=Han}\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .flatMap((token) => {
      if (!token) return [];
      if (/^\p{Script=Han}+$/u.test(token) && token.length > 2) {
        const grams = [token];
        for (let i = 0; i < token.length - 1; i += 1) {
          grams.push(token.slice(i, i + 2));
        }
        return grams;
      }
      return [token];
    })
    .filter(Boolean);
}

function localSearch(query, people) {
  const terms = tokenize(query);
  if (!terms.length) {
    return people.map((person) => ({
      id: person.id,
      score: 0,
      reason: "显示全部记录。",
    }));
  }

  return people
    .map((person) => {
      const haystack = textOf(person);
      let score = 0;
      const hits = [];

      for (const term of terms) {
        if (haystack.includes(term)) {
          score += term.length > 1 ? 4 : 2;
          hits.push(term);
        }
      }

      if (person.name && String(query).includes(person.name)) score += 20;
      if ((person.roles || []).some((role) => String(query).includes(role))) score += 8;
      if ((person.tags || []).some((tag) => String(query).includes(tag))) score += 6;
      if (person.location && String(query).includes(person.location)) score += 5;

      const uniqueHits = [...new Set(hits)].slice(0, 6);
      return {
        id: person.id,
        score,
        reason: uniqueHits.length
          ? `匹配到 ${uniqueHits.join("、")} 等线索。`
          : "未发现明显文本匹配。",
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

function extractOutputText(payload) {
  return (
    payload.output_text ||
    payload.output?.flatMap((item) => item.content || [])
      .map((content) => content.text || "")
      .join("") ||
    ""
  );
}

function parseJsonObject(text) {
  const match = String(text || "").match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI 未返回可解析的 JSON。");
  return JSON.parse(match[0]);
}

function activeProvider() {
  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "local";
}

function providerName(provider = activeProvider()) {
  if (provider === "deepseek") return "DeepSeek";
  if (provider === "openai") return "OpenAI";
  return "本地检索";
}

function normalizeAiError(error, provider = activeProvider()) {
  const message = error.message || String(error);
  if (message === "fetch failed" || message.includes("fetch failed")) {
    const cause = error.cause?.code ? `底层错误：${error.cause.code}。` : "";
    return new Error(
      `无法连接 ${providerName(provider)} API。${cause}请检查网络/代理是否能访问接口，确认配置 API Key 后已经重启 server.js。`,
    );
  }
  return error;
}

async function diagnoseProvider() {
  const provider = activeProvider();
  const startedAt = Date.now();
  if (provider === "local") {
    return {
      provider,
      ok: false,
      message: "未配置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY。",
    };
  }

  const target =
    provider === "openai"
      ? "https://api.openai.com/v1/models"
      : "https://api.deepseek.com/models";
  try {
    const response = await fetch(target, {
      method: "GET",
      headers: {
        authorization:
          provider === "openai"
            ? `Bearer ${process.env.OPENAI_API_KEY}`
            : `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
    });
    return {
      provider,
      providerName: providerName(provider),
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      message: response.ok
        ? "API 连接正常。"
        : `API 返回 HTTP ${response.status}，通常是 Key 无效、权限不足或账户状态异常。`,
    };
  } catch (error) {
    return {
      provider,
      providerName: providerName(provider),
      ok: false,
      elapsedMs: Date.now() - startedAt,
      error: error.message,
      cause: error.cause?.code || "",
      message: normalizeAiError(error, provider).message,
    };
  }
}

async function callDeepSeekJson(messages, label) {
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
      messages,
      response_format: { type: "json_object" },
      stream: false,
      temperature: 0.2,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${label}失败：${response.status} ${detail}`);
  }

  const payload = await response.json();
  const text = payload.choices?.[0]?.message?.content || "";
  return parseJsonObject(text);
}

async function callOpenAIJson(input, label, options = {}) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: options.model || process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input,
      temperature: 0.2,
      ...(options.tools ? { tools: options.tools } : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${label}失败：${response.status} ${detail}`);
  }

  return parseJsonObject(extractOutputText(await response.json()));
}

async function aiSearch(query, people) {
  const provider = activeProvider();
  if (provider === "local" || !people.length) {
    return {
      mode: "local",
      results: localSearch(query, people),
      answer: "当前未配置 AI API Key，已使用本地智能检索排序。",
    };
  }

  const compactPeople = people.map((person) => ({
    id: person.id,
    name: person.name,
    era: person.era,
    roles: person.roles,
    location: person.location,
    tags: person.tags,
    summary: person.summary,
    biography: String(person.biography || "").slice(0, 1200),
  }));

  const prompt = [
    "你是“俗世神人”档案库的检索助手。这里记录的是网络上褒贬不一、评价分歧明显的公众人物、网红、博主或事件主角。",
    "根据用户问题，从候选记录中找出最相关的人。注意区分资料、评价和争议点，不要替用户下最终定论。",
    "只返回 JSON，格式为：{\"answer\":\"简短中文回答\",\"results\":[{\"id\":\"人物 id\",\"score\":0-100,\"reason\":\"一句中文理由\"}]}。",
    "不要编造资料库中没有的信息。",
    `用户问题：${query}`,
    `候选记录：${JSON.stringify(compactPeople)}`,
  ].join("\n\n");

  let parsed;
  try {
    parsed =
      provider === "deepseek"
        ? await callDeepSeekJson(
            [
              { role: "system", content: "你只输出 json，不输出 Markdown 或额外解释。" },
              { role: "user", content: prompt },
            ],
            "DeepSeek AI 搜索",
          )
        : await callOpenAIJson(prompt, "AI 搜索");
  } catch (error) {
    throw normalizeAiError(error, provider);
  }

  return {
    mode: provider,
    answer: parsed.answer || "已完成 AI 检索。",
    results: Array.isArray(parsed.results) ? parsed.results : [],
  };
}

async function buildPersonFromWeb(query) {
  const provider = activeProvider();
  if (provider === "local") {
    throw new Error("请先配置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY，再使用 AI 自动建档。");
  }

  const prompt = [
    "你是“俗世神人”档案库的资料整理助手。用户会给出一个人物名、网名或关键词。",
    provider === "openai"
      ? "请联网搜索公开资料，整理成一条中立、可追溯、适合入库的人物记录。"
      : "请根据模型已知资料整理成一条中立、适合入库的人物记录。你不能联网搜索，所以必须在正文开头注明“由 DeepSeek 生成，未联网检索，需人工核查”。",
    "这个档案库关注网络上褒贬不一、评价分歧明显的公众人物、网红、博主、创业者或事件主角。",
    "要求：",
    "1. 不要把未经证实的传闻写成事实。",
    "2. 正文必须区分：基本背景、走红/成名原因、主要争议、支持者观点、质疑者观点、可继续核查的问题。",
    "3. 如果人物不适合建档或资料不足，也要返回一条谨慎记录，并在正文说明资料不足。",
    "4. source 字段放 2-5 个可核查来源标题或链接，多个来源用换行分隔。",
    "5. tags 使用中文短标签。",
    "只返回 JSON，不要 Markdown。格式如下：",
    "{\"name\":\"名称或网名\",\"era\":\"活跃时期\",\"roles\":[\"身份\"],\"location\":\"主要平台或地区\",\"tags\":[\"标签\"],\"summary\":\"一句中立简评\",\"biography\":\"完整中文记录正文\",\"source\":\"来源列表\",\"image\":\"\"}",
    `用户输入：${query}`,
  ].join("\n");

  let parsed;
  try {
    parsed =
      provider === "deepseek"
        ? await callDeepSeekJson(
            [
              { role: "system", content: "你只输出 json，不输出 Markdown 或额外解释。" },
              { role: "user", content: prompt },
            ],
            "DeepSeek AI 自动建档",
          )
        : await callOpenAIJson(prompt, "AI 自动建档", {
            model: process.env.OPENAI_WEB_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
            tools: [{ type: "web_search_preview" }],
          });
  } catch (error) {
    throw normalizeAiError(error, provider);
  }

  const person = normalizePerson(parsed);
  if (!person.name || !person.biography) {
    throw new Error("AI 返回的记录缺少名称或正文。");
  }
  return person;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(__dirname, requested));

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const body = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { "content-type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

async function route(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/people") {
      sendJson(res, 200, { people: await readPeople() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      const provider = activeProvider();
      sendJson(res, 200, {
        provider,
        providerName: providerName(provider),
        hasDeepSeekKey: Boolean(process.env.DEEPSEEK_API_KEY),
        hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
        deepSeekModel: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
        openAIModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/diagnostics") {
      sendJson(res, 200, await diagnoseProvider());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/people") {
      const input = await readJson(req);
      const person = normalizePerson(input);
      if (!person.name || !person.biography) {
        sendJson(res, 400, { error: "名称和记录正文不能为空。" });
        return;
      }
      const people = await readPeople();
      const index = people.findIndex((item) => item.id === person.id);
      if (index >= 0) {
        person.createdAt = people[index].createdAt || person.createdAt;
        people[index] = person;
      } else {
        people.unshift(person);
      }
      await writePeople(people);
      sendJson(res, 200, { person });
      return;
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/people/")) {
      const id = decodeURIComponent(url.pathname.split("/").pop());
      const people = await readPeople();
      const next = people.filter((person) => person.id !== id);
      await writePeople(next);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/search") {
      const { query } = await readJson(req);
      const people = await readPeople();
      sendJson(res, 200, await aiSearch(String(query || ""), people));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/ai-import") {
      const { query } = await readJson(req);
      const cleanQuery = String(query || "").trim();
      if (!cleanQuery) {
        sendJson(res, 400, { error: "请输入人物名、网名或关键词。" });
        return;
      }

      const person = await buildPersonFromWeb(cleanQuery);
      const people = await readPeople();
      const index = people.findIndex((item) => item.name === person.name);
      if (index >= 0) {
        person.id = people[index].id;
        person.createdAt = people[index].createdAt || person.createdAt;
        people[index] = person;
      } else {
        people.unshift(person);
      }
      await writePeople(people);
      sendJson(res, 200, { person });
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    const message = error.message || "服务器错误。";
    const status =
      message.includes("OPENAI_API_KEY") || message.includes("DEEPSEEK_API_KEY") ? 400 : 500;
    sendJson(res, status, { error: message });
  }
}

ensureStore().then(() => {
  http.createServer(route).listen(PORT, () => {
    console.log(`俗世神人页面已启动：http://localhost:${PORT}`);
  });
});
