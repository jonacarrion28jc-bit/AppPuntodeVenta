/*************************************************************
 * POS LICORERIA VITYS CLARK - Frontend (GitHub Pages)
 *
 * Si algun dia vuelves a desplegar el Apps Script y te da una
 * URL nueva, cambiala UNICAMENTE en la linea API_URL de abajo.
 *************************************************************/

const API_URL = 'https://script.google.com/macros/s/AKfycbzKoIi0o60A8Nnz8UtABojLwrU9d542Tqy7THKjgTo_Vfhk-Kkivxj2UXq4qq8hpwfv/exec';

/* ============ ESTADO GLOBAL ============ */
let TOKEN = null;
let SESION = null;
let DATA = {};
let VISTA_ACTUAL = null;

/* =================================================================
   LLAMADAS A LA API
   Con reintento automatico: Apps Script redirige cada peticion a
   googleusercontent.com y ese salto falla de vez en cuando (404).
   Antes de rendirse lo intenta 3 veces.
   ================================================================= */
async function api(action, data, intentos) {
  intentos = (intentos === undefined) ? 3 : intentos;
  let ultimoError = null;

  for (let i = 0; i < intentos; i++) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: TOKEN, data: data || {} })
      });

      if (!res.ok) {
        // 404 / 5xx: fallo del salto de Google, vale la pena reintentar
        ultimoError = new Error('Servidor no disponible (' + res.status + ')');
        if (i < intentos - 1) { await espera(350 * (i + 1)); continue; }
        throw ultimoError;
      }

      const j = await res.json();
      if (!j.ok) {
        // Error de negocio: NO se reintenta, es una respuesta legitima
        if (j.error === 'SESION_EXPIRADA') {
          cerrarSesion(true);
          throw new Error('Tu sesión expiró. Entra de nuevo.');
        }
        throw new Error(j.error || 'Error desconocido');
      }
      return j.result;

    } catch (e) {
      // Errores de negocio y de sesion salen de inmediato
      if (e && e.message && (e.message.indexOf('sesión expiró') >= 0 ||
          (e.message.indexOf('Servidor no disponible') < 0 && e.name !== 'TypeError'))) {
        throw e;
      }
      ultimoError = e;
      if (i < intentos - 1) { await espera(350 * (i + 1)); continue; }
    }
  }
  throw ultimoError || new Error('No hay conexión con el servidor.');
}
function espera(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* =================================================================
   UTILIDADES
   ================================================================= */
const $ = (id) => document.getElementById(id);
function val(id) { const e = $(id); return e ? e.value : ''; }
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/** Normaliza texto: quita acentos y pasa a minusculas.
    Asi "jose" encuentra "José" y "limon" encuentra "Limón". */
function norm(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim();
}
/** Busca un texto dentro de otro ignorando acentos y mayusculas. */
function contiene(texto, busqueda) {
  return norm(texto).indexOf(norm(busqueda)) >= 0;
}
function money(n) {
  const m = (DATA.negocio ? DATA.negocio.moneda : 'C$');
  return m + ' ' + Number(n || 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* =================================================================
   SONIDO
   Los navegadores bloquean el audio hasta que el usuario toca algo.
   Lo desbloqueamos en el primer toque y reutilizamos el contexto.
   ================================================================= */
let AUDIO = null;
function desbloquearAudio() {
  try {
    if (!AUDIO) AUDIO = new (window.AudioContext || window.webkitAudioContext)();
    if (AUDIO.state === 'suspended') AUDIO.resume();
  } catch (e) {}
}
document.addEventListener('click', desbloquearAudio, { once: false });
document.addEventListener('touchstart', desbloquearAudio, { once: false });

function tono(freq, dur, vol) {
  try {
    desbloquearAudio();
    if (!AUDIO) return;
    const o = AUDIO.createOscillator(), g = AUDIO.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.22, AUDIO.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, AUDIO.currentTime + dur / 1000);
    o.connect(g); g.connect(AUDIO.destination);
    o.start(); o.stop(AUDIO.currentTime + dur / 1000);
  } catch (e) {}
}
/** Dos notas ascendentes: lectura correcta. */
function sonidoOk() { tono(1050, 90, 0.25); setTimeout(() => tono(1450, 110, 0.25), 85); }
/** Nota grave: producto no encontrado o error. */
function sonidoError() { tono(300, 220, 0.25); }
/** Nota corta neutra: repetido / ya estaba. */
function sonidoAviso() { tono(700, 80, 0.18); }
function vibrar(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 45); } catch (e) {} }

/* =================================================================
   AVISOS FLOTANTES (toasts) Y DIALOGOS
   Sustituyen los alert() y confirm() feos del navegador.
   ================================================================= */
function contenedorToast() {
  let c = $('toastWrap');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toastWrap'; c.className = 'toast-wrap';
    document.body.appendChild(c);
  }
  return c;
}
/** tipo: 'ok' | 'error' | 'info' */
function aviso(mensaje, tipo, ms) {
  const icono = tipo === 'ok' ? '&#10003;' : (tipo === 'error' ? '&#9888;' : '&#8505;');
  const t = document.createElement('div');
  t.className = 'toast toast-' + (tipo || 'info');
  t.innerHTML = '<span class="toast-ico">' + icono + '</span><span class="toast-txt">' + esc(mensaje) + '</span>';
  contenedorToast().appendChild(t);
  requestAnimationFrame(() => t.classList.add('entra'));
  setTimeout(() => {
    t.classList.remove('entra');
    setTimeout(() => t.remove(), 260);
  }, ms || 3200);
}

/** Dialogo de confirmacion con diseño propio. Devuelve una promesa. */
function preguntar(opciones) {
  const o = typeof opciones === 'string' ? { texto: opciones } : (opciones || {});
  return new Promise((resolve) => {
    const d = document.createElement('div');
    d.className = 'modal-bg dialogo-bg';
    d.innerHTML = '<div class="modal dialogo">'
      + '<div class="dlg-ico ' + (o.peligro ? 'peligro' : '') + '">' + (o.icono || (o.peligro ? '&#9888;' : '&#63;')) + '</div>'
      + '<h3>' + esc(o.titulo || '¿Confirmas?') + '</h3>'
      + (o.texto ? '<p class="dlg-txt">' + esc(o.texto) + '</p>' : '')
      + '<div class="modal-acts">'
      + '<button class="btn ghost" id="dlgNo">' + esc(o.cancelar || 'Cancelar') + '</button>'
      + '<button class="btn ' + (o.peligro ? 'danger-btn' : '') + '" id="dlgSi">' + esc(o.aceptar || 'Confirmar') + '</button>'
      + '</div></div>';
    document.body.appendChild(d);
    requestAnimationFrame(() => d.classList.add('entra'));
    const cerrar = (r) => {
      d.classList.remove('entra');
      setTimeout(() => d.remove(), 200);
      resolve(r);
    };
    d.querySelector('#dlgSi').addEventListener('click', () => cerrar(true));
    d.querySelector('#dlgNo').addEventListener('click', () => cerrar(false));
    d.addEventListener('click', (ev) => { if (ev.target === d) cerrar(false); });
    document.addEventListener('keydown', function onEsc(ev) {
      if (ev.key === 'Escape') { document.removeEventListener('keydown', onEsc); cerrar(false); }
    });
  });
}

function abrirModal(html) {
  const d = document.createElement('div');
  d.className = 'modal-bg';
  d.innerHTML = html;
  d.addEventListener('click', (ev) => { if (ev.target === d) d.remove(); });
  document.body.appendChild(d);
  requestAnimationFrame(() => d.classList.add('entra'));
  return d;
}
function cerrarModal() {
  const m = document.querySelector('.modal-bg:not(.scan-bg):not(.dialogo-bg)');
  if (m) { m.classList.remove('entra'); setTimeout(() => m.remove(), 180); }
}

/* =================================================================
   ARRANQUE
   ================================================================= */
window.addEventListener('load', async () => {
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js'); } catch (e) { console.warn('SW:', e); }
  }
  TOKEN = localStorage.getItem('pos_token');
  const sesGuardada = localStorage.getItem('pos_sesion');
  try { const m = localStorage.getItem('pos_marca'); if (m) DATA.marca = JSON.parse(m); } catch (e) {}
  try { const n = localStorage.getItem('pos_negocio'); if (n) DATA.negocio = JSON.parse(n); } catch (e) {}

  if (TOKEN && sesGuardada) {
    try {
      SESION = JSON.parse(sesGuardada);
      $('splash').style.display = 'none';
      iniciarApp();
      precargarTodo();
      return;
    } catch (e) {}
  }
  mostrarLogin();
});

function mostrarLogin() {
  $('splash').style.display = 'none';
  $('login').style.display = 'flex';
  $('app').style.display = 'none';
  if (DATA.marca) {
    if (DATA.marca.logo) $('loginLogo').innerHTML = '<img src="' + DATA.marca.logo + '" class="brand-logo-lg">';
    if (DATA.marca.nombre) { $('loginTitle').textContent = DATA.marca.nombre; document.title = DATA.marca.nombre; }
  }
  api('marca', {}, 2).then((m) => {
    DATA.marca = m;
    localStorage.setItem('pos_marca', JSON.stringify(m));
    if (m.logo) $('loginLogo').innerHTML = '<img src="' + m.logo + '" class="brand-logo-lg">';
    $('loginTitle').textContent = m.nombre; document.title = m.nombre;
  }).catch(() => {});
  $('logUser').focus();
}

$('btnLogin').addEventListener('click', hacerLogin);
$('logPin').addEventListener('keydown', (e) => { if (e.key === 'Enter') hacerLogin(); });
$('logUser').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('logPin').focus(); });

async function hacerLogin() {
  const msg = $('loginMsg');
  msg.innerHTML = '<span class="cargando">Verificando<span class="pts"></span></span>';
  $('btnLogin').disabled = true;
  try {
    const r = await api('login', { usuario: val('logUser'), pin: val('logPin') });
    TOKEN = r.token; SESION = r.sesion; DATA.marca = r.marca; DATA.negocio = r.negocio;
    if ($('logRecordar').checked) {
      localStorage.setItem('pos_token', TOKEN);
      localStorage.setItem('pos_sesion', JSON.stringify(SESION));
    }
    localStorage.setItem('pos_marca', JSON.stringify(r.marca));
    localStorage.setItem('pos_negocio', JSON.stringify(r.negocio));
    msg.innerHTML = '';
    $('logPin').value = '';
    iniciarApp();
    precargarTodo();
    aviso('Bienvenido, ' + SESION.Nombre.split(' ')[0], 'ok', 2600);
  } catch (e) {
    msg.innerHTML = '<span class="err">' + esc(e.message) + '</span>';
    sonidoError();
  } finally {
    $('btnLogin').disabled = false;
  }
}

/* Trae TODOS los datos en un solo viaje y los deja en memoria.
   Desde aqui, cambiar de pestaña es instantaneo: no se pide nada mas.
   Si falla, cada pestaña reintentara por su cuenta al abrirse. */
let PRECARGADO = false;
async function precargarTodo() {
  try {
    const d = await api('todo', {}, 4);
    Object.assign(DATA, d);
    PRECARGADO = true;
    // Redibuja la pestaña actual ya con datos (p.ej. el dashboard)
    if (VISTA_ACTUAL) { borrarVistaViva(VISTA_ACTUAL); abrirVista(VISTA_ACTUAL); }
  } catch (e) {
    // No pasa nada: cada pestaña cargara sus datos cuando se abra
    PRECARGADO = true;
  }
}

