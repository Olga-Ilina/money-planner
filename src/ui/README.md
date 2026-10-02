# UI shell and design kit — the contract for screens

Everything here is a contract: the screens rely on these names, props and behaviours. Change them only
together with every user. Spec: `.internal/specs/…-design.md` §5–§7.

## Conventions (read first)

- **Russian copy in sentence case** («Новая операция», not «Новая Операция»). Short, plain words.
- **One filled `Button` per view** (the main action). Everything else: `kind="plain"` or `"destructive"`.
- **Money only through `<Money value>`** (or `formatMoney(n)` inside text) — never `toFixed` or `Intl` by hand.
  Summary figures use `StatCard` / `StatGrid`.
- **Dates only through `formatDate(iso)` → '30.09.2026', `formatShortDate(iso)` → '30.09', `formatDay(iso)` → '30 сентября' and
  `formatWeekdayDate(iso)` → 'Среда, 30 сентября'.** Model dates stay 'YYYY-MM-DD' strings; never turn them into
  `Date` objects in a screen (time zones shift them). Today: `today()`. A stored timestamp (e.g.
  `meta.lastBackupAt`): `localDateOf(stamp)` → local 'YYYY-MM-DD' or `undefined`.
- **All data changes go through `actions.commit(next, message?)`.** Build a new `Data` object (spread, `map`,
  `filter`); **never mutate `data.value` or anything inside it in place** — undo and saving rely on the old object
  being untouched. Import and restore use `actions.replaceData(next)` instead (see below).
- **Forms never lose a value to a typo.** `DateField`, `AmountField` and `NumberField` call
  `onChange(value, { invalid })`. A form keeps the set of invalid fields, keeps the stored value while a field is
  invalid, shows the field's error and **disables its save button while any field is invalid** — use
  `useFieldValidity()` (below). An optional date or amount must never be deleted by a mistyped year or amount,
  nor by letters typed or pasted over it: such text stays in the input (nothing is filtered out) and the field is
  invalid until the user fixes or clears it. A field that is removed from the form is forgotten automatically.
- Calculations come from the engine (`src/engine`, `import … from '../../engine'`); screens only lay numbers out.
  That includes the tracker's rules for the plan sheets (`src/engine/plans.ts`): `monthlyAverage` («в среднем в
  месяц»), `purchaseStatus(p, forecast, data)` («Хватает / Не хватает / Вне прогноза / Куплено / Из сбережений»),
  `leftToSave` («Осталось накопить»), `debtLeft`, `debtStatus`, `isDebtOpen`; and the cents rounding `roundCents`
  (also re-exported by `format.ts`).
- **Savings accounts are outside the balance** (the tracker's rule, spec `2026-10-01-savings-accounts`): `balances()`
  gives `cards` (debit only), `total` («Всего»: debit, cash, credit) and `savings` («Сбережения») apart; the forecast
  counts only free money — rows of a savings account move nothing, and transfers across the line (and the credit card
  paid from savings) are each month's and week's `transfers`. Whether a row counts: `inBalance(data, accountId)`.
- **The tracker's names of enum values come from the engine too** (`src/engine/labels.ts`, the same copy the
  Excel files use): `ACCOUNT_TYPE_LABEL` (and `SAVINGS_NOTE`, the one line on what a savings account is), `KIND_LABEL`,
  `JOURNAL_STATUS_LABEL`, `SOURCE_LABEL` (feed sources),
  `MOVEMENT_SOURCE_LABEL` (+ «Автопогашение»; a journal row is «Плановая запись» there, as everywhere on screen —
  the files keep the tracker's sheet name «Запланированные»), `DUPLICATE_LABEL`, `PRIORITIES`. Never copy them into a screen.
- Optional form fields emit `undefined` (never `''`) when cleared; store them as absent, not as `''`.
- Excel import/export only through `src/ui/io.ts` loaders (never a static import of `src/io/*` — that would pull
  ExcelJS into the main bundle). Files go to the user through `shareFile`, come from them through `pickFile`.
  A full backup: `backupNow()`.
- Inside the unlocked app `data.value` is never null: use `appData()` to get it typed as `Data`.
- No network, no external fonts, icons or scripts (CSP). Icons are `<Icon name>`.
- Touch targets ≥ 44 px (kit components already are). Inputs are 17 px (no iOS zoom).
- **Element ids: `useUid()` from the kit, never Preact's `useId`.** Sheets render in their own render root (the
  overlay inside the shell), where `useId` repeats ids used by the page behind them.
- **Screen CSS lives in a per-screen file next to the component** (`Today.css`, imported by `Today.tsx`), uses the
  colour tokens only (`var(--tint)`, `var(--label-2)`, …), and every class name starts with the screen name
  (`.today-…`, `.feed-…`). Nobody edits `styles.css`.
- **Screen CSS loads BEFORE `styles.css`**: `main.tsx` imports the app — and with it every screen's CSS — first,
  then `styles.css`. So a screen rule with the same specificity as a kit rule loses to it (`.my-note { margin: 0 }`
  does not beat `.sheet-text`), and a screen rule that wins does so only by being more specific. **Never restyle a
  kit piece from a screen** (`.today-warn .row-icon { background: … }`, a square painted over `.row-icon`, a
  `<p>` note between fields, a local visually hidden class): use the kit's props and helpers — `Row iconTone` /
  `valueTone`, the field `hint`, `.sr-only`, `formatShortDate` — or report the need. Where a screen really must
  adjust a kit class, it uses two classes and says why (see `SettingsPage.css`, `AccountsSettingsPage.css`).
- **State that must survive tab switches** (a segment, a filter, the selected month) lives in module-level signals
  in the screen's own file (`const filter = signal<Filter>('all')`), not in `useState` (a tab switch or a pushed
  page unmounts the screen). «Лента»'s month is the shared `feedMonth`.
- **iOS raises the keyboard only for focus set inside the tap itself.** `autoFocus` in a sheet (which focuses after
  the sheet has mounted) is best effort: on iPhone the field may be focused without the keyboard. Never rely on it.
- **A screen does not change the shared pieces** — `pages.ts`, `nav.ts`, `state.ts`, `actions.ts`, `sheets/host.tsx`,
  `Icon.tsx`, `styles.css`, `package.json` (no new dependencies: a screen needs none), `kit/*`, `src/io/*`,
  `src/engine/*`, `src/store/*`, the lock (`Lock.tsx`, `lockState.ts`, `session.ts`, `generation.ts`, `WipeSheet.tsx`, `App.tsx`) — as
  part of screen work. A change there is its own change, made together with every user and written down here.

## Where things are

