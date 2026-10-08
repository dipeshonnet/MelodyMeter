import { cloudflare, accountId } from './cloudflare.mjs';
const path = `/accounts/${accountId}/d1/database/8896068d-2e1b-478b-ab30-bdc31153a7b5/query`;
const result = await cloudflare(path, 'POST', { sql: `
INSERT OR IGNORE INTO ai_assessment_history(song_id,payload,model,rubric_version,generated_at,archived_at,correction_reason)
SELECT song_id,payload,model,rubric_version,generated_at,unixepoch(),'Ease-score polarity calibration before launch'
FROM ai_ratings WHERE rubric_version='comfortable-melody-v1';
UPDATE generation_jobs SET status='queued',attempts=0,next_attempt_at=0,lease_until=0,lease_token=NULL,message=NULL
WHERE song_id IN (SELECT song_id FROM ai_ratings WHERE rubric_version='comfortable-melody-v1');
DELETE FROM ai_ratings WHERE rubric_version='comfortable-melody-v1'
AND EXISTS(SELECT 1 FROM ai_assessment_history h WHERE h.song_id=ai_ratings.song_id AND h.payload=ai_ratings.payload);
` });
console.log('Initial assessments archived and queued for the corrected rubric; audience votes unchanged.', result.map(r => ({ success: r.success, changes: r.meta?.changes })));
