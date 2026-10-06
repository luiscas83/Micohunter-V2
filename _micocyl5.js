// Construye el fichero de cotos: geometria real del geojson + municipios y
// propietario de cada monte desde json-monte. Una vez, con concurrencia
// limitada. NO modifica nada del proyecto: solo escribe micocyl_cotos.json.

const https = require('https');
const fs = require('fs');

const CONCURRENCIA = 8;
const ESPERA_MS = 2500;   // techo por peticion

function bajar(url) {
  return new Promise((res) => {
    const t = setTimeout(() => res(null), ESPERA_MS);
    https.get(url, { headers: { 'User-Agent': 'MicoHunter-check/1.0' } }, (r) => {
      let d = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { d += c; });
      r.on('end', () => {
        clearTimeout(t);
        if (r.statusCode !== 200) { res(null); return; }
        try { res(JSON.parse(d)); } catch (e) { res(null); }
      });
    }).on('error', () => { clearTimeout(t); res(null); });
  });
}

const limpiar = (s) => String(s || '')
  .replace(/\r/g, '')
  .replace(/\s*,\s*/g, ',')
  .replace(/\s+/g, ' ')
  .trim();

(async () => {
  console.log('=== 1 · geojson ===');
  const gj = await bajar('https://www.micocyl.es/tramos.geojson');
  if (!gj || !gj.features) { console.log('  NO SE PUDO LEER'); return; }
  console.log('  ' + gj.features.length + ' montes');

  const porArea = new Map();
  for (const f of gj.features) {
    const p = f.properties || {};
    const area = limpiar(p.area);
    if (!area) continue;
    if (!porArea.has(area)) porArea.set(area, []);
    porArea.get(area).push({ nid: p.nid, nombre: limpiar(p.name), f });
  }
  const areas = [...porArea.keys()].sort();
  console.log('  ' + areas.length + ' acotados');

  console.log('');
  console.log('=== 2 · json-monte de los ' + gj.features.length + ' montes ===');
  const fichas = new Map();
  let hechos = 0, fallos = 0;

  for (let i = 0; i < areas.length; i++) {
    const area = areas[i];
    const montes = porArea.get(area);
    let k = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCIA, montes.length) },
      async () => {
        while (true) {
          const idx = k++;
          if (idx >= montes.length) return;
          const m = montes[idx];
          const j = await bajar('https://www.micocyl.es/json-monte/' + m.nid);
          if (j && j[0]) { fichas.set(m.nid, j[0]); hechos++; } else { fallos++; }
        }
      });
    await Promise.all(workers);
    console.log('  ' + String(i + 1).padStart(2) + '/' + areas.length + '  ' + area.slice(0, 46)
      + '  (' + fichas.size + ' fichas, ' + fallos + ' fallos)');
  }

  console.log('');
  console.log('=== 3 · montando el fichero ===');

  const ESP = {
    '54': 'Capuchina', '55': 'Colmenillas', '65': 'Hongo blanco, Ceps',
    '63': 'Hongo rojo, Ceps', '64': 'Hongo verano, Ceps', '66': 'Lansarón',
    '61': 'Llanegas', '57': 'Marzuelo', '62': 'Níscalo, Rovelló',
    '54b': '', '56': 'Rebozuelo', '60': 'Senderillas', '59': 'Seta de cardo',
  };

  const salida = [];
  for (const area of areas) {
    const montes = porArea.get(area);
    const pts = montes
      .filter((m) => m.f.geometry && m.f.geometry.type === 'Point')
      .map((m) => m.f.geometry.coordinates);

    const lat = pts.reduce((a, c) => a + c[1], 0) / pts.length;
    const lng = pts.reduce((a, c) => a + c[0], 0) / pts.length;

    const municipios = new Set();
    const propietarios = new Set();
    let sup = 0, supN = 0, act = '';
    const especies = new Set();
    const habitats = new Set();

    for (const m of montes) {
      const fx = fichas.get(m.nid);
      if (fx) {
        limpiar(fx.municipios).split(',').forEach((x) => { if (x) municipios.add(x); });
        if (limpiar(fx.propietario) && limpiar(fx.propietario).length < 80) {
          propietarios.add(limpiar(fx.propietario));
        }
        const s = parseFloat(String(fx.superficie).replace(',', '.'));
        if (Number.isFinite(s)) { sup += s; supN++; }
        if (!act && fx.actualizado) act = fx.actualizado;
      }
      const sp = String((m.f.properties || {}).Especies || '');
      sp.split('-').map((x) => x.trim()).filter(Boolean).forEach((x) => {
        if (ESP[x]) especies.add(ESP[x]);
      });
    }

    const cod = (area.match(/([A-Z]{2,4}-\d{2}[.\-]?\d{3})/) || [])[1] || null;
    const nombre = area
      .replace(/^Acotado\s+[A-Z]{2,4}-?[\d.\-]+\s*/i, '')
      .replace(/^Parque\s+Micol.gico\s+[A-Z]{2,4}-?[\d.\-]+\s*/i, '')
      .replace(/\s*\([A-Z]{2,4}-?[\d.\-]+\)\s*$/, '')
      .replace(/^Acotado\s+/i, '')
      .replace(/^Parque\s+Micol.gico\s+/i, '')
      .trim();

    salida.push({
      area,
      codigo: cod,
      nombre,
      esParque: /parque/i.test(area),
      montes: montes.length,
      lat: +lat.toFixed(5),
      lng: +lng.toFixed(5),
      municipios: [...municipios].sort(),
      propietarios: [...propietarios].sort().slice(0, 6),
      superficieHa: supN ? Math.round(sup) : null,
      superficieMontes: supN,
      especies: [...especies].sort(),
      actualizado: act,
    });
  }

  fs.writeFileSync('micocyl_cotos.json', JSON.stringify(salida, null, 1));
  console.log('  ' + salida.length + ' acotados escritos en micocyl_cotos.json');

  console.log('');
  console.log('=== 4 · resumen de lo que sale ===');
  salida.forEach((s) => {
    console.log('  ' + (s.codigo || 'SIN CODIGO').padEnd(14)
      + s.nombre.slice(0, 42).padEnd(44)
      + String(s.montes).padStart(3) + ' montes  '
      + String(s.municipios.length).padStart(2) + ' municipios  '
      + (s.superficieHa ? s.superficieHa + ' ha' : 'sin superficie'));
  });
})();