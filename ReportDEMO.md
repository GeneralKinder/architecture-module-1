# ReportDEMO: опис виконаної роботи та відповіді на всі питання

Цей файл супроводжує [`FinalReport.md`](FinalReport.md). У `FinalReport.md` лежить сам звіт (deliverables). Тут описано, **що саме і як було зроблено**, і зібрано **відповіді на всі питання завдання за кожним рівнем оцінювання** (60 / 75 / 90 / 100) з посиланнями на розділи звіту.

---

## 1. Що було зроблено: покроково

1. **Прочитано всі матеріали завдання:** `README.md` і всі файли в `docs/` (system overview, business context, engineering metrics, change scenarios, analysis tools, architecture proposal, AI time to market).
2. **Проаналізовано код кожного модуля** (`src/`) і знайдено конкретні місця, що підтверджують або спростовують проблеми:
   - `PaymentService` читав `OrderRepository` іншого модуля (boundary leak);
   - `CheckoutService.js:26` синхронно чекає email у критичному шляху;
   - `ReportingService.js:7-30` сканує колекції всіх модулів, `find` усередині `map` (квадратична складність);
   - `ReportingService.js:48` рахує revenue за **поточною** ціною товару, а не ціною на момент замовлення;
   - `OrderService.js:16` бере ціни з таблиці products (Inventory) через `shared/money.js`;
   - `InventoryService.js:9-11` має коректну idempotency, тож це сильний boundary, який треба **залишити**.
3. **Перевірено гіпотезу експериментом:** якщо email-провайдер падає вже після оплати, отримуємо `order = FAILED`, `payment = CAPTURED`, stock повернуто. Тобто клієнт заплатив, замовлення не створено, товар знову доступний (ризик overselling). Це **реальна проблема**, а не теоретична.
4. **Змодельовано latency checkout** (200 000 симуляцій за параметрами `src/config.js`):

   | | p50 | p95 | p99 |
   | --- | ---: | ---: | ---: |
   | З email у критичному шляху | ≈ 0,5 s | ≈ 2,5 s | ≈ 3,1 s |
   | Без email | ≈ 0,2 s | ≈ 2,25 s | ≈ 2,85 s |

   Успіх checkout зараз = 0,95 × 0,98 ≈ **93,1%**. Ці числа використано в характеристиках, ризиках і metrics.
5. **Прийнято архітектурне рішення:** зберегти modular monolith і зміцнити boundaries; Notifications стає першим (і поки єдиним) кандидатом на independently deployable worker, але лише за тригерами; proposal «5 services» прийнято частково.
6. **Зроблено розрахунки** за формулами з `docs/analysis-tools.md`: Expected Risk Cost (6 ризиків), Change Cost і Architecture Tax (2 сценарії), Time to Market по stages (3 варіанти).
7. **Намальовано 2 діаграми** (Mermaid): current і proposed. Обидві перевірені рендером через mermaid-cli.
8. **Реалізовано одне невелике boundary-покращення + fitness functions** (див. §6 цього файлу).
9. **Перевірено:** `npm test` дає 9/9 pass, `npm run demo` працює. Нові fitness tests **падають на оригінальному коді**, тобто справді ловлять порушення.

---

## 2. Відповідність критеріям оцінювання

### Рівень 60 балів

| Критерій | Де у FinalReport | Коротка відповідь |
| --- | --- | --- |
| Зрозуміла current architecture | §1 | Modular monolith: 1 process, 1 artifact, спільна in-memory DB. Checkout оркеструє Orders → Inventory → Payments → Notifications синхронно. Reporting сканує всі колекції |
| Читабельні current і proposed diagrams | §1, §5 | Mermaid flowcharts. Leaks позначені пунктиром, sync і async розрізнені, видно deployment boundaries і external providers |
| Визначені базові проблеми | §2 | P1–P6: Payments → OrderRepository, email у checkout, немає timeout, Reporting читає чужі дані, pricing без власника, спільний release train |
| Coherent architecture change | §5, §7 | Modular monolith з explicit contracts + outbox для Notifications і Reporting + Payment port з timeout + gated виділення Notifications worker |

### Рівень 75 балів

