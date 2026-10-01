/* ============================================================================
 * Personal Life OS – app.js
 * ----------------------------------------------------------------------------
 * Ten plik łączy interfejs z bazą Firebase. Nie musisz go edytować.
 * Spis treści:
 *   1 Start i Firebase      6 Planer dnia        11 Konto i kopia zapasowa
 *   2 Pomocnicze            7 Zadania            12 Zdarzenia globalne
 *   3 Dane (Firestore)      8 Fiszki             13 Uruchomienie
 *   4 Motyw                 9 Import z AI
 *   5 Okna i powiadomienia 10 Nauka (obracana fiszka)
 * ========================================================================== */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, connectAuthEmulator, onAuthStateChanged, signInWithEmailAndPassword,
  sendPasswordResetEmail, signOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  connectFirestoreEmulator, collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  onSnapshot, query, where, writeBatch, serverTimestamp, Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import * as L from './logic.js';

window.__lifeosBooted = true; // informuje ekran startowy, że moduły się załadowały

// ============================================================ 1. START I FIREBASE
const APP_VERSION = '1.2.0';
const HOUR_PX = 64; // wysokość jednej godziny na osi czasu (musi zgadzać się z .tl-body w index.html: 18 × 64 = 1152)

// Wymagane są tylko te 4 pola. storageBucket i messagingSenderId mogą zostać z „WKLEJ_TUTAJ”, bo aplikacja z nich nie korzysta.
const configured = ['apiKey', 'authDomain', 'projectId', 'appId'].every((k) => firebaseConfig[k] && !String(firebaseConfig[k]).includes('WKLEJ_TUTAJ'));
let app; let auth; let db;

/** Uruchamia Firebase. Dane zapisują się też w pamięci przeglądarki, więc aplikacja działa offline. */
function initFirebase() {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (err) {
    console.warn('Tryb offline dla danych jest niedostępny w tej przeglądarce:', err);
    db = getFirestore(app);
  }
  // Tylko do testów developerskich: adres localhost + ?emulator=1. W internecie nigdy się nie włącza.
  const useEmulator = ['localhost', '127.0.0.1'].includes(location.hostname)
    && new URLSearchParams(location.search).has('emulator');
  if (useEmulator) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
}

// ================================================================ 2. POMOCNICZE
const { esc } = L;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const icon = (name, cls = 'ic') => `<i data-lucide="${name}" class="${cls}" aria-hidden="true"></i>`;
const refreshIcons = () => { try { if (window.lucide) window.lucide.createIcons(); } catch (e) { /* ikony to dodatek */ } };
const WORDS = {
  card: ['fiszka', 'fiszki', 'fiszek'],
  event: ['wydarzenie', 'wydarzenia', 'wydarzeń'],
  task: ['zadanie', 'zadania', 'zadań'],
};

let savedListId = null;
try { savedListId = localStorage.getItem('lifeos-tasklist') || null; } catch (e) { /* prywatny tryb */ }

const state = {
  user: null, tasks: [], cards: [], events: [], monthEvents: [], taskLists: [],
  currentListId: savedListId,
  date: L.dateKey(),
  plannerMode: 'day', // 'day' | 'month'
  month: L.monthKey(),
  path: { subject: null, topic: null, subtopic: null },
  route: null, online: navigator.onLine, syncShown: '',
  pending: { tasks: false, cards: false, events: false },
  scrollPlanner: true,
};

let rafId = 0;
/** Odrysowuje bieżący widok (raz na klatkę, nawet gdy zmian jest wiele). */
function scheduleRender() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    const view = views[state.route];
    if (view && view.mounted) view.update();
    updateNav();
    updateSyncUI();
  });
}

function showOnly(name) {
  for (const id of ['boot', 'setup', 'login', 'shell']) $(`#${id}`).classList.toggle('hide', id !== name);
}

// ============================================================ 3. DANE (FIRESTORE)
// Struktura: users/{uid}/tasks | planner_events | flashcards (te same pola, co w specyfikacji).
const colRef = (name) => collection(db, 'users', state.user.uid, name);
const docRef = (name, id) => doc(db, 'users', state.user.uid, name, id);
const SNAP = { serverTimestamps: 'estimate' };

/** Dokument z bazy → zwykły obiekt (znaczniki czasu także jako milisekundy do sortowania). */
function mapDoc(d) {
  const data = d.data(SNAP);
  return {
    id: d.id, ...data,
    createdAtMs: data.createdAt && data.createdAt.toMillis ? data.createdAt.toMillis() : 0,
    lastReviewedMs: data.lastReviewed && data.lastReviewed.toMillis ? data.lastReviewed.toMillis() : 0,
  };
}
const toRaw = ({ id, createdAtMs, lastReviewedMs, ...raw }) => raw;

let unsubs = [];
let unsubEventsDate = null; // wydarzenia godzinowe / rozpoczynające się tego dnia (where date == …)
let unsubEventsDays = null; // wydarzenia całodniowe obejmujące ten dzień (where days array-contains …)
let unsubMonth = null;      // widok miesiąca: jedno zapytanie zakresowe po polu date
let dayDocsA = new Map();
let dayDocsB = new Map();
const shownErrors = new Set();

function listenError(name, err) {
  console.error(`[Firestore:${name}]`, err);
  if (shownErrors.has(err.code)) return;
  shownErrors.add(err.code);
  toast(err.code === 'permission-denied'
    ? 'Brak uprawnień do odczytu danych. Sprawdź reguły Firestore (PORADNIK.md, krok 5).'
    : `Problem z odczytem danych (${err.code || 'nieznany błąd'}).`, { ms: 9000 });
}

/** Włącza nasłuch na żywo: każda zmiana z drugiego urządzenia pojawia się tu sama. */
function startData() {
  stopData();
  const watch = (name, key, pendingKey) => onSnapshot(colRef(name), (snap) => {
    state[key] = snap.docs.map(mapDoc);
    if (pendingKey) state.pending[pendingKey] = snap.metadata.hasPendingWrites;
    scheduleRender();
  }, (err) => listenError(name, err));
  unsubs = [
    watch('tasks', 'tasks', 'tasks'),
    watch('flashcards', 'cards', 'cards'),
    watch('task_lists', 'taskLists', null),
  ];
  listenPlanner();
}

/** Zatrzymuje wszystkie nasłuchy wydarzeń (dnia i miesiąca) przed uruchomieniem innych. */
function stopEventListeners() {
  if (unsubEventsDate) unsubEventsDate();
  if (unsubEventsDays) unsubEventsDays();
  if (unsubMonth) unsubMonth();
  unsubEventsDate = unsubEventsDays = unsubMonth = null;
}

/**
 * Wydarzenia widoczne w widoku DNIA — dwa niezależne zapytania, każde na jednym polu
 * (żadne nie wymaga indeksu złożonego):
 *  A) date == wybrany dzień           → wydarzenia godzinowe + całodniowe zaczynające się dziś
 *  B) days array-contains wybrany dzień → wydarzenia całodniowe/wielodniowe obejmujące ten dzień
 * Wynik jest sumą (po id), bo część wydarzeń całodniowych spełnia oba warunki naraz.
 */
function listenEvents() {
  stopEventListeners();
  dayDocsA = new Map();
  dayDocsB = new Map();
  state.events = [];
  const mergeAndRender = () => {
    const merged = new Map(dayDocsA);
    for (const [id, ev] of dayDocsB) merged.set(id, ev);
    state.events = [...merged.values()];
    scheduleRender();
  };
  unsubEventsDate = onSnapshot(query(colRef('planner_events'), where('date', '==', state.date)), (snap) => {
    dayDocsA = new Map(snap.docs.map((d) => [d.id, mapDoc(d)]));
    state.pending.events = snap.metadata.hasPendingWrites;
    mergeAndRender();
  }, (err) => listenError('planner_events', err));
  unsubEventsDays = onSnapshot(query(colRef('planner_events'), where('days', 'array-contains', state.date)), (snap) => {
    dayDocsB = new Map(snap.docs.map((d) => [d.id, mapDoc(d)]));
    mergeAndRender();
  }, (err) => listenError('planner_events', err));
}

/**
 * Wydarzenia widoczne w widoku MIESIĄCA — jedno zapytanie zakresowe, oba warunki na TYM SAMYM
 * polu (date), więc też bez indeksu złożonego: date >= (początek siatki – MAX_ALLDAY_SPAN_DAYS)
 * AND date <= koniec siatki. Cofnięcie o MAX_ALLDAY_SPAN_DAYS gwarantuje, że złapiemy też
 * wydarzenia wielodniowe, które zaczęły się przed tym miesiącem, a wciąż do niego wchodzą.
 * Właściwe „czy ten dzień jest objęty” liczymy już po stronie klienta (L.eventTouchesDay).
 */
function listenMonth() {
  stopEventListeners();
  state.monthEvents = [];
  const grid = L.monthGrid(state.month);
  if (!grid.length) return;
  const gridStart = grid[0][0].key;
  const gridEnd = grid[grid.length - 1][6].key;
  const lookback = L.shiftDateKey(gridStart, -L.MAX_ALLDAY_SPAN_DAYS);
  unsubMonth = onSnapshot(
    query(colRef('planner_events'), where('date', '>=', lookback), where('date', '<=', gridEnd)),
    (snap) => {
      state.monthEvents = snap.docs.map(mapDoc);
      state.pending.events = snap.metadata.hasPendingWrites;
      scheduleRender();
    },
    (err) => listenError('planner_events', err),
  );
}

/** Uruchamia właściwy nasłuch wydarzeń zależnie od aktywnego trybu planera. */
function listenPlanner() {
  if (state.plannerMode === 'month') listenMonth(); else listenEvents();
}

function stopData() {
  unsubs.forEach((u) => u());
  unsubs = [];
  stopEventListeners();
  Object.assign(state, { tasks: [], cards: [], events: [], monthEvents: [], taskLists: [] });
}

function dbError(err) {
  console.error('[Firestore]', err);
  const code = err && err.code;
  let msg = 'Nie udało się zapisać zmian.';
  if (code === 'permission-denied') msg = 'Brak uprawnień do zapisu. Sprawdź reguły Firestore (PORADNIK.md, krok 5).';
  else if (code === 'resource-exhausted') msg = 'Przekroczono dzienny limit darmowego planu Firebase. Spróbuj jutro.';
  else if (code === 'unavailable') msg = 'Brak połączenia z bazą. Zmiany zapiszą się po odzyskaniu sieci.';
  toast(msg, { ms: 7000 });
}

/** Usuwa dokument i pokazuje „Cofnij”. Zapisy nie czekają na sieć – interfejs reaguje od razu. */
function deleteWithUndo(name, item, label) {
  const ref = docRef(name, item.id);
  const raw = toRaw(item);
  deleteDoc(ref).catch(dbError);
  toast(label, { action: 'Cofnij', ms: 7000, onAction: () => setDoc(ref, raw).catch(dbError) });
}

/** Zapisy/usunięcia wielu dokumentów (paczki po 400; limit Firestore to 500). */
function commitBatches(items, build) {
  const promises = [];
  for (let i = 0; i < items.length; i += 400) {
    const batch = writeBatch(db);
    items.slice(i, i + 400).forEach((it, k) => build(batch, it, i + k));
    promises.push(batch.commit());
  }
  return promises;
}
function deleteManyWithUndo(name, items, label) {
  const raws = items.map((it) => ({ id: it.id, raw: toRaw(it) }));
  Promise.all(commitBatches(items, (b, it) => b.delete(docRef(name, it.id)))).catch(dbError);
  toast(label, {
    action: 'Cofnij', ms: 9000,
    onAction: () => Promise.all(commitBatches(raws, (b, r) => b.set(docRef(name, r.id), r.raw))).catch(dbError),
  });
}

// ==================================================================== 4. MOTYW
const isDark = () => document.documentElement.classList.contains('dark');
function setTheme(dark, persist = true) {
  document.documentElement.classList.toggle('dark', dark);
  $('#meta-theme').setAttribute('content', dark ? '#000000' : '#F2F2F7');
  $$('[data-act="theme"]').forEach((b) => b.setAttribute('aria-checked', String(dark)));
  if (persist) { try { localStorage.setItem('lifeos-theme', dark ? 'dark' : 'light'); } catch (e) { /* prywatny tryb */ } }
}
function initTheme() {
  setTheme(isDark(), false);
  let saved = null;
  try { saved = localStorage.getItem('lifeos-theme'); } catch (e) { /* ignoruj */ }
  if (!saved) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => setTheme(e.matches, false));
  }
}

