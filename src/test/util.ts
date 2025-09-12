export async function sleep(time_ms: number) {
  return new Promise(resolve => setTimeout(resolve, time_ms));
}

export async function withTimeout(p: Promise<boolean>, time_ms: number) {
  let h: NodeJS.Timeout;

  const tp = new Promise((_, reject) => {
    h = setTimeout(
      () => reject(new Error(`promise timed out after ${time_ms}ms`)),
      time_ms
    );
  });

  return Promise.race([p, tp]).then(r => {
    clearTimeout(h);
    return r;
  })
}