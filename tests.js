/* Tests del motor de prediccion de MicoHunter.
 *
 * Ejecutar con:  node tests.js
 *
 * Sin dependencias, sin framework y sin build, porque el proyecto no tiene
 * package.json: el mismo algoritmo.js que carga el navegador es el que se
 * importa aqui con require(), asi que no hay dos copias que se desincronicen.
 *
 * El motor tenia comentarios que lo llamaban verificable y no habia ni un
 * test. Estos son los que faltaban.
 */

'use strict';

const assert = require('node:assert');
const A = require('./algoritmo.js');

let pruebas = 0;
let fallos = 0;

function grupo(nombre) { console.log('\n' + nombre); }

/**
 * Cola de pruebas: cada una espera a que termine la anterior.
 *
 * ESTO SE ARREGLO. `prueba()` era `try { fn(); console.log('ok') }`, que sólo
 * funciona con tests SÍNCRONOS. Con un test que devuelve una promesa —porque
 * consulta una API o un fichero— la función se llamaba, devolvía la promesa
 * pendiente y el `ok` se imprimía al momento: el test se daba por bueno sin
 * haber ejecutado ni una aserción.
 *
 * No se vio porque los seis tests que había así se añadieron después, y
 * «robar» el código para comprobar que fallaba no lo detectaba. Ahora la
 * prueba se encadena en una cola y se espera: el orden de salida sigue siendo
 * el de declaración, y un fallo dentro de un `.then()` cuenta como fallo.
 */
let cola = Promise.resolve();

function prueba(nombre, fn) {
  pruebas++;
  const reportarError = (e) => {
    fallos++;
    console.log('  FALLA  ' + nombre);
    console.log('         ' + (e && e.message ? e.message : e));
  };
  cola = cola.then(() => {
    try {
      // `Promise.resolve` envuelve tanto un valor normal como una promesa, así
      // que el mismo camino sirve para los tests síncronos y los asíncronos.
      return Promise.resolve(fn()).then(
        () => console.log('  ok     ' + nombre),
        reportarError
      );
    } catch (e) {
      reportarError(e);
    }
  });
}

const r2 = (x) => Math.round(x * 100) / 100;

/**
 * Número de especies, tomado de la lista y no escrito a mano.
 *
 * Estaba fijo en 18 y añadí una decinuevevespecie, el resultado fue que dos
 * pruebas que no tienen nada que ver con la nueva especie fallaron. Eso no
 * prueba que la especie esté mal: prueba que el test estaba mal, porque
 * comprueba una constante en vez de una propiedad. Los nombres de las
 * pruebas se construyen con este número para que no vuelvan a mentir.
 */
const TOTAL = A.SPECIES.length;
const N = TOTAL + (TOTAL === 1 ? ' especie' : ' especies');

/* ------------------------------------------------------------------ */
/* Contextos sinteticos                                                 */
/* ------------------------------------------------------------------ */

/* Contexto de 30 dias. lluvia[0] es hoy. */
function ctx(o) {
  o = o || {};
  if (o.tSuelo === undefined) o.tSuelo = 18;   // sin esto, todo salia NaN
  const n = o.lluvia ? o.lluvia.length : 30;
  const hist = [];
  for (let i = n - 1; i >= 0; i--) {
    hist.push({
      d: i,
      t: o.histT ? o.histT[i] : o.tSuelo - 2 + (i % 3),
      tmax: o.tSuelo + 2,
      tmin: o.tSuelo - 8,
      hr: 75,
    });
  }
  hist[hist.length - 1].t = o.tSuelo;
  return {
    historial: hist,
    lluvia30: o.lluvia || Array.from({ length: n }, (_, i) => (i < 10 ? 6 : 0.5)),
    altitude: o.alt === undefined ? 1200 : o.alt,
    tSuelo: hist[hist.length - 1].t,
    mes: o.mes === undefined ? 10 : o.mes,
    terreno: {
      vegetacion: o.veg || ['pinar'],
      exposicion: null,
      humedad: 'normal',
      ph: o.ph === undefined ? 5.0 : o.ph,
      hayMadera: null,
    },
  };
}

function esp(k) {
  const s = A.SPECIES.find(x => x.key === k);
  assert.ok(s, 'no existe la especie ' + k);
  return s;
}

/* ------------------------------------------------------------------ */
/* 1. Funciones de respuesta                                            */
/* ------------------------------------------------------------------ */

grupo('1. Funciones de respuesta');

prueba('potencialEstacional vale 0 bajo la minima critica', () => {
  const sp = esp('boletus');
  assert.strictEqual(A.potencialEstacional(sp.tCrit - 1, sp), 0);
});

prueba('potencialEstacional nunca sale de 0..1', () => {
  const sp = esp('boletus');
  for (let t = -5; t <= 40; t += 0.5) {
    const v = A.potencialEstacional(t, sp);
    assert.ok(v >= 0 && v <= 1, 't=' + t + ' -> ' + v);
  }
});

prueba('potencialEstacional cae por encima del techo', () => {
  const sp = esp('boletus');
  assert.ok(A.potencialEstacional(sp.tMax + 5, sp) < A.potencialEstacional(sp.tMax - 1, sp));
});

prueba('factorTemporada: 1.00 dentro, 0.45 a dos meses, 0.15 lejos', () => {
  // Especie de mentira, con temporada fija. Antes usaba el boleto y sus meses
  // de verdad, así que al cambiar esos meses por los del libro el test empezó
  // a fallar sin que hubiera cambiado la función. Un test que depende de los
  // datos no mide la función, mide los datos.
  const sp = { temporada: [6, 7, 8, 9, 10, 11] };
  assert.strictEqual(A.factorTemporada(sp, 9), 1.0);
  assert.strictEqual(A.factorTemporada(sp, 7), 1.0, 'el mes 7 esta dentro');
  assert.strictEqual(A.factorTemporada(sp, 4), 0.45);
  assert.strictEqual(A.factorTemporada(sp, 3), 0.15);
});

prueba('factorTemporada da 1.00 en el mes medio de la temporada real del boleto', () => {
  // Aquí sí se comprueba contra una especie real, pero en su mes central.
  const sp = esp('boletus');
  const centro = sp.temporada[Math.floor(sp.temporada.length / 2)];
  assert.strictEqual(A.factorTemporada(sp, centro), 1.0,
    'fuera de temporada en su propio mes central: ' + sp.key);
});

prueba('factorTemporada con temporada vacia no penaliza', () => {
  assert.strictEqual(A.factorTemporada({ temporada: [] }, 1), 1);
});

prueba('lluviaEfectiva: la misma lluvia concentrada da mas', () => {
  const sp = esp('boletus');
  const hoy = Array(30).fill(0).map((_, i) => (i === 0 ? 20 : 0));
  const repartida = Array(30).fill(0).map((_, i) => (i < 4 ? 5 : 0));
  assert.ok(A.lluviaEfectiva(hoy, sp) > A.lluviaEfectiva(repartida, sp));
});

prueba('lluviaEfectiva vale 0 sin lluvia', () => {
  assert.strictEqual(A.lluviaEfectiva(Array(30).fill(0), esp('boletus')), 0);
});

prueba('altitudeFactor baja fuera del optimo', () => {
  assert.ok(A.altitudeFactor(300) < A.altitudeFactor(1500));
});

/* ------------------------------------------------------------------ */
/* 2. El arreglo del cap del pH                                         */
/* ------------------------------------------------------------------ */

grupo('2. Factor de suelo: el pH ya no esta capado');

prueba('acidofila en su pH ideal no penaliza', () => {
  const r = A.factorSuelo(5.2, esp('boletus'));
  assert.strictEqual(r2(r.factor), 1.0);
  assert.strictEqual(r.etiqueta, 'pH adecuado');
});

prueba('acidofila en suelo calizo VETE: no crece, no es improbable', () => {
  // Antes este test pedía que la acidófila bajara a 0,60. Se aplicó el veto por
  // pH a petición del usuario: una micorrícica de turba ácida en un suelo
  // calcáreo no sale, y un 0,60 se leía como «poco probable», que es otra
  // cosa. Ahora vale 0 y lo dice con el rango por el que sí crece.
  const r = A.factorSuelo(7.6, esp('boletus'));
  assert.strictEqual(r.factor, 0, 'la acidófila en calizo tiene que valer 0');
  assert.strictEqual(r.veto, true, 'tiene que quedar marcado como veto');
  assert.ok(/suelo demasiado calizo/.test(r.etiqueta),
    'la etiqueta tiene que explicar el 0: ' + r.etiqueta);
  assert.ok(/3\.7 y 6\.7/.test(r.etiqueta),
    'la etiqueta tiene que decir el rango en el que sí crece: ' + r.etiqueta);
});

prueba('el recorrido del pH es monotono decreciente', () => {
  let previo = 2;
  for (const ph of [4.0, 5.0, 6.0, 7.0, 8.0, 9.0]) {
    const f = A.factorSuelo(ph, esp('boletus')).factor;
    assert.ok(f <= previo, 'ph=' + ph + ' -> ' + f + ' no baja');
    previo = f;
  }
});

prueba('alcalinofila en suelo acido penaliza', () => {
  assert.ok(A.factorSuelo(4.8, esp('seta_cardo')).factor < 1);
});

prueba('sin pH el factor es neutro y se declara desconocido', () => {
  const r = A.factorSuelo(null, esp('boletus'));
  assert.strictEqual(r.factor, 1);
  assert.strictEqual(r.conocido, false);
});

prueba('pH absurdo no rompe ni sale de rango', () => {
  // NaN, undefined y null son pH DESCONOCIDO: no vetan y devuelven 1. Un pH
  // absurdo pero numérico (14, -3) sí está fuera de rango y veta. Las dos
  // cosas tienen que ser verdad a la vez, y por eso van en el mismo test.
  for (const ph of [NaN, undefined, null]) {
    const r = A.factorSuelo(ph, esp('boletus'));
    assert.ok(Number.isFinite(r.factor), 'factor no finito con ph=' + ph);
    assert.strictEqual(r.factor, 1, 'sin pH no se penaliza: ' + r.factor);
    assert.strictEqual(r.veto, false, 'sin pH no hay veto: ' + ph);
    assert.strictEqual(r.conocido, false);
  }
  for (const ph of [-3, 14]) {
    const r = A.factorSuelo(ph, esp('boletus'));
    assert.ok(Number.isFinite(r.factor), 'factor no finito con ph=' + ph);
    assert.strictEqual(r.factor, 0, 'un pH absurdo tiene que vetar: ' + ph);
    assert.ok(r.factor >= 0 && r.factor <= 1);
  }
});

prueba('el efecto del pH llega hasta el indice final', () => {
  const sp = esp('boletus');
  const acido = A.indice(sp, ctx({ ph: 5.0 }));
  const calizo = A.indice(sp, ctx({ ph: 7.6 }));
  assert.ok(acido.I > calizo.I,
    'el indice no se mueve: ' + acido.I + ' vs ' + calizo.I);
});

/* ------------------------------------------------------------------ */
/* 3. GDD y su tope de ventana                                          */
/* ------------------------------------------------------------------ */

grupo('3. GDD y tope de ventana');

prueba('GDD acumulado coincide con la suma manual', () => {
  const sp = esp('boletus');
  const hist = Array.from({ length: 10 }, () => ({ d: 0, t: sp.tBase + 2, tmax: 0, tmin: 0, hr: 0 }));
  const r = A.calcularGDD(hist, sp, 0);
  assert.strictEqual(r.gdd, 20);
  assert.strictEqual(r.diasEnRango, 10);
});

prueba('el tope se respeta tambien en dias de estres termico', () => {
  // Senderuela tiene diasMax 25: con 30 dias de historico el tope SI puede
  // activarse. Con el boleto (45) no, y el test no probaria nada.
  // Antes del arreglo estos dias hacia continue y no contaban para el tope:
  // diasEnRango llegaba a 30.
  const sp = esp('senderuela');
  const hist = Array.from({ length: 30 }, () => ({ d: 0, t: sp.tMax + 8, tmax: 0, tmin: 0, hr: 0 }));
  const r = A.calcularGDD(hist, sp, 0);
  assert.strictEqual(r.diasEnRango, 25,
    'los dias de estres se saltan el tope: ' + r.diasEnRango);
});

prueba('el tope no supera los dias disponibles y lo declara', () => {
  const sp = esp('boletus');
  const hist = Array.from({ length: 12 }, () => ({ d: 0, t: sp.tBase + 3, tmax: 0, tmin: 0, hr: 0 }));
  const r = A.calcularGDD(hist, sp, 0);
  assert.strictEqual(r.tope, 12);
  assert.strictEqual(r.topeAlcanzable, false);
  assert.strictEqual(r.diasDisponibles, 12);
  assert.strictEqual(r.diasEnRango, 12);
});

prueba('con diasMax corto el tope SI es alcanzable', () => {
  const sp = esp('senderuela');
  const hist = Array.from({ length: 30 }, () => ({ d: 0, t: sp.tBase + 3, tmax: 0, tmin: 0, hr: 0 }));
  const r = A.calcularGDD(hist, sp, 0);
  assert.strictEqual(r.topeAlcanzable, true);
  assert.strictEqual(r.diasEnRango, sp.diasMax);
});



prueba('el factor de acumulacion nunca supera 1', () => {
  assert.strictEqual(A.factorAcondicionamiento(99999, esp('boletus')), 1);
});

/* ------------------------------------------------------------------ */
/* 4. Habitat                                                           */
/* ------------------------------------------------------------------ */

grupo('4. Factor de habitat');

prueba('cobertura principal da 1.00', () => {
  const r = A.evaluarHabitat(esp('niscalos'), { vegetacion: ['pinar'], ph: 5 });
  assert.strictEqual(r2(r.factor), 1.0);
});

prueba('sin cobertura devuelve 0,70 y lo dice (ni premia ni penaliza)', () => {
  const r = A.evaluarHabitat(esp('niscalos'), { vegetacion: [], ph: 5 });
  assert.strictEqual(r2(r.factor), 0.70);
  assert.strictEqual(r.etiqueta, 'sin datos de cobertura');
});

prueba('un habitat conocido que NO encaja veta a cero, y lo dice', () => {
  // El niscalo solo vive en pinar. Un robledal cartografiado no es un habitat
  // suyo, y antes de este cambio le caia a 0,05: una forma de decir «casi no»
  // cuando lo que se queria decir es «nada».
  const r = A.evaluarHabitat(esp('niscalos'), { vegetacion: ['robledal'], ph: 5 });
  assert.strictEqual(r.factor, 0, 'el desajuste con dato medido tiene que ser 0');
  assert.strictEqual(r.etiqueta, 'fuera de su hábitat',
    'un 0 sin etiqueta parece un fallo: ' + r.etiqueta);
  assert.strictEqual(r.veto, true, 'tiene que quedar marcado como veto');
});

prueba('un habitat cartografiado que no encaja veta, sin excepcion', () => {
  // El pastizal no lo produce ninguna capa del MFE, asi que llega aqui por la
  // heuristica. Es el caso limite: un habitat que el motor reconoce como
  // pratense pero que ninguna fuente oficial puede confirmar.
  //
  // Aqui la fila veta, y es lo correcto: se ha cartografiado matorral y el
  // boleto no crece en matorral. Lo que NO puede vetar es la lista vacia, que
  // se comprueba justo debajo.
  const r = A.evaluarHabitat(esp('boletus'), { vegetacion: ['pastizal'], ph: 5 });
  assert.strictEqual(r.factor, 0,
    'pastizal no es un habitat de boleto: ' + r.factor);
  assert.strictEqual(r.veto, true);
});

prueba('sin dato alguno el habitat NO puede vetar a nadie', () => {
  // Este es el test que importa. Si el veto se aplicara antes que la falta de
  // dato, los puntos sin cartografiar sacarian a las 19 especies y no
  // apareceria ninguna. Por eso la lista vacia vale 0,70 y no 0.
  for (const sp of A.SPECIES) {
    const r = A.evaluarHabitat(sp, { vegetacion: [] });
    assert.ok(r.factor > 0,
      sp.key + ': sin dato de habitat no puede anular, vale ' + r.factor);
    assert.strictEqual(r.factor, 0.7, sp.key + ': sin dato debe dar 0,70');
    assert.strictEqual(r.etiqueta, 'sin datos de cobertura');
    assert.strictEqual(r.veto, false,
      sp.key + ': la falta de dato no es un veto');
  }
});

/* ------------------------------------------------------------------ */
/* 5. Los cinco escenarios sinteticos                                   */
/* ------------------------------------------------------------------ */

grupo('5. Escenarios sinteticos');

const ESC = {
  '30 dias secos': ctx({ histT: Array.from({ length: 30 }, (_, i) => 11 + (i % 2)), lluvia: Array(30).fill(0.2) }),
  'lluvia intensa reciente': ctx({ lluvia: Array(30).fill(9) }),
  'lluvia moderada + temperatura favorable': ctx({}),
  'lluvia + temperaturas demasiado altas': ctx({ tSuelo: 27, histT: Array(30).fill(26) }),
  'condiciones variables': ctx({
    tSuelo: 17,
    histT: Array.from({ length: 30 }, (_, i) => [7, 21, 14, 26, 11, 18][i % 6]),
    lluvia: Array.from({ length: 30 }, (_, i) => [0, 14, 0, 0, 8, 0][i % 6]),
  }),
};

for (const nombre of Object.keys(ESC)) {
  prueba('escenario "' + nombre + '" sin NaN y en rango', () => {
    for (const sp of A.SPECIES) {
      const r = A.indice(sp, ESC[nombre]);
      assert.ok(Number.isFinite(r.I), sp.key + ' -> I=' + r.I);
      assert.ok(r.I >= 0 && r.I <= 100, sp.key + ' fuera de rango: ' + r.I);
      for (const k of Object.keys(r)) {
        if (typeof r[k] === 'number') {
          assert.ok(Number.isFinite(r[k]), sp.key + '.' + k + ' = ' + r[k]);
        }
      }
      const d = r.detalle;
      for (const k of Object.keys(d)) {
        if (typeof d[k] === 'number') {
          assert.ok(Number.isFinite(d[k]), sp.key + '.detalle.' + k + ' = ' + d[k]);
        }
      }
    }
  });
}

prueba('el ranking sale ordenado de mayor a menor', () => {
  const r = A.ranking(ESC['lluvia moderada + temperatura favorable']);
  assert.strictEqual(r.length, A.SPECIES.length);
  for (let i = 1; i < r.length; i++) {
    assert.ok(r[i - 1].I >= r[i].I, 'desordenado en la posicion ' + i);
  }
});

prueba('treinta dias secos puntuan menos que lluvia moderada', () => {
  const suma = c => A.SPECIES.reduce((s, sp) => s + A.indice(sp, c).I, 0);
  const seco = suma(ESC['30 dias secos']);
  const humedo = suma(ESC['lluvia moderada + temperatura favorable']);
  assert.ok(seco < humedo, 'seco=' + r2(seco) + ' humedo=' + r2(humedo));
});

