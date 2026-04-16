# AutoFill-Form 

> Extensión de navegador para Google Chrome que autocompleta formularios web con los datos personales del usuario de forma segura, local e inteligente.

---

## Tabla de contenido

- [Descripción](#descripción)
- [Características principales](#características-principales)
- [Arquitectura](#arquitectura)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Instalación](#instalación)
- [Uso](#uso)
- [Modelo de datos](#modelo-de-datos)
- [Seguridad](#seguridad)
- [Tecnologías](#tecnologías)
- [Equipo](#equipo)

---

## Descripción

**AutoFill-Form** es una extensión de Chrome (Manifest V3) que permite al usuario almacenar sus datos personales de forma local y segura, y autocompletar formularios web con un solo clic. No requiere servidor externo ni conexión a la nube — toda la información vive en el navegador del usuario mediante `chrome.storage.local`.

El motor de autofill utiliza normalización avanzada de strings y resolución flexible de atributos del DOM (`name`, `id`, `placeholder`, `autocomplete`), lo que le permite identificar campos correctamente incluso con variaciones de idioma, formato o nomenclatura.

---

## Características principales

- **Autofill inteligente** — detecta y rellena campos de formularios en páginas externas mediante un motor modular (`AutofillEngine`, `FieldResolver`, `FormFiller`).
- **CRUD completo de datos personales** — el usuario puede crear, leer, actualizar y eliminar su información en cualquier momento.
- **Campos personalizados** — soporte para agregar atributos adicionales no predefinidos.
- **Autenticación por PIN** — acceso protegido mediante PIN hasheado con SHA-256 (API nativa `SubtleCrypto`). El PIN puede actualizarse desde la interfaz.
- **Compatibilidad con frameworks frontend** — funciona en formularios construidos con React, Angular y Vue mediante disparo manual de eventos `input` y `change`.
- **Soporte para Microsoft Edge**.
- **Sin dependencias externas de backend** — privacidad total, los datos nunca salen del dispositivo.

---

## Arquitectura

La extensión sigue un estilo arquitectónico en capas (N-Tiers) con comunicación orientada a eventos:

| Capa | Componente | Responsabilidad |
|---|---|---|
| Presentación | `popup.html` / `popup.js` | Interfaz de usuario de la extensión |
| Lógica de negocio | `background.js` (service worker) | Coordinación de mensajes y lógica central |
| Acceso al DOM | `content.js` | Inyección y manipulación de formularios en páginas externas |
| Persistencia | `chrome.storage.local` | Almacenamiento local de datos del usuario |

La comunicación entre capas es asíncrona mediante `chrome.runtime.sendMessage` y listeners `onMessage`.

---

## Instalación

Como la extensión aún no está publicada en la Chrome Web Store, se instala en modo desarrollador:

1. Clona el repositorio:
   ```bash
   git clone https://github.com/Blodox12/Ingenieria-de-Software-Extension-de-navegador.git
   ```

2. Abre Google Chrome y ve a `chrome://extensions/`.

3. Activa el **Modo desarrollador** (esquina superior derecha).

4. Haz clic en **"Cargar descomprimida"** y selecciona la carpeta del proyecto.

5. La extensión aparecerá en la barra de herramientas de Chrome.

> También compatible con **Microsoft Edge**: ve a `edge://extensions/` y sigue los mismos pasos.

---

## Uso

1. Haz clic en el ícono de la extensión en la barra de herramientas.
2. En el primer uso, crea un PIN de acceso.
3. Ingresa tus datos personales en el formulario de perfil (nombre, correo, teléfono, dirección, documento, etc.).
4. Navega a cualquier página con un formulario web.
5. Haz clic en el botón de autofill — la extensión detectará y rellenará los campos automáticamente.
6. Revisa y ajusta los datos llenados antes de enviar el formulario.

---

## Modelo de datos

Los datos se almacenan localmente en `chrome.storage.local` con la siguiente estructura lógica:

**`Usuario`** — datos personales del usuario (nombre, apellido, correo, teléfono, dirección, tipo y número de documento, fecha de nacimiento).

**`Autenticacion`** — PIN hasheado con SHA-256, algoritmo utilizado y fecha de última actualización. Vinculada uno a uno con `Usuario`.

**`CampoPersonalizado`** — atributos adicionales definidos por el usuario como pares clave-valor. Vinculados uno a muchos con `Usuario`.

**`Configuracion`** — preferencias de la extensión (autofill activo/inactivo, idioma). Vinculada uno a uno con `Usuario`.

> Al ser un almacén de documentos JSON (no relacional), las relaciones entre entidades son lógicas, no foreign keys físicas.

---

## Seguridad

- El PIN **nunca se almacena en texto plano** — se guarda únicamente su hash SHA-256 usando la API nativa `SubtleCrypto` del navegador.
- Todos los datos permanecen en el dispositivo del usuario. **No hay transmisión de datos a servidores externos**.
- El content script opera con los permisos mínimos necesarios definidos en `manifest.json`.

---

## Tecnologías

| Tecnología | Uso |
|---|---|
| JavaScript (Vanilla JS) | Lógica principal de la extensión |
| HTML5 + CSS3 | Interfaz del popup |
| Chrome Extension API (Manifest V3) | Gestión de permisos, tabs, scripting y storage |
| `chrome.storage.local` | Persistencia de datos local |
| `SubtleCrypto` (Web API nativa) | Hashing SHA-256 del PIN |

No se utilizaron frameworks externos (React, Angular, Vue) en el desarrollo de la extensión, optando por JavaScript puro para facilitar la comprensión y mantenimiento del código por parte del equipo.

---

## Equipo

Desarrollado como proyecto académico para el curso de **Ingeniería de Software** — Universidad EAFIT, 2026-1.

| Nombre | 
|---|
| Daniel Mauricio Giraldo Moreno |
| Miguel Angel Alzate Osorno |
| Johan Alejandro Peña Rivera |
| Ismael García Ceballos |

**Docente:** Paola Noreña