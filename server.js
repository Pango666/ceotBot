require("dotenv").config();
const express = require("express");
const axios = require("axios");
const botLogic = require("./botLogic");

const app = express();
app.use(express.json({ limit: "10mb" }));

// LOG TODO
app.use((req, _res, next) => {
  console.log("➡️", req.method, req.url);
  next();
});

const PORT = Number(process.env.PORT || 3010);
const EVO_BASE = (process.env.EVOLUTION_BASE_URL || "http://localhost:8088").replace(/\/$/, "");
const EVO_KEY = process.env.EVOLUTION_API_KEY || "";
const INSTANCE = process.env.EVOLUTION_INSTANCE || "demo";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";

console.log("ℹ️ EVO_BASE:", EVO_BASE, "| INSTANCE:", INSTANCE);
if (!EVO_KEY) console.warn("⚠️ EVOLUTION_API_KEY vacío.");

// --- Security (opcional) ---
function checkSecret(req) {
  if (!WEBHOOK_SECRET) return true;
  return (req.header("x-webhook-secret") || "") === WEBHOOK_SECRET;
}

function jidToNumber(jid) {
  if (!jid || typeof jid !== "string") return null;
  const at = jid.indexOf("@");
  return at >= 0 ? jid.slice(0, at) : jid;
}

// --- payload helpers (Evolution) ---
function getEnvelope(payload) {
  return payload?.data ? payload : { data: payload };
}

function getFirstMessage(payload) {
  const env = getEnvelope(payload);
  return (
    env?.data?.message ||
    env?.data?.messages?.[0] ||
    payload?.message ||
    payload?.messages?.[0] ||
    null
  );
}

function getMessageContent(payload) {
  const m = getFirstMessage(payload);
  return m?.message || m;
}

function isFromMe(payload) {
  const env = getEnvelope(payload);
  const m = getFirstMessage(payload);
  return Boolean(env?.data?.key?.fromMe || m?.key?.fromMe || m?.fromMe);
}

function getRemoteJid(payload) {
  const env = getEnvelope(payload);
  const m = getFirstMessage(payload);
  return (
    env?.data?.key?.remoteJidAlt ||
    env?.data?.key?.remoteJid ||
    m?.key?.remoteJid ||
    m?.remoteJid ||
    payload?.remoteJid ||
    null
  );
}

function extractText(payload) {
  const msg = getMessageContent(payload);

  const text =
    msg?.conversation ||
    msg?.extendedTextMessage?.text ||
    msg?.imageMessage?.caption ||
    msg?.videoMessage?.caption ||
    null;

  if (text) return text;

  return (
    msg?.buttonsResponseMessage?.selectedButtonId ||
    msg?.buttonsResponseMessage?.selectedDisplayText ||
    msg?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    msg?.listResponseMessage?.singleSelectReply?.title ||
    null
  );
}

// --- HTTP to Evolution ---
const evo = axios.create({
  baseURL: EVO_BASE,
  timeout: 15000,
  headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
  validateStatus: () => true,
});

