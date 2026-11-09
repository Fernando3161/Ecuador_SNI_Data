export const VOLTAGES = [500, 230, 138];
export const COLORS = { 500: "#edbd66", 230: "#58d3af", 138: "#83a9d7" };
export const GENERATION_COLORS = {
  hydro: "#72bcea",
  oil: "#e8a471",
  biomass: "#81cda4",
  biogas: "#b1ce83",
  solar: "#efd26d",
  onwind: "#ccafe7",
};
const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
export const TYPES = {
  buses: { label: "Bus", plural: "Buses", icon: "node" },
  lines: { label: "Line", plural: "Lines", icon: "line" },
  transformers: { label: "Transformer", plural: "Transformers", icon: "transformer" },
};

const WORLD = { x: -78.55, y: 1.64 };
const INITIAL_LAYERS = { buses: true, transformers: true, relief: true, labels: true, network: true };
const deg = Math.PI / 180;

function project(lon, lat) {
  return { x: lon, y: -Math.asinh(Math.tan(lat * deg)) / deg };
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function segmentDistance(p, a, b) {
  const x = b.x - a.x;
  const y = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * x + (p.y - a.y) * y) / (x * x + y * y || 1)));
  return Math.hypot(p.x - a.x - t * x, p.y - a.y - t * y);
}

export function prepareAssets(data) {
  const lookup = new Map();
  const byType = {};
  byType.buses = data.buses.map(row => {
    const item = { ...row, type: "buses", point: project(row.lon, row.lat), connections: [] };
    lookup.set(item.id, item);
    return item;
  });
  const sharedEndpoints = new Map();
  for (const type of ["lines", "transformers"]) {
    byType[type] = data[type].map(row => {
      const origin = lookup.get(row.origin);
      const end = lookup.get(row.end);
      const item = { ...row, type, origin, end, point: midpoint(origin.point, end.point), bend: 0 };
      origin.connections.push(item);
      end.connections.push(item);
      if (type === "lines") {
        const key = [row.origin, row.end].sort().join("/");
        const group = sharedEndpoints.get(key) ?? [];
        group.push(item);
        sharedEndpoints.set(key, group);
      }
      return item;
    });
  }
  for (const group of sharedEndpoints.values()) {
    group.forEach((item, index) => {
      const orientation = item.origin.id < item.end.id ? 1 : -1;
      item.bend = (index - (group.length - 1) / 2) * orientation;
    });
  }
  return byType;
}

export function assetVoltage(asset) {
  return asset.type === "transformers" ? `${asset.kv0} / ${asset.kv1} kV` : `${asset.kv} kV`;
}

