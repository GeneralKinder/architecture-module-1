# ReportDEMO: опис виконаної роботи та відповіді за рівнями оцінювання

Як влаштовано файли:
- [`FinalReport.md`](FinalReport.md) містить **лише 7 deliverables** з README: дві діаграми, Decision summary, Principles, Risk analysis, Metrics + Fitness Functions, AI та Time to Market.
- Цей файл містить **усе, що треба знати й казати для оцінки**. Порядок такий самий, як у розділі **Assessment** README: спочатку критерії 60 балів, потім 75, 90 і 100. Кожен рівень включає попередні. У дужках біля пункту вказано, на яке питання README він відповідає.
- В останніх розділах окремо описано зміни в коді та як перевірити роботу.

---

## 0. Що було зроблено: покроково

1. **Прочитано всі матеріали завдання:** `README.md` і всі файли в `docs/` (system overview, business context, engineering metrics, change scenarios, analysis tools, architecture proposal, AI time to market).
2. **Проаналізовано код кожного модуля** в `src/` і знайдено конкретні рядки, що підтверджують або спростовують проблеми.
3. **Перевірено гіпотезу експериментом:** окремий скрипт з email-провайдером, що завжди падає, показав `order = FAILED`, `payment = CAPTURED`, stock повернуто.
4. **Змодельовано latency checkout** (200 000 симуляцій за параметрами `src/config.js`):

   | | p50 | p95 | p99 |
      | --- | ---: | ---: | ---: |
   | З email у критичному шляху (зараз) | ≈ 0,5 s | ≈ 2,5 s | ≈ 3,1 s |
   | Без email | ≈ 0,2 s | ≈ 2,25 s | ≈ 2,85 s |

   Ймовірність успіху checkout зараз = 0,95 (payment) × 0,98 (email) ≈ **93,1%**.
5. **Прийнято архітектурне рішення** і зроблено розрахунки за формулами з `docs/analysis-tools.md`: Expected Risk Cost, Change Cost, Architecture Tax, TTM по stages.
6. **Намальовано 2 діаграми** (Mermaid), обидві перевірені рендером через mermaid-cli.
7. **Реалізовано одне boundary-покращення + 4 fitness functions** (розділ 5 цього файлу). `npm test` дає 9/9 pass.

### Assumptions, що використовуються в розрахунках

| # | Assumption | Чому defendable |
| --- | --- | --- |
| A1 | Середній чек ≈ $150, ≈ 14 400 замовлень/місяць (≈ 20/год), revenue checkout ≈ $3 000/год | Продаж техніки, ціни seed-товарів $39–$279; навантаження обслуговує 1 instance |
| A2 | Під час checkout-інциденту втрачається ≈ 40% замовлень | Частина покупців повертається пізніше |
| A3 | Hourly Cost = $50 | Приклад із `docs/analysis-tools.md` |

---

## 1. Рівень 60 балів

### 1.1 Зрозуміла current architecture

OrderFlow є **modular monolith**:
- 1 process, 1 deployment artifact, спільна in-memory DB;
- release у спільному вікні 2 рази на тиждень, rollback повертає весь release.

Checkout синхронно оркеструє весь flow: `createDraft` → `reserve` → `chargeOrder` → `markPaid` → `complete` → `sendOrderConfirmation`. Будь-яка помилка в `catch` робить release stock + `fail(order)`.

| Module | Responsibility | Як реалізовано зараз |
| --- | --- | --- |
| Checkout | Оркестрація flow і compensation | `CheckoutService.js`: усі кроки послідовно, email теж у критичному шляху (`:26`) |
| Orders | Draft, статуси, total | `OrderService.js`: total рахує через `shared/money.js` з таблиці products (`:16`) |
| Inventory | Reserve/release | `InventoryService.js`: idempotency через `operationKey` (`:9-11`) |
| Payments | Виклик provider, запис платежу | `PaymentService.js`: раніше сам читав order з `OrderRepository`; provider викликається без timeout |
| Notifications | Формування і відправка email | `NotificationService.js`: template захардкожений (`:10`), відправка синхронна |
| Reporting | Sales summary, operational health | `ReportingService.js`: сканує колекції orders, payments, notifications, products in-process (`:7-30`) |

### 1.2 Читабельні current і proposed diagrams

**FinalReport §1, Current architecture.** На діаграмі видно:
- один process і спільну DB;
- **sync**-залежності Checkout від усіх модулів;
- **жирною** стрілкою синхронне очікування email;
- **пунктиром** три boundary leaks (Payments → OrderRepository, Orders → products, Reporting → чужі колекції);
- зовнішні providers з їхніми характеристиками.

**FinalReport §2, Proposed architecture.** На діаграмі видно:
- 2 deployment boundaries: Core і Notifications worker;
- major components;
- sync-виклики (суцільні) та async (пунктир: outbox → Notifications, outbox → Reporting read model, webhook від provider);
- external providers, включно з майбутнім Provider-2;
- те, що Marketing публікує templates без deploy.

### 1.3 Визначені базові проблеми (Питання 1)

