// Centred placeholder for a list or screen with nothing to show yet.
import type { KitAction } from './Banner';

export interface EmptyStateProps {
  title: string;
  text?: string;
  action?: KitAction;
}

export function EmptyState({ title, text, action }: EmptyStateProps) {
  return (
    <div class="empty-state">
      <p class="empty-title">{title}</p>
      {text && <p class="empty-text">{text}</p>}
      {action && (
        <button type="button" class="btn btn-plain" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
