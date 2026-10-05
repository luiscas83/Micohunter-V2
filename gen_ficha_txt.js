/*
 * Genera un TXT con todo lo que influye en el indice de cada especie.
 *
 * Sale de los datos vivos de algoritmo.js, no de una copia: si el modelo
 * cambia, el fichero cambia. Se ejecuta con `node gen_ficha_txt.js`.
 *
 * El TXT lleva dos cosas: una tabla con todos los numeros juntos, para
 * comparar de un vistazo, y una ficha por especie con todo el detalle. La
 * tabla es lo util para cazar un valor raro; la ficha, para leer el contexto
 * de uno.
 *
 * Al final se comprueban las invariantes del modelo (tCrit < tBase < tOpt <
 * tMax) y se listan los avisos, que es justo lo que se quiere verificar.
 */

const fs = require('fs');
const path = require('path');
const A = require(path.join(__dirname, 'algoritmo.js'));

const SALIDA = process.argv[2]
  || path.join(process.env.USERPROFILE || '.', 'Desktop', 'MicoHunter-parametros.txt');

const n = (v, d = 1) => (v == null ? '—' : Number(v).toFixed(d).replace('.', ','));
const pct = (v) => (v == null ? '—' : Math.round(v * 100) + '%');
const si = (v) => (v ? 'sí' : 'no');
const lista = (a) => (Array.isArray(a) && a.length ? a.join(', ') : '—');

/**
 * Los decimales en coma, también en las tablas.
 *
 * La primera versión usaba String(sp.tOpt) y salía «13.2», que en un
 * documento español se lee como un millón o como un descuido. Y el ancho de
 * columna recortaba los nombres a media palabra («Boleto bronce / Hongo ne»),
 * que es peor que no acortar: se pierde la letra que dice qué especie es.
 *
 * `decimales` fija cuántos decimales se muestran. Sin él, un 1 salía «1» al
 * lado de un «0,55» en la misma columna, que parece un descuido de formato
 * aunque el número sea el correcto.
 */
const num = (v, ancho, decimales) => {
  const t = (v == null ? '—'
    : decimales != null ? Number(v).toFixed(decimales).replace('.', ',')
      : String(v).replace('.', ','));
  return t.padStart(ancho);
};

/** Parte un texto en líneas de como mucho `ancho` caracteres, por palabras. */
const envolver = (texto, ancho) => {
  const palabras = String(texto).split(/\s+/).filter(Boolean);
  const lineas = [];
  let actual = '';
  for (const p of palabras) {
    if (!actual.length) actual = p;
    else if (actual.length + 1 + p.length <= ancho) actual += ' ' + p;
    else { lineas.push(actual); actual = p; }
  }
  if (actual.length) lineas.push(actual);
  return lineas.length ? lineas : [''];
};

/** Los hábitats son claves internas con guion bajo: «bosque_mixto». Para leer
 *  van como los muestra la tarjeta, con espacios y capitalizados. */
const corto2 = (t) => String(t).replace(/_/g, ' ');

/** Recorta con puntos suspensivos, no por la mitad de una palabra. */
const corto = (t, ancho) => {
  const s = String(t);
  if (s.length <= ancho) return s;
  const corte = s.slice(0, ancho - 1);
  const ultimo = corte.lastIndexOf(' ');
  return (ultimo > ancho * 0.5 ? corte.slice(0, ultimo) : corte) + '…';
};

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const meses = (t) => (Array.isArray(t) && t.length
  ? t.map((m) => MESES[m - 1]).join('-')
  : '—');

/** El perfil de pH que le toca a la especie, tal y como lo aplica factorSuelo. */
function perfilPH(sp) {
  if (sp.pHTolerante) return { nombre: 'tolerante', opt: 5.6, meseta: 3.4, suelo: 0.85 };
  if (sp.acidofilo) return { nombre: 'acidófila', opt: 5.2, meseta: 1.5, suelo: 0.60 };
  if (sp.alcalinofila) return { nombre: 'alcalinófila', opt: 7.6, meseta: 1.4, suelo: 0.60 };
  return { nombre: 'indiferente', opt: 6.8, meseta: 1.8, suelo: 0.70 };
}