async function cerrarSesion(silencioso) {
  if (!silencioso) {
    const ok = await preguntar({
      titulo: 'Cerrar sesión',
      texto: 'Tendrás que ingresar tu usuario y PIN de nuevo para volver a entrar.',
      aceptar: 'Cerrar sesión', cancelar: 'Seguir aquí', peligro: true,
      icono: '&#128274;'
    });
    if (!ok) return;
  }
  TOKEN = null; SESION = null;
  DATA = { marca: DATA.marca, negocio: DATA.negocio };
  VISTA_ACTUAL = null;
  VISTA_HTML = {}; VISTA_SCROLL = {};
  localStorage.removeItem('pos_token');
  localStorage.removeItem('pos_sesion');
  cerrarScanner();
  mostrarLogin();
  if (!silencioso) aviso('Sesión cerrada', 'info', 2400);
}
$('btnSalir').addEventListener('click', () => cerrarSesion(false));

function iniciarApp() {
  $('login').style.display = 'none';
  $('app').style.display = 'block';
  $('userLabel').textContent = SESION.Nombre + ' (' + SESION.Rol + ')';
  aplicarMarcaHeader(DATA.marca || { nombre: 'POS', logo: '' });
  aplicarPermisos();
  const primero = document.querySelector('.nav-btn[data-view]:not([style*="none"])');
  if (primero) primero.click();
}
function aplicarMarcaHeader(m) {
  $('brand').innerHTML = (m.logo ? '<img src="' + m.logo + '" class="brand-logo">' : '')
    + '<span>' + esc(m.nombre || 'POS') + '</span>';
  if (m.nombre) document.title = m.nombre;
}
function aplicarPermisos() {
  const p = SESION.permisos || {};
  const map = { dashboard: p.Dashboard, ventas: p.Ventas, inventario: p.Inventario, compras: p.Compras, clientes: p.Clientes, admin: p.Admin_Usuarios };
  document.querySelectorAll('.nav-btn[data-view]').forEach((b) => {
    b.style.display = (map[b.dataset.view] === false) ? 'none' : '';
  });
}

/* =================================================================
   NAVEGACION CON CARGA POR MODULO
   Cada pantalla pide solo sus datos, y solo la primera vez.
   ================================================================= */
$('burger').addEventListener('click', () => $('navWrap').classList.toggle('open'));
document.querySelectorAll('.nav-btn[data-view]').forEach((b) => {
  b.addEventListener('click', () => {
    cerrarScanner();
    $('navWrap').classList.remove('open');
    document.querySelectorAll('.nav-btn[data-view]').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    abrirVista(b.dataset.view);
  });
});

/** Qué datos necesita cada pantalla y con qué accion se traen. */
const NECESITA = {
  dashboard:  { claves: ['dashboard'], accion: 'datosApp' },
  ventas:     { claves: ['catalogo', 'clientes'], accion: 'datosVentas' },
  inventario: { claves: ['inventario', 'categorias'], accion: 'datosInventario' },
  compras:    { claves: ['inventario', 'proveedores'], accion: 'datosCompras' },
  clientes:   { claves: ['clientes'], accion: 'datosVentas' },
  admin:      { claves: [], accion: null }
};

/* Vistas cuyo HTML se conserva tal cual entre cambios de pestaña.
   Ventas y Compras NO se guardan: siempre empiezan con carrito limpio.
   Admin tampoco: sus sub-pestañas se manejan aparte. */
const VISTAS_VIVAS = { dashboard: true, clientes: true };
let VISTA_HTML = {};   // html guardado de cada vista viva
let VISTA_SCROLL = {}; // posicion de scroll guardada

async function abrirVista(v) {
  // Guardar el estado de la vista que dejamos, si es "viva"
  if (VISTA_ACTUAL && VISTAS_VIVAS[VISTA_ACTUAL]) {
    VISTA_HTML[VISTA_ACTUAL] = $('content').innerHTML;
    VISTA_SCROLL[VISTA_ACTUAL] = window.scrollY;
  }
  VISTA_ACTUAL = v;
  const req = NECESITA[v];

  // Si la vista es viva y ya la teníamos construida, la restauramos tal cual:
  // nada de recargar, nada de parpadeo.
  if (VISTAS_VIVAS[v] && VISTA_HTML[v] !== undefined) {
    $('content').innerHTML = VISTA_HTML[v];
    reconectarVista(v);
    window.scrollTo(0, VISTA_SCROLL[v] || 0);
    return;
  }

  // Si el usuario NO tiene permiso para esta vista, mensaje claro y salir.
  const permisoDe = { dashboard: 'Dashboard', ventas: 'Ventas', inventario: 'Inventario', compras: 'Compras', clientes: 'Clientes', admin: 'Admin_Usuarios' };
  const pk = permisoDe[v];
  if (pk && SESION.permisos && SESION.permisos[pk] === false) {
    $('content').innerHTML = '<div class="placeholder"><div class="ph-ico">&#128274;</div>'
      + '<h2>Sin acceso</h2><p>Tu rol no tiene permiso para ver este módulo.</p></div>';
    return;
  }

  if (req && req.accion) {
    const falta = req.claves.some((k) => DATA[k] === undefined || DATA[k] === null);
    if (falta) {
      $('content').innerHTML = esqueleto(v);
      try {
        const d = await api(req.accion);
        Object.assign(DATA, d);
      } catch (e) {
        if (VISTA_ACTUAL !== v) return;
        $('content').innerHTML = pantallaError(e.message, v);
        return;
      }
      if (VISTA_ACTUAL !== v) return; // el usuario ya se fue a otra pantalla
    }
  }

  if (v === 'dashboard') renderDashboard();
  else if (v === 'ventas') renderVentas();
  else if (v === 'inventario') renderInventario();
  else if (v === 'compras') renderCompras();
  else if (v === 'clientes') renderClientes();
  else if (v === 'admin') renderAdmin();
}
function reintentarVista(v) { borrarVistaViva(v); abrirVista(v); }

/* Cuando una vista cambió (por una venta, compra, etc.) su HTML guardado
   deja de ser valido: lo borramos para que se reconstruya al volver. */
function borrarVistaViva(v) { delete VISTA_HTML[v]; delete VISTA_SCROLL[v]; }

/* Al restaurar el HTML guardado, los botones perdieron sus eventos
   (el navegador no guarda los listeners). Los reconectamos. */
function reconectarVista(v) {
  if (v === 'clientes') {
    renderClientes();
  } else if (v === 'dashboard') {
    const r = $('btnRefDash'); if (r) r.addEventListener('click', refrescarDashboard);
    const rep = $('btnReporte'); if (rep) rep.addEventListener('click', descargarReporteVentas);
  }
}

function pantallaError(mensaje, vista) {
  return '<div class="placeholder"><div class="ph-ico">&#9888;</div>'
    + '<h2>No se pudieron cargar los datos</h2>'
    + '<p>' + esc(mensaje) + '</p>'
    + '<button class="btn" onclick="reintentarVista(\'' + vista + '\')">&#128260; Reintentar</button></div>';
}
function esqueleto(v) {
  if (v === 'ventas' || v === 'compras') {
    return '<div class="skel-wrap"><div class="skel-grid2">'
      + '<div class="skel-panel alto"></div><div class="skel-panel alto"></div>'
      + '</div><p class="skel-txt">Cargando<span class="pts"></span></p></div>';
  }
  if (v === 'inventario' || v === 'clientes') {
    return '<div class="skel-wrap"><div class="skel-panel alto"></div>'
      + '<p class="skel-txt">Cargando<span class="pts"></span></p></div>';
  }
  return '<div class="skel-wrap"><div class="skel-grid">'
    + '<div class="skel-card"></div><div class="skel-card"></div><div class="skel-card"></div><div class="skel-card"></div>'
    + '</div><div class="skel-grid2"><div class="skel-panel"></div><div class="skel-panel"></div></div>'
    + '<p class="skel-txt">Cargando<span class="pts"></span></p></div>';
}

/* =================================================================
   LECTOR DE CODIGOS DE BARRAS
   Lector nativo del navegador (BarcodeDetector) si existe, que es
   mucho mas rapido y preciso con EAN/UPC; si no, html5-qrcode.
   ================================================================= */
const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'qr_code'];
let SCAN = { activo: false, stream: null, detector: null, timer: null, cb: null, continuo: false, ultimo: '', t: 0, h5: null, contador: 0, historial: [] };

async function abrirScanner(callback, continuo) {
  cerrarScanner();
  desbloquearAudio();
  SCAN.cb = callback; SCAN.continuo = !!continuo;
  SCAN.ultimo = ''; SCAN.t = 0; SCAN.contador = 0; SCAN.historial = [];

  const d = document.createElement('div');
  d.className = 'modal-bg scan-bg';
  d.innerHTML =
    '<div class="modal scan-modal">'
    + '<div class="scan-head"><h3>&#128247; Escanear código</h3>'
    + '<span class="scan-cont" id="scanCont">' + (continuo ? '0 leídos' : '') + '</span></div>'
    + '<div class="scan-box" id="scanBox">'
    + '  <video id="scanVideo" playsinline muted></video>'
    + '  <div id="scanFallback" class="scan-fallback" style="display:none"></div>'
    + '  <div class="scan-mira"><span></span></div>'
    + '  <div class="scan-flash" id="scanFlash"></div>'
    + '</div>'
    + '<div id="scanEstado" class="scan-estado">Iniciando cámara<span class="pts"></span></div>'
    + '<div id="scanHist" class="scan-hist"></div>'
    + '<label class="lbl">O usa la pistola / escribe el código</label>'
    + '<input id="scanManual" class="inp" placeholder="Código + Enter" autocomplete="off" inputmode="numeric">'
    + '<div class="modal-acts"><button class="btn ghost" id="scanCerrar">Cerrar</button></div>'
    + '</div>';
  document.body.appendChild(d);
  requestAnimationFrame(() => d.classList.add('entra'));

  $('scanCerrar').addEventListener('click', cerrarScanner);
  const mi = $('scanManual');
  mi.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const v = mi.value.trim(); mi.value = '';
      if (v) entregarScan(v);
    }
  });
  if (!/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) mi.focus();

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    sinCamara('Este navegador no permite usar la cámara. Usa el campo de texto.');
    return;
  }
  try {
    SCAN.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
  } catch (err) {
    let m = 'No se pudo abrir la cámara.';
    if (err && err.name === 'NotAllowedError') m = 'Permiso de cámara denegado. Actívalo en los ajustes del navegador.';
    else if (err && err.name === 'NotFoundError') m = 'No se encontró ninguna cámara en este dispositivo.';
    sinCamara(m);
    return;
  }

  const video = $('scanVideo');
  video.srcObject = SCAN.stream;
  try { await video.play(); } catch (e) {}
  SCAN.activo = true;

  if ('BarcodeDetector' in window) {
    let formatos = FORMATOS;
    try {
      const soportados = await window.BarcodeDetector.getSupportedFormats();
      formatos = FORMATOS.filter((f) => soportados.indexOf(f) >= 0);
      if (!formatos.length) formatos = soportados;
    } catch (e) {}
    SCAN.detector = new window.BarcodeDetector({ formats: formatos });
    $('scanEstado').innerHTML = '<span class="ok">Listo &mdash; apunta al código de barras</span>';
    bucleNativo(video);
  } else {
    $('scanEstado').innerHTML = '<span class="ok">Listo &mdash; apunta al código de barras</span>';
    usarRespaldo();
  }
}

function bucleNativo(video) {
  const tick = async () => {
    if (!SCAN.activo || !SCAN.detector) return;
    try {
      if (video.readyState >= 2) {
        const codigos = await SCAN.detector.detect(video);
        if (codigos && codigos.length) {
          const txt = String(codigos[0].rawValue || '').trim();
          if (txt) entregarScan(txt);
        }
      }
    } catch (e) {}
    if (SCAN.activo) SCAN.timer = setTimeout(tick, 110);
  };
  tick();
}

