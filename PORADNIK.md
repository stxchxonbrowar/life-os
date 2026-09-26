# Life OS: instrukcja uruchomienia krok po kroku

**Dla kogo:** dla osoby, która nigdy nie programowała. Nie otwierasz i nie zmieniasz żadnego kodu. Jedyny wyjątek to wklejenie sześciu wartości w kroku 6, a to może za Ciebie zrobić Claude.

**Czas:** 45 do 60 minut za pierwszym razem.
**Koszt:** 0 zł. Firebase (plan Spark) i GitHub (plan Free) nie wymagają karty płatniczej.
**Urządzenie:** kroki 1 do 7 zrób na komputerze, nie na telefonie.

Nazwy przycisków podaję po angielsku, tak jak w konsoli Firebase i w GitHubie. Jeśli Twoja przeglądarka tłumaczy strony na polski, nazwy mogą wyglądać nieco inaczej, ale kolejność ekranów jest ta sama.

---

## Zanim zaczniesz: trzy rzeczy, które mają znaczenie

1. **Baza ma wystartować w trybie zablokowanym, NIE w „test mode”.** Tryb testowy to reguła otwarta dla całego internetu, która sama wygasa po 30 dniach. Do tego czasu każdy, kto zna identyfikator Twojego projektu, może czytać i kasować Twoje dane. Po 30 dniach aplikacja przestaje działać. W kroku 5 wklejasz gotowe reguły, które wpuszczają tylko zalogowanego właściciela.
2. **Baza musi mieć nazwę `(default)`.** Darmowy limit Firestore obejmuje tylko bazę domyślną. Baza o innej nazwie wymaga płatnego konta.
3. **Na darmowym GitHubie strona działa tylko z publicznego repozytorium.** Kod aplikacji będzie więc widoczny dla wszystkich. To jest bezpieczne, bo w kodzie nie ma haseł, a Twoje dane leżą w Firebase za logowaniem i regułami. Nie wrzucaj do repozytorium żadnych haseł ani plików kopii zapasowej.

## Konta, które założysz

| Serwis | Do czego służy | Adres | Kiedy |
|---|---|---|---|
| Konto Google | wejście do Firebase (jeśli masz Gmaila, masz konto) | accounts.google.com | krok 2 |
| Firebase | baza danych i logowanie | console.firebase.google.com | kroki 2 do 6 |
| GitHub | darmowy adres strony, dzięki któremu zainstalujesz aplikację | github.com | krok 7 |

Hasła zapisz w menedżerze haseł. Nie zapisuj ich w żadnym pliku aplikacji.

---

## Krok 1: Rozpakuj paczkę

Rozpakuj `personal-life-os.zip` do zwykłego folderu (prawy przycisk myszy, „Wyodrębnij wszystko”). W środku są pliki `index.html`, `app.js`, `firebase-config.js` i inne. Nie zmieniaj ich nazw.

## Krok 2: Projekt Firebase

1. Wejdź na **console.firebase.google.com** i zaloguj się kontem Google.
2. Kliknij **Create a project**. Nazwa np. `life-os-karol`.
3. Przy Google Analytics wyłącz przełącznik (nie jest potrzebny).
4. Kliknij **Create project**, a potem **Continue**.
5. W lewym dolnym rogu konsoli powinien być plan **Spark** (darmowy). Jeśli konsola proponuje „Upgrade”, pomiń to i nie podawaj karty.

## Krok 3: Baza Firestore

1. W menu po lewej wybierz **Firestore Database** (może być w sekcji „Build”). Kliknij **Create database**.
2. **Database ID:** zostaw `(default)`. **Edition:** Standard.
3. **Location:** wybierz lokalizację w Europie (np. `eur3` albo Warszawę, jeśli jest na liście). Lokalizacji nie da się później zmienić.
4. Przy regułach wybierz tryb zablokowany (**Production mode** albo **Locked mode**). **Nie wybieraj „Test mode”.**
5. Kliknij **Create** (albo **Enable**) i poczekaj chwilę.

## Krok 4: Logowanie (Authentication)

1. W menu wybierz **Authentication** i kliknij **Get started**.
2. Zakładka **Sign-in method**, wybierz **Email/Password**, włącz pierwszy przełącznik (nie „Email link”) i kliknij **Save**.
3. Zakładka **Users**, kliknij **Add user**. Wpisz swój e-mail i mocne hasło (co najmniej 6 znaków). To jest konto, którym logujesz się do aplikacji.
4. Zamknij rejestrację obcym: w Authentication otwórz **Settings**, sekcja **User actions**, odznacz **Enable create (sign-up)** i kliknij **Save**. Od tej chwili nikt poza Tobą nie założy konta w Twoim projekcie. Twoje konto już istnieje, więc logowanie działa jak wcześniej.

