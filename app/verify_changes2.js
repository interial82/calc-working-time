// 6개 항목 headless Edge 검증 (puppeteer-core)
// 주의: 토글은 render()로 셀 DOM이 재생성되므로 매번 셀을 DOM에서 재조회해야 한다.
const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const profile = 'C:/Users/inter/AppData/Local/Temp/cwt_verify2_' + Date.now();
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: 'new',
    args: ['--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profile]
  });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => { window.confirm = () => false; });
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    if ((req.method() === 'POST' && u.includes('/backup')) || u.includes('/backup.js')) req.abort();
    else req.continue();
  });
  await page.goto('http://127.0.0.1:8737/', { waitUntil: 'domcontentloaded' });
  await sleep(1200);
  await page.evaluate(async () => {
    const r = await fetch('http://127.0.0.1:8737/backup');
    const obj = await r.json();
    obj.store.savedAt = new Date().toISOString();
    localStorage.setItem('calc_working_time_v1', JSON.stringify(obj.store));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(2500);

  const results = [];
  const ok = (name, pass, detail='') => results.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ['+detail+']' : ''}`);

  // 1) 휴일 → 롱프레스 → 연차 전환
  const h2v = await page.evaluate(async () => {
    const key = [...document.querySelectorAll('#calGrid .cell:not(.blank)')][0].dataset.key;
    document.querySelector(`.cell[data-key="${key}"] .daynum`).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    const wasHoliday = store.months[key.slice(0,7)].days[key].holiday === true;
    const cell = document.querySelector(`.cell[data-key="${key}"]`);   // render() 후 재조회
    cell.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    await new Promise(r => setTimeout(r, 1200));
    cell.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    const d = store.months[key.slice(0,7)].days[key];
    const c = document.querySelector(`.cell[data-key="${key}"]`);
    return { key, wasHoliday, holiday: d.holiday === true, vacation: d.vacation === true,
             vacClass: c.classList.contains('vacation'), holidayClass: c.classList.contains('holiday') };
  });
  ok('휴일 → 롱프레스 → 연차 전환 (중복 없음)', h2v.wasHoliday && h2v.vacation && !h2v.holiday && h2v.vacClass && !h2v.holidayClass, JSON.stringify(h2v));

  // 2) 연차 → 더블클릭 → 휴일 전환
  await sleep(1600);
  const v2h = await page.evaluate(async () => {
    const cell = [...document.querySelectorAll('#calGrid .cell.vacation:not(.holiday)')][0];
    const key = cell.dataset.key;
    cell.querySelector('.daynum').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    const d = store.months[key.slice(0,7)].days[key];
    const c = document.querySelector(`.cell[data-key="${key}"]`);
    return { key, holiday: d.holiday === true, vacation: d.vacation === true,
             hoursGone: d.hours === undefined, redClass: c.classList.contains('holiday') };
  });
  ok('연차 → 더블클릭 → 휴일 전환 (중복 없음, 시간 제거)', v2h.holiday && !v2h.vacation && v2h.hoursGone && v2h.redClass, JSON.stringify(v2h));

  // 3) 드래그 멀티 선택 (실제 마우스: 합성 pointermove는 clientX=0이라 elementFromPoint 실패)
  await page.setViewport({ width: 1100, height: 900 });
  await sleep(300);
  const centers = await page.evaluate(() =>
    [...document.querySelectorAll('#calGrid .cell:not(.blank)')].slice(0, 4).map(c => {
      const r = c.getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2 };
    }));
  await page.mouse.move(centers[0].x, centers[0].y);
  await page.mouse.down();
  for(let i=1; i<4; i++){ await page.mouse.move(centers[i].x, centers[i].y, { steps: 4 }); await sleep(40); }
  await page.mouse.up();
  await sleep(250);
  const drag = await page.evaluate(() => {
    const sel = [...document.querySelectorAll('#calGrid .cell.sel')].map(c=>c.dataset.key);
    return { selCount: sel.length, sel, info: document.getElementById('selInfo').textContent };
  });
  ok('드래그 멀티 선택 (4개 셀)', drag.selCount === 4 && drag.info.includes('선택 4개'), JSON.stringify(drag));

  // 4) Shift+클릭 멀티 선택 (기존 선택 유지 + 추가)
  const shift = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('#calGrid .cell:not(.blank)')];
    const target = cells[6];
    const before = selKeys.size;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    const after = selKeys.size;
    const sel = [...document.querySelectorAll('#calGrid .cell.sel')].map(c=>c.dataset.key);
    return { before, after, hasTarget: sel.includes(target.dataset.key) };
  });
  ok('Shift+클릭 멀티 선택 (선택 +1)', shift.after === shift.before + 1 && shift.hasTarget, JSON.stringify(shift));

  // 5) 멀티 선택 상태에서 시/분 수기 입력 → 일괄 반영 (비활성 셀 제외된 셀 선택)
  const batchHM = await page.evaluate(() => {
    const keys = [...selKeys];
    const k0 = keys.find(k => {
      const he = document.querySelector(`.hoursInput[data-key="${k}"]`);
      return he && !he.disabled;
    });
    if(!k0) return { skip: true, keys };
    const hEl = document.querySelector(`.hoursInput[data-key="${k0}"]`);
    const mEl = document.querySelector(`.minInput[data-key="${k0}"]`);
    hEl.value = "9"; hEl.dispatchEvent(new Event('input', { bubbles: true }));
    mEl.value = "30"; mEl.dispatchEvent(new Event('input', { bubbles: true }));
    const data = store.months[k0.slice(0,7)].days;
    const nonHoliday = keys.filter(k => !(data[k] && data[k].holiday));
    const applied = nonHoliday.map(k => data[k] ? data[k].hours : null);
    return { skip: false, k0, nonHoliday, applied, expect: 9.5 };
  });
  ok('시/분 수기 입력 일괄 반영', !batchHM.skip && batchHM.applied.every(h => h === 9.5), JSON.stringify(batchHM));

  // 6) 멀티 선택 상태에서 시간 팝업 적용 → 일괄 반영 (shift-click마다 render로 DOM 재생성 → 매번 재조회)
  const batchModal = await page.evaluate(async () => {
    clearSel();
    const idxs = [4, 5, 6];
    for(const i of idxs){
      const cell = [...document.querySelectorAll('#calGrid .cell:not(.blank)')][i];
      cell.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
      await new Promise(r => setTimeout(r, 60));
    }
    const keys = [...selKeys];
    const a = document.querySelector(`.cell[data-key="${keys[0]}"]`);
    a.querySelector('.timerange').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    const open = document.getElementById('overlay').style.display === 'flex';
    document.getElementById('mStart').value = "09:00";
    document.getElementById('mEnd').value = "18:00";
    document.getElementById('mBreak').value = "60";
    document.getElementById('mApply').click();
    await new Promise(r => setTimeout(r, 200));
    const data = store.months[keys[0].slice(0,7)].days;
    const starts = keys.map(k => data[k] ? data[k].start : null);
    const hours = keys.map(k => data[k] ? data[k].hours : null);
    return { open, keyCount: keys.length, keys, starts, hours };
  });
  ok('시간 팝업 적용 일괄 반영 (3개 셀 09:00–18:00=8h)',
     batchModal.open && batchModal.keyCount === 3 && batchModal.starts.every(s=>s==="09:00") && batchModal.hours.every(h=>h===8),
     JSON.stringify(batchModal));

  // 7) 동기화 토스트 제거
  const noSyncToast = await page.evaluate(() => {
    const src = [...document.querySelectorAll('script')].map(s => s.textContent).join('');
    return { hasSyncToast: src.includes('최신 데이터로 동기화했습니다') };
  });
  ok('동기화 토스트 알림 제거', !noSyncToast.hasSyncToast, JSON.stringify(noSyncToast));

  // 8) 미래 일자 연한 회색 (future)
  const future = await page.evaluate(() => {
    const todayCell = document.querySelector('#calGrid .cell.today');
    const cells = [...document.querySelectorAll('#calGrid .cell:not(.blank)')];
    const tk = todayCell ? todayCell.dataset.key : null;
    const fut = cells.filter(c => c.classList.contains('future')).map(c=>c.dataset.key);
    const allAfter = fut.every(k => k > tk);
    const pastNotFuture = cells.filter(c => c.dataset.key < tk && !c.classList.contains('future')).length;
    return { tk, futCount: fut.length, allAfter, pastNotFuture };
  });
  ok('미래 일자 연한 회색 (future)', future.tk && future.futCount > 0 && future.allAfter, JSON.stringify(future));

  // 9) 하단 설명 접기/펼치기 (기본 접힘)
  const hint = await page.evaluate(async () => {
    const body = document.getElementById('hintBody');
    const btn = document.getElementById('hintToggle');
    const collapsedBefore = body.classList.contains('collapsed');   // 기본 접힘
    btn.click();
    const openAfter = !body.classList.contains('collapsed');
    const labelAfter = btn.textContent;
    btn.click();
    const collapsedAgain = body.classList.contains('collapsed');
    return { collapsedBefore, openAfter, labelAfter, collapsedAgain };
  });
  ok('하단 설명 기본 접힘 + 토글', hint.collapsedBefore && hint.openAfter && hint.labelAfter.includes('▼') && hint.collapsedAgain, JSON.stringify(hint));

  console.log(results.join('\n'));
  const fails = results.filter(r => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - fails}/${results.length} PASS`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('SCRIPT ERROR:', e.message); process.exit(2); });
