/* ============================================================================
 * Personal Life OS – logic.js
 * ----------------------------------------------------------------------------
 * CZYSTA LOGIKA: bez Firebase i bez DOM-u.
 * Dzięki temu da się ją testować automatycznie (Node), a app.js zostaje cienką
 * warstwą interfejsu + bazy danych. Tego pliku NIE musisz edytować.
 * ========================================================================== */

// ---------------------------------------------------------------- STAŁE ------
export const DAY_START_MIN = 6 * 60;          // 06:00 – początek osi czasu
export const DAY_END_MIN = 24 * 60 - 1;       // 23:59 – koniec osi czasu
export const LAST_START_MIN = 23 * 60 + 45;   // najpóźniejszy start klikniętego wydarzenia
export const MAX_IMPORT = 1000;               // maks. liczba fiszek w jednym imporcie
export const MAX_ALLDAY_SPAN_DAYS = 60;       // maks. długość wydarzenia całodniowego (dni)
export const MAX_EVENT_DESC = 2000;           // maks. długość opisu wydarzenia
export const MAX_LIST_NAME = 60;              // maks. długość nazwy listy zadań
export const MAX_SHARE_CARDS = 100;           // maks. liczba fiszek w jednej paczce do udostępnienia
export const MAX_BROWSE_SHOWN = 200;          // maks. liczba fiszek pokazywanych naraz na liście do przeglądania
export const WEEKDAY_LABELS_PL = ['pon', 'wt', 'śr', 'czw', 'pt', 'sob', 'niedz'];

export const PRIORITIES = ['low', 'medium', 'high'];
export const PRIORITY_LABEL = { low: 'Niski', medium: 'Średni', high: 'Wysoki' };
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

export const CARD_TYPES = ['standard', 'language'];
export const RATINGS = ['hard', 'good', 'easy'];
export const RATING_LABEL = { hard: 'Trudne', good: 'Dobre', easy: 'Łatwe' };
export const STATUS_LABEL = { new: 'Nowa', hard: 'Trudna', good: 'Dobra', easy: 'Łatwa' };

// Po ilu dniach fiszka wraca do powtórki (0 = zawsze „do powtórki”).
export const INTERVAL_DAYS = { new: 0, hard: 0, good: 3, easy: 7 };
export const INTERVAL_HINT = { hard: 'jeszcze dziś', good: 'za 3 dni', easy: 'za 7 dni' };

export const EVENT_COLORS = [
  { name: 'Niebieski', hex: '#0A84FF' },
  { name: 'Fioletowy', hex: '#8B6DFF' },
  { name: 'Różowy', hex: '#FF4FA3' },
  { name: 'Czerwony', hex: '#FF453A' },
  { name: 'Pomarańczowy', hex: '#FF9F0A' },
  { name: 'Żółty', hex: '#FFD60A' },
  { name: 'Zielony', hex: '#30D158' },
  { name: 'Turkusowy', hex: '#40C8E0' },
];
export const DEFAULT_EVENT_COLOR = EVENT_COLORS[0].hex;

// --------------------------------------------------------------- TEKST -------
/** Zamienia znaki specjalne HTML – każdy tekst użytkownika MUSI przez to przejść. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

/** Polska odmiana liczebnika: plural(5, ['fiszka','fiszki','fiszek']) → "5 fiszek". */
export function plural(n, [one, few, many]) {
  const abs = Math.abs(n);
  const last = abs % 10;
  const lastTwo = abs % 100;
  let word = many;
  if (abs === 1) word = one;
  else if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) word = few;
  return `${n} ${word}`;
}

export const capitalize = (s) => (s ? s.charAt(0).toLocaleUpperCase('pl') + s.slice(1) : s);

/** Kolor z bazy może być tylko #RRGGBB – inaczej wracamy do domyślnego (bezpieczeństwo CSS). */
export function safeColor(hex) {
  return /^#[0-9a-fA-F]{6}$/.test(hex || '') ? hex : DEFAULT_EVENT_COLOR;
}

