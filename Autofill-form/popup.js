/**
 * popup.js — Lógica del Popup
 *
 * Responsabilidades:
 *  - Detectar si el PIN ya está configurado
 *  - Manejar flujo: setup PIN → verify PIN → pantalla principal
 *  - Guardar y cargar datos del usuario vía background
 *  - Enviar mensaje de autofill al background
 *  - Gestionar sesión desbloqueada en memoria (sin persistir)
 */

// ─── Estado de sesión (en memoria, se pierde al cerrar popup) ─────────────────
let sessionUnlocked = false;

// Campos personalizados en memoria (se sincronizan con user_data al guardar)
let customFields = {}; // { fax: "+57...", empresa: "Acme", ... }

// ─── Utilidad: enviar mensajes al background ──────────────────────────────────
function sendMsg(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// ─── Utilidad: mostrar mensajes de estado ─────────────────────────────────────
function showStatus(elementId, message, type = "ok") {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message;
  el.className = `status show ${type}`;
  setTimeout(() => {
    el.className = "status";
  }, 3500);
}

// ─── Mostrar pantalla activa ──────────────────────────────────────────────────
function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  const target = document.getElementById(screenId);
  if (target) target.classList.add("active");
}

// ─── Mostrar tab activo ───────────────────────────────────────────────────────
function showTab(tabId) {
  document.querySelectorAll(".tab-content").forEach((t) => (t.style.display = "none"));
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  const content = document.getElementById(tabId);
  if (content) content.style.display = "block";
  const btn = document.querySelector(`[data-tab="${tabId}"]`);
  if (btn) btn.classList.add("active");
}

// ─── Cargar datos guardados en el formulario ──────────────────────────────────
const DEFAULT_FIELDS = ["nombre","apellido","email","telefono","documento","direccion","ciudad","pais","codigoPostal"];

async function loadDataIntoForm() {
  try {
    const res = await sendMsg({ action: "GET_DATA" });
    if (res.success && res.data) {
      // Llenar campos por defecto
      DEFAULT_FIELDS.forEach((f) => {
        const el = document.getElementById("f-" + f);
        if (el && res.data[f]) el.value = res.data[f];
      });
      // Cargar campos personalizados (todo lo que no es campo por defecto)
      customFields = {};
      Object.keys(res.data).forEach((k) => {
        if (!DEFAULT_FIELDS.includes(k)) {
          customFields[k] = res.data[k];
        }
      });
      renderCustomFields();
      renderDataPreview(res.data);
    }
  } catch (err) {
    console.error("Error cargando datos:", err);
  }
}

// ─── Renderizar preview de datos en tab AutoFill ──────────────────────────────
function renderDataPreview(data) {
  const container = document.getElementById("data-preview");
  if (!container) return;

  const labels = {
    nombre: "Nombre",
    apellido: "Apellido",
    email: "Email",
    telefono: "Teléfono",
    documento: "Documento",
    direccion: "Dirección",
    ciudad: "Ciudad",
    pais: "País",
    codigoPostal: "Cód. Postal",
  };

  const entries = Object.entries(data).filter(([k, v]) => v && v.trim && v.trim() !== "");

  if (entries.length === 0) {
    container.innerHTML = `<div style="color: var(--text-muted); font-size: 12px; text-align:center; padding: 8px 0;">No hay datos guardados aún</div>`;
    return;
  }

  container.innerHTML = entries
    .map(
      ([k, v]) => `
      <div class="field-preview">
        <span class="key">${labels[k] || k}</span>
        <span class="val">${v}</span>
      </div>`
    )
    .join("");
}

// ─── Recoger datos del formulario ─────────────────────────────────────────────
function collectFormData() {
  const data = {};
  DEFAULT_FIELDS.forEach((f) => {
    const el = document.getElementById("f-" + f);
    if (el) data[f] = el.value.trim();
  });
  // Combinar con campos personalizados
  Object.assign(data, customFields);
  return data;
}

// ─── Renderizar lista de campos personalizados ────────────────────────────────
function renderCustomFields() {
  const container = document.getElementById("custom-fields-list");
  if (!container) return;

  if (Object.keys(customFields).length === 0) {
    container.innerHTML = `<div style="color:var(--text-muted);font-size:12px;margin-bottom:8px;">Sin campos personalizados aún.</div>`;
    return;
  }

  container.innerHTML = Object.entries(customFields).map(([k, v]) => `
    <div class="custom-field-item">
      <span class="cf-key">${k}</span>
      <span class="cf-val">${v}</span>
      <button class="cf-del" data-key="${k}" title="Eliminar">✕</button>
    </div>
  `).join("");

  // Botones de eliminar
  container.querySelectorAll(".cf-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.key;
      delete customFields[key];
      renderCustomFields();
    });
  });
}

