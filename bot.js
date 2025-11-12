const axios = require('axios');
require('dotenv').config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_BOT_TOKEN_DARVAS = process.env.TELEGRAM_BOT_TOKEN_DARVAS;

async function sendTelegramNotification(message, isDarvasRoom = false) {
  if (!TELEGRAM_BOT_TOKEN || (!TELEGRAM_CHAT_ID && !TELEGRAM_BOT_TOKEN_DARVAS)) {
    console.log('📢 [bot.js:10]', !TELEGRAM_BOT_TOKEN || (!TELEGRAM_CHAT_ID && !TELEGRAM_BOT_TOKEN_DARVAS));
    return;
  }
  console.log('📢 [bot.js:13]', 'running');
  // 3. Chọn chat_id dựa trên tham số isDarvasRoom
  const bot = isDarvasRoom ? TELEGRAM_BOT_TOKEN_DARVAS : TELEGRAM_BOT_TOKEN;

  // 4. Sửa URL (loại bỏ dấu cách)
  const url = `https://api.telegram.org/bot${bot}/sendMessage`;

  try {
    await axios.post(url, {
      text: message,
      chat_id: TELEGRAM_CHAT_ID,
      parse_mode: "Markdown"
    });
    console.log('📢 Notification sent to telegram');
  } catch (error) {
    if (error.response) {
      console.log('📢 [bot.js:29]', 'error');
    } else {
      console.log('📢 [bot.js:31]', 'error');
    }
  }
}

module.exports = { sendTelegramNotification };