// ======================================================= 5. OKNA I POWIADOMIENIA
function toast(message, { action, onAction, ms = 5000 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span style="flex:1">${esc(message)}</span>${action ? `<button type="button" class="toast-act">${esc(action)}</button>` : ''}`;
  const remove = () => el.remove();
  const timer = setTimeout(remove, ms);
  const btn = $('.toast-act', el);
  if (btn) btn.addEventListener('click', () => { clearTimeout(timer); remove(); if (onAction) onAction(); });
  const box = $('#toasts');
  box.append(el);
  while (box.children.length > 3) box.firstElementChild.remove();
}

/** Uniwersalny arkusz (na telefonie wysuwa się od dołu, na komputerze jest oknem na środku). */
function openSheet({ title, body, onMount }) {
  const dlg = $('#sheet');
  dlg.innerHTML = `<div class="sheet-panel"><div class="sheet-head"><h2 id="sheet-title" class="sheet-title">${esc(title)}</h2>`
    + `<button type="button" class="icon-btn" data-act="sheet-close" aria-label="Zamknij">${icon('x')}</button></div>`
    + `<div>${body}</div></div>`;
  refreshIcons();
  if (!dlg.open) dlg.showModal();
  if (onMount) onMount(dlg);
}
function closeSheet() { const d = $('#sheet'); if (d.open) d.close(); }

function confirmSheet({ title, message, confirmLabel, danger = true }) {
  return new Promise((resolve) => {
    let result = false;
    openSheet({
      title,
      body: `<p class="text-muted">${esc(message)}</p><div style="display:flex;flex-direction:column;gap:.5rem;margin-top:1.25rem">`
        + `<button type="button" class="btn btn-lg ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-yes">${esc(confirmLabel)}</button>`
        + '<button type="button" class="btn btn-lg btn-plain" data-act="sheet-close">Anuluj</button></div>',
      onMount: (dlg) => {
        dlg.addEventListener('close', () => resolve(result), { once: true });
        $('#confirm-yes', dlg).addEventListener('click', () => { result = true; dlg.close(); });
      },
    });
  });
}

function showFormError(form, message) {
  const el = $('.form-error', form);
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hide');
}
function setStatus(box, kind, message) {
  box.className = kind === 'error' ? 'form-error' : kind === 'ok' ? 'form-ok' : 'form-hint';
  box.textContent = message;
}

// ====================================================================== 6. PLANER
const PlannerView = {
  mounted: false,
  timer: 0,

  mount() {
    let hours = '';
    for (let h = 6; h < 24; h += 1) {
      const top = (h - 6) * HOUR_PX;
      hours += `<div class="tl-line" style="top:${top}px"></div><span class="tl-label" style="top:${top}px" aria-hidden="true">${L.pad2(h)}:00</span>`;
    }
    hours += `<div class="tl-line" style="top:${18 * HOUR_PX}px"></div>`;
    $('#view').innerHTML = `<div class="page">
        <div class="pl-headrow">
          <h1 class="page-title" id="pl-title"></h1>
          <div class="seg" role="group" aria-label="Widok planera">
            <button type="button" class="seg-btn" data-act="pl-mode-day" id="pl-tab-day" aria-pressed="true">Dzień</button>
            <button type="button" class="seg-btn" data-act="pl-mode-month" id="pl-tab-month" aria-pressed="false">Miesiąc</button>
          </div>
        </div>
        <div class="page-sub" id="pl-sub"></div>
        <div id="pl-allday"></div>
        <div class="tl" id="pl-dayview"><div class="tl-body" id="tl-body">${hours}<div id="tl-events"></div><div id="tl-now"></div></div></div>
        <div id="pl-monthview" class="hide"></div>
      </div>`;
    $('#dock').innerHTML = `<div class="dock-pill glass">
        <button type="button" class="icon-btn" data-act="pl-prev" id="pl-prevbtn" aria-label="Poprzedni dzień">${icon('chevron-left')}</button>
        <button type="button" class="btn btn-plain" style="flex:1;min-width:0" data-act="pl-pick" id="pl-datebtn" aria-label="Wybierz datę"></button>
        <input type="date" id="pl-date" class="sr-only" tabindex="-1" aria-hidden="true">
        <button type="button" class="icon-btn" data-act="pl-next" id="pl-nextbtn" aria-label="Następny dzień">${icon('chevron-right')}</button>
        <button type="button" class="btn btn-primary" data-act="pl-add">${icon('plus')} Dodaj</button>
      </div>`;
    // Kliknięcie w oś czasu = nowe wydarzenie o godzinie, w którą kliknięto (co 15 minut). Kliknięcie w blok = edycja.
    $('#tl-body').addEventListener('click', (e) => {
      const block = e.target.closest('.ev');
      if (block) { openEventSheet({ id: block.dataset.id }); return; }
      const rect = $('#tl-body').getBoundingClientRect();
      const start = L.pxToMinutes(e.clientY - rect.top, HOUR_PX, 15);
      openEventSheet({ startTime: L.toHHMM(start), endTime: L.toHHMM(Math.min(start + 60, 23 * 60 + 59)) });
    });
    this.timer = setInterval(() => this.drawNow(), 20000);
    $('#main').scrollTop = 0;
    this.mounted = true;
    state.scrollPlanner = true;
    refreshIcons();
  },

  unmount() { clearInterval(this.timer); this.mounted = false; },

  /** Czerwona linia „teraz” – tylko gdy oglądasz dzisiejszy dzień. */
  drawNow() {
    const box = $('#tl-now');
    if (!box) return;
    const now = new Date();
    const mins = L.nowMinutes(now);
    if (state.date !== L.dateKey(now) || mins < L.DAY_START_MIN) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="now" style="top:${L.minutesToPx(mins, HOUR_PX)}px"><span>${L.toHHMM(Math.floor(mins))}</span></div>`;
  },

  scrollToRelevant() {
    const main = $('#main');
    const tl = $('#tl-body');
    const base = tl.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
    const mins = L.nowMinutes();
    const target = state.date === L.dateKey() && mins >= L.DAY_START_MIN
      ? base + L.minutesToPx(mins, HOUR_PX) - main.clientHeight * 0.35
      : base + L.minutesToPx(7 * 60, HOUR_PX) - 90;
    main.scrollTop = Math.max(0, target);
  },

  update() {
    const isMonth = state.plannerMode === 'month';
    $('#pl-tab-day').setAttribute('aria-pressed', String(!isMonth));
    $('#pl-tab-month').setAttribute('aria-pressed', String(isMonth));
    $('#pl-dayview').classList.toggle('hide', isMonth);
    $('#pl-monthview').classList.toggle('hide', !isMonth);
    $('#pl-allday').classList.toggle('hide', isMonth);
    $('#pl-prevbtn').setAttribute('aria-label', isMonth ? 'Poprzedni miesiąc' : 'Poprzedni dzień');
    $('#pl-nextbtn').setAttribute('aria-label', isMonth ? 'Następny miesiąc' : 'Następny dzień');
    if (isMonth) this.updateMonth(); else this.updateDay();
  },

  updateDay() {
    const today = L.dateKey();
    const rel = state.date === L.shiftDateKey(today, 1) ? 'Jutro' : state.date === L.shiftDateKey(today, -1) ? 'Wczoraj' : '';
    $('#pl-title').textContent = state.date === today ? 'Dziś' : L.formatDateLong(state.date);
    const timed = state.events.filter((ev) => !ev.allDay);
    const allDay = state.events.filter((ev) => ev.allDay)
      .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'pl'));
    const n = state.events.length;
    const count = n ? L.plural(n, WORDS.event) : 'Brak wydarzeń. Dotknij osi czasu, żeby dodać.';
    $('#pl-sub').innerHTML = `<p>${esc(state.date === today ? L.formatDateLong(state.date) : rel)}</p><p>${esc(count)}</p>`
      + (state.date !== today ? '<button type="button" class="btn btn-tonal" style="margin-top:.6rem" data-act="pl-today">Wróć do dziś</button>' : '');
    $('#pl-datebtn').textContent = state.date === today ? 'Dziś' : L.formatDateShort(state.date);

    const deadlineTasks = L.tasksWithDeadlineOn(state.tasks, state.date);

    $('#pl-allday').innerHTML = allDay.map((ev) => {
      const color = L.safeColor(ev.colorCode);
      const span = ev.date === ev.endDate ? '' : L.formatDateRangeShort(ev.date, ev.endDate);
      const descLabel = ev.description ? `. ${esc(ev.description)}` : '';
      return `<button type="button" class="allday-chip" data-act="pl-allday-edit" data-id="${esc(ev.id)}"
        style="border-left-color:${color};background-color:${color}22" aria-label="Całodniowe: ${esc(ev.title)}${span ? `, ${esc(span)}` : ''}${descLabel}">
        <span class="allday-title">${esc(ev.title)}</span>${span ? `<span class="allday-range">${esc(span)}</span>` : ''}
        ${ev.description ? `<span class="allday-range line-clamp-2">${esc(ev.description)}</span>` : ''}</button>`;
    }).join('') + deadlineTasks.map((t) => {
      const pr = L.PRIORITIES.includes(t.priority) ? t.priority : 'medium';
      const label = L.formatTaskDeadline(t.deadlineDate, t.deadlineTime);
      return `<button type="button" class="allday-chip allday-chip-task pr-${pr}${t.completed ? ' done' : ''}" data-act="ta-goto" data-id="${esc(t.id)}"
        aria-label="Termin zadania: ${esc(t.title)}, ${esc(label)}${t.completed ? ', ukończone' : ''}">
        ${icon(t.completed ? 'check-circle-2' : 'circle')}
        <span class="allday-title">${esc(t.title)}</span><span class="allday-range">${esc(label)}</span></button>`;
    }).join('');
    if (deadlineTasks.length) refreshIcons();

    const blocks = L.layoutEvents(timed).map((ev) => {
      const color = L.safeColor(ev.colorCode);
      const top = L.minutesToPx(ev.startMin, HOUR_PX);
      const height = Math.max(((ev.endMin - ev.startMin) * HOUR_PX) / 60, 26);
      const width = 100 / ev.cols;
      const range = `${L.toHHMM(ev.startMin)}–${L.toHHMM(Math.min(ev.endMin, 24 * 60 - 1))}`;
      const compact = height < 46;
      const descLabel = ev.description ? `. ${esc(ev.description)}` : '';
      return `<button type="button" class="ev" data-id="${esc(ev.id)}" aria-label="${esc(ev.title)}, ${range}${descLabel}"
        style="top:${top}px;height:${height - 2}px;left:calc(${ev.col * width}% + 2px);width:calc(${width}% - 4px);background-color:${color}38;border-left-color:${color}">
        ${compact ? `<span class="ev-compact"><span class="ev-title">${esc(ev.title)}</span><span class="ev-time">${range}</span></span>`
    : `<span class="ev-title">${esc(ev.title)}</span><span class="ev-time">${range}</span>${ev.description ? `<span class="ev-desc line-clamp-2">${esc(ev.description)}</span>` : ''}`}</button>`;
    }).join('');
    $('#tl-events').innerHTML = blocks;
    this.drawNow();
    if (state.scrollPlanner) { state.scrollPlanner = false; this.scrollToRelevant(); }
  },

  updateMonth() {
    $('#pl-title').textContent = L.monthLabel(state.month);
    $('#pl-datebtn').textContent = L.monthLabel(state.month);
    const today = L.dateKey();
    const isCurrentMonth = state.month === L.monthKey();
    $('#pl-sub').innerHTML = isCurrentMonth ? '' : '<button type="button" class="btn btn-tonal" data-act="pl-month-today">Wróć do bieżącego miesiąca</button>';
    const weeks = L.monthGrid(state.month);
    const head = L.WEEKDAY_LABELS_PL.map((w) => `<div class="mg-head">${esc(w)}</div>`).join('');
    const MAX_SHOWN = 3;
    const deadlineMap = L.groupTasksByDeadline(state.tasks);
    const body = weeks.map((week) => week.map((cell) => {
      const dayEvents = state.monthEvents.filter((ev) => L.eventTouchesDay(ev, cell.key))
        .sort((a, b) => (Number(!!b.allDay) - Number(!!a.allDay)) || (a.startTime || '').localeCompare(b.startTime || '') || a.title.localeCompare(b.title, 'pl'));
      const dayTasks = deadlineMap.get(cell.key) || [];
      const shownEvents = dayEvents.slice(0, MAX_SHOWN);
      const shownTasks = dayTasks.slice(0, Math.max(0, MAX_SHOWN - shownEvents.length));
      const chips = shownEvents.map((ev) => {
        const color = L.safeColor(ev.colorCode);
        return `<span class="mg-chip" style="background-color:${color}26;border-left-color:${color}">${esc(ev.title)}</span>`;
      }).join('') + shownTasks.map((t) => {
        const pr = L.PRIORITIES.includes(t.priority) ? t.priority : 'medium';
        return `<span class="mg-chip mg-chip-task pr-${pr}${t.completed ? ' done' : ''}">${esc(t.title)}</span>`;
      }).join('');
      const totalCount = dayEvents.length + dayTasks.length;
      const restCount = totalCount - shownEvents.length - shownTasks.length;
      const more = restCount > 0 ? `<span class="mg-more">+${restCount} więcej</span>` : '';
      const label = `${L.formatDateLong(cell.key)}`
        + (dayEvents.length ? `, ${L.plural(dayEvents.length, WORDS.event)}: ${dayEvents.map((e) => e.title).join(', ')}` : '')
        + (dayTasks.length ? `, terminy zadań: ${dayTasks.map((t) => t.title).join(', ')}` : '');
      return `<button type="button" class="mg-day${cell.inMonth ? '' : ' mg-out'}${cell.key === today ? ' mg-today' : ''}${cell.key === state.date ? ' mg-selected' : ''}"
        data-act="pl-goto-day" data-key="${cell.key}" aria-label="${esc(label)}">
        <span class="mg-num">${cell.day}</span>
        ${totalCount ? `<span class="mg-events">${chips}${more}</span>` : ''}</button>`;
    }).join('')).join('');
    $('#pl-monthview').innerHTML = `<div class="mg-head-row">${head}</div><div class="mg-grid">${body}</div>`;
  },
};

/** Przełącza na widok dnia dla wskazanej daty (z widoku miesiąca też). */
function setDate(key) {
  if (!key) return;
  const switchingFromMonth = state.plannerMode !== 'day';
  if (key === state.date && !switchingFromMonth) return;
  state.date = key;
  state.plannerMode = 'day';
  state.scrollPlanner = true;
  listenEvents();
  scheduleRender();
}

/** Przechodzi do innego miesiąca w widoku miesiąca (nawigacja strzałkami). */
function setMonth(key) {
  if (!key || key === state.month) return;
  state.month = key;
  listenMonth();
  scheduleRender();
}

/** Przełącza tryb planera (dzień ⇄ miesiąc) i uruchamia właściwy nasłuch danych. */
function setPlannerMode(mode) {
  if (mode === state.plannerMode) return;
  state.plannerMode = mode;
  if (mode === 'month') {
    state.month = L.monthKey(L.parseDateKey(state.date) || new Date());
    listenMonth();
  } else {
    state.scrollPlanner = true;
    listenEvents();
  }
  scheduleRender();
}

function pickDate() {
  const input = $('#pl-date');
  input.value = state.date;
  try { input.showPicker(); } catch (e) { input.focus(); input.click(); }
}

