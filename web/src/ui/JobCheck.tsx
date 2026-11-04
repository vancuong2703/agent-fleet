import type { Run } from '../../../shared/types.js';
import { runDiagnostic } from '../../../shared/run-diagnostics.js';
import { Notice } from './Common.js';
import { useLanguage } from './language.js';
export function JobCheck({ run }: { run: Run | null }) {
  const { t } = useLanguage(); const diagnostic = runDiagnostic(run);
  return <>{run?.checkPassed != null && <p className={`job-check ${run.checkPassed ? 'ok' : 'bad'}`}>{t('Check', 'Kiểm tra')}: {run.checkPassed ? 'PASS' : 'FAIL'}</p>}{diagnostic && <Notice message={diagnostic} error />}</>;
}