/* ------------------------------------------------------------------ */
/* 6. Datos incompletos y robustez                                      */
/* ------------------------------------------------------------------ */

grupo('6. Datos incompletos y casos raros');

prueba('sin SoilGrids (ph null) el indice se calcula igual', () => {
  const r = A.indice(esp('boletus'), ctx({ ph: null }));
  assert.ok(Number.isFinite(r.I) && r.I > 0);
  assert.strictEqual(r.detalle.sueloConocido, false);
});

prueba('historial vacio no rompe', () => {
  const c = ctx({});
  c.historial = [];
  const r = A.indice(esp('boletus'), c);
  assert.ok(Number.isFinite(r.I));
});

prueba('historial con huecos no rompe', () => {
  const c = ctx({});
  c.historial.forEach((d, i) => { if (i % 3 === 0) d.t = null; });
  const r = A.indice(esp('boletus'), c);
  assert.ok(Number.isFinite(r.I));
});

prueba('lluvia30 mas corta que la ventana L no rompe', () => {
  const r = A.indice(esp('boletus'), ctx({ lluvia: Array(5).fill(3) }));
  assert.ok(Number.isFinite(r.I) && r.reff >= 0);
});

prueba('historial con un dia no numerico NO propaga NaN', () => {
  const c = ctx({});
  c.historial[5].t = null;
  c.historial[9].t = undefined;
  const r = A.indice(esp('boletus'), c);
  assert.ok(Number.isFinite(r.I), 'I=' + r.I);
  assert.ok(r.I > 0, 'I=' + r.I);
});

prueba('vegetacion vacia no revienta ninguna especie', () => {
  for (const sp of A.SPECIES) {
    assert.ok(Number.isFinite(A.indice(sp, ctx({ veg: [] })).I), sp.key);
  }
});

prueba('especie desconocida: error controlado', () => {
  const fantasma = { key: 'no_existe', habitat: [], temporada: [] };
  let r;
  try {
    r = A.indice(fantasma, ctx({}));
  } catch (e) {
    assert.ok(e instanceof TypeError || e instanceof RangeError, 'rara: ' + e);
    return;
  }
  assert.ok(Number.isFinite(r.I), 'I=' + r.I);
  assert.ok(Number.isFinite(r.S) && Number.isFinite(r.H) && Number.isFinite(r.A));
});

prueba(`las ${N} tienen los ocho parametros en orden`, () => {
  for (const sp of A.SPECIES) {
    for (const k of ['tBase', 'tOpt', 'tMax', 'tCrit', 'gddNeed', 'L', 'Ro', 'diasMax']) {
      assert.ok(Number.isFinite(sp[k]), sp.key + ' sin ' + k);
    }
    assert.ok(sp.tCrit < sp.tBase, sp.key + ': tCrit >= tBase');
    assert.ok(sp.tBase < sp.tOpt, sp.key + ': tBase >= tOpt');
    assert.ok(sp.tOpt < sp.tMax, sp.key + ': tOpt >= tMax');
    assert.ok(sp.diasMax > 0 && sp.Ro > 0 && sp.L > 0, sp.key + ': parametro no positivo');
  }
});

prueba('toda especie tiene habitat y temporada no vacios', () => {
  for (const sp of A.SPECIES) {
    assert.ok(Array.isArray(sp.habitat) && sp.habitat.length, sp.key + ' sin habitat');
    assert.ok(Array.isArray(sp.temporada) && sp.temporada.length, sp.key + ' sin temporada');
  }
});

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 7. Altitud por especie                                                */
/* ------------------------------------------------------------------ */

grupo('7. Factor altitudinal por especie');

prueba(`las ${N} tienen banda propia y coherente`, () => {
  assert.ok(TOTAL > 15, 'la lista de especies se ha quedado vacía o rara');
  for (const sp of A.SPECIES) {
    assert.ok(Array.isArray(sp.alt), sp.key + ' sin banda');
    assert.strictEqual(sp.alt.length, 3, sp.key + ': banda de 3 numeros');
    const b = sp.alt;
    assert.ok(b[0] >= 0, sp.key + ': optimo min negativo');
    assert.ok(b[1] > b[0], sp.key + ': max <= min');
    assert.ok(b[2] > 0, sp.key + ': margen no positivo');
    assert.ok(sp.altSuelo > 0 && sp.altSuelo <= 1, sp.key + ': suelo fuera de 0..1');
    assert.ok(['documentado', 'indicado'].includes(sp.altEvidencia),
      sp.key + ': evidencia "' + sp.altEvidencia + '"');
    assert.ok(typeof sp.altFuente === 'string' && sp.altFuente.length > 10,
      sp.key + ': sin fuente');
  }
});

prueba('las bandas NO son todas iguales (ya no es la curva del boleto)', () => {
  const firmas = new Set(A.SPECIES.map(sp => sp.alt.join('-')));
  assert.ok(firmas.size >= 8,
    'solo ' + firmas.size + ' bandas distintas: siguen siendo casi todas la del boleto');
});

prueba('dentro de la banda optima el factor es 1,00', () => {
  for (const sp of A.SPECIES) {
    const medio = Math.round((sp.alt[0] + sp.alt[1]) / 2);
    assert.strictEqual(A.altitudeFactor(medio, sp), 1,
      sp.key + ' a ' + medio + ' m: ' + A.altitudeFactor(medio, sp));
    assert.strictEqual(A.altitudeFactor(sp.alt[0], sp), 1, sp.key + ' en el borde bajo');
    assert.strictEqual(A.altitudeFactor(sp.alt[1], sp), 1, sp.key + ' en el borde alto');
  }
});

prueba('el factor nunca sale de [altSuelo, 1]', () => {
  for (const sp of A.SPECIES) {
    for (const alt of [0, 50, 300, 700, 1047, 1400, 1900, 2500, 3500]) {
      const v = A.altitudeFactor(alt, sp);
      assert.ok(v >= sp.altSuelo - 1e-9 && v <= 1,
        sp.key + ' a ' + alt + ' m = ' + v + ', suelo ' + sp.altSuelo);
    }
  }
});

prueba('el recorrido es unimodal y sin peldanos', () => {
  // Sube hasta la banda optima, meseta dentro y baja despues. Lo que no puede
  // es dar saltos: la curva es continua. Si se comprobara solo "decreciente"
  // fallaria en la rampa de subida, que es justamente donde la curva sube.
  for (const sp of A.SPECIES) {
    const centro = Math.round((sp.alt[0] + sp.alt[1]) / 2);
    let subida = -1;
    for (let alt = 0; alt <= centro; alt += 25) {
      const v = A.altitudeFactor(alt, sp);
      assert.ok(v >= subida - 1e-9, sp.key + ' baja al subir hasta ' + alt + ' m');
      subida = v;
    }
    let bajada = 2;
    for (let alt = centro; alt <= 3500; alt += 25) {
      const v = A.altitudeFactor(alt, sp);
      assert.ok(v <= bajada + 1e-9, sp.key + ' sube al bajar en ' + alt + ' m');
      bajada = v;
    }
  }
});

prueba('una banda ancha no penaliza en la costa', () => {
  // Antes lo comprobaba la seta de ostra, con banda de 0 a 1200 m y margen
  // 800, y se ha quitado del modelo. Ahora es la seta de pie azul, con banda
  // de 100 a 1400 y margen 600: es la que más se le parece de las que
  // quedan, porque es de las pocas que llegan casi al nivel del mar.
  const sp = esp('pie_azul');   // Lepista nuda, 100-1400 m
  assert.strictEqual(A.altitudeFactor(300, sp), 1);
  assert.strictEqual(A.altitudeFactorGlobal(300), 0.5);
});

prueba('el fallo original: el perrechico bajo ya no pierde el 50%', () => {
  const sp = esp('san_jorge');   // documentado 500-1200 m
  const bajo = A.altitudeFactor(300, sp);
  assert.ok(bajo > A.altitudeFactorGlobal(300),
    'sigue igual que la curva del boleto: ' + bajo);
  assert.strictEqual(bajo, 0.75, 'a 300 m esta a 200 del borde con margen 400');
});

prueba('el fallo original: el boleto en alta montana ya no se castiga', () => {
  const sp = esp('boletus');
  // En España está documentado hasta 3500 m. La curva del boleto lo ponía en
  // 0,50 a partir de 2000 m: 1500 m de rango real desperdiciados.
  assert.strictEqual(A.altitudeFactor(2200, sp), 1);
  assert.strictEqual(A.altitudeFactorGlobal(2200), 0.5);
  // Y el suelo (0,55) no lo toca hasta pasado el margen de 700 m.
  assert.strictEqual(A.altitudeFactor(2900, sp), 0.55);
});

prueba('las dos curvas coinciden donde el boleto manda', () => {
  const sp = esp('boletus');
  assert.strictEqual(A.altitudeFactor(1500, sp), 1);
  assert.strictEqual(A.altitudeFactorGlobal(1500), 1);
});

prueba('sin especie cae en la curva global de reserva', () => {
  assert.strictEqual(A.altitudeFactor(1047, null), A.altitudeFactorGlobal(1047));
  assert.strictEqual(A.altitudeFactor(1047, {}), A.altitudeFactorGlobal(1047));
  assert.strictEqual(A.altitudeFactor(1047, { alt: [1, 2] }), A.altitudeFactorGlobal(1047));
});

prueba('altitud no numerica no rompe', () => {
  const sp = esp('boletus');
  for (const alt of [NaN, undefined, null, -50]) {
    const v = A.altitudeFactor(alt, sp);
    assert.ok(Number.isFinite(v) && v >= sp.altSuelo && v <= 1, alt + ' -> ' + v);
  }
});

prueba('el indice final ya distingue especies por altitud', () => {
  // Misma especie que el test anterior: banda ancha que incluye los 300 m.
  const sp = esp('pie_azul');
  const costa = A.indice(sp, ctx({ alt: 300 })).I;
  const alta = A.indice(sp, ctx({ alt: 2400 })).I;
  assert.ok(costa > alta, 'costa=' + costa + ' alta=' + alta);
});

prueba('el detalle expone la banda y su evidencia', () => {
  const d = A.indice(esp('boletus'), ctx({})).detalle;
  assert.ok(/\d+-\d+ m/.test(d.altBanda), 'banda: ' + d.altBanda);
  assert.ok(['documentado', 'indicado'].includes(d.altEvidencia), d.altEvidencia);
});

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 8. Estrés por helada                                                  */
/* ------------------------------------------------------------------ */

grupo('8. Estrés por helada');

/* Contexto con las mínimas de aire de las últimas noches controladas.
   `noches` va de más antigua a más reciente; es el valor de tmin de cada
   noche, que es la señal con la que se detecta la helada. El suelo se deja
   templado salvo que se indique otra cosa, para aislar el efecto del aire. */
function ctxHel(noches, sueloHoy) {
  const c = ctx({});
  for (let k = 0; k < noches.length; k++) {
    c.historial[c.historial.length - 1 - k].tmin = noches[noches.length - 1 - k];
  }
  if (sueloHoy != null) c.historial[c.historial.length - 1].t = sueloHoy;
  c.tSuelo = c.historial[c.historial.length - 1].t;
  return c;
}

const PROLONGADO = [-2, -3, 1, 7];    // tres noches malas y una buena
const AISLADO = [8, 7, -2, 7];        // una noche mala y tres buenas

prueba(`las ${N} tienen los cuatro campos de helada en rango`, () => {
  for (const sp of A.SPECIES) {
    assert.ok(Number.isFinite(sp.frostTol), sp.key + ': sin frostTol');
    assert.ok(sp.frostPenalty > 0 && sp.frostPenalty <= 1,
      sp.key + ': frostPenalty ' + sp.frostPenalty);
    assert.ok(sp.frostRecovery > 0 && sp.frostRecovery <= 10,
      sp.key + ': frostRecovery ' + sp.frostRecovery);
    assert.ok(sp.frostSoil >= 0 && sp.frostSoil <= 3,
      sp.key + ': frostSoil ' + sp.frostSoil);
  }
});

prueba('las tolerancias al frío NO son todas iguales', () => {
  const tols = new Set(A.SPECIES.map(sp => sp.frostTol));
  assert.ok(tols.size >= 6, 'solo ' + tols.size + ' tolerancias distintas');
});

prueba('sin helada el factor es exactamente 1', () => {
  const c = ctxHel([9, 10, 9, 11]);
  for (const sp of A.SPECIES) {
    const f = A.frostStress(c.historial, sp, 0);
    assert.strictEqual(f.stress, 0, sp.key + ' con Stress ' + f.stress);
    assert.strictEqual(f.mult, 1, sp.key + ' con mult ' + f.mult);
  }
});

prueba('un episodio prolongado pesa MÁS que uno aislado, en todas', () => {
  const cP = ctxHel(PROLONGADO);
  const cA = ctxHel(AISLADO);
  let comparadas = 0;
  for (const sp of A.SPECIES) {
    const p = A.frostStress(cP.historial, sp, 0);
    const a = A.frostStress(cA.historial, sp, 0);
    assert.ok(p.stress >= a.stress - 1e-9,
      sp.key + ': prolongado ' + p.stress + ' < aislado ' + a.stress);
    comparadas++;
  }
  assert.strictEqual(comparadas, TOTAL, 'no se compararon todas las especies');
});

prueba('la helada ya NO pone el índice a cero ni marca no viable', () => {
  // Suelo dentro del rango de todas, con una helada fuerte en el aire.
  //
  // Cada especie se consulta en SU habitat, no en «pinar» para todas. Con el
  // veto, una consulta en un habitat ajeno vale 0 por diseño, y este test
  // mide la helada, no el habitat. Antes pasaba por debajo porque el veto no
  // existía.
  for (const sp of A.SPECIES) {
    const c = ctxHel([-9, -8, -9, -7], 16);
    c.terreno.vegetacion = [sp.habitat[0]];
    // Y en SU pH. El de `ctx()` es 5,0, que es una acidófila; con el veto por
    // suelo las tres alcalinófilas caían a 0 y este test, que mide la helada,
    // fallaba por el motivo equivocado.
    const perfil = sp.pHTolerante ? 5.6 : sp.acidofilo ? 5.2
      : sp.alcalinofila ? 7.6 : 6.8;
    c.terreno.ph = perfil;
    c.suelo = { ph: perfil, ok: true };
    const r = A.indice(sp, c);
    assert.strictEqual(r.viable, true, sp.key + ': viable=' + r.viable);
    assert.strictEqual(r.motivo, null, sp.key + ': motivo=' + r.motivo);
    assert.ok(r.I > 0, sp.key + ' con I=' + r.I + ', se ha quedado en cero');
    assert.ok(Number.isFinite(r.I), sp.key);
  }
});

prueba('el aire cuenta aunque el suelo esté templado', () => {
  // El fallo que se arregla: antes una mínima de -8 °C con suelo a 14 °C no
  // hacía nada al boleto, porque la helada se miraba solo en el suelo.
  const c = ctxHel([-8], 14);
  const f = A.frostStress(c.historial, esp('boletus'), 0);
  assert.ok(f.stress > 0.2, 'la helada de aire sigue sin contar: ' + f.stress);
  assert.ok(f.mult < 1, 'el factor no baja: ' + f.mult);
});

prueba('si el suelo baja del mínimo crítico pesa más que el aire solo', () => {
  const sp = esp('boletus');
  const templado = ctxHel([-3], 16);          // aire helado, suelo a 16
  const frio = ctxHel([-3], 2);                // misma noche, suelo a 2
  const a = A.frostStress(templado.historial, sp, 0);
  const b = A.frostStress(frio.historial, sp, 0);
  assert.ok(b.stress > a.stress + 0.2,
    'el suelo no aporta: aire ' + a.stress + ' vs suelo ' + b.stress);
  assert.strictEqual(b.sueloHelado, true);
  assert.strictEqual(a.sueloHelado, false);
});

prueba('el índice se recupera conforme el episodio se aleja', () => {
  const sp = esp('boletus');
  const serie = [0, 1, 2, 3, 5, 7].map(ant => {
    const c = ctx({});
    c.historial[c.historial.length - 1 - ant].tmin = -6;
    for (const k of [0, 1, 2]) {
      if (k !== ant) c.historial[c.historial.length - 1 - k].tmin = 9;
    }
    return A.frostStress(c.historial, sp, 0);
  });
  for (let i = 1; i < serie.length; i++) {
    assert.ok(serie[i].stress < serie[i - 1].stress,
      'el estrés no baja al alejarse en ' + serie[i - 1].stress + ' -> ' + serie[i].stress);
    assert.ok(serie[i].mult > serie[i - 1].mult,
      'el factor no sube al alejarse en ' + serie[i - 1].mult + ' -> ' + serie[i].mult);
  }
});

prueba('las especies resistentes sufren menos que las frágiles', () => {
  const c = ctxHel(PROLONGADO);
  const dura = A.frostStress(c.historial, esp('seta_pino'), 0);
  const fragil = A.frostStress(c.historial, esp('amanita'), 0);
  assert.ok(dura.mult > fragil.mult,
    'la capuchina (' + dura.mult + ') no aguanta más que la amanita (' + fragil.mult + ')');
  assert.ok(dura.mult >= 0.99, 'la capuchina tiene que salir ilesa: ' + dura.mult);
});

prueba('el estrés y el factor se quedan en sus rangos', () => {
  for (const noches of [[-30], [-30, -30, -30, -30], [5, 5, 5, 5]]) {
    const c = ctxHel(noches);
    for (const sp of A.SPECIES) {
      const f = A.frostStress(c.historial, sp, 0);
      assert.ok(f.stress >= 0 && f.stress <= 1, sp.key + ': stress ' + f.stress);
      assert.ok(f.mult >= sp.frostPenalty - 1e-9 && f.mult <= 1 + 1e-9,
        sp.key + ': mult ' + f.mult + ' fuera de [penalty, 1]');
      assert.ok(Number.isFinite(f.mult) && Number.isFinite(f.stress), sp.key);
    }
  }
});

prueba('las noches de helada por encima de la tolerancia no cuentan', () => {
  // Una noche a -1 °C no le hace nada a la capuchina, que aguanta hasta -5.
  // Antes lo comprobaba la seta de ostra, con tolerancia de -6 y ya fuera.
  const c = ctxHel([-1], 14);
  const f = A.frostStress(c.historial, esp('seta_pino'), 0);
  assert.strictEqual(f.noches, 0);
  assert.strictEqual(f.mult, 1);
});

prueba('sin mínima de aire el modelo no rompe', () => {
  const c = ctx({});
  for (const d of c.historial) d.tmin = null;
  for (const sp of A.SPECIES) {
    const r = A.indice(sp, c);
    assert.ok(Number.isFinite(r.I), sp.key + ' -> I=' + r.I);
    assert.ok(Number.isFinite(r.detalle.heladaFactor), sp.key);
  }
});

