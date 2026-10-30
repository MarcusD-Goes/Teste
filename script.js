/* Trilha Livre — mapa colaborativo de acessibilidade urbana
 * Módulos lógicos: dados · permissões · mapa · geolocalização · moderação · UI */
(() => {
  'use strict';

  /* ---------- Constantes ---------- */
  const STORE_KEY = 'trilhalivre:reports:v1';
  const ROLE_KEY = 'trilhalivre:role';
  const DEFAULT_CENTER = [-2.6283, -56.7358];
  const CATS = {
    calcada:    { label: 'Calçada ruim', icon: '🚧', color: '#7c3aed' },
    rampa:      { label: 'Rampa',        icon: '♿', color: '#2563eb' },
    iluminacao: { label: 'Iluminação',   icon: '💡', color: '#4f46e5' },
    obstaculo:  { label: 'Obstáculo',    icon: '⛔', color: '#9333ea' },
  };
  const SEV = { 1: 'Baixa', 2: 'Média', 3: 'Alta' };
  const STATUS = { pending: 'Em análise', approved: 'Publicada', rejected: 'Rejeitada' };

  /* ---------- Permissões (RBAC) ---------- */
  const PERMS = {
    visitor:     { label: 'Visitante',   submit: false, moderate: false },
    contributor: { label: 'Colaborador', submit: true,  moderate: false },
    moderator:   { label: 'Moderador',   submit: true,  moderate: true  },
  };
  let role = PERMS[localStorage.getItem(ROLE_KEY)] ? localStorage.getItem(ROLE_KEY) : 'visitor';
  const can = (action) => PERMS[role][action];

  /* ---------- Dados ---------- */
  const uid = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const seed = () => {
    const [la, ln] = DEFAULT_CENTER;
    const mk = (cat, dLa, dLn, sev, desc, status, own = false) => ({
      id: uid(), cat, lat: la + dLa, lng: ln + dLn, sev, desc, status, own, at: Date.now() - Math.random() * 6e8,
    });
    return [
      mk('calcada', .0012, -.0010, 3, 'Calçada com buracos e raízes expostas. Impossível passar de cadeira de rodas.', 'approved'),
      mk('rampa', -.0008, .0015, 2, 'Rampa de acesso com inclinação acima do recomendado e sem corrimão.', 'approved'),
      mk('iluminacao', .0004, .0020, 2, 'Três postes apagados no trecho; travessia fica sem visibilidade à noite.', 'approved'),
      mk('obstaculo', -.0016, -.0012, 3, 'Lixeira e bancas ocupam toda a largura da calçada.', 'approved'),
      mk('rampa', .0020, .0008, 1, 'Falta piso tátil na rampa da esquina.', 'pending'),
      mk('calcada', -.0004, -.0025, 2, 'Degrau alto entre a calçada e a faixa de pedestres.', 'pending'),
    ];
  };
  const load = () => {
    try { const d = JSON.parse(localStorage.getItem(STORE_KEY)); if (Array.isArray(d)) return d; } catch (_) {}
    const s = seed(); save(s); return s;
  };
  const save = (data) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (_) {} };
  let reports = load();
  const activeCats = new Set(Object.keys(CATS));

  /* Visibilidade: visitante vê só o aprovado; colaborador vê também as próprias; moderador vê tudo */
  const visible = (r) => role === 'moderator' || r.status === 'approved' || (role === 'contributor' && r.own && r.status !== 'rejected');

  /* ---------- Utilitários ---------- */
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (t) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  let toastTimer;
  const toast = (msg) => {
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  };

  /* ---------- Mapa ---------- */
  const map = L.map('map', { zoomControl: false, tap: true }).setView(DEFAULT_CENTER, 16);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© colaboradores do <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  const markers = new Map();

  const pinIcon = (r) => L.divIcon({
    className: '', iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -34],
    html: `<div class="pin ${r.status === 'pending' ? 'pending' : ''}" style="--c:${CATS[r.cat].color}"><span>${CATS[r.cat].icon}</span></div>`,
  });

  const popupHtml = (r) => `<h4>${CATS[r.cat].icon} ${esc(CATS[r.cat].label)}</h4>
    <div class="meta"><span class="tag s${r.sev}">${SEV[r.sev]}</span><span class="tag ${r.status}">${STATUS[r.status]}</span></div>
    <p style="margin:8px 0 0">${esc(r.desc)}</p>`;

  /* ---------- Geolocalização ---------- */
  let meMarker;
  const locate = (cb) => {
    if (!('geolocation' in navigator)) return toast('Seu navegador não oferece geolocalização.');
    toast('Buscando sua localização…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll = [pos.coords.latitude, pos.coords.longitude];
        if (meMarker) meMarker.setLatLng(ll);
        else meMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [18, 18] }), interactive: false, keyboard: false }).addTo(map);
        map.flyTo(ll, 17, { duration: .8 });
        cb && cb({ lat: ll[0], lng: ll[1] });
      },
      (err) => toast(err.code === 1
        ? 'Permissão de localização negada. Ative-a nas configurações do navegador ou toque no mapa.'
        : 'Não foi possível obter sua localização. Toque no mapa para marcar.'),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  };

  /* ---------- Renderização ---------- */
  const itemHtml = (r, withActions) => `
    <li class="item" style="--c:${CATS[r.cat].color}" data-id="${r.id}">
      <button class="open-item" type="button" data-focus="${r.id}">
        <h3>${CATS[r.cat].icon} ${esc(CATS[r.cat].label)}</h3>
        <div class="meta"><span class="tag s${r.sev}">${SEV[r.sev]}</span><span class="tag ${r.status}">${STATUS[r.status]}</span><span>${fmtDate(r.at)}</span></div>
        <p>${esc(r.desc)}</p>
      </button>
      ${withActions ? `<div class="actions">
        ${r.status !== 'approved' ? `<button class="btn btn-sm btn-ok" data-act="approve">Aprovar</button>` : ''}
        ${r.status !== 'rejected' ? `<button class="btn btn-sm btn-bad" data-act="reject">Rejeitar</button>` : ''}
        <button class="btn btn-sm btn-ghost-dark" data-act="delete">Excluir</button></div>` : ''}
    </li>`;

  function render() {
    const shown = reports.filter((r) => visible(r) && activeCats.has(r.cat));
    layer.clearLayers(); markers.clear();
    shown.forEach((r) => {
      const m = L.marker([r.lat, r.lng], { icon: pinIcon(r), title: CATS[r.cat].label, alt: CATS[r.cat].label }).bindPopup(popupHtml(r));
      m.addTo(layer); markers.set(r.id, m);
    });

    const list = shown.slice().sort((a, b) => b.at - a.at);
    $('#list').innerHTML = list.length ? list.map((r) => itemHtml(r, false)).join('')
      : '<li class="empty">Nenhuma ocorrência nesta seleção. Registre a primeira.</li>';

    const approved = reports.filter((r) => r.status === 'approved');
    const pending = reports.filter((r) => r.status === 'pending');
    $('#stats').innerHTML = `
      <div class="stat"><b>${approved.length}</b><span>publicadas</span></div>
      <div class="stat"><b>${approved.filter((r) => r.sev === 3).length}</b><span>gravidade alta</span></div>
      <div class="stat"><b>${pending.length}</b><span>em análise</span></div>`;
    $('#handleLabel').textContent = `Ocorrências (${list.length})`;

    const isMod = can('moderate');
    $('#modTab').hidden = !isMod;
    $('#modCount').textContent = pending.length;
    $('#modList').innerHTML = pending.length ? pending.map((r) => itemHtml(r, true)).join('')
      : '<li class="empty">Fila vazia. Nenhuma ocorrência aguardando análise.</li>';
    if (!isMod) setTab('list');
  }

  function setTab(name) {
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.tab === name; t.classList.toggle('is-active', on); t.setAttribute('aria-selected', on);
    });
    $('#list').hidden = name !== 'list'; $('#modList').hidden = name !== 'mod';
  }

  /* ---------- Filtros ---------- */
  $('#filters').innerHTML = Object.entries(CATS).map(([k, c]) =>
    `<button class="chip" type="button" aria-pressed="true" data-cat="${k}" style="--c:${c.color}"><i></i>${c.label}</button>`).join('');
  $('#filters').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    const k = b.dataset.cat, on = !activeCats.has(k);
    on ? activeCats.add(k) : activeCats.delete(k);
    b.setAttribute('aria-pressed', on); render();
  });

  /* ---------- Painel ---------- */
  const panel = $('#panel');
  $('#handle').addEventListener('click', () => {
    const open = panel.classList.toggle('open'); $('#handle').setAttribute('aria-expanded', open);
  });
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)));
  document.body.addEventListener('click', (e) => {
    const f = e.target.closest('[data-focus]');
    if (f) {
      const r = reports.find((x) => x.id === f.dataset.focus);
      if (!r) return;
      panel.classList.remove('open');
      map.flyTo([r.lat, r.lng], 18, { duration: .6 });
      map.once('moveend', () => (markers.get(r.id) || { openPopup() {} }).openPopup());
    }
    const a = e.target.closest('[data-act]');
    if (a) moderate(a.closest('.item').dataset.id, a.dataset.act);
  });

  /* ---------- Moderação ---------- */
  function moderate(id, action) {
    if (!can('moderate')) return toast('Apenas moderadores podem executar esta ação.');
    const i = reports.findIndex((r) => r.id === id); if (i < 0) return;
    if (action === 'approve') { reports[i].status = 'approved'; toast('Ocorrência publicada.'); }
    if (action === 'reject') { reports[i].status = 'rejected'; toast('Ocorrência rejeitada.'); }
    if (action === 'delete') { reports.splice(i, 1); toast('Ocorrência excluída.'); }
    save(reports); render();
  }

  /* ---------- Perfil ---------- */
  const roleSel = $('#roleSelect'); roleSel.value = role;
  roleSel.addEventListener('change', () => {
    role = roleSel.value; localStorage.setItem(ROLE_KEY, role);
    toast(`Perfil: ${PERMS[role].label}.`); render();
  });

  /* ---------- Fluxo de registro ---------- */
  const dlg = $('#reportDialog'), form = $('#reportForm');
  let draft = null, picking = false;

  $('#catGrid').innerHTML = Object.entries(CATS).map(([k, c], i) =>
    `<label><input type="radio" name="cat" value="${k}" ${i === 0 ? 'checked' : ''}><span>${c.icon} ${c.label}</span></label>`).join('');

  const setPicking = (on) => {
    picking = on; $('#pickBanner').hidden = !on; $('.map-wrap').classList.toggle('picking', on);
  };
  $('#addBtn').addEventListener('click', () => {
    if (!can('submit')) return toast('Entre como Colaborador para registrar ocorrências.');
    panel.classList.remove('open'); setPicking(true);
  });
  $('#pickCancel').addEventListener('click', () => setPicking(false));
  $('#pickGps').addEventListener('click', () => locate((ll) => openForm(ll)));
  $('#locateBtn').addEventListener('click', () => locate());
  map.on('click', (e) => { if (picking) openForm({ lat: e.latlng.lat, lng: e.latlng.lng }); });

  function openForm(ll) {
    draft = ll; setPicking(false); form.reset();
    $('#descHelp').textContent = 'Mínimo de 10 caracteres.'; $('#descHelp').classList.remove('err');
    $('#coords').textContent = `Local: ${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`;
    $('#notice').textContent = can('moderate')
      ? 'Como moderador, sua ocorrência é publicada imediatamente.'
      : 'Sua ocorrência será revisada por um moderador antes de aparecer para todos.';
    dlg.showModal();
  }
  const closeForm = () => dlg.close();
  $('#closeDialog').addEventListener('click', closeForm);
  $('#cancelForm').addEventListener('click', closeForm);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!can('submit') || !draft) return;
    const desc = $('#desc').value.trim().replace(/\s+/g, ' ');
    if (desc.length < 10) {
      const h = $('#descHelp'); h.textContent = 'Descreva o problema com pelo menos 10 caracteres.'; h.classList.add('err');
      return $('#desc').focus();
    }
    const data = new FormData(form);
    const rep = {
      id: uid(), cat: data.get('cat'), sev: Number(data.get('sev')), desc: desc.slice(0, 280),
      lat: draft.lat, lng: draft.lng, at: Date.now(), own: true,
      status: can('moderate') ? 'approved' : 'pending',
    };
    if (!CATS[rep.cat] || !SEV[rep.sev]) return;
    reports.push(rep); save(reports); closeForm(); render();
    toast(rep.status === 'approved' ? 'Ocorrência publicada.' : 'Enviada para análise. Obrigado por contribuir!');
  });

  /* ---------- Início ---------- */
  render();
  if ('geolocation' in navigator && navigator.permissions) {
    navigator.permissions.query({ name: 'geolocation' }).then((p) => { if (p.state === 'granted') locate(); }).catch(() => {});
  }
  setTimeout(() => map.invalidateSize(), 200);
})();