| File | What |
| --- | --- |
| `App.tsx` | start (load meta + data), onboarding / lock / tabs, update banner, the shell (`OverlayHost`, `SheetHost`, `Toast`) |
| `Lock.tsx`, `Onboarding.tsx`, `WipeSheet.tsx`, `session.ts` | PIN screen, first run, «Забыли PIN?», auto-lock and privacy cover |
| `lockState.ts` | what the PIN screen and the «PIN» page share (see «PIN lock and meta» below): `checkLockPin(pin)` (THE PIN check; never rejects), `PinRemovedError`, `PinChangedError`, `freshLockMeta(m)`, `strictestLockState(m, other)`, `withLockState(m, from)`, `saveLockState(checked, reset = false)` (saves checkPin's counter and pause into the stored meta — only a right PIN, `reset`, lowers them; never rejects), `cutLongPause(m, now)`, `pauseLeft(until, now)`, `formatWait(ms)`, `usePause(until)`, `useCutLongPause(until)`, `PIN_LENGTH`, `MAX_PAUSE_MS` (checkPin's) |
| `generation.ts` | the data generation: `isStale(e)`, `sameGeneration(stored, mine = meta.value)`, `stopTab()`, `reloadApp()`, `generationPending()` / `setGenerationPending(on)` (see «PIN lock and meta») |
| `TabBar.tsx`, `TabContent.tsx`, `nav.ts`, `pages.ts`, `scroll.ts` | tabs, per-tab page stacks, page registry, scroll memory |
| `state.ts`, `actions.ts` | signals and all data / meta changes |
| `format.ts`, `share.ts`, `io.ts`, `backupNow.ts`, `backupCopy.ts`, `pwa.ts` | formats, share/pick files, lazy Excel modules, full backup (and «Сделать копию» as the user sees it), app updates |
| `sync.ts` | the iCloud Drive sync with the Mac (see «Sync with the Mac» below): the sync state, unsent changes, «Отправить на Mac», the data set kept before «Забрать с Mac» |
| `kit/*` (import from `kit/index.ts`) | design kit |
| `screens/{Today,Feed,Accounts,Reports,More}.tsx` | the five tab root screens (+ `accountsParts.tsx`, `charts.ts`) |
| `pages/*Page.tsx` | sub-pages registered in `pages.ts` (+ their helpers: `ReplaceDataSheet`, `usageText`, `yearChange`, `*Edit.ts`) |
| `sheets/*.tsx`, `sheets/host.tsx` | the forms, the item card and the «+» menu; the global sheet host (`planForm.ts`: pieces the forms share) |
| `styles.css` | shared styles; colour tokens only |

### Screen map

Tabs (`TabBar`), each with its root screen and the pages pushed on top of it; sheets open over any of them
(`openSheet`, `sheets/host.tsx`).

- **«Сегодня»** — `screens/Today.tsx`. Notices: today outside the accounting year («Учётный год закончился» /
  «ещё не начался» → `settings`), «сделайте копию» (`makeCopy`). Cards «На картах», «Наличные», «Кредитка» (debt and
  the next debit, «Спишется 10 октября: …») → «Счета». «Новая операция» → `operation`. «Ближайшие 7 дней» (and
  everything overdue): a row → `item`; ✓ pays in one tap, or opens `item` when the record lacks an account — a deleted one
  counts as none, and the card then asks for one (a purchase: also a price or cost). «Этот месяц»: «Доход», «Расход» → «Лента» at that month. «Проверьте записи» (each counts what the place it
  opens can show): «Оплачено без счёта» and «Возможные дубли» — the rows «Лента» finds over the 12 accounting months
  (`feedCheckCounts`) → «Лента» filtered to them (`openFeedCheck`); «Куплено без даты» → `purchases`; «Вне учётного
  года» → `settings`. At the bottom, only once the sync is in use: «Отправьте изменения на Mac» (a quiet one-line row) when
  the data hold changes not sent and the last sync is more than a day old → `sync`.
- **«Лента»** — `screens/Feed.tsx`. The month (`feedMonth`), the filter «Все / Траты / Доходы / Не оплачено», the
  month's «Доход» and «Расход» with their plans, the records by date (badges «дубль?», «без счёта»; the check reads
  «Оплачено / Получено / Куплено») → `item`. «+» → `add` → a form (an operation and a planned record are dated in the
  shown month; saved into another month → «Показать»). The month report (.xlsx). A check filter from «Сегодня» shows
  a note with «Показать все»; one that finds nothing in any month is dropped (no note).
- **«Счета»** — `screens/Accounts.tsx`. Totals («На картах», «Наличные», «Долг по кредитке», «Всего», «Сбережения» —
  outside «Всего» and the forecast), notices about rows that reach no balance (→ «Лента», «без счёта» filtered),
  balances — the accounts in the balance under «Остатки», the savings accounts under «Сбережения» — → `account`
  (`pages/AccountPage.tsx`, params `{ id }`: movements of a month with the running balance), the credit card → `credit`
  (`pages/CreditPage.tsx`: statements and debits), «Перевод между счетами» → `operation` (a transfer, any account to
  any account), «Счета и движения» (.xlsx).
- **«Отчёты»** — `screens/Reports.tsx` (+ `charts.ts`). «Месяц» (categories: limit, plan, fact), «Год» (months,
  categories × months), «Прогноз» (free money: weeks with the cushion, the three months; «Переводы в сбережения / из
  сбережений» in a month card and a «Переводы» column of the weeks only when there are any); each is exported.
- **«Ещё»** — `screens/More.tsx`. Планы: `recurring` («Постоянные платежи» → `recurring` form), `purchases`
  («Покупки» → `purchase` form; «Хватит ли денег» from `purchaseStatus`), `debts` («Долги» → `debt` form). Настройки:
  `categories` («Категории и лимиты»), `accounts-settings` («Счета и кредитка»; the type «Сберегательная» shows
  `SAVINGS_NOTE` as the field's hint), `settings` («Учёт и прогноз»: the accounting year, the forecast, the
  cushion, the balances date; explains records outside the year), `pin` («PIN-код»). Данные: `sync` («Синхронизация»:
  the status, «Отправить на Mac», «Забрать с Mac», «Вернуть данные до синхронизации»), `import` («Загрузить
  трекер»), `backup` («Резервная копия»: `makeCopy`, restore). `about` («О приложении»).
- **Sheets** — `operation` (OperationForm), `journal` (JournalForm: a planned record), `recurring`, `purchase`, `debt`
  (the plan forms), `item` (ItemSheet: the card of any record — pay / mark / buy, postpone, «Пометить отменённой»,
  «Изменить», «Удалить»), `add` (AddMenu).
- Outside the tabs: `Onboarding.tsx` (first run), `Lock.tsx` (PIN), start errors and «Доступна новая версия» (`App.tsx`).

**Page layout.** Each sub-page is one file `pages/<Name>Page.tsx` exporting `<Name>Page(props: RoutedPageProps)`
that renders a `<Page title=…>` (the title is the name of its row in «Ещё»); its name in `pages.ts` is fixed. It may
split its content into more files next to it, plus `<Name>Page.css`.

