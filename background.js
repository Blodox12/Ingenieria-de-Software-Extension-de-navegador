/**
 * background.js — Service Worker (Manifest V3)
 *
 * Responsabilidades:
 *  - Recibir mensajes del popup
 *  - Guardar/recuperar datos en chrome.storage.local
 *  - Hashear y verificar el PIN
 *  - Enviar datos al content script para autofill
 */

// ─── Utilidad: Hash simple del PIN ───────────────────────────────────────────
// Usamos SHA-256 via SubtleCrypto (disponible en Service Workers MV3).
// El PIN NO se guarda en texto plano.
async function hashPIN(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + "autofill_salt_mvp"); // salt fijo simple
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── Listener principal de mensajes ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Necesitamos manejar Promises con este patrón en MV3
  handleMessage(message).then(sendResponse).catch((err) => {
    sendResponse({ success: false, error: err.message });
  });
  return true; // Mantiene el canal abierto para respuesta asíncrona
});

async function handleMessage(message) {
  switch (message.action) {
    case "SET_PIN":
      return await setPin(message.pin);

    case "VERIFY_PIN":
      return await verifyPin(message.pin);

    case "SAVE_DATA":
      return await saveData(message.data);

    case "GET_DATA":
      return await getData();

    case "AUTOFILL":
      return await triggerAutofill();

    case "CHECK_PIN_EXISTS":
      return await checkPinExists();

    default:
      return { success: false, error: "Acción desconocida: " + message.action };
  }
}

// ─── Funciones de negocio ────────────────────────────────────────────────────

async function setPin(pin) {
  if (!pin || pin.length < 4) {
    return { success: false, error: "El PIN debe tener al menos 4 dígitos." };
  }
  const hashed = await hashPIN(pin);
  await chrome.storage.local.set({ pin_hash: hashed });
  return { success: true };
}

async function verifyPin(pin) {
  const result = await chrome.storage.local.get("pin_hash");
  if (!result.pin_hash) {
    return { success: false, error: "No hay PIN configurado." };
  }
  const hashed = await hashPIN(pin);
  if (hashed === result.pin_hash) {
    return { success: true };
  }
  return { success: false, error: "PIN incorrecto." };
}

async function checkPinExists() {
  const result = await chrome.storage.local.get("pin_hash");
  return { exists: !!result.pin_hash };
}

async function saveData(data) {
  if (!data || typeof data !== "object") {
    return { success: false, error: "Datos inválidos." };
  }
  await chrome.storage.local.set({ user_data: data });
  return { success: true };
}

async function getData() {
  const result = await chrome.storage.local.get("user_data");
  return { success: true, data: result.user_data || {} };
}

async function triggerAutofill() {
  // 1. Obtener datos guardados
  const result = await chrome.storage.local.get("user_data");
  const userData = result.user_data;

  if (!userData || Object.keys(userData).length === 0) {
    return { success: false, error: "No hay datos guardados para autofill." };
  }

  // 2. Obtener la pestaña activa
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    return { success: false, error: "No se encontró una pestaña activa." };
  }

  // 3. Enviar mensaje al content script con los datos
  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: "DO_AUTOFILL",
      data: userData,
    });
    return response;
  } catch (err) {
    // Si el content script no está inyectado (ej. página nueva), inyectarlo
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    // Reintentar
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: "DO_AUTOFILL",
      data: userData,
    });
    return response;
  }
}
