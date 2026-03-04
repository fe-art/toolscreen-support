// app.js - Shared core: YAML loading, model building, markdown renderer, mode switching

const COLORS = {
  question: "#6080c0",
  solution: "#509060",
  escalate: "#b08840",
  info: "#a09050",
};

const TYPE_LABELS = {
  question: "Question",
  solution: "Possible fix",
  escalate: "Further help needed",
  info: "Info",
};

const GUILD_ID = "1472102343381352539";

// ── Model ──────────────────────────────────────────────────────────────

const model = {
  meta: {},
  nodes: {},
  bugs: {},
  bugByNode: {},
  children: {},
  parents: {},
};

async function loadModel() {
  const [treeResp, bugsResp] = await Promise.all([
    fetch("troubleshooting-tree.yaml"),
    fetch("known-bugs.yaml"),
  ]);

  if (!treeResp.ok) throw new Error("Failed to load troubleshooting-tree.yaml");

  const treeYaml = jsyaml.load(await treeResp.text());
  model.meta = treeYaml.meta || {};
  model.nodes = treeYaml.nodes || {};

  if (bugsResp.ok) {
    const bugsYaml = jsyaml.load(await bugsResp.text());
    model.bugs = (bugsYaml && bugsYaml.bugs) || {};
    for (const [bugId, bug] of Object.entries(model.bugs)) {
      if (bug.status === "fixed") continue;
      for (const nodeId of bug.affects || []) {
        model.bugByNode[nodeId] = { ...bug, id: bugId };
      }
    }
  }

  model.children = computeChildren(model.nodes);
  model.parents = computeParents(model.nodes);
}

function computeChildren(nodes) {
  const children = {};
  for (const [id, node] of Object.entries(nodes)) {
    const refs = [];
    for (const opt of node.options || []) {
      if (opt.next) refs.push({ target: opt.next, edge: "option", label: opt.label });
    }
    if (node.did_not_help) {
      refs.push({ target: node.did_not_help, edge: "did_not_help", label: null });
    }
    if (node.next) {
      refs.push({ target: node.next, edge: "next", label: null });
    }
    children[id] = refs;
  }
  return children;
}

function computeParents(nodes) {
  const parents = {};
  for (const [id, node] of Object.entries(nodes)) {
    for (const opt of node.options || []) {
      if (opt.next) {
        (parents[opt.next] ||= []).push({ from: id, label: opt.label, edge: "option" });
      }
    }
    if (node.did_not_help) {
      (parents[node.did_not_help] ||= []).push({ from: id, label: "(didn't help)", edge: "did_not_help" });
    }
    if (node.next) {
      (parents[node.next] ||= []).push({ from: id, label: "(continue)", edge: "next" });
    }
  }
  return parents;
}

function threadUrl(threadId) {
  if (!threadId) return null;
  return `https://discord.com/channels/${GUILD_ID}/${threadId}`;
}

// ── Markdown-light renderer ────────────────────────────────────────────

function renderMarkdown(text) {
  if (!text) return "";
  const lines = text.split("\n");
  let html = "";
  let inOl = false;
  let inUl = false;
  let inCode = false;
  let codeLang = "";
  let codeContent = "";

  for (const rawLine of lines) {
    const line = rawLine;

    // Fenced code blocks
    if (line.trimStart().startsWith("```")) {
      if (!inCode) {
        inCode = true;
        codeLang = line.trim().slice(3);
        codeContent = "";
        continue;
      } else {
        html += `<pre><code>${escapeHtml(codeContent)}</code></pre>`;
        inCode = false;
        continue;
      }
    }
    if (inCode) {
      codeContent += (codeContent ? "\n" : "") + line;
      continue;
    }

    // Close lists if line doesn't continue them
    const isOlItem = /^\s*\d+[\.\)]\s/.test(line);
    const isUlItem = /^\s*[-*]\s/.test(line);

    if (inOl && !isOlItem) { html += "</ol>"; inOl = false; }
    if (inUl && !isUlItem) { html += "</ul>"; inUl = false; }

    if (isOlItem) {
      if (!inOl) { html += "<ol>"; inOl = true; }
      html += `<li>${renderInline(line.replace(/^\s*\d+[\.\)]\s/, ""))}</li>`;
    } else if (isUlItem) {
      if (!inUl) { html += "<ul>"; inUl = true; }
      html += `<li>${renderInline(line.replace(/^\s*[-*]\s/, ""))}</li>`;
    } else if (line.trim() === "") {
      html += "<br>";
    } else {
      html += `<p>${renderInline(line)}</p>`;
    }
  }

  if (inOl) html += "</ol>";
  if (inUl) html += "</ul>";
  if (inCode) html += `<pre><code>${escapeHtml(codeContent)}</code></pre>`;

  return html;
}

