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

  var OUT_HEADER = ["Address Line 1", "soggetto", "case_sap", "materiali",
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
    var n = expandSaints(norm(name));
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

  function cleanMateriali(note) {
    var t = String(note || "").replace(/Note riferimento:/gi, "").replace(PHONE_RE, "");
    return t.replace(/\s+/g, " ").replace(/^[\s;]+|[\s;]+$/g, "");
  }

  // rows: [{case, sogg, addr, note}], idx: indice del comune
  function process(rows, idx, comune) {
    var results = [], report = [];
    var noIndex = !!NO_INDEX[comune];
    rows.forEach(function (r, i) {
      var n = i + 2; // numero riga nel file originale (intestazione = 1)
      var parsed = parseAddress(r.addr);
      var flag = "no", why = [], lat = "", lon = "", addrOut;
      if (noIndex) {
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
          if (civN !== civ || espN !== esp) {
            why.push("civico da nota: " + civ + (esp ? "/" + esp : "") + " -> " + civN + (espN ? "/" + espN : ""));
          }
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
          addrOut = streetLabel(name, civ, esp, r.addr, false);
        }
      }
      results.push({
        addr: addrOut, sogg: r.sogg, case: r.case,
        mat: cleanMateriali(r.note), istr: "", flag: flag,
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
    NO_INDEX: NO_INDEX
  };
});
