/**
 * background.js — Service Worker (Manifest V3)
 */

async function hashPIN(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + "autofill_salt_mvp");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((err) => {
    sendResponse({ success: false, error: err.message });
  });
  return true;
});

async function handleMessage(message) {
  switch (message.action) {
    case "SET_PIN":          return await setPin(message.pin);
    case "VERIFY_PIN":       return await verifyPin(message.pin);
    case "SAVE_DATA":        return await saveData(message.data);
    case "GET_DATA":         return await getData();
    case "AUTOFILL":         return await triggerAutofill();
    case "USE_AI_FALLBACK":  return await askGeminiToMapFields(message.fields, message.userData);
    case "CHECK_PIN_EXISTS": return await checkPinExists();
    case "GET_HISTORY":      return await getHistory();
    case "CLEAR_HISTORY":    return await clearHistory();
    case "GET_AI_ENABLED":   return await getAiEnabled();
    case "SET_AI_ENABLED":   return await setAiEnabled(message.enabled);
    default:                return { success: false, error: "Acción desconocida: " + message.action };
  }
}

async function setPin(pin) {
  if (!pin || pin.length < 4)
    return { success: false, error: "El PIN debe tener al menos 4 dígitos." };
  const hashed = await hashPIN(pin);
  await chrome.storage.local.set({ pin_hash: hashed });
  return { success: true };
}

async function verifyPin(pin) {
  const result = await chrome.storage.local.get("pin_hash");
  if (!result.pin_hash)
    return { success: false, error: "No hay PIN configurado." };
  const hashed = await hashPIN(pin);
  return hashed === result.pin_hash
    ? { success: true }
    : { success: false, error: "PIN incorrecto." };
}

async function checkPinExists() {
  const result = await chrome.storage.local.get("pin_hash");
  return { exists: !!result.pin_hash };
}

async function saveData(data) {
  if (!data || typeof data !== "object")
    return { success: false, error: "Datos inválidos." };
  await chrome.storage.local.set({ user_data: data });
  return { success: true };
}

async function getData() {
  const result = await chrome.storage.local.get("user_data");
  return { success: true, data: result.user_data || {} };
}

async function triggerAutofill() {
  const result = await chrome.storage.local.get("user_data");
  const userData = result.user_data;

  if (!userData || Object.keys(userData).length === 0)
    return { success: false, error: "No hay datos guardados para autofill." };

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab)
    return { success: false, error: "No se encontró una pestaña activa." };

  // Leer preferencia de IA antes de enviar al content script
  const { ai_enabled } = await chrome.storage.local.get("ai_enabled");
  const useAI = ai_enabled !== false; // true por defecto

  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, { action: "DO_AUTOFILL", data: userData, useAI });
  } catch (err) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    response = await chrome.tabs.sendMessage(tab.id, { action: "DO_AUTOFILL", data: userData, useAI });
  }

  // Guardar en historial
  if (response) {
    await appendHistory({
      url:       tab.url,
      title:     tab.title || tab.url,
      timestamp: Date.now(),
      success:   response.success,
      filled:    response.filledCount || 0,
      aiUsed:    response.aiInfo?.used || false,
      aiFields:  response.aiInfo?.filled || 0,
    });
  }

  return response;
}

// ── Historial ─────────────────────────────────────────────────────────────────
async function appendHistory(entry) {
  const result = await chrome.storage.local.get("autofill_history");
  const history = result.autofill_history || [];
  history.unshift(entry);          // más reciente primero
  if (history.length > 50) history.splice(50); // máximo 50 entradas
  await chrome.storage.local.set({ autofill_history: history });
}

async function getHistory() {
  const result = await chrome.storage.local.get("autofill_history");
  return { success: true, history: result.autofill_history || [] };
}

async function clearHistory() {
  await chrome.storage.local.remove("autofill_history");
  return { success: true };
}

// ── Preferencia de IA ─────────────────────────────────────────────────────────
async function getAiEnabled() {
  const result = await chrome.storage.local.get("ai_enabled");
  // Si nunca se guardó, el valor por defecto es true
  return { success: true, enabled: result.ai_enabled !== false };
}

async function setAiEnabled(enabled) {
  await chrome.storage.local.set({ ai_enabled: !!enabled });
  return { success: true };
}

async function askGeminiToMapFields(unresolvedFields, userData) {
  const API_KEY = "AIzaSyBJDqx03G6SmY1_HbulPci5bOwZdHYdoYw";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

  // Cada campo tiene una propiedad _key. Gemini debe usar ese valor exacto como clave en su respuesta.
  const prompt = `
Actúa como un asistente de autocompletado de formularios web.
Tengo los siguientes datos personales del usuario:
${JSON.stringify(userData)}

Y tengo los siguientes campos de un formulario web que no pude identificar automáticamente:
${JSON.stringify(unresolvedFields)}

Tu tarea es emparejar los datos del usuario con los campos del formulario usando el id, name, placeholder, type y contextText de cada campo.
IMPORTANTE: cada campo tiene una propiedad "_key". Debes usar ese valor exacto como clave en tu respuesta JSON.
Si no hay información suficiente para un campo, omítelo del resultado.
REGLA ESTRICTA: Responde ÚNICAMENTE con un objeto JSON válido. Sin markdown, sin explicaciones, solo el JSON en crudo.
Ejemplo de salida esperada: {"field_autofill_3": "Daniel Giraldo", "email_input": "correo@ejemplo.com"}
  `.trim();

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1024,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Error Gemini ${response.status}: ${text}` };
    }

    const data = await response.json();

    if (!data?.candidates?.length) {
      return { success: false, error: "Respuesta inválida de Gemini: no se recibieron candidatos." };
    }

    const rawText = data.candidates[0]?.content?.parts?.[0]?.text;
    console.log("=== GEMINI RAW ===", rawText);

    if (!rawText || typeof rawText !== "string") {
      return { success: false, error: "Respuesta inválida de Gemini: contenido inesperado." };
    }

    let mapping;
    try {
      mapping = JSON.parse(rawText);
    } catch (parseError) {
      // Intento de rescate: extraer el bloque JSON si viene con texto extra
      const first = rawText.indexOf("{");
      const last  = rawText.lastIndexOf("}");
      if (first !== -1 && last > first) {
        try {
          mapping = JSON.parse(rawText.slice(first, last + 1));
        } catch {
          return { success: false, error: "No se pudo parsear el JSON devuelto por Gemini." };
        }
      } else {
        return { success: false, error: "No se pudo parsear el JSON devuelto por Gemini." };
      }
    }

    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
      return { success: false, error: "El valor devuelto por Gemini no es un objeto JSON válido." };
    }

    return { success: true, mapping };

  } catch (error) {
    console.error("Error consultando a Gemini:", error);
    return { success: false, error: error.message || "Error desconocido al llamar a Gemini." };
  }
}