const L = [];
const w = (s = '') => L.push(s);

/* ══════════════════════════════════════════════════════════════════════
   CABECERA
   ══════════════════════════════════════════════════════════════════════ */

w('╔══════════════════════════════════════════════════════════════════════╗');
w('║  MicoHunter · Todos los parámetros que entran en el índice           ║');
w('╚══════════════════════════════════════════════════════════════════════╝');
w('');
w('Generado:  ' + new Date().toLocaleString('es-ES'));
w('Origen:    algoritmo.js, array SPECIES (' + A.SPECIES.length + ' especies)');
w('Cómo leer: las cifras son las que usa el motor tal cual, sin redondear.');
w('           Lo que viene de una fuente lleva la etiqueta de evidencia; lo');
w('           que es un valor de partida para arrancar el modelo, no.');
w('');
w('La fórmula, para tenerla delante mientras se revisa:');
w('');
w('   I = 100 · S · H^0.5 · A · T · F_habitat · F_suelo · F_altitud · F_helada · F_ensuciable');
w('');
w('   S  potencial estacional por temperatura del suelo (0-1)');
w('   H  reserva de humedad del suelo (0-1)');
w('   A  potencial de acumulación (los grados-día que necesita, recortados por la ventana)');
w('   T  ventana de temperatura documentada para la especie');
w('');
w('Qué es cada etiqueta de evidencia:');
w('   PUBLICADO  los umbrales están medidos en campo. Solo el boleto.');
w('   DERIVADO   temporada, hospedante y sustrato documentados; los umbrales');
w('              numéricos se deducen de esa ventana.');
w('   ESTIMADO   sin temporada verificada en la fuente; valores de partida.');
w('');

/* ══════════════════════════════════════════════════════════════════════
   PARTE 1 · TABLA GENERAL
   ══════════════════════════════════════════════════════════════════════ */

w('══════════════════════════════════════════════════════════════════════');
w('  1 · TODAS LAS ESPECIES EN UNA TABLA');
w('══════════════════════════════════════════════════════════════════════');
w('');
w('── Térmico y acumulación ' + '─'.repeat(50));
w('');
w('  #  Especie                     Latín                       tB     tO     tX     tC   anch    gdd  días  °C/día');
w('  ' + '─'.repeat(98));

A.SPECIES.forEach((sp, i) => {
  const ancho = n(sp.tMax - sp.tBase, 0);
  const porDia = n(sp.gddNeed / sp.diasMax, 2);
  w('  ' + String(i + 1).padStart(2)
    + ' ' + corto(sp.es, 28).padEnd(28)
    + ' ' + corto(sp.lat, 27).padEnd(27)
    + num(sp.tBase, 5)
    + num(sp.tOpt, 6)
    + num(sp.tMax, 6)
    + num(sp.tCrit, 6)
    + ' ' + ancho.padStart(5)
    + num(sp.gddNeed, 6)
    + num(sp.diasMax, 5)
    + ' ' + porDia.padStart(7));
});

w('');
w('  tB = tBase (arranque)   tO = tOpt (óptimo)   tX = tMax (techo)');
w('  tC = tCrit (mínima absoluta)   anch = anchura de la ventana, tMax − tBase');
w('  gdd = grados-día que necesita   días = ventana máxima de acumulación');
w('  °C/día = gdd ÷ días, el ritmo de calentamiento que necesita por día.');
w('        Es un número derivado, no un parámetro: sirve para comparar');
w('        especies que tienen ventanas de distinta duración.');
w('');

w('── Suelo e altitud ' + '─'.repeat(58));
w('');
w('  #  Especie                     banda óptima    margen  altSuelo  perfil pH    ác.  alcal. toler.');
w('  ' + '─'.repeat(94));

A.SPECIES.forEach((sp, i) => {
  const ph = perfilPH(sp);
  const banda = (sp.alt || []).slice(0, 2).join('-') + ' m';
  w('  ' + String(i + 1).padStart(2)
    + ' ' + corto(sp.es, 28).padEnd(28)
    + ' ' + banda.padEnd(16)
    + num((sp.alt || [])[2], 7)
    + num(sp.altSuelo, 10, 2)
    + '  ' + ph.nombre.padEnd(13)
    + ' ' + si(sp.acidofilo).padEnd(5)
    + ' ' + si(sp.alcalinofila).padEnd(6)
    + ' ' + si(sp.pHTolerante));
});

