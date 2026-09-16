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
let LISTO = false;
let VISTA_PENDIENTE = null;

/* ============ LLAMADAS A LA API ============ */
async function api(action, data) {
  const res = await fetch(API_URL, {
  method: 'POST',
  body: JSON.stringify({ action, token: TOKEN, data: data || {} }),
  redirect: 'follow'
});
  if (!res.ok) throw new Error('Sin conexión con el servidor (' + res.status + ')');
  const j = await res.json();
  if (!j.ok) {
    if (j.error === 'SESION_EXPIRADA') { cerrarSesion(true); throw new Error('Tu sesión expiró. Entra de nuevo.'); }
    throw new Error(j.error || 'Error desconocido');
  }
  return j.result;
}

/* ============ UTILIDADES ============ */
const $ = (id) => document.getElementById(id);
function val(id) { const e = $(id); return e ? e.value : ''; }
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function money(n) {
  const m = (DATA.negocio ? DATA.negocio.moneda : 'C$');
  return m + ' ' + Number(n || 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function beep() {
  try {
    const c = new (window.AudioContext || window.webkitAudioContext)();
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 900;
    const g = c.createGain(); g.gain.value = 0.08;
    o.connect(g); g.connect(c.destination); o.start();
    setTimeout(() => { o.stop(); c.close(); }, 80);
  } catch (e) {}
}
function vibrar(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 40); } catch (e) {} }
function abrirModal(html) {
  const d = document.createElement('div');
  d.className = 'modal-bg';
  d.innerHTML = html;
  d.addEventListener('click', (ev) => { if (ev.target === d) d.remove(); });
  document.body.appendChild(d);
  return d;
}
function cerrarModal() {
  const m = document.querySelector('.modal-bg:not(.scan-bg)');
  if (m) m.remove();
}

