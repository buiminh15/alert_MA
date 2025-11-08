const axios = require('axios');
const { dateToTimestamp, formatDate, getDates } = require('./utils');

// Cấu hình tham số
const SYMBOLS = ['VNINDEX']; // Danh sách các symbol
const RESOLUTION = '1D'; // 1D = daily; có thể đổi thành 1W, 1M nếu cần
const RESOLUTION_1W = '1W';

// Tính SMA (Simple Moving Average)
function calculateSMA(prices, period) {
  const sma = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      sma.push(null); // Chưa đủ dữ liệu
    } else {
      const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      sma.push(Number((sum / period).toFixed(4)));
    }
  }
  return sma;
}

// Hàm xử lý cho từng symbol
async function checkMASingle(symbol) {
  try {
    console.log(`\n🔄 Đang xử lý symbol: ${symbol}`);
    console.log('='.repeat(50));

    const { threeMonthsAgo, today } = getDates();

    const endDateStr = formatDate(today);
    const fromDateStr = formatDate(threeMonthsAgo);

    const fromDate = dateToTimestamp(fromDateStr);
    const endDate = dateToTimestamp(endDateStr);

    console.log(`🔍 Đang lấy dữ liệu ${symbol} từ ${threeMonthsAgo.toLocaleDateString()} đến ${today.toLocaleDateString()}`);

    // URL API
    const API_URL = `https://api.24hmoney.vn/tradingview/history?symbol=${symbol}&resolution=${RESOLUTION}&from=${fromDate}&to=${endDate}`;

    const { data } = await axios.get(API_URL, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MA-Checker/1.0)'
      }
    });

    if (data.s !== 'ok') {
      throw new Error(`API error: ${data.s}`);
    }

    const { t, c, o, h, l, v } = data;
    console.log(`✅ Nhận được ${c.length} phiên`);

    // Tính MA
    const ma10 = calculateSMA(c, 10);
    const ma20 = calculateSMA(c, 20);
    const ma50 = calculateSMA(c, 50);

    // Lấy giá và MA tại phiên gần nhất
    const lastIndex = c.length - 1;
    const currentPrice = c[lastIndex];
    const currentMA10 = ma10[lastIndex];
    const currentMA20 = ma20[lastIndex];
    const currentMA50 = ma50[lastIndex];

    // Kiểm tra điều kiện
    const isBelowMA10 = currentMA10 !== null && currentPrice < currentMA10;
    const isBelowMA20 = currentMA20 !== null && currentPrice < currentMA20;
    const isBelowMA50 = currentMA50 !== null && currentPrice < currentMA50;

    const isBelowAll = isBelowMA10 && isBelowMA20 && isBelowMA50;

    // In kết quả
    console.log('\n📈 KẾT QUẢ PHÂN TÍCH MA:');
    console.log(`- Giá hiện tại (close): ${currentPrice}`);
    console.log(`- MA10: ${currentMA10 !== null ? currentMA10 : '❌ Chưa đủ dữ liệu'}`);
    console.log(`- MA20: ${currentMA20 !== null ? currentMA20 : '❌ Chưa đủ dữ liệu'}`);
    console.log(`- MA50: ${currentMA50 !== null ? currentMA50 : '❌ Chưa đủ dữ liệu'}`);

    console.log('\n🔍 Kiểm tra vị trí giá:');
    console.log(`- Dưới MA10? ${isBelowMA10 ? '✅ Có' : '❌ Không'}`);
    console.log(`- Dưới MA20? ${isBelowMA20 ? '✅ Có' : '❌ Không'}`);
    console.log(`- Dưới MA50? ${isBelowMA50 ? '✅ Có' : '❌ Không'}`);

    console.log('\n🎯 KẾT LUẬN:');
    if (isBelowAll) {
      console.log('🔴 GIÁ ĐANG NẰM DƯỚI CẢ 3 ĐƯỜNG MA (10, 20, 50)');
      console.log('→ Xu hướng ngắn & trung hạn: GIẢM MẠNH');
      console.log('→ Cảnh báo: thị trường trong vùng điều chỉnh sâu / quá bán');
      console.log('→ Lưu ý: có thể là cơ hội mua giá rẻ nếu có tín hiệu đảo chiều');
    } else if (currentPrice > currentMA10 && currentMA10 > currentMA20 && currentMA20 > currentMA50) {
      console.log('🟢 GIÁ > MA10 > MA20 > MA50');
      console.log('→ Xu hướng tăng mạnh — thị trường "bò"');
    } else {
      console.log('🟡 Giá đang dao động trong vùng MA — xu hướng trung lập / tích lũy');
    }

    return {
      symbol,
      currentPrice,
      currentMA10,
      currentMA20,
      currentMA50,
      isBelowAll,
      isBullish: currentPrice > currentMA10 && currentMA10 > currentMA20 && currentMA20 > currentMA50
    };

  } catch (err) {
    console.error(`❌ Lỗi khi xử lý ${symbol}:`, err.message);
    if (err.response) {
      console.error('→ Mã lỗi HTTP:', err.response.status);
      console.error('→ Response data:', err.response.data);
    }
    return {
      symbol,
      error: err.message
    };
  }
}