function defaultStart() {
  if (state.date !== L.dateKey()) return '09:00';
  const next = Math.ceil(L.nowMinutes() / 15) * 15;
  return L.toHHMM(Math.max(L.DAY_START_MIN, Math.min(next, L.LAST_START_MIN)));
}

/** Pokazuje/ukrywa pola godzinowe vs. całodniowe w formularzu wydarzenia i pilnuje sensownej daty końca. */
function toggleEventAllDayFields(form) {
  const allDay = form.allDay.value === '1';
  $('#ev-timed-fields', form).style.display = allDay ? 'none' : 'grid';
  $('#ev-allday-fields', form).style.display = allDay ? 'block' : 'none';
  $('label[for="ev-date"]', form).textContent = allDay ? 'Data rozpoczęcia' : 'Data';
  if (allDay && (!form.endDate.value || form.endDate.value < form.date.value)) form.endDate.value = form.date.value;
}

/** Formularz wydarzenia (nowe albo edycja) – godzinowe albo całodniowe/wielodniowe. */
function openEventSheet({ id, startTime, endTime, date } = {}) {
  const ev = id ? state.events.find((e) => e.id === id) : null;
  if (id && !ev) return;
  const allDay = ev ? !!ev.allDay : false;
  const start = ev ? (ev.startTime || defaultStart()) : (startTime || defaultStart());
  const v = ev
    ? {
      title: ev.title, date: ev.date, start: ev.startTime || start,
      end: ev.endTime || L.toHHMM(Math.min(L.toMinutes(start) + 60, 23 * 60 + 59)),
      endDate: ev.endDate || ev.date, color: L.safeColor(ev.colorCode), description: ev.description || '',
    }
    : {
      title: '', date: date || state.date, start, end: endTime || L.toHHMM(Math.min(L.toMinutes(start) + 60, 23 * 60 + 59)),
      endDate: date || state.date, color: L.DEFAULT_EVENT_COLOR, description: '',
    };
  const swatches = L.EVENT_COLORS.map((c) => `<label class="swatch" title="${c.name}">
      <input type="radio" name="color" value="${c.hex}" class="sr-only" aria-label="${c.name}" ${c.hex.toLowerCase() === v.color.toLowerCase() ? 'checked' : ''}>
      <span class="swatch-dot" style="background:${c.hex}">${icon('check')}</span></label>`).join('');
  openSheet({
    title: ev ? 'Edytuj wydarzenie' : 'Nowe wydarzenie',
    body: `<form data-form="event" data-id="${esc(id || '')}" style="display:flex;flex-direction:column;gap:.9rem" novalidate>
      <div><label class="label" for="ev-title">Nazwa</label>
        <input id="ev-title" name="title" class="field" maxlength="120" value="${esc(v.title)}" ${ev ? '' : 'autofocus'} autocomplete="off"></div>

      <div><label class="label" for="ev-desc">Opis (opcjonalnie)</label>
        <textarea id="ev-desc" name="description" class="field" maxlength="${L.MAX_EVENT_DESC}" rows="3">${esc(v.description)}</textarea></div>

      <fieldset class="seg-field"><legend class="sr-only">Rodzaj wydarzenia</legend>
        <div class="seg">
          <label class="seg-opt"><input type="radio" name="allDay" value="0" class="sr-only" ${allDay ? '' : 'checked'}><span>Godzinowe</span></label>
          <label class="seg-opt"><input type="radio" name="allDay" value="1" class="sr-only" ${allDay ? 'checked' : ''}><span>Całodniowe</span></label>
        </div>
      </fieldset>

      <div><label class="label" for="ev-date">${allDay ? 'Data rozpoczęcia' : 'Data'}</label><input id="ev-date" name="date" type="date" class="field" value="${esc(v.date)}"></div>

      <div id="ev-timed-fields" style="display:${allDay ? 'none' : 'grid'};grid-template-columns:1fr 1fr;gap:.75rem">
        <div><label class="label" for="ev-start">Początek</label><input id="ev-start" name="start" type="time" min="06:00" class="field" value="${esc(v.start)}"></div>
        <div><label class="label" for="ev-end">Koniec</label><input id="ev-end" name="end" type="time" class="field" value="${esc(v.end)}"></div>
      </div>

      <div id="ev-allday-fields" style="display:${allDay ? 'block' : 'none'}">
        <label class="label" for="ev-enddate">Data zakończenia</label>
        <input id="ev-enddate" name="endDate" type="date" class="field" value="${esc(v.endDate)}">
      </div>

      <fieldset><legend class="label">Kolor</legend><div class="swatches">${swatches}</div></fieldset>
      <p class="form-error hide" role="alert"></p>
      <div style="display:flex;gap:.5rem">
        ${ev ? `<button type="button" class="btn btn-lg btn-danger" data-act="ev-del" data-id="${esc(ev.id)}" aria-label="Usuń wydarzenie">${icon('trash-2')}</button>` : ''}
        <button type="submit" class="btn btn-lg btn-primary" style="flex:1">${ev ? 'Zapisz zmiany' : 'Dodaj wydarzenie'}</button>
      </div></form>`,
  });
}

// ===================================================================== 7. ZADANIA
/** Nazwa aktualnie wybranej listy zadań (null/brak = lista domyślna „Zadania”). */
function currentListName() {
  if (!state.currentListId) return 'Zadania';
  const l = state.taskLists.find((x) => x.id === state.currentListId);
  return l ? l.name : 'Zadania';
}

/** Przełącza aktywną listę zadań i zapamiętuje wybór (tylko wygoda UI – nie ma tego w bazie). */
function setCurrentList(id) {
  const next = id || null;
  if (next === state.currentListId) return;
  state.currentListId = next;
  try {
    if (next) localStorage.setItem('lifeos-tasklist', next);
    else localStorage.removeItem('lifeos-tasklist');
  } catch (e) { /* prywatny tryb */ }
  TasksView.addingSubtaskFor = null;
  scheduleRender();
}

function openListSwitcher() {
  const others = [...state.taskLists].sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  const rows = [{ id: null, name: 'Zadania' }, ...others].map((l) => {
    const active = (l.id || null) === state.currentListId;
    const count = L.tasksInList(state.tasks, l.id).filter((t) => !t.completed).length;
    return `<li style="display:flex;align-items:center;gap:.15rem">
        <button type="button" class="btn btn-plain" style="flex:1;justify-content:flex-start;gap:.6rem;min-height:52px" data-act="ta-list-pick" data-id="${esc(l.id || '')}" aria-pressed="${active}">
          ${active ? icon('check', 'ic') : '<span class="ic" aria-hidden="true"></span>'}
          <span style="flex:1;text-align:left;overflow-wrap:anywhere">${esc(l.name)}</span>
          ${count ? `<span class="text-muted" style="font-size:.85rem">${count}</span>` : ''}</button>
        ${l.id ? `<button type="button" class="icon-btn" data-act="ta-list-rename" data-id="${esc(l.id)}" aria-label="Zmień nazwę listy: ${esc(l.name)}">${icon('pencil')}</button>
          <button type="button" class="icon-btn danger" data-act="ta-list-del" data-id="${esc(l.id)}" aria-label="Usuń listę: ${esc(l.name)}">${icon('trash-2')}</button>` : ''}
      </li>`;
  }).join('');
  openSheet({
    title: 'Listy zadań',
    body: `<ul class="space-y-2" role="list" style="margin-bottom:1.1rem">${rows}</ul>
      <form data-form="tasklist" style="display:flex;flex-direction:column;gap:.5rem">
        <div style="display:flex;gap:.5rem">
          <label class="sr-only" for="tl-name">Nazwa nowej listy</label>
          <input id="tl-name" name="name" class="field" style="flex:1;min-width:0" placeholder="Nowa lista…" maxlength="${L.MAX_LIST_NAME}" autocomplete="off">
          <button type="submit" class="btn btn-primary" style="width:48px;padding:0" aria-label="Utwórz listę">${icon('plus')}</button>
        </div>
        <p class="form-error hide" role="alert"></p>
      </form>`,
  });
}

function openListRename(id) {
  const l = state.taskLists.find((x) => x.id === id);
  if (!l) return;
  openSheet({
    title: 'Zmień nazwę listy',
    body: `<form data-form="tasklist-rename" data-id="${esc(id)}" style="display:flex;flex-direction:column;gap:.9rem">
      <div><label class="label" for="tlr-name">Nazwa</label>
        <input id="tlr-name" name="name" class="field" maxlength="${L.MAX_LIST_NAME}" value="${esc(l.name)}" autofocus autocomplete="off"></div>
      <p class="form-error hide" role="alert"></p>
      <button type="submit" class="btn btn-lg btn-primary">Zapisz</button></form>`,
  });
}

/** Usuwa listę razem z jej zadaniami (jeden batch = jeden „Cofnij”, tak jak przy usuwaniu działu fiszek). */
async function deleteTaskList(id) {
  const l = state.taskLists.find((x) => x.id === id);
  if (!l) return;
  const items = state.tasks.filter((t) => t.listId === id);
  const ok = await confirmSheet({
    title: `Usunąć listę „${l.name}”?`,
    message: items.length
      ? `Razem z listą zostanie usuniętych: ${L.plural(items.length, WORDS.task)}. Zaraz po usunięciu możesz to cofnąć.`
      : 'Ta lista jest pusta.',
    confirmLabel: 'Usuń listę',
  });
  if (!ok) return;
  if (state.currentListId === id) setCurrentList(null);
  const raws = items.map((it) => ({ id: it.id, raw: toRaw(it) }));
  const listRaw = toRaw(l);
  const batch = writeBatch(db);
  items.forEach((t) => batch.delete(docRef('tasks', t.id)));
  batch.delete(docRef('task_lists', id));
  batch.commit().catch(dbError);
  toast(`Usunięto listę „${l.name}”${items.length ? ` i ${L.plural(items.length, WORDS.task)}` : ''}`, {
    action: 'Cofnij', ms: 9000,
    onAction: () => {
      const undo = writeBatch(db);
      undo.set(docRef('task_lists', id), listRaw);
      raws.forEach((r) => undo.set(docRef('tasks', r.id), r.raw));
      undo.commit().catch(dbError);
    },
  });
}

/** Skok z „terminu zadania” w Planerze do tego zadania w Zadaniach: przełącza listę i podświetla wiersz. */
function gotoTaskFromDeadline(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  setCurrentList(t.listId || null);
  TasksView.scrollToId = id;
  location.hash = '#/zadania';
}

/** Edycja istniejącego zadania/podzadania: nazwa, priorytet (tylko zadania główne) i termin. */
function openTaskSheet(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const isSub = !!t.parentId;
  const prioField = isSub ? '' : `<fieldset class="seg-field"><legend class="label">Priorytet</legend>
      <div class="seg">${L.PRIORITIES.map((p) => `<label class="seg-opt"><input type="radio" name="priority" value="${p}" class="sr-only" ${t.priority === p ? 'checked' : ''}><span>${L.PRIORITY_LABEL[p]}</span></label>`).join('')}</div></fieldset>`;
  openSheet({
    title: isSub ? 'Edytuj podzadanie' : 'Edytuj zadanie',
    body: `<form data-form="task-edit" data-id="${esc(id)}" style="display:flex;flex-direction:column;gap:.9rem" novalidate>
      <div><label class="label" for="te-title">Nazwa</label>
        <input id="te-title" name="title" class="field" maxlength="200" value="${esc(t.title)}" autofocus autocomplete="off"></div>
      ${prioField}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
        <div><label class="label" for="te-date">Termin (opcjonalnie)</label><input id="te-date" name="deadlineDate" type="date" class="field" value="${esc(t.deadlineDate || '')}"></div>
        <div><label class="label" for="te-time">Godzina</label><input id="te-time" name="deadlineTime" type="time" class="field" value="${esc(t.deadlineTime || '')}"></div>
      </div>
      <p class="form-hint">Godzina ma sens tylko razem z datą. Wyczyść pole daty, żeby usunąć termin.</p>
      <p class="form-error hide" role="alert"></p>
      <div style="display:flex;gap:.5rem">
        <button type="button" class="btn btn-lg btn-danger" data-act="ta-del" data-id="${esc(id)}" aria-label="Usuń ${isSub ? 'podzadanie' : 'zadanie'}: ${esc(t.title)}">${icon('trash-2')}</button>
        <button type="submit" class="btn btn-lg btn-primary" style="flex:1">Zapisz zmiany</button>
      </div></form>`,
  });
}

/** Mały arkusz z rzadziej używanymi akcjami na zadaniu: przesuwanie w górę/dół, dodanie podzadania. */
function openTaskRowMenu(id, { up = false, down = false, addsub = false } = {}) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const rowBtn = (act, ic, label) => `<button type="button" class="btn btn-plain" style="width:100%;justify-content:flex-start;gap:.6rem;min-height:52px" data-act="${act}" data-id="${esc(id)}">${icon(ic)} ${label}</button>`;
  const rows = [
    up ? rowBtn('ta-move-up', 'arrow-up', 'Przesuń wyżej') : '',
    down ? rowBtn('ta-move-down', 'arrow-down', 'Przesuń niżej') : '',
    addsub ? rowBtn('ta-subtask-add', 'corner-down-right', 'Dodaj podzadanie') : '',
  ].filter(Boolean).join('');
  openSheet({ title: t.title, body: `<div style="display:flex;flex-direction:column;gap:.35rem">${rows}</div>` });
}

