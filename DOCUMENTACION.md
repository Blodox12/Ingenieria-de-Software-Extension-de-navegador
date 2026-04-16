# AutoFill Pro — Documentación del MVP
## Proyecto Universitario · Ingeniería de Software

---

## A) ARQUITECTURA PROPUESTA MÍNIMA

### Por qué esta arquitectura es adecuada para un MVP académico

Chrome Extensions MV3 impone una separación de responsabilidades obligatoria por seguridad. En lugar de luchar contra eso, la arquitectura del MVP la aprovecha:

- **Sin backend**: Todo vive en el navegador → sin costos, sin servidores, sin deploy.
- **Sin frameworks**: HTML/CSS/JS vanilla → cualquier miembro del equipo puede leerlo y modificarlo sin curva de aprendizaje.
- **Flujo lineal**: Popup → Background → Content Script. Cada mensaje tiene un propósito claro.
- **chrome.storage.local**: API oficial, persistente entre sesiones, asíncrona. Perfecta para MVP.

---

### Componentes y responsabilidades

```
┌─────────────────────────────────────────────────────────────────┐
│                        CHROME EXTENSION                         │
│                                                                 │
│  ┌──────────────┐    mensajes     ┌──────────────────────────┐  │
│  │   popup.html │ ──────────────► │   background.js          │  │
│  │   popup.js   │ ◄────────────── │   (Service Worker)       │  │
│  │              │    respuestas   │                          │  │
│  │  - UI/UX     │                 │  - Hashear PIN           │  │
│  │  - Inputs    │                 │  - Verificar PIN         │  │
│  │  - Pantallas │                 │  - Guardar datos         │  │
│  │  - NO toca   │                 │  - Leer datos            │  │
│  │    el DOM    │                 │  - Coordinar autofill    │  │
│  │    de la web │                 │                          │  │
│  └──────────────┘                 └──────────┬───────────────┘  │
│                                              │ sendMessage       │
│                                              ▼                   │
│                                  ┌──────────────────────────┐   │
│                                  │   content.js             │   │
│                                  │   (inyectado en la web)  │   │
│                                  │                          │   │
│                                  │  - Detectar inputs/sel.  │   │
│                                  │  - Mapear campos         │   │
│                                  │  - Inyectar valores      │   │
│                                  │  - Disparar eventos DOM  │   │
│                                  └──────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │   chrome.storage.local                                   │    │
│  │   { pin_hash: "sha256...", user_data: { nombre: "..." }} │    │
│  └──────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Responsabilidad de cada componente

| Componente | Responsabilidad | Accede a |
|---|---|---|
| **popup.html/js** | UI, pantallas, envío de mensajes | Background via `chrome.runtime.sendMessage` |
| **background.js** | Lógica de negocio, PIN, storage, coordinación | `chrome.storage.local`, `chrome.tabs` |
| **content.js** | Manipulación del DOM de la página web | DOM de la pestaña activa |
| **chrome.storage.local** | Persistencia de datos | Leído/escrito por background |

---

## B) ESTRUCTURA DE ARCHIVOS

```
autofill-extension/
│
├── manifest.json          ← Configuración de la extensión (MV3)
├── background.js          ← Service Worker: lógica central
├── content.js             ← Se inyecta en páginas web
├── popup.html             ← Interfaz del popup
├── popup.js               ← Lógica del popup
│
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

**Total: 6 archivos. Sin dependencias externas. Sin npm. Sin build.**

---

## C) LÓGICA CLAVE — EXPLICACIONES

### Seguridad del PIN (la solución más simple viable para MVP)

```javascript
// background.js
async function hashPIN(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + "autofill_salt_mvp"); // salt fijo
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  // ... convierte a hex string
}
```

**¿Por qué SubtleCrypto + SHA-256?**
- Disponible nativamente en Service Workers MV3 (sin librerías).
- El PIN **nunca se guarda en texto plano**.
- El salt fijo previene ataques de rainbow table básicos.
- Para un MVP académico es más que suficiente. En producción real usaríamos bcrypt.