// ---------------------------------------------------------- CZAS I DATY ------
export const pad2 = (n) => String(n).padStart(2, '0');

/** "14:30" → 870. Zwraca NaN dla niepoprawnego zapisu. */
export function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return NaN;
  return h * 60 + min;
}

/** 870 → "14:30" */
export function toHHMM(totalMin) {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(totalMin)));
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/**
 * Data lokalna jako "RRRR-MM-DD".
 * UWAGA: celowo NIE używamy toISOString() – zwraca datę UTC i tuż po północy
 * w Polsce pokazałoby „wczoraj”.
 */
export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** "2026-09-20" → Date (południe lokalnie, żeby zmiana czasu nie przesunęła dnia). */
export function parseDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d, 12, 0, 0);
  const valid = date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
  return valid ? date : null;
}

export function shiftDateKey(key, days) {
  const d = parseDateKey(key);
  if (!d) return dateKey();
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

/**
 * Lista kluczy dat od startKey do endKey włącznie (np. ["2026-09-12","2026-09-13"]).
 * Zwraca null, jeśli któraś z dat jest niepoprawna albo endKey < startKey.
 * Używane do zapisu pola `days` wydarzenia całodniowego (szybkie wyszukiwanie
 * „co się dzieje dzisiaj” przez array-contains, bez indeksu złożonego).
 */
export function expandDays(startKey, endKey) {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey || startKey);
  if (!start || !end || end < start) return null;
  const days = [];
  const cur = new Date(start);
  let guard = 0;
  while (cur <= end && guard < 3660) { // zabezpieczenie: maks. ~10 lat, na wszelki wypadek
    days.push(dateKey(cur));
    cur.setDate(cur.getDate() + 1);
    guard += 1;
  }
  return days;
}

export function formatDateLong(key) {
  const d = parseDateKey(key);
  if (!d) return '';
  return capitalize(new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }).format(d));
}

export function formatDateShort(key) {
  const d = parseDateKey(key);
  return d ? new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long' }).format(d) : '';
}

