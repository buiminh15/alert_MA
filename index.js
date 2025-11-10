const axios = require('axios');
const supabase = require('./config/supabase');
const { dateToTimestamp, formatDate, getDates } = require('./utils');
const { sendTelegramNotification } = require('./bot');

// ─── 1. Lấy danh sách mã theo dõi từ Supabase ─────────────────────────────────
async function getWatchedSymbols() {
  const { data, error } = await supabase
    .from('watched_symbols')
    .select('symbol')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Lỗi khi lấy danh sách mã:', error.message);
    throw new Error('Không thể lấy danh sách mã');
  }

  return data.map(row => row.symbol);
}

// ─── 2. Tính SMA ──────────────────────────────────────────────────────────────
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

// ─── 3. Tính trung bình khối lượng ────────────────────────────────────────────
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

// ─── 4. Chuyển dữ liệu ngày → tuần (đơn giản hóa) ────────────────────────────
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

function getWeekNumber(d) {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

// ─── 5. 🚀 HÀM DARVAS NÂNG CAO: có xác nhận MA + khối lượng ───────────────────
function detectDarvasWithConfirmation(
  timestamps,
  highs,
  lows,
  closes,
  ma10,
  ma20,
  ma50,
  volumes,
  avgVol20,
  boxPeriod = 5
) {
  const results = [];

  for (let i = boxPeriod; i < closes.length; i++) {
    // Hộp của "hôm qua" (từ i-boxPeriod-1 đến i-2)
    const prevLookbackHighs = highs.slice(i - boxPeriod - 1, i - 1);
    const prevLookbackLows = lows.slice(i - boxPeriod - 1, i - 1);
    const prevTop = Math.max(...prevLookbackHighs);
    const prevBottom = Math.min(...prevLookbackLows);

    const currentClose = closes[i];
    const currentVol = volumes[i];
    const currentAvgVol = avgVol20[i];

    // 🔔 Tín hiệu Darvas cơ bản
    const basicBuy = currentClose > prevTop;
    const basicSell = currentClose < prevBottom;

    // 📈 Xác nhận xu hướng tăng: giá > MA20 > MA50
    const isUptrend =
      ma20[i] !== null &&
      ma50[i] !== null &&
      currentClose > ma20[i] &&
      ma20[i] > ma50[i];

    // 📊 Xác nhận khối lượng: KL hiện tại > trung bình 20 ngày
    const isHighVol = currentAvgVol && currentVol > currentAvgVol;

    // ✅ Tín hiệu MUA ĐÃ XÁC NHẬN
    const confirmedBuy = basicBuy && isUptrend && isHighVol;

    // 📉 Tín hiệu BÁN ĐÃ XÁC NHẬN: phá đáy + vi phạm MA20
    const isBelowMA20 = ma20[i] !== null && currentClose < ma20[i];
    const confirmedSell = basicSell && isBelowMA20;

    results.push({
      date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
      close: currentClose,
      volume: currentVol,
      top: prevTop,
      bottom: prevBottom,
      ma10: ma10[i],
      ma20: ma20[i],
      ma50: ma50[i],
      avgVol20: currentAvgVol,
      isBasicBuy: basicBuy,
      isBasicSell: basicSell,
      isUptrend,
      isHighVol,
      isConfirmedBuy: confirmedBuy,
      isConfirmedSell: confirmedSell
    });
  }

  return results;
}

// ─── 6. Lấy & xử lý dữ liệu cho một mã cổ phiếu ───────────────────────────────
async function checkMASingle(symbol, resolution = '1D') {
  try {
    if (resolution === '1D') console.log(`\n🔄 Đang xử lý mã: ${symbol}`);

    let fromDate, endDate;
    if (resolution === '1W') {
      const { oneYearAgo, today } = getDates();
      fromDate = dateToTimestamp(formatDate(oneYearAgo));
      endDate = dateToTimestamp(formatDate(today));
    } else {
      const { threeMonthsAgo, today } = getDates();
      fromDate = dateToTimestamp(formatDate(threeMonthsAgo));
      endDate = dateToTimestamp(formatDate(today));
    }

    const API_URL = `https://api.24hmoney.vn/tradingview/history?symbol=${symbol}&resolution=1D&from=${fromDate}&to=${endDate}`;

    const { data } = await axios.get(API_URL, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MA-Darvas Checker/1.0)' }
    });

    if (data.s !== 'ok') {
      throw new Error(`Lỗi API: ${data.s}`);
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

    // Tính các chỉ báo
    const ma10 = calculateSMA(c, 10);
    const ma20 = calculateSMA(c, 20);
    const ma50 = calculateSMA(c, 50);
    const avgVol20 = calculateAvgVolume(v, 20);

    const lastIndex = c.length - 1;
    const currentPrice = c[lastIndex];
    const currentVolume = v[lastIndex];
    const currentAvgVol = avgVol20[lastIndex];

    const isBelowMA10 = ma10[lastIndex] !== null && currentPrice < ma10[lastIndex];
    const isBelowMA20 = ma20[lastIndex] !== null && currentPrice < ma20[lastIndex];
    const isBelowMA50 = ma50[lastIndex] !== null && currentPrice < ma50[lastIndex];
    const isBelowAll = isBelowMA10 && isBelowMA20 && isBelowMA50;

    const isHighVolume = currentAvgVol && currentVolume > currentAvgVol;

    const isBullish =
      ma10[lastIndex] &&
      ma20[lastIndex] &&
      ma50[lastIndex] &&
      currentPrice > ma10[lastIndex] &&
      ma10[lastIndex] > ma20[lastIndex] &&
      ma20[lastIndex] > ma50[lastIndex];

    return {
      symbol,
      resolution,
      currentPrice,
      currentVolume,
      currentAvgVol,
      isHighVolume,
      isBelowMA10,
      isBelowMA20,
      isBelowMA50,
      isBelowAll,
      isBullish,
      timestamps: t,
      closes: c,
      highs: h,
      lows: l,
      volumes: v,
      ma10,
      ma20,
      ma50,
      avgVol20
    };
  } catch (err) {
    console.error(`❌ Lỗi khi xử lý ${symbol}:`, err.message);
    return {
      symbol,
      resolution,
      error: err.message,
      timestamps: [],
      closes: [],
      highs: [],
      lows: [],
      volumes: [],
      ma10: [],
      ma20: [],
      ma50: [],
      avgVol20: []
    };
  }
}

