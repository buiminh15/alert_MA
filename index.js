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

// Tính trung bình volume trong n ngày
function calculateAvgVolume(volumes, period) {
  const avg = [];
  for (let i = 0; i < volumes.length; i++) {
    if (i < period - 1) {
      avg.push(null);
    } else {
      const sum = volumes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      avg.push(Number((sum / period).toFixed(2)));
    }
  }
  return avg;
}

// Hàm lấy dữ liệu tuần từ dữ liệu ngày (mô phỏng)
function getWeeklyDataFromDaily(timestamps, closes, volumes, highs, lows) {
  const weeklyCloses = [];
  const weeklyVolumes = [];
  const weeklyHighs = [];
  const weeklyLows = [];
  const weeklyTimestamps = [];
  let lastWeek = null;

  for (let i = 0; i < timestamps.length; i++) {
    const date = new Date(timestamps[i] * 1000);
    const weekNum = getWeekNumber(date);

    if (lastWeek === null || weekNum !== lastWeek) {
      weeklyCloses.push(closes[i]);
      weeklyVolumes.push(volumes[i]);
      weeklyHighs.push(highs[i]);
      weeklyLows.push(lows[i]);
      weeklyTimestamps.push(timestamps[i]);
      lastWeek = weekNum;
    }
  }

  return {
    timestamps: weeklyTimestamps,
    closes: weeklyCloses,
    volumes: weeklyVolumes,
    highs: weeklyHighs,
    lows: weeklyLows
  };
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
    if (resolution === '1D') console.log(`\n🔄 Đang xử lý symbol: ${symbol}`);
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
      const weeklyData = getWeeklyDataFromDaily(t, c, v, h, l);
      t = weeklyData.timestamps;
      c = weeklyData.closes;
      v = weeklyData.volumes;
      h = weeklyData.highs;
      l = weeklyData.lows;
    }

    const ma10 = calculateSMA(c, 10);
    const ma20 = calculateSMA(c, 20);
    const ma50 = calculateSMA(c, 50);

    const avgVol20 = calculateAvgVolume(v, 20);

    const lastIndex = c.length - 1;
    const currentPrice = c[lastIndex];
    const currentVolume = v[lastIndex];
    const currentAvgVol20 = avgVol20[lastIndex];

    const currentMA10 = ma10[lastIndex];
    const currentMA20 = ma20[lastIndex];
    const currentMA50 = ma50[lastIndex];

    const isBelowMA10 = currentMA10 !== null && currentPrice < currentMA10;
    const isBelowMA20 = currentMA20 !== null && currentPrice < currentMA20;
    const isBelowMA50 = currentMA50 !== null && currentPrice < currentMA50;

    const isBelowAll = isBelowMA10 && isBelowMA20 && isBelowMA50;

    // Thêm điều kiện volume
    const isHighVolume = currentAvgVol20 && currentVolume > currentAvgVol20;

    return {
      symbol,
      resolution,
      currentPrice,
      currentVolume,
      currentAvgVol20,
      isHighVolume,
      isBelowMA10,
      isBelowMA20,
      isBelowAll,
      isBullish: currentPrice > currentMA10 && currentMA10 > currentMA20 && currentMA20 > currentMA50[lastIndex],
      timestamps: t,
      closes: c,
      highs: h,
      lows: l,
      volumes: v
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

// 🚨 HÀM MỚI: Phát hiện cả điểm mua và bán theo Darvas Box
function detectDarvasSignals(timestamps, highs, lows, closes, boxPeriod = 5) {
  const results = [];

  for (let i = boxPeriod; i < closes.length; i++) {
    // Lấy N phiên trước đó để xác định hộp
    const lookback = highs.slice(i - boxPeriod, i);
    const lookbackLows = lows.slice(i - boxPeriod, i);

    // Xác định Top và Bottom của hộp
    const top = Math.max(...lookback);
    const bottom = Math.min(...lookbackLows);

    // Giá hiện tại (hôm nay)
    const currentClose = closes[i];

    // Đỉnh và đáy của hộp hôm qua
    const prevLookback = highs.slice(i - boxPeriod - 1, i - 1);
    const prevLookbackLows = lows.slice(i - boxPeriod - 1, i - 1);
    const prevTop = Math.max(...prevLookback);
    const prevBottom = Math.min(...prevLookbackLows);

    // Tín hiệu mua: giá hôm nay > đỉnh hộp hôm qua
    const buySignal = currentClose > prevTop;

    // Tín hiệu bán: giá hôm nay < đáy hộp hôm qua
    const sellSignal = currentClose < prevBottom;

    results.push({
      date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
      high: highs[i],
      low: lows[i],
      close: closes[i],
      top: top,
      bottom: bottom,
      isBuySignal: buySignal,
      isSellSignal: sellSignal
    });
  }

  return results;
}

// Hàm kiểm tra MA chính
async function checkAllMA() {
  const symbols = await getWatchedSymbols();

  let message = '';

  for (const symbol of symbols) {
    const result = await checkMASingle(symbol);
    const {
      isBelowMA10,
      isBelowMA20,
      currentVolume,
      currentAvgVol20,
      isHighVolume,
      isBelowAll,
      isBullish,
      timestamps,
      highs,
      lows,
      closes
    } = result;

    // 🚨 GỌI HÀM TÌM ĐIỂM MUA/BÁN THEO DARVAS BOX
    const darvasSignals = detectDarvasSignals(timestamps, highs, lows, closes);
    const latestDarvasSignal = darvasSignals[darvasSignals.length - 1];

    if (latestDarvasSignal) {
      if (latestDarvasSignal.isBuySignal) {
        message = `
          🟢 DARVAS BOX BUY SIGNAL
          - Cổ phiếu: ${symbol}
          - Ngày: ${latestDarvasSignal.date}
          - Giá đóng cửa: ${latestDarvasSignal.close.toFixed(2)}
          - Vượt đỉnh hộp: ${latestDarvasSignal.top.toFixed(2)}

          🎯 KẾT LUẬN:
          ===> Khuyến nghị: MUA (Giá vượt đỉnh hộp Darvas)
        `;
        console.log(message);
        await sendTelegramNotification(message);
      }

      if (latestDarvasSignal.isSellSignal) {
        message = `
          🔴 DARVAS BOX SELL SIGNAL
          - Cổ phiếu: ${symbol}
          - Ngày: ${latestDarvasSignal.date}
          - Giá đóng cửa: ${latestDarvasSignal.close.toFixed(2)}
          - Phá đáy hộp: ${latestDarvasSignal.bottom.toFixed(2)}

          🎯 KẾT LUẬN:
          ===> Khuyến nghị: BÁN (Giá phá đáy hộp Darvas)
        `;
        console.log(message);
        await sendTelegramNotification(message);
      }
    }

    // Tín hiệu mạnh: giá dưới MA10, MA20, MA50 (toàn bộ)
    if (isBelowAll) {
      const resultW = await checkMASingle(symbol, '1W');
      const { isBelowMA10: isBelowMA10W, isBelowMA20: isBelowMA20W } = resultW;

      if (isBelowMA10W && isBelowMA20W) {
        message = `
        🔍 ${symbol} - Dưới cả MA10, MA20, MA50 (Tín hiệu yếu cực)
        - Volume hiện tại: ${currentVolume.toFixed(2)}
        - AVG Volume 20 ngày: ${currentAvgVol20.toFixed(2)}
        - Volume cao hơn TB? ${isHighVolume ? '✅ Có' : '❌ Không'}

        🎯 KẾT LUẬN:
        ===> Khuyến nghị: BÁN (Tín hiệu yếu rõ rệt)
      `;
        console.log(message);
        await sendTelegramNotification(message);
      }
    }

    // Tín hiệu bán: giá dưới MA10 và MA20 (nhưng có thể chưa tới MA50)
    else if (isBelowMA10 && isBelowMA20) {
      const resultW = await checkMASingle(symbol, '1W');
      const {
        isBelowMA10: isBelowMA10W,
        isBelowMA20: isBelowMA20W,
        isHighVolume: isHighVolumeW,
        currentAvgVol20: currentAvgVol20W,
        currentVolume: currentVolumeW
      } = resultW;

      if (isBelowMA10W && isBelowMA20W) {
        message = `
        🔍 Đang lấy dữ liệu ${symbol}
        - Dưới MA10 ngày và tuần? ✅ Có
        - Dưới MA20 ngày và tuần? ✅ Có
        - Volume hiện tại (ngày): ${currentVolumeW.toFixed(2)}
        - AVG Volume 20 ngày: ${currentAvgVol20W.toFixed(2)}
        - Volume cao hơn TB? ${isHighVolumeW ? '✅ Có' : '❌ Không'}

        🎯 KẾT LUẬN:
        ===> Khuyến nghị: BÁN ${isHighVolumeW ? '(Tín hiệu mạnh hơn do volume tăng)' : ''}
      `;
        console.log(message);
        await sendTelegramNotification(message);
      }

      if (isBelowMA10W && !isBelowMA20W) {
        message = `
        🔍 Đang lấy dữ liệu ${symbol}
        - Dưới MA10 ngày và tuần? ✅ Có
        - Dưới MA20 ngày? ✅ Có
        - Dưới MA20 tuần? ❌ Không
        - Volume hiện tại (ngày): ${currentVolumeW.toFixed(2)}
        - AVG Volume 20 ngày: ${currentAvgVol20W.toFixed(2)}
        - Volume cao hơn TB? ${isHighVolumeW ? '✅ Có' : '❌ Không'}

        🎯 KẾT LUẬN:
        ===> Khuyến nghị: BÁN 1 phần ${isHighVolumeW ? '(Tín hiệu mạnh hơn do volume tăng)' : ''}
      `;
        console.log(message);
        await sendTelegramNotification(message);
      }
    }

    // Thêm: Tín hiệu mua nếu isBullish + volume mạnh
    if (isBullish && isHighVolume) {
      const resultW = await checkMASingle(symbol, '1W');
      const { isBullish: isBullishW } = resultW;

      if (isBullishW) {
        message = `
        🚀 ${symbol} - Xu hướng tăng đẹp (giá > MA10 > MA20 > MA50)
        - Volume hiện tại: ${currentVolume.toFixed(2)}
        - AVG Volume 20 ngày: ${currentAvgVol20.toFixed(2)}
        - Volume cao hơn TB? ✅ Có

        🎯 KẾT LUẬN:
        ===> Khuyến nghị: MUA (Tín hiệu tăng mạnh, có volume hỗ trợ)
      `;
        console.log(message);
        await sendTelegramNotification(message);
      }
    }
  }
}

checkAllMA();