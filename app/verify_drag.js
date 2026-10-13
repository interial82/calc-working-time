// 실제 마우스 이벤트로 드래그 멀티선택 / Shift+클릭 / 설명 기본 접힘 검증
const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const profile = 'C:/Users/inter/AppData/Local/Temp/cwt_drag_' + Date.now();
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: 'new',
    args: ['--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profile]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 900 });
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

  const centers = await page.evaluate(() => {
    return [...document.querySelectorAll('#calGrid .cell:not(.blank)')].slice(0, 8).map(c => {
      const r = c.getBoundingClientRect();
      return { key: c.dataset.key, x: r.x + r.width/2, y: r.y + r.height/2 };
    });
  });

  // 1) 실제 마우스 드래그: 셀0 → 셀4 (5개)
  await page.mouse.move(centers[0].x, centers[0].y);
  await page.mouse.down();
  for(let i=1; i<=4; i++){
    await page.mouse.move(centers[i].x, centers[i].y, { steps: 4 });
    await sleep(40);
  }
  await page.mouse.up();
  await sleep(250);
  const drag = await page.evaluate(() => ({
    sel: [...document.querySelectorAll('#calGrid .cell.sel')].map(c=>c.dataset.key),
    info: document.getElementById('selInfo').textContent
  }));
  ok('실제 마우스 드래그 멀티 선택 (5개)', drag.sel.length === 5 && drag.info.includes('선택 5개'), JSON.stringify(drag));

  // 2) Shift+클릭 2회 (실제 마우스 + Shift 키)
  await page.keyboard.down('Shift');
  await page.mouse.click(centers[6].x, centers[6].y);
  await sleep(120);
  await page.mouse.click(centers[7].x, centers[7].y);
  await page.keyboard.up('Shift');
  await sleep(250);
  const shift = await page.evaluate(() => ({
    n: selKeys.size,
    has6: selKeys.has([...document.querySelectorAll('#calGrid .cell:not(.blank)')][6].dataset.key),
    has7: selKeys.has([...document.querySelectorAll('#calGrid .cell:not(.blank)')][7].dataset.key)
  }));
  ok('Shift+클릭 2회 멀티 선택 (5→7)', shift.n === 7 && shift.has6 && shift.has7, JSON.stringify(shift));

  // 3) Shift+클릭 토글 제거
  await page.keyboard.down('Shift');
  await page.mouse.click(centers[6].x, centers[6].y);
  await page.keyboard.up('Shift');
  await sleep(250);
  const un = await page.evaluate(() => ({ n: selKeys.size }));
  ok('Shift+클릭 재클릭 → 선택 해제 (7→6)', un.n === 6, JSON.stringify(un));

  // 4) 선택 유지한 채 timerange 클릭 → 모달 열림 + 일괄 적용 (드래그로 5개 선택 후)
  await page.evaluate(() => clearSel());
  await page.mouse.move(centers[1].x, centers[1].y);
  await page.mouse.down();
  for(let i=2; i<=3; i++){ await page.mouse.move(centers[i].x, centers[i].y, { steps: 4 }); await sleep(40); }
  await page.mouse.up();
  await sleep(200);
  const trPos = await page.evaluate(() => {
    const k = [...selKeys][0];
    const tr = document.querySelector(`.timerange[data-key="${k}"]`);
    const r = tr.getBoundingClientRect();
    return { k, x: r.x + r.width/2, y: r.y + r.height/2 };
  });
  await page.mouse.click(trPos.x, trPos.y);
  await sleep(250);
  const modal = await page.evaluate(() => document.getElementById('overlay').style.display === 'flex');
  let batch = { open: modal };
  if(modal){
    await page.evaluate(() => {
      document.getElementById('mStart').value = "10:00";
      document.getElementById('mEnd').value = "17:00";
      document.getElementById('mBreak').value = "60";
      document.getElementById('mApply').click();
    });
    await sleep(250);
    batch = await page.evaluate(() => {
      const keys = [...selKeys];
      const data = store.months[keys[0].slice(0,7)].days;
      return { open: true, n: keys.length, starts: keys.map(k=>data[k] && data[k].start), hours: keys.map(k=>data[k] && data[k].hours) };
    });
  }
  ok('드래그 선택 → timerange 클릭 모달 → 일괄 적용 (3개 6h)',
     batch.open && batch.n === 3 && batch.starts.every(s=>s==="10:00") && batch.hours.every(h=>h===6), JSON.stringify(batch));

  // 5) 하단 설명 기본 접힘
  const hint = await page.evaluate(() => ({
    collapsed: document.getElementById('hintBody').classList.contains('collapsed'),
    label: document.getElementById('hintToggle').textContent
  }));
  ok('하단 설명 기본 접힘', hint.collapsed && hint.label.includes('▶'), JSON.stringify(hint));

  // 6) 시/분 입력이 드래그와 충돌하지 않는지 (입력란 클릭 → 타이핑)
  const inpPos = await page.evaluate(() => {
    const k = [...document.querySelectorAll('#calGrid .cell:not(.blank)')].map(c=>c.dataset.key)
      .find(k => { const he = document.querySelector(`.hoursInput[data-key="${k}"]`); return he && !he.disabled; });
    const he = document.querySelector(`.hoursInput[data-key="${k}"]`);
    const r = he.getBoundingClientRect();
    return { k, x: r.x + r.width/2, y: r.y + r.height/2 };
  });
  await page.evaluate(() => clearSel());
  await page.mouse.click(inpPos.x, inpPos.y);
  await sleep(150);
  await page.keyboard.type("7");
  await sleep(200);
  const typed = await page.evaluate(k => {
    const he = document.querySelector(`.hoursInput[data-key="${k}"]`);
    return { val: he.value, hours: store.months[k.slice(0,7)].days[k].hours, dragging };
  }, inpPos.k);
  ok('시/분 입력란 클릭+타입 정상 (7h, 드래그 잔존 없음)', typed.val === "7" && typed.hours === 7 && typed.dragging === false, JSON.stringify(typed));

  console.log(results.join('\n'));
  const fails = results.filter(r => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - fails}/${results.length} PASS`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('SCRIPT ERROR:', e.message); process.exit(2); });
