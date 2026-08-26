/**
 * Executes a promise with a bounded timeout. If the promise does not resolve
 * within `ms` milliseconds, or if it throws, a warning is logged (if logger provided)
 * and `fallbackValue` is returned without leaking the timer handle.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallbackValue: T,
  label?: string,
  logger?: { warn: (msg: string, ...args: any[]) => void }
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      if (logger && label) {
        logger.warn(`Operation "${label}" timed out after ${ms}ms.`);
      }
      resolve(fallbackValue);
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } catch (err: any) {
    if (logger && label) {
      logger.warn(`Operation "${label}" failed with error: ${err?.message || err}`);
    }
    return fallbackValue;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
