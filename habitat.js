// ============================================================
// MicoHunter — servicio de hábitat real
// ============================================================
//
// POR QUÉ ESTE FICHERO EXISTE
//
// El motor necesita saber qué crece en el punto que el usuario ha pulsado, y
// hasta ahora no lo sabía de verdad: `inferirVegetacion()` en app.js sacaba
// una lista de bosques a partir de la latitud y la longitud, con seis `if`.
// Eso hace exactamente el error que más miente: una franja de la Sierra
// de Guadarrama devolvía "pinar, hayedo, robledal" tanto en un pinar real
// como en medio de la Plaza Mayor. El factor de hábitat daba 1.00 a un boletus
// en un pueblo, y la tarjeta se lo presenting como si el bosque real.
//
// Aquí se consulta el dato real. Dos fuentes, con papeles distintos:
//
//   1. MFE (Mapa Forestal de España, MITECO) servido por el GeoServer del
//      IEPNB. Dice qué TIPO DE BOSQUE hay en el punto y qué especies lo
//      forman. Es la fuente oficial y la buena para lo que importa.
//      Se consulta en dos capas del mismo servicio:
//        - unas treinta capas forestales, que dicen el tipo de bosque;
//        - `ff_uso`, que dice el USO DEL SUELO, y que es la que contesta
//          cuando no hay bosque: si lo que hay es pradera, cultivo o matorral.
//
//   2. OpenStreetMap vía Overpass. Sólo se consulta cuando el MFE no devuelve
//      bosque Y su capa de usos no da ninguna clase utilizable, y únicamente
//      para distinguir "nada" de "nada pero en una plaza": una ciudad, una
//      carretera o un polígono industrial. OSM es excelente en lo que ya está
//      cartografiado —las ciudades— y horrible en los pinares de montaña,
//      así que se usa justo para lo suyo.
//
// LO QUE NO SE HACE, Y ES UNA DECISIÓN
//  Cuando no hay dato, NO se devuelve un hábitat de reserva. Se devuelve la
//  lista vacía, que el motor lee como «sin datos de cobertura» y que la tarjeta
//  enseña como «Sin hábitat conocido». Antes se devolvía `['pradera']`, que
//  era una suposición y además tenía efectos: en cualquier punto sin bosque
//  cartografiado, las especies pratenses sacaban 1,00 y las demás 0,13. Un
//  dato que nadie midió no puede decidir un ranking.
//
// NOTAS SOBRE EL SERVICIO (aprendidas probando, no de la documentación):
//  - El parámetro `bbox` de WFS 2.0 NO filtra en este GeoServer: devuelve 0
//    features siempre. Hay que usar `CQL_FILTER=BBOX(geom,...)`.
//  - El atributo geométrico se llama `geom`. Con `the_geom` —que es lo que
//    usan la mayoría de GeoServer— el servidor responde HTTP 400.
//  - `INTERSECTS(geom, ENVELOPE(...))` también da 400. Sólo funciona BBOX.
//  - Las capas se declaran en el bloque `LAYERS` de GetCapabilities, pero
//    algunas no existen de verdad (`form_arbolada` da LayerNotDefined) y otras
//    no se pueden pedir. Por eso hay una lista blanca explícita abajo.
//  - El WMS de esas capas está vacío: dibuja 0 píxeles sobre toda España.
//    Por eso la vía buena es WFS, que sí devuelve la geometría.
//  - Medido: 30 consultas en paralelo tardan 0.4 s y no hay límite de tasa
//    apreciable para este tamaño. Aun así se cachea, porque un mapa se usa
//    arrastrando, no a clicks sueltos.
//
// LO QUE NO HACE
//  - No decide si una seta es comestible ni la identifica.
//  - No sustituye al campo: el MFE dice qué hay CRECIDO, no qué va a salir.

'use strict';

/* ------------------------------------------------------------------ */
/* Fuente 1: MFE — tipo de bosque                                     */
/* ------------------------------------------------------------------ */

const MFE_WFS = 'https://geoserver.iepnb.es/geoserver/wfs';
const MFE_CACHE_KEY = 'micohunter_habitat_cache';
const MFE_DIAS = 365 * 24 * 3600 * 1000;