export class NetworkMap {
  constructor(canvas, geometry, assets, onSelect) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.assets = assets;
    this.onSelect = onSelect;
    this.mode = "network";
    this.generation = [];
    this.generationHits = [];
    this.generationMaxGWh = 1;
    this.center = { ...WORLD };
    this.zoom = 1;
    this.voltages = new Set(VOLTAGES);
    this.layers = { ...INITIAL_LAYERS };
    this.linesByVoltage = Object.fromEntries(VOLTAGES.map(kv => [kv, assets.lines.filter(line => line.kv === kv)]));
    this.tooltip = document.querySelector("#map-tooltip");
    this.scaleIndicator = document.querySelector("#map-scale");
    this.countries = Object.entries(geometry.countries).map(([id, path]) => [id, new Path2D(path)]);
    this.land = new Path2D();
    for (const [, path] of this.countries) this.land.addPath(path);
    this.provinces = new Path2D(Object.values(geometry.admin1).join(""));
    this.rivers = new Path2D(geometry.rivers);
    this.cities = geometry.cities;
    this.terrain = geometry.terrain;
    this.relief = new Image();
    this.relief.onload = () => this.repaint();
    this.relief.src = new URL("ecuador-relief.webp", import.meta.url);
    this.hits = { buses: [], lines: [], transformers: [] };
    this.bindControls();
    new ResizeObserver(() => this.resize()).observe(canvas);
    document.fonts.ready.then(() => this.repaint());
  }

  resize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    this.width = width;
    this.height = height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.baseScale = Math.min(height / 6.55, width / 8.5);
    this.repaint();
  }

  get scale() {
    return this.baseScale * this.zoom;
  }

  screen(point) {
    return {
      x: (point.x - this.center.x) * this.scale + this.width / 2,
      y: (point.y - this.center.y) * this.scale + this.height / 2,
    };
  }

  repaint() {
    if (this.frame || !this.width) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.draw();
    });
  }

  zoomBy(factor, anchor = { x: this.width / 2, y: this.height / 2 }) {
    const before = this.scale;
    this.zoom = Math.min(12, Math.max(.72, this.zoom * factor));
    const rate = 1 / before - 1 / this.scale;
    this.center.x += (anchor.x - this.width / 2) * rate;
    this.center.y += (anchor.y - this.height / 2) * rate;
    this.clampCenter();
    this.clearHover();
    this.repaint();
  }

  clampCenter() {
    this.center.x = Math.min(-70.8, Math.max(-86, this.center.x));
    this.center.y = Math.min(7, Math.max(-5, this.center.y));
  }

  resetView() {
    this.center = { ...WORLD };
    this.zoom = 1;
    this.clearHover();
    this.repaint();
  }

  resetLayers() {
    this.voltages = new Set(VOLTAGES);
    this.layers = { ...INITIAL_LAYERS };
    this.repaint();
  }

  setMode(mode) {
    this.mode = mode;
    this.generationHits = [];
    this.clearHover();
    this.repaint();
  }

  setGeneration(groups, maxGWh) {
    this.generation = groups;
    this.generationMaxGWh = maxGWh;
    this.generationHits = [];
    this.clearHover();
    this.repaint();
  }

  focusAsset(asset) {
    const extent = asset.origin
      ? Math.max(Math.abs(asset.origin.point.x - asset.end.point.x), Math.abs(asset.origin.point.y - asset.end.point.y))
      : 0;
    this.zoom = Math.max(1.6, Math.min(3.8, 2.45 / (extent || .5)));
    this.center = { ...asset.point };
    this.clearHover();
    this.repaint();
  }

  setSelected(asset) {
    this.selected = asset;
    this.clearHover();
    this.repaint();
  }

  clearHover() {
    this.hovered = null;
    this.tooltip.hidden = true;
    this.canvas.classList.remove("is-hovering");
  }

  bindControls() {
    const canvas = this.canvas;
    const pos = event => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    document.querySelector("#zoom-in").addEventListener("click", () => this.zoomBy(1.33));
    document.querySelector("#zoom-out").addEventListener("click", () => this.zoomBy(1 / 1.33));
    document.querySelector("#zoom-fit").addEventListener("click", () => this.resetView());
    canvas.addEventListener("wheel", event => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      this.zoomBy(Math.exp(-Math.max(-170, Math.min(170, event.deltaY)) * .0025), pos(event));
    }, { passive: false });
    canvas.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      const p = pos(event);
      this.drag = { start: p, center: { ...this.center }, moved: false };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", event => {
      const p = pos(event);
      if (this.drag) {
        const dx = p.x - this.drag.start.x;
        const dy = p.y - this.drag.start.y;
        if (Math.hypot(dx, dy) > 3) this.drag.moved = true;
        if (this.drag.moved) {
          canvas.classList.add("is-dragging");
          this.center = { x: this.drag.center.x - dx / this.scale, y: this.drag.center.y - dy / this.scale };
          this.clampCenter();
          this.clearHover();
          this.repaint();
        }
      } else {
        this.hoverAt(p);
      }
    });
    canvas.addEventListener("pointerup", event => {
      if (this.drag && !this.drag.moved) this.onSelect(this.hitTest(pos(event)));
      this.drag = null;
      canvas.classList.remove("is-dragging");
    });
    canvas.addEventListener("pointercancel", () => {
      this.drag = null;
      this.clearHover();
      canvas.classList.remove("is-dragging");
      this.repaint();
    });
    canvas.addEventListener("pointerleave", () => {
      this.clearHover();
      this.repaint();
    });
    canvas.addEventListener("keydown", event => {
      const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (event.key in directions) {
        const [dx, dy] = directions[event.key];
        this.center.x += 52 * dx / this.scale;
        this.center.y += 52 * dy / this.scale;
        this.clampCenter();
        this.clearHover();
        this.repaint();
      } else if (event.key === "+" || event.key === "=") {
        this.zoomBy(1.33);
      } else if (event.key === "-") {
        this.zoomBy(1 / 1.33);
      } else if (event.key === "Home") {
        this.resetView();
      } else if (event.key === "Escape") {
        this.onSelect(null);
      } else {
        return;
      }
      event.preventDefault();
    });
  }

  hitTest(point) {
    if (this.mode === "generation") {
      let closest = null;
      let bestDistance = Infinity;
      for (const { asset, position, radius } of this.generationHits) {
        const distance = Math.hypot(point.x - position.x, point.y - position.y);
        if (distance <= radius + 3 && distance <= bestDistance) {
          closest = asset;
          bestDistance = distance;
        }
      }
      return closest;
    }
    let closestPoint = null;
    let closestDist = 8;
    for (const hit of [...this.hits.buses, ...this.hits.transformers]) {
      const distance = Math.hypot(point.x - hit.position.x, point.y - hit.position.y);
      if (distance < closestDist) {
        closestDist = distance;
        closestPoint = hit.asset;
      }
    }
    if (closestPoint) return closestPoint;
    let closestLine = null;
    closestDist = 5;
    for (const hit of this.hits.lines) {
      const { a, b, middle, asset } = hit;
      const distance = Math.min(segmentDistance(point, a, middle), segmentDistance(point, middle, b));
      if (distance < closestDist) {
        closestDist = distance;
        closestLine = asset;
      }
    }
    return closestLine;
  }

  hoverAt(point) {
    const previous = this.hovered;
    this.hovered = this.hitTest(point);
    this.canvas.classList.toggle("is-hovering", Boolean(this.hovered));
    this.tooltip.hidden = !this.hovered;
    if (this.hovered) {
      const asset = this.hovered;
      this.tooltip.textContent = asset.type === "generation"
        ? `Bus ${asset.id} · ${decimal.format(asset.gwh)} GWh`
        : `${TYPES[asset.type].label} ${asset.id} · ${assetVoltage(asset)}`;
      this.tooltip.style.left = `${Math.max(5, Math.min(point.x + 12, this.width - this.tooltip.offsetWidth - 7))}px`;
      this.tooltip.style.top = `${Math.max(4, point.y - 34)}px`;
    }
    if (previous !== this.hovered) this.repaint();
  }

  draw() {
    const { context: ctx, dpr, width, height, scale } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sea = ctx.createLinearGradient(0, 0, width, height);
    sea.addColorStop(0, "#122733");
    sea.addColorStop(1, "#0d202a");
    ctx.fillStyle = sea;
    ctx.fillRect(0, 0, width, height);

    const origin = this.screen({ x: 0, y: 0 });
    ctx.save();
    ctx.translate(origin.x, origin.y);
    ctx.scale(scale, scale);
    for (const [id, path] of this.countries) {
      ctx.fillStyle = id === "ECU" ? "#2a403e" : "#223634";
      ctx.fill(path, "evenodd");
    }
    if (this.layers.relief && this.relief.complete && this.relief.naturalWidth) {
      ctx.save();
      ctx.clip(this.land, "evenodd");
      ctx.drawImage(this.relief, ...this.terrain);
      ctx.restore();
    }
    ctx.lineWidth = .65 / scale;
    ctx.strokeStyle = "#79acb33b";
    ctx.stroke(this.rivers);
    ctx.setLineDash([2 / scale, 2.5 / scale]);
    ctx.strokeStyle = "#a9c6ba40";
    ctx.stroke(this.provinces);
    ctx.setLineDash([]);
    ctx.lineWidth = .9 / scale;
    ctx.strokeStyle = "#9cb8aa71";
    for (const [, path] of this.countries) ctx.stroke(path);
    ctx.restore();

    this.drawGraticule();
    if (this.layers.labels) this.drawRegionLabels();
    if (this.mode === "generation") this.drawGeneration();
    else this.drawAssets();
    if (this.layers.labels) this.drawCities();
    this.drawScale();
  }

  drawGraticule() {
    const { context: ctx, width, height } = this;
    ctx.save();
    ctx.lineWidth = .75;
    ctx.strokeStyle = "#a4c1c219";
    ctx.beginPath();
    for (let lon = -88; lon <= -68; lon += 2) {
      const x = this.screen({ x: lon, y: 0 }).x;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let lat = -10; lat <= 8; lat += 2) {
      if (lat === 0) continue;
      const y = this.screen(project(0, lat)).y;
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
    const eq = this.screen({ x: 0, y: 0 }).y;
    if (eq > 47 && eq < height - 20) {
      ctx.strokeStyle = "#a8c9c14d";
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(0, eq);
      ctx.lineTo(width, eq);
      ctx.stroke();
      ctx.fillStyle = "#afc4bf";
      ctx.font = '9px "IBM Plex Mono", monospace';
      ctx.fillText("0°", 17, eq - 5);
    }
    ctx.restore();
  }

  drawRegionLabels() {
    const { context: ctx } = this;
    const regions = [
      ["P A C I F I C  O C E A N", -82.45, -1.24, "#85a6b4", 10],
      ["C O L O M B I A", -76.5, 1.0, "#b3c5b8", 10],
      ["E C U A D O R", -76.82, -1.72, "#e0e8c5", 11],
      ["P E R U", -76.35, -3.77, "#b3c5b8", 10],
    ];
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const [text, lon, lat, color, size] of regions) {
      const p = this.screen(project(lon, lat));
      ctx.font = `500 ${size}px "IBM Plex Mono", monospace`;
      ctx.fillStyle = color;
      ctx.globalAlpha = .74;
      ctx.fillText(text, p.x, p.y);
    }
    ctx.restore();
  }

  drawCities() {
    const { context: ctx } = this;
    const shown = [];
    ctx.save();
    for (const [name, x, y, dx, dy, atZoom, kind] of this.cities) {
      if (this.zoom < atZoom) continue;
      const point = this.screen({ x, y });
      if (point.x < 0 || point.y < 0 || point.x > this.width || point.y > this.height) continue;
      const major = kind === "major";
      ctx.font = `${major ? 800 : 650} ${major ? 12 : 10.5}px Manrope, sans-serif`;
      const tx = point.x + dx;
      const ty = point.y + dy;
      const w = ctx.measureText(name).width;
      const box = { x0: dx < 0 ? tx - w : tx, x1: dx < 0 ? tx : tx + w, y0: ty - 7, y1: ty + 7 };
      if (shown.some(p => box.x0 < p.x1 + 5 && box.x1 > p.x0 - 5 && box.y0 < p.y1 && box.y1 > p.y0)) continue;
      shown.push(box);
      ctx.fillStyle = major ? "#e1eadf" : "#b9ccc3";
      ctx.beginPath();
      ctx.arc(point.x, point.y, major ? 2.2 : 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = dx < 0 ? "right" : "left";
      ctx.textBaseline = "middle";
      ctx.strokeStyle = "#122723";
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.strokeText(name, tx, ty);
      ctx.fillText(name, tx, ty);
    }
    ctx.restore();
  }

  drawGeneration() {
    const ctx = this.context;
    this.generationHits = [];
    ctx.save();
    if (this.layers.network) {
      ctx.beginPath();
      for (const line of this.assets.lines) {
        const a = this.screen(line.origin.point);
        const b = this.screen(line.end.point);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.strokeStyle = "#9db7bb73";
      ctx.lineWidth = 1.05;
      ctx.stroke();
    }
    for (const asset of this.generation) {
      const position = this.screen(asset.point);
      const scaled = Math.log1p(asset.gwh) / Math.log1p(this.generationMaxGWh);
      const radius = Math.sqrt(10 + 280 * scaled);
      this.generationHits.push({ asset, position, radius });
      this.paintGeneration(asset, position, radius, false);
    }
    for (const asset of new Set([this.selected, this.hovered])) {
      const hit = this.generationHits.find(item => item.asset === asset);
      if (hit) this.paintGeneration(asset, hit.position, hit.radius + 2, true);
    }
    ctx.restore();
  }

  paintGeneration(asset, position, radius, highlight) {
    const ctx = this.context;
    ctx.beginPath();
    ctx.arc(position.x, position.y, radius, 0, 2 * Math.PI);
    ctx.globalAlpha = highlight ? .94 : .75;
    ctx.fillStyle = GENERATION_COLORS[asset.technology];
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = highlight ? 2 : .95;
    ctx.strokeStyle = highlight ? "#f1faf6" : "#d9e8e3ac";
    ctx.stroke();
  }

  drawAssets() {
    const { context: ctx } = this;
    this.hits = { buses: [], lines: [], transformers: [] };
    ctx.save();
    ctx.lineCap = "round";
    for (const voltage of [...VOLTAGES].reverse()) {
      if (!this.voltages.has(voltage)) continue;
      for (const asset of this.linesByVoltage[voltage]) this.paintLine(asset, false, true);
    }
    if (this.selected?.type === "lines") this.paintLine(this.selected, true);
    if (this.hovered?.type === "lines" && this.hovered !== this.selected) this.paintLine(this.hovered, true);

    if (this.layers.buses) {
      for (const bus of this.assets.buses) {
        if (this.voltages.has(bus.kv)) this.paintBus(bus, false, true);
      }
    }
    if (this.layers.transformers) {
      for (const transformer of this.assets.transformers) {
        if (this.voltages.has(transformer.kv0) || this.voltages.has(transformer.kv1)) this.paintTransformer(transformer, false, true);
      }
    }
    for (const asset of new Set([this.selected, this.hovered])) {
      if (asset?.type === "buses") this.paintBus(asset, true);
      if (asset?.type === "transformers") this.paintTransformer(asset, true);
    }
    ctx.restore();
  }

  paintLine(asset, highlight, track = false) {
    const { context: ctx } = this;
    const a = this.screen(asset.origin.point);
    const b = this.screen(asset.end.point);
    const middle = midpoint(a, b);
    const distance = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const bend = asset.bend * 7;
    const control = { x: middle.x - (b.y - a.y) / distance * bend, y: middle.y + (b.x - a.x) / distance * bend };
    if (track) this.hits.lines.push({ asset, a, b, middle: midpoint(middle, control) });
    const nominalWidth = { 500: 2.65, 230: 1.72, 138: 1.13 }[asset.kv];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(control.x, control.y, b.x, b.y);
    ctx.lineWidth = nominalWidth + (highlight ? 5 : 1.7);
    ctx.strokeStyle = highlight ? "#e5fbef8c" : "#152a2b";
    ctx.stroke();
    ctx.lineWidth = nominalWidth + (highlight ? 1.4 : 0);
    ctx.globalAlpha = highlight ? 1 : { 500: .98, 230: .88, 138: .76 }[asset.kv];
    ctx.strokeStyle = COLORS[asset.kv];
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  paintBus(asset, highlight, track = false) {
    const { context: ctx } = this;
    const p = this.screen(asset.point);
    if (track) this.hits.buses.push({ asset, position: p });
    if (highlight) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8.7, 0, 2 * Math.PI);
      ctx.fillStyle = "#b5f9e657";
      ctx.fill();
      ctx.lineWidth = 1.15;
      ctx.strokeStyle = "#effdf7";
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, highlight ? 4.4 : asset.kv === 500 ? 3.4 : 2.5, 0, 2 * Math.PI);
    ctx.fillStyle = highlight ? "#fff" : asset.kv === 500 ? "#fbe3ac" : "#d9ede7";
    ctx.strokeStyle = "#1b3339";
    ctx.lineWidth = 1.15;
    ctx.fill();
    ctx.stroke();
  }

  paintTransformer(asset, highlight, track = false) {
    const { context: ctx } = this;
    const point = this.screen(asset.point);
    const p = { x: point.x + 5, y: point.y - 6 };
    if (track) this.hits.transformers.push({ asset, position: p });
    if (highlight) {
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = "#eadcf0";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    const r = highlight ? 6.1 : 3.2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - r);
    ctx.lineTo(p.x + r, p.y);
    ctx.lineTo(p.x, p.y + r);
    ctx.lineTo(p.x - r, p.y);
    ctx.closePath();
    ctx.fillStyle = highlight ? "#f4e7fb" : "#604974";
    ctx.strokeStyle = "#dbc2ed";
    ctx.lineWidth = 1.05;
    ctx.fill();
    ctx.stroke();
  }

  drawScale() {
    const pxPerKm = this.scale / (111.32 * Math.cos(this.center.y * deg));
    const size = [1, 2, 5, 10, 20, 50, 100, 200, 500].filter(km => km * pxPerKm <= 95).at(-1) ?? 1;
    this.scaleIndicator.style.width = `${size * pxPerKm}px`;
    this.scaleIndicator.firstElementChild.textContent = `${size} km`;
  }
}
