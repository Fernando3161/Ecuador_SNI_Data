import { assetVoltage, GENERATION_COLORS, NetworkMap, prepareAssets, TYPES, VOLTAGES } from "./map.js";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const clean = value => String(value).replace(/[&<>"']/g, c => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
const normalize = value => value.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
const energyFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const coord = new Intl.NumberFormat("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const physical = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 5 });
const order = new Intl.Collator("en-US", { numeric: true });
const energy = gwh => `${energyFormat.format(gwh)} GWh`;

function groupGeneration(plants, buses) {
  const byBus = new Map();
  for (const plant of plants) {
    const items = byBus.get(plant.bus) ?? [];
    items.push(plant);
    byBus.set(plant.bus, items);
  }
  return [...byBus].map(([id, items]) => {
    const byTechnology = new Map();
    let gwh = 0;
    for (const plant of items) {
      gwh += plant.gwh;
      byTechnology.set(plant.technology, (byTechnology.get(plant.technology) ?? 0) + plant.gwh);
    }
    const [[technology]] = [...byTechnology].sort((a, b) => b[1] - a[1]);
    const bus = buses.get(id);
    return { id, type: "generation", bus, point: bus.point, gwh, technology, plants: items };
  }).sort((a, b) => b.gwh - a.gwh);
}

function networkFacts(asset) {
  if (asset.type === "buses") {
    return [
      ["Nominal voltage", assetVoltage(asset)],
      ["Latitude", `${coord.format(asset.lat)}°`],
      ["Longitude", `${coord.format(asset.lon)}°`],
      ["Connected lines", asset.connections.filter(item => item.type === "lines").length],
      ["Transformers", asset.connections.filter(item => item.type === "transformers").length],
    ];
  }
  const facts = [
    ["Nominal voltage", assetVoltage(asset)],
    ["Rated apparent power", `${physical.format(asset.mva)} MVA`],
  ];
  if (asset.type === "lines") facts.push(["Modeled line length", `${physical.format(asset.km)} km`], ["Parallel circuits", asset.circuits]);
  const unit = asset.type === "lines" ? "Ω" : "p. u.";
  facts.push(["Resistance", `${physical.format(asset.r)} ${unit}`], ["Reactance", `${physical.format(asset.x)} ${unit}`]);
  return facts;
}

function networkNeighbors(asset) {
  if (asset.type !== "buses") return [asset.origin, asset.end];
  return [...new Set(asset.connections.map(item => item.origin === asset ? item.end : item.origin))]
    .sort((a, b) => order.compare(a.id, b.id));
}

function factList(rows) {
  return rows.map(([label, value]) => `<div><dt>${clean(label)}</dt><dd class="mono">${clean(value)}</dd></div>`).join("");
}

export function initExplorer(model, geometry, annual) {
  const assets = prepareAssets(model);
  const allAssets = Object.values(assets).flat();
  const buses = new Map(assets.buses.map(bus => [bus.id, bus]));
  const totalGroups = groupGeneration(annual.plants, buses);
  const labels = Object.fromEntries(annual.technologies.map(({ key, label }) => [key, label]));
  const canvas = $("#grid-map");
  const map = new NetworkMap(canvas, geometry, assets, select);
  const search = $("#asset-search");
  const results = $("#search-results");
  const filter = $("#generation-tech");
  const detail = $("#asset-detail");
  const compactLayout = window.matchMedia("(max-width: 840px)");
  let selected = null;
  let mode;
  let groups = totalGroups;
  let matches = [];
  let searchIndex = -1;

  function toggleLayers(open) {
    $("#layer-menu").hidden = !open;
    $("#layer-button").setAttribute("aria-expanded", open);
  }

  function closeSearch() {
    results.hidden = true;
    search.setAttribute("aria-expanded", "false");
    search.removeAttribute("aria-activedescendant");
    searchIndex = -1;
  }

  function voltageMatches(asset) {
    return asset.type === "transformers"
      ? map.voltages.has(asset.kv0) || map.voltages.has(asset.kv1)
      : map.voltages.has(asset.kv);
  }

  function syncFilters() {
    for (const input of $$("[data-voltage]")) input.checked = map.voltages.has(Number(input.dataset.voltage));
    for (const item of $$("[data-legend-voltage]")) item.dataset.muted = !map.voltages.has(Number(item.dataset.legendVoltage));
    for (const input of $$("[data-layer]")) input.checked = map.layers[input.dataset.layer];
    for (const item of $$("[data-legend-layer]")) item.dataset.muted = !map.layers[item.dataset.legendLayer];
    for (const button of $$("[data-isolate]")) {
      const active = map.voltages.has(Number(button.dataset.isolate));
      button.setAttribute("aria-pressed", active && map.voltages.size === 1);
      button.dataset.muted = !active;
    }
    $("#voltage-hint").textContent = map.voltages.size === 1
      ? "Select that voltage again to show all levels."
      : "Select a voltage to filter the map.";
    if (mode === "network" && selected && (!voltageMatches(selected) || map.layers[selected.type] === false)) {
      select(null);
    }
    map.clearHover();
    map.repaint();
  }

  function renderBreakdown() {
    const counts = Object.fromEntries(VOLTAGES.map(kv => [kv, map.linesByVoltage[kv].length]));
    const max = Math.max(...Object.values(counts));
    $("#voltage-breakdown").innerHTML = VOLTAGES.map(kv => {
      const count = counts[kv];
      return `<button type="button" class="voltage-row" data-isolate="${kv}" aria-pressed="false" aria-label="Isolate ${kv} kV · ${count} lines">
        <span class="voltage-caption">${kv} kV</span><span class="track" aria-hidden="true"><span class="v${kv}" style="width:${100 * count / max}%"></span></span>
        <span class="voltage-count"><b>${count}</b> lines</span></button>`;
    }).join("");
    $("#topology-counts").innerHTML = Object.entries(TYPES).map(([key, type]) =>
      `<div><dt>${type.plural}</dt><dd>${assets[key].length}</dd></div>`
    ).join("");
  }

  function bubble(technology) {
    return `<i class="legend-bubble" style="--bubble:${GENERATION_COLORS[technology]}" aria-hidden="true"></i>`;
  }

  function updateGeneration() {
    const tech = filter.value;
    groups = tech ? groupGeneration(annual.plants.filter(plant => plant.technology === tech), buses) : totalGroups;
    map.setGeneration(groups, totalGroups[0].gwh);
    const count = groups.reduce((sum, group) => sum + group.plants.length, 0);
    const gwh = groups.reduce((sum, group) => sum + group.gwh, 0);
    $("#generation-map-total").innerHTML = `${energyFormat.format(gwh)} <span>GWh</span>`;
    $("#generation-map-count").textContent = `${groups.length} ${groups.length === 1 ? "bus" : "buses"} · ${count} generation ${count === 1 ? "record" : "records"}`;
    $("#generation-legend-tech").innerHTML = annual.technologies
      .filter(({ key }) => !tech || key === tech)
      .map(({ key, label }) => `<div>${bubble(key)}${clean(label)}</div>`).join("");
    $("#generation-ranking-list").innerHTML = groups.slice(0, 4).map((group, i) =>
      `<button type="button" class="generation-item" data-ranked-group="${i}">
        <span>${bubble(group.technology)}Bus ${clean(group.id)}</span><b>${energy(group.gwh)}</b></button>`
    ).join("");
    if (mode === "generation") select(null);
  }

  function select(asset, focus = false) {
    selected = asset;
    map.setSelected(asset);
    $("#map-overview").hidden = Boolean(asset);
    detail.hidden = !asset;
    if (!asset) {
      detail.replaceChildren();
      return;
    }
    const generation = asset.type === "generation";
    const type = generation ? { icon: "bolt", label: "Annual generation" } : TYPES[asset.type];
    const facts = generation
      ? [["Simulated energy", energy(asset.gwh)], ["Bus voltage", assetVoltage(asset.bus)],
        ["Generation records", asset.plants.length], ["Dominant technology", labels[asset.technology]]]
      : networkFacts(asset);
    const neighbors = generation ? [] : networkNeighbors(asset);
    const context = generation ? "Connection point in the 2022 model" : `Model asset ID · ${model.meta.year}`;
    const connections = neighbors.length ? `
      <p class="section-label">CONNECTED BUSES</p>
      <div class="detail-connections">${neighbors.map((item, i) =>
        `<button type="button" class="asset-chip" data-neighbor="${i}">Bus ${clean(item.id)}</button>`
      ).join("")}</div>` : "";
    const plants = generation ? `
      <p class="section-label">ASSIGNED POWER PLANTS</p>
      <ul class="generation-plant-list">${asset.plants.map(plant =>
        `<li><span>${clean(plant.name)}</span><b>${energy(plant.gwh)}</b></li>`
      ).join("")}</ul>
      <a href="#plants" class="forward">Browse power plants ${icon("arrow")}</a>` : "";
    detail.innerHTML = `<div class="detail-top"><span class="side-icon">${icon(type.icon)}</span>
      <span class="detail-kind">${type.label}</span>
      <button type="button" id="close-detail" class="icon-button" aria-label="Close details">${icon("close")}</button></div>
      <h2 id="detail-heading" tabindex="-1">${clean(generation ? `Bus ${asset.id}` : asset.id)}</h2>
      <p class="detail-sub">${clean(context)}</p>
      <dl class="fact-list">${factList(facts)}</dl>
      ${connections}${plants}
      <p class="detail-caption">Source <span class="detail-id">${clean(generation ? "Notebook 06A · Bus assignments" : model.meta.file)}</span></p>`;
    $("#close-detail").onclick = () => {
      select(null);
      canvas.focus({ preventScroll: true });
      if (compactLayout.matches) canvas.scrollIntoView({ block: "nearest" });
    };
    for (const button of $$("[data-neighbor]")) {
      button.onclick = () => reveal(neighbors[Number(button.dataset.neighbor)]);
    }
    if (focus || compactLayout.matches) $("#detail-heading").focus({ preventScroll: true });
    if (compactLayout.matches) detail.scrollIntoView({ block: "start" });
  }

  function reveal(asset) {
    if (asset.type !== "generation") {
      if (asset.type === "transformers") {
        map.voltages.add(asset.kv0);
        map.voltages.add(asset.kv1);
      } else {
        map.voltages.add(asset.kv);
      }
      if (asset.type in map.layers) map.layers[asset.type] = true;
      syncFilters();
    }
    map.focusAsset(asset);
    select(asset, true);
  }

  function searchAssets() {
    const term = normalize(search.value);
    if (!term) {
      closeSearch();
      return;
    }
    const generation = mode === "generation";
    matches = (generation ? groups : allAssets).filter(asset => {
      const fields = generation ? ["Bus", asset.id, ...asset.plants.map(plant => plant.name)] : [TYPES[asset.type].label, asset.id];
      return normalize(fields.join(" ")).includes(term);
    }).sort((a, b) => Number(b.id === term) - Number(a.id === term) || order.compare(a.id, b.id)).slice(0, 8);
    searchIndex = -1;
    results.innerHTML = matches.length ? matches.map((asset, i) => {
      const type = generation ? { icon: "bolt", label: "Generation bus" } : TYPES[asset.type];
      return `<button type="button" role="option" aria-selected="false" tabindex="-1" id="suggestion-${i}" data-suggestion="${i}">${icon(type.icon)}${type.label}<code>${clean(asset.id)}</code></button>`;
    }).join("") : '<p role="status">No matching assets.</p>';
    results.hidden = false;
    search.setAttribute("aria-expanded", "true");
    search.removeAttribute("aria-activedescendant");
  }

  function choose(index) {
    const match = matches[index];
    if (!match) return;
    search.value = "";
    closeSearch();
    reveal(match);
  }

  function show(next) {
    if (mode === next) return;
    mode = next;
    const generation = next === "generation";
    map.setMode(next);
    map.resetView();
    select(null);
    closeSearch();
    toggleLayers(false);
    search.value = "";
    search.placeholder = generation ? "Plant or bus" : "Search by ID";
    search.setAttribute("aria-label", generation ? "Search for a plant or bus" : "Search for an asset by ID");
    for (const node of $$("[data-network-only]")) node.hidden = generation;
    for (const node of $$("[data-generation-only]")) node.hidden = !generation;
    for (const link of $$("[data-map-view]")) {
      if (link.dataset.mapView === next) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
    const heading = generation ? "Annual Generation Map" : "Transmission Map";
    $("#map-heading").textContent = heading;
    $("#map-description").textContent = generation ? "Connection buses · simulated GWh" : "Mainland Ecuador";
    $("#map-mode-label").textContent = generation ? "SIMULATED GENERATION" : "TRANSMISSION NETWORK";
    $("#map-footer-hint").textContent = generation ? "Select a bubble to see its power plants." : "Select an asset to view its details.";
    $("#map-footer-source").textContent = generation ? "Domestic generation · 06A" : "Schematic routes";
    $("#summary-file").textContent = generation ? "Notebook 06A · 2022 base case" : model.meta.file;
    $("#grid-map").setAttribute("aria-label", `${heading}. Use the arrow keys to pan and the plus and minus keys to zoom.`);
    syncFilters();
  }

  renderBreakdown();
  for (const { key, label } of annual.technologies) filter.add(new Option(label, key));
  updateGeneration();

  $("#voltage-breakdown").onclick = event => {
    const button = event.target.closest("[data-isolate]");
    if (!button) return;
    const voltage = Number(button.dataset.isolate);
    map.voltages = new Set(button.getAttribute("aria-pressed") === "true" ? VOLTAGES : [voltage]);
    syncFilters();
  };
  filter.onchange = updateGeneration;
  $("#generation-ranking-list").onclick = event => {
    const button = event.target.closest("[data-ranked-group]");
    if (button) reveal(groups[Number(button.dataset.rankedGroup)]);
  };
  $("#layer-button").onclick = () => toggleLayers($("#layer-menu").hidden);
  $("#restore-layers").onclick = () => { map.resetLayers(); syncFilters(); };
  $("#layer-menu").onchange = ({ target }) => {
    const { voltage, layer } = target.dataset;
    if (voltage) {
      const value = Number(voltage);
      if (target.checked) map.voltages.add(value);
      else map.voltages.delete(value);
    }
    if (layer) map.layers[layer] = target.checked;
    syncFilters();
  };
  search.addEventListener("input", searchAssets);
  search.addEventListener("focus", searchAssets);
  search.addEventListener("keydown", event => {
    if (event.key === "Escape" || event.key === "Tab") closeSearch();
    if (results.hidden || !matches.length) return;
    if (event.key === "Enter") {
      event.preventDefault();
      choose(Math.max(searchIndex, 0));
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const increment = event.key === "ArrowDown" ? 1 : -1;
      searchIndex = searchIndex < 0 && increment < 0
        ? matches.length - 1 : (searchIndex + increment + matches.length) % matches.length;
      for (const option of $$("[data-suggestion]")) {
        option.setAttribute("aria-selected", Number(option.dataset.suggestion) === searchIndex);
      }
      search.setAttribute("aria-activedescendant", `suggestion-${searchIndex}`);
    }
  });
  results.onclick = event => {
    const option = event.target.closest("[data-suggestion]");
    if (option) choose(Number(option.dataset.suggestion));
  };
  document.addEventListener("pointerdown", event => {
    if (!event.target.closest("#map-search")) closeSearch();
    if (!event.target.closest("#layer-wrap")) toggleLayers(false);
  });
  document.addEventListener("keydown", event => {
    if ($("#view-explorer").hidden) return;
    if (event.key === "Escape" && !$("#layer-menu").hidden) {
      toggleLayers(false);
      $("#layer-button").focus();
    }
    if (event.key === "/" && !event.ctrlKey && !event.metaKey &&
        !event.target.closest("input, textarea, select, [contenteditable]")) {
      event.preventDefault();
      search.focus();
    }
  });
  return { show, dismissMenus: () => { closeSearch(); toggleLayers(false); } };
}