/**
 * Lista blanca de capas del MFE y el hábitat del motor al que corresponde.
 *
 * Se descartan las capas que existen pero no aportan: `temporalmente_desarbolado`
 * y `repoblacion_quercus_rubra` son estados de gestión forestal, no hábitats, y
 * `coniferas_aloctonas_gestion` mezcla plantaciones industriales con lo demás.
 *
 * El vocabulario de la derecha es el mismo que ya usan `sp.habitat` en
 * algoritmo.js. No se inventan etiquetas nuevas porque `evaluarHabitat`
 * compara contra esa lista y una etiqueta desconocida puntuaría siempre bajo.
 */
const MFE_CAPAS = [
  // Coníferas: todo pinar, aunque la especie relevante la diga `nom_sp1`.
  { capa: 'pinar_pino_pinaster_reg_mediterranea', tag: 'pinar' },
  { capa: 'pinar_pino_pinaster_reg_atlantica',    tag: 'pinar' },
  { capa: 'pinar_pino_albar',                     tag: 'pinar' },
  { capa: 'pinar_pino_negro',                     tag: 'pinar' },
  { capa: 'pinar_pino_pinonero',                  tag: 'pinar' },
  { capa: 'pinar_pino_radiata',                   tag: 'pinar' },

  // Frondosas.
  { capa: 'hayedos',                            tag: 'hayedo' },
  { capa: 'robledales_qrobur_qpetraea',         tag: 'robledal' },
  { capa: 'robledales_roble_pubescente',        tag: 'robledal' },
  { capa: 'melojares',                          tag: 'robledal' },
  { capa: 'castanares',                         tag: 'castaneral' },
  { capa: 'fresnedas',                          tag: 'fresnedal' },
  { capa: 'encinares',                          tag: 'encinar' },
  { capa: 'quejigares',                         tag: 'encinar' },
  { capa: 'madronales',                         tag: 'matorral' },
  { capa: 'abedulares',                         tag: 'bosque_mixto' },
  { capa: 'abetales',                           tag: 'bosque_mixto' },
  { capa: 'avellanedas',                        tag: 'bosque_mixto' },

  // Dehesas y matorral mediterráneo. El alcornocal se trata como dehesa:
  // es un sistema de montebravo con ganado, que es lo que importa para el
  // hábitat, no el hecho de que el árbol sea un Quercus suber.
  { capa: 'dehesas',          tag: 'dehesa' },
  { capa: 'alcornocales',     tag: 'dehesa' },
  { capa: 'fayal_brezal',     tag: 'matorral' },
  { capa: 'enebrales',        tag: 'matorral' },

  // Lauretum canario.
  { capa: 'laurisilvas_macaronesicas', tag: 'bosque_mixto' },

  // Arbolado de ribera: un hábitat propio, y es donde salen las setas de
  // tronco. Además, si el árbol dominante es un olmo se marca también olmedal,
  // porque ese hábitat sí lo tienen las especies de olmeda.
  { capa: 'bosque_ribereno', tag: 'ribera' },

  // Plantaciones. El chopo y el plátano de producción no son un bosque
  // natural: se marcan como `perturbado` para que no den un 1.00 plano a
  // una micorrícica que en realidad no prospera ahí.
  { capa: 'eucaliptales',                   tag: 'perturbado' },
  { capa: 'choperas_plataneras_produccion', tag: 'perturbado' },

  // Bosques mixtos: el MFE los separa por región biogeográfica, pero para el
  // motor es el mismo hecho: no es ni un pinar puro ni un hayedo puro.
  { capa: 'bosques_mixtos_frondosas_mediterraneo',              tag: 'bosque_mixto' },
  { capa: 'bosques_mixtos_frondosas_autoc_regobio_atlantica',    tag: 'bosque_mixto' },
  { capa: 'mezcla_coniferas_frondosas_autoc_regbio_mediterraneo', tag: 'bosque_mixto' },
  { capa: 'mezcla_coniferas_frondosas_autoc_regbio_alpina',      tag: 'bosque_mixto' },
];

/**
 * Hábitats que implican árbol. Se usan para lo contrario: cuando el MFE
 * responde y NO encuentra ninguno, la lista no puede incluir ninguno.
 */
const HABITATS_ARBOLADOS = new Set([
  'pinar', 'hayedo', 'robledal', 'castaneral', 'fresnedal', 'encinar',
  'dehesa', 'bosque_mixto', 'ribera', 'olmedal', 'perturbado',
]);

