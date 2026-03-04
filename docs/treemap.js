// treemap.js - Visual flowchart via Mermaid, one diagram per branch

let currentBranch = null;

function renderTreemap() {
  const rootNode = model.nodes.root;
  if (!rootNode) return;

  // Build branch selector
  const select = document.getElementById("branch-select");
  select.innerHTML = "";
  for (let i = 0; i < rootNode.options.length; i++) {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = rootNode.options[i].label;
    select.appendChild(opt);
  }

  select.addEventListener("change", () => {
    renderBranch(parseInt(select.value));
  });

  // Render first branch by default
  renderBranch(0);
}

function renderBranch(branchIndex) {
  const rootNode = model.nodes.root;
  const opt = rootNode.options[branchIndex];
  if (!opt) return;
  currentBranch = branchIndex;

  // Collect all nodes in this branch via DFS
  const branchNodes = new Set();
  const branchEdges = [];
  const visited = new Set();

  function dfs(nodeId) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    branchNodes.add(nodeId);

    const node = model.nodes[nodeId];
    if (!node) return;

    const children = model.children[nodeId] || [];
    for (const child of children) {
      const target = child.target;
      if (!model.nodes[target]) continue;

      branchEdges.push({
        from: nodeId,
        to: target,
        edge: child.edge,
        label: child.label,
      });

      // Only recurse if not visited (avoid infinite loops)
      // and if the target isn't already claimed by the branch
      if (!visited.has(target)) {
        dfs(target);
      }
    }
  }

  dfs(opt.next);

  // Generate Mermaid flowchart definition
  const lines = [];
  lines.push("flowchart TD");

  // Define node shapes based on type
  for (const nid of branchNodes) {
    const node = model.nodes[nid];
    const label = mermaidEscape(truncate(node.text, 70));
    const bug = model.bugByNode[nid];
    const bugMark = bug ? " ⚠" : "";

    if (node.type === "question") {
      lines.push(`  ${nid}{"${label}${bugMark}"}`);
    } else if (node.type === "solution") {
      lines.push(`  ${nid}["${label}${bugMark}"]`);
    } else if (node.type === "escalate") {
      lines.push(`  ${nid}[["${label}${bugMark}"]]`);
    } else {
      lines.push(`  ${nid}("${label}${bugMark}")`);
    }
  }

  lines.push("");

  // Define edges
  for (const e of branchEdges) {
    if (e.edge === "did_not_help") {
      lines.push(`  ${e.from} -.->|"didn't help"| ${e.to}`);
    } else if (e.edge === "next") {
      lines.push(`  ${e.from} --> ${e.to}`);
    } else if (e.label) {
      const label = mermaidEscape(truncate(e.label, 45));
      lines.push(`  ${e.from} -->|"${label}"| ${e.to}`);
    } else {
      lines.push(`  ${e.from} --> ${e.to}`);
    }
  }

  lines.push("");

  // Class definitions for node types
  lines.push("  classDef question fill:#5865F2,stroke:#4752c4,color:#fff,font-weight:bold");
  lines.push("  classDef solution fill:#248045,stroke:#1a5c31,color:#fff");
  lines.push("  classDef escalate fill:#F0B232,stroke:#c48f1f,color:#000,font-weight:bold");
  lines.push("  classDef info fill:#FEE75C,stroke:#cbb94a,color:#000");

  // Apply classes
  const byType = { question: [], solution: [], escalate: [], info: [] };
  for (const nid of branchNodes) {
    const t = model.nodes[nid].type;
    if (byType[t]) byType[t].push(nid);
  }
  for (const [type, nids] of Object.entries(byType)) {
    if (nids.length > 0) {
      lines.push(`  class ${nids.join(",")} ${type}`);
    }
  }

  // Click handlers
  for (const nid of branchNodes) {
    lines.push(`  click ${nid} onMermaidClick`);
  }

  const definition = lines.join("\n");

  // Render with Mermaid
  const container = document.getElementById("mermaid-graph");
  container.innerHTML = "";

  // Mermaid needs a fresh element with the definition as text
  const graphDiv = document.createElement("div");
  graphDiv.className = "mermaid";
  graphDiv.textContent = definition;
  container.appendChild(graphDiv);

  // Re-run mermaid on this element
  mermaid.run({ nodes: [graphDiv] }).catch((err) => {
    console.error("Mermaid render error:", err);
    container.innerHTML = `<pre class="error">${escapeHtml(err.message)}\n\n${escapeHtml(definition)}</pre>`;
  });

  // Update branch info
  const info = document.getElementById("branch-info");
  info.textContent = `${branchNodes.size} nodes \u00b7 ${branchEdges.length} edges`;
}

