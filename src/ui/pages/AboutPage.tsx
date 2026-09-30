// Page «О приложении» (registered as 'about' in src/ui/pages.ts); owner: D6.
// The version, where the data lives (only on this phone), how to put the app on the Home Screen, and
// what the PIN is. No links to the internet: the app makes no network requests. The third-party licences
// are a file of the app itself (licenses.md next to index.html, emitted by the build and precached by
// the service worker), opened in a new window so the app stays where it was.
import './AboutPage.css';
import { version } from '../../../package.json';
import { Page, Row, Section } from '../kit';
import type { RoutedPageProps } from '../nav';

const LICENSES_URL = `${import.meta.env.BASE_URL}licenses.md`;

const INSTALL_STEPS = [
  'Откройте приложение в Safari.',
  'Нажмите «Поделиться» — квадрат со стрелкой вверх.',
  'Выберите «На экран „Домой“» и нажмите «Добавить».',
  'Открывайте приложение значком на экране «Домой».',
];

export function AboutPage(_props: RoutedPageProps) {
  return (
    <Page title="О приложении" subtitle="Трекер расходов">
      <Section>
        <Row title="Версия" value={version} valueTone="muted" />
        <Row
          title="Лицензии сторонних библиотек"
          chevron
          onClick={() => void window.open(LICENSES_URL, '_blank', 'noopener')}
        />
      </Section>
      <Section header="Где хранятся данные">
        <p class="about-text">
          Данные хранятся только на этом телефоне. Приложение ничего не отправляет в интернет и
          работает без него.
        </p>
        <p class="about-text">
          Если удалить приложение или данные сайта в настройках Safari, данные пропадут. Вернуть их можно только из
          резервной копии — делайте её регулярно («Ещё» → «Резервная копия»).
        </p>
      </Section>
      <Section
        header="Как установить на экран «Домой»"
        footer="С экрана «Домой» приложение открывается на весь экран, работает без интернета, и iOS не удаляет его данные, если им долго не пользоваться."
      >
        <ol class="about-steps">
          {INSTALL_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </Section>
      <Section header="PIN-код">
        <p class="about-text">
          PIN защищает от посторонних глаз, но не шифрует данные. Если забыть PIN, данные можно только удалить и
          вернуть из резервной копии.
        </p>
      </Section>
    </Page>
  );
}
