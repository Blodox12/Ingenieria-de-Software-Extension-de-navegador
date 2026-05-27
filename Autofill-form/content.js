/**
 * content.js — Content Script (Refactorizado con lógica de Súper-Normalización)
 *
 * Arquitectura: Multicapa Basada en Eventos (Chrome MV3)
 */

// ─── Mapeo canónico: palabras clave → campo de datos del usuario ──────────────
const FIELD_MAP = {
  nombre:           "nombre",
  name:             "nombre",
  firstname:        "nombre",
  first_name:       "nombre",
  "primer nombre":  "nombre",
  apellido:         "apellido",
  lastname:         "apellido",
  last_name:        "apellido",
  surname:          "apellido",
  email:            "email",
  correo:           "email",
  "e-mail":         "email",
  mail:             "email",
  telefono:         "telefono",
  phone:            "telefono",
  tel:              "telefono",
  celular:          "telefono",
  movil:            "telefono",
  mobile:           "telefono",
  direccion:        "direccion",
  address:          "direccion",
  calle:            "direccion",
  street:           "direccion",
  ciudad:           "ciudad",
  city:             "ciudad",
  pais:             "pais",
  country:          "pais",
  postal:           "codigoPostal",
  zip:              "codigoPostal",
  "codigo postal":  "codigoPostal",
  cod_postal:       "codigoPostal",
  dni:              "documento",
  cedula:           "documento",
  documento:        "documento",
  identification:   "documento",
  nrodoc:           "documento",
  numdoc:           "documento",
};

const INSPECTED_ATTRS = [
  "name", "id", "placeholder", "autocomplete", "aria-label", "data-field",
];

/**
 * FieldResolver
 */
class FieldResolver {
  constructor(userData) {
    this.userData = userData;
  }

  normalize(str) {
    if (!str) return "";
    return str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "")
      .trim();
  }

  resolveFromAttribute(attrValue) {
    if (!attrValue) return null;
    const normalizedAttr = this.normalize(attrValue);

    const SHORT_KEYWORDS = new Set(["tel", "zip", "dni", "mail"]);

    for (const keyword of Object.keys(FIELD_MAP)) {
      const normKw = this.normalize(keyword);
      if (SHORT_KEYWORDS.has(normKw)) {
        const pattern = new RegExp(`(^|[^a-z0-9])${normKw}([^a-z0-9]|$)`);
        if (pattern.test(normalizedAttr)) return FIELD_MAP[keyword];
      } else {
        if (normalizedAttr.includes(normKw)) return FIELD_MAP[keyword];
      }
    }

    for (const userKey of Object.keys(this.userData)) {
      const normalizedUserKey = this.normalize(userKey);
      if (normalizedAttr.includes(normalizedUserKey)) {
        return userKey;
      }
    }

    return null;
  }

  resolveFromElement(element) {
    for (const attr of INSPECTED_ATTRS) {
      const fieldKey = this.resolveFromAttribute(element.getAttribute(attr));
      if (fieldKey) return fieldKey;
    }
    return null;
  }
}

/**
 * FormFiller
 */
class FormFiller {
  fillInput(element, value) {
    if (!value) return false;
    element.focus();
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.blur();
    return true;
  }