Kolejne osoby (np. syna) dodajesz ręcznie w **Users, Add user**. Każde konto ma własne, osobne dane: nikt nie widzi cudzych zadań ani fiszek.

## Krok 5: Reguły bezpieczeństwa

1. Wróć do **Firestore Database** i otwórz zakładkę **Rules**.
2. Zaznacz całą zawartość (Ctrl+A), usuń ją i wklej reguły z ramki poniżej (albo z pliku `firestore.rules` z paczki, otwartego w Notatniku).
3. Kliknij **Publish**.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Każdy użytkownik widzi i zmienia WYŁĄCZNIE dane w swojej gałęzi users/{jego-uid}/...
    // Niezalogowani i inni użytkownicy nie mają dostępu do niczego.
    function isOwner(uid) {
      return request.auth != null && request.auth.uid == uid;
    }
    function text(v, max) {
      return v is string && v.size() > 0 && v.size() <= max;
    }
    function optionalTimestamp(d, k) {
      return !(k in d) || d[k] == null || d[k] is timestamp;
    }
    // Pole opcjonalne, ale JEŚLI występuje, musi być poprawnym niepustym tekstem.
    // Puste pole aplikacja po prostu pomija przy zapisie (nigdy nie zapisuje "").
    function optionalText(d, k, max) {
      return !(k in d) || text(d[k], max);
    }
    // Referencja do innego dokumentu w TEJ SAMEJ kolekcji (id listy / id zadania nadrzędnego).
    function optionalRef(d, k) {
      return !(k in d) || (d[k] is string && d[k].size() > 0 && d[k].size() <= 200);
    }
    function effectiveListId(d) {
      return d.get('listId', null);
    }

    function validTask(d) {
      return d.keys().hasAll(['title', 'completed', 'priority'])
        // hasOnly (nie tylko limit liczby pól!) - żadne inne pole nie może się
        // "podszyć" pod dozwolone, zajmując miejsce np. createdAt.
        && d.keys().hasOnly(['title', 'completed', 'priority', 'createdAt', 'listId', 'parentId'])
        && text(d.title, 300)
        && d.completed is bool
        && d.priority in ['low', 'medium', 'high']
        && optionalTimestamp(d, 'createdAt')
        && optionalRef(d, 'listId')
        && optionalRef(d, 'parentId');
    }

    // Zadanie z parentId musi realnie wskazywać na INNE, ISTNIEJĄCE zadanie z TEJ SAMEJ
    // listy, które samo NIE JEST podzadaniem – to wymusza w bazie (nie tylko w aplikacji)
    // maksymalnie jeden poziom zagnieżdżenia, tak jak w Google Tasks.
    function validParentRef(uid, id, d) {
      return !('parentId' in d) || (
        d.parentId != id
        && exists(/databases/$(database)/documents/users/$(uid)/tasks/$(d.parentId))
        && get(/databases/$(database)/documents/users/$(uid)/tasks/$(d.parentId)).data.get('parentId', null) == null
        && get(/databases/$(database)/documents/users/$(uid)/tasks/$(d.parentId)).data.get('listId', null) == effectiveListId(d)
      );
    }

    function validTaskList(d) {
      return d.keys().hasAll(['name'])
        && d.keys().hasOnly(['name', 'createdAt'])
        && text(d.name, 60)
        && optionalTimestamp(d, 'createdAt');
    }

    // Wydarzenie jest ALBO godzinowe (startTime/endTime, brak allDay/endDate/days),
    // ALBO całodniowe (allDay == true, endDate/days, brak startTime/endTime).
    // Wymuszamy to ściśle, żeby po przełączeniu trybu w aplikacji (setDoc, nie update)
    // w bazie nigdy nie zostały pola ze „starego” kształtu.
    function validEvent(d) {
      return d.keys().hasAll(['title', 'date', 'colorCode'])
        // hasOnly: dozwolony jest wyłącznie ten zestaw pól - żadnych podstawionych dodatkowych kluczy.
        && d.keys().hasOnly(['title', 'date', 'colorCode', 'allDay', 'startTime', 'endTime', 'endDate', 'days', 'description'])
        && text(d.title, 200)
        && optionalText(d, 'description', 2000)
        && d.date is string && d.date.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
        && d.colorCode is string && d.colorCode.matches('^#[0-9A-Fa-f]{6}$')
        && (
          (
            (!('allDay' in d) || d.allDay == false)
            && !('endDate' in d) && !('days' in d)
            && d.keys().hasAll(['startTime', 'endTime'])
            && d.startTime is string && d.startTime.matches('^([01][0-9]|2[0-3]):[0-5][0-9]$')
            && d.endTime is string && d.endTime.matches('^([01][0-9]|2[0-3]):[0-5][0-9]$')
          )
          ||
          (
            d.allDay == true
            && !('startTime' in d) && !('endTime' in d)
            && d.keys().hasAll(['endDate', 'days'])
            && d.endDate is string && d.endDate.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
            && d.endDate >= d.date
            && d.days is list && d.days.size() >= 1 && d.days.size() <= 60
          )
        );
    }

    function validCard(d) {
      return d.keys().hasAll(['subject', 'topic', 'subtopic', 'type', 'front', 'back', 'status'])
        // hasOnly: dozwolony jest wyłącznie ten zestaw pól - żadnych podstawionych dodatkowych kluczy.
        && d.keys().hasOnly(['subject', 'topic', 'subtopic', 'type', 'front', 'back', 'status', 'lastReviewed', 'createdAt'])
        && text(d.subject, 120) && text(d.topic, 120) && text(d.subtopic, 120)
        && d.type in ['standard', 'language']
        && text(d.front, 4000) && text(d.back, 4000)
        && d.status in ['new', 'hard', 'good', 'easy']
        && optionalTimestamp(d, 'lastReviewed')
        && optionalTimestamp(d, 'createdAt');
    }

    match /users/{uid}/tasks/{id} {
      allow read, delete: if isOwner(uid);
      allow create: if isOwner(uid) && validTask(request.resource.data) && validParentRef(uid, id, request.resource.data);
      // Update: pełne (kosztowne - get()) sprawdzenie rodzica tylko, gdy parentId
      // faktycznie się zmienia. Zwykłe odhaczenie/zmiana priorytetu/nazwy istniejącego
      // podzadania NIE jest wtedy blokowane, nawet gdyby rodzic zniknął w jakiś inny
      // sposób (np. ręczna edycja danych) – skasować taki "sierocy" wpis zawsze można
      // (allow delete wyżej), więc to nigdy nie jest ślepy zaułek dla użytkownika.
      allow update: if isOwner(uid) && validTask(request.resource.data)
        && (request.resource.data.get('parentId', null) == resource.data.get('parentId', null)
            || validParentRef(uid, id, request.resource.data));
    }
    match /users/{uid}/task_lists/{id} {
      allow read, delete: if isOwner(uid);
      allow create, update: if isOwner(uid) && validTaskList(request.resource.data);
    }
    match /users/{uid}/planner_events/{id} {
      allow read, delete: if isOwner(uid);
      allow create, update: if isOwner(uid) && validEvent(request.resource.data);
    }
    match /users/{uid}/flashcards/{id} {
      allow read, delete: if isOwner(uid);
      allow create, update: if isOwner(uid) && validCard(request.resource.data);
    }

    // ---------------------------------------------------- UDOSTĘPNIANIE FISZEK
    // Paczka fiszek do przekazania innemu kontu. Celowo NIE walidujemy tu treści
    // każdej fiszki tak surowo jak w validCard: prawdziwą bramką bezpieczeństwa jest
    // miejsce, w które dane faktycznie trafiają - własna kolekcja `flashcards`
    // odbiorcy - a ta ma już pełną walidację (hasOnly + limity długości) powyżej.
    // `shares` to tylko nieedytowalny, ograniczony rozmiarem "schowek" do jednorazowego
    // pobrania po znanym (niezgadywalnym) ID; nie da się go wylistować.
    function validShare(d) {
      return d.keys().hasAll(['ownerUid', 'createdAt', 'cards'])
        && d.keys().hasOnly(['ownerUid', 'createdAt', 'cards'])
        && d.ownerUid is string && d.ownerUid == request.auth.uid
        && d.createdAt is timestamp
        && d.cards is list && d.cards.size() >= 1 && d.cards.size() <= 100;
    }
    match /shares/{id} {
      allow get: if request.auth != null;
      allow list: if false;
      allow create: if request.auth != null && validShare(request.resource.data);
      allow update: if false; // udostępnienia są niezmienne - poprawka to nowy dokument
      allow delete: if request.auth != null && request.auth.uid == resource.data.ownerUid;
    }

    // Wskaźnik "to ja to udostępniłem/am" - żeby właściciel mógł zobaczyć listę
    // swoich udostępnień i je cofnąć (skasować dokument w `shares`), mimo że
    // `shares` samo w sobie nie da się przeglądać (allow list: false powyżej).
    function validSharePointer(d) {
      return d.keys().hasAll(['cardCount', 'createdAt'])
        && d.keys().hasOnly(['cardCount', 'createdAt', 'label'])
        && d.cardCount is int && d.cardCount >= 1 && d.cardCount <= 100
        && optionalTimestamp(d, 'createdAt')
        && optionalText(d, 'label', 200);
    }
    match /users/{uid}/shares_sent/{id} {
      allow read, delete: if isOwner(uid);
      allow create: if isOwner(uid) && validSharePointer(request.resource.data);
      allow update: if false;
    }
  }
}
```

**Ważne, jeśli aktualizujesz z poprzedniej wersji:** te reguły różnią się od poprzednich (dochodzą listy zadań, podzadania, opis wydarzenia i udostępnianie fiszek). Samo wgranie nowych plików aplikacji do repozytorium NIE wystarczy — musisz też wkleić powyższy blok w **Firestore Database → Rules** i kliknąć **Publish** (krok 5 raz jeszcze), inaczej nowe funkcje będą zgłaszać „Brak uprawnień do zapisu/odczytu”, bo baza dalej pilnuje starego kształtu danych.

Co te reguły robią:
- Zalogowany użytkownik widzi i zmienia wyłącznie swoje dane (`users/{jego-id}/...`). Niezalogowani i inni użytkownicy nie mają dostępu do niczego.
- Baza odrzuca dane w złym formacie (zły priorytet, godzina 25:00, pusty tytuł, za długi tekst, wydarzenie całodniowe dłuższe niż 60 dni, opis dłuższy niż 2000 znaków).
- Wydarzenie musi być *albo* godzinowe, *albo* całodniowe — nigdy oba naraz i nigdy żadne z nich niepełne. Opis jest zawsze opcjonalny.
- Podzadanie musi wskazywać na istniejące zadanie z tej samej listy, które samo nie jest podzadaniem — baza pilnuje jednego poziomu zagnieżdżenia, nie tylko aplikacja. Zwykła zmiana (np. odhaczenie) podzadania, którego rodzic zniknął, dalej działa — zablokowana jest tylko próba *ustawienia* nieprawidłowego rodzica.
- `hasOnly` pilnuje, żeby dokument nie miał żadnych dodatkowych, niespodziewanych pól — nie tylko ich liczby, ale i nazw.
- Udostępniona paczka fiszek (`shares/{id}`) jest niezmienna, ograniczona do 100 fiszek, nie da się jej wylistować (dostęp tylko po znanym ID) i tylko właściciel może ją skasować (cofnąć udostępnienie).
- Wszystko poza tymi kolekcjami (zadania, listy zadań, wydarzenia, fiszki, udostępnienia) jest zamknięte.

## Krok 6: Konfiguracja aplikacji

1. Kliknij kółko zębate obok „Project Overview” i wybierz **Project settings**, zakładka **General**.
2. Przewiń do **Your apps** i kliknij ikonę Web **`</>`**.
3. Nazwa: `Life OS`. **Nie zaznaczaj** „Firebase Hosting”. Kliknij **Register app**.
4. Zobaczysz blok `firebaseConfig` z wartościami `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`. To są dane do wklejenia. Kliknij **Continue to console**.

**Opcja A (polecana):** wklej te wartości Claude w rozmowie i poproś o „gotową paczkę z moją konfiguracją”. To nie są hasła. W aplikacjach webowych Firebase są jawne, chroni je logowanie i reguły z kroku 5. **Nigdy nie wklejaj swojego hasła do logowania.**

**Opcja B:** otwórz `firebase-config.js` w Notatniku i zamień każde `WKLEJ_TUTAJ` na wartość z konsoli. Zostaw cudzysłowy. Jeśli konsola nie pokazuje `storageBucket` lub `messagingSenderId`, zostaw w nich `WKLEJ_TUTAJ`, aplikacja z nich nie korzysta. Zapisz plik.

## Krok 7: Hosting na GitHub Pages

1. Wejdź na **github.com**, kliknij **Sign up** i załóż darmowe konto. Potwierdź e-mail.
2. Kliknij **New repository**. Nazwa: `life-os`. Widoczność: **Public**. Kliknij **Create repository**.
3. Na pustym repozytorium kliknij **uploading an existing file** (albo **Add file, Upload files**). Przeciągnij **wszystkie pliki** z rozpakowanego folderu. Nie wrzucaj samego ZIP-a i nie wrzucaj folderu nadrzędnego: pliki mają leżeć na samej górze repozytorium. Kliknij **Commit changes**.
4. Otwórz zakładkę **Settings** repozytorium, potem **Pages**. W sekcji **Build and deployment** ustaw **Source: Deploy from a branch**, **Branch: main**, folder **/ (root)** i kliknij **Save**.
5. Po 1 do 3 minutach na górze strony Pages pojawi się adres, zwykle `https://TWOJA-NAZWA.github.io/life-os/`. Otwórz go. Zobaczysz ekran logowania. Zaloguj się kontem z kroku 4.

