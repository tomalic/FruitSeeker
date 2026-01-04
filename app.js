/* FruitSeeker + QuickID hybrid
   - Upload CSV/XLSX
   - Search with ANY text (across all columns)
   - If query is 4 digits -> prioritize EAN ending match
     If query is 5 digits -> prioritize "barra" exact match
   - If only 1 result -> show the "Quick ID" big card
   - If multiple -> show list/table like FruitSeeker
*/

const LS_KEY = "fruitseeker_quickid_products_v2";

let products = [];          // rows as objects
let headers = [];           // original headers
let colMap = {};            // logical -> header name

// Column name synonyms (normalized matching)
const synonyms = {
  rapid: ['id rápida','id rapida','id','id rápida (4)','id rapida (4)','id rapida 4','id rápida 4','id rápida 4 dígitos','id rapida 4 digitos','id rápida 4 del ean','id rapida 4 del ean','id rápida ean','id rapida ean','quick id','id rápida apple','id rápida producto'],
  part:  ['part number','part','pn','p/n','sku','modelo','model','código producto','codigo producto','product code','code'],
  ean:   ['ean','ean13','código ean','codigo ean','barcode','codi ean','codi de barres','código de barras','codigo de barras'],
  barra: ['barra','barra5','codigo5','código5','bar','barra 5','barra (5)','barra 5 dígitos','barra 5 digitos','ultimos 5','últimos 5'],
  nombre:['nombre','producto','titulo','título','name','product','article','artículo','descripción corta','descripcion corta','short description'],
  descripcion:['descripcion','descripción','description','descripcio','detalle','detalles','long description'],
  foto:  ['foto','imagen','image','photo','picture','url imagen','url imagen producto','img','image url','foto url','imagen url','url foto','url'],
  precio:['precio','price','pvp','p.v.p.','importe','amount','coste','costo','cost'],
  ref11: ['ref11','ref 11','referencia 11','nuestra referencia','referencia interna','ref','ref.','referencia'],
  dept:  ['departamento','dept','depto','departament'],
  fam:   ['familia','family'],
};