| # | Проблема | Evidence: code | Evidence: metrics / business |
| --- | --- | --- | --- |
| P1 | **Payments читав Orders repository напряму.** Зміна моделі Order ламає Payments | Оригінальний `PaymentService.js:11-12`: `this.orderRepository.findById(orderId)` | 48% feature PR торкаються Orders і Payments одночасно |
| P2 | **Email у критичному шляху checkout.** Якщо email падає, гроші вже списані, а order стає FAILED і stock повертається | `CheckoutService.js:26-27` + `catch` на `:35-36`. Експеримент: `order=FAILED, payment=CAPTURED, stock=12` | 37% змін templates вимагали regression checkout. Email додає ≈ 300 ms. ≈ 1,9% усіх checkout стають «charged but failed» |
| P3 | **Немає timeout і fallback для payment provider** | `PaymentService.js`: `await this.provider.charge(...)` без обмеження | 2 останні інциденти почалися з payment latency spikes; MTTR 35 → 95 хв |
| P4 | **Reporting читає operational data всіх модулів у тому самому process** | `ReportingService.js:15-21`: `find` усередині `map`, складність O(orders × payments). `:48` рахує revenue за **поточною** ціною товару, а не ціною на момент замовлення | Reporting traffic ×3 за рік, очікується ×8–10 (Scenario C) |
| P5 | **Pricing без власника** | `OrderService.js:16` бере ціни з таблиці Inventory через `shared/money.js` | Scenario F (discount щомісяця) зачепить 5–6 modules |
| P6 | **Спільний release train і rollback scope** | Один artifact | Releases 5 → 2 на тиждень, Rollback 2% → 9%, Lead Time 2 → 6 днів |

**Що НЕ є проблемою** (README: «не розглядайте будь-який coupling як помилку»):
- синхронна оркестрація Orders → Inventory → Payments в одному process дає strong consistency для Scenario D;
- Inventory idempotency працює, і тест це підтверджує;
- Checkout як явний orchestrator: compensation в одному місці;
- provider injection через `createApplication(options)` уже створює adapter seam.

**Факти, припущення і причинність розділено.** Ріст Deployment Duration (8 → 27 хв) частково пояснюється test suite і ручними approvals, тобто це **process**. Те, що ріст Modules per Feature спричиняє rollback, є гіпотезою, яку перевіряють metrics (розділ 4.5).

### 1.4 Coherent architecture change (Питання 5, 6, 7, 8)

**Рішення:** зберегти modular monolith і зміцнити boundaries. Notifications виділяється в окремий deployable worker лише за тригерами.

**Які boundaries змінити (Питання 5):**
1. **Payments ↔ Orders:** explicit contract `chargeOrder({orderId, amountCents, currency}, token)` (**реалізовано**).
2. **Checkout ↔ Notifications:** подія `OrderCompleted` через outbox замість sync-виклику; templates переходять із коду у versioned config з kill-switch.
3. **Reporting ↔ operational data:** Reporting читає власний read model (projection з подій), staleness ≤ 5 хв.
4. **Pricing:** Pricing policy всередині Orders повертає price breakdown (`subtotal`, `discounts[]`, `total`); ціни приходять через query API Inventory.
5. **Payments ↔ provider:** port + adapters, timeout 3 s, circuit breaker, idempotency key, статус `PENDING`, webhook для async confirmation.

**Чи залишається modular monolith доречним? (Питання 6) Так:**
- 8 engineers + 2 QA і **немає platform team**;
- навантаження обслуговує 1 instance;
- Orders, Inventory та Payments потребують strong consistency;
- головні проблеми лежать у boundaries всередині monolith і в process.

**Чи має якийсь module стати independently deployable? (Питання 7)** Так, лише **Notifications**, у Phase 3 і лише за тригерами (розділ 4.6):
- найвища частота змін (Scenario A);
- business приймає eventual delivery;
- немає sync API для клієнта;
- падіння не впливає на revenue.

**Що виділити першим? (Питання 8)** **Notifications** як async worker, що споживає `OrderCompleted`.
- **Не Payments:** потрібна sync-відповідь клієнту, consistency з Order, обов'язковий human review security та finance, а виділення не прибирає latency provider, лише додає network hop.
- **Не Reporting:** спершу масштабуємо **дані** (read model).
- **Не Inventory:** через Scenario D.

**Evolution plan** (не rewrite; кожен крок ≤ 1 sprint і 15–20% capacity, feature delivery не зупиняється):

| Phase | Термін | Що робимо | Статус |
| --- | --- | --- | --- |
| 0 | Тижні 1–2 | Baseline metrics; fitness functions у CI | ✅ тести є |
| 1 | Тижні 1–4 | Contracts: Payments ↔ Orders, Orders ↔ Inventory; Payment port + timeout + `PENDING` | ✅ Payments ↔ Orders |
| 2 | Тижні 4–10 | Outbox + in-process dispatcher (email, Reporting projection); templates як config | — |
| 3 | Місяці 3–6, gated | Notifications worker як окремий deploy; release Core щодня | — |
| 4 | Місяці 9–12, gated | Reporting як окремий data store, лише за тригером | — |

---

## 2. Рівень 75 балів

### 2.1 Responsibilities та dependencies пояснені

| Залежність | Тип | Виправдана? | Чому |
| --- | --- | --- | --- |
| Checkout → Orders, Inventory, Payments | sync, in-process | ✅ Так | Потрібна strong consistency: reservation до charge, compensation при помилці |
| Checkout → Notifications | sync, критичний шлях | ❌ Ні | Business: «checkout availability важливіша за миттєвий email» |
| Payments → OrderRepository | прямий доступ до чужого repository | ❌ Ні | Information Hiding порушено; 48% PR зачіпають обидва модулі |
| Orders → products (через `shared/money.js`) | читання чужої таблиці | ❌ Ні | Pricing без власника; Scenario F |
| Reporting → orders, payments, notifications, products | читання чужих таблиць | 🔶 Тимчасово | Для малого обсягу просто; при ×8–10 traffic і schema-змінах стає дорогою |
| Inventory → свої таблиці | власні дані | ✅ Так | Idempotency в одному місці |
| Усі → `shared/errors.js` | shared kernel | ✅ Так | Стабільний, не створює cost of change |

### 2.2 Architectural characteristics мають пріоритет (Питання 2)

