/** Let the browser paint the busy overlay before the next chunk of work. */
export function yieldToPaint(): Promise<void> {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame !== 'function') {
      setTimeout(resolve, 0);
      return;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 0);
      });
    });
  });
}