async function sendText(number, text) {
  const url = `/message/sendText/${encodeURIComponent(INSTANCE)}`;
  const body = { number: String(number), text: String(text) };

  const r = await evo.post(url, body);
  if (r.status >= 300) throw new Error(`sendText failed: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

function menuText() {
  return (
    "🦷 *Bienvenido a DentalCare* 🦷\n" +
    "¡Tu sonrisa es nuestra prioridad! ✨\n\n" +
    "1️⃣ *Agendar Cita* 🗓️\n" +
    "2️⃣ *Mis Citas* 📋\n" +
    "3️⃣ *Registrarme* 📝\n" +
    "4️⃣ *Diagnóstico IA* 🤖\n\n" +
    "👇 *Responde con el número de la opción deseada.*"
  );
}

// BUTTONS
async function sendButtons(number, title, description, buttons) {
  const url = `/message/sendButtons/${encodeURIComponent(INSTANCE)}`;
  const body = {
    number: String(number),
    title: String(title),
    description: String(description),
    footer: "DentalCare Bot",
    buttons: buttons.map((b) => ({
      type: "reply",
      displayText: String(b.text),
      id: String(b.id),
    })),
  };

  const r = await evo.post(url, body);
  if (r.status >= 300) throw new Error(`sendButtons failed: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

// GENERIC LIST
async function sendList(number, title, description, buttonText, sections) {
  const url = `/message/sendList/${encodeURIComponent(INSTANCE)}`;
  const body = {
    number: String(number),
    title: String(title),
    description: String(description),
    buttonText: String(buttonText),
    footerText: "DentalCare Bot",
    sections: sections
  };

  const r = await evo.post(url, body);
  if (r.status >= 300) throw new Error(`sendList failed: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

// --- endpoints ---
app.get("/health", (_req, res) => res.json({ ok: true, instance: INSTANCE }));

async function handleWebhook(req, res) {
  try {
    if (!checkSecret(req)) return res.status(401).send("unauthorized");

    const payload = req.body;

    // si quieres ver el body completo descomenta:
    // console.log("📦 BODY:", JSON.stringify(payload, null, 2).slice(0, 4000));

    if (isFromMe(payload)) return res.status(200).send("ignored");

    const remoteJid = getRemoteJid(payload);
    const number = jidToNumber(remoteJid);
    const text = extractText(payload);

    console.log("📩 remoteJid:", remoteJid, "| number:", number, "| text:", text);

    if (!number || !text) return res.status(200).send("no-content");

    // Bot logic
    const response = await botLogic.handleMessage(number, text);

    if (response) {
      if (typeof response === "string") {
        await sendText(number, response);
      }

      else if (typeof response === "object" && response.type === "buttons") {
        // STRATEGY: Send Text FIRST (Guarantee delivery)
        await sendText(number, response.text);

        // Then try sending buttons alone (as a "controls" message)
        try {
          // We use a short title for the buttons message
          await sendButtons(number, response.title || "Opciones", "Selecciona una acción", response.buttons);
        } catch (e) {
          console.error("⚠️ Buttons failed to send (user already has text):", e.message);
        }
      }

      else if (typeof response === "object" && response.type === "list") {
        // STRATEGY: Send Text FIRST (Guarantee delivery of instruction)
        await sendText(number, response.text);

        // Then send the List
        try {
          await sendList(number, response.title, "Haz clic abajo 👇", response.buttonText, response.sections);
        } catch (e) {
          console.error("⚠️ List failed to send (falling back to text options):", e.message);
          // Fallback: print options as text
          let listText = "\n";
          response.sections.forEach(sec => {
            if (sec.title) listText += `\n📌 *${sec.title}*\n`;
            sec.rows.forEach(row => {
              // Show "[ID] Title" clearly with bullet
              listText += `🔹 [${row.rowId}] *${row.title}*\n      _${row.description || ""}_\n`;
            });
          });
          await sendText(number, `📋 *Selecciona una opción:*\n(Escribe el número correspondiente)\n${listText}`);
        }
      }

      console.log("✅ replied to:", number);
    } else {
      await sendText(number, menuText());
      console.log("✅ menu text sent to:", number);
    }

    return res.status(200).send("ok");
  } catch (e) {
    console.error("❌ webhook error:", e?.response?.data || e?.message || e);
    return res.status(200).send("ok");
  }
}

/**
 * IMPORTANTÍSIMO:
 * Registramos el mismo handler en varios paths
 * porque tu webhook a veces llega a /, a veces a /webhook,
 * y si "webhook_by_events" existe puede llegar como /messages-upsert, etc.
 */
app.post("/", handleWebhook);
app.post("/webhook", handleWebhook);
app.post("/messages-upsert", handleWebhook);
app.post("/webhook/messages-upsert", handleWebhook);

app.post("/connection-update", (_req, res) => res.status(200).send("ok"));
app.post("/qrcode-updated", (_req, res) => res.status(200).send("ok"));
app.post("/webhook/connection-update", (_req, res) => res.status(200).send("ok"));
app.post("/webhook/qrcode-updated", (_req, res) => res.status(200).send("ok"));

app.listen(PORT, () => console.log(`✅ Bot escuchando en http://localhost:${PORT}`));