| Пріоритет | Characteristic | Чому | Response measure |
| --- | --- | --- | --- |
| 1 | **Availability і Resilience checkout** | Checkout = revenue; business прямо ставить його вище за миттєвий email | Checkout success ≥ 99,5% (без урахування відмов банку); p99 ≤ 3,5 s навіть під provider spikes |
| 2 | **Data integrity** (Inventory, Payments) | Overselling і «гроші без замовлення» дорожчі за затримку | 0 подвійних змін stock; 0 замовлень «CAPTURED + FAILED» |
| 3 | **Modifiability** Payments, Notifications, Pricing | Найчастіші зміни (Scenarios A, B, F) | Modules Changed per Feature < 2,5 |
| 4 | **Deployability** | Спільний release train дає чергу, rollback 9% | Lead Time ≤ 3 дні, Rollback < 4% |
| 5 | **Scalability** Reporting | Горизонт 12 місяців, staleness у кілька хвилин прийнятний | Checkout p95 змінюється ≤ 5% під 10× report load |

**Чим свідомо жертвуємо:**
- **негайністю email:** eventual, p95 ≤ 5 хв;
- **свіжістю reports:** до 5 хв;
- **незалежним scaling і deployment** більшості модулів;
- **«кожен модуль = окрема БД»:** logical schemas в одній БД;
- **трохи більшою кількістю infrastructure:** outbox, dispatcher, template config.

### 2.3 Principles застосовані до конкретних місць

У FinalReport §4 обрано 4 принципи.

**Information Hiding**
- *Порушено:*
   - Payments знав про внутрішній `OrderRepository`;
   - Reporting знає структуру `orders`, `payments`, `notifications`, `products`;
   - Orders читає таблицю products (`OrderService.js:16`).
- *Proposal:* модулі бачать лише public contract або подію, таблиці стають private для модуля-власника.

**Explicit Contracts**
- *Порушено:* `chargeOrder(orderId)` неявно вимагав, щоб Payments сам дістав order.
- *Proposal:*
   - `chargeOrder({orderId, amountCents, currency})` (**реалізовано**);
   - versioned подія `OrderCompleted`;
   - contract tests.

**Low Coupling (temporal coupling)**
- *Порушено:* Checkout тимчасово зв'язаний із FakeMail, тож падіння email ламає оплачене замовлення.
- *Proposal:* outbox розриває temporal coupling; timeout і breaker обмежують coupling із FakePay.

**Fitness Functions**
- *Порушено:* boundaries нічим не захищені, тому leak повертається з наступною (зокрема AI-generated) зміною.
- *Proposal:* dependency rules як автоматичні тести (**реалізовано** FF1–FF4).

**Де принципи вже дотримані:**
- **High Cohesion** в Inventory: idempotency в одному місці;
- **Local Reasoning** у Checkout: compensation в одному `catch`.

### 2.4 Зміни пов'язані з requirements і scenarios (Питання 10, частина)

| Scenario | Stimulus | Response | Affected components | Response measure | Рішення |
| --- | --- | --- | --- | --- | --- |
| A Notifications | Marketing змінює template або вимикає експеримент | Зміна публікується як config, без app deploy | Notifications, template config | ≤ 1 год до prod; kill-switch ≤ 5 хв; 0% змін з checkout regression | Templates як config + async |
| B Payment provider | Новий provider або outage основного | Routing через port; async confirm: `PENDING` → webhook | Payments (+ обробка `PENDING` у Checkout) | Новий provider = зміна в 1 module; failover ≤ 1 хв після відкриття breaker | Adapter, **без** нового service |
| C Reporting ×8–10 | Довгі date ranges, частіші запити | Відповідь із read model | Reporting, projection | Checkout p95 змінюється ≤ 5% під 10× report load; staleness ≤ 5 хв | Read model; виділення лише за тригером |
| D Inventory idempotency | Повторний reserve/release | Stock змінюється рівно 1 раз | Inventory | 0 подвійних змін (тест) | **Без змін**, sync in-process |
| E Checkout availability | Provider відповідає 2–3 s або недоступний | Bounded latency; email поза критичним шляхом | Checkout, Payments | p99 ≤ 3,5 s; падіння email має 0% впливу на checkout; email p95 ≤ 5 хв | Timeout + breaker + outbox |
| F Discount | Нове discount rule щомісяця | Клієнт бачить правильну суму до списання; Reporting бачить discount | Orders/Pricing (+ мапінг у Reporting) | ≤ 2 modules; сума клієнту = сума списання (100%) | Pricing policy в Orders, **sync** |

**Зв'язок із business context:**

| Business вимога | Рішення |
| --- | --- |
| «Checkout availability важливіша за миттєвий email» | Email через outbox |
| «Payments змінюється частіше» | Port + adapters |
| «2–3 експерименти на тиждень» | Templates як config |
| «Inventory consistency важлива» | Inventory без змін |
| «Повна зупинка feature delivery неприйнятна» | Поетапний plan по 15–20% capacity |
| «Бюджет на infrastructure може зрости, якщо результат вимірюваний» | Метрики й тригери |

Не кожен scenario потребує нового service: A і C вирішуються async-взаємодією всередині monolith, D вимагає залишити все як є.

---

## 3. Рівень 90 балів

### 3.1 Визначені основні cost-of-change drivers (Питання 3)

| Rank | Dependency | Чому дорога | Scenario |
| --- | --- | --- | --- |
| 1 | **Checkout → Notifications (sync) + template у коді** | Найчастіша зміна (2–3 рази на тиждень) потребує deploy усього app і regression checkout | A, E |
| 2 | **Payments → Orders repository** | Couples дві найактивніші зони; кожна зміна Order schema стає зміною Payments | B, F |
| 3 | **Reporting → таблиці всіх модулів** | Будь-яка schema-зміна в Orders, Payments чи Notifications ламає звіти | C, F |
| 4 | **Orders → products (pricing через shared)** | Discount rules не мають місця і розмазуються | F |
| 5 | **Shared release train** (process-level coupling) | Будь-яка зміна чекає вікна, rollback забирає чужі зміни | Усі |

