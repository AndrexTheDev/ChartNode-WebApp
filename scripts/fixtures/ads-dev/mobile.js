/* Dev fixture standing in for an Adsterra mobile native-banner script. */
(function () {
  var host = document.currentScript && document.currentScript.parentElement;
  if (!host) return;
  var box = document.createElement('div');
  box.setAttribute('data-fake-ad', 'native-mobile');
  box.textContent = 'ADSTERRA MOBILE NATIVE';
  box.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;min-height:86px;border:1px dashed #ff2e97;color:#ff2e97;font:12px monospace;letter-spacing:2px;';
  host.appendChild(box);
})();
