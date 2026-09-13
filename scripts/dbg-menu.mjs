import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
await p.goto('http://127.0.0.1:3000/de/terminal', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('canvas'); await new Promise(r=>setTimeout(r,4000));
await p.evaluate(() => document.querySelector('[data-menu-trigger="tools"]')?.click());
await new Promise(r=>setTimeout(r,800));
const info = await p.evaluate(() => {
  const menu = document.querySelector('[role="menu"]');
  if (!menu) return { menu: null };
  const r = menu.getBoundingClientRect();
  const st = getComputedStyle(menu);
  const cx = r.left + r.width/2, cy = r.top + Math.min(20, r.height/2);
  const top = document.elementFromPoint(cx, cy);
  const tr = top ? top.getBoundingClientRect() : null;
  const chain = [];
  let el = menu; 
  while (el && chain.length < 8) { const s = getComputedStyle(el); chain.push(`${el.tagName}.${(el.className.baseVal??el.className??'').toString().slice(0,60)} | z:${s.zIndex} pos:${s.position} op:${s.opacity} vis:${s.visibility} disp:${s.display} clip:${s.clipPath.slice(0,30)} anim:${s.animationName}`); el = el.parentElement; }
  return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, op: st.opacity, vis: st.visibility, disp: st.display, z: st.zIndex, clip: st.clipPath, anim: st.animationName, topEl: top ? `${top.tagName}.${(top.className.baseVal??top.className??'').toString().slice(0,70)} txt=${(top.textContent??'').slice(0,20)} aria=${top.getAttribute?.('aria-label')} rect=${tr&&JSON.stringify({x:Math.round(tr.x),y:Math.round(tr.y),w:Math.round(tr.width),h:Math.round(tr.height)})} pos=${getComputedStyle(top).position} z=${getComputedStyle(top).zIndex}` : null, chain };
});
console.log(JSON.stringify(info, null, 1));
await b.close();
