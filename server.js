require("dotenv").config();
const express = require("express");
const axios = require("axios");
const botLogic = require("./botLogic");

const app = express();
app.use(express.json({ limit: "10mb" }));

// LOG request
app.use((req, _res, next) => {
  console.log("➡️", req.method, req.url);
  next();
});

const PORT = Number(process.env.PORT || 3010);
const EVO_BASE = (process.env.EVOLUTION_BASE_URL || "http://localhost:8088").replace(/\/$/, "");
const EVO_KEY = process.env.EVOLUTION_API_KEY || "";
const INSTANCE = process.env.EVOLUTION_INSTANCE || "demo";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";

// ============================================
// 🛡️ ANTI-BAN: Rate Limiting & Human Delays
// ============================================
const userLastMessage = new Map(); // phone -> timestamp
const RATE_LIMIT_MS = Number(process.env.RATE_LIMIT_MS || 2000);
const MIN_DELAY_MS = Number(process.env.MIN_DELAY_MS || 1000);
const MAX_DELAY_MS = Number(process.env.MAX_DELAY_MS || 3000);
const TYPING_DELAY_PER_CHAR = 30;
const DISABLE_LISTS = process.env.DISABLE_LISTS === "true";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(min = MIN_DELAY_MS, max = MAX_DELAY_MS) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function calculateTypingDelay(text) {
  const len = typeof text === 'string' ? text.length : 50;
  return Math.min(len * TYPING_DELAY_PER_CHAR, 5000);
}

function isRateLimited(number) {
  const last = userLastMessage.get(number);
  const now = Date.now();

  if (last && (now - last) < RATE_LIMIT_MS) {
    console.log(`⏳ Rate limited: ${number} (wait ${RATE_LIMIT_MS - (now - last)}ms)`);
    return true;
  }

  userLastMessage.set(number, now);
  return false;
}

// Cleanup old entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  const expiry = 10 * 60 * 1000;
  for (const [key, time] of userLastMessage.entries()) {
    if (now - time > expiry) userLastMessage.delete(key);
  }
}, 10 * 60 * 1000);
// ============================================

console.log("ℹ️ EVO_BASE:", EVO_BASE, "| INSTANCE:", INSTANCE);
if (!EVO_KEY) console.warn("⚠️ EVOLUTION_API_KEY vacío.");

function checkSecret(req) {
  if (!WEBHOOK_SECRET) return true;
  return (req.header("x-webhook-secret") || "") === WEBHOOK_SECRET;
}

function jidToNumber(jid) {
  if (!jid || typeof jid !== "string") return null;
  const at = jid.indexOf("@");
  return at >= 0 ? jid.slice(0, at) : jid;
}

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

const evo = axios.create({
  baseURL: EVO_BASE,
  timeout: 15000,
  headers: { apikey: EVO_KEY, "Content-Type": "application/json" },
  validateStatus: () => true,
});

async function sendText(number, text, applyDelay = true) {
  // 🛡️ ANTI-BAN: Add human-like delay before sending
  if (applyDelay) {
    const typingDelay = calculateTypingDelay(text);
    const humanDelay = randomDelay(500, 1500);
    await sleep(typingDelay + humanDelay);
  }

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

app.post("/push-message", async (req, res) => {
  try {
    if (!checkSecret(req)) return res.status(401).json({ error: "Unauthorized" });

    const { number, message, buttons } = req.body;

    if (!number || !message) {
      return res.status(400).json({ error: "Missing 'number' or 'message'" });
    }

    console.log(`📤 Pushing message to ${number}`);

    if (buttons && Array.isArray(buttons) && buttons.length > 0) {
      await sendText(number, message);
      await sendButtons(number, "Recordatorio", "Selecciona una opción", buttons);
    } else {
      await sendText(number, message);
    }

    return res.json({ success: true });
  } catch (e) {
    console.error("❌ Push error:", e.message);
    return res.status(500).json({ error: e.message });
  }
});

async function handleWebhook(req, res) {
  try {
    if (!checkSecret(req)) return res.status(401).send("unauthorized");

    const payload = req.body;

    if (isFromMe(payload)) return res.status(200).send("ignored");

    const remoteJid = getRemoteJid(payload);
    const number = jidToNumber(remoteJid);
    const text = extractText(payload);

    console.log("📩 remoteJid:", remoteJid, "| number:", number, "| text:", text);

    if (!number || !text) return res.status(200).send("no-content");

    // 🛡️ ANTI-BAN: Check rate limit
    if (isRateLimited(number)) {
      return res.status(200).send("rate-limited");
    }

    // 🛡️ ANTI-BAN: Random initial delay
    await sleep(randomDelay());

    const response = await botLogic.handleMessage(number, text);

    if (response) {
      if (typeof response === "string") {
        await sendText(number, response);
      }
      else if (typeof response === "object" && response.type === "buttons") {
        await sendText(number, response.text);
        try {
          await sendButtons(number, response.title || "Opciones", "Selecciona una acción", response.buttons);
        } catch (e) {
          console.error("⚠️ Buttons failed to send:", e.message);
        }
      }
      else if (typeof response === "object" && response.type === "list") {
        await sendText(number, response.text);

        if (DISABLE_LISTS) {
          console.log("📝 Lists disabled, using text fallback");
          let listText = "\n";
          response.sections.forEach(sec => {
            if (sec.title) listText += `\n📌 *${sec.title}*\n`;
            sec.rows.forEach(row => {
              listText += `🔹 [${row.rowId}] *${row.title}*\n      _${row.description || ""}_\n`;
            });
          });
          await sendText(number, `📋 *Selecciona una opción:*\n(Escribe el número correspondiente)\n${listText}`);
        } else {
          try {
            await sendList(number, response.title, "Haz clic abajo 👇", response.buttonText, response.sections);
          } catch (e) {
            console.error("⚠️ List failed to send (fallback):", e.message);
            let listText = "\n";
            response.sections.forEach(sec => {
              if (sec.title) listText += `\n📌 *${sec.title}*\n`;
              sec.rows.forEach(row => {
                listText += `🔹 [${row.rowId}] *${row.title}*\n      _${row.description || ""}_\n`;
              });
            });
            await sendText(number, `📋 *Selecciona una opción:*\n(Escribe el número correspondiente)\n${listText}`);
          }
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

app.post("/", handleWebhook);
app.post("/webhook", handleWebhook);
app.post("/messages-upsert", handleWebhook);
app.post("/webhook/messages-upsert", handleWebhook);

app.post("/connection-update", (_req, res) => res.status(200).send("ok"));
app.post("/qrcode-updated", (_req, res) => res.status(200).send("ok"));
app.post("/webhook/connection-update", (_req, res) => res.status(200).send("ok"));
app.post("/webhook/qrcode-updated", (_req, res) => res.status(200).send("ok"));

// GLOBAL ERROR HANDLERS (for stability)
process.on('uncaughtException', (err) => {
  console.error('🔥 UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

const server = app.listen(PORT, "0.0.0.0", async () => {
  console.log(`✅ Bot escuchando en http://localhost:${PORT}`);

  // Test API Connection on startup
  await botLogic.api.checkConnection();
});
server.on('error', (e) => console.error("❌ SERVER ERROR:", e));