## State — `state.ts` (Preact signals)

Read `x.value` in a component and it re-renders when the value changes.

| Export | Type | Notes |
| --- | --- | --- |
| `data` | `Signal<Data \| null>` | the app data; set only by `actions` |
| `meta` | `Signal<Meta>` | this tab's meta: PIN lock state, `lastBackupAt`, `lastImportAt`, `generation`, `sync` (`src/store/db.ts`); change it only through `actions.updateMeta`. Its PIN (hash, salt, iterations) is the PIN this tab unlocks with, and its `generation` the data set this tab loaded |
| `locked` | `Signal<boolean>` | PIN screen shown |
| `stopped` | `Signal<boolean>` | another tab deleted the data or set up new ones: only the stop screen is shown until a reload (`generation.ts`) |
| `tab` | `Signal<Tab>` | `'today' \| 'feed' \| 'accounts' \| 'reports' \| 'more'` |
| `feedMonth` | `Signal<YM>` | month shown in «Лента»; always one of the 12 accounting months once there is data: a month outside them (set, or left over after the accounting year changed) becomes the current month when that is inside the year, else the nearest accounting month (the first before the year, the last after it) |
| `toast` | `Signal<ToastState \| null>` | use `showToast`, not this |
| `today()` | `ISODate` | today's LOCAL date; reading it re-renders when the day changes |
| `appData()` | `Data` | `data.value`, throws if null (never inside the unlocked app) |
| `accountName(data, id)` | `string` | `''` without id, «(удалённый счёт)» for an unknown id |
| `TABS`, `TAB_TITLES`, `hasPin(meta)`, `samePin(a, b)`, `PIN_FIELDS`, `clampMonth(ym, months, current)` | | `samePin`: the same hash, salt and iterations. `clampMonth`: `ym` when it is one of `months`, else `current` when it is, else the nearest accounting month |

## Actions — `actions.ts`

```ts
import { actions, needsBackup } from '../actions';

actions.commit(next: Data, message?: string, opts?: { action?: ToastAction }): void
```
Shows `next` at once and saves it in the background: one write at a time, the newest data wins (superseded
writes are skipped). A failed save shows a toast starting with «Не удалось сохранить …» (the data stays on
screen; the next commit saves everything) — and keeps «Отменить» while the undo snapshot is still valid. With a
`message`, shows a toast with «Отменить» (and `opts.action` next to it, e.g. «Показать») and keeps ONE undo snapshot for 5 s; a later commit replaces it (without a
message it drops it, so «Отменить» never reverts the wrong change).

- `actions.undo(): boolean` — back to the data before the last commit with a message, within 5 s. When that
  change had moved «Лента»'s month (a new accounting year clamps `feedMonth`) and the user has not picked another
  month since, the month comes back too.
- `actions.replaceData(next): Promise<void>` — **tracker import and restore from a backup** (not undoable): drops any
  «Отменить» first, **saves, then shows**. Rejects with the `StoreError` and leaves the data unchanged when saving
  fails. If anything is committed while it saves, that commit wins (it is what is shown and what ends up stored) and
  replaceData rejects with `DataChangedError` («Данные изменились, пока шло сохранение. Файл не загружен — попробуйте
  ещё раз.»). Show `ioErrorMessage(e)` for both.
- `actions.updateMeta(fn: (stored: Meta) => Meta, { applyOnFailure?, pin? }): Promise<Meta>` — read-modify-write of
  the **STORED** meta in ONE transaction (`updateStoredMeta`, `src/store/db.ts`): `fn` gets the meta as it is stored
  right now (another tab may have changed it) and returns it with **only its own fields** changed —
  `(m) => ({ ...m, lastImportAt: at })`. Updates from this tab run one at a time. Rules:
  - only the PIN change (`{ pin: true }`: onboarding and the «PIN» page) may change the PIN fields (`pinHash`,
    `pinSalt`, `pinIterations`) or `generation`; any other writer that tries is refused (rejects, nothing written);
  - only while the stored `generation` is this tab's: otherwise nothing is written, it rejects with `StaleTabError`
    and the tab stops (below);
  - memory then takes the written meta — except that a PIN this tab did not set never enters memory: when another
    tab changed or removed the PIN, a date writer still writes its date onto the stored meta, and memory keeps this
    tab's PIN, counter and pause (the lock refuses the other PIN until a restart);
  - rejects when the save fails, and with `fn`'s own error when `fn` throws (nothing written, memory unchanged);
    `applyOnFailure` keeps a change whose save failed in memory anyway (the PIN counter and pause).

  Never write the whole meta: `saveMeta` is for the store and tests only (a test keeps it out of `src/ui`).
- `actions.markBackupDone(): Promise<void>` — the stored `lastBackupAt = now`, nothing else (`backupNow()` calls it for you).
  Never rejects: a failed save shows a toast, except `StaleTabError` (the tab has stopped; its stop screen says why).
- `actions.setSync(sync: SyncState | undefined): Promise<void>` — the stored `meta.sync` (the iCloud Drive sync state;
  `undefined` removes it: «never synced»), nothing else. Rejects like `updateMeta` (`StaleTabError`, a `StoreError`);
  the caller says what it means. Only `sync.ts` and the «Синхронизация» page call it.
- `actions.flush(): Promise<void>` — waits for queued data and meta writes.
- `needsBackup(meta, data, now: Date | number = Date.now()): boolean` — true when there is something to lose (any
  operation, journal row, recurring payment, purchase, debt, or an account with a non-zero start) and no backup
  for more than 14 days (or the stored time is unreadable).

Typical delete with undo: `actions.commit({ ...d, operations: d.operations.filter((o) => o.id !== id) }, 'Операция удалена')`.
New ids: `newId()` from the engine.

