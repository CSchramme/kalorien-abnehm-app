// Startdatei für Plesk / Phusion Passenger und andere Hoster, die eine CommonJS-Startdatei erwarten.
// Passenger lädt diese Datei per require() und übernimmt den Port automatisch;
// der eigentliche Server ist ein ES-Modul und wird hier dynamisch geladen.
import('./server/index.js')
  .then(({ createServer }) => {
    const { server } = createServer();
    const port = Number(process.env.PORT) || 3000;
    server.listen(port, () => console.log(`Leichter läuft (Port ${port})`));
  })
  .catch((err) => {
    console.error('Leichter konnte nicht starten:', err);
    process.exit(1);
  });