/* ------------------------------------------------------------------ */
/* Fuente 1b: MFE, capa de usos del suelo — ¿y si no hay bosque?       */
/* ------------------------------------------------------------------ */

/**
 * MFE USOS DEL SUELO (`ff_uso`), la capa que faltaba.
 *
 * EL PROBLEMA QUE RESUELVE. `MFE_CAPAS` pregunta por ~30 capas *forestales*.
 * Cuando ninguna coincide, el código asumía «campo abierto» y devolvía
 * `['pradera']`: una suposición, no un dato. Con ello, en cualquier punto sin
 * bosque cartografiado, las especies pratenses sacaban factor 1,00 y las demás
 * 0,13, por un hábitat que nadie había medido. Y dos especies —senderuela y
 * champiñón silvestre, que viven en pradera y nowhere más— no tenían NINGÚN
 * tipo de bosque que el MFE les pudiera confirmar jamás, porque un mapa
 * forestal no dice «pradera»: no dice nada.
 *
 * LA MISMA FUENTE. No es una API nueva: es el mismo MFE del MITECO, servido
 * por el mismo GeoServer del IEPNB, con el mismo `CQL_FILTER=BBOX(geom,…)`
 * que ya funciona. La capa estaba declarada en GetCapabilities desde el
 * principio y el proyecto nunca la pidió.
 *
 * MEDIDO. En cajas de 120 m de radio sale en 6 de 10 puntos de prueba, con
 * 100-156 polígonos en cajas de 2 km. Hay huecos: en la playa de Gijón no hay
 * ni un polígono, así que esta capa no sustituye a la anterior, la suple.
 *
 * EL ATRIBUTO GEOMÉTRICO SE LLAMA `geom`, no `the_geom`. En esta capa
 * `the_geom` da error y en las capas forestales también, así que no es una
 * diferencia: es el mismo nombre en todas.
 */
const MFE_USO_CAPA = 'ff_uso';

/** Los campos que se piden: la clase oficial y el código normalizado. */
const MFE_USO_PROPS =
  'descr_uso_pda,nb_claifin,nb_lulucf_nivel1,nb_lulucf_nivel2,descr_forarb';

/**
 * Del vocabulario oficial del MFE al del motor, con un peso para ordenar.
 *
 * El peso va de 1 a 5 porque en una caja de 120 m caben varias clases a la vez:
 * en Babia (pastoreo, León) salen a la vez `GLg` (pastizal herbáceo), `GLs`
 * (pastizal arbustivo) y `FLb` (frondosas). Se ordenan para que el primer
 * hábitat de la lista sea el que mejor explica por qué puede salir una seta.
 *
 * Lo que NO está en esta tabla, y por qué:
 *
 *   Tierras forestales (FL), Frondosas (FLb), Coníferas (FLc)
 *       El bosque lo pone la lista blanca de arriba, que pregunta por el tipo
 *       de bosque de verdad. Aquí el código LULUCF es demasiado genérico: si
 *       esta capa dice «Frondosas» y la lista blanca no ha encontrado nada,
 *       es que la lista blanca está incompleta, y decirlo es mejor que fingir
 *       que aquí no hay árbol. Se recoge aparte, en `bosqueSinReconocer`.
 *
 *   Asentamientos o artificial (SL)
 *       NO se traduce a urbano, y esto es deliberado. Medido: el Retiro de
 *       Madrid sale en esta capa como `Artificial`, y el Retiro es un parque
 *       con hierba donde sí fructifica. Marcarlo urbano sería el mismo error
 *       que el proyecto ya corrigió, sólo que al revés. Quien decide si un
 *       sitio es una ciudad sigue siendo la densidad de edificios de OSM.
 *
 *   Humedales (WL), Agua, Otras tierras (OL)
 *       No son un hábitat de seta y no se traducen. Se listan en `descartado`
 *       para que se pueda ver que hubo respuesta y qué dijo.
 */
const MFE_USO_TAGS = {
  'Pastizales con vegetación herbácea (GLg)': { tag: 'pradera', peso: 1 },
  'Pastizales con vegetación arbórea (GLw)': { tag: 'pradera', peso: 2 },
  'Pastizales con vegetación arbustiva (GLs)': { tag: 'matorral', peso: 3 },
  'Pastizales (GL)': { tag: 'pradera', peso: 4 },
  'Tierras de cultivo (CL)': { tag: 'cultivo', peso: 5 },
};