w('');
w('  Los cuatro perfiles de pH, con los valores que aplica el motor:');
w('  acidófila   óptimo 5,2  meseta ±1,5  suelo 0,60');
w('  alcalinófila óptimo 7,6  meseta ±1,4  suelo 0,60');
w('  indiferente óptimo 6,8  meseta ±1,8  suelo 0,70');
w('  tolerante   óptimo 5,6  meseta ±3,4  suelo 0,85');
w('');
w('  Dentro de la meseta el factor de suelo es 1,00. Fuera decae 1 punto');
w('  por cada 2,2 de pH de distancia, con el suelo como suelo del factor.');
w('');

w('');
w('── Hábitat: los cuatro casos, y sólo uno veta ──');
w('');
w('  1,00  la cobertura local coincide con un hábitat principal');
w('  0,60  coincide con un hábitat secundario');
w('  0,00  NO COINCIDE y la fuente lo ha cartografiado. VETO. La tarjeta lo');
w('        dice con «fuera de su hábitat». Si el MFE dice robledal y la ficha');
w('        dice pradera, ahí no crece.');
w('  0,70  sin dato de cobertura. NO es un veto: es no saber, y no saber no');
w('        puede anular nada. Es lo que sale en un punto sin cartografiar.');
w('  0,00  núcleo urbano, por densidad de edificios en OpenStreetMap.');
w('');
w('  El veto se aplica porque el hábitat viene del MFE en dos capas oficiales');
w('  y porque se ha comprobado que ninguna de las ' + A.SPECIES.length);
w('  especies se queda sin salida. Lo que NO se veta es la falta de dato: si el');
w('  veto fuera antes, todo punto sin cartografiar sacaría a las');
w('  ' + A.SPECIES.length + ' y no aparecería ninguna.');
w('');
w('  El `confinado` que se eliminó con el veto valía 0,05 en el desajuste, que');
w('  es una forma de decir «casi no» cuando se quería decir «nada». Además');
w('  ninguna ficha lo tenía marcado: nunca hizo nada.');
w('');
w('  Consecuencia asumida: el veto es tan estricto como las fichas. En una');
w('  dehesa de la Extremadura el MFE dice «dehesa» y sólo hay una especie que la');
w('  acepte, así que las otras ' + (A.SPECIES.length - 1) + ' salen a 0.');
w('');
w('');
w('-- Datos de la tarjeta que NO entran en el modelo --');
w('');
w('  La tarjeta de suelo y clima ense\u00f1a cinco datos que son INSTANT\u00e1NEOS, no medias:');
w('');
w('    temperatura del aire ahora    \u00b0C');
w('    humedad del aire ahora        %');
w('    humedad del suelo ahora       %');
w('    temperatura del suelo ahora   \u00b0C');
w('    lluvia del \u00faltimo d\u00eda completo     mm');
w('');
w('  Vienen del bloque `current` de Open-Meteo, que da el valor de la hora en');
w('  curso con intervalo de 15 minutos. No se sacan del array horario a prop\u00f3sito:');
w('  con `forecast_days=1` la \u00faltima hora de ese array son las 23:00 del d\u00eda en');
w('  curso, que a las 21:15 son casi dos horas por delante y son previsi\u00f3n.');
w('');
w('  NINGUNO ENTRA EN EL MODELO. El factor de h\u00e1bitat es el mismo con la tarjeta');
w('  que sin ella, y el \u00edndice no depende de ellos. Se documentan aqu\u00ed para que');
w('  quede claro que son informaci\u00f3n de contexto y no par\u00e1metros.');
w('');
w('  Dos avisos de unidades, que son donde estos datos se pueden liar:');
w('');
w('    La humedad del suelo llega en m\u00b3/m\u00b3 (fracci\u00f3n volum\u00e9trica, de 0 a 1).');
w('    Medido en Soria: 0,215, que es un 21,5 %. El modelo guarda la fracci\u00f3n tal');
w('    cual y la conversi\u00f3n a porcentaje se hace al pintar, en app.js.');
w('');
w('    La profundidad del suelo no es fija: 18 cm si la fuente manda ese campo,');
w('    6 cm si no. La tarjeta lo dice en la etiqueta, no s\u00f3lo en el tooltip.');
w('');
w('  Se quit\u00f3 el campo D\u00eda del a\u00f1o: no lo le\u00eda nadie, as\u00ed que detr\u00e1s de quitarlo');
w('  de la tarjeta se fueron tambi\u00e9n la funci\u00f3n `diaDelAnio()` y su entrada en el');
w('  glosario. `mes` sigue existiendo porque la ventana de temporada lo usa.');
w('── Helada ' + '─'.repeat(62));
w('');
w('  #  Especie                     tol.  penalty  recovery  suelo  ¿tolera?');
w('  ' + '─'.repeat(76));

