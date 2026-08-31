import { Alert, Platform } from 'react-native';

/**
 * React Native's `Alert` is a no-op on react-native-web -- `Alert.alert()` is
 * literally an empty method there. Every confirmation and every error message
 * routed through it therefore vanished on the web build: "Leave this session?"
 * did nothing at all, which on a screen with no tab bar and no back gesture
 * left the user stuck mid-session.
 *
 * These two helpers are the only way the app should ask or tell: native gets
 * the real dialog, web gets the browser's.
 */

export function notify(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

export function confirm({
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  destructive = false,
}: {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}): Promise<boolean> {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    return Promise.resolve(window.confirm(message ? `${title}\n\n${message}` : title));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      {
        text: confirmLabel,
        style: destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ]);
  });
}