// ─── 7. 🧠 Logic quét chính: Darvas + tín hiệu MA bổ sung ─────────────────────
async function checkAllMA() {
  const symbols = await getWatchedSymbols();
  console.log(`🔍 Đang kiểm tra ${symbols.length} mã cổ phiếu...`);

  for (const symbol of symbols) {
    const dailyResult = await checkMASingle(symbol, '1D');
    if (dailyResult.error) continue;

    const {
      timestamps,
      highs,
      lows,
      closes,
      volumes,
      ma10,
      ma20,
      ma50,
      avgVol20,
      isBullish,
      currentPrice,
      currentVolume,
      currentAvgVol,
      isHighVolume,
      isBelowMA10,
      isBelowMA20,
      isBelowMA50,
      isBelowAll
    } = dailyResult;

    let message = '';

    // ─── 🚀 TÍN HIỆU DARVAS (ĐÃ ĐƯỢC XÁC NHẬN) ─────────────────────────────────
    const darvasSignals = detectDarvasWithConfirmation(
      timestamps,
      highs,
      lows,
      closes,
      ma10,
      ma20,
      ma50,
      volumes,
      avgVol20,
      5
    );

    const latest = darvasSignals[darvasSignals.length - 1];

    if (latest) {
      if (latest.isConfirmedBuy) {
        message = `
🟢 DARVAS + MA + KHỐI LƯỢNG XÁC NHẬN MUA
📌 ${symbol} | ${latest.date}
💰 Giá: ${latest.close.toFixed(2)} > Đỉnh hộp: ${latest.top.toFixed(2)}
📊 Xác nhận:
   • Xu hướng tăng (MA20 > MA50): ✅
   • KL > TB 20 ngày: ${latest.isHighVol ? '✅' : '❌'} (${latest.volume.toFixed(0)} vs ${latest.avgVol20?.toFixed(0) || 'N/A'})
🎯 KHUYẾN NGHỊ: MUA — Tín hiệu mạnh, đa yếu tố xác nhận
`;
        console.log(message);
        // await sendTelegramNotification(message);
      }

      if (latest.isConfirmedSell) {
        message = `
🔴 DARVAS + MA XÁC NHẬN BÁN
📌 ${symbol} | ${latest.date}
💰 Giá: ${latest.close.toFixed(2)} < Đáy hộp: ${latest.bottom.toFixed(2)}
📉 Xác nhận:
   • Dưới MA20: ✅ (${latest.close.toFixed(2)} < ${latest.ma20?.toFixed(2) || 'N/A'})
🎯 KHUYẾN NGHỊ: BÁN / DỪNG LỖ — Ưu tiên bảo toàn vốn
`;
        console.log(message);
        // await sendTelegramNotification(message);
      }
    }

    // ─── 📌 CÁC TÍN HIỆU DỰA TRÊN MA (ĐỘC LẬP VỚI DARVAS) ──────────────────────
    // Dùng làm tham khảo hoặc fallback truyền thống

    // 1️⃣ Xu hướng giảm mạnh: dưới MA10, MA20, MA50 (cả ngày & tuần)
    if (isBelowAll) {
      const weeklyResult = await checkMASingle(symbol, '1W');
      const { isBelowMA10: isBelowMA10W, isBelowMA20: isBelowMA20W } = weeklyResult;

      if (isBelowMA10W && isBelowMA20W) {
        message = `
⚠️ ${symbol} — Xu hướng giảm mạnh (Ngày & Tuần)
📉 Dưới MA10, MA20, MA50 trên cả hai khung thời gian
📊 Khối lượng: ${currentVolume.toFixed(2)} | TB 20 ngày: ${currentAvgVol?.toFixed(2)}
   KL > TB? ${isHighVolume ? '✅ Có' : '❌ Không'}

🎯 KẾT LUẬN:
   ===> KHUYẾN NGHỊ: BÁN (Tín hiệu yếu rõ rệt)
`;
        console.log(message);
        // await sendTelegramNotification(message);
      }
    }

    // 2️⃣ Tín hiệu bán trung gian: dưới MA10 & MA20 ngày (xác nhận tuần)
    else if (isBelowMA10 && isBelowMA20) {
      const weeklyResult = await checkMASingle(symbol, '1W');
      const {
        isBelowMA10: isBelowMA10W,
        isBelowMA20: isBelowMA20W,
        isHighVolume: isHighVolumeW,
        currentAvgVol: currentAvgVolW,
        currentVolume: currentVolumeW
      } = weeklyResult;

      if (isBelowMA10W && isBelowMA20W) {
        message = `
🔍 ${symbol} — Đồng thuận giảm được xác nhận
✅ Dưới MA10 (Ngày+Tuần) & MA20 (Ngày+Tuần)
📊 KL ngày: ${currentVolumeW.toFixed(2)} | TB 20 ngày: ${currentAvgVolW?.toFixed(2)}
   Bùng nổ KL? ${isHighVolumeW ? '✅ Có' : '❌ Không'}

🎯 KẾT LUẬN:
   ===> KHUYẾN NGHỊ: BÁN ${isHighVolumeW ? '(Mạnh hơn do bùng nổ khối lượng)' : ''}
`;
        console.log(message);
        // await sendTelegramNotification(message);
      }

      if (isBelowMA10W && !isBelowMA20W) {
        message = `
🔍 ${symbol} — Tín hiệu tuần hỗn hợp
✅ Dưới MA10 (Ngày+Tuần) & MA20 (ngày)
❌ Nhưng *trên* MA20 (tuần) → có thể là hỗ trợ

📊 KL ngày: ${currentVolumeW.toFixed(2)} | TB 20 ngày: ${currentAvgVolW?.toFixed(2)}
   Bùng nổ KL? ${isHighVolumeW ? '✅ Có' : '❌ Không'}

🎯 KẾT LUẬN:
   ===> KHUYẾN NGHỊ: BÁN 1 PHẦN ${isHighVolumeW ? '(Mạnh hơn do bùng nổ khối lượng)' : ''}
`;
        console.log(message);
        // await sendTelegramNotification(message);
      }
    }

    // 3️⃣ Tín hiệu tăng mạnh: MA dốc + khối lượng (chưa có tín hiệu Darvas)
    if (isBullish && isHighVolume) {
      const weeklyResult = await checkMASingle(symbol, '1W');
      const { isBullish: isBullishW } = weeklyResult;

      if (isBullishW) {
        message = `
🚀 ${symbol} — Xu hướng tăng mạnh (MA10 > MA20 > MA50 + KL)
📈 Giá: ${currentPrice.toFixed(2)}
📊 Khối lượng: ${currentVolume.toFixed(2)} > TB 20 ngày (${currentAvgVol?.toFixed(2)})

🎯 KẾT LUẬN:
   ===> KHUYẾN NGHỊ: CÂN NHẮC MUA (Xu hướng mạnh có hỗ trợ khối lượng — theo dõi breakout Darvas hoặc hồi về MA)
`;
        console.log(message);
        // await sendTelegramNotification(message);
      }
    }
  }

  console.log('\n✅ Hoàn tất quét.');
}

// ─── 8. Chạy chương trình ─────────────────────────────────────────────────────
checkAllMA().catch(err => {
  console.error('❌ Lỗi toàn cục:', err);
  process.exit(1);
});