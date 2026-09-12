/* Dev fixture standing in for an Adsterra desktop native-banner script. */
(function () {
  var host = document.currentScript && document.currentScript.parentElement;
  if (!host) return;
  var box = document.createElement('div');
  box.setAttribute('data-fake-ad', 'native-desktop');
  box.textContent = 'ADSTERRA DESKTOP NATIVE';
  box.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%;min-height:560px;border:1px dashed #39ff14;color:#39ff14;font:12px monospace;letter-spacing:2px;';
  host.appendChild(box);
})();