/**
 * Códigos que son bosque pero que la lista blanca no sabe nombrar.
 *
 * Si alguno sale, la lista blanca se quedó corta: hay árbol y la capa lo sabe,
 * pero no se sabe de qué clase. No se inventa un hábitat. Se anota para poder
 * verlo, y el motor se queda como estaba.
 *
 * `Mixto (FLm)` aparece medido en un pinar real de Segovia, junto a `pinar`, en
 * la misma caja de 120 m: son parcelas de árbol joven mezcladas con el pinar
 * maduro. No es un error del MFE, es que la parcelaria distingue el árbol
 * joven como categoría propia y el motor no la necesita.
 */
const MFE_USO_BOSQUE = ['Tierras forestales (FL)', 'Frondosas (FLb)',
  'Coníferas (FLc)', 'Especie desconocida (FLu)', 'Mixto (FLm)'];

/**
 * Uso del suelo en el punto. Igual que `consultarMFE`, devuelve `respondio`
 * para no confundir «aquí no hay pradera» con «no me han contestado».
 *
 * Devuelve los hábitats ORDENADOS por peso, no todos los que ha salido: en
 * una caja de 120 m hay varias clases y al modelo le sirve la principal.
 */
/**
 * Hábitats que el motor usa pero que NADIE produce.
 *
 * Se declara aquí, junto a las dos listas de arriba, para poder ver la foto
 * completa de una vez. De dónde sale cada uno:
 *
 *   De `MFE_CAPAS`     bosque_mixto, castaneral, dehesa, encinar, fresnedal,
 *                      hayedo, matorral, pinar, perturbado, ribera, robledal
 *   De `MFE_USO_TAGS`  pradera, cultivo
 *   De aquí            borde_bosque, cesped, claro, frutal, ganado, majadal,
 *                      pastizal
 *
 * Los siete últimos son hábitats REALES de las especies según el libro y no
 * tienen capa en ninguna de las dos fuentes del MFE. No se les inventa una
 * capa: siguen siendo datos válidos de la ficha, y si el MFE dice «pinar» una
 * seta de pradera no encaja y sale penalizada, que es lo que debe pasar.
 */
const HABITATS_SIN_CAPA = new Set([
  'borde_bosque', 'cesped', 'claro', 'frutal', 'ganado', 'majadal', 'pastizal',
]);

async function consultarUsoDelSuelo(lat, lon) {
  const d = 0.0011;   // el mismo radio que consultarMFE, a propósito

  const url = MFE_WFS + '?' + new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: `foto_fija_mfe:${MFE_USO_CAPA}`,
    outputFormat: 'application/json',
    count: 60,
    propertyName: MFE_USO_PROPS,
    // La forma que sí funciona en este GeoServer, como en las capas forestales.
    CQL_FILTER: `BBOX(geom,${lon - d},${lat - d},${lon + d},${lat + d},'EPSG:4326')`,
  });

  const vacio = (respondio) => ({
    respondio, tags: [], clase: null, poligonos: 0,
    descartado: [], bosqueSinReconocer: false,
  });

  let feats;
  try {
    const r = await fetchConTope(url, 12000);
    if (!r.ok) return vacio(false);
    const j = await r.json();
    feats = j.features || [];
  } catch {
    // Esta capa puede caerse sin que caiga la consulta del bosque. Si el punto
    // cae en un pinar y sólo falla ésta, el pinar sigue saliendo.
    return vacio(false);
  }

  if (!feats.length) {
    // Responde pero no hay parcela. Pasa en la costa y en algún casco urbano
    // grueso. Es un hueco de la capa, no un dato sobre el punto.
    return vacio(true);
  }

  const pesados = [];
  const descartado = new Set();
  let bosqueSinReconocer = false;

  for (const f of feats) {
    const p = f.properties || {};
    for (const campo of ['nb_lulucf_nivel2', 'nb_lulucf_nivel1']) {
      const v = p[campo];
      if (!v) continue;
      const regla = MFE_USO_TAGS[v];
      if (regla) {
        pesados.push({ tag: regla.tag, peso: regla.peso });
      } else if (MFE_USO_BOSQUE.includes(v)) {
        bosqueSinReconocer = true;
      } else {
        descartado.add(v);
      }
    }
  }

  pesados.sort((a, b) => a.peso - b.peso);
  const tags = [...new Set(pesados.map(x => x.tag))];

  // El texto oficial que se muestra en el tooltip tiene que ser el del
  // polígono que ha dado el PRIMER tag de la lista, no el primero que se
  // encontró por casualidad: si no, puede poneerse «Matorral» encima de una
  // lista que empieza por «Pradera». Se ordenan los polígonos por el peso de su
  // mejor tag y se coge el primero.
  const porPeso = feats
    .map(f => f.properties || {})
    .map(p => {
      const v = [p.nb_lulucf_nivel2, p.nb_lulucf_nivel1]
        .filter(Boolean)
        .map(x => MFE_USO_TAGS[x])
        .filter(Boolean)[0];
      return { p, peso: v ? v.peso : 99 };
    })
    .sort((a, b) => a.peso - b.peso);
  const primero = porPeso.length ? porPeso[0].p : null;

  return {
    respondio: true,
    tags,
    clase: primero ? primero.nb_claifin || primero.descr_uso_pda : null,
    poligonos: feats.length,
    descartado: [...descartado],
    bosqueSinReconocer,
  };
}

