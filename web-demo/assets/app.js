/* Shared behaviour for the web demo. No app code. */
(function () {
  var root = document.documentElement;

  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function write(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var lang = read('af-lang') || root.getAttribute('data-lang') || 'en';
  if (lang !== 'en' && lang !== 'vi') lang = 'en';

  // Theme: '', 'dark' or 'light'. Persisted so a reload keeps the choice.
  var themeLabels = {
    en: { '': 'System', dark: 'Dark', light: 'Light' },
    vi: { '': 'Theo hệ thống', dark: 'Tối', light: 'Sáng' }
  };
  var themeMode = root.getAttribute('data-theme') || '';
  var savedTheme = read('af-theme');
  if (savedTheme === 'dark' || savedTheme === 'light') themeMode = savedTheme;
  else if (savedTheme === 'system') themeMode = '';
  if (themeMode) root.setAttribute('data-theme', themeMode); else root.removeAttribute('data-theme');

  // View style: 'warm' (default paper tone) or 'plain' (pure white). It only
  // swaps the neutral tokens, so it combines with any theme above.
  var styleLabels = {
    en: { warm: 'Warm', plain: 'Plain' },
    vi: { warm: 'Ấm', plain: 'Trắng' }
  };
  var styleTips = {
    en: { warm: 'View style: warm paper tone', plain: 'View style: pure white' },
    vi: { warm: 'Phong cách: nền giấy ấm', plain: 'Phong cách: trắng thuần' }
  };
  var viewStyle = read('af-style') === 'plain' ? 'plain' : 'warm';
  root.setAttribute('data-style', viewStyle);

  function applyThemeLabel() {
    var label = document.getElementById('themeLabel');
    if (!label) return;
    var set = themeLabels[lang] || themeLabels.en;
    label.textContent = set[themeMode] || set[''];
  }

  function applyStyleLabel() {
    var label = document.getElementById('styleLabel');
    var btn = document.getElementById('styleBtn');
    if (label) label.textContent = (styleLabels[lang] || styleLabels.en)[viewStyle];
    if (btn) btn.setAttribute('title', (styleTips[lang] || styleTips.en)[viewStyle]);
  }

  function applyLang(l) {
    lang = l === 'vi' ? 'vi' : 'en';
    root.setAttribute('data-lang', lang);
    root.setAttribute('lang', lang);
    document.querySelectorAll('[data-' + lang + ']').forEach(function (n) {
      n.textContent = n.getAttribute('data-' + lang);
    });
    var en = document.getElementById('lang-en');
    var vi = document.getElementById('lang-vi');
    if (en) en.setAttribute('aria-pressed', String(lang === 'en'));
    if (vi) vi.setAttribute('aria-pressed', String(lang === 'vi'));
    applyThemeLabel();
    applyStyleLabel();
  }

  function setLang(l) {
    write('af-lang', l === 'vi' ? 'vi' : 'en');
    applyLang(l);
  }

  function theme() {
    var next = themeMode === 'dark' ? 'light'
      : themeMode === 'light' ? ''
      : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark');
    themeMode = next;
    if (next) root.setAttribute('data-theme', next); else root.removeAttribute('data-theme');
    write('af-theme', next || 'system');
    applyThemeLabel();
  }

  function style() {
    viewStyle = viewStyle === 'plain' ? 'warm' : 'plain';
    root.setAttribute('data-style', viewStyle);
    write('af-style', viewStyle);
    applyStyleLabel();
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

  // Only the label span is rewritten; the icon and the button keep their DOM.
  function checkAll(btn, label) {
    var span = btn.querySelector('span');
    var steps = parseInt(btn.getAttribute('data-steps'), 10) || 4;
    var done = spin(btn);
    var n = 0;
    var iv = setInterval(function () {
      n++;
      if (span) span.textContent = (lang === 'vi' ? 'Đang kiểm tra ' : 'Checking ') + Math.min(n, steps) + '/' + steps;
      if (n >= steps) {
        clearInterval(iv);
        done();
        if (span) {
          span.textContent = span.getAttribute('data-' + lang) || span.getAttribute('data-en') || label || span.textContent;
        }
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

  (function init() {
    var t = document.getElementById('toast');
    if (t) {
      t.setAttribute('role', 'status');
      t.setAttribute('aria-live', 'polite');
    }
    // No resource strip on this page -> the System toggle would be dead. Hide it.
    if (!document.getElementById('resStrip')) {
      var b = document.getElementById('resToggle');
      if (b) { b.hidden = true; b.style.display = 'none'; }
    }
    applyLang(lang);
  })();

  window.AF = { setLang: setLang, theme: theme, style: style, toast: toast, spin: spin, checkOne: checkOne, checkAll: checkAll, toggleRes: toggleRes, get lang() { return lang; } };
})();