/* ============ ARRANQUE ============ */
window.addEventListener('load', async () => {
  // Registrar el service worker (hace que la app abra al instante y sea instalable)
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js'); } catch (e) { console.warn('SW:', e); }
  }
  // Sesion guardada?
  TOKEN = localStorage.getItem('pos_token');
  const sesGuardada = localStorage.getItem('pos_sesion');
  const marcaGuardada = localStorage.getItem('pos_marca');
  if (marcaGuardada) { try { DATA.marca = JSON.parse(marcaGuardada); } catch (e) {} }
  const negGuardado = localStorage.getItem('pos_negocio');
  if (negGuardado) { try { DATA.negocio = JSON.parse(negGuardado); } catch (e) {} }

  if (TOKEN && sesGuardada) {
    try {
      SESION = JSON.parse(sesGuardada);
      $('splash').style.display = 'none';
      iniciarApp();
      cargarDatosSegundoPlano();
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
  // Refrescar marca en segundo plano
  api('marca').then((m) => {
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
  msg.innerHTML = 'Verificando...';
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
    cargarDatosSegundoPlano();
  } catch (e) {
    msg.innerHTML = '<span class="err">' + esc(e.message) + '</span>';
  } finally {
    $('btnLogin').disabled = false;
  }
}

function cerrarSesion(silencioso) {
  if (!silencioso && !confirm('¿Cerrar sesión?')) return;
  TOKEN = null; SESION = null; DATA = { marca: DATA.marca, negocio: DATA.negocio };
  LISTO = false; VISTA_PENDIENTE = null;
  localStorage.removeItem('pos_token');
  localStorage.removeItem('pos_sesion');
  cerrarScanner();
  mostrarLogin();
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
async function cargarDatosSegundoPlano() {
  try {
    const d = await api('datosApp');
    Object.assign(DATA, d);
    LISTO = true;
    if (VISTA_PENDIENTE) { const v = VISTA_PENDIENTE; VISTA_PENDIENTE = null; abrirVista(v); }
  } catch (e) {
    LISTO = true;
    $('content').innerHTML = '<div class="placeholder"><h2>No se pudieron cargar los datos</h2><p>' + esc(e.message) + '</p><button class="btn" onclick="location.reload()">Reintentar</button></div>';
  }
}

/* ============ NAVEGACION ============ */
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
function abrirVista(v) {
  if (!LISTO) { VISTA_PENDIENTE = v; $('content').innerHTML = esqueleto(); return; }
  if (v === 'dashboard') renderDashboard();
  else if (v === 'ventas') renderVentas();
  else if (v === 'inventario') renderInventario();
  else if (v === 'compras') renderCompras();
  else if (v === 'clientes') renderClientes();
  else if (v === 'admin') renderAdmin();
}
function esqueleto() {
  return '<div class="skel-wrap"><div class="skel-grid">'
    + '<div class="skel-card"></div><div class="skel-card"></div><div class="skel-card"></div><div class="skel-card"></div>'
    + '</div><div class="skel-grid2"><div class="skel-panel"></div><div class="skel-panel"></div></div>'
    + '<p class="skel-txt">Cargando datos...</p></div>';
}

/* =================================================================
   LECTOR DE CODIGOS DE BARRAS
   Usa el lector NATIVO del navegador (BarcodeDetector) cuando existe
   -mucho mas rapido y preciso con EAN/UPC-, y cae a html5-qrcode
   solo si el dispositivo no lo soporta.
   ================================================================= */
const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'qr_code'];
let SCAN = { activo: false, stream: null, detector: null, timer: null, cb: null, continuo: false, ultimo: '', t: 0, h5: null };

async function abrirScanner(callback, continuo) {
  cerrarScanner();
  SCAN.cb = callback; SCAN.continuo = !!continuo; SCAN.ultimo = ''; SCAN.t = 0;

  const d = document.createElement('div');
  d.className = 'modal-bg scan-bg';
  d.innerHTML =
    '<div class="modal scan-modal">'
    + '<h3>Escanear código</h3>'
    + '<div class="scan-box">'
    + '  <video id="scanVideo" playsinline muted></video>'
    + '  <div id="scanFallback" class="scan-fallback" style="display:none"></div>'
    + '  <div class="scan-mira"><span></span></div>'
    + '</div>'
    + '<div id="scanEstado" class="scan-estado">Iniciando cámara...</div>'
    + '<label class="lbl">O usa la pistola / escribe el código</label>'
    + '<input id="scanManual" class="inp" placeholder="Código + Enter" autocomplete="off" inputmode="numeric">'
    + '<div id="scanMsg" class="msg"></div>'
    + '<div class="modal-acts">'
    + '  <button class="btn ghost" id="scanCambiar" style="display:none">Cambiar cámara</button>'
    + '  <button class="btn ghost" id="scanCerrar">Cerrar</button>'
    + '</div></div>';
  document.body.appendChild(d);

  $('scanCerrar').addEventListener('click', cerrarScanner);
  const mi = $('scanManual');
  mi.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const v = mi.value.trim(); mi.value = '';
      if (v) entregarScan(v);
    }
  });
  // En escritorio el foco va al campo (para la pistola USB); en movil no,
  // para que no salte el teclado y tape la camara.
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
    $('scanEstado').textContent = 'Lector nativo activo — apunta al código';
    bucleNativo(video);
  } else {
    // Respaldo: html5-qrcode sobre el mismo contenedor
    $('scanEstado').textContent = 'Lector de respaldo activo — apunta al código';
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
    if (SCAN.activo) SCAN.timer = setTimeout(tick, 120);
  };
  tick();
}

