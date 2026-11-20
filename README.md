# Preparazione file Spoke · Cooperativa Futura

Strumento interno per gli operatori del ritiro ingombranti. Carica l'estrazione dei ritiri (Excel o CSV) e scarica il file per l'import in Spoke, con lat/lon ricavate dall'indirizzario ANNCSU del comune.

## Privacy
- Il file caricato viene letto nel browser e non viene inviato a nessun server.
- Il repository non deve mai contenere liste di ritiri. Non caricare file di dati nella cartella del sito.
- Il sito può registrare le visite alla pagina (come ogni sito), non il contenuto dei file.

## Aggiornare gli indici
Gli indici in `data/` derivano dall'indirizzario Toscana ANNCSU (file INDIR_TOSC). Vanno rigenerati quando serve un nuovo comune o ogni alcuni mesi.

## Limiti
- Le regole manuali (lettere di zona, località scritte male, esponenti mancanti) non sono automatiche: la tabella "Da controllare" le segnala.
- Foiano della Chiana: nessuna coordinata utile nell'indirizzario, si usa Google Maps.
- Coordinate METODO 4 per la maggior parte dei civici delle frazioni: accuratezza di 5 m o più.

## Uso in locale
Il browser blocca il caricamento degli indici se la pagina viene aperta direttamente come file. Per provarla sul PC: dalla cartella `app` avviare `python3 -m http.server 8000` e aprire http://localhost:8000.
