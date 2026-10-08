export async function deliverExport(json: string, filename: string, assertCurrentAccount: () => Promise<void>): Promise<void> {
  await assertCurrentAccount();
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Allow the browser to consume the click before releasing the Blob.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
export function cleanupExports(): void {}