const TasksView = {
  mounted: false, prio: 'medium', focusId: null, scrollToId: null, addingSubtaskFor: null, focusSubtaskInput: false,

  mount() {
    $('#view').innerHTML = `<div class="page">
        <div class="pl-headrow">
          <h1 class="page-title">Zadania</h1>
          <button type="button" class="btn btn-tonal" data-act="ta-switch-list" id="ta-listbtn" aria-haspopup="dialog"></button>
        </div>
        <p class="page-sub" id="ta-sub"></p><div id="ta-body"></div></div>`;
    $('#dock').innerHTML = `<form data-form="task" class="dock-pill glass" autocomplete="off">
        <label class="sr-only" for="ta-input">Nowe zadanie</label>
        <input id="ta-input" name="title" class="field" style="flex:1;min-width:0" placeholder="Nowe zadanie" maxlength="200" enterkeyhint="done">
        <button type="button" class="chip-btn" data-act="ta-newprio" id="ta-newprio"></button>
        <button type="submit" class="btn btn-primary" style="width:48px;padding:0" aria-label="Dodaj zadanie">${icon('plus')}</button>
      </form>`;
    this.renderPrio();
    $('#main').scrollTop = 0;
    this.mounted = true;
    refreshIcons();
  },
  unmount() { this.mounted = false; this.addingSubtaskFor = null; },

  renderPrio() {
    const b = $('#ta-newprio');
    b.setAttribute('aria-label', `Priorytet nowego zadania: ${L.PRIORITY_LABEL[this.prio]}. Zmień.`);
    b.innerHTML = `<span class="chip chip-${this.prio}">${L.PRIORITY_LABEL[this.prio]}</span>`;
  },
  cycleNew() { this.prio = L.nextPriority(this.prio); this.renderPrio(); },

  row(t, { sub = false, canUp = false, canDown = false, canAddSub = false } = {}) {
    const done = !!t.completed;
    const prioBtn = sub ? '' : `<button type="button" class="chip-btn" data-act="ta-prio" data-id="${esc(t.id)}" aria-label="Priorytet: ${L.PRIORITY_LABEL[t.priority] || L.PRIORITY_LABEL.medium}. Zmień. Zadanie: ${esc(t.title)}">
        <span class="chip chip-${L.PRIORITIES.includes(t.priority) ? t.priority : 'medium'}">${L.PRIORITY_LABEL[t.priority] || L.PRIORITY_LABEL.medium}</span></button>`;
    const showMenu = canUp || canDown || canAddSub;
    const menuBtn = showMenu ? `<button type="button" class="icon-btn" data-act="ta-row-menu" data-id="${esc(t.id)}"
        data-up="${canUp ? '1' : '0'}" data-down="${canDown ? '1' : '0'}" data-addsub="${canAddSub ? '1' : '0'}"
        aria-label="Więcej opcji: ${esc(t.title)}">${icon('more-vertical')}</button>` : '';
    const overdue = L.isTaskOverdue(t);
    const deadline = t.deadlineDate ? `<span class="task-deadline${overdue ? ' overdue' : ''}">${icon(overdue ? 'alarm-clock' : 'calendar', 'ic')}${esc(L.formatTaskDeadline(t.deadlineDate, t.deadlineTime))}</span>` : '';
    return `<li class="card${sub ? ' task-sub' : ''}" data-task="${esc(t.id)}" style="display:flex;align-items:center;gap:.25rem;padding:.25rem .25rem .25rem .35rem">
      <label class="check-wrap"><input type="checkbox" class="check-in sr-only" data-id="${esc(t.id)}" ${done ? 'checked' : ''} aria-label="${done ? 'Ukończone' : 'Do zrobienia'}: ${esc(t.title)}">
        <span class="check-box">${icon('check')}</span></label>
      <button type="button" class="task-title-btn" data-act="ta-edit" data-id="${esc(t.id)}" aria-label="Edytuj ${sub ? 'podzadanie' : 'zadanie'}: ${esc(t.title)}">
        <span class="${done ? 'task-done' : ''}" style="overflow-wrap:anywhere">${esc(t.title)}</span>${deadline}</button>
      ${prioBtn}${menuBtn}
      <button type="button" class="icon-btn danger" data-act="ta-del" data-id="${esc(t.id)}" aria-label="Usuń ${sub ? 'podzadanie' : 'zadanie'}: ${esc(t.title)}">${icon('trash-2')}</button></li>`;
  },

  subtaskForm(parentId) {
    return `<li class="card task-sub" style="padding:.5rem .75rem">
      <form data-form="subtask" data-parent="${esc(parentId)}" style="display:flex;gap:.4rem;align-items:center">
        <label class="sr-only" for="ta-sub-input">Nazwa podzadania</label>
        <input id="ta-sub-input" name="title" class="field" style="flex:1;min-width:0" placeholder="Nazwa podzadania" maxlength="200">
        <button type="submit" class="btn btn-primary" style="width:44px;padding:0" aria-label="Dodaj podzadanie">${icon('plus')}</button>
        <button type="button" class="icon-btn" data-act="ta-subtask-cancel" aria-label="Anuluj dodawanie podzadania">${icon('x')}</button>
      </form></li>`;
  },

  /** `topIdx`/`topTotal`: pozycja TEGO zadania wśród otwartych zadań głównych (do strzałek góra/dół). */
  rowWithChildren(t, { topIdx = -1, topTotal = 0 } = {}) {
    const canUp = !t.completed && topIdx > 0;
    const canDown = !t.completed && topIdx !== -1 && topIdx < topTotal - 1;
    let html = this.row(t, { canUp, canDown, canAddSub: true });
    const openSubs = t.subtasks.filter((s) => !s.completed);
    for (const sub of t.subtasks) {
      const subIdx = openSubs.findIndex((s) => s.id === sub.id);
      html += this.row(sub, {
        sub: true,
        canUp: !sub.completed && subIdx > 0,
        canDown: !sub.completed && subIdx !== -1 && subIdx < openSubs.length - 1,
      });
    }
    if (this.addingSubtaskFor === t.id) html += this.subtaskForm(t.id);
    return html;
  },

  startAddSubtask(id) { this.addingSubtaskFor = id; this.focusSubtaskInput = true; scheduleRender(); },
  cancelAddSubtask() { this.addingSubtaskFor = null; scheduleRender(); },

  update() {
    // Samoleczenie: lista wybrana wcześniej zniknęła (np. skasowana na innym urządzeniu) → wróć do domyślnej.
    if (state.currentListId && !state.taskLists.some((l) => l.id === state.currentListId)) { setCurrentList(null); return; }
    const listTasks = L.tasksInList(state.tasks, state.currentListId);
    const tree = L.buildTaskTree(listTasks);
    const open = tree.filter((t) => !t.completed);
    const done = tree.filter((t) => t.completed);
    const openCount = listTasks.filter((t) => !t.completed).length;

    const btn = $('#ta-listbtn');
    btn.innerHTML = `${esc(currentListName())} ${icon('chevron-down')}`;
    btn.setAttribute('aria-label', `Aktualna lista zadań: ${currentListName()}. Zmień listę.`);

    $('#ta-sub').textContent = listTasks.length ? L.plural(openCount, ['zadanie do zrobienia', 'zadania do zrobienia', 'zadań do zrobienia']) : 'Nic tu jeszcze nie ma.';
    let html = '';
    if (!listTasks.length) {
      html = '<div class="card" style="padding:1.5rem;margin-top:1.25rem"><p style="font-weight:600">Brak zadań</p><p class="text-muted" style="margin-top:.25rem">Wpisz pierwsze zadanie w polu na dole ekranu.</p></div>';
    } else {
      if (open.length) html += `<h2 class="section-title">Do zrobienia</h2><ul class="space-y-2" role="list">${open.map((t, i) => this.rowWithChildren(t, { topIdx: i, topTotal: open.length })).join('')}</ul>`;
      else html += '<div class="card" style="padding:1.25rem;margin-top:1.25rem"><p style="font-weight:600">Wszystko zrobione</p></div>';
      if (done.length) {
        html += `<div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem"><h2 class="section-title">Ukończone (${done.length})</h2>`
          + '<button type="button" class="btn btn-plain" style="margin-top:1rem" data-act="ta-clear-done">Usuń ukończone</button></div>'
          + `<ul class="space-y-2" role="list">${done.map((t) => this.rowWithChildren(t)).join('')}</ul>`;
      }
    }
    $('#ta-body').innerHTML = html;
    refreshIcons();
    if (this.focusId) {
      const cb = $(`[data-task="${CSS.escape(this.focusId)}"] input`);
      if (cb) cb.focus();
      this.focusId = null;
    }
    if (this.scrollToId) {
      const row = $(`[data-task="${CSS.escape(this.scrollToId)}"]`);
      if (row) {
        row.scrollIntoView({ block: 'center' });
        row.classList.add('task-flash');
        setTimeout(() => row.classList.remove('task-flash'), 1500);
      }
      this.scrollToId = null;
    }
    if (this.focusSubtaskInput) {
      const inp = $('#ta-sub-input');
      if (inp) inp.focus();
      this.focusSubtaskInput = false;
    }
  },

  toggle(id, checked) { this.focusId = id; updateDoc(docRef('tasks', id), { completed: checked }).catch(dbError); },
  cyclePriority(id) {
    const t = state.tasks.find((x) => x.id === id);
    if (t) updateDoc(docRef('tasks', id), { priority: L.nextPriority(t.priority) }).catch(dbError);
  },
  /** Przesuwa zadanie o jedno miejsce w górę (-1) albo w dół (+1) wśród otwartego rodzeństwa. */
  move(id, direction) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    const openSiblings = state.tasks.filter((x) => !x.completed
      && (x.listId || null) === (t.listId || null) && (x.parentId || null) === (t.parentId || null));
    const plan = L.planMoveTask(openSiblings, id, direction);
    if (!plan) return;
    const batch = writeBatch(db);
    plan.forEach((p) => batch.update(docRef('tasks', p.id), { order: p.order }));
    batch.commit().catch(dbError);
  },
  /** Usuwa zadanie. Jeśli ma podzadania, kasuje je razem (jeden „Cofnij” przywraca wszystko naraz). */
  remove(id) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    const children = state.tasks.filter((x) => x.parentId === id);
    if (children.length) {
      deleteManyWithUndo('tasks', [t, ...children], `Usunięto zadanie i ${L.plural(children.length, ['podzadanie', 'podzadania', 'podzadań'])}`);
    } else {
      deleteWithUndo('tasks', t, 'Usunięto zadanie');
    }
  },
  /**
   * Usuwa ukończone zadania z AKTUALNEJ listy (nie ze wszystkich list naraz!).
   * Ukończone zadanie główne kasuje też jego podzadania (niezależnie od ich stanu) –
   * samodzielne ukończone podzadanie pod NIEukończonym rodzicem kasuje się osobno.
   */
  async clearDone() {
    const listTasks = L.tasksInList(state.tasks, state.currentListId);
    const doneTop = listTasks.filter((t) => !t.parentId && t.completed);
    const doneTopIds = new Set(doneTop.map((t) => t.id));
    const childrenOfDoneTop = listTasks.filter((t) => t.parentId && doneTopIds.has(t.parentId));
    const doneSubStandalone = listTasks.filter((t) => t.parentId && t.completed && !doneTopIds.has(t.parentId));
    const toDelete = [...doneTop, ...childrenOfDoneTop, ...doneSubStandalone];
    if (!toDelete.length) return;
    const ok = await confirmSheet({ title: 'Usunąć ukończone zadania?', message: `Zostanie usuniętych: ${L.plural(toDelete.length, WORDS.task)} (razem z podzadaniami). Zaraz po usunięciu możesz to cofnąć.`, confirmLabel: 'Usuń ukończone' });
    if (ok) deleteManyWithUndo('tasks', toDelete, `Usunięto ${L.plural(toDelete.length, WORDS.task)}`);
  },
};

// ====================================================================== 8. FISZKI
const cardsHash = (p) => `#/fiszki${[p.subject, p.topic, p.subtopic].filter((v) => v != null).map((v) => `/${encodeURIComponent(v)}`).join('')}`;
const pathName = (p) => [p.subject, p.topic, p.subtopic].filter((v) => v != null).join(' › ');

/** -1 = „Wszystkie fiszki”, inaczej indeks do L.buildScopeOptions(state.cards). */
function scopeIndexToPath(idx) {
  if (!Number.isFinite(idx) || idx === -1) return { subject: null, topic: null, subtopic: null };
  const opt = L.buildScopeOptions(state.cards)[idx];
  return opt ? opt.path : { subject: null, topic: null, subtopic: null };
}

/** <option>/<optgroup> dla wyboru zakresu nauki na pierwszym ekranie Fiszek. */
function buildScopeSelectHtml(opts, idx, allCount) {
  let html = `<option value="-1" ${idx === -1 ? 'selected' : ''}>Wszystkie fiszki (${allCount})</option>`;
  let openGroup = false;
  opts.forEach((o, i) => {
    if (o.depth === 0) {
      if (openGroup) html += '</optgroup>';
      html += `<optgroup label="${esc(o.label)}">`;
      openGroup = true;
      html += `<option value="${i}" ${i === idx ? 'selected' : ''}>${esc(o.label)} — cały przedmiot (${o.total})</option>`;
    } else {
      const prefix = o.depth === 2 ? '—— ' : '— ';
      html += `<option value="${i}" ${i === idx ? 'selected' : ''}>${prefix}${esc(o.label)} (${o.total})</option>`;
    }
  });
  if (openGroup) html += '</optgroup>';
  return html;
}

/** Lista fiszek do przeglądania (przód/tył, edycja, usuwanie) – ten sam znacznik na liście
 * leafa (poziom 3) i na pierwszym ekranie pod wyborem zakresu. */
function cardListHtml(items) {
  const list = [...items].sort((a, b) => (a.createdAtMs - b.createdAtMs) || a.front.localeCompare(b.front, 'pl'));
  return `<ul class="space-y-2" role="list">${list.map((c) => `<li class="card" style="display:flex;gap:.25rem;align-items:flex-start;padding:.75rem .5rem .75rem 1rem">
      <div style="flex:1;min-width:0"><p class="line-clamp-3" style="font-weight:600;overflow-wrap:anywhere">${esc(c.front)}</p>
        <p class="line-clamp-2 text-muted" style="font-size:.9rem;margin-top:.15rem;overflow-wrap:anywhere">${esc(c.back)}</p>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.5rem"><span class="chip chip-${c.status in L.STATUS_LABEL ? c.status : 'new'}">${L.STATUS_LABEL[c.status] || L.STATUS_LABEL.new}</span>${c.type === 'language' ? '<span class="chip chip-lang chip-none">Językowa</span>' : ''}</div></div>
      <button type="button" class="icon-btn" data-act="fc-edit" data-id="${esc(c.id)}" aria-label="Edytuj fiszkę: ${esc(c.front)}">${icon('pencil')}</button>
      <button type="button" class="icon-btn danger" data-act="fc-del" data-id="${esc(c.id)}" aria-label="Usuń fiszkę: ${esc(c.front)}">${icon('trash-2')}</button></li>`).join('')}</ul>`;
}

