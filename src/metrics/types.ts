import type {ExecType} from '../db/types.js';
import type {MetricsOptions} from '../types.js';

export interface JobDurationRow {
    name: string;
    type: ExecType;
    durationMs: number;
}

export interface HistogramData {
    buckets: {le: number; count: number}[];
    sum: number;
    count: number;
}

export interface TypeStatusCount {
    type: ExecType;
    status: string;
    count: number;
}

export interface NameTypeStatusCount {
    name: string;
    type: ExecType;
    status: string;
    count: number;
}

export interface NameTypeHistogram {
    name: string;
    type: ExecType;
    histogram: HistogramData;
}

export interface TypeHistogram {
    type: ExecType;
    histogram: HistogramData;
}

export interface JobMetricsSnapshot {
    byTypeAndStatus: TypeStatusCount[];
    byNameTypeAndStatus: NameTypeStatusCount[];
    ioActive: number;
    workerPool: {busy: number; idle: number; queued: number};
    histogramsByNameType: NameTypeHistogram[];
    histogramsByType: TypeHistogram[];
    bucketsSec: number[];
}

export type {MetricsOptions};