export function nowMinutes(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

// -------------------------------------------------------- WIDOK MIESIĄCA -----
export function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** "2026-09" + delta miesięcy → "2026-10" / "2026-08" itd. (przechodzi przez granice roku). */
export function shiftMonthKey(key, delta) {
  const m = /^(\d{4})-(\d{2})$/.exec(key || '');
  if (!m) return monthKey();
  const d = new Date(Number(m[1]), Number(m[2]) - 1 + delta, 1, 12, 0, 0);
  return monthKey(d);
}

/** "2026-09" → "Wrzesień 2026" */
export function monthLabel(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(key || '');
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1, 12, 0, 0);
  return capitalize(new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' }).format(d));
}

/**
 * Siatka kalendarza dla miesiąca "RRRR-MM": tablica tygodni (poniedziałek–niedziela),
 * każdy tydzień to 7 obiektów { key, day, inMonth, isToday }. Dni z sąsiednich
 * miesięcy (dopełnienie do pełnych tygodni) mają inMonth: false.
 */
export function monthGrid(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(key || '');
  if (!m) return [];
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const first = new Date(year, month, 1, 12, 0, 0);
  const last = new Date(year, month + 1, 0, 12, 0, 0);
  const mondayIndex = (d) => (d.getDay() + 6) % 7; // pon=0 … niedz=6 (JS: niedz=0 … sob=6)

  const start = new Date(first);
  start.setDate(start.getDate() - mondayIndex(first));
  const end = new Date(last);
  end.setDate(end.getDate() + (6 - mondayIndex(last)));

  const todayKey = dateKey();
  const weeks = [];
  let week = [];
  const cur = new Date(start);
  while (cur <= end) {
    const k = dateKey(cur);
    week.push({ key: k, day: cur.getDate(), inMonth: cur.getMonth() === month, isToday: k === todayKey });
    if (week.length === 7) { weeks.push(week); week = []; }
    cur.setDate(cur.getDate() + 1);
  }
  return weeks;
}

// ------------------------------------------------------------ OŚ CZASU -------
export const minutesToPx = (min, hourPx) => ((min - DAY_START_MIN) * hourPx) / 60;

/** Piksele od góry siatki → minuty doby, zaokrąglone w dół do `snap` minut. */
export function pxToMinutes(px, hourPx, snap = 15) {
  const raw = DAY_START_MIN + (px / hourPx) * 60;
  const snapped = Math.floor(raw / snap) * snap;
  return Math.max(DAY_START_MIN, Math.min(snapped, LAST_START_MIN));
}

/**
 * Walidacja formularza wydarzenia — godzinowego albo całodniowego (allDay: true).
 * Zwraca komunikat błędu albo null.
 */
export function validateEvent({ title, date, allDay, startTime, endTime, endDate, description }) {
  if (!String(title ?? '').trim()) return 'Wpisz nazwę wydarzenia.';
  if (String(description ?? '').length > MAX_EVENT_DESC) return `Opis może mieć maksymalnie ${MAX_EVENT_DESC} znaków.`;
  if (!parseDateKey(date)) return 'Wybierz datę wydarzenia.';

  if (allDay) {
    const end = endDate || date;
    if (!parseDateKey(end)) return 'Wybierz datę zakończenia.';
    if (end < date) return 'Data zakończenia nie może być wcześniejsza niż data rozpoczęcia.';
    const span = expandDays(date, end);
    if (!span) return 'Nieprawidłowy zakres dat.';
    if (span.length > MAX_ALLDAY_SPAN_DAYS) {
      return `Wydarzenie całodniowe może trwać maksymalnie ${MAX_ALLDAY_SPAN_DAYS} dni – skróć zakres.`;
    }
    return null;
  }

  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (Number.isNaN(start)) return 'Podaj godzinę rozpoczęcia.';
  if (Number.isNaN(end)) return 'Podaj godzinę zakończenia.';
  if (start < DAY_START_MIN) return 'Planer zaczyna się o 06:00. Wybierz późniejszą godzinę rozpoczęcia.';
  if (end <= start) return 'Koniec musi być później niż początek.';
  return null;
}

/** Czy wydarzenie (godzinowe albo całodniowe) obejmuje dany dzień ("RRRR-MM-DD")? */
export function eventTouchesDay(ev, key) {
  if (!ev) return false;
  if (ev.allDay) {
    if (Array.isArray(ev.days)) return ev.days.includes(key);
    return key >= ev.date && key <= (ev.endDate || ev.date);
  }
  return ev.date === key;
}

/** Krótki, czytelny zakres dat np. do banera wydarzenia całodniowego. */
export function formatDateRangeShort(startKey, endKey) {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey || startKey);
  if (!start) return '';
  if (!end || dateKey(start) === dateKey(end)) return formatDateShort(startKey);
  const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
  if (sameMonth) {
    const monthLbl = new Intl.DateTimeFormat('pl-PL', { month: 'long' }).format(end);
    return `${start.getDate()}–${end.getDate()} ${monthLbl}`;
  }
  const startLbl = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short' }).format(start);
  const endLbl = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short' }).format(end);
  return `${startLbl} – ${endLbl}`;
}

/**
 * Układ wydarzeń na osi czasu. Wydarzenia, które nakładają się w czasie,
 * dostają osobne kolumny (col / cols), żeby nie leżały jedno na drugim.
 * Zwraca kopie z polami: startMin, endMin, col, cols.
 */