**Lo que se guarda en storage:**
```json
{
  "pin_hash": "a3f2c9d1e8b7...",
  "user_data": {
    "nombre": "Juan",
    "apellido": "Pérez",
    "email": "juan@email.com",
    ...
  }
}
```

### Autofill: Mapeo de campos

```javascript
// content.js — El mapeo funciona por palabras clave en atributos HTML
const FIELD_MAP = {
  "nombre": "nombre",   // si el input tiene name="nombre" o id="nombre"
  "name":   "nombre",   // o name="name" (formularios en inglés)
  "email":  "email",
  "phone":  "telefono",
  // ... etc.
};
```

Para cada `<input>` y `<select>` de la página, el content script revisa:
`name`, `id`, `placeholder`, `autocomplete`, `aria-label`

Si encuentra una coincidencia, inyecta el valor y dispara eventos `input` y `change` para compatibilidad con frameworks como React/Vue/Angular.

---

## D) FLUJO COMPLETO PASO A PASO

### Flujo 1: Primera vez — Configurar PIN

```
Usuario                    popup.js              background.js        storage
   │                          │                       │                  │
   │── ingresa PIN ──────────►│                       │                  │
   │── confirma PIN ─────────►│                       │                  │
   │                          │── SET_PIN(pin) ───────►│                  │
   │                          │                       │── hashPIN() ─────►│
   │                          │                       │── storage.set()──►│
   │                          │◄── { success: true } ──│                  │
   │◄─── "PIN configurado" ───│                       │                  │
   │                          │── showScreen(main) ───►│                  │
```

### Flujo 2: Guardar datos personales

```
Usuario                    popup.js              background.js        storage
   │                          │                       │                  │
   │── llena formulario ─────►│                       │                  │
   │── click "Guardar" ───────►│                       │                  │
   │                          │── SAVE_DATA(data) ────►│                  │
   │                          │                       │── storage.set()──►│
   │                          │◄── { success: true } ──│                  │
   │◄─── "Datos guardados" ───│                       │                  │
```

### Flujo 3: Sesiones siguientes — Verificar PIN

```
Usuario                    popup.js              background.js        storage
   │                          │                       │                  │
   │                          │── CHECK_PIN_EXISTS ───►│                  │
   │                          │                       │── storage.get()──►│
   │                          │◄── { exists: true } ───│                  │
   │                          │── showScreen(verify) ──│                  │
   │── ingresa PIN ──────────►│                       │                  │
   │── click "Desbloquear" ──►│                       │                  │
   │                          │── VERIFY_PIN(pin) ────►│                  │
   │                          │                       │── hashPIN(pin)    │
   │                          │                       │── storage.get()──►│
   │                          │                       │◄─ pin_hash ───────│
   │                          │                       │── compare hashes  │
   │                          │◄── { success: true } ──│                  │
   │◄─── muestra pantalla ────│                       │                  │
│         principal            │                       │                  │
```

### Flujo 4: Ejecutar AutoFill ← El flujo más importante

```
Usuario          popup.js        background.js      content.js       Formulario web
   │                │                  │                 │                  │
   │─ click ───────►│                  │                 │                  │
   │  "AutoFill"    │── AUTOFILL ─────►│                 │                  │
   │                │                  │── GET data ─────►storage           │
   │                │                  │◄─ user_data ─────│                 │
   │                │                  │── tabs.query()   │                 │
   │                │                  │   (pestaña activa)                 │
   │                │                  │── sendMessage ──►│                 │
   │                │                  │   DO_AUTOFILL     │                 │
   │                │                  │   + data          │                 │
   │                │                  │                  │─ detecta inputs►│
   │                │                  │                  │─ mapea campos   │
   │                │                  │                  │─ fillInput() ──►│
   │                │                  │                  │─ fillSelect() ──►│
   │                │                  │                  │─ dispara eventos│
   │                │                  │◄─ { filled: 3 } ──│                │
   │                │◄─ { success } ───│                  │                 │
   │◄─ "3 campos ───│                  │                  │                 │
│    rellenados"    │                  │                  │                 │
```

