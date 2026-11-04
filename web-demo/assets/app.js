/* Shared behaviour for the web demo. No app code. */
(function () {
  var lang = document.documentElement.getAttribute('data-lang') || 'en';

  function applyLang(l) {
    lang = l;
    document.documentElement.setAttribute('data-lang', l);
    document.querySelectorAll('[data-' + l + ']').forEach(function (n) {
      n.textContent = n.getAttribute('data-' + l);
    });
    var en = document.getElementById('lang-en');
    var vi = document.getElementById('lang-vi');
    if (en) en.setAttribute('aria-pressed', String(l === 'en'));
    if (vi) vi.setAttribute('aria-pressed', String(l === 'vi'));
  }

  function theme() {
    var r = document.documentElement;
    var cur = r.getAttribute('data-theme');
    var next = cur === 'dark' ? 'light' : cur === 'light' ? '' : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark');
    if (next) r.setAttribute('data-theme', next); else r.removeAttribute('data-theme');
    var label = document.getElementById('themeLabel');
    if (label) label.textContent = next ? (next === 'dark' ? 'Dark' : 'Light') : 'System';
  }

  function toast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove('on'); }, 1600);
  }

  function spin(btn) {
    var ic = btn.querySelector('.ic');
    if (ic) ic.classList.add('spin');
    btn.disabled = true;
    return function () { if (ic) ic.classList.remove('spin'); btn.disabled = false; };
  }

  function checkOne(btn) {
    var done = spin(btn);
    setTimeout(function () { done(); toast(lang === 'vi' ? 'Đã kiểm tra (demo)' : 'Checked (demo)'); }, 1300);
  }

  function checkAll(btn, label) {
    var done = spin(btn);
    var n = 0;
    var iv = setInterval(function () {
      n++;
      btn.textContent = (lang === 'vi' ? 'Đang kiểm tra ' : 'Checking ') + Math.min(n, 4) + '/4';
      if (n >= 4) {
        clearInterval(iv); done();
        if (label) btn.textContent = label;
        var st = document.getElementById('stamp');
        if (st) st.textContent = new Date().toTimeString().slice(0, 5);
        toast(lang === 'vi' ? 'Hoàn tất (demo)' : 'Done (demo)');
      }
    }, 420);
  }

  function toggleRes() {
    var s = document.getElementById('resStrip');
    var b = document.getElementById('resToggle');
    if (!s || !b) return;
    var on = b.getAttribute('aria-pressed') === 'true';
    b.setAttribute('aria-pressed', String(!on));
    s.hidden = on;
  }

  window.AF = { setLang: applyLang, theme: theme, toast: toast, spin: spin, checkOne: checkOne, checkAll: checkAll, toggleRes: toggleRes, get lang() { return lang; } };
  applyLang(lang);
})();
