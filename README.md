# Handwerk CRM

Offline-fähige Web-App (PWA) für Handwerksbetriebe: Kunden mit Notizen, Angebote, Aufträge,
Rechnungen und E-Rechnungen (ZUGFeRD / XRechnung). Mehrere Firmen, eigener Briefkopf,
Synchronisation über OneDrive. Läuft auf Android, iPad/iPhone, Windows und macOS im Browser
und lässt sich auf jedem Gerät „zum Startbildschirm hinzufügen“.

## Funktionen
- **Mehrere Firmen** mit eigenen Stammdaten, Bankverbindung, Nummernkreisen, Standardtexten und Briefkopf
- **Briefkopf** als PDF (Seite 2 = Folgeseite) oder Bild, Ränder in mm einstellbar
- **Kunden** mit Notiz-Verlauf und Belegübersicht
- **Angebot → Auftrag → Rechnung** per Klick, Positionen mit Einheiten, 19/7/0 % USt
- **Rechnung abschließen**: feste Nummer, unveränderbar (GoBD), Storno per Stornorechnung
- **§ 13b** (Bauleistungen, Reverse Charge) und **Kleinunternehmer § 19**
- **ZUGFeRD 2.x / Factur-X, Profil EN 16931** (PDF/A-3 mit eingebetteter `factur-x.xml`)
- **XRechnung 3.0** (CII-XML) für öffentliche Auftraggeber
- **OneDrive-Sync** (App-Ordner `Apps/Handwerk CRM`), Belege werden unter `Belege/<Firma>/` abgelegt
- **Datensicherung** als JSON-Datei

## Entwicklung
```bash
npm install
npm run dev      # lokaler Server
npm run build    # Produktionsbuild nach dist/
npm test         # erzeugt Muster-PDF/XML in test/out
python3 test/validate.py test/out/*.xml   # Prüfung gegen EN16931-/XRechnung-Schematron
```

## OneDrive einrichten
1. [Microsoft Entra – App-Registrierungen](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) → *Neue Registrierung*
2. Kontotypen: *Konten in allen Organisationsverzeichnissen und persönliche Microsoft-Konten*
3. Umleitungs-URI: Plattform **Single-Page-Anwendung**, Adresse der App (z. B. `https://<name>.github.io/<repo>/`)
4. Client-ID in der App unter *Einstellungen → OneDrive* eintragen (oder als Repository-Variable `MS_CLIENT_ID` hinterlegen)

## Datenhaltung
Daten liegen lokal im Browser (IndexedDB) und werden mit `crm-data.json` im OneDrive-App-Ordner
abgeglichen (pro Datensatz gewinnt die neueste Änderung). Es gibt keinen Server.