function usarRespaldo() {
  // Libera nuestro stream: html5-qrcode abre el suyo
  pararStream();
  $('scanVideo').style.display = 'none';
  const fb = $('scanFallback');
  fb.style.display = 'block';
  fb.id = 'scanFallback';
  if (typeof Html5Qrcode === 'undefined') {
    sinCamara('No se pudo cargar el lector. Usa el campo de texto.');
    return;
  }
  try {
    const cfg = { fps: 10, qrbox: { width: 240, height: 160 } };
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
  const e = $('scanEstado'); if (e) e.innerHTML = '<span class="err">' + esc(mensaje) + '</span>';
  const mi = $('scanManual'); if (mi) mi.focus();
}

function entregarScan(texto) {
  const ahora = Date.now();
  if (texto === SCAN.ultimo && (ahora - SCAN.t) < 1800) return;
  SCAN.ultimo = texto; SCAN.t = ahora;
  beep(); vibrar(45);
  const cb = SCAN.cb;
  if (SCAN.continuo) {
    const sm = $('scanMsg');
    if (sm) sm.innerHTML = '<span class="ok">Leído: ' + esc(texto) + '</span>';
    if (cb) cb(texto);
  } else {
    cerrarScanner();
    if (cb) cb(texto);
  }
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
  const d = document.querySelector('.scan-bg'); if (d) d.remove();
}

/* =================================================================
   DASHBOARD
   ================================================================= */
function renderDashboard() {
  if (!DATA.dashboard) { $('content').innerHTML = '<div class="placeholder"><h2>Dashboard</h2><p>Sin permiso para ver este módulo.</p></div>'; return; }
  pintarDashboard(DATA.dashboard);
}
async function refrescarDashboard() {
  $('content').innerHTML = esqueleto();
  try { DATA.dashboard = await api('dashboard'); pintarDashboard(DATA.dashboard); }
  catch (e) { $('content').innerHTML = '<div class="placeholder"><h2>Error</h2><p>' + esc(e.message) + '</p></div>'; }
}
function pintarDashboard(d) {
  const kpis = kpi('&#128181;', 'Ventas de hoy', money(d.ventasDia), d.nDia + ' ventas')
    + kpi('&#128197;', 'Ventas del mes', money(d.ventasMes), d.nMes + ' ventas')
    + kpi('&#9888;', 'Alertas de vencimiento', d.alertasCount, 'lotes por atender', d.alertasCount > 0 ? 'warn' : '')
    + kpi('&#128230;', 'Productos', d.totalProductos, 'en catálogo');

  const alertas = d.porVencer.length ? d.porVencer.map((v) => {
    const cls = v.estado === 'vencido' ? 'vencido' : 'alerta';
    const txt = v.estado === 'vencido' ? ('Vencido hace ' + Math.abs(v.dias) + ' d') : ('Vence en ' + v.dias + ' d');
    return '<tr class="row-' + cls + '"><td>' + esc(v.producto) + '<div class="sub-sm">' + v.lote + ' · ' + v.vence + '</div></td>'
      + '<td class="hide-sm">' + v.lote + '</td><td class="tc">' + v.stock + '</td>'
      + '<td class="tc hide-sm">' + v.vence + '</td><td class="tc"><span class="tag ' + cls + '">' + txt + '</span></td></tr>';
  }).join('') : '<tr><td colspan="5" class="empty">Sin alertas</td></tr>';

  const stock = d.pocoStock.length ? d.pocoStock.map((s) =>
    '<tr><td>' + esc(s.nombre) + '</td><td class="tc">' + s.stock + '</td><td class="tc">' + s.minimo + '</td></tr>'
  ).join('') : '<tr><td colspan="3" class="empty">Todo con stock suficiente</td></tr>';

  const maxV = d.masVendidos.length ? Math.max.apply(null, d.masVendidos.map((x) => x.cantidad)) : 1;
  const vend = d.masVendidos.length ? d.masVendidos.map((v) => {
    const pct = Math.round(v.cantidad / maxV * 100);
    return '<div class="bar-row"><span class="bar-lbl">' + esc(v.producto) + '</span>'
      + '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>'
      + '<span class="bar-val">' + v.cantidad + '</span></div>';
  }).join('') : '<p class="empty">Sin ventas</p>';

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
    + '<div class="dash-head"><button class="btn ghost" onclick="refrescarDashboard()">&#128260; Actualizar</button></div>'
    + '<div class="kpi-grid">' + kpis + '</div>'
    + '<div class="grid-2">'
    + panel('&#9888; Próximos a vencer / vencidos', '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Producto</th><th class="hide-sm">Lote</th><th class="tc">Stock</th><th class="tc hide-sm">Vence</th><th class="tc">Estado</th></tr></thead><tbody>' + alertas + '</tbody></table></div>')
    + panel('&#128201; Poco stock', '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Producto</th><th class="tc">Stock</th><th class="tc">Mínimo</th></tr></thead><tbody>' + stock + '</tbody></table></div>')
    + '</div><div class="grid-2">'
    + panel('&#128200; Ventas (6 meses)', '<div class="chart-wrap"><svg viewBox="0 0 ' + w + ' ' + (chartH + 26) + '" width="100%" height="190">' + barras + '</svg></div>')
    + panel('&#127942; Más vendidos', '<div class="bars">' + vend + '</div>')
    + '</div><div class="grid-1">'
    + panel('&#128101; Ventas por vendedor (mes)', '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Vendedor</th><th class="tc">Ventas</th><th class="tc">Total</th></tr></thead><tbody>' + vendedores + '</tbody></table></div>')
    + '</div></div>';
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
  if (!DATA.catalogo) { $('content').innerHTML = '<div class="placeholder"><h2>Ventas</h2><p>Sin permiso.</p></div>'; return; }
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

  // Eventos (sin redibujar el input: NO pierde el foco)
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
  q = (q || '').toLowerCase();
  const lista = DATA.catalogo.filter((p) =>
    !q || p.nombre.toLowerCase().indexOf(q) >= 0 || (p.codigo && p.codigo.indexOf(q) >= 0)
  ).slice(0, 40);
  $('listaProd').innerHTML = lista.map((p) => {
    const sin = p.controla && p.stock <= 0;
    return '<div class="prod-card ' + (sin ? 'off' : '') + '" ' + (sin ? '' : 'onclick="agregar(\'' + p.id + '\')"') + '>'
      + '<div class="prod-nom">' + esc(p.nombre) + '</div>'
      + '<div class="prod-meta">' + money(p.precio) + (p.controla ? (' · stock ' + p.stock) : '') + '</div></div>';
  }).join('') || '<p class="empty">Sin coincidencias</p>';
}
function escaneoVenta(t) {
  t = String(t || '').trim();
  if (!t) return;
  const local = DATA.catalogo.filter((p) => p.codigo === t || p.id === t)[0];
  if (local) { agregarObj(local); return; }
  api('buscarProducto', { texto: t })
    .then((p) => agregarObj(p))
    .catch((e) => flash(e.message));
}
function filtrarClientes(q) {
  q = (q || '').toLowerCase();
  const drop = $('cliLista');
  if (!q) { drop.innerHTML = ''; drop.style.display = 'none'; $('cliId').value = ''; return; }
  const lista = (DATA.clientes || []).filter((c) => c.nombre.toLowerCase().indexOf(q) >= 0).slice(0, 8);
  drop.innerHTML = lista.map((c) =>
    '<div class="cli-item" onclick="elegirCliente(\'' + c.id + '\',\'' + c.nombre.replace(/'/g, "\\'") + '\')">' + esc(c.nombre) + '</div>'
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
    if (p.controla && l.cantidad + 1 > p.stock) { flash('Sin stock suficiente de ' + p.nombre); return; }
    l.cantidad++;
  } else {
    if (p.controla && p.stock <= 0) { flash('Sin stock de ' + p.nombre); return; }
    CARRITO.push({ id: p.id, nombre: p.nombre, precio: p.precio, cantidad: 1, controla: p.controla, stock: p.stock });
  }
  pintarCarrito();
}
function cambiarCant(id, d) {
  const l = CARRITO.filter((x) => x.id === id)[0]; if (!l) return;
  l.cantidad += d;
  if (l.cantidad <= 0) CARRITO = CARRITO.filter((x) => x.id !== id);
  else if (l.controla && l.cantidad > l.stock) { l.cantidad = l.stock; flash('Máximo en stock: ' + l.stock); }
  pintarCarrito();
}
function quitar(id) { CARRITO = CARRITO.filter((x) => x.id !== id); pintarCarrito(); }
function pintarCarrito() {
  const c = $('carrito'); if (!c) return;
  if (!CARRITO.length) { c.innerHTML = '<p class="empty">Carrito vacío</p>'; $('totalTxt').textContent = money(0); return; }
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
function flash(t) {
  const m = $('scanMsg') || $('ventaMsg');
  if (m) { m.innerHTML = '<span class="err">' + esc(t) + '</span>'; setTimeout(() => { if (m) m.innerHTML = ''; }, 2600); }
}
async function cobrar() {
  if (!CARRITO.length) { flash('El carrito está vacío.'); return; }
  cerrarScanner();
  const btn = $('btnCobrar'); btn.disabled = true;
  const msg = $('ventaMsg'); msg.innerHTML = 'Procesando venta...';
  try {
    const r = await api('registrarVenta', {
      ID_Cliente: val('cliId'), Metodo_Pago: val('selPago'),
      items: CARRITO.map((l) => ({ id: l.id, cantidad: l.cantidad, precio: l.precio }))
    });
    msg.innerHTML = '<span class="ok">Venta ' + r.idVenta + ' registrada.</span>';
    mostrarTicket(r.ticket);
    CARRITO = []; pintarCarrito();
    $('cliBuscar').value = ''; $('cliId').value = '';
    // refrescar en segundo plano
    api('catalogo').then((c) => { DATA.catalogo = c; const b = $('buscarProd'); filtrarProd(b ? b.value : ''); }).catch(() => {});
    api('dashboard').then((d) => { DATA.dashboard = d; }).catch(() => {});
    api('inventario').then((i) => { DATA.inventario = i; }).catch(() => {});
  } catch (e) {
    msg.innerHTML = '<span class="err">' + esc(e.message) + '</span>';
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
   INVENTARIO  (el buscador NO se redibuja: no pierde el foco)
   ================================================================= */
function renderInventario() {
  if (!DATA.inventario) { $('content').innerHTML = '<div class="placeholder"><h2>Inventario</h2><p>Sin permiso.</p></div>'; return; }
  $('content').innerHTML = '<div class="card wide">'
    + '<div class="card-head"><h2>&#128230; Inventario</h2>'
    + '<div class="head-acts">'
    + '  <button class="btn ghost" id="invRefresh">&#128260;</button>'
    + '  <button class="btn ghost" id="invScan">&#128247; Escanear</button>'
    + '  <button class="btn" id="invNuevo">+ Producto</button>'
    + '</div></div>'
    + '<input class="inp" id="invBuscar" placeholder="Buscar por nombre o código..." autocomplete="off" style="margin-bottom:14px">'
    + '<div class="tbl-wrap"><table class="tbl"><thead><tr>'
    + '<th class="hide-sm">Código</th><th>Producto</th>'
    + '<th class="tc hide-sm">Costo u.</th><th class="tc hide-sm">Costo caja</th>'
    + '<th class="tc">Precio</th><th class="tc hide-sm">Margen</th><th class="tc">Stock</th><th></th>'
    + '</tr></thead><tbody id="invBody"></tbody></table></div></div>';

  $('invBuscar').addEventListener('input', (e) => filasInventario(e.target.value));
  $('invRefresh').addEventListener('click', refrescarInventario);
  $('invScan').addEventListener('click', scanInventario);
  $('invNuevo').addEventListener('click', () => editarProducto(null));
  filasInventario('');
}
function filasInventario(q) {
  q = (q || '').toLowerCase();
  const lista = DATA.inventario.filter((p) =>
    String(p.estado).toLowerCase() !== 'descontinuado' &&
    (!q || p.nombre.toLowerCase().indexOf(q) >= 0 || (p.codigo && p.codigo.indexOf(q) >= 0))
  );
  $('invBody').innerHTML = lista.map((p) => {
    const bajo = p.stockMin > 0 && p.stock <= p.stockMin;
    const marg = (p.margen !== null && p.margen !== undefined) ? (p.margen + '%') : '-';
    return '<tr>'
      + '<td class="hide-sm">' + esc(p.codigo || '') + '</td>'
      + '<td>' + esc(p.nombre) + '<div class="sub-sm">' + esc(p.categoria || '') + (p.costoUnit ? (' · costo ' + money(p.costoUnit)) : '') + '</div></td>'
      + '<td class="tc hide-sm">' + (p.costoUnit ? money(p.costoUnit) : '-') + '</td>'
      + '<td class="tc hide-sm">' + (p.costoCaja ? money(p.costoCaja) : '-') + '</td>'
      + '<td class="tc">' + money(p.precio) + '</td>'
      + '<td class="tc hide-sm">' + marg + '</td>'
      + '<td class="tc ' + (bajo ? 'txt-warn' : '') + '">' + p.stock + '</td>'
      + '<td class="acts"><button class="mini" onclick=\'editarProducto(' + JSON.stringify(p).replace(/'/g, '&#39;') + ')\'>&#9998;</button>'
      + '<button class="mini danger" onclick="eliminarProducto(' + p._row + ')">&#128465;</button></td></tr>';
  }).join('') || '<tr><td colspan="8" class="empty">Sin productos</td></tr>';
}
async function refrescarInventario() {
  try {
    DATA.inventario = await api('inventario');
    const b = $('invBuscar');
    filasInventario(b ? b.value : '');
  } catch (e) { alert(e.message); }
}
function scanInventario() {
  abrirScanner((t) => {
    api('buscarInventario', { texto: t }).then((r) => {
      if (r.encontrado) editarProducto(r.producto);
      else if (confirm('No existe un producto con el código ' + r.codigo + '.\n\n¿Crear uno nuevo con ese código?'))
        editarProducto(null, r.codigo);
    }).catch((e) => alert(e.message));
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

  $('pScan').addEventListener('click', () => abrirScanner((t) => { $('pCod').value = String(t).trim(); }, false));
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
    box.innerHTML = 'Ganancia por unidad: <b>' + money(g) + '</b> · Margen: <span class="' + cls + '"><b>' + m + '%</b></span>';
  } else box.innerHTML = '<span class="muted">Ingresa costo y precio para ver el margen.</span>';
}
async function salvarProducto(row) {
  const msg = $('pMsg'); msg.innerHTML = 'Guardando...';
  try {
    await api('guardarProducto', {
      _row: row || null, nombre: val('pNom'), codigo: val('pCod'), idCategoria: val('pCat'),
      marca: val('pMar'), costoUnit: val('pCostoU'), costoCaja: val('pCostoC'), precio: val('pPre'),
      unidPorCaja: val('pUnidCaja'), stockMin: val('pMin'), presentacion: val('pPres'),
      controla: $('pVenc').checked, diasAlerta: val('pDias')
    });
    cerrarModal();
    await refrescarInventario();
    api('catalogo').then((c) => { DATA.catalogo = c; }).catch(() => {});
  } catch (e) { msg.innerHTML = '<span class="err">' + esc(e.message) + '</span>'; }
}
async function eliminarProducto(row) {
  if (!confirm('¿Descontinuar este producto? Dejará de aparecer en ventas.')) return;
  try { await api('eliminarProducto', { row }); await refrescarInventario(); }
  catch (e) { alert(e.message); }
}

/* =================================================================
   COMPRAS
   ================================================================= */
let COMPRA = [];
function renderCompras() {
  if (!DATA.proveedores) { $('content').innerHTML = '<div class="placeholder"><h2>Compras</h2><p>Sin permiso.</p></div>'; return; }
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
  q = (q || '').toLowerCase();
  const lista = (DATA.inventario || []).filter((p) =>
    String(p.estado).toLowerCase() !== 'descontinuado' && (!q || p.nombre.toLowerCase().indexOf(q) >= 0)
  ).slice(0, 24);
  $('compLista').innerHTML = lista.map((p) =>
    '<div class="prod-card" onclick=\'addCompra(' + JSON.stringify({ id: p.id, nombre: p.nombre, controla: p.controla, costo: p.costoUnit }).replace(/'/g, '&#39;') + ')\'>'
    + '<div class="prod-nom">' + esc(p.nombre) + '</div>'
    + '<div class="prod-meta">' + (p.controla ? 'Con vencimiento' : 'Sin vencimiento') + '</div></div>'
  ).join('') || '<p class="empty">Sin coincidencias</p>';
}
function scanCompra() {
  abrirScanner((t) => {
    api('buscarInventario', { texto: t }).then((r) => {
      if (r.encontrado) addCompra({ id: r.producto.id, nombre: r.producto.nombre, controla: r.producto.controla, costo: r.producto.costoUnit });
      else alert('No existe un producto con el código ' + r.codigo + '. Regístralo primero en Inventario.');
    }).catch((e) => alert(e.message));
  }, true);
}
function addCompra(p) {
  if (COMPRA.filter((x) => x.id === p.id).length) return;
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
  if (!prov) { msg.innerHTML = '<span class="err">Selecciona un proveedor.</span>'; return; }
  if (!COMPRA.length) { msg.innerHTML = '<span class="err">Agrega productos.</span>'; return; }
  const fv = COMPRA.filter((l) => l.controla && !l.vence)[0];
  if (fv) { msg.innerHTML = '<span class="err">Falta fecha de vencimiento en: ' + esc(fv.nombre) + '</span>'; return; }
  const fc = COMPRA.filter((l) => !l.costo || l.costo <= 0)[0];
  if (fc) { msg.innerHTML = '<span class="err">Falta costo en: ' + esc(fc.nombre) + '</span>'; return; }
  cerrarScanner();
  const btn = $('btnCompra'); btn.disabled = true;
  msg.innerHTML = 'Registrando...';
  try {
    const r = await api('registrarCompra', {
      idProveedor: prov,
      items: COMPRA.map((l) => ({ id: l.id, cantidad: l.cantidad, costo: l.costo, vence: l.vence }))
    });
    msg.innerHTML = '<span class="ok">Compra ' + r.idCompra + ' registrada. ' + r.lotesNuevos + ' lote(s) creados.</span>';
    COMPRA = []; pintarCompra();
    api('inventario').then((i) => { DATA.inventario = i; }).catch(() => {});
    api('catalogo').then((c) => { DATA.catalogo = c; }).catch(() => {});
    api('dashboard').then((d) => { DATA.dashboard = d; }).catch(() => {});
  } catch (e) { msg.innerHTML = '<span class="err">' + esc(e.message) + '</span>'; }
  finally { btn.disabled = false; }
}

/* =================================================================
   CLIENTES / PROVEEDORES
   ================================================================= */
function renderClientes() {
  const sub = DATA.proveedores ? '<button class="tab" data-t="prov">&#128666; Proveedores</button>' : '';
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
  if (!DATA.clientes) api('clientes').then((l) => { DATA.clientes = l; filasClientes(val('cliFiltro')); }).catch(() => {});
}
function filasClientes(q) {
  q = (q || '').toLowerCase();
  const lista = (DATA.clientes || []).filter((c) => !q || c.nombre.toLowerCase().indexOf(q) >= 0);
  const b = $('cliBodyTbl'); if (!b) return;
  b.innerHTML = lista.map((c) =>
    '<tr><td class="hide-sm">' + c.id + '</td><td>' + esc(c.nombre) + '<div class="sub-sm">' + esc(c.telefono || '') + '</div></td>'
    + '<td class="hide-sm">' + esc(c.correo || '') + '</td><td class="hide-sm">' + esc(c.tipo || '') + '</td>'
    + '<td class="acts"><button class="mini" onclick=\'editarCliente(' + JSON.stringify(c).replace(/'/g, '&#39;') + ')\'>&#9998;</button></td></tr>'
  ).join('') || '<tr><td colspan="5" class="empty">Sin clientes</td></tr>';
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
  const msg = $('cMsg'); msg.innerHTML = 'Guardando...';
  try {
    await api('guardarCliente', { _row: row || null, nombre: val('cNom'), telefono: val('cTel'), correo: val('cCor'), direccion: val('cDir'), tipo: val('cTipo') });
    cerrarModal();
    DATA.clientes = await api('clientes');
    filasClientes(val('cliFiltro'));
  } catch (e) { msg.innerHTML = '<span class="err">' + esc(e.message) + '</span>'; }
}
function tabProveedores() {
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
  q = (q || '').toLowerCase();
  const lista = (DATA.proveedores || []).filter((p) => !q || p.nombre.toLowerCase().indexOf(q) >= 0);
  const b = $('prBodyTbl'); if (!b) return;
  b.innerHTML = lista.map((p) =>
    '<tr><td class="hide-sm">' + p.id + '</td><td>' + esc(p.nombre) + '<div class="sub-sm">' + esc(p.telefono || '') + '</div></td>'
    + '<td class="hide-sm">' + esc(p.correo || '') + '</td><td class="hide-sm">' + esc(p.tipo || '') + '</td>'
    + '<td class="acts"><button class="mini" onclick=\'editarProveedor(' + JSON.stringify(p).replace(/'/g, '&#39;') + ')\'>&#9998;</button>'
    + '<button class="mini danger" onclick="eliminarProveedor(' + p._row + ')">&#128465;</button></td></tr>'
  ).join('') || '<tr><td colspan="5" class="empty">Sin proveedores</td></tr>';
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
  const msg = $('prMsg'); msg.innerHTML = 'Guardando...';
  try {
    await api('guardarProveedor', { _row: row || null, nombre: val('prNom'), telefono: val('prTel'), correo: val('prCor'), tipo: val('prTipo'), direccion: val('prDir') });
    cerrarModal();
    DATA.proveedores = await api('proveedores');
    filasProv(val('prFiltro'));
  } catch (e) { msg.innerHTML = '<span class="err">' + esc(e.message) + '</span>'; }
}
async function eliminarProveedor(row) {
  if (!confirm('¿Desactivar este proveedor?')) return;
  try { await api('eliminarProveedor', { row }); DATA.proveedores = await api('proveedores'); filasProv(val('prFiltro')); }
  catch (e) { alert(e.message); }
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
  if (!m || !m.logo) { alert('No hay logo guardado.'); return; }
  const ext = m.logo.indexOf('image/png') >= 0 ? 'png' : 'jpg';
  const a = document.createElement('a');
  a.href = m.logo; a.download = 'logo-licoreria.' + ext;
  document.body.appendChild(a); a.click(); a.remove();
}
function comprimirLogo(ev) {
  const file = ev.target.files[0]; if (!file) return;
  const msg = $('admMsg'); msg.innerHTML = 'Procesando imagen...';
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
      msg.innerHTML = '<span class="ok">Imagen lista (' + Math.round(out.length / 1024) + ' KB).</span>';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
async function guardarMarca() {
  const msg = $('admMsg'); msg.innerHTML = 'Guardando...';
  try {
    const payload = { nombre: val('inpNombre') };
    if (window._logoBase64) payload.logo = window._logoBase64;
    const m = await api('guardarMarca', payload);
    window._logoBase64 = null;
    DATA.marca = m;
    localStorage.setItem('pos_marca', JSON.stringify(m));
    aplicarMarcaHeader(m);
    msg.innerHTML = '<span class="ok">Guardado.</span>';
  } catch (e) { msg.innerHTML = '<span class="err">' + esc(e.message) + '</span>'; }
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
  const msg = $('negMsg'); msg.innerHTML = 'Guardando...';
  try {
    const n = await api('guardarNegocio', { nombre: val('nNom'), ruc: val('nRuc'), direccion: val('nDir'), telefono: val('nTel'), mensaje: val('nMsg') });
    DATA.negocio = n;
    localStorage.setItem('pos_negocio', JSON.stringify(n));
    if (n.nombre && DATA.marca) { DATA.marca.nombre = n.nombre; aplicarMarcaHeader(DATA.marca); }
    msg.innerHTML = '<span class="ok">Datos guardados.</span>';
  } catch (e) { msg.innerHTML = '<span class="err">' + esc(e.message) + '</span>'; }
}
async function tabUsuarios() {
  $('admBody').innerHTML = '<p class="loading">Cargando...</p>';
  try {
    const lista = await api('usuarios');
    if (!DATA.roles) DATA.roles = await api('roles');
    window._roles = DATA.roles.map((r) => r.Rol);
    $('admBody').innerHTML = '<div class="card wide"><div class="card-head"><h2>&#128100; Usuarios</h2>'
      + '<button class="btn" id="uNuevo">+ Usuario</button></div>'
      + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="hide-sm">ID</th><th>Nombre</th><th>Rol</th>'
      + '<th class="tc">Estado</th><th></th></tr></thead><tbody>'
      + lista.map((u) =>
        '<tr><td class="hide-sm">' + u.ID_Usuario + '</td><td>' + esc(u.Nombre) + '<div class="sub-sm">' + esc(u.Email || '') + '</div></td>'
        + '<td>' + esc(u.Rol) + '</td><td class="tc"><span class="badge ' + (String(u.Estado).toLowerCase() === 'activo' ? 'on' : 'off') + '">' + u.Estado + '</span></td>'
        + '<td class="acts"><button class="mini" onclick=\'editarUsuario(' + JSON.stringify(u).replace(/'/g, '&#39;') + ')\'>&#9998;</button>'
        + '<button class="mini danger" onclick="eliminarUsuario(' + u._row + ')">&#128465;</button></td></tr>'
      ).join('') + '</tbody></table></div></div>';
    $('uNuevo').addEventListener('click', () => editarUsuario(null));
  } catch (e) { $('admBody').innerHTML = '<div class="placeholder"><p>' + esc(e.message) + '</p></div>'; }
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
    + '<label class="lbl">PIN ' + (esNuevo ? '' : '(vacío = no cambiar)') + '</label><input id="mPin" class="inp" type="password" inputmode="numeric" placeholder="••••">'
    + '<div id="mMsg" class="msg"></div><div class="modal-acts"><button class="btn ghost" onclick="cerrarModal()">Cancelar</button>'
    + '<button class="btn" id="uGuardar">Guardar</button></div></div>');
  $('uGuardar').addEventListener('click', () => salvarUsuario(u ? u._row : null));
}
async function salvarUsuario(row) {
  const msg = $('mMsg'); msg.innerHTML = 'Guardando...';
  try {
    const d = { _row: row || null, Nombre: val('mNombre'), Email: val('mEmail'), Rol: val('mRol'), PIN: val('mPin') };
    if ($('mEstado')) d.Estado = val('mEstado');
    await api('guardarUsuario', d);
    cerrarModal(); tabUsuarios();
  } catch (e) { msg.innerHTML = '<span class="err">' + esc(e.message) + '</span>'; }
}
async function eliminarUsuario(row) {
  if (!confirm('¿Eliminar este usuario?')) return;
  try { await api('eliminarUsuario', { row }); tabUsuarios(); } catch (e) { alert(e.message); }
}
const PERM = ['Ventas', 'Inventario', 'Compras', 'Clientes', 'Proveedores', 'Dashboard', 'Admin_Usuarios'];
async function tabRoles() {
  $('admBody').innerHTML = '<p class="loading">Cargando...</p>';
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
  } catch (e) { $('admBody').innerHTML = '<div class="placeholder"><p>' + esc(e.message) + '</p></div>'; }
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
  const msg = $('rMsg'); msg.innerHTML = 'Guardando...';
  try {
    const d = { _row: row || null, Rol: val('rNombre'), Descripcion: val('rDesc') };
    PERM.forEach((p) => { d[p] = $('chk_' + p).checked; });
    await api('guardarRol', d);
    cerrarModal(); tabRoles();
  } catch (e) { msg.innerHTML = '<span class="err">' + esc(e.message) + '</span>'; }
}
async function eliminarRol(row) {
  if (!confirm('¿Eliminar este rol?')) return;
  try { await api('eliminarRol', { row }); tabRoles(); } catch (e) { alert(e.message); }
}
