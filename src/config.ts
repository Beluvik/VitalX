/**
 * Where the VitalX backend lives.
 *
 * After deploying the backend (see backend/README.md) paste its address here,
 * and the app uses it by default for food search, barcodes and photo reading.
 * Leave it empty to run without a backend: the app then talks to the food
 * databases directly and photo reading needs the user's own key in Setup.
 *
 * The token is a shared secret that only keeps casual strangers off the
 * server. Anything inside an app can be extracted, so it is not real security:
 * the server's own rate limits are what protect the quota.
 */
export const BACKEND_URL = 'https://vitalx-api.vitalx.workers.dev';
export const BACKEND_TOKEN = '';