---

## E) HISTORIAS DE USUARIO

### HU-01: Configurar PIN de seguridad

**Como** usuario nuevo de la extensión,  
**quiero** configurar un PIN de acceso,  
**para** proteger mis datos personales de accesos no autorizados.

**Criterios de aceptación:**
- El usuario puede ingresar un PIN de mínimo 4 dígitos.
- El sistema solicita confirmar el PIN antes de guardarlo.
- Si los PINs no coinciden, se muestra un mensaje de error claro.
- El PIN se almacena hasheado (SHA-256); no es legible en texto plano.
- Tras configurarlo, el usuario accede directamente a la pantalla principal.

---

### HU-02: Desbloquear la extensión con PIN

**Como** usuario registrado,  
**quiero** ingresar mi PIN cada vez que abro la extensión,  
**para** que mis datos no sean accesibles a quien use mi computador.

**Criterios de aceptación:**
- Al abrir el popup, si ya hay un PIN configurado, se muestra la pantalla de verificación.
- Si el PIN es correcto, se accede a la pantalla principal.
- Si el PIN es incorrecto, se muestra un mensaje de error y el campo se limpia.
- El sistema no bloquea la cuenta (sin límite de intentos en MVP).
- Nunca se muestra el PIN ni su hash al usuario.

---

### HU-03: Ingresar datos personales

**Como** usuario,  
**quiero** ingresar mis datos personales (nombre, email, teléfono, etc.),  
**para** que la extensión pueda usarlos al rellenar formularios.

**Criterios de aceptación:**
- El formulario incluye: nombre, apellido, email, teléfono, documento, dirección, ciudad, país, código postal.
- El usuario puede llenar cualquier subconjunto de campos (ninguno es obligatorio).
- Al hacer clic en "Guardar datos", los datos se persisten en chrome.storage.local.
- Se muestra confirmación visual de que los datos fueron guardados.

---

### HU-04: Ver resumen de datos guardados

**Como** usuario,  
**quiero** ver un resumen de los datos que tengo guardados,  
**para** verificar que son correctos antes de ejecutar el autofill.

**Criterios de aceptación:**
- La pestaña "AutoFill" muestra un preview de todos los campos con datos guardados.
- Los campos vacíos no se muestran en el preview.
- Si no hay datos guardados, se muestra el mensaje "No hay datos guardados aún".
- El preview se actualiza inmediatamente al guardar nuevos datos.

---

### HU-05: Rellenar automáticamente inputs de texto

**Como** usuario,  
**quiero** hacer clic en "AutoFill" para que la extensión rellene los inputs de texto de un formulario,  
**para** ahorrar tiempo al completar formularios web.

**Criterios de aceptación:**
- Al hacer clic en "AutoFill", los campos `<input type="text">`, `<input type="email">` y `<input type="tel">` se rellenan si hay coincidencia con los datos guardados.
- La detección funciona por los atributos `name`, `id`, `placeholder`, `autocomplete` y `aria-label`.
- Se soportan formularios en español e inglés (nombre/name, email/correo, etc.).
- Se muestra el número de campos rellenados al completar la operación.

---

### HU-06: Rellenar automáticamente campos select

**Como** usuario,  
**quiero** que el autofill también funcione en campos `<select>`,  
**para** que mis datos de ciudad, país u otras opciones se seleccionen automáticamente.

**Criterios de aceptación:**
- Los `<select>` son detectados y rellenados si su `name` o `id` coincide con un campo del usuario.
- La búsqueda de la opción correcta se hace por valor (`value`) o por texto visible.
- La comparación ignora mayúsculas, minúsculas y acentos.
- Si no se encuentra la opción exacta, el select no se modifica.

---

### HU-07: Recibir feedback del resultado del autofill