**Import and restore** («Загрузить трекер», «Резервная копия», onboarding). Read and parse first (`pickFile` → `loadTrackerImport()` / `loadBackup()`), show what
was found, then ask in a local `Sheet` (not `Confirm`, which has one action) that offers **«Сначала сделать копию»**
(`backupNow()`) and **«Заменить данные в приложении»**, and only then `await actions.replaceData(next)` — never
`commit` (import is not undoable). Exact markup:
```tsx
<Sheet open={askOpen} title="Заменить данные в приложении" onClose={() => setAskOpen(false)}
       left={<Button kind="plain" onClick={() => setAskOpen(false)}>Отмена</Button>}>
  <p class="sheet-text">Сейчас в приложении другие данные. Файл заменит их, это нельзя отменить.</p>
  {error && <Banner tone="error">{error}</Banner>}
  <div class="sheet-actions">
    <Button kind="plain" full disabled={busy} onClick={() => void copyFirst()}>Сначала сделать копию</Button>
    <Button kind="destructive" full disabled={busy} onClick={() => void replace()}>Заменить данные в приложении</Button>
  </div>
</Sheet>
```
`copyFirst` = `await backupNow()` (it shows its own toast on failure); `replace` = `setBusy(true); try { await
actions.replaceData(next); setAskOpen(false); } catch (e) { setError(ioErrorMessage(e)); } finally { setBusy(false); }`.
`pages/ReplaceDataSheet.tsx` is that sheet with the counts; «Забрать с Mac» passes `replace={replaceKeepingBefore}` and
its own `note` (the data it replaces can be brought back), every other user keeps the defaults. Its `usePickedFile<T>()`
keeps whatever `read` returns (a `PendingReplace` with more fields, e.g. the Mac version of `readTrackerStamped`).
A tracker is read with `readTrackerStamped` (`sync.ts`), not `loadTrackerImport()` directly: once the data are replaced,
`setSyncFromImport(mac)` when it carries a Mac version (see «Sync with the Mac»).

## PIN lock and meta — `lockState.ts`, `generation.ts` (not to be changed by screens)

- **The PIN check** (the lock screen and the «PIN» page — nothing else checks a PIN): `const since =
  lockGeneration(); const r = await checkLockPin(pin);`. It never rejects and resolves only after the counter and
  the pause are saved:
  - `{ kind: 'checked', ok, waitMs }` — ok: `unlockIfCurrent(since)` (the lock screen) or the next step (the «PIN»
    page, only while `lockGeneration() === since`); not ok: shake, and «Неверный PIN» when `waitMs === 0`;
  - `{ kind: 'unread', error }` — the stored meta could not be read (before or after the check): not accepted,
    nothing written; show `ioErrorMessage(error)`, the next try reads again;
  - `{ kind: 'broken', error }` — never ok, nothing checked or written, keypad off until a restart; show
    `ioErrorMessage(error)`. Damaged PIN data or no crypto; `PinRemovedError` («PIN удалён в другой вкладке.
    Перезапустите приложение.»: no PIN stored — another tab's «Забыли PIN?»); `PinChangedError` («PIN изменён в
    другой вкладке. Перезапустите приложение.»: a stored PIN that is not this tab's); `StaleTabError` (another data
    set is stored: the tab has stopped, see below). The first two are `StoreError`s with code `meta-damaged`.

  How it stays fail-closed: it reads the stored meta right before the check (`freshLockMeta(meta.value)`: the
  generation, then the PIN must be this tab's; the PIN is checked with `strictestLockState(stored, memory)`, so
  another tab cannot reset the counter) and again right after it (the generation and the PIN again); only then does
  `saveLockState(checked, ok)` write — a right PIN resets the counter and the pause, a wrong one saves the stricter
  counter and pause of its result, the second read and the meta its write finds (in the same transaction). A tab only ever unlocks with the PIN it was started with
  (the hash, salt and iterations in `meta.value`) and never takes another tab's PIN.
- **A pause**: `const left = usePause(meta.value.lockedUntil); useCutLongPause(meta.value.lockedUntil);` — keypad
  disabled while `left > 0`, «Попробуйте через ${formatWait(left)}». A pause more than 30 min ahead (the clock moved
  back) is cut to 30 min and saved, only while the stored PIN is this tab's.
- **A new PIN** (the «PIN» page), written only over the PIN checked on the first step:
  ```ts
  const checked = meta.value;
  const n = await setPin(checked, pin);
  await actions.updateMeta((m) => {
    if (!hasPin(m)) throw new PinRemovedError();        // wiped meanwhile: never a PIN into wiped storage
    if (!samePin(m, checked)) throw new PinChangedError(); // changed meanwhile: never over another tab's PIN
    const next: Meta = { ...m, pinHash: n.pinHash, pinSalt: n.pinSalt, pinIterations: n.pinIterations, failedAttempts: 0 };
    delete next.lockedUntil; // a new PIN also ends the pause
    return next;
  }, { pin: true });
  ```
  Onboarding does the same with `generation: newGeneration()`, only while no PIN is stored — or, when the PIN
  stored is this very onboarding's own (`samePin(stored, n)`: a try whose data save failed), it keeps that meta as
  stored (PIN, generation, counter and pause) and only retries the data; any other stored PIN refuses.
- **The data generation** (`Meta.generation`): which data set the stored meta and data belong to — a random id
  stored with the PIN by onboarding, cleared by a wipe; a meta stored before it existed gets one at the start
  (`loadMetaAtStart`, stored once). When the start cannot store it (no space left), the app goes on without one —
  none stored and none in memory are the same data set, so the owner still unlocks, sees the data and can make a
  backup — and the next meta write that succeeds onto this tab's own PIN stores it (`generationPending()`, set by
  the start; `actions.updateMeta` adds it, and memory takes it only once written). Another tab storing one first
  (its own start) stops this tab: a reload goes on. A tab remembers the one it loaded (`meta.value.generation`).
  When another tab deleted the data («Забыли PIN?») or set up new ones, this tab **stops** (`stopped`, `stopTab()`): App shows only
  «Данные изменились в другой вкладке. Перезапустите приложение.» with «Перезапустить» (`reloadApp()`); the tabs
  are unmounted, and nothing of the old data is shown or saved again. Checked
  - before every save — data: `saveData(d, { generation })` reads the meta and writes in one transaction; meta:
    inside `updateMeta`'s transaction. Refused with `StaleTabError` (code `stale`): nothing written, no «Не удалось
    сохранить» toast; a stopped tab writes nothing at all. The UI calls `saveData` only with `{ generation }` (a test
    keeps it that way: the unchecked `saveData(d)` is for the store and tests);
  - on every unlock (`checkLockPin`, both reads) and by the pause cut;
  - on every return to the foreground while the tab holds data (`session.ts`; a read that fails locks it).

  A screen does nothing for it: `actions`, `lockState` and `session` do it.

  **The cost during an update.** A tab still running the previous version (no generations) writes its whole meta,
  without a `generation`, whenever it writes the meta. Every tab of the new version then finds another data set
  stored and stops (fail closed) on its next save, unlock or return to the foreground: the change that triggers the
  stop — a commit, an undo, a backup date — is **dropped**: it is not saved, and a reload does not bring it back.
  «Перезапустить» recovers everything else: the start gives the stored meta a generation again, and the right PIN
  opens the data as last saved. The old tab keeps working (it knows no generations) until it is updated
  («Доступна новая версия»); closing or updating it first avoids the stop.

## Navigation — `nav.ts`, `pages.ts`

- `pushPage(tab, page, params?: Record<string, string>)` — opens registered page `page` on top of `tab`'s stack.
  Every push is a fresh page (`NavEntry.key`): the same page pushed again with other params starts with new state.
