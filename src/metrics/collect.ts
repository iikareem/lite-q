import type {ExecType} from '../db/types.js';
import type {QueueContext} from '../queue/context.js';
import type {MetricsOptions} from '../types.js';
import {buildHistogram} from './histogram.js';
import type {JobMetricsSnapshot, NameTypeHistogram, TypeHistogram} from './types.js';

export const DEFAULT_METRIC_BUCKETS_SEC = [0.1, 0.5, 1, 2, 5, 10, 30, 60];

export function collectJobMetrics(ctx: QueueContext, options?: MetricsOptions): JobMetricsSnapshot {
    const bucketsSec = options?.buckets ?? DEFAULT_METRIC_BUCKETS_SEC;
    const since =
        options?.windowMs !== undefined ? Date.now() - options.windowMs : undefined;

    const byTypeAndStatus = ctx.db.statsByTypeAndStatus().map((row) => ({
        type: row.type as ExecType,
        status: row.status,
        count: Number(row.count),
    }));

    const byNameTypeAndStatus = ctx.db.statsByNameTypeAndStatus().map((row) => ({
        name: row.name,
        type: row.type as ExecType,
        status: row.status,
        count: Number(row.count),
    }));

    const durationRows = ctx.db.completedDurations(since).map((row) => ({
        name: row.name,
        type: row.type as ExecType,
        durationMs: Number(row.duration_ms),
    }));

    const byNameType = new Map<string, number[]>();
    const byType = new Map<ExecType, number[]>();

    for (const row of durationRows) {
        const nameKey = `${row.name}\0${row.type}`;
        const nameDurations = byNameType.get(nameKey) ?? [];
        nameDurations.push(row.durationMs);
        byNameType.set(nameKey, nameDurations);

        const typeDurations = byType.get(row.type) ?? [];
        typeDurations.push(row.durationMs);
        byType.set(row.type, typeDurations);
    }

    const histogramsByNameType: NameTypeHistogram[] = [];
    for (const [key, durations] of byNameType) {
        const [name, type] = key.split('\0') as [string, ExecType];
        histogramsByNameType.push({
            name,
            type,
            histogram: buildHistogram(durations, bucketsSec),
        });
    }

    const histogramsByType: TypeHistogram[] = [];
    for (const [type, durations] of byType) {
        histogramsByType.push({
            type,
            histogram: buildHistogram(durations, bucketsSec),
        });
    }

    histogramsByNameType.sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
    histogramsByType.sort((a, b) => a.type.localeCompare(b.type));

    return {
        byTypeAndStatus,
        byNameTypeAndStatus,
        ioActive: ctx.activeIo.count,
        workerPool: ctx.pool.snapshot(),
        histogramsByNameType,
        histogramsByType,
        bucketsSec,
    };
}