| Критерій | Де у FinalReport | Коротка відповідь |
| --- | --- | --- |
| Responsibilities та dependencies пояснені | §1 (таблиця), §4 | Для кожного модуля описано відповідальність, залежності та проблему |
| Architectural characteristics мають пріоритет | §3 | 1) Availability/Resilience checkout → 2) Data integrity → 3) Modifiability → 4) Deployability → 5) Reporting scalability. Явно названо, чим жертвуємо |
| Principles застосовані до конкретних місць | §8 | 5 принципів, кожен прив'язаний до файлу або рядка коду |
| Зміни пов'язані з requirements і scenarios | §6 (таблиця A–F) | Для кожного scenario: stimulus, response, components, response measure, рішення |

### Рівень 90 балів

| Критерій | Де у FinalReport | Коротка відповідь |
| --- | --- | --- |
| Cost-of-change drivers | §4 | Ранжований список із 5 dependencies з прив'язкою до scenarios |
| Risk analysis | §9 | 6 ризиків з Probability, Impact, Expected Risk Cost, Mitigation |
| Metrics або cost formulas | §9, §10, §11 | Expected Risk Cost, Change Cost, Architecture Tax ($52 000/рік для Scenario A), 9 metrics |
| Хоча б один non-obvious trade-off | §7 | Timeout на payment перетворює latency-проблему на consistency-проблему; async email змінює контракт відповіді та дає дублікати; discount **не можна** робити async |
| AI Time to Market | §13 | Повний аналіз, 11 питань |
| Implementation speed vs end-to-end speed | §13.1, §13.2 | Implementation займає 33% TTM; навіть нескінченне прискорення коду дає 80 днів |
| TTM target захищений stage estimates | §13.2 | Таблиця по stages: AI-only = 106 днів, target = 79 днів, range 67–95 |

### Рівень 100 балів

| Критерій | Де у FinalReport | Коротка відповідь |
| --- | --- | --- |
| Правдоподібний proposal явно відхилено або змінено | §12 | Proposal «5 services»: кроки 1–2 прийнято, крок 3 змінено (async лише для Notifications і Reporting), крок 4 відхилено для Orders, Inventory, Payments, Reporting і змінено (gated) для Notifications |
| Пояснено, що свідомо не змінюється | §6 Q4, §12 | Inventory boundary, Checkout orchestrator, Orders/Inventory/Payments в одному process, одна БД, без broker і Kubernetes |
| Чому складніша architecture ще не виправдана | §12 | Availability ланцюжка 0,999⁴ ≈ 99,6%; 1,6 engineer на service без platform team; saga замість простої consistency; навантаження вміщується в 1 instance; частина проблем має process-природу |
| Risk, який створює власне рішення | §9 R3, R4 | R3: outbox/worker губить або дублює листи. R4: timeout створює невизначений стан платежу |
| Metrics або FF можуть спростувати assumptions | §11 | Колонка «Що спростує assumption». Наприклад, якщо Modules per Feature > 3,5 після Phase 1–2, coupling не є головною причиною |
| Умови майбутньої evolution | §11 (тригери) | Конкретні пороги для Notifications, Reporting, Payments, переходу до services, Inventory |
| Що має змінитися для місячного циклу | §13.7 | 8 конкретних змін: slicing + feature flags, dual-track, trunk-based, ≤ 2 modules, ephemeral env, CD, ранній security review, baseline якості AI |

---

## 3. Відповіді на 10 питань «Architecture decision task»

**1. Які проблеми справді видно в поточній architecture?**
- Payments читав Orders repository напряму. Підтверджено: 48% PR торкаються обох модулів.
- Email у критичному шляху checkout. Експеримент показав «charged but FAILED» замовлення, а 37% змін templates потребують regression checkout.
- Payment provider без timeout. 2 останні інциденти почалися з latency spikes.
- Reporting сканує дані всіх модулів у тому самому process: traffic ×3, буде ×8–10, і звіт рахує неправильну ціну.
- Pricing не має власника (Scenario F).
- Спільний release train: releases 5 → 2 на тиждень, rollback 9%.

Окремо зазначено, що **не** є проблемою (sync-оркестрація Inventory і Payments, idempotency Inventory) і що Deployment Duration частково зріс через process (approvals, test suite).