A.SPECIES.forEach((sp, i) => {
  w('  ' + String(i + 1).padStart(2)
    + ' ' + corto(sp.es, 28).padEnd(28)
    + num(sp.frostTol, 6)
    + num(sp.frostPenalty, 8, 2)
    + num(sp.frostRecovery, 9)
    + num(sp.frostSoil, 6, 1)
    + '  ' + (sp.frostTol < 0 ? 'sí, tolera' : 'no, suffers'));
});

w('');
w('  tol. = temperatura mínima que no le hace daño, en °C de suelo');
w('  penalty = cuánto se le resta cuando la helada es más fuerte que eso');
w('  recovery = noches que tarda en recuperarse');
w('  suelo = a partir de qué temperatura de suelo empieza a sufrir');
w('');

w('── Ecología y ventana de temporada ' + '─'.repeat(40));
w('');
w('  #  Especie                     grupo              prio.  meses      evidencia  banda');
w('  ' + '─'.repeat(88));

A.SPECIES.forEach((sp, i) => {
  w('  ' + String(i + 1).padStart(2)
    + ' ' + corto(sp.es, 28).padEnd(28)
    + ' ' + corto(A.GUILD_LABELS[sp.guild] || sp.guild, 18).padEnd(18)
    + num(sp.prioridad, 5)
    + '  ' + meses(sp.temporada).padEnd(10)
    + ' ' + corto(sp.evidencia || '', 10).padEnd(10)
    + ' ' + (sp.altEvidencia || ''));
});

w('');
w('  prioridad: orden de desempate del ranking. Menor = aparece antes.');
w('  evidencia: de dónde salen los umbrales numéricos');
w('  banda: de dónde sale el rango de altitud');
w('');

/* ══════════════════════════════════════════════════════════════════════
   PARTE 2 · FICHA POR ESPECIE
   ═══════════════════════════════════════════════════════════════════════ */

w('══════════════════════════════════════════════════════════════════════');
w('  2 · FICHA POR ESPECIE');
w('══════════════════════════════════════════════════════════════════════');

const orden = A.porPrioridad(A.SPECIES.map((sp) => ({ sp })));