/* ------------------------------------------------------------------ */
/* Caché                                                              */
/* ------------------------------------------------------------------ */

/**
 * Clave redondeada a 3 decimales (~110 m).
 *
 * Es una decisión, no una comodidad. Los polígonos del MFE son parcelas
 * forestales de entre 1 y 25 ha, así que 110 m cae dentro del mismo dato la
 * mayoría de las veces; y a 4 decimales la caché no volvería a acertar nunca
 * porque el usuario llega a decimales distintos cada vez.
 */
const habitatKey = (lat, lon) => `${lat.toFixed(3)},${lon.toFixed(3)}`;

function habitatCacheLeer() {
  try { return JSON.parse(localStorage.getItem(MFE_CACHE_KEY)) || {}; }
  catch { return {}; }
}

function habitatCacheEscribir(k, v) {
  const c = habitatCacheLeer();
  c[k] = { v, t: Date.now() };
  const claves = Object.keys(c);
  if (claves.length > 300) {
    // Poda por antigüedad: el MFE se revisa cada pocos años.
    claves.sort((a, b) => c[a].t - c[b].t)
      .slice(0, claves.length - 200)
      .forEach(x => delete c[x]);
  }
  try { localStorage.setItem(MFE_CACHE_KEY, JSON.stringify(c)); } catch { /* lleno */ }
}

/**
 * Petición con tope. Sin esto, una consulta colgada bloquea la ficha entera
 * durante medio minuto, que es justo lo que pasaba con SoilGrids.
 */
async function fetchConTope(url, ms, opciones) {
  const t = new AbortController();
  const id = setTimeout(() => t.abort(), ms);
  try {
    return await fetch(url, Object.assign({ signal: t.signal }, opciones || {}));
  } finally {
    clearTimeout(id);
  }
}

/* ------------------------------------------------------------------ */
/* Consulta al MFE                                                    */
/* ------------------------------------------------------------------ */

/** Los campos que se piden: los que explican el bosque, no los que lo inventan. */
const MFE_PROPS = 'nom_sp1,nom_sp2,nom_sp3,descr_tipobosque,nb_format,nb_format2';

async function consultarCapaMFE(capa, lat, lon, d) {
  const url = MFE_WFS + '?' + new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: `foto_fija_mfe:${capa.capa}`,
    outputFormat: 'application/json',
    count: 3,
    propertyName: MFE_PROPS,
    // La forma que sí funciona en este GeoServer. Con `bbox=` o con
    // `the_geom` el servidor contesta 0 features o HTTP 400.
    CQL_FILTER: `BBOX(geom,${lon - d},${lat - d},${lon + d},${lat + d},'EPSG:4326')`,
  });

  try {
    const r = await fetchConTope(url, 12000);
    if (!r.ok) return null;
    const j = await r.json();
    const feats = j.features || [];
    if (!feats.length) return null;
    return feats[0].properties || {};
  } catch {
    // Una capa que falla no puede tumbar la consulta entera. Si el punto cae
    // en un hayedo y sólo falla la capa del pinar, el hayedo sigue saliendo.
    return null;
  }
}

/**
 * Qué bosque hay en el punto. Devuelve `null` si no hay árbol, y `indefinido`
 * si el servicio no respondió (que no es lo mismo: lo primero es que no hay
 * bosque, lo segundo es que no se ha podido mirar).
 */