**2. Які architectural characteristics мають найвищий пріоритет?**
Availability і resilience checkout (це revenue), далі data integrity (overselling, «гроші без замовлення»), modifiability, deployability, і лише потім scalability Reporting. Жертвуємо негайністю email, свіжістю reports (≤ 5 хв) і незалежним deployment для більшості модулів.

**3. Які dependencies найбільше збільшують cost of change?**
1) Checkout → Notifications (sync + template у коді); 2) Payments → Orders repository; 3) Reporting → таблиці всіх модулів; 4) Orders → products для pricing; 5) спільний release train.

**4. Які boundaries варто залишити без змін?**
Inventory (sync, idempotent, strong consistency), Checkout як orchestrator, Orders/Inventory/Payments в одному process і одній БД, `shared/errors.js`.

**5. Які boundaries варто змінити?**
Payments ↔ Orders (explicit contract, **виконано**), Checkout ↔ Notifications (outbox + templates як config), Reporting ↔ operational data (read model), Pricing (policy в Orders, ціни через query API Inventory), Payments ↔ provider (port, adapters, timeout, `PENDING`).

**6. Чи залишається modular monolith доречним?**
Так. Команда 8 + 2 без platform team, навантаження на 1 instance, потрібна strong consistency між Orders, Inventory і Payments. Головні проблеми лежать у внутрішніх boundaries і в process.

**7. Чи має якийсь module стати independently deployable?**
Так, лише Notifications, у Phase 3 і лише за тригерами (≥ 1 code deploy на тиждень блокується release train, templates-as-config покривають < 70% експериментів тощо).

**8. Який module виділити першим?**
Notifications як async worker. Не Payments (потрібна sync-відповідь, consistency, finance/security review), не Reporting (спочатку масштабуємо дані через read model), не Inventory (Scenario D).

**9. Які trade-offs і нові failure modes створює рішення?**
- Eventual email і reports (≤ 5 хв).
- At-least-once delivery дає можливі дублікати листів.
- Новий стан `PENDING` і reconciliation.
- Outbox і worker треба моніторити.
- Payments не отримує independent deployment.
- Ризики R3 і R4 у §9: ERC ≈ $930/міс проти поточних R1 + R2 ≈ $6 400/міс.

**10. Які evidence підтримують рішення?**
- Code: конкретні рядки в §2.
- Експеримент із падінням email.
- Моделювання latency.
- Metrics з `engineering-metrics.md`.
- Розрахунки Change Cost і Architecture Tax.
- Fitness tests, які падають на оригінальному коді і проходять після покращення.

---

## 4. Відповіді на розділи README

### Architectural principles (3–5)
Обрано 5: **Information Hiding, Explicit Contracts, Low Coupling (temporal), Design for Change, Fitness Functions**. Для кожного показано, де він порушений зараз і що змінює proposal (FinalReport §8). Додатково зазначено, де принципи вже дотримані: High Cohesion в Inventory, Local Reasoning у Checkout.

### Risk analysis (≥ 3)
6 ризиків (FinalReport §9), формула `Probability × Business Impact`, assumptions A1–A3 явні:

| Risk | ERC |
| --- | --- |
| R1 payment latency spike | ≈ $2 400/міс (після mitigation ≈ $650) |
| R2 email після оплати, «charged but FAILED» | ≈ $4 000/міс |
| R3 outbox/worker (створює рішення) | ≈ $210/міс |
| R4 невизначений стан платежу через timeout (створює рішення) | ≈ $720/міс |
| R5 migration сповільнює roadmap | ≈ $4 800 одноразово |
| R6 Reporting деградує checkout | ≈ $3 600/рік |

### Change cost analysis
FinalReport §10, два сценарії з усіма 5 вимірами (modules touched, engineering hours, coordination, testing scope, deployment scope):

| Scenario | Поточна | Запропонована | Architecture Tax |
| --- | --- | --- | --- |
| A: notification experiment | 11,4 год / $570 | 3 год / $150 | ≈ $52 000/рік |
| F: discount rule | 52 год / $2 600 (5–6 modules) | 29 год / $1 450 (2 modules) | ≈ $13 800/рік |

### Metrics та Fitness Functions
FinalReport §11: 9 metrics із поточним значенням, target і умовою спростування. Fitness functions FF1–FF4 **реалізовані як автоматичні тести**, FF5–FF8 заплановані (latency test, dependency rule для Reporting, CI threshold, review rule).