**Nie otwieraj `index.html` dwuklikiem z dysku.** Aplikacja działa tylko z adresu `https://`. Po otwarciu z dysku pokaże komunikat z tą wskazówką.

Jeśli logowanie zgłosi `auth/unauthorized-domain`: w Firebase otwórz Authentication, Settings, **Authorized domains**, kliknij **Add domain** i wpisz `TWOJA-NAZWA.github.io`.

*Alternatywa: Vercel.* Plan Hobby jest darmowy, ale tylko do użytku osobistego i niekomercyjnego. Wejdź na vercel.com, zaloguj się przez GitHub, dodaj nowy projekt z repozytorium `life-os` i kliknij **Deploy** bez zmiany ustawień. Wybierz jedno rozwiązanie, GitHub Pages albo Vercel. Ekranów Vercela nie sprawdzałem w tej sesji.

## Krok 8: Instalacja na telefonie i komputerze

- **Android (Chrome):** menu ⋮, potem „Zainstaluj aplikację” (albo „Dodaj do ekranu głównego”).
- **Komputer (Chrome lub Edge):** ikona instalacji po prawej stronie paska adresu albo menu, „Zainstaluj Life OS”.
- **iPhone (tylko Safari):** „Udostępnij”, potem „Do ekranu początkowego”. Tego nie testowałem na prawdziwym iPhonie.