async function checkMAWeekSingle(symbol) {
  try {
    console.log(`\n🔄 Đang xử lý symbol: ${symbol}`);
    console.log('='.repeat(50));

    const { threeMonthsAgo, today } = getDates();

    const endDateStr = formatDate(today);
    const fromDateStr = formatDate(threeMonthsAgo);

    const fromDate = dateToTimestamp(fromDateStr);
    const endDate = dateToTimestamp(endDateStr);

    console.log(`🔍 Đang lấy dữ liệu ${symbol} từ ${threeMonthsAgo.toLocaleDateString()} đến ${today.toLocaleDateString()}`);

    // URL API
    const API_URL = `https://api.24hmoney.vn/tradingview/history?symbol=${symbol}&resolution=${RESOLUTION_1W}&from=${fromDate}&to=${endDate}`;

    const { data } = await axios.get(API_URL, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MA-Checker/1.0)'
      }
    });

    if (data.s !== 'ok') {
      throw new Error(`API error: ${data.s}`);
    }

    const { t, c, o, h, l, v } = data;
    console.log(`✅ Nhận được ${c.length} phiên`);

    // Tính MA
    const ma10 = calculateSMA(c, 10);
    const ma20 = calculateSMA(c, 20);
    const ma50 = calculateSMA(c, 50);

    // Lấy giá và MA tại phiên gần nhất
    const lastIndex = c.length - 1;
    const currentPrice = c[lastIndex];
    const currentMA10 = ma10[lastIndex];
    const currentMA20 = ma20[lastIndex];
    const currentMA50 = ma50[lastIndex];

    // Kiểm tra điều kiện
    const isBelowMA10 = currentMA10 !== null && currentPrice < currentMA10;
    const isBelowMA20 = currentMA20 !== null && currentPrice < currentMA20;
    const isBelowMA50 = currentMA50 !== null && currentPrice < currentMA50;

    const isBelowAll = isBelowMA10 && isBelowMA20 && isBelowMA50;

    // In kết quả
    console.log('\n📈 KẾT QUẢ PHÂN TÍCH MA khung TUẦN:');
    console.log(`- Giá hiện tại (close): ${currentPrice}`);
    console.log(`- MA10 tuần: ${currentMA10 !== null ? currentMA10 : '❌ Chưa đủ dữ liệu'}`);
    console.log(`- MA20 tuần: ${currentMA20 !== null ? currentMA20 : '❌ Chưa đủ dữ liệu'}`);
    console.log(`- MA50 tuần: ${currentMA50 !== null ? currentMA50 : '❌ Chưa đủ dữ liệu'}`);

    console.log('\n🔍 Kiểm tra vị trí giá:');
    console.log(`- Dưới MA10 tuần? ${isBelowMA10 ? '✅ Có' : '❌ Không'}`);
    console.log(`- Dưới MA20 tuần? ${isBelowMA20 ? '✅ Có' : '❌ Không'}`);
    console.log(`- Dưới MA50 tuần? ${isBelowMA50 ? '✅ Có' : '❌ Không'}`);

    console.log('\n🎯 KẾT LUẬN:');
    if (isBelowAll) {
      console.log('🔴 GIÁ ĐANG NẰM DƯỚI CẢ 3 ĐƯỜNG MA tuần (10, 20, 50)');
      console.log('→ Xu hướng ngắn & trung hạn: GIẢM MẠNH');
      console.log('→ Cảnh báo: thị trường trong vùng điều chỉnh sâu / quá bán');
      console.log('→ Lưu ý: có thể là cơ hội mua giá rẻ nếu có tín hiệu đảo chiều');
    } else if (currentPrice > currentMA10 && currentMA10 > currentMA20 && currentMA20 > currentMA50) {
      console.log('🟢 GIÁ > MA10 tuần > MA20 tuần > MA50 tuần');
      console.log('→ Xu hướng tăng mạnh — thị trường "bò"');
    } else {
      console.log('🟡 Giá đang dao động trong vùng MA — xu hướng trung lập / tích lũy');
    }

    return {
      symbol,
      currentPrice,
      currentMA10,
      currentMA20,
      currentMA50,
      isBelowAll,
      isBullish: currentPrice > currentMA10 && currentMA10 > currentMA20 && currentMA20 > currentMA50
    };

  } catch (err) {
    console.error(`❌ Lỗi khi xử lý ${symbol}:`, err.message);
    if (err.response) {
      console.error('→ Mã lỗi HTTP:', err.response.status);
      console.error('→ Response data:', err.response.data);
    }
    return {
      symbol,
      error: err.message
    };
  }
}

// Hàm chính
async function checkMA() {
  console.log('🚀 Bắt đầu kiểm tra MA cho các symbol...\n');

  const results = [];
  const resultsWeek = [];

  for (const symbol of SYMBOLS) {
    const result = await checkMASingle(symbol);
    const resultWeek = await checkMAWeekSingle(symbol);
    results.push(result);
    resultsWeek.push(resultWeek);

    // Thêm khoảng cách giữa các symbol (trừ symbol cuối cùng)
    if (SYMBOLS.indexOf(symbol) < SYMBOLS.length - 1) {
      console.log('\n' + '='.repeat(60) + '\n');
    }
  }

  // Tóm tắt kết quả cuối cùng
  // console.log('\n📋 TỔNG KẾT:');
  // console.log('='.repeat(30));
  // results.forEach(result => {
  //   if (result.error) {
  //     console.log(`- ${result.symbol}: ❌ Lỗi - ${result.error}`);
  //   } else {
  //     let status = '';
  //     if (result.isBelowAll) {
  //       status = '🔴 Giảm mạnh';
  //     } else if (result.isBullish) {
  //       status = '🟢 Tăng mạnh';
  //     } else {
  //       status = '🟡 Trung lập';
  //     }
  //     console.log(`- ${result.symbol}: ${status} (Giá: ${result.currentPrice})`);
  //   }
  // });
}

// Chạy
checkMA();