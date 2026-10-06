// Agrupa los 636 montes por acotado y saca lo que realmente se puede.
// NO modifica nada del proyecto.

const https = require('https');

function bajar(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'MicoHunter-check/1.0' } }, (r) => {
      let d = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { d += c; });
      r.on('end', () => res({ status: r.statusCode, body: d }));
    }).on('error', rej);
  });
}

(async () => {
  const j = JSON.parse((await bajar('https://www.micocyl.es/tramos.geojson')).body);

  // 1 · Agrupar por `area`, que es donde viene el codigo oficial.
  const porArea = new Map();
  for (const f of j.features) {
    const p = f.properties || {};
    const area = (p.area || '').trim();
    if (!area) continue;
    if (!porArea.has(area)) porArea.set(area, []);
    porArea.get(area).push(f);
  }

  console.log('=== 1 · CUANTOS ACOTADOS HAY ===');
  console.log('  ' + porArea.size + ' areas distintas en 636 montes');
  console.log('');

  // 2 · Centroide real de cada acotado, con sus montes.
  console.log('=== 2 · LOS ACOTADOS CON SU CENTROIDE REAL ===');
  console.log('  (centro = promedio de los puntos reales de sus montes)');
  console.log('');
  console.log('  acotado                                  montes   lat        lng');

  const filas = [];
  for (const [area, feats] of porArea) {
    const pts = feats
      .filter(f => f.geometry && f.geometry.type === 'Point'
        && Array.isArray(f.geometry.coordinates))
      .map(f => f.geometry.coordinates);
    if (!pts.length) continue;
    const lat = pts.reduce((a, c) => a + c[1], 0) / pts.length;
    const lng = pts.reduce((a, c) => a + c[0], 0) / pts.length;
    filas.push({ area, n: feats.length, lat, lng });
  }
  filas.sort((a, b) => a.area.localeCompare(b.area));
  filas.forEach(f => {
    console.log('  ' + f.area.slice(0, 38).padEnd(39)
      + String(f.n).padStart(4)
      + '  ' + f.lat.toFixed(4).padStart(8)
      + '  ' + f.lng.toFixed(4).padStart(9));
  });

  console.log('');
  console.log('=== 3 · ¿CUANTOS TIENEN CODIGO OFICIAL? ===');
  const conCodigo = filas.filter(f => /[A-Z]{2,4}-\d{2}[.\-]?\d{3}/.test(f.area));
  console.log('  ' + conCodigo.length + ' de ' + filas.length + ' tienen código tipo VA-50.001');
  console.log('');
  conCodigo.forEach(f => {
    const m = f.area.match(/([A-Z]{2,4}-\d{2}[.\-]?\d{3})\s*(.*)/);
    console.log('  ' + m[1].padEnd(14) + m[2].slice(0, 46)
      + '   ' + f.lat.toFixed(3) + ', ' + f.lng.toFixed(3)
      + '   (' + f.n + ' montes)');
  });

  console.log('');
  console.log('=== 4 · LA FICHA COMPLETA DE UN MONTE (json-monte) ===');
  const uno = j.features.find(f => /Gredos/i.test((f.properties || {}).area || ''));
  if (uno) {
    const r = await bajar('https://www.micocyl.es/json-monte/' + uno.properties.nid);
    try {
      const d = JSON.parse(r.body);
      const x = d[0] || {};
      const limpio = {};
      for (const k of Object.keys(x)) {
        let v = x[k];
        if (typeof v === 'string' && v.length > 70) v = v.slice(0, 70) + '…';
        limpio[k] = v;
      }
      console.log('  nid ' + uno.properties.nid + ' · ' + uno.properties.name);
      console.log(JSON.stringify(limpio, null, 1).slice(0, 1500));
    } catch (e) {
      console.log('  estado ' + r.status + ', no se pudo leer: ' + r.body.slice(0, 150));
    }
  }
})();