function normalize(s) {
  return (s ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function buildColumnMap(headerRow) {
  const hdrsNorm = headerRow.map(h => normalize(h));
  const pick = (keys) => {
    // exact match first
    for (const key of keys) {
      const idx = hdrsNorm.indexOf(normalize(key));
      if (idx !== -1) return headerRow[idx];
    }
    // contains match
    for (let i = 0; i < hdrsNorm.length; i++) {
      const h = hdrsNorm[i];
      for (const key of keys) {
        if (h.includes(normalize(key))) return headerRow[i];
      }
    }
    return null;
  };

  const map = {};
  for (const logical of Object.keys(synonyms)) {
    const found = pick(synonyms[logical]);
    if (found) map[logical] = found;
  }
  return map;
}

function parseWorkbookToRows(workbook) {
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

function computeSearchBlob(row) {
  // Concatenate all values to a single searchable string
  const values = Object.values(row).map(v => (v ?? "").toString());
  return normalize(values.join(" "));
}

function enrichRows(rows) {
  return rows.map(r => {
    const row = { ...r };
    row.__search = computeSearchBlob(row);
    return row;
  });
}

function saveToLocalStorage() {
  try {
    const payload = {
      products: products.map(p => {
        const { __search, ...rest } = p;
        return rest;
      }),
      headers,
      colMap,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn("No se pudo guardar en localStorage:", e);
  }
}

function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const payload = JSON.parse(raw);
    headers = payload.headers || [];
    colMap = payload.colMap || {};
    products = enrichRows(payload.products || []);
    updateLoadedBadge();
  } catch (e) {
    console.warn("No se pudo cargar localStorage:", e);
  }
}

function clearData() {
  products = [];
  headers = [];
  colMap = {};
  localStorage.removeItem(LS_KEY);
  document.getElementById("results").innerHTML = "";
  updateLoadedBadge();
}

function updateLoadedBadge() {
  const el = document.getElementById("loadedCount");
  if (!el) return;

  const block = el.parentElement; // 👈 conté text + botó

  if (!products.length) {
    el.textContent = "Sin datos cargados";
    el.classList.add("text-muted");
    block.classList.remove("d-none");   // 👈 mostrar bloc
  } else {
    el.textContent = `Datos guardados: ${products.length} filas`;
    el.classList.remove("text-muted");
    block.classList.add("d-none");      // 👈 amagar text + botó
  }
}

function handleFile(file) {
  const name = (file.name || "").toLowerCase();
  const reader = new FileReader();

  reader.onload = (e) => {
    try {
      let rows = [];
      if (name.endsWith(".xlsx")) {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array" });
        rows = parseWorkbookToRows(wb);
      } else if (name.endsWith(".csv")) {
        const text = e.target.result; // readAsText
        const wb = XLSX.read(text, { type: "string" });
        rows = parseWorkbookToRows(wb);
      } else {
        throw new Error("Formato no soportado. Usa .csv o .xlsx");
      }

      if (!rows.length) throw new Error("El archivo no contiene filas.");

      headers = Object.keys(rows[0]);
      colMap = buildColumnMap(headers);
      products = enrichRows(rows);

      saveToLocalStorage();
      updateLoadedBadge();

      // Auto-search if there is something typed
      const q = (document.getElementById("q")?.value || "").trim();
      if (q) doSearch(q);
      else {
        document.getElementById("results").innerHTML =
          `<div class="alert alert-success mb-0">Datos cargados: <b>${products.length}</b> filas.</div>`;
      }
    } catch (err) {
      console.error(err);
      document.getElementById("results").innerHTML =
        `<div class="alert alert-danger mb-0">${err.message || err}</div>`;
    }
  };

  if (name.endsWith(".xlsx")) reader.readAsArrayBuffer(file);
  else reader.readAsText(file);
}

function field(row, logical) {
  const h = colMap[logical];
  if (!h) return "";
  return (row[h] ?? "").toString().trim();
}

function doSearch(queryRaw) {
  const q = queryRaw.trim();
  const resultsEl = document.getElementById("results");
  if (!q) {
    resultsEl.innerHTML = "";
    return;
  }
  if (!products.length) {
    resultsEl.innerHTML = `<div class="alert alert-warning mb-0">Primero carga un CSV/XLSX.</div>`;
    return;
  }

  const qNorm = normalize(q);
  const digitsOnly = q.replace(/\D/g, "");

  let matches = [];

  // Priority mode for numeric quick lookup:
  // - 4 digits => EAN ending match
  // - 5 digits => Barra exact match
  if (digitsOnly.length === q.length && (digitsOnly.length === 4 || digitsOnly.length === 5)) {
    const eanHeader = colMap.ean;
    const barraHeader = colMap.barra;

    const special = products.filter(p => {
      const ean = eanHeader ? (p[eanHeader] ?? "").toString().replace(/\D/g, "") : "";
      const barra = barraHeader ? (p[barraHeader] ?? "").toString().replace(/\D/g, "") : "";

      if (digitsOnly.length === 4) {
        return ean && ean.endsWith(digitsOnly);
      }
      // 5
      return barra && barra === digitsOnly;
    });

    if (special.length) {
      matches = special;
    }
  }

 // Fallback / general search across all fields (all terms, any order)
if (!matches.length) {
  const terms = qNorm.split(/\s+/).filter(Boolean); // paraules / trossos

  matches = products.filter(p => {
    const blob = (p.__search || "");
    return terms.every(t => blob.includes(t));
  });
}

  renderResults(q, matches);
}

function renderResults(query, matches) {
  const resultsEl = document.getElementById("results");

  if (!matches.length) {
    resultsEl.innerHTML = `<div class="alert alert-secondary mb-0">Sin resultados para <b>${escapeHtml(query)}</b>.</div>`;
    return;
  }

  // If only 1 -> show the "Quick ID" card (style of your first app)
  if (matches.length === 1) {
    resultsEl.innerHTML = renderQuickCard(matches[0], query);
    return;
  }

  // Multiple -> show FruitSeeker-like list/table
  resultsEl.innerHTML = renderTable(matches, query);
}

function renderQuickCard(p, query) {
  const rapid = field(p, "rapid") || "—";
  const part = field(p, "part");
  const ref11 = field(p, "ref11");
  const ean = field(p, "ean");
  const desc = field(p, "descripcion") || field(p, "nombre") || "";
  const precio = field(p, "precio");
  const foto = field(p, "foto");

  const imgHtml = foto
    ? `<img class="product-img" src="${escapeAttr(foto)}" alt="Foto" onerror="this.style.display='none'">`
    : "";

  const lines = [];
  if (part) lines.push(`<div class="ref-badge badge text-bg-light">${escapeHtml(part)}</div>`);
  if (precio) lines.push(`<div class="badge text-bg-primary">${escapeHtml(precio)}</div>`);

  return `
    <div class="card mx-auto" style="max-width: 680px;">
      <div class="card-body text-center">
        <div class="small text-muted mb-2">Resultado para <b>${escapeHtml(query)}</b></div>

        <div class="header-wrap mb-3">
          ${imgHtml}
          <div>
            <div class="big-id">${escapeHtml(rapid)}</div>
            <div class="text-muted">ID rápida</div>
          </div>
        </div>

        ${part ? `<div class="fw-semibold mb-1">${escapeHtml(part)}</div>` : ""}

        ${desc ? `<div class="text-muted mb-3">${escapeHtml(desc)}</div>` : ""}

        <div class="d-flex flex-wrap gap-2 justify-content-center mb-3">
          ${lines.join("")}
        </div>

        <div class="text-start small" style="max-width: 520px; margin: 0 auto;">
          ${ref11 ? `<p class="mb-1"><b>Ref. (11 dígitos)</b><br><span class="fs-5 fw-semibold">${escapeHtml(ref11)}</span></p>` : ""}
          ${ean ? `<p class="mb-0"><b>EAN</b><br><span class="fs-5 fw-semibold">${escapeHtml(ean)}</span></p>` : ""}
        </div>
      </div>
    </div>
  `;
}

function renderTable(rows, query) {
  const cols = {
    rapid: colMap.rapid,
    part: colMap.part,
    ean: colMap.ean,
    descripcion: colMap.descripcion || colMap.nombre,
    precio: colMap.precio,
  };

  const head = `
    <div class="card mx-auto" style="max-width: 980px;">
      <div class="card-body">
        <div class="d-flex flex-wrap align-items-baseline justify-content-between gap-2">
          <div>
            <div class="fw-semibold">Resultados: ${rows.length}</div>
            <div class="small text-muted">Búsqueda: <b>${escapeHtml(query)}</b></div>
          </div>
        </div>

        <div class="table-responsive mt-3">
          <table class="table table-sm align-middle results-table">
            <thead>
              <tr>
                <th>${cols.rapid ? "ID rápida" : "ID"}</th>
                <th>${cols.part ? "Part number" : "Referencia"}</th>
                <th>${cols.ean ? "EAN" : "EAN"}</th>
                <th>${cols.descripcion ? "Descripción" : "Descripción"}</th>
                <th class="text-end">${cols.precio ? "Precio" : "Precio"}</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => renderRowTr(r, cols)).join("")}
            </tbody>
          </table>
        </div>

        <div class="small text-muted mt-2">Tip: escribe números (4 o 5 dígitos) para una búsqueda rápida por EAN/Barra.</div>
      </div>
    </div>
  `;
  return head;
}

function renderRowTr(r, cols) {
  const rapid = cols.rapid ? (r[cols.rapid] ?? "") : "";
  const part = cols.part ? (r[cols.part] ?? "") : "";
  const ean = cols.ean ? (r[cols.ean] ?? "") : "";
  const desc = cols.descripcion ? (r[cols.descripcion] ?? "") : "";
  const precio = cols.precio ? (r[cols.precio] ?? "") : "";

  return `
    <tr class="result-row" data-rapid="${escapeAttr(rapid)}">
      <td class="fw-semibold">${escapeHtml(rapid || "—")}</td>
      <td>${escapeHtml(part)}</td>
      <td>${escapeHtml(ean)}</td>
      <td>${escapeHtml(desc)}</td>
      <td class="text-end">${escapeHtml(precio)}</td>
    </tr>
  `;
}

// --- Basic HTML escaping (avoid breaking the DOM with CSV content) ---
function escapeHtml(s) {
  return (s ?? "").toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function escapeAttr(s) { return escapeHtml(s).replace(/`/g, "&#096;"); }

// --- PWA install button (unchanged behavior) ---
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById("btnInstall");
  if (btn) btn.classList.remove("d-none");
});

document.addEventListener("DOMContentLoaded", () => {
  loadFromLocalStorage();

  const fileInput = document.getElementById("fileInput");
  fileInput?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  });

  const qInput = document.getElementById("q");
  qInput?.addEventListener("input", () => {
    doSearch(qInput.value);
  });

  document.getElementById("btnBorrar")?.addEventListener("click", clearData);

  document.getElementById("btnInstall")?.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (_) {}
    deferredPrompt = null;
  });

  updateLoadedBadge();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(console.error);
  });
}
