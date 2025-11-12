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

// ─── 2. Tính trung bình khối lượng hiệu quả hơn ────────────────────────────────
function calculateAvgVolume(volumes, period) {
  const avg = [];
  let sum = 0;

  for (let i = 0; i < volumes.length; i++) {
    sum += volumes[i];

    if (i < period - 1) {
      avg.push(null);
    } else {
      if (i >= period) {
        sum -= volumes[i - period];
      }
      avg.push(Number((sum / period).toFixed(2)));
    }
  }
  return avg;
}

// ─── 3. Chuyển dữ liệu ngày → tuần (đơn giản hóa) ────────────────────────────
function getWeeklyDataFromDaily(timestamps, closes, volumes, highs, lows, opens) {
  const weeklyCloses = [];
  const weeklyVolumes = [];
  const weeklyHighs = [];
  const weeklyLows = [];
  const weeklyOpens = []; // Thêm dòng này
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
      weeklyOpens.push(opens[i]); // Thêm dòng này
      weeklyTimestamps.push(timestamps[i]);
      lastWeek = weekNum;
    }
  }

  return {
    timestamps: weeklyTimestamps,
    closes: weeklyCloses,
    volumes: weeklyVolumes,
    highs: weeklyHighs,
    lows: weeklyLows,
    opens: weeklyOpens // Trả về thêm opens
  };
}