  fillSelect(element, value, normalizeFn) {
    if (!value) return false;
    const normalizedValue = normalizeFn(value);

    for (const option of element.options) {
      if (
        normalizeFn(option.value) === normalizedValue ||
        normalizeFn(option.text)  === normalizedValue ||
        normalizeFn(option.value).includes(normalizedValue) ||
        normalizeFn(option.text).includes(normalizedValue)
      ) {
        element.value = option.value;
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    return false;
  }
}

/**
 * AutofillEngine
 */
class AutofillEngine {
  constructor(userData) {
    this.userData  = userData;
    this.resolver  = new FieldResolver(userData);
    this.filler    = new FormFiller();
  }

  run() {
    let filledCount = 0;
    filledCount += this._fillTextInputs();
    filledCount += this._fillSelects();
    return filledCount;
  }

  _fillTextInputs() {
    let count = 0;
    const selector =
      'input[type="text"], input[type="email"], input[type="tel"], ' +
      'input[type="number"], input:not([type])';

    const inputs = document.querySelectorAll(selector);

    for (const input of inputs) {
      if (input.disabled || input.readOnly || input.type === "hidden") continue;

      const fieldKey = this.resolver.resolveFromElement(input);
      if (fieldKey && this.userData[fieldKey]) {
        const ok = this.filler.fillInput(input, this.userData[fieldKey]);
        if (ok) count++;
      }
    }
    return count;
  }

  _fillSelects() {
    let count = 0;
    const selects = document.querySelectorAll("select");

    for (const select of selects) {
      if (select.disabled) continue;

      const fieldKey = this.resolver.resolveFromElement(select);
      if (fieldKey && this.userData[fieldKey]) {
        const ok = this.filler.fillSelect(
          select,
          this.userData[fieldKey],
          (str) => this.resolver.normalize(str)
        );
        if (ok) count++;
      }
    }
    return count;
  }
}

// ─── Listener de mensajes ────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "DO_AUTOFILL") {
    (async () => {
      try {
        const engine = new AutofillEngine(message.data);
        let filledCount = engine.run();

        const unresolvedFields = getUnresolvedFields();
        console.log("Autofill: campos rellenados por automapeo:", filledCount, "campos pendientes:", unresolvedFields.length);

        const aiInfo = {
          used: false,
          filled: 0,
          error: null,
          fieldsSent: unresolvedFields.length,
        };

        // Solo invocar IA si el background lo permite (flag useAI)
        const aiEnabled = message.useAI !== false;

        if (aiEnabled && unresolvedFields.length > 0 && message.data) {
          console.log("Autofill: campos no resueltos enviados a IA:", unresolvedFields);

          const aiResponse = await new Promise((resolve) => {
            chrome.runtime.sendMessage(
              {
                action: "USE_AI_FALLBACK",
                fields: unresolvedFields,
                userData: message.data,
              },
              resolve
            );
          });

          if (aiResponse) {
            if (aiResponse.success && aiResponse.mapping) {
              aiInfo.used = true;
              aiInfo.filled = fillFieldsWithAI(aiResponse.mapping);
              filledCount += aiInfo.filled;
              console.log("Autofill IA: mapeo recibido", aiResponse.mapping);
            } else {
              aiInfo.error = aiResponse.error || "Fallo al recibir respuesta de IA";
              console.warn("Autofill IA falló:", aiInfo.error, aiResponse);
            }
          } else {
            aiInfo.error = "No se recibió respuesta de la acción USE_AI_FALLBACK.";
            console.warn(aiInfo.error);
          }

          console.log("Autofill IA: resultado", aiInfo);
        }

        const messageParts = [];
        if (filledCount > 0) {
          messageParts.push(`✅ ${filledCount} campo(s) rellenado(s) correctamente.`);
        }
        if (aiInfo.used) {
          messageParts.push(`IA rellenó ${aiInfo.filled} campo(s).`);
        } else if (aiInfo.fieldsSent > 0) {
          messageParts.push(`IA no rellenó campos adicionales.${aiInfo.error ? ' Error: ' + aiInfo.error : ''}`);
        }

        if (filledCount > 0) {
          sendResponse({ success: true, message: messageParts.join(' '), filledCount, aiInfo });
        } else {
          sendResponse({
            success: false,
            message: `⚠️ No se encontraron campos compatibles en este formulario.${aiInfo.error ? ' Error IA: ' + aiInfo.error : ''}`,
            filledCount: 0,
            aiInfo,
          });
        }
      } catch (err) {
        sendResponse({ success: false, message: "Error: " + err.message });
      }
    })();
    return true;
  }
});

// ─── getUnresolvedFields ─────────────────────────────────────────────────────
// Recoge los campos que quedaron vacíos tras el motor local.
// Asigna una _key única a cada campo para que Gemini la use como clave de respuesta
// y fillFieldsWithAI pueda encontrar el elemento en el DOM.
function getUnresolvedFields() {
  const unresolved = [];
  const inputs = document.querySelectorAll(
    'input[type="text"], input[type="email"], input[type="tel"], ' +
    'input[type="number"], input[type="date"], input:not([type]), select, textarea'
  );

  inputs.forEach((input, index) => {
    // Ignorar campos que no deben rellenarse
    if (
      input.disabled ||
      input.readOnly ||
      input.type === "hidden" ||
      input.type === "submit" ||
      input.type === "button" ||
      input.type === "checkbox" ||
      input.type === "radio" ||
      input.type === "password" ||
      input.value  // ya fue rellenado por el motor local
    ) return;

    // Texto del label asociado para dar contexto a la IA
    const labelEl = input.id
      ? document.querySelector(`label[for="${input.id}"]`)
      : null;
    const contextText =
      labelEl?.innerText?.trim() ||
      input.closest("label")?.innerText?.trim() ||
      "";

    // _key: identificador único que se usará como clave en el JSON de respuesta de Gemini
    // Preferimos id > name > índice generado
    const _key = input.id || input.name || `field_autofill_${index}`;

    // Si no hay ni id ni name, marcamos el elemento con un atributo temporal
    // para poder encontrarlo luego en fillFieldsWithAI
    if (!input.id && !input.name) {
      input.setAttribute("data-autofill-key", _key);
    }

    unresolved.push({
      _key,
      id: input.id || "",
      name: input.name || "",
      placeholder: input.placeholder || "",
      type: input.type || "text",
      contextText,
    });
  });

  return unresolved;
}

// ─── fillFieldsWithAI ────────────────────────────────────────────────────────
// Recibe el mapping { _key: valor } devuelto por Gemini y rellena los elementos.
function fillFieldsWithAI(mapping) {
  let filled = 0;

  for (const [key, value] of Object.entries(mapping)) {
    if (!key || value == null || value === "") continue;

    // Buscar el elemento por id, luego por name, luego por data-autofill-key
    const element =
      document.getElementById(key) ||
      document.getElementsByName(key)[0] ||
      document.querySelector(`[data-autofill-key="${key}"]`);

    if (!element) continue;

    element.focus();
    element.value = String(value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.blur();

    filled++;
  }

  // Limpiar los atributos temporales
  document.querySelectorAll("[data-autofill-key]").forEach((el) => {
    el.removeAttribute("data-autofill-key");
  });

  return filled;
}