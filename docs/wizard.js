// wizard.js - Step-by-step wizard mode

const wizardState = {
  history: ["root"],
};

function currentNodeId() {
  return wizardState.history[wizardState.history.length - 1];
}

function initWizard() {
  renderWizard();
  window.addEventListener("popstate", () => {
    const hash = location.hash.slice(1);
    if (hash && model.nodes[hash] && currentMode === "wizard") {
      // Reconstruct history if navigating via browser back
      const idx = wizardState.history.lastIndexOf(hash);
      if (idx >= 0) {
        wizardState.history = wizardState.history.slice(0, idx + 1);
      } else {
        wizardState.history.push(hash);
      }
      renderWizard(true);
    }
  });
}

function navigateWizard(nodeId) {
  if (!model.nodes[nodeId]) return;
  wizardState.history.push(nodeId);
  history.pushState(null, "", `#${nodeId}`);
  renderWizard();
}

function goBack() {
  if (wizardState.history.length <= 1) return;
  wizardState.history.pop();
  const current = currentNodeId();
  history.pushState(null, "", `#${current}`);
  renderWizard();
}

function startOver() {
  wizardState.history = ["root"];
  history.pushState(null, "", "#root");
  renderWizard();
}

function showSolved() {
  const card = document.getElementById("node-card");
  card.innerHTML = "";
  card.className = "node-card solved";

  const badge = document.createElement("div");
  badge.className = "node-type-badge";
  badge.style.background = "#509060";
  badge.textContent = "Resolved";
  card.appendChild(badge);

  const text = document.createElement("div");
  text.className = "node-text";
  text.innerHTML = "<p>Glad that's sorted! Click <strong>Start over</strong> if anything else comes up.</p>";
  card.appendChild(text);

  const actions = document.createElement("div");
  actions.className = "node-actions";
  const startBtn = document.createElement("button");
  startBtn.className = "btn btn-secondary";
  startBtn.textContent = "Start over";
  startBtn.addEventListener("click", startOver);
  actions.appendChild(startBtn);
  card.appendChild(actions);
}

function renderWizard(skipPush) {
  const nodeId = currentNodeId();
  const node = model.nodes[nodeId];
  if (!node) return;

  // Breadcrumbs
  renderBreadcrumbs();

  // Card
  const card = document.getElementById("node-card");
  card.innerHTML = "";
  card.className = "node-card";
  card.style.borderLeftColor = COLORS[node.type] || "#888";

  // Type badge
  const badge = document.createElement("div");
  badge.className = "node-type-badge";
  badge.style.background = COLORS[node.type] || "#888";
  badge.textContent = TYPE_LABELS[node.type] || node.type;
  card.appendChild(badge);

  // Node ID (for maintainers, subtle)
  const idLabel = document.createElement("div");
  idLabel.className = "node-id-label";
  idLabel.textContent = nodeId;
  card.appendChild(idLabel);

  // Text content
  const text = document.createElement("div");
  text.className = "node-text";
  text.innerHTML = renderMarkdown(node.text);
  card.appendChild(text);

  // Known bug banner
  const bug = model.bugByNode[nodeId];
  if (bug) {
    const banner = document.createElement("div");
    banner.className = "bug-banner";
    const url = threadUrl(bug.discord_thread);
    banner.innerHTML = `<span class="bug-icon">&#9888;</span> <strong>Known issue:</strong> ${escapeHtml(bug.name)}` +
      (url ? ` &mdash; <a href="${url}" target="_blank" rel="noopener">track on Discord</a>` : "");
    card.appendChild(banner);
  }

  // Actions
  const actions = document.createElement("div");
  actions.className = "node-actions";

  if (node.type === "question") {
    for (const opt of node.options || []) {
      const btn = document.createElement("button");
      btn.className = "btn btn-option";
      btn.textContent = opt.label;
      btn.addEventListener("click", () => navigateWizard(opt.next));
      actions.appendChild(btn);
    }
  } else if (node.type === "solution") {
    const solvedBtn = document.createElement("button");
    solvedBtn.className = "btn btn-success";
    solvedBtn.textContent = "That fixed it!";
    solvedBtn.addEventListener("click", showSolved);
    actions.appendChild(solvedBtn);

    if (node.did_not_help) {
      const nextBtn = document.createElement("button");
      nextBtn.className = "btn btn-secondary";
      nextBtn.textContent = "Still having issues";
      nextBtn.addEventListener("click", () => navigateWizard(node.did_not_help));
      actions.appendChild(nextBtn);
    }
  } else if (node.type === "info") {
    if (node.next) {
      const btn = document.createElement("button");
      btn.className = "btn btn-primary";
      btn.textContent = "Continue";
      btn.addEventListener("click", () => navigateWizard(node.next));
      actions.appendChild(btn);
    }
  } else if (node.type === "escalate") {
    // Show collect prompts
    if (node.collect && node.collect.length > 0) {
      const collectDiv = document.createElement("div");
      collectDiv.className = "escalate-collect";
      collectDiv.innerHTML = "<p><strong>Please provide the following to a helper:</strong></p>";
      const ul = document.createElement("ul");
      for (const item of node.collect) {
        const li = document.createElement("li");
        li.innerHTML = renderInline(item.prompt);
        ul.appendChild(li);
      }
      collectDiv.appendChild(ul);
      card.appendChild(collectDiv);
    }
  }

  // Navigation row
  const nav = document.createElement("div");
  nav.className = "node-nav";

  if (wizardState.history.length > 1) {
    const backBtn = document.createElement("button");
    backBtn.className = "btn btn-ghost";
    backBtn.textContent = "\u2190 Back";
    backBtn.addEventListener("click", goBack);
    nav.appendChild(backBtn);
  }

  if (nodeId !== "root") {
    const overBtn = document.createElement("button");
    overBtn.className = "btn btn-ghost";
    overBtn.textContent = "Start over";
    overBtn.addEventListener("click", startOver);
    nav.appendChild(overBtn);
  }

  card.appendChild(actions);
  card.appendChild(nav);

  // Scroll to top of card
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderBreadcrumbs() {
  const bc = document.getElementById("breadcrumbs");
  bc.innerHTML = "";

  for (let i = 0; i < wizardState.history.length; i++) {
    const nid = wizardState.history[i];
    const node = model.nodes[nid];

    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "bc-sep";
      sep.textContent = "\u203a";
      bc.appendChild(sep);
    }

    const crumb = document.createElement("button");
    crumb.className = "bc-crumb";
    if (i === wizardState.history.length - 1) {
      crumb.classList.add("bc-current");
    }

    // Label: for root say "Start", for others use the option label that led here
    if (i === 0) {
      crumb.textContent = "Start";
    } else {
      const prevNid = wizardState.history[i - 1];
      const prevNode = model.nodes[prevNid];
      let label = nid;
      if (prevNode && prevNode.options) {
        const opt = prevNode.options.find((o) => o.next === nid);
        if (opt) label = truncate(opt.label, 40);
      } else if (prevNode && prevNode.did_not_help === nid) {
        label = "Didn't help";
      } else if (prevNode && prevNode.next === nid) {
        label = "Continue";
      }
      crumb.textContent = label;
    }

    const targetIdx = i;
    crumb.addEventListener("click", () => {
      wizardState.history = wizardState.history.slice(0, targetIdx + 1);
      const current = currentNodeId();
      history.pushState(null, "", `#${current}`);
      renderWizard();
    });

    bc.appendChild(crumb);
  }
}
