const state = {
  people: [],
  reasons: new Map(),
  filter: "all",
  apiAvailable: true,
  dataMode: "local",
  user: null,
  role: "visitor",
};

const STORAGE_KEY = "people-archive-items";
const APP_CONFIG = window.APP_CONFIG || {};
const hasSupabaseConfig =
  APP_CONFIG.supabaseUrl &&
  APP_CONFIG.supabaseAnonKey &&
  !String(APP_CONFIG.supabaseUrl).includes("YOUR_") &&
  !String(APP_CONFIG.supabaseAnonKey).includes("YOUR_");
const supabaseClient =
  hasSupabaseConfig && window.supabase
    ? window.supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey)
    : null;

state.dataMode = supabaseClient ? "supabase" : "local";

const els = {
  count: document.querySelector("#personCount"),
  list: document.querySelector("#peopleList"),
  template: document.querySelector("#personCardTemplate"),
  form: document.querySelector("#personForm"),
  id: document.querySelector("#personId"),
  name: document.querySelector("#name"),
  era: document.querySelector("#era"),
  roles: document.querySelector("#roles"),
  location: document.querySelector("#location"),
  tags: document.querySelector("#tags"),
  summary: document.querySelector("#summary"),
  biography: document.querySelector("#biography"),
  source: document.querySelector("#source"),
  image: document.querySelector("#image"),
  file: document.querySelector("#fileInput"),
  reset: document.querySelector("#resetButton"),
  searchInput: document.querySelector("#searchInput"),
  searchButton: document.querySelector("#searchButton"),
  searchStatus: document.querySelector("#searchStatus"),
  authStatus: document.querySelector("#authStatus"),
  authRole: document.querySelector("#authRole"),
  authEmail: document.querySelector("#authEmail"),
  loginButton: document.querySelector("#loginButton"),
  logoutButton: document.querySelector("#logoutButton"),
  aiImportInput: document.querySelector("#aiImportInput"),
  aiImportButton: document.querySelector("#aiImportButton"),
  aiImportStatus: document.querySelector("#aiImportStatus"),
  exportButton: document.querySelector("#exportButton"),
  tabs: document.querySelectorAll(".tab"),
};

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

function localReadPeople() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function localWritePeople(people) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(people));
}

function splitList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "")
    .split(/[#，,、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeLocalPerson(input) {
  const now = new Date().toISOString();
  return {
    id: input.id || crypto.randomUUID(),
    name: String(input.name || "").trim(),
    era: String(input.era || "").trim(),
    roles: splitList(input.roles),
    location: String(input.location || "").trim(),
    tags: splitList(input.tags),
    summary: String(input.summary || "").trim(),
    biography: String(input.biography || "").trim(),
    source: String(input.source || "").trim(),
    image: String(input.image || "").trim(),
    status: ["approved", "pending", "rejected"].includes(input.status) ? input.status : "pending",
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9\s]/g, " ")
    .split(/\s+/)
    .flatMap((token) => {
      if (!token) return [];
      if (/^[\u4e00-\u9fa5]+$/.test(token) && token.length > 2) {
        const grams = [token];
        for (let i = 0; i < token.length - 1; i += 1) grams.push(token.slice(i, i + 2));
        return grams;
      }
      return [token];
    })
    .filter(Boolean);
}

