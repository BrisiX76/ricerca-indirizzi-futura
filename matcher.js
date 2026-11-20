/*
 * matcher.js - logica di abbinamento indirizzi -> coordinate ANNCSU.
 * Porta in JavaScript dello script spoke_prep.py. Nessuna chiamata di rete:
 * i dati della lista restano nel browser.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SpokeMatcher = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var OUT_HEADER = ["Address Line 1", "soggetto", "telefono", "case_sap", "materiali",
    "istruzioni_accesso", "da_verificare", "lat", "lon"];

  // Comuni per cui l'indirizzario non basta: coordinate da Google Maps.
  var NO_INDEX = { foiano: true };

  function norm(s) {
    return String(s === undefined || s === null ? "" : s)
      .normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .toUpperCase().replace(/['’]/g, " ")
      .replace(/\s+/g, " ").trim();
  }

  function expandSaints(n) {
    n = n.replace(/\bS\. ?ANDREA\b/g, "SANT ANDREA").replace(/\bS\. ?FIRMINA\b/g, "SANTA FIRMINA");
    return n.replace(/\bS\. ?/g, "SAN ");
  }

  function normName(name) {
    var n = expandSaints(norm(name)).replace(/\bMONSIGNOR\b/, "MONSIGNORE");
    n = n.replace(/^LOC\.? /, "LOCALITA ");
    n = n.replace(/^P\.?ZZA /, "PIAZZA ");
    n = n.replace(/^V\.? /, "VIA ");
    n = n.replace(/^V\.LE /, "VIALE ");
    return n;
  }

  var CITY_RE = /^(.*\S)\s*[-,]\s*([A-Z][A-Z ']+)$/;
  var ADDR_RE = /^(.*?[A-Z])\s+(\d+)(?:\s*[\/ ]\s*([A-Z]|\d+))?(?:\s+(?:\d+|[A-Z]))*$/;
  var NOTE_CIVICO_RE = /CIVICO\s*:?\s*N?\.?\s*(\d+)(?:\s*\/\s*([A-Z]|\d+)(?![A-Za-z]))?/i;
  var PHONE_RE = /\+?\d[\d ]{7,}\d/g;

  function parseAddress(addr) {
    var a = norm(addr);
    var m = CITY_RE.exec(a);
    if (m) a = m[1];
    a = a.trim().replace(/\s+LETTERA\s+/, "/");
    m = ADDR_RE.exec(a);
    if (!m) return null;
    return { name: normName(m[1]), civ: m[2], esp: norm(m[3] || "") };
  }

  function streetLabel(name, civ, esp, raw, withCity) {
    var label = name + " " + civ + (esp ? "/" + esp : "");
    if (withCity) {
      var m = CITY_RE.exec(norm(raw));
      if (m) label += ", " + m[2];
    }
    return label;
  }

  // "VIA M. MANNELLI 15" -> "VIA MARIO MANNELLI 15": stesso cognome, iniziale compatibile.
  function initialFallback(idx, name, civ, esp) {
    var parts = name.split(" ");
    var init = -1;
    for (var k = 0; k < parts.length; k++) if (/^[A-Z]\.?$/.test(parts[k])) { init = k; break; }
    if (init === -1 || parts.length < 3) return null;
    var initial = parts[init].charAt(0), surname = parts[parts.length - 1], type = parts[0];
    for (var key in idx) {
      var p = key.split("|");
      if (p[1] !== civ || p[2] !== esp || p[0].slice(-(surname.length + 1)) !== " " + surname) continue;
      var ow = p[0].split(" ");
      if (ow.length >= 3 && ow[0] === type && ow[1].charAt(0) === initial) return idx[key];
    }
    return null;
  }

  // idx: oggetto { "ODONIMO|CIVICO|ESPONENTE": [lat, lon, rank] }
  function lookup(idx, name, civ, esp) {
    var names = [name];
    var bareSt = name.replace(/^STRADA COMUNALE (DI |DA |DEL |DELLA )?/, "");
    if (bareSt !== name) names.push("LOCALITA " + bareSt);
    // "PONTE ALLA CHIASSA PER MARCENA" o "CECILIANO PER PATRIGNONE": provo entrambe le parti
    var src = bareSt !== name ? bareSt : name;
    if (src.indexOf(" PER ") !== -1) {
      src.split(" PER ").forEach(function (pt) { names.push("LOCALITA " + pt); });
    }
    if (name.indexOf("LOCALITA") !== 0) {
      names.push("LOCALITA " + name);
      var bare = name.replace(/^(VIA|VIALE|PIAZZA|LARGO) (DI |DEL |DELLA )?/, "");
      if (bare !== name) names.push("LOCALITA " + bare);
    }
    for (var i = 0; i < names.length; i++) {
      var tries = [[esp, ""], ["", " (civico base, esponente non trovato)"]];
      for (var t = 0; t < tries.length; t++) {
        var hit = idx[names[i] + "|" + civ + "|" + tries[t][0]];
        if (hit) return { hit: hit, found: names[i], note: tries[t][1] };
      }
    }
    var fb = initialFallback(idx, name, civ, esp);
    if (fb) return { hit: fb, found: name, note: "" };
    return null;
  }

  // Comune dal suffisso dell'indirizzo, es. "VIA X 4 - MONTE SAN SAVINO" -> "monte_san_savino"
  var CITTA = {
    "AREZZO": "arezzo", "CIVITELLA IN VAL DI CHIANA": "civitella", "CORTONA": "cortona",
    "CASTIGLION FIORENTINO": "castiglion_fiorentino", "MONTE SAN SAVINO": "monte_san_savino",
    "LUCIGNANO": "lucignano", "FOIANO DELLA CHIANA": "foiano"
  };
  function comuneDaIndirizzo(addr) {
    var m = CITY_RE.exec(norm(addr));
    if (!m) return null;
    return CITTA[m[2].trim()] || null;
  }

  // Separa la nota in: materiali (solo voci "N MATERIALE", separate da "; ")
  // e istruzioni di accesso (tutto il resto, senza nomi, telefoni e civico ripetuto).
  var MAT_START = /(^|\s)(\d{1,2})\s+(?=[A-Za-z\u00C0-\u024F])/;
  function splitNote(note, sogg, addr) {
    var t = String(note || "").replace(/Note riferimento:/gi, " ");
    // telefono: primo numero trovato (cellulare 3xx o sequenza lunga di cifre), anche attaccato al nome
    var telM = /3\d{2}[ .]?\d{6,7}/.exec(t) || /\+?\d[\d ]{7,}\d/.exec(t);
    var tel = telM ? telM[0].replace(/\s+/g, " ").trim() : "";
    // telefoni: cellulari italiani (3xx...) o sequenze lunghe di cifre
    t = t.replace(/3\d{2}[ .]?\d{6,7}/g, " ").replace(/\+?\d[\d ]{7,}\d/g, " ");
    var m = MAT_START.exec(t);
    var head = t, tail = "";
    if (m) {
      var start = m.index + m[1].length;
      head = t.slice(0, start);
      tail = t.slice(start);
    }
    // nomi del soggetto (anche attaccati, es. "LoVasco" per "LO VASCO")
    var tokens = {}, joined = norm(sogg).replace(/\s/g, "").toLowerCase();
    norm(sogg).split(" ").forEach(function (w) { tokens[w.toLowerCase()] = true; });
    // "CIVICO 145", "CIVICO: 124" in maiuscolo: sono annotazioni dell'operatore, il civico è già in indirizzo.
    // Il "civico 26" minuscolo in una proposta di ritiro resta.
    head = head.replace(/CIVICO\s*:?\s*\d+(\s+\d+)*/g, " ").replace(/\bcivico\s+n\b\.?\s*/gi, "civico ");
    // il nome della via è già nella colonna indirizzo
    var via = addr ? norm(addr).replace(/\s+-\s+.*$/, "").replace(/,.*$/, "").replace(/\s+\d+(\s*\/\s*[A-Z0-9]+)?(\s+[A-Z0-9]+)*$/, "").replace(/\s+LETTERA.*$/, "") : "";
    if (addr) {
      var civAddr = norm(addr).replace(/\s+-\s+.*$/, "").replace(/,.*$/, "").match(/\s(\d+(\s*\/\s*[A-Z0-9]+)?)$/);
      if (civAddr) head = head.replace(new RegExp("(^|\\s)" + civAddr[1].replace(/\s+/g, "") + "(?=\\s|$)"), " ").replace(/\s+/g, " ");
    }
    if (via && via.length > 3) {
      head = head.replace(new RegExp(via.split(" ").map(function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join("\\s+"), "i"), " ");
    }
    head = head.split(/\s+/).filter(function (w) {
      var lw = w.toLowerCase().replace(/[^a-z]/g, "");
      if (!lw) return /[0-9]/.test(w); // numeri del civico o di "altro lato": restano
      if (tokens[lw]) return false;
      if (lw.length >= 4 && joined.indexOf(lw) !== -1) return false;
      return true;
    }).join(" ").replace(/^[\s;,.\-]+|[\s;,.\-]+$/g, "");
    // frasi operative finite in materiali: vanno nelle istruzioni
    var extra = [];
    tail = tail.replace(/\b(DETTO DI [A-Z ]+|IMBALLATO IN SICUREZZA|ESPONE[A-Z ]*)\b/g, function (m) { extra.push(m.trim()); return " "; });
    if (extra.length) head = (head + " " + extra.join(" ")).trim();
    var mat = tail.split(";").map(function (x) { return x.replace(/["\u201C\u201D]/g, "").replace(/\s+/g, " ").trim(); })
      .filter(function (x) { return x; }).join("; ");
    return { mat: mat, istr: head, tel: tel };
  }

  function cleanMateriali(note) {
    var t = String(note || "").replace(/Note riferimento:/gi, "").replace(PHONE_RE, "");
    return t.replace(/\s+/g, " ").replace(/^[\s;]+|[\s;]+$/g, "");
  }

  // rows: [{case, sogg, addr, note}], idx: indice del comune
  function process(rows, idx, comune) {
    var results = [], report = [];
    var noIndex = !!NO_INDEX[comune];
    rows.forEach(function (r, i) {
      var n = r.riga || i + 2; // numero riga nel file originale (intestazione = 1)
      var parsed = parseAddress(r.addr);
      var flag = "no", why = [], lat = "", lon = "", addrOut;
      var nota = splitNote(r.note, r.sogg, r.addr);
      if (!comune) {
        addrOut = r.addr;
        flag = "sì";
        why.push("comune non riconosciuto nell'indirizzo");
      } else if (noIndex) {
        flag = "sì";
        why.push("comune senza indirizzario: coordinate da Google Maps");
        addrOut = r.addr;
      } else if (!parsed) {
        addrOut = r.addr;
        flag = "sì";
        why.push("indirizzo non riconosciuto");
      } else {
        var name = parsed.name, civ = parsed.civ, esp = parsed.esp;
        var mn = NOTE_CIVICO_RE.exec(r.note || "");
        if (mn) {
          var civN = mn[1], espN = norm(mn[2] || "");
          // civico preso dalla nota: è corretto per regola, non va verificato
          // (nessun motivo nel report)
          civ = civN; esp = espN;
        }
        var found = lookup(idx, name, civ, esp);
        if (found) {
          lat = found.hit[0]; lon = found.hit[1];
          if (found.note) { flag = "sì"; why.push("esponente non in indirizzario"); }
          addrOut = streetLabel(name, civ, esp, r.addr, true);
        } else {
          flag = "sì";
          why.push("coordinate non trovate: geocodifica da indirizzo");
          addrOut = streetLabel(name, civ, esp, r.addr, true);
        }
      }
      results.push({
        addr: addrOut, sogg: r.sogg, case: r.case,
        mat: nota.mat, istr: nota.istr, tel: nota.tel, flag: flag,
        lat: lat, lon: lon
      });
      if (flag === "sì" || why.length) {
        report.push({ riga: n, case: r.case, sogg: r.sogg, addr: r.addr, motivo: why.join("; ") });
      }
    });
    return { results: results, report: report };
  }

  return {
    OUT_HEADER: OUT_HEADER,
    norm: norm,
    parseAddress: parseAddress,
    lookup: lookup,
    process: process,
    comuneDaIndirizzo: comuneDaIndirizzo,
    splitNote: splitNote,
    NO_INDEX: NO_INDEX
  };
});