export function layoutEvents(events) {
  const items = [];
  for (const ev of events) {
    let start = toMinutes(ev.startTime);
    let end = toMinutes(ev.endTime);
    if (!Number.isFinite(start)) continue;
    if (!Number.isFinite(end) || end <= start) end = start + 30;
    start = Math.max(start, DAY_START_MIN);
    end = Math.min(end, 24 * 60);
    if (end <= start) continue;
    items.push({ ...ev, startMin: start, endMin: end });
  }
  items.sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const result = [];
  let cluster = [];
  let columnEnds = [];
  let clusterEnd = -1;
  const flush = () => {
    cluster.forEach((ev) => { ev.cols = columnEnds.length; });
    result.push(...cluster);
    cluster = [];
    columnEnds = [];
    clusterEnd = -1;
  };
  for (const ev of items) {
    if (cluster.length && ev.startMin >= clusterEnd) flush();
    let col = columnEnds.findIndex((endMin) => endMin <= ev.startMin);
    if (col === -1) { col = columnEnds.length; columnEnds.push(ev.endMin); } else { columnEnds[col] = ev.endMin; }
    ev.col = col;
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, ev.endMin);
  }
  if (cluster.length) flush();
  return result;
}

// -------------------------------------------------------------- ZADANIA ------
/**
 * Ręczna kolejność (pole `order`) decyduje TYLKO między dwoma zadaniami OTWARTYMI –
 * ukończone i tak lądują na końcu (patrz sortTasks), więc dawna, teraz już nieaktualna
 * wartość `order` zostawiona na ukończonym zadaniu nie ma wpływu na jego miejsce.
 */
function orderCompare(a, b) {
  if (a.completed || b.completed) return 0;
  if (!Number.isFinite(a.order) || !Number.isFinite(b.order)) return 0;
  return a.order - b.order;
}

export function sortTasks(tasks) {
  return [...tasks].sort((a, b) =>
    (Number(!!a.completed) - Number(!!b.completed))
    || orderCompare(a, b)
    || ((PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1))
    || ((b.createdAtMs ?? 0) - (a.createdAtMs ?? 0)));
}

export function nextPriority(current) {
  const i = PRIORITIES.indexOf(current);
  return PRIORITIES[(i + 1) % PRIORITIES.length];
}

/**
 * Wartość `order` dla NOWEGO zadania dopisywanego na koniec rodzeństwa (ta sama lista
 * i ten sam rodzic, tylko zadania OTWARTE). Zwraca null, jeśli ta grupa nigdy nie była
 * ręcznie przestawiana – wtedy pole `order` w ogóle nie jest zapisywane (brak pola =
 * kolejność wynika z priorytetu/daty, jak dotychczas), żeby nie wymuszać migracji.
 */
export function nextOrderValue(openSiblings) {
  const nums = openSiblings.map((t) => t.order).filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  return Math.max(...nums) + 1;
}

/**
 * Przygotowuje przesunięcie zadania `id` o jedno miejsce w górę (direction -1) albo w dół
 * (direction +1) wśród OTWARTEGO rodzeństwa (`openSiblings`: ta sama lista i ten sam rodzic,
 * tylko nieukończone). Jeśli żadne z rodzeństwa nie ma jeszcze pola `order` (nikt wcześniej
 * nie przestawiał tej grupy), najpierw "materializuje" kolejność całej grupy na podstawie
 * aktualnego sortowania (priorytet, potem najnowsze) – dopiero na niej wykonuje zamianę.
 * Zwraca tablicę { id, order } do zapisania (writeBatch) dla WSZYSTKICH elementów grupy,
 * albo null, gdy przesunięcie nie jest możliwe (zadanie na krawędzi listy albo nie znalezione).
 */
export function planMoveTask(openSiblings, id, direction) {
  const current = sortTasks(openSiblings);
  const idx = current.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  const swapIdx = idx + direction;
  if (swapIdx < 0 || swapIdx >= current.length) return null;
  const hasOrder = current.every((t) => Number.isFinite(t.order));
  const result = hasOrder
    ? current.map((t) => ({ id: t.id, order: t.order }))
    : current.map((t, i) => ({ id: t.id, order: i }));
  const tmp = result[idx].order;
  result[idx].order = result[swapIdx].order;
  result[swapIdx].order = tmp;
  return result;
}

