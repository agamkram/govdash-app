/**
 * R page — USRAP refugee admissions / arrivals (RPC WRAPS public reports).
 * Baked snapshot — not live. Tap a state to expand nationalities.
 */

const WRAPS_URL = "./data/nested/wraps.json?v=2522";

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function fmt(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString("en-US");
}

function stateRows(data) {
  const by = data.arrivals?.byState || {};
  return Object.entries(by)
    .map(([name, row]) => ({ name, total: Number(row?.total) || 0, row }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

function nationalityRows(row) {
  return [...(row?.byNationality || [])].sort(
    (a, b) =>
      (b.total || 0) - (a.total || 0) ||
      String(a.name).localeCompare(String(b.name))
  );
}

export function createRefugeesPage(root) {
  const body = root.querySelector("#refugees-body");
  let data = null;
  let loadPromise = null;
  let openState = "";

  function setNote(msg) {
    body.replaceChildren(el("p", "fiscal-note", msg));
  }

  function render() {
    if (!data) return;
    body.replaceChildren();

    const hero = el("div", "refugees-hero");
    hero.append(el("p", "refugees-kicker", `FY${data.fiscalYear || "—"} admissions`));
    hero.append(el("p", "refugees-total", fmt(data.admissions?.total)));
    if (data.admissions?.ceiling != null) {
      hero.append(
        el("p", "refugees-sub", `of ${fmt(data.admissions.ceiling)} ceiling`)
      );
    }
    const countries = [...(data.admissions?.byCountry || [])].sort(
      (a, b) =>
        (b.total || 0) - (a.total || 0) ||
        String(a.name).localeCompare(String(b.name))
    );
    if (countries.length) {
      const nest = el("ul", "refugees-nations refugees-national-subs");
      for (const c of countries) {
        const li = el("li", "refugees-nation");
        li.append(el("span", "refugees-name", c.name));
        li.append(el("span", "refugees-num", fmt(c.total)));
        nest.append(li);
      }
      hero.append(nest);
    }
    if (data.period) hero.append(el("p", "fiscal-note", data.period));
    body.append(hero);

    const states = stateRows(data);
    if (states.length) {
      body.append(el("h3", "refugees-h", "By state"));
      const ul = el("ul", "refugees-list");
      for (const s of states) {
        const block = el("li", "refugees-block");
        const row = el("div", "refugees-row");
        const open = openState === s.name;
        const btn = el("button", "refugees-state-btn", s.name);
        btn.type = "button";
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        btn.addEventListener("click", () => {
          openState = open ? "" : s.name;
          render();
        });
        row.append(btn);
        row.append(el("span", "refugees-num", fmt(s.total)));
        block.append(row);

        if (open) {
          const nats = nationalityRows(s.row);
          const nest = el("ul", "refugees-nations");
          if (!nats.length) {
            nest.append(
              el("li", "refugees-nation fiscal-note", "No nationality rows in this bake.")
            );
          } else {
            for (const n of nats) {
              const li = el("li", "refugees-nation");
              li.append(el("span", "refugees-name", n.name));
              li.append(el("span", "refugees-num", fmt(n.total)));
              nest.append(li);
            }
          }
          block.append(nest);
        }
        ul.append(block);
      }
      body.append(ul);
    }

    body.append(
      el(
        "p",
        "fiscal-note",
        "Tap a state for nationality. Honest blank if no row. " +
          (data.note ||
            "USRAP only — monthly RPC snapshot. Not SIV, UAC, or ORR.")
      )
    );

    if (data.sourceUrl) {
      const actions = el("p", "fiscal-actions");
      const a = el("a", "btn", "RPC source");
      a.href = data.sourceUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      actions.append(a);
      body.append(actions);
    }
  }

  async function ensureData() {
    if (data) return data;
    if (loadPromise) return loadPromise;
    loadPromise = fetch(WRAPS_URL)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
        return data;
      })
      .catch((err) => {
        loadPromise = null;
        throw err;
      });
    return loadPromise;
  }

  async function show() {
    setNote("Loading…");
    try {
      await ensureData();
      render();
    } catch (err) {
      setNote(
        `Could not load refugee snapshot (${err.message || err}). Run npm run fetch:wraps.`
      );
    }
  }

  return { show };
}