function localSearch(query, people) {
  const terms = tokenize(query);
  return people
    .map((person) => {
      const haystack = [
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
      const hits = [];
      let score = 0;

      for (const term of terms) {
        if (haystack.includes(term)) {
          score += term.length > 1 ? 4 : 2;
          hits.push(term);
        }
      }
      if (person.name && query.includes(person.name)) score += 20;
      if ((person.roles || []).some((role) => query.includes(role))) score += 8;
      if ((person.tags || []).some((tag) => query.includes(tag))) score += 6;

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

function personMeta(person) {
  return [person.era, (person.roles || []).join(" / "), person.location]
    .filter(Boolean)
    .join(" · ");
}

function statusOf(person) {
  return ["approved", "pending", "rejected"].includes(person.status) ? person.status : "approved";
}

function statusLabel(status) {
  return {
    approved: "已通过",
    pending: "待审核",
    rejected: "已驳回",
  }[status];
}

function canReview() {
  if (!supabaseClient) return true;
  return ["reviewer", "admin"].includes(state.role);
}

function dbToPerson(row) {
  return {
    id: row.id,
    name: row.name || "",
    era: row.era || "",
    roles: row.roles || [],
    location: row.location || "",
    tags: row.tags || [],
    summary: row.summary || "",
    biography: row.biography || "",
    source: row.source || "",
    image: row.image || "",
    status: row.status || "pending",
    createdBy: row.created_by || "",
    reviewedBy: row.reviewed_by || "",
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
  };
}

function personToDb(input) {
  return {
    name: String(input.name || "").trim(),
    era: String(input.era || "").trim(),
    roles: splitList(input.roles),
    location: String(input.location || "").trim(),
    tags: splitList(input.tags),
    summary: String(input.summary || "").trim(),
    biography: String(input.biography || "").trim(),
    source: String(input.source || "").trim(),
    image: String(input.image || "").trim(),
    status: ["approved", "pending", "rejected"].includes(input.status) ? input.status : "pending",
  };
}

function renderAuth() {
  if (!supabaseClient) {
    els.authStatus.textContent = "本地模式";
    els.authRole.textContent = "未配置公共数据库。朋友投稿需要导出 JSON 后发给你审核。";
    els.authEmail.hidden = true;
    els.loginButton.hidden = true;
    els.logoutButton.hidden = true;
    return;
  }

  els.authEmail.hidden = Boolean(state.user);
  els.loginButton.hidden = Boolean(state.user);
  els.logoutButton.hidden = !state.user;

  if (!state.user) {
    els.authStatus.textContent = "公共数据库";
    els.authRole.textContent = "未登录：只能查看已通过记录。登录后可投稿。";
    return;
  }

  els.authStatus.textContent = state.user.email || "已登录";
  els.authRole.textContent = canReview()
    ? `权限：${state.role}，可审核投稿。`
    : "权限：contributor，可投稿并查看自己的待审核记录。";
}

function activePeople() {
  let people = [...state.people];
  if (state.filter === "recent") {
    people.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }
  if (state.filter === "tagged") {
    people = people.filter((person) => (person.tags || []).length);
  }
  if (["approved", "pending", "rejected"].includes(state.filter)) {
    people = people.filter((person) => statusOf(person) === state.filter);
  }
  if (state.reasons.size) {
    people = people
      .filter((person) => state.reasons.has(person.id))
      .sort((a, b) => state.reasons.get(b.id).score - state.reasons.get(a.id).score);
  }
  return people;
}

function render() {
  els.count.textContent = state.people.length;
  const people = activePeople();
  els.list.innerHTML = "";

  if (!people.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = state.people.length
      ? "没有符合条件的记录。"
      : "还没有记录，先从右侧写下第一个俗世神人。";
    els.list.append(empty);
    return;
  }

  for (const person of people) {
    const node = els.template.content.firstElementChild.cloneNode(true);
    const portrait = node.querySelector(".portrait");
    const heading = node.querySelector("h3");
    const meta = node.querySelector(".meta");
    const summary = node.querySelector(".summary");
    const tags = node.querySelector(".tags");
    const reason = node.querySelector(".reason");
    const badge = node.querySelector(".status-badge");
    const approveButton = node.querySelector('[data-action="approve"]');
    const rejectButton = node.querySelector('[data-action="reject"]');
    const status = statusOf(person);

    node.dataset.id = person.id;
    node.dataset.status = status;
    if (person.image) portrait.style.backgroundImage = `url("${escapeHtml(person.image)}")`;
    if (!person.image) portrait.textContent = person.name.slice(0, 1) || "?";
    heading.textContent = person.name;
    meta.textContent = personMeta(person) || "未填写年代、身份或地点";
    badge.textContent = statusLabel(status);
    badge.dataset.status = status;
    approveButton.hidden = !canReview() || status === "approved";
    rejectButton.hidden = !canReview() || status === "rejected";
    summary.textContent = person.summary || `${person.biography.slice(0, 130)}...`;
    tags.innerHTML = (person.tags || [])
      .slice(0, 10)
      .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
      .join("");

    const match = state.reasons.get(person.id);
    reason.textContent = match ? match.reason : person.source ? `来源 / 证据：${person.source}` : "";
    els.list.append(node);
  }
}

async function loadPeople() {
  if (supabaseClient) {
    await loadSupabasePeople();
    return;
  }

  try {
    const payload = await request("/api/people");
    state.people = payload.people || [];
    state.apiAvailable = true;
    els.searchStatus.textContent = "当前使用本地智能排序，稳定记录优先。";
    els.aiImportStatus.textContent = "有待开发。";
  } catch {
    state.people = localReadPeople();
    state.apiAvailable = false;
    els.searchStatus.textContent = "当前为纯静态模式：记录保存在本浏览器，本地搜索可用。";
    els.aiImportStatus.textContent = "有待开发。";
  }
  render();
}

async function loadSupabaseProfile() {
  const {
    data: { session },
  } = await supabaseClient.auth.getSession();
  state.user = session?.user || null;
  state.role = state.user ? "contributor" : "visitor";

  if (state.user) {
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("role")
      .eq("id", state.user.id)
      .maybeSingle();
    if (!error && data?.role) state.role = data.role;
  }
  renderAuth();
}

async function loadSupabasePeople() {
  state.apiAvailable = false;
  state.dataMode = "supabase";
  await loadSupabaseProfile();

  const { data, error } = await supabaseClient
    .from("people")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    state.people = [];
    els.searchStatus.textContent = `公共数据库读取失败：${error.message}`;
    render();
    return;
  }

  state.people = (data || []).map(dbToPerson);
  els.searchStatus.textContent = canReview()
    ? "公共数据库模式：可查看并审核待处理投稿。"
    : state.user
      ? "公共数据库模式：可投稿，投稿默认进入待审核。"
      : "公共数据库模式：未登录时只显示已通过记录。";
  els.aiImportStatus.textContent = "有待开发。";
  render();
}

function formData() {
  const existing = state.people.find((person) => person.id === els.id.value);
  return {
    id: els.id.value,
    name: els.name.value,
    era: els.era.value,
    roles: els.roles.value,
    location: els.location.value,
    tags: els.tags.value,
    summary: els.summary.value,
    biography: els.biography.value,
    source: els.source.value,
    image: els.image.value,
    status: existing ? statusOf(existing) : "pending",
  };
}

function resetForm() {
  els.form.reset();
  els.id.value = "";
  els.file.value = "";
}

function editPerson(person) {
  els.id.value = person.id;
  els.name.value = person.name || "";
  els.era.value = person.era || "";
  els.roles.value = (person.roles || []).join("，");
  els.location.value = person.location || "";
  els.tags.value = (person.tags || []).join(" ");
  els.summary.value = person.summary || "";
  els.biography.value = person.biography || "";
  els.source.value = person.source || "";
  els.image.value = person.image || "";
  document.querySelector(".editor").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function savePerson(payload) {
  if (supabaseClient) {
    if (!state.user) {
      throw new Error("请先用邮箱登录，再提交记录。");
    }

    const dbPayload = personToDb(payload);
    if (payload.id) {
      const { error } = await supabaseClient.from("people").update(dbPayload).eq("id", payload.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseClient.from("people").insert({
        ...dbPayload,
        status: "pending",
        created_by: state.user.id,
      });
      if (error) throw new Error(error.message);
    }
    return;
  }

  if (state.apiAvailable) {
    await request("/api/people", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return;
  }

  const person = normalizeLocalPerson(payload);
  const people = localReadPeople();
  const index = people.findIndex((item) => item.id === person.id);
  if (index >= 0) {
    person.createdAt = people[index].createdAt || person.createdAt;
    people[index] = person;
  } else {
    people.unshift(person);
  }
  localWritePeople(people);
}

async function updatePersonStatus(person, status) {
  if (supabaseClient) {
    if (!canReview()) throw new Error("只有审核员可以修改审核状态。");
    const { error } = await supabaseClient
      .from("people")
      .update({
        status,
        reviewed_by: state.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", person.id);
    if (error) throw new Error(error.message);
    return;
  }

  if (state.apiAvailable) {
    await request(`/api/people/${encodeURIComponent(person.id)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    return;
  }

  const people = localReadPeople();
  const index = people.findIndex((item) => item.id === person.id);
  if (index >= 0) {
    people[index] = {
      ...people[index],
      status,
      updatedAt: new Date().toISOString(),
    };
    localWritePeople(people);
  }
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.searchStatus.textContent = "正在保存记录...";
  try {
    await savePerson(formData());
    resetForm();
    state.reasons.clear();
    await loadPeople();
    els.searchStatus.textContent = "已保存。";
  } catch (error) {
    els.searchStatus.textContent = error.message;
  }
});

els.reset.addEventListener("click", resetForm);

els.list.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  const card = event.target.closest(".person-card");
  if (!button || !card) return;

  const person = state.people.find((item) => item.id === card.dataset.id);
  if (!person) return;

  if (button.dataset.action === "edit") {
    editPerson(person);
    return;
  }

  if (button.dataset.action === "approve" || button.dataset.action === "reject") {
    await updatePersonStatus(person, button.dataset.action === "approve" ? "approved" : "rejected");
    await loadPeople();
    return;
  }

  if (button.dataset.action === "delete") {
    const confirmed = window.confirm(`确定删除「${person.name}」吗？`);
    if (!confirmed) return;
    if (supabaseClient) {
      if (!canReview()) {
        els.searchStatus.textContent = "只有审核员可以删除公共数据库记录。";
        return;
      }
      const { error } = await supabaseClient.from("people").delete().eq("id", person.id);
      if (error) throw new Error(error.message);
    } else if (state.apiAvailable) {
      await request(`/api/people/${encodeURIComponent(person.id)}`, { method: "DELETE" });
    } else {
      localWritePeople(localReadPeople().filter((item) => item.id !== person.id));
    }
    state.reasons.delete(person.id);
    await loadPeople();
  }
});

els.file.addEventListener("change", async () => {
  const file = els.file.files?.[0];
  if (!file) return;

  const text = await file.text();
  if (file.name.toLowerCase().endsWith(".json")) {
    try {
      const data = JSON.parse(text);
      const people = Array.isArray(data) ? data : data.people;
      if (!Array.isArray(people)) throw new Error("JSON 需要是数组，或包含 people 数组。");
      for (const person of people) {
        await savePerson({
          ...person,
          status: ["approved", "pending", "rejected"].includes(person.status)
            ? person.status
            : "pending",
        });
      }
      await loadPeople();
      els.searchStatus.textContent = `已导入 ${people.length} 条记录，请在“待审核”里查看。`;
      return;
    } catch (error) {
      els.searchStatus.textContent = error.message;
      return;
    }
  }

  if (!els.name.value) {
    els.name.value = file.name.replace(/\.[^.]+$/, "");
  }
  els.biography.value = text.trim();
  if (!els.summary.value) {
    els.summary.value = text.trim().slice(0, 120);
  }
});

els.searchButton.addEventListener("click", async () => {
  const query = els.searchInput.value.trim();
  if (!query) {
    state.reasons.clear();
    els.searchStatus.textContent = "已清空搜索。";
    render();
    return;
  }

  els.searchButton.disabled = true;
  els.searchStatus.textContent = "正在搜索俗世神人档案...";
  try {
    const payload = {
      answer: "已使用本地智能检索排序。",
      results: localSearch(query, state.people),
    };
    state.reasons = new Map((payload.results || []).map((item) => [item.id, item]));
    els.searchStatus.textContent = `${payload.answer} 共找到 ${state.reasons.size} 条。`;
    render();
  } catch (error) {
    els.searchStatus.textContent = error.message;
  } finally {
    els.searchButton.disabled = false;
  }
});

els.searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    els.searchButton.click();
  }
});

els.loginButton.addEventListener("click", async () => {
  if (!supabaseClient) return;
  const email = els.authEmail.value.trim();
  if (!email) {
    els.searchStatus.textContent = "请输入邮箱。";
    return;
  }
  els.loginButton.disabled = true;
  try {
    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}${window.location.pathname}`,
      },
    });
    if (error) throw new Error(error.message);
    els.searchStatus.textContent = "登录链接已发送，请检查邮箱。";
  } catch (error) {
    els.searchStatus.textContent = error.message;
  } finally {
    els.loginButton.disabled = false;
  }
});

els.logoutButton.addEventListener("click", async () => {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  state.user = null;
  state.role = "visitor";
  state.reasons.clear();
  await loadPeople();
});

if (supabaseClient) {
  supabaseClient.auth.onAuthStateChange(async () => {
    await loadPeople();
  });
}

els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    els.tabs.forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    state.filter = tab.dataset.filter;
    render();
  });
});

els.exportButton.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state.people, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `people-archive-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

loadPeople().catch((error) => {
  els.searchStatus.textContent = error.message;
});
