
// Sleep for the given number of milliseconds
export async function sleep(time_ms: number) {
  return new Promise(resolve => setTimeout(resolve, time_ms));
}