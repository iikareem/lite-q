import {after, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import Database from 'better-sqlite3';
import {LiteQ} from '../src/queue/lite-q.js';

const FAST_WORKER = resolve('./test/fixtures/fast-worker.js');

async function waitFor(
    predicate: () => Promise<boolean>,
    timeoutMs = 5000,
    intervalMs = 50,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
    }
    throw new Error('timed out waiting for condition');
}

describe('queue.metrics()', () => {
    const queues: LiteQ[] = [];
    const tempDirs: string[] = [];

    after(async () => {
        for (const queue of queues) {
            await queue.stop().catch(() => {});
        }
        for (const dir of tempDirs) {
            await rm(dir, {recursive: true, force: true});
        }
    });

    it('returns valid Prometheus text for an empty queue', async () => {
        const queue = new LiteQ({storagePath: ':memory:'});
        queues.push(queue);

        const text = await queue.metrics();

        assert.match(text, /# TYPE liteq_io_active gauge/);
        assert.match(text, /liteq_io_active 0/);
        assert.match(text, /liteq_worker_pool\{state="busy"\} 0/);
        assert.match(text, /liteq_worker_pool\{state="idle"\} 0/);
        assert.match(text, /liteq_worker_pool\{state="queued"\} 0/);
        assert.match(text, /# TYPE liteq_cron_schedules gauge/);
        assert.match(text, /liteq_cron_schedules\{enabled="true"\} 0/);
        assert.match(text, /liteq_cron_schedules\{enabled="false"\} 0/);
        assert.ok(text.endsWith('\n'));
    });

    it('emits gauges and histograms for completed I/O jobs', async () => {
        const queue = new LiteQ({storagePath: ':memory:', pollInterval: 50, concurrency: 2});
        queues.push(queue);

        const runIo = queue.register<{delayMs: number}>('send-email', async (job) => {
            await new Promise((resolvePromise) => setTimeout(resolvePromise, job.data.delayMs));
            return {sent: true};
        });

        await queue.start();
        await runIo({delayMs: 30});
        await runIo({delayMs: 30});
        await runIo({delayMs: 30});

        await waitFor(async () => (await queue.stats()).completed === 3);

        const text = await queue.metrics();

        assert.match(text, /liteq_jobs\{status="completed",type="io"\} 3/);
        assert.match(
            text,
            /liteq_jobs_by_name\{name="send-email",status="completed",type="io"\} 3/,
        );
        assert.match(
            text,
            /liteq_job_duration_seconds_count\{name="send-email",type="io"\} 3/,
        );
        assert.match(text, /liteq_job_duration_seconds_count\{type="io"\} 3/);
        assert.match(text, /liteq_io_active 0/);
    });

    it('emits metrics for completed worker jobs', async () => {
        const queue = new LiteQ({storagePath: ':memory:', pollInterval: 50, maxWorkers: 2});
        queues.push(queue);

        const runWorker = queue.register('generate-pdf', FAST_WORKER);

        await queue.start();
        await runWorker({orderId: '1'});
        await runWorker({orderId: '2'});

        await waitFor(async () => (await queue.stats()).completed === 2);

        const text = await queue.metrics();

        assert.match(text, /liteq_jobs\{status="completed",type="worker"\} 2/);
        assert.match(
            text,
            /liteq_jobs_by_name\{name="generate-pdf",status="completed",type="worker"\} 2/,
        );
        assert.match(
            text,
            /liteq_job_duration_seconds_count\{name="generate-pdf",type="worker"\} 2/,
        );
        assert.match(text, /liteq_job_duration_seconds_count\{type="worker"\} 2/);
    });

    it('respects windowMs for duration histograms', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'liteq-metrics-'));
        tempDirs.push(dir);
        const dbPath = join(dir, 'jobs.db');

        const queue = new LiteQ({storagePath: dbPath, pollInterval: 50});
        queues.push(queue);

        const runIo = queue.register('sync-ledger', async () => ({ok: true}));

        await queue.start();
        await runIo({});
        await runIo({});

        await waitFor(async () => (await queue.stats()).completed === 2);

        const db = new Database(dbPath);
        const oldest = db
            .prepare(
                `SELECT id FROM lite_q_jobs WHERE status = 'completed' ORDER BY completed_at ASC LIMIT 1`,
            )
            .get() as {id: string};
        db.prepare(`UPDATE lite_q_jobs SET completed_at = ? WHERE id = ?`).run(
            Date.now() - 7 * 24 * 60 * 60 * 1000,
            oldest.id,
        );
        db.close();

        const allTime = await queue.metrics();
        const recent = await queue.metrics({windowMs: 60 * 60 * 1000});

        assert.match(
            allTime,
            /liteq_job_duration_seconds_count\{name="sync-ledger",type="io"\} 2/,
        );
        assert.match(
            recent,
            /liteq_job_duration_seconds_count\{name="sync-ledger",type="io"\} 1/,
        );
    });
});

describe('queue.metrics() cron', () => {
    const queues: LiteQ[] = [];
    const tempDirs: string[] = [];

    after(async () => {
        for (const queue of queues) {
            await queue.stop().catch(() => {});
        }
        for (const dir of tempDirs) {
            await rm(dir, {recursive: true, force: true});
        }
    });

    it('emits execution counts and histograms per schedule', async () => {
        const queue = new LiteQ({storagePath: ':memory:'});
        queues.push(queue);

        const handle = queue.cron('cleanup-sessions', '0 0 * * *', async () => ({cleaned: true}));

        await handle.trigger();
        await handle.trigger();

        const text = await queue.metrics();

        assert.match(text, /# TYPE liteq_jobs gauge/);
        assert.match(text, /liteq_cron_schedules\{enabled="true"\} 1/);
        assert.match(
            text,
            /liteq_cron_executions\{schedule="cleanup-sessions",type="io",status="completed"\} 2/,
        );
        assert.match(
            text,
            /liteq_cron_duration_seconds_count\{schedule="cleanup-sessions",type="io"\} 2/,
        );
    });

    it('respects windowMs for cron duration histograms', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'liteq-cron-metrics-'));
        tempDirs.push(dir);
        const dbPath = join(dir, 'jobs.db');

        const queue = new LiteQ({storagePath: dbPath});
        queues.push(queue);

        const handle = queue.cron('cleanup-sessions', '0 0 * * *', async () => ({cleaned: true}));

        await handle.trigger();
        await handle.trigger();

        const db = new Database(dbPath);
        const oldest = db
            .prepare(
                `SELECT id FROM lite_q_cron_executions WHERE status = 'completed' ORDER BY completed_at ASC LIMIT 1`,
            )
            .get() as {id: string};
        db.prepare(`UPDATE lite_q_cron_executions SET completed_at = ? WHERE id = ?`).run(
            Date.now() - 7 * 24 * 60 * 60 * 1000,
            oldest.id,
        );
        db.close();

        const allTime = await queue.metrics();
        const recent = await queue.metrics({windowMs: 60 * 60 * 1000});

        assert.match(
            allTime,
            /liteq_cron_duration_seconds_count\{schedule="cleanup-sessions",type="io"\} 2/,
        );
        assert.match(
            recent,
            /liteq_cron_duration_seconds_count\{schedule="cleanup-sessions",type="io"\} 1/,
        );
    });
});