**Como** usuario,  
**quiero** ver un mensaje que indique si el autofill fue exitoso,  
**para** saber si la operación funcionó o si debo revisar el formulario manualmente.

**Criterios de aceptación:**
- Si se rellenó al menos 1 campo, se muestra "X campo(s) rellenado(s) correctamente."
- Si no se encontraron campos compatibles, se muestra "No se encontraron campos compatibles en este formulario."
- Si no hay datos guardados, se muestra el mensaje correspondiente.
- El mensaje desaparece automáticamente después de 3.5 segundos.

---

### HU-08: Bloquear la sesión manualmente

**Como** usuario,  
**quiero** poder bloquear la sesión desde la extensión,  
**para** proteger mis datos si me alejo del computador.

**Criterios de aceptación:**
- Hay un botón "Bloquear sesión" visible en la pantalla principal.
- Al hacer clic, la sesión se bloquea y se muestra la pantalla de ingreso de PIN.
- Los datos del usuario permanecen guardados en storage (no se borran).
- Para volver a acceder se debe ingresar el PIN correctamente.

---

### HU-09: Modificar datos guardados

**Como** usuario,  
**quiero** poder editar mis datos personales después de haberlos guardado,  
**para** mantenerlos actualizados.

**Criterios de aceptación:**
- Al abrir la pestaña "Mis Datos" tras un login exitoso, los campos muestran los valores actualmente guardados.
- El usuario puede modificar cualquier campo y guardar de nuevo.
- Los nuevos valores reemplazan los anteriores en storage.
- El preview en la pestaña "AutoFill" se actualiza inmediatamente.

---

### HU-10: Cambiar PIN

**Como** usuario,  
**quiero** poder cambiar mi PIN en cualquier momento,  
**para** mantener la seguridad de mis datos.

**Criterios de aceptación:**
- Hay un botón "Cambiar PIN" visible en la pestaña "Mis Datos".
- Al hacer clic, se redirige a la pantalla de configuración de PIN.
- El usuario debe ingresar y confirmar el nuevo PIN.
- El nuevo PIN reemplaza el anterior en storage (hasheado).
- Los datos del usuario no se borran al cambiar el PIN.

---

## F) RIESGOS TÉCNICOS Y MITIGACIONES

### Riesgo 1: Content script no inyectado en la pestaña activa
**Probabilidad:** Alta (páginas abiertas antes de instalar la extensión).  
**Impacto:** El autofill no funciona.  
**Mitigación:** En `background.js`, si `sendMessage` falla, se usa `chrome.scripting.executeScript` para inyectar `content.js` programáticamente, y luego se reintenta. **Ya está implementado en el código.**

---

### Riesgo 2: Formularios con atributos no estándar o generados dinámicamente
**Probabilidad:** Media (muchos frameworks generan `id` aleatorios como `mat-input-0`).  
**Impacto:** El autofill no detecta los campos.  
**Mitigación:** El `FIELD_MAP` cubre los atributos `name`, `id`, `placeholder`, `autocomplete`, y `aria-label`. Para el demo, usar formularios simples con atributos estándar. En 2 días, priorizar que funcione en 2-3 formularios de prueba específicos.

---

### Riesgo 3: Páginas que restringen content scripts (CSP estricto)
**Probabilidad:** Baja en páginas normales, alta en `chrome://` o extensiones.  
**Impacto:** El script no se ejecuta.  
**Mitigación:** Documentar en el video que el autofill funciona en páginas web normales, no en páginas del sistema de Chrome. Preparar un formulario HTML de prueba propio.

---

### Riesgo 4: Datos no persisten al reiniciar Chrome
**Probabilidad:** Muy baja (`chrome.storage.local` es persistente).  
**Impacto:** Usuario pierde sus datos.  
**Mitigación:** Verificar que se usa `chrome.storage.local` (no `sessionStorage`). **Ya implementado correctamente.**

---

