export * from './api/client';
import { systemApi } from './api/systemApi';
import { fsApi } from './api/fsApi';
import { pluginsApi } from './api/pluginsApi';
import { secretsApi } from './api/secretsApi';
import { fleetApi } from './api/fleetApi';

export const api = {
  ...systemApi,
  ...fsApi,
  ...pluginsApi,
  ...secretsApi,
  ...fleetApi,
};

export default api;