async function consultarMFE(lat, lon) {
  // ~120 m de radio: lo bastante para no depender de dónde cayó el punto
  // dentro de la parcela, lo bastante pequeño para no tragarse un pinar y una
  // dehesa en la misma llamada.
  const d = 0.0011;

  const resultados = await Promise.all(
    MFE_CAPAS.map(c => consultarCapaMFE(c, lat, lon, d).then(p => ({ c, p })))
  );

  const obligatoire = resultados.filter(r => r.p);
  if (!obligatoire.length) return { arboles: [], respondio: true };

  const hab = [];
  const arboles = [];
  const vistos = new Set();

  for (const { c, p } of obligatoire) {
    const especies = [p.nom_sp1, p.nom_sp2, p.nom_sp3].filter(Boolean);
    // El nombre de la capa es el dato duro; el de la especie arbórea lo
    // acompaña. Se guarda el par porque es lo que se muestra en la tarjeta.
    const linea = {
      capa: c.capa,
      habitat: c.tag,
      especie: especies[0] || null,
      formacion: p.nb_format || p.nb_format2 || p.descr_tipobosque || null,
    };
    arboles.push(linea);
    hab.push(c.tag);

    // El olmedal no tiene capa propia en la lista blanca, pero sí aparece
    // como composición del arbolado de ribera.
    if (c.tag === 'ribera' && especies.some(e => /ulmus|olmo/i.test(e))) {
      hab.push('olmedal');
    }
    vistos.add(c.tag);
  }

  return { arboles, vegetacion: [...new Set(hab)], respondio: true };
}

/* ------------------------------------------------------------------ */
/* Fuente 2: OpenStreetMap — ¿esto es una ciudad?                     */
/* ------------------------------------------------------------------ */

const OSM_HOSTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

/**
 * Densidad de buildings en 150 m alrededor del punto.
 *
 * El umbral está medido, no inventado. Con radio de 150 m:
 *
 *   Puerta del Sol      76 edificios -> urbano
 *   Soria capital       69 edificios -> urbano
 *   Parque del Retiro    5 edificios -> NO urbano
 *   Pinar de la Raya     0 edificios -> NO urbano
 *   Laguna Negra        0 edificios -> NO urbano
 *
 * El Retiro sale como no urbano a propósito: es un parque con árboles y
 * hierba, y ahí sí puede fructificar. Marcarlo como ciudad sería el mismo
 * error que estamos corrigiendo, sólo que al revés.
 */
async function consultarUrbano(lat, lon) {
  const q = `
[out:json][timeout:25];
(
  way["building"](around:150,${lat},${lon});
  relation["building"](around:150,${lat},${lon});
  way["building:part"](around:150,${lat},${lon});
  way["landuse"~"^(residential|industrial|commercial|retail)$"](around:150,${lat},${lon});
  way["highway"~"^(residential|tertiary|secondary|primary|trunk|unclassified|pedestrian)$"](around:150,${lat},${lon});
);
out tags;`;

  const cuerpo = new URLSearchParams({ data: q });
  const post = {
    method: 'POST',
    body: cuerpo,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  };
  let ultimoError = null;

  for (let intento = 0; intento < OSM_HOSTS.length; intento++) {
    try {
      const r = await fetchConTope(OSM_HOSTS[intento], 14000, post);
      if (r.status === 429) { ultimoError = 'límite de tasa'; continue; }
      if (!r.ok) { ultimoError = `HTTP ${r.status}`; continue; }
      const j = await r.json();
      let edificios = 0;
      const usos = new Set();
      for (const e of j.elements || []) {
        const t = e.tags || {};
        if (t.building || t['building:part']) edificios++;
        if (t.landuse) usos.add(t.landuse);
      }
      const urbano = edificios >= 10;
      return {
        ok: true,
        urbano,
        edificios,
        usos: [...usos],
        // La fuente puede no tener nada, y eso NO es lo mismo que decir que
        // el sitio es wild. Se distingue para no bajar el índice sin motivo.
        datos: (j.elements || []).length > 0,
      };
    } catch (e) {
      ultimoError = e.name === 'AbortError' ? 'sin respuesta' : e.message;
    }
  }
  return { ok: false, urbano: false, edificios: 0, usos: [], error: ultimoError };
}

/* ------------------------------------------------------------------ */
/* Orquestación                                                       */
/* ------------------------------------------------------------------ */

