import type {HistogramData} from './types.js';

export function buildHistogram(durationsMs: number[], bucketsSec: number[]): HistogramData {
    if (durationsMs.length === 0) {
        return {
            buckets: bucketsSec.map((le) => ({le, count: 0})),
            sum: 0,
            count: 0,
        };
    }

    const sorted = [...durationsMs].sort((a, b) => a - b);
    const sum = sorted.reduce((total, ms) => total + ms, 0) / 1000;
    const buckets = bucketsSec.map((le) => ({
        le,
        count: sorted.filter((ms) => ms / 1000 <= le).length,
    }));

    return {buckets, sum, count: sorted.length};
}
