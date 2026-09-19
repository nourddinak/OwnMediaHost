// Universal, robust clipboard copy utility with fallback for insecure origins / webviews / mobile

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // 1. Try modern navigator.clipboard API if available
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('navigator.clipboard.writeText failed, falling back to execCommand:', err);
    }
  }

  // 2. Fallback to textarea + document.execCommand('copy')
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    // Ensure element is not visible on screen and does not cause scroll jumps
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.width = '1px';
    textArea.style.height = '1px';
    textArea.style.padding = '0';
    textArea.style.border = 'none';
    textArea.style.outline = 'none';
    textArea.style.boxShadow = 'none';
    textArea.style.background = 'transparent';
    textArea.setAttribute('readonly', '');

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    // Workaround for iOS Safari
    const range = document.createRange();
    range.selectNodeContents(textArea);
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    textArea.setSelectionRange(0, 999999);

    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch (fallbackErr) {
    console.error('execCommand copy fallback failed:', fallbackErr);
    return false;
  }
}

/**
 * Copy text and show a toast notification (success or failure).
 * Avoids duplicating the same copy-then-toast pattern across pages.
 */
export async function copyWithToast(
  text: string,
  toast: (message: string, type?: 'success' | 'error' | 'info') => void,
  successMessage = 'Copied to clipboard!'
): Promise<boolean> {
  const ok = await copyTextToClipboard(text);
  if (ok) {
    toast(successMessage);
  } else {
    toast('Could not access clipboard. Please copy manually.', 'error');
  }
  return ok;
}