function getWeekNumber(d) {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

// ─── 8. 🚨 PHÁT HIỆN CLIMAX (đã cải tiến: thêm nhận diện nến) ───────────────────
function detectClimax(
  timestamps,
  highs,
  lows,
  closes,
  volumes,
  avgVol20,
  opens
) {
  const results = [];

  for (let i = 0; i < closes.length; i++) {
    const currentHigh = highs[i];
    const currentLow = lows[i];
    const currentClose = closes[i];
    const currentOpen = opens[i];
    const currentVolume = volumes[i];
    const avgVolume = avgVol20[i];
    const range = currentHigh - currentLow;

    let isBuyingClimax = false;
    let isSellingClimax = false;

    // 🟢 Buying Climax: kết hợp new high + volume + nến đảo chiều
    if (
      avgVolume &&
      currentVolume > avgVolume * 2.5 &&
      i >= 5 && currentHigh > Math.max(...highs.slice(Math.max(0, i - 5), i))
    ) {
      const bodySize = Math.abs(currentClose - currentOpen);
      const upperWick = currentHigh - Math.max(currentClose, currentOpen);
      const lowerWick = Math.min(currentClose, currentOpen) - currentLow;

      // Điều kiện gốc (không cần nến cụ thể)
      const basicClimax = range > 0 && upperWick / range > 0.5 && currentClose < currentHigh;

      // Nhận diện nến Shooting Star (đỉnh dài, body nhỏ, close gần open)
      const isShootingStar = range > 0 && upperWick / range > 0.6 && bodySize / range < 0.2 && currentClose < currentHigh;

      // Gộp điều kiện
      if (basicClimax || isShootingStar) {
        isBuyingClimax = true;
      }
    }

    // 🔴 Selling Climax: kết hợp new low + volume + nến đảo chiều
    if (
      avgVolume &&
      currentVolume > avgVolume * 2.5 &&
      i >= 5 && currentLow < Math.min(...lows.slice(Math.max(0, i - 5), i))
    ) {
      const bodySize = Math.abs(currentClose - currentOpen);
      const lowerWick = Math.min(currentClose, currentOpen) - currentLow;

      // Điều kiện gốc
      const basicClimax = range > 0 && lowerWick / range > 0.5 && currentClose > currentLow;

      // Nhận diện nến Hammer hoặc Inverted Hammer (lower wick lớn, body nhỏ)
      const isHammer = range > 0 && lowerWick / range > 0.6 && bodySize / range < 0.2 && currentClose > currentLow;

      // Nhận diện Bearish Engulfing (nếu hôm trước tăng, hôm nay giảm mạnh bao trùm)
      const isEngulfing = i > 0 && currentOpen < currentClose && currentClose > opens[i - 1] && currentOpen < closes[i - 1];

      // Gộp điều kiện
      if (basicClimax || isHammer || isEngulfing) {
        isSellingClimax = true;
      }
    }

    results.push({
      isBuyingClimax,
      isSellingClimax
    });
  }

  return results;
}

// ─── 4. 🚀 HÀM DARVAS THUẦN: chỉ theo lý thuyết gốc ────────────────────────────
function detectPureDarvas(
  timestamps,
  highs,
  lows,
  closes,
  volumes,
  avgVol20,
  boxPeriod = 5
) {
  const results = [];
  let currentTop = null;
  let currentBottom = null;
  let boxValidFrom = -1;

  for (let i = 0; i < closes.length; i++) {
    // Khởi tạo hộp mới nếu chưa có và đủ điều kiện
    if (currentTop === null && i >= boxPeriod) {
      // Tìm đỉnh và đáy trong N ngày trước đó (hộp tiềm năng)
      const lookbackStart = i - boxPeriod;
      const lookbackEnd = i - 1;

      let tempTop = -Infinity;
      let tempBottom = Infinity;

      for (let j = lookbackStart; j <= lookbackEnd; j++) {
        if (highs[j] > tempTop) tempTop = highs[j];
        if (lows[j] < tempBottom) tempBottom = lows[j];
      }

      // Kiểm tra breakout: giá cao nhất hôm nay > đỉnh hộp hôm qua
      if (i > 0 && highs[i] > highs[i - 1]) {
        const prevHighsSlice = highs.slice(i - boxPeriod, i);
        const highestHigh = Math.max(...prevHighsSlice);

        if (highs[i - 1] === highestHigh) {
          currentTop = highestHigh;
          currentBottom = Math.min(...lows.slice(i - boxPeriod, i));
          boxValidFrom = i;
        }
      }
    }

    // Nếu có hộp đang hoạt động, kiểm tra tín hiệu mua/bán
    let isBasicBuy = false;
    let isBasicSell = false;
    let isConfirmedBuy = false;
    let isConfirmedSell = false;

    if (currentTop !== null && i >= boxValidFrom) {
      isBasicBuy = closes[i] > currentTop;
      isBasicSell = closes[i] < currentBottom;

      // Xác nhận khối lượng
      const isHighVol = avgVol20[i] && volumes[i] > avgVol20[i];

      isConfirmedBuy = isBasicBuy && isHighVol;
      isConfirmedSell = isBasicSell;
    }

    results.push({
      date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
      close: closes[i],
      volume: volumes[i],
      top: currentTop,
      bottom: currentBottom,
      avgVol20: avgVol20[i],
      isBasicBuy,
      isBasicSell,
      isConfirmedBuy,
      isConfirmedSell
    });
  }

  return results;
}

// ─── 5. Lấy & xử lý dữ liệu cho một mã cổ phiếu ───────────────────────────────
async function checkDarvasSingle(symbol, resolution = '1D') {
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
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Pure-Darvas Checker/1.0)' }
    });

    if (data.s !== 'ok') {
      throw new Error(`Lỗi API: ${data.s}`);
    }

    let { t, c, o, h, l, v } = data;

    if (resolution === '1W') {
      const weeklyData = getWeeklyDataFromDaily(t, c, v, h, l, o); // Truyền thêm o
      t = weeklyData.timestamps;
      c = weeklyData.closes;
      v = weeklyData.volumes;
      h = weeklyData.highs;
      l = weeklyData.lows;
      o = weeklyData.opens; // Lấy opens mới
    }

    // Tính chỉ báo khối lượng
    const avgVol20 = calculateAvgVolume(v, 20);

    const lastIndex = c.length - 1;
    const currentPrice = c[lastIndex];
    const currentVolume = v[lastIndex];
    const currentAvgVol = avgVol20[lastIndex];
    const isHighVolume = currentAvgVol && currentVolume > currentAvgVol;

    return {
      symbol,
      resolution,
      currentPrice,
      currentVolume,
      currentAvgVol,
      isHighVolume,
      timestamps: t,
      closes: c,
      highs: h,
      lows: l,
      volumes: v,
      avgVol20,
      opens: o // Trả về thêm opens
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
      avgVol20: [],
      opens: [] // Trả về thêm opens
    };
  }
}

