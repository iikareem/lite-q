import type {ExecType} from '../db/types.js';
import type {QueueContext} from '../queue/context.js';
import type {MetricsOptions} from '../types.js';
import {buildHistogram} from './histogram.js';
import type {JobMetricsSnapshot, NameTypeHistogram, TypeHistogram, CronMetricsSnapshot, ScheduleHistogram} from './types.js';

export const DEFAULT_METRIC_BUCKETS_SEC = [0.1, 0.5, 1, 2, 5, 10, 30, 60];

function resolveSince(windowMs?: number): number | undefined {
    return windowMs !== undefined ? Date.now() - windowMs : undefined;
}

function resolveBucketsSec(buckets?: number[]): number[] {
    return buckets ?? DEFAULT_METRIC_BUCKETS_SEC;
}

export function collectJobMetrics(ctx: QueueContext, options?: MetricsOptions): JobMetricsSnapshot {
    const bucketsSec = resolveBucketsSec(options?.buckets);
    const since = resolveSince(options?.windowMs);

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

export function collectCronMetrics(ctx: QueueContext, options?: MetricsOptions): CronMetricsSnapshot {
    const bucketsSec = resolveBucketsSec(options?.buckets);
    const since = resolveSince(options?.windowMs);

    const {total, enabled} = ctx.cronDb.cronJobCounts();

    const byScheduleAndStatus = ctx.cronDb.executionStatsBySchedule().map((row) => ({
        schedule: row.name,
        type: row.type as ExecType,
        status: row.status,
        count: Number(row.count),
    }));

    const durationRows = ctx.cronDb.executionDurations(since).map((row) => ({
        schedule: row.name,
        type: row.type as ExecType,
        durationMs: Number(row.duration_ms),
    }));

    const bySchedule = new Map<string, number[]>();
    for (const row of durationRows) {
        const key = `${row.schedule}\0${row.type}`;
        const durations = bySchedule.get(key) ?? [];
        durations.push(row.durationMs);
        bySchedule.set(key, durations);
    }

    const histogramsBySchedule: ScheduleHistogram[] = [];
    for (const [key, durations] of bySchedule) {
        const [schedule, type] = key.split('\0') as [string, ExecType];
        histogramsBySchedule.push({
            schedule,
            type,
            histogram: buildHistogram(durations, bucketsSec),
        });
    }

    histogramsBySchedule.sort(
        (a, b) => a.schedule.localeCompare(b.schedule) || a.type.localeCompare(b.type),
    );

    return {
        schedulesEnabled: enabled,
        schedulesDisabled: total - enabled,
        byScheduleAndStatus,
        histogramsBySchedule,
        bucketsSec,
    };
}
