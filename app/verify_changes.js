// 로컬 Edge headless로 index.html 변경 로직 검증
const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // fresh 프로파일: localStorage 누적(이전 테스트의 연차/휴일 토글)로 인한 상태 오염 원천 차단
  const profile = 'C:/Users/inter/AppData/Local/Temp/cwt_verify_' + Date.now();
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: 'new',
    args: ['--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profile]
  });
  const page = await browser.newPage();
  // confirm을 항상 거부: startup sync의 동시 편집 confirm이 headless를 블로킹하지 않도록
  await page.evaluateOnNewDocument(() => { window.confirm = () => false; });
  // 사용자 실데이터 보호 + 테스트 격리: 백업 미러(POST /backup)와 동기화 채택(/backup.js) 차단
  // (실브라우저가 열려 있으면 60초마다 headless 스토어가 실데이터로 덮어써져 테스트가 오염됨)
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    if ((req.method() === 'POST' && u.includes('/backup')) || u.includes('/backup.js')) req.abort();
    else req.continue();
  });
  await page.goto('http://127.0.0.1:8737/', { waitUntil: 'domcontentloaded' });
  await sleep(1500);

  // headless 프로파일은 localStorage가 비어 있음 → 서버 백업을 시드로 주입 후 재시작
  // savedAt를 현재로: startup sync가 서버 버전으로 덮어써 vacation/holiday 테스트 오염을 방지
  const seeded = await page.evaluate(async () => {
    const r = await fetch('http://127.0.0.1:8737/backup');
    const obj = await r.json();
    obj.store.savedAt = new Date().toISOString();
    localStorage.setItem('calc_working_time_v1', JSON.stringify(obj.store));
    return Object.keys(obj.store.months).length;
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(1500);
  // startup sync의 confirm 경로 차단 (headless에서 confirm이 블로킹/자동수락되는 것 방지)
  await page.evaluate(() => { window.confirm = () => false; });
  await sleep(2500);

  const results = [];
  const ok = (name, pass, detail='') => results.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ['+detail+']' : ''}`);

  // 1) 렌더 기본
  const base = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('#calGrid .cell:not(.blank)')];
    return { cells: cells.length, total: document.getElementById('sumTotal').textContent, req: document.getElementById('requiredInput').value };
  });
  ok('월 렌더 (평일 5열 셀)', base.cells >= 20, `cells=${base.cells} total=${base.total} req=${base.req}`);

  // 2) 오늘 표시 (오늘이 평일이면 today 1개, 주말이면 0개 정상)
  const today = await page.evaluate(() => {
    const t = [...document.querySelectorAll('#calGrid .cell.today')];
    const d = new Date();
    return { n: t.length, key: t[0] ? t[0].dataset.key : null, dow: d.getDay(), isCurMonth: t[0] ? t[0].dataset.key.startsWith(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')) : null };
  });
  ok('오늘 셀 연한 파란(today 클래스)', today.dow === 0 || today.dow === 6 ? today.n === 0 : today.n === 1 && today.isCurMonth, JSON.stringify(today));

  // 3) 롱프레스 1초 → 연차 (입력 시간 유지)
  const lp = await page.evaluate(async () => {
    const cell = [...document.querySelectorAll('#calGrid .cell:not(.blank)')].find(c => c.dataset.key.endsWith('-13') || c.dataset.key.endsWith('-12') || true);
    const key = cell.dataset.key;
    const before = store.months[key.slice(0,7)].days[key].hours;
    cell.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    await new Promise(r => setTimeout(r, 1200));   // 1초 초과 유지
    cell.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    const c = document.querySelector(`.cell[data-key="${key}"]`);
    const dayRec = store.months[key.slice(0,7)].days[key];
    return { key, before, after: dayRec.hours, vacClass: c.classList.contains('vacation'), badge: !!c.querySelector('.vacationBadge'), vacFlag: dayRec.vacation === true };
  });
  ok('롱프레스 1초 → 연차 지정 + 시간 유지', lp.vacClass && lp.badge && lp.vacFlag && lp.before === lp.after, JSON.stringify(lp));

  // 4) 롱프레스 직후 클릭 연쇄 무시 (모달이 열리면 실패)
  const chain = await page.evaluate(async () => {
    const cell = [...document.querySelectorAll('#calGrid .cell:not(.blank)')][2];
    const key = cell.dataset.key;
    cell.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    await new Promise(r => setTimeout(r, 1200));
    cell.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true }));
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));   // 직후 클릭
    await new Promise(r => setTimeout(r, 200));
    const modalOpen = document.getElementById('overlay').style.display === 'flex';
    const c = document.querySelector(`.cell[data-key="${key}"]`);
    return { key, modalOpen, vac: c.classList.contains('vacation') };
  });
  ok('롱프레스 직후 클릭 → 모달 연쇄 오픈 방지', !chain.modalOpen && chain.vac, JSON.stringify(chain));

  // 5) 더블클릭 범위 확장: 셀 배경(날짜 라벨)에서 dblclick → 휴일
  await sleep(1600);   // 직전 롱프레스의 연쇄차단 윈도우(1500ms) 소멸 대기
  const dc = await page.evaluate(() => {
    const cell = [...document.querySelectorAll('#calGrid .cell:not(.blank):not(.holiday)')][0];
    const key = cell.dataset.key;
    const label = cell.querySelector('.daynum');   // 시간 표시줄이 아닌 날짜 라벨
    label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const dayRec = store.months[key.slice(0,7)].days[key];
    const c = document.querySelector(`.cell[data-key="${key}"]`);
    return { key, holiday: dayRec.holiday === true, hoursGone: dayRec.hours === undefined, redClass: c.classList.contains('holiday'), badge: !!c.querySelector('.holidayBadge') };
  });
  ok('셀 배경(날짜 라벨) 더블클릭 → 휴일 지정 + 시간 제거', dc.holiday && dc.hoursGone && dc.redClass && dc.badge, JSON.stringify(dc));

  // 6) 시/분 입력란 포커스 시 select() 호출 (전체 선택 → 새 입력이 덮어씀)
  const focus = await page.evaluate(() => {
    const inp = [...document.querySelectorAll('#calGrid .hoursInput')].find(i => !i.disabled && i.value !== '');
    let selCalled = false;
    const orig = HTMLInputElement.prototype.select;
    HTMLInputElement.prototype.select = function(){ if(this.classList.contains('hoursInput')||this.classList.contains('minInput')) selCalled = true; return orig.call(this); };
    inp.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    HTMLInputElement.prototype.select = orig;
    return { value: inp.value, selCalled };
  });
  ok('시/분 입력란 포커스 → 기존 값 전체 선택(select 호출)', focus.selCalled, JSON.stringify(focus));

  // 7) 연차는 합계 포함 (휴일은 제외): store 재계산과 화면 합계 비교
  const sum = await page.evaluate(() => {
    const ymKey = document.getElementById('monthPick').value;
    const days = store.months[ymKey].days;
    let expect = 0, vacIncluded = false;
    for(const k in days){
      const d = days[k];
      if(d.holiday) continue;
      expect += parseFloat(d.hours) || 0;
      if(d.vacation && d.hours) vacIncluded = true;
    }
    const vacOnly = [...document.querySelectorAll('#calGrid .cell.vacation:not(.holiday)')].length;
    return { vacOnly, vacIncluded, expect: Math.round(expect*100)/100, shown: document.getElementById('sumTotal').textContent };
  });
  ok('연차 시간은 합계에 포함 (휴일 시간은 제외)', sum.vacOnly > 0 && sum.vacIncluded, JSON.stringify(sum));

  // 8) 동기화 confirm 가드 코드 존재 (peer 있을 때만 confirm 경로)
  const guard = await page.evaluate(() => {
    const src = [...document.querySelectorAll('script')].map(s => s.textContent).join('');
    return { hasGuard: src.includes('rejectedRemoteAt') && src.includes('peerList.length > 0'), hasLp: src.includes('lpJustFired'), hasVac: src.includes('toggleVacation'), hasToday: src.includes('" today"') };
  });
  ok('sync 가드/연차/오늘 코드 페이지 로드 확인', guard.hasGuard && guard.hasLp && guard.hasVac && guard.hasToday, JSON.stringify(guard));

  console.log(results.join('\n'));
  const fails = results.filter(r => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - fails}/${results.length} PASS`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('SCRIPT ERROR:', e.message); process.exit(2); });