const CardsView = {
  mounted: false, browseIdx: -1,

  mount() {
    $('#view').innerHTML = '<div class="page" id="fc-page"></div>';
    $('#dock').innerHTML = `<div class="dock-pill glass">
        <button type="button" class="btn btn-primary btn-lg" style="flex:1" data-act="fc-import">${icon('sparkles')} Importuj z AI</button>
        <button type="button" class="btn btn-plain btn-lg" style="min-width:52px;padding:0 .9rem" data-act="fc-new" aria-label="Dodaj fiszkę ręcznie">${icon('plus')}</button>
      </div>`;
    $('#main').scrollTop = 0;
    this.mounted = true;
    this.browseIdx = -1;
    refreshIcons();
  },
  unmount() { this.mounted = false; },

  /** Widget pierwszego ekranu: wybór zakresu nauki + akcje + lista fiszek do przeglądania. */
  renderBrowsePicker() {
    const opts = L.buildScopeOptions(state.cards);
    const path = scopeIndexToPath(this.browseIdx);
    const items = L.filterByPath(state.cards, path);
    const due = items.filter((c) => L.isDue(c)).length;
    const hard = items.filter((c) => c.status === 'hard').length;
    const shown = items.slice(0, L.MAX_BROWSE_SHOWN);
    const overflow = items.length > shown.length
      ? `<p class="text-muted" style="margin-top:.5rem;font-size:.85rem">Pokazano ${shown.length} z ${items.length}. Zwęż wybór powyżej, żeby zobaczyć resztę.</p>` : '';
    return `<div class="card" style="padding:1rem;margin-top:1.25rem">
        <label class="label" for="fc-scope">Z czego się uczyć</label>
        <select id="fc-scope" class="field">${buildScopeSelectHtml(opts, this.browseIdx, state.cards.length)}</select>
        <button type="button" class="btn btn-primary btn-lg" style="width:100%;margin-top:.75rem" data-act="fc-study" data-mode="due" data-scope-idx="${this.browseIdx}" ${due ? '' : 'disabled'}>${icon('play')} ${due ? `Ucz się: ${due} do powtórki` : 'Wszystko powtórzone'}</button>
        <div style="display:flex;gap:.5rem;margin-top:.6rem">
          <button type="button" class="btn btn-plain" style="flex:1" data-act="fc-study" data-mode="all" data-scope-idx="${this.browseIdx}" ${items.length ? '' : 'disabled'}>Wszystkie (${items.length})</button>
          <button type="button" class="btn btn-plain" style="flex:1" data-act="fc-study" data-mode="hard" data-scope-idx="${this.browseIdx}" ${hard ? '' : 'disabled'}>Trudne (${hard})</button>
        </div>
        <button type="button" class="btn btn-tonal" style="width:100%;margin-top:.6rem" data-act="fc-share" data-scope-idx="${this.browseIdx}" ${items.length ? '' : 'disabled'}>${icon('share-2')} Udostępnij (${items.length})</button>
      </div>
      <h2 class="section-title">Fiszki do przeglądania</h2>
      ${items.length ? cardListHtml(shown) + overflow : '<p class="text-muted">Ten zakres jest pusty.</p>'}`;
  },

  update() {
    const path = state.path;
    const level = L.pathLevel(path);
    const inPath = L.filterByPath(state.cards, path);
    const segs = [path.subject, path.topic, path.subtopic].filter((v) => v != null);
    const last = segs.length ? segs[segs.length - 1] : null;

    let html = '';
    if (level > 0) {
      const crumbs = [`<li><a class="btn btn-plain" style="min-height:44px" href="#/fiszki">Fiszki</a></li>`];
      for (let i = 0; i < segs.length - 1; i += 1) {
        const p = { subject: segs[0] ?? null, topic: i >= 1 ? segs[1] : null, subtopic: null };
        if (i === 0) p.topic = null;
        crumbs.push(`<li><a class="btn btn-plain" style="min-height:44px" href="${cardsHash(p)}">${esc(segs[i])}</a></li>`);
      }
      html += `<nav aria-label="Ścieżka"><ol style="display:flex;flex-wrap:wrap;gap:.35rem;margin-bottom:.75rem">${crumbs.join('')}</ol></nav>`;
    }
    html += `<h1 class="page-title" style="overflow-wrap:anywhere">${esc(last ?? 'Fiszki')}</h1>`;
    html += `<p class="page-sub">${esc(inPath.length ? L.plural(inPath.length, WORDS.card) : (level ? 'Ten dział jest pusty.' : 'Nie masz jeszcze fiszek.'))}</p>`;

    if (!state.cards.length) {
      html += `<div class="card" style="padding:1.5rem;margin-top:1.25rem"><p style="font-weight:600">Zacznij od importu z AI</p>
        <p class="text-muted" style="margin-top:.35rem;line-height:1.5">Dotknij „Importuj z AI” na dole, skopiuj gotowy prompt, wklej go do Claude i wklej z powrotem odpowiedź. Możesz też dodać pojedynczą fiszkę przyciskiem plus.</p></div>`;
    } else if (!inPath.length) {
      html += '<div class="card" style="padding:1.5rem;margin-top:1.25rem"><p class="text-muted">W tym miejscu nie ma już fiszek. Wróć wyżej przez ścieżkę na górze.</p></div>';
    } else if (level === 0) {
      html += this.renderBrowsePicker();
      html += `<h2 class="section-title">Przedmioty</h2><ul class="space-y-2" role="list">`;
      html += L.listGroups(state.cards, path).map((g) => {
        const next = { ...path, [L.CARD_FIELDS[level]]: g.name };
        return `<li><a class="card card-link" href="${cardsHash(next)}"><span style="flex:1;min-width:0"><span style="display:block;font-weight:600;overflow-wrap:anywhere">${esc(g.name)}</span>
          <span class="text-muted" style="font-size:.9rem">${L.plural(g.total, WORDS.card)}</span></span>
          ${g.due ? `<span class="chip chip-good chip-none">${g.due} do powtórki</span>` : ''}${g.hard ? `<span class="chip chip-hard chip-none">${g.hard} trudnych</span>` : ''}
          ${icon('chevron-right', 'ic text-muted')}</a></li>`;
      }).join('');
      html += '</ul>';
    } else {
      const due = inPath.filter((c) => L.isDue(c)).length;
      const hard = inPath.filter((c) => c.status === 'hard').length;
      html += `<div class="card" style="padding:1rem;margin-top:1.25rem">
        <button type="button" class="btn btn-primary btn-lg" style="width:100%" data-act="fc-study" data-mode="due" ${due ? '' : 'disabled'}>${icon('play')} ${due ? `Ucz się: ${due} do powtórki` : 'Wszystko powtórzone'}</button>
        <div style="display:flex;gap:.5rem;margin-top:.6rem">
          <button type="button" class="btn btn-plain" style="flex:1" data-act="fc-study" data-mode="all">Wszystkie (${inPath.length})</button>
          <button type="button" class="btn btn-plain" style="flex:1" data-act="fc-study" data-mode="hard" ${hard ? '' : 'disabled'}>Trudne (${hard})</button>
        </div>
        <button type="button" class="btn btn-tonal" style="width:100%;margin-top:.6rem" data-act="fc-share">${icon('share-2')} Udostępnij ten dział (${inPath.length})</button></div>`;

      if (level < 3) {
        html += `<h2 class="section-title">${['Przedmioty', 'Tematy', 'Zagadnienia'][level]}</h2><ul class="space-y-2" role="list">`;
        html += L.listGroups(state.cards, path).map((g) => {
          const next = { ...path, [L.CARD_FIELDS[level]]: g.name };
          return `<li><a class="card card-link" href="${cardsHash(next)}"><span style="flex:1;min-width:0"><span style="display:block;font-weight:600;overflow-wrap:anywhere">${esc(g.name)}</span>
            <span class="text-muted" style="font-size:.9rem">${L.plural(g.total, WORDS.card)}</span></span>
            ${g.due ? `<span class="chip chip-good chip-none">${g.due} do powtórki</span>` : ''}${g.hard ? `<span class="chip chip-hard chip-none">${g.hard} trudnych</span>` : ''}
            ${icon('chevron-right', 'ic text-muted')}</a></li>`;
        }).join('');
        html += '</ul>';
      } else {
        html += `<h2 class="section-title">Fiszki</h2>${cardListHtml(inPath)}`;
      }
      html += `<div style="margin-top:2rem"><button type="button" class="btn btn-danger" data-act="fc-del-group">${icon('trash-2')} Usuń ten dział (${inPath.length})</button></div>`;
    }
    $('#fc-page').innerHTML = html;
    refreshIcons();
  },
};

/** Ręczne dodawanie i edycja fiszki. Walidację robi ten sam kod, co przy imporcie z AI. */
function openCardSheet(id) {
  const c = id ? state.cards.find((x) => x.id === id) : null;
  if (id && !c) return;
  const v = c || { subject: state.path.subject ?? '', topic: state.path.topic ?? '', subtopic: state.path.subtopic ?? '', type: 'standard', front: '', back: '' };
  const uniq = (f) => [...new Set(state.cards.map((x) => x[f]))].sort((a, b) => a.localeCompare(b, 'pl'));
  const dl = (name, field) => `<datalist id="dl-${name}">${uniq(field).map((s) => `<option value="${esc(s)}"></option>`).join('')}</datalist>`;
  const lang = v.type === 'language';
  const seg = (val, label) => `<label style="flex:1"><input type="radio" name="type" value="${val}" class="peer sr-only" ${v.type === val ? 'checked' : ''}>
      <span class="btn btn-plain w-full peer-checked:bg-brand peer-checked:text-[rgb(var(--on-brand))] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2">${label}</span></label>`;
  openSheet({
    title: c ? 'Edytuj fiszkę' : 'Nowa fiszka',
    body: `<form data-form="card" data-id="${esc(id || '')}" style="display:flex;flex-direction:column;gap:.9rem" novalidate>
      <div><label class="label" for="cd-subject">Przedmiot</label><input id="cd-subject" name="subject" class="field" list="dl-subject" maxlength="120" value="${esc(v.subject)}" autocomplete="off">${dl('subject', 'subject')}</div>
      <div><label class="label" for="cd-topic">Temat</label><input id="cd-topic" name="topic" class="field" list="dl-topic" maxlength="120" value="${esc(v.topic)}" autocomplete="off">${dl('topic', 'topic')}</div>
      <div><label class="label" for="cd-subtopic">Zagadnienie</label><input id="cd-subtopic" name="subtopic" class="field" list="dl-subtopic" maxlength="120" value="${esc(v.subtopic)}" autocomplete="off">${dl('subtopic', 'subtopic')}</div>
      <fieldset><legend class="label">Rodzaj fiszki</legend><div style="display:flex;gap:.5rem">${seg('standard', 'Pytanie i odpowiedź')}${seg('language', 'Językowa')}</div></fieldset>
      <div><label class="label" for="cd-front" id="cd-front-l">${lang ? 'Przód (po polsku)' : 'Przód (pytanie)'}</label><textarea id="cd-front" name="front" class="field" maxlength="4000">${esc(v.front)}</textarea></div>
      <div><label class="label" for="cd-back" id="cd-back-l">${lang ? 'Tył (w języku obcym)' : 'Tył (odpowiedź)'}</label><textarea id="cd-back" name="back" class="field" maxlength="4000">${esc(v.back)}</textarea></div>
      <p class="form-error hide" role="alert"></p>
      <button type="submit" class="btn btn-lg btn-primary">${c ? 'Zapisz zmiany' : 'Dodaj fiszkę'}</button></form>`,
    onMount: (dlg) => {
      dlg.addEventListener('change', (e) => {
        if (e.target.name !== 'type') return;
        const isLang = e.target.value === 'language';
        $('#cd-front-l', dlg).textContent = isLang ? 'Przód (po polsku)' : 'Przód (pytanie)';
        $('#cd-back-l', dlg).textContent = isLang ? 'Tył (w języku obcym)' : 'Tył (odpowiedź)';
      });
    },
  });
}