### AI та Time to Market: 9 пунктів README

| Пункт README | Відповідь (FinalReport §13) |
| --- | --- |
| 1. Перевірте assumptions | §13.1: «4× швидше» стосується лише coding-частини Implementation (33% TTM). Review, security та finance review і черги не прискорюються. Немає baseline якості AI-коду |
| 2. Окрема оцінка для кожного stage | §13.2: Analysis 20 → 17, Implementation 40 → 20, Integration 25 → 18, Validation 25 → 18, Release 10 → 6 |
| 3. Stages, які AI реально прискорює | §13.3: сильно coding; помірно Analysis і Validation; майже ні: review, черги, release |
| 4. Remaining bottlenecks | §13.4: review (2 seniors), integration queue, QA capacity, release window, human review, stakeholders |
| 5. Architecture vs process constraints | §13.5: таблиця з двох колонок |
| 6. Чи реалістичний 1 місяць | §13.6: ні. Навіть найкращі значення таблиці improvements дають 59 днів |
| 7. Інший target | **75–90 днів (2,5–3 міс)**, stretch ≈ 60–65 днів через 12 міс |
| 8. Prerequisites, investments, risks | §13.8: ≈ 250 год ≈ $12 500 одноразово + друге test environment |
| 9. Нові risks від більшого throughput | §13.9: review fatigue, ріст CFR, architecture erosion, security-помилки, ріст WIP, knowledge dilution |

### AI та Time to Market: 11 питань з `docs/ai-time-to-market.md`

1. **Прогноз TTM:** 75–90 днів (target 79). AI-only без інших змін дає ≈ 106 днів. Перший feature під час міграції займе ≈ 110–125 днів (J-curve).
2. **Assumptions кожного stage:** у колонці «Assumptions» таблиці §13.2. Implementation розкладено на coding 18, review і rework 12, design 10.
3. **Що AI реально прискорює:** coding, тести, документацію; частково research і test cases.
4. **Bottlenecks залишаться або перемістяться:** з coding на review та integration і validation queue.
5. **Architecture constraints:** спільний artifact і release train, Orders ↔ Payments coupling, sync Notifications, Reporting на чужих schemas, немає contracts, pricing без власника.
6. **Process constraints:** 2 senior reviewers, ручні approvals, release 2 рази на тиждень, одне test environment, обов'язковий human review, 2 QA, доступність stakeholders.
7. **1 місяць реалістичний?** Ні, за наявних умов.
8. **Що має змінитися:** 8 змін у §13.7. Головне змінити одиницю доставки (slicing + feature flags) і перейти від послідовних stages до паралельних.
9. **Нові risks:** §13.9.
10. **Як виміряти вплив AI без LOC і кількості PR:** end-to-end TTM, час у кожному stage, flow efficiency, review wait time, CFR і rollback для AI-PR порівняно з non-AI, rework rate (churn за 3 тижні), WIP, Modules per Feature.
11. **Evidence для перегляду прогнозу:** таблиця §13.11. Наприклад, integration queue > 5 днів означає target ≈ 90–100 днів, а defect rate AI-PR > +30% означає знизити очікуваний gain implementation.

---

## 5. Відповіді на open questions з `architecture-proposal.md`

| Питання | Відповідь |
| --- | --- |
| Які modules справді потребують independent deployment зараз? | Лише Notifications, і то після templates-as-config та за тригером |
| Чи виправдовує Reporting traffic окреме data store? | Поки ні. Спершу read model (staleness ≤ 5 хв), окреме сховище після тригера (> 5× traffic, > 20% CPU, checkout p95 +10%) |
| Хто відповідає за end-to-end checkout reliability? | Власник Checkout (Orders stream) з SLO на p99 і success rate |
| Які consistency guarantees потрібні? | Orders, Inventory, Payments: strong, in-process. Notifications і Reporting: eventual ≤ 5 хв |
| Чи достатньо спершу покращити boundaries всередині monolith? | Так. Metrics з §11 перевірять це і можуть спростувати |

---

## 6. ОКРЕМИЙ ПУНКТ: що зроблено в коді (Optional implementation)

### 6.1 Яке покращення і чому саме воно