### 3.2 Виконано risk analysis

Таблиця є у FinalReport §5. Як отримано числа:

**R1. Payment latency spike блокує checkout** (поточний ризик)
- *Probability 0,8 на місяць:* 5 інцидентів на місяць, 2 останні почалися з payment.
- *Impact:* 1,6 год MTTR × $3 000 × 40% ≈ $1 900 + recovery (3 eng × 2 год × $50 = $300) + support і reputation ≈ $800, разом ≈ **$3 000**.
- *ERC:* ≈ **$2 400/міс**. Після mitigation impact ≈ $800, ERC ≈ $650.

**R2. Email падає після оплати: «charged but FAILED»** (поточний, підтверджений експериментом)
- *Probability:* подія повторюється щомісяця: 0,95 × 0,02 ≈ 1,9% checkout × 14 400 ≈ 274 замовлення.
- *Impact:* 274 × $15 (refund, support) ≈ **$4 100** + ризик overselling.
- *ERC:* ≈ **$4 000/міс**. Якщо реальний failure rate email 0,5%, ERC ≈ $1 000.

**R3. Outbox або worker зупиняється** (**створює наше рішення**)
- *Probability 0,3 на місяць.*
- *Impact:* stall на 4 год × 20 замовлень = 80 клієнтів без листа; ≈ 30% з них звертаються × $10; плюс 4 год engineering, разом ≈ **$700**.
- *ERC:* ≈ **$210/міс**.

**R4. Timeout дає невизначений стан платежу** (**створює наше рішення**)
- *Probability 0,9 на місяць* (≥ 1 випадок під час spikes).
- *Impact:* ≈ 20 випадків × $40 ≈ **$800**.
- *ERC:* ≈ **$720/міс**.

**R5. Migration сповільнює roadmap** (одноразовий)
- *Probability 0,4 на квартал.*
- *Impact:* 2 eng × 3 тиж × 40 год × $50 = **$12 000**.
- *ERC:* ≈ **$4 800 одноразово**.

**R6 (додатково). Reporting ×8–10 деградує checkout**
- *Probability 0,5 на рік.*
- *Impact:* 6 піків × 2 год × $3 000 × 20% ≈ **$7 200**.
- *ERC:* ≈ **$3 600/рік**.
- *Mitigation:* read model, limits на date range.

**Висновок:** поточні R1 + R2 ≈ **$6 400/міс** значно перевищують нові R3 + R4 ≈ **$930/міс** і одноразову migration. Це кількісно обґрунтовує Phase 1–2.

### 3.3 Використані metrics або cost formulas

**Change Cost Analysis** (`Change Cost = Engineering Hours × $50`).

**Scenario A: новий notification experiment** (2–3 рази на тиждень)

| Вимір | Поточна architecture | Запропонована architecture |
| --- | --- | --- |
| Modules touched | Notifications + Checkout (regression), спільний artifact | 0 code modules (лише template config); для зміни segmentation logic 1 module |
| Engineering hours | Impl 2 + review 1 + coordination 2 + testing (0,37 × 8 + 0,63 × 3 ≈ 4,9) + release 1,5 ≈ **11,4 год** | Impl 1 + review 0,5 + preview/contract test 1 + publish 0,5 ≈ **3 год** |
| Coordination overhead | Чекати release window (2 рази на тиждень), узгодження з власниками checkout | Marketing і власник Notifications, без release window |
| Testing scope | У 37% випадків повний checkout regression | Template rendering + contract `OrderCompleted` |
| Deployment scope | Увесь app; rollback забирає всі зміни release | Config publish; kill-switch ≤ 5 хв |
| Change Cost | **$570** | **$150** |

**Scenario F: discount для payment methods і наборів товарів** (щомісяця)

| Вимір | Поточна architecture | Запропонована architecture |
| --- | --- | --- |
| Modules touched | `shared/money.js`, Orders, Checkout, Payments, Reporting, Notifications: **5–6** | Orders/Pricing + мапінг `discounts` у Reporting: **2** |
| Engineering hours | Impl 24 + coordination 8 + testing 16 + release 4 = **52 год** | 16 + 3 + 8 + 2 = **29 год** |
| Coordination overhead | Високий: кілька власників, 2 senior reviewers, finance review | Середній: finance review залишається (process) |
| Testing scope | Увесь checkout + reports | Pricing rules + contract tests |
| Deployment scope | Увесь app | Core app |
| Change Cost | **$2 600** | **$1 450** |

**Architecture Tax** (`Current Change Cost − Baseline`, baseline = запропонована architecture):
- **Scenario A:** $420 × 2,5 на тиждень × 50 тижнів ≈ **$52 000/рік**. Інвестиція в outbox + templates ≈ 110 год ≈ $5 500, окупність ≈ 1,5 місяця.
- **Scenario F:** $1 150 × 12 ≈ **$13 800/рік**.

**Чому оцінки відрізняються:** у запропонованій architecture зміна живе в одному власнику і поширюється через contract або подію, а не через спільні таблиці та спільний release.

**Evidence, що підтримують рішення (Питання 10):**
- код з конкретними рядками (1.3);
- експеримент із падінням email;
- моделювання latency;
- metrics з `engineering-metrics.md`;
- Change Cost, Architecture Tax і Expected Risk Cost;
- fitness tests, що падають на оригінальному коді.

### 3.4 Пояснено хоча б один non-obvious trade-off (Питання 9)