- `popPage(tab)`, `popToRoot(tab)`, `currentPage(tab): NavEntry | null`, `stackDepth(tab)` (reactive).
- `openTab(tab, page?, params?)` — switch to `tab` at its root, optionally opening a page (e.g. from «Сегодня»
  to an account: `openTab('accounts', 'account', { id })`).
- `selectTab(tab)` — what the tab bar does (switching keeps each stack; tapping the active tab pops to root).
- Registered pages (`pages.ts`): `recurring`, `purchases`, `debts`, `categories`, `accounts-settings`,
  `settings`, `pin`, `import`, `backup`, `about`, `account` (params `{ id }`), `credit`, `sync`.
  A page component takes `RoutedPageProps` = `{ params: Record<string, string> }` and renders a `<Page>`.
- `<Page>` inside a tab shows the back button automatically: ‹ + the title of the page below (its accessible name
  is «Назад: <title>»).
- Each tab and each page keeps its scroll position; a newly pushed page starts at the top.

## Sheets — `sheets/host.tsx`

```ts
import { openSheet, closeSheet } from '../sheets/host';
openSheet('operation', { initial?: Operation, preset?: Partial<Operation> });
openSheet('journal',   { initial?: JournalRow, preset?: Partial<JournalRow> });
openSheet('recurring', { initial?: Recurring });
openSheet('purchase',  { initial?: Purchase });
openSheet('debt',      { initial?: Debt });
openSheet('item',      { item: { source: FeedSource, id: string, ym?: YM } });  // item card
openSheet('add');                                                              // «+» menu
// the item card takes ONE prop, `item` (a reference, not the row):
openSheet('item', { item: { source: 'recurring', id: payment.id, ym: '2026-10' } });
```
One sheet at a time: opening one replaces the open one (the «+» menu opens a form this way; focus returns to «+»
when the form closes). The host passes `open` and `onClose`; a sheet closes itself by calling `onClose()`
(→ `closeSheet()`). Component props (exact): `OperationForm({open, onClose, initial?, preset?})`,
`ItemSheet({item: ItemRef | null, onClose})` (null while closed), `JournalForm({open, onClose, initial?, preset?})`,
`AddMenu({open, onClose})`, `RecurringForm({open, onClose, initial?})`, `PurchaseForm({open, onClose, initial?})`,
`DebtForm({open, onClose, initial?})`.

A screen may also render its own `<Sheet>` / `<Confirm>` for something local (e.g. a picker), anywhere — even in a
`Page`'s `right` slot: inside the app every `Sheet` and `Confirm` renders into the shell's single overlay root
(`OverlayHost`, `kit/Overlay.tsx`), so it is never clipped by the page bar, sits above the tab bar, and is hidden
with the app when it locks. Outside the shell (lock screen, onboarding) they render in place.

## Kit — `kit/index.ts`

