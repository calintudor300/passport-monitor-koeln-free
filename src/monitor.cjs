'use strict';
const {chromium} = require('playwright');
const {TARGET_URL, isServiceOption, classify} = require('./classifier.cjs');

const timeout = ms => new Promise(r => setTimeout(r, ms));

async function snapshot(page, httpStatus = 200) {
  return page.evaluate((httpStatus) => {
    const normalize = s => String(s || '').replace(/\s+/g, ' ').trim();
    const selects = [...document.querySelectorAll('select')].map((s, index) => ({
      index,
      id: s.id,
      name: s.name,
      label: [...(s.labels || [])].map(l => normalize(l.textContent)).join(' '),
      options: [...s.options].map(o => ({label:normalize(o.textContent), value:o.value, disabled:o.disabled}))
    }));
    return {
      bodyText: (document.body?.innerText || '').slice(0, 25000),
      selects,
      httpStatus
    };
  }, httpStatus);
}

function findService(snap) {
  for (const select of snap.selects) {
    for (const opt of select.options) {
      if (isServiceOption(opt.label) && !opt.disabled && opt.value) {
        return {index:select.index, value:opt.value};
      }
    }
  }
  return null;
}

function findDay(snap, serviceIndex) {
  const selects = snap.selects.filter(s => s.index !== serviceIndex);
  const named = selects.find(s => /day|date|день|дата/i.test(`${s.id} ${s.name} ${s.label}`));
  return named || selects.find(s => s.index > serviceIndex) || null;
}

async function checkAvailability() {
  const browser = await chromium.launch({headless:true, args:['--disable-dev-shm-usage']});
  const context = await browser.newContext({
    locale:'uk-UA', timezoneId:'Europe/Berlin',
    viewport:{width:1280,height:850},
    userAgent: undefined
  });
  const page = await context.newPage();
  try {
    const response = await page.goto(TARGET_URL, {waitUntil:'domcontentloaded', timeout:35000});
    const code = response?.status() || 200;
    if (code === 403 || code === 429 || code >= 500) {
      return {status:'blocked',dates:[],reason:`Сайт вернул HTTP ${code}`};
    }
    // The site may load the form asynchronously; no CAPTCHA or verification is bypassed.
    let before;
    for (let i=0;i<8;i++) {
      before = await snapshot(page, code);
      if (findService(before)) break;
      // If the server hides the entire form because all places are taken,
      // accept the explicit message after several rendering passes.
      if (i >= 2 && /всі місця зайняті|на даний момент відсутні місця в електронній черзі/i.test(before.bodyText)) break;
      if (/just a moment|captcha|verify you are human|checking your browser/i.test(before.bodyText)) break;
      await timeout(1000);
    }
    const service = findService(before);
    if (!service) {
      return classify({ ...before, serviceSelected:false, dayOptions:[] });
    }
    try {
      await page.locator('select').nth(service.index).selectOption(service.value,{timeout:6000});
    } catch (_e) {
      // Native <select> can be hidden by its custom-styled wrapper.
      await page.locator('select').nth(service.index).evaluate((el, value) => {
        el.value=value;
        el.dispatchEvent(new Event('input',{bubbles:true}));
        el.dispatchEvent(new Event('change',{bubbles:true}));
      },service.value);
    }
    await timeout(1700);
    let after = await snapshot(page, code);
    let day = findDay(after,service.index);
    // Allow time for AJAX to populate the day picker, without making repeated HTTP requests.
    for (let i=0;i<8;i++) {
      const result = classify({...after,serviceSelected:true,dayOptions:day?.options || []});
      if (result.status === 'available' || result.status === 'no_slots' || result.status === 'blocked') break;
      await timeout(1000);
      after = await snapshot(page, code);
      day = findDay(after,service.index);
    }
    const result = classify({...after,serviceSelected:true,dayOptions:day?.options || []});
    return result;
  } finally {
    await context.close();
    await browser.close();
  }
}

module.exports = {checkAvailability};
