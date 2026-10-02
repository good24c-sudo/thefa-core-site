/* ============================================================
   THEFA Core — demo.html controller
   Rich (deep-detail) version of the 7-step machine.
   ============================================================ */

(function () {
  'use strict';

  var D = window.BUILDUP_DATA;
  if (!D) return;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function boot() {
    var req = document.getElementById('demoRequestText');
    if (req) req.textContent = D.demo.request;

    var list = document.getElementById('demoStepList');
    if (!list || !window.buildupCreateDemoMachine) return;

    list.innerHTML = D.demo.steps.map(function (s) {
      return '<button class="demo-step" type="button" role="tab" id="demoTab' + s.id + '" ' +
        'aria-controls="demoPanel" aria-selected="false" data-step="' + s.id + '" data-done="false">' +
        '<span class="demo-step__n">' + s.id + '</span>' +
        '<span><span class="demo-step__label">' + esc(s.ko) + '</span>' +
        '<span class="demo-step__en">' + esc(s.en) + '</span></span>' +
        '<span class="demo-step__tick" aria-hidden="true">✓</span>' +
      '</button>';
    }).join('');

    var machine = window.buildupCreateDemoMachine({
      tabSelector: '.demo-step',
      tablistSelector: '#demoStepList',
      panelSelector: '#demoPanel',
      labelSelector: '#demoStageLabel',
      stateSelector: '#demoStageState',
      barSelector: '#demoBar',
      countSelector: '#demoCount',
      playSelector: '#demoPlay',
      prevSelector: '#demoPrev',
      nextSelector: '#demoNext',
      announce: 'demoLive',
      rich: true,
      interval: 4200
    });

    machine.autoStartOnVisible(document.getElementById('demoStage'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