1. **Timeout на payment перетворює latency-проблему на consistency-проблему.** Якщо checkout перериває очікування, а provider фактично списав гроші, стан платежу невідомий. Тому timeout **неможливий без** idempotency key (`orderId` як `reference`), статусу `PENDING`, утримання reservation та reconciliation job.
   - За поточної конфігурації (10% повільних викликів, рівномірно 1,5–3 s) timeout 2,5 s відправляв би в `PENDING` 10% × 1/3 ≈ **3,3%** платежів, тобто ≈ 480 на місяць.
   - Тому обрано **3 s**: платимо вищим p99 за меншу кількість невизначених станів.
2. **Async email покращує availability, але змінює контракт для клієнта.**
   - HTTP-відповідь checkout більше не містить `notification`;
   - Reporting показує `notificationStatus = PENDING`;
   - at-least-once delivery дає можливі **дублікати**, тому потрібен dedupe key `orderId + template`.
3. **Discount не можна робити async.** Event-driven підхід знижує coupling, але клієнт мусить бачити правильну суму **до** списання (Scenario F), тому Pricing залишається синхронною частиною Orders.

### 3.5 Проаналізовано AI Time to Market scenario (9 пунктів README)

**1. Перевірте assumptions.**
- Implementation займає 40 з 120 днів (33%). Навіть нескінченне прискорення implementation дає **80 днів**, а не 30 (закон Амдала).
- «4× швидше» стосується **написання коду**, а не всього stage: implementation також включає design, очікування review (2 senior engineers), обов'язковий human review security та finance, rework.
- AI-зміни, ймовірно, **збільшать** навантаження на Integration і Validation: PR уже 520 LOC, «більші PR довше чекають review», зміни в кількох модулях потребують більше integration testing.
- Немає baseline для defect rate AI-коду.

**2. Окрема оцінка для кожного stage:** таблиця в 3.7.

**3. Які stages AI реально прискорює:**
- *сильно:* coding частина Implementation (scaffolding, tests, refactoring), чернетки документації;
- *помірно:* Analysis (research, prototype), Validation (генерація test cases, але виконання та environment не прискорюються);
- *майже ні:* очікування review, security та finance review, черга на test environment, release window, рішення stakeholders.

**4. Remaining bottlenecks:**
1. **Review capacity:** 2 senior engineers. Bottleneck **переміщується** з coding на review, бо PR стає більше і вони більші.
2. **Integration queue:** одне test environment, черга 3–5 днів, зростає з throughput.
3. **Validation:** 2 QA на зрослий обсяг змін.
4. **Release window** 2 рази на тиждень і спільний scope.
5. **Human review** security та finance changes.
6. **Доступність stakeholders** в Analysis.

**5. Architecture constraints vs process constraints:**

| Architecture constraints | Process constraints (генерація коду не вирішує) |
| --- | --- |
| Спільний deployment artifact і release train | Review зосереджений на 2 senior engineers |
| Orders ↔ Payments coupling (48% PR) дає великі changesets | Ручні approval кроки в deployment |
| Sync Notifications у checkout: регресія checkout для template | Release window 2 рази на тиждень |
| Reporting читає чужі schemas | Одне test environment |
| Немає explicit contracts: integration tests замість contract tests | Обов'язковий human review security та finance |
| Pricing без власника: Scenario F зачіпає 5–6 modules | Немає baseline якості AI-коду; 2 QA; доступність stakeholders |

**6. Чи реалістичний 1 місяць?** **Ні**, за наявних умов:
- AI-only дає ≈ 106 днів;
- навіть найкращі значення з таблиці improvements одночасно (15 + 10 + 15 + 15 + 4) дають **59 днів**, а частина improvements overlap.

**7. Інший target:** **75–90 днів (2,5–3 місяці)** через 6–9 місяців впровадження. Stretch target на 12 місяців ≈ 60–65 днів.

**8. Prerequisites, investments, risks для target:**

| Prerequisite / Investment | Оцінка | Risk |
| --- | --- | --- |
| Explicit contracts + contract tests | 60–80 год | Contracts застарівають без підтримки |
| Outbox + templates-as-config | 100–120 год | R3 |
| Payment port + timeout + `PENDING` + reconciliation | 40–60 год | R4 |
| Друге test environment | Щомісячна infra cost | Drift між environments |
| CODEOWNERS, ADR, навчання reviewers | ≈ 10% часу seniors | Тимчасове сповільнення seniors |
| Fitness functions у CI | ≈ 8 год (частково ✅) | False positives |
| **Разом одноразово** | ≈ 250 год ≈ **$12 500** | R5 |

**Коли benefit стане доступним (migration cost):** перший major feature під час Phase 1–2 буде **повільнішим**, ≈ 110–125 днів, бо 15–20% capacity іде на investments. Це J-curve: виграш з'являється з 2-го–3-го feature.

**9. Нові risks від більшого implementation throughput:**
- **review fatigue і rubber-stamping** великих AI-PR;
- **ріст Change Failure Rate і Rollback** без baseline якості;
- **architecture erosion:** AI копіює існуючі патерни, зокрема leaks; mitigation через FF у CI;
- **security та finance помилки** в Payments і Pricing;
- **ріст WIP:** черги в Integration і Validation, через що Lead Time може **зрости**;
- **ріст test suite** збільшує Deployment Duration;
- **knowledge dilution:** код пишеться швидше, ніж команда його розуміє, тож MTTR росте.

### 3.6 Розрізнено implementation speed та end-to-end delivery speed

- **Implementation speed** (швидкість написання коду) з AI може зрости ≈ 4× лише для coding-частини: 18 → 5 днів.
- **End-to-end delivery speed** (TTM) визначається найповільнішими етапами й чергами: review, integration queue, validation, release window.
- Тому 4× implementation дає лише **120 → 106 днів (−12%)**, якщо нічого іншого не змінювати. Local optimization одного stage не збільшує end-to-end throughput, бо bottleneck просто переміщується.