Loguj się tym samym kontem na każdym urządzeniu. Dane synchronizują się na żywo. Bez internetu aplikacja działa dalej, a zmiany wysyłają się po odzyskaniu sieci. Pierwsze uruchomienie wymaga internetu.

## Krok 9: Codzienne użycie

**Planer.** Dotknij osi czasu w miejscu godziny albo kliknij „Dodaj”. Formularz ma pole tytułu i osobne pole „Opis (opcjonalnie)” — opis mieści do 2000 znaków i pokazuje się pod tytułem zarówno w widoku dnia, jak i na pasku wydarzenia całodniowego (skrócony do dwóch linii). Dotknięcie wydarzenia otwiera edycję i usuwanie. Strzałki i data na dole zmieniają dzień. Czerwona linia to bieżąca godzina. Przełącznik „Dzień / Miesiąc” u góry pokazuje całą siatkę kalendarza — zamiast samej kropki przy dniu widać teraz **tytuł wydarzenia**, podświetlony kolorem, jaki mu nadałeś (do trzech na dzień, reszta jako „+N więcej”); dotknięcie dnia otwiera go w widoku dnia. W formularzu wydarzenia przełącznik „Godzinowe / Całodniowe” pozwala dodać wydarzenie trwające kilka dni (np. rejs) — pokazuje się wtedy jako osobny pasek nad osią czasu w widoku dnia, na każdym dniu, który obejmuje.