/** Walidacja opcjonalnego terminu zadania (data, opcjonalnie godzina – ale tylko razem z datą). */
export function validateDeadline({ deadlineDate, deadlineTime } = {}) {
  const date = String(deadlineDate ?? '').trim();
  const time = String(deadlineTime ?? '').trim();
  if (!date && !time) return null;
  if (!date) return 'Wybierz datę terminu albo usuń godzinę.';
  if (!parseDateKey(date)) return 'Nieprawidłowa data terminu.';
  if (time && Number.isNaN(toMinutes(time))) return 'Nieprawidłowa godzina terminu.';
  return null;
}

/** Czy zadanie ma termin w przeszłości i wciąż nie jest ukończone? */
export function isTaskOverdue(task, today = dateKey()) {
  return !!(task && task.deadlineDate && !task.completed && task.deadlineDate < today);
}

/** Krótki, czytelny opis terminu zadania, np. "Dziś", "Jutro, 18:00", "12 października". */
export function formatTaskDeadline(deadlineDate, deadlineTime) {
  if (!deadlineDate) return '';
  const today = dateKey();
  let label;
  if (deadlineDate === today) label = 'Dziś';
  else if (deadlineDate === shiftDateKey(today, 1)) label = 'Jutro';
  else if (deadlineDate === shiftDateKey(today, -1)) label = 'Wczoraj';
  else label = formatDateShort(deadlineDate);
  return deadlineTime ? `${label}, ${deadlineTime}` : label;
}

function sortDeadlineTasks(list) {
  return list.sort((a, b) =>
    (Number(!!a.completed) - Number(!!b.completed))
    || String(a.deadlineTime || '99:99').localeCompare(String(b.deadlineTime || '99:99'))
    || a.title.localeCompare(b.title, 'pl'));
}

/** Zadania (z jakiejkolwiek listy) z terminem przypadającym na dany dzień, posortowane do wyświetlenia. */
export function tasksWithDeadlineOn(tasks, dateKeyValue) {
  return sortDeadlineTasks(tasks.filter((t) => t.deadlineDate === dateKeyValue));
}

/** Mapa dzień → zadania z terminem tego dnia (dla widoku miesiąca – liczymy raz, nie per-dzień). */
export function groupTasksByDeadline(tasks) {
  const map = new Map();
  for (const t of tasks) {
    if (!t.deadlineDate) continue;
    if (!map.has(t.deadlineDate)) map.set(t.deadlineDate, []);
    map.get(t.deadlineDate).push(t);
  }
  for (const list of map.values()) sortDeadlineTasks(list);
  return map;
}

// ------------------------------------------------- LISTY ZADAŃ I PODZADANIA --
/** Nazwa listy zadań – walidacja formularza „Nowa lista” / „Zmień nazwę”. */
export function validateListName(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return 'Wpisz nazwę listy.';
  if (trimmed.length > MAX_LIST_NAME) return `Nazwa listy może mieć maksymalnie ${MAX_LIST_NAME} znaków.`;
  return null;
}

/**
 * Zadania należące do danej listy. `listId` == null/undefined/'' oznacza
 * listę domyślną – to samo umownie stosujemy w polu `listId` zadania (brak pola = domyślna).
 */
export function tasksInList(tasks, listId) {
  const target = listId || null;
  return tasks.filter((t) => (t.listId || null) === target);
}

/**
 * Buduje drzewo zadań (maks. jeden poziom zagnieżdżenia, jak w Google Tasks) z PŁASKIEJ
 * listy zadań NALEŻĄCYCH JUŻ DO JEDNEJ LISTY (np. wynik tasksInList). Zwraca zadania
 * nadrzędne (posortowane przez sortTasks), każde z dopisanym polem `subtasks`
 * (też posortowanym przez sortTasks). Podzadanie, którego rodzic zniknął (skasowany,
 * przeniesiony do innej listy…) jest zabezpieczająco pokazywane jako zadanie główne –
 * nigdy nie znika po cichu z widoku.
 */
