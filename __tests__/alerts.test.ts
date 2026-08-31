import { Alert, Platform } from 'react-native';

import { confirm, notify } from '@/lib/alerts';

/**
 * react-native-web ships `Alert.alert` as an empty method, so anything routed
 * through it on the web build silently did nothing -- including the only way
 * out of a running session. These lock the browser path in place.
 */
describe('alerts on web', () => {
  const original = Platform.OS;
  // The React Native test environment has a `window`, but none of the browser
  // dialogs on it, so they are installed rather than spied on.
  let browserConfirm: jest.Mock<boolean, [string?]>;
  let browserAlert: jest.Mock<void, [string?]>;

  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    browserConfirm = jest.fn(() => true);
    browserAlert = jest.fn();
    (window as unknown as { confirm: unknown }).confirm = browserConfirm;
    (window as unknown as { alert: unknown }).alert = browserAlert;
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
    jest.restoreAllMocks();
  });

  it('confirms through the browser dialog, not the no-op Alert', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');

    await expect(confirm({ title: 'Leave this session?', message: 'Saved.' })).resolves.toBe(true);
    expect(browserConfirm).toHaveBeenCalledWith('Leave this session?\n\nSaved.');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('resolves false when the browser dialog is dismissed', async () => {
    browserConfirm.mockReturnValue(false);
    await expect(confirm({ title: 'Build a new plan?' })).resolves.toBe(false);
  });

  it('tells through the browser dialog', () => {
    notify('Could not save', 'Try again.');
    expect(browserAlert).toHaveBeenCalledWith('Could not save\n\nTry again.');
  });
});

describe('alerts on a device', () => {
  it('asks with a real two-button Alert and resolves what was tapped', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const pending = confirm({ title: 'Leave this session?', confirmLabel: 'Leave', cancelLabel: 'Stay' });

    const buttons = alertSpy.mock.calls[0][2]!;
    expect(buttons.map((b) => b.text)).toEqual(['Stay', 'Leave']);

    buttons[1].onPress!();
    await expect(pending).resolves.toBe(true);
    alertSpy.mockRestore();
  });
});
