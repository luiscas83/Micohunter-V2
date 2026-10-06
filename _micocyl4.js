// Prueba las exportaciones que anuncia el propio visor del Micocyl.
// Una peticion en vez de 636. NO modifica nada del proyecto.

const https = require('https');

function bajar(url) {
  return new Promise((res) => {
    https.get(url, { headers: { 'User-Agent': 'MicoHunter-check/1.0' } }, (r) => {
      const trozos = [];
      r.on('data', (c) => trozos.push(c));
      r.on('end', () => res({
        status: r.statusCode,
        type: r.headers['content-type'],
        body: Buffer.concat(trozos),
      }));
    }).on('error', (e) => res({ status: 0, type: '', body: Buffer.from(''), err: String(e.message) }));
  });
}

const RUTAS = [
  'https://www.micocyl.es/export-tramos-csv-sin-geo',
  'https://www.micocyl.es/export-tramos-sin-geo',
];

(async () => {
  for (const url of RUTAS) {
    const r = await bajar(url);
    console.log('=== ' + url.replace('https://www.micocyl.es', '') + ' ===');
    console.log('  estado : ' + r.status);
    console.log('  tipo   : ' + r.type);
    console.log('  bytes  : ' + r.body.length);
    if (r.status !== 200) { console.log(''); continue; }

    const txt = r.body.toString('utf8');
    const lineas = txt.split(/\r?\n/).filter((x) => x.trim());
    console.log('  lineas : ' + lineas.length);

    // Cabecera: los nombres de campo.
    const sep = lineas[0].includes(';') ? ';' : ',';
    const cab = lineas[0].split(sep);
    console.log('  campos : ' + cab.length);
    console.log('  ' + cab.map((c) => c.trim().slice(0, 28)).join(' | '));
    console.log('');
    console.log('  primera fila:');
    console.log('  ' + lineas[1].split(sep).map((c) => c.trim().slice(0, 40)).join(' | ').slice(0, 400));
    console.log('');
    if (lineas.length > 3) {
      console.log('  segunda fila:');
      console.log('  ' + lineas[2].split(sep).map((c) => c.trim().slice(0, 40)).join(' | ').slice(0, 400));
    }
    console.log('');
    return;   // con el primero que funcione basta
  }
})();