### 3.7 Запропонований TTM target захищений через stage estimates та evidence

Модель stage Implementation (40 днів) = coding ≈ 18 + review wait і rework ≈ 12 + design/clarification ≈ 10.

| Stage | Зараз | AI-only | **Target** | Range | Assumptions |
| --- | ---: | ---: | ---: | ---: | --- |
| Analysis | 20 | 18 | **17** | 15–18 | AI прискорює research і prototype (−2…−3); bottleneck у доступності stakeholders |
| Implementation | 40 | 25 | **20** | 18–28 | AI-only: coding 18 → 5, design 10 → 8, review 12 → 12. Target: design 7, review 8 (CODEOWNERS, PR ≤ 200 LOC, FF замість ручного architecture review) |
| Integration | 25 | 27 | **18** | 15–22 | AI-only: більше паралельних змін (+2). Target: contracts, contract tests, ≤ 2,5 modules, друге env прибирає чергу 3–5 днів (−7) |
| Validation | 25 | 26 | **18** | 15–20 | AI-only: більше коду, немає baseline (+1). Target: automation + parallel testing (−7). Ефект env уже враховано в Integration (overlap не рахуємо двічі) |
| Release | 10 | 10 | **6** | 4–7 | Щоденний release, менший scope, Notifications окремо (−4) |
| **Total** | **120** | **106 (≈ 3,5 міс)** | **79 (≈ 2,6 міс)** | **67–95** | |

**Відповіді на 11 питань з `docs/ai-time-to-market.md`:**

1. **Прогноз TTM:** 75–90 днів, target 79. Перший feature під час міграції займе ≈ 110–125 днів.
2. **Assumptions кожного stage:** колонка «Assumptions» у таблиці вище.
3. **Що AI реально прискорює:** coding, тести, документацію; частково research і test cases (3.5, п. 3).
4. **Які bottlenecks залишаться або перемістяться:** з coding на review, integration queue, QA і release (3.5, п. 4).
5. **Architecture constraints:** спільний artifact і release train, Orders ↔ Payments coupling, sync Notifications, Reporting на чужих schemas, немає contracts, pricing без власника.
6. **Process constraints:** 2 senior reviewers, ручні approvals, release 2 рази на тиждень, одне test environment, обов'язковий human review, 2 QA, доступність stakeholders.
7. **1 місяць реалістичний?** Ні: навіть найкращі значення дають 59 днів.
8. **Що має змінитися:** розділ 4.7.
9. **Нові risks:** 3.5, п. 9.
10. **Як виміряти вплив AI без LOC і кількості PR:**
   - end-to-end TTM і **час у кожному stage** (flow time, waiting vs working, flow efficiency);
   - Change Lead Time і review wait time;
   - Change Failure Rate, Rollback, escaped defects для PR з AI-assisted label порівняно з іншими;
   - rework rate: частка коду, переписаного протягом 3 тижнів;
   - WIP і час очікування в integration queue;
   - Modules Changed per Feature, PR size.
11. **Evidence для перегляду прогнозу після першого major feature:**

| Спостереження | Перегляд |
| --- | --- |
| Implementation ≤ 12 днів **і** review wait < 2 днів | Знизити target до ≈ 65–70 днів |
| Integration queue > 5 днів | Implementation gain «з'їдено»; спочатку env, target ≈ 90–100 днів |
| Defect rate AI-PR > non-AI на ≥ 30% | Знизити очікуваний gain implementation (40 → 28), посилити review |
| Validation не скоротилась, хоча automation є | Bottleneck у QA capacity, а не в інструментах |
| Modules Changed per Feature не < 3 | Boundaries не працюють; Integration estimate переглянути вгору |

---

## 4. Рівень 100 балів

### 4.1 Хоча б один правдоподібний proposal явно відхилено або змінено

Proposal з `docs/architecture-proposal.md`: «Orders, Payments, Inventory, Notifications, Reporting → independently deployable services».

| Крок proposal | Рішення | Обґрунтування |
| --- | --- | --- |
| 1. Зафіксувати contracts | ✅ **Прийнято** | Почато: Payments contract + fitness tests |
| 2. Data ownership, прибрати доступ до чужих repositories | ✅ **Прийнято** | Payments ↔ Orders виконано; далі Orders ↔ products і Reporting |
| 3. Async messaging | 🔶 **Змінено** | Лише для Notifications і Reporting projection. **Не** для Orders, Inventory, Payments (Scenario D; Scenario F вимагає sync) |
| 4. Виділення services (усі 5) | ❌ **Відхилено** для Orders, Inventory, Payments, Reporting; **змінено** для Notifications (gated) | Див. 4.3 |

**Відповіді на open questions proposal:**

| Питання | Відповідь |
| --- | --- |
| Які modules справді потребують independent deployment зараз? | Лише Notifications, і то після templates-as-config та за тригером |
| Чи виправдовує Reporting traffic окреме data store? | Поки ні. Спершу read model, окреме сховище за тригером (4.6) |
| Хто відповідає за end-to-end checkout reliability? | Власник Checkout (Orders stream) з SLO на p99 і success rate |
| Які consistency guarantees потрібні? | Orders, Inventory, Payments: strong, in-process. Notifications і Reporting: eventual ≤ 5 хв |
| Чи достатньо спершу покращити boundaries всередині monolith? | Так. Metrics з 4.5 це перевірять і можуть спростувати |

### 4.2 Пояснено, що свідомо не змінюється (Питання 4)

