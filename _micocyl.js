// Comprueba el endpoint de Micocyl y saca solo la estructura.
// NO modifica nada del proyecto.

const https = require('https');

function bajar(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'MicoHunter-check/1.0' } }, (r) => {
      let d = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { d += c; });
      r.on('end', () => res({ status: r.statusCode, type: r.headers['content-type'], body: d }));
    }).on('error', rej);
  });
}

(async () => {
  const r = await bajar('https://www.micocyl.es/tramos.geojson');
  console.log('=== 1 · la respuesta ===');
  console.log('  estado   : ' + r.status);
  console.log('  tipo     : ' + r.type);
  console.log('  bytes    : ' + r.body.length);

  let j;
  try { j = JSON.parse(r.body); } catch (e) {
    console.log('  NO ES JSON. Primeros 300:');
    console.log('  ' + r.body.slice(0, 300));
    return;
  }

  console.log('');
  console.log('=== 2 · estructura ===');
  console.log('  tipo     : ' + j.type);
  const feats = j.features || [];
  console.log('  features : ' + feats.length);

  if (!feats.length) {
    console.log('  hay alguna propiedad: ' + JSON.stringify(Object.keys(j)));
    return;
  }

  const f0 = feats[0];
  console.log('  geometria: ' + (f0.geometry ? f0.geometry.type : 'ninguna'));
  console.log('');
  console.log('=== 3 · propiedades de una feature (claves) ===');
  console.log('  ' + Object.keys(f0.properties).join(', '));

  console.log('');
  console.log('=== 4 · una feature de ejemplo, sin la geometria ===');
  const copia = Object.assign({}, f0.properties);
  for (const k of Object.keys(copia)) {
    if (typeof copia[k] === 'string' && copia[k].length > 60) copia[k] = copia[k].slice(0, 60) + '…';
  }
  console.log(JSON.stringify(copia, null, 1).slice(0, 1200));

  console.log('');
  console.log('=== 5 · los nombres de las 18 unidades reguladas ===');
  const nombres = new Map();
  for (const f of feats) {
    const p = f.properties || {};
    const n = p.unidad_regulada || p.title || p.name;
    if (n) {
      if (!nombres.has(n)) nombres.set(n, []);
      nombres.get(n).push(p.nid);
    }
  }
  let i = 0;
  for (const [n, ids] of nombres) {
    console.log('  ' + String(++i).padStart(2) + '. ' + n.slice(0, 60)
      + '   (' + ids.length + ' montes' + (ids.length === 1 ? ', nid ' + ids[0] : ')'));
    if (i >= 25) { console.log('  … y ' + (nombres.size - i) + ' más'); break; }
  }
  console.log('  TOTAL de unidades: ' + nombres.size);
})();