**Zadania.** Pole na dole ekranu. Kolorowa etykieta obok pola ustawia priorytet nowego zadania, a dotknięcie etykiety przy zadaniu zmienia jego priorytet. Usuwanie ma przycisk „Cofnij” (kasuje też podzadania danego zadania). Przycisk z nazwą listy u góry (np. „Zadania ▾”) otwiera przełącznik list — wzorem Kalendarza/Zadań Google możesz tworzyć zupełnie osobne, niezależne listy (np. „Dom”, „Statek”, „Stachu — szkoła”), przełączać się między nimi, zmieniać nazwę i kasować całą listę razem z jej zadaniami (też z „Cofnij”). Aplikacja pamięta, na której liście byłeś, nawet po zamknięciu. Każde zadanie może mieć podzadania — przycisk „+” przy zadaniu otwiera mały formularz dodania podzadania; wspierany jest tylko jeden poziom zagnieżdżenia (tak jak w Google Tasks — podzadania nie mają własnych podzadań). „Usuń ukończone” działa tylko na aktualnie otwartej liście, nie rusza pozostałych.

**Fiszki.** Przycisk „Importuj z AI” otwiera okno, w którym jest przycisk „Kopiuj prompt dla Claude”. Wklejasz prompt do rozmowy z Claude, uzupełniasz pola w `[[ ]]`, a odpowiedź wklejasz z powrotem. Aplikacja sprawdza dane na bieżąco. Jeśli w JSON-ie jest błąd, nic się nie zapisuje i widzisz, co poprawić. **Sprawdzaj treść fiszek przed importem**: AI potrafi podać z przekonaniem błędną liczbę albo numer przepisu.

**Udostępnianie fiszek.** W widoku fiszek, wewnątrz dowolnego przedmiotu/tematu/zagadnienia, przycisk „Udostępnij” tworzy link i pokazuje go do skopiowania. To jest **jednorazowa kopia, nie żywa synchronizacja** — druga osoba (np. Stachu, na swoim koncie) otwiera link, loguje się na swoje konto i widzi podgląd paczki z przyciskiem „Dodaj do moich fiszek”; od tej chwili to już jej własne, niezależne fiszki (Twoje dalsze zmiany się tam nie pojawią, i odwrotnie). Limit to 100 fiszek na jedno udostępnienie — przy większym dziale podziel je i udostępnij węższy zakres (np. jedno zagadnienie zamiast całego przedmiotu). Link nie wygasa sam, ale w „Ikona konta → Moje udostępnienia fiszek” widzisz listę wszystkiego, co udostępniłeś, i możesz cofnąć dowolne udostępnienie w każdej chwili — po cofnięciu link przestaje działać (osoby, które już zaimportowały paczkę wcześniej, zachowują swoją kopię).

