// Saca de cada acotado: los municipios (donde se saca el permiso), el
// propietario y los enlaces. Una peticion por acotado, con pausa entre medias.
// NO modifica nada del proyecto.

const https = require('https');
const fs = require('fs');

const PAUSA = 700;   // ms entre peticiones: no se machaca el servidor

function bajar(url) {
  return new Promise((res) => {
    https.get(url, { headers: { 'User-Agent': 'MicoHunter-check/1.0' } }, (r) => {
      let d = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { d += c; });
      r.on('end', () => res({ status: r.statusCode, body: d }));
    }).on('error', (e) => res({ status: 0, body: '', err: String(e.message) }));
  });
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function texto(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é')
    .replace(/&iacute;/g, 'í').replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú')
    .replace(/&ntilde;/g, 'ñ').replace(/&Aacute;/g, 'Á').replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// El nombre del area viene con el prefijo «Acotado …» o «Parque …».
// El slug real NO lleva el codigo ni las comas:
//   "Acotado VA-50.001 Torozos, Mayorga y Pinares de Valladolid"
//     -> torozos-mayorga-y-pinares-de-valladolid
// El primer intento de slug los dejaba dentro y daba 404 en 13 de 19.
function slugDe(area) {
  return area
    .replace(/^Acotado\s+[A-Z]{2,4}-?[\d.\-]+\s*/i, '')
    .replace(/^Acotado\s+/i, '')
    .replace(/^Parque\s+Micol.gico\s+[A-Z]{2,4}-?[\d.\-]+\s*/i, '')
    .replace(/^Parque\s+Micol.gico\s+/i, '')
    .replace(/^Parque\s+micol.gico\s+de\s+/i, '')
    .replace(/\s*\([A-Z]{2,4}-?[\d.\-]+\)\s*$/, '')
    .replace(/,|\[|\]|\(|\)/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

(async () => {
  const j = JSON.parse((await bajar('https://www.micocyl.es/tramos.geojson')).body);

  const porArea = new Map();
  for (const f of j.features) {
    const area = ((f.properties || {}).area || '').trim();
    if (!area) continue;
    if (!porArea.has(area)) porArea.set(area, []);
    porArea.get(area).push(f);
  }

  console.log('=== probando si el slug funciona ===');
  const areas = [...porArea.keys()].sort();
  const prueba = areas.find(a => /Gredos/.test(a));
  const slug = slugDe(prueba);
  const r = await bajar('https://www.micocyl.es/areas/' + slug);
  console.log('  area      : ' + prueba);
  console.log('  slug      : ' + slug);
  console.log('  estado    : ' + r.status);
  const t = texto(r.body);
  const m = t.match(/Los municipios incluidos en este acotado son:(.{0,600})/i)
    || t.match(/municipios(.{0,400})/i);
  console.log('  municipios: ' + (m ? m[1].trim().slice(0, 220) : 'NO ENCONTRADO'));
  console.log('');

  console.log('=== los 19, con su slug y su pagina ===');
  const out = [];
  for (const area of areas) {
    const s = slugDe(area);
    await esperar(PAUSA);
    const rr = await bajar('https://www.micocyl.es/areas/' + s);
    const tt = texto(rr.body);
    // Se buscan varias formulaciones: cada ficha esta maquetada a su manera.
    const mm = tt.match(/Los municipios incluidos en este acotado son:(.{0,700})/i)
      || tt.match(/municipios(?: incluidos| que forman)?[^:]{0,60}:\s*(.{0,700})/i)
      || tt.match(/Puntos de expedici.n(.{0,700})/i);
    out.push({ area, slug: s, estado: rr.status, municipios: mm ? mm[1].trim() : null });
    console.log('  ' + String(rr.status).padEnd(4) + s.slice(0, 46)
      + (mm ? '  ' + mm[1].trim().slice(0, 60) : '  (sin lista de municipios)'));
  }

  console.log('');
  console.log('=== resumen ===');
  const ok = out.filter(o => o.estado === 200);
  console.log('  paginas que responden 200: ' + ok.length + ' de ' + out.length);
  const conMun = out.filter(o => o.municipios);
  console.log('  con lista de municipios   : ' + conMun.length);

  fs.writeFileSync('micocyl_municipios.json', JSON.stringify(out, null, 1));
  console.log('  guardado en micocyl_municipios.json');
})();