// ─── Renderizar historial de autofills ───────────────────────────────────────
async function renderHistory() {
  const container = document.getElementById("history-list");
  if (!container) return;

  try {
    const res = await sendMsg({ action: "GET_HISTORY" });
    const history = res.history || [];

    if (history.length === 0) {
      container.innerHTML = `<div class="history-empty">No hay ejecuciones registradas aún.</div>`;
      return;
    }

    container.innerHTML = history.map((entry) => {
      const date = new Date(entry.timestamp);
      const dateStr = date.toLocaleDateString("es-CO", { day: "2-digit", month: "short" });
      const timeStr = date.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });

      // Extraer dominio legible de la URL
      let displayUrl = entry.url || "—";
      try { displayUrl = new URL(entry.url).hostname.replace("www.", ""); } catch (_) {}

      const statusTag = entry.success
        ? `<span class="h-tag ok">✅ OK</span>`
        : `<span class="h-tag fail">⚠️ Sin campos</span>`;

      const countTag = entry.filled > 0
        ? `<span class="h-tag cnt">${entry.filled} campo${entry.filled !== 1 ? "s" : ""}</span>`
        : "";

      const aiTag = entry.aiUsed
        ? `<span class="h-tag ai">🤖 IA +${entry.aiFields}</span>`
        : "";

      return `
        <div class="history-entry">
          <div class="h-top">
            <span class="h-url" title="${entry.url}">${displayUrl}</span>
            <span class="h-date">${dateStr} ${timeStr}</span>
          </div>
          <div class="h-tags">${statusTag}${countTag}${aiTag}</div>
        </div>`;
    }).join("");
  } catch (err) {
    container.innerHTML = `<div class="history-empty">Error cargando historial.</div>`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", async () => {
  // 1. ¿Existe PIN ya configurado?
  try {
    const res = await sendMsg({ action: "CHECK_PIN_EXISTS" });
    if (res.exists) {
      showScreen("screen-verify-pin");
      document.getElementById("verify-pin-input").focus();
    } else {
      showScreen("screen-setup-pin");
      document.getElementById("setup-pin-input").focus();
    }
  } catch (err) {
    showScreen("screen-setup-pin");
  }

  // ── Toggle IA: cargar preferencia guardada ────────────────────────────────
  try {
    const aiRes = await sendMsg({ action: "GET_AI_ENABLED" });
    document.getElementById("toggle-ai").checked = aiRes.enabled !== false;
  } catch (_) {}

  document.getElementById("toggle-ai").addEventListener("change", async (e) => {
    await sendMsg({ action: "SET_AI_ENABLED", enabled: e.target.checked });
  });

  // ── Tabs ──────────────────────────────────────────────────────────────────
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      showTab(tab.dataset.tab);
      if (tab.dataset.tab === "tab-history") renderHistory();
    });
  });

  // ── Limpiar historial ──────────────────────────────────────────────────────
  document.getElementById("btn-clear-history").addEventListener("click", async () => {
    await sendMsg({ action: "CLEAR_HISTORY" });
    renderHistory();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCREEN: Setup PIN
  // ═══════════════════════════════════════════════════════════════════════════
  document.getElementById("btn-save-pin").addEventListener("click", async () => {
    const pin = document.getElementById("setup-pin-input").value;
    const confirm = document.getElementById("setup-pin-confirm").value;

    if (!pin || pin.length < 4) {
      showStatus("status-setup-pin", "El PIN debe tener al menos 4 dígitos.", "err");
      return;
    }
    if (pin !== confirm) {
      showStatus("status-setup-pin", "Los PINs no coinciden.", "err");
      return;
    }

    const res = await sendMsg({ action: "SET_PIN", pin });
    if (res.success) {
      showStatus("status-setup-pin", "✅ PIN configurado correctamente.", "ok");
      setTimeout(() => {
        sessionUnlocked = true;
        showScreen("screen-main");
        loadDataIntoForm();
      }, 900);
    } else {
      showStatus("status-setup-pin", res.error || "Error al guardar el PIN.", "err");
    }
  });

  // Enter en campo PIN setup
  document.getElementById("setup-pin-confirm").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("btn-save-pin").click();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCREEN: Verify PIN
  // ═══════════════════════════════════════════════════════════════════════════
  document.getElementById("btn-verify-pin").addEventListener("click", async () => {
    const pin = document.getElementById("verify-pin-input").value;

    if (!pin) {
      showStatus("status-verify-pin", "Ingresa tu PIN.", "err");
      return;
    }

    const res = await sendMsg({ action: "VERIFY_PIN", pin });
    if (res.success) {
      sessionUnlocked = true;
      document.getElementById("verify-pin-input").value = "";
      showScreen("screen-main");
      loadDataIntoForm();
    } else {
      document.getElementById("verify-pin-input").value = "";
      document.getElementById("verify-pin-input").focus();
      showStatus("status-verify-pin", "❌ " + (res.error || "PIN incorrecto."), "err");
    }
  });

  // Enter en campo verify PIN
  document.getElementById("verify-pin-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("btn-verify-pin").click();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCREEN: Principal
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Botón "Añadir campo" ───────────────────────────────────────────────────
  document.getElementById("btn-show-add-field").addEventListener("click", () => {
    document.getElementById("add-field-form").style.display = "block";
    document.getElementById("btn-show-add-field").style.display = "none";
    document.getElementById("new-field-key").focus();
  });

  document.getElementById("btn-cancel-add-field").addEventListener("click", () => {
    document.getElementById("add-field-form").style.display = "none";
    document.getElementById("btn-show-add-field").style.display = "block";
    document.getElementById("new-field-key").value = "";
    document.getElementById("new-field-value").value = "";
  });

  document.getElementById("btn-confirm-add-field").addEventListener("click", () => {
    const keyInput = document.getElementById("new-field-key");
    const valInput = document.getElementById("new-field-value");
    const key = keyInput.value.trim().toLowerCase().replace(/\s+/g, "_");
    const val = valInput.value.trim();

    if (!key) {
      showStatus("status-custom-field", "El nombre del parámetro no puede estar vacío.", "err");
      return;
    }
    if (!val) {
      showStatus("status-custom-field", "El valor no puede estar vacío.", "err");
      return;
    }
    if (DEFAULT_FIELDS.includes(key)) {
      showStatus("status-custom-field", `"${key}" ya existe como campo por defecto.`, "warn");
      return;
    }

    customFields[key] = val;
    renderCustomFields();

    // Limpiar y cerrar formulario
    keyInput.value = "";
    valInput.value = "";
    document.getElementById("add-field-form").style.display = "none";
    document.getElementById("btn-show-add-field").style.display = "block";
  });

  // Enter en campo valor confirma
  document.getElementById("new-field-value").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("btn-confirm-add-field").click();
  });

  // ── Guardar datos ──────────────────────────────────────────────────────────
  document.getElementById("btn-save-data").addEventListener("click", async () => {
    if (!sessionUnlocked) {
      showStatus("status-data", "Sesión bloqueada. Ingresa tu PIN.", "err");
      return;
    }

    const data = collectFormData();
    const hasAnyData = Object.values(data).some((v) => v !== "");

    if (!hasAnyData) {
      showStatus("status-data", "Completa al menos un campo.", "warn");
      return;
    }

    const res = await sendMsg({ action: "SAVE_DATA", data });
    if (res.success) {
      showStatus("status-data", "✅ Datos guardados correctamente.", "ok");
      renderDataPreview(data);
    } else {
      showStatus("status-data", res.error || "Error al guardar.", "err");
    }
  });

  // ── Botón AutoFill ─────────────────────────────────────────────────────────
  document.getElementById("btn-autofill").addEventListener("click", async () => {
    if (!sessionUnlocked) {
      showStatus("status-autofill", "Sesión bloqueada. Ingresa tu PIN.", "err");
      return;
    }

    const btn = document.getElementById("btn-autofill");
    btn.disabled = true;
    btn.textContent = "⏳ Rellenando...";

    try {
      const res = await sendMsg({ action: "AUTOFILL" });
      let message = res.message || (res.success ? "✅ Autofill completado." : "No se pudo completar el autofill.");

      if (res.aiInfo) {
        message += ` IA usada: ${res.aiInfo.used ? "sí" : "no"}.`;
        message += ` Campos enviados a IA: ${res.aiInfo.fieldsSent}.`;
        if (res.aiInfo.used) {
          message += ` Campos rellenados por IA: ${res.aiInfo.filled}.`;
        }
        if (res.aiInfo.error) {
          message += ` Error IA: ${res.aiInfo.error}.`;
        }
      }

      if (res.success) {
        showStatus("status-autofill", message, "ok");
      } else {
        showStatus("status-autofill", message, "warn");
      }
    } catch (err) {
      showStatus("status-autofill", "Error: " + err.message, "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "⚡ Ejecutar AutoFill";
    }
  });

  // ── Bloquear sesión ────────────────────────────────────────────────────────
  document.getElementById("btn-lock").addEventListener("click", () => {
    sessionUnlocked = false;
    showScreen("screen-verify-pin");
    document.getElementById("verify-pin-input").value = "";
    document.getElementById("verify-pin-input").focus();
  });

  // ── Cambiar PIN ────────────────────────────────────────────────────────────
  document.getElementById("btn-change-pin").addEventListener("click", () => {
    // Resetear campos de setup y mostrar esa pantalla
    document.getElementById("setup-pin-input").value = "";
    document.getElementById("setup-pin-confirm").value = "";
    showScreen("screen-setup-pin");
  });
});