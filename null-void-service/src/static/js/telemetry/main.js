import { startMetrics } from './sys_metrics.js';

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startMetrics);
} else {
    startMetrics();
}
