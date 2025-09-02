const express = require('express');
const { Telegraf, Markup } = require('telegraf');

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error('Falta BOT_TOKEN en variables de entorno');
  process.exit(1);
}

const bot = new Telegraf(TOKEN);

// Estado mínimo en memoria (se pierde si Render duerme; ok para nuestro caso)
const userData = {};

// /start → arranca de cero
bot.start((ctx) => {
  const chatId = ctx.chat.id;
  userData[chatId] = { step: 'name' };
  ctx.reply('Hola 👋 Soy el bot de Cordero Financiero.\nDecime tu nombre y apellido:');
});

// Mensajes de texto (flujo nombre → email → teléfono → confirmar)
bot.on('text', (ctx) => {
  const chatId = ctx.chat.id;
  const from = ctx.from || {};
  const userId = from.id;              // ← Telegram ID del usuario
  const username = from.username || ''; // opcional, por si queremos loguearlo
  const text = (ctx.message.text || '').trim();

  if (!userData[chatId]) {
    userData[chatId] = { step: 'name' };
    return ctx.reply('Arranquemos de nuevo. ¿Cuál es tu nombre y apellido?');
  }

  const state = userData[chatId];

  if (state.step === 'name') {
    state.name = text;
    state.userId = userId;      // guardamos el Telegram ID
    state.username = username;  // opcional
    state.step = 'email';
    return ctx.reply('Perfecto. Ahora decime tu email:');
  }

  if (state.step === 'email') {
    state.email = text; // sin validar: lo revisás vos
    state.step = 'phone';
    return ctx.reply('Gracias. Ahora tu teléfono (con código de área):');
  }

  if (state.step === 'phone') {
    state.phone = text;
    state.step = 'confirm';

    const resumen =
      `📋 Revisá tus datos:\n` +
      `• Nombre: ${state.name}\n` +
      `• Email: ${state.email}\n` +
      `• Teléfono: ${state.phone}\n` +
      `• Telegram ID: ${state.userId}\n` +
      (state.username ? `• Usuario: @${state.username}\n` : '') +
      `\n¿Confirmás que están correctos?`;

    return ctx.reply(
      resumen,
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ Confirmar', 'CONFIRM')],
        [Markup.button.callback('✏️ Corregir', 'RESTART')]
      ])
    );
  }

  if (state.step === 'confirm') {
    return ctx.reply('Tocá una opción: ✅ Confirmar o ✏️ Corregir.');
  }
});

// Botones (Confirmar / Corregir)
bot.on('callback_query', async (ctx) => {
  const chatId = ctx.chat.id;
  const action = ctx.callbackQuery.data;
  const state = userData[chatId] || {};
  await ctx.answerCbQuery();

  if (action === 'CONFIRM') {
    const msg =
      `🆕 Nuevo registro\n` +
      `• Nombre: ${state.name}\n` +
      `• Email: ${state.email}\n` +
      `• Teléfono: ${state.phone}\n` +
      `• Telegram ID: ${state.userId}\n` +
      (state.username ? `• Usuario: @${state.username}\n` : '');

    // Envío al admin/canal si está configurado
    const adminId = process.env.ADMIN_CHAT_ID; // puede ser un canal/grupo/usuario
    if (adminId) {
      try {
        await bot.telegram.sendMessage(adminId, msg);
      } catch (e) {
        console.error('Error enviando a ADMIN_CHAT_ID:', e.message);
      }
    }

    await ctx.editMessageText('✅ ¡Listo! Tus datos fueron enviados. Gracias.');
    delete userData[chatId]; // limpiar estado
    return;
  }

  if (action === 'RESTART') {
    userData[chatId] = { step: 'name' };
    await ctx.editMessageText('Ok, empecemos de nuevo.\n¿Cuál es tu nombre y apellido?');
    return;
  }
});

// --- Webhook en Render ---
const SECRET_PATH = `/telegraf/${process.env.BOT_SECRET || 'secret'}`;
const app = express();
app.use(express.json());
app.use(SECRET_PATH, bot.webhookCallback(SECRET_PATH));

// Healthcheck
app.get('/', (_req, res) => res.send('OK'));

// Arranque del server (y seteo automático del webhook en Render)
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Servidor en puerto ${PORT}`);
  const baseUrl = process.env.RENDER_EXTERNAL_URL || process.env.BASE_URL;
  if (baseUrl) {
    try {
      await bot.telegram.setWebhook(`${baseUrl}${SECRET_PATH}`, {
        allowed_updates: ['message', 'edited_message', 'callback_query']
      });
      console.log('Webhook seteado en:', `${baseUrl}${SECRET_PATH}`);
    } catch (err) {
      console.error('Error seteando webhook:', err.message);
    }
  }
});