- **Inventory boundary** і синхронний reserve/release з persisted idempotency key. Scenario D вимагає strong consistency, а async або окремий service створив би саме ті duplicate operations, яких бізнес боїться.
- **Checkout як orchestrator** (без choreography через events). Компенсація в одному місці, легко тестувати й міркувати локально.
- **Orders, Inventory та Payments в одному process і одній БД.** Reservation до charge і release при помилці працюють без saga.
- **Modular monolith як основний deploy unit** і один repository.
- **Одна БД-технологія:** logical schemas, а не окремі DB servers.
- **Без message broker** на кшталт Kafka чи RabbitMQ: outbox table + dispatcher достатньо; broker додасть ще один компонент для команди без platform team.
- **Без Kubernetes і service mesh.**
- **`shared/errors.js`** як маленький shared kernel.

### 4.3 Пояснено, чому складніша architecture може бути ще не виправдана

- **Availability погіршиться, а це characteristic №1.** Зараз checkout має 2 зовнішні network-виклики. З 5 services додаються ще ≈ 4 internal hops. Якщо кожен має 99,9%, ланцюжок дає 0,999⁴ ≈ **99,6%** до врахування providers.
- **Не вистачає людей.** 8 engineers на 5 services означає ≈ 1,6 людини на service з on-call, pipeline та observability, а **platform team немає**.
- **Consistency стане дорожчою.** Reservation перед charge між services вимагає saga + idempotency + reconciliation, тобто нових класів інцидентів, включно з overselling.
- **Scaling не потрібен.** Навантаження обслуговує 1 instance; Reporting масштабується як дані (read model).
- **Частина деградації metrics має process-причини:** ручні approvals, розширений test suite, 2 senior reviewers. Services їх не вирішують.

### 4.4 Визначено risk, який створює власне рішення (Питання 9)

**R3. Outbox або Notifications worker зупиняється, листи губляться, затримуються або дублюються.**
- *ERC:* ≈ $210/міс.
- *Mitigation:*
   - outbox у тій самій транзакції, що й зміна order;
   - dedupe key `orderId + template`;
   - alert, якщо backlog age > 5 хв;
   - replay tool і dead-letter.

**R4. Timeout на payment дає невизначений стан платежу** (provider списав, checkout не дочекався) і подвійне списання при retry.
- *ERC:* ≈ $720/міс.
- *Mitigation:*
   - idempotency key = `orderId`;
   - `PENDING` утримує reservation;
   - reconciliation кожні 5 хв і webhook;
   - alert, якщо `PENDING` > 15 хв.

**Додатково:** **R5**, migration сповільнює roadmap (≈ $4 800 одноразово). Окремий deploy Notifications також додає on-call burden для малої команди.

### 4.5 Metrics або Fitness Functions можуть спростувати assumptions

| Metric | Target | Що **спростує** assumption |
| --- | --- | --- |
| Modules Changed per Feature | 4,3 → < 2,5 | Якщо після Phase 1–2 значення > 3,5 протягом 2 місяців, coupling **не є** головною причиною; переглядаємо process (PR size, планування) |
| Change Lead Time | 6 → ≤ 3 дні | Якщо не падає, а Modules per Feature падає, bottleneck у review або release (process), а не в architecture |
| Rollback Rate | 9% → < 4% | Якщо не падає, причина в якості змін |
| Template changes з checkout regression | 37% → 0% | > 0% означає, що boundary Checkout ↔ Notifications ще протікає |
| Notification delivery lag p95 | ≤ 5 хв | Ріст означає, що async створює нові проблеми (R3) |
| Кількість `PENDING` > 15 хв | 0 | Стабільно > 0 означає, що timeout 3 s надто агресивний (R4) |
| Notification **code** deploys на тиждень | вимірюємо | < 1 на тиждень після templates-as-config означає, що **виділення worker не потрібне** (спростовує Phase 3) |

**Fitness Functions:**
- **FF1–FF4 реалізовані** (розділ 5). FF1 і FF4 падають на оригінальному коді, тобто справді фіксують порушення.
- **Заплановано:**
   - **FF5:** checkout з notification provider, що відповідає 5 s або падає, завершується успішно з p95 < 1 s. Сьогодні **падає** і доводить temporal coupling.
   - **FF6:** Reporting не читає колекції orders, payments, notifications напряму (після read model).
   - **FF7:** CI threshold checkout p99 ≤ 3,5 s у load test з `PAYMENT_SLOW_RATE=0.3`.
   - **FF8:** review rule: новий cross-module import потребує ADR.

### 4.6 Названо умови майбутньої architecture evolution

| Крок | Тригер (будь-який) |
| --- | --- |
| Notifications worker → окремий deploy | Notification code deploys ≥ 1 на тиждень блокуються release train; templates-as-config покривають < 70% експериментів; email-навантаження впливає на ресурси Core |
| Reporting → окремий data store/service | Reporting traffic > 5× поточного; report queries > 20% CPU Core; checkout p95 росте > 10% під час report peaks; finance потребує > 12 міс історії |
| Payments → independently deployable | Другий provider з async confirmations у prod; payment changes ≥ 2 на тиждень блокуються release; окрема payments team; вимога ізоляції PCI scope |
| Ширший перехід до services | Команда > 15 engineers або ≥ 3 stream-aligned teams **і** є platform capability (CI/CD, observability, on-call) |
| Inventory | Не виділяється, доки немає multi-warehouse або окремого власника |

### 4.7 Пояснено, що має змінитися для реального місячного delivery cycle

