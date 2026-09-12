/* Dev fixture: Adsterra social bar (mobile). Self-anchors to the viewport bottom. */
(function () {
  var bar = document.createElement('div');
  bar.setAttribute('data-fake-ad', 'socialbar-mobile');
  bar.textContent = 'SOCIAL BAR mobile';
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:60;display:flex;align-items:center;justify-content:center;height:34px;background:#10130f;color:#00f0ff;border-top:1px solid #00f0ff;font:11px monospace;letter-spacing:2px;';
  document.body.appendChild(bar);
})();