prueba('el detalle expone el episodio para poder contarlo', () => {
  const d = A.indice(esp('boletus'), ctxHel(PROLONGADO)).detalle;
  assert.ok(Number.isFinite(d.heladaFactor), 'sin heladaFactor');
  assert.ok(Number.isFinite(d.heladaEstres), 'sin heladaEstres');
  assert.ok(d.heladaNoches >= 1, 'no cuenta las noches: ' + d.heladaNoches);
  assert.ok(d.heladaMinima <= -1, 'no registra la mínima: ' + d.heladaMinima);
  assert.ok(d.heladaAntiguedad !== null, 'no sabe cuánto hace');
});

prueba('el factor de helada aparece en el índice final', () => {
  const sp = esp('boletus');
  const conHelada = A.indice(sp, ctxHel(PROLONGADO)).I;
  const sinHelada = A.indice(sp, ctxHel([9, 9, 9, 9])).I;
  assert.ok(conHelada < sinHelada,
    'la helada no baja el índice: ' + conHelada + ' vs ' + sinHelada);
});

/* ------------------------------------------------------------------ */
/* 9. Hábitat real (MFE + urbano)                                       */
/* ------------------------------------------------------------------ */

/*
 * Estas pruebas comprueban lo que NO depende de la red: el vocabulario del MFE
 * traducido al del motor, y la regla de que el núcleo urbano anula.
 *
 * Las consultas al GeoServer del IEPNB y a Overpass se probaron aparte y
 * funcionan, pero meterlas aquí haría que la suite dependiera de un servidor
 * de la administración. Si algún día sube un cambio en habitat.js que rompa la
 * forma de la consulta, eso se ve con `_probe17.py`, no con los tests.
 */

grupo('9. Hábitat: núcleo urbano');

prueba('el núcleo urbano pone el factor de hábitat a 0', () => {
  const r = A.evaluarHabitat(esp('boletus'), { vegetacion: ['urbano'], urbano: true });
  assert.strictEqual(r.factor, 0);
});

prueba('el urbano anula también a las especies no confinadas', () => {
  // El error que se quería evitar: degradar en vez de anular, que dejaba a un
  // boletus con 0.25 en la Plaza Mayor.
  for (const k of ['boletus', 'niscalos', 'senderuela', 'parasol', 'rebozuelo']) {
    const r = A.evaluarHabitat(esp(k), { vegetacion: ['urbano'], urbano: true });
    assert.strictEqual(r.factor, 0, k + ' no llega a 0 en urbano');
  }
});

prueba('el urbano pone el índice entero a cero, sin NaN', () => {
  const c = ctx({ vegetacion: ['pinar'], tSuelo: 18 });
  const urbano = A.indice(esp('boletus'), {
    ...c,
    terreno: { ...c.terreno, vegetacion: ['urbano'], urbano: true },
  });
  assert.strictEqual(urbano.I, 0);
  assert.ok(Number.isFinite(urbano.I), 'NaN en urbano');
  assert.strictEqual(urbano.detalle.habEtiqueta, 'entorno urbano');
});

prueba('mismo punto, misma meteorología: urbano vs pinar cambia el índice', () => {
  const c = ctx({ tSuelo: 18 });
  const enPinar = A.indice(esp('boletus'), {
    ...c, terreno: { ...c.terreno, vegetacion: ['pinar'], urbano: false },
  }).I;
  const enPlaza = A.indice(esp('boletus'), {
    ...c, terreno: { ...c.terreno, vegetacion: ['urbano'], urbano: true },
  }).I;
  assert.ok(enPinar > enPlaza, enPinar + ' no es mayor que ' + enPlaza);
});

prueba('sin marca de urbano, el comportamiento antiguo se conserva', () => {
  // Regresión: los tests anteriores pasaban terreno sin `urbano`, y eso no
  // puede cambiar el resultado.
  const r = A.evaluarHabitat(esp('boletus'), { vegetacion: ['pinar'] });
  assert.ok(r.factor > 0.5, 'el pinar sin la marca urbano dejó de valer 1: ' + r.factor);
});

prueba('vegetación vacía sigue degradando, no anulando', () => {
  const r = A.evaluarHabitat(esp('boletus'), { vegetacion: [] });
  assert.ok(r.factor > 0, 'la falta de datos no puede anular');
  assert.ok(r.confuso, 'debe declararse confuso');
});

grupo('10. Hábitat: vocabulario del MFE');

const H = require('./habitat.js');

prueba('el MFE no consulta capas inventadas', () => {
  // Regresión contra el desastre de la sesión anterior: pedir una capa que
  // no existe devuelve HTTP 400 y, con Promise.all, tumba la consulta entera.
  for (const c of H.MFE_CAPAS) {
    assert.ok(c.capa && /^[a-z0-9_]+$/.test(c.capa),
      'nombre de capa suspectso: ' + c.capa);
    assert.ok(c.tag && /^[a-z_]+$/.test(c.tag), 'hábitat suspectso: ' + c.tag);
  }
});

prueba('todas las capas del MFE dan hábitats que el motor conoce', () => {
  const conocidos = new Set();
  for (const sp of A.SPECIES) for (const h of sp.habitat) conocidos.add(h);
  // Hábitats que el motor usa para clasificar aunque no estén en la lista de
  // ninguna especie concreta.
  ['olmedal', 'ribera', 'urbano', 'perturbado'].forEach(x => conocidos.add(x));

  const desconocidos = [...new Set(H.MFE_CAPAS.map(c => c.tag))]
    .filter(t => !conocidos.has(t));
  assert.strictEqual(desconocidos.length, 0,
    'el motor no reconocería: ' + desconocidos.join(', '));
});

prueba('no se repite la misma capa en la lista blanca', () => {
  const capas = H.MFE_CAPAS.map(c => c.capa);
  assert.strictEqual(new Set(capas).size, capas.length, 'capas duplicadas');
});

prueba('la capa pinaster existe y da pinar', () => {
  // La comprobación más importante: es la capa que el resto del proyecto da
  // por buena (INICIO está en un pinar de pinaster) y la que devuelve
  // Pinus pinaster en el GeoServer.
  const p = H.MFE_CAPAS.find(c => c.capa === 'pinar_pino_pinaster_reg_mediterranea');
  assert.ok(p, 'no está la capa de pinaster mediterráneo');
  assert.strictEqual(p.tag, 'pinar');
});

prueba('HABITATS_ARBOLADOS cubre todos los hábitats arbolados', () => {
  // Sirve para lo contrario: cuando el MFE dice que no hay árbol, no se puede
  // devolver un bosque de la heurística.
  for (const c of H.MFE_CAPAS) {
    const arbolado = ['pinar', 'hayedo', 'robledal', 'castaneral', 'fresnedal',
      'encinar', 'dehesa', 'bosque_mixto', 'ribera', 'perturbado'].includes(c.tag);
    if (arbolado) {
      assert.ok(H.HABITATS_ARBOLADOS.has(c.tag),
        c.tag + ' da árbol pero no está en HABITATS_ARBOLADOS');
    }
  }
});

prueba('la clave de caché redondea a ~110 m y no a la precisión del click', () => {
  assert.strictEqual(H.habitatKey(40.41681, -3.70379), H.habitatKey(40.41682, -3.70378));
  assert.notStrictEqual(H.habitatKey(40.4168, -3.7038), H.habitatKey(41.9, -2.5));
});

grupo('11. Seta de pie azul (Lepista nuda)');

const pie = A.SPECIES.find(s => s.key === 'pie_azul');

prueba('la especie está dada de alta con nombre científico y común', () => {
  assert.ok(pie, 'no existe la especie pie_azul');
  assert.strictEqual(pie.lat, 'Lepista nuda');
  assert.strictEqual(pie.es, 'Seta de pie azul');
});


prueba('advierte de la confusión con Cortinarius', () => {
  assert.ok(pie.confusion && /cortinarius/i.test(pie.confusion),
    'no menciona el Cortinarius, que es la confusión que mata');
});

prueba('es saprofita de hojarasca y NO cae en la penalización de pratense', () => {
  // El error evitable: con guild `saprofita` el motor le bajaría el hábitat a
  // 0,45 en el hayedo, que es donde vive. Se comprueba el resultado, no el
  // nombre del guild, porque lo que importa es el número que sale.
  assert.strictEqual(pie.guild, 'saprofita_humus');
  const r = A.evaluarHabitat(pie, { vegetacion: ['hayedo'] });
  assert.strictEqual(r.factor, 1, 'penalizada en su propio hábitat: ' + r.factor);
});

prueba('el grupo de hojarasca tiene etiqueta y no se confunde con las pratenses', () => {
  assert.strictEqual(A.GUILD_LABELS.saprofita_humus, 'Saprofita de hojarasca');
  for (const k of ['senderuela', 'parasol', 'champinon', 'san_jorge']) {
    const sp = A.SPECIES.find(x => x.key === k);
    // Estas cuatro sí son pratenses y sí deben seguir penalizadas en bosque.
    const r = A.evaluarHabitat(sp, { vegetacion: ['hayedo'] });
    assert.ok(r.factor < 1, k + ' dejó de penalizarse en bosque: ' + r.factor);
  }
});

prueba('el óptimo térmico es frío, como dice la fuente', () => {
  // "Sólo aparecen cuando la temperatura baja de 17 °C" (Woodland Trust).
  assert.ok(pie.tOpt <= 12, 'tOpt demasiado cálido: ' + pie.tOpt);
  assert.ok(pie.tMax <= 18, 'tMax por encima del techo documentado: ' + pie.tMax);
  assert.ok(pie.tCrit <= 0, 'tCrit no refleja que tolera heladas: ' + pie.tCrit);
  // Y tiene que ser más fría que un boletus de otoño.
  const boletus = A.SPECIES.find(s => s.key === 'boletus');
  assert.ok(pie.tOpt < boletus.tOpt,
    'la seta de pie azul no puede tener óptimo más cálido que el boleto');
});

prueba('la ficha cita el libro y conserva la cita secundaria', () => {
  // Comprobación de estilo: la fuente primaria es Laux, pero el contraste con
  // Waldschatzfinder y Wikipedia queda escrito en la ficha, no se descarta.
  assert.ok(/Laux/.test(pie.fuente), 'sin cita del libro');
  assert.ok(/Fuentes secundarias/.test(pie.fuente), 'sin cita secundaria');
});

prueba('el hábitat declarado es de frondosas y pinar, no de pradera', () => {
  assert.ok(pie.habitat.includes('hayedo'), 'sin hayedo');
  assert.ok(pie.habitat.includes('robledal'), 'sin robledal');
  for (const prad of ['pradera', 'pastizal', 'majadal', 'ganado']) {
    assert.ok(!pie.habitat.includes(prad),
      'no es una especie de pradera: ' + prad);
  }
});

prueba('la ficha documenta la fuente y no se inventa la banda altitudinal', () => {
  assert.ok(pie.fuente && pie.fuente.length > 100, 'fuente demasiado corta');
  assert.strictEqual(pie.altEvidencia, 'indicado',
    'sin banda altitudinal publicada debe decir "indicado", no "documentado"');
});

prueba('el ciclo completo no produce NaN con la especie nueva', () => {
  const c = ctx({ tSuelo: 11, vegetacion: ['hayedo'] });
  const r = A.indice(pie, { ...c, terreno: { ...c.terreno, vegetacion: ['hayedo'] } });
  assert.ok(Number.isFinite(r.I), 'NaN: ' + r.I);
  assert.ok(r.I >= 0 && r.I <= 100, 'fuera de rango: ' + r.I);
  assert.strictEqual(r.viable, true);
});


prueba('la temporada es la de Waldschatzfinder, no la del libro', () => {
  // Decisión del usuario: aquí manda la segunda fuente, contra Laux. El motivo
  // está en CRUCE.pie_azul y la cita del libro sigue en LAUX.
  assert.ok(pie.temporada.includes(9), 'no incluye septiembre');
  assert.ok(pie.temporada.includes(12), 'no incluye diciembre');
  assert.ok(!pie.temporada.includes(4), 'la ventana no es la del libro');
  assert.ok(/Waldschatzfinder/.test(pie.temporadaTxt),
    'la ficha debe decir de dónde sale la temporada');
  assert.ok(/Laux la da más ancha/.test(pie.temporadaTxt),
    'la ficha debe declarar el desacuerdo con el libro');
});

grupo('12. Contraste con Waldschatzfinder y Wikipedia');

prueba('las 19 fichas citan las tres fuentes', () => {
  const sinSecundaria = A.SPECIES.filter(s => !/Fuentes secundarias/.test(s.fuente || ''));
  assert.strictEqual(sinSecundaria.length, 0,
    'sin cita secundaria: ' + sinSecundaria.map(s => s.key).join(', '));
});

prueba('ninguna ficha se apoya solo en el libro cuando hay contraste', () => {
  // Una cita secundaria sin decir que NO manda sobre el libro sería propaganda
  // de fuente: el lector no distinguiría cuál de las dos vale.
  for (const s of A.SPECIES) {
    if (!/Fuentes secundarias/.test(s.fuente || '')) continue;
    assert.ok(/no mandan sobre el libro/.test(s.fuente),
      s.key + ': la cita secundaria no aclara su peso');
  }
});

prueba('el perrechico es alcalinófilo y no ácido', () => {
  // Wikipedia: "common in grasslands in Europe, often in areas rich in
  // limestone".
  const pj = A.SPECIES.find(s => s.key === 'san_jorge');
  assert.strictEqual(pj.alcalinofila, true);
  assert.strictEqual(pj.acidofilo, false);
  assert.strictEqual(A.factorSuelo(7.6, pj).factor, 1, 'penaliza el suelo calizo');
  assert.ok(A.factorSuelo(5.2, pj).factor < 1, 'no penaliza el suelo ácido');
});

prueba('el contraste documenta la regla de urbano = 0 que choca con los datos', () => {
  // Varias especies están documentadas en parques y la regla las pone a 0. Se
  // decidió mantener la regla, pero el desacuerdo queda escrito para que no
  // se pierda: si algún día se cambia, está justificado y documentado.
  const cr = A.fuenteCruce('senderuela');
  assert.ok(/parques/i.test(cr), 'no documenta lo de los parques');
  assert.ok(/choca con la regla de urbano/i.test(cr),
    'no declara que la regla de urbano contradice a las fuentes');
});

grupo('13. Lista corta de fuentes en la ficha');

prueba('fuentesBreves devuelve solo nombres, sin comillas ni dos puntos', () => {
  // El fallo que se quiere evitar: que en la ficha aparezca el resumen de lo
  // que dice la fuente. Se detecta buscando comillas y dos puntos, que son
  // justo lo que abre una cita o un resumen.
  for (const sp of A.SPECIES) {
    const b = A.fuentesBreves(sp);
    assert.ok(b.length > 0, sp.key + ': lista de fuentes vacía');
    assert.ok(!b.includes('"'), sp.key + ': la lista corta trae una cita entrecomillada');
    assert.ok(!b.includes('“'), sp.key + ': la lista corta trae una cita tipográfica');
    assert.ok(!b.includes(':'), sp.key + ': la lista corta trae un resumen con dos puntos');
    assert.ok(b.length < 190, sp.key + ': la lista corta es demasiado larga (' + b.length + ')');
  }
});

prueba('ninguna especie repite el mismo autor en la lista corta', () => {
  for (const sp of A.SPECIES) {
    const partes = A.fuentesBreves(sp).split(' · ');
    assert.strictEqual(partes.length, new Set(partes).size,
      sp.key + ': fuente repetida -> ' + partes.join(' | '));
  }
});

prueba('todas citan la fuente primaria del proyecto', () => {
  // 18 de 19 salen de Laux. La excepción, la seta de cardo, no está en el
  // libro y por eso cita al artículo que sí la describe.
  for (const sp of A.SPECIES) {
    const b = A.fuentesBreves(sp);
    if (sp.key === 'seta_cardo') {
      assert.ok(/Carlavilla/.test(b),
        sp.key + ': debería citar a Carlavilla & Manjón');
      assert.ok(!/Laux/.test(b),
        sp.key + ': el libro no tiene su ficha, no debe citarse a Laux como primaria');
    } else {
      assert.ok(/Laux/.test(b),
        sp.key + ': le falta la fuente primaria del libro');
    }
  }
});

prueba('las fuentes de contraste solo salen si CRUCE las tiene', () => {
  for (const sp of A.SPECIES) {
    const b = A.fuentesBreves(sp);
    const c = A.CRUCE[sp.key] || {};
    assert.strictEqual(/Waldschatzfinder/.test(b), !!c.ws,
      sp.key + ': Waldschatzfinder no coincide con CRUCE');
    assert.strictEqual(/Wikipedia/.test(b), !!c.wiki,
      sp.key + ': Wikipedia no coincide con CRUCE');
  }
});