1. **Змінити одиницю доставки.** Major feature нарізається на інкременти, що релізяться незалежно за feature flags. Stages виконуються **паралельно** для різних інкрементів, а не послідовною сумою.
2. **Dual-track discovery.** Analysis наступного інкременту йде паралельно з implementation поточного; SLA на доступність stakeholders.
3. **Trunk-based development, PR ≤ 200 LOC**, review SLA ≤ 1 день, ≥ 4–5 reviewers з architecture knowledge (CODEOWNERS, ADR, pairing).
4. **Modules Changed per Feature ≤ 2** завдяки boundaries і contract tests замість повного integration testing.
5. **Ephemeral або друге test environment**, автоматизований regression ≤ 1 день.
6. **Continuous delivery:** release on demand щодня, без ручних approvals для low-risk змін; Notifications і config окремо.
7. **Security та finance review з першого дня** (checklists, ранній review design).
8. **Виміряний baseline якості AI-коду.**

Навіть тоді 1 місяць реалістичний лише для feature, що зачіпає ≤ 2 modules і не потребує нового зовнішнього provider.

---

## 5. ОКРЕМИЙ ПУНКТ: що зроблено в коді (Optional implementation)

### 5.1 Яке покращення і чому саме воно

**Прибрано прямий доступ Payments до `OrderRepository` модуля Orders.** Payments тепер отримує дані платежу через **explicit contract**.

Чому обрано саме це покращення:
- це варіант з README («видалення прямого доступу до чужого repository»);
- це cost-of-change driver №2 і стосується 48% PR (Orders + Payments одночасно);
- це prerequisite для Scenario B (другий provider) і Scenario F (Payments має списувати суму, яку порахував Pricing, а не перечитувати Order);
- зміна мала й безпечна: поведінка checkout не змінилась, усі старі тести проходять.

### 5.2 Змінені файли

| Файл | Було | Стало |
| --- | --- | --- |
| `src/payments/PaymentService.js` | `constructor(database, orderRepository, provider)`; `chargeOrder(orderId, paymentToken)` сам читав order через `this.orderRepository.findById(orderId)` (коментар «Deliberate boundary leak») | `constructor(database, provider)`; `chargeOrder({ orderId, amountCents, currency }, paymentToken)`. Contract валідується: при некоректних даних кидається `DomainError` з кодом `INVALID_PAYMENT_REQUEST`. Payments більше не знає про Orders |
| `src/checkout/CheckoutService.js` | `chargeOrder(order.id, command.paymentToken)` | `chargeOrder({ orderId: order.id, amountCents: order.totalCents, currency: order.currency }, command.paymentToken)`. Checkout як orchestrator передає дані через contract |
| `src/app.js` | `new PaymentService(database, orderRepository, paymentProvider)` | `new PaymentService(database, paymentProvider)` |
| `tests/architecture.test.js` | (не існував) | **Новий файл**: 4 fitness functions |

Логіка idempotency платежу (повторний виклик для вже `CAPTURED` order повертає існуючий платіж), запис статусів `PROCESSING`, `CAPTURED`, `FAILED` і обробка помилок provider **не змінювались**.

### 5.3 Fitness functions (`tests/architecture.test.js`)

| Тест | Що перевіряє | На оригінальному коді | Після зміни |
| --- | --- | --- | --- |
| FF1 «Payments does not depend on Orders internals» | Файли `src/payments/` не імпортують `orders/` і не згадують `OrderRepository` | ❌ fail | ✅ pass |
| FF2 «payment provider implementation is used only through the Payments boundary» | `FakePaymentProvider` імпортується лише в `payments/` і composition root `app.js` | ✅ pass | ✅ pass |
| FF3 «notification template changes do not require Orders, Payments or Inventory» | `src/notifications/` не імпортує `orders/`, `payments/`, `inventory/`, `checkout/` | ✅ pass | ✅ pass |
| FF4 «Payments charges through its contract without Orders data» | Contract test: `PaymentService` виконує charge, коли в БД **немає жодного order** | ❌ fail | ✅ pass |

FF2 і FF3 проходять уже зараз. Вони **охороняють** boundaries, які зараз правильні, від майбутньої ерозії (зокрема від AI-generated змін).

Тести написані на вбудованих `node:test`, `node:fs`, `node:path`, без нових dependencies. Імпорти визначаються простим regex по `from "..."`, що достатньо для цього проєкту (усі модулі ESM).

### 5.4 Результат перевірки

```text
npm test
ok 1 - Payments does not depend on Orders internals
ok 2 - payment provider implementation is used only through the Payments boundary
ok 3 - notification template changes do not require Orders, Payments or Inventory
ok 4 - Payments charges through its contract without Orders data
ok 5 - checkout reserves stock, captures payment and sends confirmation
ok 6 - payment failure marks order failed and releases stock
ok 7 - duplicate inventory reservation does not reduce stock twice
ok 8 - reporting combines operational order and payment data
ok 9 - catalog and order lists return detached records
# pass 9
# fail 0
```

`npm run demo` повертає `COMPLETED` order з `CAPTURED` payment, як і раніше.

### 5.5 Що свідомо НЕ змінювалось у коді

- **Баг «email падає після оплати → order FAILED, payment CAPTURED».** Він знайдений і описаний (1.3, P2; ризик R2), але виправлення вимагає outbox і async-доставки (Phase 2). Це більша зміна, ніж «одне невелике покращення», тому вона залишена в evolution plan.
- Timeout, `PENDING` і circuit breaker для Payments, read model для Reporting, Pricing policy описані як наступні кроки, але не реалізовані.
- Жодних нових бібліотек, frameworks або змін у `package.json`.

---

## 6. Як перевірити роботу

```bash
npm test        # 9 тестів, включно з 4 fitness functions
npm run demo    # демонстрація checkout
npm start       # API на http://localhost:3000
```

Діаграми в `FinalReport.md` написані на Mermaid. Їх рендерить GitHub, а в WebStorm вони відображаються в Markdown preview (за потреби увімкніть Mermaid у Settings → Languages & Frameworks → Markdown).