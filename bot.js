const axios = require('axios');

require('dotenv').config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegramNotification(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('Lỗi: TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID chưa được thiết lập trong biến môi trường.');
    return;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await axios.post(url, {
      text: message,
      chat_id: TELEGRAM_CHAT_ID,
      parse_mode: "Markdown"
    });
    console.log('Notification sent to Telegram');
  } catch (error) {
    if (error.response) {
      console.error("Telegram API Error:", error.response.status, error.response.statusText);
      console.error("Response data:", error.response.data);
    } else {
      console.error("Axios Error:", error.message);
    }
  }
}

module.exports = { sendTelegramNotification };
