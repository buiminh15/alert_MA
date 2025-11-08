function dateToTimestamp(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;

  // Hỗ trợ cả có giờ và không có giờ
  const datetimeRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}):?(\d{2})?)?$/;
  const match = dateStr.trim().match(datetimeRegex);

  if (!match) {
    console.warn(`⚠️ Định dạng ngày không hợp lệ: "${dateStr}". Vui lòng dùng "dd/mm/yyyy" hoặc "dd/mm/yyyy HH:mm:ss"`);
    return null;
  }

  const [, day, month, year, hour = '0', minute = '0', second = '0'] = match;

  // Tạo Date (lưu ý: JS month bắt đầu từ 0 → trừ 1 ở tháng)
  const date = new Date(
    parseInt(year, 10),
    parseInt(month, 10) - 1, // month index: 0–11
    parseInt(day, 10),
    parseInt(hour, 10),
    parseInt(minute, 10),
    parseInt(second, 10)
  );

  // Kiểm tra ngày hợp lệ (tránh lỗi như 31/02/2024)
  if (isNaN(date.getTime())) {
    console.warn(`⚠️ Ngày không tồn tại: "${dateStr}"`);
    return null;
  }

  // Trả về Unix timestamp (giây)
  return Math.floor(date.getTime() / 1000);
}

function formatDate(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0'); // Tháng +1
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

function getDates() {
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Đặt về 00:00:00

  // Sao chép today → lùi 3 tháng
  const threeMonthsAgo = new Date(today);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const originalDay = today.getDate();
  threeMonthsAgo.setDate(originalDay);
  if (threeMonthsAgo.getDate() !== originalDay) {
    // VD: 31/05 → 31/02 không tồn tại → JS tự nhảy sang 02/03 → ta đặt lại về 28/02 hoặc 29/02
    threeMonthsAgo.setDate(0); // setDate(0) = ngày cuối tháng trước
  }

  // Sao chép today → lùi 1 năm
  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  return {
    today,
    threeMonthsAgo,
    oneYearAgo
  };
}


export { dateToTimestamp, formatDate, getDates };