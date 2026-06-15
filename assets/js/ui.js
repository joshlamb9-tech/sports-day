/* Sports Day — tiny DOM + UI helpers (no framework) */
(function () {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // el('button.btn.btn-primary', { onclick, 'data-id': x }, ['Save'] | 'Save' | node)
  function el(spec, props, children) {
    const parts = spec.split(/(?=[.#])/);
    const tag = parts[0].match(/^[a-z0-9]+/i) ? parts.shift() : 'div';
    const node = document.createElement(tag.match(/^[a-z]/i) ? tag : 'div');
    parts.forEach(function (p) {
      const v = p.slice(1);
      if (!v) return;                       // ignore stray '.'/'#' (e.g. a blank dynamic class)
      if (p[0] === '.') node.classList.add(v);
      else if (p[0] === '#') node.id = v;
    });
    if (props) {
      for (const k in props) {
        if (!props.hasOwnProperty(k) || props[k] == null) continue;
        if (k === 'onclick' || k === 'oninput' || k === 'onchange' || k === 'onsubmit' || k === 'onkeydown') {
          node.addEventListener(k.slice(2), props[k]);
        } else if (k === 'html') { node.innerHTML = props[k]; }
        else if (k === 'text') { node.textContent = props[k]; }
        else if (k === 'style' && typeof props[k] === 'object') { Object.assign(node.style, props[k]); }
        else { node.setAttribute(k, props[k]); }
      }
    }
    appendChildren(node, children);
    return node;
  }
  function appendChildren(node, children) {
    if (children == null) return;
    if (!Array.isArray(children)) children = [children];
    children.forEach(function (c) {
      if (c == null || c === false) return;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; }

  // numbers: 5 not 5.0, 4.5 stays 4.5
  function fmtNum(n) {
    n = Math.round(Number(n) * 100) / 100;
    return (n % 1 === 0) ? String(n) : String(n);
  }

  let toastТimer;
  function toast(msg, type) {
    let t = $('#sd-toast');
    if (!t) { t = el('div#sd-toast'); document.body.appendChild(t); }
    t.className = 'sd-toast ' + (type || '');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastТimer);
    toastТimer = setTimeout(function () { t.classList.remove('show'); }, type === 'error' ? 4200 : 2600);
  }

  // lightweight confirm modal (avoids window.confirm so it never blocks tooling)
  function confirmDialog(opts) {
    return new Promise(function (resolve) {
      const overlay = el('div.sd-modal-overlay');
      const close = function (v) { overlay.remove(); resolve(v); };
      const box = el('div.sd-modal', null, [
        el('h3', { text: opts.title || 'Are you sure?' }),
        opts.body ? el('p.muted', { text: opts.body }) : null,
        el('div.row', { style: { marginTop: '20px', justifyContent: 'flex-end' } }, [
          el('button.btn.btn-ghost', { onclick: function () { close(false); }, text: opts.cancel || 'Cancel' }),
          el('button.btn' + (opts.danger ? '.btn-danger' : '.btn-primary'), { onclick: function () { close(true); }, text: opts.ok || 'Confirm' })
        ])
      ]);
      overlay.appendChild(box);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) close(false); });
      document.body.appendChild(overlay);
    });
  }

  function fmtTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  window.SD = window.SD || {};
  window.SD.ui = { $: $, $$: $$, el: el, esc: esc, clear: clear, fmtNum: fmtNum, toast: toast, confirmDialog: confirmDialog, fmtTime: fmtTime };
})();