**Nauka.** Dotknij fiszki albo „Pokaż odpowiedź”. Po obrocie oceń: Trudne (wraca jeszcze dziś, także w tej sesji), Dobre (za 3 dni), Łatwe (za 7 dni). Na klawiaturze: Spacja lub Enter obraca, klawisze 1, 2, 3 oceniają.

**Kopia zapasowa.** Ikona konta, „Pobierz kopię zapasową”. Rób to raz w miesiącu i trzymaj plik u siebie (nie w GitHubie). Tablicę `fiszki` z pliku możesz wkleić do „Importuj z AI”, żeby odtworzyć fiszki (status nauki się wtedy zeruje). Zadań i wydarzeń z pliku aplikacja sama nie odtwarza.

**Limity darmowego planu** (dokumentacja Firestore): 1 GiB danych, 50 000 odczytów, 20 000 zapisów i 20 000 usunięć dziennie, 10 GiB transferu miesięcznie. Dla użytku osobistego to duży zapas. Limity dzienne zerują się o północy czasu pacyficznego, czyli u nas około 9:00 rano. Na planie Spark bez karty nic Ci nie naliczą, a po przekroczeniu limitu zapisy czekają do resetu.

**Aktualizacja aplikacji.** Gdy dostaniesz nową paczkę, w repozytorium kliknij **Add file, Upload files**, przeciągnij pliki (nadpiszą stare) i kliknij **Commit changes**. Odczekaj 1 do 3 minut. Nowa wersja pojawi się przy **drugim** otwarciu aplikacji, bo pierwsze otwarcie pobiera ją w tle. **Jeśli paczka zawiera nowy `firestore.rules`** (tak jak ta) — a poznasz to po tym, że w informacji o zmianach jest o tym mowa — wklej go też w Firebase, **Firestore Database → Rules → Publish** (krok 5). Same pliki na GitHubie nowych reguł nie publikują; bez tego kroku nowe funkcje będą zgłaszać błąd braku uprawnień.

## Krok 10: Problemy

| Co widzisz | Przyczyna | Co zrobić |
|---|---|---|
| „Brakuje konfiguracji Firebase” | `firebase-config.js` nie jest uzupełniony albo nie został wgrany | krok 6, potem wgraj plik ponownie do repozytorium |
| „Nieprawidłowy e-mail lub hasło” | zła dana albo konto nie istnieje | Firebase, Authentication, Users: czy konto jest na liście. Na ekranie logowania jest „Nie pamiętam hasła” |
| „Logowanie e-mailem i hasłem nie jest włączone” | pominięty krok 4 | krok 4, punkt 2 |
| „Brak uprawnień do zapisu/odczytu” | reguły niewklejone albo nieopublikowane, albo baza ma inną nazwę niż `(default)` | krok 5 (**Publish**) i krok 3 |
| `auth/unauthorized-domain` | domena strony nie jest na liście Firebase | krok 7, akapit o Authorized domains |
| Biała strona albo „Nie udało się uruchomić aplikacji” | brak internetu przy pierwszym wejściu albo otwarcie z dysku | otwórz adres https i odśwież |
| Po aktualizacji widać starą wersję nawet po kilku otwarciach | przeglądarka trzyma starą kopię aplikacji w tzw. Service Workerze | **Komputer (Chrome/Edge):** F12, zakładka „Application” (albo „Aplikacja”), po lewej „Service Workers”, kliknij „Unregister”, potem odśwież stronę na twardo (Ctrl+Shift+R, na Macu Cmd+Shift+R). **Telefon:** w Chrome menu ⋮ → Historia → Wyczyść dane przeglądania → zaznacz tylko „Obrazy i pliki w pamięci podręcznej” → Wyczyść dane, potem otwórz aplikację ponownie. Zainstalowaną aplikację (ikona na ekranie głównym) czasem trzeba odinstalować i zainstalować od nowa. |
| „Przekroczono dzienny limit” | dzienny limit Firestore | poczekaj do resetu (ok. 9:00 rano) |

---

## Prompt do generowania fiszek

Ten sam tekst jest pod przyciskiem „Kopiuj prompt dla Claude” w aplikacji.

````text
Jesteś autorem fiszek do nauki. Przygotuj fiszki jako dane do importu do mojej aplikacji.

PRZEDMIOT: [[np. Prawo morskie]]
TEMAT: [[np. Konwencja MARPOL]]
ZAGADNIENIE: [[np. Załącznik I, zanieczyszczenie olejem]]
LICZBA FISZEK: [[np. 20]]
POZIOM: [[np. egzamin zawodowy / liceum / rozszerzony]]
TYP: [[standard albo language]]
JĘZYK OBCY (tylko dla language): [[np. angielski]]
MATERIAŁ (opcjonalnie): [[wklej notatki; jeśli puste, użyj własnej wiedzy]]

