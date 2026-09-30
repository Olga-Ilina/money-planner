// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ioErrorMessage } from '../../src/ui/io';
import { MAX_FILE_BYTES, XLSX_MIME, pickFile, shareFile } from '../../src/ui/share';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const buffer = new Uint8Array([1, 2, 3]).buffer;

function stubNavigator(nav: Partial<Navigator>): void {
  vi.stubGlobal('navigator', { ...navigator, ...nav });
}

describe('shareFile', () => {
  it('uses the share sheet with an .xlsx file when files can be shared', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ canShare: () => true, share });
    await expect(shareFile('Отчёт.xlsx', buffer)).resolves.toBe('shared');
    const arg = share.mock.calls[0]?.[0] as ShareData;
    expect(arg.title).toBe('Отчёт.xlsx');
    const file = arg.files?.[0];
    expect(file?.name).toBe('Отчёт.xlsx');
    expect(file?.type).toBe(XLSX_MIME);
    expect(file?.size).toBe(3);
  });

  it('closing the share sheet is not an error', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    stubNavigator({ canShare: () => true, share });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    await expect(shareFile('Отчёт.xlsx', buffer)).resolves.toBe('cancelled');
    expect(click).not.toHaveBeenCalled();
  });

  it('downloads through a link when files cannot be shared', async () => {
    stubNavigator({ canShare: undefined, share: undefined });
    const createObjectURL = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    let clicked: HTMLAnchorElement | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked = this;
    });
    await expect(shareFile('Копия.xlsx', buffer)).resolves.toBe('downloaded');
    expect(clicked).not.toBeNull();
    expect(clicked!.download).toBe('Копия.xlsx');
    expect(clicked!.href).toBe('blob:x');
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('falls back to the download when the share sheet refuses', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('no gesture', 'NotAllowedError'));
    stubNavigator({ canShare: () => true, share });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:y'), revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await expect(shareFile('Отчёт.xlsx', buffer)).resolves.toBe('downloaded');
    expect(click).toHaveBeenCalledOnce();
  });
});

describe('pickFile', () => {
  it('opens a hidden file input and resolves with the chosen file', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const promise = pickFile('.xlsx');
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input!.accept).toBe('.xlsx');
    expect(click).toHaveBeenCalledOnce();
    const file = new File(['x'], 'Трекер.xlsx');
    Object.defineProperty(input, 'files', { value: [file] });
    input!.dispatchEvent(new Event('change'));
    await expect(promise).resolves.toBe(file);
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  function choose(size: number): Promise<File | null> {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const promise = pickFile('.xlsx');
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['x'], 'Трекер.xlsx');
    Object.defineProperty(file, 'size', { value: size });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    return promise;
  }

  it('refuses a file over 20 MB with «Файл больше 20 МБ» (a message for the user)', async () => {
    expect(MAX_FILE_BYTES).toBe(20 * 1024 * 1024);
    const e = await choose(MAX_FILE_BYTES + 1).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).toBe('Файл больше 20 МБ');
    expect(ioErrorMessage(e)).toBe('Файл больше 20 МБ');
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('accepts a file of exactly 20 MB', async () => {
    await expect(choose(MAX_FILE_BYTES)).resolves.not.toBeNull();
  });

  it('resolves null when the picker is cancelled', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const promise = pickFile('.xlsx');
    document.querySelector('input[type="file"]')!.dispatchEvent(new Event('cancel'));
    await expect(promise).resolves.toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
});
