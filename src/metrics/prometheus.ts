import type {HistogramData, JobMetricsSnapshot} from './types.js';

function escapeLabel(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function formatLabels(labels: Record<string, string>): string {
    const parts = Object.entries(labels).map(([key, value]) => `${key}="${escapeLabel(value)}"`);
    return parts.length > 0 ? `{${parts.join(',')}}` : '';
}

function appendGauge(lines: string[], name: string, value: number, labels?: Record<string, string>): void {
    lines.push(`${name}${formatLabels(labels ?? {})} ${value}`);
}

function appendHistogram(
    lines: string[],
    name: string,
    histogram: HistogramData,
    labels: Record<string, string>,
): void {
    for (const bucket of histogram.buckets) {
        appendGauge(lines, `${name}_bucket`, bucket.count, {...labels, le: String(bucket.le)});
    }
    appendGauge(lines, `${name}_bucket`, histogram.count, {...labels, le: '+Inf'});
    appendGauge(lines, `${name}_sum`, histogram.sum, labels);
    appendGauge(lines, `${name}_count`, histogram.count, labels);
}

export function formatJobMetricsPrometheus(snapshot: JobMetricsSnapshot): string {
    const lines: string[] = [];

    lines.push('# HELP liteq_jobs Number of jobs by status and execution type');
    lines.push('# TYPE liteq_jobs gauge');
    for (const row of snapshot.byTypeAndStatus) {
        appendGauge(lines, 'liteq_jobs', row.count, {status: row.status, type: row.type});
    }

    lines.push('# HELP liteq_jobs_by_name Number of jobs by name, status, and execution type');
    lines.push('# TYPE liteq_jobs_by_name gauge');
    for (const row of snapshot.byNameTypeAndStatus) {
        appendGauge(lines, 'liteq_jobs_by_name', row.count, {
            name: row.name,
            status: row.status,
            type: row.type,
        });
    }

    lines.push('# HELP liteq_io_active Currently running I/O jobs on the main thread');
    lines.push('# TYPE liteq_io_active gauge');
    appendGauge(lines, 'liteq_io_active', snapshot.ioActive);

    lines.push('# HELP liteq_worker_pool Worker pool state');
    lines.push('# TYPE liteq_worker_pool gauge');
    appendGauge(lines, 'liteq_worker_pool', snapshot.workerPool.busy, {state: 'busy'});
    appendGauge(lines, 'liteq_worker_pool', snapshot.workerPool.idle, {state: 'idle'});
    appendGauge(lines, 'liteq_worker_pool', snapshot.workerPool.queued, {state: 'queued'});

    lines.push('# HELP liteq_job_duration_seconds Job execution duration in seconds');
    lines.push('# TYPE liteq_job_duration_seconds histogram');
    for (const row of snapshot.histogramsByNameType) {
        appendHistogram(lines, 'liteq_job_duration_seconds', row.histogram, {
            name: row.name,
            type: row.type,
        });
    }
    for (const row of snapshot.histogramsByType) {
        appendHistogram(lines, 'liteq_job_duration_seconds', row.histogram, {type: row.type});
    }

    return `${lines.join('\n')}\n`;
}
