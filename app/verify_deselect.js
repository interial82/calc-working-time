// 멀티 선택 중 셀 밖 클릭 시 해제 검증 (실제 마우스)
const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const profile = 'C:/Users/inter/AppData/Local/Temp/cwt_desel_' + Date.now();
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

  const centers = await page.evaluate(() =>
    [...document.querySelectorAll('#calGrid .cell:not(.blank)')].slice(0, 6).map(c => {
      const d = c.querySelector('.daynum').getBoundingClientRect();   // 날짜 라벨(입력란 아님) 기준
      return { key: c.dataset.key, x: d.x + d.width/2, y: d.y + d.height/2 };
    }));

  async function dragSelect(n, start=0){
    await page.evaluate(() => clearSel());
    await page.mouse.move(centers[start].x, centers[start].y);
    await page.mouse.down();
    for(let i=start+1; i<start+n; i++){ await page.mouse.move(centers[i].x, centers[i].y, { steps: 4 }); await sleep(40); }
    await page.mouse.up();
    await sleep(350);   // 파생 click 윈도우(150ms) 소멸 후 후속 클릭 가능
    return page.evaluate(() => selKeys.size);
  }

  // 1) 5개 선택 → 페이지 배경(body) 클릭 → 해제
  const n1 = await dragSelect(5);
  await page.mouse.click(20, 700);   // 좌하단 본문 배경
  await sleep(200);
  const after1 = await page.evaluate(() => ({ n: selKeys.size, info: document.getElementById('selInfo').textContent }));
  ok('셀 밖(본문 배경) 클릭 → 선택 해제', n1 === 5 && after1.n === 0 && after1.info === '', JSON.stringify({n1, ...after1}));

  // 2) 5개 선택 → 상단 바(월 이동 버튼) 클릭 → 해제
  const n2 = await dragSelect(5);
  const btnPos = await page.evaluate(() => { const r = document.getElementById('btnHelp').getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
  await page.mouse.click(btnPos.x, btnPos.y);
  await sleep(250);
  const after2 = await page.evaluate(() => selKeys.size);
  ok('상단 버튼(도움말) 클릭 → 선택 해제', n2 === 5 && after2 === 0, JSON.stringify({n2, after2}));
  // 도움말 모달이 열렸으면 닫아야 이후 드래그가 가려지지 않음
  await page.evaluate(() => { document.getElementById("helpOverlay").style.display = "none"; });
  await sleep(150);

  // 3) 5개 선택 → 셀 배경 클릭(timerange 아님) → 선택 유지
  const n3 = await dragSelect(5);
  const cellBg = await page.evaluate(() => {
    const c = document.querySelector('#calGrid .cell:not(.blank)');
    const d = c.querySelector('.daynum').getBoundingClientRect();
    return { x: d.x + d.width/2, y: d.y + d.height/2 };   // 날짜 라벨 위 (timerange 아님)
  });
  await page.mouse.click(cellBg.x, cellBg.y);
  await sleep(200);
  const after3 = await page.evaluate(() => selKeys.size);
  ok('일별 셀 클릭 → 선택 유지', n3 === 5 && after3 === 5, JSON.stringify({n3, after3}));

  // 4) 3개 선택 → timerange 클릭(모달) → 모달 내 클릭 → 선택 유지 + 일괄 적용
  const n4 = await dragSelect(3);
  const trPos = await page.evaluate(() => {
    const k = [...selKeys][0];
    if(!k) return { x: -1, y: -1 };
    const r = document.querySelector(`.timerange[data-key="${k}"]`).getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  });
  await page.mouse.click(trPos.x, trPos.y);
  await sleep(250);
  const modalOpen = await page.evaluate(() => document.getElementById('overlay').style.display === 'flex');
  // 모달 내부(preview 영역) 클릭 → 선택 유지 확인
  const pvPos = await page.evaluate(() => { const r = document.getElementById('preview').getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
  await page.mouse.click(pvPos.x, pvPos.y);
  await sleep(200);
  const after4 = await page.evaluate(() => selKeys.size);
  ok('timerange 모달 열림 + 모달 내 클릭 → 선택 유지', n4 === 3 && modalOpen && after4 === 3, JSON.stringify({n4, modalOpen, after4}));
  // 모달 적용 → 일괄 반영 후 선택 유지
  await page.evaluate(() => {
    document.getElementById('mStart').value = "09:30";
    document.getElementById('mEnd').value = "18:30";
    document.getElementById('mBreak').value = "60";
    document.getElementById('mApply').click();
  });
  await sleep(250);
  const batch = await page.evaluate(() => {
    const keys = [...selKeys];
    const data = store.months[keys[0].slice(0,7)].days;
    return { n: keys.length, starts: keys.map(k=>data[k] && data[k].start), hours: keys.map(k=>data[k] && data[k].hours) };
  });
  ok('모달 적용 → 3개 일괄 반영 + 선택 유지', batch.n === 3 && batch.starts.every(s=>s==="09:30") && batch.hours.every(h=>h===8), JSON.stringify(batch));

  // 5) 4개 선택 → Shift+클릭 → 선택 유지(+1) (해제되면 1개만 선택된 상태가 됨)
  const n5 = await dragSelect(4);
  const c6 = centers[5];
  await page.keyboard.down('Shift');
  await page.mouse.click(c6.x, c6.y);
  await page.keyboard.up('Shift');
  await sleep(200);
  const after5 = await page.evaluate(() => selKeys.size);
  ok('Shift+클릭 → 선택 유지 후 +1 (4→5)', n5 === 4 && after5 === 5, JSON.stringify({n5, after5}));

  // 6) 3개 선택 → 시/분 입력란 클릭+타입 → 일괄 반영 (선택 유지)
  const n6 = await dragSelect(3, 3);   // 손대지 않은 셀 3~5 (테스트4가 0~2에 start/end 넣어 입력란 비활성)
  const inpPos = await page.evaluate(() => {
    const k = [...selKeys].find(k => { const he = document.querySelector(`.hoursInput[data-key="${k}"]`); return he && !he.disabled; });
    const r = document.querySelector(`.hoursInput[data-key="${k}"]`).getBoundingClientRect();
    return { k, x: r.x + r.width/2, y: r.y + r.height/2 };
  });
  await page.mouse.click(inpPos.x, inpPos.y);
  await sleep(150);
  await page.keyboard.type("6");
  await sleep(250);
  const after6 = await page.evaluate(() => {
    const keys = [...selKeys];
    const data = store.months[keys[0].slice(0,7)].days;
    return { n: keys.length, hours: keys.map(k=>data[k] && data[k].hours) };
  });
  ok('시/분 입력 → 3개 일괄 6h + 선택 유지', n6 === 3 && after6.n === 3 && after6.hours.every(h=>h===6), JSON.stringify(after6));

  console.log(results.join('\n'));
  const fails = results.filter(r => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - fails}/${results.length} PASS`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('SCRIPT ERROR:', e.message); process.exit(2); });
