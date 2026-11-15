'use strict';

const TARGET_SERVICE = 'Закордонний паспорт та (або) ID-картка';
const TARGET_URL = 'https://cologne.pasport.org.ua/solutions/e-queue';

function normalize(s) {
  return String(s ?? '').replace(/\s+/g, ' ').replace(/[‐‑‒–—]/g, '-').trim();
}

function isServiceOption(label) {
  const text = normalize(label).toLocaleLowerCase('uk');
  return text.includes('закордонний паспорт') && /id\s*-\s*картк/.test(text);
}

function isPlaceholder(label) {
  const text = normalize(label).toLocaleLowerCase('uk');
  return !text || /^(обрати|оберіть|вибрати|виберіть|select|choose|день|date|--+|\.+)/i.test(text)
    || /немає|відсутн|недоступн|завантаженн|loading|no available/i.test(text);
}

function availableDates(options) {
  const seen = new Set();
  return (options || [])
    .filter(o => o && !o.disabled && String(o.value ?? '').trim() && !isPlaceholder(o.label))
    .map(o => normalize(o.label))
    .filter(label => {
      if (seen.has(label)) return false;
      seen.add(label);
      return true;
    })
    .slice(0, 45);
}

function classify(snapshot) {
  const body = normalize(snapshot.bodyText || '').toLocaleLowerCase('uk');
  const status = snapshot.httpStatus || 200;
  if (status === 403 || status === 429 || status >= 500) {
    return {status:'blocked', dates:[], reason:`Сайт вернул HTTP ${status}`};
  }
  if (/just a moment|checking your browser|verify you are human|attention required|captcha|turnstile|security check/i.test(body)) {
    return {status:'blocked', dates:[], reason:'Сайт требует проверку человека или ограничил доступ'};
  }
  const dates = snapshot.serviceSelected ? availableDates(snapshot.dayOptions) : [];
  if (dates.length > 0) {
    return {status:'available', dates, reason:`Найдено доступных дат: ${dates.length}`};
  }
  // Treat only these exact negative availability signals as authoritative.
  if (/вибачте.{0,100}всі місця зайняті|на даний момент відсутні місця в електронній черзі|наразі всі місця зайняті|всі місця зайняті/i.test(body)) {
    return {status:'no_slots', dates:[], reason:'Официальный сайт сообщает, что свободных мест нет'};
  }
  if (!snapshot.serviceSelected) {
    return {status:'unknown', dates:[], reason:'Не удалось выбрать нужную услугу на исходном сайте'};
  }
  return {status:'unknown', dates:[], reason:'Сайт не показал ни доступных дат, ни однозначного сообщения об отсутствии мест'};
}

module.exports = {TARGET_SERVICE, TARGET_URL, normalize, isServiceOption, isPlaceholder, availableDates, classify};