| Component | Props | Notes |
| --- | --- | --- |
| `Icon` | `{name, size? = 24}` | names: home, list, wallet, chart, more, plus, check, check-circle, chevron-right, chevron-left, chevron-down, chevron-up, download (an export: reports, the backup copy), upload (loading a file in: the tracker import), share, trash, edit, lock, repeat (round: recurring, restore), calendar, clock, cart, arrows (transfer: two straight arrows), plus-circle (income), minus-circle (expense), alert (error: ! in a circle), warning (! in a triangle), info, x, search, card (bank card), cash, tag (categories), sliders (settings), debt (debts: a bill with «%»). Decorative (`aria-hidden`): label the button around it. A screen never edits `Icon.tsx`: it uses the closest existing icon and reports the need. |
| `Page` | `{title, subtitle?, right?, children}` | large title (an `h1` focusable by script only, `tabindex="-1"`: where focus goes when a sheet's opener is gone); slim bar on top with back button (in a pushed page), small title once scrolled, `right` actions (use `.icon-button` + `aria-label` for icons). The bar's sides never overlap the title: a long title is cut with «…» |
| `Section` | `{header?, footer?, children}` | inset grouped card; put `Row`s and fields inside |
| `Row` | `{title, subtitle?, value?, valueTone?: 'default'\|'green'\|'red'\|'orange'\|'muted', icon?: IconName \| element, iconTone?: 'tint'\|'green'\|'teal'\|'orange'\|'red'\|'muted', chevron?, onClick?, destructive?, bar?, children?, trailing?, focusKey?}` | ≥ 44 px, inset separators; with `onClick` it is a `<button>` (children must not be interactive then) **whose accessible name has «, » between its parts** (title, subtitle, children, value — visually hidden `.sr-only` separators, so VoiceOver reads «Еда, Продукты · Карта, 100,00 €», not «ЕдаПродукты · Карта100,00 €»); `children` go under the title, subtitle and bar (e.g. a line of text); `value` can be `<Money>`. **`bar`**: a decorative `ProgressBar` under the subtitle, above `children`, drawn inside the row but `aria-hidden` and with NO separator before it — a bar left in `children` would put its raw value («3500.5») into the button's name («Кредит, …, 3500.5, Выплачено …»). The row's own text (subtitle, `children`, `value`) must carry the numbers; never a `ProgressBar` in the `children` of a BUTTON row (a row without `onClick`, like «Отчёты» → categories, may keep a labelled bar in `children`: it is announced with its own label). Two lines of your own inside a row button (two spans in `children`) need the same separator between them, an inline `<span class="sr-only">, </span>` (as «Долги» does); the kit's own separators are one such span per use, never one shared vnode. **`iconTone`**: the colour of the icon square (default `tint`; `muted` is a grey square with a grey glyph, e.g. a cancelled record) — never paint over `.row-icon` from a screen. **`trailing`**: an interactive control at the right end (a check button, reorder buttons, an inline field) that does NOT trigger `onClick` — it sits next to the row's button, not inside it; give it an `aria-label`. **`focusKey`**: an identity of the row button that survives it being drawn anew under another `key` (a renamed category): a sheet opened from it gives focus back to the row with the same `focusKey` |
| `Money` | `{value, tone?: 'auto'\|'plain', signed?}` | '1 234,56 €' with no-break spaces; auto: negative → red; `signed`: '+' for positive |
| `StatCard` | `{label, value: number, tone?: 'neg'\|'pos'\|'auto' = 'auto', sub?: string, onClick?}` | a summary figure: small label, the amount through `Money`, an optional small line («Спишется 10 октября: 300,00 €»). `auto`: negative red; `neg`: always red; `pos`: always green. With `onClick` a button (with ›) |
| `StatGrid` | `{children, columns?: 2 \| 3 = 3}` | up to 3 per row at iPhone widths (3 at 440 pt; 2 at 375 pt, the rest wraps); fits amounts up to «-123 456,78 €» |
| `Button` | `{kind?: 'filled'\|'plain'\|'destructive' = 'filled', onClick, disabled?, full?, type?, children}` | one filled per view |
| `Segmented` | `{options: {value, label}[], value, onChange, label}` | radio group; **`label` is required** (what is chosen, e.g. «Тип операции»); one tab stop, arrow keys / Home / End choose; segments 44 px high, labels never wrap (4 options get 13 px type) |
| `Chips` | `{options, value: T \| undefined, onChange(T), label?}` or `{options, value: T[], onChange(T[]), multi: true}` | single: tapping selects (no deselect); multi: toggles |
| `AmountField` | `{label, value?: number, onChange(n \| undefined, {invalid}), autoFocus?, error?, placeholder?, allowNegative?, hint?}` | `inputmode="decimal"`; spaces ignored; ',' or '.': with both, the rightmost is the decimal separator; one kind used twice, or 3 digits after a 1–3 digit number ('12.500'), groups thousands; more than 2 decimals («0,125») is **invalid** → `undefined` + `{invalid: true}` and «Проверьте сумму» once the field is left. **Anything that is not empty and not an amount is invalid — letters, «€», a minus without `allowNegative` (hardware keyboard, paste): the text stays in the input (never filtered or cleared), the form keeps the stored amount and saving stays disabled.** Shows the value rounded to cents. Minus only with `allowNegative` (journal refunds). `parseAmount(text, allowNegative?)` is exported |
| `DateField` | `{label, value?: ISODate, onChange(d \| undefined, {invalid}), error?, min?, max?, hint?}` | `type="date"`; a year outside 1900..2200 or a half-typed date is **invalid** → `undefined` + `{invalid: true}` and «Проверьте год» once the field is left. Cleared → `undefined` + `{invalid: false}` |
| `NumberField` | `{label, value?, onChange(n \| undefined, {invalid}), min?, max?, integer? = true, error?, placeholder?, hint?}` | out of range → «От 1 до 12» at once, text that is not a number → «Проверьте число» once left; both **invalid** (`undefined` + `{invalid: true}`). Same rule as `AmountField`: letters, decimals in an integer field, a minus where not allowed stay in the input and make the field invalid — nothing is silently cut or cleared. **`integer={false}` reads a PLAIN decimal (a rate in %), not money:** digits with at most one decimal separator, ',' or '.' — «3,875», «3.875» and «7,125» are 3.875 and 7.125 (they are NOT read as thousands, unlike in `AmountField`); **no thousands grouping**, so «1 000», «1,2,3», «1.234,5» are invalid; a half-typed «5,» is 5 and «,5» is 0.5 (at least one digit); spaces (also no-break) only around the number are ignored; a leading minus (or «−») only when `min` is missing or negative. An existing value shows without float noise or grouping, up to 6 decimals, trailing zeros trimmed (3.875 → «3,875», 0.1 + 0.2 → «0,3», 1234.5 → «1234,5»). Money always goes through `AmountField` |
| `useFieldValidity()` | → `{anyInvalid, isInvalid(name), field(name, set), forget(name)}` | for forms: `onChange={v.field('date', setDate)}` passes valid values (and clearing) to `setDate` and only marks invalid ones, so the stored value is kept; `disabled={v.anyInvalid}` on the save button. **A field that unmounts is forgotten automatically** (a conditional field, e.g. «Цена» while «Куплено» is on, cannot keep saving disabled after it is hidden; shown again it starts valid, with the kept value). A form that hides a field without unmounting it (`hidden`, CSS) calls `v.forget(name)` (the field's typed text is not reset). **Use a distinct `name` per field**: two fields with the same name share one flag, and one unmounting clears the other's |
| `TextField` | `{label, value?, onChange(s \| undefined), placeholder?, autoFocus?, error?, maxLength?, stacked?, autoCapitalize?, noAutocorrect?, hint?}` | `''` → `undefined` (store `what: v ?? ''` where the model needs a string) |
| `SelectField` | `{label, value?, options: {value, label}[], onChange(v \| undefined), placeholder?, emptyLabel?, error?, hint?}` | native select; `placeholder` adds the empty choice (optional field) that emits `undefined`; without one, nothing chosen reads `emptyLabel` (default «Не выбран»; «Не выбрана» for «Карта») as a disabled choice |
| `ToggleField` | `{label, value: boolean, onChange(b), disabled?, hint?}` | iOS switch (`role="switch"`) |
| field `hint` | `hint?: string` on every field above | a short muted note under the field, inside its card (under the error when both show), that also describes the control (`aria-describedby`: error, then hint). Use it for a note about ONE field («Сумма факт учитывается как оплата…», «Месяц учёта останется: …») — never a local `<p>` between fields; a note about the whole card is the `Section` footer |
| `Sheet` | `{open, title, onClose, left?, right?, children}` | bottom sheet: grabber, rounded top, ≤ 92dvh, own scroll, backdrop tap / Esc / drag down close, focus trapped and restored to what opened it — when that element is gone (or lies in a modal that has closed too: the card whose «Удалить» asked in a `Confirm` and closed with it), to the row drawn in its place (the same Row `focusKey`), else to the page's main heading, never `<body>`; focus that another modal's clean-up already put on the page is left there; `focusOpenModal()` puts focus back into the open sheet (the shell calls it when the lock screen goes away); keeps showing its last content while sliding away; renders into the shell's overlay root. Header buttons: `<Button kind="plain">Отмена</Button>` left, «Готово»/«Сохранить» right (bold); a long title is cut with «…», never under the buttons. Body helpers: `.sheet-text` (explanation), `.sheet-actions` (bottom buttons). |
| `Confirm` | `{open, title, message?, confirmLabel, cancelLabel? = 'Отмена', destructive? = true, onConfirm, onCancel}` | action sheet for destructive confirms; focus starts on «Отмена»; the message describes the dialog (`aria-describedby`) |
| `MonthPicker` | `{value: YM, months: YM[], onChange}` | ‹ Октябрь 2026 ›; only steps to months in `months` (ascending); from a month outside, steps to the nearest inside |
| `Banner` | `{tone: 'info'\|'warning'\|'error'\|'success', children, action?: {label, onClick, disabled?}, onClose?}` | card notice; `error` has `role="alert"`; the close button is 44 × 44; `action.disabled` while it is busy |
| `EmptyState` | `{title, text?, action?: {label, onClick}}` | |
| `ProgressBar` | `{value, max, tone?: 'tint'\|'green'\|'red'\|'orange', label}` | **`label` is required** (e.g. «Потрачено из лимита»); over `max`: full and red; `aria-valuenow` stays within 0..max. **Inside a button `Row` (with `onClick`), pass it as `bar={…}`, not as `children`** (see `Row`) |
| `Toast` + `showToast(text, {undo?, action?: {label, onClick}, durationMs?}) → id`, `hideToast(id?)` | | one toast above the tab bar and above sheets; one polite live region; «Отменить» when `undo`, the `action` before it (both may be there); 5 s with a button, 3 s without. When it goes (tapped, timed out, replaced) while one of its buttons has focus, focus goes into the open sheet, else to the page's main heading — never `<body>` |
| `PinPad` | `{title, message?, messageTone?, value, onChange, length? = 4, disabled?, shake?: number, footer?, inPage?}` | controlled PIN keypad. **In a Page (the «PIN» page) pass `inPage`**: no lock icon, the title is an `h2` under the page's `h1`. Keep the digits in component state only, hash with `setPin`, save with `actions.updateMeta` (see Actions). The hardware keyboard reaches only a pad that is not inside a `hidden` or `inert` part of the page, so the PIN page behind the lock screen never gets the digits typed into the lock. |
| `OverlayHost` | `{children}` | used once by the shell (`App.tsx`); screens do not render it |

Also exported: `ICON_NAMES`, `isValidDate(iso)` (year 1900..2200, real date), `parseAmount`, `useUid`, all `*Props`
types, `FieldInfo`, `FieldChange`, `Option`, `KitAction`, `Tone` (Row `valueTone`), `IconTone` (Row `iconTone`).

CSS helpers in `styles.css`: `.icon-button` (44 px round icon button, tinted), `.link-button`, `.sheet-text`,
`.sheet-actions`, `.tone-green|red|orange|muted`, **`.sr-only`** (text for screen readers only — e.g. «Октябрь 2026»
behind a visible «Окт», «, остаток » between two amounts; never a local copy of it). It is absolutely positioned:
inside a horizontal scroller give the scroller `position: relative`, or the hidden text widens the page.
Colours only through the tokens (`var(--tint)`, `--label-2`, …). Green TEXT is `--green-text` (4.5:1 on the cards; `.tone-green`
uses it), the bright `--green` only fills and icons; likewise red and orange TEXT is `--red-text` / `--orange-text`
(`.tone-red`, `.tone-orange`, destructive buttons and rows, field errors), the bright `--red` / `--orange` only fills and icons; white text sits on `--tint-fill` (a filled button, a chosen chip), not on `--tint`.

## Formats — `format.ts`

- `formatMoney(n, {signed?})` → '1 234,56 €' (no-break spaces; never «-0,00 €»); cents are rounded half away from
  zero, the same for negatives (-12.345 → «-12,35 €»). `roundCents(n)` gives that number; `isNegativeMoney(n)`.
- `formatDate('2026-09-30')` → '30.09.2026'; `formatShortDate('2026-12-10')` → '10.12' (a date inside a line, e.g.
  «с 10.12», a week «28.09–04.10»; never `formatDate(…).slice(0, 5)`); `formatDay('2026-09-30', {year?})` → '30 сентября' ('30 сентября
  2026'); `formatWeekdayDate('2026-09-30')` → 'Среда, 30 сентября' (the «Сегодня» subtitle; worked out from the
  string, no `Date`). Month names: `monthLabel(ym)` from the engine → 'Октябрь 2026'.
- `todayISO(date?: Date)` → the LOCAL calendar date 'YYYY-MM-DD' of `date` (default: now). In components prefer
  the reactive `today()`.
- `localDateOf(stamp?: string)` → the local date of a stored ISO timestamp, or `undefined` when there is none or it
  cannot be read. The last backup: `const d = localDateOf(meta.value.lastBackupAt); d ? formatDate(d) : 'ещё не было'`.
- `localTimeOf(stamp?: string)` → its local time 'HH:MM' (or `undefined`): the last sync «01.10.2026, 23:05».

## Files — `share.ts`, `io.ts`, `backupNow.ts`

```ts
import { shareFile, pickFile } from '../share';
import { loadBackup, loadReports, loadTrackerImport, ioErrorMessage } from '../io';
import { backupNow } from '../backupNow';

// export: call straight from the tap handler — Safari opens the share sheet only right after a tap
const { monthReport } = await loadReports();
const { filename, buffer } = await monthReport(appData(), ym);
await shareFile(filename, buffer);   // 'shared' | 'cancelled' | 'downloaded'
```
- `shareFile(filename, buffer)` — .xlsx; the share sheet when it accepts files (closing it → `'cancelled'`, not an
  error), otherwise (or when it refuses) a download link.
- `pickFile(accept): Promise<File | null>` — call synchronously inside the tap (before any `await`). `null` when
  cancelled; **rejects with `FileTooLargeError` («Файл больше 20 МБ») for a file over 20 MB** (`MAX_FILE_BYTES`) —
  await it inside your `try` and show `ioErrorMessage(e)`.
- `makeCopy()` and `copying` (`backupCopy.ts`) — «Сделать копию» on «Сегодня» and on «Резервная копия»: `copying` is
  true while a copy is made (disable the button), then the toast «Копия готова» (or «Копия сделана, но дата не
  сохранилась» when the date could not be saved); a closed share sheet says nothing. It calls:
- `backupNow(): Promise<'shared' | 'downloaded' | 'cancelled'>` — the full backup: `exportBackup(data, now as an ISO datetime)` → `shareFile(backupFilename(local today))` →
  `markBackupDone()` unless cancelled. A failure shows a toast with the error's message (e.g. the `BackupError`)
  and resolves `'cancelled'` (nothing recorded). A second call while one runs joins it.
- `loadTrackerImport()` → `{ importTracker }`, `loadBackup()` → `{ exportBackup, importBackup, backupFilename }`
  (`exportBackup(data, at, { stamp })` writes a sync stamp as the document's description),
  `loadReports()` → `{ monthReport, yearReport, accountsReport }`, `loadSync()` → `{ formatStamp, parseStamp,
  readStamp, newSyncId, stampTime, dataHash }` (small, no ExcelJS; jszip only inside `readStamp`). A chunk that fails to download rejects with
  «Не удалось загрузить модуль, проверьте подключение.»
- `ioErrorMessage(e)` — the text to show: the message of `TrackerImportError`, `BackupError`, `StoreError`,
  `DataChangedError`, `FileTooLargeError`, `SyncError` or a failed module load; anything else «Что-то пошло не так. Данные не
  изменены.» Never leave a half-applied state: read/parse first, then `actions.replaceData` (import/restore) or
  `actions.commit`.

## Sync with the Mac — `sync.ts` (spec `.internal/specs/2026-10-01-icloud-sync.md`)

The app and the Excel tracker on the Mac meet in the iCloud Drive folder «Трекер расходов — синхронизация»; a
service on the Mac does its half. No network: files go out through `shareFile` and come in through `pickFile`.

- **The stamp** (`src/io/sync.ts`), in `docProps/core.xml` `<dc:description>` of both files:
  `money-planner-sync/1 id=<16 hex> base=<16 hex|-> dirty=<0|1> at=<ISO-8601 UTC> from=<app|mac>`. A stamp of ours
  that cannot be read (or of a newer version) is a `SyncError`, never «no stamp».
- **The state**: `meta.sync = { lastId, lastAt, syncedHash, sentDirty? }` (absent: never synced), written only by
  `actions.setSync`; `syncOf(meta)` gives it when usable. «Есть неотправленные изменения» = `dataHash(data)` ≠
  `syncedHash` (always when never synced), computed on demand (`hashOf` caches per data object, `useUnsent()`), never
  written per commit. `sentDirty`: a version was sent with changes and no Mac file built on it has been picked up
  since — it stays through later sends and goes when a picked Mac file has `id == lastId` (`resolveSentDirty`) or a Mac
  version is taken (any `setSync` after a replace).
- **«Отправить на Mac»** (`sendToMac()`, from the tap): new id, `base = lastId` (or «-»), `dirty` = unsent changes or
  `sentDirty` (iOS may have put this file in the place of the one with the changes: with dirty=0 the Mac would archive
  it as older), `from=app`, in the full backup `Из приложения.xlsx` → `shareFile`; 'shared' / 'downloaded' → `setSync`
  (this id, this data's hash, `sentDirty` when dirty); 'cancelled' → nothing. `sending` is true meanwhile.
- **«Забрать с Mac»** (`classifyPickUp`): no stamp → the usual tracker import; `from=app` → «выберите «Для
  приложения.xlsx»»; `id == lastId` → «Нового нет» (and `resolveSentDirty`); a Mac version → a warning first when the app holds unsent changes
  («Сначала отправить на Mac» / «Всё равно заменить») or when its last version was sent with changes and this file is
  not built on it (`base ≠ lastId`); then the usual preview (`ReplaceDataSheet`) and `replaceKeepingBefore(next)`;
  after it `setSync` (the file's id, the new data's hash).
- **«Загрузить трекер» and the onboarding import** read with `readTrackerStamped(buf)`: the tracker plus `mac` (the
  version of a `from=mac` stamp and the hash of the data read). After the replace `setSyncFromImport(mac)` sets the sync
  state as «Забрать с Mac» does (no false conflict on the next send); it never rejects (a failed save: a toast). A stamp
  that cannot be read never stops the import: `mac` is null and the first note is `STAMP_UNREADABLE`.
- **The data set before the sync** (`saveBeforeSync` / `loadBeforeSync` in `src/store/db.ts`, key `beforeSync`): one
  level, the data and the sync state they had. `replaceKeepingBefore` replaces nothing unless it was kept first (and
  refuses with `DataChangedError` when the data changed while it was kept), and puts the earlier one back when the
  replace fails (when that fails too, `beforeSync` is read again: what is offered is what is stored). Written like the
  data — only while the stored generation is this tab's (a `StaleTabError` stops the tab) — and read only for this
  tab's generation; a wipe deletes it. «Вернуть данные до синхронизации» (`restoreBeforeSync`) reads it again (the
  newest of this data set), brings back the data (`actions.replaceData`), then its sync state and then forgets it — two
  separate steps, one failing never skips the other — and says how it went in a toast. Nothing kept: «Данных до
  синхронизации больше нет.» — or, in a tab whose data set another tab replaced, the tab stops.
- **«Сегодня»**: `reminderDue(sync)` (synced, more than a day ago) and `useUnsent(due)` → one quiet row.

## App flow (for reference; not to be changed by screens)

Start: `loadMetaAtStart()` (an old meta gets its generation; when that cannot be stored, it goes on without one
and the next meta write stores it), `loadData()`, then the meta again — when another tab
deleted the data or set up new ones in between, everything is read again, so one data set's PIN never opens
another's data. A `StoreError` → a full-screen message decided by its `code`: damaged data,
damaged PIN settings or a read error offer «Попробовать снова» and «Удалить данные…» (after typing «УДАЛИТЬ»);
data saved by a newer app version offers only «Обновить приложение» (looks for the new version and applies it —
nothing is deleted); anything else only «Попробовать снова». **Data without a valid PIN fails closed** (the same
screen with the wipe; never onboarding). No data and no PIN → onboarding (PIN twice → «Загрузить трекер из Excel»
/ «Восстановить из резервной копии» / «Начать с нуля»). PIN → lock on every start and after > 5 min in the
background (or when the clock went back); a PIN check that outlives such a lock does not unlock. While the app is in
the background an opaque cover hides it (the app switcher shows no data); it is removed on return after the lock
decision. After the first unlock the tabs stay mounted — hidden and inert — while locked, so an open form survives.
«Доступна новая версия» banner with «Обновить» when the service worker has an update. Once the tab has stopped
(another data set is stored), only the stop screen is shown.

## Tests

UI tests live in `tests/ui/*.test.tsx` (screens: `tests/ui/d1…d6/*.test.tsx`, by the waves that built them) with `// @vitest-environment
happy-dom` at the top (engine/io tests stay in node). Use `@testing-library/preact`. The whole run uses the time
zone `Pacific/Auckland` (UTC+12/+13, `vite.config.ts`), so a UTC date where a local one belongs fails the tests.

In `beforeEach`: `useFactory(new IDBFactory())` (fake-indexeddb) and `resetSession()`; in `afterEach`:
`cleanup()`, `await actions.flush()`, `resetSession()`, `useFactory(undefined)`. To make a store function fail,
mock the module partially (`vi.mock('../../src/store/db', async (orig) => ({ ...(await orig()), saveData:
vi.fn(...) }))`) — `vi.spyOn` on an ES module namespace does not work. The app writes the meta only through
`updateStoredMeta`: to make a meta write fail or wait, mock that (not `saveMeta`); set up what another tab stored
with `saveMeta`. A test that sets `meta.value` itself stands for what the tab loaded: store the same meta (at least
the same `generation` — none in both is fine), or a save counts it as another data set. In a file that uses `vi.mock` and
`import.meta`, do not import a binding named `meta` (import `meta as appMeta`): Vitest's hoisting rewrites
`import.meta` otherwise.

**Screen-test recipe.**
```tsx
import { scenario } from '../../engine/scenario';
data.value = scenario();                               // the engine's test data
render(<><Today /><SheetHost /><Toast /></>);          // the screen with the sheet host and the toast
fireEvent.click(screen.getByRole('button', { name: 'Новая операция' }));
// … fill the form, save …
await actions.flush();                                 // the commit is written
expect(data.value?.operations).toContainEqual(expect.objectContaining({ what: 'Кафе', amount: 12.5 }));
expect(await loadData()).toEqual(data.value);          // and stored
```
Assert on the committed `Data` (and on what the user sees), not on internals. Without an `OverlayHost` sheets
render in place, so `screen.getByRole('dialog', { name })` finds them either way.