for (const { sp } of orden) {
  const ph = perfilPH(sp);
  const banda = sp.alt || [];

  w('');
  w('┌──────────────────────────────────────────────────────────────────────┐');
  w('│ ' + sp.es.toUpperCase() + '   ·   ' + sp.lat);
  if (sp.alias) w('│ alias: ' + sp.alias);
  w('│ clave interna: ' + sp.key + '     prioridad: ' + sp.prioridad);
  w('└──────────────────────────────────────────────────────────────────────┘');

  w('');
  w('  UMBRALES TÉRMICOS');
  w('    tBase  arranque, °C de suelo            ' + num(sp.tBase, 6));
  w('    tOpt   óptimo, °C de suelo              ' + num(sp.tOpt, 6));
  w('    tMax   techo, °C de suelo               ' + num(sp.tMax, 6));
  w('    tCrit  mínima absoluta, °C              ' + num(sp.tCrit, 6));
  w('    → ventana ' + sp.tBase + ' a ' + sp.tMax + ' °C   (anchura '
    + (sp.tMax - sp.tBase) + ')');
  w('    → evidencia: ' + (A.EVIDENCIA_LABELS[sp.evidencia] || sp.evidencia));

  w('');
  w('  ACUMULACIÓN');
  w('    gddNeed  grados-día para fructificar    ' + num(sp.gddNeed, 6));
  w('    diasMax  ventana máxima, días           ' + num(sp.diasMax, 6));
  w('    → ritmo necesario: ' + n(sp.gddNeed / sp.diasMax, 2)
    + ' °C/día sobre la base, si usara toda la ventana');

  w('');
  w('  AGUA');
  w('    L        constante de decaimiento       ' + num(sp.L, 6) + ' días');
  w('    Ro       lluvia que satura el factor    ' + num(sp.Ro, 6) + ' mm');
  w('    → ' + n(sp.Ro / sp.L, 1) + ' mm/día para no quedarse sin reserva');

  w('');
  w('  SUELO');
  w('    perfil de pH                            ' + ph.nombre.padEnd(12)
    + ' óptimo ' + n(ph.opt, 1) + ', meseta ±' + n(ph.meseta, 1)
    + ', suelo ' + n(ph.suelo, 2));
  w('    acidofila / alcalinófila / tolerante    '
    + si(sp.acidofilo) + ' / ' + si(sp.alcalinofila) + ' / ' + si(sp.pHTolerante));

  w('');
  w('  ALTITUD');
  w('    banda óptima                            '
    + banda.slice(0, 2).join(' a ') + ' m');
  w('    margen de decaimiento                   ' + num(banda[2], 6) + ' m');
  w('    altSuelo donde se detiene la curva      ' + num(sp.altSuelo, 6, 2));
  w('    evidencia                               ' + sp.altEvidencia);
  w('    procedencia');
  for (const linea of envolver(sp.altFuente || '—', 92)) w('      ' + linea);

  w('');
  w('  HELADA');
  w('    frostTol      tolera hasta              ' + num(sp.frostTol, 6) + ' °C');
  w('    frostPenalty  penalización              ' + num(sp.frostPenalty, 6, 2));
  w('    frostRecovery noches de recuperación     ' + num(sp.frostRecovery, 6));
  w('    frostSoil     a partir de               ' + num(sp.frostSoil, 6) + ' °C');

  w('');
  w('  ECOLOGÍA');
  w('    grupo                                     '
    + (A.GUILD_LABELS[sp.guild] || sp.guild) + '  (' + sp.guild + ')');
  w('    hospedantes admitidos                    '
    + lista((sp.habitat || []).map(corto2)));
  w('    temporada documentada                    ' + meses(sp.temporada));
  w('    sustrato                           '
    + (sp.substrate != null ? String(sp.substrate) : 'no modelado'));
  w('    no coloniza sotobosques secos de SO      ' + si(sp.avoidDrySW));
  w('    confinada a un hospedante                ' + si(sp.confined));
  w('    tóxica                                   ' + si(sp.toxica));
  w('    comestibilidad                           ' + (sp.comestible || '—'));

  if (sp.confusion) {
    w('');
    w('  CON QUÉ SE CONFUNDE');
    for (const linea of envolver(sp.confusion, 92)) w('    ' + linea);
  }
  if (sp.taxonomiaAviso) {
    w('');
    w('  TAXONOMÍA');
    for (const linea of envolver(sp.taxonomiaAviso, 92)) w('    ' + linea);
  }
  if (sp.aviso) {
    w('');
    w('  AVISO');
    for (const linea of envolver(sp.aviso, 92)) w('    ' + linea);
  }

  w('');
  w('  TEMPORADA, TEXTO DE LA FUENTE');
  for (const linea of envolver(sp.temporadaTxt || '—', 92)) w('    ' + linea);

  w('');
  w('  FUENTES');
  w('    en la ficha:');
  for (const linea of envolver(A.fuentesBreves(sp), 92)) w('      ' + linea);
  const fuenteNum = A.FUENTES_NUMERAS[sp.key];
  w('    parámetros numéricos: ' + (fuenteNum || 'sin fuente publicada; valores de partida'));
  // Los contrastes de Waldschatzfinder y Wikipedia son párrafos largos: sin
  // envolver salían líneas de 630 caracteres, inservibles en un TXT que se
  // abre en el Bloc de notas.
  if (A.CRUCE[sp.key]) {
    const c = A.CRUCE[sp.key];
    for (const [etiqueta, valor] of [['contraste Waldschatzfinder', c.ws],
      ['contraste Wikipedia', c.wiki], ['nota', c.nota]]) {
      if (!valor) continue;
      w('    ' + etiqueta + ':');
      for (const linea of envolver(valor, 92)) w('      ' + linea);
    }
  }
  w('');
  w('  CITA COMPLETA (la que se imprime en el apartado 4 de la Metodología)');
  // Se parte por ancho de línea, no por los puntos. La cita es el texto tal
  // cual lo escribió la fuente, y partirla por los puntos la deja con los
  // puntos pegados al final de la línea y corta frases a la mitad.
  for (const linea of envolver(String(sp.fuente || ''), 92)) w('    ' + linea);
}