function usarRespaldo() {
  pararStream();
  const v = $('scanVideo'); if (v) v.style.display = 'none';
  const fb = $('scanFallback'); if (fb) fb.style.display = 'block';
  if (typeof Html5Qrcode === 'undefined') {
    sinCamara('No se pudo cargar el lector. Usa el campo de texto.');
    return;
  }
  try {
    const cfg = { fps: 10, qrbox: { width: 250, height: 160 } };
    if (typeof Html5QrcodeSupportedFormats !== 'undefined') {
      cfg.formatsToSupport = [
        Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.ITF, Html5QrcodeSupportedFormats.QR_CODE
      ];
    }
    cfg.experimentalFeatures = { useBarCodeDetectorIfSupported: true };
    SCAN.h5 = new Html5Qrcode('scanFallback', { verbose: false });
    SCAN.activo = true;
    SCAN.h5.start({ facingMode: 'environment' }, cfg,
      (txt) => entregarScan(String(txt).trim()), () => {})
      .catch(() => sinCamara('No se pudo abrir la cámara. Usa el campo de texto.'));
  } catch (e) {
    sinCamara('No se pudo abrir la cámara. Usa el campo de texto.');
  }
}

function sinCamara(mensaje) {
  SCAN.activo = false;
  const v = $('scanVideo'); if (v) v.style.display = 'none';
  const m = document.querySelector('.scan-mira'); if (m) m.style.display = 'none';
  const b = $('scanBox'); if (b) b.classList.add('sin-camara');
  const e = $('scanEstado'); if (e) e.innerHTML = '<span class="err">' + esc(mensaje) + '</span>';
  const mi = $('scanManual'); if (mi) mi.focus();
}

/** Destello verde sobre la cámara: confirmacion visual de la lectura. */
function destello() {
  const f = $('scanFlash');
  if (!f) return;
  f.classList.remove('activo');
  void f.offsetWidth;
  f.classList.add('activo');
}

function entregarScan(texto) {
  const ahora = Date.now();
  if (texto === SCAN.ultimo && (ahora - SCAN.t) < 1800) return;
  SCAN.ultimo = texto; SCAN.t = ahora;

  sonidoOk(); vibrar(50); destello();
  SCAN.contador++;

  const c = $('scanCont');
  if (c && SCAN.continuo) c.textContent = SCAN.contador + (SCAN.contador === 1 ? ' leído' : ' leídos');

  const cb = SCAN.cb;
  if (SCAN.continuo) {
    if (cb) cb(texto);
  } else {
    cerrarScanner();
    if (cb) cb(texto);
  }
}

/** Añade una linea al historial visible dentro del escáner. */
function scanHistorial(texto, tipo) {
  const h = $('scanHist');
  if (!h) return;
  SCAN.historial.unshift({ texto, tipo });
  SCAN.historial = SCAN.historial.slice(0, 4);
  h.innerHTML = SCAN.historial.map((x) =>
    '<div class="sh-row ' + x.tipo + '">'
    + '<span class="sh-ico">' + (x.tipo === 'ok' ? '&#10003;' : '&#9888;') + '</span>'
    + esc(x.texto) + '</div>'
  ).join('');
}

function pararStream() {
  if (SCAN.stream) { try { SCAN.stream.getTracks().forEach((t) => t.stop()); } catch (e) {} SCAN.stream = null; }
}
function cerrarScanner() {
  SCAN.activo = false;
  if (SCAN.timer) { clearTimeout(SCAN.timer); SCAN.timer = null; }
  pararStream();
  if (SCAN.h5) { try { SCAN.h5.stop().then(() => { try { SCAN.h5.clear(); } catch (e) {} }).catch(() => {}); } catch (e) {} SCAN.h5 = null; }
  SCAN.detector = null; SCAN.cb = null; SCAN.continuo = false;
  const d = document.querySelector('.scan-bg');
  if (d) { d.classList.remove('entra'); setTimeout(() => d.remove(), 180); }
}

/* =================================================================
   DASHBOARD
   ================================================================= */
function renderDashboard() {
  if (!DATA.dashboard) { $('content').innerHTML = pantallaError('No se pudieron cargar los datos del panel.', 'dashboard'); return; }
  pintarDashboard(DATA.dashboard);
}
async function refrescarDashboard() {
  const btn = $('btnRefDash');
  if (btn) { btn.disabled = true; btn.innerHTML = '&#128260; Actualizando...'; }
  try {
    DATA.dashboard = await api('dashboard');
    pintarDashboard(DATA.dashboard);
    VISTA_HTML['dashboard'] = $('content').innerHTML;
    aviso('Datos actualizados', 'ok', 2000);
  } catch (e) {
    aviso(e.message, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '&#128260; Actualizar'; }
  }
}
function pintarDashboard(d) {
  const kpis = kpi('&#128181;', 'Ventas de hoy', money(d.ventasDia), d.nDia + ' ventas')
    + kpi('&#128197;', 'Ventas del mes', money(d.ventasMes), d.nMes + ' ventas')
    + kpi('&#9888;', 'Alertas de vencimiento', d.alertasCount, 'lotes por atender', d.alertasCount > 0 ? 'warn' : '')
    + kpi('&#128230;', 'Productos', d.totalProductos, 'en catálogo');

  const alertas = d.porVencer.length ? d.porVencer.map((v) => {
    const cls = v.estado === 'vencido' ? 'vencido' : 'alerta';
    const txt = v.estado === 'vencido' ? ('Vencido hace ' + Math.abs(v.dias) + ' d') : ('Vence en ' + v.dias + ' d');
    return '<tr class="row-' + cls + '"><td>' + esc(v.producto) + '<div class="sub-sm">' + v.lote + ' &middot; ' + v.vence + '</div></td>'
      + '<td class="hide-sm">' + v.lote + '</td><td class="tc">' + v.stock + '</td>'
      + '<td class="tc hide-sm">' + v.vence + '</td><td class="tc"><span class="tag ' + cls + '">' + txt + '</span></td></tr>';
  }).join('') : '<tr><td colspan="5" class="empty">Sin alertas</td></tr>';

  const stock = d.pocoStock.length ? d.pocoStock.map((s) =>
    '<tr><td>' + esc(s.nombre) + '</td><td class="tc">' + s.stock + '</td><td class="tc">' + s.minimo + '</td></tr>'
  ).join('') : '<tr><td colspan="3" class="empty">Todo con stock suficiente</td></tr>';

  const barrasTop = (lista, color) => {
    if (!lista || !lista.length) return '<p class="empty">Sin datos</p>';
    const max = Math.max.apply(null, lista.map((x) => x.cantidad).concat([1]));
    return lista.map((v, i) => {
      const pct = Math.max(3, Math.round(v.cantidad / max * 100));
      return '<div class="bar-row"><span class="bar-rank">' + (i + 1) + '</span>'
        + '<span class="bar-lbl">' + esc(v.producto) + '</span>'
        + '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>'
        + '<span class="bar-val">' + v.cantidad + '</span></div>';
    }).join('');
  };
  const topMas = barrasTop(d.masVendidos, 'linear-gradient(90deg,#2ea86a,#4ad395)');

  // Menos vendidos: tabla ranking. Mas claro para detectar productos estancados.
  const topMenos = (d.menosVendidos && d.menosVendidos.length) ? d.menosVendidos.map((v, i) => {
    const cero = v.cantidad === 0;
    const badge = cero
      ? '<span class="v-badge vencido">Sin ventas</span>'
      : '<span class="v-badge alerta">' + v.cantidad + '</span>';
    return '<tr><td class="tc"><span class="rank-num">' + (i + 1) + '</span></td>'
      + '<td>' + esc(v.producto) + '</td><td class="tc">' + badge + '</td></tr>';
  }).join('') : '<tr><td colspan="3" class="empty">Sin datos</td></tr>';

  const vendedores = d.vendedores.length ? d.vendedores.map((v) =>
    '<tr><td>' + esc(v.vendedor) + '</td><td class="tc">' + v.ventas + '</td><td class="tc">' + money(v.total) + '</td></tr>'
  ).join('') : '<tr><td colspan="3" class="empty">Sin ventas este mes</td></tr>';

  const maxM = Math.max.apply(null, d.mensual.map((x) => x.total).concat([1]));
  const bw = 46, gap = 22, chartH = 150;
  const barras = d.mensual.map((m, i) => {
    const h = Math.round(m.total / maxM * (chartH - 20)), x = i * (bw + gap) + 10, y = chartH - h;
    return '<g><rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + h + '" rx="5" fill="#3d5af1"></rect>'
      + '<text x="' + (x + bw / 2) + '" y="' + (chartH + 16) + '" text-anchor="middle" fill="#8b96b0" font-size="12">' + m.etiqueta + '</text>'
      + '<text x="' + (x + bw / 2) + '" y="' + (y - 6) + '" text-anchor="middle" fill="#b9c2d6" font-size="10">' + (m.total > 0 ? Math.round(m.total) : '') + '</text></g>';
  }).join('');
  const w = d.mensual.length * (bw + gap) + 10;

  $('content').innerHTML = '<div class="dash">'
    + '<div class="dash-head">'
    + '  <button class="btn ghost" id="btnReporte" onclick="descargarReporteVentas()">&#128202; Reporte Excel</button>'
    + '  <button class="btn ghost" id="btnRefDash" onclick="refrescarDashboard()">&#128260; Actualizar</button>'
    + '</div>'
    + '<div class="kpi-grid">' + kpis + '</div>'
    + '<div class="grid-2">'
    + panel('&#9888; Próximos a vencer / vencidos', '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Producto</th><th class="hide-sm">Lote</th><th class="tc">Stock</th><th class="tc hide-sm">Vence</th><th class="tc">Estado</th></tr></thead><tbody>' + alertas + '</tbody></table></div>')
    + panel('&#128201; Poco stock', '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Producto</th><th class="tc">Stock</th><th class="tc">Mínimo</th></tr></thead><tbody>' + stock + '</tbody></table></div>')
    + '</div><div class="grid-1">'
    + panel('&#128200; Ventas (6 meses)', '<div class="chart-wrap"><svg viewBox="0 0 ' + w + ' ' + (chartH + 26) + '" width="100%" height="190">' + barras + '</svg></div>')
    + '</div><div class="grid-2">'
    + panel('&#127942; Top 15 más vendidos', '<div class="bars bars-top">' + topMas + '</div>')
    + panel('&#128203; Top 15 menos vendidos', '<div class="tbl-wrap"><table class="tbl tbl-rank"><thead><tr><th class="tc">#</th><th>Producto</th><th class="tc">Vendidos</th></tr></thead><tbody>' + topMenos + '</tbody></table></div>')
    + '</div><div class="grid-1">'
    + panel('&#128101; Ventas por vendedor (mes)', '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Vendedor</th><th class="tc">Ventas</th><th class="tc">Total</th></tr></thead><tbody>' + vendedores + '</tbody></table></div>')
    + '</div></div>';
}
/* =================================================================
   REPORTE EXCEL: productos vendidos y no vendidos
   Genera un .xlsx real en el navegador con SheetJS (carga bajo demanda).
   ================================================================= */
