**Finaler, präziser Prompt:**

> Entwirf eine Desktop-Applikation mit integriertem KI-Agenten basierend auf Open SWE vom LangChain-Team.
> Die Anwendung soll konsequent **Spec-Driven Development** umsetzen und eine **phasenbasierte Entwicklungsumgebung (IDE)** bereitstellen.
>
> ## Kernidee: Phasenbasierte UI (progressive Disclosure)
>
> Die Benutzeroberfläche zeigt **immer nur den aktuellen Entwicklungsartefakt-Typ** und blendet alles andere aus:
>
> 1. **Spec-Phase**
>
>    * Sichtbar: Spezifikation (Spec)
>    * Eingabe: Chat + optional strukturierter Editor
>    * Kein Zugriff auf Code
> 2. **User Story Phase**
>
>    * Sichtbar: User Stories
>    * Generiert aus der Spec
>    * Bearbeitung via Chat oder manuell
>    * Spec bleibt referenzierbar, aber nicht im Fokus
> 3. **Technical Story Phase**
>
>    * Sichtbar: Technical Stories
>    * Abgeleitet aus User Stories
>    * Bearbeitbar
> 4. **Implementierungsphase**
>
>    * **Erst jetzt wird der Code sichtbar**
>    * Freischaltung eines integrierten, minimalen Code-Editors
>    * Fokus: Umsetzung der Technical Stories
>
> 👉 Ziel: Der User soll **niemals zu früh Code sehen**, sondern strikt entlang des Spec-Driven Workflows geführt werden.
>
> ---
>
> ## Workflow
>
> 1. **Projektstart**
>
>    * Automatisches Erstellen eines neuen Git-Branches
> 2. **Spec-Erstellung**
>
>    * User beschreibt Anforderungen im Chat
>    * Agent generiert strukturierte Spec
>    * Iterative Verbesserung möglich (Chat + Editor)
> 3. **Ableitung**
>
>    * Spec → User Stories
>    * User Stories → Technical Stories
> 4. **Implementierung**
>
>    * Zerlegung in kleine Tasks (Chunks)
>    * Für jede Technical Story:
>
>      * eigener Sub-Agent
>      * eigenes Context Window
> 5. **Agent-Modi**
>
>    * **YOLO Mode**:
>
>      * Vollautomatisches Abarbeiten aller Technical Stories
>      * Kann unbeaufsichtigt laufen (z. B. über Nacht)
>    * **Human-in-the-Loop Mode**:
>
>      * Tool Calls müssen bestätigt werden
>
> ---
>
> ## Testing-System (zentraler Bestandteil)
>
> **Automatisch generiert und iterativ verbessert:**
>
> * **Unit Tests**
>
>   * basierend auf Technical Stories
> * **Integrationstests**
>
>   * basierend auf User Stories
>   * Technologien:
>
>     * Web: Playwright (z. B. React)
>     * Mobile: Flutter, iOS, Android
> * **Test-Schleife (autonom)**
>
>   * Tests werden kontinuierlich ausgeführt
>   * Agent entscheidet:
>
>     * Code fixen **oder**
>     * Test korrigieren
>   * Ziel:
>
>     * Alle Tests bestehen (Unit, Integration, End-to-End)
>     * Verhalten entspricht exakt den User Stories
>
> ---
>
> ## Abschluss
>
> * Automatischer Merge in den Main-Branch nach erfolgreichem Testing
>
> ---
>
> ## Kollaboration & Struktur
>
> * Jede Spec bekommt einen eigenen Ordner im Repository
> * Mehrere Specs können parallel entwickelt werden
> * Git-basierte Zusammenarbeit wird unterstützt
>
> ---
>
> ## Technische Anforderungen
>
> * Desktop-App (z. B. Electron, Tauri oder vergleichbar)
> * Integrierter minimaler Code-Editor (erst in Implementierungsphase sichtbar)
> * Chat-Interface als primärer Steuermechanismus
> * Klare Trennung von:
>
>   * Spec
>   * User Stories
>   * Technical Stories
>   * Code
>
> ---
>
> ## Ziel des Systems
>
> Eine fokussierte Entwicklungsumgebung, die:
>
> * Entwickler strikt durch Spec-Driven Development führt
> * Kontextüberladung verhindert
> * KI-Agenten effizient orchestriert
> * und autonome Softwareentwicklung (inkl. Testing) ermöglicht

---

Wenn du willst, kann ich als nächsten Schritt:

* dir eine **konkrete UI-Struktur (Screens + Navigation)** designen
* oder eine **Systemarchitektur (Agenten, Services, Datenflüsse)**
* oder direkt ein **Tech-Stack + MVP-Plan**

ausarbeiten.
