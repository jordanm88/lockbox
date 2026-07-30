const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const catalogPath = path.resolve(__dirname, '..', '..', 'src-tauri', 'Resources', 'catalog.json');

(async () => {
  if (!fs.existsSync(catalogPath)) {
    console.error('catalog.json not found at', catalogPath);
    process.exit(1);
  }

  let raw = fs.readFileSync(catalogPath, 'utf8');
  // Trim any leading non-json bytes (BOM or stray chars) by finding first '{'
  const firstBrace = raw.indexOf('{');
  if (firstBrace > 0) raw = raw.slice(firstBrace);
  const catalog = JSON.parse(raw);
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  for (const app of catalog.apps) {
    if (!app.homepage) continue;
    console.log('Processing', app.id, app.homepage);
    try {
      await page.goto(app.homepage, { waitUntil: 'networkidle' });
      const downloadHandle = await page.$("a:has-text('Download'), button:has-text('Download'), a:has-text('download'), button:has-text('download')");
      let finalUrl = null;
      // Click the download control and wait for an archive-like response
      if (downloadHandle) {
        const [response] = await Promise.all([
          page.waitForResponse(r => {
            const u = r.url();
            const h = r.headers();
            const ct = (h['content-type'] || '').toLowerCase();
            const cd = (h['content-disposition'] || '').toLowerCase();
            if (/\.(zip|exe|tar|gz|appimage|7z)$/i.test(u)) return true;
            if (/application\/(zip|x-zip-compressed|octet-stream|x-7z-compressed|x-gzip)/i.test(ct)) return true;
            if (/filename=.*\.(zip|exe|tar|gz|appimage|7z)/i.test(cd)) return true;
            return false;
          }, { timeout: 10000 }).catch(() => null),
          downloadHandle.click().catch(() => null),
        ]);
        if (response && response.ok()) {
          finalUrl = response.url();
        }
      }

      // If the click didn't yield an archive response, search for archive links on the page
      if (!finalUrl) {
        const links = await page.$$eval('a[href]', els => els.map(e => e.href));
        // Prefer links whose href contains 'mirror' or points at known archive extensions
        finalUrl = links.find(u => /mirror/i.test(u) && /\.(zip|exe|tar|gz|appimage|7z)$/i.test(u));
        if (!finalUrl) finalUrl = links.find(u => /\.(zip|exe|tar|gz|appimage|7z)$/i.test(u));
      }

      if (!finalUrl) {
        console.warn('Could not find archive URL for', app.id);
        continue;
      }

      console.log('Found candidate URL:', finalUrl);
      const res = await page.request.get(finalUrl);
      if (!res.ok()) {
        console.warn('Download failed', res.status());
        continue;
      }
      const buffer = await res.body();
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      app.targets = app.targets || {};
      const firstTarget = Object.keys(app.targets)[0];
      if (firstTarget) {
        app.targets[firstTarget].url = finalUrl;
        app.targets[firstTarget].sha256 = hash;
        app.targets[firstTarget].sizeBytes = buffer.length;
      }
      console.log('Saved sha256 for', app.id, hash);
    } catch (err) {
      console.error('Error processing', app.id, err.message);
    }
  }

  await browser.close();
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
  console.log('Updated', catalogPath);
  process.exit(0);
})();