async function cargarSheetJS() {
  if (window.XLSX) return window.XLSX;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
  return window.XLSX;
}
async function descargarReporteVentas() {
  const btn = $('btnReporte');
  if (btn) { btn.disabled = true; btn.innerHTML = '&#128202; Generando...'; }
  try {
    const XLSX = await cargarSheetJS();
    const rep = await api('reporteVentas');
    const moneda = rep.moneda || 'C$';

    // Encabezados + filas
    const datos = [['Código', 'Producto', 'Categoría', 'Cantidad vendida', 'Monto (' + moneda + ')']];
    let totalCant = 0, totalMonto = 0;
    rep.filas.forEach((f) => {
      datos.push([f.codigo || '', f.producto, f.categoria || '', f.cantidad, Number(f.monto.toFixed(2))]);
      totalCant += f.cantidad; totalMonto += f.monto;
    });
    datos.push([]); // fila en blanco
    datos.push(['', '', 'TOTAL', totalCant, Number(totalMonto.toFixed(2))]);

    const ws = XLSX.utils.aoa_to_sheet(datos);
    ws['!cols'] = [{ wch: 16 }, { wch: 34 }, { wch: 18 }, { wch: 16 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Productos vendidos');

    const hoy = new Date();
    const nombre = 'Reporte_Ventas_' + hoy.getFullYear()
      + String(hoy.getMonth() + 1).padStart(2, '0')
      + String(hoy.getDate()).padStart(2, '0') + '.xlsx';
    XLSX.writeFile(wb, nombre);
    aviso('Reporte descargado: ' + rep.filas.length + ' productos', 'ok', 3200);
  } catch (e) {
    aviso('No se pudo generar el reporte: ' + e.message, 'error', 4200);
    sonidoError();
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '&#128202; Reporte Excel'; }
  }
}

function kpi(i, t, v, s, e) {
  return '<div class="kpi ' + (e || '') + '"><div class="kpi-ico">' + i + '</div><div class="kpi-body">'
    + '<div class="kpi-val">' + v + '</div><div class="kpi-tit">' + t + '</div><div class="kpi-sub">' + s + '</div></div></div>';
}
function panel(t, c) { return '<div class="panel"><div class="panel-tit">' + t + '</div><div class="panel-body">' + c + '</div></div>'; }

/* =================================================================
   VENTAS
   ================================================================= */
let CARRITO = [];
function renderVentas() {
  if (!DATA.catalogo) { $('content').innerHTML = pantallaError('No se pudo cargar el catálogo.', 'ventas'); return; }
  CARRITO = [];
  $('content').innerHTML = '<div class="pos">'
    + '<div class="pos-left">'
    + '  <div class="pos-scan">'
    + '    <input id="scanInput" class="inp scan-inp" placeholder="Pistola USB: código + Enter" autocomplete="off">'
    + '    <button class="btn btn-scan" id="btnScanVenta">&#128247; Escanear</button>'
    + '  </div>'
    + '  <input id="buscarProd" class="inp" placeholder="Buscar producto por nombre..." autocomplete="off">'
    + '  <div id="listaProd" class="prod-grid"></div>'
    + '</div>'
    + '<div class="pos-right">'
    + '  <h3>&#128722; Venta actual</h3>'
    + '  <div id="carrito" class="carrito"></div>'
    + '  <div class="pos-total"><span>Total</span><span id="totalTxt">' + money(0) + '</span></div>'
    + '  <label class="lbl">Cliente</label>'
    + '  <div class="cli-search"><input id="cliBuscar" class="inp" placeholder="Buscar cliente (opcional)" autocomplete="off"><div id="cliLista" class="cli-drop"></div></div>'
    + '  <input type="hidden" id="cliId" value="">'
    + '  <label class="lbl">Método de pago</label>'
    + '  <select id="selPago" class="inp"><option>Efectivo</option><option>Tarjeta</option><option>Billetera Movil</option></select>'
    + '  <div id="ventaMsg" class="msg"></div>'
    + '  <button class="btn btn-block" id="btnCobrar">&#128181; Cobrar</button>'
    + '</div></div>';

  $('buscarProd').addEventListener('input', (e) => filtrarProd(e.target.value));
  $('cliBuscar').addEventListener('input', (e) => filtrarClientes(e.target.value));
  $('btnScanVenta').addEventListener('click', () => abrirScanner((t) => escaneoVenta(t), true));
  $('btnCobrar').addEventListener('click', cobrar);
  const si = $('scanInput');
  si.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); escaneoVenta(si.value); si.value = ''; }
  });
  filtrarProd(''); pintarCarrito();
  if (!/Android|iPhone|iPad/i.test(navigator.userAgent)) si.focus();
}
function filtrarProd(q) {
  const lista = DATA.catalogo.filter((p) =>
    !q || contiene(p.nombre, q) || (p.codigo && p.codigo.indexOf(q.trim()) >= 0)
  ).slice(0, 40);
  $('listaProd').innerHTML = lista.map((p) => {
    const sin = p.controla && p.stock <= 0;
    return '<div class="prod-card ' + (sin ? 'off' : '') + '" ' + (sin ? '' : 'onclick="agregar(\'' + p.id + '\')"') + '>'
      + '<div class="prod-nom">' + esc(p.nombre) + '</div>'
      + '<div class="prod-meta">' + money(p.precio) + (p.controla ? (' &middot; stock ' + p.stock) : '') + '</div></div>';
  }).join('') || '<p class="empty">Sin coincidencias</p>';
}
/** Busca en memoria primero: instantaneo, sin viajar al servidor. */
function buscarLocal(lista, texto) {
  const t = String(texto || '').trim();
  if (!t || !lista) return null;
  return lista.filter((p) => p.codigo === t || String(p.id).toLowerCase() === t.toLowerCase())[0] || null;
}
function escaneoVenta(t) {
  t = String(t || '').trim();
  if (!t) return;
  const local = buscarLocal(DATA.catalogo, t);
  if (local) {
    agregarObj(local);
    scanHistorial(local.nombre, 'ok');
    return;
  }
  // No esta en memoria: preguntamos al servidor
  scanHistorial('Buscando ' + t + '...', 'ok');
  api('buscarProducto', { texto: t })
    .then((p) => { agregarObj(p); scanHistorial(p.nombre, 'ok'); })
    .catch(() => {
      sonidoError();
      scanHistorial('No existe: ' + t, 'err');
      aviso('No se encontró el producto con código ' + t, 'error');
    });
}
function filtrarClientes(q) {
  const drop = $('cliLista');
  if (!q) { drop.innerHTML = ''; drop.style.display = 'none'; $('cliId').value = ''; return; }
  const lista = (DATA.clientes || []).filter((c) => contiene(c.nombre, q)).slice(0, 8);
  drop.innerHTML = lista.map((c) =>
    '<div class="cli-item" onclick="elegirCliente(\'' + c.id + '\',\'' + String(c.nombre).replace(/'/g, "\\'") + '\')">' + esc(c.nombre) + '</div>'
  ).join('') || '<div class="cli-item muted">Sin coincidencias</div>';
  drop.style.display = 'block';
}
function elegirCliente(id, nombre) {
  $('cliId').value = id; $('cliBuscar').value = nombre; $('cliLista').style.display = 'none';
}
function agregar(id) { const p = DATA.catalogo.filter((x) => x.id === id)[0]; if (p) agregarObj(p); }
function agregarObj(p) {
  const l = CARRITO.filter((x) => x.id === p.id)[0];
  if (l) {
    if (p.controla && l.cantidad + 1 > p.stock) {
      sonidoAviso();
      aviso('Sin stock suficiente de ' + p.nombre + ' (máximo ' + p.stock + ')', 'error');
      return;
    }
    l.cantidad++;
  } else {
    if (p.controla && p.stock <= 0) {
      sonidoAviso();
      aviso('Sin stock de ' + p.nombre, 'error');
      return;
    }
    CARRITO.push({ id: p.id, nombre: p.nombre, precio: p.precio, cantidad: 1, controla: p.controla, stock: p.stock });
  }
  pintarCarrito();
}
function cambiarCant(id, d) {
  const l = CARRITO.filter((x) => x.id === id)[0]; if (!l) return;
  l.cantidad += d;
  if (l.cantidad <= 0) CARRITO = CARRITO.filter((x) => x.id !== id);
  else if (l.controla && l.cantidad > l.stock) {
    l.cantidad = l.stock;
    aviso('Máximo en stock: ' + l.stock, 'error', 2400);
  }
  pintarCarrito();
}
function quitar(id) { CARRITO = CARRITO.filter((x) => x.id !== id); pintarCarrito(); }
function pintarCarrito() {
  const c = $('carrito'); if (!c) return;
  if (!CARRITO.length) {
    c.innerHTML = '<p class="empty">Carrito vacío</p>';
    $('totalTxt').textContent = money(0);
    return;
  }
  let total = 0;
  c.innerHTML = CARRITO.map((l) => {
    const sub = l.precio * l.cantidad; total += sub;
    return '<div class="cart-row"><div class="cart-nom">' + esc(l.nombre) + '<br><span class="muted">' + money(l.precio) + '</span></div>'
      + '<div class="cart-qty"><button onclick="cambiarCant(\'' + l.id + '\',-1)">&minus;</button><span>' + l.cantidad + '</span><button onclick="cambiarCant(\'' + l.id + '\',1)">+</button></div>'
      + '<div class="cart-sub">' + money(sub) + '</div>'
      + '<button class="cart-x" onclick="quitar(\'' + l.id + '\')">&#10005;</button></div>';
  }).join('');
  $('totalTxt').textContent = money(total);
}
async function cobrar() {
  if (!CARRITO.length) { aviso('El carrito está vacío', 'error'); return; }
  cerrarScanner();
  const btn = $('btnCobrar'); btn.disabled = true;
  const msg = $('ventaMsg'); msg.innerHTML = '<span class="cargando">Procesando venta<span class="pts"></span></span>';
  try {
    const r = await api('registrarVenta', {
      ID_Cliente: val('cliId'), Metodo_Pago: val('selPago'),
      items: CARRITO.map((l) => ({ id: l.id, cantidad: l.cantidad, precio: l.precio }))
    });
    msg.innerHTML = '';
    sonidoOk();
    aviso('Venta ' + r.idVenta + ' registrada — ' + money(r.total), 'ok', 3800);
    mostrarTicket(r.ticket);
    CARRITO = []; pintarCarrito();
    $('cliBuscar').value = ''; $('cliId').value = '';
    // El stock cambio: refrescamos en segundo plano
    api('catalogo').then((c) => {
      DATA.catalogo = c;
      const b = $('buscarProd');
      if (b) filtrarProd(b.value);
    }).catch(() => {});
    DATA.dashboard = null; DATA.inventario = null;
    borrarVistaViva('dashboard');
  } catch (e) {
    msg.innerHTML = '<span class="err">' + esc(e.message) + '</span>';
    sonidoError();
  } finally { btn.disabled = false; }
}

/* ---- TICKET 80mm ---- */
function mostrarTicket(t) {
  const neg = DATA.negocio || {};
  const filas = t.items.map((it) =>
    '<tr><td>' + it.cantidad + 'x ' + esc(it.nombre) + '</td><td style="text-align:right">' + money(it.subtotal) + '</td></tr>'
  ).join('');
  const logo = (DATA.marca && DATA.marca.logo) ? '<img src="' + DATA.marca.logo + '" class="tk-logo">' : '';
  abrirModal('<div class="modal ticket-modal">'
    + '<div id="ticketArea" class="ticket">'
    + '<div style="text-align:center">' + logo + '<div class="tk-nom">' + esc(neg.nombre || '') + '</div>'
    + (neg.ruc ? '<div class="tk-line">RUC: ' + esc(neg.ruc) + '</div>' : '')
    + (neg.direccion ? '<div class="tk-line">' + esc(neg.direccion) + '</div>' : '')
    + (neg.telefono ? '<div class="tk-line">Tel: ' + esc(neg.telefono) + '</div>' : '')
    + '</div><div class="tk-sep"></div>'
    + '<div class="tk-line">Ticket: ' + t.idVenta + '</div>'
    + '<div class="tk-line">Fecha: ' + t.fecha + '</div>'
    + '<div class="tk-line">Cliente: ' + esc(t.cliente) + '</div>'
    + '<div class="tk-line">Vendedor: ' + esc(t.vendedor) + '</div>'
    + '<div class="tk-line">Pago: ' + esc(t.metodo) + '</div>'
    + '<div class="tk-sep"></div><table class="tk-tbl">' + filas + '</table><div class="tk-sep"></div>'
    + '<div class="tk-total"><span>TOTAL</span><span>' + money(t.total) + '</span></div><div class="tk-sep"></div>'
    + '<div style="text-align:center" class="tk-msg">' + esc(neg.mensaje || 'Gracias por su compra') + '</div>'
    + '</div>'
    + '<div class="modal-acts"><button class="btn ghost" onclick="cerrarModal()">Cerrar</button>'
    + '<button class="btn" onclick="imprimirTicket()">&#128424; Imprimir</button></div></div>');
}
function imprimirTicket() {
  const contenido = $('ticketArea').innerHTML;
  const w = window.open('', '_blank', 'width=340,height=620');
  w.document.write('<html><head><title>Ticket</title><style>'
    + 'body{font-family:monospace;font-size:12px;width:80mm;margin:0;padding:6px;color:#000}'
    + '.tk-nom{font-size:15px;font-weight:bold}.tk-line{font-size:11px;margin:1px 0}'
    + '.tk-sep{border-top:1px dashed #000;margin:6px 0}.tk-tbl{width:100%;border-collapse:collapse;font-size:11px}'
    + '.tk-tbl td{padding:1px 0}.tk-total{display:flex;justify-content:space-between;font-weight:bold;font-size:13px}'
    + '.tk-msg{margin-top:8px;font-size:11px}.tk-logo{max-width:110px;max-height:56px;margin-bottom:5px}'
    + '</style></head><body>' + contenido + '</body></html>');
  w.document.close(); w.focus();
  setTimeout(() => w.print(), 320);
}

/* =================================================================
   INVENTARIO
   ================================================================= */
let INV_FILTRO = 'todos'; // todos | vencido | alerta | bajo
function renderInventario() {
  if (!DATA.inventario) { $('content').innerHTML = pantallaError('No se pudo cargar el inventario.', 'inventario'); return; }
  INV_FILTRO = 'todos';

  // Contadores para las pastillas de filtro
  const activos = DATA.inventario.filter((p) => String(p.estado).toLowerCase() !== 'descontinuado');
  const nVencidos = activos.filter((p) => p.estadoVenc === 'vencido').length;
  const nAlerta = activos.filter((p) => p.estadoVenc === 'alerta').length;
  const nBajo = activos.filter((p) => p.stockMin > 0 && p.stock <= p.stockMin).length;

  $('content').innerHTML = '<div class="card wide">'
    + '<div class="card-head"><h2>&#128230; Inventario</h2>'
    + '<div class="head-acts">'
    + '  <button class="btn ghost" id="invRefresh" title="Actualizar">&#128260;</button>'
    + '  <button class="btn ghost" id="invScan">&#128247; Escanear</button>'
    + '  <button class="btn" id="invNuevo">+ Producto</button>'
    + '</div></div>'
    + '<input class="inp" id="invBuscar" placeholder="Buscar por nombre, código, categoría o marca..." autocomplete="off" style="margin-bottom:12px">'
    + '<div class="filtros" id="invFiltros">'
    + '  <button class="filtro activo" data-f="todos">Todos <span class="fcount">' + activos.length + '</span></button>'
    + '  <button class="filtro f-vencido" data-f="vencido">&#9888; Vencidos <span class="fcount">' + nVencidos + '</span></button>'
    + '  <button class="filtro f-alerta" data-f="alerta">&#9200; Por vencer <span class="fcount">' + nAlerta + '</span></button>'
    + '  <button class="filtro f-bajo" data-f="bajo">&#128201; Poco stock <span class="fcount">' + nBajo + '</span></button>'
    + '</div>'
    + '<div class="tbl-wrap"><table class="tbl"><thead><tr>'
    + '<th class="hide-sm">Código</th><th>Producto</th>'
    + '<th class="tc hide-sm">Costo u.</th><th class="tc hide-sm">Costo caja</th>'
    + '<th class="tc">Precio</th><th class="tc hide-sm">Margen</th>'
    + '<th class="tc">Stock</th><th class="tc">Vence</th><th></th>'
    + '</tr></thead><tbody id="invBody"></tbody></table></div></div>';

  $('invBuscar').addEventListener('input', (e) => filasInventario(e.target.value));
  $('invRefresh').addEventListener('click', refrescarInventario);
  $('invScan').addEventListener('click', scanInventario);
  $('invNuevo').addEventListener('click', () => editarProducto(null));
  document.querySelectorAll('#invFiltros .filtro').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#invFiltros .filtro').forEach((x) => x.classList.remove('activo'));
    b.classList.add('activo');
    INV_FILTRO = b.dataset.f;
    filasInventario(val('invBuscar'));
  }));
  filasInventario('');
}
function filasInventario(q) {
  const lista = DATA.inventario.filter((p) => {
    if (String(p.estado).toLowerCase() === 'descontinuado') return false;
    // Filtro por pastilla
    if (INV_FILTRO === 'vencido' && p.estadoVenc !== 'vencido') return false;
    if (INV_FILTRO === 'alerta' && p.estadoVenc !== 'alerta') return false;
    if (INV_FILTRO === 'bajo' && !(p.stockMin > 0 && p.stock <= p.stockMin)) return false;
    // Filtro por texto
    return (!q || contiene(p.nombre, q) || contiene(p.categoria, q) ||
      contiene(p.marca, q) || (p.codigo && p.codigo.indexOf(String(q).trim()) >= 0));
  });
  $('invBody').innerHTML = lista.map((p) => {
    const bajo = p.stockMin > 0 && p.stock <= p.stockMin;
    const marg = (p.margen !== null && p.margen !== undefined) ? (p.margen + '%') : '-';
    // Punto de color segun estado de vencimiento
    let venceCell = '<span class="muted">—</span>';
    let rowCls = '';
    if (p.estadoVenc === 'vencido') {
      venceCell = '<span class="v-badge vencido">&#9888; ' + p.vence + '</span>';
      rowCls = 'row-vencido';
    } else if (p.estadoVenc === 'alerta') {
      venceCell = '<span class="v-badge alerta">' + p.diasVence + ' d</span>';
      rowCls = 'row-alerta';
    } else if (p.estadoVenc === 'ok') {
      venceCell = '<span class="v-badge ok">' + p.vence + '</span>';
    }
    return '<tr class="' + rowCls + '">'
      + '<td class="hide-sm">' + esc(p.codigo || '') + '</td>'
      + '<td>' + esc(p.nombre) + '<div class="sub-sm">' + esc(p.categoria || '')
        + (p.estadoVenc === 'vencido' ? ' &middot; <span class="txt-venc">vencido</span>' : (p.estadoVenc === 'alerta' ? ' &middot; <span class="txt-alerta">vence en ' + p.diasVence + ' d</span>' : ''))
        + '</div></td>'
      + '<td class="tc hide-sm">' + (p.costoUnit ? money(p.costoUnit) : '-') + '</td>'
      + '<td class="tc hide-sm">' + (p.costoCaja ? money(p.costoCaja) : '-') + '</td>'
      + '<td class="tc">' + money(p.precio) + '</td>'
      + '<td class="tc hide-sm">' + marg + '</td>'
      + '<td class="tc ' + (bajo ? 'txt-warn' : '') + '">' + p.stock + '</td>'
      + '<td class="tc">' + venceCell + '</td>'
      + '<td class="acts"><button class="mini" onclick=\'editarProducto(' + JSON.stringify(p).replace(/'/g, '&#39;') + ')\'>&#9998;</button>'
      + '<button class="mini danger" onclick="eliminarProducto(' + p._row + ')">&#128465;</button></td></tr>';
  }).join('') || '<tr><td colspan="9" class="empty">Sin coincidencias</td></tr>';
}
async function refrescarInventario() {
  const btn = $('invRefresh');
  if (btn) btn.disabled = true;
  try {
    DATA.inventario = await api('inventario');
    const b = $('invBuscar');
    filasInventario(b ? b.value : '');
    aviso('Inventario actualizado', 'ok', 2000);
  } catch (e) { aviso(e.message, 'error'); }
  finally { if (btn) btn.disabled = false; }
}
/** Escaneo en inventario: busca primero en memoria (instantaneo). */
function scanInventario() {
  abrirScanner(async (t) => {
    const local = buscarLocal(DATA.inventario, t);
    if (local) { editarProducto(local); return; }
    const ok = await preguntar({
      titulo: 'Producto no registrado',
      texto: 'No existe ningún producto con el código ' + t + '. ¿Quieres crearlo ahora con ese código?',
      aceptar: 'Crear producto', cancelar: 'Cancelar', icono: '&#128230;'
    });
    if (ok) editarProducto(null, t);
  }, false);
}
function editarProducto(p, codigoPre) {
  const esNuevo = !p;
  const ops = (DATA.categorias || []).map((c) =>
    '<option value="' + c.id + '"' + (p && p.idCategoria === c.id ? ' selected' : '') + '>' + esc(c.nombre) + '</option>'
  ).join('');
  const cod = p ? p.codigo : (codigoPre || '');
  abrirModal('<div class="modal"><h3>' + (esNuevo ? 'Nuevo producto' : 'Editar producto') + '</h3>'
    + '<label class="lbl">Nombre</label><input id="pNom" class="inp" value="' + esc(p ? p.nombre : '') + '">'
    + '<label class="lbl">Código de barras</label>'
    + '<div class="inp-row"><input id="pCod" class="inp" value="' + esc(cod) + '" inputmode="numeric">'
    + '<button class="btn btn-scan" id="pScan">&#128247;</button></div>'
    + '<div class="row2"><div><label class="lbl">Categoría</label><select id="pCat" class="inp">' + ops + '</select></div>'
    + '<div><label class="lbl">Marca</label><input id="pMar" class="inp" value="' + esc(p ? p.marca : '') + '"></div></div>'
    + '<div class="row3">'
    + '<div><label class="lbl">Costo unitario</label><input id="pCostoU" class="inp" type="number" step="0.01" min="0" value="' + (p && p.costoUnit ? p.costoUnit : '') + '"></div>'
    + '<div><label class="lbl">Costo por caja</label><input id="pCostoC" class="inp" type="number" step="0.01" min="0" value="' + (p && p.costoCaja ? p.costoCaja : '') + '"></div>'
    + '<div><label class="lbl">Precio de venta</label><input id="pPre" class="inp" type="number" step="0.01" min="0" value="' + (p && p.precio ? p.precio : '') + '"></div>'
    + '</div><div id="margenBox" class="margen-box"></div>'
    + '<div class="row3">'
    + '<div><label class="lbl">Unid. por caja</label><input id="pUnidCaja" class="inp" type="number" min="0" value="' + (p && p.unidPorCaja ? p.unidPorCaja : '') + '"></div>'
    + '<div><label class="lbl">Stock mínimo</label><input id="pMin" class="inp" type="number" min="0" value="' + (p ? p.stockMin : 3) + '"></div>'
    + '<div><label class="lbl">Presentación</label><input id="pPres" class="inp" value="' + esc(p ? p.presentacion : '') + '"></div>'
    + '</div>'
    + '<label class="check2"><input type="checkbox" id="pVenc" ' + (p && p.controla ? 'checked' : '') + '> Controla vencimiento</label>'
    + '<div id="pDiasWrap" style="display:' + (p && p.controla ? 'block' : 'none') + '"><label class="lbl">Días de alerta antes de vencer</label>'
    + '<input id="pDias" class="inp" type="number" min="1" value="' + (p && p.diasAlerta ? p.diasAlerta : 30) + '"></div>'
    + '<div id="pMsg" class="msg"></div>'
    + '<div class="modal-acts"><button class="btn ghost" onclick="cerrarModal()">Cancelar</button>'
    + '<button class="btn" id="pGuardar">Guardar</button></div></div>');

  $('pScan').addEventListener('click', () => abrirScanner((t) => {
    $('pCod').value = String(t).trim();
    aviso('Código capturado: ' + String(t).trim(), 'ok', 2400);
  }, false));
  $('pVenc').addEventListener('change', (e) => { $('pDiasWrap').style.display = e.target.checked ? 'block' : 'none'; });
  $('pCostoU').addEventListener('input', calcMargen);
  $('pPre').addEventListener('input', calcMargen);
  $('pGuardar').addEventListener('click', () => salvarProducto(p ? p._row : null));
  calcMargen();
}
function calcMargen() {
  const box = $('margenBox'); if (!box) return;
  const c = Number(val('pCostoU')) || 0, v = Number(val('pPre')) || 0;
  if (c > 0 && v > 0) {
    const g = v - c, m = Math.round((g / v) * 100);
    const cls = m < 15 ? 'err' : (m < 30 ? '' : 'ok');
    box.innerHTML = 'Ganancia por unidad: <b>' + money(g) + '</b> &middot; Margen: <span class="' + cls + '"><b>' + m + '%</b></span>';
  } else box.innerHTML = '<span class="muted">Ingresa costo y precio para ver el margen.</span>';
}
async function salvarProducto(row) {
  const msg = $('pMsg');
  const btn = $('pGuardar'); btn.disabled = true;
  msg.innerHTML = '<span class="cargando">Guardando<span class="pts"></span></span>';
  try {
    await api('guardarProducto', {
      _row: row || null, nombre: val('pNom'), codigo: val('pCod'), idCategoria: val('pCat'),
      marca: val('pMar'), costoUnit: val('pCostoU'), costoCaja: val('pCostoC'), precio: val('pPre'),
      unidPorCaja: val('pUnidCaja'), stockMin: val('pMin'), presentacion: val('pPres'),
      controla: $('pVenc').checked, diasAlerta: val('pDias')
    });
    cerrarModal();
    aviso(row ? 'Producto actualizado' : 'Producto creado', 'ok');
    DATA.catalogo = null; DATA.dashboard = null;
    borrarVistaViva('dashboard');
    await refrescarInventario();
  } catch (e) {
    msg.innerHTML = '<span class="err">' + esc(e.message) + '</span>';
    btn.disabled = false;
    sonidoError();
  }
}
async function eliminarProducto(row) {
  const prod = DATA.inventario.filter((p) => p._row === row)[0];
  const ok = await preguntar({
    titulo: 'Descontinuar producto',
    texto: (prod ? '"' + prod.nombre + '" ' : 'El producto ') + 'dejará de aparecer en ventas, pero su historial se conserva.',
    aceptar: 'Descontinuar', cancelar: 'Cancelar', peligro: true, icono: '&#128465;'
  });
  if (!ok) return;
  try {
    await api('eliminarProducto', { row });
    aviso('Producto descontinuado', 'ok');
    DATA.catalogo = null; DATA.dashboard = null;
    borrarVistaViva('dashboard');
    await refrescarInventario();
  } catch (e) { aviso(e.message, 'error'); }
}

/* =================================================================
   COMPRAS
   ================================================================= */
let COMPRA = [];
function renderCompras() {
  if (!DATA.proveedores) { $('content').innerHTML = pantallaError('No se pudieron cargar los proveedores.', 'compras'); return; }
  COMPRA = [];
  const ops = '<option value="">Selecciona proveedor...</option>'
    + DATA.proveedores.map((p) => '<option value="' + p.id + '">' + esc(p.nombre) + '</option>').join('');
  $('content').innerHTML = '<div class="pos">'
    + '<div class="pos-left"><h3>&#128666; Registrar compra</h3>'
    + '<label class="lbl">Proveedor</label><select id="compProv" class="inp">' + ops + '</select>'
    + '<label class="lbl">Agregar producto</label>'
    + '<div class="inp-row"><input id="compBuscar" class="inp" placeholder="Buscar producto..." autocomplete="off">'
    + '<button class="btn btn-scan" id="compScan">&#128247;</button></div>'
    + '<div id="compLista" class="prod-grid" style="margin-top:10px"></div></div>'
    + '<div class="pos-right"><h3>Detalle de compra</h3>'
    + '<div id="compCarrito" class="carrito carrito-alto"></div>'
    + '<div class="pos-total"><span>Total</span><span id="compTotal">' + money(0) + '</span></div>'
    + '<div id="compMsg" class="msg"></div>'
    + '<button class="btn btn-block" id="btnCompra">&#128229; Registrar compra</button></div></div>';

  $('compBuscar').addEventListener('input', (e) => filasCompraProd(e.target.value));
  $('compScan').addEventListener('click', scanCompra);
  $('btnCompra').addEventListener('click', registrarCompra);
  filasCompraProd(''); pintarCompra();
}
function filasCompraProd(q) {
  const lista = (DATA.inventario || []).filter((p) =>
    String(p.estado).toLowerCase() !== 'descontinuado' &&
    (!q || contiene(p.nombre, q) || contiene(p.marca, q))
  ).slice(0, 24);
  $('compLista').innerHTML = lista.map((p) =>
    '<div class="prod-card" onclick=\'addCompra(' + JSON.stringify({ id: p.id, nombre: p.nombre, controla: p.controla, costo: p.costoUnit }).replace(/'/g, '&#39;') + ')\'>'
    + '<div class="prod-nom">' + esc(p.nombre) + '</div>'
    + '<div class="prod-meta">' + (p.controla ? 'Con vencimiento' : 'Sin vencimiento') + '</div></div>'
  ).join('') || '<p class="empty">Sin coincidencias</p>';
}
function scanCompra() {
  abrirScanner((t) => {
    const local = buscarLocal(DATA.inventario, t);
    if (local) {
      addCompra({ id: local.id, nombre: local.nombre, controla: local.controla, costo: local.costoUnit });
      scanHistorial(local.nombre, 'ok');
    } else {
      sonidoError();
      scanHistorial('No existe: ' + t, 'err');
      aviso('No existe un producto con el código ' + t + '. Regístralo primero en Inventario.', 'error', 4200);
    }
  }, true);
}
function addCompra(p) {
  if (COMPRA.filter((x) => x.id === p.id).length) {
    sonidoAviso();
    aviso(p.nombre + ' ya está en la lista', 'info', 2200);
    return;
  }
  COMPRA.push({ id: p.id, nombre: p.nombre, controla: p.controla, cantidad: 1, costo: p.costo || 0, vence: '' });
  pintarCompra();
}
function pintarCompra() {
  const c = $('compCarrito'); if (!c) return;
  if (!COMPRA.length) { c.innerHTML = '<p class="empty">Sin productos</p>'; $('compTotal').textContent = money(0); return; }
  let total = 0;
  c.innerHTML = COMPRA.map((l, i) => {
    total += l.cantidad * l.costo;
    return '<div class="comp-row"><div class="comp-nom"><span>' + esc(l.nombre) + '</span>'
      + '<button class="cart-x" onclick="quitarCompra(' + i + ')">&#10005;</button></div>'
      + '<div class="comp-fields">'
      + '<label>Cantidad<input type="number" min="1" value="' + l.cantidad + '" oninput="setCompra(' + i + ',\'cantidad\',this.value)"></label>'
      + '<label>Costo unit.<input type="number" min="0" step="0.01" value="' + l.costo + '" oninput="setCompra(' + i + ',\'costo\',this.value)"></label>'
      + (l.controla ? '<label>Vence<input type="date" value="' + l.vence + '" oninput="setCompra(' + i + ',\'vence\',this.value)"></label>' : '')
      + '</div></div>';
  }).join('');
  $('compTotal').textContent = money(total);
}
function setCompra(i, campo, valor) {
  if (campo === 'vence') { COMPRA[i].vence = valor; return; }
  COMPRA[i][campo] = Number(valor) || 0;
  let t = 0; COMPRA.forEach((l) => { t += l.cantidad * l.costo; });
  $('compTotal').textContent = money(t);
}
function quitarCompra(i) { COMPRA.splice(i, 1); pintarCompra(); }
async function registrarCompra() {
  const prov = val('compProv'), msg = $('compMsg');
  if (!prov) { aviso('Selecciona un proveedor', 'error'); return; }
  if (!COMPRA.length) { aviso('Agrega al menos un producto', 'error'); return; }
  const fv = COMPRA.filter((l) => l.controla && !l.vence)[0];
  if (fv) { aviso('Falta la fecha de vencimiento de ' + fv.nombre, 'error', 4000); return; }
  const fc = COMPRA.filter((l) => !l.costo || l.costo <= 0)[0];
  if (fc) { aviso('Falta el costo de ' + fc.nombre, 'error', 4000); return; }
  cerrarScanner();
  const btn = $('btnCompra'); btn.disabled = true;
  msg.innerHTML = '<span class="cargando">Registrando<span class="pts"></span></span>';
  try {
    const r = await api('registrarCompra', {
      idProveedor: prov,
      items: COMPRA.map((l) => ({ id: l.id, cantidad: l.cantidad, costo: l.costo, vence: l.vence }))
    });
    msg.innerHTML = '';
    sonidoOk();
    aviso('Compra ' + r.idCompra + ' registrada — ' + money(r.total), 'ok', 3800);
    COMPRA = []; pintarCompra();
    DATA.inventario = null; DATA.catalogo = null; DATA.dashboard = null;
    borrarVistaViva('dashboard');
  } catch (e) {
    msg.innerHTML = '<span class="err">' + esc(e.message) + '</span>';
    sonidoError();
  } finally { btn.disabled = false; }
}

/* =================================================================
   CLIENTES / PROVEEDORES
   ================================================================= */
function renderClientes() {
  const sub = (SESION.permisos || {}).Proveedores ? '<button class="tab" data-t="prov">&#128666; Proveedores</button>' : '';
  $('content').innerHTML = '<div class="tabs"><button class="tab active" data-t="cli">&#128101; Clientes</button>' + sub + '</div><div id="cliBody"></div>';
  document.querySelectorAll('.tabs .tab').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs .tab').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    if (b.dataset.t === 'cli') tabClientes(); else tabProveedores();
  }));
  tabClientes();
}
function tabClientes() {
  $('cliBody').innerHTML = '<div class="card wide">'
    + '<div class="card-head"><h2>&#128101; Clientes</h2><button class="btn" id="cliNuevo">+ Cliente</button></div>'
    + '<input class="inp" id="cliFiltro" placeholder="Buscar cliente por nombre..." autocomplete="off" style="margin-bottom:14px">'
    + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="hide-sm">ID</th><th>Nombre</th>'
    + '<th class="hide-sm">Correo</th><th class="hide-sm">Tipo</th><th></th></tr></thead><tbody id="cliBodyTbl"></tbody></table></div></div>';
  $('cliFiltro').addEventListener('input', (e) => filasClientes(e.target.value));
  $('cliNuevo').addEventListener('click', () => editarCliente(null));
  filasClientes('');
}
function filasClientes(q) {
  const lista = (DATA.clientes || []).filter((c) =>
    !q || contiene(c.nombre, q) || contiene(c.telefono, q) || contiene(c.correo, q));
  const b = $('cliBodyTbl'); if (!b) return;
  b.innerHTML = lista.map((c) =>
    '<tr><td class="hide-sm">' + c.id + '</td><td>' + esc(c.nombre) + '<div class="sub-sm">' + esc(c.telefono || '') + '</div></td>'
    + '<td class="hide-sm">' + esc(c.correo || '') + '</td><td class="hide-sm">' + esc(c.tipo || '') + '</td>'
    + '<td class="acts"><button class="mini" onclick=\'editarCliente(' + JSON.stringify(c).replace(/'/g, '&#39;') + ')\'>&#9998;</button></td></tr>'
  ).join('') || '<tr><td colspan="5" class="empty">Sin coincidencias</td></tr>';
}
function editarCliente(c) {
  abrirModal('<div class="modal"><h3>' + (c ? 'Editar cliente' : 'Nuevo cliente') + '</h3>'
    + '<label class="lbl">Nombre</label><input id="cNom" class="inp" value="' + esc(c ? c.nombre : '') + '">'
    + '<div class="row2"><div><label class="lbl">Teléfono</label><input id="cTel" class="inp" value="' + esc(c && c.telefono ? c.telefono : '') + '"></div>'
    + '<div><label class="lbl">Correo</label><input id="cCor" class="inp" value="' + esc(c && c.correo ? c.correo : '') + '"></div></div>'
    + '<label class="lbl">Dirección</label><input id="cDir" class="inp" value="' + esc(c && c.direccion ? c.direccion : '') + '">'
    + '<label class="lbl">Tipo</label><select id="cTipo" class="inp"><option ' + (c && c.tipo === 'Minorista' ? 'selected' : '') + '>Minorista</option>'
    + '<option ' + (c && c.tipo === 'Mayorista' ? 'selected' : '') + '>Mayorista</option></select>'
    + '<div id="cMsg" class="msg"></div><div class="modal-acts"><button class="btn ghost" onclick="cerrarModal()">Cancelar</button>'
    + '<button class="btn" id="cGuardar">Guardar</button></div></div>');
  $('cGuardar').addEventListener('click', () => salvarCliente(c ? c._row : null));
}
async function salvarCliente(row) {
  const msg = $('cMsg'), btn = $('cGuardar');
  btn.disabled = true;
  msg.innerHTML = '<span class="cargando">Guardando<span class="pts"></span></span>';
  try {
    await api('guardarCliente', { _row: row || null, nombre: val('cNom'), telefono: val('cTel'), correo: val('cCor'), direccion: val('cDir'), tipo: val('cTipo') });
    cerrarModal();
    aviso(row ? 'Cliente actualizado' : 'Cliente creado', 'ok');
    DATA.clientes = await api('clientes');
    const f = $('cliFiltro');
    filasClientes(f ? f.value : '');
  } catch (e) {
    msg.innerHTML = '<span class="err">' + esc(e.message) + '</span>';
    btn.disabled = false;
    sonidoError();
  }
}
async function tabProveedores() {
  $('cliBody').innerHTML = '<div class="skel-panel alto"></div>';
  if (!DATA.proveedores) {
    try { DATA.proveedores = await api('proveedores'); }
    catch (e) { $('cliBody').innerHTML = pantallaError(e.message, 'clientes'); return; }
  }
  $('cliBody').innerHTML = '<div class="card wide">'
    + '<div class="card-head"><h2>&#128666; Proveedores</h2><button class="btn" id="prNuevo">+ Proveedor</button></div>'
    + '<input class="inp" id="prFiltro" placeholder="Buscar proveedor..." autocomplete="off" style="margin-bottom:14px">'
    + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="hide-sm">ID</th><th>Nombre</th>'
    + '<th class="hide-sm">Correo</th><th class="hide-sm">Tipo</th><th></th></tr></thead><tbody id="prBodyTbl"></tbody></table></div></div>';
  $('prFiltro').addEventListener('input', (e) => filasProv(e.target.value));
  $('prNuevo').addEventListener('click', () => editarProveedor(null));
  filasProv('');
}
function filasProv(q) {
  const lista = (DATA.proveedores || []).filter((p) =>
    !q || contiene(p.nombre, q) || contiene(p.tipo, q) || contiene(p.telefono, q));
  const b = $('prBodyTbl'); if (!b) return;
  b.innerHTML = lista.map((p) =>
    '<tr><td class="hide-sm">' + p.id + '</td><td>' + esc(p.nombre) + '<div class="sub-sm">' + esc(p.telefono || '') + '</div></td>'
    + '<td class="hide-sm">' + esc(p.correo || '') + '</td><td class="hide-sm">' + esc(p.tipo || '') + '</td>'
    + '<td class="acts"><button class="mini" onclick=\'editarProveedor(' + JSON.stringify(p).replace(/'/g, '&#39;') + ')\'>&#9998;</button>'
    + '<button class="mini danger" onclick="eliminarProveedor(' + p._row + ')">&#128465;</button></td></tr>'
  ).join('') || '<tr><td colspan="5" class="empty">Sin coincidencias</td></tr>';
}
function editarProveedor(p) {
  abrirModal('<div class="modal"><h3>' + (p ? 'Editar proveedor' : 'Nuevo proveedor') + '</h3>'
    + '<label class="lbl">Nombre</label><input id="prNom" class="inp" value="' + esc(p ? p.nombre : '') + '">'
    + '<div class="row2"><div><label class="lbl">Teléfono</label><input id="prTel" class="inp" value="' + esc(p && p.telefono ? p.telefono : '') + '"></div>'
    + '<div><label class="lbl">Correo</label><input id="prCor" class="inp" value="' + esc(p && p.correo ? p.correo : '') + '"></div></div>'
    + '<label class="lbl">Tipo de producto</label><input id="prTipo" class="inp" value="' + esc(p && p.tipo ? p.tipo : '') + '">'
    + '<label class="lbl">Dirección</label><input id="prDir" class="inp" value="' + esc(p && p.direccion ? p.direccion : '') + '">'
    + '<div id="prMsg" class="msg"></div><div class="modal-acts"><button class="btn ghost" onclick="cerrarModal()">Cancelar</button>'
    + '<button class="btn" id="prGuardar">Guardar</button></div></div>');
  $('prGuardar').addEventListener('click', () => salvarProveedor(p ? p._row : null));
}
async function salvarProveedor(row) {
  const msg = $('prMsg'), btn = $('prGuardar');
  btn.disabled = true;
  msg.innerHTML = '<span class="cargando">Guardando<span class="pts"></span></span>';
  try {
    await api('guardarProveedor', { _row: row || null, nombre: val('prNom'), telefono: val('prTel'), correo: val('prCor'), tipo: val('prTipo'), direccion: val('prDir') });
    cerrarModal();
    aviso(row ? 'Proveedor actualizado' : 'Proveedor creado', 'ok');
    DATA.proveedores = await api('proveedores');
    const f = $('prFiltro');
    filasProv(f ? f.value : '');
  } catch (e) {
    msg.innerHTML = '<span class="err">' + esc(e.message) + '</span>';
    btn.disabled = false;
    sonidoError();
  }
}
async function eliminarProveedor(row) {
  const pr = (DATA.proveedores || []).filter((p) => p._row === row)[0];
  const ok = await preguntar({
    titulo: 'Desactivar proveedor',
    texto: (pr ? '"' + pr.nombre + '" ' : 'El proveedor ') + 'dejará de aparecer al registrar compras.',
    aceptar: 'Desactivar', cancelar: 'Cancelar', peligro: true, icono: '&#128465;'
  });
  if (!ok) return;
  try {
    await api('eliminarProveedor', { row });
    aviso('Proveedor desactivado', 'ok');
    DATA.proveedores = await api('proveedores');
    const f = $('prFiltro');
    filasProv(f ? f.value : '');
  } catch (e) { aviso(e.message, 'error'); }
}

/* =================================================================
   ADMIN
   ================================================================= */
function renderAdmin() {
  $('content').innerHTML = '<div class="tabs">'
    + '<button class="tab active" data-t="perso">&#127912; Personalización</button>'
    + '<button class="tab" data-t="negocio">&#127978; Negocio</button>'
    + '<button class="tab" data-t="usuarios">&#128100; Usuarios</button>'
    + '<button class="tab" data-t="roles">&#128273; Roles</button>'
    + '</div><div id="admBody"></div>';
  document.querySelectorAll('.tabs .tab').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs .tab').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    const t = b.dataset.t;
    if (t === 'perso') tabPerso(); else if (t === 'negocio') tabNegocio();
    else if (t === 'usuarios') tabUsuarios(); else tabRoles();
  }));
  tabPerso();
}
function tabPerso() {
  const m = DATA.marca || { nombre: '', logo: '' };
  const prev = m.logo ? '<img src="' + m.logo + '" id="logoPreview" class="logo-preview">'
    : '<div id="logoPreview" class="logo-preview empty">Sin logo</div>';
  $('admBody').innerHTML = '<div class="card"><h2>&#127912; Personalización</h2>'
    + '<label class="lbl">Nombre del negocio</label><input id="inpNombre" class="inp" value="' + esc(m.nombre || '') + '">'
    + '<label class="lbl">Logo (se comprime automáticamente)</label>'
    + '<div class="logo-row">' + prev + '<input id="inpLogo" type="file" accept="image/png,image/jpeg" class="inp-file"></div>'
    + '<div id="admMsg" class="msg"></div>'
    + '<div class="btn-row">' + (m.logo ? '<button class="btn ghost" id="btnDescLogo">&#11015; Descargar logo</button>' : '')
    + '<button class="btn" id="btnGuardarMarca">&#128190; Guardar</button></div></div>';
  $('inpLogo').addEventListener('change', comprimirLogo);
  $('btnGuardarMarca').addEventListener('click', guardarMarca);
  if ($('btnDescLogo')) $('btnDescLogo').addEventListener('click', descargarLogo);
}
function descargarLogo() {
  const m = DATA.marca;
  if (!m || !m.logo) { aviso('No hay logo guardado', 'error'); return; }
  const ext = m.logo.indexOf('image/png') >= 0 ? 'png' : 'jpg';
  const a = document.createElement('a');
  a.href = m.logo; a.download = 'logo-licoreria.' + ext;
  document.body.appendChild(a); a.click(); a.remove();
  aviso('Logo descargado', 'ok');
}
function comprimirLogo(ev) {
  const file = ev.target.files[0]; if (!file) return;
  const msg = $('admMsg');
  msg.innerHTML = '<span class="cargando">Procesando imagen<span class="pts"></span></span>';
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const max = 256; let w = img.width, h = img.height;
      if (w > h && w > max) { h = h * max / w; w = max; } else if (h > max) { w = w * max / h; h = max; }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      let q = 0.92, out = c.toDataURL('image/jpeg', q);
      while (out.length > 46000 && q > 0.3) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
      window._logoBase64 = out;
      $('logoPreview').outerHTML = '<img src="' + out + '" id="logoPreview" class="logo-preview">';
      msg.innerHTML = '<span class="ok">Imagen lista (' + Math.round(out.length / 1024) + ' KB). Pulsa Guardar.</span>';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
async function guardarMarca() {
  const msg = $('admMsg'), btn = $('btnGuardarMarca');
  btn.disabled = true;
  msg.innerHTML = '<span class="cargando">Guardando<span class="pts"></span></span>';
  try {
    const payload = { nombre: val('inpNombre') };
    if (window._logoBase64) payload.logo = window._logoBase64;
    const m = await api('guardarMarca', payload);
    window._logoBase64 = null;
    DATA.marca = m;
    localStorage.setItem('pos_marca', JSON.stringify(m));
    aplicarMarcaHeader(m);
    msg.innerHTML = '';
    aviso('Personalización guardada', 'ok');
  } catch (e) {
    msg.innerHTML = '<span class="err">' + esc(e.message) + '</span>';
    sonidoError();
  } finally { btn.disabled = false; }
}
function tabNegocio() {
  const n = DATA.negocio || {};
  $('admBody').innerHTML = '<div class="card"><h2>&#127978; Datos del negocio</h2>'
    + '<p class="muted" style="margin-bottom:10px">Estos datos aparecen en el ticket de venta.</p>'
    + '<label class="lbl">Nombre</label><input id="nNom" class="inp" value="' + esc(n.nombre || '') + '">'
    + '<label class="lbl">RUC / Cédula</label><input id="nRuc" class="inp" value="' + esc(n.ruc || '') + '">'
    + '<label class="lbl">Dirección</label><input id="nDir" class="inp" value="' + esc(n.direccion || '') + '">'
    + '<label class="lbl">Teléfono</label><input id="nTel" class="inp" value="' + esc(n.telefono || '') + '">'
    + '<label class="lbl">Mensaje al pie del ticket</label><input id="nMsg" class="inp" value="' + esc(n.mensaje || '') + '">'
    + '<div id="negMsg" class="msg"></div><button class="btn" id="btnGuardarNeg">&#128190; Guardar datos</button></div>';
  $('btnGuardarNeg').addEventListener('click', guardarNegocio);
}
async function guardarNegocio() {
  const msg = $('negMsg'), btn = $('btnGuardarNeg');
  btn.disabled = true;
  msg.innerHTML = '<span class="cargando">Guardando<span class="pts"></span></span>';
  try {
    const n = await api('guardarNegocio', { nombre: val('nNom'), ruc: val('nRuc'), direccion: val('nDir'), telefono: val('nTel'), mensaje: val('nMsg') });
    DATA.negocio = n;
    localStorage.setItem('pos_negocio', JSON.stringify(n));
    if (n.nombre && DATA.marca) { DATA.marca.nombre = n.nombre; aplicarMarcaHeader(DATA.marca); }
    msg.innerHTML = '';
    aviso('Datos del negocio guardados', 'ok');
  } catch (e) {
    msg.innerHTML = '<span class="err">' + esc(e.message) + '</span>';
    sonidoError();
  } finally { btn.disabled = false; }
}

/** Usuarios y roles en UNA sola peticion (antes eran dos). */
async function tabUsuarios() {
  $('admBody').innerHTML = '<div class="skel-panel alto"></div>';
  try {
    const d = await api('usuariosYRoles');
    DATA.roles = d.roles;
    window._roles = d.roles.map((r) => r.Rol);
    $('admBody').innerHTML = '<div class="card wide"><div class="card-head"><h2>&#128100; Usuarios</h2>'
      + '<button class="btn" id="uNuevo">+ Usuario</button></div>'
      + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="hide-sm">ID</th><th>Nombre</th><th>Rol</th>'
      + '<th class="tc">Estado</th><th></th></tr></thead><tbody>'
      + d.usuarios.map((u) =>
        '<tr><td class="hide-sm">' + u.ID_Usuario + '</td><td>' + esc(u.Nombre) + '<div class="sub-sm">' + esc(u.Email || '') + '</div></td>'
        + '<td>' + esc(u.Rol) + '</td><td class="tc"><span class="badge ' + (String(u.Estado).toLowerCase() === 'activo' ? 'on' : 'off') + '">' + u.Estado + '</span></td>'
        + '<td class="acts"><button class="mini" onclick=\'editarUsuario(' + JSON.stringify(u).replace(/'/g, '&#39;') + ')\'>&#9998;</button>'
        + '<button class="mini danger" onclick="eliminarUsuario(' + u._row + ')">&#128465;</button></td></tr>'
      ).join('') + '</tbody></table></div></div>';
    $('uNuevo').addEventListener('click', () => editarUsuario(null));
  } catch (e) {
    $('admBody').innerHTML = '<div class="placeholder"><div class="ph-ico">&#9888;</div>'
      + '<h2>No se pudo cargar</h2><p>' + esc(e.message) + '</p>'
      + '<button class="btn" onclick="tabUsuarios()">&#128260; Reintentar</button></div>';
  }
}
function editarUsuario(u) {
  const esNuevo = !u;
  const ops = (window._roles || []).map((r) =>
    '<option value="' + r + '"' + (u && u.Rol === r ? ' selected' : '') + '>' + esc(r) + '</option>').join('');
  abrirModal('<div class="modal"><h3>' + (esNuevo ? 'Nuevo usuario' : 'Editar usuario') + '</h3>'
    + '<label class="lbl">Nombre</label><input id="mNombre" class="inp" value="' + esc(u ? u.Nombre : '') + '">'
    + '<label class="lbl">Email</label><input id="mEmail" class="inp" value="' + esc(u && u.Email ? u.Email : '') + '">'
    + '<label class="lbl">Rol</label><select id="mRol" class="inp">' + ops + '</select>'
    + (esNuevo ? '' : '<label class="lbl">Estado</label><select id="mEstado" class="inp"><option' + (u.Estado === 'Activo' ? ' selected' : '') + '>Activo</option><option' + (u.Estado === 'Inactivo' ? ' selected' : '') + '>Inactivo</option></select>')
    + '<label class="lbl">PIN ' + (esNuevo ? '' : '(vacío = no cambiar)') + '</label><input id="mPin" class="inp" type="password" inputmode="numeric" placeholder="&bull;&bull;&bull;&bull;">'
    + '<p class="muted" style="margin-top:6px">Usa al menos 6 dígitos y evita secuencias como 123456.</p>'
    + '<div id="mMsg" class="msg"></div><div class="modal-acts"><button class="btn ghost" onclick="cerrarModal()">Cancelar</button>'
    + '<button class="btn" id="uGuardar">Guardar</button></div></div>');
  $('uGuardar').addEventListener('click', () => salvarUsuario(u ? u._row : null));
}
async function salvarUsuario(row) {
  const msg = $('mMsg'), btn = $('uGuardar');
  btn.disabled = true;
  msg.innerHTML = '<span class="cargando">Guardando<span class="pts"></span></span>';
  try {
    const d = { _row: row || null, Nombre: val('mNombre'), Email: val('mEmail'), Rol: val('mRol'), PIN: val('mPin') };
    if ($('mEstado')) d.Estado = val('mEstado');
    await api('guardarUsuario', d);
    cerrarModal();
    aviso(row ? 'Usuario actualizado' : 'Usuario creado', 'ok');
    tabUsuarios();
  } catch (e) {
    msg.innerHTML = '<span class="err">' + esc(e.message) + '</span>';
    btn.disabled = false;
    sonidoError();
  }
}
async function eliminarUsuario(row) {
  const ok = await preguntar({
    titulo: 'Eliminar usuario',
    texto: 'Esta acción no se puede deshacer. El usuario ya no podrá iniciar sesión.',
    aceptar: 'Eliminar', cancelar: 'Cancelar', peligro: true, icono: '&#128465;'
  });
  if (!ok) return;
  try {
    await api('eliminarUsuario', { row });
    aviso('Usuario eliminado', 'ok');
    tabUsuarios();
  } catch (e) { aviso(e.message, 'error', 4200); }
}

const PERM = ['Ventas', 'Inventario', 'Compras', 'Clientes', 'Proveedores', 'Dashboard', 'Admin_Usuarios'];
async function tabRoles() {
  $('admBody').innerHTML = '<div class="skel-panel alto"></div>';
  try {
    DATA.roles = await api('roles');
    $('admBody').innerHTML = '<div class="card wide"><div class="card-head"><h2>&#128273; Roles</h2>'
      + '<button class="btn" id="rNuevo">+ Rol</button></div>'
      + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Rol</th><th>Permisos</th><th></th></tr></thead><tbody>'
      + DATA.roles.map((r) => {
        const chips = PERM.filter((p) => { const s = String(r[p]).toLowerCase(); return s === 'si' || s === 'sí'; })
          .map((p) => '<span class="chip">' + p.replace('_', ' ') + '</span>').join(' ') || '<span class="muted">-</span>';
        return '<tr><td><b>' + esc(r.Rol) + '</b><div class="sub-sm">' + esc(r.Descripcion || '') + '</div></td><td>' + chips + '</td>'
          + '<td class="acts"><button class="mini" onclick=\'editarRol(' + JSON.stringify(r).replace(/'/g, '&#39;') + ')\'>&#9998;</button>'
          + '<button class="mini danger" onclick="eliminarRol(' + r._row + ')">&#128465;</button></td></tr>';
      }).join('') + '</tbody></table></div></div>';
    $('rNuevo').addEventListener('click', () => editarRol(null));
  } catch (e) {
    $('admBody').innerHTML = '<div class="placeholder"><div class="ph-ico">&#9888;</div>'
      + '<h2>No se pudo cargar</h2><p>' + esc(e.message) + '</p>'
      + '<button class="btn" onclick="tabRoles()">&#128260; Reintentar</button></div>';
  }
}
function editarRol(r) {
  const esNuevo = !r;
  const checks = PERM.map((p) => {
    const s = r ? String(r[p]).toLowerCase() : '';
    const on = (s === 'si' || s === 'sí');
    return '<label class="check"><input type="checkbox" id="chk_' + p + '"' + (on ? ' checked' : '') + '> ' + p.replace('_', ' ') + '</label>';
  }).join('');
  abrirModal('<div class="modal"><h3>' + (esNuevo ? 'Nuevo rol' : 'Editar rol') + '</h3>'
    + '<label class="lbl">Nombre del rol</label><input id="rNombre" class="inp" value="' + esc(r ? r.Rol : '') + '"' + (esNuevo ? '' : ' readonly') + '>'
    + '<label class="lbl">Descripción</label><input id="rDesc" class="inp" value="' + esc(r && r.Descripcion ? r.Descripcion : '') + '">'
    + '<label class="lbl">Permisos</label><div class="checks">' + checks + '</div>'
    + '<div id="rMsg" class="msg"></div><div class="modal-acts"><button class="btn ghost" onclick="cerrarModal()">Cancelar</button>'
    + '<button class="btn" id="rGuardar">Guardar</button></div></div>');
  $('rGuardar').addEventListener('click', () => salvarRol(r ? r._row : null));
}
async function salvarRol(row) {
  const msg = $('rMsg'), btn = $('rGuardar');
  btn.disabled = true;
  msg.innerHTML = '<span class="cargando">Guardando<span class="pts"></span></span>';
  try {
    const d = { _row: row || null, Rol: val('rNombre'), Descripcion: val('rDesc') };
    PERM.forEach((p) => { d[p] = $('chk_' + p).checked; });
    await api('guardarRol', d);
    cerrarModal();
    aviso(row ? 'Rol actualizado' : 'Rol creado', 'ok');
    tabRoles();
  } catch (e) {
    msg.innerHTML = '<span class="err">' + esc(e.message) + '</span>';
    btn.disabled = false;
    sonidoError();
  }
}
async function eliminarRol(row) {
  const rol = (DATA.roles || []).filter((r) => r._row === row)[0];
  const ok = await preguntar({
    titulo: 'Eliminar rol',
    texto: (rol ? 'El rol "' + rol.Rol + '" ' : 'Este rol ') + 'se eliminará. Solo es posible si ningún usuario lo tiene asignado.',
    aceptar: 'Eliminar', cancelar: 'Cancelar', peligro: true, icono: '&#128465;'
  });
  if (!ok) return;
  try {
    await api('eliminarRol', { row });
    aviso('Rol eliminado', 'ok');
    tabRoles();
  } catch (e) { aviso(e.message, 'error', 4600); }
}
