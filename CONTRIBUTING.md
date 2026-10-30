# Участие в Spline · Contributing

[Русский](#русский) · [English](#english)

## Русский

Любой может предложить правку: сделайте форк, внесите изменения и пришлите pull request в `main`. После проверки правка попадает в `main`, а с ближайшим релизом приходит всем пользователям как обновление.

### Как прислать правку

1. Сделайте форк и ветку от свежего `main`: `git switch -c fix/kern-arrows`.
2. Одна тема на один pull request. Большую идею лучше сначала обсудить в issue.
3. Проверьте локально:

   ```bash
   gofmt -l .
   go vet ./...
   go test ./...
   go run . --dev
   ```

4. Откройте pull request в `main` и заполните шаблон. CI проверит сборку под Windows, macOS и Linux.

### Правила

- **Два языка.** Заголовок и описание коммита пишем на русском и английском: из них собирается текст релиза, который видят пользователи. Все надписи интерфейса добавляем в `web/js/i18n.js` на обоих языках.
- **Простой и расширенный режим.** Всё сложное показываем только в расширенном режиме. В простом такие пункты скрыты, а не просто неактивны.
- **Без пояснений в панелях.** Короткие понятные подписи и подсказки при наведении, подробности в руководстве (`web/js/guide.js`).
- **Тёмное рабочее пространство.** Стиль описан в `design-system/spline/MASTER.md`. Цвета берём из переменных CSS.
- **Файлы `.sp` должны открываться всегда.** Новое поле в проекте необязательно, старые файлы работают без него. Всё, что приходит из файла, проверяется в `validateProject` и `project.Validate`.
- **Тест на каждое исправление.** Если есть код на Go, тест должен падать без правки.
- **Без новых зависимостей и обращений к сети** без предварительного обсуждения в issue.
- **Только свой код и материалы со свободной лицензией.** Присылая правку, вы соглашаетесь с лицензией проекта ([MIT](LICENSE)).

### Для мейнтейнера: приём и выпуск

Принять правку:

```bash
gh pr checkout 123          # запустить и проверить руками
gh pr merge 123 --squash    # заголовок на двух языках
```

Выпустить версию:

1. Поставить тег и отправить его: `git tag v0.41.0 && git push origin v0.41.0`.
2. GitHub Actions соберёт всё и создаст **черновик** релиза. Пользователи его не видят, и программа его не предлагает.
3. Скачать сборку, проверить, поправить текст релиза.
4. Опубликовать черновик. С этого момента обновление приходит всем.
5. Обновить сайт (см. `deploy/`).

---

## English

Anyone can propose a change: fork the repository, make your changes and open a pull request into `main`. Once reviewed, it lands in `main`, and with the next release it reaches every user as an update.

### Sending a change

1. Fork and branch from a fresh `main`: `git switch -c fix/kern-arrows`.
2. One topic per pull request. For a big idea, open an issue first.
3. Check it locally:

   ```bash
   gofmt -l .
   go vet ./...
   go test ./...
   go run . --dev
   ```

4. Open a pull request into `main` and fill in the template. CI checks the build for Windows, macOS and Linux.

### Rules

- **Two languages.** Commit titles and descriptions are in Russian and English: the release notes users read are built from them. Every interface string goes into `web/js/i18n.js` in both languages.
- **Simple and extended mode.** Anything complex appears only in extended mode. In simple mode such items are hidden, not just disabled.
- **No explanations in panels.** Short clear labels and tooltips; details go to the guide (`web/js/guide.js`).
- **A dark workspace.** The style is described in `design-system/spline/MASTER.md`. Colours come from CSS variables.
- **`.sp` files must always open.** A new project field is optional and old files work without it. Everything read from a file is checked in `validateProject` and `project.Validate`.
- **A test for every fix.** For Go code, the test must fail without the fix.
- **No new dependencies or network access** without an issue first.
- **Only your own work and freely licensed material.** By sending a change you agree to the project's license ([MIT](LICENSE)).

### For the maintainer: merging and releasing

Merge a change:

```bash
gh pr checkout 123          # run it and try it by hand
gh pr merge 123 --squash    # a title in both languages
```

Release a version:

1. Tag and push: `git tag v0.41.0 && git push origin v0.41.0`.
2. GitHub Actions builds everything and creates a **draft** release. Users do not see it and the app does not offer it.
3. Download the build, try it, edit the release text.
4. Publish the draft. From that moment the update reaches everyone.
5. Update the site (see `deploy/`).