// Called by Mermaid click handlers
window.onMermaidClick = function (nodeId) {
  showNodeDetail(nodeId);
};

function showNodeDetail(nodeId) {
  const node = model.nodes[nodeId];
  if (!node) return;

  const panel = document.getElementById("node-detail");
  panel.innerHTML = "";
  panel.hidden = false;

  // Header
  const header = document.createElement("div");
  header.className = "detail-header";
  header.innerHTML = `
    <span class="node-dot" style="background:${COLORS[node.type] || "#888"}"></span>
    <code>${nodeId}</code>
    <span class="detail-type">${TYPE_LABELS[node.type] || node.type}</span>
    <button class="detail-close" title="Close">&times;</button>
  `;
  header.querySelector(".detail-close").addEventListener("click", () => {
    panel.hidden = true;
  });
  panel.appendChild(header);

  // Full text
  const text = document.createElement("div");
  text.className = "detail-text";
  text.innerHTML = renderMarkdown(node.text);
  panel.appendChild(text);

  // Bug info
  const bug = model.bugByNode[nodeId];
  if (bug) {
    const bugDiv = document.createElement("div");
    bugDiv.className = "bug-banner";
    const url = threadUrl(bug.discord_thread);
    bugDiv.innerHTML = `<strong>Known issue:</strong> ${escapeHtml(bug.name)}` +
      (url ? ` &mdash; <a href="${url}" target="_blank" rel="noopener">Discord thread</a>` : "") +
      `<br><small>Status: ${bug.status}</small>`;
    panel.appendChild(bugDiv);
  }

  // Outgoing edges
  const children = model.children[nodeId] || [];
  if (children.length > 0) {
    const edgesDiv = document.createElement("div");
    edgesDiv.className = "detail-section";
    edgesDiv.innerHTML = "<h4>Leads to</h4>";
    const ul = document.createElement("ul");
    for (const c of children) {
      const li = document.createElement("li");
      const edgeLabel = c.edge === "did_not_help" ? "didn't help" : c.edge === "next" ? "continue" : "";
      li.innerHTML = `
        ${edgeLabel ? `<span class="edge-label">${edgeLabel}</span>` : ""}
        ${c.label ? `<em>${escapeHtml(truncate(c.label, 50))}</em> &rarr; ` : ""}
        <code class="detail-node-link" data-node="${c.target}">${c.target}</code>
      `;
      li.querySelector(".detail-node-link").addEventListener("click", () => showNodeDetail(c.target));
      ul.appendChild(li);
    }
    edgesDiv.appendChild(ul);
    panel.appendChild(edgesDiv);
  }

  // Wizard link
  const wizLink = document.createElement("div");
  wizLink.className = "detail-section";
  const btn = document.createElement("button");
  btn.className = "btn btn-ghost btn-small";
  btn.textContent = "Open in wizard";
  btn.addEventListener("click", () => {
    switchMode("wizard");
    wizardState.history = ["root"];
    navigateWizard(nodeId);
  });
  wizLink.appendChild(btn);
  panel.appendChild(wizLink);
}

function mermaidEscape(text) {
  // Mermaid uses " for labels, so we escape inner quotes and special chars
  return text
    .replace(/"/g, "'")
    .replace(/[#;]/g, " ")
    .replace(/[<>{}]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, " ");
}