// ================================================================ 9. IMPORT Z AI
const AI_PROMPT = [
  'Jesteś autorem fiszek do nauki. Przygotuj fiszki jako dane do importu do mojej aplikacji.',
  '',
  'PRZEDMIOT: [[np. Prawo morskie]]',
  'TEMAT: [[np. Konwencja MARPOL]]',
  'ZAGADNIENIE: [[np. Załącznik I, zanieczyszczenie olejem]]',
  'LICZBA FISZEK: [[np. 20]]',
  'POZIOM: [[np. egzamin zawodowy / liceum / rozszerzony]]',
  'TYP: [[standard albo language]]',
  'JĘZYK OBCY (tylko dla language): [[np. angielski]]',
  'MATERIAŁ (opcjonalnie): [[wklej notatki; jeśli puste, użyj własnej wiedzy]]',
  '',
  'ZASADY:',
  '1. Odpowiedz WYŁĄCZNIE jedną tablicą JSON w jednym bloku kodu ```json. Żadnego tekstu przed ani po.',
  '2. Każda fiszka to obiekt z polami: "subject", "topic", "subtopic", "type", "front", "back". Wszystkie są tekstowe i wszystkie wymagane.',
  '3. "subject", "topic" i "subtopic" mają być identyczne we wszystkich fiszkach tej paczki (te same znaki, ta sama wielkość liter), zgodnie z moimi danymi powyżej. Maks. 120 znaków każde.',
  '4. "type": "standard" (front = pytanie, back = odpowiedź) albo "language" (front = słowo lub zdanie po polsku, back = tłumaczenie na język obcy).',
  '5. Jedna fiszka = jeden fakt. Front krótki i jednoznaczny. Back zwięzły (najlepiej do 300 znaków, twardy limit 4000). Nową linię w polu zapisz jako \\n.',
  '6. Poprawny JSON: cudzysłów wewnątrz tekstu jako \\", bez przecinka po ostatnim elemencie, bez komentarzy.',
  '7. Bez duplikatów: ten sam "front" nie może wystąpić dwa razy w jednym zagadnieniu.',
  '8. Maksymalnie 1000 fiszek w odpowiedzi.',
  '9. Nie zgaduj. Jeśli nie jesteś pewien liczby, daty, wartości granicznej albo numeru przepisu, pomiń tę fiszkę.',
  '10. Jeśli brakuje mi przedmiotu, tematu, zagadnienia albo języka obcego, zapytaj mnie zamiast wymyślać.',
  '',
  'FORMAT ODPOWIEDZI:',
  '```json',
  '[',
  '  {',
  '    "subject": "Prawo morskie",',
  '    "topic": "MARPOL",',
  '    "subtopic": "Załącznik I",',
  '    "type": "standard",',
  '    "front": "Co reguluje Załącznik I MARPOL?",',
  '    "back": "Zapobieganie zanieczyszczeniu olejem."',
  '  }',
  ']',
  '```',
].join('\n');

function openImport() {
  openSheet({
    title: 'Importuj fiszki z AI',
    body: `<form data-form="import" style="display:flex;flex-direction:column;gap:.9rem" novalidate>
      <p class="text-muted" style="font-size:.95rem;line-height:1.5">Skopiuj prompt, wklej go do Claude, uzupełnij pola w [[ ]], a odpowiedź wklej poniżej.</p>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        <button type="button" class="btn btn-tonal" data-act="imp-copy">${icon('copy')} Kopiuj prompt dla Claude</button>
        <button type="button" class="btn btn-plain" data-act="imp-paste">${icon('clipboard-paste')} Wklej ze schowka</button>
      </div>
      <div><label class="label" for="imp-text">Dane JSON z AI</label>
        <textarea id="imp-text" class="field" style="min-height:11rem;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.85rem" spellcheck="false" placeholder='[ { "subject": "…", "topic": "…", "subtopic": "…", "type": "standard", "front": "…", "back": "…" } ]'></textarea></div>
      <div id="imp-status" class="form-hint" role="status" aria-live="polite">Wklej dane, a sprawdzę je od razu.</div>
      <button type="submit" class="btn btn-lg btn-primary" id="imp-go">Importuj</button></form>`,
    onMount: (dlg) => {
      const ta = $('#imp-text', dlg);
      let timer;
      ta.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(previewImport, 250); });
    },
  });
}

function previewImport() {
  const ta = $('#imp-text');
  const box = $('#imp-status');
  if (!ta || !box) return;
  if (!ta.value.trim()) { setStatus(box, 'hint', 'Wklej dane, a sprawdzę je od razu.'); return; }
  const r = L.parseImport(ta.value, state.cards);
  if (!r.ok) { setStatus(box, 'error', r.error); return; }
  const dup = r.duplicates ? ` Pominę ${L.plural(r.duplicates, ['duplikat', 'duplikaty', 'duplikatów'])}.` : '';
  setStatus(box, 'ok', r.cards.length
    ? `Gotowe do importu: ${L.plural(r.cards.length, WORDS.card)}.${dup}`
    : `Wszystkie fiszki z tej paczki już istnieją.${dup}`);
}

// ======================================================= 9b. UDOSTĘPNIANIE FISZEK
/**
 * Tworzy paczkę do udostępnienia z fiszek aktualnie widocznych w danym miejscu drzewa
 * (cały zbiór, przedmiot, temat albo zagadnienie – to, co jest w `state.path`).
 * Zapis idzie w JEDNYM batchu: sama paczka (`shares/{id}`, do pobrania przez link)
 * + wskaźnik właściciela (`users/{uid}/shares_sent/{id}`, żeby dało się ją potem cofnąć).
 */
async function shareCurrentPath(path = state.path) {
  const items = L.filterByPath(state.cards, path);
  const sizeError = L.validateShareSize(items.length);
  if (sizeError) { toast(sizeError, { ms: 8000 }); return; }
  openSheet({ title: 'Udostępnianie…', body: '<p class="text-muted" style="padding:1rem 0">Tworzę link…</p>' });
  try {
    const shareRef = doc(collection(db, 'shares'));
    const pointerRef = docRef('shares_sent', shareRef.id);
    const label = pathName(path) || 'Wszystkie fiszki';
    const batch = writeBatch(db);
    batch.set(shareRef, { ownerUid: state.user.uid, createdAt: serverTimestamp(), cards: L.buildShareSnapshot(items) });
    batch.set(pointerRef, { createdAt: serverTimestamp(), cardCount: items.length, label });
    await batch.commit();
    const link = `${location.origin}${location.pathname}#/udostepnij/${shareRef.id}`;
    openSheet({
      title: 'Link gotowy',
      body: `<p class="text-muted" style="line-height:1.5">Wyślij ten link drugiej osobie (np. na czacie albo mailem). Gdy otworzy go w aplikacji i zaloguje się na SWOIM koncie, będzie mogła dodać ${L.plural(items.length, WORDS.card)} do siebie – Twoje fiszki się przy tym nie zmienią.</p>
        <p id="share-link-text" class="field" style="margin-top:1rem;overflow-wrap:anywhere;user-select:all;font-size:.85rem">${esc(link)}</p>
        <button type="button" class="btn btn-lg btn-primary" style="margin-top:1rem;width:100%" id="share-link-copy">${icon('copy')} Kopiuj link</button>
        <p class="form-hint" style="margin-top:.9rem">Link nie wygasa sam. Możesz go cofnąć w „Konto → Moje udostępnienia fiszek”.</p>`,
      onMount: (dlg) => {
        $('#share-link-copy', dlg).addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(link); toast('Link skopiowany.'); } catch (e) { toast('Nie udało się skopiować. Zaznacz i skopiuj link ręcznie.', { ms: 7000 }); }
        });
      },
    });
  } catch (err) { dbError(err); closeSheet(); }
}

function renderShareImportError(message) {
  openSheet({
    title: 'Udostępnianie fiszek',
    body: `<p class="text-muted" style="line-height:1.5">${esc(message)}</p>
      <button type="button" class="btn btn-lg btn-primary" style="margin-top:1rem" data-act="sheet-close">Zamknij</button>`,
  });
}

/** Odbiór paczki z linku #/udostepnij/{id}: pobiera dokument, waliduje TĄ SAMĄ funkcją co ręczny import. */
async function openShareImport(shareId) {
  openSheet({ title: 'Otrzymana paczka fiszek', body: '<p class="text-muted" style="padding:1rem 0">Wczytuję…</p>' });
  let snap;
  try {
    snap = await getDoc(doc(db, 'shares', shareId));
  } catch (err) {
    console.error(err);
    renderShareImportError('Nie udało się pobrać paczki. Sprawdź połączenie z internetem i spróbuj otworzyć link ponownie.');
    return;
  }
  if (!$('#sheet').open) return; // arkusz zamknięty, zanim dane doszły – nie podmieniamy go pod użytkownikiem
  if (!snap.exists()) { renderShareImportError('Ten link jest nieprawidłowy albo osoba, która go wysłała, cofnęła udostępnienie.'); return; }
  const raw = snap.data();
  const cards = Array.isArray(raw.cards) ? raw.cards : [];
  const r = L.parseImport(JSON.stringify(cards), state.cards);
  if (!r.ok) { renderShareImportError(`Ta paczka jest uszkodzona: ${r.error}`); return; }
  if (!r.cards.length) {
    openSheet({
      title: 'Otrzymana paczka fiszek',
      body: `<p class="text-muted">Wszystkie ${L.plural(cards.length, WORDS.card)} z tej paczki już masz.</p>
        <button type="button" class="btn btn-lg btn-primary" style="margin-top:1rem" data-act="sheet-close">Zamknij</button>`,
    });
    return;
  }
  const path = L.commonPath(r.cards);
  const dup = r.duplicates ? ` (plus ${L.plural(r.duplicates, ['duplikat', 'duplikaty', 'duplikatów'])}, które już masz – zostaną pominięte)` : '';
  openSheet({
    title: 'Otrzymana paczka fiszek',
    body: `<p class="text-muted" style="line-height:1.5">Ktoś udostępnił Ci ${L.plural(r.cards.length, WORDS.card)}${dup}.</p>
      ${path.subject ? `<p style="font-weight:600;margin-top:.5rem;overflow-wrap:anywhere">${esc(pathName(path))}</p>` : ''}
      <button type="button" class="btn btn-lg btn-primary" style="margin-top:1.25rem;width:100%" id="share-import-go">${icon('download')} Dodaj do moich fiszek</button>
      <button type="button" class="btn btn-lg btn-plain" style="margin-top:.5rem;width:100%" data-act="sheet-close">Anuluj</button>`,
    onMount: (dlg) => {
      $('#share-import-go', dlg).addEventListener('click', async () => {
        const btn = $('#share-import-go', dlg);
        btn.disabled = true;
        btn.textContent = 'Zapisuję…';
        try {
          const base = Date.now();
          await Promise.all(commitBatches(r.cards, (b, c, i) => b.set(doc(colRef('flashcards')), { ...c, createdAt: Timestamp.fromMillis(base + i) })));
          closeSheet();
          toast(`Dodano ${L.plural(r.cards.length, WORDS.card)} do Twoich fiszek.`, { ms: 7000 });
          location.hash = cardsHash(path);
        } catch (err) { dbError(err); btn.disabled = false; btn.textContent = 'Dodaj do moich fiszek'; }
      });
    },
  });
}

function renderMySharesSheet(items) {
  const sorted = [...items].sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
  const rows = sorted.map((it) => `<li class="card" style="display:flex;align-items:center;gap:.5rem;padding:.75rem 1rem">
      <span style="flex:1;min-width:0"><span style="display:block;font-weight:600;overflow-wrap:anywhere">${esc(it.label || 'Fiszki')}</span>
      <span class="text-muted" style="font-size:.85rem">${L.plural(it.cardCount || 0, WORDS.card)}</span></span>
      <button type="button" class="icon-btn danger" data-act="fc-share-revoke" data-id="${esc(it.id)}" aria-label="Cofnij udostępnienie: ${esc(it.label || 'Fiszki')}">${icon('trash-2')}</button></li>`).join('');
  openSheet({
    title: 'Moje udostępnienia fiszek',
    body: items.length ? `<ul class="space-y-2" role="list">${rows}</ul>` : '<p class="text-muted">Nie udostępniłeś jeszcze żadnych fiszek.</p>',
  });
}

async function openMyShares() {
  openSheet({ title: 'Moje udostępnienia fiszek', body: '<p class="text-muted" style="padding:1rem 0">Wczytuję…</p>' });
  try {
    const snap = await getDocs(colRef('shares_sent'));
    renderMySharesSheet(snap.docs.map(mapDoc));
  } catch (err) { dbError(err); closeSheet(); }
}

async function revokeShare(id) {
  const ok = await confirmSheet({
    title: 'Cofnąć udostępnienie?',
    message: 'Link przestanie działać. Fiszki, które ktoś już zaimportował do siebie, zostaną u niego – to jego kopia.',
    confirmLabel: 'Cofnij udostępnienie',
  });
  if (!ok) return;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'shares', id));
    batch.delete(docRef('shares_sent', id));
    await batch.commit();
    toast('Cofnięto udostępnienie.');
    openMyShares();
  } catch (err) { dbError(err); }
}

// ================================================================== 10. NAUKA
let study = null;
const findCard = (id) => state.cards.find((c) => c.id === id);
const sizeClass = (t) => (t.length <= 40 ? 't-3' : t.length <= 120 ? 't-2' : t.length <= 300 ? 't-1' : 't-0');

function startStudy(mode, path = state.path) {
  const queue = L.buildStudyQueue(L.filterByPath(state.cards, path), mode);
  if (!queue.length) { toast('Brak fiszek w tym trybie.'); return; }
  study = { queue: queue.map((c) => c.id), index: 0, flipped: false, reversed: false, tally: { hard: 0, good: 0, easy: 0 }, seen: 0 };
  const dlg = $('#study');
  if (!dlg.open) dlg.showModal();
  renderStudy();
}

function ratingButtons() {
  const keys = { hard: '1', good: '2', easy: '3' };
  return `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem">${L.RATINGS.map((r) => `<button type="button" class="btn rate rate-${r}" data-act="st-rate" data-r="${r}" aria-label="${L.RATING_LABEL[r]}, ${L.INTERVAL_HINT[r]}, klawisz ${keys[r]}">
      <span>${L.RATING_LABEL[r]}</span><small>${L.INTERVAL_HINT[r]}</small></button>`).join('')}</div>`;
}