// ─── 6. 🧠 Logic quét chính: chỉ Darvas thuần ──────────────────────────────────
async function checkAllDarvas() {
  console.log('📢 [darvas.js:237]', 'running darvas');
  const symbols = await getWatchedSymbols();

  for (const symbol of symbols) {
    const dailyResult = await checkDarvasSingle(symbol, '1D');
    if (dailyResult.error) continue;

    const {
      timestamps,
      highs,
      lows,
      closes,
      volumes,
      avgVol20,
      currentPrice,
      currentVolume,
      currentAvgVol,
      opens // Lấy thêm opens
    } = dailyResult;

    // ─── 🚀 TÍN HIỆU DARVAS THUẦN ──────────────────────────────────────────────
    const darvasSignals = detectPureDarvas(
      timestamps,
      highs,
      lows,
      closes,
      volumes,
      avgVol20,
      5
    );

    // ─── 🚨 PHÁT HIỆN CLIMAX ────────────────────────────────────────────────────
    const climaxSignals = detectClimax(timestamps, highs, lows, closes, volumes, avgVol20, opens);

    // Ghép dữ liệu climax vào mỗi tín hiệu Darvas
    const combinedSignals = darvasSignals.map((signal, i) => ({
      ...signal,
      isBuyingClimax: climaxSignals[i]?.isBuyingClimax || false,
      isSellingClimax: climaxSignals[i]?.isSellingClimax || false
    }));

    const latest = combinedSignals[combinedSignals.length - 1];

    if (latest) {
      if (latest.isConfirmedBuy) {
        const climaxWarning = latest.isBuyingClimax
          ? '\n⚠️ CẢNH BÁO: Mới qua Buying Climax — cẩn trọng, có thể tăng giả tạo!'
          : latest.isSellingClimax
            ? '\n🟢 TÍCH CỰC: Mới qua Selling Climax — điểm mua tiềm năng!'
            : '';

        const message = `
      🟢 DARVAS XÁC NHẬN MUA (THUẦN)
      📌 ${symbol} | ${latest.date}
      💰 Giá: ${latest.close.toFixed(2)} > Đỉnh hộp: ${latest.top.toFixed(2)}
      📊 Xác nhận:
        • KL > TB 20 ngày: ${latest.avgVol20 && latest.volume > latest.avgVol20 ? '✅' : '❌'} (${latest.volume.toFixed(0)} vs ${latest.avgVol20?.toFixed(0) || 'N/A'})
      💡 Phân tích thêm:
        ${climaxWarning}
      🎯 KHUYẾN NGHỊ: ${latest.isBuyingClimax ? 'CÂN NHẮC — Có rủi ro tăng giả tạo' : 'MUA — Tín hiệu Darvas thuần + khối lượng'}
      `;
        console.log('📢 [darvas.js:279]', message);
        await sendTelegramNotification(message, true);
      }

      if (latest.isConfirmedSell) {
        const climaxInfo = latest.isSellingClimax
          ? '\n🟢 CẢNH BÁO: Mới qua Selling Climax — có thể là điểm mua tiềm năng, không phải bán!'
          : latest.isBuyingClimax
            ? '\n🔴 TÍCH CỰC: Mới qua Buying Climax — xác nhận xu hướng giảm'
            : '';

        const message = `
      🔴 DARVAS XÁC NHẬN BÁN (THUẦN)
      📌 ${symbol} | ${latest.date}
      💰 Giá: ${latest.close.toFixed(2)} < Đáy hộp: ${latest.bottom.toFixed(2)}
      💡 Phân tích thêm:
        ${climaxInfo}
      🎯 KHUYẾN NGHỊ: ${latest.isSellingClimax ? 'CÂN NHẮC — Có thể là điểm mua ngược!' : 'BÁN / DỪNG LỖ — Tín hiệu Darvas thuần'}
      `;
        console.log('📢 [darvas.js:290]', message);
        await sendTelegramNotification(message, true);
      }
    }

    // ─── 📌 THỐNG KÊ HIỆN TẠI ──────────────────────────────────────────────────
    const weeklyResult = await checkDarvasSingle(symbol, '1W');
    const {
      currentAvgVol: currentAvgVolW,
      currentVolume: currentVolumeW
    } = weeklyResult;

    if (latest) {
      const climaxInfo = latest.isBuyingClimax
        ? '🚨 MỚI QUA BUYING CLIMAX — Cẩn trọng tăng giả tạo!'
        : latest.isSellingClimax
          ? '🟢 MỚI QUA SELLING CLIMAX — Có thể là điểm mua tiềm năng!'
          : '✅ Không có dấu hiệu climax gần đây.';

      const message = `
🔍 ${symbol} — Tổng quan Darvas
📈 Giá: ${currentPrice.toFixed(2)}
📊 KL ngày: ${currentVolume.toFixed(0)} | TB 20 ngày: ${currentAvgVol?.toFixed(0)}
📊 KL tuần: ${currentVolumeW.toFixed(0)} | TB 20 tuần: ${currentAvgVolW?.toFixed(0)}
📦 Hộp hiện tại: Top=${latest.top?.toFixed(2) || 'N/A'}, Bottom=${latest.bottom?.toFixed(2) || 'N/A'}
🎯 Tín hiệu: ${latest.isConfirmedBuy ? '🟢 MUA' : latest.isConfirmedSell ? '🔴 BÁN' : '⚪️ CHỜ'}

💡 PHÂN TÍCH CLIMAX:
   ${climaxInfo}

🎯 KẾT LUẬN:
   ===> ${latest.isConfirmedBuy ? 'CÂN NHẮC MUA (Darvas + KL)' : latest.isConfirmedSell ? 'CÂN NHẮC BÁN (Darvas)' : 'Theo dõi tiếp'}
`;
      console.log('📢 [darvas.js:314]', message);
      await sendTelegramNotification(message, true);
    }
  }

}

// ─── 7. Chạy chương trình ─────────────────────────────────────────────────────
// checkAllDarvas().catch(err => {
//   console.error('❌ Lỗi toàn cục:', err);
//   process.exit(1);
// });

module.exports = { checkAllDarvas };