/* ══════════════════════════════════════════════════════════════════════
   PARTE 3 · INVARIANTES Y AVISOS
   ═══════════════════════════════════════════════════════════════════════ */

w('');
w('');
w('══════════════════════════════════════════════════════════════════════');
w('  3 · INVARIANTES DEL MODELO');
w('══════════════════════════════════════════════════════════════════════');
w('');
w('Relaciones que el motor asume y que los tests comprueban en cada ficha:');
w('');
w('    tCrit < tBase < tOpt < tMax');
w('    0 < altSuelo ≤ 1,  y  margen > 0');
w('    gddNeed > 0,  diasMax > 0,  L > 0,  Ro > 0');
w('    0 < frostPenalty ≤ 1,  frostRecovery > 0');
w('');

const fallos = [];

for (const sp of A.SPECIES) {
  const p = [];
  if (!(sp.tCrit < sp.tBase)) p.push(`tCrit ${sp.tCrit} no es menor que tBase ${sp.tBase}`);
  if (!(sp.tBase < sp.tOpt)) p.push(`tBase ${sp.tBase} no es menor que tOpt ${sp.tOpt}`);
  if (!(sp.tOpt < sp.tMax)) p.push(`tOpt ${sp.tOpt} no es menor que tMax ${sp.tMax}`);
  if (!(sp.altSuelo > 0 && sp.altSuelo <= 1)) p.push(`altSuelo ${sp.altSuelo} fuera de (0, 1]`);
  if (!((sp.alt || [])[2] > 0)) p.push(`margen de altitud ${(sp.alt || [])[2]} no es positivo`);
  if (!(sp.gddNeed > 0)) p.push(`gddNeed ${sp.gddNeed} no es positivo`);
  if (!(sp.diasMax > 0)) p.push(`diasMax ${sp.diasMax} no es positivo`);
  if (!(sp.L > 0)) p.push(`L ${sp.L} no es positivo`);
  if (!(sp.Ro > 0)) p.push(`Ro ${sp.Ro} no es positivo`);
  if (!(sp.frostPenalty > 0 && sp.frostPenalty <= 1)) p.push(`frostPenalty ${sp.frostPenalty} fuera de (0, 1]`);
  if (!(sp.frostRecovery > 0)) p.push(`frostRecovery ${sp.frostRecovery} no es positivo`);
  if (!sp.guild) p.push('sin grupo ecológico');
  if (!Array.isArray(sp.habitat) || !sp.habitat.length) p.push('sin hospedantes');
  if (!Array.isArray(sp.temporada) || !sp.temporada.length) p.push('sin temporada');
  if (!Array.isArray(sp.alt) || sp.alt.length !== 3) p.push(`alt mal formada: ${JSON.stringify(sp.alt)}`);
  if (p.length) fallos.push({ sp, p });
}

if (fallos.length === 0) {
  w('  Todas las ' + A.SPECIES.length + ' especies cumplen las relaciones.');
} else {
  for (const f of fallos) {
    w('  ✗ ' + f.sp.es + ' (' + f.sp.key + ')');
    for (const x of f.p) w('      ' + x);
  }
}

w('');
w('── Otheras cosas que conviene mirar ' + '─'.repeat(45));
w('');

