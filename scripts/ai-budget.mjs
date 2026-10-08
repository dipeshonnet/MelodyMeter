import { cloudflare, accountId } from './cloudflare.mjs';
const result = await cloudflare(`/accounts/${accountId}/d1/database/8896068d-2e1b-478b-ab30-bdc31153a7b5/query`, 'POST', { sql: "SELECT SUM(amount) AS reserved,COUNT(*) AS attempts FROM budget_reservations WHERE kind='ai' AND created_at>=unixepoch('now','start of day');" });
console.log(result[0].results);
