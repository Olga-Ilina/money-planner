import { describe, expect, it } from 'vitest';
import { App } from '../src/ui/App';

describe('scaffold', () => {
  it('exposes the App component', () => {
    expect(typeof App).toBe('function');
  });
});
