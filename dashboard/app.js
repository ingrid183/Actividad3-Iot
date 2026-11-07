const $ = id => document.getElementById(id);
const config = window.RUTA_CONFIG || {};
const MAX_ROWS = 200;
let rows = [], charts = [], busy = false;

const url = path => config.API_URL.replace(/\/+$/, '') + path;
const headers = extra => Object.assign(config.API_KEY ? {'x-api-key': config.API_KEY} : {}, extra);
const date = d => d.toLocaleString('es-CO');

// DynamoDB puede devolver números como texto o con tipo ({"N": "26.5"}).
function plain(value) {
  if (value && typeof value === 'object') {
    for (const type of ['N', 'S', 'BOOL']) if (type in value) return value[type];
  }
  return value;
}

// timestamp del ESP32: segundos epoch. También se aceptan milisegundos o ISO.
function toDate(value) {
  value = plain(value);
  if (typeof value === 'string' && !/^\d+(\.\d+)?$/.test(value)) return new Date(value);
  const n = Number(value);
  return new Date(n < 1e12 ? n * 1000 : n);
}

function normalize(payload) {
  if (typeof payload?.body === 'string') payload = JSON.parse(payload.body);
  const list = Array.isArray(payload) ? payload : payload.items || payload.Items || payload.data || [];
  return list.map(item => {
    const row = Object.fromEntries(Object.entries(item).map(([k, v]) => [k, plain(v)]));
    return {
      date: toDate(row.timestamp ?? row.ts ?? row.measured_at),
      device: row.device_id ?? config.DEVICE_ID,
      temperature: Number(row.temperature ?? row.temperatura),
      humidity: Number(row.humidity ?? row.humedad)
    };
  }).filter(r => !isNaN(r.date) && isFinite(r.temperature) && isFinite(r.humidity))
    .sort((a, b) => b.date - a.date);
}

function inPeriod(row) {
  const start = $('start').value && new Date($('start').value);
  const end = $('end').value && new Date($('end').value);
  return (!start || row.date >= start) && (!end || row.date <= end);
}

function renderReception(last) {
  $('liveStatus').className = 'warn';
  if (!last) {
    $('liveStatus').textContent = 'Todavía no hay mediciones del dispositivo.';
    return;
  }
  const age = Math.max(0, Math.floor((Date.now() - last.date) / 1000));
  if (age > 60) {
    $('liveStatus').textContent = `Sin recepción reciente · última medición: ${date(last.date)} · Comprueba que el ESP32 esté encendido y conectado.`;
  } else {
    $('liveStatus').className = 'live';
    $('liveStatus').textContent = `Recibiendo mediciones · última hace ${age} s.`;
  }
}

function renderCharts(list) {
  if (typeof Chart === 'undefined') return;
  for (const chart of charts) chart.destroy();
  const chronological = [...list].reverse();
  charts = [['temperatureChart', 'temperature', 'Temperatura', '#17766b'],
            ['humidityChart', 'humidity', 'Humedad', '#377cb5']].map(([id, key, label, color]) => new Chart($(id), {
    type: 'line',
    data: {labels: chronological.map(r => date(r.date)),
           datasets: [{label, data: chronological.map(r => r[key]), borderColor: color, tension: .2, pointRadius: 2}]},
    options: {responsive: true, maintainAspectRatio: false, animation: false,
              plugins: {legend: {display: false}}, scales: {x: {ticks: {maxTicksLimit: 6}}}}
  }));
}

function render() {
  const visible = rows.filter(inPeriod).slice(0, MAX_ROWS);
  const last = visible[0];
  $('temp').textContent = last ? last.temperature.toFixed(1) : '—';
  $('humidity').textContent = last ? last.humidity.toFixed(1) : '—';
  $('time').textContent = last ? date(last.date) : '—';
  $('unit').textContent = last ? `Dispositivo ${last.device}` : '—';
  $('status').className = '';
  $('status').textContent = visible.length ? `Consulta actualizada · ${visible.length} mediciones` : 'Sin datos en el período seleccionado';
  renderReception(rows[0]);
  $('rows').replaceChildren(...visible.map(r => {
    const tr = document.createElement('tr');
    for (const value of [date(r.date), r.device, r.temperature.toFixed(1) + ' °C', r.humidity.toFixed(1) + ' %']) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.append(td);
    }
    return tr;
  }));
  renderCharts(visible);
}

async function refresh() {
  if (busy) return;
  busy = true;
  try {
    const query = new URLSearchParams({device_id: config.DEVICE_ID});
    const response = await fetch(url(config.READINGS_PATH) + '?' + query, {headers: headers()});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    rows = normalize(await response.json());
    render();
  } catch (error) {
    $('status').textContent = 'Error al consultar la API: ' + error.message;
    $('status').className = 'error';
    $('liveStatus').textContent = 'No se puede comprobar la recepción. Los valores visibles corresponden a la última consulta correcta.';
    $('liveStatus').className = 'warn';
  } finally {
    busy = false;
  }
}

function downloadCsv() {
  const visible = rows.filter(inPeriod);
  const lines = [['fecha_iso', 'device_id', 'temperature', 'humidity'],
                 ...visible.map(r => [r.date.toISOString(), r.device, r.temperature, r.humidity])];
  const csv = lines.map(line => line.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob(['﻿' + csv], {type: 'text/csv;charset=utf-8'}));
  link.download = `lecturas_${config.DEVICE_ID}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function sendCommand(message) {
  $('actuatorStatus').className = '';
  $('actuatorStatus').textContent = `Enviando ${message}…`;
  for (const id of ['ledOn', 'ledOff']) $(id).disabled = true;
  try {
    const response = await fetch(url(config.ACTUATOR_PATH), {
      method: 'POST', headers: headers({'Content-Type': 'application/json'}), body: JSON.stringify({message})
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    $('actuatorStatus').className = 'live';
    $('actuatorStatus').textContent = `Estado: orden ${message === 'ON' ? 'encender' : 'apagar'} enviada a las ${date(new Date())}`;
  } catch (error) {
    $('actuatorStatus').className = 'error';
    $('actuatorStatus').textContent = 'No se pudo enviar la orden: ' + error.message;
  } finally {
    for (const id of ['ledOn', 'ledOff']) $(id).disabled = false;
  }
}

$('apply').onclick = render;
$('export').onclick = downloadCsv;
$('ledOn').onclick = () => sendCommand('ON');
$('ledOff').onclick = () => sendCommand('OFF');
if (!config.API_URL) {
  $('status').textContent = 'Falta configurar API_URL en config.js';
  $('status').className = 'error';
} else {
  refresh();
  setInterval(refresh, (config.REFRESH_SECONDS || 10) * 1000);
}