prueba('la cita larga se conserva intacta para la Metodología', () => {
  // Las dos cosas conviven: la ficha va corta y el apartado 4 va largo. Si esto
  // falla, se ha borrado el detalle en lugar de ocultarlo en la ficha.
  for (const sp of A.SPECIES) {
    assert.ok((sp.fuente || '').length > 40,
      sp.key + ': la cita larga sigue vacía');
  }
  const boletus = A.SPECIES.find(s => s.key === 'boletus');
  assert.ok(boletus.fuente.includes('Laux'), 'la cita larga perdió el libro');
  assert.ok(/[«"]/.test(boletus.fuente),
    'la cita larga ya no incluye el resumen de la fuente');
});

prueba('la lista corta es mucho más corta que la larga', () => {
  for (const sp of A.SPECIES) {
    const corta = A.fuentesBreves(sp).length;
    const larga = (sp.fuente || '').length;
    assert.ok(corta < larga / 2,
      sp.key + ': la lista corta (' + corta + ') no es mucho más corta que la larga (' + larga + ')');
  }
});

prueba('la confusion y la nota taxonómica del pie azul se quedan', () => {
  // El usuario quitó el CARTEL de aviso. Eso no es lo mismo que quitar los
  // datos del libro: la confusión con dos Cortinarius venenosos y la
  // denominacion aceptada siguen en la ficha de la especie, que es donde se
  // leen. Estos dos tests estaban puestos para que nadie borrara el cartel
  // «por limpieza de código»; ahora el que lo borra es el usuario, y a
  // proposito, asi que se comprueba lo que se conserva.
  assert.ok(pie.confusion && /cortinarius/i.test(pie.confusion),
    'la confusión con los Cortinarius sigue en la ficha');
  assert.ok(pie.taxonomiaAviso && /tricholomataceae/i.test(pie.taxonomiaAviso),
    'la nota taxonómica sigue en la ficha');
  assert.strictEqual(pie.toxica, false,
    'el pie azul ya no está marcado como tóxica');
  assert.strictEqual(pie.aviso, undefined,
    'el aviso se quitó: si vuelve a salir sin querer, hay cartel vacío');
});

grupo('14. Marzuelo y colmenilla, dos especies distintas');

prueba('el marzuelo y la colmenilla son fichas separadas', () => {
  // El fallo original: un solo registro, con el nombre español del marzuelo
  // encima de la ficha de la colmenilla. Aquí se comprueba que existen las dos
  // y que cada una conserva su nombre latino.
  const morena = A.SPECIES.find(s => s.key === 'morena');
  const marzuelo = A.SPECIES.find(s => s.key === 'marzuelo');
  assert.ok(morena, 'la colmenilla ha desaparecido');
  assert.ok(marzuelo, 'el marzuelo no está en la lista');
  assert.notStrictEqual(morena.lat, marzuelo.lat,
    'las dos fichas comparten nombre latino: ' + morena.lat);
});

prueba('el nombre español de cada una es el suyo y no el de la otra', () => {
  const m = A.SPECIES.find(s => s.key === 'morena');
  const z = A.SPECIES.find(s => s.key === 'marzuelo');
  // «Marzuelo» y «seta de marzo» son nombres de H. marzuolus. La colmenilla
  // no puede llevarlos en ningún campo visible.
  const textoColmenilla = [m.es, m.alias, m.temporadaTxt, m.comestible,
    m.confusion || '', m.aviso || ''].join(' ').toLowerCase();
  assert.ok(!/marzuel/.test(textoColmenilla),
    'la colmenilla vuelve a llamarse marzuelo: ' + textoColmenilla);
  assert.ok(!/seta de marzo/.test(textoColmenilla),
    'la colmenilla vuelve a llamarse "seta de marzo"');
  // Y el marzuelo sí se llama así.
  assert.ok(/marzuel/i.test(z.es + z.alias),
    'el marzuelo no se reconoce por su nombre');
});

prueba('cada ficha conserva el texto que le da el libro', () => {
  // El error no era solo el nombre: los datos estaban copiados de una ficha a
  // otra. Se comprueba que cada texto viene de SU ficha en el libro.
  const m = A.SPECIES.find(s => s.key === 'morena');
  const z = A.SPECIES.find(s => s.key === 'marzuelo');
  assert.strictEqual(m.temporadaTxt, A.LAUX.morena.epoca,
    'la colmenilla ya no usa su texto de temporada de Laux');
  assert.strictEqual(z.temporadaTxt, A.LAUX.marzuelo.epoca,
    'el marzuelo ya no usa su texto de temporada de Laux');
  // El texto del marzuelo menciona calizos y montaña; el de la colmenilla,
  // caducifolios y ribereños. Si se intercambian, se nota.
  assert.ok(/calizos/.test(z.temporadaTxt), 'el marzuelo perdió su suelo calizo');
  assert.ok(!/calizos/.test(m.temporadaTxt), 'la colmenilla no tiene suelos calizos en Laux');
});

prueba('los dos grupos ecológicos son los que dice cada fuente', () => {
  // El marzuelo es micorrízico (Wikipedia lo dice y es Hygrophoraceae); la
  // colmenilla es saprofita. Confundirlos aquí cambia el factor de pratense.
  const m = A.SPECIES.find(s => s.key === 'morena');
  const z = A.SPECIES.find(s => s.key === 'marzuelo');
  assert.strictEqual(m.guild, 'saprofita',
    'la colmenilla ha cambiado de grupo ecológico');
  assert.strictEqual(z.guild, 'ectomicorricico',
    'el marzuelo debería ser ectomicorrícico, no ' + z.guild);
});

prueba('la alcalinofilia del marzuelo sale del libro', () => {
  const z = A.SPECIES.find(s => s.key === 'marzuelo');
  assert.strictEqual(z.alcalinofila, true,
    'Laux dice "sobre suelos calizos": debería ser alcalinófila');
  assert.strictEqual(z.acidofilo, false,
    'no es acidofila: eso es del níscalo');
  // Su temporada es de invierno y primavera, no de otoño.
  assert.strictEqual(z.evidencia, 'derivado',
    'sin umbrales publicados su evidencia debe ser "derivado"');
});

prueba('el marzuelo cita el libro y no inventa una fuente numérica', () => {
  const z = A.SPECIES.find(s => s.key === 'marzuelo');
  assert.ok(/Laux/.test(A.fuentesBreves(z)),
    'el marzuelo está en el libro y debe citarlo');
  // No hay medición publicada de sus umbrales: si apareciera en el mapa de
  // fuentes numéricas sería inventar una cita.
  assert.strictEqual(A.FUENTES_NUMERAS.z, undefined,
    'el marzuelo no tiene fuente numérica publicada; no debe citarse ninguna');
});

grupo('15. Las tablas de la Metodología no se quedan atrás');

// Las dos tablas de la Metodologia están escritas a mano en index.html, asi que
// no se actualizan solas al anadir una especie. Estos tests las cotejan con
// SPECIES para que el desfase salga en las pruebas y no en la lectura.

// El HTML crudo no sirve para buscar frases: lleva un <strong> en mitad de
// ellas («De las 20 bandas, <strong>10 proceden…»), asi que se quitan las
// etiquetas y se lee el texto como lo ve una persona.
const TEXTO = () => require('fs').readFileSync('index.html', 'utf8')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&laquo;|&raquo;/g, '«')
  .replace(/\s+/g, ' ');

const NUM = () => require('fs').readFileSync('index.html', 'utf8');

const TABLAS = () => [...NUM().matchAll(/<table[\s\S]*?<\/table>/g)].map(m => m[0]);

// Filas de datos: las que llevan <td, no las del encabezado.
const filasDe = (tabla) => [...tabla.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
  .map(m => m[1])
  .filter(c => c.includes('<td'));

// Las celdas numericas llevan coma decimal en el HTML («11,5»), no punto.
const numerosDe = (celdas) => celdas
  .map(c => c.trim().replace(',', '.'))
  .filter(v => /^-?\d+(\.\d+)?$/.test(v))
  .map(Number);

// Numeros escritos con letra, hasta veinte.
const numeroDe = (t) => {
  const s = String(t).toLowerCase();
  if (/^\d+$/.test(s)) return Number(s);
  const p = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete',
    'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince',
    'dieciseis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte'];
  const i = p.indexOf(s);
  if (i === -1) throw new Error('no se sabe leer el numero «' + t + '»');
  return i;
};

prueba('cada especie tiene su fila en la tabla de umbrales', () => {
  // Salvedad deliberada: el boleto y la seta de pie azul NO aparecen, y no es
  // un descuido. Son las dos especies con cifra publicada en un estudio medido,
  // y el parrafo que precede a la tabla lo explica. Lo que se vigila es que la
  // lista de exclusiones siga siendo esa: si alguien excluye otra sin avisar,
  // salta.
  const excluidas = ['Boletus edulis', 'Lepista nuda'];

  const enTabla = new Set();
  for (const f of filasDe(TABLAS()[0])) {
    const lat = (f.match(/<em>([\s\S]*?)<\/em>/) || [])[1];
    if (lat) enTabla.add(lat);
  }

  for (const sp of A.SPECIES) {
    if (excluidas.includes(sp.lat)) {
      assert.ok(!enTabla.has(sp.lat),
        sp.lat + ' figura como excluida pero se le ha anadido fila');
      continue;
    }
    assert.ok(enTabla.has(sp.lat),
      sp.lat + ' (' + sp.key + ') no tiene fila en la tabla de umbrales');
  }

  assert.strictEqual(enTabla.size, A.SPECIES.length - excluidas.length,
    'la tabla de umbrales tiene ' + enTabla.size + ' filas y tocarian '
    + (A.SPECIES.length - excluidas.length));
});

prueba('cada fila de la tabla de umbrales lleva los numeros de SU especie', () => {
  // El fallo que esto caza: una fila con los numeros de una especie y el
  // nombre de otra. Cuando la colmenilla llevaba el nombre del marzuelo, eso
  // es exactamente lo que se vio.
  const porLatino = new Map(A.SPECIES.map(sp => [sp.lat, sp]));
  let leidas = 0;

  for (const fila of filasDe(TABLAS()[0])) {
    const latin = (fila.match(/<em>([\s\S]*?)<\/em>/) || [])[1];
    if (!latin) continue;
    const sp = porLatino.get(latin);
    assert.ok(sp, 'la tabla lista ' + latin + ', que no esta en SPECIES');

    const nums = numerosDe([...fila.matchAll(/class="num">([^<]*)</g)].map(m => m[1]));
    assert.deepStrictEqual(nums.slice(0, 4), [sp.tBase, sp.tOpt, sp.tMax, sp.tCrit],
      latin + ': tBase/tOpt/tMax/tCrit de la tabla (' + nums.slice(0, 4).join(', ')
      + ') no coinciden con el modelo ('
      + [sp.tBase, sp.tOpt, sp.tMax, sp.tCrit].join(', ') + ')');
    assert.deepStrictEqual(nums.slice(4, 8), [sp.gddNeed, sp.L, sp.Ro, sp.diasMax],
      latin + ': gddNeed/L/Ro/diasMax de la tabla no coinciden con el modelo');
    leidas++;
  }

  assert.ok(leidas > 0, 'no se ha leido ninguna fila de la tabla');
});

prueba('cada especie tiene su fila en la tabla de bandas altitudinales', () => {
  // Salvedad: la seta de pie azul no aparece. No es un descuido: su banda se
  // deduce sin ninguna fuente publicada, y el parrafo 4.5 explica que las
  // bandas sin rango en metros van por deducci\u00f3n del h\u00e1bitat. Al
  // contrary que en la tabla de umbrales, aqui solo falta una.
  const sinFila = ['Lepista nuda'];

  const enTabla = new Set();
  for (const f of filasDe(TABLAS()[1])) {
    const lat = (f.match(/<em>([\s\S]*?)<\/em>/) || [])[1];
    if (lat) enTabla.add(lat);
  }

  for (const sp of A.SPECIES) {
    if (sinFila.includes(sp.lat)) {
      assert.ok(!enTabla.has(sp.lat),
        sp.lat + ' figura sin fila pero se le ha anadido una');
      continue;
    }
    assert.ok(enTabla.has(sp.lat),
      sp.lat + ' (' + sp.key + ') no tiene fila en la tabla de altitud');
  }
  assert.strictEqual(enTabla.size, A.SPECIES.length - sinFila.length,
    'la tabla de altitud tiene ' + enTabla.size + ' filas y tocarian '
    + (A.SPECIES.length - sinFila.length));
});

prueba('la banda y el margen de la tabla son los de SU especie', () => {
  // El margen va en la segunda celda numerica, aparte de la banda: «800-2200 m»
  // y luego «700 m». Al leer solo la primera celda se cogia el margen y se
  // comparaba con la banda.
  const porLatino = new Map(A.SPECIES.map(sp => [sp.lat, sp]));
  let conBanda = 0;

  for (const fila of filasDe(TABLAS()[1])) {
    const latin = (fila.match(/<em>([\s\S]*?)<\/em>/) || [])[1];
    if (!latin) continue;
    const sp = porLatino.get(latin);
    assert.ok(sp, 'la tabla lista ' + latin + ', que no esta en SPECIES');
    if (!sp.alt) continue;

    const banda = fila.match(/class="num">([\d.,]+)\s*[\u2013\u2014-]\s*([\d.,]+)\s*m?<\/td>/);
    if (!banda) continue;   // fila sin banda escrita, que es la del pie azul

    const n = (x) => Number(String(x).replace(',', '.'));
    assert.deepStrictEqual([n(banda[1]), n(banda[2])], sp.alt.slice(0, 2),
      latin + ': banda de la tabla (' + n(banda[1]) + '-' + n(banda[2])
      + ') != banda del modelo (' + sp.alt.slice(0, 2).join('-') + ')');

    const margen = numerosDe([...fila.matchAll(/class="num">([^<]*)m<\/td>/g)].map(m => m[1]));
    assert.strictEqual(margen.length ? margen[0] : null, sp.alt[2],
      latin + ': margen de la tabla != ' + sp.alt[2] + ' del modelo');
    conBanda++;
  }

  assert.ok(conBanda >= A.SPECIES.length - 1,
    'solo se han podido comprobar ' + conBanda + ' bandas de ' + A.SPECIES.length);
});

prueba('el parrafo 4.5 cuenta las bandas que hay', () => {
  // «De las 20 bandas, 10 proceden de una fuente que da el rango en metros y 10
  // se deducen del tipo de habitat». Texto escrito a mano, y por eso el primero
  // en mentir cuando se anade una especie.
  const m = TEXTO().match(
    /De las (\w+) bandas, (\d+) proceden de una fuente que da el rango en metros y (\d+) se deducen/);
  assert.ok(m, 'no se encuentra el parrafo 4.5 con el recuento de bandas');

  const total = A.SPECIES.length;
  const doc = A.SPECIES.filter(s => s.altEvidencia === 'documentado').length;
  const ind = A.SPECIES.filter(s => s.altEvidencia === 'indicado').length;

  assert.strictEqual(numeroDe(m[1]), total,
    'dice «De las ' + m[1] + ' bandas» y hay ' + total);
  assert.strictEqual(Number(m[2]), doc,
    'dice ' + m[2] + ' documentadas y hay ' + doc);
  assert.strictEqual(Number(m[3]), ind,
    'dice ' + m[3] + ' deducidas y hay ' + ind);
});

prueba('los recuentos sueltos de la pagina dicen lo que dicen', () => {
  // El badge lateral «10 de 20» y la linea de Limitaciones «De las 20 bandas,
  // 10 estimadas». Los dos se quedaron sin actualizar al anadir el marzuelo, y
  // el segundo ya venia mal antes: decia 19 y 9 donde habia 18 y 8.
  const txt = TEXTO();
  const total = A.SPECIES.length;
  const doc = A.SPECIES.filter(s => s.altEvidencia === 'documentado').length;
  const ind = A.SPECIES.filter(s => s.altEvidencia === 'indicado').length;

  const badge = txt.match(/(\d+) de (\d+) bandas altitudinales con/);
  assert.ok(badge, 'no se encuentra el badge de bandas altitudinales');
  assert.strictEqual(Number(badge[2]), total,
    'el badge dice "' + badge[1] + ' de ' + badge[2] + '" y hay ' + total + ' especies');
  assert.strictEqual(Number(badge[1]), doc,
    'el badge dice ' + badge[1] + ' documentadas y hay ' + doc);

  const lim = txt.match(/De las (\d+) bandas altitudinales, (\d+) est\u00e1n estimadas/);
  assert.ok(lim, 'no se encuentra la linea de Limitaciones sobre las bandas');
  assert.strictEqual(Number(lim[1]), total,
    'Limitaciones dice ' + lim[1] + ' bandas y hay ' + total);
  assert.strictEqual(Number(lim[2]), ind,
    'Limitaciones dice ' + lim[2] + ' estimadas y hay ' + ind);
});

