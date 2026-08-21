/**
 * I page — Who comes in (timely monthly immigration flows).
 * Cards: NIV · IV · USRAP · SIV · Border. No merged total.
 */

const WRAPS_URL = "./data/nested/wraps.json?v=2530";
const SIV_URL = "./data/nested/siv.json?v=2530";
const CBP_URL = "./data/nested/cbp-encounters.json?v=2530";
const VISAS_URL = "./data/nested/visas.json?v=2530";

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

function stateRows(byState) {
  return Object.entries(byState || {})
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
  const kindEl = root.querySelector("[data-flows-kind]");
  const titleEl = root.querySelector("[data-flows-title]");
  const ledeEl = root.querySelector("[data-flows-lede]");

  let wraps = null;
  let siv = null;
  let cbp = null;
  let visas = null;
  /** @type {"home" | "niv" | "iv" | "usrap" | "siv" | "cbp"} */
  let view = "home";
  let openState = "";

  function setChrome(kind, title, lede) {
    if (kindEl) kindEl.textContent = kind;
    if (titleEl) titleEl.textContent = title;
    if (ledeEl) ledeEl.textContent = lede;
  }

  function setNote(msg) {
    body.replaceChildren(el("p", "fiscal-note", msg));
  }

  function backRow(onClick) {
    const p = el("p", "fiscal-actions flows-back-row");
    const btn = el("button", "btn", "← All flows");
    btn.type = "button";
    btn.addEventListener("click", onClick);
    p.append(btn);
    return p;
  }

  function cadencePill() {
    return el("span", "flows-cadence flows-cadence-month", "Updates monthly");
  }

  function loadJson(url) {
    return fetch(url).then(async (res) => {
      if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
      return res.json();
    });
  }

  function namedTotalList(title, rows) {
    const list = rows || [];
    if (!list.length) return;
    body.append(el("h3", "refugees-h", title));
    const ul = el("ul", "refugees-list");
    for (const row of list) {
      const li = el("li", "refugees-row");
      li.append(el("span", "refugees-name", row.name));
      li.append(el("span", "refugees-num", fmt(row.total)));
      ul.append(li);
    }
    body.append(ul);
  }

  function renderVisa(kind) {
    const data = kind === "niv" ? visas?.niv : visas?.iv;
    if (!data) {
      setNote(`No ${kind.toUpperCase()} bake yet. Run npm run fetch:visas.`);
      return;
    }
    const isNiv = kind === "niv";
    setChrome(
      isNiv ? "NIV" : "IV",
      isNiv ? "Nonimmigrant visas" : "Immigrant visas",
      isNiv
        ? "Consular nonimmigrant visa issuances for one month (State Department)."
        : "Consular immigrant visa issuances for one month (State Department)."
    );
    body.replaceChildren();
    body.append(
      backRow(() => {
        view = "home";
        openState = "";
        render();
      })
    );

    const hero = el("div", "refugees-hero");
    const head = el("div", "flows-card-head");
    head.append(
      el(
        "p",
        "refugees-kicker",
        `${data.asOfLabel || "Latest month"} · issuances`
      )
    );
    head.append(cadencePill());
    hero.append(head);
    hero.append(el("p", "refugees-total", fmt(data.total)));
    hero.append(
      el(
        "p",
        "refugees-sub",
        `One month only · not FYTD · FY${data.fiscalYear || "—"}`
      )
    );
    if (
      data.rowSum != null &&
      data.total != null &&
      Math.abs(data.rowSum - data.total) > 50
    ) {
      hero.append(
        el(
          "p",
          "fiscal-note",
          `PDF grand total ${fmt(data.total)}; parsed rows sum ${fmt(data.rowSum)}.`
        )
      );
    }
    body.append(hero);

    namedTotalList("By visa class (top)", data.byClass);
    namedTotalList("By nationality (top)", data.byNationality);

    body.append(
      el(
        "p",
        "fiscal-note",
        data.note ||
          "Issuances, not arrivals. Preliminary. Do not sum months for an FY total."
      )
    );
    const actions = el("p", "fiscal-actions");
    if (data.sourceUrl) {
      const a = el("a", "btn", "State tables");
      a.href = data.sourceUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      actions.append(a);
    }
    if (data.pdfUrl) {
      const a = el("a", "btn", "This month PDF");
      a.href = data.pdfUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      actions.append(a);
    }
    if (actions.childNodes.length) body.append(actions);
  }

  function renderHome() {
    setChrome(
      "Immigration",
      "Who comes in",
      "Monthly snapshots from State and CBP. Each card is its own count — not one total."
    );
    body.replaceChildren();
    const list = el("div", "flows-cards");

    const cards = [
      {
        id: "niv",
        title: "NIV",
        blurb: "Nonimmigrant visa issuances",
        total: visas?.niv?.total,
        sub: `${visas?.niv?.asOfLabel || "—"} · one month · State`,
      },
      {
        id: "iv",
        title: "IV",
        blurb: "Immigrant visa issuances",
        total: visas?.iv?.total,
        sub: `${visas?.iv?.asOfLabel || "—"} · one month · State`,
      },
      {
        id: "usrap",
        title: "USRAP",
        blurb: "Refugee admissions",
        total: wraps?.admissions?.total,
        sub:
          wraps?.admissions?.ceiling != null
            ? `of ${fmt(wraps.admissions.ceiling)} ceiling · ${wraps.asOfLabel || "—"} · RPC`
            : `${wraps?.asOfLabel || "—"} · RPC`,
      },
      {
        id: "siv",
        title: "SIV",
        blurb: "Afghan / Iraqi SIV arrivals",
        total: siv?.total,
        sub: `${siv?.asOfLabel || "—"} · RPC`,
      },
      {
        id: "cbp",
        title: "Border",
        blurb: "CBP encounters (SW lead)",
        total: cbp?.latestTotal,
        sub:
          cbp?.nationwide?.latestTotal != null
            ? `${cbp.asOfLabel || "—"} · SW · N ${fmt(cbp.northern?.latestTotal)} · US ${fmt(cbp.nationwide.latestTotal)}`
            : `${cbp?.asOfLabel || "—"} · CBP`,
      },
    ];

    for (const c of cards) {
      const btn = el("button", "flows-card");
      btn.type = "button";
      btn.addEventListener("click", () => {
        view = c.id;
        openState = "";
        render();
      });
      const head = el("div", "flows-card-head");
      head.append(el("span", "flows-card-title", c.title));
      head.append(cadencePill());
      btn.append(head);
      btn.append(el("p", "flows-card-blurb", c.blurb));
      btn.append(el("p", "refugees-total flows-card-total", fmt(c.total)));
      btn.append(el("p", "flows-card-sub", c.sub));
      list.append(btn);
    }
    body.append(list);
    body.append(
      el(
        "p",
        "fiscal-note",
        "Tap a card for detail. NIV/IV are issuances for one month — not FY year-to-date."
      )
    );
  }

  function renderStateList(byState, emptyNote) {
    const states = stateRows(byState);
    if (!states.length) {
      body.append(el("p", "fiscal-note", emptyNote || "No state rows."));
      return;
    }
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

  function renderUsrap() {
    const data = wraps;
    setChrome(
      "USRAP",
      "Who arrived · refugees",
      "U.S. Refugee Admissions Program from State/PRM RPC reports."
    );
    body.replaceChildren();
    body.append(
      backRow(() => {
        view = "home";
        openState = "";
        render();
      })
    );

    const hero = el("div", "refugees-hero");
    const head = el("div", "flows-card-head");
    head.append(el("p", "refugees-kicker", `FY${data.fiscalYear || "—"} admissions`));
    head.append(cadencePill());
    hero.append(head);
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

    renderStateList(data.arrivals?.byState);
    body.append(
      el(
        "p",
        "fiscal-note",
        "Tap a state for nationality. " +
          (data.note || "Monthly RPC snapshot. Historical months can move after reconciliation.")
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

  function renderSiv() {
    const data = siv;
    setChrome(
      "SIV",
      "Special Immigrant Visas",
      "Iraqi and Afghan SIV holders (+ derived family) who received DoS resettlement benefits."
    );
    body.replaceChildren();
    body.append(
      backRow(() => {
        view = "home";
        openState = "";
        render();
      })
    );

    const hero = el("div", "refugees-hero");
    const head = el("div", "flows-card-head");
    head.append(el("p", "refugees-kicker", `FY${data.fiscalYear || "—"} arrivals`));
    head.append(cadencePill());
    hero.append(head);
    hero.append(el("p", "refugees-total", fmt(data.total)));
    const countries = [...(data.byCountry || [])];
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
    if (data.rowSum != null && data.rowSum !== data.total) {
      hero.append(
        el(
          "p",
          "fiscal-note",
          `PDF grand total ${fmt(data.total)}; parsed state rows sum ${fmt(data.rowSum)}.`
        )
      );
    }
    body.append(hero);

    renderStateList(data.byState);
    body.append(
      el(
        "p",
        "fiscal-note",
        data.note ||
          "Monthly RPC snapshot. Historical months can move after reconciliation."
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

  function renderCbp() {
    const data = cbp;
    setChrome(
      "Border",
      "CBP encounters",
      "Southwest leads the card; northern and nationwide are the same month from CBP."
    );
    body.replaceChildren();
    body.append(
      backRow(() => {
        view = "home";
        openState = "";
        render();
      })
    );

    const hero = el("div", "refugees-hero");
    const head = el("div", "flows-card-head");
    head.append(
      el("p", "refugees-kicker", `${data.asOfLabel || "Latest month"} · Southwest`)
    );
    head.append(cadencePill());
    hero.append(head);
    hero.append(el("p", "refugees-total", fmt(data.latestTotal)));
    hero.append(
      el(
        "p",
        "refugees-sub",
        `FY${data.fiscalYear || "—"} YTD ${fmt(data.fytdTotal)} · SW land`
      )
    );
    body.append(hero);

    const regions = [
      {
        name: "Southwest land",
        latest: data.southwest?.latestTotal ?? data.latestTotal,
        fytd: data.southwest?.fytdTotal ?? data.fytdTotal,
      },
      {
        name: "Northern land",
        latest: data.northern?.latestTotal,
        fytd: data.northern?.fytdTotal,
      },
      {
        name: "Other (air / sea)",
        latest: data.other?.latestTotal,
        fytd: data.other?.fytdTotal,
      },
      {
        name: "Nationwide",
        latest: data.nationwide?.latestTotal,
        fytd: data.nationwide?.fytdTotal,
      },
    ].filter((r) => r.latest != null);

    if (regions.length) {
      body.append(el("h3", "refugees-h", `${data.asOfLabel || "Latest"} · by region`));
      const ul = el("ul", "refugees-list");
      for (const r of regions) {
        const row = el("li", "refugees-row");
        row.append(el("span", "refugees-name", r.name));
        const right = el("span", "refugees-num");
        right.textContent =
          r.fytd != null
            ? `${fmt(r.latest)} · YTD ${fmt(r.fytd)}`
            : fmt(r.latest);
        row.append(right);
        ul.append(row);
      }
      body.append(ul);
    }

    const demos = data.byDemographic || [];
    if (demos.length) {
      body.append(el("h3", "refugees-h", `Southwest · by group`));
      const ul = el("ul", "refugees-list");
      for (const d of demos) {
        const row = el("li", "refugees-row");
        row.append(el("span", "refugees-name", d.name));
        row.append(el("span", "refugees-num", fmt(d.total)));
        ul.append(row);
      }
      body.append(ul);
    }

    const months = data.southwest?.months || data.months || [];
    if (months.length) {
      body.append(
        el("h3", "refugees-h", `Southwest · FY${data.fiscalYear || ""} by month`)
      );
      const ul = el("ul", "refugees-list");
      for (const m of [...months].reverse()) {
        const row = el("li", "refugees-row");
        row.append(el("span", "refugees-name", m.month));
        row.append(el("span", "refugees-num", fmt(m.total)));
        ul.append(row);
      }
      body.append(ul);
    }

    body.append(el("p", "fiscal-note", data.note || ""));
    const actions = el("p", "fiscal-actions");
    if (data.sourceUrl) {
      const a = el("a", "btn", "Nationwide CBP");
      a.href = data.sourceUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      actions.append(a);
    }
    if (data.southwestSourceUrl) {
      const a = el("a", "btn", "SW border CBP");
      a.href = data.southwestSourceUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      actions.append(a);
    }
    if (actions.childNodes.length) body.append(actions);
  }

  function render() {
    if (view === "home") renderHome();
    else if (view === "niv") renderVisa("niv");
    else if (view === "iv") renderVisa("iv");
    else if (view === "usrap") renderUsrap();
    else if (view === "siv") renderSiv();
    else if (view === "cbp") renderCbp();
  }

  async function show() {
    view = "home";
    openState = "";
    setNote("Loading…");
    try {
      const results = await Promise.allSettled([
        loadJson(WRAPS_URL),
        loadJson(SIV_URL),
        loadJson(CBP_URL),
        loadJson(VISAS_URL),
      ]);
      if (results[0].status === "fulfilled") wraps = results[0].value;
      if (results[1].status === "fulfilled") siv = results[1].value;
      if (results[2].status === "fulfilled") cbp = results[2].value;
      if (results[3].status === "fulfilled") visas = results[3].value;
      if (!wraps && !siv && !cbp && !visas) {
        throw new Error(
          results
            .map((r) => (r.status === "rejected" ? r.reason?.message : ""))
            .filter(Boolean)
            .join("; ") || "no data"
        );
      }
      render();
    } catch (err) {
      setNote(
        `Could not load flow snapshots (${err.message || err}). Run npm run fetch:visas, fetch:wraps, and fetch:cbp.`
      );
    }
  }

  return { show };
}
