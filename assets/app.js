import { initExplorer } from "./explorer.js";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escape = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const normalize = value => value.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
const decimal = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" });
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0, useGrouping: "always" });
const order = new Intl.Collator("en-US", { sensitivity: "base", numeric: true });
const energy = value => `${decimal.format(value)} GWh`;
const percent = value => `${decimal.format(value)} %`;
const views = ["explorer", "plants", "data"];
const previousViews = { explorador: "explorer", mapa: "generation-map", resultados: "results", centrales: "plants", datos: "data", registro: "plants", operacion: "results" };
const repository = "https://github.com/Fernando3161/EcuadorElectricGrid";
const pageSize = 12;
let activeView;
let mapMode = "network";
let explorer;
let data;
let labels;
let plantPage = 0;

function route() {
  const hash = location.hash.slice(1);
  if (hash === "content" && activeView) return;
  const requested = Object.hasOwn(previousViews, hash) ? previousViews[hash] : hash;
  const results = requested === "results";
  activeView = views.includes(requested) ? requested : "explorer";
  for (const page of views) {
    $(`#view-${page}`).hidden = page !== activeView;
  }
  for (const link of $$(".navigation a")) {
    if (link.hash === `#${results ? "results" : activeView}`) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (activeView === "explorer" && !results) {
    mapMode = requested === "generation-map" ? "generation" : "network";
    explorer?.show(mapMode);
  }
  explorer?.dismissMenus();
  if (results) {
    $("#results").scrollIntoView();
  } else {
    window.scrollTo(0, 0);
  }
}

function renderMetrics() {
  const { generation_gwh, demand_gwh, peak_mw, unserved_gwh, accounting_gap_gwh } = data.summary;
  const rows = [
    ["Domestic generation", decimal.format(generation_gwh), "GWh", "Annual output from domestic power plants", "bolt"],
    ["SNI demand", decimal.format(demand_gwh), "GWh", "Annual demand in mainland Ecuador", "hist"],
    ["Peak demand", decimal.format(peak_mw), "MW", "Highest hourly demand of the year", "pulse"],
    ["Unserved energy", decimal.format(unserved_gwh), "GWh", "Annual result from the simulation", "node"],
  ];
  $("#summary-metrics").innerHTML = rows.map(([name, value, unit, detail, glyph]) =>
    `<article class="metric">
      <div class="metric-head"><span class="metric-icon">${icon(glyph)}</span>${name}</div>
      <div class="metric-value">${value}<span>${unit}</span></div>
      <p class="metric-detail">${detail}</p>
    </article>`
  ).join("");
  $("#reference-gap").textContent = energy(accounting_gap_gwh);
  const nonconventional = data.mix.find(row => row.key === "nonconventional");
  $("#nonconv-gap").textContent = `${decimal.format(Math.abs(nonconventional.delta_pp))} pp`;
}

function renderMix(unit) {
  const isShare = unit === "pct";
  const max = isShare ? 100 : 25000;
  const format = isShare ? percent : decimal.format;
  $("#mix-caption").textContent = isShare
    ? "Each category’s share of annual supply in the model and reference."
    : "Annual energy by supply category in GWh.";
  for (const button of $$("[data-mix-unit]")) {
    button.setAttribute("aria-pressed", button.dataset.mixUnit === unit);
  }
  const rows = data.mix.map(row => {
    const model = row[`model_${unit}`];
    const reference = row[`reference_${unit}`];
    return `<div class="mix-row">
      <span class="mix-row-label">${escape(row.label)}</span>
      <span class="mix-tracks" aria-hidden="true"><i class="mix-bar model" style="--width:${100 * model / max}%"></i><i class="mix-bar reference" style="--width:${100 * reference / max}%"></i></span>
      <span class="mix-numbers"><span class="model"><span class="sr-only">Model </span>${format(model)}</span><span class="reference"><span class="sr-only">CENACE </span>${format(reference)}</span></span>
    </div>`;
  }).join("");
  const ticks = [0, .25, .5, .75, 1].map(t => `<span>${integer.format(Math.round(t * max))}${isShare ? "%" : ""}</span>`).join("");
  $("#mix-chart").innerHTML = `${rows}<div class="mix-axis" aria-hidden="true">${ticks}</div>`;
}

function renderBalance() {
  const s = data.summary;
  const groups = [
    ["SUPPLY", [["Domestic generation", s.generation_gwh, "energy"], ["Imports", s.imports_gwh, "exchange"]]],
    ["USE", [["SNI demand", s.demand_gwh, "demand"], ["Exports", s.exports_gwh, "exchange"]]],
  ];
  const body = groups.map(([name, rows]) => `<div class="balance-group">
      <p class="balance-label">${name}</p>
      <div class="balance-strip" aria-hidden="true">${rows.map(([, value, type]) =>
        `<i class="${type}" style="--width:${100 * value / s.supply_gwh}%"></i>`).join("")}</div>
      <dl class="balance-facts">${rows.map(([label, value, type]) =>
        `<div><dt><i class="balance-dot ${type}" aria-hidden="true"></i>${label}</dt><dd>${energy(value)}</dd></div>`).join("")}</dl>
    </div>`).join("");
  $("#balance-content").innerHTML = `
    <div class="balance-total">${decimal.format(s.supply_gwh)}<span>GWh</span></div>
    <p class="balance-description">Modeled annual supply</p>
    ${body}
    <div class="balance-net"><span>Net imports</span><b>${energy(s.net_imports_gwh)}</b></div>`;
}

function renderPlants() {
  const term = normalize($("#plant-search").value);
  const tech = $("#plant-tech").value;
  const sort = $("#plant-sort").value;
  const filtered = data.plants.filter(plant => (!tech || plant.technology === tech)
    && normalize(`${plant.name} ${plant.id} ${plant.province}`).includes(term));
  if (sort === "name") filtered.sort((a, b) => order.compare(a.name, b.name) || order.compare(a.id, b.id));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  plantPage = Math.max(0, Math.min(plantPage, pages - 1));
  const start = plantPage * pageSize;
  const visible = filtered.slice(start, start + pageSize);

  for (const button of $$("[data-plant-tech]")) {
    button.setAttribute("aria-pressed", button.dataset.plantTech === tech);
  }
  $("#plant-table").innerHTML = visible.length ? visible.map(plant => `
    <tr role="row">
      <td role="cell"><span class="plant-name">${escape(plant.name)}</span><span class="plant-id">${escape(plant.id)}</span></td>
      <td role="cell"><span class="cell-label" aria-hidden="true">Technology</span><span class="tech-chip"><i class="tech-dot" data-tech="${escape(plant.technology)}" aria-hidden="true"></i>${escape(labels[plant.technology])}</span></td>
      <td role="cell"><span class="cell-label" aria-hidden="true">Source province</span>${escape(plant.province || "—")}</td>
      <td role="cell" class="mono numeric"><span class="cell-label" aria-hidden="true">Annual generation</span>${energy(plant.gwh)}</td>
      <td role="cell" class="mono numeric"><span class="cell-label" aria-hidden="true">Domestic share</span>${percent(100 * plant.gwh / data.summary.generation_gwh)}</td>
    </tr>`
  ).join("") : '<tr role="row"><td role="cell" class="empty-cell" colspan="5">No plants match these filters.</td></tr>';
  const count = filtered.length;
  $("#plant-count").textContent = count > 1
    ? `${start + 1}–${start + visible.length} of ${count} records`
    : count === 1 ? "1 record" : "0 records";
  $("#plant-page").textContent = `${plantPage + 1} / ${pages}`;
  $("#plant-prev").disabled = plantPage === 0;
  $("#plant-next").disabled = plantPage >= pages - 1;
}

function setupPlants() {
  $("#plant-techs").innerHTML = data.technologies.map(({ key, label, gwh }) =>
    `<button class="tech-card" type="button" data-plant-tech="${escape(key)}" aria-pressed="false">
      <span class="tech-label"><i class="tech-dot" data-tech="${escape(key)}" aria-hidden="true"></i>${escape(label)}</span>
      <strong>${energy(gwh)}</strong>
    </button>`
  ).join("");
  const selector = $("#plant-tech");
  for (const { key, label } of data.technologies) selector.add(new Option(label, key));
  const resetPage = () => {
    plantPage = 0;
    renderPlants();
  };
  for (const button of $$("[data-plant-tech]")) {
    button.onclick = () => {
      selector.value = selector.value === button.dataset.plantTech ? "" : button.dataset.plantTech;
      resetPage();
    };
  }
  selector.onchange = resetPage;
  $("#plant-search").oninput = resetPage;
  $("#plant-sort").onchange = resetPage;
  $("#plant-prev").onclick = () => { plantPage -= 1; renderPlants(); };
  $("#plant-next").onclick = () => { plantPage += 1; renderPlants(); };
  renderPlants();
}

function renderSources() {
  const { source } = data;
  $("#link-doi").href = source.doi_url;
  $("#link-diagnostics").href = `${repository}/tree/${source.kpi_commit}/results/phase_06a`;
  $("#link-crosscheck").href = `${repository}/blob/${source.crosscheck_commit}/docs/linkedin_posts.md#post-1--building-a-usable-2022-grid-model`;
  $("#link-doi-commit").href = `${repository}/commit/${source.doi_commit}`;
  $("#link-validation").href = `${repository}/blob/${source.kpi_commit}/results/phase_06/validation_2022.csv`;
  $("#link-attachments").href = `${repository}/blob/${source.kpi_commit}/data/interim/network/generator_attachments_2022.csv`;
  $("#data-doi").textContent = source.doi;
  $("#data-branch").textContent = `${source.kpi_branch} · ${source.kpi_commit.slice(0, 10)}`;
  $("#data-doi-commit").textContent = source.doi_commit.slice(0, 10);
}

async function readJSON(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error(`Could not read ${path} (${response.status})`);
  return response.json();
}

async function start() {
  window.addEventListener("hashchange", route);
  route();
  const mapInputs = Promise.allSettled([readJSON("../data/model.json"), readJSON("cartography.json")]);
  data = await readJSON("../data/kpis-2022.json");
  labels = Object.fromEntries(data.technologies.map(({ key, label }) => [key, label]));
  renderMetrics();
  renderMix("pct");
  renderBalance();
  setupPlants();
  renderSources();
  for (const button of $$("[data-mix-unit]")) {
    button.onclick = () => renderMix(button.dataset.mixUnit);
  }
  try {
    const [model, geometry] = await mapInputs;
    if (model.status !== "fulfilled") throw model.reason;
    if (geometry.status !== "fulfilled") throw geometry.reason;
    explorer = initExplorer(model.value, geometry.value, data);
    explorer.show(mapMode);
  } catch (error) {
    console.error(error);
    $("#map-load-error").hidden = false;
  }
}

start().catch(error => {
  console.error(error);
  $("#load-error").hidden = false;
});
