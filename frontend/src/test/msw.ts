import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

export const healthyResponse = () =>
  HttpResponse.json({
    status: 'ok',
    version: '0.0.0',
    uptime: 1,
    timestamp: new Date().toISOString(),
  });

/** Default handlers: the API is healthy. Tests override with `server.use(...)`. */
export const server = setupServer(http.get('*/v1/health', healthyResponse));

export { HttpResponse, http };