function renderInline(text) {
  let s = escapeHtml(text);
  // Bold
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic
  s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // Inline code
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Links [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // Bare URLs
  s = s.replace(/(^|[^"'>])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  // Discord channel refs <#id>
  s = s.replace(/&lt;#(\d+)&gt;/g, '<span class="channel-ref">#channel</span>');
  return s;
}

function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

// ── Utility ────────────────────────────────────────────────────────────

function truncate(text, max) {
  if (!text) return "";
  const first = text.split("\n").find((l) => l.trim()) || "";
  if (first.length <= max) return first;
  return first.slice(0, max - 1) + "\u2026";
}

function nodeStats(nodes) {
  const counts = { question: 0, solution: 0, info: 0, escalate: 0 };
  for (const n of Object.values(nodes)) {
    counts[n.type] = (counts[n.type] || 0) + 1;
  }
  return counts;
}

// ── Mode switching ─────────────────────────────────────────────────────

let currentMode = "wizard";

function switchMode(mode) {
  currentMode = mode;
  document.getElementById("wizard-view").hidden = mode !== "wizard";
  document.getElementById("treemap-view").hidden = mode !== "treemap";
  for (const tab of document.querySelectorAll(".tab")) {
    tab.classList.toggle("active", tab.dataset.mode === mode);
  }
  if (mode === "treemap" && !treemapRendered) {
    renderTreemap();
    treemapRendered = true;
  }
}

let treemapRendered = false;

// ── Init ───────────────────────────────────────────────────────────────

async function init() {
  // Init Mermaid with dark theme and click support
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    securityLevel: "loose",
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true,
      curve: "basis",
      rankSpacing: 50,
      nodeSpacing: 30,
    },
    themeVariables: {
      darkMode: true,
      background: "#1a1a1a",
      primaryColor: "#6080c0",
      primaryTextColor: "#d0d0d0",
      primaryBorderColor: "#506888",
      lineColor: "#555555",
      secondaryColor: "#252525",
      tertiaryColor: "#333333",
      fontFamily: "sans-serif",
      fontSize: "13px",
    },
  });

  try {
    await loadModel();
  } catch (err) {
    document.getElementById("node-card").innerHTML =
      `<p class="error">Failed to load troubleshooting data: ${escapeHtml(err.message)}<br>Try refreshing the page.</p>`;
    return;
  }

  // Meta info
  const stats = nodeStats(model.nodes);
  document.getElementById("meta-info").textContent =
    `v${model.meta.version || "?"} \u00b7 Updated ${model.meta.updated || "?"} \u00b7 ${Object.keys(model.nodes).length} nodes`;

  // Tab switching
  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => switchMode(tab.dataset.mode));
  }

  // Init wizard
  initWizard();

  // Check URL hash for initial mode/node
  const hash = location.hash.slice(1);
  if (hash.startsWith("tree:")) {
    switchMode("treemap");
  } else if (hash && model.nodes[hash]) {
    navigateWizard(hash);
  }
}

document.addEventListener("DOMContentLoaded", init);
