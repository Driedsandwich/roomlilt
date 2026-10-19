import { createApplication } from './app.js';

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be a valid local TCP port.');
const application = await createApplication({ dataFile: process.env.DATA_FILE });
const address = await application.listen(port);
console.log(`RoomLilt MCP ready at ${address.url} (protocol 2025-11-25)`);
console.log('Fictional household only. Open http://127.0.0.1:5173 for the simulated experience.');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await application.close();
  process.exit(0);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
