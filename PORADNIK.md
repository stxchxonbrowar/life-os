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

    function validTask(d) {
      return d.keys().hasAll(['title', 'completed', 'priority'])
        // hasOnly (nie tylko limit liczby pól!) - żadne inne pole nie może się
        // "podszyć" pod dozwolone, zajmując miejsce np. createdAt.
        && d.keys().hasOnly(['title', 'completed', 'priority', 'createdAt'])
        && text(d.title, 300)
        && d.completed is bool
        && d.priority in ['low', 'medium', 'high']
        && optionalTimestamp(d, 'createdAt');
    }

    // Wydarzenie jest ALBO godzinowe (startTime/endTime, brak allDay/endDate/days),
    // ALBO całodniowe (allDay == true, endDate/days, brak startTime/endTime).
    // Wymuszamy to ściśle, żeby po przełączeniu trybu w aplikacji (setDoc, nie update)
    // w bazie nigdy nie zostały pola ze „starego” kształtu.
    function validEvent(d) {
      return d.keys().hasAll(['title', 'date', 'colorCode'])
        // hasOnly: dozwolony jest wyłącznie ten zestaw pól - żadnych podstawionych dodatkowych kluczy.
        && d.keys().hasOnly(['title', 'date', 'colorCode', 'allDay', 'startTime', 'endTime', 'endDate', 'days'])
        && text(d.title, 200)
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
      allow create, update: if isOwner(uid) && validTask(request.resource.data);
    }
    match /users/{uid}/planner_events/{id} {
      allow read, delete: if isOwner(uid);
      allow create, update: if isOwner(uid) && validEvent(request.resource.data);
    }
    match /users/{uid}/flashcards/{id} {
      allow read, delete: if isOwner(uid);
      allow create, update: if isOwner(uid) && validCard(request.resource.data);
    }
  }
}
```

Co te reguły robią:
- Zalogowany użytkownik widzi i zmienia wyłącznie swoje dane (`users/{jego-id}/...`). Niezalogowani i inni użytkownicy nie mają dostępu do niczego.
- Baza odrzuca dane w złym formacie (zły priorytet, godzina 25:00, pusty tytuł, za długi tekst, wydarzenie całodniowe dłuższe niż 60 dni).
- Wydarzenie musi być *albo* godzinowe, *albo* całodniowe — nigdy oba naraz i nigdy żadne z nich niepełne.
- `hasOnly` pilnuje, żeby dokument nie miał żadnych dodatkowych, niespodziewanych pól — nie tylko ich liczby, ale i nazw.
- Wszystko poza trzema kolekcjami (zadania, wydarzenia, fiszki) jest zamknięte.

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

**Planer.** Dotknij osi czasu w miejscu godziny albo kliknij „Dodaj”. Dotknięcie wydarzenia otwiera edycję i usuwanie. Strzałki i data na dole zmieniają dzień. Czerwona linia to bieżąca godzina. Przełącznik „Dzień / Miesiąc” u góry pokazuje całą siatkę kalendarza — kropki przy numerze dnia to liczba wydarzeń, dotknięcie dnia otwiera go w widoku dnia. W formularzu wydarzenia przełącznik „Godzinowe / Całodniowe” pozwala dodać wydarzenie trwające kilka dni (np. rejs) — pokazuje się wtedy jako osobny pasek nad osią czasu w widoku dnia, na każdym dniu, który obejmuje.

**Zadania.** Pole na dole ekranu. Kolorowa etykieta obok pola ustawia priorytet nowego zadania, a dotknięcie etykiety przy zadaniu zmienia jego priorytet. Usuwanie ma przycisk „Cofnij”.

**Fiszki.** Przycisk „Importuj z AI” otwiera okno, w którym jest przycisk „Kopiuj prompt dla Claude”. Wklejasz prompt do rozmowy z Claude, uzupełniasz pola w `[[ ]]`, a odpowiedź wklejasz z powrotem. Aplikacja sprawdza dane na bieżąco. Jeśli w JSON-ie jest błąd, nic się nie zapisuje i widzisz, co poprawić. **Sprawdzaj treść fiszek przed importem**: AI potrafi podać z przekonaniem błędną liczbę albo numer przepisu.

**Nauka.** Dotknij fiszki albo „Pokaż odpowiedź”. Po obrocie oceń: Trudne (wraca jeszcze dziś, także w tej sesji), Dobre (za 3 dni), Łatwe (za 7 dni). Na klawiaturze: Spacja lub Enter obraca, klawisze 1, 2, 3 oceniają.

**Kopia zapasowa.** Ikona konta, „Pobierz kopię zapasową”. Rób to raz w miesiącu i trzymaj plik u siebie (nie w GitHubie). Tablicę `fiszki` z pliku możesz wkleić do „Importuj z AI”, żeby odtworzyć fiszki (status nauki się wtedy zeruje). Zadań i wydarzeń z pliku aplikacja sama nie odtwarza.

**Limity darmowego planu** (dokumentacja Firestore): 1 GiB danych, 50 000 odczytów, 20 000 zapisów i 20 000 usunięć dziennie, 10 GiB transferu miesięcznie. Dla użytku osobistego to duży zapas. Limity dzienne zerują się o północy czasu pacyficznego, czyli u nas około 9:00 rano. Na planie Spark bez karty nic Ci nie naliczą, a po przekroczeniu limitu zapisy czekają do resetu.

**Aktualizacja aplikacji.** Gdy dostaniesz nową paczkę, w repozytorium kliknij **Add file, Upload files**, przeciągnij pliki (nadpiszą stare) i kliknij **Commit changes**. Odczekaj 1 do 3 minut. Nowa wersja pojawi się przy **drugim** otwarciu aplikacji, bo pierwsze otwarcie pobiera ją w tle.

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

**Niesprawdzone:**
- Prawdziwy projekt Firebase. Testy szły na emulatorze. Pierwsze logowanie na Twoim projekcie to pierwszy test z prawdziwą chmurą.
- iPhone i Safari, Firefox.
- Prawdziwy GitHub Pages i wysyłka e-maila z resetem hasła.
- Czytnik ekranu (sprawdziłem tylko automatem i klawiaturą).
- Wydarzenie całodniowe trwające dokładnie na granicy 60 dni na żywym, nie-emulowanym Firestore (logika jest przetestowana, ale nie na prawdziwej bazie).

**Ograniczenia:** brak powiadomień push. Styl Tailwind ładuje się z internetu (wymóg specyfikacji), więc pierwsze uruchomienie wymaga sieci. Kolor paska stanu na iPhonie nie zmienia się razem z motywem. Widok miesiąca dociąga dane maksymalnie 60 dni wstecz od pierwszego dnia siatki (żeby złapać wydarzenia wielodniowe zaczęte wcześniej) — to więcej odczytów niż w widoku dnia, ale wciąż daleko poniżej darmowego limitu przy normalnym użyciu.
