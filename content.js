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

  /**
   * Súper-Normalización: minúsculas, sin acentos y SIN caracteres especiales/espacios.
   * Esto hace que "fecha_nacimiento" y "Fecha Nacimiento" se vuelvan "fechanacimiento".
   */
  normalize(str) {
    if (!str) return "";
    return str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Quita acentos
      .replace(/[^a-z0-9]/g, "")      // Quita espacios, guiones, puntos y símbolos
      .trim();
  }

  /**
   * Resuelve el campo comparando el atributo contra el MAPA y las claves de USUARIO.
   */
  resolveFromAttribute(attrValue) {
    if (!attrValue) return null;
    const normalizedAttr = this.normalize(attrValue); // Ej: "fechanacimiento"

    const SHORT_KEYWORDS = new Set(["tel", "zip", "dni", "mail"]);

    // 1. Prioridad: Mapeo canónico
    for (const keyword of Object.keys(FIELD_MAP)) {
      const normKw = this.normalize(keyword);
      if (SHORT_KEYWORDS.has(normKw)) {
        // Para keywords cortas seguimos validando que no sea parte de otra palabra
        // Pero usamos una versión simplificada del regex post-normalización
        const pattern = new RegExp(`(^|[^a-z0-9])${normKw}([^a-z0-9]|$)`);
        if (pattern.test(normalizedAttr)) return FIELD_MAP[keyword];
      } else {
        if (normalizedAttr.includes(normKw)) return FIELD_MAP[keyword];
      }
    }

    // 2. Coincidencia con claves personalizadas del usuario (Ej: fecha_nacimiento)
    for (const userKey of Object.keys(this.userData)) {
      const normalizedUserKey = this.normalize(userKey); // "fecha_nacimiento" -> "fechanacimiento"
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
    try {
      const engine = new AutofillEngine(message.data);
      const count  = engine.run();

      if (count > 0) {
        sendResponse({
          success: true,
          message: `✅ ${count} campo(s) rellenado(s) correctamente.`,
        });
      } else {
        sendResponse({
          success: false,
          message: "⚠️ No se encontraron campos compatibles en este formulario.",
        });
      }
    } catch (err) {
      sendResponse({ success: false, message: "Error: " + err.message });
    }
    return true; 
  }
});