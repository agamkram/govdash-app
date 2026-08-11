/**
 * ZIP page — your House seat and senators. Map has the chambers, not 435 names.
 */

export const YOU_NODES = {
  legislative: "gsa-1",
  house: "gsa-4",
  senate: "gsa-3",
};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function createYouPage(root, { onMap }) {
  const form = root.querySelector("#you-form");
  const input = root.querySelector("#you-zip");
  const body = root.querySelector("#you-body");
  let seq = 0;

  function setNote(msg) {
    body.replaceChildren(el("p", "fiscal-note", msg));
  }

  function render(data) {
    body.replaceChildren();
    const where = el("p", "you-where");
    const dist =
      data.atLarge || data.district === 0
        ? `${data.state} at-large`
        : `${data.state}-${data.district}`;
    where.textContent = `${data.city}, ${data.stateName} · ${dist}`;
    body.append(where);

    if (!data.members?.length) {
      body.append(el("p", "fiscal-note", "No sitting members matched this ZIP."));
      return;
    }

    const list = el("ul", "you-list");
    for (const m of data.members) {
      const li = el("li", "you-card");
      const chamber = m.chamber === "senate" ? "Senate" : "House";
      const seat =
        m.chamber === "senate"
          ? `${m.state} Senate`
          : data.atLarge || m.district === 0
            ? `${m.state} at-large`
            : `${m.state}-${m.district}`;
      li.append(el("p", "you-chamber", `${chamber} · ${seat}`));
      li.append(el("h3", "you-name", m.name));
      if (m.party) li.append(el("p", "you-party", m.party));
      const actions = el("p", "you-card-actions");
      if (m.url) {
        const a = el("a", "btn", "Site");
        a.href = m.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        actions.append(a);
      }
      if (m.phone) {
        const a = el("a", "btn", `Call ${m.phone}`);
        a.href = `tel:${String(m.phone).replace(/[^\d+]/g, "")}`;
        actions.append(a);
      }
      const mapBtn = el("button", "btn primary", "Map");
      mapBtn.type = "button";
      mapBtn.addEventListener("click", () => onMap?.(m.chamber));
      actions.append(mapBtn);
      li.append(actions);
      list.append(li);
    }
    body.append(list);

    const all = el("p", "fiscal-actions");
    const leg = el("button", "btn", "Legislative on the map");
    leg.type = "button";
    leg.addEventListener("click", () => onMap?.("legislative"));
    all.append(leg);
    body.append(all);

    body.append(
      el(
        "p",
        "fiscal-note",
        "Members from unitedstates/congress-legislators. District from Census ZIP point. A ZIP can touch more than one House seat — this is the centroid."
      )
    );
  }

  async function lookup(zip) {
    const z = String(zip || "").replace(/\D/g, "").slice(0, 5);
    if (!/^\d{5}$/.test(z)) {
      setNote("Five digits.");
      return;
    }
    localStorage.setItem("govdash-zip", z);
    input.value = z;
    const n = ++seq;
    setNote("Looking up…");
    return fetch(`/api/you?zip=${z}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (n !== seq) return json;
        render(json);
        return json;
      })
      .catch((err) => {
        if (n !== seq) return;
        setNote(`Could not look up ${z} (${err.message || err}).`);
      });
  }

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    lookup(input.value);
  });
  input?.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(0, 5);
  });

  function prepare() {
    const saved = localStorage.getItem("govdash-zip") || "";
    input.value = saved;
    if (/^\d{5}$/.test(saved)) lookup(saved);
    else setNote("Five digits. House seat and both senators.");
    setTimeout(() => input.focus(), 40);
  }

  return { prepare, lookup };
}
