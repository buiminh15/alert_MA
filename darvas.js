const axios = require('axios');
const { sendTelegramNotification } = require('./bot'); // Giả sử bạn có file bot.js
const { dateToTimestamp, formatDate, getDates } = require('./utils');

const API_BASE = process.env.REACT_APP_API_BASE; // hoặc URL backend của bạn

// ─── 1. Lấy dữ liệu Darvas Boxes từ API ────────────────────────────────────────
async function getDarvasBoxes() {
  try {
    const response = await axios.get(`${API_BASE}/api/darvas`);
    return response.data;
  } catch (err) {
    console.error('❌ Lỗi khi lấy danh sách Darvas boxes:', err.message);
    throw new Error('Không thể lấy dữ liệu Darvas từ API');
  }
}

// ─── 2. Lấy giá hiện tại từ API 24hMoney ───────────────────────────────────────
async function getCurrentPrice(symbol) {
  let fromDate, endDate;
  const { oneWeekAgo, today } = getDates();
  fromDate = dateToTimestamp(formatDate(oneWeekAgo));
  endDate = dateToTimestamp(formatDate(today));

  const API_URL = `https://api.24hmoney.vn/tradingview/history?symbol=${symbol}&resolution=1D&from=${fromDate}&to=${endDate}`;

  try {
    const { data } = await axios.get(API_URL, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Darvas SL Checker/1.0)' }
    });

    if (data.s !== 'ok') {
      throw new Error(`API trả về lỗi: ${data.s}`);
    }

    const { c } = data;
    if (!c || c.length === 0) {
      throw new Error('Không có dữ liệu giá');
    }

    return c[c.length - 1]; // Giá đóng cửa gần nhất
  } catch (err) {
    console.error(`❌ Lỗi khi lấy giá cho ${symbol}:`, err.message);
    return null;
  }
}

// ─── 3. Kiểm tra Stop Loss cho từng hộp ────────────────────────────────────────
async function checkAllDarvasStopLoss() {
  console.log('📢 [checkDarvasStopLoss.js] Đang kiểm tra stop loss cho các hộp Darvas...');

  const boxes = await getDarvasBoxes();

  for (const box of boxes) {
    const { id, stock_symbol, box_high, box_low, stop_loss, status } = box;

    if (status !== 'active') {
      console.log(`📌 Bỏ qua hộp ${id} (${stock_symbol}) vì không active (status: ${status})`);
      continue;
    }

    const currentPrice = await getCurrentPrice(stock_symbol);
    if (currentPrice === null) {
      console.warn(`⚠️ Không thể lấy giá cho ${stock_symbol}, bỏ qua.`);
      continue;
    }

    if (currentPrice <= stop_loss) {
      const message = `
🔴 DARVAS STOP LOSS ĐÃ CHẠM!
📌 Mã: ${stock_symbol}
📦 Hộp: High=${box_high}, Low=${box_low}
💰 Stop Loss: ${stop_loss}
📈 Giá hiện tại: ${currentPrice.toFixed(2)}
🎯 ID Hộp: ${id}
⚠️ Giá đã rơi <= stop loss → cần xem xét đóng lệnh.
      `;

      console.log('📢 [checkDarvasStopLoss.js]', message);
      await sendTelegramNotification(message, true);
    }
  }
}

// checkAllDarvasStopLoss().catch(err => {
//   console.error(err);
// });

module.exports = { checkAllDarvasStopLoss };