### Riesgo 5: El equipo no conoce JavaScript
**Probabilidad:** Alta (mencionado en el contexto).  
**Impacto:** Dificultad para depurar.  
**Mitigación estratégica para 2 días:**
1. **Día 1**: Instalar la extensión, probar el flujo PIN → guardar datos → autofill en formulario propio.
2. **Día 2**: Probar en formularios reales, grabar el video demo, preparar artefactos.
- Usar `console.log()` extensamente para depurar. El log del Service Worker se ve en `chrome://extensions → Service Worker → Inspect`.

---

### Riesgo 6: Formulario de prueba no disponible
**Probabilidad:** Media si no se prepara con anticipación.  
**Impacto:** No hay qué mostrar en el video.  
**Mitigación:** Crear un `test-form.html` local con campos estándar. **Archivo incluido abajo.**

---

## ARCHIVO BONUS: test-form.html

Formulario de prueba para demostrar el autofill:

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Formulario de Prueba — AutoFill MVP</title>
  <style>
    body { font-family: sans-serif; max-width: 500px; margin: 40px auto; padding: 20px; }
    label { display: block; margin-top: 16px; font-weight: bold; }
    input, select { width: 100%; padding: 8px; margin-top: 4px; border: 1px solid #ccc; border-radius: 4px; }
    button { margin-top: 20px; padding: 10px 20px; background: #4f8ef7; color: white; border: none; border-radius: 4px; cursor: pointer; }
  </style>
</head>
<body>
  <h1>Formulario de Registro</h1>
  <form>
    <label>Nombre</label>
    <input type="text" name="nombre" placeholder="Tu nombre" />

    <label>Apellido</label>
    <input type="text" name="apellido" placeholder="Tu apellido" />

    <label>Email</label>
    <input type="email" name="email" placeholder="correo@ejemplo.com" />

    <label>Teléfono</label>
    <input type="tel" name="telefono" placeholder="+57 300..." />

    <label>Documento</label>
    <input type="text" name="documento" placeholder="Número de documento" />

    <label>Dirección</label>
    <input type="text" name="direccion" placeholder="Calle y número" />

    <label>Ciudad</label>
    <select name="ciudad">
      <option value="">Selecciona...</option>
      <option value="bogota">Bogotá</option>
      <option value="medellin">Medellín</option>
      <option value="cali">Cali</option>
      <option value="barranquilla">Barranquilla</option>
    </select>

    <label>País</label>
    <select name="pais">
      <option value="">Selecciona...</option>
      <option value="colombia">Colombia</option>
      <option value="mexico">México</option>
      <option value="argentina">Argentina</option>
      <option value="españa">España</option>
    </select>

    <label>Código Postal</label>
    <input type="text" name="codigoPostal" placeholder="110111" />

    <button type="button">Enviar (demo)</button>
  </form>
</body>
</html>
```

---

## GUÍA DE INSTALACIÓN Y DEMO (5 minutos)

### Instalación
1. Descargar y descomprimir el archivo ZIP.
2. Abrir Chrome → `chrome://extensions`.
3. Activar "Modo desarrollador" (esquina superior derecha).
4. Clic en "Cargar descomprimida" → seleccionar la carpeta `autofill-extension`.
5. La extensión aparece en la barra de Chrome con el ícono ⚡.

### Script de demo (5 min)
1. **(0:00-0:30)** Abrir la extensión → mostrar pantalla de configuración de PIN → ingresar PIN "1234".
2. **(0:30-1:30)** Ir a la pestaña "Mis Datos" → llenar todos los campos → clic "Guardar datos".
3. **(1:30-2:00)** Ir a la pestaña "AutoFill" → mostrar el preview de datos.
4. **(2:00-3:30)** Abrir `test-form.html` en una pestaña → hacer clic en "AutoFill" → mostrar campos rellenados.
5. **(3:30-4:00)** Demostrar bloqueo de sesión → reingresar PIN → volver a autofill.
6. **(4:00-5:00)** Mostrar el código y explicar la arquitectura brevemente.