export function buildTaskTree(tasks) {
  const byParent = new Map();
  const roots = [];
  for (const t of tasks) {
    if (t.parentId) {
      if (!byParent.has(t.parentId)) byParent.set(t.parentId, []);
      byParent.get(t.parentId).push(t);
    } else {
      roots.push(t);
    }
  }
  const rootIds = new Set(roots.map((t) => t.id));
  for (const [parentId, children] of byParent) {
    if (!rootIds.has(parentId)) {
      roots.push(...children);
      byParent.delete(parentId);
    }
  }
  return sortTasks(roots).map((t) => ({ ...t, subtasks: sortTasks(byParent.get(t.id) || []) }));
}

// --------------------------------------------------------------- FISZKI ------
const FIELDS = ['subject', 'topic', 'subtopic'];
export const CARD_FIELDS = FIELDS;

export function pathLevel(path) {
  if (path.subject == null) return 0;
  if (path.topic == null) return 1;
  if (path.subtopic == null) return 2;
  return 3;
}

export function filterByPath(cards, path) {
  return cards.filter((c) =>
    (path.subject == null || c.subject === path.subject)
    && (path.topic == null || c.topic === path.topic)
    && (path.subtopic == null || c.subtopic === path.subtopic));
}

/** Czy fiszka jest „do powtórki”? Prosty system 3-stopniowy oparty o status i lastReviewed. */
export function isDue(card, now = Date.now()) {
  const days = INTERVAL_DAYS[card.status] ?? 0;
  if (days === 0) return true;
  if (!card.lastReviewedMs) return true;
  return now >= card.lastReviewedMs + days * 86400000;
}

/** Lista grup (przedmioty / tematy / zagadnienia) na bieżącym poziomie hierarchii. */
export function listGroups(cards, path, now = Date.now()) {
  const level = pathLevel(path);
  if (level >= 3) return [];
  const field = FIELDS[level];
  const map = new Map();
  for (const c of filterByPath(cards, path)) {
    const g = map.get(c[field]) ?? { name: c[field], total: 0, due: 0, hard: 0 };
    g.total += 1;
    if (isDue(c, now)) g.due += 1;
    if (c.status === 'hard') g.hard += 1;
    map.set(c[field], g);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'pl', { numeric: true, sensitivity: 'base' }));
}

/**
 * Spłaszczona lista WSZYSTKICH istniejących węzłów hierarchii fiszek (każdy przedmiot,
 * każdy jego temat, każde jego zagadnienie – każdy raz), w porządku przedmiot → jego tematy
 * → ich zagadnienia. Używana na pierwszym ekranie zakładki Fiszki do szybkiego wyboru,
 * z czego się uczyć, bez klikania przez okruszki poziom po poziomie.
 * `depth`: 0 = przedmiot, 1 = temat, 2 = zagadnienie.
 */
export function buildScopeOptions(cards) {
  const options = [];
  for (const s of listGroups(cards, { subject: null, topic: null, subtopic: null })) {
    const subjectPath = { subject: s.name, topic: null, subtopic: null };
    options.push({ path: subjectPath, label: s.name, depth: 0, total: s.total });
    for (const t of listGroups(cards, subjectPath)) {
      const topicPath = { subject: s.name, topic: t.name, subtopic: null };
      options.push({ path: topicPath, label: t.name, depth: 1, total: t.total });
      for (const st of listGroups(cards, topicPath)) {
        const subtopicPath = { subject: s.name, topic: t.name, subtopic: st.name };
        options.push({ path: subtopicPath, label: st.name, depth: 2, total: st.total });
      }
    }
  }
  return options;
}

