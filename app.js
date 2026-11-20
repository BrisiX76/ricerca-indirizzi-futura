/* app.js - interfaccia: lettura Excel/CSV, abbinamento, scarico xlsx.
 * Tutto avviene nel browser. Nessuna richiesta di rete con i dati della lista. */
(function () {
  "use strict";

  var fileInp = document.getElementById("file");
  var runBtn = document.getElementById("run");
  var dlBtn = document.getElementById("scarica");
  var box = document.getElementById("risultato");
  var riepilogo = document.getElementById("riepilogo");
  var tbody = document.querySelector("#report tbody");

  var cache = {};     // indici già caricati
  var ultimo = null;  // ultimo risultato, per il download

  function caricaIndice(comune) {
    if (cache[comune]) return Promise.resolve(cache[comune]);
    return fetch("data/" + comune + ".json")
      .then(function (r) {
        if (!r.ok) throw new Error("indice non trovato: " + comune);
        return r.json();
      })
      .then(function (j) { cache[comune] = j; return j; });
  }

  // Testo di un CSV: prova UTF-8, altrimenti Windows-1252 (export spesso così).
  function decodificaTesto(bytes) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (e) {
      return new TextDecoder("windows-1252").decode(bytes);
    }
  }

  // Dal contenuto di un file (xlsx/xls/csv) ricava le righe grezze.
  function righeDaBytes(bytes, nome) {
    var wb;
    if (/\.csv$/i.test(nome)) {
      wb = XLSX.read(decodificaTesto(bytes), { type: "string", raw: false });
    } else {
      wb = XLSX.read(bytes, { type: "array", raw: false });
    }
    var ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
  }

  // Accetta anche lo zip con uno o più file Excel o CSV dentro.
  function apriFile(file) {
    return file.arrayBuffer().then(function (buf) {
      if (!/\.zip$/i.test(file.name)) {
        return righeDaBytes(new Uint8Array(buf), file.name);
      }
      return JSZip.loadAsync(buf).then(function (zip) {
        var candidati = [];
        zip.forEach(function (percorso, voce) {
          if (!voce.dir && !/^__MACOSX|^\./.test(percorso) && /\.(xlsx|xls|csv)$/i.test(percorso)) {
            candidati.push({ nome: percorso, voce: voce });
          }
        });
        if (!candidati.length) throw new Error("nello zip non c'è un file Excel o CSV");
        // più file nello zip (es. una gita su due comuni): si uniscono, intestazione presa dal primo
        return Promise.all(candidati.map(function (c) {
          return c.voce.async("uint8array").then(function (bytes) {
            return righeDaBytes(bytes, c.nome);
          });
        })).then(function (liste) {
          var unite = [];
          liste.forEach(function (righe, k) {
            righe.forEach(function (riga, j) {
              if (k > 0 && j === 0) return; // intestazione ripetuta
              unite.push(riga);
            });
          });
          return unite;
        });
      });
    });
  }

  // Più file (anche più zip): si uniscono, con l'intestazione presa dal primo.
  // I ritiri con lo stesso Case SAP compaiono una volta sola.
  var duplicatiRimossi = 0;
  function leggiListe(files) {
    return Promise.all(Array.prototype.map.call(files, apriFile)).then(function (liste) {
      var unite = [];
      liste.forEach(function (righe, k) {
        righe.forEach(function (riga, j) {
          if (k > 0 && j === 0) return;
          unite.push(riga);
        });
      });
      return unite;
    }).then(function (righe) {
      return righe;
    });
  }

  function leggiLista(files) {
    return leggiListe(files).then(function (righe) {
      if (!righe.length) throw new Error("il file è vuoto");
      var h = righe[0].map(function (x) { return String(x).trim().toLowerCase(); });
      function col(k) {
        for (var i = 0; i < h.length; i++) if (h[i].indexOf(k) !== -1) return i;
        return -1;
      }
      var ci = { case: col("case"), sogg: col("soggetto"), addr: col("indirizzo"), note: col("note") };
      if (ci.addr === -1) throw new Error("colonna Indirizzo non trovata nell'intestazione");
      var out = [], visti = {};
      duplicatiRimossi = 0;
      for (var r = 1; r < righe.length; r++) {
        var row = righe[r];
        if (!row.some(function (c) { return String(c).trim() !== ""; })) continue;
        function g(i) { return i === -1 || i === undefined ? "" : String(row[i] === undefined ? "" : row[i]).trim(); }
        var item = { case: g(ci.case), sogg: g(ci.sogg), addr: g(ci.addr), note: g(ci.note) };
        if (item.case && visti[item.case]) { duplicatiRimossi++; continue; }
        if (item.case) visti[item.case] = true;
        out.push(item);
      }
      return out;
    });
  }

  function mostraRisultato(comune, res) {
    var tot = res.results.length;
    var conCoord = res.results.filter(function (r) { return r.lat !== ""; }).length;
    riepilogo.textContent = "Comune: " + comune.replace(/_/g, " ") + " · righe: " + tot +
      (duplicatiRimossi ? " · duplicati rimossi: " + duplicatiRimossi : "") +
      " · con coordinate: " + conCoord + " · da controllare: " + res.report.length;

    tbody.innerHTML = "";
    res.report.forEach(function (r) {
      var tr = document.createElement("tr");
      [r.riga, r.case, r.sogg, r.addr, r.motivo].forEach(function (v) {
        var td = document.createElement("td");
        td.textContent = v;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    box.hidden = false;
    dlBtn.disabled = false;
  }

  function scaricaXlsx(comune, res) {
    var sheet = [SpokeMatcher.OUT_HEADER];
    res.results.forEach(function (r) {
      sheet.push([
        r.addr, r.sogg, r.case, r.mat, r.istr, r.flag,
        r.lat === "" ? "" : Number(r.lat),
        r.lon === "" ? "" : Number(r.lon)
      ]);
    });
    var rep = [["Riga", "Case SAP", "Soggetto", "Indirizzo", "Motivo"]];
    res.report.forEach(function (r) { rep.push([r.riga, r.case, r.sogg, r.addr, r.motivo]); });

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet), "Spoke");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rep), "Da controllare");
    XLSX.writeFile(wb, "spoke_" + comune + ".xlsx");
  }

  fileInp.addEventListener("change", function () { runBtn.disabled = !fileInp.files.length; });

  runBtn.addEventListener("click", function () {
    var files = fileInp.files;
    if (!files || !files.length) return;
    runBtn.disabled = true;
    riepilogo.textContent = "Elaborazione in corso...";
    box.hidden = false;
    leggiLista(files)
      .then(function (righe) {
        var scelta = "auto";
        var assegnati = righe.map(function (r, i) {
          var c = scelta === "auto" ? SpokeMatcher.comuneDaIndirizzo(r.addr) : scelta;
          return { riga: i + 2, c: c || "", r: r };
        });
        var nomi = {};
        assegnati.forEach(function (a) { if (a.c) nomi[a.c] = true; });
        var chiavi = Object.keys(nomi);
        return Promise.all(chiavi.map(function (c) {
          return SpokeMatcher.NO_INDEX[c] ? Promise.resolve({}) : caricaIndice(c);
        })).then(function (indici) {
          var idxPer = {};
          chiavi.forEach(function (c, k) { idxPer[c] = indici[k]; });
          var gruppi = {};
          assegnati.forEach(function (a) {
            (gruppi[a.c] = gruppi[a.c] || []).push(a);
          });
          var results = [], report = [];
          Object.keys(gruppi).forEach(function (c) {
            var g = gruppi[c];
            var rows = g.map(function (a) { return { riga: a.riga, case: a.r.case, sogg: a.r.sogg, addr: a.r.addr, note: a.r.note }; });
            var out = SpokeMatcher.process(rows, idxPer[c] || {}, c);
            results = results.concat(out.results.map(function (x, k) { x.riga = g[k].riga; return x; }));
            report = report.concat(out.report);
          });
          results.sort(function (a, b) { return a.riga - b.riga; });
          report.sort(function (a, b) { return a.riga - b.riga; });
          var nomeComune = scelta === "auto" ? "misto" : scelta;
          ultimo = { comune: nomeComune, res: { results: results, report: report } };
          mostraRisultato(nomeComune, ultimo.res);
        });
      })
      .catch(function (e) {
        riepilogo.textContent = "Errore: " + e.message;
        dlBtn.disabled = true;
      })
      .then(function () { runBtn.disabled = false; });
  });

  dlBtn.addEventListener("click", function () {
    if (ultimo) scaricaXlsx(ultimo.comune, ultimo.res);
  });

})();