function renderStudy() {
  const dlg = $('#study');
  const s = study;
  if (!s) return;
  if (s.index >= s.queue.length) { renderSummary(); return; }
  const card = findCard(s.queue[s.index]);
  if (!card) { s.index += 1; renderStudy(); return; }
  const rev = s.reversed && card.type === 'language';
  const labels = L.cardLabels(card.type, rev);
  const front = rev ? card.back : card.front;
  const back = rev ? card.front : card.back;
  const hasLang = s.queue.some((id) => { const c = findCard(id); return c && c.type === 'language'; });
  const pct = Math.round((s.index / s.queue.length) * 100);
  dlg.innerHTML = `<div class="study-wrap">
      <header class="study-head">
        <button type="button" class="icon-btn" data-act="st-close" aria-label="Zakończ naukę">${icon('x')}</button>
        <p class="study-count" aria-live="polite">${s.index + 1} z ${s.queue.length}</p>
        ${hasLang ? `<button type="button" class="btn btn-plain" data-act="st-reverse" aria-pressed="${s.reversed}">${icon('repeat')} ${s.reversed ? 'Obcy → polski' : 'Polski → obcy'}</button>` : '<span style="width:44px"></span>'}
      </header>
      <div class="study-bar" aria-hidden="true"><div style="width:${pct}%"></div></div>
      <div class="study-stage"><div class="flip-scene"><div class="flip-card" data-act="st-flip">
        <section class="flip-face flip-front" aria-hidden="false"><p class="face-label">${labels.front}</p><p class="face-text ${sizeClass(front)}">${esc(front)}</p></section>
        <section class="flip-face flip-back" id="face-back" tabindex="-1" aria-hidden="true"><p class="face-label">${labels.back}</p><p class="face-text ${sizeClass(back)}">${esc(back)}</p></section>
      </div></div></div>
      <footer class="study-foot" id="study-foot"><button type="button" class="btn btn-primary btn-lg" style="width:100%" data-act="st-flip" id="st-flipbtn">Pokaż odpowiedź</button></footer>
    </div>`;
  refreshIcons();
  const b = $('#st-flipbtn');
  if (b) b.focus({ preventScroll: true });
}

/** Obrót fiszki (animacja 3D w CSS) i pokazanie przycisków „Trudne / Dobre / Łatwe”. */
function flipCard() {
  if (!study || study.flipped || !$('.flip-card')) return;
  study.flipped = true;
  $('.flip-card').classList.add('is-flipped');
  $('.flip-front').setAttribute('aria-hidden', 'true');
  $('#face-back').setAttribute('aria-hidden', 'false');
  $('#study-foot').innerHTML = ratingButtons();
  $('#face-back').focus({ preventScroll: true });
}

/** Zapisuje ocenę w bazie (status + lastReviewed) i przechodzi do następnej fiszki. */
function rate(r) {
  if (!study || !study.flipped || !L.RATINGS.includes(r)) return;
  const id = study.queue[study.index];
  updateDoc(docRef('flashcards', id), { status: r, lastReviewed: serverTimestamp() }).catch(dbError);
  study.tally[r] += 1;
  study.seen += 1;
  if (r === 'hard') study.queue.push(id); // trudna wraca na koniec tej sesji
  study.index += 1;
  study.flipped = false;
  renderStudy();
}

function renderSummary() {
  const s = study;
  const hardCount = L.filterByPath(state.cards, state.path).filter((c) => c.status === 'hard').length;
  $('#study').innerHTML = `<div class="study-wrap"><div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:1rem">
      <h2 class="page-title" id="sum-h" tabindex="-1">Sesja zakończona</h2>
      <p class="text-muted">Ocenione odpowiedzi: ${s.seen}</p>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem">
        <div class="card" style="padding:1rem"><p class="text-muted" style="font-size:.85rem">Trudne</p><p style="font-size:1.8rem;font-weight:700">${s.tally.hard}</p></div>
        <div class="card" style="padding:1rem"><p class="text-muted" style="font-size:.85rem">Dobre</p><p style="font-size:1.8rem;font-weight:700">${s.tally.good}</p></div>
        <div class="card" style="padding:1rem"><p class="text-muted" style="font-size:.85rem">Łatwe</p><p style="font-size:1.8rem;font-weight:700">${s.tally.easy}</p></div>
      </div></div>
      <footer style="display:flex;flex-direction:column;gap:.5rem">
        ${hardCount ? `<button type="button" class="btn btn-lg btn-plain" data-act="st-again-hard">Ćwicz trudne (${hardCount})</button>` : ''}
        <button type="button" class="btn btn-lg btn-primary" data-act="st-close">Zamknij</button></footer></div>`;
  const h = $('#sum-h');
  if (h) h.focus();
}

function closeStudy() { const d = $('#study'); if (d.open) d.close(); }

// ================================================= 11. KONTO I KOPIA ZAPASOWA
function openAccount() {
  const label = $('[data-sync-text]').textContent;
  openSheet({
    title: 'Konto',
    body: `<p class="text-muted" style="font-size:.9rem">Zalogowano jako</p>
      <p style="font-weight:600;overflow-wrap:anywhere;margin-bottom:.9rem">${esc(state.user ? state.user.email : '')}</p>
      <p class="form-hint" style="margin-bottom:1rem">${esc(label)}</p>
      <div style="display:flex;flex-direction:column;gap:.5rem">
        <button type="button" class="btn btn-lg btn-plain" data-act="backup">${icon('download')} Pobierz kopię zapasową</button>
        <button type="button" class="btn btn-lg btn-plain" data-act="fc-my-shares">${icon('share-2')} Moje udostępnienia fiszek</button>
        <button type="button" class="btn btn-lg btn-danger" data-act="logout">${icon('log-out')} Wyloguj</button></div>
      <p class="text-muted" style="font-size:.8rem;margin-top:1rem">Life OS, wersja ${APP_VERSION}</p>`,
  });
}