/** Najgłębsza wspólna ścieżka zaimportowanych fiszek (żeby po imporcie od razu je pokazać). */
export function commonPath(cards) {
  const path = { subject: null, topic: null, subtopic: null };
  if (!cards.length) return path;
  for (const field of FIELDS) {
    const values = new Set(cards.map((c) => c[field]));
    if (values.size !== 1) break;
    path[field] = cards[0][field];
  }
  return path;
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildStudyQueue(cards, mode, now = Date.now(), rng = Math.random) {
  let pool = cards;
  if (mode === 'due') pool = cards.filter((c) => isDue(c, now));
  else if (mode === 'hard') pool = cards.filter((c) => c.status === 'hard');
  return shuffle(pool, rng);
}

/** Etykiety stron fiszki. Dla językowych: przód = polski, tył = język obcy (chyba że odwrócone). */
export function cardLabels(type, reversed = false) {
  if (type === 'language') {
    return reversed ? { front: 'Język obcy', back: 'Polski' } : { front: 'Polski', back: 'Język obcy' };
  }
  return { front: 'Pytanie', back: 'Odpowiedź' };
}

// -------------------------------------------------------- UDOSTĘPNIANIE FISZEK
/**
 * Migawka fiszek do zapisania w `shares/{id}` – tylko treść, bez stanu nauki
 * (status/lastReviewed) i bez createdAt: u odbiorcy to ma być komplet NOWYCH fiszek.
 */
export function buildShareSnapshot(cards) {
  return cards.map((c) => ({
    subject: c.subject, topic: c.topic, subtopic: c.subtopic, type: c.type, front: c.front, back: c.back,
  }));
}

/** Czy paczkę o takim rozmiarze da się zapisać w jednym dokumencie Firestore (limit 1 MiB)? */
export function validateShareSize(count) {
  if (!count) return 'Brak fiszek do udostępnienia w tym miejscu.';
  if (count > MAX_SHARE_CARDS) {
    return `Można udostępnić maksymalnie ${MAX_SHARE_CARDS} fiszek naraz (limit rozmiaru pliku w bazie). `
      + 'Przejdź do węższego działu (np. konkretnego tematu albo zagadnienia) i spróbuj tam.';
  }
  return null;
}

// ------------------------------------------------- IMPORT JSON Z AI ---------
export const normalizeName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const keyOf = (s) => normalizeName(s).toLocaleLowerCase('pl');

/** Wyciąga JSON z odpowiedzi AI: zdejmuje BOM i ogrodzenie ```json … ```. */
function extractJsonText(raw) {
  let t = String(raw ?? '').replace(/^\uFEFF/, '').trim();
  const fence = /```(?:json|JSON)?[ \t]*\r?\n?([\s\S]*?)```/.exec(t);
  if (fence) t = fence[1].trim();
  return t;
}

const fail = (error) => ({ ok: false, error });

/**
 * Walidacja i normalizacja importu.
 * - wszystko albo nic: przy jakimkolwiek błędzie nic nie jest importowane,
 * - nazwy przedmiotów/tematów są zestawiane bez względu na wielkość liter
 *   z już istniejącymi (żeby „biologia” i „Biologia” nie stały się dwoma działami),
 * - duplikaty (ten sam przedmiot+temat+zagadnienie+przód) są pomijane.
 */
export function parseImport(raw, existingCards = []) {
  const text = extractJsonText(raw);
  if (!text) return fail('Pole jest puste. Wklej tablicę JSON wygenerowaną przez AI.');

  let data;
  try {
    data = JSON.parse(text);
  } catch (firstError) {
    // AI często dopisuje zdanie przed/po JSON-ie – próbujemy wyciąć samą tablicę.
    const a = text.indexOf('[');
    const b = text.lastIndexOf(']');
    if (a === -1 || b <= a) {
      return fail(`Niepoprawny JSON: ${firstError.message}. Dane muszą zaczynać się od [ i kończyć na ].`);
    }
    try {
      data = JSON.parse(text.slice(a, b + 1));
    } catch (secondError) {
      return fail(`Niepoprawny JSON: ${secondError.message}. Skopiuj całą tablicę przyciskiem „Kopiuj” przy bloku kodu.`);
    }
  }

  if (!Array.isArray(data)) return fail('To nie jest tablica. Dane muszą zaczynać się od [ i kończyć na ].');
  if (data.length === 0) return fail('Tablica jest pusta – nie ma czego importować.');
  if (data.length > MAX_IMPORT) {
    return fail(`Za dużo fiszek naraz (${data.length}). Maksimum to ${MAX_IMPORT} – podziel na mniejsze paczki.`);
  }

  // Mapy nazw „kanonicznych”: istniejące pisownie wygrywają.
  const canon = { subject: new Map(), topic: new Map(), subtopic: new Map() };
  const seen = new Set();
  const scopeKey = (c) => [keyOf(c.subject), keyOf(c.topic), keyOf(c.subtopic)];
  const register = (c) => {
    const [s, t, st] = scopeKey(c);
    if (!canon.subject.has(s)) canon.subject.set(s, normalizeName(c.subject));
    if (!canon.topic.has(`${s}\u0000${t}`)) canon.topic.set(`${s}\u0000${t}`, normalizeName(c.topic));
    if (!canon.subtopic.has(`${s}\u0000${t}\u0000${st}`)) canon.subtopic.set(`${s}\u0000${t}\u0000${st}`, normalizeName(c.subtopic));
  };
  for (const c of existingCards) {
    register(c);
    seen.add([...scopeKey(c), keyOf(c.front)].join('\u0000'));
  }

  const errors = [];
  const cards = [];
  let duplicates = 0;

  data.forEach((item, idx) => {
    const n = idx + 1;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`Fiszka #${n}: to nie jest obiekt { … }.`);
      return;
    }
    const read = (k) => {
      const v = item[k];
      if (typeof v === 'number' && Number.isFinite(v)) return String(v);
      return typeof v === 'string' ? v : '';
    };
    const problems = [];
    for (const k of ['subject', 'topic', 'subtopic', 'front', 'back']) {
      if (!read(k).trim()) problems.push(`brak pola „${k}”`);
    }
    const rawType = item.type == null || item.type === '' ? 'standard' : String(item.type).trim().toLowerCase();
    if (!CARD_TYPES.includes(rawType)) problems.push(`nieznany typ „${item.type}” (dozwolone: standard, language)`);
    for (const k of ['subject', 'topic', 'subtopic']) {
      if (normalizeName(read(k)).length > 120) problems.push(`pole „${k}” jest za długie (maks. 120 znaków)`);
    }
    for (const k of ['front', 'back']) {
      if (read(k).length > 4000) problems.push(`pole „${k}” jest za długie (maks. 4000 znaków)`);
    }
    if (problems.length) { errors.push(`Fiszka #${n}: ${problems.join(', ')}.`); return; }

    // Ujednolicamy nazwy do już istniejących (bez względu na wielkość liter).
    const draft = {
      subject: normalizeName(read('subject')),
      topic: normalizeName(read('topic')),
      subtopic: normalizeName(read('subtopic')),
    };
    const [s, t, st] = scopeKey(draft);
    if (!canon.subject.has(s)) register(draft);
    const subject = canon.subject.get(s);
    if (!canon.topic.has(`${s}\u0000${t}`)) register(draft);
    const topic = canon.topic.get(`${s}\u0000${t}`);
    if (!canon.subtopic.has(`${s}\u0000${t}\u0000${st}`)) register(draft);
    const subtopic = canon.subtopic.get(`${s}\u0000${t}\u0000${st}`);

    const front = read('front').trim();
    const dupKey = [s, t, st, keyOf(front)].join('\u0000');
    if (seen.has(dupKey)) { duplicates += 1; return; }
    seen.add(dupKey);

    cards.push({
      subject, topic, subtopic,
      type: rawType,
      front,
      back: read('back').trim(),
      status: 'new',
      lastReviewed: null,
    });
  });

  if (errors.length) {
    const shown = errors.slice(0, 8);
    if (errors.length > shown.length) shown.push(`…i jeszcze ${errors.length - shown.length} błędów.`);
    return fail(`Nic nie zaimportowano – w danych są błędy:\n${shown.join('\n')}`);
  }
  return { ok: true, cards, duplicates, total: data.length };
}
