## Smoke-Test (Persistenz + 24 Monate)

### Start
1. `npm install`
2. `npm run tauri dev`

### Persistenz
1. In **Kontostand**: Datum = heute, Kontostand = `100,00` speichern.
2. App komplett schließen.
3. App erneut starten.
4. Erwartung: Der Eintrag ist in der Historie weiterhin sichtbar.

### Fixkosten / Prognose / Buy-Liste Verrechnung
1. In **Prognosen**: aktueller Monat `YYYY-MM` → Einnahmen `1000,00` speichern.
2. In **Fixkosten**: z.B. `Miete`, Betrag `400,00`, Rhythmus `Monatlich`, erste Abbuchung = 1. des Monats hinzufügen.
3. In **Buy-Liste**: Item anlegen (z.B. `Kopfhörer` `50,00`) → bleibt geparkt.
4. Dashboard prüfen:
   - Erwartung: Einnahmen werden addiert, Fixkosten abgezogen, Buy-Item noch **nicht**.
5. Buy-Item anhaken (Apply) und Dashboard neu öffnen:
   - Erwartung: Buy-Item wird abgezogen.
6. Buy-Item wieder abwählen (Undo):
   - Erwartung: Buy-Item wird wieder entfernt.

### 24 Monate Navigation
1. Im **Dashboard** 24× nach rechts klicken.
2. Erwartung: App bleibt stabil, zeigt Monat `+24` an und berechnet (ohne Crash).