const sinFuenteNum = A.SPECIES.filter((s) => !A.FUENTES_NUMERAS[s.key]);
const conFuenteNum = A.SPECIES.filter((s) => A.FUENTES_NUMERAS[s.key]);

w('  Umbrales numéricos SIN fuente publicada: ' + sinFuenteNum.length + ' de ' + A.SPECIES.length);
w('    Son valores de partida del modelo. No tienen medición detrás:');
w('    ' + sinFuenteNum.map((s) => s.key).join(', '));
w('');
w('  Umbrales numéricos CON fuente citada: ' + conFuenteNum.length);
for (const s of conFuenteNum) {
  const lineas = envolver(s.key + ' → ' + A.FUENTES_NUMERAS[s.key], 92);
  w('    ' + lineas[0]);
  for (const extra of lineas.slice(1)) w('      ' + extra);
}
w('');

const pub = A.SPECIES.filter((s) => s.evidencia === 'publicado');
w('  PUBLICADO (medido en campo): ' + (pub.map((s) => s.key).join(', ') || 'ninguna'));
w('  DERIVADO:  ' + A.SPECIES.filter((s) => s.evidencia === 'derivado').map((s) => s.key).join(', '));
w('  ESTIMADO:  ' + A.SPECIES.filter((s) => s.evidencia === 'estimado').map((s) => s.key).join(', '));
w('');
w('  Reparto de perfiles de pH:');
for (const nombre of ['acidófila', 'alcalinófila', 'indiferente', 'tolerante']) {
  const grupo = A.SPECIES.filter((s) => perfilPH(s).nombre === nombre);
  w('    ' + nombre.padEnd(13) + String(grupo.length).padStart(2) + '  '
    + grupo.map((s) => s.key).join(', '));
}
w('');
w('  Reparto de evidencia altitudinal:');
for (const ev of ['documentado', 'indicado']) {
  const grupo = A.SPECIES.filter((s) => s.altEvidencia === ev);
  w('    ' + ev.padEnd(13) + String(grupo.length).padStart(2) + '  '
    + grupo.map((s) => s.key).join(', '));
}
w('');

// De dónde sale cada hábitat. Antes esta lista salía sin origen, y eso
// escondía el problema que había: nueve hábitats sólo podían venir de la
// heurística de coordenadas, que mira los decimales y no ha medido nada.
const H = require('./habitat.js');
const deCapas = new Set(H.MFE_CAPAS.map((c) => c.tag));
const deUso = new Set(Object.values(H.MFE_USO_TAGS).map((v) => v.tag));
const sinCapa = H.HABITATS_SIN_CAPA;

w('  Hábitats declarados, con la fuente que puede producirlos:');
const tags = [...new Set(A.SPECIES.flatMap((s) => s.habitat || []))].sort();
for (const t of tags) {
  const grupo = A.SPECIES.filter((s) => (s.habitat || []).includes(t));
  const origen = deCapas.has(t) ? 'MFE, capa forestal'
    : deUso.has(t) ? 'MFE, ff_uso'
    : sinCapa.has(t) ? 'sin capa: declarado'
    : t === 'olmedal' ? 'derivado de ribera'
    : 'SIN ORIGEN DECLARADO';
  w('    ' + corto2(t).padEnd(16) + String(grupo.length).padStart(2) + '  '
    + origen.padEnd(22) + grupo.map((s) => s.key).join(', '));
}
w('');
const sinOrigen = tags.filter((t) => !deCapas.has(t) && !deUso.has(t)
  && !sinCapa.has(t) && t !== 'olmedal');
w('    Hábitats sin origen declarado: '
  + (sinOrigen.length ? sinOrigen.join(', ') : 'ninguno'));
w('');
w('══════════════════════════════════════════════════════════════════════');
w('  Fin. ' + new Date().toLocaleString('es-ES'));
w('══════════════════════════════════════════════════════════════════════');

fs.writeFileSync(SALIDA, L.join('\r\n'), 'utf8');
console.log('Escrito: ' + SALIDA);
console.log('  ' + L.length + ' líneas, ' + fs.statSync(SALIDA).size + ' bytes');
console.log('  ' + A.SPECIES.length + ' especies, ' + fallos.length + ' con invariantes rotos');