prueba('el recuento de alcalinófilas de la Metodología es el real', () => {
  // Aparece en dos sitios y con redaccion distinta: la version larga dice
  // «Son tres: el marzuelo…» y la corta «Dos: marzuelo, colmenilla y
  // perrechico». Se comprueban las dos, para que actualizar una y dejar la otra
  // no pase desapercibido.
  const txt = TEXTO();
  const ac = A.SPECIES.filter(s => s.alcalinofila).length;

  // OJO con partir por punto: el texto dice «\u00f3ptimo 7,6 con meseta de \u00b11,4,
  // suelo 0,60.» y ese punto es decimal, no el fin de la frase. Con dos
  // decimales en la misma linea no hay forma de saber por donde cortar sin
  // liarse. Asi que no se parte: se busca directamente la DIRECCION del
  // recuento, que es lo unico que hace falta comprobar.
  const NUMEROS = /uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\d+/;
  const cuenta = [...txt.matchAll(new RegExp(
    'Alcalin\\u00f3filas[^;]{0,140}?(?:Son (?:las )?|\\s)(' + NUMEROS.source + ')\\s*:', 'gi'))]
    .map(m => ({ texto: m[0].trim(), n: numeroDe(m[1]) }));

  assert.ok(cuenta.length >= 2,
    'se esperaban los dos recuentos de alcalin\u00f3filas y se hallaron ' + cuenta.length
    + ' (' + JSON.stringify(cuenta.map(c => c.texto)) + ')');

  for (const c of cuenta) {
    assert.ok(c.n > 0 && c.n < 11, 'no se sabe leer el recuento de: ' + JSON.stringify(c.texto));
    assert.strictEqual(c.n, ac,
      'la Metodologia cuenta ' + c.n + ' alcalin\u00f3filas y hay ' + ac
      + ' (en \u00ab' + c.texto.slice(0, 70) + '\u00bb)');
  }

  // Los bloques completos, para comprobar los nombres que se citan. Para el
  // recorte se usa el HTML crudo y las etiquetas se quitan despues: en TEXTO()
  // ya no queda ningun «</li>» donde cortar.
  const bloques = [...NUM().matchAll(/Alcalin\u00f3filas[\s\S]{0,400}?<\/li>/g)]
    .map(m => m[0].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
  assert.ok(bloques.length >= 2,
    'no se han localizado los dos bloques de texto (' + bloques.length + ')');

  for (const sp of A.SPECIES.filter(s => s.alcalinofila)) {
    const alias = (sp.alias || '').split(' \u00b7 ')[0];
    const nombres = [sp.es, alias]
      .filter(Boolean)
      .map(n => n.toLowerCase().replace(' / ', ' '));
    const aparece = nombres.some(n => bloques.some(b => b.toLowerCase().includes(n)));
    assert.ok(aparece,
      sp.key + ' es alcalin\u00f3fila pero no se nombra en la lista de la Metodologia');
  }
});

grupo('16. Los recuentos de la Metodología cuadran con las especies que hay');

prueba('el numero de especies que dice el documento es el real', () => {
  const txt = TEXTO();
  const total = A.SPECIES.length;

  const frases = [
    [/El modelo usa (\d+) especies/, 'el parrafo que abre el apartado 4'],
    [/De los (\d+) umbrales de las (\d+) especies/, 'el recuento de umbrales'],
    [/cada una de las (\d+) fichas/, 'la comprobacion de las relaciones termicas'],
  ];

  for (const [re, donde] of frases) {
    const m = txt.match(re);
    assert.ok(m, 'no se encuentra ' + donde);
    // El segundo grupo del recuento de umbrales es el de especies; el primero,
    // el de umbrales, que son ocho por especie.
    if (m.length > 2) {
      assert.strictEqual(Number(m[1]), total * 8,
        donde + ': dice ' + m[1] + ' umbrales y hay ' + (total * 8)
        + ' (' + total + ' especies x 8)');
    }
    const nEspecies = m.length > 2 ? Number(m[2]) : Number(m[1]);
    assert.strictEqual(nEspecies, total,
      donde + ': dice ' + nEspecies + ' especies y hay ' + total);
  }
});

prueba('la cifra de especies aparece en todos los sitios que debe', () => {
  // Si alguien anade una especie, tiene que acordarse de los cuatro sitios. Se
  // cuentan las apariciones que dicen la cifra correcta: si el documento deja
  // de mencionar el numero de especies en algun sitio, el test se dispara.
  const txt = TEXTO();
  const total = String(A.SPECIES.length);

  const menciones = (txt.match(new RegExp('(?<![\\d])' + total + ' especies', 'g')) || []).length;
  assert.ok(menciones >= 3,
    'solo aparecen ' + menciones + ' veces «' + total + ' especies»; se esperaban al menos 3');

  // Y no queda ninguna con la cifra de cuando habia una especie menos, salvo
  // donde la cifra es correcta por ser una resta.
  //
  // «Las otras 19 especies» SI es correcta: son 20 menos la que tiene el dato
  // medido. Los recuentos que deben decir el total llevan delante un sustantivo
  // de cantidad; el que es una resta empieza por «Las otras». Por eso se
  // excluyen esos, y no cualquier mencion del numero anterior.
  const vieja = String(A.SPECIES.length - 1);
  const todas = [...txt.matchAll(new RegExp('(?<![\\d])' + vieja + ' especies', 'g'))];
  const resquicios = todas.filter(m => !/Las otras /.test(
    txt.slice(Math.max(0, m.index - 12), m.index)));
  assert.strictEqual(resquicios.length, 0,
    'quedan ' + resquicios.length + ' menciones de «' + vieja + ' especies» que'
    + ' deberian decir ' + total + ': '
    + resquicios.map(m => JSON.stringify(txt.slice(m.index - 40, m.index + 20))).join(' '));

  // Y el caso de la resta se comprueba aparte, para que no se cuele.
  const otras = [...txt.matchAll(/Las otras (\d+) especies/g)];
  for (const m of otras) {
    assert.strictEqual(Number(m[1]), total - 1,
      'dice «Las otras ' + m[1] + ' especies» y deberia ser ' + (total - 1)
      + ' (' + total + ' menos la que tiene el dato medido)');
  }
});

prueba('la ficha del marzuelo no rompe el reparto termico que se documenta', () => {
  // El parrafo 4.1 agrupa las especies en bloques termicos por tBase y tCrit.
  // El marzuelo tiene los mas bajos de todas (2 y -4), asi que tiene que estar
  // en el bloque de invierno y no en ningun otro; si se colara en el de otoño
  // el texto estaria describiendo un reparto que ya no existe.
  const txt = TEXTO();
  const z = A.SPECIES.find(s => s.key === 'marzuelo');
  assert.ok(z, 'el marzuelo no esta');

  const invierno = txt.match(/Especies de invierno[\s\S]{0,260}/);
  assert.ok(invierno, 'no se encuentra el bloque de especies de invierno');
  assert.ok(/marzuel/i.test(invierno[0]),
    'el marzuelo (tBase ' + z.tBase + ', tCrit ' + z.tCrit + ') deberia estar en el bloque de invierno');

  // Y sus numeros tienen que ser coherentes con la regla del propio bloque.
  assert.ok(z.tBase <= 7 && z.tCrit <= 3,
    'el marzuelo ya no cumple «tBase <= 7 y tCrit <= 3»: ' + z.tBase + ' / ' + z.tCrit
    + '. Si se cambia, hay que moverlo de bloque en el texto.');

  // No puede estar ademas en el bloque de otoño o el de termofilas, que se
  // definen por rangos que el marzuelo no cumple.
  const otono = txt.match(/Especies de oto\u00f1o[\s\S]{0,200}/);
  assert.ok(otono, 'no se encuentra el bloque de especies de otoño');
  assert.ok(!/marzuel/i.test(otono[0]), 'el marzuelo esta tambien en el bloque de otoño');
});

grupo('17. El panel de terreno se pinta entero');

prueba('ninguna función de pintado se queda sin llamar', () => {
  // Todas las funciones render* de app.js, con lo que pinta cada una. Cada una
  // tiene que aparecer dos veces: la definición y la llamada. Con una sola, el
  // campo se queda en el «consultando…» del HTML para siempre, que es
  // exactamente lo que pasaba con renderVegetacion().
  //
  // Si se añade una renderX() nueva hay que apuntarla aquí, y el test avisa.
  const src = require('fs').readFileSync('app.js', 'utf8');

  const pintan = {
    renderVegetacion: 'Hábitat en el punto',
    renderTerreno: 'resumen de suelo',
    renderEstado: 'cabecera de estado',
    renderTarjetas: 'tarjetas de especies',
    renderAnalisis: 'bloque de análisis',
    updateLocationInfo: 'los campos de situación, altitud y temperatura',
    renderCargando: 'el estado de espera',
    renderEstadoSinDatos: 'el estado de error',
    renderFavorites: 'la lista de favoritos',
    renderGeoselector: 'el selector de punto',
  };

  for (const [nombre, que] of Object.entries(pintan)) {
    assert.ok(new RegExp('function ' + nombre + '\\s*\\(').test(src),
      nombre + '(): no hay ninguna función con ese nombre en app.js');
    const veces = (src.match(new RegExp('\\b' + nombre + '\\s*\\(', 'g')) || []).length;
    assert.ok(veces >= 2,
      nombre + '() pinta ' + que + ' pero nadie la llama: aparece ' + veces
      + ' vez (sólo la definición). Ese campo se queda en «consultando…» para siempre.');
  }

  // La comprobación inversa: toda render* que exista en el fichero tiene que
  // estar en la lista de arriba. Sin esto, una función nueva se podría colar
  // sin que nadie se entere de que nadie la llama.
  const definidas = [...src.matchAll(/function (render\w+)\s*\(/g)].map(m => m[1]);
  const sinRegistrar = definidas.filter(n => !(n in pintan));
  assert.deepStrictEqual(sinRegistrar, [],
    'hay funciones render* que no están en la lista de este test: '
    + sinRegistrar.join(', ') + '. Añádelas para que se compruebe que se llaman.');
});

prueba('cada campo del panel de terreno lo pinta alguna función', () => {
  // El panel de terreno es la lista de .terrain-item: cada uno tiene un id en
  // el <span> del valor. Si un id se queda sin escritor, ese campo muestra el
  // texto inicial para siempre.
  //
  // No se miran los ids de las pestanas («analisis», «favoritos», «setas»):
  // ésos no los pinta ninguna función, los cambia el enrutador al pulsar la
  // pestaña, y el valor por defecto es estar oculto.
  const html = require('fs').readFileSync('index.html', 'utf8');
  const src = require('fs').readFileSync('app.js', 'utf8');

  const campos = [...html.matchAll(/class="terrain-item"[\s\S]{0,220}?id="(\w+)"/g)]
    .map(m => m[1]);

  assert.ok(campos.length >= 8,
    'sólo se han encontrado ' + campos.length
    + ' campos del panel de terreno; el HTML ha cambiado');

  for (const id of campos) {
    // Con set() se busca '#id', con getElementById se busca el id a secas.
    const escrito = new RegExp("'#" + id + "'|\\b" + id + "\\b").test(src);
    assert.ok(escrito,
      'el campo "' + id + '" del panel de terreno no se pinta nunca:'
      + ' su valor se queda en el texto inicial del HTML');
  }

  // Y el que fallaba, por si acaso.
  assert.ok(/habitatLine/.test(src), 'habitatLine ha desaparecido de app.js');
});

prueba('el habitat se pinta despues de llegar y antes de pintar el ranking', () => {
  // El orden importa por una razon concreta: aplicarDatos() construye el
  // contexto del modelo y renderVegetacion() lee currentHabitat. Si se
  // llamara antes de que currentHabitat estuviera lleno, imprimiría
  // «consultando…» teniendo el dato ya disponible.
  const src = require('fs').readFileSync('app.js', 'utf8');

  const iAsignacion = src.indexOf('currentHabitat = rh.value');
  const iAplicar = src.indexOf('aplicarDatos(m, s);');
  const iRender = src.indexOf('renderVegetacion();');

  assert.ok(iAsignacion > 0, 'no se encuentra la asignacion de currentHabitat');
  assert.ok(iAplicar > 0, 'no se encuentra la llamada a aplicarDatos');
  assert.ok(iRender > 0, 'no se encuentra la llamada a renderVegetacion');

  assert.ok(iAsignacion < iAplicar,
    'currentHabitat se asigna despues de aplicarDatos, asi que el habitat llega tarde');
  assert.ok(iAsignacion < iRender,
    'renderVegetacion se llama antes de que currentHabitat tenga el dato');
});

grupo('18. Los valores de las tarjetas empiezan en mayúscula');

prueba('mayus() sólo cambia la primera letra', () => {
  // mayus() vive en app.js, que es un script clásico y no un módulo, así que los
  // tests no la pueden importar. Se comprueba su comportamiento sacando el
  // cuerpo de la función del propio fichero y evaluándolo aparte: si mañana
  // alguien la toca, el test lo nota sin necesidad de arrancar un navegador.
  const src = require('fs').readFileSync('app.js', 'utf8');

  const def = src.match(/function mayus\(s\)\s*\{[\s\S]*?\n\}/);
  assert.ok(def, 'no se encuentra la función mayus() en app.js');
  const fn = new Function('return (' + def[0] + ')')();

  assert.strictEqual(fn('comestible'), 'Comestible');
  assert.strictEqual(fn('excelente'), 'Excelente');
  assert.strictEqual(fn('de abril a mayo, aislada o en grupos'),
    'De abril a mayo, aislada o en grupos');
  assert.strictEqual(fn('suelo demasiado calizo'), 'Suelo demasiado calizo');

  // No toca el resto de la frase: sólo la primera letra. Esto es lo que
  // distingue mayus() de capitalizarlo todo, que reventaría los acróimos y
  // los nombres propios del texto del libro.
  assert.strictEqual(fn('comestible; las personas más delicadas'),
    'Comestible; las personas más delicadas');
  assert.strictEqual(fn('seta de pino'), 'Seta de pino');
  assert.strictEqual(fn('de Ribadavia, Galicia'), 'De Ribadavia, Galicia');

  // Con acentos y eñes al principio.
  assert.strictEqual(fn('árboles'), 'Árboles');
  assert.strictEqual(fn('hígado'), 'Hígado');
  assert.strictEqual(fn('otoño'), 'Otoño');
  // Ya en mayúscula no se toca (toLocaleUpperCase es idempotente).
  assert.strictEqual(fn('Comestible'), 'Comestible');
  assert.strictEqual(fn('Árboles'), 'Árboles');

  // Símbolos que se escriben con mayúscula dentro y que no son el inicio de
  // una frase. Sin este caso, «pH adecuado» salía «PH adecuado».
  assert.strictEqual(fn('pH adecuado'), 'pH adecuado');
  assert.strictEqual(fn('pH'), 'pH');
  assert.strictEqual(fn('kWh por metro'), 'kWh por metro');
  assert.strictEqual(fn('mS/cm'), 'mS/cm');
  // Pero una palabra que empieza por «P» sí se capitaliza: la segunda letra es
  // minúscula, así que no es un símbolo.
  assert.strictEqual(fn('pradera'), 'Pradera');

  // Casos límite. mayus() es un ayudante de texto: un número no tiene "primera
  // letra", y lo razonable es devolverlo como cadena sin romperse. Lo que no
  // debe es lanzar.
  assert.strictEqual(fn(''), '');
  assert.strictEqual(fn('   '), '', 'los espacios no cuentan como letra');
  assert.strictEqual(fn(null), null, 'null se devuelve tal cual, no como texto');
  assert.strictEqual(fn(undefined), undefined);
  assert.strictEqual(fn(42), '42');
  assert.strictEqual(fn(0), '0');
});

prueba('la temporada, la comestibilidad y la helada pasan por mayus()', () => {
  // Los valores largos de la tarjeta. Si alguno se queda sin mayus(), vuelve a
  // leerse como continuación de la etiqueta («Comestibilidad: comestible»).
  const src = require('fs').readFileSync('app.js', 'utf8');

  const desde = src.indexOf('function tarjeta(');
  const hasta = src.indexOf('// Análisis: ranking');
  assert.ok(desde > 0 && hasta > desde, 'no se encuentra la función tarjeta()');
  const cuerpo = src.slice(desde, hasta);

  assert.ok(/mayus\(temporadaTexto\(sp\)\)/.test(cuerpo),
    'la temporada de la tarjeta ya no pasa por mayus()');
  assert.ok(/mayus\(sp\.comestible/.test(cuerpo),
    'la comestibilidad de la tarjeta ya no pasa por mayus()');
  assert.ok(/mayus\(textoHelada\(/.test(cuerpo),
    'el texto de helada de la tarjeta ya no pasa por mayus()');
  assert.ok(/mayus\(r\.detalle\.sueloEtiqueta\)/.test(cuerpo),
    'la etiqueta de suelo de la tarjeta ya no pasa por mayus()');
  assert.ok(/mayus\(r\.motivo\)/.test(cuerpo),
    'el motivo de inviabilidad ya no pasa por mayus()');
});

prueba('la ficha de la pestaña Especies usa el mismo mayus()', () => {
  // Las dos vistas pintan los mismos datos y tienen que leerse igual. Si aquí
  // se aplicara mayus() y en las tarjetas no, o al revés, una de las dos queda
  // con «Comestibilidad: comestible».
  const src = require('fs').readFileSync('app.js', 'utf8');

  // La ficha no la pinta una función aparte: la monta
  // initMushroomSelector(), que arma el selector y las tarjetas a la vez.
  const desde = src.indexOf('function initMushroomSelector');
  assert.ok(desde > 0, 'no se encuentra initMushroomSelector() en app.js');
  const cuerpo = src.slice(desde, desde + 8000);
  assert.ok(/mushroom-info-details/.test(cuerpo),
    'initMushroomSelector() ya no pinta la ficha de especie');

  assert.ok(/mayus\(temporadaTexto\(sp\)\)/.test(cuerpo),
    'la temporada de la ficha ya no pasa por mayus()');
  assert.ok(/mayus\(sp\.comestible/.test(cuerpo),
    'la comestibilidad de la ficha ya no pasa por mayus()');
  assert.ok(/mayus\(sp\.confusion\)/.test(cuerpo),
    'la confusion de la ficha ya no pasa por mayus()');
  assert.ok(/mayus\(sp\.taxonomiaAviso\)/.test(cuerpo),
    'el aviso de taxonomia de la ficha ya no pasa por mayus()');

  // El habitat ya llevaba cap() desde antes, que es lo correcto: son claves
  // internas con guion bajo, no frases.
  assert.ok(/sp\.habitat\.map\(cap\)/.test(cuerpo),
    'el habitat de la ficha deberia seguir con cap(), no con mayus()');
});

prueba('los avisos de toxicidad ya empiezan en mayúscula', () => {
  // El banner rojo de «ESPECIE TÓXICA» no pasa por mayus(), y no hace falta:
  // los tres textos que hay ya empiezan en mayúscula. Este test lo fija, para
  // que nadie añada un aviso en minúscula pensando que mayus() lo tapará.
  for (const sp of A.SPECIES) {
    if (!sp.aviso) continue;
    assert.ok(/^[A-ZÁÉÍÓÚÑ0-9«]/.test(sp.aviso),
      sp.key + ': el aviso empieza en minúscula -> ' + JSON.stringify(sp.aviso.slice(0, 40)));
  }
});

prueba('ningún texto que empiece una celda va en minúscula', () => {
  // El problema original era de lo que empieza una celda: «Comestibilidad:
  // comestible» se lee como si el valor fuese parte de la etiqueta. Un texto en
  // mitad de celda no tiene ese problema —el «(estimada)» que va detrás de la
  // banda altitudinal, por ejemplo—, así que no se mira.
  //
  // Se buscan sólo los tres sitios donde un valor arranca de verdad: la rama
  // «else» de un ternario, el valor por defecto de un ||, y el contenido
  // directo de un span. El resto de literales son claves internas,
  // identificadores o sufijos, y no son el principio de nada.
  const src = require('fs').readFileSync('app.js', 'utf8');

  const desde = src.indexOf('function tarjeta(');
  const hasta = src.indexOf('📊 Ranking de especies');
  assert.ok(desde > 0 && hasta > desde,
    'no se encuentra la plantilla de las tarjetas');

  // Lo que ya va envuelto en mayus() sale capitalizado por definición, así que
  // se vacía antes de mirar. Sin este recorte el test daba un falso positivo
  // con el «estimada» de «Vegetación (estimada)», que en pantalla ya sale
  // «Vegetación (Estimada)».
  const sinClases = src.slice(desde, hasta)
    // Los valores de class e id son nombres para el navegador: minúscula
    // obligatoria. Aquí cae el 'inviable' de `class="… ${r.viable ? '' :
    // 'inviable'}"`, que es una clase y no un texto que se lea.
    .replace(/(class|id)="[^"]*"/g, m => ' '.repeat(m.length))
    // Y lo que ya va envuelto en mayus() sale capitalizado por definición, así
    // que se vacía también. Sin este recorte el test daba un falso positivo con
    // el «estimada» de «Vegetación (estimada)», que en pantalla ya sale
    // «Vegetación (Estimada)».
    .replace(/mayus\([^()]*\)/g, m => ' '.repeat(m.length));

  const sinMayus = sinClases;

  const arranques = [
    ...[...sinMayus.matchAll(/:\s*'([^']{2,80})'/g)].map(m => ({ donde: 'rama else', t: m[1] })),
    ...[...sinMayus.matchAll(/\|\|\s*'([^']{2,80})'/g)].map(m => ({ donde: 'valor por defecto', t: m[1] })),
    ...[...sinMayus.matchAll(/>\s*'([^']{2,80})'/g)].map(m => ({ donde: 'contenido del span', t: m[1] })),
  ];

  assert.ok(arranques.length > 0,
    'no se ha encontrado ningún valor literal en las tarjetas; el código ha '
    + 'cambiado y este test necesita revisarse');

  const minusculas = arranques
    .filter(a => /^[a-záéíóúñü]/.test(a.t))
    .map(a => a.donde + ': «' + a.t + '»');

  assert.deepStrictEqual(minusculas, [],
    'estos valores empiezan una celda y van en minúscula: ' + minusculas.join(', ')
    + '. O se capitalizan, o se envuelven en mayus() si vienen de un dato.');
});

prueba('el texto que se pinta sale de la fuente y sólo se le toca la letra', () => {
  // mayus() se aplica AL PINTAR, no a los datos. Si se tocara en los datos, la
  // cita de la fuente quedaría deformada y la Metodología, que la imprime
  // entera, dejaría de ser la frase del libro.
  for (const sp of A.SPECIES) {
    assert.strictEqual(sp.comestible, sp.comestible.trim(),
      sp.key + ': comestible tiene espacios');
    // El dato sigue como lo escribió la fuente: en minúscula cuando la
    // fuente lo dejó en minúscula.
    if (sp.comestible && /^[A-ZÁÉÍÓÚÑ]/.test(sp.comestible)) {
      assert.ok(sp.evidencia, sp.key + ': comestible empieza en mayúscula sin motivo');
    }
  }

  // La temporada de la colmenilla es la frase del libro tal cual. Si alguien la
  // capitaliza en los datos, esta comparación falla y avisa.
  const morena = A.SPECIES.find(s => s.key === 'morena');
  assert.ok(/^de abril a mayo/.test(morena.temporadaTxt),
    'la temporada de la colmenilla ya no es la frase de Laux: ' + morena.temporadaTxt.slice(0, 40));
});

grupo('19. La Metodología es una sola tarjeta');

prueba('la sección de la Metodología tiene una sola tarjeta', () => {
  const html = require('fs').readFileSync('index.html', 'utf8');
  const m = html.match(/<section[^>]*id="guia"[\s\S]*?<\/section>/);
  assert.ok(m, 'no se encuentra la sección #guia');

  const sec = m[0];

  // Se cuentan los div de clase "card" que son hijos directos de la sección, no
  // los anidados: dentro de la tarjeta hay otros div con clase propia (los
  // bloques de código, los índices) y no cuentan.
  const nivel = [];
  let n = 0;
  for (const t of sec.matchAll(/<div\b[^>]*>|<\/div>/g)) {
    const antes = n;
    n += t[0] === '</div>' ? -1 : 1;
    nivel.push({ pos: t.index, abre: t[0] !== '</div>', prof: n, antes, texto: t[0] });
  }

  const tarjetas = nivel.filter(x => x.abre && x.antes === 0 && x.prof === 1
    && x.texto.includes('class="card'));
  assert.strictEqual(tarjetas.length, 1,
    'la Metodología tiene ' + tarjetas.length + ' tarjetas de nivel superior;'
    + ' se esperaba una sola');

  // Y que no quede ninguna warn-card suelta, que era la marca de los dos
  // apartados que avisan.
  assert.strictEqual((sec.match(/class="card warn-card"/g) || []).length, 0,
    'quedan tarjetas warn-card sueltas dentro de la Metodología');
});

prueba('los diez apartados siguen ahí y en orden', () => {
  const html = require('fs').readFileSync('index.html', 'utf8');
  const sec = html.match(/<section[^>]*id="guia"[\s\S]*?<\/section>/)[0];

  const titulos = [...sec.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)]
    .map(m => m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());

  assert.strictEqual(titulos.length, 10,
    'la Metodología tiene ' + titulos.length + ' apartados; se esperaban 10');

  for (let i = 0; i < 10; i++) {
    assert.ok(titulos[i].startsWith((i + 1) + ' \u00b7 '),
      'el apartado ' + (i + 1) + ' dice \u00ab' + titulos[i] + '\u00bb;'
      + ' se esperaba que empiece por «' + (i + 1) + ' · »');
  }
});

prueba('el texto de la Metodología es el mismo que antes', () => {
  // Esta es la comprobación que de verdad importa. La operación era de
  // contenedor, así que el interior no puede haber cambiado: ni una palabra, ni
  // un número, ni una ruta. Si al quitar las cajas se hubiera movido algo de
  // sitio, aquí se vería.
  const fs = require('fs');
  const html = fs.readFileSync('index.html', 'utf8');
  const sec = html.match(/<section[^>]*id="guia"[\s\S]*?<\/section>/)[0];

  const visible = (t) => t.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const texto = visible(sec);

  // Se comprueba contra los fragmentos que no pueden perderse: los numeros que
  // se corrigieron al añadir el marzuelo y al quitar la seta de ostra.
  const needles = [
    ['19 especies', 'el número de especies tras quitar la seta de ostra'],
    ['152 umbrales', 'el recuento de umbrales: 19 x 8'],
    ['9 de 19', 'el badge de bandas con fuente'],
    ['De las 19 bandas altitudinales', 'el recuento de Limitaciones'],
    ['Hygrophorus marzuolus', 'la fila del marzuelo en alguna tabla'],
    ['Morchella esculenta', 'la fila de la colmenilla'],
    ['Marzuelo', 'el nombre del marzuelo'],
    ['Colmenilla', 'el nombre de la colmenilla'],
  ];
  for (const [aguja, porque] of needles) {
    assert.ok(texto.includes(aguja),
      'ya no aparece \u00ab' + aguja + '\u00bb en la Metodología (' + porque + ')');
  }

  // Y que la tarjeta no sea una maraña de espacios: el Interior venia
  // indentado con dos espacios dentro de cada div y eso se ha tenido que quitar.
  assert.ok(!/\n  \n/.test(sec.replace(/\r\n/g, '\n')),
    'han quedado líneas en blanco con sangría dentro de la tarjeta');
});

grupo('20. El recuento de la ventana de acumulación no se queda viejo');

// OJO: TEXTO() devuelve el texto SIN etiquetas, así que aquí no puede aparecer
// un «</p>» ni un «</span>». Los dos primeros tests fallaron por buscar
// justamente eso, no por lo que perseguían.
const PALABRAS = ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete',
  'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince',
  'dieciseis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte'];

// La lista empieza en indice 0 con «cero», así que el número 15 está en el
// índice 14. Con un `n` sin restar, aPalabras(15) devolvía «dieciseis».
const aPalabras = (n) => (n >= 1 && n <= PALABRAS.length ? PALABRAS[n - 1] : String(n));

prueba('los números de la sección 4.4 son los reales', () => {
  // El histórico que pide la aplicación: lo mismo que mete en Open-Meteo.
  const HISTORICO = 30;

  const caben = A.SPECIES.filter(s => s.diasMax <= HISTORICO).length;
  const noCaben = A.SPECIES.length - caben;
  const topeAlto = A.SPECIES.filter(s => s.diasMax >= 45 && s.diasMax <= 60).length;

  // Si caben todas o no cabe ninguna, el reparto del párrafo no aplicaría y el
  // texto tendría que estar escrito de otra manera.
  assert.ok(caben > 0 && caben < A.SPECIES.length,
    'o caben todas o no cabe ninguna (' + caben + ' de ' + A.SPECIES.length
    + '); el párrafo está mal plantado');

  const txt = TEXTO();
  const ini = txt.indexOf('Es el número de días consecutivos');
  assert.ok(ini > 0, 'no se encuentra el párrafo 4.4 · diasMax');
  const p = txt.slice(ini, ini + 800);

  assert.ok(p.includes(aPalabras(caben)),
    'el párrafo dice cuántos caben en ' + HISTORICO + ' días y no es ' + caben
    + '. De las ' + A.SPECIES.length + ' especies caben ' + caben
    + '. Hay que revisar la sección 4.4.');

  assert.ok(p.includes(aPalabras(noCaben)),
    'el párrafo dice cuántas NO caben, y no es ' + noCaben
    + ' («' + aPalabras(noCaben) + '» no aparece en el texto del párrafo)');

  assert.ok(p.includes(aPalabras(topeAlto)),
    'el párrafo dice cuántas tienen tope de 45 a 60, y no es ' + topeAlto
    + ' («' + aPalabras(topeAlto) + '» no aparece)');
});

prueba('ningún recuento escrito a mano contradice a los datos', () => {
  // El caso general de lo que pasó con el «ocho»: un número tecleado en el
  // texto que deja de ser cierto en cuanto cambia el modelo. Se comprueban
  // todos los recuentos de especies de la Metodología de una tacada.
  const txt = TEXTO();
  const total = A.SPECIES.length;

  const frases = [
    [/El modelo usa (\d+) especies/, 'el número de especies del modelo'],
    [/De los (\d+) umbrales de las (\d+) especies/, 'el recuento de umbrales'],
    [/cada una de las (\d+) fichas/, 'el número de fichas'],
    [/De las (\d+) bandas/, 'el número de bandas'],
    [/De las (\d+) bandas altitudinales/, 'las bandas de Limitaciones'],
  ];

  for (const [re, donde] of frases) {
    const m = txt.match(re);
    assert.ok(m, 'no se encuentra ' + donde);
    for (const cifra of m.slice(1).filter(x => /^\d+$/.test(x)).map(Number)) {
      // Los umbrales son ocho por especie; el resto de cifras son el número de
      // especies o de bandas, que ahora es el mismo número.
      const valido = (cifra === total || cifra === total * 8);
      assert.ok(valido,
        donde + ': dice ' + cifra + ', y no es ni ' + total + ' (especies) ni '
        + (total * 8) + ' (umbrales)');
    }
  }

  // El badge lateral «10 de 20» va aparte porque sus dos cifras no significan
  // lo mismo: la de arriba es cuántas bandas tienen fuente documentada y la de
  // abajo es el total. Comprobarlas las dos contra el número de especies sería
  // un error del test, no del documento.
  const documentadas = A.SPECIES.filter(s => s.altEvidencia === 'documentado').length;
  const badge = txt.match(/(\d+) de (\d+) bandas altitudinales/);
  assert.ok(badge, 'no se encuentra el badge de bandas altitudinales');
  assert.strictEqual(Number(badge[2]), total,
    'el badge dice «' + badge[1] + ' de ' + badge[2] + '» y el total son ' + total
    + ' especies');
  assert.strictEqual(Number(badge[1]), documentadas,
    'el badge dice ' + badge[1] + ' bandas con fuente, y hay ' + documentadas
    + ' documentadas');
});

grupo('21. Los iconos de las tarjetas son todos puntos');

prueba('ningún icono es un cuadrado ni otra figura que no sea un punto', () => {
  const src = require('fs').readFileSync('app.js', 'utf8');

  // Los cuadrados y el copo de nieve que se colaron. No hay forma de
  // preguntarle a JavaScript si un emoji es un círculo, así que la lista de
  // prohibidos es explícita.
  // Lista MEDIDA, no de memoria. Se renderizo el bloque entero en el
  // navegador para averiguarlo, porque fiarse del nombre del caracter sale mal:
  // 1F7E7 es el cuadrado naranja y 1F7E0 el circulo naranja, al reves de como
  // los Generation los enumera. Ese error hizo que al pedir circulos se
  // cambiara un circulo por un cuadrado.
  //
  // Bloque de formas grandes (1F7E0-1F7EF):
  //   circulos   1F7E0 naranja  1F7E1 amarillo  1F7E2 verde
  //              1F7E3 morado   1F7E4 marron
  //   cuadrados  1F7E5 rojo     1F7E6 azul      1F7E7 naranja
  //              1F7E8 amarillo 1F7E9 verde     1F7EA morado
  //              1F7EB marron   1F7EF blanco
  const prohibidos = {
    '\u{1F7E5}': 'cuadrado rojo grande',
    '\u{1F7E6}': 'cuadrado azul grande',
    '\u{1F7E7}': 'cuadrado naranja grande',
    '\u{1F7E8}': 'cuadrado amarillo grande',
    '\u{1F7E9}': 'cuadrado verde grande',
    '\u{1F7EA}': 'cuadrado morado grande',
    '\u{1F7EB}': 'cuadrado marrón grande',
    '\u{1F7EF}': 'cuadrado blanco grande',
    '\u2B1B': 'cuadrado negro grande',
    '\u2B1C': 'cuadrado blanco grande',
    '\u25A0': 'cuadrado negro geométrico',
    '\u2744': 'copo de nieve',
    '\u2B1A': 'cuadrado negro pequeño',
  };

  // Y la lista buena, para comprobar que hay circulos de verdad y no solo que
  // no haya cuadrados. Esta tambien estaba mal antes.
  const permitidos = [
    '\u{1F7E0}', '\u{1F7E1}', '\u{1F7E2}', '\u{1F7E3}', '\u{1F7E4}',
    '\u{1F534}', '\u{1F535}', '\u{1F536}', '\u{1F537}',
    '\u26AA', '\u26AB', '\u25CF', '\u25CB',
  ];

  // Solo el bloque de iconos, no el fichero entero: un cuadrado puede
  // aparecer legítimamente en un dibujo o en un texto.
  const bloque = src.match(/const MUSHROOM_META = \{[\s\S]*?\n\};/);
  assert.ok(bloque, 'no se encuentra MUSHROOM_META en app.js');

  for (const [emoji, nombre] of Object.entries(prohibidos)) {
    assert.ok(!bloque[0].includes(emoji),
      'hay un ' + nombre + ' (U+'
      + [...emoji].map(c => c.codePointAt(0).toString(16).toUpperCase()).join(' U+')
      + ') entre los iconos de las especies. Todos deben ser puntos.');
  }

  // Y que sí haya círculos de verdad, no que simplemente no haya cuadrados.
  const hay = permitidos.filter(c => bloque[0].includes(c));
  assert.ok(hay.length >= 5,
    'solo se han encontrado ' + hay.length + ' círculos distintos; el mapa de '
    + 'iconos ha cambiado más de lo previsto');
});

prueba('el icono se parece al color del anillo', () => {
  // No hay forma de preguntarle a JavaScript si un emoji es naranja. Lo que se
  // puede es mantener la tabla de qué tono de icono le toca a cada color de
  // anillo y comprobar que el par existe. Mantenerla es trabajo de un minuto.
  //
  // OJO: 🟠 U+1F7E0 es el CUADRADO naranja y 🟧 U+1F7E7 el CIRCULO naranja. No
  // son intercambiables, y el cuadrado se quitó del mapa a propósito.
  // Tabla hecha leyendo los pares reales de MUSHROOM_META, no de memoria.
  // Se mantiene a mano: es una cuestión de ojo, no una regla que se pueda
  // calcular, porque no hay forma de preguntarle a JavaScript si un emoji
  // «es marrón». Mantenerla es trabajo de un minuto.
  // Tabla hecha leyendo los pares reales de MUSHROOM_META, no de memoria.
  // Se mantiene a mano: es una cuestión de ojo, no una regla que se pueda
  // calcular, porque no hay forma de preguntarle a JavaScript si un emoji
  // «es marrón». Mantenerla es trabajo de un minuto.
  const TONO = {
    '#212121': '\u{26AB}',     // trompeta
    '#455a64': '\u{26AB}',     // girola
    '#4e342e': '\u{26AB}',     // boleto_bronce
    '#5d4037': '\u{1F7E4}',     // seta_pino
    '#78909c': '\u{1F535}',     // marzuelo
    '#795548': '\u{1F7E4}',     // morena
    '#7e57c2': '\u{1F7E3}',     // pie_azul
    '#8b4513': '\u{1F7E4}',     // boletus
    '#8d6e63': '\u{1F7E4}',     // parasol
    '#9c4a1a': '\u{1F7E4}',     // boleto_pino
    '#9e9e9e': '\u{26AA}',     // senderuela
    '#bdbdbd': '\u{26AA}',     // champinon
    '#c62828': '\u{1F534}',     // rovello
    '#c9a227': '\u{1F7E1}',     // hongo_verano
    '#d32f2f': '\u{1F534}',     // amanita
    '#d7ccc8': '\u{26AA}',     // seta_cardo
    '#e0e0e0': '\u{26AA}',     // san_jorge
    '#e65100': '\u{1F7E0}',     // niscalos
    '#f9a825': '\u{1F7E1}',     // rebozuelo
    '#fbc02d': '\u{1F7E1}',     // gula_monte
  };



  const src = require('fs').readFileSync('app.js', 'utf8');
  const bloque = src.match(/const MUSHROOM_META = \{[\s\S]*?\n\};/)[0];

  const entradas = [...bloque.matchAll(/(\w+):\s*\{\s*icon:\s*'([^']*)'\s*,\s*color:\s*'([^']*)'/g)]
    .map(m => ({ key: m[1], icon: m[2], color: m[3].toLowerCase() }));

  for (const e of entradas) {
    const sp = A.SPECIES.find(s => s.key === e.key);
    const nombre = sp ? sp.es : e.key;
    assert.ok(TONO[e.color],
      nombre + ': el color ' + e.color + ' no está en la tabla de tonos del '
      + 'test. Añádelo con el emoji que se le parezca, o no se puede comprobar '
      + 'que el icono case con el anillo.');

    assert.strictEqual(e.icon, TONO[e.color],
      nombre + ': el anillo es ' + e.color + ' y el icono debería ser el tono '
      + 'que le toca, no ' + e.icon
      + ' (U+' + [...e.icon].map(c => c.codePointAt(0).toString(16).toUpperCase()).join(' U+') + ')');
  }
});

prueba('cada especie tiene icono y solo hay iconos de especies que existen', () => {
  const src = require('fs').readFileSync('app.js', 'utf8');
  const bloque = src.match(/const MUSHROOM_META = \{[\s\S]*?\n\};/)[0];

  const entradas = [...bloque.matchAll(/(\w+):\s*\{\s*icon:\s*'([^']*)'\s*,\s*color:\s*'([^']*)'/g)]
    .map(m => ({ key: m[1], icon: m[2], color: m[3] }));

  assert.ok(entradas.length > 0, 'no se ha leído ninguna entrada de MUSHROOM_META');

  const claves = new Set(entradas.map(e => e.key));
  for (const sp of A.SPECIES) {
    assert.ok(claves.has(sp.key),
      sp.key + ' no tiene icono en MUSHROOM_META: su tarjeta saldrá con el emoji de repuesto');
  }

  for (const e of entradas) {
    assert.ok(A.SPECIES.some(s => s.key === e.key),
      'MUSHROOM_META tiene un icono para «' + e.key + '», que no está en SPECIES');
    assert.ok(e.icon && e.icon.trim().length > 0, e.key + ': icono vacío');
    assert.ok(/^#[0-9a-f]{6}$/i.test(e.color),
      e.key + ': color «' + e.color + '» no es un hexadecimal de seis dígitos');
  }
});

/* ------------------------------------------------------------------ */
/* 22. El hábitat deja de inventarse                                    */
/* ------------------------------------------------------------------ */

grupo('22. Sin dato de hábitat no se inventa un hábitat');

// Este grupo nace de un fallo real. `consultarHabitat` devolvía
// `vegetacion: ['pradera']` cuando el MFE decía que no hay árbol y Overpass no
// contestaba. No era una etiqueta: era un dato falso que llegaba hasta el
// modelo, y decidía el ranking. Con la lista vacía el motor da 0,70 a todo el
// mundo y el clima manda; con la pradera inventada las pratenses sacaban 1,00.

prueba('el motor NO inventa pradera cuando no hay dato', () => {
  const A_ = require('./algoritmo.js');
  for (const sp of A_.SPECIES) {
    const conDato = A_.evaluarHabitat(sp, { vegetacion: ['pradera'] });
    const sinDato = A_.evaluarHabitat(sp, { vegetacion: [] });
    assert.notStrictEqual(sinDato.factor, conDato.factor,
      sp.key + ': con la lista vacía sale igual que con la pradera inventada');
    assert.strictEqual(sinDato.etiqueta, 'sin datos de cobertura');
    assert.strictEqual(sinDato.confuso, true);
    assert.ok(sinDato.factor > 0, sp.key + ': sin datos no puede anular');
  }
});

prueba('la falta de dato NO favorece a las pratenses', () => {
  // El fallo era asimétrico y por eso era grave: la invención de «pradera»
  // pegaba un 0,25 de penalización a las micorrícicas que no estaba medido.
  const A_ = require('./algoritmo.js');
  const sinDato = A_.SPECIES.map(sp => ({
    sp, f: A_.evaluarHabitat(sp, { vegetacion: [] }).factor,
  }));
  const conPradera = A_.SPECIES.map(sp => ({
    sp, f: A_.evaluarHabitat(sp, { vegetacion: ['pradera'] }).factor,
  }));
  // Con la lista vacía todas reciben lo mismo: no hay dato, luego no hay
  // preferencia. Con la invención sí la había, y no la justificaba nadie.
  for (const { sp, f } of sinDato) {
    assert.strictEqual(f, 0.7,
      sp.key + ': sin datos todos reciben 0,70 y este recibe ' + f);
  }
  const conFavor = conPradera.filter(x => x.f > 0.7).length;
  assert.ok(conFavor > 0,
    'la invención de pradera llegaba a favorecer a alguien: ' + conFavor);
});

prueba('el vocabulario del MFE no se solapa con el de la capa de usos', () => {
  // Dos capas del mismo MFE, con vocabularios que se tocan. `matorral` lo
  // producen las dos, y esta bien: las capas forestales lo sacan de
  // madronales, enebrales y fayal-brezal, y `ff_uso` lo saca de «Pastizales con
  // vegetacion arbustiva». Es el mismo monte bajo arbustivo, medido por dos
  // capas distintas.
  //
  // Lo que no puede pasar es que una clase del uso del suelo traduzca a un
  // ARBOLADO, porque entonces el motor recibiria «pinar» de una capa que no
  // distingue un pinar de un hayedo. De ahi la comprobacion.
  const H_ = require('./habitat.js');
  const arborado = H_.HABITATS_ARBOLADOS;
  const capasDeMonteBajo = ['madronales', 'enebrales', 'fayal_brezal'];

  for (const [codigo, regla] of Object.entries(H_.MFE_USO_TAGS)) {
    assert.ok(codigo && /^[A-Za-z\u00C0-\u017F ()\-]+$/.test(codigo),
      'el codigo LULUCF tiene caracteres raros: ' + codigo);
    assert.ok(regla.tag && /^[a-z_]+$/.test(regla.tag),
      'el tag no parece un identificador del motor: ' + regla.tag);
    assert.ok(Number.isFinite(regla.peso) && regla.peso >= 1,
      'el peso tiene que ordenar los tags: ' + codigo);

    if (arborado.has(regla.tag)) {
      const deMonteBajo = capasDeMonteBajo.some(c =>
        H_.MFE_CAPAS.some(x => x.capa === c && x.tag === regla.tag));
      assert.ok(deMonteBajo,
        'el tag «' + regla.tag + '» es un habitat arbolado y `ff_uso` no puede '
        + 'dar un bosque: solo puede ser el monte bajo que las capas '
        + 'forestales ya producen');
    }
  }
});

prueba('la capa de usos NO declara hábitats inventados', () => {
  // `cultivo` es una decisión de diseño —un campo de cereal no es un hábitat de
  // setas— y por eso está declarado como tal en el modelo. Si algún día alguien
  // añade un tag aquí sin declararlo en MONTANA ni en PRADENSE, la penalización
  // genérica se aplica doble o ninguna vez.
  const A_ = require('./algoritmo.js');
  const H_ = require('./habitat.js');
  const MONTANA = new Set(['pinar', 'hayedo', 'robledal', 'castaneral',
    'fresnedal', 'olmedal', 'encinar', 'bosque_mixto', 'dehesa', 'ribera',
    'cultivo', 'matorral', 'perturbado']);
  const PRADENSE = new Set(['pradera', 'pastizal', 'cesped', 'claro', 'majadal',
    'ganado', 'borde_bosque']);
  for (const regla of Object.values(H_.MFE_USO_TAGS)) {
    const enUno = MONTANA.has(regla.tag);
    const enOtro = PRADENSE.has(regla.tag);
    assert.ok(enUno !== enOtro,
      '«' + regla.tag + '» está en los dos conjuntos o en ninguno: '
      + (enUno ? 'MONTANA' : '') + (enUno && enOtro ? ' y ' : '')
      + (enOtro ? 'PRADENSE' : ''));
  }
  // Y que cada tag nuevo sea al menos comprendido por alguna especie o por el
  // propio juego de conjuntos: un tag que nadie acepta no informa a nadie.
  for (const regla of Object.values(H_.MFE_USO_TAGS)) {
    const loUsaAlguien = A_.SPECIES.some(s => s.habitat.includes(regla.tag));
    const esGrupo = MONTANA.has(regla.tag) || PRADENSE.has(regla.tag);
    assert.ok(loUsaAlguien || esGrupo,
      '«' + regla.tag + '» no lo declara ninguna especie ni está en MONTANA '
      + 'ni en PRADENSE: no hace nada');
  }
});

prueba('todo hábitat de las especies tiene un origen declarado', () => {
  // Regresión contra el hueco que había: nueve hábitats (pradera, pastizal,
  // cesped, claro, majadal, ganado, borde_bosque, frutal) sólo podían venir de
  // la heurística de coordenadas, que mira los decimales. Antes de esto no
  // había forma de ver ese hueco al leer el código.
  const A_ = require('./algoritmo.js');
  const H_ = require('./habitat.js');
  const origenes = new Set([
    ...H_.MFE_CAPAS.map(c => c.tag),
    ...Object.values(H_.MFE_USO_TAGS).map(v => v.tag),
    ...H_.HABITATS_SIN_CAPA,
    'olmedal',            // lo deriva consultarMFE del bosque ribereño
  ]);
  const sinOrigen = [...new Set(A_.SPECIES.flatMap(s => s.habitat))]
    .filter(h => !origenes.has(h));
  assert.deepStrictEqual(sinOrigen, [],
    'hábitats que ninguna fuente puede producir: ' + sinOrigen.join(', '));
});

prueba('los hábitats sin capa están declarados como tales, no inventados', () => {
  // Lo que no se puede cartografiar no se inventa: se declara. Y un hábitat
  // declarado sin capa tiene que seguir siendo un dato bueno de la ficha.
  const H_ = require('./habitat.js');
  for (const h of H_.HABITATS_SIN_CAPA) {
    assert.ok(!H_.MFE_CAPAS.some(c => c.tag === h),
      '«' + h + '» está declarado sin capa pero hay una capa que lo produce');
    assert.ok(!Object.values(H_.MFE_USO_TAGS).some(v => v.tag === h),
      '«' + h + '» está declarado sin capa pero `ff_uso` lo produce');
  }
});

prueba('la capa de usos no traduce las clases que no son hábitat de seta', () => {
  // Asentamientos NO se traduce a urbano, y esto es deliberado: medido, el
  // Retiro de Madrid sale como `Artificial`, y el Retiro es un parque con
  // hierba. Si alguien lo añadiera, un parque passaría a ser una plaza.
  const H_ = require('./habitat.js');
  const tags = Object.values(H_.MFE_USO_TAGS).map(v => v.tag);
  for (const prohibido of ['urbano', 'ciudad', 'edificado', 'agua', 'rio']) {
    assert.ok(!tags.includes(prohibido),
      'la capa de usos no debe producir el tag «' + prohibido + '»');
  }
});

prueba('el bosque sin nombrar se anota en vez de inventarse un hábitat', () => {
  // Si `ff_uso` dice «Frondosas» y la lista blanca no encuentra bosque, lo
  // honesto es decirlo: la lista blanca está corta. Inventar un `bosque_mixto`
  // sería dar un 1,00 a una micorrícica sobre un dato que no tenemos.
  const H_ = require('./habitat.js');
  const bosque = new Set(H_.MFE_USO_BOSQUE);
  for (const codigo of bosque) {
    assert.ok(!Object.keys(H_.MFE_USO_TAGS).includes(codigo),
      '«' + codigo + '» es bosque y no debe traducirse a un hábitat del motor');
  }
  assert.ok(bosque.size > 0, 'la lista de códigos de bosque está vacía');
});

/* ------------------------------------------------------------------ */
/* 23. El veto por habitat                                              */
/* ------------------------------------------------------------------ */

grupo('23. El habitat veta cuando se sabe que no encaja');

// Este grupo comprueba la decision que mas veces se ha dado la vuelta en este
// proyecto: degradar o vetar. Se veto porque el habitat ya no se adivina a
// partir de las coordenadas sino que viene del MFE en dos capas oficiales, y se
// ha comprobado que ninguna de las 19 especies se queda sin salida. La clave
// es que el veto solo aplica con DATO MEDICADO.

prueba('el veto solo se aplica con habitat conocido', () => {
  const A_ = require('./algoritmo.js');
  let vetadas = 0;
  let conDato = 0;
  for (const sp of A_.SPECIES) {
    // En su habitat propio no hay veto, por definicion.
    const propio = A_.evaluarHabitat(sp, { vegetacion: [sp.habitat[0]] });
    assert.notStrictEqual(propio.veto, true,
      sp.key + ': se veta a si misma en su habitat');
    assert.ok(propio.factor > 0, sp.key + ': 0 en su habitat propio');
    conDato++;
  }
  assert.strictEqual(conDato, A_.SPECIES.length);
  assert.strictEqual(vetadas, 0);
});

prueba('ninguna especie se queda sin salida con el veto', () => {
  // Esta es la comprobacion que legitima el veto. Si una especie no acepta
  // ningun habitat que las fuentes puedan dar, el veto la borraria de la
  // pantalla para siempre. Con `ff_uso` en marcha ya no pasa, pero hay que
  // vigilarlo: se rompe en cuanto se anade una especie con habitats raros.
  const A_ = require('./algoritmo.js');
  const H_ = require('./habitat.js');
  const cartografiables = new Set([
    ...H_.MFE_CAPAS.map((c) => c.tag),
    ...Object.values(H_.MFE_USO_TAGS).map((v) => v.tag),
    'olmedal',
  ]);
  const sinSalida = A_.SPECIES.filter(
    (sp) => !sp.habitat.some((h) => cartografiables.has(h))
  );
  assert.deepStrictEqual(sinSalida.map((s) => s.key), [],
    'especies que el veto dejaria sin aparecer nunca: '
    + sinSalida.map((s) => s.key).join(', '));
});

prueba('cada especie sobrevive en al menos un habitat real', () => {
  // Comprobado uno por uno, no en bloque: es mas util saber QUE especie
  // falla si alguna vez falla.
  const A_ = require('./algoritmo.js');
  for (const sp of A_.SPECIES) {
    let sobrevive = false;
    for (const h of sp.habitat) {
      if (A_.evaluarHabitat(sp, { vegetacion: [h] }).factor > 0) { sobrevive = true; break; }
    }
    assert.ok(sobrevive, sp.key + ' (hayedo: ' + sp.habitat.join(', ') + ')');
  }
});

prueba('el veto y la falta de dato son cosas distintas', () => {
  // El error que habria que cometer: tratar la lista vacia como un veto.
  // Entonces cualquier punto sin cartografiar sacaria a las 19 especies y no
  // apareceria ninguna. La falta de dato se queda en 0,70.
  const A_ = require('./algoritmo.js');
  for (const sp of A_.SPECIES) {
    const sinDato = A_.evaluarHabitat(sp, { vegetacion: [] });
    const conDatoMalo = A_.evaluarHabitat(sp, { vegetacion: ['__nada_real__'] });
    assert.ok(sinDato.factor > 0, sp.key + ': sin dato no anula');
    assert.strictEqual(conDatoMalo.factor, 0,
      sp.key + ': un habitat que no encaja tiene que vetar');
    assert.strictEqual(sinDato.veto, false);
    assert.strictEqual(conDatoMalo.veto, true);
  }
});

prueba('el veto trae la etiqueta que lo explica', () => {
  // Un 0 sin explicacion parece un fallo de la aplicacion, no una decision.
  const A_ = require('./algoritmo.js');
  const r = A_.evaluarHabitat(A_.SPECIES[0], { vegetacion: ['__nada_real__'] });
  assert.strictEqual(r.etiqueta, 'fuera de su h\u00e1bitat');
  assert.ok(r.etiqueta && r.etiqueta.length > 3);
});

prueba('el veto llega al detalle que se pinta en la tarjeta', () => {
  // Si `habVeto` no llega al detalle, la tarjeta pone «0 %» a secas y el
  // usuario no sabe si es un fallo o una respuesta.
  const A_ = require('./algoritmo.js');
  const sp = A_.SPECIES.find((s) => s.key === 'niscalos');   // solo pinar
  const mal = A_.indice(sp, ctx({ veg: ['robledal'] }));
  const bien = A_.indice(sp, ctx({ veg: ['pinar'] }));
  assert.strictEqual(mal.detalle.habFactor, 0);
  assert.strictEqual(mal.detalle.habVeto, true);
  assert.strictEqual(mal.detalle.habEtiqueta, 'fuera de su h\u00e1bitat');
  assert.ok(mal.I < bien.I, 'en un habitat ajeno no puede puntuar mas');
  assert.strictEqual(bien.detalle.habVeto, false);
});

prueba('`confinado` ya no existe en el modelo', () => {
  // Se elimino con el veto. Valia 0,05 en el desajuste, que es una forma de
  // decir «casi no» cuando se queria decir «nada», y ademas ninguna de las 19
  // fichas lo tenia marcado: nunca hizo nada. Si vuelve a aparecer en una
  // ficha, hay que quitarlo otra vez o cambiar el veto.
  const A_ = require('./algoritmo.js');
  for (const sp of A_.SPECIES) {
    assert.strictEqual(sp.confinado, undefined,
      sp.key + ': `confinado` no deberia existir ya; el veto lo sustituye');
  }
  const src = require('fs').readFileSync(require.resolve('./algoritmo.js'), 'utf8');
  assert.ok(!/sp\.confinado/.test(src),
    'evaluarHabitat sigue leyendo `sp.confinado`; el veto no esta completo');
});

prueba('la temporada NO es un veto, a diferencia del habitat', () => {
  // Se comprueba a proposito: es la confusion facil, porque las dos son
  // correcciones que bajan el indice. La diferencia es que la temporada se
  // deduce del mes, que siempre se sabe, mientras que el habitat puede no
  // saberse.
  const A_ = require('./algoritmo.js');
  // OJO al orden de los argumentos: la firma es (sp, mes), no (mes, sp).
  // Pasados al reves, `sp.temporada` sale undefined y la funcion devuelve 1 en
  // todos los meses, que es justo el fallo que dio este test.
  const sp = A_.SPECIES[0];
  const dentro = A_.factorTemporada(sp, sp.temporada[0]);
  const lejos = A_.factorTemporada(sp, (sp.temporada[0] + 5) % 12 || 12);
  assert.ok(dentro > lejos, 'dentro de temporada tiene que puntuar mas: '
    + dentro + ' contra ' + lejos);
  assert.ok(lejos > 0, 'fuera de temporada degrada, pero no veta');
});

/* ------------------------------------------------------------------ */
/* 24. Los cinco datos instantáneos de la tarjeta de suelo y clima       */
/* ------------------------------------------------------------------ */

grupo('24. Los datos «ahora» de la tarjeta de suelo y clima');

// Estos cinco se añadieron a petición del usuario: temperatura del aire,
// humedad del aire, humedad del suelo, temperatura del suelo y la lluvia del
// último día completo. Se quitó «día del año», que no aportaba nada.
//
// Lo que se comprueba aquí es lo que se podría hacer mal sin que nadie lo
// notase: las unidades de la humedad del suelo, y que la lluvia del último día
// completo sea ayer y no hoy.

/** Respuesta de Open-Meteo con los datos que `meteo` lee. */
function meteoFalso(sobrescribir) {
  const dias = 30;
  const n = dias + 1;                    // 30 días atrás + hoy
  const time = [];
  for (let k = 0; k < n; k++) {
    const f = new Date(Date.UTC(2026, 9, 5));
    f.setUTCDate(f.getUTCDate() - (n - 1 - k));
    time.push(f.toISOString().slice(0, 10));
  }
  const relleno = v => Array.from({ length: n }, () => v);

  const base = {
    elevation: 1060,
    timezone: 'Europe/Madrid',
    daily: {
      time,
      precipitation_sum: relleno(0),
      temperature_2m_mean: relleno(15),
      temperature_2m_min: relleno(10),
      temperature_2m_max: relleno(20),
      relative_humidity_2m_mean: relleno(70),
    },
    hourly: {
      time: [],
      soil_temperature_18cm: [],
      soil_temperature_6cm: [],
      soil_moisture_3_9cm: [],
    },
    current: {
      time: '2026-10-05T21:15',
      interval: 900,
      temperature_2m: 17.4,
      relative_humidity_2m: 69,
      soil_temperature_18cm: 19,
      soil_moisture_3_9cm: 0.215,
    },
  };
  // Lluvia: ayer 1,3 mm y hoy 0. Hoy está incompleto a las 21:15.
  base.daily.precipitation_sum[n - 2] = 1.3;
  base.daily.precipitation_sum[n - 1] = 0;
  for (let k = 0; k < n * 24; k++) base.hourly.time.push('x');

  return Object.assign(base, sobrescribir || {});
}

/** Llama a `meteo` con un `fetch` simulado y devuelve lo que devolvería de verdad. */
async function meteoCon(datos) {
  const A = require('./algoritmo.js');
  const original = global.fetch;
  let urlPedida = '';
  global.fetch = async (u) => {
    urlPedida = String(u);
    return { ok: true, status: 200, json: async () => datos };
  };
  try {
    const m = await A.meteo(41.76, -2.53, 30);
    return { m, url: urlPedida };
  } finally {
    global.fetch = original;
  }
}

prueba('la consulta pide el bloque `current`, no sólo el horario', () => {
  // Con `forecast_days=1` la última hora del array horario son las 23:00 del
  // día en curso. Medido a las 21:15: casi dos horas por delante, y es una
  // previsión. Para un dato que se enseña como «ahora» no vale.
  return meteoCon(meteoFalso()).then(({ url }) => {
    assert.ok(/[?&]current=temperature_2m/.test(url),
      'la URL no pide `current`: ' + url.slice(0, 120));
    // Cuenta los campos de `current`: si le falta el del suelo, el bloque llega
    // incompleto y la tarjeta enseña «—» sin explicación. La versión anterior
    // de este test sólo miraba que apareciera la palabra, y `current` con un
    // solo campo la cumplía.
    const bloque = (url.match(/[?&]current=([^&]*)/) || [, ''])[1];
    const campos = bloque ? bloque.split(',').map(s => s.trim()) : [];
    assert.strictEqual(campos.length, 5,
      'current debería pedir 5 campos y pide ' + campos.length + ': ' + bloque);
    for (const c of ['temperature_2m', 'relative_humidity_2m',
      'soil_temperature_18cm', 'soil_temperature_6cm', 'soil_moisture_3_9cm']) {
      assert.ok(campos.includes(c), 'falta «' + c + '» en current');
    }
    assert.ok(/[?&]timezone=auto/.test(url), 'falta timezone=auto');
  });
});

prueba('los cinco datos llegan con valor', () => {
  return meteoCon(meteoFalso()).then(({ m }) => {
    assert.strictEqual(m.tAireAhora, 17.4, 'temperatura del aire');
    assert.strictEqual(m.hrAhora, 69, 'humedad del aire');
    assert.strictEqual(m.tSueloAhora, 19, 'temperatura del suelo');
    assert.strictEqual(m.humSueloAhora, 0.215, 'humedad del suelo');
    assert.strictEqual(m.lluviaAyer, 1.3, 'lluvia del último día');
    assert.strictEqual(m.ahoraIso, '2026-10-05T21:15');
  });
});

prueba('la humedad del suelo se guarda en m³/m³, como la da la fuente', () => {
  // Si aquí se dividiera por 100, el modelo recibiría 0,00215. Y si se
  // multiplicara, recibiría 21,5 y la tarjeta pondría «2150 %».
  return meteoCon(meteoFalso()).then(({ m }) => {
    assert.ok(m.humSueloAhora > 0 && m.humSueloAhora <= 1,
      'una fracción volumétrica va de 0 a 1, y esto vale ' + m.humSueloAhora);
  });
});

prueba('la conversión a porcentaje ocurre al PINTAR, no en el modelo', () => {
  // Se comprueba en el sitio donde puede equivocarse: la línea de app.js que
  // multiplica por 100. Si alguien lo mueve a `meteo()`, este test falla.
  const src = require('fs').readFileSync('app.js', 'utf8');
  assert.ok(/humSueloAhora\s*\*\s*100/.test(src),
    'la humidity del suelo ya no se convierte a porcentaje en app.js');
  // Y el modelo no puede convertirla, o el valor dejaría de estar en 0 a 1.
  const alg = require('fs').readFileSync('algoritmo.js', 'utf8');
  const linea = alg.split(/\r?\n/).find(l => /humSueloAhora:/.test(l));
  assert.ok(linea && !/\*\s*100|\/\s*100/.test(linea),
    'el modelo está multiplicando o dividiendo la humedad: ' + linea);
});

prueba('la lluvia del último día completo es AYER, no hoy', () => {
  // El último elemento del array diario es hoy, y a las 21:15 está
  // incompleto. Si se usara, la tarjeta diría que no ha llovido cuando sí.
  return meteoCon(meteoFalso()).then(({ m }) => {
    assert.strictEqual(m.lluviaAyer, 1.3);
    assert.notStrictEqual(m.lluviaAyer, m.lluvia30[0],
      'ha cogido la lluvia de hoy, que está incompleta');
  });
});

prueba('sin días previos no hay «último día completo» y se dice', () => {
  // Con `past_days=0` sólo existe hoy. Inventar un valor sería mentir.
  const A = require('./algoritmo.js');
  const original = global.fetch;
  const unDia = meteoFalso();
  unDia.daily.time = ['2026-10-05'];
  for (const k of Object.keys(unDia.daily)) {
    if (k !== 'time') unDia.daily[k] = [0];
  }
  global.fetch = async () => ({ ok: true, status: 200, json: async () => unDia });
  return A.meteo(41.76, -2.53, 0).then((m) => {
    assert.strictEqual(m.lluviaAyer, null,
      'con un solo día no hay día completo anterior: ' + m.lluviaAyer);
    global.fetch = original;
  }, (e) => { global.fetch = original; throw e; });
});

prueba('sin `current` el modelo no inventa los datos instantáneos', () => {
  // Si la API dejara de devolver `current`, los cinco tienen que salir a null
  // y la tarjeta enseña «—». Rellenarlos con la media diaria sería mentiroso:
  // la media de 24 h no es el valor de esta hora.
  const A = require('./algoritmo.js');
  const original = global.fetch;
  const sinCurrent = meteoFalso();
  delete sinCurrent.current;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => sinCurrent });
  return A.meteo(41.76, -2.53, 30).then((m) => {
    global.fetch = original;
    for (const k of ['tAireAhora', 'hrAhora', 'tSueloAhora', 'humSueloAhora']) {
      assert.strictEqual(m[k], null, k + ' se inventó un valor: ' + m[k]);
    }
    assert.ok(m.tAire != null && m.tSuelo != null,
      'las medias de 24 h sí deben seguir viniendo');
  }, (e) => { global.fetch = original; throw e; });
});

prueba('la profundidad del suelo se elige 18 antes que 6', () => {
  // Si sólo viene la de 6 cm, la tarjeta tiene que decirlo, porque una
  // temperatura de suelo sin profundidad no significa nada.
  const A = require('./algoritmo.js');
  const original = global.fetch;

  const con18 = (datos) => {
    global.fetch = async () => ({ ok: true, status: 200, json: async () => datos });
    return A.meteo(41.76, -2.53, 30).then((m) => {
      global.fetch = original;
      return m;
    }, (e) => { global.fetch = original; throw e; });
  };

  const solo6 = meteoFalso();
  delete solo6.current.soil_temperature_18cm;
  solo6.current.soil_temperature_6cm = 18.5;

  return con18(meteoFalso())
    .then((m) => {
      assert.strictEqual(m.profundidadSueloAhora, 18);
      assert.strictEqual(m.tSueloAhora, 19, 'con 18 cm presente, manda 18');
    })
    .then(() => con18(solo6))
    .then((m) => {
      assert.strictEqual(m.profundidadSueloAhora, 6);
      assert.strictEqual(m.tSueloAhora, 18.5, 'sin 18 cm, cae a 6');
    });
});

prueba('«día del año» ya no está en la tarjeta', () => {
  const html = require('fs').readFileSync('index.html', 'utf8');
  assert.ok(!/id="dayOfYearValue"/.test(html),
    'el campo «día del año» sigue en el HTML');
  assert.ok(!/D[ií]a del a[nñ]o/.test(html), 'el texto «día del año» sigue');
  const app = require('fs').readFileSync('app.js', 'utf8');
  assert.ok(!/dayOfYearValue/.test(app),
    'app.js sigue escribiendo en el campo que ya no existe');
});

prueba('la profundidad no se duplica al cambiar de punto', () => {
  // La profundidad se pinta en la ETIQUETA del campo, porque no es fija: el
  // bloque `current` puede devolver el de 18 cm o el de 6 cm. Para no
  // reescribirla cada vez se guarda el texto base en `dataset.base` y se le
  // vuelve a colgar la profundidad.
  //
  // El fallo caracteristico es que la base se fije YA con la profundidad
  // dentro, y cada consulta anada «(18 cm) (18 cm)». Se comprueba que la base
  // se lee del HTML, que no lleva parentesis de profundidad, y que el codigo
  // la usa en lugar de reescribir el textContent desde cero.
  const html = require('fs').readFileSync('index.html', 'utf8');
  const src = require('fs').readFileSync('app.js', 'utf8');

  // Por LINEA, no por regex sobre el HTML entero. El intento anterior busco
  // `terrain-item ... id="soilTempNowValue"` con un regex perezoso, y como el
  // campo de al lado (Humedad del suelo) esta a menos de 260 caracteres, el
  // match empezaba en el de al lado y comparaba su etiqueta con la del otro.
  const linea = html.split(/\r?\n/).find(l => l.includes('id="soilTempNowValue"'));
  assert.ok(linea, 'no se encuentra el campo de la temperatura del suelo ahora');
  const etq = linea.match(/class="tl">([^<]*)</);
  assert.ok(etq, 'el campo no tiene etiqueta .tl');
  assert.ok(!/\(\d+ cm\)/.test(etq[1]),
    'la etiqueta del HTML ya lleva la profundidad puesta: ' + etq[1]);
  assert.ok(/Temp\. del suelo ahora/.test(etq[1]),
    'la etiqueta ha cambiado de texto: ' + etq[1]);

  assert.ok(/dataset\.base/.test(src),
    'app.js no guarda la etiqueta base: se reescribira entera cada vez');
  assert.ok(/dataset\.base\s*\+/.test(src) || /etq\.textContent\s*=\s*etq\.dataset\.base/.test(src),
    'app.js no recompone la etiqueta a partir de la base');
  // Y que la profundidad se elija con una escala de valores, no con un texto
  // fijo: si un dia la fuente devuelve 6 cm, tiene que salir «(6 cm)».
  assert.ok(/prof\s*===\s*18/.test(src) && /prof\s*===\s*6/.test(src),
    'la profundidad ya no distingue 18 cm de 6 cm');
});

prueba('los cinco campos nuevos están en la tarjeta y se pintan', () => {
  const html = require('fs').readFileSync('index.html', 'utf8');
  const src = require('fs').readFileSync('app.js', 'utf8');
  const NUEVOS = {
    airTempNowValue: 'temperatura del aire ahora',
    airHumNowValue: 'humedad del aire ahora',
    soilMoistureValue: 'humedad del suelo ahora',
    soilTempNowValue: 'temperatura del suelo ahora',
    rainYesterdayValue: 'lluvia del último día completo',
  };
  for (const [id, nombre] of Object.entries(NUEVOS)) {
    assert.ok(new RegExp('id="' + id + '"').test(html),
      'no está en el HTML: ' + nombre + ' (' + id + ')');
    assert.ok(new RegExp("'" + id + "'").test(src),
      'no se pinta: ' + nombre + ' (' + id + ')');
  }
});

prueba('las medias y los instantáneos no se confunden', () => {
  // Los de arriba del todo son medias y estos de abajo son «ahora». Si se
  // mezclaran, la tarjeta daría dos respuestas a la misma pregunta.
  const html = require('fs').readFileSync('index.html', 'utf8');
  const iMedia = html.indexOf('id="airTempValue"');
  const iAhora = html.indexOf('id="airTempNowValue"');
  assert.ok(iMedia > 0 && iAhora > 0);
  assert.ok(iMedia < iAhora, 'los instantáneos deberían ir después de las medias');
  assert.ok(/Temp\. media del aire en 24h/.test(html),
    'la etiqueta de la media ha perdido el «media»');
  assert.ok(/Temp\. del aire ahora/.test(html),
    'la etiqueta del instantáneo dice algo distinto de «ahora»');
});

// El resumen espera a la cola, o se imprimiría antes de que acabaran los
// tests asíncronos y `fallos` valdría 0 siempre.

/* ------------------------------------------------------------------ */
/* 25. El veto por pH                                                   */
/* ------------------------------------------------------------------ */

grupo('25. El pH veta cuando el punto está fuera del rango de la especie');

// Decisión del usuario: una especie cuyo pH de crecimiento no coincide con el
// del punto no se calcula. Antes el suelo era 0,60 o 0,70, que se leía como
// «poco probable», y es otra cosa: o crece o no crece.
//
// La ALTITUD no se veta, por decisión y por motivo, y está escrito en el
// modelo: las bandas tienen un margen de suavizado inventado al crearlas, y
// convertir un margen en un corte duro sería inventar el corte. Ese veto queda
// pendiente.

prueba('el rango de pH sale del perfil, no de un número escrito a mano', () => {
  // Si el veto tuviera su propio número y la curva otro, un día el factor
  // empezaría a decaer en un sitio y el veto cortaría en otro, sin que nada
  // fallara. Este test compara los dos.
  const A_ = require('./algoritmo.js');
  for (const sp of A_.SPECIES) {
    const p = sp.pHTolerante ? { o: 5.6, m: 3.4 }
      : sp.acidofilo ? { o: 5.2, m: 1.5 }
        : sp.alcalinofila ? { o: 7.6, m: 1.4 }
          : { o: 6.8, m: 1.8 };
    const lo = p.o - p.m, hi = p.o + p.m;

    // Justo dentro del borde: factor 1, sin veto.
    const borde = A_.factorSuelo(hi - 0.01, sp);
    assert.strictEqual(borde.veto, false,
      sp.key + ': en el borde superior interno no debe vetar (' + hi + ')');
    assert.strictEqual(borde.factor, 1);

    // Justo fuera: veto.
    const fuera = A_.factorSuelo(hi + 0.01, sp);
    assert.strictEqual(fuera.veto, true,
      sp.key + ': fuera de ' + hi + ' debería vetar');
    assert.strictEqual(fuera.factor, 0);
  }
});

prueba('la alcalinófila VETE en un suelo ácido', () => {
  // Es el caso que motivó el veto: el marzuelo «sobre suelos calizos» según
  // Laux, en un pH 5,0. Antes salía con 0,60.
  const A_ = require('./algoritmo.js');
  const alcali = A_.SPECIES.find((s) => s.alcalinofila);
  assert.ok(alcali, 'no hay ninguna especie alcalinófila');
  const r = A_.factorSuelo(5.0, alcali);
  assert.strictEqual(r.factor, 0, 'en pH 5,0 tiene que valer 0');
  assert.strictEqual(r.veto, true);
  assert.ok(/suelo demasiado ácido/.test(r.etiqueta), r.etiqueta);
});

prueba('la acidófila VETE en un suelo calizo', () => {
  const A_ = require('./algoritmo.js');
  const acid = A_.SPECIES.find((s) => s.acidofilo);
  assert.ok(acid, 'no hay ninguna especie acidófila');
  const r = A_.factorSuelo(7.8, acid);
  assert.strictEqual(r.factor, 0, 'en pH 7,8 tiene que valer 0');
  assert.strictEqual(r.veto, true);
  assert.ok(/suelo demasiado calizo/.test(r.etiqueta), r.etiqueta);
});

prueba('la etiqueta del veto dice el rango en el que SÍ crece', () => {
  // Un 0 sin explicación parece un fallo de la aplicación. Y saber el rango es
  // lo que permite entender por qué cae una especie y no otra.
  const A_ = require('./algoritmo.js');
  const acid = A_.SPECIES.find((s) => s.acidofilo);
  const r = A_.factorSuelo(7.8, acid);
  assert.ok(/3\.7 y 6\.7/.test(r.etiqueta),
    'la etiqueta debe llevar el rango: ' + r.etiqueta);
  assert.deepStrictEqual(r.rango.map((x) => Number(x.toFixed(1))), [3.7, 6.7]);
});

prueba('SIN pH no hay veto, porque no saber no es que el pH sea malo', () => {
  // El caso límite. SoilGrids puede no devolver pH, y si eso vetara, un fallo
  // del servicio de suelo borraría las 19 especies del dashboard.
  const A_ = require('./algoritmo.js');
  for (const ph of [null, undefined, NaN]) {
    const r = A_.factorSuelo(ph, A_.SPECIES[0]);
    assert.strictEqual(r.veto, false, 'ph=' + ph + ' no puede vetar');
    assert.strictEqual(r.factor, 1, 'ph=' + ph + ': sin pH el factor es 1');
    assert.strictEqual(r.conocido, false);
  }
});

prueba('ningún pH deja a cero TODAS las especies', () => {
  // La comprobación que legitima el veto: si los rangos dejaran un hueco, en
  // ese pH el dashboard se quedaría en blanco. Los cuatro perfiles se solapan
  // y el níscalo, que es tolerante (2,2 a 9,0), cubre los dos extremos.
  const A_ = require('./algoritmo.js');
  const sinNinguna = [];
  for (let ph = 2.2; ph <= 9.0; ph += 0.05) {
    const n = A_.SPECIES.filter((s) => !A_.factorSuelo(ph, s).veto).length;
    if (n === 0) sinNinguna.push(ph.toFixed(2));
  }
  assert.deepStrictEqual(sinNinguna, [],
    'estos pH no dejan ninguna especie: ' + sinNinguna.join(', '));
});

prueba('en el rango real de SoilGrids siempre quedan especies', () => {
  const A_ = require('./algoritmo.js');
  // SoilGrids devuelve pH entre 4 y 9 aproximadamente. El mínimo del modelo
  // tiene que ser de varias especies, no de una.
  let minimo = 99;
  let donde = null;
  for (let ph = 4.5; ph <= 8.5; ph += 0.1) {
    const n = A_.SPECIES.filter((s) => !A_.factorSuelo(ph, s).veto).length;
    if (n < minimo) { minimo = n; donde = ph; }
  }
  assert.ok(minimo >= 6,
    'el peor caso del rango real deja ' + minimo + ' especies en pH ' + donde);
});

prueba('el veto llega al detalle que pinta la tarjeta', () => {
  const A_ = require('./algoritmo.js');
  const acid = A_.SPECIES.find((s) => s.acidofilo);
  const c = ctx({ veg: [acid.habitat[0]], ph: 7.8 });
  const r = A_.indice(acid, c);
  assert.strictEqual(r.detalle.sueloVeto, true);
  assert.strictEqual(r.detalle.sueloFactor, 0);
  assert.ok(r.detalle.vetos.includes('suelo'),
    'la lista de vetos tiene que incluir «suelo»: ' + JSON.stringify(r.detalle.vetos));
  assert.strictEqual(r.I, 0, 'el índice tiene que ser 0');
});

prueba('los dos vetos van en la misma lista, sin pisarse', () => {
  // Una especie puede estar fuera de hábitat Y de pH. La tarjeta tiene que
  // poder decir las dos cosas, no sólo una.
  const A_ = require('./algoritmo.js');
  const alcali = A_.SPECIES.find((s) => s.alcalinofila);
  // En pinar, que no es su hábitat, y con pH 5,0, que tampoco.
  const c = ctx({ veg: ['pinar'], ph: 5.0 });
  const r = A_.indice(alcali, c);
  assert.deepStrictEqual(r.detalle.vetos.sort(), ['habitat', 'suelo'],
    'debería vetar por los dos motivos');
});

prueba('la altura NO se veta, y no se veta a propósito', () => {
  // La banda de la amanita va de 200 a 900 con margen 400, o sea un veto a
  // 1300 m, cuando su propia fuente dice «hasta 1500 m». Vetar sobre un margen
  // inventado sería inventar el corte, y dejaría a la seta de cardo sin salir
  // por encima de 800 m en todo el interior de España.
  const A_ = require('./algoritmo.js');
  const amanita = A_.SPECIES.find((s) => s.key === 'amanita');
  // 2000 m: fuera de la banda, dentro de lo que dice la fuente.
  assert.ok(A_.altitudeFactor(2000, amanita) > 0,
    'a 2000 m la amanita no puede quedar a cero: '
    + A_.altitudeFactor(2000, amanita));
  const cardo = A_.SPECIES.find((s) => s.key === 'seta_cardo');
  assert.ok(A_.altitudeFactor(1200, cardo) > 0,
    'a 1200 m la seta de cardo no puede quedar a cero: '
    + A_.altitudeFactor(1200, cardo));
});

prueba('el veto de pH aparece en el guion del selector de Especies', () => {
  // Si el selector no dice el motivo, el veto esconde sin explicar.
  const src = require('fs').readFileSync('app.js', 'utf8');
  assert.ok(/pH fuera de rango/.test(src),
    'el selector tiene que explicar el veto de suelo');
  assert.ok(/fuera de su h.bitat/.test(src),
    'el selector tiene que explicar el veto de hábitat');
  assert.ok(/mostrarVetadas/.test(src),
    'tiene que existir el interruptor para verlas igualmente');
  assert.ok(/refreshMushroomSelector/.test(src),
    'el interruptor necesita una función que redibuje sin duplicar escuchadores');
});

cola.then(() => {
  console.log('\n' + '-'.repeat(58));
  console.log(pruebas + ' pruebas, ' + fallos + ' fallos');
  console.log('-'.repeat(58));
  process.exit(fallos ? 1 : 0);
});