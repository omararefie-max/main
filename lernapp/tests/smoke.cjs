// Browser-Smoketest (Playwright). Start: python3 -m http.server 8123 im App-Ordner, dann: node tests/smoke.cjs
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const assert = require('assert');
const URL = process.env.URL || 'http://localhost:8123/index.html';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => {
    // Sprach-APIs simulieren (Headless-Chromium hat keine Stimmen/Mikrofon)
    window.__spoken = []; window.__stt = [];
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak(u) { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 5); }, cancel() {}, pause() {}, resume() {}, getVoices() { return []; }, addEventListener() {} } });
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
    window.webkitSpeechRecognition = window.SpeechRecognition = function () {
      this.start = () => setTimeout(() => {
        const next = window.__stt.shift();
        if (next === undefined) return this.onerror && this.onerror({ error: 'no-speech' });
        const r = Object.assign([{ transcript: next }], { isFinal: true });
        this.onresult && this.onresult({ results: [r] }); setTimeout(() => this.onend && this.onend(), 5);
      }, 20);
      this.abort = () => {}; this.stop = () => { setTimeout(() => this.onend && this.onend(), 5); };
    };
    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [] });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(URL); await page.waitForSelector('text=Es gibt noch keine Karten');
  await page.click('text=Beispieldaten laden'); await page.waitForSelector('text=Lernen starten');
  console.log('ok - Beispieldaten geladen');
  await page.screenshot({ path: '/tmp/shot-menu.png' });

  // --- Modul 1: drei Karten durchspielen
  await page.click('text=Lernen starten');
  for (let i = 0; i < 3; i++) {
    await page.waitForSelector('.q-text');
    const multi = await page.$('text=Mehrfachauswahl');
    if (i === 0) await page.screenshot({ path: '/tmp/shot-quiz.png' });
    if (multi) { const o = await page.$$('.opt'); await o[0].click(); await o[1].click(); await o[4].click(); await page.click('text=Antwort prüfen'); }
    else { await (await page.$$('.opt'))[0].click(); }
    await page.waitForSelector('.feedback');
    if (i === 0) await page.screenshot({ path: '/tmp/shot-feedback.png' });
    await page.click('.dock .btn.primary');
  }
  // falsch beantwortete Karten kommen nochmal – bis zur Auswertung durchklicken
  for (let guard = 0; guard < 10; guard++) {
    if (await page.$('.score')) break;
    await page.waitForSelector('.opt'); const o = await page.$$('.opt'); await o[2].click();
    if (await page.$('text=Antwort prüfen')) await page.click('text=Antwort prüfen');
    await page.waitForSelector('.feedback'); await page.click('.dock .btn.primary');
  }
  await page.waitForSelector('.score'); console.log('ok - Quiz-Sitzung + Auswertung:', await page.textContent('.score'));
  await page.screenshot({ path: '/tmp/shot-result.png' });
  await page.click('text=Fertig');

  // --- Prüfungsmodus
  await page.click('text=Prüfungsmodus'); await page.click('text=Prüfung starten');
  for (let i = 0; i < 3; i++) {
    await page.waitForSelector('.q-text'); const o = await page.$$('.opt'); await o[2].click();
    if (await page.$('text=Mehrfachauswahl')) { }
    await page.click('.dock .btn.primary');
  }
  await page.waitForSelector('.score'); console.log('ok - Prüfungsmodus');
  await page.click('text=Fertig');

  // --- Seiten
  for (const [hash, text] of [['#/statistik', 'Trefferquote'], ['#/karten', 'Quizkarten (3)'], ['#/einstellungen', 'Darstellung'], ['#/hoeren', 'Hands-free lernen'], ['#/pruefung', 'Prüfung starten']]) {
    await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForSelector('text=' + text); console.log('ok - Seite', hash);
  }
  await page.evaluate(() => { location.hash = '#/statistik'; }); await page.waitForSelector('text=Problemkarten'); await page.screenshot({ path: '/tmp/shot-stats.png' });

  // --- Editor: neue Karte
  await page.evaluate(() => { location.hash = '#/karten'; }); await page.click('text=+ Neue Quizkarte');
  const inputs = await page.$$('input[type=text]');
  await inputs[0].fill('Test'); await inputs[1].fill('Thema'); await page.fill('textarea >> nth=0', 'Frage X?');
  for (let i = 0; i < 5; i++) await inputs[3 + i].fill('Antwort ' + i);
  await page.click('input[type=checkbox] >> nth=1'); await page.click('text=Speichern'); await page.waitForSelector('text=Quizkarten (4)');
  console.log('ok - Editor speichert Karte');
  // Import mit Update (gleiche ID) -> Anzahl bleibt
  await page.click('.seg button:has-text("Import")'); await page.fill('textarea', JSON.stringify({ karten: [{ id: 'med-kardio-001', frage: 'Geändert?', antworten: ['1','2','3','4','5'], richtig: 'A' }] }));
  await page.click('text=Prüfen / Vorschau'); await page.waitForSelector('text=1 werden aktualisiert'); await page.click('text=Jetzt importieren');
  await page.click('.seg button:has-text("Inhalte")'); await page.waitForSelector('text=Quizkarten (4)'); console.log('ok - Import aktualisiert per ID');

  // --- Modul 2: Hands-free (simulierte Sprache). Antworten: A, "weiter", dann nichts
  await page.evaluate(() => { location.hash = '#/hoeren'; });
  await page.evaluate(() => { window.__stt = ['Antwort A', 'weiter', 'a und b']; });
  await page.click('text=Hands-free lernen');
  await page.waitForSelector('.status', { timeout: 5000 });
  await page.waitForSelector('text=Fertig', { timeout: 40000 }).catch(() => {});
  await page.screenshot({ path: '/tmp/shot-hands.png' });
  const spoken = await page.evaluate(() => window.__spoken);
  assert(spoken.some((t) => t.startsWith('Frage 1')), 'Frage wurde vorgelesen');
  assert(spoken.some((t) => /Richtig|falsch/i.test(t)), 'Feedback wurde gesprochen');
  console.log('ok - Hands-free:', spoken.length, 'Sprachausgaben');
  if (await page.$('text=Beenden')) await page.click('text=Beenden').catch(() => {});

  // --- Modul 3: mündliche Prüfung (1 Frage, 0 Nachfragen)
  await page.evaluate(() => { location.hash = '#/pruefung'; }); await page.waitForSelector('text=Prüfung starten');
  await page.selectOption('select', 'Innere Medizin::Kardiologie'); const nums = await page.$$('input[type=number]'); await nums[0].fill('1'); await nums[2].fill('1');
  await page.evaluate(() => { window.__stt = ['Ein Herzinfarkt ist ein Verschluss eines Herzkranzgefäßes, der Herzmuskel stirbt ab. Man hat Brustschmerzen mit Ausstrahlung in den Arm. Diagnose mit EKG und Troponin. Therapie mit Herzkatheter PCI.']; });
  await page.click('text=Prüfung starten');
  await page.waitForSelector('.transcript.has', { timeout: 5000 }); await page.screenshot({ path: '/tmp/shot-oral.png' });
  await page.waitForSelector('text=Verbesserungsempfehlungen', { timeout: 30000 });
  await page.screenshot({ path: '/tmp/shot-oral-result.png' });
  const sc = await page.textContent('.score'); assert(parseInt(sc) >= 80, 'Ergebnis zu niedrig: ' + sc); console.log('ok - mündliche Prüfung, Ergebnis:', sc);
  await page.click('text=Zurück'); await page.waitForSelector('text=Verlauf'); console.log('ok - Verlauf gespeichert');

  // Offline-Test: Service Worker aktiv, Seite lädt ohne Netz
  await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForTimeout(800);
  await ctx.setOffline(true); await page.reload(); await page.waitForSelector('.tabs'); console.log('ok - offline lädt');
  await ctx.setOffline(false);

  console.log(errors.length ? 'FEHLER:\n' + errors.join('\n') : 'keine Konsolenfehler');
  await browser.close(); process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('TEST FEHLGESCHLAGEN', e); process.exit(2); });
