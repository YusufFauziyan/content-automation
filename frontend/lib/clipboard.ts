'use client';

/**
 * Copies text, including where the Clipboard API is unavailable.
 *
 * `navigator.clipboard` exists only in a secure context. Opening the dev server
 * over the LAN — `http://192.168.1.14:3000`, the address Next prints next to
 * localhost — is not one, so the API is simply undefined there and every copy
 * fails. Since the prompts are the whole point of the recovery panel, this
 * falls back to a hidden textarea and `execCommand`, which is deprecated but
 * still the only thing that works on plain HTTP.
 *
 * @returns Whether the text reached the clipboard.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission refused, or a browser that reports the API but blocks it.
      // Fall through rather than give up.
    }
  }

  return copyViaTextarea(text);
}

function copyViaTextarea(text: string): boolean {
  if (typeof document === 'undefined') return false;

  const field = document.createElement('textarea');
  field.value = text;

  // Off-screen rather than hidden: `display:none` cannot hold a selection, and
  // `readOnly` stops iOS opening the keyboard over the page.
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.top = '-1000px';
  field.style.opacity = '0';

  document.body.appendChild(field);

  const selection = document.getSelection();
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  field.select();
  field.setSelectionRange(0, text.length);

  let copied = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }

  document.body.removeChild(field);

  // Put back whatever the reader had selected before we borrowed the selection.
  if (previous && selection) {
    selection.removeAllRanges();
    selection.addRange(previous);
  }

  return copied;
}