/** Pobiera cały zapis Twoich danych do pliku .json (zadania, wydarzenia, fiszki). */
async function backup() {
  toast('Przygotowuję kopię zapasową…');
  try {
    const grab = async (name) => (await getDocs(colRef(name))).docs.map((d) => {
      const out = { id: d.id };
      for (const [k, v] of Object.entries(d.data(SNAP))) out[k] = v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v;
      return out;
    });
    const payload = { aplikacja: 'Life OS', wersja: APP_VERSION, data: new Date().toISOString(), zadania: await grab('tasks'), wydarzenia: await grab('planner_events'), fiszki: await grab('flashcards') };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `life-os-kopia-${L.dateKey()}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`Zapisano plik: ${payload.zadania.length} zadań, ${payload.wydarzenia.length} wydarzeń, ${payload.fiszki.length} fiszek.`, { ms: 7000 });
  } catch (err) {
    console.error(err);
    toast(err && err.code === 'unavailable' ? 'Kopia wymaga połączenia z internetem.' : 'Nie udało się przygotować kopii.', { ms: 7000 });
  }
}

const AUTH_ERRORS = {
  'auth/invalid-credential': 'Nieprawidłowy e-mail lub hasło.',
  'auth/wrong-password': 'Nieprawidłowy e-mail lub hasło.',
  'auth/user-not-found': 'Nieprawidłowy e-mail lub hasło.',
  'auth/invalid-email': 'Podaj poprawny adres e-mail.',
  'auth/missing-password': 'Wpisz hasło.',
  'auth/too-many-requests': 'Za dużo prób. Odczekaj kilka minut i spróbuj ponownie.',
  'auth/network-request-failed': 'Brak połączenia z internetem.',
  'auth/user-disabled': 'To konto zostało wyłączone w Firebase.',
  'auth/operation-not-allowed': 'Logowanie e-mailem i hasłem nie jest włączone w Firebase (PORADNIK.md, krok 4).',
  'auth/unauthorized-domain': 'Ta domena nie jest dozwolona w Firebase (PORADNIK.md, sekcja „Problemy”).',
  'auth/invalid-api-key': 'Nieprawidłowy apiKey w firebase-config.js (PORADNIK.md, krok 6).',
  'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'Nieprawidłowy apiKey w firebase-config.js (PORADNIK.md, krok 6).',
};
function loginMessage(text) {
  const el = $('#login-msg');
  el.textContent = text;
  el.classList.toggle('hide', !text);
}

// ========================================================== 12. ZDARZENIA GLOBALNE
const views = { planer: PlannerView, zadania: TasksView, fiszki: CardsView };
const TITLES = { planer: 'Planer', zadania: 'Zadania', fiszki: 'Fiszki' };

function parseRoute() {
  let parts = [];
  try { parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent); } catch (e) { parts = []; }
  const name = views[parts[0]] ? parts[0] : 'planer';
  const path = name === 'fiszki'
    ? { subject: parts[1] ?? null, topic: parts[2] ?? null, subtopic: parts[3] ?? null }
    : { subject: null, topic: null, subtopic: null };
  return { name, path };
}

let lastHandledShare = null;

function route() {
  if (!state.user) return;
  const shareMatch = /^#\/udostepnij\/([^/]+)$/.exec(location.hash);
  if (shareMatch) {
    // Nie zmieniamy trasy pod spodem – arkusz z paczką po prostu otwiera się na wierzchu.
    // Jeśli to pierwsza rzecz po zalogowaniu, trzeba jednak zamontować JAKIŚ widok (inaczej pusty ekran za arkuszem).
    if (!state.route) { state.route = 'planer'; views.planer.mount(); views.planer.update(); updateNav(); }
    const shareId = decodeURIComponent(shareMatch[1]);
    if (lastHandledShare !== shareId) { lastHandledShare = shareId; openShareImport(shareId); }
    return;
  }
  const r = parseRoute();
  state.path = r.path;
  if (r.name !== state.route || !views[r.name].mounted) {
    if (state.route && views[state.route].mounted) views[state.route].unmount();
    state.route = r.name;
    views[r.name].mount();
  }
  document.title = `${TITLES[r.name]} - Life OS`;
  views[r.name].update();
  updateNav();
}

function updateNav() {
  $$('[data-nav]').forEach((a) => { if (a.dataset.nav === state.route) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const setBadge = (name, label, n, text) => $$(`[data-badge="${name}"]`).forEach((b) => {
    b.textContent = n > 99 ? '99+' : String(n);
    b.classList.toggle('hide', n === 0);
    const link = b.closest('a');
    if (n > 0) link.setAttribute('aria-label', `${label}, ${text}`); else link.removeAttribute('aria-label');
  });
  const open = state.tasks.filter((t) => !t.completed).length;
  const due = state.cards.filter((c) => L.isDue(c)).length;
  setBadge('zadania', 'Zadania', open, `${open} do zrobienia`);
  setBadge('fiszki', 'Fiszki', due, `${due} do powtórki`);
}

function updateSyncUI() {
  const pending = state.pending.tasks || state.pending.cards || state.pending.events;
  const mode = !state.online ? 'offline' : pending ? 'pending' : 'ok';
  if (mode === state.syncShown) return;
  state.syncShown = mode;
  const map = {
    ok: ['cloud-check', 'Zsynchronizowano'],
    pending: ['cloud-upload', 'Zapisywanie zmian'],
    offline: ['cloud-off', 'Brak połączenia. Zmiany zapiszą się po odzyskaniu sieci'],
  };
  const [ic, label] = map[mode];
  $$('[data-sync]').forEach((el) => { el.setAttribute('aria-label', label); el.innerHTML = icon(ic); });
  $$('[data-sync-text]').forEach((el) => { el.textContent = label; });
  refreshIcons();
}

const actions = {
  theme: () => setTheme(!isDark()),
  account: () => openAccount(),
  logout: async () => { closeSheet(); try { await signOut(auth); } catch (e) { toast('Nie udało się wylogować.'); } },
  backup: () => backup(),
  forgot: async () => {
    const email = $('#login-email').value.trim();
    if (!email) { loginMessage('Wpisz adres e-mail, a wyślę link do zmiany hasła.'); $('#login-email').focus(); return; }
    try { await sendPasswordResetEmail(auth, email); loginMessage('Jeśli konto istnieje, wysłaliśmy link do zmiany hasła. Sprawdź także spam.'); } catch (e) { loginMessage(AUTH_ERRORS[e.code] || 'Nie udało się wysłać linku.'); }
  },
  'sheet-close': () => closeSheet(),
  'pl-prev': () => (state.plannerMode === 'month' ? setMonth(L.shiftMonthKey(state.month, -1)) : setDate(L.shiftDateKey(state.date, -1))),
  'pl-next': () => (state.plannerMode === 'month' ? setMonth(L.shiftMonthKey(state.month, 1)) : setDate(L.shiftDateKey(state.date, 1))),
  'pl-today': () => setDate(L.dateKey()),
  'pl-month-today': () => setMonth(L.monthKey()),
  'pl-pick': () => pickDate(),
  'pl-add': () => openEventSheet(),
  'pl-mode-day': () => setDate(state.date),
  'pl-mode-month': () => setPlannerMode('month'),
  'pl-goto-day': (el) => setDate(el.dataset.key),
  'pl-allday-edit': (el) => openEventSheet({ id: el.dataset.id }),
  'ev-del': (el) => {
    const ev = state.events.find((e) => e.id === el.dataset.id);
    closeSheet();
    if (ev) deleteWithUndo('planner_events', ev, 'Usunięto wydarzenie');
  },
  'ta-newprio': () => TasksView.cycleNew(),
  'ta-prio': (el) => TasksView.cyclePriority(el.dataset.id),
  'ta-del': (el) => { closeSheet(); TasksView.remove(el.dataset.id); },
  'ta-clear-done': () => TasksView.clearDone(),
  'ta-switch-list': () => openListSwitcher(),
  'ta-list-pick': (el) => { setCurrentList(el.dataset.id || null); closeSheet(); },
  'ta-list-rename': (el) => openListRename(el.dataset.id),
  'ta-list-del': (el) => deleteTaskList(el.dataset.id),
  'ta-subtask-add': (el) => { closeSheet(); TasksView.startAddSubtask(el.dataset.id); },
  'ta-subtask-cancel': () => TasksView.cancelAddSubtask(),
  'ta-edit': (el) => openTaskSheet(el.dataset.id),
  'ta-row-menu': (el) => openTaskRowMenu(el.dataset.id, { up: el.dataset.up === '1', down: el.dataset.down === '1', addsub: el.dataset.addsub === '1' }),
  'ta-move-up': (el) => { closeSheet(); TasksView.move(el.dataset.id, -1); },
  'ta-move-down': (el) => { closeSheet(); TasksView.move(el.dataset.id, 1); },
  'ta-goto': (el) => gotoTaskFromDeadline(el.dataset.id),
  'fc-import': () => openImport(),
  'fc-new': () => openCardSheet(),
  'fc-edit': (el) => openCardSheet(el.dataset.id),
  'fc-del': (el) => { const c = findCard(el.dataset.id); if (c) deleteWithUndo('flashcards', c, 'Usunięto fiszkę'); },
  'fc-del-group': async () => {
    const items = L.filterByPath(state.cards, state.path);
    if (!items.length) return;
    const ok = await confirmSheet({ title: 'Usunąć cały dział?', message: `Zostanie usuniętych: ${L.plural(items.length, WORDS.card)} z działu „${pathName(state.path)}”. Zaraz po usunięciu możesz to cofnąć.`, confirmLabel: 'Usuń ten dział' });
    if (!ok) return;
    const up = { ...state.path };
    const fields = L.CARD_FIELDS.filter((f) => up[f] != null);
    up[fields[fields.length - 1]] = null;
    location.hash = cardsHash(up);
    deleteManyWithUndo('flashcards', items, `Usunięto ${L.plural(items.length, WORDS.card)}`);
  },
  'fc-study': (el) => startStudy(el.dataset.mode, el.dataset.scopeIdx != null ? scopeIndexToPath(Number(el.dataset.scopeIdx)) : state.path),
  'fc-share': (el) => shareCurrentPath(el && el.dataset.scopeIdx != null ? scopeIndexToPath(Number(el.dataset.scopeIdx)) : state.path),
  'fc-my-shares': () => { closeSheet(); openMyShares(); },
  'fc-share-revoke': (el) => revokeShare(el.dataset.id),
  'st-flip': () => flipCard(),
  'st-rate': (el) => rate(el.dataset.r),
  'st-close': () => closeStudy(),
  'st-reverse': () => { if (study) { study.reversed = !study.reversed; study.flipped = false; renderStudy(); } },
  'st-again-hard': () => { closeStudy(); startStudy('hard'); },
  'imp-copy': async () => {
    try { await navigator.clipboard.writeText(AI_PROMPT); toast('Prompt skopiowany. Wklej go do rozmowy z Claude.'); } catch (e) { toast('Nie udało się skopiować. Prompt znajdziesz w pliku PORADNIK.md.', { ms: 7000 }); }
  },
  'imp-paste': async () => {
    try {
      const text = await navigator.clipboard.readText();
      const ta = $('#imp-text');
      ta.value = text;
      previewImport();
    } catch (e) { toast('Przeglądarka zablokowała schowek. Wklej dane ręcznie w pole (Ctrl+V).', { ms: 7000 }); }
  },
};

const forms = {
  login: async (f) => {
    const btn = $('#login-btn');
    loginMessage('');
    btn.disabled = true;
    btn.textContent = 'Loguję…';
    try {
      await signInWithEmailAndPassword(auth, f.email.value.trim(), f.password.value);
    } catch (e) {
      loginMessage(AUTH_ERRORS[e.code] || `Nie udało się zalogować (${e.code || 'błąd'}).`);
    } finally { btn.disabled = false; btn.textContent = 'Zaloguj się'; }
  },

  task: (f) => {
    const input = f.title;
    const title = input.value.trim();
    if (!title) { input.focus(); return; }
    const siblings = state.tasks.filter((x) => !x.completed && !x.parentId && (x.listId || null) === (state.currentListId || null));
    const order = L.nextOrderValue(siblings);
    addDoc(colRef('tasks'), {
      title, completed: false, priority: TasksView.prio, createdAt: serverTimestamp(),
      ...(state.currentListId ? { listId: state.currentListId } : {}),
      ...(order != null ? { order } : {}),
    }).catch(dbError);
    input.value = '';
    input.focus();
  },

  subtask: (f) => {
    const title = String(new FormData(f).get('title') || '').trim();
    if (!title) return;
    const parentId = f.dataset.parent;
    const siblings = state.tasks.filter((x) => !x.completed && x.parentId === parentId);
    const order = L.nextOrderValue(siblings);
    addDoc(colRef('tasks'), {
      title, completed: false, priority: 'medium', createdAt: serverTimestamp(), parentId,
      ...(state.currentListId ? { listId: state.currentListId } : {}),
      ...(order != null ? { order } : {}),
    }).catch(dbError);
    TasksView.addingSubtaskFor = null;
    scheduleRender();
  },

  /** Edycja zadania: setDoc (pełne nadpisanie z zachowaniem pól, których formularz nie dotyka),
   * nie updateDoc – dzięki temu wyczyszczenie pola terminu w formularzu rzeczywiście USUWA je
   * z bazy, a nie tylko pomija (merge w updateDoc zostawiłby starą wartość). */
  'task-edit': (f) => {
    const id = f.dataset.id;
    const t = state.tasks.find((x) => x.id === id);
    if (!t) { closeSheet(); return; }
    const fd = new FormData(f);
    const title = String(fd.get('title') || '').trim();
    if (!title) { showFormError(f, 'Wpisz nazwę zadania.'); return; }
    const deadlineDate = String(fd.get('deadlineDate') || '').trim();
    const deadlineTime = String(fd.get('deadlineTime') || '').trim();
    const error = L.validateDeadline({ deadlineDate, deadlineTime });
    if (error) { showFormError(f, error); return; }
    const data = toRaw(t);
    delete data.deadlineDate;
    delete data.deadlineTime;
    data.title = title;
    if (!t.parentId) {
      const priority = fd.get('priority');
      if (L.PRIORITIES.includes(priority)) data.priority = priority;
    }
    if (deadlineDate) {
      data.deadlineDate = deadlineDate;
      if (deadlineTime) data.deadlineTime = deadlineTime;
    }
    setDoc(docRef('tasks', id), data).catch(dbError);
    closeSheet();
    toast('Zapisano zmiany');
  },

  tasklist: (f) => {
    const name = String(new FormData(f).get('name') || '').trim();
    const error = L.validateListName(name);
    if (error) { showFormError(f, error); return; }
    addDoc(colRef('task_lists'), { name, createdAt: serverTimestamp() })
      .then((ref) => setCurrentList(ref.id))
      .catch(dbError);
    closeSheet();
    toast('Utworzono listę');
  },

  'tasklist-rename': (f) => {
    const name = String(new FormData(f).get('name') || '').trim();
    const error = L.validateListName(name);
    if (error) { showFormError(f, error); return; }
    updateDoc(docRef('task_lists', f.dataset.id), { name }).catch(dbError);
    closeSheet();
    toast('Zmieniono nazwę listy');
  },

  event: (f) => {
    const fd = new FormData(f);
    const allDay = fd.get('allDay') === '1';
    const title = String(fd.get('title') || '').trim();
    const description = String(fd.get('description') || '').trim();
    const date = fd.get('date');
    const colorCode = L.safeColor(fd.get('color') || L.DEFAULT_EVENT_COLOR);
    let data;
    if (allDay) {
      const endDate = fd.get('endDate') || date;
      const error = L.validateEvent({ title, date, allDay: true, endDate, description });
      if (error) { showFormError(f, error); return; }
      data = { title, date, allDay: true, endDate, days: L.expandDays(date, endDate), colorCode, ...(description ? { description } : {}) };
    } else {
      const startTime = fd.get('start');
      const endTime = fd.get('end');
      const error = L.validateEvent({ title, date, startTime, endTime, description });
      if (error) { showFormError(f, error); return; }
      data = { title, date, startTime, endTime, colorCode, ...(description ? { description } : {}) };
    }
    const id = f.dataset.id;
    // setDoc (pełne nadpisanie), NIE updateDoc: przy przełączeniu godzinowe ⇄ całodniowe w bazie
    // nie mogą zostać pola ze „starego” kształtu – reguły Firestore są na to celowo surowe.
    (id ? setDoc(docRef('planner_events', id), data) : addDoc(colRef('planner_events'), data)).catch(dbError);
    closeSheet();
    if (state.plannerMode === 'day') {
      const touchesToday = allDay ? L.eventTouchesDay(data, state.date) : data.date === state.date;
      if (!touchesToday) setDate(data.date);
    }
    toast(id ? 'Zapisano zmiany' : 'Dodano wydarzenie');
  },

  card: (f) => {
    const fd = new FormData(f);
    const id = f.dataset.id;
    const draft = ['subject', 'topic', 'subtopic', 'type', 'front', 'back'].reduce((o, k) => ({ ...o, [k]: String(fd.get(k) || '') }), {});
    const names = { subject: 'przedmiot', topic: 'temat', subtopic: 'zagadnienie', front: 'przód', back: 'tył' };
    const missing = Object.keys(names).filter((k) => !draft[k].trim()).map((k) => names[k]);
    if (missing.length) { showFormError(f, `Uzupełnij: ${missing.join(', ')}.`); return; }
    const r = L.parseImport(JSON.stringify([draft]), state.cards.filter((c) => c.id !== id));
    if (!r.ok) { showFormError(f, r.error.split('\n').slice(1).join('\n').replace(/^Fiszka #1: /, '') || r.error); return; }
    if (!r.cards.length) { showFormError(f, 'Taka fiszka już istnieje w tym dziale (ten sam przód).'); return; }
    const c = r.cards[0];
    const data = { subject: c.subject, topic: c.topic, subtopic: c.subtopic, type: c.type, front: c.front, back: c.back };
    (id ? updateDoc(docRef('flashcards', id), data)
      : addDoc(colRef('flashcards'), { ...data, status: 'new', lastReviewed: null, createdAt: serverTimestamp() })).catch(dbError);
    closeSheet();
    toast(id ? 'Zapisano zmiany' : 'Dodano fiszkę');
    location.hash = cardsHash({ subject: data.subject, topic: data.topic, subtopic: data.subtopic });
  },

  import: async (f) => {
    const box = $('#imp-status');
    const r = L.parseImport($('#imp-text').value, state.cards);
    if (!r.ok) { setStatus(box, 'error', r.error); toast('Nic nie zaimportowano. Popraw dane JSON.', { ms: 6000 }); return; }
    if (!r.cards.length) { setStatus(box, 'error', 'Wszystkie fiszki z tej paczki już istnieją. Nie ma czego importować.'); return; }
    const btn = $('#imp-go');
    btn.disabled = true;
    btn.textContent = 'Zapisuję…';
    try {
      const base = Date.now();
      // Zapis paczkami (do 400 fiszek naraz). Kolejność z JSON-a zachowujemy przez rosnący createdAt.
      const promises = commitBatches(r.cards, (b, c, i) => b.set(doc(colRef('flashcards')), { ...c, createdAt: Timestamp.fromMillis(base + i) }));
      const all = Promise.all(promises);
      const res = await Promise.race([all.then(() => 'ok'), sleep(8000).then(() => 'slow')]);
      if (res === 'slow') all.catch(dbError);
      closeSheet();
      const dup = r.duplicates ? ` Pominięto ${L.plural(r.duplicates, ['duplikat', 'duplikaty', 'duplikatów'])}.` : '';
      toast(res === 'slow' ? `Zapisano na tym urządzeniu: ${L.plural(r.cards.length, WORDS.card)}. Wyślę je po odzyskaniu sieci.`
        : `Zaimportowano ${L.plural(r.cards.length, WORDS.card)}.${dup}`, { ms: 7000 });
      location.hash = cardsHash(L.commonPath(r.cards));
    } catch (err) {
      dbError(err);
      btn.disabled = false;
      btn.textContent = 'Importuj';
    }
  },
};

function wireGlobalEvents() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = actions[el.dataset.act];
    if (fn) fn(el, e);
  });
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    if (forms[f.dataset.form]) forms[f.dataset.form](f);
  });
  document.addEventListener('change', (e) => {
    const cb = e.target.closest('input.check-in');
    if (cb) TasksView.toggle(cb.dataset.id, cb.checked);
    if (e.target.id === 'pl-date' && e.target.value) setDate(e.target.value);
    if (e.target.id === 'fc-scope') { CardsView.browseIdx = Number(e.target.value); scheduleRender(); }
    if (e.target.name === 'allDay') {
      const form = e.target.closest('form[data-form="event"]');
      if (form) toggleEventAllDayFields(form);
    }
  });
  $('#sheet').addEventListener('click', (e) => { if (e.target === $('#sheet')) closeSheet(); });
  const dlg = $('#study');
  dlg.addEventListener('close', () => { study = null; scheduleRender(); });
  dlg.addEventListener('keydown', (e) => {
    if (!study) return;
    if (study.flipped && ['1', '2', '3'].includes(e.key)) { rate(L.RATINGS[Number(e.key) - 1]); return; }
    if (!study.flipped && (e.key === ' ' || e.key === 'Enter') && !e.target.closest('button')) { e.preventDefault(); flipCard(); }
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => { state.online = true; updateSyncUI(); });
  window.addEventListener('offline', () => { state.online = false; updateSyncUI(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && PlannerView.mounted) PlannerView.drawNow(); });
}

// ============================================================== 13. URUCHOMIENIE
function onAuth(user) {
  if (user) {
    state.user = user;
    state.route = null;
    startData();
    showOnly('shell');
    route();
    updateSyncUI();
  } else {
    if (state.route && views[state.route].mounted) views[state.route].unmount();
    stopData();
    state.user = null;
    state.route = null;
    closeSheet();
    closeStudy();
    showOnly('login');
    $('#login-pass').value = '';
    $('#login-email').focus();
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const run = async () => {
    try {
      await navigator.serviceWorker.register('./sw.js');
      const reg = await navigator.serviceWorker.ready;
      const hosts = ['cdn.tailwindcss.com', 'unpkg.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com'];
      const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => { try { return hosts.includes(new URL(u).hostname); } catch (err) { return false; } });
      if (reg.active) reg.active.postMessage({ type: 'CACHE_URLS', urls });
    } catch (err) { console.warn('[SW] rejestracja nie powiodła się:', err); }
  };
  if (document.readyState === 'complete') run(); else window.addEventListener('load', run);
}

function main() {
  initTheme();
  registerServiceWorker();
  if (!configured) { refreshIcons(); showOnly('setup'); return; }
  initFirebase();
  wireGlobalEvents();
  refreshIcons();
  onAuthStateChanged(auth, onAuth, (err) => {
    console.error(err);
    $('#boot-msg').textContent = 'Nie udało się sprawdzić logowania. Odśwież stronę.';
  });
}

main();
