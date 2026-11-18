# סריקת תצוגה באייפון

סריקה של כל מסכי המוצר (`screen:` ב-`qa/manifest.json`) ב-WebKit, בכל תפקידי הדמו ובארבעה מכשירים: iPhone SE (320), iPhone SE דור 3 (375), iPhone 15 (393) ו-iPhone 15 Pro Max (430), בשפה he-IL. נבנתה ב-17.11.2026, ותיקוני הממצאים שלה הם #555, #557 ו-#559.

## מה נבדק בכל מסך

- גלילה אופקית של העמוד (`scrollWidth > innerWidth`).
- רכיבים שיוצאים מהמסך או נחתכים.
- מטרות מגע קטנות מ-44x44, כולל אזור מגע של `::before` (הכלי `.tap-area`).
- שדות בגופן קטן מ-16px (ספארי מגדיל את העמוד בנגיעה).
- רכיבים קבועים בקצה המסך בלי `env(safe-area-inset-*)`.
- כיוון ויישור בעברית.
- חלונות גבוהים מהמסך, והאם הם נגללים.

בכל מסך הסקריפט פותח גם את חלונית "עוד" ועד ארבעה כפתורים שפותחים חלון, לא כפתורי שמירה, מחיקה או שליחה.

## הרצה

רק מול מסד מקומי זמני: אם אין תהליך בזריעה, הסקריפט יוצר תהליך דמו אחד.

```bash
npm run db:dev
npx prisma migrate deploy && npm run db:seed
npx next build && npx next start -p 3100
node qa/iphone/https-proxy.mjs
node qa/iphone/audit.mjs
node qa/iphone/report.mjs
```

השרת צריך לרוץ בלי `AUTH_URL` ובלי `NEXTAUTH_URL`, כדי ש-Auth.js ילך לפי הכתובת שמעביר השרת המאובטח.

WebKit צריך ספריות מערכת: `npx playwright install webkit` ו-`npx playwright install-deps webkit`.

הפלט נכתב ל-`qa/reports/iphone/` (מחוץ לגיט): `results.json`, `findings.json`, `report.md` וצילומי מסך.

אפשרויות של `audit.mjs`: `--roles admin,employee1`, `--devices "iPhone SE"`, `--only /app/tasks`, `--concurrency 4`, `--no-probe` (בלי פתיחת חלונות), `--append` (מוסיף לתוצאות קיימות).

## למה שרת מאובטח מקומי

מדיניות האבטחה של האתר כוללת `upgrade-insecure-requests`. בפרודקשן זה נכון. Chromium פוטר ממנה כתובת מקומית, אבל WebKit לא, ולכן ב-`http://127.0.0.1` אף סקריפט לא נטען. `https-proxy.mjs` מגיש את אותה בנייה בחיבור מאובטח עם תעודה עצמית, בלי לשנות אף תגובה.
