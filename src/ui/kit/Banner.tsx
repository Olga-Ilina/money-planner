// A card-like notice at the top of a screen: «сделайте резервную копию», «доступна новая версия», errors.
import type { ComponentChildren } from 'preact';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export interface KitAction {
  label: string;
  onClick: () => void;
  /** Busy (e.g. while a file is made): the button is shown but cannot be pressed. */
  disabled?: boolean;
}

export interface BannerProps {
  tone: 'info' | 'warning' | 'error' | 'success';
  children: ComponentChildren;
  action?: KitAction;
  /** Adds a close button. */
  onClose?: () => void;
}

const TONE_ICON: Record<BannerProps['tone'], IconName> = {
  info: 'info',
  warning: 'warning',
  error: 'alert',
  success: 'check-circle',
};

export function Banner({ tone, children, action, onClose }: BannerProps) {
  return (
    <div class={`banner banner-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span class="banner-icon">
        <Icon name={TONE_ICON[tone]} size={20} />
      </span>
      <div class="banner-text">{children}</div>
      {action && (
        <button type="button" class="banner-action" disabled={action.disabled} onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {onClose && (
        <button type="button" class="icon-button banner-close" aria-label="Закрыть" onClick={onClose}>
          <Icon name="x" size={18} />
        </button>
      )}
    </div>
  );
}