/**
 * Hábitat del punto, de la fuente más fiable a la menos.
 *
 * Devuelve siempre `{ vegetacion, urbano, fuente, ... }`. Si todo falla,
 * `vegetacion` va vacía y `fuente` dice `sin_datos`: `evaluarHabitat` ya
 * sabe qué hacer con eso (degrada, no veta).
 */
async function consultarHabitat(lat, lon) {
  const k = habitatKey(lat, lon);
  const cache = habitatCacheLeer();
  const hit = cache[k];
  if (hit && Date.now() - hit.t < MFE_DIAS) {
    return { ...hit.v, desdeCache: true };
  }

  let r = {
    vegetacion: [],
    urbano: false,
    fuente: 'sin_datos',
    arboles: [],
    detalles: {},
  };

  const mfe = await consultarMFE(lat, lon);

  if (mfe.respondio && mfe.arboles.length) {
    // Caso bueno: hay bosque y sabemos cuál. No hace falta preguntar a nadie
    // más, porque un pinar no es una plaza.
    r = {
      vegetacion: mfe.vegetacion,
      urbano: false,
      fuente: 'MFE',
      arboles: mfe.arboles,
      detalles: {},
    };
  } else if (mfe.respondio) {
    // El MFE ha dicho que aquí no hay árbol. Eso ya es un dato, pero es un dato
    // NEGATIVO: sólo descarta el bosque, y no dice si lo que hay es pradera,
    // cultivo, matorral o descampado.
    //
    // Antes se devolvía `['pradera']`: se elegía un hábitat en lugar de
    // medirlo, y el modelo lo tomaba como bueno. La capa de usos del suelo del
    // mismo MFE sí lo dice, así que se pregunta antes de suponer nada.
    const uso = await consultarUsoDelSuelo(lat, lon);

    if (uso.respondio && uso.tags.length) {
      // Hay una respuesta oficial y es un hábitat que el motor entiende.
      // No hace falta Overpass: esto no es una ciudad.
      r = {
        vegetacion: uso.tags,
        urbano: false,
        fuente: 'MFE (uso del suelo)',
        arboles: [],
        detalles: {
          uso: uso.clase,
          poligonos: uso.poligonos,
          // Si la capa dice «Frondosas» y la lista blanca no encontró pinar ni
          // frondoso, no es que no haya bosque: es que la lista blanca está
          // corta. Se anota para que se note, no para callarlo.
          bosqueSinReconocer: uso.bosqueSinReconocer,
          descartado: uso.descartado,
        },
      };
    } else {
      // Sin clase utilizable. Ahora toca Overpass, y sólo para lo suyo:
      // distinguir una plaza de un descampado. Un punto sin datos en OSM no
      // significa campo: en el campo OSM no tiene nada y en un pueblo lo
      // tiene todo. Por eso los dos casos se quedan SIN hábitat conocido en
      // vez de inventar una pradera.
      const osm = await consultarUrbano(lat, lon);
      if (osm.ok && osm.datos && osm.urbano) {
        r = {
          vegetacion: ['urbano'],
          urbano: true,
          fuente: 'MFE + OSM',
          arboles: [],
          detalles: { edificios: osm.edificios, usos: osm.usos },
        };
      } else if (osm.ok && !osm.datos) {
        r = {
          vegetacion: [],
          urbano: false,
          fuente: 'MFE + OSM (sin poblar)',
          arboles: [],
          detalles: { uso: uso.clase, poligonos: uso.poligonos },
        };
      } else {
        r = {
          vegetacion: [],
          urbano: false,
          fuente: 'MFE (Overpass no respondió)',
          arboles: [],
          detalles: { uso: uso.clase, poligonos: uso.poligonos },
        };
      }
    }
  }

  habitatCacheEscribir(k, r);
  return r;
}

/* ------------------------------------------------------------------ */
/* Exportación (Node, para los tests)                                 */
/* ------------------------------------------------------------------ */

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MFE_CAPAS, MFE_PROPS, HABITATS_ARBOLADOS,
    MFE_USO_CAPA, MFE_USO_PROPS, MFE_USO_TAGS, MFE_USO_BOSQUE, HABITATS_SIN_CAPA,
    habitatKey, consultarHabitat, consultarMFE, consultarUsoDelSuelo, consultarUrbano,
  };
}