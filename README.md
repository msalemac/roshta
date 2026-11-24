# clinic-tools

تطبيق ويب ثابت (HTML/JS). **ممنوع** وضع أي بيانات مرضى أو ملفات Excel أو أرقام سرية في هذا المستودع. كل البيانات على OneDrive.

## التشغيل
1. سجّل تطبيقًا في Microsoft Entra (Personal accounts only) بنوع **Single-page application**، وRedirect URI:
   `https://USERNAME.github.io/REPO/` (مع `/` في الآخر).
2. ضع الـClient ID في `js/config.js`.
3. فعّل GitHub Pages: Settings → Pages → Branch `main` → `/ (root)`.
4. افتح الرابط، سجّل الدخول بـOneDrive، ثم أنشئ حساب المدير، وارفع ملف القالب من لوحة المدير.

## ملاحظات
- المكتبة msal تُحمَّل من jsDelivr بنسخة مثبتة 2.38.3.
- الأرقام السرية تُخزَّن مشفّرة (PBKDF2) في `Users/users.json` على OneDrive وهي تنظيم عمل، مش حماية أمنية.
- الإصدار 0.1.0: نسخة أولى لم تُختبر بعد على OneDrive الحقيقي.
