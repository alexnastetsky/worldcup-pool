import { createApp, lakebase, server } from '@databricks/appkit';
import { setupPoolRoutes } from './routes/pool-routes';

createApp({
  plugins: [lakebase(), server()],
  async onPluginsReady(appkit) {
    await setupPoolRoutes(appkit);
  },
}).catch(console.error);
