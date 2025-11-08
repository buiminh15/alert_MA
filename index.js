const axios = require('axios');
const supabase = require('./config/supabase');
const { dateToTimestamp, formatDate, getDates } = require('./utils');

const { sendTelegramNotification } = require('./bot');

// Lấy danh sách symbol từ Supabase
async function getWatchedSymbols() {
  const { data, error } = await supabase
    .from('watched_symbols')
    .select('symbol')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Lỗi khi lấy danh sách symbol:', error.message);
    throw new Error('Không thể lấy danh sách symbol');
  }

  return data.map(row => row.symbol);
}

// Tính SMA
function calculateSMA(prices, period) {
  const sma = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      sma.push(null);
    } else {
      const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      sma.push(Number((sum / period).toFixed(4)));
    }
  }
  return sma;
}

// Hàm lấy dữ liệu tuần từ dữ liệu ngày (mô phỏng)
function getWeeklyDataFromDaily(timestamps, closes) {
  const weeklyCloses = [];
  const weeklyTimestamps = [];
  let lastWeek = null;

  for (let i = 0; i < timestamps.length; i++) {
    const date = new Date(timestamps[i] * 1000);
    const weekNum = getWeekNumber(date);

    if (lastWeek === null || weekNum !== lastWeek) {
      weeklyCloses.push(closes[i]);
      weeklyTimestamps.push(timestamps[i]);
      lastWeek = weekNum;
    }
  }

  return { timestamps: weeklyTimestamps, closes: weeklyCloses };
}

// Hàm hỗ trợ: lấy số tuần trong năm
function getWeekNumber(d) {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

// Hàm xử lý cho từng symbol
async function checkMASingle(symbol, resolution = '1D') {
  try {
    console.log(`\n🔄 Đang xử lý symbol: ${symbol}`);
    let fromDate, endDate;
    if (resolution === '1W') {
      const { oneYearAgo, today } = getDates();
      const endDateStr = formatDate(today);
      const fromDateStr = formatDate(oneYearAgo);
      fromDate = dateToTimestamp(fromDateStr);
      endDate = dateToTimestamp(endDateStr);
    } else {
      const { threeMonthsAgo, today } = getDates();
      const endDateStr = formatDate(today);
      const fromDateStr = formatDate(threeMonthsAgo);
      fromDate = dateToTimestamp(fromDateStr);
      endDate = dateToTimestamp(endDateStr);
    }

    const API_URL = `https://api.24hmoney.vn/tradingview/history?symbol=${symbol}&resolution=1D&from=${fromDate}&to=${endDate}`;

    const { data } = await axios.get(API_URL, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MA-Checker/1.0)'
      }
    });

    if (data.s !== 'ok') {
      throw new Error(`API error: ${data.s}`);
    }

    let { t, c, o, h, l, v } = data;

    if (resolution === '1W') {
      const weeklyData = getWeeklyDataFromDaily(t, c);
      t = weeklyData.timestamps;
      c = weeklyData.closes;
    }

    const ma10 = calculateSMA(c, 10);
    const ma20 = calculateSMA(c, 20);
    const ma50 = calculateSMA(c, 50);

    const lastIndex = c.length - 1;
    const currentPrice = c[lastIndex];
    const currentMA10 = ma10[lastIndex];
    const currentMA20 = ma20[lastIndex];
    const currentMA50 = ma50[lastIndex];

    const isBelowMA10 = currentMA10 !== null && currentPrice < currentMA10;
    const isBelowMA20 = currentMA20 !== null && currentPrice < currentMA20;
    const isBelowMA50 = currentMA50 !== null && currentPrice < currentMA50;

    const isBelowAll = isBelowMA10 && isBelowMA20 && isBelowMA50;

    return {
      symbol,
      resolution,
      currentPrice,
      isBelowMA10,
      isBelowMA20,
      isBelowAll,
      isBullish: currentPrice > currentMA10 && currentMA10 > currentMA20 && currentMA20 > currentMA50[lastIndex]
    };

  } catch (err) {
    console.error(`❌ Lỗi khi xử lý ${symbol}:`, err.message);
    return {
      symbol,
      resolution,
      error: err.message
    };
  }
}

// Hàm kiểm tra MA chính
async function checkAllMA() {
  const symbols = await getWatchedSymbols();

  console.log('📢 [index.js:145]', symbols);
  let message = '';

  for (const symbol of symbols) {
    const result = await checkMASingle(symbol);
    const { isBelowMA10, isBelowMA20 } = result;
    if (isBelowMA10 && isBelowMA20) {
      const resultW = await checkMASingle(symbol, '1W');
      const { isBelowMA10: isBelowMA10W, isBelowMA20: isBelowMA20W } = resultW;
      if (isBelowMA10W && isBelowMA20W) {
        console.log(`📢 Gửi thông báo tới Telegram 💀`);
        message = `
          🔍 Đang lấy dữ liệu ${symbol}
          - Dưới MA10 ngày và tuần? ✅ Có
          - Dưới MA20 ngày và tuần? ✅ Có

          🎯 KẾT LUẬN:
          ===> Khuyến nghị: BÁN
        `;

        await sendTelegramNotification(message);
      }

      if (isBelowMA10W && !isBelowMA20W) {
        console.log(`📢 Gửi thông báo tới Telegram 💀`);
        message = `
          🔍 Đang lấy dữ liệu ${symbol}
          - Dưới MA10 ngày và tuần? ✅ Có
          - Dưới MA20 ngày? ✅ Có
          - Dưới MA20 tuần? ❌ Không

          🎯 KẾT LUẬN:
          ===> Khuyến nghị: BÁN 1 phần
        `;

        await sendTelegramNotification(message);
      }

    }
  }


}

checkAllMA();