**Прибрано прямий доступ Payments до `OrderRepository` модуля Orders.** Payments тепер отримує дані платежу через **explicit contract**.

Чому обрано саме це покращення:
- це варіант з README («видалення прямого доступу до чужого repository»);
- це cost-of-change driver №2 і стосується 48% PR (Orders + Payments одночасно);
- це prerequisite для Scenario B (другий provider) і Scenario F (discount: Payments має списувати суму, яку порахував Pricing, а не перечитувати Order);
- зміна мала й безпечна: поведінка checkout не змінилась, усі старі тести проходять.

### 6.2 Змінені файли

| Файл | Було | Стало |
| --- | --- | --- |
| `src/payments/PaymentService.js` | `constructor(database, orderRepository, provider)`; `chargeOrder(orderId, paymentToken)` сам читав order через `this.orderRepository.findById(orderId)` (коментар «Deliberate boundary leak») | `constructor(database, provider)`; `chargeOrder({ orderId, amountCents, currency }, paymentToken)`. Contract валідується: при некоректних даних кидається `DomainError` з кодом `INVALID_PAYMENT_REQUEST`. Payments більше не знає про Orders |
| `src/checkout/CheckoutService.js` | `chargeOrder(order.id, command.paymentToken)` | `chargeOrder({ orderId: order.id, amountCents: order.totalCents, currency: order.currency }, command.paymentToken)`. Checkout як orchestrator передає дані через contract |
| `src/app.js` | `new PaymentService(database, orderRepository, paymentProvider)` | `new PaymentService(database, paymentProvider)` |
| `tests/architecture.test.js` | (не існував) | **Новий файл**: 4 fitness functions |

Логіка idempotency платежу (повторний виклик для вже `CAPTURED` order повертає існуючий платіж), запис статусів `PROCESSING`, `CAPTURED`, `FAILED` і обробка помилок provider **не змінювались**.

### 6.3 Fitness functions (`tests/architecture.test.js`)

| Тест | Що перевіряє | На оригінальному коді | Після зміни |
| --- | --- | --- | --- |
| FF1 «Payments does not depend on Orders internals» | Файли `src/payments/` не імпортують `orders/` і не згадують `OrderRepository` | ❌ fail | ✅ pass |
| FF2 «payment provider implementation is used only through the Payments boundary» | `FakePaymentProvider` імпортується лише в `payments/` і composition root `app.js` | ✅ pass | ✅ pass |
| FF3 «notification template changes do not require Orders, Payments or Inventory» | `src/notifications/` не імпортує `orders/`, `payments/`, `inventory/`, `checkout/` | ✅ pass | ✅ pass |
| FF4 «Payments charges through its contract without Orders data» | Contract test: `PaymentService` виконує charge, коли в БД **немає жодного order** | ❌ fail | ✅ pass |

FF2 і FF3 проходять уже зараз. Вони **охороняють** boundaries, які зараз правильні, від майбутньої ерозії (зокрема від AI-generated змін, див. FinalReport §13.9).

Тести написані на вбудованих `node:test`, `node:fs`, `node:path`, без нових dependencies. Імпорти визначаються простим regex по `from "..."`, що достатньо для цього проєкту (усі модулі ESM).

### 6.4 Результат перевірки

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

### 6.5 Що свідомо НЕ змінювалось у коді

- **Баг «email падає після оплати → order FAILED, payment CAPTURED».** Він знайдений і описаний (FinalReport §2 P2, ризик R2), але його виправлення вимагає outbox і async-доставки (Phase 2). Це більша зміна, ніж «одне невелике покращення», тому вона залишена в evolution plan.
- Timeout, `PENDING` і circuit breaker для Payments, read model для Reporting, Pricing policy описані як наступні кроки, але не реалізовані.
- Жодних нових бібліотек, frameworks або змін у `package.json`.

---

## 7. Як перевірити роботу

```bash
npm test        # 9 тестів, включно з 4 fitness functions
npm run demo    # демонстрація checkout
npm start       # API на http://localhost:3000
```

Діаграми в `FinalReport.md` написані на Mermaid. Їх рендерить GitHub, а в WebStorm вони відображаються в Markdown preview (за потреби увімкніть Mermaid у Settings → Languages & Frameworks → Markdown).