ZASADY:
1. Odpowiedz WYŁĄCZNIE jedną tablicą JSON w jednym bloku kodu ```json. Żadnego tekstu przed ani po.
2. Każda fiszka to obiekt z polami: "subject", "topic", "subtopic", "type", "front", "back". Wszystkie są tekstowe i wszystkie wymagane.
3. "subject", "topic" i "subtopic" mają być identyczne we wszystkich fiszkach tej paczki (te same znaki, ta sama wielkość liter), zgodnie z moimi danymi powyżej. Maks. 120 znaków każde.
4. "type": "standard" (front = pytanie, back = odpowiedź) albo "language" (front = słowo lub zdanie po polsku, back = tłumaczenie na język obcy).
5. Jedna fiszka = jeden fakt. Front krótki i jednoznaczny. Back zwięzły (najlepiej do 300 znaków, twardy limit 4000). Nową linię w polu zapisz jako \n.
6. Poprawny JSON: cudzysłów wewnątrz tekstu jako \", bez przecinka po ostatnim elemencie, bez komentarzy.
7. Bez duplikatów: ten sam "front" nie może wystąpić dwa razy w jednym zagadnieniu.
8. Maksymalnie 1000 fiszek w odpowiedzi.
9. Nie zgaduj. Jeśli nie jesteś pewien liczby, daty, wartości granicznej albo numeru przepisu, pomiń tę fiszkę.
10. Jeśli brakuje mi przedmiotu, tematu, zagadnienia albo języka obcego, zapytaj mnie zamiast wymyślać.

FORMAT ODPOWIEDZI:
```json
[
  {
    "subject": "Prawo morskie",
    "topic": "MARPOL",
    "subtopic": "Załącznik I",
    "type": "standard",
    "front": "Co reguluje Załącznik I MARPOL?",
    "back": "Zapobieganie zanieczyszczeniu olejem."
  }
]
```
````

---

## Co zostało sprawdzone, a co nie

**Sprawdzone automatycznie** (przeglądarka Chromium, emulatory Firebase):
- 27 scenariuszy end-to-end przeszło: logowanie (dobre i złe hasło), planer (oś czasu, linia „teraz”, nakładające się wydarzenia, edycja, usuwanie, „Cofnij”), zadania, fiszki (hierarchia, import poprawny i błędny, duplikaty), tryb nauki z obrotem 3D i zapisem ocen, motyw jasny i ciemny, kopia zapasowa, synchronizacja między dwoma urządzeniami na żywo, zapis bez sieci, start bez internetu, instalowalność PWA, odporność na wstrzyknięcie kodu w tytułach.
- 19 testów reguł bezpieczeństwa przeszło (dostęp właściciela; odmowa dla obcych i niezalogowanych; odrzucanie złych danych).
- 32 testy logiki (daty i zmiana czasu, układ osi czasu, parser importu).
- Test dostępności axe (WCAG 2.1 A i AA): brak naruszeń w jasnym i ciemnym motywie na wszystkich widokach.

**Aktualizacja — widok miesiąca i wydarzenia wielodniowe:**
- 41 testów logiki (poprzednie + nowe: zakres dat, siatka kalendarza, dopasowanie dnia do wydarzenia, walidacja obu kształtów wydarzenia).
- 37 testów reguł bezpieczeństwa (poprzednie 19, przeliczone pod nowy kształt danych, + 18 nowych dla wydarzeń całodniowych/wielodniowych). Przy tej okazji reguły zostały dokręcone: limit liczby pól sam w sobie pozwalał podstawić 1–2 nieznane pola w miejsce opcjonalnych — teraz reguły sprawdzają dokładny zestaw dozwolonych nazw pól (`hasOnly`), nie tylko ich liczbę.
- 27 nowych scenariuszy end-to-end dla widoku miesiąca i wydarzeń wielodniowych: przełączanie dzień/miesiąc, nawigacja między miesiącami i powrót do bieżącego, dodanie wydarzenia całodniowego rozciągniętego na kilka dni, widoczność jako kropka na każdym objętym dniu siatki, przejście z siatki do widoku dnia, edycja z zamianą godzinowe ⇄ całodniowe (i odwrotnie) bez pozostawiania „starych” pól w bazie, usunięcie. Test dostępności axe powtórzony dla nowego widoku i formularza z przełącznikiem — przy okazji wykryto i poprawiono jeden realny błąd kontrastu (przygaszone dni spoza miesiąca w siatce), zanim trafił na Twój telefon.

**Aktualizacja — opis wydarzenia, tytuły w widoku miesiąca, listy zadań, podzadania, udostępnianie fiszek:**
- 67 testów logiki (41 poprzednich, bez zmian + 26 nowych): opis wydarzenia w obu kształtach wydarzenia, nazwa listy zadań, filtrowanie zadań po liście, budowa drzewa zadanie→podzadania (w tym „osierocone” podzadanie, które nigdy nie znika, tylko wraca na najwyższy poziom, i poprawna kolejność sortowania), przygotowanie i limit rozmiaru paczki do udostępnienia.
- 82 testy reguł bezpieczeństwa (poprzednie 37 + 45 nowych): opis wydarzenia, `listId`/`parentId` zadania, w tym cała logika `validParentRef` — odrzucenie zadania wskazującego samo siebie, nieistniejącego rodzica, rodzica z innej listy i drugiego poziomu zagnieżdżenia — oraz jawnie sprawdzony przypadek "osieroconego" podzadania: zwykła aktualizacja (np. odhaczenie) dalej działa, ale próba nadania mu nowego, złego rodzica jest blokowana; nowa kolekcja list zadań; kolekcja `shares` (limit 100 fiszek, brak możliwości wylistowania, kasowanie tylko przez właściciela) i `shares_sent`.
- 40 testów end-to-end (poprzednie 27, doszły: listy zadań — tworzenie, przełączanie, izolacja danych między listami, zmiana nazwy, kasowanie z kasowaniem zadań; podzadania — dodanie, zagnieżdżenie, brak podwójnego zagnieżdżenia, kasowanie razem z rodzicem; opis wydarzenia — dodanie, wyświetlanie, wypełnienie przy edycji; tytuły w widoku miesiąca zamiast kropek; **prawdziwe udostępnienie fiszek między dwoma kontami** na emulatorze (konto A tworzy i udostępnia, konto B loguje się z linku, widzi podgląd, importuje, fiszka pojawia się u B; konto A cofa udostępnienie i ten sam link przestaje działać). Dwa wcześniejsze wyniki axe okazały się fałszywymi alarmami spowodowanymi animacją otwierania okna w trakcie skanu (nie błędem aplikacji) — potwierdzone powtórnymi przebiegami; poprawiony został sam test (dodane odczekanie na koniec animacji), nie aplikacja.
- Zanim jakikolwiek test w ogóle poszedł, przy pisaniu reguł i kodu wyłapałem i poprawiłem sam dwie rzeczy, które inaczej byłyby realnymi błędami: (1) reguła dla podzadań pierwotnie sprawdzałaby rodzica przy KAŻDEJ aktualizacji, co zablokowałoby na stałe odznaczanie ukończenia „osieroconego” podzadania — poprawione tak, by pełne sprawdzenie uruchamiało się tylko przy realnej zmianie rodzica; (2) „Usuń ukończone” działało globalnie na wszystkich zadaniach, więc po wprowadzeniu wielu list kasowałoby ukończone zadania też z list, których akurat nie oglądasz — poprawione, żeby działało tylko na aktualnie otwartej liście.

**Niesprawdzone:**
- Prawdziwy projekt Firebase. Testy szły na emulatorze. Pierwsze logowanie na Twoim projekcie to pierwszy test z prawdziwą chmurą.
- iPhone i Safari, Firefox.
- Prawdziwy GitHub Pages i wysyłka e-maila z resetem hasła.
- Czytnik ekranu (sprawdziłem tylko automatem i klawiaturą).
- Wydarzenie całodniowe trwające dokładnie na granicy 60 dni na żywym, nie-emulowanym Firestore (logika jest przetestowana, ale nie na prawdziwej bazie).
- Udostępnianie fiszek między dwoma PRAWDZIWYMI kontami na Twoim rzeczywistym projekcie Firebase (testowałem na emulatorze z dwoma kontami testowymi — mechanizm jest ten sam, ale to nie jest to samo co Twój żywy projekt).

**Ograniczenia:** brak powiadomień push. Styl Tailwind ładuje się z internetu (wymóg specyfikacji), więc pierwsze uruchomienie wymaga sieci. Kolor paska stanu na iPhonie nie zmienia się razem z motywem. Widok miesiąca dociąga dane maksymalnie 60 dni wstecz od pierwszego dnia siatki (żeby złapać wydarzenia wielodniowe zaczęte wcześniej) — to więcej odczytów niż w widoku dnia, ale wciąż daleko poniżej darmowego limitu przy normalnym użyciu. Udostępnianie fiszek to **jednorazowa kopia, nie żywa synchronizacja** — po imporcie odbiorca ma niezależną kopię, dalsze zmiany w żadną stronę się nie przenoszą; limit to 100 fiszek na jedno udostępnienie (to techniczny limit rozmiaru pojedynczego dokumentu w Firestore, 1 MiB); udostępnienia nie wygasają same z czasem, ale można je cofnąć ręcznie w każdej chwili. Podzadania wspierają tylko jeden poziom zagnieżdżenia (jak w Google Tasks) — podzadanie nie może mieć własnego podzadania.
