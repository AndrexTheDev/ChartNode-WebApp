/* Dev fixture: Adsterra popunder (mobile). Marks itself instead of opening a window. */
(function () {
  var tag = document.createElement('div');
  tag.setAttribute('data-fake-ad', 'popunder-mobile');
  tag.textContent = 'POPUnder mobile ARMED';
  tag.style.cssText = 'position:fixed;right:8px;top:8px;z-index:70;padding:6px 10px;background:#140f14;color:#b026ff;border:1px solid #b026ff;font:11px monospace;';
  document.body.appendChild(tag);
})();
