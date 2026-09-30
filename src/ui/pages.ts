// Registry of the pages that can be pushed inside a tab: pushPage(tab, name, params).
// Each page lives in its own file under src/ui/pages/ (one owner per file); names are the contract.
import type { ComponentType } from 'preact';
import type { RoutedPageProps } from './nav';
import { AboutPage } from './pages/AboutPage';
import { AccountPage } from './pages/AccountPage';
import { AccountsSettingsPage } from './pages/AccountsSettingsPage';
import { BackupPage } from './pages/BackupPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { CreditPage } from './pages/CreditPage';
import { DebtsPage } from './pages/DebtsPage';
import { ImportPage } from './pages/ImportPage';
import { PinPage } from './pages/PinPage';
import { PurchasesPage } from './pages/PurchasesPage';
import { RecurringPage } from './pages/RecurringPage';
import { SettingsPage } from './pages/SettingsPage';

export const pages: Record<string, ComponentType<RoutedPageProps>> = {
  // owner D5
  recurring: RecurringPage,
  purchases: PurchasesPage,
  debts: DebtsPage,
  // owner D6
  categories: CategoriesPage,
  'accounts-settings': AccountsSettingsPage,
  settings: SettingsPage,
  pin: PinPage,
  import: ImportPage,
  backup: BackupPage,
  about: AboutPage,
  // owner D3: 'account' takes params { id }
  account: AccountPage,
  credit: CreditPage,
};
